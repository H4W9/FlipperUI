import { useEffect, useRef } from "react";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { duckyscriptCompletionSource, duckyscriptLanguage } from "./duckyscript";

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

const duckyscriptHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ffb454", fontWeight: "600" },
  { tag: tags.comment, color: "#71717a", fontStyle: "italic" },
  { tag: tags.number, color: "#7dd3fc" },
  { tag: tags.string, color: "#f4f4f5" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "#f4f4f5",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "#ff8300",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "#52525b",
    borderRight: "1px solid #27272a",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 131, 0, 0.08)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 131, 0, 0.08)",
    color: "#a1a1aa",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(255, 131, 0, 0.28) !important",
  },
  ".cm-tooltip": {
    backgroundColor: "#18181b",
    border: "1px solid #3f3f46",
    color: "#f4f4f5",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "rgba(255, 131, 0, 0.18)",
    color: "#f4f4f5",
  },
});

export function DuckyscriptEditor({ value, onChange, readOnly = false }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        duckyscriptLanguage,
        syntaxHighlighting(duckyscriptHighlight),
        autocompletion({
          override: [duckyscriptCompletionSource],
          activateOnTyping: true,
        }),
        keymap.of([indentWithTab, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const next = update.state.doc.toString();
          valueRef.current = next;
          onChangeRef.current(next);
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className="h-full min-h-0" />;
}
