import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import {
  appStart,
  storageDelete,
  storageRead,
  storageRename,
} from "../../lib/tauri";
import { saveAppsCache } from "../../lib/appsCache";
import { useExportDrag } from "../../hooks/useExportDrag";
import { base64ToUint8Array } from "../../lib/encoding";
import { FapIcon } from "./FapIcon";
import type { AppEntry } from "../../types/apps";

const ROW_HEIGHT = 46;

type SortKey = "name" | "category" | "size";
type SortDir = "asc" | "desc";

interface Props {
  entries: AppEntry[];
  allEntries: AppEntry[];
}

export function LibraryTable({ entries, allEntries }: Props) {
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
        No apps match the current filter.
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
                <Row entry={entry} allEntries={allEntries} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const GRID_COLS = "grid-cols-[32px_1fr_140px_80px_160px]";

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
      <span aria-hidden />
      <HeaderCell
        label="App / Path"
        col="name"
        sortKey={sortKey}
        sortDir={sortDir}
        onClick={onHeaderClick}
      />
      <HeaderCell
        label="Category"
        col="category"
        sortKey={sortKey}
        sortDir={sortDir}
        onClick={onHeaderClick}
      />
      <HeaderCell
        label="Size"
        col="size"
        sortKey={sortKey}
        sortDir={sortDir}
        onClick={onHeaderClick}
        align="right"
      />
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
      {active &&
        (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  );
}

function Row({
  entry,
  allEntries,
}: {
  entry: AppEntry;
  allEntries: AppEntry[];
}) {
  const setError = useFlipperStore((s) => s.setAppsError);
  const setEntries = useFlipperStore((s) => s.setAppEntries);
  const launchingPath = useFlipperStore((s) => s.appsLaunchingPath);
  const setLaunchingPath = useFlipperStore((s) => s.setAppsLaunchingPath);
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);
  const icon = useFlipperStore((s) => s.appIcons[entry.path]);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState<"rename" | "download" | "delete" | null>(
    null,
  );

  const relDir = relativeDir(entry.path, entry.root);
  const launching = launchingPath === entry.path;
  const anyLaunching = launchingPath !== null;
  const handleDragStart = useExportDrag(entry.path, `${entry.name}.fap`);

  const persistList = async (next: AppEntry[]) => {
    setEntries(next);
    if (deviceUid) await saveAppsCache(deviceUid, next).catch(() => {});
  };

  const onLaunch = async () => {
    if (anyLaunching) return;
    setLaunchingPath(entry.path);
    try {
      await appStart(entry.path, "");
    } catch (e) {
      setError(`Launch failed: ${(e as Error).message || String(e)}`);
    } finally {
      setLaunchingPath(null);
    }
  };

  const onDownload = async () => {
    setBusy("download");
    try {
      const savePath = await save({
        defaultPath: `${entry.name}.fap`,
        filters: [{ name: "Flipper app", extensions: ["fap"] }],
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
    setRenameValue(`${entry.name}.fap`);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameValue("");
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    if (!newName) {
      cancelRename();
      return;
    }
    if (!newName.toLowerCase().endsWith(".fap")) {
      setError("Filename must end with .fap");
      return;
    }
    const parent = parentDir(entry.path);
    const newPath = `${parent}/${newName}`;
    if (newPath === entry.path) {
      cancelRename();
      return;
    }
    if (allEntries.some((e) => e.path === newPath)) {
      setError(`A file named "${newName}" already exists here.`);
      return;
    }
    setBusy("rename");
    try {
      await storageRename(entry.path, newPath);
      const newBase = newName.replace(/\.fap$/i, "");
      const next = allEntries.map((e) =>
        e.path === entry.path
          ? { ...e, path: newPath, name: newBase }
          : e,
      );
      await persistList(next);
      setRenaming(false);
    } catch (e) {
      setError(`Rename failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    const ok = await confirm(
      `Delete ${entry.name}.fap?\n\nThis uninstalls the app from the device and can't be undone.`,
      {
        title: "Delete app",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
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

  const rowDisabled = busy !== null || renaming;

  return (
    <div
      className={`grid ${GRID_COLS} gap-2 px-3 h-full items-center text-xs border-b border-border-subtle/50 hover:bg-surface/40 transition-colors`}
      draggable={!renaming}
      onDragStart={handleDragStart}
    >
      <FapIcon bytes={icon?.icon} size={20} />
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
          title={entry.path}
        >
          {entry.root}
          {relDir && `/${relDir}`}
        </span>
      </div>
      <span className="text-secondary truncate" title={entry.category ?? ""}>
        {entry.category ?? "—"}
      </span>
      <span className="text-right text-secondary tabular-nums">
        {formatSize(entry.size)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={onLaunch}
          disabled={rowDisabled || anyLaunching}
          title={launching ? "Launching…" : "Launch on device"}
          aria-label="Launch"
          className="p-1 text-muted hover:text-accent rounded transition-colors disabled:opacity-30"
        >
          <Play
            size={13}
            className={launching ? "animate-pulse text-accent" : ""}
          />
        </button>
        <button
          onClick={onDownload}
          disabled={rowDisabled}
          title="Download .fap"
          aria-label="Download"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Download size={13} />
        </button>
        <button
          onClick={startRename}
          disabled={rowDisabled}
          title="Rename"
          aria-label="Rename"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDelete}
          disabled={rowDisabled}
          title="Delete"
          aria-label="Delete"
          className="p-1 text-muted hover:text-danger rounded transition-colors disabled:opacity-30"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
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

function sortEntries(
  entries: AppEntry[],
  key: SortKey,
  dir: SortDir,
): AppEntry[] {
  const out = [...entries];
  out.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "category":
        cmp = (a.category ?? "").localeCompare(b.category ?? "");
        break;
      case "size":
        cmp = a.size - b.size;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return out;
}
