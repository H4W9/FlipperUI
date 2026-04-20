import {
  FolderTree,
  Info,
  LayoutGrid,
  Monitor,
  Nfc,
  RadioTower,
  Settings as SettingsIcon,
  Terminal,
  Tv,
} from "lucide-react";
import type { ComponentType } from "react";
import { useFlipperStore, type ActiveView } from "../../store/useFlipperStore";

interface RailItem {
  view: ActiveView;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Only show when a device is connected. */
  requiresConnection?: boolean;
}

const TOP_ITEMS: RailItem[] = [
  { view: "files", label: "File Explorer", Icon: FolderTree },
  { view: "subghz", label: "Sub-GHz Library", Icon: RadioTower },
  { view: "infrared", label: "Infrared Library", Icon: Tv },
  { view: "nfc", label: "NFC Library", Icon: Nfc },
  { view: "apps", label: "App Library", Icon: LayoutGrid },
  { view: "info", label: "Device Info", Icon: Info },
  { view: "cli", label: "Terminal", Icon: Terminal, requiresConnection: true },
  { view: "screen", label: "Screen Stream", Icon: Monitor, requiresConnection: true },
];

const BOTTOM_ITEMS: RailItem[] = [
  { view: "settings", label: "Settings", Icon: SettingsIcon },
];

export function SideRail() {
  const activeView = useFlipperStore((s) => s.activeView);
  const setActiveView = useFlipperStore((s) => s.setActiveView);
  const isConnected = useFlipperStore((s) => s.isConnected);

  return (
    <nav
      aria-label="Primary navigation"
      className="flex flex-col items-center justify-between w-14 shrink-0 bg-panel border-r border-border-subtle py-2"
    >
      <div className="flex flex-col gap-1">
        {TOP_ITEMS.filter((i) => !i.requiresConnection || isConnected).map((item) => (
          <RailButton
            key={item.view}
            item={item}
            active={activeView === item.view}
            onClick={() => setActiveView(item.view)}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <RailButton
            key={item.view}
            item={item}
            active={activeView === item.view}
            onClick={() => setActiveView(item.view)}
          />
        ))}
      </div>
    </nav>
  );
}

function RailButton({
  item,
  active,
  onClick,
}: {
  item: RailItem;
  active: boolean;
  onClick: () => void;
}) {
  const { Icon, label } = item;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={[
        "relative flex items-center justify-center w-10 h-10 rounded-md transition-colors",
        active
          ? "text-accent bg-surface/60"
          : "text-muted hover:text-primary hover:bg-surface/40",
      ].join(" ")}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-2 bottom-2 w-[2px] rounded-r bg-accent"
        />
      )}
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
}
