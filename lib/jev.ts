// Server-only helpers shared by the API routes.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { BEATS, BEAT_INFO, type Beat } from "./beats";

// Reads TYPESAFE_API_KEY (and optional TYPESAFE_BASE_URL) from the environment.
// Created lazily: the constructor throws without a key, which would break `next build`.
let client: TypeSafeClient | undefined;
export const getClient = () => (client ??= new TypeSafeClient({ defaultModel: "jev-latest" }));

// The beat definitions, used as the criteria of every choice question.
export const CRITERIA = Object.fromEntries(BEATS.map((b) => [b, BEAT_INFO[b].definition])) as Record<
  Beat,
  string
>;

export const NEXT_BEAT_INSTRUCTIONS = `You are Jev, a pacing coach for fiction writers. Read the writer's manuscript up to the cursor and judge what the NEXT sentence at the cursor should do. Consider the whole manuscript, not just the last line: what the reader has not been given in a while, what question is open, and the rhythm of recent sentences.`;

export type Dist = Record<Beat, number>;

// Every beat present, non-negative, summing to 1.
export function toDist(probabilities: Partial<Record<Beat, number>>): Dist {
  const sum = BEATS.reduce((a, b) => a + Math.max(0, probabilities[b] ?? 0), 0) || 1;
  return Object.fromEntries(
    BEATS.map((b) => [b, Math.max(0, probabilities[b] ?? 0) / sum]),
  ) as Dist;
}
