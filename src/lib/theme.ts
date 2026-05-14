/**
 * Runtime theme accent color.
 *
 * The Tailwind v4 `@theme` block in `styles.css` declares `--color-accent`
 * (plus hover/dim variants) as design tokens. This module overrides those
 * tokens at runtime on `document.documentElement` so the user-picked accent
 * color flows through every `text-accent` / `bg-accent` / `border-accent`
 * utility class in the app — except where the FlipperUI brand orange is
 * pinned (splash window, app-header "UI" suffix), which use literal colors
 * outside this token system.
 */

/** Flipper Zero brand orange — the default and reset target. */
export const FLIPPER_ORANGE = "#ff8300";

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

/** Built-in accent swatches surfaced as quick-pick buttons in Settings. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "orange", label: "Flipper Orange", hex: FLIPPER_ORANGE },
  { id: "amber", label: "Amber", hex: "#f59e0b" },
  { id: "rose", label: "Rose", hex: "#f43f5e" },
  { id: "magenta", label: "Magenta", hex: "#d946ef" },
  { id: "violet", label: "Violet", hex: "#8b5cf6" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4" },
  { id: "emerald", label: "Emerald", hex: "#10b981" },
];

/**
 * Apply an accent color to the document root. Idempotent and safe to call
 * before `loadSettings()` resolves (we pass the cached value in then).
 */
export function applyAccentColor(hex: string): void {
  const normalized = normalizeHex(hex) ?? FLIPPER_ORANGE;
  const root = document.documentElement;
  root.style.setProperty("--color-accent", normalized);
  root.style.setProperty("--color-accent-hover", shiftLightness(normalized, 0.08));
  root.style.setProperty("--color-accent-dim", shiftLightness(normalized, -0.08));
}

/** Coerce arbitrary input to a `#rrggbb` string, or null if it can't parse. */
export function normalizeHex(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s.startsWith("#")) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

/** Returns a new `#rrggbb` shifted in HSL lightness by `delta` (-1..1). */
function shiftLightness(hex: string, delta: number): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const nl = Math.max(0, Math.min(1, l + delta));
  const { r: nr, g: ng, b: nb } = hslToRgb(h, s, nl);
  return rgbToHex(nr, ng, nb);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number): string {
  const v = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  return `#${v.toString(16).padStart(6, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: conv(h + 1 / 3) * 255,
    g: conv(h) * 255,
    b: conv(h - 1 / 3) * 255,
  };
}
