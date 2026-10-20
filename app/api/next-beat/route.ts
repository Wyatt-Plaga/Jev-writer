import { APIError, APIUserAbortError, AuthenticationError, RateLimitError, choice } from "@typesafe-ai/sdk";
import { BEATS, type BeatPrediction, type NextBeatRequest } from "@/lib/beats";
import { CRITERIA, NEXT_BEAT_INSTRUCTIONS, getClient, readWorks, toDist, worksQuestions } from "@/lib/jev";

function buildState(req: NextBeatRequest) {
  return {
    ...(req.notes?.trim() ? { story_notes: req.notes.trim() } : {}),
    manuscript_before_cursor: req.before,
    ...(req.after.trim() ? { manuscript_after_cursor: req.after } : {}),
  };
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
        questions: { next_beat: choice(NEXT_BEAT_INSTRUCTIONS, CRITERIA), ...worksQuestions() },
      },
      { signal: request.signal },
    );

    const answer = response.answers.next_beat;
    const dist = toDist(answer.probabilities);
    const { works } = readWorks(response.answers);
    const asPercents = (d: Record<(typeof BEATS)[number], number>) =>
      BEATS.map((category) => ({ category, percent: Math.round(d[category] * 100) })).sort(
        (a, b) => b.percent - a.percent,
      );
    const result: BeatPrediction = {
      distribution: asPercents(dist),
      works: asPercents(works),
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
