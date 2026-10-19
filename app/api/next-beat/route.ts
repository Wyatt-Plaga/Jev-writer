import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { BEATS, BEAT_INFO, type BeatPrediction, type NextBeatRequest } from "@/lib/beats";

const client = new Anthropic();

// Paragraphs are grouped into fixed-size chunks so that, as the writer keeps
// typing at the end, every earlier chunk stays byte-identical and is served
// from the prompt cache. Only the last (still-growing) chunk is re-processed.
const PARAGRAPHS_PER_CHUNK = 20;

const SYSTEM_PROMPT = `You are Jev, a pacing coach for fiction writers. You read a writer's entire manuscript up to their cursor and judge what the NEXT sentence should do.

Categories:
${BEATS.map((b) => `- ${b}: ${BEAT_INFO[b].definition}`).join("\n")}

How to judge:
- Consider the whole manuscript, not just the last line: what has the reader not been given in a while, what question is open, what the scene needs right now.
- Look at the rhythm of recent sentences (e.g. a long run of action with no reaction, or exposition that has gone on too long).
- Give a percentage for every category, summing to 100. Spread probability honestly: if two options are both strong, say so.
- "reason": one or two sentences explaining the top choice, referring to specifics in the text (names, events).
- "hint": a short, concrete direction for the top choice (e.g. "Show Mara's hands shaking as she folds the letter"). Do not write the sentence for them.`;

const PredictionSchema = z.object({
  distribution: z.array(z.object({ category: z.enum(BEATS), percent: z.number() })),
  reason: z.string(),
  hint: z.string(),
});

function buildContent(req: NextBeatRequest): Anthropic.Beta.BetaTextBlockParam[] {
  const paragraphs = req.before.split(/\n{2,}/);
  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += PARAGRAPHS_PER_CHUNK) {
    chunks.push(paragraphs.slice(i, i + PARAGRAPHS_PER_CHUNK).join("\n\n"));
  }
  // The last paragraph is the one being typed, so a chunk only counts as
  // settled once a paragraph after it exists.
  const lastCompleteChunk = Math.floor((paragraphs.length - 1) / PARAGRAPHS_PER_CHUNK) - 1;

  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [];
  if (req.notes?.trim()) {
    blocks.push({ type: "text", text: `<story_notes>\n${req.notes.trim()}\n</story_notes>` });
  }
  blocks.push({ type: "text", text: "<manuscript_before_cursor>" });
  chunks.forEach((text, i) => {
    blocks.push({
      type: "text",
      text: i < chunks.length - 1 ? text + "\n\n" : text,
      ...(i === lastCompleteChunk ? { cache_control: { type: "ephemeral" as const } } : {}),
    });
  });

  let tail = "</manuscript_before_cursor>\n\n";
  if (req.after.trim()) {
    tail += `<manuscript_after_cursor>\n${req.after}\n</manuscript_after_cursor>\n\n`;
  }
  tail += "What should the next sentence at the cursor do?";
  blocks.push({ type: "text", text: tail });
  return blocks;
}

// Make sure every category appears and the percentages sum to 100.
function normalize(dist: { category: (typeof BEATS)[number]; percent: number }[]) {
  const totals = new Map<(typeof BEATS)[number], number>(BEATS.map((b) => [b, 0]));
  for (const d of dist) totals.set(d.category, (totals.get(d.category) ?? 0) + Math.max(0, d.percent));
  const sum = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
  return [...totals.entries()]
    .map(([category, p]) => ({ category, percent: Math.round((p / sum) * 100) }))
    .sort((a, b) => b.percent - a.percent);
}

export async function POST(request: Request) {
  const body = (await request.json()) as NextBeatRequest;
  if (!body.before?.trim()) {
    return Response.json({ error: "Write something first." }, { status: 400 });
  }

  try {
    const response = await client.beta.messages.parse(
      {
        model: "claude-opus-5-5",
        max_tokens: 4000,
        // Low effort keeps latency down; this runs after every sentence.
        output_config: { effort: "low", format: betaZodOutputFormat(PredictionSchema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT }],
        messages: [{ role: "user", content: buildContent(body) }],
      },
      { signal: request.signal },
    );

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "Jev couldn't analyze this passage." }, { status: 422 });
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      return Response.json({ error: "Jev returned an unreadable answer." }, { status: 502 });
    }

    const result: BeatPrediction = {
      distribution: normalize(parsed.distribution),
      reason: parsed.reason,
      hint: parsed.hint,
      usage: {
        cachedTokens: response.usage.cache_read_input_tokens ?? 0,
        uncachedTokens:
          response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
      },
    };
    return Response.json(result);
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) {
      return new Response(null, { status: 499 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Missing or invalid ANTHROPIC_API_KEY." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited; try again in a moment." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API error ${error.status}: ${error.message}` }, { status: 502 });
    }
    // E.g. no API key configured: the SDK throws before sending anything.
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
