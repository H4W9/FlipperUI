import { Upload } from "lucide-react";

interface LibraryDropOverlayProps {
  /** Whether the overlay is currently shown. */
  visible: boolean;
  /**
   * Headline shown next to the upload icon, e.g.
   * `"Drop .nfc files to upload to /ext/nfc"`.
   */
  label: string;
}

/**
 * Full-cover dashed-border drop target rendered on top of a library view
 * while the user is dragging files over the window. Pure presentation —
 * combine with `useLibraryDrop`'s `isDragOver` flag to wire it up.
 */
export function LibraryDropOverlay({ visible, label }: LibraryDropOverlayProps) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-app/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 px-8 py-6 border-2 border-dashed border-accent/60 rounded-xl">
        <Upload size={32} className="text-accent" />
        <span className="text-sm text-accent/80 font-medium">{label}</span>
      </div>
    </div>
  );
}
