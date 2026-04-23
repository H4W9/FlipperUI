import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AlertTriangle, Nfc, Upload } from "lucide-react";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useFlipperStore } from "../../store/useFlipperStore";
import { nfcCancelScan, nfcScan, storageWrite } from "../../lib/tauri";
import { loadSettings, subscribeSettings } from "../../lib/settings";
import { loadNfcCache, saveNfcCache } from "../../lib/nfcCache";
import { uint8ArrayToBase64 } from "../../lib/encoding";
import { LibraryToolbar } from "./LibraryToolbar";
import { LibraryTable } from "./LibraryTable";
import type { NfcScanProgress } from "../../types/nfc";

const NFC_ROOT = "/ext/nfc";

export function NfcLibrary() {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);
  const entries = useFlipperStore((s) => s.nfcEntries);
  const scanning = useFlipperStore((s) => s.nfcScanning);
  const error = useFlipperStore((s) => s.nfcError);
  const setEntries = useFlipperStore((s) => s.setNfcEntries);
  const setScanning = useFlipperStore((s) => s.setNfcScanning);
  const setProgress = useFlipperStore((s) => s.setNfcProgress);
  const setError = useFlipperStore((s) => s.setNfcError);

  const [excludedDirs, setExcludedDirs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<string | null>(null);
  const [cacheScannedAt, setCacheScannedAt] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState<number>(0);

  useEffect(() => {
    loadSettings().then((s) => setExcludedDirs(s.nfc.excludedDirs));
    return subscribeSettings((s) => setExcludedDirs(s.nfc.excludedDirs));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<NfcScanProgress>("nfc-scan-progress", (e) =>
      setProgress(e.payload),
    ).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [setProgress]);

  // Rehydrate from disk on every deviceUid change — swaps in the new device's
  // cache (or clears, if it has never been scanned) so entries from a prior
  // device don't linger after reconnect to a different one.
  useEffect(() => {
    if (!deviceUid) return;
    let cancelled = false;
    loadNfcCache(deviceUid).then((cache) => {
      if (cancelled) return;
      setCacheScannedAt(cache?.scannedAt ?? null);
      setEntries(cache?.entries ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceUid, setEntries]);

  const runScan = useCallback(async () => {
    if (scanning) return;
    setError(null);
    setScanning(true);
    setProgress({ scanned: 0, total: 0, current_path: "" });
    try {
      const list = await nfcScan(NFC_ROOT, excludedDirs, entries);
      setEntries(list);
      if (deviceUid) {
        await saveNfcCache(deviceUid, list).catch(() => {});
        setCacheScannedAt(Date.now());
      }
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (!msg.toLowerCase().includes("cancelled")) {
        setError(`Scan failed: ${msg}`);
      }
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [
    scanning,
    setError,
    setScanning,
    setProgress,
    excludedDirs,
    entries,
    setEntries,
    deviceUid,
  ]);

  const cancelScan = async () => {
    try {
      await nfcCancelScan();
    } catch {
      /* fine */
    }
  };

  const uploadOne = useCallback(async (localPath: string) => {
    const name = localPath.split("/").pop() ?? "";
    if (!name.toLowerCase().endsWith(".nfc")) {
      throw new Error(`"${name}" is not a .nfc file`);
    }
    const remotePath = `${NFC_ROOT}/${name}`;
    const bytes = await readFile(localPath);
    const b64 = uint8ArrayToBase64(bytes);
    await storageWrite(remotePath, b64);
  }, []);

  const uploadMany = useCallback(
    async (paths: string[]) => {
      if (!isConnected) {
        setError("Connect a Flipper to upload .nfc files.");
        return;
      }
      const nfcs = paths.filter((p) => p.toLowerCase().endsWith(".nfc"));
      if (nfcs.length === 0) {
        setError("No .nfc files in the drop — nothing to upload.");
        return;
      }
      setUploadingCount(nfcs.length);
      setError(null);
      try {
        for (const p of nfcs) {
          await uploadOne(p);
        }
        await runScan();
      } catch (e) {
        setError(`Upload failed: ${(e as Error).message || String(e)}`);
      } finally {
        setUploadingCount(0);
      }
    },
    [uploadOne, runScan, setError, isConnected],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "enter") setIsDragOver(true);
        else if (event.payload.type === "leave") setIsDragOver(false);
        else if (event.payload.type === "drop") {
          setIsDragOver(false);
          void uploadMany(event.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [uploadMany]);

  const onUploadClick = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Flipper NFC cards", extensions: ["nfc"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await uploadMany(paths);
  };

  const deviceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.device_type) set.add(e.device_type);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (deviceTypeFilter && e.device_type !== deviceTypeFilter) return false;
      if (!q) return true;
      const haystack = [
        e.name,
        e.path,
        e.device_type ?? "",
        e.uid ?? "",
        e.mifare_type ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query, deviceTypeFilter]);

  // Browsable while disconnected — scan, upload, and drag-drop degrade below.

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <LibraryToolbar
        deviceTypes={deviceTypes}
        deviceTypeFilter={deviceTypeFilter}
        onDeviceTypeFilterChange={setDeviceTypeFilter}
        query={query}
        onQueryChange={setQuery}
        onRefresh={runScan}
        onCancel={cancelScan}
        onUpload={onUploadClick}
        uploadingCount={uploadingCount}
        total={entries.length}
        filtered={filtered.length}
        lastScannedAt={cacheScannedAt}
        isConnected={isConnected}
      />
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 border-b border-danger/30 text-xs text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-danger/70 hover:text-danger"
          >
            ×
          </button>
        </div>
      )}
      {entries.length === 0 && !scanning ? (
        <EmptyState onScan={runScan} />
      ) : (
        <LibraryTable entries={filtered} />
      )}

      {isDragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-app/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-8 py-6 border-2 border-dashed border-accent/60 rounded-xl">
            <Upload size={32} className="text-accent" />
            <span className="text-sm text-accent/80 font-medium">
              Drop .nfc files to upload to {NFC_ROOT}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
      <Nfc size={40} strokeWidth={1.5} className="text-elevated" />
      <p className="text-sm">No .nfc files indexed yet.</p>
      <button
        onClick={onScan}
        className="px-3 py-1.5 text-xs text-primary bg-accent/20 border border-accent/40 rounded hover:bg-accent/30"
      >
        Scan /ext/nfc
      </button>
    </div>
  );
}
