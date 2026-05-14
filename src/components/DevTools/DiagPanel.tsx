import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCw, Trash2, ArrowUpRight, ArrowDownLeft, Activity } from "lucide-react";
import {
  diagEnable,
  diagEntries,
  diagClear,
  diagIsEnabled,
  type DiagEntry,
} from "../../lib/tauri";

interface DiagPanelProps {
  onClose: () => void;
}

// Render only the tail of the ring buffer so the DOM stays cheap. Older frames
// are still on the Rust side if needed; this limit is about render cost, not
// data loss.
const MAX_VISIBLE = 200;

export function DiagPanel({ onClose }: DiagPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await diagEntries());
    } catch {
      // Ignore — backend may momentarily be busy during reconnect.
    }
  }, []);

  // On mount: sync enabled state from the backend and kick off the poll loop.
  useEffect(() => {
    diagIsEnabled().then(setEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = window.setInterval(refresh, 500);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  // Follow the tail as new entries arrive unless the user scrolled up.
  useEffect(() => {
    if (!autoFollow) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, autoFollow]);

  const handleToggle = async () => {
    const next = !enabled;
    await diagEnable(next);
    setEnabled(next);
    if (!next) setEntries([]);
  };

  const handleClear = async () => {
    await diagClear();
    setEntries([]);
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoFollow(atBottom);
  };

  const visible = useMemo(
    () => (entries.length > MAX_VISIBLE ? entries.slice(-MAX_VISIBLE) : entries),
    [entries]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[720px] max-w-[90vw] h-[520px] max-h-[85vh] flex flex-col bg-panel border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface/50">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary font-medium">Developer diagnostics</span>
            <span className="text-[10px] text-dim">RPC frame log</span>
          </div>
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1.5 text-xs text-secondary mr-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={handleToggle}
                className="accent-accent"
              />
              Enabled
            </label>
            <button
              onClick={refresh}
              aria-label="Refresh"
              className="p-1 text-muted hover:text-primary rounded transition-colors"
              title="Refresh"
              disabled={!enabled}
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={handleClear}
              aria-label="Clear"
              className="p-1 text-muted hover:text-primary rounded transition-colors"
              title="Clear log"
              disabled={!enabled}
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 text-muted hover:text-primary rounded transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {!enabled ? (
          <div className="flex-1 flex items-center justify-center text-dim text-xs px-6 text-center">
            Diagnostics are off. Enable to start capturing the last {MAX_VISIBLE * 2} RPC frames
            exchanged with the Flipper.
          </div>
        ) : (
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto font-mono text-[11px] leading-tight"
          >
            {visible.length === 0 ? (
              <div className="flex items-center justify-center h-full text-dim text-xs">
                Waiting for traffic…
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-panel border-b border-border-subtle text-secondary text-left">
                  <tr>
                    <th className="px-2 py-1 font-normal w-8"></th>
                    <th className="px-2 py-1 font-normal">time</th>
                    <th className="px-2 py-1 font-normal">id</th>
                    <th className="px-2 py-1 font-normal">kind</th>
                    <th className="px-2 py-1 font-normal">detail</th>
                    <th className="px-2 py-1 font-normal text-right">bytes</th>
                    <th className="px-2 py-1 font-normal text-right">status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e, i) => (
                    <tr
                      key={`${e.ts_ms}-${i}`}
                      className="border-b border-border-subtle/30 hover:bg-surface/40"
                    >
                      <td className="px-2 py-0.5">
                        {e.dir === "Tx" ? (
                          <ArrowUpRight size={11} className="text-accent" />
                        ) : e.dir === "Rx" ? (
                          <ArrowDownLeft size={11} className="text-success" />
                        ) : (
                          <Activity size={11} className="text-secondary" />
                        )}
                      </td>
                      <td className="px-2 py-0.5 text-dim">{formatTime(e.ts_ms)}</td>
                      <td className="px-2 py-0.5 text-secondary">
                        {e.command_id || <span className="text-dim">—</span>}
                      </td>
                      <td className="px-2 py-0.5 text-primary truncate max-w-[280px]">
                        {e.content_kind || <span className="text-dim">—</span>}
                        {e.has_next && <span className="ml-1 text-dim">…</span>}
                      </td>
                      <td className="px-2 py-0.5 text-secondary truncate max-w-[300px]">
                        {e.detail || <span className="text-dim">—</span>}
                      </td>
                      <td className="px-2 py-0.5 text-right text-secondary">{e.payload_bytes}</td>
                      <td
                        className={`px-2 py-0.5 text-right ${
                          e.command_status !== 0 ? "text-danger" : "text-dim"
                        }`}
                      >
                        {e.command_status_name || e.command_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="px-3 py-1 border-t border-border-subtle bg-surface/30 text-[10px] text-dim flex items-center justify-between">
          <span>{enabled ? `${entries.length} frames` : "off"}</span>
          <span>{autoFollow ? "following tail" : "scroll-paused"}</span>
        </div>
      </div>
    </div>
  );
}

function formatTime(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
