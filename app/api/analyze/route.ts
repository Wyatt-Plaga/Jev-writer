import { APIError, AuthenticationError, RateLimitError, choice, noul } from "@typesafe-ai/sdk";
import { BEATS, BEAT_INFO, type Beat } from "@/lib/beats";
import {
  MAX_SENTENCES,
  type AnalysisResult,
  type AnalyzeEvent,
  type AnalyzeRequest,
  type DeviationRun,
  type SentenceResult,
} from "@/lib/analysis";
import { CRITERIA, NEXT_BEAT_INSTRUCTIONS, getClient, toDist, type Dist } from "@/lib/jev";

// Requests to Jev in flight at once. The SDK retries 429s using retry-after.
const CONCURRENCY = 8;
// Text before each sentence is capped at roughly the last 4k tokens.
const PREFIX_CHARS = 16_000;
// Sentences labeled per call, as separate questions over one numbered passage.
const LABEL_BATCH = 20;
// Sentences of context on each side of a labeling batch.
const LABEL_CONTEXT = 6;
// How many top deviations get the "mistake or intentional surprise" check.
const MOMENTUM_CANDIDATES = 15;
const MIN_SCORE_TO_CHECK = 0.15;
// Momentum answers between these are too close to call, so they go in neither list.
const BREAKS_MOMENTUM = 0.6;
const WORKS_AS_SURPRISE = 0.4;

// Below this, Jev doesn't think a beat would work at that point.
const WOULDNT_WORK = 0.4;

// "Would a sentence of this beat work here?", asked separately for every beat
// so that several good options don't have to split one probability. Each is
// asked two ways and averaged; disagreement between them lowers the score.
const WORKS_PHRASINGS = [
  (b: Beat) =>
    `If the writer's next sentence were ${b} (${BEAT_INFO[b].definition.toLowerCase()}), would it work well at this exact point in the story?`,
  (b: Beat) =>
    `Would a skilled editor accept a ${b} sentence (${BEAT_INFO[b].definition.toLowerCase()}) as the very next sentence here?`,
];

type Sentence = AnalyzeRequest["sentences"][number];

function joinSentences(sentences: Sentence[]) {
  let out = "";
  sentences.forEach((s, i) => {
    if (i > 0) out += s.paragraph === sentences[i - 1].paragraph ? " " : "\n\n";
    out += s.text;
  });
  return out;
}

function prefixBefore(sentences: Sentence[], k: number) {
  const text = joinSentences(sentences.slice(0, k));
  return text.length > PREFIX_CHARS ? "…" + text.slice(-PREFIX_CHARS) : text;
}

function numberedPassage(sentences: Sentence[], from: number, to: number) {
  let out = "";
  for (let i = from; i < to; i++) {
    if (i > from) out += sentences[i].paragraph === sentences[i - 1].paragraph ? " " : "\n\n";
    out += `[${i + 1}] ${sentences[i].text}`;
  }
  return out;
}

const argmax = (d: Dist, skip?: Beat) =>
  BEATS.filter((b) => b !== skip).reduce((best, b) => (d[b] > d[best] ? b : best));
// Three decimals is plenty for display and keeps the response small.
const round = (d: Dist) => Object.fromEntries(BEATS.map((b) => [b, Math.round(d[b] * 1000) / 1000])) as Dist;

// Runs tasks with at most `limit` in flight, in order of the array.
async function pool<T>(tasks: (() => Promise<T>)[], limit: number, onDone: () => void) {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      onDone();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function errorMessage(error: unknown) {
  if (error instanceof AuthenticationError) return "Missing or invalid TYPESAFE_API_KEY.";
  if (error instanceof RateLimitError) return "Jev rate limit hit; try again in a moment.";
  if (error instanceof APIError) return `Jev API error: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function analyze(
  req: AnalyzeRequest,
  signal: AbortSignal,
  send: (e: AnalyzeEvent) => void,
): Promise<AnalysisResult> {
  const client = getClient();
  const { sentences } = req;
  const notes: Record<string, string> = req.notes?.trim() ? { story_notes: req.notes.trim() } : {};
  const n = sentences.length;
  let calls = 0;
  let inputTokens = 0;
  const call: typeof client.systemOne = (request, options) => {
    calls++;
    const p = client.systemOne(request, { ...options, signal, retry: { maxRetries: 5 } });
    p.then((r) => (inputTokens += r.usage.input_tokens ?? 0)).catch(() => {});
    return p;
  };

  const labelBatches = Math.ceil(n / LABEL_BATCH);
  let total = n - 1 + labelBatches + MOMENTUM_CANDIDATES;
  let done = 0;
  const progress = (stage: string) => () => send({ type: "progress", done: ++done, total, stage });

  // 1. From the text before each sentence only: which beat Jev expects most,
  // and whether each beat would work there.
  const predictions = await pool(
    sentences.slice(1).map((_, i) => async () => {
      const k = i + 1;
      const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
        expected: choice(NEXT_BEAT_INSTRUCTIONS, CRITERIA),
      };
      for (const b of BEATS) WORKS_PHRASINGS.forEach((q, j) => (questions[`w${j}_${b}`] = noul(q(b))));
      const r = await call({ state: { ...notes, manuscript_before_cursor: prefixBefore(sentences, k) }, questions });
      const answer = (key: string) => r.answers[key] as unknown as { noul: number; probabilities: Partial<Dist> };
      const phrasings = WORKS_PHRASINGS.map(
        (_, j) => Object.fromEntries(BEATS.map((b) => [b, answer(`w${j}_${b}`).noul])) as Dist,
      );
      return {
        expected: toDist(answer("expected").probabilities),
        works: Object.fromEntries(BEATS.map((b) => [b, (phrasings[0][b] + phrasings[1][b]) / 2])) as Dist,
        // 1 when both phrasings gave the same answers, lower as they drift apart.
        stability: 1 - BEATS.reduce((s, b) => s + Math.abs(phrasings[0][b] - phrasings[1][b]), 0) / BEATS.length,
      };
    }),
    CONCURRENCY,
    progress("Predicting each sentence"),
  );

  // 2. What each sentence actually does, labeled in context.
  const labelChunks = await pool(
    Array.from({ length: labelBatches }, (_, b) => async () => {
      const from = b * LABEL_BATCH;
      const to = Math.min(n, from + LABEL_BATCH);
      const questions = Object.fromEntries(
        Array.from({ length: to - from }, (_, j) => [
          `s${from + j + 1}`,
          choice(`What does sentence [${from + j + 1}] do in the story?`, CRITERIA),
        ]),
      );
      const passage = numberedPassage(sentences, Math.max(0, from - LABEL_CONTEXT), Math.min(n, to + LABEL_CONTEXT));
      const r = await call({ state: { ...notes, passage }, questions });
      return Array.from({ length: to - from }, (_, j) =>
        toDist(r.answers[`s${from + j + 1}`].probabilities as Partial<Dist>),
      );
    }),
    CONCURRENCY,
    progress("Labeling what each sentence does"),
  );
  const labels = labelChunks.flat();

  // 3. Score: the writer picked a beat that wouldn't work there, when another would have.
  const results: SentenceResult[] = labels.map((a, index) => {
    const actual = argmax(a);
    const base: SentenceResult = { index, actual, actualProb: a[actual], labels: round(a) };
    if (index === 0) return base;
    const { expected: p, works, stability } = predictions[index - 1];
    const expected = argmax(p);
    const bestAlternative = argmax(works, actual);
    // Weighted by the label distribution, so an unsure label doesn't count fully.
    const worksActual = BEATS.reduce((s, b) => s + a[b] * works[b], 0);
    return {
      ...base,
      predicted: round(p),
      expected,
      expectedProb: p[expected],
      probOfActual: p[actual],
      works: round(works),
      worksActual,
      bestAlternative,
      stability,
      score: (1 - worksActual) * works[bestAlternative] * stability,
    };
  });

  // 4. Is each top deviation a mistake, or a deliberate surprise that works?
  const candidates = results
    .filter((r) => (r.score ?? 0) >= MIN_SCORE_TO_CHECK && r.worksActual! < 0.5)
    .sort((a, b) => b.score! - a.score!)
    .slice(0, MOMENTUM_CANDIDATES);
  total -= MOMENTUM_CANDIDATES - candidates.length;
  await pool(
    candidates.map((r) => async () => {
      const better = r.bestAlternative as Beat;
      const after = joinSentences(sentences.slice(r.index + 1, r.index + 4));
      const q0 = `A pacing coach thought a ${r.actual} sentence was unlikely to work at this point, and that ${better} (${BEAT_INFO[better].definition.toLowerCase()}) would work better. The sentence in "sentence" is ${r.actual}. Does it break the story's momentum or feel misplaced, rather than working as a deliberate, effective choice?`;
      const q1 = `Would a careful editor flag the sentence in "sentence" as hurting the pacing at this point in the story?`;
      const out = await call({
        state: {
          ...notes,
          before: prefixBefore(sentences, r.index).slice(-4000),
          sentence: sentences[r.index].text,
          ...(after ? { after } : ({} as Record<string, string>)),
        },
        questions: { m0: noul(q0), m1: noul(q1) },
      });
      r.breaksMomentum = (out.answers.m0.noul + out.answers.m1.noul) / 2;
    }),
    CONCURRENCY,
    progress("Checking whether deviations work"),
  );

  const deviations = candidates
    .filter((r) => r.breaksMomentum! >= BREAKS_MOMENTUM)
    .sort((a, b) => b.score! * b.breaksMomentum! - a.score! * a.breaksMomentum!)
    .map((r) => r.index);
  const surprises = candidates
    .filter((r) => r.breaksMomentum! <= WORKS_AS_SURPRISE)
    .sort((a, b) => b.score! * (1 - b.breaksMomentum!) - a.score! * (1 - a.breaksMomentum!))
    .map((r) => r.index);

  // 5. Stretches of sentences in a row whose beat wouldn't work there.
  const runs: DeviationRun[] = [];
  let start = -1;
  const deviates = (r: SentenceResult) => (r.worksActual ?? 1) < WOULDNT_WORK;
  for (let i = 1; i <= n; i++) {
    if (i < n && deviates(results[i])) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= 3) {
        const slice = results.slice(start, i);
        runs.push({ start, end: i - 1, score: slice.reduce((s, r) => s + r.score!, 0) / slice.length });
      }
      start = -1;
    }
  }
  runs.sort((a, b) => b.score - a.score);

  return { sentences: results, deviations, surprises, runs, calls, inputTokens };
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzeRequest;
  const sentences = (body.sentences ?? []).filter((s) => s.text?.trim());
  if (sentences.length < 3) {
    return Response.json({ error: "Write at least a few sentences first." }, { status: 400 });
  }
  if (sentences.length > MAX_SENTENCES) {
    return Response.json(
      { error: `That's ${sentences.length} sentences; analyze at most ${MAX_SENTENCES} at a time.` },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AnalyzeEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // Client went away.
        }
      };
      try {
        const result = await analyze({ ...body, sentences }, request.signal, send);
        send({ type: "result", result });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error(error);
          send({ type: "error", error: errorMessage(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
