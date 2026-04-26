import { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, RefreshCw } from "lucide-react";
import { storageList } from "../../lib/tauri";
import { useFlipperStore } from "../../store/useFlipperStore";
import type { FileEntry } from "../../types/flipper";
import { Spinner } from "../ui/Spinner";
import { DeviceSettingsModal } from "./DeviceSettingsModal";

const INT_PATH = "/int";
// Anything bigger than this we treat as "probably not a settings file" — keeps
// the dashboard list focused and the editor responsive.
const MAX_BYTES = 64 * 1024;

interface SettingsFile {
  name: string;
  path: string;
  size: number;
}

export function DeviceSettingsCard() {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const [files, setFiles] = useState<SettingsFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected) {
      setFiles(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await storageList(INT_PATH);
      const viable = list.filter(isViableSettingsFile).map((e) => ({
        name: e.name,
        path: `${INT_PATH}/${e.name}`,
        size: e.size,
      }));
      viable.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(viable);
    } catch (e) {
      setFiles([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <section className="flex flex-col bg-panel/60 border border-border-subtle rounded-lg p-4 min-h-[160px]">
        <div className="flex items-center gap-1.5 mb-3 text-primary">
          <SettingsIcon size={14} className="text-accent" />
          <h3 className="text-sm font-semibold flex-1">Flipper settings</h3>
          <button
            onClick={() => void refresh()}
            disabled={!isConnected || loading}
            title="Rescan /int"
            className="p-1 text-secondary hover:text-primary rounded hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex-1 flex flex-col">
          {!isConnected ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-dim">
              Connect a device to view settings
            </div>
          ) : loading && !files ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-[11px] text-dim">
              <Spinner size={12} /> Scanning /int…
            </div>
          ) : error ? (
            <div className="text-[11px] text-danger">{error}</div>
          ) : !files || files.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-dim">
              No editable settings files found
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setOpenPath(f.path)}
                  className="flex flex-col items-start px-2.5 py-2 bg-surface hover:bg-elevated border border-border-subtle rounded text-left transition-colors min-w-0"
                  title={f.path}
                >
                  <span className="text-[11px] text-primary truncate w-full font-medium">
                    {prettyName(f.name)}
                  </span>
                  <span className="text-[10px] text-dim truncate w-full font-mono">
                    {f.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      {openPath && (
        <DeviceSettingsModal
          path={openPath}
          onClose={() => setOpenPath(null)}
        />
      )}
    </>
  );
}

function isViableSettingsFile(entry: FileEntry): boolean {
  if (entry.file_type !== 0) return false;
  const name = entry.name.toLowerCase();
  if (!name.endsWith(".txt")) return false;
  if (entry.size > MAX_BYTES) return false;
  return true;
}

function prettyName(name: string): string {
  // .desktop_keybinds.txt → Desktop Keybinds
  const stripped = name.replace(/^\.+/, "").replace(/\.txt$/i, "");
  return stripped
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
