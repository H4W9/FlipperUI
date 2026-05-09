/**
 * Unified editor for the per-library "excluded directories" lists.
 *
 * Replaces the six separate Sub-GHz / Infrared / NFC / RFID / BadUSB / Apps
 * editors with a single table where each row is `(library, path)`. The
 * underlying storage shape is unchanged — exclusions still live on the
 * per-library settings sub-objects — so existing settings.json files keep
 * working, and the Rust scanners continue to receive their per-library
 * arrays without any change.
 *
 * The component is intentionally self-contained: it reads the relevant
 * fields off `AppSettings`, produces flat rows for rendering, and on
 * mutation writes back to one library at a time via `updateSettings`. No
 * backend changes are needed.
 */
import { useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import type { AppSettings } from "../../lib/settings";
import { updateSettings } from "../../lib/settings";
import { useDirectorySuggestions } from "../../lib/useDirectorySuggestions";

/** Identifier of one of the six libraries that own an `excludedDirs` list. */
export type LibraryId = "subghz" | "infrared" | "nfc" | "rfid" | "badusb" | "apps";

/**
 * Per-library metadata: which roots the exclusion path must live under and
 * how to display the library in the chooser. Keeping all of this in one
 * place keeps the UI honest about each library's path rules without
 * duplicating validation logic across six editors.
 */
interface LibraryMeta {
  id: LibraryId;
  label: string;
  /** Allowed root prefixes. A path is valid if it lives under any one of
   *  these. Multiple roots only matter for BadUSB (badusb + badkb) and
   *  Apps (any /ext, /int, /any path). */
  roots: string[];
  /** Default placeholder shown in the path input — uses the first root. */
  placeholder: string;
}

const LIBRARIES: readonly LibraryMeta[] = [
  {
    id: "subghz",
    label: "Sub-GHz",
    roots: ["/ext/subghz"],
    placeholder: "/ext/subghz/private",
  },
  {
    id: "infrared",
    label: "Infrared",
    roots: ["/ext/infrared"],
    placeholder: "/ext/infrared/test",
  },
  {
    id: "nfc",
    label: "NFC",
    roots: ["/ext/nfc"],
    placeholder: "/ext/nfc/private",
  },
  {
    id: "rfid",
    label: "RFID",
    roots: ["/ext/lfrfid"],
    placeholder: "/ext/lfrfid/dev",
  },
  {
    id: "badusb",
    label: "BadUSB",
    roots: ["/ext/badusb", "/ext/badkb"],
    placeholder: "/ext/badusb/private",
  },
  {
    id: "apps",
    label: "Apps",
    roots: ["/ext", "/int", "/any"],
    placeholder: "/ext/apps/Examples",
  },
] as const;

/** Fast lookup for validation / placeholder rendering. */
const LIBRARY_BY_ID: Record<LibraryId, LibraryMeta> = LIBRARIES.reduce(
  (acc, lib) => {
    acc[lib.id] = lib;
    return acc;
  },
  {} as Record<LibraryId, LibraryMeta>,
);

/**
 * Read all per-library exclusion lists out of settings and flatten them
 * into a sorted array of rows. Sorting is stable per (library, path) so
 * that toggling one row doesn't reshuffle the table.
 */
function rowsFromSettings(settings: AppSettings): { lib: LibraryId; path: string }[] {
  const rows: { lib: LibraryId; path: string }[] = [];
  for (const meta of LIBRARIES) {
    const list = settings[meta.id].excludedDirs;
    for (const path of list) {
      rows.push({ lib: meta.id, path });
    }
  }
  return rows.sort((a, b) =>
    a.lib === b.lib ? a.path.localeCompare(b.path) : a.lib.localeCompare(b.lib),
  );
}

/**
 * Validate `path` against `meta.roots`. Returns `null` when the path is
 * acceptable, or an error string suitable for inline display otherwise.
 * Mirrors the rules in the legacy ExcludedDirsEditor + AbsoluteDirListEditor:
 *   - must start with one of the allowed roots (with a trailing `/` so
 *     `/ext/subghzextra` doesn't sneak in as a Sub-GHz exclusion)
 *   - cannot equal a root itself (excluding the entire scan root makes
 *     the library unscannable)
 *   - cannot contain `..` traversal
 */
function validatePath(path: string, meta: LibraryMeta): string | null {
  if (!path) return "Path is required";
  if (path.includes("..")) return "Path traversal (..) is not allowed";
  for (const root of meta.roots) {
    if (path === root) {
      return `Cannot exclude the scan root itself (${root})`;
    }
    if (path.startsWith(`${root}/`)) {
      return null;
    }
  }
  if (meta.roots.length === 1) {
    return `Path must start with ${meta.roots[0]}/`;
  }
  return `Path must start with one of: ${meta.roots.map((r) => `${r}/`).join(", ")}`;
}

export function LibraryExclusionsEditor({
  settings,
  disabled,
  onChange,
}: {
  settings: AppSettings | null;
  disabled?: boolean;
  /** Notified after a successful write so the parent can update its
   *  cached settings state in lockstep with the store. */
  onChange?: (next: AppSettings) => void;
}) {
  const rows = useMemo(
    () => (settings ? rowsFromSettings(settings) : []),
    [settings],
  );

  // Draft state for the "add a new exclusion" row. Held locally because
  // it's not worth round-tripping through tauri-plugin-store for a single
  // half-typed path.
  const [draftLib, setDraftLib] = useState<LibraryId>("subghz");
  const [draftPath, setDraftPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const datalistId = useId();

  // Autocomplete fed off the *first* root of the chosen library — the one
  // most users want. The user can still type a path under any of that
  // library's allowed roots; validation accepts all of them.
  const draftMeta = LIBRARY_BY_ID[draftLib];
  const suggestions = useDirectorySuggestions(draftPath, draftMeta.roots[0], {
    exclude: settings?.[draftLib].excludedDirs ?? [],
  });

  const isDisabled = disabled || !settings;

  /** Persist a new value of `excludedDirs` for one library only. */
  const writeLibrary = async (lib: LibraryId, nextList: string[]) => {
    const sorted = Array.from(new Set(nextList)).sort();
    const next = await updateSettings({ [lib]: { excludedDirs: sorted } });
    onChange?.(next);
  };

  const addDraft = async () => {
    if (!settings) return;
    const trimmed = draftPath.trim().replace(/\/+$/, "");
    const validationError = validatePath(trimmed, draftMeta);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (settings[draftLib].excludedDirs.includes(trimmed)) {
      setError("Already in the list");
      return;
    }
    setError(null);
    setDraftPath("");
    await writeLibrary(draftLib, [...settings[draftLib].excludedDirs, trimmed]);
  };

  const removeRow = async (lib: LibraryId, path: string) => {
    if (!settings) return;
    await writeLibrary(
      lib,
      settings[lib].excludedDirs.filter((p) => p !== path),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-dim">
        Folders listed here are skipped during the matching library&apos;s
        scan. Each row applies to one library; a folder excluded for one
        library is still scanned by the others.
      </p>

      {/* Add-row */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <select
            value={draftLib}
            disabled={isDisabled}
            onChange={(e) => {
              const nextLib = e.target.value as LibraryId;
              setDraftLib(nextLib);
              // Clearing the in-flight error makes the field feel
              // responsive when the user fixes a mismatch by changing
              // the library rather than the path.
              if (error) setError(null);
            }}
            className="bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-accent disabled:opacity-50"
            aria-label="Library"
          >
            {LIBRARIES.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.label}
              </option>
            ))}
          </select>

          <input
            value={draftPath}
            disabled={isDisabled}
            onChange={(e) => {
              setDraftPath(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addDraft();
              }
            }}
            placeholder={draftMeta.placeholder}
            list={datalistId}
            autoComplete="off"
            className="flex-1 bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent disabled:opacity-50 font-mono"
          />
          <datalist id={datalistId}>
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>

          <button
            type="button"
            onClick={() => void addDraft()}
            disabled={isDisabled || !draftPath.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <span className="text-[11px] text-dim italic">
          No exclusions. All library scans walk their full root.
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const meta = LIBRARY_BY_ID[row.lib];
            return (
              <li
                key={`${row.lib}::${row.path}`}
                className="flex items-center gap-2 px-2 py-1 bg-surface/50 border border-border-subtle rounded"
              >
                <span
                  className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-surface text-[10px] uppercase tracking-wide text-secondary border border-border-subtle"
                  title={`${meta.label} library`}
                >
                  {meta.label}
                </span>
                <code className="flex-1 text-xs text-secondary truncate">
                  {row.path}
                </code>
                <button
                  type="button"
                  onClick={() => void removeRow(row.lib, row.path)}
                  disabled={isDisabled}
                  aria-label={`Remove ${row.path} from ${meta.label}`}
                  className="p-0.5 text-muted hover:text-danger rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
