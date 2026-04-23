interface ScanProgressLike {
  scanned: number;
  total: number;
  current_path: string;
}

interface Props {
  progress: ScanProgressLike;
}

/**
 * Determinate/indeterminate scan progress bar shared by every library view.
 *
 * When `total === 0` the first progress event hasn't arrived yet — the real
 * fraction would be 0/0, which reads as a frozen bar during the 200–500 ms
 * before the first file parses. Render an indeterminate sliding slice +
 * "Preparing scan…" label instead; flip to determinate as soon as `total > 0`.
 */
export function ScanProgressBar({ progress }: Props) {
  const indeterminate = progress.total === 0;
  return (
    <div className="px-3 pb-2 flex flex-col gap-1">
      <div className="relative h-[3px] w-full bg-surface rounded overflow-hidden">
        {indeterminate ? (
          <div className="scan-indeterminate-bar" />
        ) : (
          <div
            className="h-full bg-accent transition-[width] duration-100"
            style={{
              width: `${(progress.scanned / progress.total) * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-dim">
        <span className="truncate max-w-[60%]" title={progress.current_path}>
          {indeterminate
            ? "Preparing scan…"
            : progress.current_path || "Scanning…"}
        </span>
        <span>
          {indeterminate ? "—" : `${progress.scanned} / ${progress.total}`}
        </span>
      </div>
    </div>
  );
}
