"use client";

import { BEATS, BEAT_INFO, WOULDNT_WORK } from "@/lib/beats";
import type { AnalysisResult, SentenceResult, Verdict } from "@/lib/analysis";

// Jev's listed price per million input tokens; output tokens are free.
const USD_PER_MILLION_INPUT = 0.042;
const LIST_LIMIT = 10;

export const VERDICT_INFO: Record<Verdict, { color: string; label: string; plural: string }> = {
  green: { color: "#16a34a", label: "Works", plural: "work" },
  yellow: { color: "#ca8a04", label: "Shaky", plural: "shaky" },
  red: { color: "#dc2626", label: "Doesn't work", plural: "don't work" },
};

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

function Beat({ beat }: { beat: (typeof BEATS)[number] }) {
  return <b style={{ color: BEAT_INFO[beat].color }}>{beat}</b>;
}

function VerdictChip({ r }: { r: SentenceResult }) {
  const v = VERDICT_INFO[r.verdict];
  return (
    <span className="jev-chip" style={{ color: v.color, borderColor: v.color }}>
      {v.label} · {pct(r.quality)}
    </span>
  );
}

// What to do about a sentence, from the hindsight verdict and the forward beat check.
function Advice({ r }: { r: SentenceResult }) {
  const works = r.works;
  if (!works || !r.advice) return null;
  const alt = r.bestAlternative!;
  if (r.advice === "change-beat") {
    return (
      <span className="jev-advice">
        Wrong kind of sentence here: <Beat beat={r.actual} /> would work {pct(works[r.actual])}. Try{" "}
        <Beat beat={alt} /> instead ({pct(works[alt])}).
      </span>
    );
  }
  if (r.advice === "rewrite") {
    return (
      <span className="jev-advice">
        <Beat beat={r.actual} /> fits here ({pct(works[r.actual])}), so the wording is the problem. Rewrite it.
      </span>
    );
  }
  return (
    <span className="jev-advice">
      Jev doubted <Beat beat={r.actual} /> here ({pct(works[r.actual])}), but as written it works.
    </span>
  );
}

function Item({
  r,
  text,
  rank,
  focused,
  onFocus,
}: {
  r: SentenceResult;
  text: string;
  rank: number;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <li>
      <button className={`jev-item${focused ? " on" : ""}`} onClick={onFocus}>
        <span className="jev-item-head">
          #{rank} · sentence {r.index + 1}
          <VerdictChip r={r} />
        </span>
        <span className="jev-item-text">“{clip(text)}”</span>
        <Advice r={r} />
      </button>
    </li>
  );
}

// One sentence: whether it works as written, what to do about it, and which beats would have worked.
function Breakdown({ r, text, onClose }: { r: SentenceResult; text: string; onClose: () => void }) {
  const works = r.works;
  const rows = works ? [...BEATS].sort((a, b) => works[b] - works[a]) : [];
  return (
    <div className="jev-breakdown" style={{ borderColor: VERDICT_INFO[r.verdict].color }}>
      <div className="jev-item-head">
        <span>
          Sentence {r.index + 1} · <VerdictChip r={r} />
        </span>
        <button className="jev-close" onClick={onClose} aria-label="Close breakdown">
          ×
        </button>
      </div>
      <p className="jev-item-text">“{clip(text, 160)}”</p>
      <Advice r={r} />
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
            &quot;Would work&quot; is judged from the text before the sentence, per beat. The verdict above is judged
            in hindsight, with the sentence and what follows it.
          </p>
        </>
      ) : (
        <p className="jev-muted">
          The first sentence has nothing before it to compare against. It reads as <Beat beat={r.actual} />.
        </p>
      )}
      <p className="jev-muted">
        Label {pct(r.actualProb)} sure
        {r.stability !== undefined && ` · the two reworded "would work" questions agreed ${pct(r.stability)}`}
      </p>
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
          {state.status === "done" ? "Re-analyze chapter" : "Analyze chapter"}
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
  const { sentences, toFix, riskyWorks, runs } = result;
  const cost = (result.inputTokens / 1e6) * USD_PER_MILLION_INPUT;
  const count = (v: Verdict) => sentences.filter((s) => s.verdict === v).length;

  return (
    <div className={stale ? "jev-stale" : undefined}>
      {stale && <p className="jev-muted">The text changed since this ran.</p>}

      <p className="jev-summary">
        {(["green", "yellow", "red"] as const).map((v) => (
          <span key={v} style={{ color: VERDICT_INFO[v].color }}>
            {count(v)} {VERDICT_INFO[v].plural}
          </span>
        ))}
      </p>

      {focused !== null && sentences[focused] ? (
        <Breakdown r={sentences[focused]} text={texts[focused]} onClose={onClearFocus} />
      ) : (
        <p className="jev-muted">Click a sentence in the text or the timeline to see its breakdown.</p>
      )}

      <p className="jev-label">Timeline</p>
      <div className="jev-timeline" role="list">
        {sentences.map((s) => (
          <button
            key={s.index}
            role="listitem"
            className={`jev-tick${focused === s.index ? " on" : ""}`}
            title={`Sentence ${s.index + 1}: ${VERDICT_INFO[s.verdict].label} (${pct(s.quality)}), ${s.actual}`}
            onClick={() => onFocus(s.index)}
          >
            <span style={{ height: `${30 + (1 - s.quality) * 70}%`, background: VERDICT_INFO[s.verdict].color }} />
            <i style={{ background: BEAT_INFO[s.actual].color }} />
          </button>
        ))}
      </div>
      <p className="jev-muted">
        Bar color is the verdict, and taller means weaker. The thin strip underneath is each sentence&apos;s beat.
      </p>

      <p className="jev-label">Sentences to fix</p>
      {toFix.length ? (
        <ol className="jev-list">
          {toFix.slice(0, LIST_LIMIT).map((i, rank) => (
            <Item
              key={i}
              r={sentences[i]}
              text={texts[i]}
              rank={rank + 1}
              focused={focused === i}
              onFocus={() => onFocus(i)}
            />
          ))}
        </ol>
      ) : (
        <p className="jev-muted">Every sentence works in context.</p>
      )}

      {runs.length > 0 && (
        <>
          <p className="jev-label">Weak stretches</p>
          <ul className="jev-list">
            {runs.slice(0, 5).map((run) => (
              <li key={run.start}>
                <button className="jev-item" onClick={() => onFocus(run.start)}>
                  <span className="jev-item-head">
                    Sentences {run.start + 1}–{run.end + 1}
                    <span className="jev-item-verdict">avg {pct(run.quality)}</span>
                  </span>
                  <span className="jev-item-text">“{clip(texts[run.start], 70)}”</span>
                  <span className="jev-item-beats">{run.end - run.start + 1} weak sentences in a row</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {riskyWorks.length > 0 && (
        <>
          <p className="jev-label">Risky choices that work</p>
          <ol className="jev-list">
            {riskyWorks.slice(0, 5).map((i, rank) => (
              <Item
                key={i}
                r={sentences[i]}
                text={texts[i]}
                rank={rank + 1}
                focused={focused === i}
                onFocus={() => onFocus(i)}
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
