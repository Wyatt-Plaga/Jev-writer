"use client";

import { BEATS, BEAT_INFO, type BeatPrediction, type HorizonPrediction } from "@/lib/beats";

type Props = {
  prediction: BeatPrediction | null;
  status: "idle" | "thinking" | "error";
  error: string | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onAsk: () => void;
};

function Horizon({ horizon }: { horizon: HorizonPrediction }) {
  const top = horizon.distribution[0];
  return (
    <section className="jev-horizon">
      <p className="jev-label">{horizon.label}</p>
      <p className="jev-top">
        <span className="jev-dot" style={{ background: BEAT_INFO[top.category].color }} />
        {top.category} <span className="jev-pct">{top.percent}%</span>
      </p>
      <div className="jev-stack" role="img" aria-label={horizon.distribution.map((d) => `${d.category} ${d.percent}%`).join(", ")}>
        {horizon.distribution
          .filter((d) => d.percent > 0)
          .map((d) => (
            <span
              key={d.category}
              title={`${d.category} ${d.percent}%`}
              style={{ width: `${d.percent}%`, background: BEAT_INFO[d.category].color }}
            />
          ))}
      </div>
      <p className="jev-runners">
        {horizon.distribution
          .slice(1, 3)
          .filter((d) => d.percent > 0)
          .map((d) => `${d.category} ${d.percent}%`)
          .join(" · ")}
      </p>
    </section>
  );
}

export function JevPanel({ prediction, status, error, notes, onNotesChange, onAsk }: Props) {
  return (
    <aside className="jev-panel">
      <div className="jev-header">
        <h2>Jev</h2>
        <span className={`jev-status ${status}`}>
          {status === "thinking" ? "reading…" : status === "error" ? "error" : ""}
        </span>
      </div>

      {prediction ? (
        <div className={status === "thinking" ? "jev-stale" : undefined}>
          {prediction.horizons.map((h) => (
            <Horizon key={h.key} horizon={h} />
          ))}
          <ul className="jev-legend">
            {BEATS.map((b) => (
              <li key={b} title={BEAT_INFO[b].definition}>
                <span className="jev-dot" style={{ background: BEAT_INFO[b].color }} />
                {b}
              </li>
            ))}
          </ul>
          {prediction.inputTokens !== null && (
            <p className="jev-usage">{prediction.inputTokens.toLocaleString()} tokens read</p>
          )}
        </div>
      ) : (
        <p className="jev-empty">
          Finish a sentence and Jev will suggest what comes next, from the next sentence to the next paragraph.
        </p>
      )}
      {error && <p className="jev-error">{error}</p>}

      <button className="jev-ask" onClick={onAsk}>
        Ask Jev now <kbd>Ctrl/⌘ J</kbd>
      </button>

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
