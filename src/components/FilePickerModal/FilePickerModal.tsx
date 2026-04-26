import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, File as FileIcon, Folder, X } from "lucide-react";
import { storageList } from "../../lib/tauri";
import type { FileEntry } from "../../types/flipper";
import { Spinner } from "../ui/Spinner";

interface FilePickerModalProps {
  title?: string;
  initialPath?: string;
  /** Optional predicate. Folders are always shown (so the user can navigate). */
  filter?: (entry: FileEntry) => boolean;
  /** Disallow picking a folder. Defaults to true (only files are pickable). */
  filesOnly?: boolean;
  onPick: (path: string) => void;
  onClose: () => void;
}

const SD_ROOTS = ["/ext", "/int"];

export function FilePickerModal({
  title = "Pick a file",
  initialPath = "/ext",
  filter,
  filesOnly = true,
  onPick,
  onClose,
}: FilePickerModalProps) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await storageList(p);
      list.sort((a, b) => {
        if (a.file_type !== b.file_type) return a.file_type === 1 ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(list);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(path);
    setSelected(null);
  }, [path, load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const goUp = () => {
    if (SD_ROOTS.includes(path)) return;
    const parent = path.substring(0, path.lastIndexOf("/")) || "/";
    setPath(parent === "" ? "/" : parent);
  };

  const segments = path === "/" ? [] : path.split("/").filter(Boolean);

  const visibleEntries = entries.filter((e) => {
    if (e.file_type === 1) return true;
    return filter ? filter(e) : true;
  });

  const confirm = () => {
    if (!selected) return;
    onPick(selected);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-border-subtle rounded-lg shadow-2xl w-full max-w-xl mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-primary flex-1 truncate">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 text-secondary hover:text-primary rounded hover:bg-elevated"
            title="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle bg-surface/40 text-[11px] text-secondary overflow-x-auto">
          <button
            onClick={goUp}
            disabled={SD_ROOTS.includes(path)}
            className="p-1 rounded hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed text-secondary hover:text-primary"
            title="Up one level"
          >
            <ArrowLeft size={12} />
          </button>
          <button
            onClick={() => setPath("/")}
            className="hover:text-primary px-1"
          >
            /
          </button>
          {segments.map((seg, i) => {
            const sub = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={sub} className="flex items-center gap-1">
                <ChevronRight size={10} />
                <button
                  onClick={() => setPath(sub)}
                  className="hover:text-primary"
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="p-6 flex items-center justify-center text-xs text-dim">
              <Spinner size={14} /> <span className="ml-2">Loading…</span>
            </div>
          ) : error ? (
            <div className="p-4 text-xs text-danger">{error}</div>
          ) : path === "/" ? (
            <ul>
              {SD_ROOTS.map((root) => (
                <li key={root}>
                  <button
                    onClick={() => setPath(root)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-primary hover:bg-elevated text-left"
                  >
                    <Folder size={14} className="text-accent" />
                    <span className="font-mono">{root}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : visibleEntries.length === 0 ? (
            <div className="p-6 text-center text-xs text-dim">Empty</div>
          ) : (
            <ul>
              {visibleEntries.map((entry) => {
                const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
                const isFolder = entry.file_type === 1;
                const isSelected = selected === fullPath;
                return (
                  <li key={fullPath}>
                    <button
                      onClick={() => {
                        if (isFolder) {
                          setPath(fullPath);
                        } else {
                          setSelected(fullPath);
                        }
                      }}
                      onDoubleClick={() => {
                        if (!isFolder && (!filesOnly || true)) {
                          onPick(fullPath);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-4 py-1.5 text-xs text-left hover:bg-elevated ${
                        isSelected ? "bg-accent/10 text-primary" : "text-secondary"
                      }`}
                    >
                      {isFolder ? (
                        <Folder size={13} className="text-accent shrink-0" />
                      ) : (
                        <FileIcon size={13} className="text-dim shrink-0" />
                      )}
                      <span className="truncate flex-1">{entry.name}</span>
                      {!isFolder && (
                        <span className="text-[10px] text-dim tabular-nums">
                          {formatBytes(entry.size)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle bg-surface/40">
          <span className="text-[11px] text-dim font-mono truncate flex-1">
            {selected ?? "No file selected"}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-surface text-secondary hover:text-primary hover:bg-elevated"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!selected}
            className="px-3 py-1.5 text-xs rounded font-medium bg-flipper text-black hover:bg-flipper/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Pick
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
