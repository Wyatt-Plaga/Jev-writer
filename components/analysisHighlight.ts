// Sentence splitting and in-editor highlighting for chapter analysis.
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export type SentenceSpan = { text: string; paragraph: number; from: number; to: number };

// Splits every paragraph into sentences, keeping their document positions.
// Headings are skipped: they aren't prose for Jev to judge.
export function extractSentences(doc: PMNode): SentenceSpan[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const out: SentenceSpan[] = [];
  let paragraph = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "heading") return false;
    // One character per document position, so offsets map straight to positions.
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text! : " ".repeat(child.nodeSize);
    });
    const start = pos + 1;
    let found = false;
    for (const { segment, index } of segmenter.segment(text)) {
      const lead = segment.length - segment.trimStart().length;
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const from = start + index + lead;
      const to = from + trimmed.length;
      // The segmenter splits `"Who's there?" she whispered.` after the quote;
      // a piece starting in lowercase continues the previous sentence.
      const prev = out[out.length - 1];
      if (found && /^\p{Ll}/u.test(trimmed)) {
        prev.to = to;
        prev.text = text.slice(prev.from - start, to - start);
        continue;
      }
      out.push({ text: trimmed, paragraph, from, to });
      found = true;
    }
    if (found) paragraph++;
    return false;
  });
  return out;
}

const key = new PluginKey<DecorationSet>("jevAnalysis");

type Spec = { index: number };

// Holds one decoration per analyzed sentence. The decorations move with edits,
// so results that arrive after the writer kept typing still land on the right text.
export const AnalysisHighlight = Extension.create({
  name: "jevAnalysis",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(key) as DecorationSet | undefined;
            return next ?? set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

function current(editor: Editor) {
  return (key.getState(editor.state) ?? DecorationSet.empty).find();
}

// Where each analyzed sentence is now, by sentence index.
export function sentencePositions(editor: Editor) {
  const map = new Map<number, { from: number; to: number }>();
  for (const d of current(editor)) map.set((d.spec as Spec).index, { from: d.from, to: d.to });
  return map;
}

// Marks the sentences being analyzed, with no styling yet.
export function trackSentences(editor: Editor, spans: SentenceSpan[]) {
  const decos = spans.map((s, index) =>
    Decoration.inline(s.from, s.to, { class: "jev-s" }, { index } satisfies Spec),
  );
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(editor.state.doc, decos)));
}

// Restyles the tracked sentences; `style` returns attributes for an index, or null for none.
export function styleSentences(
  editor: Editor,
  style: (index: number) => { class: string; style?: string; title?: string } | null,
) {
  const decos = [];
  for (const [index, { from, to }] of sentencePositions(editor)) {
    const attrs = style(index) ?? { class: "jev-s" };
    decos.push(Decoration.inline(from, to, attrs, { index } satisfies Spec));
  }
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(editor.state.doc, decos)));
}

export function clearSentences(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.empty));
}
