interface ProgressBarProps {
  value: number; // 0–100
  label?: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-gray-800 border-t border-gray-700">
      <span className="text-xs text-gray-400 whitespace-nowrap">
        {label ?? "Transferring…"}
      </span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500 rounded-full transition-all duration-200"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{value}%</span>
    </div>
  );
}
