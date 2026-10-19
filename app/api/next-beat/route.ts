import {
  BEATS,
  BEAT_INFO,
  HORIZONS,
  type Beat,
  type BeatPrediction,
  type NextBeatRequest,
} from "@/lib/beats";

// TypeSafe's Jev model, called over plain HTTP. Request and response shapes
// match the official @typesafe-ai/sdk (v0.7.0) `systemOne` call.
const BASE_URL = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/+$/, "");
const MODEL = process.env.TYPESAFE_DEFAULT_MODEL || "jev-latest";
const TIMEOUT_MS = 15_000;

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

type SystemOneResponse = {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number | null; output_tokens: number | null };
};

const CRITERIA = Object.fromEntries(BEATS.map((b) => [b, BEAT_INFO[b].definition]));

const QUESTIONS = Object.fromEntries(
  HORIZONS.map((h) => [
    h.key,
    {
      type: "choice",
      instructions:
        `${h.question} Judge from the whole manuscript, not just the last line: ` +
        "what the reader hasn't been given in a while, which questions are open, and the rhythm of recent passages.",
      criteria: CRITERIA,
    },
  ]),
);

function toPercents(probabilities: Record<string, number>) {
  const sum = BEATS.reduce((acc, b) => acc + Math.max(0, probabilities[b] ?? 0), 0) || 1;
  return BEATS.map((category) => ({
    category,
    percent: Math.round((Math.max(0, probabilities[category] ?? 0) / sum) * 100),
  })).sort((a, b) => b.percent - a.percent);
}

function errorMessage(status: number, body: unknown) {
  const detail =
    typeof body === "object" && body !== null && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : typeof body === "string"
        ? body.slice(0, 300)
        : "";
  if (status === 401) return "Missing or invalid TYPESAFE_API_KEY.";
  if (status === 429) return "Rate limited; try again in a moment.";
  return `Jev API error ${status}${detail ? `: ${detail}` : ""}`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as NextBeatRequest;
  if (!body.before?.trim()) {
    return Response.json({ error: "Write something first." }, { status: 400 });
  }
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Set TYPESAFE_API_KEY in .env.local." }, { status: 500 });
  }

  const state: Record<string, string> = {
    manuscript_before_cursor: body.before,
    manuscript_after_cursor: body.after,
  };
  if (body.notes?.trim()) state.story_notes = body.notes.trim();

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions: QUESTIONS, model: MODEL }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "Jev took too long to answer." : "Couldn't reach the Jev API." },
      { status: 502 },
    );
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave non-JSON bodies as text for the error message.
  }
  if (!res.ok) {
    return Response.json({ error: errorMessage(res.status, parsed) }, { status: 502 });
  }

  const data = parsed as SystemOneResponse;
  const result: BeatPrediction = {
    horizons: HORIZONS.map((h) => {
      const answer = data.answers[h.key];
      return {
        key: h.key,
        label: h.label,
        choice: answer.choice as Beat,
        confidence: answer.confidence,
        distribution: toPercents(answer.probabilities),
      };
    }),
    inputTokens: data.usage?.input_tokens ?? null,
  };
  return Response.json(result);
}
