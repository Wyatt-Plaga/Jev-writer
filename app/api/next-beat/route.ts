import {
  APIError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  choice,
} from "@typesafe-ai/sdk";
import { BEATS, BEAT_INFO, type Beat, type BeatPrediction, type NextBeatRequest } from "@/lib/beats";

// Reads TYPESAFE_API_KEY (and optional TYPESAFE_BASE_URL) from the environment.
// Created lazily: the constructor throws without a key, which would break `next build`.
let client: TypeSafeClient | undefined;
const getClient = () => (client ??= new TypeSafeClient({ defaultModel: "jev-latest" }));

const INSTRUCTIONS = `You are Jev, a pacing coach for fiction writers. Read the writer's manuscript up to the cursor and judge what the NEXT sentence at the cursor should do. Consider the whole manuscript, not just the last line: what the reader has not been given in a while, what question is open, and the rhythm of recent sentences.`;

const CRITERIA = Object.fromEntries(BEATS.map((b) => [b, BEAT_INFO[b].definition])) as Record<
  Beat,
  string
>;

function buildState(req: NextBeatRequest) {
  return {
    ...(req.notes?.trim() ? { story_notes: req.notes.trim() } : {}),
    manuscript_before_cursor: req.before,
    ...(req.after.trim() ? { manuscript_after_cursor: req.after } : {}),
  };
}

// Make sure every category appears and the percentages sum to 100.
function normalize(probabilities: Partial<Record<Beat, number>>) {
  const sum = BEATS.reduce((a, b) => a + Math.max(0, probabilities[b] ?? 0), 0) || 1;
  return BEATS.map((category) => ({
    category,
    percent: Math.round((Math.max(0, probabilities[category] ?? 0) / sum) * 100),
  })).sort((a, b) => b.percent - a.percent);
}

export async function POST(request: Request) {
  const body = (await request.json()) as NextBeatRequest;
  if (!body.before?.trim()) {
    return Response.json({ error: "Write something first." }, { status: 400 });
  }

  try {
    const response = await getClient().systemOne(
      {
        state: buildState(body),
        questions: { next_beat: choice(INSTRUCTIONS, CRITERIA) },
      },
      { signal: request.signal },
    );

    const answer = response.answers.next_beat;
    const result: BeatPrediction = {
      distribution: normalize(answer.probabilities),
      confidence: answer.confidence,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens ?? 0 },
    };
    return Response.json(result);
  } catch (error) {
    if (error instanceof APIUserAbortError) {
      return new Response(null, { status: 499 });
    }
    if (error instanceof AuthenticationError) {
      return Response.json({ error: "Missing or invalid TYPESAFE_API_KEY." }, { status: 500 });
    }
    if (error instanceof RateLimitError) {
      return Response.json({ error: "Rate limited; try again in a moment." }, { status: 429 });
    }
    if (error instanceof APIError) {
      return Response.json({ error: `Jev API error: ${error.message}` }, { status: 502 });
    }
    // E.g. no API key configured: the SDK throws before sending anything.
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
