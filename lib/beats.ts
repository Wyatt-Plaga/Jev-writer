// Shared between the API route and the client UI.

export const BEATS = [
  "Action",
  "Dialogue",
  "Characterization",
  "World-building",
  "Description",
  "Exposition",
  "Tension",
] as const;

export type Beat = (typeof BEATS)[number];

export const BEAT_INFO: Record<Beat, { color: string; definition: string }> = {
  Action: {
    color: "#e4572e",
    definition: "Something physically happens; a character does something that moves the scene forward.",
  },
  Dialogue: {
    color: "#3b82f6",
    definition: "A character speaks, or the passage is centered on spoken words.",
  },
  Characterization: {
    color: "#a855f7",
    definition: "Reveals who a character is: thoughts, feelings, reactions, motives, interiority.",
  },
  "World-building": {
    color: "#10b981",
    definition: "Establishes how the world works: its rules, history, culture, politics or magic.",
  },
  Description: {
    color: "#f59e0b",
    definition: "Sensory detail about the immediate setting, objects or people.",
  },
  Exposition: {
    color: "#64748b",
    definition: "Backstory or summary that tells the reader context directly.",
  },
  Tension: {
    color: "#e11d48",
    definition: "Raises a question, a threat, a reversal or a hook that pulls the reader forward.",
  },
};

// How far ahead Jev looks. All horizons are asked in one request.
export const HORIZONS = [
  {
    key: "nextSentence",
    label: "Next sentence",
    question: "What should the very next sentence at the cursor mainly do?",
  },
  {
    key: "restOfParagraph",
    label: "Rest of this paragraph",
    question:
      "Looking past the next sentence, what should the rest of the paragraph the cursor is in mainly do before it ends?",
  },
  {
    key: "nextParagraph",
    label: "Next paragraph",
    question: "What should the next full paragraph after the current one mainly do?",
  },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];

export type HorizonPrediction = {
  key: HorizonKey;
  label: string;
  choice: Beat;
  confidence: number;
  // Sorted from most to least likely; percents sum to roughly 100.
  distribution: { category: Beat; percent: number }[];
};

export type BeatPrediction = {
  horizons: HorizonPrediction[];
  inputTokens: number | null;
};

export type NextBeatRequest = {
  before: string;
  after: string;
  notes?: string;
};
