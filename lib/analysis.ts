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
  // The full label distribution for the sentence, summing to 1.
  labels: Record<Beat, number>;
  // What Jev expected from the text before the sentence, averaged over the
  // reworded questions and summing to 1. The first sentence has none.
  predicted?: Record<Beat, number>;
  expected?: Beat;
  expectedProb?: number;
  // Probability Jev gave, before seeing it, to what the writer actually did.
  probOfActual?: number;
  // Chance a sentence of each beat would work here, asked separately per beat
  // from the text before the sentence. These don't sum to 1.
  works?: Record<Beat, number>;
  // Chance the beat the writer used would work here, weighted by the label.
  worksActual?: number;
  // The beat other than the one used that Jev thought most likely to work.
  bestAlternative?: Beat;
  // How much the two reworded "would it work" questions agreed (0-1).
  stability?: number;
  // (1 - worksActual) × how well the best alternative would work × stability,
  // before the momentum check (0-1).
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
  // Stretches of 3+ sentences in a row whose beat Jev thought wouldn't work.
  runs: DeviationRun[];
  calls: number;
  inputTokens: number;
};

export type AnalyzeEvent =
  | { type: "progress"; done: number; total: number; stage: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; error: string };
