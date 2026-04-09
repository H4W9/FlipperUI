import { useRef, useState } from "react";
import { Upload, FolderPlus, RefreshCw, Check, X } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";

export function Toolbar() {
  const { currentPath, isLoading } = useFlipperStore();
  const { upload, mkdir, refresh } = useStorage();

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startCreate = () => {
    setFolderName("");
    setCreatingFolder(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const confirmCreate = async () => {
    const name = folderName.trim();
    setCreatingFolder(false);
    setFolderName("");
    if (name) await mkdir(name);
  };

  const cancelCreate = () => {
    setCreatingFolder(false);
    setFolderName("");
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-700/60 bg-gray-900/30 min-h-[34px]">
      <button
        onClick={upload}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded transition-colors shrink-0"
      >
        <Upload size={13} />
        Upload
      </button>

      {creatingFolder ? (
        /* Inline folder-name input */
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmCreate();
              if (e.key === "Escape") cancelCreate();
            }}
            placeholder="Folder name…"
            className="w-36 px-2 py-0.5 text-xs bg-gray-800 border border-orange-500/60 text-gray-100 rounded outline-none focus:border-orange-400"
          />
          <button
            onClick={confirmCreate}
            className="p-1 text-green-400 hover:text-green-300 rounded"
            title="Create"
          >
            <Check size={13} />
          </button>
          <button
            onClick={cancelCreate}
            className="p-1 text-gray-500 hover:text-gray-300 rounded"
            title="Cancel"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded transition-colors shrink-0"
        >
          <FolderPlus size={13} />
          New Folder
        </button>
      )}

      <div className="flex-1" />
      <span className="text-xs text-gray-500 font-mono truncate max-w-xs">{currentPath}</span>
      <button
        onClick={() => refresh(currentPath)}
        disabled={isLoading}
        className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-40 rounded transition-colors shrink-0"
        title="Refresh"
      >
        <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
