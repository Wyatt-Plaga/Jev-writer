// Shared between the analyze route and the client UI.
import type { Beat } from "./beats";

export const MAX_SENTENCES = 600;

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
  // What Jev expected from the text before the sentence. The first sentence has none.
  expected?: Beat;
  expectedProb?: number;
  // Probability Jev gave, before seeing it, to what the writer actually did.
  probOfActual?: number;
  // How unlikely Jev found the actual beat, times the label's confidence (0-1).
  mismatch?: number;
  // How much the reworded prediction questions agreed with each other (0-1).
  stability?: number;
  // Confidence-weighted deviation before the momentum check (0-1).
  score?: number;
  // Chance the sentence breaks momentum rather than being an effective surprise.
  // Only set for the candidates that were checked.
  breaksMomentum?: number;
};

export type DeviationRun = { start: number; end: number; score: number };

export type AnalysisResult = {
  sentences: SentenceResult[];
  // Sentence indexes, ranked: deviations that probably hurt the story.
  deviations: number[];
  // Strong deviations that Jev thinks work as intentional surprises.
  surprises: number[];
  // Stretches of 3+ sentences in a row that all go against the prediction.
  runs: DeviationRun[];
  calls: number;
  inputTokens: number;
};

export type AnalyzeEvent =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; error: string };
