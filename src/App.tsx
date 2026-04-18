import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { DevicePanel } from "./components/DevicePanel/DevicePanel";
import { FileBrowser } from "./components/FileBrowser/FileBrowser";
import { CliPanel } from "./components/CliPanel/CliPanel";
import { ScreenViewer } from "./components/ScreenViewer/ScreenViewer";
import { SettingsRoot } from "./components/Settings/SettingsPanel";
import { useFlipperStore } from "./store/useFlipperStore";

export default function App() {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const cliVisible = useFlipperStore((s) => s.cliVisible);
  const screenVisible = useFlipperStore((s) => s.screenVisible);
  const setScreenVisible = useFlipperStore((s) => s.setScreenVisible);
  const setConnected = useFlipperStore((s) => s.setConnected);
  const setError = useFlipperStore((s) => s.setError);

  // The Rust side emits `flipper-disconnected` when the screen-stream reader
  // (or any other background worker) tears the client down after an
  // unrecoverable serial error. Without this the UI would keep showing
  // "connected" over a dead link.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("flipper-disconnected", (event) => {
      setConnected(null);
      setError(`Disconnected: ${event.payload}`);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, [setConnected, setError]);

  return (
    <div className="flex flex-col h-screen bg-app text-primary overflow-hidden select-none">
      <SettingsRoot />
      <DevicePanel />
      {isConnected ? (
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
            <FileBrowser />
            {cliVisible && (
              <div
                className="absolute inset-0 z-20 bg-app/50 backdrop-blur-[1px] flex items-center justify-center"
                aria-label="File explorer disabled while CLI is active"
              >
                <div className="bg-surface/90 border border-border-subtle rounded-lg px-4 py-2 text-xs text-secondary shadow-lg">
                  File explorer is disabled while CLI is active
                </div>
              </div>
            )}
          </div>
          {cliVisible && <CliPanel />}

          {/* Floating screen viewer */}
          {screenVisible && (
            <div className="absolute top-4 right-4 z-30">
              <ScreenViewer onClose={() => setScreenVisible(false)} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-elevated"
          >
            <rect x="7" y="2" width="10" height="20" rx="2" />
            <path d="M12 18h.01" />
            <path d="M9 7h6" />
          </svg>
          <p className="text-sm">Connect a Flipper Zero to get started</p>
        </div>
      )}
    </div>
  );
}
