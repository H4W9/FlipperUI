import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderTree,
  Nfc,
  Radio,
  Search,
  Usb,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useFlipperStore, type ActiveView } from "../../store/useFlipperStore";
import { relativeDir } from "../../lib/path";
import rfidIconUrl from "../../assets/icons/125.svg";

const MAX_RESULTS_PER_GROUP = 6;
const MAX_TOTAL_RESULTS = 30;

interface SearchHit {
  id: string;
  view: ActiveView;
  groupLabel: string;
  Icon: LucideIcon | null;
  iconSvg?: string;
  name: string;
  /** Secondary line (path / category / freq / kind, depending on library). */
  detail: string;
  /** Raw lowercased haystack used for substring scoring. */
  haystack: string;
}

export function GlobalSearch() {
  const setActiveView = useFlipperStore((s) => s.setActiveView);
  const setInjection = useFlipperStore((s) => s.setLibrarySearchInjection);
  const subghz = useFlipperStore((s) => s.subghzEntries);
  const ir = useFlipperStore((s) => s.irEntries);
  const nfc = useFlipperStore((s) => s.nfcEntries);
  const rfid = useFlipperStore((s) => s.rfidEntries);
  const badusb = useFlipperStore((s) => s.badusbEntries);
  const apps = useFlipperStore((s) => s.appEntries);
  const fileEntries = useFlipperStore((s) => s.entries);
  const currentPath = useFlipperStore((s) => s.currentPath);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const expand = () => {
    setExpanded(true);
    // Defer focus to next tick so the input is mounted before we focus it.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const collapse = () => {
    setOpen(false);
    setExpanded(false);
    setQuery("");
    inputRef.current?.blur();
  };

  // Close the dropdown on click-outside or Escape, and collapse the input if
  // it's empty so the header reclaims the space.
  useEffect(() => {
    if (!open && !expanded) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        if (!query) setExpanded(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, expanded, query]);

  // Cmd/Ctrl+F focuses the global search bar (matches the user's mental model
  // of "find" without colliding with ⌘K which opens the command palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        expand();
        if (query) setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    const pushFrom = <T,>(
      collection: T[],
      view: ActiveView,
      groupLabel: string,
      Icon: LucideIcon | null,
      iconSvg: string | undefined,
      name: (e: T) => string,
      detail: (e: T) => string,
      extraHaystack: (e: T) => string,
      idKey: (e: T) => string,
    ) => {
      let added = 0;
      for (const e of collection) {
        const hayName = name(e).toLowerCase();
        const hayDetail = detail(e).toLowerCase();
        const hayExtra = extraHaystack(e).toLowerCase();
        const hay = `${hayName} ${hayDetail} ${hayExtra}`;
        if (!hay.includes(q)) continue;
        hits.push({
          id: `${view}:${idKey(e)}`,
          view,
          groupLabel,
          Icon,
          iconSvg,
          name: name(e),
          detail: detail(e),
          haystack: hay,
        });
        added += 1;
        if (added >= MAX_RESULTS_PER_GROUP) break;
      }
    };

    pushFrom(
      apps,
      "apps",
      "Apps",
      Zap,
      undefined,
      (e) => e.name,
      (e) => e.category ?? (relativeDir(e.path, e.root) || e.path),
      (e) => `${e.path} ${e.category ?? ""}`,
      (e) => e.path,
    );
    pushFrom(
      subghz,
      "subghz",
      "Sub-GHz",
      Radio,
      undefined,
      (e) => e.name,
      (e) =>
        [
          e.frequency != null ? `${(e.frequency / 1_000_000).toFixed(2)} MHz` : null,
          e.protocol,
          e.preset,
        ]
          .filter(Boolean)
          .join(" • ") || e.path,
      (e) => `${e.path} ${e.protocol ?? ""} ${e.preset ?? ""} ${e.key ?? ""}`,
      (e) => e.path,
    );
    pushFrom(
      ir,
      "infrared",
      "Infrared",
      Zap,
      undefined,
      (e) => e.name,
      (e) =>
        e.signals.length > 0
          ? `${e.signals.length} signal${e.signals.length === 1 ? "" : "s"}`
          : e.path,
      (e) => `${e.path} ${e.signals.map((s) => s.name).join(" ")}`,
      (e) => e.path,
    );
    pushFrom(
      nfc,
      "nfc",
      "NFC",
      Nfc,
      undefined,
      (e) => e.name,
      (e) =>
        [e.device_type, e.uid, e.mifare_type].filter(Boolean).join(" • ") ||
        e.path,
      (e) => `${e.path} ${e.uid ?? ""} ${e.device_type ?? ""}`,
      (e) => e.path,
    );
    pushFrom(
      rfid,
      "rfid",
      "RFID",
      null,
      rfidIconUrl,
      (e) => e.name,
      (e) =>
        [e.key_type, e.data].filter(Boolean).join(" • ") || e.path,
      (e) => `${e.path} ${e.data ?? ""} ${e.key_type ?? ""}`,
      (e) => e.path,
    );
    pushFrom(
      badusb,
      "badusb",
      "BadUSB",
      Usb,
      undefined,
      (e) => e.name,
      (e) =>
        [
          e.kind === "kb" ? "BadKB" : "BadUSB",
          `${e.line_count} line${e.line_count === 1 ? "" : "s"}`,
          e.comment,
        ]
          .filter(Boolean)
          .join(" • "),
      (e) => `${e.path} ${e.comment ?? ""}`,
      (e) => e.path,
    );

    // File browser: only the currently-loaded directory is indexed (the
    // backend doesn't ship a recursive file index). Surface those hits with a
    // "Files (current dir)" label so the limited scope is obvious.
    {
      let added = 0;
      for (const e of fileEntries) {
        if (!e.name.toLowerCase().includes(q)) continue;
        hits.push({
          id: `files:${currentPath}/${e.name}`,
          view: "files",
          groupLabel: "Files (current dir)",
          Icon: FolderTree,
          name: e.name,
          detail: currentPath,
          haystack: `${e.name} ${currentPath}`.toLowerCase(),
        });
        added += 1;
        if (added >= MAX_RESULTS_PER_GROUP) break;
      }
    }

    // Rank "starts-with" hits ahead of mid-string hits, then break ties by
    // group order (already encoded by insertion above).
    hits.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    });

    return hits.slice(0, MAX_TOTAL_RESULTS);
  }, [query, subghz, ir, nfc, rfid, badusb, apps, fileEntries, currentPath]);

  // Snap the selection back to the top whenever the result set changes — keeps
  // Enter from firing a stale, out-of-range item.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  const select = (hit: SearchHit) => {
    if (hit.view === "files") {
      // Files don't support an injected query (the FileBrowser's filter is
      // local to FileList); just navigate to the view so the user lands where
      // the match lives.
      setActiveView("files");
    } else {
      setActiveView(hit.view);
      setInjection({ view: hit.view, query });
    }
    collapse();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
    } else if (e.key === "Enter") {
      const hit = results[activeIdx];
      if (hit) {
        e.preventDefault();
        select(hit);
      }
    } else if (e.key === "Escape") {
      collapse();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={expand}
        aria-label="Search"
        title="Search (⌘F)"
        className={`flex items-center justify-center p-1.5 rounded text-muted hover:text-primary hover:bg-surface transition-colors ${
          expanded ? "invisible" : ""
        }`}
      >
        <Search size={14} />
      </button>

      {expanded && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-1 px-2 py-1 rounded bg-surface border border-elevated focus-within:border-accent transition-colors w-48 shadow-lg">
          <Search size={13} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => query && setOpen(true)}
            onBlur={() => {
              if (!query) setExpanded(false);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            className="flex-1 min-w-0 bg-transparent text-xs text-primary placeholder:text-muted outline-none"
          />
        </div>
      )}

      {expanded && open && query && (
        <div className="absolute right-0 top-full mt-1 w-[min(420px,80vw)] max-h-[60vh] overflow-y-auto bg-panel border border-border-subtle rounded-lg shadow-2xl z-50">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-dim">
              No matches found.
            </div>
          ) : (
            <Grouped results={results} activeIdx={activeIdx} onSelect={select} onHover={setActiveIdx} />
          )}
        </div>
      )}
    </div>
  );
}

function Grouped({
  results,
  activeIdx,
  onSelect,
  onHover,
}: {
  results: SearchHit[];
  activeIdx: number;
  onSelect: (hit: SearchHit) => void;
  onHover: (idx: number) => void;
}) {
  // Group while preserving the global activeIdx (which is into the flat list).
  const groups: { label: string; items: { hit: SearchHit; flatIdx: number }[] }[] = [];
  results.forEach((hit, flatIdx) => {
    const last = groups[groups.length - 1];
    if (last && last.label === hit.groupLabel) {
      last.items.push({ hit, flatIdx });
    } else {
      groups.push({ label: hit.groupLabel, items: [{ hit, flatIdx }] });
    }
  });

  return (
    <div className="py-1">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
            {g.label}
          </div>
          {g.items.map(({ hit, flatIdx }) => (
            <Row
              key={hit.id}
              hit={hit}
              active={flatIdx === activeIdx}
              onMouseEnter={() => onHover(flatIdx)}
              onClick={() => onSelect(hit)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Row({
  hit,
  active,
  onMouseEnter,
  onClick,
}: {
  hit: SearchHit;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const Icon = hit.Icon;
  return (
    <div
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded cursor-pointer text-xs ${
        active ? "bg-surface text-primary" : "text-secondary hover:text-primary"
      }`}
    >
      {Icon ? (
        <Icon size={13} className="text-accent shrink-0" />
      ) : hit.iconSvg ? (
        <img src={hit.iconSvg} alt="" className="w-[13px] h-[13px] shrink-0" />
      ) : (
        <span className="w-[13px] h-[13px] shrink-0" />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="truncate text-primary">{hit.name}</span>
        <span className="truncate text-[10px] text-dim">{hit.detail}</span>
      </div>
    </div>
  );
}
