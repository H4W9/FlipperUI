import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Save, X } from "lucide-react";
import { badusbParsePaths, storageRead, storageWrite } from "../../lib/tauri";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../../lib/encoding";
import type { BadUsbEntry } from "../../types/badusb";
import { DuckyscriptEditor } from "./DuckyscriptEditor";

interface Props {
  entry: BadUsbEntry;
  onClose: () => void;
  onSaved: (entry: BadUsbEntry) => void;
}

export function BadUsbEditorModal({ entry, onClose, onSaved }: Props) {
  const [initialText, setInitialText] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = initialText !== null && text !== initialText;
  const stats = useMemo(() => {
    const bytes = new TextEncoder().encode(text).length;
    const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
    return { bytes, lines };
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInitialText(null);
    setText("");

    storageRead(entry.path)
      .then((b64) => {
        if (cancelled) return;
        const bytes = base64ToUint8Array(b64);
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setInitialText(decoded);
        setText(decoded);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);

  const saveChanges = useCallback(async () => {
    if (!dirty || saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      const bytes = new TextEncoder().encode(text);
      await storageWrite(entry.path, uint8ArrayToBase64(bytes));
      const parsed = await badusbParsePaths([entry.path]);
      const refreshed = parsed[0] ?? {
        ...entry,
        line_count: countNonBlankLines(text),
        comment: firstComment(text),
        size: bytes.length,
        mtime: null,
      };
      setInitialText(text);
      onSaved(refreshed);
    } catch (e) {
      setError(`Save failed: ${(e as Error).message || String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [dirty, entry, loading, onSaved, saving, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving && !loading) void saveChanges();
      }
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, loading, requestClose, saveChanges, saving]);

  const revert = () => {
    if (initialText !== null) setText(initialText);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/70 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[min(860px,92vw)] h-[min(680px,88vh)] bg-panel border border-border-subtle rounded-lg shadow-xl overflow-hidden"
      >
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium text-primary truncate" title={entry.name}>
              {entry.name}
            </span>
            <span className="text-[10px] text-dim truncate" title={entry.path}>
              {entry.path}
            </span>
          </div>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border-subtle text-secondary"
            title={entry.kind === "kb" ? "Bluetooth HID" : "USB HID"}
          >
            {entry.kind === "kb" ? "BadKB" : "BadUSB"}
          </span>
          <button
            onClick={revert}
            disabled={!dirty || saving || loading}
            title="Revert changes"
            aria-label="Revert changes"
            className="p-1 text-muted hover:text-primary rounded disabled:opacity-30"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={saveChanges}
            disabled={!dirty || saving || loading}
            title="Save"
            aria-label="Save"
            className="p-1 text-muted hover:text-accent rounded disabled:opacity-30"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          </button>
          <button
            onClick={requestClose}
            aria-label="Close editor"
            className="p-1 text-muted hover:text-primary rounded"
          >
            <X size={14} />
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2 m-3 mb-0 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden bg-surface/40">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-xs text-dim">
              <Loader2 size={14} className="animate-spin" />
              Loading script...
            </div>
          ) : initialText === null ? (
            <div className="h-full flex items-center justify-center text-xs text-dim">
              Script could not be loaded.
            </div>
          ) : (
            <DuckyscriptEditor value={text} onChange={setText} readOnly={saving} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border-subtle text-[10px] text-dim">
          <span>
            {stats.lines} line{stats.lines === 1 ? "" : "s"} · {countNonBlankLines(text)} non-blank
          </span>
          <span className={dirty ? "text-accent" : ""}>
            {dirty ? "Unsaved" : "Saved"} · {formatSize(stats.bytes)}
          </span>
        </footer>
      </div>
    </div>
  );
}

function countNonBlankLines(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
}

function firstComment(text: string): string | null {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const rem = trimmed.match(/^REM\s+(.+)$/i);
    if (rem?.[1]?.trim()) return rem[1].trim();
    if (trimmed.startsWith("#") && trimmed.slice(1).trim()) return trimmed.slice(1).trim();
  }
  return null;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
