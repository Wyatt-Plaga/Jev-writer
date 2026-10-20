"use client";

import { BEATS, BEAT_INFO } from "@/lib/beats";
import type { AnalysisResult, SentenceResult } from "@/lib/analysis";

// Jev's listed price per million input tokens; output tokens are free.
const USD_PER_MILLION_INPUT = 0.042;
const LIST_LIMIT = 10;

export type AnalysisState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number; stage: string }
  | { status: "done"; result: AnalysisResult; texts: string[]; stale: boolean }
  | { status: "error"; error: string };

type Props = {
  state: AnalysisState;
  focused: number | null;
  onAnalyze: () => void;
  onCancel: () => void;
  onFocus: (index: number) => void;
  onClearFocus: () => void;
};

const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;
const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function Item({
  r,
  text,
  rank,
  focused,
  onFocus,
  verdict,
}: {
  r: SentenceResult;
  text: string;
  rank: number;
  focused: boolean;
  onFocus: () => void;
  verdict: string;
}) {
  return (
    <li>
      <button className={`jev-item${focused ? " on" : ""}`} onClick={onFocus}>
        <span className="jev-item-head">
          #{rank} · sentence {r.index + 1}
          <span className="jev-item-verdict">{verdict}</span>
        </span>
        <span className="jev-item-text">“{clip(text)}”</span>
        <span className="jev-item-beats">
          Expected <b style={{ color: BEAT_INFO[r.expected!].color }}>{r.expected}</b> ({pct(r.expectedProb)}) ·
          wrote <b style={{ color: BEAT_INFO[r.actual].color }}>{r.actual}</b> ({pct(r.probOfActual)} expected)
        </span>
      </button>
    </li>
  );
}

// What Jev expected of one sentence, next to what it actually does.
function Breakdown({ r, text, onClose }: { r: SentenceResult; text: string; onClose: () => void }) {
  const rows = r.predicted ? [...BEATS].sort((a, b) => r.predicted![b] - r.predicted![a]) : [];
  return (
    <div className="jev-breakdown">
      <div className="jev-item-head">
        Sentence {r.index + 1}
        <button className="jev-close" onClick={onClose} aria-label="Close breakdown">
          ×
        </button>
      </div>
      <p className="jev-item-text">“{clip(text, 160)}”</p>
      {r.predicted ? (
        <>
          <p className="jev-label">Jev expected</p>
          <ul className="jev-bars">
            {rows.map((b) => (
              <li key={b} className={b === r.actual ? "jev-wrote" : undefined} title={BEAT_INFO[b].definition}>
                <span className="jev-cat">{b}</span>
                <span className="jev-track">
                  <span
                    className="jev-fill"
                    style={{ width: pct(r.predicted![b]), background: BEAT_INFO[b].color }}
                  />
                </span>
                <span className="jev-pct">{pct(r.predicted![b])}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="jev-muted">The first sentence has nothing before it to predict from.</p>
      )}
      <p className="jev-muted">
        You wrote <b style={{ color: BEAT_INFO[r.actual].color }}>{r.actual}</b> (Jev is {pct(r.actualProb)} sure of
        that label)
        {r.predicted && r.expected === r.actual && ", which matches what Jev expected"}.
      </p>
      {r.breaksMomentum !== undefined && (
        <p className="jev-muted">
          Breaks momentum: {pct(r.breaksMomentum)} · works as a deliberate choice: {pct(1 - r.breaksMomentum)}
        </p>
      )}
      {r.stability !== undefined && (
        <p className="jev-muted">
          Deviation score {pct(r.score)} · the three reworded predictions agreed {pct(r.stability)}
        </p>
      )}
    </div>
  );
}

export function AnalysisSection({ state, focused, onAnalyze, onCancel, onFocus, onClearFocus }: Props) {
  return (
    <section className="jev-analysis">
      <p className="jev-label">Chapter analysis</p>
      {state.status === "running" ? (
        <>
          <div className="jev-progress">
            <span style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
          </div>
          <p className="jev-muted">
            {state.stage}… {state.done}/{state.total}
          </p>
          <button className="jev-ask" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <button className="jev-ask" onClick={onAnalyze}>
          {state.status === "done" ? "Re-analyze chapter" : "Find the biggest deviations"}
        </button>
      )}
      {state.status === "error" && <p className="jev-error">{state.error}</p>}
      {state.status === "done" && (
        <Results {...state} focused={focused} onFocus={onFocus} onClearFocus={onClearFocus} />
      )}
    </section>
  );
}

function Results({
  result,
  texts,
  stale,
  focused,
  onFocus,
  onClearFocus,
}: {
  result: AnalysisResult;
  texts: string[];
  stale: boolean;
  focused: number | null;
  onFocus: (index: number) => void;
  onClearFocus: () => void;
}) {
  const { sentences, deviations, surprises, runs } = result;
  const maxScore = Math.max(0.01, ...sentences.map((s) => s.score ?? 0));
  const flagged = new Set(deviations);
  const cost = (result.inputTokens / 1e6) * USD_PER_MILLION_INPUT;

  return (
    <div className={stale ? "jev-stale" : undefined}>
      {stale && <p className="jev-muted">The text changed since this ran.</p>}

      {focused !== null && sentences[focused] ? (
        <Breakdown r={sentences[focused]} text={texts[focused]} onClose={onClearFocus} />
      ) : (
        <p className="jev-muted">Click a sentence in the text or the timeline to see what Jev expected there.</p>
      )}

      <p className="jev-label">Beat timeline</p>
      <div className="jev-timeline" role="list">
        {sentences.map((s) => (
          <button
            key={s.index}
            role="listitem"
            className={`jev-tick${flagged.has(s.index) ? " flagged" : ""}${focused === s.index ? " on" : ""}`}
            title={`Sentence ${s.index + 1}: ${s.actual}${s.expected ? ` (expected ${s.expected})` : ""}`}
            onClick={() => onFocus(s.index)}
          >
            <span
              style={{
                height: `${20 + ((s.score ?? 0) / maxScore) * 80}%`,
                background: BEAT_INFO[s.actual].color,
              }}
            />
          </button>
        ))}
      </div>
      <p className="jev-muted">Color is what each sentence does; height is how far it went from what Jev expected.</p>

      <p className="jev-label">Biggest deviations</p>
      {deviations.length ? (
        <ol className="jev-list">
          {deviations.slice(0, LIST_LIMIT).map((i, rank) => (
            <Item
              key={i}
              r={sentences[i]}
              text={texts[i]}
              rank={rank + 1}
              focused={focused === i}
              onFocus={() => onFocus(i)}
              verdict={`breaks momentum ${pct(sentences[i].breaksMomentum)}`}
            />
          ))}
        </ol>
      ) : (
        <p className="jev-muted">Nothing stands out: the writing mostly does what Jev expects.</p>
      )}

      {runs.length > 0 && (
        <>
          <p className="jev-label">Stretches off course</p>
          <ul className="jev-list">
            {runs.slice(0, 5).map((run) => (
              <li key={run.start}>
                <button className="jev-item" onClick={() => onFocus(run.start)}>
                  <span className="jev-item-head">
                    Sentences {run.start + 1}–{run.end + 1}
                  </span>
                  <span className="jev-item-text">“{clip(texts[run.start], 70)}”</span>
                  <span className="jev-item-beats">
                    {run.end - run.start + 1} in a row going somewhere other than expected
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {surprises.length > 0 && (
        <>
          <p className="jev-label">Deviations that work</p>
          <ol className="jev-list">
            {surprises.slice(0, 5).map((i, rank) => (
              <Item
                key={i}
                r={sentences[i]}
                text={texts[i]}
                rank={rank + 1}
                focused={focused === i}
                onFocus={() => onFocus(i)}
                verdict={`works ${pct(1 - (sentences[i].breaksMomentum ?? 0))}`}
              />
            ))}
          </ol>
        </>
      )}

      <p className="jev-usage">
        {sentences.length} sentences · {result.calls} Jev calls · {result.inputTokens.toLocaleString()} tokens · ~$
        {cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}
      </p>
    </div>
  );
}
