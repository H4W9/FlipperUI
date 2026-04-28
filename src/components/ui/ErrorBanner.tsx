import { useEffect } from "react";
import { X } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";

export function ErrorBanner() {
  const error = useFlipperStore((s) => s.error);
  const setError = useFlipperStore((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  if (!error) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-danger/20 border-b border-danger/40 text-danger text-sm">
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
