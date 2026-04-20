import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ArrowUp,
  ArrowDown,
  Copy,
  Download,
  Pencil,
  Radio,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import {
  storageDelete,
  storageRead,
  storageRename,
  storageWrite,
} from "../../lib/tauri";
import { saveNfcCache } from "../../lib/nfcCache";
import { base64ToUint8Array } from "../../lib/encoding";
import type { NfcEntry } from "../../types/nfc";

const ROW_HEIGHT = 46;
const NFC_ROOT = "/ext/nfc";

type SortKey = "name" | "type" | "uid" | "size";
type SortDir = "asc" | "desc";

interface Props {
  entries: NfcEntry[];
}

export function LibraryTable({ entries }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(
    () => sortEntries(entries, sortKey, sortDir),
    [entries, sortKey, sortDir],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-dim">
        No .nfc files found.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <HeaderRow
        sortKey={sortKey}
        sortDir={sortDir}
        onHeaderClick={onHeaderClick}
      />
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = sorted[vi.index];
            return (
              <div
                key={entry.path}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <Row entry={entry} allEntries={entries} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const GRID_COLS = "grid-cols-[1fr_160px_220px_80px_190px]";

function HeaderRow({
  sortKey,
  sortDir,
  onHeaderClick,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onHeaderClick: (k: SortKey) => void;
}) {
  return (
    <div
      className={`grid ${GRID_COLS} gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted border-b border-border-subtle bg-panel/60 sticky top-0 z-10`}
    >
      <HeaderCell label="Card / Folder" col="name" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
      <HeaderCell label="Type" col="type" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
      <HeaderCell label="UID" col="uid" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
      <HeaderCell label="Size" col="size" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} align="right" />
      <span className="text-right">Actions</span>
    </div>
  );
}

function HeaderCell({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = col === sortKey;
  return (
    <button
      onClick={() => onClick(col)}
      className={`flex items-center gap-1 hover:text-primary transition-colors ${
        align === "right" ? "justify-end" : ""
      } ${active ? "text-secondary" : ""}`}
    >
      <span>{label}</span>
      {active && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  );
}

function Row({ entry, allEntries }: { entry: NfcEntry; allEntries: NfcEntry[] }) {
  const setError = useFlipperStore((s) => s.setNfcError);
  const setEntries = useFlipperStore((s) => s.setNfcEntries);
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState<
    "rename" | "dup" | "delete" | "download" | null
  >(null);

  const relDir = relativeDir(entry.path, NFC_ROOT);
  const typeLabel = summarizeType(entry);

  const persistList = async (next: NfcEntry[]) => {
    setEntries(next);
    if (deviceUid) await saveNfcCache(deviceUid, next).catch(() => {});
  };

  const onDownload = async () => {
    setBusy("download");
    try {
      const savePath = await save({
        defaultPath: entry.name,
        filters: [{ name: "Flipper NFC card", extensions: ["nfc"] }],
      });
      if (!savePath) return;
      const b64 = await storageRead(entry.path);
      await writeFile(savePath, base64ToUint8Array(b64));
    } catch (e) {
      setError(`Download failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const startRename = () => {
    setRenameValue(entry.name);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameValue("");
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    if (!newName || newName === entry.name) {
      cancelRename();
      return;
    }
    if (!newName.toLowerCase().endsWith(".nfc")) {
      setError("Filename must end with .nfc");
      return;
    }
    const parent = parentDir(entry.path);
    const newPath = `${parent}/${newName}`;
    if (allEntries.some((e) => e.path === newPath)) {
      setError(`A file named "${newName}" already exists here.`);
      return;
    }
    setBusy("rename");
    try {
      await storageRename(entry.path, newPath);
      const next = allEntries.map((e) =>
        e.path === entry.path ? { ...e, path: newPath, name: newName } : e,
      );
      await persistList(next);
      setRenaming(false);
    } catch (e) {
      setError(`Rename failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onDuplicate = async () => {
    setBusy("dup");
    try {
      const parent = parentDir(entry.path);
      const existingNames = new Set(
        allEntries.filter((e) => parentDir(e.path) === parent).map((e) => e.name),
      );
      const newName = nextDuplicateName(entry.name, existingNames);
      const newPath = `${parent}/${newName}`;
      const b64 = await storageRead(entry.path);
      await storageWrite(newPath, b64);
      const duplicate: NfcEntry = {
        ...entry,
        path: newPath,
        name: newName,
        mtime: null,
      };
      await persistList([...allEntries, duplicate]);
    } catch (e) {
      setError(`Duplicate failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    const ok = await confirm(`Delete ${entry.name}?\n\nThis can't be undone.`, {
      title: "Delete .nfc file",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await storageDelete(entry.path, false);
      await persistList(allEntries.filter((e) => e.path !== entry.path));
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`grid ${GRID_COLS} gap-2 px-3 h-full items-center text-xs border-b border-border-subtle/50 hover:bg-surface/40 transition-colors`}
    >
      <div className="flex flex-col min-w-0">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              disabled={busy === "rename"}
              className="flex-1 min-w-0 bg-surface border border-accent/60 rounded px-1.5 py-0.5 text-xs text-primary outline-none"
            />
            <button
              onClick={commitRename}
              disabled={busy === "rename"}
              aria-label="Confirm rename"
              className="p-0.5 text-success hover:text-success/80"
              title="Save (Enter)"
            >
              <Check size={12} />
            </button>
            <button
              onClick={cancelRename}
              disabled={busy === "rename"}
              aria-label="Cancel rename"
              className="p-0.5 text-muted hover:text-primary"
              title="Cancel (Esc)"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <span className="truncate text-primary" title={entry.path}>
            {entry.name}
          </span>
        )}
        <span
          className="truncate text-[10px] text-dim"
          title={relDir ? `${NFC_ROOT}/${relDir}` : NFC_ROOT}
        >
          {relDir || "/"}
        </span>
      </div>
      <span className="text-secondary truncate" title={typeLabel}>
        {typeLabel}
      </span>
      <span
        className="text-secondary truncate font-mono text-[11px]"
        title={entry.uid ?? ""}
      >
        {entry.uid ?? "—"}
      </span>
      <span className="text-right text-dim tabular-nums text-[11px]">
        {formatSize(entry.size)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={onDownload}
          disabled={busy !== null || renaming}
          title="Download to computer"
          aria-label="Download"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Download size={13} />
        </button>
        <button
          onClick={startRename}
          disabled={busy !== null || renaming}
          title="Rename"
          aria-label="Rename"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDuplicate}
          disabled={busy !== null || renaming}
          title="Duplicate"
          aria-label="Duplicate"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={onDelete}
          disabled={busy !== null || renaming}
          title="Delete"
          aria-label="Delete"
          className="p-1 text-muted hover:text-danger rounded transition-colors disabled:opacity-30"
        >
          <Trash2 size={13} />
        </button>
        <button
          disabled
          title="Emulation coming soon"
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border-subtle text-dim opacity-40 cursor-not-allowed"
        >
          <Radio size={10} />
          Emulate
        </button>
      </div>
    </div>
  );
}

function summarizeType(entry: NfcEntry): string {
  const dev = entry.device_type ?? "";
  if (entry.mifare_type) {
    return dev ? `${dev} ${entry.mifare_type}` : entry.mifare_type;
  }
  return dev || "—";
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeDir(path: string, root: string): string {
  const prefix = root.replace(/\/$/, "") + "/";
  if (!path.startsWith(prefix)) return "";
  const rest = path.slice(prefix.length);
  const idx = rest.lastIndexOf("/");
  return idx < 0 ? "" : rest.slice(0, idx);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

function nextDuplicateName(name: string, existing: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const stripped = base.replace(/ \d+$/, "");
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stripped} ${n}${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stripped} copy${ext}`;
}

function sortEntries(
  entries: NfcEntry[],
  key: SortKey,
  dir: SortDir,
): NfcEntry[] {
  const out = [...entries];
  out.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "type":
        cmp = summarizeType(a).localeCompare(summarizeType(b));
        break;
      case "uid":
        cmp = (a.uid ?? "").localeCompare(b.uid ?? "");
        break;
      case "size":
        cmp = a.size - b.size;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return out;
}
