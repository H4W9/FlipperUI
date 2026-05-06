import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Monitor, ZoomIn, ZoomOut, Camera, Circle, Square, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Check, Undo2 } from "lucide-react";
import { GIFEncoder, applyPalette } from "gifenc";
import { screenStreamStart, screenStreamStop, sendInputEvent } from "../../lib/tauri";
import { base64ToUint8Array } from "../../lib/encoding";
import { loadSettings, subscribeSettings, type AppSettings } from "../../lib/settings";
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
const INPUT_PRESS = 0;
const INPUT_RELEASE = 1;
const INPUT_SHORT = 2;
const INPUT_LONG = 3;

// Long-press threshold: Flipper firmware fires LONG after ~300 ms of hold.
// We use a slightly higher value so a quick tap can't accidentally trigger it
// across browser keyboard-repeat startup latency.
const LONG_PRESS_MS = 350;

// Cap for the input wait-list. Mashing keys or holding auto-repeat past this
// depth drops the extra events instead of letting a multi-second backlog build
// up — the device would still be replaying old presses long after you let go.
const MAX_PENDING_INPUTS = 8;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Discrete zoom levels. The default sits between the prior 3× and 4× — about
// 10% larger than the original — so the screen has more presence without
// pushing past comfortable on smaller windows.
const SCALES = [2, 2.6, 3.3, 4, 5] as const;
const DEFAULT_SCALE_INDEX = 2;

function formatScale(scale: number): string {
  return Number.isInteger(scale) ? `${scale}x` : `${scale.toFixed(1)}x`;
}

function DpadBtn({ icon, onPress, ariaLabel, label }: { icon: React.ReactNode; onPress: () => void; ariaLabel: string; label?: string }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onPress(); }}
      aria-label={ariaLabel}
      className="flex flex-col items-center justify-center gap-0.5 w-9 h-9 rounded-md border border-border-subtle bg-surface hover:bg-elevated hover:border-flipper/40 active:bg-flipper/30 active:border-flipper text-secondary hover:text-primary transition-colors"
      title={ariaLabel}
    >
      {icon}
      {label && <span className="text-[9px] text-dim leading-none">{label}</span>}
    </button>
  );
}

export function ScreenViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX);
  const scale = SCALES[scaleIndex];
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);

  // Ref (not state) so the frame listener sees updates without re-subscribing —
  // re-subscribing would reset the stream. Frames collected here are encoded
  // into a GIF when the user stops recording.
  const recordingRef = useRef<{ frames: { rgba: Uint8Array; ts: number }[]; startedAt: number } | null>(null);

  // Read on demand inside save handlers so the latest persisted dirs are used
  // even if the user changes them while the viewer is open.
  const settingsRef = useRef<AppSettings | null>(null);
  useEffect(() => {
    loadSettings().then((s) => { settingsRef.current = s; }).catch(() => {});
    return subscribeSettings((s) => { settingsRef.current = s; });
  }, []);

  const joinDir = (dir: string | null | undefined, filename: string) =>
    dir ? `${dir.replace(/[\\/]+$/, "")}/${filename}` : filename;

  const zoomIn = useCallback(() => {
    setScaleIndex((i) => Math.min(SCALES.length - 1, i + 1));
  }, []);
  const zoomOut = useCallback(() => {
    setScaleIndex((i) => Math.max(0, i - 1));
  }, []);

  const saveScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const bytes = base64ToUint8Array(b64);

    const path = await save({
      defaultPath: joinDir(settingsRef.current?.screenStream.screenshotDir, "flipper-screen.png"),
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
      defaultPath: joinDir(settingsRef.current?.screenStream.gifDir, "flipper-recording.gif"),
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

  // Serial wait-list for input events. Each call chains onto the previous so
  // only one `sendInputEvent` is in flight at a time — rapid clicks or held
  // keys won't flood the backend channel and starve the screen-stream reader
  // (which used to break BLE framing under input bursts).
  const inputChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingInputsRef = useRef(0);

  const enqueueInput = useCallback((key: number, inputType: number) => {
    if (pendingInputsRef.current >= MAX_PENDING_INPUTS) return;
    pendingInputsRef.current += 1;
    inputChainRef.current = inputChainRef.current
      .then(() => sendInputEvent(key, inputType))
      .catch(() => {})
      .finally(() => {
        pendingInputsRef.current -= 1;
      });
  }, []);

  const press = useCallback((key: number) => {
    enqueueInput(key, INPUT_SHORT);
  }, [enqueueInput]);

  // Global keyboard shortcuts while the viewer is open, without requiring focus.
  // Skip if the user is typing in an input (e.g. the CLI) so text entry wins.
  //
  // Press lifecycle: keydown sends PRESS, sets a LONG_PRESS_MS timer that emits
  // LONG if the key is still held; keyup cancels the timer (sends SHORT if the
  // long timer hadn't fired yet) and sends RELEASE. Browser auto-repeat is
  // ignored — a held key is one continuous press, not a stream of taps.
  useEffect(() => {
    if (!connected) return;
    const keyMap: Record<string, number> = {
      ArrowUp: KEY_UP, ArrowDown: KEY_DOWN,
      ArrowLeft: KEY_LEFT, ArrowRight: KEY_RIGHT,
      Enter: KEY_OK, Backspace: KEY_BACK,
    };
    type HeldKey = { fkey: number; longTimer: number | null; longSent: boolean };
    const held = new Map<string, HeldKey>();

    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;
      const fkey = keyMap[e.key];
      if (fkey === undefined) return;
      e.preventDefault();
      if (e.repeat) return; // hold = one press, not many
      if (held.has(e.key)) return;

      enqueueInput(fkey, INPUT_PRESS);
      const entry: HeldKey = { fkey, longTimer: null, longSent: false };
      entry.longTimer = window.setTimeout(() => {
        entry.longSent = true;
        entry.longTimer = null;
        enqueueInput(fkey, INPUT_LONG);
      }, LONG_PRESS_MS);
      held.set(e.key, entry);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const entry = held.get(e.key);
      if (!entry) return;
      held.delete(e.key);
      if (entry.longTimer != null) {
        window.clearTimeout(entry.longTimer);
        // Quick tap — fire SHORT before RELEASE so apps that key off SHORT
        // (e.g. menu select) react. Both PRESS and RELEASE were already / will
        // be sent, so this matches the SHORT triplet but with realistic timing.
        enqueueInput(entry.fkey, INPUT_SHORT);
      }
      enqueueInput(entry.fkey, INPUT_RELEASE);
    };

    // Window blur fires when the user alt-tabs while holding a key. Without
    // this we'd never see keyup and the device would keep the key held down.
    const onBlur = () => {
      for (const [, entry] of held) {
        if (entry.longTimer != null) window.clearTimeout(entry.longTimer);
        enqueueInput(entry.fkey, INPUT_RELEASE);
      }
      held.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      // Releasing held keys on unmount avoids leaving the device in a
      // "key down" state if the user navigates away mid-hold.
      for (const [, entry] of held) {
        if (entry.longTimer != null) window.clearTimeout(entry.longTimer);
        enqueueInput(entry.fkey, INPUT_RELEASE);
      }
      held.clear();
    };
  }, [connected, enqueueInput]);

  const width = SCREEN_W * scale;
  const height = SCREEN_H * scale;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-app overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-panel/50 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Monitor size={14} className="text-accent shrink-0" />
          <span className="text-xs text-primary font-medium">Screen</span>
          {!connected && !error && (
            <span className="text-[11px] text-dim">connecting…</span>
          )}
          {isRecording && (
            <span
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-danger/15 border border-danger/30 text-danger text-[11px] font-mono tabular-nums"
              role="status"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
              </span>
              <span>REC {formatElapsed(recordElapsed)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Zoom group */}
          <div className="flex items-center gap-0.5 px-1 py-0.5 rounded border border-border-subtle bg-surface/40">
            <button
              onClick={zoomOut}
              disabled={scaleIndex === 0}
              aria-label="Zoom out"
              className="p-0.5 text-muted hover:text-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
            <span className="text-[10px] text-dim w-9 text-center tabular-nums">
              {formatScale(scale)}
            </span>
            <button
              onClick={zoomIn}
              disabled={scaleIndex === SCALES.length - 1}
              aria-label="Zoom in"
              className="p-0.5 text-muted hover:text-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          <button
            onClick={saveScreenshot}
            disabled={!connected}
            aria-label="Save screenshot"
            className="p-1 text-muted hover:text-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Save screenshot (PNG)"
          >
            <Camera size={14} />
          </button>

          {/* Vertical divider so the record action reads as its own thing */}
          <div className="w-px h-5 bg-border-subtle mx-0.5" />

          {/* Prominent GIF record button — larger pill with text + colour cue */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!connected}
            aria-label={isRecording ? "Stop recording" : "Record GIF"}
            title={isRecording ? "Stop recording" : "Record GIF"}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isRecording
                ? "bg-danger/20 border-danger/50 text-danger hover:bg-danger/30"
                : "bg-surface/60 border-border-subtle text-secondary hover:bg-danger/10 hover:border-danger/40 hover:text-danger"
            }`}
          >
            {isRecording ? (
              <>
                <Square size={11} fill="currentColor" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Circle size={11} fill="currentColor" className="text-danger" />
                <span>Record GIF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 p-6 bg-app flex items-center justify-center overflow-auto">
        {error ? (
          <div className="text-xs text-danger px-4 py-8">{error}</div>
        ) : (
          <div
            className={`relative rounded-md transition-shadow ${
              isRecording
                ? "shadow-[0_0_0_2px_rgba(239,68,68,0.55),0_0_28px_4px_rgba(239,68,68,0.25)]"
                : ""
            }`}
          >
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
                border: "5px solid #FF8300",
              }}
              className="rounded shadow-lg shadow-black/40"
            />
          </div>
        )}
      </div>

      {/* D-pad */}
      {connected && (
        <div className="flex items-center justify-center px-3 py-4 gap-5 border-t border-border-subtle bg-panel/30 shrink-0">
          {/* Directional pad */}
          <div className="grid grid-cols-3 grid-rows-3 gap-1">
            <div />
            <DpadBtn icon={<ArrowUp size={14} />} onPress={() => press(KEY_UP)} ariaLabel="Up" />
            <div />
            <DpadBtn icon={<ArrowLeft size={14} />} onPress={() => press(KEY_LEFT)} ariaLabel="Left" />
            <DpadBtn icon={<Check size={14} />} onPress={() => press(KEY_OK)} ariaLabel="OK" />
            <DpadBtn icon={<ArrowRight size={14} />} onPress={() => press(KEY_RIGHT)} ariaLabel="Right" />
            <div />
            <DpadBtn icon={<ArrowDown size={14} />} onPress={() => press(KEY_DOWN)} ariaLabel="Down" />
            <div />
          </div>
          {/* Back */}
          <DpadBtn icon={<Undo2 size={14} />} onPress={() => press(KEY_BACK)} ariaLabel="Back" label="Back" />
        </div>
      )}
    </div>
  );
}
