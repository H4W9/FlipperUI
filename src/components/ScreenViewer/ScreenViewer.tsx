import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Monitor, X, Maximize2, Minimize2, Camera, Circle, Square, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Check, Undo2 } from "lucide-react";
import { GIFEncoder, applyPalette } from "gifenc";
import { screenStreamStart, screenStreamStop, sendInputEvent } from "../../lib/tauri";
import { base64ToUint8Array } from "../../lib/encoding";
import { Spinner } from "../ui/Spinner";

const SCREEN_W = 128;
const SCREEN_H = 64;

// Hard cap on recording length. 60 s * ~30 fps ≈ 1800 frames; at 128×64 RGBA
// that's ~58 MB in memory — above this the UI starts to feel it, and GIFs this
// long are rarely useful anyway.
const MAX_RECORD_MS = 60_000;

// Two-color palette matching the on-screen render: dark segments and the
// amber backlight. Keeping the GIF at 2 colors makes it tiny and sharp.
const GIF_PALETTE: [number, number, number][] = [
  [0x00, 0x00, 0x00],
  [0xff, 0x83, 0x00],
];

// InputKey enum values from Flipper protobuf
const KEY_UP = 0, KEY_DOWN = 1, KEY_RIGHT = 2, KEY_LEFT = 3, KEY_OK = 4, KEY_BACK = 5;
const INPUT_SHORT = 2;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function DpadBtn({ icon, onPress, ariaLabel, label }: { icon: React.ReactNode; onPress: () => void; ariaLabel: string; label?: string }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onPress(); }}
      aria-label={ariaLabel}
      className="flex flex-col items-center justify-center gap-0.5 w-7 h-7 rounded bg-surface hover:bg-elevated active:bg-flipper/30 text-secondary hover:text-primary transition-colors"
      title={ariaLabel}
    >
      {icon}
      {label && <span className="text-[8px] text-dim leading-none">{label}</span>}
    </button>
  );
}

interface ScreenViewerProps {
  onClose: () => void;
}

export function ScreenViewer({ onClose }: ScreenViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [scale, setScale] = useState(3); // 3x = 384x192
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);

  // Ref (not state) so the frame listener sees updates without re-subscribing —
  // re-subscribing would reset the stream. Frames collected here are encoded
  // into a GIF when the user stops recording.
  const recordingRef = useRef<{ frames: { rgba: Uint8Array; ts: number }[]; startedAt: number } | null>(null);

  const toggleScale = useCallback(() => {
    setScale((s) => (s === 3 ? 5 : s === 5 ? 2 : 3));
  }, []);

  const saveScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const bytes = base64ToUint8Array(b64);

    const path = await save({
      defaultPath: "flipper-screen.png",
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (path) await writeFile(path, bytes);
  }, []);

  const startRecording = useCallback(() => {
    recordingRef.current = { frames: [], startedAt: performance.now() };
    setRecordElapsed(0);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    if (!rec || rec.frames.length < 2) return;

    const gif = GIFEncoder();
    const frames = rec.frames;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const next = frames[i + 1];
      // GIF frame delays are in centiseconds; most viewers clamp anything
      // under ~2cs back up to 10cs, so don't bother going lower.
      const delayMs = next ? Math.max(20, Math.round(next.ts - f.ts)) : 100;
      const indexed = applyPalette(f.rgba, GIF_PALETTE);
      gif.writeFrame(indexed, SCREEN_W, SCREEN_H, { palette: GIF_PALETTE, delay: delayMs });
    }
    gif.finish();
    const bytes = gif.bytes();

    const path = await save({
      defaultPath: "flipper-recording.gif",
      filters: [{ name: "GIF", extensions: ["gif"] }],
    });
    if (path) await writeFile(path, bytes);
  }, []);

  // Tick the elapsed timer while recording; also auto-stop at MAX_RECORD_MS so
  // we never exceed the memory cap enforced in the frame listener.
  useEffect(() => {
    if (!isRecording) return;
    const id = window.setInterval(() => {
      const rec = recordingRef.current;
      if (!rec) return;
      const elapsed = performance.now() - rec.startedAt;
      setRecordElapsed(elapsed);
      if (elapsed >= MAX_RECORD_MS) stopRecording();
    }, 250);
    return () => window.clearInterval(id);
  }, [isRecording, stopRecording]);

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
          const bytes = base64ToUint8Array(event.payload);
          const imageData = ctx.createImageData(SCREEN_W, SCREEN_H);
          imageData.data.set(bytes);
          ctx.putImageData(imageData, 0, 0);

          // While recording, snapshot this frame. We copy bytes because the
          // decoded buffer is reused per event and would otherwise mutate.
          const rec = recordingRef.current;
          if (rec) {
            const now = performance.now();
            if (now - rec.startedAt >= MAX_RECORD_MS) {
              // Auto-stop at cap — handled below by stopRecording watcher.
              return;
            }
            rec.frames.push({ rgba: new Uint8Array(bytes), ts: now });
          }
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
      // Discard any in-progress recording on unmount — we won't have the UI
      // around to prompt for a save path.
      recordingRef.current = null;
      screenStreamStop().catch(() => {});
      setConnected(false);
    };
  }, []);

  const press = useCallback((key: number) => {
    sendInputEvent(key, INPUT_SHORT).catch(() => {});
  }, []);

  // Global keyboard shortcuts while the viewer is open, without requiring focus.
  // Skip if the user is typing in an input (e.g. the CLI) so text entry wins.
  useEffect(() => {
    if (!connected) return;
    const keyMap: Record<string, number> = {
      ArrowUp: KEY_UP, ArrowDown: KEY_DOWN,
      ArrowLeft: KEY_LEFT, ArrowRight: KEY_RIGHT,
      Enter: KEY_OK, Backspace: KEY_BACK,
    };
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      const key = keyMap[e.key];
      if (key === undefined) return;
      e.preventDefault();
      press(key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [connected, press]);

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
            {isRecording && (
              <span className="ml-2 text-danger font-mono">
                ● {formatElapsed(recordElapsed)}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleScale}
            aria-label="Toggle zoom"
            className="p-0.5 text-muted hover:text-primary rounded transition-colors"
            title={`${scale}x zoom`}
          >
            {scale > 3 ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <span className="text-[10px] text-dim w-5 text-center">{scale}x</span>
          <button
            onClick={saveScreenshot}
            aria-label="Save screenshot"
            className="p-0.5 text-muted hover:text-primary rounded transition-colors"
            title="Save screenshot"
          >
            <Camera size={12} />
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? "Stop recording" : "Record GIF"}
            className={`p-0.5 rounded transition-colors ${
              isRecording ? "text-danger hover:text-primary" : "text-muted hover:text-primary"
            }`}
            title={isRecording ? "Stop recording" : "Record GIF"}
            disabled={!connected}
          >
            {isRecording ? <Square size={12} fill="currentColor" /> : <Circle size={12} />}
          </button>
          <button
            onClick={onClose}
            aria-label="Close screen viewer"
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
          <div className="relative">
            {!connected && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner size={20} />
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={SCREEN_W}
              height={SCREEN_H}
              style={{
                width,
                height,
                imageRendering: "pixelated",
                opacity: connected ? 1 : 0.15,
              }}
              className="border border-flipper/30 rounded"
            />
          </div>
        )}
      </div>

      {/* D-pad */}
      {connected && (
        <div className="flex items-center justify-between px-3 pb-2 gap-4">
          {/* Directional pad */}
          <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
            <div />
            <DpadBtn icon={<ArrowUp size={12} />} onPress={() => press(KEY_UP)} ariaLabel="Up" />
            <div />
            <DpadBtn icon={<ArrowLeft size={12} />} onPress={() => press(KEY_LEFT)} ariaLabel="Left" />
            <DpadBtn icon={<Check size={12} />} onPress={() => press(KEY_OK)} ariaLabel="OK" />
            <DpadBtn icon={<ArrowRight size={12} />} onPress={() => press(KEY_RIGHT)} ariaLabel="Right" />
            <div />
            <DpadBtn icon={<ArrowDown size={12} />} onPress={() => press(KEY_DOWN)} ariaLabel="Down" />
            <div />
          </div>
          {/* Back */}
          <DpadBtn icon={<Undo2 size={12} />} onPress={() => press(KEY_BACK)} ariaLabel="Back" label="Back" />
        </div>
      )}
    </div>
  );
}
