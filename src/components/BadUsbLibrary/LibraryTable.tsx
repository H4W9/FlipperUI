import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ArrowUp,
  ArrowDown,
  Copy,
  Download,
  FilePenLine,
  Pencil,
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
import { saveBadUsbCache } from "../../lib/badusbCache";
import { useExportDrag } from "../../hooks/useExportDrag";
import { relativeDir, parentDir, nextDuplicateName } from "../../lib/path";
import { formatSize, formatMtime } from "../../lib/format";
import { base64ToUint8Array } from "../../lib/encoding";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";
import type { BadUsbEntry } from "../../types/badusb";

const ROW_HEIGHT = 46;

type SortKey = "name" | "kind" | "lines" | "size" | "mtime";
type SortDir = "asc" | "desc";

interface Props {
  entries: BadUsbEntry[];
  allEntries: BadUsbEntry[];
  onPreview: (entry: BadUsbEntry) => void;
}

export function LibraryTable({ entries, allEntries, onPreview }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; items: MenuItem[] } | null
  >(null);

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

  const openMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

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
        No .txt scripts found.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <HeaderRow sortKey={sortKey} sortDir={sortDir} onHeaderClick={onHeaderClick} />
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
                <Row
                  entry={entry}
                  allEntries={allEntries}
                  onPreview={onPreview}
                  onContextMenu={openMenu}
                />
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}

const GRID_COLS = "grid-cols-[1fr_80px_70px_80px_100px_220px]";

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
      <HeaderCell label="Script / Folder" col="name" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
      <HeaderCell label="Kind" col="kind" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
      <HeaderCell label="Lines" col="lines" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} align="right" />
      <HeaderCell label="Size" col="size" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} align="right" />
      <HeaderCell label="Modified" col="mtime" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} align="right" />
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

function Row({
  entry,
  allEntries,
  onPreview,
  onContextMenu,
}: {
  entry: BadUsbEntry;
  allEntries: BadUsbEntry[];
  onPreview: (entry: BadUsbEntry) => void;
  onContextMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const setError = useFlipperStore((s) => s.setBadUsbError);
  const setEntries = useFlipperStore((s) => s.setBadUsbEntries);
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState<"rename" | "dup" | "delete" | "download" | null>(null);

  const kindRoot = entry.kind === "kb" ? "/ext/badkb" : "/ext/badusb";
  const relDir = relativeDir(entry.path, kindRoot);
  const handleDragStart = useExportDrag(entry.path, entry.name);

  const persistList = async (next: BadUsbEntry[]) => {
    setEntries(next);
    if (deviceUid) await saveBadUsbCache(deviceUid, next).catch(() => {});
  };

  const onDownload = async () => {
    setBusy("download");
    try {
      const savePath = await save({
        defaultPath: entry.name,
        filters: [{ name: "Duckyscript", extensions: ["txt"] }],
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
    if (!newName.toLowerCase().endsWith(".txt")) {
      setError("Filename must end with .txt");
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
      const duplicate: BadUsbEntry = {
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
      title: "Delete Duckyscript",
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

  const handleContextMenu = (e: React.MouseEvent) => {
    if (renaming) return;
    onContextMenu(e, [
      { label: "Edit", icon: <FilePenLine size={12} />, onClick: () => onPreview(entry) },
      { label: "Download", icon: <Download size={12} />, onClick: onDownload },
      { label: "Rename", icon: <Pencil size={12} />, onClick: startRename },
      { label: "Duplicate", icon: <Copy size={12} />, onClick: onDuplicate },
      { type: "separator" },
      {
        label: "Delete",
        icon: <Trash2 size={12} />,
        onClick: onDelete,
        danger: true,
      },
    ]);
  };

  return (
    <div
      className={`grid ${GRID_COLS} gap-2 px-3 h-full items-center text-xs border-b border-border-subtle/50 hover:bg-surface/40 transition-colors cursor-pointer`}
      draggable={!renaming}
      onDragStart={handleDragStart}
      onDoubleClick={() => {
        if (!renaming && busy === null) onPreview(entry);
      }}
      onContextMenu={handleContextMenu}
      title="Double-click to edit"
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
          title={entry.comment ?? (relDir ? `${kindRoot}/${relDir}` : kindRoot)}
        >
          {entry.comment ?? (relDir || "/")}
        </span>
      </div>
      <span className="text-secondary">
        <span
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
            entry.kind === "kb"
              ? "border-accent/40 text-accent"
              : "border-border-subtle text-secondary"
          }`}
        >
          {entry.kind === "kb" ? "BadKB" : "BadUSB"}
        </span>
      </span>
      <span className="text-right text-secondary tabular-nums">
        {entry.line_count}
      </span>
      <span className="text-right text-dim tabular-nums text-[11px]">
        {formatSize(entry.size)}
      </span>
      <span
        className="text-right text-dim tabular-nums text-[11px]"
        title={entry.mtime ? new Date(entry.mtime * 1000).toLocaleString() : ""}
      >
        {formatMtime(entry.mtime)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview(entry);
          }}
          disabled={busy !== null || renaming}
          title="Edit"
          aria-label="Edit"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <FilePenLine size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          disabled={busy !== null || renaming}
          title="Download to computer"
          aria-label="Download"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Download size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            startRename();
          }}
          disabled={busy !== null || renaming}
          title="Rename"
          aria-label="Rename"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          disabled={busy !== null || renaming}
          title="Duplicate"
          aria-label="Duplicate"
          className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={busy !== null || renaming}
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





function sortEntries(
  entries: BadUsbEntry[],
  key: SortKey,
  dir: SortDir,
): BadUsbEntry[] {
  const out = [...entries];
  out.sort((a, b) => {
    if (key === "mtime") {
      if (a.mtime == null && b.mtime == null) return 0;
      if (a.mtime == null) return 1;
      if (b.mtime == null) return -1;
      const c = a.mtime - b.mtime;
      return dir === "asc" ? c : -c;
    }
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "kind":
        cmp = a.kind.localeCompare(b.kind);
        break;
      case "lines":
        cmp = a.line_count - b.line_count;
        break;
      case "size":
        cmp = a.size - b.size;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return out;
}
