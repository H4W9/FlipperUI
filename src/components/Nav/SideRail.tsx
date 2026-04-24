import {
  FolderTree,
  Home,
  Info,
  Menu,
  Monitor,
  Terminal
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { useFlipperStore, type ActiveView } from "../../store/useFlipperStore";
import { FlipperSvgIcon } from "../ui/FlipperSvgIcon";
import subghzIconSvg from "../../assets/icons/sub1.svg?raw";
import infraredIconSvg from "../../assets/icons/infrared.svg?raw";
import nfcIconSvg from "../../assets/icons/nfc.svg?raw";
import pluginsIconSvg from "../../assets/icons/plugins.svg?raw";
import settingsIconSvg from "../../assets/icons/settings.svg?raw";
import badusbIconSvg from "../../assets/icons/badusb.svg?raw";
//import archiveIconSvg from "../../assets/icons/archive.svg?raw";

type RailIconProps = { size?: number; strokeWidth?: number };

const flipperIcon = (svg: string, name: string): ComponentType<RailIconProps> => {
  const Icon = ({ size }: RailIconProps) => <FlipperSvgIcon svg={svg} size={size} />;
  Icon.displayName = `FlipperIcon(${name})`;
  return Icon;
};

interface RailItem {
  view: ActiveView;
  label: string;
  Icon: ComponentType<RailIconProps>;
  /** Disabled while no device is connected. */
  requiresConnection?: boolean;
  /**
   * If true, the item stays enabled while disconnected as long as its cached
   * library has at least one entry — the view is browsable offline.
   */
  browsableOffline?: "subghz" | "infrared" | "nfc" | "badusb";
  /** Additionally disabled while the active transport is BLE. */
  disabledOnBle?: boolean;
}

const TOP_ITEMS: RailItem[] = [
  { view: "dashboard", label: "Dashboard", Icon: Home },
  { view: "files", label: "File Explorer", Icon: FolderTree, requiresConnection: true },
  { view: "apps", label: "Apps", Icon: flipperIcon(pluginsIconSvg, "plugins"), requiresConnection: true },
  { view: "subghz", label: "Sub-GHz", Icon: flipperIcon(subghzIconSvg, "subghz"), requiresConnection: true, browsableOffline: "subghz" },
  { view: "infrared", label: "Infrared", Icon: flipperIcon(infraredIconSvg, "infrared"), requiresConnection: true, browsableOffline: "infrared" },
  { view: "nfc", label: "NFC", Icon: flipperIcon(nfcIconSvg, "nfc"), requiresConnection: true, browsableOffline: "nfc" },
  { view: "badusb", label: "BadUSB", Icon: flipperIcon(badusbIconSvg, "badusb"), requiresConnection: true, browsableOffline: "badusb" },
  { view: "screen", label: "Screen", Icon: Monitor, requiresConnection: true },
  { view: "cli", label: "Terminal", Icon: Terminal, requiresConnection: true, disabledOnBle: true },
  
];

const BOTTOM_ITEMS: RailItem[] = [
  { view: "info", label: "Device Info", Icon: Info, requiresConnection: true },
  { view: "settings", label: "Settings", Icon: flipperIcon(settingsIconSvg, "settings") },
];

export function SideRail() {
  const activeView = useFlipperStore((s) => s.activeView);
  const setActiveView = useFlipperStore((s) => s.setActiveView);
  const isConnected = useFlipperStore((s) => s.isConnected);
  const connectionKind = useFlipperStore((s) => s.connectionKind);
  const subghzCount = useFlipperStore((s) => s.subghzEntries.length);
  const irCount = useFlipperStore((s) => s.irEntries.length);
  const nfcCount = useFlipperStore((s) => s.nfcEntries.length);
  const badusbCount = useFlipperStore((s) => s.badusbEntries.length);
  const [expanded, setExpanded] = useState(false);

  const offlineLibraryHasEntries = (kind: NonNullable<RailItem["browsableOffline"]>): boolean => {
    if (kind === "subghz") return subghzCount > 0;
    if (kind === "infrared") return irCount > 0;
    if (kind === "nfc") return nfcCount > 0;
    return badusbCount > 0;
  };

  const itemDisabled = (item: RailItem): boolean => {
    if (item.requiresConnection && !isConnected) {
      if (item.browsableOffline && offlineLibraryHasEntries(item.browsableOffline)) {
        // Fall through to the BLE check; otherwise this item is enabled.
      } else {
        return true;
      }
    }
    if (item.disabledOnBle && connectionKind === "ble") return true;
    return false;
  };

  const renderItem = (item: RailItem) => {
    const disabled = itemDisabled(item);
    return (
      <RailButton
        key={item.view}
        item={item}
        active={activeView === item.view}
        disabled={disabled}
        expanded={expanded}
        onClick={() => {
          if (!disabled) setActiveView(item.view);
        }}
      />
    );
  };

  return (
    <nav
      aria-label="Primary navigation"
      className={[
        "flex flex-col justify-between shrink-0 bg-panel border-r border-border-subtle py-2 transition-[width] duration-200 ease-out",
        expanded ? "w-48 items-stretch px-2" : "w-14 items-center",
      ].join(" ")}
    >
      <div className={expanded ? "flex flex-col gap-1" : "flex flex-col items-center gap-1"}>
        <RailToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        {TOP_ITEMS.map(renderItem)}
      </div>
      <div className={expanded ? "flex flex-col gap-1" : "flex flex-col items-center gap-1"}>
        {BOTTOM_ITEMS.map(renderItem)}
      </div>
    </nav>
  );
}

function RailToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const label = expanded ? "Collapse menu" : "Expand menu";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className={[
        "flex items-center rounded-md transition-colors text-muted hover:text-primary hover:bg-surface/40",
        expanded ? "justify-start gap-3 px-2 w-full h-10" : "justify-center w-10 h-10",
      ].join(" ")}
    >
      <Menu size={18} strokeWidth={1.75} />
      {expanded && <span className="text-sm"></span>}
    </button>
  );
}

function RailButton({
  item,
  active,
  disabled,
  expanded,
  onClick,
}: {
  item: RailItem;
  active: boolean;
  disabled: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const { Icon, label } = item;

  const stateClasses = disabled
    ? "text-dim opacity-40 cursor-not-allowed"
    : active
    ? "text-accent bg-surface/60"
    : "text-muted hover:text-primary hover:bg-surface/40";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-current={active && !disabled ? "page" : undefined}
      className={[
        "relative flex items-center rounded-md transition-colors",
        expanded ? "justify-start gap-3 px-2 w-full h-10" : "justify-center w-10 h-10",
        stateClasses,
      ].join(" ")}
    >
      {active && !disabled && (
        <span
          aria-hidden
          className="absolute -left-2 top-2 bottom-2 w-[2px] rounded-r bg-accent"
        />
      )}
      <Icon size={18} strokeWidth={1.75} />
      {expanded && <span className="text-sm truncate">{label}</span>}
    </button>
  );
}
