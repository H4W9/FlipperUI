import { ChevronRight, HardDrive, Cpu } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";

type Volume = "ext" | "int";

export function BreadcrumbBar() {
  const currentPath = useFlipperStore((s) => s.currentPath);
  const setCurrentPath = useFlipperStore((s) => s.setCurrentPath);
  const { refresh } = useStorage();

  const parts = currentPath.split("/").filter(Boolean);
  const volume: Volume = parts[0] === "int" ? "int" : "ext";

  const navigateTo = (index: number) => {
    const path = index < 0 ? "/" : "/" + parts.slice(0, index + 1).join("/");
    setCurrentPath(path);
    refresh(path);
  };

  const switchVolume = (next: Volume) => {
    if (next === volume) return;
    const path = `/${next}`;
    setCurrentPath(path);
    refresh(path);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-panel/50 border-b border-flipper/60 text-sm overflow-x-auto">
      {/* Volume toggle (SD / Internal) */}
      <div className="flex items-center gap-1.5 select-none shrink-0">
        <HardDrive
          size={13}
          className={volume === "ext" ? "text-primary" : "text-muted"}
          aria-label="SD card"
        />
        <button
          type="button"
          role="switch"
          aria-checked={volume === "int"}
          aria-label="Toggle storage volume"
          onClick={() => switchVolume(volume === "ext" ? "int" : "ext")}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            volume === "int" ? "bg-accent" : "bg-elevated"
          }`}
          title={volume === "ext" ? "SD card (/ext)" : "Internal (/int)"}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
              volume === "int" ? "translate-x-[14px]" : "translate-x-[2px]"
            }`}
          />
        </button>
        <Cpu
          size={13}
          className={volume === "int" ? "text-primary" : "text-muted"}
          aria-label="Internal storage"
        />
      </div>

      <div className="w-px h-4 bg-elevated shrink-0" />

      <div className="flex items-center gap-0.5 min-w-0">
        <button
          onClick={() => navigateTo(-1)}
          className="text-accent hover:text-accent-hover font-mono shrink-0"
        >
          /
        </button>
        {parts.map((segment, i) => (
          <span key={i} className="flex items-center gap-0.5 shrink-0">
            <ChevronRight size={12} className="text-dim" />
            <button
              onClick={() => navigateTo(i)}
              className={
                i === parts.length - 1
                  ? "text-primary font-mono"
                  : "text-secondary hover:text-primary font-mono"
              }
            >
              {segment}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
