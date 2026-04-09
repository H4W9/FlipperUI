import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Folder,
  File,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";
import { Spinner } from "../ui/Spinner";
import type { FileEntry } from "../../types/flipper";

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface ContextMenuProps extends ContextMenuState {
  onRename: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function ContextMenu({
  x,
  y,
  entry,
  onRename,
  onDownload,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isDir = entry.file_type === 1;

  // Close on outside click or Escape
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

  // Nudge menu back on-screen if it would overflow the right/bottom edge
  const style: React.CSSProperties = { position: "fixed", zIndex: 50 };
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const menuW = 160;
  const menuH = isDir ? 80 : 112;
  style.left = x + menuW > winW ? winW - menuW - 4 : x;
  style.top = y + menuH > winH ? winH - menuH - 4 : y;

  const item = "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-700 cursor-pointer rounded transition-colors";

  return (
    <div
      ref={ref}
      style={style}
      className="w-40 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 text-zinc-200"
    >
      <div
        className={item}
        onMouseDown={(e) => { e.preventDefault(); onRename(); onClose(); }}
      >
        <Pencil size={12} className="text-zinc-400" /> Rename
      </div>
      {!isDir && (
        <div
          className={item}
          onMouseDown={(e) => { e.preventDefault(); onDownload(); onClose(); }}
        >
          <Download size={12} className="text-zinc-400" /> Download
        </div>
      )}
      <div className="my-1 border-t border-zinc-700" />
      <div
        className={`${item} text-red-400 hover:text-red-300 hover:bg-red-900/30`}
        onMouseDown={(e) => { e.preventDefault(); onDelete(); onClose(); }}
      >
        <Trash2 size={12} /> Delete
      </div>
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

interface FileRowProps {
  entry: FileEntry;
  isRenaming: boolean;
  onStartRename: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}

function FileRow({ entry, isRenaming, onStartRename, onContextMenu }: FileRowProps) {
  const { currentPath, setCurrentPath } = useFlipperStore();
  const { refresh, download, rename } = useStorage();
  const isDir = entry.file_type === 1;

  const [renameValue, setRenameValue] = useState(entry.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // When this row enters rename mode, reset value and focus the input
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
    onStartRename(""); // clear rename mode
    await rename(entry.name, renameValue);
  };

  const cancelRename = () => {
    onStartRename(""); // clear rename mode
    setRenameValue(entry.name);
  };

  const handleClick = () => {
    if (!isDir || isRenaming) return;
    const newPath =
      currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
    setCurrentPath(newPath);
    refresh(newPath);
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60 hover:bg-zinc-800/40 group text-sm ${
        isDir && !isRenaming ? "cursor-pointer" : ""
      }`}
      onClick={handleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, entry); }}
    >
      {/* Icon */}
      {isDir ? (
        <Folder size={15} className="text-orange-400 shrink-0" />
      ) : (
        <File size={15} className="text-zinc-500 shrink-0" />
      )}

      {/* Name — switches to inline input when renaming */}
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
            className="flex-1 px-1.5 py-0.5 text-sm bg-zinc-800 border border-orange-500/60 text-zinc-100 rounded outline-none focus:border-orange-400"
          />
          <button
            onClick={commitRename}
            className="p-0.5 text-green-400 hover:text-green-300"
          >
            <Check size={13} />
          </button>
          <button
            onClick={cancelRename}
            className="p-0.5 text-zinc-500 hover:text-zinc-300"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <span
          className={`flex-1 truncate ${isDir ? "text-orange-200" : "text-zinc-200"}`}
        >
          {entry.name}
        </span>
      )}

      {/* Size (files only, hidden while renaming) */}
      {!isRenaming && (
        <span className="text-xs text-zinc-500 w-16 text-right shrink-0">
          {isDir ? "" : formatSize(entry.size)}
        </span>
      )}

      {/* Quick-action buttons (hover, hidden while renaming) */}
      {!isRenaming && (
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onStartRename(entry.name)}
            className="p-1 text-zinc-400 hover:text-orange-400 rounded"
            title="Rename"
          >
            <Pencil size={13} />
          </button>
          {!isDir && (
            <button
              onClick={() => download(entry.name)}
              className="p-1 text-zinc-400 hover:text-blue-400 rounded"
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

// ── FileList ──────────────────────────────────────────────────────────────────

export function FileList() {
  const { entries, isLoading, currentPath } = useFlipperStore();
  const { download, remove } = useStorage();

  const [renamingName, setRenamingName] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1 gap-2 text-zinc-500">
        <Spinner size={16} />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-zinc-600 text-sm">
        {currentPath === "/" ? "No files" : "Empty directory"}
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {/* Column header */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-700 bg-zinc-900/60 text-xs text-zinc-500 sticky top-0">
          <span className="w-4 shrink-0" />
          <span className="flex-1">Name</span>
          <span className="w-16 text-right shrink-0">Size</span>
          <span className="w-14 shrink-0" />
        </div>
        {entries.map((e) => (
          <FileRow
            key={e.name}
            entry={e}
            isRenaming={renamingName === e.name}
            onStartRename={setRenamingName}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Context menu portal — rendered outside the list so it can overflow */}
      {contextMenu && (
        <ContextMenu
          {...contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => setRenamingName(contextMenu.entry.name)}
          onDownload={() => download(contextMenu.entry.name)}
          onDelete={() => remove(contextMenu.entry.name, contextMenu.entry.file_type === 1)}
        />
      )}
    </>
  );
}
