"use client";

import { BEATS, BEAT_INFO } from "@/lib/beats";
import type { AnalysisResult, SentenceResult } from "@/lib/analysis";

// Jev's listed price per million input tokens; output tokens are free.
const USD_PER_MILLION_INPUT = 0.042;
const LIST_LIMIT = 10;
// Matches the route: below this, Jev doesn't think a beat would work there.
const WOULDNT_WORK = 0.4;

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
          Wrote <b style={{ color: BEAT_INFO[r.actual].color }}>{r.actual}</b> (would work {pct(r.works?.[r.actual])}) ·{" "}
          <b style={{ color: BEAT_INFO[r.bestAlternative!].color }}>{r.bestAlternative}</b> would work{" "}
          {pct(r.works?.[r.bestAlternative!])}
        </span>
      </button>
    </li>
  );
}

// Whether each beat would have worked at this sentence, next to what it actually does.
function Breakdown({ r, text, onClose }: { r: SentenceResult; text: string; onClose: () => void }) {
  const works = r.works;
  const rows = works ? [...BEATS].sort((a, b) => works[b] - works[a]) : [];
  return (
    <div className="jev-breakdown">
      <div className="jev-item-head">
        Sentence {r.index + 1}
        <button className="jev-close" onClick={onClose} aria-label="Close breakdown">
          ×
        </button>
      </div>
      <p className="jev-item-text">“{clip(text, 160)}”</p>
      {works && r.predicted ? (
        <>
          <ul className="jev-bars jev-works">
            <li className="jev-bars-head">
              <span />
              <span>Would work here</span>
              <span />
              <span title="Jev's single most likely pick, as a share of 100%">Likely</span>
            </li>
            {rows.map((b) => (
              <li
                key={b}
                className={[b === r.actual && "jev-wrote", works[b] < WOULDNT_WORK && "jev-low"]
                  .filter(Boolean)
                  .join(" ")}
                title={BEAT_INFO[b].definition}
              >
                <span className="jev-cat">{b}</span>
                <span className="jev-track">
                  <span className="jev-fill" style={{ width: pct(works[b]), background: BEAT_INFO[b].color }} />
                </span>
                <span className="jev-pct">{pct(works[b])}</span>
                <span className="jev-pct jev-likely">{pct(r.predicted![b])}</span>
              </li>
            ))}
          </ul>
          <p className="jev-muted">
            Each beat is judged on its own, so several can work at once. You wrote{" "}
            <b style={{ color: BEAT_INFO[r.actual].color }}>{r.actual}</b>, which Jev rates{" "}
            {pct(works[r.actual])} likely to work here
            {r.worksActual! < WOULDNT_WORK
              ? `; ${r.bestAlternative} (${pct(works[r.bestAlternative!])}) would fit better.`
              : "."}
          </p>
        </>
      ) : (
        <p className="jev-muted">
          The first sentence has nothing before it to judge against. It reads as{" "}
          <b style={{ color: BEAT_INFO[r.actual].color }}>{r.actual}</b>.
        </p>
      )}
      {r.breaksMomentum !== undefined && (
        <p className="jev-muted">
          Breaks momentum: {pct(r.breaksMomentum)} · works as a deliberate choice: {pct(1 - r.breaksMomentum)}
        </p>
      )}
      {r.stability !== undefined && (
        <p className="jev-muted">
          Deviation score {pct(r.score)} · label {pct(r.actualProb)} sure · the two reworded questions agreed{" "}
          {pct(r.stability)}
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
        <p className="jev-muted">Click a sentence in the text or the timeline to see which beats would have worked there.</p>
      )}

      <p className="jev-label">Beat timeline</p>
      <div className="jev-timeline" role="list">
        {sentences.map((s) => (
          <button
            key={s.index}
            role="listitem"
            className={`jev-tick${flagged.has(s.index) ? " flagged" : ""}${focused === s.index ? " on" : ""}`}
            title={`Sentence ${s.index + 1}: ${s.actual}${s.worksActual !== undefined ? ` (would work ${pct(s.works?.[s.actual])})` : ""}`}
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
      <p className="jev-muted">Color is what each sentence does; height is how unlikely that beat was to work there.</p>

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
                    {run.end - run.start + 1} in a row with a beat Jev doubted would work
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {surprises.length > 0 && (
        <>
          <p className="jev-label">Risky choices that work</p>
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
