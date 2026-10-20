// Shared between the analyze route and the client UI.
import type { Beat } from "./beats";

export const MAX_SENTENCES = 600;

// Hindsight "does this sentence work" thresholds for the green/yellow/red verdict.
export const WORKS_WELL = 0.6;
export const DOESNT_WORK = 0.4;

export type Verdict = "green" | "yellow" | "red";

// What to do about a sentence, from combining the two checks:
// - "change-beat": it doesn't work, and its kind of sentence wouldn't work there either.
// - "rewrite": it doesn't work, but its kind of sentence would; the execution is the problem.
// - "risky-works": it works, even though Jev doubted its kind of sentence would.
export type Advice = "change-beat" | "rewrite" | "risky-works";

export type AnalyzeRequest = {
  // Sentences in document order; `paragraph` groups them for rebuilding the text.
  sentences: { text: string; paragraph: number }[];
  notes?: string;
};

export type SentenceResult = {
  index: number;
  // What the sentence actually does, as Jev labels it with the sentence in context.
  actual: Beat;
  actualProb: number;
  // The full label distribution for the sentence, summing to 1.
  labels: Record<Beat, number>;
  // Hindsight: chance the sentence as written works at its point in the story,
  // judged with the passage around it (0-1). Sets the verdict color.
  quality: number;
  verdict: Verdict;
  advice?: Advice;

  // The forward check, from the text before the sentence only. The first sentence has none.
  // Jev's single most likely pick, summing to 1.
  predicted?: Record<Beat, number>;
  expected?: Beat;
  // Chance a sentence of each beat would work here, asked separately per beat.
  // These don't sum to 1.
  works?: Record<Beat, number>;
  // Chance the beat the writer used would work here, weighted by the label.
  worksActual?: number;
  // The beat other than the one used that Jev thought most likely to work.
  bestAlternative?: Beat;
  // How much the two reworded "would it work" questions agreed (0-1).
  stability?: number;
};

export type WeakRun = { start: number; end: number; quality: number };

export type AnalysisResult = {
  sentences: SentenceResult[];
  // Red and yellow sentences, weakest first.
  toFix: number[];
  // Green sentences whose kind of sentence Jev doubted would work, strongest first.
  riskyWorks: number[];
  // Stretches of 3+ sentences in a row that aren't green.
  runs: WeakRun[];
  calls: number;
  inputTokens: number;
};

export type AnalyzeEvent =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; error: string };
