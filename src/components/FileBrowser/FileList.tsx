import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Folder,
  File,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
  Archive,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";
import { useExportDrag } from "../../hooks/useExportDrag";
import { storageTarExtract, storageTimestamp } from "../../lib/tauri";
import { joinPath } from "../../lib/encoding";
import { Spinner } from "../ui/Spinner";
import type { FileEntry } from "../../types/flipper";

const ROW_HEIGHT = 32; // px — fixed height for virtual scrolling

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTarFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = "name" | "size" | "type";
type SortDir = "asc" | "desc";

function sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    // Always keep dirs above files
    if (a.file_type !== b.file_type) return b.file_type - a.file_type;

    let cmp = 0;
    if (key === "name") cmp = a.name.localeCompare(b.name);
    else if (key === "size") cmp = a.size - b.size;
    else if (key === "type") {
      const extA = a.name.includes(".") ? a.name.split(".").pop()! : "";
      const extB = b.name.includes(".") ? b.name.split(".").pop()! : "";
      cmp = extA.localeCompare(extB) || a.name.localeCompare(b.name);
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface ContextMenuProps extends ContextMenuState {
  onRename: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onExtractTar: () => void;
  onClose: () => void;
}

function ContextMenu({
  x,
  y,
  entry,
  onRename,
  onDownload,
  onDelete,
  onExtractTar,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isDir = entry.file_type === 1;
  const isTar = !isDir && isTarFile(entry.name);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const style: React.CSSProperties = { position: "fixed", zIndex: 50 };
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const menuW = 160;
  const menuH = 130;
  style.left = x + menuW > winW ? winW - menuW - 4 : x;
  style.top = y + menuH > winH ? winH - menuH - 4 : y;

  const item =
    "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-elevated cursor-pointer rounded transition-colors";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="File actions"
      style={style}
      className="w-40 bg-surface border border-elevated rounded shadow-xl py-1 text-primary"
    >
      <div
        role="menuitem"
        className={item}
        onMouseDown={(e) => {
          e.preventDefault();
          onRename();
          onClose();
        }}
      >
        <Pencil size={12} className="text-secondary" /> Rename
      </div>
      {!isDir && (
        <div
          role="menuitem"
          className={item}
          onMouseDown={(e) => {
            e.preventDefault();
            onDownload();
            onClose();
          }}
        >
          <Download size={12} className="text-secondary" /> Download
        </div>
      )}
      {isTar && (
        <div
          role="menuitem"
          className={item}
          onMouseDown={(e) => {
            e.preventDefault();
            onExtractTar();
            onClose();
          }}
        >
          <Archive size={12} className="text-secondary" /> Extract here
        </div>
      )}
      <div className="my-1 border-t border-elevated" role="separator" />
      <div
        role="menuitem"
        className={`${item} text-danger hover:text-danger/80 hover:bg-danger/10`}
        onMouseDown={(e) => {
          e.preventDefault();
          onDelete();
          onClose();
        }}
      >
        <Trash2 size={12} /> Delete
      </div>
    </div>
  );
}

// ── File row ─────────────────────────────────────────────────────────────────

interface FileRowProps {
  entry: FileEntry;
  isRenaming: boolean;
  isSelected: boolean;
  onStartRename: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onSelect: (name: string, e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

// Simple timestamp cache — shared across all FileRow instances
const timestampCache = new Map<string, string>();

function formatTimestamp(epoch: number): string {
  if (epoch === 0) return "—";
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileRow({
  entry,
  isRenaming,
  isSelected,
  onStartRename,
  onContextMenu,
  onSelect,
  style,
}: FileRowProps) {
  const { currentPath, setCurrentPath } = useFlipperStore();
  const { refresh, download, rename } = useStorage();
  const isDir = entry.file_type === 1;

  const [renameValue, setRenameValue] = useState(entry.name);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Fetch timestamp lazily on hover
  const handleMouseEnter = useCallback(() => {
    if (isDir) return;
    const fullPath = joinPath(currentPath, entry.name);
    const cached = timestampCache.get(fullPath);
    if (cached) {
      setTimestamp(cached);
      return;
    }
    storageTimestamp(fullPath)
      .then((epoch) => {
        const formatted = formatTimestamp(epoch);
        timestampCache.set(fullPath, formatted);
        setTimestamp(formatted);
      })
      .catch(() => {}); // ignore — timestamp is optional
  }, [isDir, currentPath, entry.name]);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(entry.name);
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    }
  }, [isRenaming, entry.name]);

  const commitRename = async () => {
    onStartRename("");
    await rename(entry.name, renameValue);
  };

  const cancelRename = () => {
    onStartRename("");
    setRenameValue(entry.name);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) return;
    if (isDir && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const newPath = joinPath(currentPath, entry.name);
      setCurrentPath(newPath);
      refresh(newPath);
      return;
    }
    onSelect(entry.name, e);
  };

  const exportDrag = useExportDrag(joinPath(currentPath, entry.name), entry.name);
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isDir) return;
      void exportDrag(e);
    },
    [isDir, exportDrag],
  );

  // Folder rows tag themselves with `data-drop-folder` so FileBrowser can
  // hit-test where a native drag landed and upload directly into that folder.
  const dropFolder = isDir ? joinPath(currentPath, entry.name) : undefined;

  return (
    <div
      style={style}
      data-drop-folder={dropFolder}
      draggable={!isDir && !isRenaming}
      className={`flex items-center gap-2 px-3 border-b border-border-subtle/60 hover:bg-surface/40 group text-sm ${
        isDir && !isRenaming ? "cursor-pointer" : ""
      } ${isSelected ? "bg-surface/60" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onDragStart={handleDragStart}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, entry);
      }}
      title={timestamp ?? undefined}
    >
      {isDir ? (
        <Folder size={15} className="text-accent shrink-0" />
      ) : (
        <File size={15} className="text-muted shrink-0" />
      )}

      {isRenaming ? (
        <div
          className="flex items-center gap-1 flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            className="flex-1 px-1.5 py-0.5 text-sm bg-surface border border-accent/60 text-primary rounded outline-none focus:border-accent"
          />
          <button onClick={commitRename} className="p-0.5 text-success hover:text-success/80">
            <Check size={13} />
          </button>
          <button onClick={cancelRename} className="p-0.5 text-muted hover:text-primary">
            <X size={13} />
          </button>
        </div>
      ) : (
        <span className={`flex-1 truncate ${isDir ? "text-accent/80" : "text-primary"}`}>
          {entry.name}
        </span>
      )}

      {!isRenaming && (
        <span className="text-xs text-muted w-16 text-right shrink-0">
          {isDir ? "" : formatSize(entry.size)}
        </span>
      )}

      {!isRenaming && (
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onStartRename(entry.name)}
            className="p-1 text-secondary hover:text-accent rounded"
            title="Rename (F2)"
          >
            <Pencil size={13} />
          </button>
          {!isDir && (
            <button
              onClick={() => download(entry.name)}
              className="p-1 text-secondary hover:text-blue-400 rounded"
              title="Download"
            >
              <Download size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sort header button ───────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-0.5 hover:text-primary transition-colors ${
        active ? "text-primary" : ""
      } ${className ?? ""}`}
    >
      {label}
      {active &&
        (currentDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  );
}

// ── FileList ─────────────────────────────────────────────────────────────────

export function FileList() {
  const { entries, isLoading, currentPath, setError } = useFlipperStore();
  const { download, remove, refresh } = useStorage();

  const [renamingName, setRenamingName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clear filter + selection + timestamp cache when directory changes
  useEffect(() => {
    setFilter("");
    setSelectedNames(new Set());
    timestampCache.clear();
  }, [currentPath]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const filteredSorted = useMemo(() => {
    let result = entries;
    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(lower));
    }
    return sortEntries(result, sortKey, sortDir);
  }, [entries, filter, sortKey, sortDir]);

  // Virtual scrolling
  const virtualizer = useVirtualizer({
    count: filteredSorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const handleSelect = useCallback(
    (name: string, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        setSelectedNames((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
      } else if (e.shiftKey && selectedNames.size > 0) {
        // Range select
        const lastSelected = [...selectedNames].pop()!;
        const names = filteredSorted.map((e) => e.name);
        const startIdx = names.indexOf(lastSelected);
        const endIdx = names.indexOf(name);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const range = names.slice(lo, hi + 1);
          setSelectedNames((prev) => new Set([...prev, ...range]));
        }
      } else {
        setSelectedNames(new Set([name]));
      }
    },
    [selectedNames, filteredSorted],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  const handleExtractTar = useCallback(
    async (entry: FileEntry) => {
      const tarPath = joinPath(currentPath, entry.name);
      try {
        await storageTarExtract(tarPath, currentPath);
        await refresh(currentPath);
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [currentPath, refresh, setError],
  );

  // Keyboard shortcuts — use refs so the listener is stable (registered once)
  const selectedNamesRef = useRef(selectedNames);
  selectedNamesRef.current = selectedNames;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const filteredSortedRef = useRef(filteredSorted);
  filteredSortedRef.current = filteredSorted;
  const removeRef = useRef(remove);
  removeRef.current = remove;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        // Delete selected files
        if (selectedNamesRef.current.size > 0) {
          e.preventDefault();
          for (const name of selectedNamesRef.current) {
            const entry = entriesRef.current.find((en) => en.name === name);
            if (entry) removeRef.current(name, entry.file_type === 1);
          }
          setSelectedNames(new Set());
        }
      } else if (e.key === "F2") {
        // Rename first selected
        if (selectedNamesRef.current.size === 1) {
          e.preventDefault();
          setRenamingName([...selectedNamesRef.current][0]);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        // Select all
        e.preventDefault();
        setSelectedNames(new Set(filteredSortedRef.current.map((en) => en.name)));
      } else if (e.key === "Escape") {
        setSelectedNames(new Set());
        setRenamingName("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1 gap-2 text-muted">
        <Spinner size={16} />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-dim text-sm">
        {currentPath === "/" ? "No files" : "Empty directory"}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Column header with search + sort */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-flipper bg-panel/60 text-xs text-muted shrink-0">
          <span className="w-4 shrink-0" />
          <SortHeader
            label="Name"
            sortKey="name"
            currentKey={sortKey}
            currentDir={sortDir}
            onSort={handleSort}
            className="flex-1"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="w-28 px-1.5 py-0.5 text-xs bg-surface border border-flipper text-primary rounded outline-none focus:border-accent/60 placeholder:text-dim"
          />
          <SortHeader
            label="Size"
            sortKey="size"
            currentKey={sortKey}
            currentDir={sortDir}
            onSort={handleSort}
            className="w-16 justify-end shrink-0"
          />
          <span className="w-14 shrink-0" />
        </div>

        {/* Virtualized file list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {filteredSorted.length === 0 && filter ? (
            <div className="flex items-center justify-center py-8 text-dim text-sm">
              No matches for &quot;{filter}&quot;
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filteredSorted[virtualRow.index];
                return (
                  <FileRow
                    key={entry.name}
                    entry={entry}
                    isRenaming={renamingName === entry.name}
                    isSelected={selectedNames.has(entry.name)}
                    onStartRename={setRenamingName}
                    onContextMenu={handleContextMenu}
                    onSelect={handleSelect}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: ROW_HEIGHT,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* File count footer */}
        <div className="px-3 py-1 text-xs text-dim border-t border-border-subtle/40 shrink-0">
          {filteredSorted.length} item{filteredSorted.length !== 1 ? "s" : ""}
          {selectedNames.size > 0 && ` · ${selectedNames.size} selected`}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          {...contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => setRenamingName(contextMenu.entry.name)}
          onDownload={() => download(contextMenu.entry.name)}
          onDelete={() => remove(contextMenu.entry.name, contextMenu.entry.file_type === 1)}
          onExtractTar={() => handleExtractTar(contextMenu.entry)}
        />
      )}
    </>
  );
}
