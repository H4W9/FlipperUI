import { DevicePanel } from "./components/DevicePanel/DevicePanel";
import { FileBrowser } from "./components/FileBrowser/FileBrowser";
import { CliPanel } from "./components/CliPanel/CliPanel";
import { ScreenViewer } from "./components/ScreenViewer/ScreenViewer";
import { useFlipperStore } from "./store/useFlipperStore";

export default function App() {
  const isConnected = useFlipperStore((s) => s.isConnected);
  const cliVisible = useFlipperStore((s) => s.cliVisible);
  const screenVisible = useFlipperStore((s) => s.screenVisible);
  const setScreenVisible = useFlipperStore((s) => s.setScreenVisible);

  return (
    <div className="flex flex-col h-screen bg-app text-primary overflow-hidden select-none">
      <DevicePanel />
      {isConnected ? (
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <FileBrowser />
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
