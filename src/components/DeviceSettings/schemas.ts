/**
 * Per-file schemas for the device-settings editor.
 *
 * A schema turns a raw `key=value`-ish line into a typed `Field[]` (the
 * controls rendered in the modal) and back to text on save. When no schema
 * matches a filename, the editor falls back to the generic `kv` + `raw` rows.
 *
 * The set of schemas is intentionally small — just the well-known files
 * shipped with stock + Momentum firmware. Anything else still works via the
 * generic editor.
 */

export type FieldKind =
  | { type: "select"; options: { value: string; label: string }[] }
  | { type: "text"; placeholder?: string }
  | { type: "path"; placeholder?: string; pickerInitialPath?: string }
  | { type: "bool" }
  | { type: "label"; text: string };

export interface Field {
  /** Stable id within a line — we use it as the React key and to identify
   * which control was edited when re-serializing. */
  id: string;
  label?: string;
  /** Visual width hint; rendered with Tailwind classes. */
  width?: "sm" | "md" | "lg" | "flex";
  kind: FieldKind;
  value: string;
}

export interface StructuredLine {
  fields: Field[];
}

export interface FileSchema {
  /** Friendly title shown above the editor (optional, falls back to filename). */
  title?: string;
  /** Optional helper text rendered above the row list. */
  description?: string;
  /** Parse a single raw line. Return `null` to defer to the generic parser
   * (e.g. for comments / blank lines / lines that don't match the schema). */
  parseLine: (raw: string) => StructuredLine | null;
  /** Build a fresh blank row for the "Add line" button. */
  newLine: () => StructuredLine;
  /** Re-serialize a structured line to text. */
  serializeLine: (line: StructuredLine) => string;
}

// ── Known controls ─────────────────────────────────────────────────────────

const KEYBIND_KEYS: { value: string; label: string }[] = [
  { value: "DPad_Up", label: "▲ Up" },
  { value: "DPad_Down", label: "▼ Down" },
  { value: "DPad_Left", label: "◀ Left" },
  { value: "DPad_Right", label: "▶ Right" },
  { value: "Ok", label: "● OK" },
  { value: "Back", label: "↩ Back" },
];

const KEYBIND_TYPES: { value: string; label: string }[] = [
  { value: "Short", label: "Short press" },
  { value: "Long", label: "Long press" },
];

// Built-in keybind targets recognized by Momentum (everything else is treated
// as a free-form action — the picker lets users plug in a .fap path).
const KEYBIND_BUILTINS: string[] = [
  "Passport",
  "Lock Menu",
  "Wipe",
  "None",
];

// Bool-shaped keys we know about in `.momentum_settings.txt`. The list is
// non-exhaustive — unknown keys still render as plain text inputs.
const MOMENTUM_BOOL_KEYS = new Set<string>([
  "Lockscreen Auto Lock",
  "Lockscreen Transparent",
  "Lockscreen Pin Fast Unlock",
  "File Browser Show Hidden",
  "File Browser Show Internal",
  "Status Bar Battery Percent",
  "Status Bar Clock",
  "Bad BT Remember Last",
  "Bad USB Remember Last",
  "SubGHz Remember Last",
  "NFC Remember Last",
  "RFID Remember Last",
  "Infrared Remember Last",
  "iButton Remember Last",
  "Allow Locked RPC Commands",
  "Charge Cap",
  "Use Sounds",
  "Use Vibro",
]);

const TRUTHY = new Set(["true", "True", "TRUE", "1", "on", "On", "yes", "Yes"]);

function isBoolish(v: string): boolean {
  return TRUTHY.has(v) || ["false", "False", "FALSE", "0", "off", "Off", "no", "No"].includes(v);
}

function boolValue(v: string): "true" | "false" {
  return TRUTHY.has(v) ? "true" : "false";
}

// ── Schemas ────────────────────────────────────────────────────────────────

const desktopKeybindsSchema: FileSchema = {
  title: "Desktop keybinds",
  description:
    "Shortcuts triggered from the lockscreen / desktop. Pick a key + press style, then choose a built-in action or a `.fap` from the device.",
  parseLine: (raw) => {
    const t = raw.trim();
    if (t === "" || t.startsWith("#") || t.startsWith(";")) return null;
    const eq = raw.indexOf("=");
    if (eq <= 0) return null;
    const left = raw.slice(0, eq).trim();
    const right = raw.slice(eq + 1);
    const colon = left.indexOf(":");
    if (colon <= 0) return null;
    const key = left.slice(0, colon).trim();
    const press = left.slice(colon + 1).trim();
    return {
      fields: [
        {
          id: "key",
          width: "md",
          kind: { type: "select", options: KEYBIND_KEYS },
          value: key,
        },
        {
          id: "press",
          width: "md",
          kind: { type: "select", options: KEYBIND_TYPES },
          value: press,
        },
        {
          id: "action",
          width: "flex",
          kind: {
            type: "path",
            placeholder: "Passport · /ext/apps/Tools/uart_terminal.fap",
            pickerInitialPath: "/ext/apps",
          },
          value: right,
        },
      ],
    };
  },
  newLine: () => ({
    fields: [
      { id: "key", width: "md", kind: { type: "select", options: KEYBIND_KEYS }, value: "DPad_Up" },
      { id: "press", width: "md", kind: { type: "select", options: KEYBIND_TYPES }, value: "Short" },
      {
        id: "action",
        width: "flex",
        kind: {
          type: "path",
          placeholder: KEYBIND_BUILTINS.join(" · "),
          pickerInitialPath: "/ext/apps",
        },
        value: "Passport",
      },
    ],
  }),
  serializeLine: (line) => {
    const key = field(line, "key");
    const press = field(line, "press");
    const action = field(line, "action");
    return `${key}:${press}=${action}`;
  },
};

const mainMenuAppsSchema: FileSchema = {
  title: "Main menu apps",
  description:
    "Apps pinned to the main menu. Pick a `.fap` from /ext/apps to add or replace an entry.",
  parseLine: (raw) => {
    const t = raw.trim();
    if (t === "" || t.startsWith("#") || t.startsWith(";")) return null;
    return {
      fields: [
        {
          id: "path",
          width: "flex",
          kind: {
            type: "path",
            placeholder: "/ext/apps/Tools/uart_terminal.fap",
            pickerInitialPath: "/ext/apps",
          },
          value: raw,
        },
      ],
    };
  },
  newLine: () => ({
    fields: [
      {
        id: "path",
        width: "flex",
        kind: {
          type: "path",
          placeholder: "/ext/apps/Tools/uart_terminal.fap",
          pickerInitialPath: "/ext/apps",
        },
        value: "",
      },
    ],
  }),
  serializeLine: (line) => field(line, "path"),
};

const momentumSettingsSchema: FileSchema = {
  title: "Momentum settings",
  description:
    "Firmware preferences. Boolean toggles render as switches; everything else stays as free-form text. Refer to Momentum docs for valid values.",
  parseLine: (raw) => {
    const t = raw.trim();
    if (t === "" || t.startsWith("#") || t.startsWith(";")) return null;
    const eq = raw.indexOf("=");
    if (eq <= 0) return null;
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    const isBool = MOMENTUM_BOOL_KEYS.has(key.trim()) || isBoolish(value.trim());
    if (isBool) {
      return {
        fields: [
          { id: "key", label: key, width: "flex", kind: { type: "label", text: key }, value: key },
          {
            id: "value",
            width: "sm",
            kind: { type: "bool" },
            value: boolValue(value.trim()),
          },
        ],
      };
    }
    return {
      fields: [
        { id: "key", width: "md", kind: { type: "label", text: key }, value: key },
        { id: "value", width: "flex", kind: { type: "text" }, value },
      ],
    };
  },
  newLine: () => ({
    fields: [
      { id: "key", width: "md", kind: { type: "text", placeholder: "Setting name" }, value: "" },
      { id: "value", width: "flex", kind: { type: "text" }, value: "" },
    ],
  }),
  serializeLine: (line) => `${field(line, "key")}=${field(line, "value")}`,
};

// ── Public API ────────────────────────────────────────────────────────────

const SCHEMAS: Record<string, FileSchema> = {
  ".desktop_keybinds.txt": desktopKeybindsSchema,
  ".mainmenu_apps.txt": mainMenuAppsSchema,
  ".momentum_settings.txt": momentumSettingsSchema,
};

/** Look up a schema for the given /int file path. Returns `null` for files
 * that should use the generic editor. */
export function schemaFor(path: string): FileSchema | null {
  const name = path.split("/").pop() ?? path;
  return SCHEMAS[name] ?? null;
}

function field(line: StructuredLine, id: string): string {
  return line.fields.find((f) => f.id === id)?.value ?? "";
}
