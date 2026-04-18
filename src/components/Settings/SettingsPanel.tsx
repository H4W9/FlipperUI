import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { X, Wrench } from "lucide-react";
import { DiagPanel } from "../DevTools/DiagPanel";

/**
 * Mount once at the top level. Listens for the "open-settings" event emitted
 * by the native menu (Cmd+, / FlipperUI → Settings…) and shows a panel with
 * app metadata plus settings/devtools entry points.
 */
export function SettingsRoot() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("open-settings", () => setSettingsOpen(true)).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  return (
    <>
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onOpenDiag={() => {
            setSettingsOpen(false);
            setDiagOpen(true);
          }}
        />
      )}
      {diagOpen && <DiagPanel onClose={() => setDiagOpen(false)} />}
    </>
  );
}

function SettingsPanel({
  onClose,
  onOpenDiag,
}: {
  onClose: () => void;
  onOpenDiag: () => void;
}) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    // Pull the version from the Tauri bundle rather than hard-coding — keeps
    // the About pane in sync with Cargo.toml / tauri.conf.json.
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] bg-panel border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface/50">
          <span className="text-sm text-primary font-medium">Settings</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-muted hover:text-primary rounded transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2 px-6 pt-6 pb-4">
          <img
            src="/flipperui-icon.png"
            alt="FlipperUI"
            width={96}
            height={96}
            className="rounded-xl shadow-lg"
          />
          <div className="text-lg font-semibold text-primary mt-1">FlipperUI</div>
          <div className="text-xs text-dim">
            {version ? `Version ${version}` : "Version —"}
          </div>
          <div className="text-xs text-secondary italic mt-3">in love —maz</div>
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={onOpenDiag}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-surface/60 rounded border border-border-subtle transition-colors text-left"
          >
            <Wrench size={12} />
            <span className="flex-1">Developer diagnostics</span>
            <span className="text-dim">Open →</span>
          </button>
        </div>

        <div className="px-4 py-3 border-t border-border-subtle text-[11px] text-dim">
          A qFlipper replacement, focused on file browsing. More settings will land here.
        </div>
      </div>
    </div>
  );
}
