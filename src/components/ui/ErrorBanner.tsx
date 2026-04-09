import { X } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";

export function ErrorBanner() {
  const { error, setError } = useFlipperStore();
  if (!error) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-red-900/60 border-b border-red-700 text-red-200 text-sm">
      <span className="flex-1 truncate">{error}</span>
      <button
        onClick={() => setError(null)}
        className="p-0.5 hover:text-white rounded"
        aria-label="Dismiss error"
      >
        <X size={14} />
      </button>
    </div>
  );
}
