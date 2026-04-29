/**
 * Path helpers shared across library views.
 *
 * Flipper paths use forward slashes only (`/ext/...`); a few helpers also
 * tolerate Windows-style separators because some local-filesystem inputs
 * (drag-drop file paths) flow through the same code on Windows hosts.
 */

export function basename(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * Returns the directory of `path` relative to `root`. `/ext/nfc/foo/x.nfc`
 * under root `/ext/nfc` returns `"foo"`; a file directly under the root
 * returns `""`. Returns `""` if `path` doesn't sit under `root`.
 */
export function relativeDir(path: string, root: string): string {
  const prefix = root.replace(/\/$/, "") + "/";
  if (!path.startsWith(prefix)) return "";
  const rest = path.slice(prefix.length);
  const idx = rest.lastIndexOf("/");
  return idx < 0 ? "" : rest.slice(0, idx);
}

/**
 * Parent directory of `path` (no trailing slash). Returns `"/"` for top-level
 * files. Used as the basis for path-rebuilding on rename/duplicate.
 */
export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

/**
 * Pick the next free `"<name> N.<ext>"` filename for a duplicate. Strips an
 * existing trailing " N" so duplicating a duplicate doesn't stack suffixes.
 * Falls back to `"<name> copy.<ext>"` if 10 000 collisions can't be resolved.
 */
export function nextDuplicateName(name: string, existing: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const stripped = base.replace(/ \d+$/, "");
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stripped} ${n}${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stripped} copy${ext}`;
}
