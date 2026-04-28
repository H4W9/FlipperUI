import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { storageWrite, storageWriteFromLocal } from "../lib/tauri";
import { uint8ArrayToBase64 } from "../lib/encoding";
import { basename } from "../lib/path";

export interface UseLibraryDropOptions {
  /** Absolute Flipper path to upload into (e.g. "/ext/nfc"). */
  rootPath: string;
  /** Lower-case extensions accepted (without dot, e.g. ["nfc"]). */
  extensions: string[];
  /** Whether a Flipper is currently connected — drops are rejected if not. */
  isConnected: boolean;
  /** Surface errors to the caller's UI. Called with null to clear. */
  setError: (msg: string | null) => void;
  /**
   * Called after a successful batch upload. Typical use is to re-run the
   * library scan so the freshly uploaded files appear without a manual refresh.
   */
  onAfterUpload?: () => void | Promise<void>;
  /**
   * Friendly name for dialog labels and error messages, e.g. "Flipper NFC
   * cards" → "No .nfc files in the drop". Defaults to `${exts} files`.
   */
  kindLabel?: string;
}

export interface DropZoneHandlers {
  onDragEnter: (e: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLElement>) => void;
}

export interface UseLibraryDropResult {
  /** True while files are being dragged over the drop zone. */
  isDragOver: boolean;
  /** Number of files currently being uploaded (0 when idle). */
  uploadingCount: number;
  /**
   * Open the OS file picker filtered to the configured extensions and upload
   * the selection. Wired to a toolbar "Upload…" button.
   */
  openFilePicker: () => Promise<void>;
  /**
   * Spread these onto a wrapping `<div>` that should act as the drop target.
   * Scoping the listeners to a specific element avoids interfering with the
   * outbound `@crabnebula/tauri-plugin-drag` drag-out from rows inside.
   */
  dropZoneHandlers: DropZoneHandlers;
}

function hasAcceptedExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * Drop-to-upload glue for library views. Returns drop-zone event handlers to
 * spread onto a wrapping `<div>` plus a file-picker for the toolbar. Both
 * paths route into the same `uploadMany` upload pipeline that base64-encodes
 * each file and ships it via `storageWrite` to `rootPath`.
 *
 * HTML5 drag events are used (the app sets `dragDropEnabled: false` so the
 * webview handles drag natively). Tauri's window-level `onDragDropEvent` is
 * deliberately avoided here — when active, it interferes with the outbound
 * drag plugin used by `useExportDrag` for row → Finder export.
 */
export function useLibraryDrop({
  rootPath,
  extensions,
  isConnected,
  setError,
  onAfterUpload,
  kindLabel,
}: UseLibraryDropOptions): UseLibraryDropResult {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  // dragenter/dragleave fire for every nested element transition. Counting
  // entries vs. leaves on a single ref keeps the overlay stable while moving
  // between child elements inside the drop zone.
  const enterDepthRef = useRef(0);

  const exts = useMemo(
    () => extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
    [extensions],
  );
  const dotList = useMemo(() => exts.map((e) => `.${e}`).join("/"), [exts]);
  const label = useMemo(
    () => kindLabel ?? `${dotList} files`,
    [dotList, kindLabel],
  );

  const uploadFromPaths = useCallback(
    async (paths: string[]) => {
      if (!isConnected) {
        setError(`Connect a Flipper to upload ${dotList} files.`);
        return;
      }
      const accepted = paths.filter((p) => hasAcceptedExt(basename(p), exts));
      if (accepted.length === 0) {
        setError(`No ${dotList} files in the drop — nothing to upload.`);
        return;
      }
      setUploadingCount(accepted.length);
      setError(null);
      try {
        for (const p of accepted) {
          const name = basename(p);
          const remotePath = `${rootPath}/${name}`;
          await storageWriteFromLocal(remotePath, p);
        }
        if (onAfterUpload) await onAfterUpload();
      } catch (e) {
        setError(`Upload failed: ${(e as Error).message || String(e)}`);
      } finally {
        setUploadingCount(0);
      }
    },
    [dotList, exts, isConnected, onAfterUpload, rootPath, setError],
  );

  const uploadFromDataTransfer = useCallback(
    async (files: FileList) => {
      if (!isConnected) {
        setError(`Connect a Flipper to upload ${dotList} files.`);
        return;
      }
      const accepted = Array.from(files).filter((f) =>
        hasAcceptedExt(f.name, exts),
      );
      if (accepted.length === 0) {
        setError(`No ${dotList} files in the drop — nothing to upload.`);
        return;
      }
      setUploadingCount(accepted.length);
      setError(null);
      try {
        for (const f of accepted) {
          const remotePath = `${rootPath}/${f.name}`;
          const buf = new Uint8Array(await f.arrayBuffer());
          await storageWrite(remotePath, uint8ArrayToBase64(buf));
        }
        if (onAfterUpload) await onAfterUpload();
      } catch (e) {
        setError(`Upload failed: ${(e as Error).message || String(e)}`);
      } finally {
        setUploadingCount(0);
      }
    },
    [dotList, exts, isConnected, onAfterUpload, rootPath, setError],
  );

  const dropZoneHandlers: DropZoneHandlers = {
    onDragEnter: (e) => {
      // Only react to file drags, not internal HTML element drags (which the
      // plugin's outbound row → Finder drag uses momentarily).
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      enterDepthRef.current += 1;
      setIsDragOver(true);
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      enterDepthRef.current = Math.max(0, enterDepthRef.current - 1);
      if (enterDepthRef.current === 0) setIsDragOver(false);
    },
    onDrop: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      enterDepthRef.current = 0;
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        void uploadFromDataTransfer(e.dataTransfer.files);
      }
    },
  };

  // Reset overlay state when the consumer unmounts, just in case a drag was
  // in progress and we never saw a leave/drop.
  useEffect(() => {
    return () => {
      enterDepthRef.current = 0;
    };
  }, []);

  const openFilePicker = useCallback(async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: label, extensions: exts }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await uploadFromPaths(paths);
  }, [exts, label, uploadFromPaths]);

  // Keep `getCurrentWebviewWindow` referenced so tree-shakers don't drop it —
  // we may need it for future fallbacks. (No active subscription here on
  // purpose; see module-level comment.)
  void getCurrentWebviewWindow;

  return { isDragOver, uploadingCount, openFilePicker, dropZoneHandlers };
}
