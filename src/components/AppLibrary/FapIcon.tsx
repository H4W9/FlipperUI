import { useMemo } from "react";
import { Package } from "lucide-react";
import { base64ToUint8Array } from "../../lib/encoding";

/**
 * Render a Flipper app's embedded 10x10 icon extracted from a `.fap`.
 *
 * `bytes` is base64-encoded raw XBM data (row-major, LSB-first, 2 bytes
 * per row for 10 pixels; the first 20 bytes carry the bitmap, the rest
 * is padding in the 32-byte manifest slot). `null` means we tried and
 * the app has no embedded icon → render the Package placeholder. `undefined`
 * means "not fetched yet" → also render placeholder (the prefetcher will
 * fill it in over the next seconds).
 */
interface Props {
  bytes: string | null | undefined;
  size?: number;
}

export function FapIcon({ bytes, size = 20 }: Props) {
  const pixels = useMemo(() => (bytes ? parseIcon(bytes) : null), [bytes]);

  if (!pixels) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-accent/10 border border-accent/30 text-accent"
        style={{ width: size + 6, height: size + 6 }}
        aria-hidden
      >
        <Package size={Math.round(size * 0.65)} strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-md bg-accent/10 border border-accent/30 text-accent"
      style={{ width: size + 6, height: size + 6 }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
      >
        {pixels.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill="currentColor"
              />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

function parseIcon(b64: string): boolean[][] {
  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(b64);
  } catch {
    return emptyGrid();
  }
  const grid: boolean[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 10; x++) {
      const byteIdx = y * 2 + (x >> 3);
      const bitIdx = x & 7;
      const on =
        byteIdx < bytes.length && ((bytes[byteIdx] >> bitIdx) & 1) === 1;
      row.push(on);
    }
    grid.push(row);
  }
  return grid;
}

function emptyGrid(): boolean[][] {
  return Array.from({ length: 10 }, () => Array(10).fill(false));
}
