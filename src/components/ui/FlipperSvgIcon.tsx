import type { CSSProperties } from "react";

interface Props {
  svg: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Inlines a raw SVG string and forces every painted element to use
 * `currentColor` (via the `.flipper-svg-icon svg *` rule in styles.css),
 * so the hard-coded-fill Flipper icons follow the surrounding text color
 * on the side rail. Preferred over CSS `mask-image` because the WKWebView
 * used by Tauri on macOS doesn't honor it reliably for these SVGs.
 */
export function FlipperSvgIcon({ svg, size = 18, className, style }: Props) {
  return (
    <span
      aria-hidden
      className={`flipper-svg-icon ${className ?? ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
