import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Monitor, X, Maximize2, Minimize2 } from "lucide-react";
import { screenStreamStart, screenStreamStop } from "../../lib/tauri";

const SCREEN_W = 128;
const SCREEN_H = 64;

interface ScreenViewerProps {
  onClose: () => void;
}

export function ScreenViewer({ onClose }: ScreenViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [scale, setScale] = useState(3); // 3x = 384x192
  const [error, setError] = useState<string | null>(null);

  const toggleScale = useCallback(() => {
    setScale((s) => (s === 3 ? 5 : s === 5 ? 2 : 3));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    (async () => {
      try {
        // Listen for frames before starting the stream
        unlisten = await listen<string>("screen-frame", (event) => {
          if (!mounted) return;
          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          // Decode base64 RGBA
          const b64 = event.payload;
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          const imageData = ctx.createImageData(SCREEN_W, SCREEN_H);
          imageData.data.set(bytes);
          ctx.putImageData(imageData, 0, 0);
        });

        await screenStreamStart();
        if (mounted) setConnected(true);
      } catch (err) {
        if (mounted) setError(String(err));
      }
    })();

    return () => {
      mounted = false;
      unlisten?.();
      screenStreamStop().catch(() => {});
      setConnected(false);
    };
  }, []);

  const width = SCREEN_W * scale;
  const height = SCREEN_H * scale;

  return (
    <div className="flex flex-col border border-flipper rounded-lg bg-panel shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-surface/50">
        <div className="flex items-center gap-2">
          <Monitor size={13} className="text-accent" />
          <span className="text-xs text-secondary font-medium">
            Screen
            {!connected && !error && (
              <span className="ml-2 text-dim">connecting...</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleScale}
            className="p-0.5 text-muted hover:text-primary rounded transition-colors"
            title={`${scale}x zoom`}
          >
            {scale > 3 ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <span className="text-[10px] text-dim w-5 text-center">{scale}x</span>
          <button
            onClick={onClose}
            className="p-0.5 text-muted hover:text-primary rounded transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="p-2 bg-app flex items-center justify-center">
        {error ? (
          <div className="text-xs text-danger px-4 py-8">{error}</div>
        ) : (
          <canvas
            ref={canvasRef}
            width={SCREEN_W}
            height={SCREEN_H}
            style={{
              width,
              height,
              imageRendering: "pixelated",
            }}
            className="border border-flipper/30 rounded"
          />
        )}
      </div>
    </div>
  );
}
