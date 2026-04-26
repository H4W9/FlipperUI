import { useEffect, useId, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  Wrench,
  RadioTower,
  Tv,
  Nfc,
  Usb,
  LayoutGrid,
  Languages,
  Info,
  MonitorCog,
  X,
  Plus,
} from "lucide-react";
import { DiagPanel } from "../DevTools/DiagPanel";
import { loadSettings, subscribeSettings, updateSettings, type AppSettings } from "../../lib/settings";
import { useDirectorySuggestions } from "../../lib/useDirectorySuggestions";

const IS_MACOS =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const LANGUAGE_OPTIONS = [{ code: "en", label: "English" }];

export function SettingsPane() {
  const [version, setVersion] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    loadSettings().then(setSettings).catch(() => {});
    return subscribeSettings(setSettings);
  }, []);

  const onLanguageChange = async (lang: string) => {
    const next = await updateSettings({ language: lang });
    setSettings(next);
  };

  const onSubghzExcludedChange = async (excludedDirs: string[]) => {
    const next = await updateSettings({ subghz: { excludedDirs } });
    setSettings(next);
  };

  const onInfraredExcludedChange = async (excludedDirs: string[]) => {
    const next = await updateSettings({ infrared: { excludedDirs } });
    setSettings(next);
  };

  const onNfcExcludedChange = async (excludedDirs: string[]) => {
    const next = await updateSettings({ nfc: { excludedDirs } });
    setSettings(next);
  };

  const onBadUsbExcludedChange = async (excludedDirs: string[]) => {
    const next = await updateSettings({ badusb: { excludedDirs } });
    setSettings(next);
  };

  const onAppsExcludedChange = async (excludedDirs: string[]) => {
    const next = await updateSettings({ apps: { excludedDirs } });
    setSettings(next);
  };

  const onAppsExtraChange = async (extraDirs: string[]) => {
    const next = await updateSettings({ apps: { extraDirs } });
    setSettings(next);
  };

  const onTrayEnabledChange = async (enabled: boolean) => {
    const next = await updateSettings({ tray: { enabled } });
    setSettings(next);
    await invoke("set_tray_enabled", { enabled }).catch(() => {});
    // Re-installing the tray rebuilds it from defaults, so re-apply the
    // monochrome preference any time we just turned the tray back on.
    if (enabled && next.tray.monochromeIcon) {
      await invoke("set_tray_monochrome", { monochrome: true }).catch(() => {});
    }
    // If the tray is turned off we also force the dock icon back on — an app
    // with no tray and no dock is unreachable once the window is hidden.
    if (!enabled && next.tray.hideDockIcon) {
      await invoke("set_dock_visible", { visible: true }).catch(() => {});
    } else if (enabled) {
      await invoke("set_dock_visible", {
        visible: !next.tray.hideDockIcon,
      }).catch(() => {});
    }
  };

  const onHideDockChange = async (hideDockIcon: boolean) => {
    const next = await updateSettings({ tray: { hideDockIcon } });
    setSettings(next);
    await invoke("set_dock_visible", { visible: !hideDockIcon }).catch(() => {});
  };

  const onMonochromeIconChange = async (monochromeIcon: boolean) => {
    const next = await updateSettings({ tray: { monochromeIcon } });
    setSettings(next);
    await invoke("set_tray_monochrome", { monochrome: monochromeIcon }).catch(
      () => {},
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-base font-medium text-primary">Settings</h1>
          <span className="text-xs text-dim">
            {version ? `FlipperUI v${version}` : ""}
          </span>
        </header>

        <Section icon={<Info size={13} />} title="About">
          <div className="flex items-center gap-3">
            <img
              src="/flipperui-icon.png"
              alt="FlipperUI"
              width={48}
              height={48}
              className="rounded-lg shadow"
            />
            <div className="flex flex-col text-xs">
              <span className="text-primary font-medium">FlipperUI</span>
              <span className="text-secondary">A Flipper Zero Manager and qFlipper replacement, focused on file browsing and organized libraries for SubGHz, Infrared, NFC and everything else.</span>
              <span className="text-dim italic mt-0.5">in love -maz</span>
            </div>
          </div>
        </Section>

        <Section icon={<Languages size={13} />} title="General">
          <Row label="Language" hint="More languages will arrive with i18n.">
            <select
              value={settings?.language ?? "en"}
              onChange={(e) => onLanguageChange(e.target.value)}
              disabled={!settings}
              className="bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-accent disabled:opacity-50"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section icon={<MonitorCog size={13} />} title="System">
          <Row
            label="Show tray icon"
            hint="Show the FlipperUI icon in the system tray / menubar. Left-click toggles the window; right-click opens Show/Hide/Quit."
          >
            <Toggle
              checked={settings?.tray.enabled ?? true}
              disabled={!settings}
              onChange={onTrayEnabledChange}
              ariaLabel="Show tray icon"
            />
          </Row>
          <Row
            label="Monochrome tray icon"
            hint={
              IS_MACOS
                ? "Use a flat glyph that adopts the menubar's foreground color (light/dark mode aware)."
                : "Use a flat monochrome glyph instead of the full-color icon."
            }
          >
            <Toggle
              checked={settings?.tray.monochromeIcon ?? false}
              disabled={!settings || !settings.tray.enabled}
              onChange={onMonochromeIconChange}
              ariaLabel="Monochrome tray icon"
            />
          </Row>
          {IS_MACOS && (
            <Row
              label="Hide Dock icon"
              hint={
                settings?.tray.enabled
                  ? "Run as a menubar-only app. The tray icon remains the way to reach the window."
                  : "Enable the tray icon first — otherwise the app would be unreachable with the window hidden."
              }
            >
              <Toggle
                checked={settings?.tray.hideDockIcon ?? false}
                disabled={!settings || !settings.tray.enabled}
                onChange={onHideDockChange}
                ariaLabel="Hide Dock icon"
              />
            </Row>
          )}
        </Section>

        <Section icon={<RadioTower size={13} />} title="Sub-GHz">
          <ExcludedDirsEditor
            rootPath="/ext/subghz"
            value={settings?.subghz.excludedDirs ?? []}
            disabled={!settings}
            onChange={onSubghzExcludedChange}
          />
        </Section>

        <Section icon={<Tv size={13} />} title="Infrared">
          <ExcludedDirsEditor
            rootPath="/ext/infrared"
            value={settings?.infrared.excludedDirs ?? []}
            disabled={!settings}
            onChange={onInfraredExcludedChange}
          />
        </Section>

        <Section icon={<Nfc size={13} />} title="NFC">
          <ExcludedDirsEditor
            rootPath="/ext/nfc"
            value={settings?.nfc.excludedDirs ?? []}
            disabled={!settings}
            onChange={onNfcExcludedChange}
          />
        </Section>

        <Section icon={<Usb size={13} />} title="BadUSB">
          <AbsoluteDirListEditor
            heading="Excluded directories"
            description="Paths skipped during the BadUSB / BadKB library scan. Must live under /ext/badusb or /ext/badkb."
            placeholder="/ext/badusb/private"
            disabled={!settings}
            value={settings?.badusb.excludedDirs ?? []}
            onChange={onBadUsbExcludedChange}
          />
        </Section>

        <Section icon={<LayoutGrid size={13} />} title="Apps">
          <AbsoluteDirListEditor
            heading="Additional app directories"
            description="Extra paths to scan for .fap files, in addition to /ext/apps. Must start with /ext, /int, or /any."
            placeholder="/ext/apps_data"
            disabled={!settings}
            value={settings?.apps.extraDirs ?? []}
            reserved={["/ext/apps"]}
            onChange={onAppsExtraChange}
          />
          <AbsoluteDirListEditor
            heading="Excluded directories"
            description="Paths skipped during the app-library scan."
            placeholder="/ext/apps/Examples"
            disabled={!settings}
            value={settings?.apps.excludedDirs ?? []}
            onChange={onAppsExcludedChange}
          />
        </Section>

        <Section icon={<Wrench size={13} />} title="Developer">
          <button
            onClick={() => setDiagOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-surface/60 rounded border border-border-subtle transition-colors text-left"
          >
            <Wrench size={12} />
            <span className="flex-1">Developer diagnostics</span>
            <span className="text-dim">Open →</span>
          </button>
        </Section>
      </div>

      {diagOpen && <DiagPanel onClose={() => setDiagOpen(false)} />}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-panel border border-border-subtle rounded-lg overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle text-xs text-secondary">
        <span className="text-muted">{icon}</span>
        <span className="font-medium text-primary">{title}</span>
      </header>
      <div className="p-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-xs text-primary">{label}</span>
        {hint && <span className="text-[11px] text-dim mt-0.5">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-accent" : "bg-surface"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-primary shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ExcludedDirsEditor({
  rootPath,
  value,
  disabled,
  onChange,
}: {
  rootPath: string;
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const datalistId = useId();
  const suggestions = useDirectorySuggestions(draft, rootPath, {
    exclude: value,
  });

  const prefix = `${rootPath}/`;
  const samplePath = `${rootPath}/private`;

  const add = () => {
    const trimmed = draft.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    if (!trimmed.startsWith(prefix)) {
      setValidationError(`Path must start with ${prefix}`);
      return;
    }
    if (trimmed === rootPath) {
      setValidationError("Cannot exclude the scan root itself");
      return;
    }
    if (trimmed.includes("..")) {
      setValidationError("Path traversal (..) is not allowed");
      return;
    }
    if (value.includes(trimmed)) {
      setValidationError("Already in the list");
      return;
    }
    setValidationError(null);
    setDraft("");
    onChange([...value, trimmed].sort());
  };

  const remove = (path: string) => {
    onChange(value.filter((p) => p !== path));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="text-xs text-primary">Excluded directories</span>
        <span className="text-[11px] text-dim mt-0.5">
          Paths skipped during the library scan. Must live under{" "}
          <code className="text-secondary">{prefix}</code>, e.g.{" "}
          <code className="text-secondary">{samplePath}</code>.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (validationError) setValidationError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          disabled={disabled}
          placeholder={samplePath}
          list={datalistId}
          autoComplete="off"
          className="flex-1 bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <datalist id={datalistId}>
          {suggestions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          onClick={add}
          disabled={disabled || !draft.trim()}
          className="flex items-center gap-1 px-2 py-1 text-xs text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
      {validationError && (
        <span className="text-[11px] text-danger">{validationError}</span>
      )}

      {value.length === 0 ? (
        <span className="text-[11px] text-dim italic">No paths excluded.</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between gap-2 px-2 py-1 bg-surface/50 border border-border-subtle rounded"
            >
              <code className="text-xs text-secondary truncate">{path}</code>
              <button
                onClick={() => remove(path)}
                aria-label={`Remove ${path}`}
                className="p-0.5 text-muted hover:text-danger rounded"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * More permissive sibling of {@link ExcludedDirsEditor}: accepts any absolute
 * Flipper path under `/ext`, `/int`, or `/any`. Used by the Apps section where
 * scan roots and exclusions aren't tied to a single prefix.
 */
function AbsoluteDirListEditor({
  heading,
  description,
  placeholder,
  value,
  disabled,
  reserved,
  onChange,
}: {
  heading: string;
  description: string;
  placeholder: string;
  value: string[];
  disabled: boolean;
  /** Paths that cannot be added (e.g. implicit defaults). */
  reserved?: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const datalistId = useId();
  const suggestions = useDirectorySuggestions(draft, "/ext", {
    exclude: [...value, ...(reserved ?? [])],
  });

  const add = () => {
    const trimmed = draft.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    const ok =
      trimmed.startsWith("/ext/") ||
      trimmed.startsWith("/int/") ||
      trimmed.startsWith("/any/") ||
      trimmed === "/ext" ||
      trimmed === "/int" ||
      trimmed === "/any";
    if (!ok) {
      setValidationError("Path must start with /ext, /int, or /any");
      return;
    }
    if (trimmed.includes("..")) {
      setValidationError("Path traversal (..) is not allowed");
      return;
    }
    if (reserved?.includes(trimmed)) {
      setValidationError(`${trimmed} is already scanned by default`);
      return;
    }
    if (value.includes(trimmed)) {
      setValidationError("Already in the list");
      return;
    }
    setValidationError(null);
    setDraft("");
    onChange([...value, trimmed].sort());
  };

  const remove = (path: string) => {
    onChange(value.filter((p) => p !== path));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="text-xs text-primary">{heading}</span>
        <span className="text-[11px] text-dim mt-0.5">{description}</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (validationError) setValidationError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          disabled={disabled}
          placeholder={placeholder}
          list={datalistId}
          autoComplete="off"
          className="flex-1 bg-surface border border-border-subtle rounded px-2 py-1 text-xs text-primary placeholder:text-dim focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <datalist id={datalistId}>
          {suggestions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          onClick={add}
          disabled={disabled || !draft.trim()}
          className="flex items-center gap-1 px-2 py-1 text-xs text-secondary hover:text-primary border border-border-subtle rounded hover:bg-surface/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
      {validationError && (
        <span className="text-[11px] text-danger">{validationError}</span>
      )}

      {value.length === 0 ? (
        <span className="text-[11px] text-dim italic">No paths configured.</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between gap-2 px-2 py-1 bg-surface/50 border border-border-subtle rounded"
            >
              <code className="text-xs text-secondary truncate">{path}</code>
              <button
                onClick={() => remove(path)}
                aria-label={`Remove ${path}`}
                className="p-0.5 text-muted hover:text-danger rounded"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
