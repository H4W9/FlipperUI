import { useEffect, useRef, useState } from "react";
import { storageList } from "./tauri";
import { useFlipperStore } from "../store/useFlipperStore";

function parentOf(draft: string, fallback: string): string {
  const trimmed = draft.replace(/\/+$/, "");
  if (!trimmed) return fallback;
  if (draft.endsWith("/")) return trimmed;
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) return fallback;
  return trimmed.slice(0, lastSlash);
}

function isFlipperPath(p: string): boolean {
  return (
    p === "/ext" ||
    p === "/int" ||
    p === "/any" ||
    p.startsWith("/ext/") ||
    p.startsWith("/int/") ||
    p.startsWith("/any/")
  );
}

/**
 * Feeds a `<datalist>` for path inputs: lists subdirectories of whatever parent
 * directory the user has typed so far. As the draft grows one level deeper the
 * hook re-fetches; results are cached in-memory per-session so typing forwards
 * and backwards through a path doesn't re-hammer the serial port.
 *
 * Returns `[]` when disconnected, when the parent is outside `/ext|/int|/any`,
 * or when `storage_list` fails (e.g. parent doesn't exist yet).
 */
export function useDirectorySuggestions(
  draft: string,
  fallbackRoot: string,
  opts: { exclude?: string[] } = {},
): string[] {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const cacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!isConnected) {
      setSuggestions([]);
      return;
    }
    const parent = parentOf(draft, fallbackRoot);
    if (!isFlipperPath(parent)) {
      setSuggestions([]);
      return;
    }
    const cached = cacheRef.current.get(parent);
    if (cached) {
      setSuggestions(cached);
      return;
    }
    let cancelled = false;
    storageList(parent)
      .then((entries) => {
        if (cancelled) return;
        const dirs = entries
          .filter((e) => e.file_type === 1)
          .map((e) => `${parent}/${e.name}`);
        cacheRef.current.set(parent, dirs);
        setSuggestions(dirs);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, fallbackRoot, isConnected]);

  if (opts.exclude && opts.exclude.length > 0) {
    const excl = new Set(opts.exclude);
    return suggestions.filter((s) => !excl.has(s));
  }
  return suggestions;
}
