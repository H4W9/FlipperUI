import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { storageRead } from "../../lib/tauri";
import { base64ToUint8Array } from "../../lib/encoding";
import type { BadUsbEntry } from "../../types/badusb";

interface Props {
  entry: BadUsbEntry;
  onClose: () => void;
}

export function FilePreviewModal({ entry, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    storageRead(entry.path)
      .then((b64) => {
        if (cancelled) return;
        const bytes = base64ToUint8Array(b64);
        setText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[min(720px,90vw)] h-[min(560px,85vh)] bg-panel border border-border-subtle rounded-lg shadow-xl overflow-hidden"
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
            onClick={onClose}
            aria-label="Close preview"
            className="p-1 text-muted hover:text-primary rounded"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-auto bg-surface/40">
          {loading && (
            <div className="h-full flex items-center justify-center gap-2 text-xs text-dim">
              <Loader2 size={14} className="animate-spin" />
              Loading script…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 m-3 p-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && text !== null && (
            <pre className="text-[11px] leading-relaxed font-mono text-primary whitespace-pre px-3 py-2">
              {text.length > 0 ? text : <span className="text-dim italic">(empty file)</span>}
            </pre>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border-subtle text-[10px] text-dim">
          <span>
            {entry.line_count} non-blank line{entry.line_count === 1 ? "" : "s"}
          </span>
          <span>{formatSize(entry.size)}</span>
        </footer>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
