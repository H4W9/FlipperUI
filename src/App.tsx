import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { DevicePanel } from "./components/DevicePanel/DevicePanel";
import { FileBrowser } from "./components/FileBrowser/FileBrowser";
import { CliPanel } from "./components/CliPanel/CliPanel";
import { ScreenViewer } from "./components/ScreenViewer/ScreenViewer";
import { SettingsPane } from "./components/Settings/SettingsPane";
import { SubGhzLibrary } from "./components/SubGhzLibrary/SubGhzLibrary";
import { InfraredLibrary } from "./components/InfraredLibrary/InfraredLibrary";
import { NfcLibrary } from "./components/NfcLibrary/NfcLibrary";
import { BadUsbLibrary } from "./components/BadUsbLibrary/BadUsbLibrary";
import { AppLibrary } from "./components/AppLibrary/AppLibrary";
import { DeviceInfoView } from "./components/DeviceInfo/DeviceInfoView";
import { SideRail } from "./components/Nav/SideRail";
import { useFlipperStore, type ActiveView } from "./store/useFlipperStore";
import flipperOutlineUrl from "./assets/flipper-outline.svg";

export default function App() {
  const activeView = useFlipperStore((s) => s.activeView);
  const setActiveView = useFlipperStore((s) => s.setActiveView);
  const isConnected = useFlipperStore((s) => s.isConnected);
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

  // Native menu (Cmd+, / FlipperUI → Settings…) navigates to the Settings view.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("open-settings", () => setActiveView("settings")).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [setActiveView]);

  return (
    <div className="flex h-screen bg-app text-primary overflow-hidden select-none">
      <SideRail />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <DevicePanel />
        <ActivePane activeView={activeView} isConnected={isConnected} />
      </div>
    </div>
  );
}

function ActivePane({
  activeView,
  isConnected,
}: {
  activeView: ActiveView;
  isConnected: boolean;
}) {
  const subghzCount = useFlipperStore((s) => s.subghzEntries.length);
  const irCount = useFlipperStore((s) => s.irEntries.length);
  const nfcCount = useFlipperStore((s) => s.nfcEntries.length);
  const badusbCount = useFlipperStore((s) => s.badusbEntries.length);

  if (activeView === "settings") {
    return <SettingsPane />;
  }

  // Cached libraries stay browsable while offline. The scan/upload/row
  // actions degrade inside the view itself — see each library component.
  if (activeView === "subghz" && (isConnected || subghzCount > 0)) {
    return <SubGhzLibrary />;
  }
  if (activeView === "infrared" && (isConnected || irCount > 0)) {
    return <InfraredLibrary />;
  }
  if (activeView === "nfc" && (isConnected || nfcCount > 0)) {
    return <NfcLibrary />;
  }
  if (activeView === "badusb" && (isConnected || badusbCount > 0)) {
    return <BadUsbLibrary />;
  }

  if (!isConnected) {
    return <DisconnectedEmptyState />;
  }

  if (activeView === "apps") return <AppLibrary />;
  if (activeView === "info") return <DeviceInfoView />;
  if (activeView === "cli") return <CliPanel />;
  if (activeView === "screen") return <ScreenViewer />;

  // activeView === "files"
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <FileBrowser />
    </div>
  );
}

function DisconnectedEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-dim">
      <div
        aria-hidden
        className="text-elevated"
        style={{
          width: 240,
          height: 178,
          backgroundColor: "currentColor",
          WebkitMaskImage: `url(${flipperOutlineUrl})`,
          maskImage: `url(${flipperOutlineUrl})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
      <p className="text-sm">Connect a Flipper Zero to get started</p>
    </div>
  );
}
