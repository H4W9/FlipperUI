import { useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  storageList,
  storageReadToLocal,
  storageWriteFromLocal,
  storageMkdir,
  storageDelete,
  storageRename,
} from "../lib/tauri";
import { joinPath } from "../lib/encoding";
import { basename } from "../lib/path";
import { notify } from "../lib/notify";
import { useFlipperStore } from "../store/useFlipperStore";

export function useStorage() {
  const setEntries = useFlipperStore((s) => s.setEntries);
  const setLoading = useFlipperStore((s) => s.setLoading);
  const setError = useFlipperStore((s) => s.setError);
  const setTransferProgress = useFlipperStore((s) => s.setTransferProgress);

  const refresh = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const entries = await storageList(path);
      entries.sort((a, b) => {
        if (a.file_type !== b.file_type) return b.file_type - a.file_type;
        return a.name.localeCompare(b.name);
      });
      setEntries(entries);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [setEntries, setLoading, setError]);

  const download = useCallback(async (name: string) => {
    const currentPath = useFlipperStore.getState().currentPath;
    const remotePath = joinPath(currentPath, name);
    let unlisten: (() => void) | undefined;
    let failed = false;
    try {
      const savePath = await save({ defaultPath: name });
      if (!savePath) return;

      setTransferProgress(0);

      unlisten = await listen<number>("download-progress", (event) => {
        setTransferProgress(event.payload);
      });

      await storageReadToLocal(remotePath, savePath);
      setTransferProgress(100);
      void notify("Download complete", name);
    } catch (e: unknown) {
      failed = true;
      const msg = String(e);
      if (!msg.includes("Transfer cancelled")) {
        setError(msg);
      }
    } finally {
      unlisten?.();
      if (failed) {
        setTransferProgress(null);
      } else {
        setTimeout(() => setTransferProgress(null), 600);
      }
    }
  }, [setError, setTransferProgress]);

  // `destDir` lets a drop target (folder row) upload into a path that isn't
  // the currently-shown directory. Defaults to currentPath for normal uploads.
  const uploadFile = useCallback(async (localPath: string, destDir?: string) => {
    const currentPath = useFlipperStore.getState().currentPath;
    const dir = destDir ?? currentPath;
    let unlisten: (() => void) | undefined;
    let failed = false;
    try {
      const fileName = basename(localPath) || "file";
      const remotePath = joinPath(dir, fileName);

      setTransferProgress(0);

      unlisten = await listen<number>("upload-progress", (event) => {
        setTransferProgress(event.payload);
      });

      await storageWriteFromLocal(remotePath, localPath);

      // Only refresh the visible listing when the upload landed there;
      // otherwise the user is still looking at currentPath and we'd flicker.
      if (dir === currentPath) await refresh(currentPath);
      void notify("Upload complete", basename(localPath) || "file");
    } catch (e: unknown) {
      failed = true;
      const msg = String(e);
      if (!msg.includes("Transfer cancelled")) {
        setError(msg);
      }
    } finally {
      unlisten?.();
      if (failed) {
        setTransferProgress(null);
      } else {
        setTimeout(() => setTransferProgress(null), 600);
      }
    }
  }, [setError, setTransferProgress, refresh]);

  const upload = useCallback(async () => {
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const path of paths) {
      await uploadFile(path);
    }
  }, [uploadFile]);

  const mkdir = useCallback(async (name: string) => {
    const currentPath = useFlipperStore.getState().currentPath;
    const path = joinPath(currentPath, name);
    try {
      await storageMkdir(path);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [setError, refresh]);

  const rename = useCallback(async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const currentPath = useFlipperStore.getState().currentPath;
    const oldPath = joinPath(currentPath, oldName);
    const newPath = joinPath(currentPath, newName.trim());
    try {
      await storageRename(oldPath, newPath);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [setError, refresh]);

  const remove = useCallback(async (name: string, isDir: boolean) => {
    const currentPath = useFlipperStore.getState().currentPath;
    const path = joinPath(currentPath, name);
    try {
      await storageDelete(path, isDir);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [setError, refresh]);

  return { refresh, download, upload, uploadFile, mkdir, rename, remove };
}
