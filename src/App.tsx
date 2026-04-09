import { DevicePanel } from "./components/DevicePanel/DevicePanel";
import { FileBrowser } from "./components/FileBrowser/FileBrowser";
import { useFlipperStore } from "./store/useFlipperStore";

export default function App() {
  const isConnected = useFlipperStore((s) => s.isConnected);

  return (
    <div className="flex flex-col h-screen bg-black text-zinc-100 overflow-hidden select-none">
      <DevicePanel />
      {isConnected ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <FileBrowser />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-zinc-700"
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
