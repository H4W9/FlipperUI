import { X } from "lucide-react";

interface ProgressBarProps {
  value: number; // 0–100
  label?: string;
  onCancel?: () => void;
}

export function ProgressBar({ value, label, onCancel }: ProgressBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-surface border-t border-flipper">
      <span className="text-xs text-secondary whitespace-nowrap">
        {label ?? "Transferring…"}
      </span>
      <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-hover rounded-full transition-all duration-200"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-secondary w-8 text-right">{value}%</span>
      {onCancel && (
        <button
          onClick={onCancel}
          className="p-0.5 text-muted hover:text-danger rounded transition-colors"
          title="Cancel transfer"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
