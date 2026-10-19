"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { JevPanel } from "./JevPanel";
import type { BeatPrediction, NextBeatRequest } from "@/lib/beats";

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
    extensions: [StarterKit, Placeholder.configure({ placeholder: "Start writing…" })],
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
    onUpdate: ({ editor }) => {
      save(DOC_KEY, JSON.stringify(editor.getJSON()));
      if (timer.current) clearTimeout(timer.current);
      const { before } = textAroundCursor(editor);
      if (SENTENCE_END.test(before)) {
        timer.current = setTimeout(() => ask(editor), DEBOUNCE_MS);
      }
    },
  });

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
        />
      </main>
    </div>
  );
}
