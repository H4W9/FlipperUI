import { ChevronRight } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";

export function BreadcrumbBar() {
  const { currentPath, setCurrentPath } = useFlipperStore();
  const { refresh } = useStorage();

  // Split path into segments: "/" → [""], "/ext/foo" → ["", "ext", "foo"]
  const parts = currentPath.split("/").filter(Boolean);

  const navigateTo = (index: number) => {
    const path = index < 0 ? "/" : "/" + parts.slice(0, index + 1).join("/");
    setCurrentPath(path);
    refresh(path);
  };

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-700/60 text-sm overflow-x-auto">
      <button
        onClick={() => navigateTo(-1)}
        className="text-orange-400 hover:text-orange-300 font-mono shrink-0"
      >
        /
      </button>
      {parts.map((segment, i) => (
        <span key={i} className="flex items-center gap-0.5 shrink-0">
          <ChevronRight size={12} className="text-zinc-600" />
          <button
            onClick={() => navigateTo(i)}
            className={
              i === parts.length - 1
                ? "text-zinc-100 font-mono"
                : "text-zinc-400 hover:text-zinc-200 font-mono"
            }
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  );
}
