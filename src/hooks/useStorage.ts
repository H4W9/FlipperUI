import { listen } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  storageList,
  storageRead,
  storageWrite,
  storageMkdir,
  storageDelete,
  storageRename,
} from "../lib/tauri";
import { useFlipperStore } from "../store/useFlipperStore";

function joinPath(base: string, name: string): string {
  if (base === "/") return "/" + name;
  return base.replace(/\/$/, "") + "/" + name;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Process in chunks to avoid call-stack overflows on large files
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useStorage() {
  const {
    currentPath,
    setEntries,
    setLoading,
    setError,
    setTransferProgress,
  } = useFlipperStore();

  const refresh = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const entries = await storageList(path);
      // Directories first, then alphabetical within each group
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
  };

  const download = async (name: string) => {
    const remotePath = joinPath(currentPath, name);
    try {
      const savePath = await save({ defaultPath: name });
      if (!savePath) return;

      setTransferProgress(0);
      const b64 = await storageRead(remotePath);
      setTransferProgress(80);
      await writeFile(savePath, base64ToUint8Array(b64));
      setTransferProgress(100);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setTimeout(() => setTransferProgress(null), 600);
    }
  };

  const upload = async () => {
    // Listen for chunk-level progress events emitted by the Rust storage_write command
    let unlisten: (() => void) | undefined;
    try {
      const selected = await open({ multiple: false });
      if (!selected) return;

      const localPath = selected as string;
      const localBytes = await readFile(localPath);
      const fileName = localPath.split("/").pop() ?? "file";
      const remotePath = joinPath(currentPath, fileName);

      setTransferProgress(0);

      // Subscribe before invoking so we don't miss early events
      unlisten = await listen<number>("upload-progress", (event) => {
        setTransferProgress(event.payload);
      });

      const b64 = uint8ArrayToBase64(localBytes);
      await storageWrite(remotePath, b64);

      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      unlisten?.();
      setTimeout(() => setTransferProgress(null), 600);
    }
  };

  const mkdir = async (name: string) => {
    const path = joinPath(currentPath, name);
    try {
      await storageMkdir(path);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const rename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const oldPath = joinPath(currentPath, oldName);
    const newPath = joinPath(currentPath, newName.trim());
    try {
      await storageRename(oldPath, newPath);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const remove = async (name: string, isDir: boolean) => {
    const path = joinPath(currentPath, name);
    try {
      await storageDelete(path, isDir);
      await refresh(currentPath);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  return { refresh, download, upload, mkdir, rename, remove };
}
