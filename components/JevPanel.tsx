"use client";

import { BEAT_INFO, type BeatPrediction } from "@/lib/beats";

type Props = {
  prediction: BeatPrediction | null;
  status: "idle" | "thinking" | "error";
  error: string | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onAsk: () => void;
  children?: React.ReactNode;
};

export function JevPanel({ prediction, status, error, notes, onNotesChange, onAsk, children }: Props) {
  return (
    <aside className="jev-panel">
      <div className="jev-header">
        <h2>Jev</h2>
        <span className={`jev-status ${status}`}>
          {status === "thinking" ? "reading…" : status === "error" ? "error" : ""}
        </span>
      </div>

      <p className="jev-label">Next sentence</p>
      {prediction ? (
        <div className={status === "thinking" ? "jev-stale" : undefined}>
          <ul className="jev-bars">
            {prediction.distribution.map(({ category, percent }) => (
              <li key={category} title={BEAT_INFO[category].definition}>
                <span className="jev-cat">{category}</span>
                <span className="jev-track">
                  <span
                    className="jev-fill"
                    style={{ width: `${percent}%`, background: BEAT_INFO[category].color }}
                  />
                </span>
                <span className="jev-pct">{percent}%</span>
              </li>
            ))}
          </ul>
          <p className="jev-reason">
            Confidence {Math.round(prediction.confidence * 100)}%
          </p>
          {prediction.usage && (
            <p className="jev-usage">
              {prediction.model} · {prediction.usage.inputTokens.toLocaleString()} tokens
            </p>
          )}
        </div>
      ) : (
        <p className="jev-empty">Finish a sentence and Jev will suggest what comes next.</p>
      )}
      {error && <p className="jev-error">{error}</p>}

      <button className="jev-ask" onClick={onAsk}>
        Ask Jev now <kbd>Ctrl/⌘ J</kbd>
      </button>

      {children}

      <label className="jev-label" htmlFor="notes">
        Story notes
      </label>
      <textarea
        id="notes"
        className="jev-notes"
        placeholder="Characters, setting, genre, what this chapter is for…"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
      />
    </aside>
  );
}
