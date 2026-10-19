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
    definition: "A character speaks, or the sentence is centered on spoken words.",
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

export type BeatPrediction = {
  distribution: { category: Beat; percent: number }[];
  reason: string;
  hint: string;
  usage?: { cachedTokens: number; uncachedTokens: number };
};

export type NextBeatRequest = {
  before: string;
  after: string;
  notes?: string;
};
