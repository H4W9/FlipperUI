import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RadioTower, AlertTriangle } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { subghzCancelScan, subghzScan } from "../../lib/tauri";
import { loadSettings, subscribeSettings } from "../../lib/settings";
import { loadSubghzCache, saveSubghzCache } from "../../lib/subghzCache";
import { LibraryToolbar } from "./LibraryToolbar";
import { LibraryTable } from "./LibraryTable";
import type { ScanProgress } from "../../types/subghz";

const SUBGHZ_ROOT = "/ext/subghz";

export function SubGhzLibrary() {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const deviceUid = useFlipperStore((s) => s.deviceInfo?.hardware_uid ?? null);
  const entries = useFlipperStore((s) => s.subghzEntries);
  const scanning = useFlipperStore((s) => s.subghzScanning);
  const error = useFlipperStore((s) => s.subghzError);
  const setEntries = useFlipperStore((s) => s.setSubghzEntries);
  const setScanning = useFlipperStore((s) => s.setSubghzScanning);
  const setProgress = useFlipperStore((s) => s.setSubghzProgress);
  const setError = useFlipperStore((s) => s.setSubghzError);

  const [excludedDirs, setExcludedDirs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<string | null>(null);
  const [cacheScannedAt, setCacheScannedAt] = useState<number | null>(null);

  // Pull excluded dirs from persisted settings so the scan honors them.
  useEffect(() => {
    loadSettings().then((s) => setExcludedDirs(s.subghz.excludedDirs));
    return subscribeSettings((s) => setExcludedDirs(s.subghz.excludedDirs));
  }, []);

  // Stream scan progress events from the Rust side.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<ScanProgress>("subghz-scan-progress", (e) =>
      setProgress(e.payload),
    ).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [setProgress]);

  // Hydrate from the on-disk cache the moment we know which device we're on.
  // Gives instant render without waiting for a scan; only hydrate when the
  // in-memory list is empty so we don't clobber a fresher just-finished scan.
  useEffect(() => {
    if (!deviceUid) return;
    let cancelled = false;
    loadSubghzCache(deviceUid).then((cache) => {
      if (cancelled || !cache) return;
      setCacheScannedAt(cache.scannedAt);
      if (useFlipperStore.getState().subghzEntries.length === 0) {
        setEntries(cache.entries);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deviceUid, setEntries]);

  const runScan = async () => {
    if (scanning) return;
    setError(null);
    setScanning(true);
    setProgress({ scanned: 0, total: 0, current_path: "" });
    try {
      // Feed the current in-memory list (which was hydrated from disk) as
      // the cache hint — Rust skips reading any file whose mtime matches.
      const list = await subghzScan(SUBGHZ_ROOT, excludedDirs, entries);
      setEntries(list);
      if (deviceUid) {
        await saveSubghzCache(deviceUid, list).catch(() => {});
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
  };

  const cancelScan = async () => {
    try {
      await subghzCancelScan();
    } catch {
      /* fine — flag may have already been cleared */
    }
  };

  const protocols = useMemo(
    () => uniqueSorted(entries.map((e) => e.protocol).filter(Boolean) as string[]),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (protocolFilter && e.protocol !== protocolFilter) return false;
      if (!q) return true;
      const haystack = [e.name, e.protocol, e.preset, e.key, e.modulation]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query, protocolFilter]);

  if (!isConnected) {
    // SubGhzLibrary is only routed when connected, but guard anyway.
    return null;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <LibraryToolbar
        protocols={protocols}
        protocolFilter={protocolFilter}
        onProtocolFilterChange={setProtocolFilter}
        query={query}
        onQueryChange={setQuery}
        onRefresh={runScan}
        onCancel={cancelScan}
        total={entries.length}
        filtered={filtered.length}
        lastScannedAt={cacheScannedAt}
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
    </div>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
      <RadioTower size={40} strokeWidth={1.5} className="text-elevated" />
      <p className="text-sm">No .sub files indexed yet.</p>
      <button
        onClick={onScan}
        className="px-3 py-1.5 text-xs text-primary bg-accent/20 border border-accent/40 rounded hover:bg-accent/30"
      >
        Scan /ext/subghz
      </button>
    </div>
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
