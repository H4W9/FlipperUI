import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { reboot, storageRead, storageWrite } from "../../lib/tauri";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../../lib/encoding";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { FilePickerModal } from "../FilePickerModal/FilePickerModal";

type Line =
  | { kind: "kv"; key: string; value: string }
  | { kind: "raw"; text: string }
  | { kind: "comment"; text: string };

interface Props {
  path: string;
  onClose: () => void;
}

export function DeviceSettingsModal({ path, onClose }: Props) {
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [trailingNewline, setTrailingNewline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"structured" | "raw">("structured");
  const [rawText, setRawText] = useState("");
  const [pickerForIndex, setPickerForIndex] = useState<number | null>(null);
  const [showRebootPrompt, setShowRebootPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    storageRead(path)
      .then((b64) => {
        if (cancelled) return;
        const bytes = base64ToUint8Array(b64);
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setOriginalText(text);
        setRawText(text);
        setLines(parseLines(text));
        setTrailingNewline(text.endsWith("\n") || text === "");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showRebootPrompt && pickerForIndex == null) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showRebootPrompt, pickerForIndex]);

  const currentText = useMemo(() => {
    if (mode === "raw") return rawText;
    return serializeLines(lines, trailingNewline);
  }, [mode, rawText, lines, trailingNewline]);

  const dirty = originalText != null && currentText !== originalText;

  const updateLine = useCallback((idx: number, patch: Partial<Line>) => {
    setLines((prev) =>
      prev.map((line, i) => (i === idx ? ({ ...line, ...patch } as Line) : line)),
    );
  }, []);

  const addRow = useCallback(() => {
    setLines((prev) => [...prev, { kind: "kv", key: "", value: "" }]);
  }, []);

  const removeRow = useCallback((idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const text = currentText;
      const bytes = new TextEncoder().encode(text);
      const b64 = uint8ArrayToBase64(bytes);
      await storageWrite(path, b64);
      setOriginalText(text);
      setShowRebootPrompt(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [currentText, path]);

  const handleReboot = useCallback(async () => {
    setShowRebootPrompt(false);
    try {
      // mode 0 = OS reboot. Fire-and-forget — the device disconnects mid-call.
      await reboot(0);
    } catch {
      /* expected: device disconnects */
    }
    onClose();
  }, [onClose]);

  const handleDismissReboot = useCallback(() => {
    setShowRebootPrompt(false);
    onClose();
  }, [onClose]);

  const switchMode = useCallback(
    (next: "structured" | "raw") => {
      if (next === mode) return;
      if (next === "raw") {
        setRawText(serializeLines(lines, trailingNewline));
      } else {
        setLines(parseLines(rawText));
        setTrailingNewline(rawText.endsWith("\n") || rawText === "");
      }
      setMode(next);
    },
    [mode, lines, rawText, trailingNewline],
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
        onClick={onClose}
      >
        <div
          className="bg-panel border border-border-subtle rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <div className="flex flex-col min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-primary truncate">
                {path.split("/").pop()}
              </h3>
              <span className="text-[10px] text-dim font-mono truncate">{path}</span>
            </div>
            <div className="flex items-center bg-surface rounded border border-border-subtle text-[10px] uppercase tracking-wide overflow-hidden">
              <button
                onClick={() => switchMode("structured")}
                className={`px-2 py-1 ${
                  mode === "structured"
                    ? "bg-accent/20 text-primary"
                    : "text-secondary hover:text-primary hover:bg-elevated"
                }`}
              >
                Structured
              </button>
              <button
                onClick={() => switchMode("raw")}
                className={`px-2 py-1 ${
                  mode === "raw"
                    ? "bg-accent/20 text-primary"
                    : "text-secondary hover:text-primary hover:bg-elevated"
                }`}
              >
                Raw
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-secondary hover:text-primary rounded hover:bg-elevated"
              title="Close"
            >
              <X size={14} />
            </button>
          </header>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs text-dim">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : error && originalText == null ? (
              <div className="m-3 p-3 flex items-start gap-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : mode === "raw" ? (
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
                className="w-full h-full min-h-[300px] resize-none bg-surface/40 px-3 py-2 text-[11px] font-mono text-primary outline-none"
              />
            ) : (
              <div className="px-3 py-2 flex flex-col gap-1.5">
                {lines.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-dim">
                    Empty file
                  </div>
                ) : (
                  lines.map((line, idx) => (
                    <LineRow
                      key={idx}
                      line={line}
                      onChange={(patch) => updateLine(idx, patch)}
                      onRemove={() => removeRow(idx)}
                      onPick={() => setPickerForIndex(idx)}
                    />
                  ))
                )}
                <button
                  onClick={addRow}
                  className="self-start mt-1 inline-flex items-center gap-1 px-2 py-1 text-[11px] text-secondary hover:text-primary border border-dashed border-border-subtle rounded hover:bg-elevated"
                >
                  <Plus size={11} /> Add line
                </button>
              </div>
            )}
          </div>

          {error && originalText != null && (
            <div className="mx-3 mb-2 p-2 flex items-start gap-2 bg-danger/10 border border-danger/30 rounded text-xs text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <footer className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle bg-surface/40">
            <span className="text-[11px] text-dim flex-1">
              {dirty ? "Unsaved changes" : "No changes"}
            </span>
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-surface text-secondary hover:text-primary hover:bg-elevated disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving || loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded font-medium bg-flipper text-black hover:bg-flipper/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save
            </button>
          </footer>
        </div>
      </div>

      {pickerForIndex != null && (
        <FilePickerModal
          title="Pick a file"
          initialPath="/ext/apps"
          onPick={(picked) => {
            const idx = pickerForIndex;
            setLines((prev) =>
              prev.map((line, i) => {
                if (i !== idx) return line;
                if (line.kind === "kv") return { ...line, value: picked };
                if (line.kind === "raw") return { ...line, text: picked };
                return line;
              }),
            );
            setPickerForIndex(null);
          }}
          onClose={() => setPickerForIndex(null)}
        />
      )}

      {showRebootPrompt && (
        <ConfirmDialog
          title="Reboot Flipper?"
          message="Settings are saved. Most /int settings only take effect after a reboot — reboot now?"
          confirmLabel="Reboot"
          cancelLabel="Later"
          onConfirm={handleReboot}
          onCancel={handleDismissReboot}
        />
      )}
    </>
  );
}

function LineRow({
  line,
  onChange,
  onRemove,
  onPick,
}: {
  line: Line;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  if (line.kind === "comment") {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={line.text}
          onChange={(e) => onChange({ text: e.target.value } as Partial<Line>)}
          spellCheck={false}
          className="flex-1 px-2 py-1 text-[11px] font-mono text-dim italic bg-surface/40 border border-border-subtle rounded outline-none focus:border-accent/40"
        />
        <RowActions onRemove={onRemove} onPick={onPick} />
      </div>
    );
  }
  if (line.kind === "raw") {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={line.text}
          onChange={(e) => onChange({ text: e.target.value } as Partial<Line>)}
          spellCheck={false}
          placeholder="(empty)"
          className="flex-1 px-2 py-1 text-[11px] font-mono text-primary bg-surface/40 border border-border-subtle rounded outline-none focus:border-accent/40"
        />
        <RowActions onRemove={onRemove} onPick={onPick} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={line.key}
        onChange={(e) => onChange({ key: e.target.value } as Partial<Line>)}
        spellCheck={false}
        placeholder="key"
        className="w-40 px-2 py-1 text-[11px] font-mono text-secondary bg-surface/40 border border-border-subtle rounded outline-none focus:border-accent/40"
      />
      <span className="text-dim text-[11px]">=</span>
      <input
        value={line.value}
        onChange={(e) => onChange({ value: e.target.value } as Partial<Line>)}
        spellCheck={false}
        placeholder="value"
        className="flex-1 px-2 py-1 text-[11px] font-mono text-primary bg-surface/40 border border-border-subtle rounded outline-none focus:border-accent/40"
      />
      <RowActions onRemove={onRemove} onPick={onPick} />
    </div>
  );
}

function RowActions({
  onPick,
  onRemove,
}: {
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <button
        onClick={onPick}
        title="Pick a file from the device"
        className="p-1 text-secondary hover:text-primary rounded hover:bg-elevated"
      >
        <FolderOpen size={12} />
      </button>
      <button
        onClick={onRemove}
        title="Remove line"
        className="p-1 text-secondary hover:text-danger rounded hover:bg-elevated"
      >
        <Trash2 size={12} />
      </button>
    </>
  );
}

function parseLines(text: string): Line[] {
  if (text === "") return [];
  // Drop a single trailing newline so we don't render a blank tail row;
  // serializeLines re-adds it via `trailingNewline`.
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n").map<Line>((raw) => {
    const t = raw.trim();
    if (t === "" || t.startsWith("#") || t.startsWith(";")) {
      return { kind: "comment", text: raw };
    }
    const eq = raw.indexOf("=");
    if (eq > 0) {
      return {
        kind: "kv",
        key: raw.slice(0, eq).trim(),
        value: raw.slice(eq + 1),
      };
    }
    return { kind: "raw", text: raw };
  });
}

function serializeLines(lines: Line[], trailingNewline: boolean): string {
  const out = lines
    .map((l) => {
      if (l.kind === "comment") return l.text;
      if (l.kind === "raw") return l.text;
      return `${l.key}=${l.value}`;
    })
    .join("\n");
  return out + (trailingNewline && out !== "" ? "\n" : "");
}
