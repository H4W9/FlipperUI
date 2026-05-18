import { useEffect, useRef, type ReactNode } from "react";

export type MenuItem =
  | { type: "separator" }
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      onClick: () => void;
      danger?: boolean;
    };

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 160;
const ITEM_HEIGHT = 28;
const SEPARATOR_HEIGHT = 9;
const PADDING_Y = 8;

function estimateHeight(items: MenuItem[]): number {
  let h = PADDING_Y;
  for (const it of items) {
    h += it.type === "separator" ? SEPARATOR_HEIGHT : ITEM_HEIGHT;
  }
  return h;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const menuH = estimateHeight(items);
  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 50,
    left: x + MENU_WIDTH > winW ? winW - MENU_WIDTH - 4 : x,
    top: y + menuH > winH ? winH - menuH - 4 : y,
  };

  const itemCls =
    "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-elevated cursor-pointer rounded transition-colors";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Context menu"
      style={style}
      className="w-40 bg-surface border border-elevated rounded shadow-xl py-1 text-primary"
    >
      {items.map((item, i) => {
        if (item.type === "separator") {
          return (
            <div
              key={`sep-${i}`}
              className="my-1 border-t border-elevated"
              role="separator"
            />
          );
        }
        const cls = item.danger
          ? `${itemCls} text-danger hover:text-danger/80 hover:bg-danger/10`
          : itemCls;
        return (
          <div
            key={`${item.label}-${i}`}
            role="menuitem"
            className={cls}
            onMouseDown={(e) => {
              e.preventDefault();
              item.onClick();
              onClose();
            }}
          >
            {item.icon && (
              <span className={item.danger ? "" : "text-secondary"}>
                {item.icon}
              </span>
            )}
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
