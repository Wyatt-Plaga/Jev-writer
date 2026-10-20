import { APIError, AuthenticationError, RateLimitError, choice, noul } from "@typesafe-ai/sdk";
import { BEATS, WOULDNT_WORK, type Beat } from "@/lib/beats";
import {
  DOESNT_WORK,
  MAX_SENTENCES,
  WORKS_WELL,
  type AnalysisResult,
  type AnalyzeEvent,
  type AnalyzeRequest,
  type SentenceResult,
  type Verdict,
  type WeakRun,
} from "@/lib/analysis";
import {
  CRITERIA,
  NEXT_BEAT_INSTRUCTIONS,
  getClient,
  readWorks,
  toDist,
  worksQuestions,
  type Dist,
} from "@/lib/jev";

// Requests to Jev in flight at once. The SDK retries 429s using retry-after.
const CONCURRENCY = 8;
// Text before each sentence is capped at roughly the last 4k tokens.
const PREFIX_CHARS = 16_000;
// Sentences labeled and judged per call, as separate questions over one numbered passage.
const BATCH = 20;
// Sentences of context on each side of a batch.
const CONTEXT = 6;

// Hindsight: does the sentence as written work, judged with what comes after it too.
// Asked two ways and averaged; the second runs stricter than the first.
const HINDSIGHT_PHRASINGS = [
  (k: number) =>
    `Does sentence [${k}] work well at its point in the story: does it do what the scene needs there, and is it well written?`,
  (k: number) => `Would a skilled editor leave sentence [${k}] as it is, rather than cut, move or rewrite it?`,
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

  const batches = Math.ceil(n / BATCH);
  const total = n - 1 + batches;
  let done = 0;
  const progress = (stage: string) => () => send({ type: "progress", done: ++done, total, stage });

  // 1. Forward, from the text before each sentence only: Jev's likeliest pick,
  // and whether each beat would work there.
  const predictions = await pool(
    sentences.slice(1).map((_, i) => async () => {
      const k = i + 1;
      const r = await call({
        state: { ...notes, manuscript_before_cursor: prefixBefore(sentences, k) },
        questions: { expected: choice(NEXT_BEAT_INSTRUCTIONS, CRITERIA), ...worksQuestions() },
      });
      return { expected: toDist(r.answers.expected.probabilities as Partial<Dist>), ...readWorks(r.answers) };
    }),
    CONCURRENCY,
    progress("Checking what would work before each sentence"),
  );

  // 2. Hindsight, with the passage around each sentence: what it does, and whether it works.
  const judged = await pool(
    Array.from({ length: batches }, (_, b) => async () => {
      const from = b * BATCH;
      const to = Math.min(n, from + BATCH);
      const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
      for (let i = from; i < to; i++) {
        questions[`s${i + 1}`] = choice(`What does sentence [${i + 1}] do in the story?`, CRITERIA);
        HINDSIGHT_PHRASINGS.forEach((q, j) => (questions[`q${j}_${i + 1}`] = noul(q(i + 1))));
      }
      const passage = numberedPassage(sentences, Math.max(0, from - CONTEXT), Math.min(n, to + CONTEXT));
      const r = await call({ state: { ...notes, passage }, questions });
      const answers = r.answers as unknown as Record<string, { noul: number; probabilities: Partial<Dist> }>;
      return Array.from({ length: to - from }, (_, j) => ({
        label: toDist(answers[`s${from + j + 1}`].probabilities),
        quality: HINDSIGHT_PHRASINGS.reduce((s, _, q) => s + answers[`q${q}_${from + j + 1}`].noul, 0) / HINDSIGHT_PHRASINGS.length,
      }));
    }),
    CONCURRENCY,
    progress("Judging each sentence in context"),
  );

  // 3. Combine: the verdict comes from hindsight; the advice from both checks.
  const results: SentenceResult[] = judged.flat().map(({ label: a, quality }, index) => {
    const actual = argmax(a);
    const verdict: Verdict = quality >= WORKS_WELL ? "green" : quality >= DOESNT_WORK ? "yellow" : "red";
    const base: SentenceResult = { index, actual, actualProb: a[actual], labels: round(a), quality, verdict };
    if (index === 0) return base;
    const { expected: p, works, stability } = predictions[index - 1];
    // Weighted by the label distribution, so an unsure label doesn't count fully.
    const worksActual = BEATS.reduce((s, b) => s + a[b] * works[b], 0);
    const beatFits = worksActual >= WOULDNT_WORK;
    return {
      ...base,
      advice: verdict === "green" ? (beatFits ? undefined : "risky-works") : beatFits ? "rewrite" : "change-beat",
      predicted: round(p),
      expected: argmax(p),
      works: round(works),
      worksActual,
      bestAlternative: argmax(works, actual),
      stability,
    };
  });

  const toFix = results
    .filter((r) => r.verdict !== "green")
    .sort((a, b) => a.quality - b.quality)
    .map((r) => r.index);
  const riskyWorks = results
    .filter((r) => r.advice === "risky-works")
    .sort((a, b) => b.quality - a.quality)
    .map((r) => r.index);

  // 4. Stretches of 3+ sentences in a row that aren't green.
  const runs: WeakRun[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && results[i].verdict !== "green") {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= 3) {
        const slice = results.slice(start, i);
        runs.push({ start, end: i - 1, quality: slice.reduce((s, r) => s + r.quality, 0) / slice.length });
      }
      start = -1;
    }
  }
  runs.sort((a, b) => a.quality - b.quality);

  return { sentences: results, toFix, riskyWorks, runs, calls, inputTokens };
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
