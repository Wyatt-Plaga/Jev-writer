// Server-only helpers shared by the API routes.
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
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

// "Would a sentence of this beat work here?", asked separately for every beat
// so that several good options don't have to split one probability. Each is
// asked two ways and averaged; disagreement between them lowers confidence.
const WORKS_PHRASINGS = [
  (b: Beat) =>
    `If the writer's next sentence were ${b} (${BEAT_INFO[b].definition.toLowerCase()}), would it work well at this exact point in the story?`,
  (b: Beat) =>
    `Would a skilled editor accept a ${b} sentence (${BEAT_INFO[b].definition.toLowerCase()}) as the very next sentence here?`,
];

export function worksQuestions() {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const b of BEATS) WORKS_PHRASINGS.forEach((q, j) => (questions[`w${j}_${b}`] = noul(q(b))));
  return questions;
}

// Reads the answers to `worksQuestions()` back out of a response.
export function readWorks(answers: Record<string, unknown>) {
  const phrasings = WORKS_PHRASINGS.map(
    (_, j) => Object.fromEntries(BEATS.map((b) => [b, (answers[`w${j}_${b}`] as { noul: number }).noul])) as Dist,
  );
  return {
    works: Object.fromEntries(BEATS.map((b) => [b, (phrasings[0][b] + phrasings[1][b]) / 2])) as Dist,
    // 1 when both phrasings gave the same answers, lower as they drift apart.
    stability: 1 - BEATS.reduce((s, b) => s + Math.abs(phrasings[0][b] - phrasings[1][b]), 0) / BEATS.length,
  };
}
