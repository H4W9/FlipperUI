import { useEffect, useState, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { Toolbar } from "./Toolbar";
import { FileList } from "./FileList";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";
import { cancelTransfer } from "../../lib/tauri";
import { ProgressBar } from "../ui/ProgressBar";
import { ErrorBanner } from "../ui/ErrorBanner";
import { Upload } from "lucide-react";

export function FileBrowser() {
  const { currentPath, transferProgress } = useFlipperStore();
  const { refresh, uploadFile } = useStorage();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleCancelTransfer = useCallback(() => {
    cancelTransfer().catch(() => {});
  }, []);

  // Load root directory on mount
  useEffect(() => {
    refresh(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for native file drag-and-drop events
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === "enter") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        (async () => {
          for (const path of paths) {
            await uploadFile(path);
          }
        })();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [uploadFile]);

  return (
    <div className="flex flex-col h-full relative">
      <ErrorBanner />
      <BreadcrumbBar />
      <Toolbar />
      <FileList />
      {transferProgress !== null && (
        <ProgressBar value={transferProgress} onCancel={handleCancelTransfer} />
      )}

      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-app/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-8 py-6 border-2 border-dashed border-accent/60 rounded-xl">
            <Upload size={32} className="text-accent" />
            <span className="text-sm text-accent/80 font-medium">Drop files to upload</span>
          </div>
        </div>
      )}
    </div>
  );
}
