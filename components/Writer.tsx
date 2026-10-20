"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { JevPanel } from "./JevPanel";
import { AnalysisSection, type AnalysisState } from "./AnalysisSection";
import {
  AnalysisHighlight,
  clearSentences,
  extractSentences,
  sentencePositions,
  styleSentences,
  trackSentences,
} from "./analysisHighlight";
import type { BeatPrediction, NextBeatRequest } from "@/lib/beats";
import type { AnalysisResult, AnalyzeEvent, AnalyzeRequest } from "@/lib/analysis";

const DOC_KEY = "jev:doc";
const NOTES_KEY = "jev:notes";
const TITLE_KEY = "jev:title";
// Wait this long after a sentence ends before asking Jev, so fast typists
// don't trigger a request for every sentence they rattle off.
const DEBOUNCE_MS = 900;

// Ends with . ! ? or … optionally followed by closing quotes/brackets, then optional whitespace.
const SENTENCE_END = /[.!?…]["'”’)\]]*\s*$/;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode etc.); the editor still works.
  }
}

function textAroundCursor(editor: Editor) {
  const { doc, selection } = editor.state;
  return {
    before: doc.textBetween(0, selection.from, "\n\n", " "),
    after: doc.textBetween(selection.from, doc.content.size, "\n\n", " "),
  };
}

export function Writer() {
  const [title, setTitle] = useState("Untitled story");
  const [notes, setNotes] = useState("");
  const [prediction, setPrediction] = useState<BeatPrediction | null>(null);
  const [status, setStatus] = useState<"idle" | "thinking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });
  const [focused, setFocused] = useState<number | null>(null);
  const analysisRun = useRef<AbortController | null>(null);
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const lastAsked = useRef<string>("");
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const ask = useCallback(async (editor: Editor, force = false) => {
    const { before, after } = textAroundCursor(editor);
    if (!before.trim()) return;
    const key = before + "\u0000" + after + "\u0000" + notesRef.current;
    if (!force && key === lastAsked.current) return;
    lastAsked.current = key;

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setStatus("thinking");
    setError(null);

    try {
      const body: NextBeatRequest = { before, after, notes: notesRef.current };
      const res = await fetch("/api/next-beat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setPrediction(data as BeatPrediction);
      setStatus("idle");
    } catch (e) {
      if (controller.signal.aborted) return;
      lastAsked.current = "";
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Placeholder.configure({ placeholder: "Start writing…" }), AnalysisHighlight],
    editorProps: { attributes: { class: "page-content" } },
    onCreate: ({ editor }) => {
      const saved = load(DOC_KEY);
      if (saved) {
        try {
          editor.commands.setContent(JSON.parse(saved));
        } catch {
          // Ignore a corrupt save.
        }
      }
    },
    // Clicking into an analyzed sentence shows its breakdown in the panel.
    onSelectionUpdate: ({ editor }) => {
      if (analysisRef.current.status !== "done") return;
      const at = editor.state.selection.from;
      for (const [index, { from, to }] of sentencePositions(editor)) {
        if (at >= from && at <= to) {
          setFocused(index);
          return;
        }
      }
    },
    onUpdate: ({ editor }) => {
      save(DOC_KEY, JSON.stringify(editor.getJSON()));
      setAnalysis((a) => (a.status === "done" && !a.stale ? { ...a, stale: true } : a));
      if (timer.current) clearTimeout(timer.current);
      const { before } = textAroundCursor(editor);
      if (SENTENCE_END.test(before)) {
        timer.current = setTimeout(() => ask(editor), DEBOUNCE_MS);
      }
    },
  });

  const analyze = useCallback(async () => {
    if (!editor) return;
    const spans = extractSentences(editor.state.doc);
    analysisRun.current?.abort();
    const controller = new AbortController();
    analysisRun.current = controller;
    setFocused(null);
    trackSentences(editor, spans);
    setAnalysis({ status: "running", done: 0, total: 1, stage: "Starting" });

    try {
      const body: AnalyzeRequest = {
        sentences: spans.map(({ text, paragraph }) => ({ text, paragraph })),
        notes: notesRef.current,
      };
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      // The route streams one JSON event per line: progress, then a result or an error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: AnalysisResult | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as AnalyzeEvent;
          if (event.type === "progress") setAnalysis({ status: "running", ...event });
          else if (event.type === "error") throw new Error(event.error);
          else result = event.result;
        }
      }
      if (!result) throw new Error("The analysis ended without a result.");
      setAnalysis({ status: "done", result, texts: spans.map((s) => s.text), stale: false });
    } catch (e) {
      if (controller.signal.aborted) return;
      clearSentences(editor);
      setAnalysis({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [editor]);

  const cancelAnalysis = useCallback(() => {
    analysisRun.current?.abort();
    if (editor) clearSentences(editor);
    setAnalysis({ status: "idle" });
  }, [editor]);

  // Highlight deviations in the text, strongest first.
  useEffect(() => {
    if (!editor || analysis.status !== "done") return;
    const { deviations, surprises, runs, sentences } = analysis.result;
    const rank = new Map(deviations.map((i, r) => [i, r]));
    const surprise = new Set(surprises);
    const inRun = new Set(runs.flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, j) => r.start + j)));
    styleSentences(editor, (i) => {
      const s = sentences[i];
      const focus = focused === i ? " jev-focus" : "";
      const title = s?.expected ? `Jev expected ${s.expected}; this is ${s.actual}` : undefined;
      if (rank.has(i)) {
        const heat = 1 - (rank.get(i)! / Math.max(1, deviations.length)) * 0.6;
        return { class: "jev-dev" + focus, style: `--heat: ${heat.toFixed(2)}`, title };
      }
      if (surprise.has(i)) return { class: "jev-surprise" + focus, title };
      if (inRun.has(i)) return { class: "jev-run" + focus, title };
      return focus ? { class: "jev-s" + focus, title } : null;
    });
  }, [editor, analysis, focused]);

  const focusSentence = useCallback(
    (index: number) => {
      setFocused(index);
      const pos = editor && sentencePositions(editor).get(index);
      if (!editor || !pos) return;
      const { node } = editor.view.domAtPos(pos.from);
      const el = node instanceof Element ? node : node.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [editor],
  );

  useEffect(() => {
    setTitle(load(TITLE_KEY) ?? "Untitled story");
    setNotes(load(NOTES_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        ask(editor, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, ask]);

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            save(TITLE_KEY, e.target.value);
          }}
        />
        {editor && (
          <div className="format-buttons">
            <button
              className={editor.isActive("bold") ? "on" : ""}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <b>B</b>
            </button>
            <button
              className={editor.isActive("italic") ? "on" : ""}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <i>I</i>
            </button>
            <button
              className={editor.isActive("heading", { level: 2 }) ? "on" : ""}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              H
            </button>
          </div>
        )}
      </header>
      <main className="workspace">
        <div className="page">
          <EditorContent editor={editor} />
        </div>
        <JevPanel
          prediction={prediction}
          status={status}
          error={error}
          notes={notes}
          onNotesChange={(n) => {
            setNotes(n);
            save(NOTES_KEY, n);
          }}
          onAsk={() => editor && ask(editor, true)}
        >
          <AnalysisSection
            state={analysis}
            focused={focused}
            onAnalyze={analyze}
            onCancel={cancelAnalysis}
            onFocus={focusSentence}
            onClearFocus={() => setFocused(null)}
          />
        </JevPanel>
      </main>
    </div>
  );
}
