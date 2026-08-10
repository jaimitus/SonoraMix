/**
 * Settings drawer — sliding panel for appearance + behavior preferences.
 * Opened from the gear button in the header. Includes a shortcut recorder
 * that captures a key combination (with at least one modifier) to assign it
 * to an action.
 *
 * v1.2.0: language selector (EN/ES), auto-duck controls and config backup
 * export/import.
 */
import { useEffect, useState } from "react";
import {
  ACCENTS,
  DEFAULT_SHORTCUTS,
  METER_PRESETS,
  type AppSettings,
  type LedSize,
  type MeterColors,
  type Shortcuts,
} from "../settings";
import { useT, type Lang } from "../i18n";

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  appVersion: string;
  /** Whether we're inside the Tauri webview (autostart etc. only apply there) */
  desktop: boolean;
  /** Export the full configuration to a JSON backup file */
  onExport: () => void;
  /** Import a configuration backup file */
  onImport: () => void;
}

type ShortcutAction = keyof Shortcuts;

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <div
      className="toggle-row"
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <div className="min-w-0">
        <p className="text-[12px] font-semibold tracking-tight text-ink-100">{label}</p>
        {description && <p className="mt-0.5 text-[10px] leading-snug text-ink-500">{description}</p>}
      </div>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-signal/80" : "bg-ink-800 border border-rule"
        } ${disabled ? "opacity-40" : ""}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-100 shadow transition-all duration-200 ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </div>
  );
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Normalize a KeyboardEvent key to an accelerator token (or null to ignore). */
function normalizeKey(key: string): string | null {
  if (key === " ") return "Space";
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  return null;
}

/** Build an accelerator string ("Ctrl+Shift+M") from a KeyboardEvent, or null. */
function comboFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");
  if (mods.length === 0) return null; // require at least one modifier
  const key = normalizeKey(e.key);
  if (!key) return null;
  return [...mods, key].join("+");
}

export default function SettingsDrawer({
  open,
  settings,
  onClose,
  onUpdate,
  appVersion,
  desktop,
  onExport,
  onImport,
}: SettingsDrawerProps) {
  const t = useT();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  // Capture the key combination while recording (before other handlers).
  useEffect(() => {
    if (!open || !recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return; // wait for the actual key
      const combo = comboFromEvent(e);
      if (!combo) return;
      onUpdate("shortcuts", { ...settings.shortcuts, [recording]: combo });
      setRecording(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, recording, settings.shortcuts, onUpdate]);

  if (!open) return null;

  const shortcutRows: { action: ShortcutAction; label: string; description: string }[] = [
    {
      action: "micMute",
      label: t("settings.shortcutMic"),
      description: t("settings.shortcutMicDesc"),
    },
    {
      action: "toggleWindow",
      label: t("settings.shortcutWindow"),
      description: t("settings.shortcutWindowDesc"),
    },
  ];

  const ledSizes: { id: LedSize; label: string }[] = [
    { id: "compact", label: "Compact" },
    { id: "standard", label: "Standard" },
    { id: "large", label: "Large" },
  ];

  const setZoneColor = (zone: keyof MeterColors, value: string) =>
    onUpdate("meters", { ...settings.meters, colors: { ...settings.meters.colors, [zone]: value } });

  const languages: { id: Lang; label: string }[] = [
    { id: "en", label: "English" },
    { id: "es", label: "Español" },
  ];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer-panel flex flex-col overflow-hidden border-l border-rule"
        style={{ background: "rgba(13, 15, 18, 0.96)", backdropFilter: "blur(20px)" }}
        role="dialog"
        aria-modal="true"
        aria-label="SonoraMix settings"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <div>
            <h2 className="font-display text-[14px] font-bold tracking-tight text-ink-100">{t("settings.title")}</h2>
            <p className="typo-caption mt-0.5 text-[9px]">{t("settings.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="btn btn-ghost h-7 w-7 p-0"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Language */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.language")}</h3>
            <div className="flex items-center gap-1.5 rounded-lg border border-rule bg-ink-900/70 p-1">
              {languages.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onUpdate("language", l.id)}
                  aria-pressed={settings.language === l.id}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold tracking-wide transition-all ${
                    settings.language === l.id
                      ? "bg-route/20 text-route border border-route/40"
                      : "text-ink-300 hover:text-ink-100"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          {/* Appearance */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.appearance")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onUpdate("accent", a.id)}
                  title={a.label}
                  aria-label={`${a.label} accent theme`}
                  className={`accent-swatch flex flex-col items-center justify-center gap-1 ${settings.accent === a.id ? "active" : ""}`}
                  style={{
                    background: `linear-gradient(135deg, ${a.signal} 0%, ${a.signal}33 55%, ${a.route}33 100%)`,
                  }}
                >
                  <span className="text-[9px] font-bold tracking-wide" style={{ color: "#0b0d0f" }}>
                    {a.label.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-ink-500">{t("settings.accentDesc")}</p>
          </section>

          {/* Meters */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.meters")}</h3>

            {/* Color presets */}
            <p className="mb-1.5 text-[10px] font-semibold text-ink-300">{t("settings.metersPreset")}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {METER_PRESETS.map((p) => {
                const active =
                  settings.meters.colors.green === p.colors.green &&
                  settings.meters.colors.amber === p.colors.amber &&
                  settings.meters.colors.red === p.colors.red;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onUpdate("meters", { ...settings.meters, colors: { ...p.colors } })}
                    title={`${p.label} meter colors`}
                    aria-label={`${p.label} meter color preset`}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-all ${
                      active
                        ? "border-route/60 bg-route/10"
                        : "border-rule bg-ink-900/70 hover:border-rule-strong"
                    }`}
                  >
                    <span className="flex h-2 w-full items-stretch gap-0.5" aria-hidden="true">
                      <span className="flex-1 rounded-sm" style={{ background: p.colors.green }} />
                      <span className="flex-1 rounded-sm" style={{ background: p.colors.amber }} />
                      <span className="flex-1 rounded-sm" style={{ background: p.colors.red }} />
                    </span>
                    <span className="text-[8px] font-bold uppercase tracking-wider text-ink-300">
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Per-zone custom colors */}
            <p className="mt-3 mb-1.5 text-[10px] font-semibold text-ink-300">{t("settings.metersCustom")}</p>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  { zone: "green", label: t("settings.metersGreen"), color: settings.meters.colors.green },
                  { zone: "amber", label: t("settings.metersAmber"), color: settings.meters.colors.amber },
                  { zone: "red", label: t("settings.metersRed"), color: settings.meters.colors.red },
                ] as { zone: keyof MeterColors; label: string; color: string }[]
              ).map(({ zone, label, color }) => (
                <label
                  key={zone}
                  className="flex items-center justify-between gap-3 rounded-md border border-rule bg-ink-900/70 px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2 text-[11px] text-ink-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                    {label}
                  </span>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setZoneColor(zone, e.target.value)}
                    aria-label={`${label} color`}
                    className="meter-color-input h-6 w-9 cursor-pointer rounded border border-rule bg-transparent"
                  />
                </label>
              ))}
            </div>

            {/* Brightness slider */}
            <p className="mt-3 mb-1.5 flex items-center justify-between text-[10px] font-semibold text-ink-300">
              <span>{t("settings.metersBrightness")}</span>
              <span className="font-mono text-ink-100">{Math.round(settings.meters.brightness * 100)}%</span>
            </p>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.meters.brightness}
              onChange={(e) => onUpdate("meters", { ...settings.meters, brightness: Number(e.target.value) })}
              aria-label="Meter brightness"
              className="meter-range w-full"
            />
            <div className="mt-0.5 flex justify-between text-[8px] text-ink-500">
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
            </div>

            {/* LED size */}
            <p className="mt-3 mb-1.5 text-[10px] font-semibold text-ink-300">{t("settings.metersLedSize")}</p>
            <div className="flex items-center gap-1.5 rounded-lg border border-rule bg-ink-900/70 p-1">
              {ledSizes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUpdate("meters", { ...settings.meters, ledSize: s.id })}
                  aria-pressed={settings.meters.ledSize === s.id}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold tracking-wide transition-all ${
                    settings.meters.ledSize === s.id
                      ? "bg-route/20 text-route border border-route/40"
                      : "text-ink-300 hover:text-ink-100"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Peak-hold toggle */}
            <div className="mt-3">
              <Toggle
                checked={settings.meters.showPeakHold}
                onChange={(v) => onUpdate("meters", { ...settings.meters, showPeakHold: v })}
                label={t("settings.metersPeakHold")}
                description={t("settings.metersPeakHoldDesc")}
              />
            </div>
          </section>

          {/* Behavior */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.behavior")}</h3>
            <div className="space-y-2">
              <Toggle
                checked={settings.closeToTray}
                onChange={(v) => onUpdate("closeToTray", v)}
                label={t("settings.closeToTray")}
                description={t("settings.closeToTrayDesc")}
              />
              <Toggle
                checked={settings.launchMinimized}
                onChange={(v) => onUpdate("launchMinimized", v)}
                label={t("settings.launchMinimized")}
                description={t("settings.launchMinimizedDesc")}
              />
              <Toggle
                checked={settings.autostart}
                onChange={(v) => onUpdate("autostart", v)}
                disabled={!desktop}
                label={t("settings.autostart")}
                description={desktop ? t("settings.autostartDesc") : t("settings.autostartDesktop")}
              />
            </div>
          </section>

          {/* Auto-Duck (v1.2.0) */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("ducking.section")}</h3>
            <div className="space-y-2.5 rounded-lg border border-rule bg-ink-900/50 px-3 py-3">
              <Toggle
                checked={settings.ducking.enabled}
                onChange={(v) => onUpdate("ducking", { ...settings.ducking, enabled: v })}
                label={t("ducking.title")}
                description={t("ducking.desc")}
              />
              {settings.ducking.enabled && (
                <>
                  {/* Mic threshold */}
                  <p className="mb-1 mt-2 flex items-center justify-between text-[10px] font-semibold text-ink-300">
                    <span>{t("ducking.threshold")}</span>
                    <span className="font-mono text-ink-100">{Math.round(settings.ducking.threshold * 100)}%</span>
                  </p>
                  <input
                    type="range"
                    min={0.02}
                    max={0.5}
                    step={0.01}
                    value={settings.ducking.threshold}
                    onChange={(e) => onUpdate("ducking", { ...settings.ducking, threshold: Number(e.target.value) })}
                    aria-label={t("ducking.threshold")}
                    className="meter-range w-full"
                  />
                  {/* Duck amount */}
                  <p className="mb-1 mt-2 flex items-center justify-between text-[10px] font-semibold text-ink-300">
                    <span>{t("ducking.amount")}</span>
                    <span className="font-mono text-ink-100">{t("ducking.amountDb", { db: `-${settings.ducking.amountDb}` })}</span>
                  </p>
                  <input
                    type="range"
                    min={3}
                    max={30}
                    step={1}
                    value={settings.ducking.amountDb}
                    onChange={(e) => onUpdate("ducking", { ...settings.ducking, amountDb: Number(e.target.value) })}
                    aria-label={t("ducking.amount")}
                    className="meter-range w-full"
                  />
                </>
              )}
            </div>
          </section>

          {/* Global Shortcuts */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.shortcuts")}</h3>
            <div className="space-y-2">
              {shortcutRows.map(({ action, label, description }) => {
                const isRecording = recording === action;
                return (
                  <div key={action} className={`toggle-row ${isRecording ? "border-route/50" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold tracking-tight text-ink-100">{label}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-ink-500">
                        {isRecording ? t("settings.shortcutRecording") : description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRecording(isRecording ? null : action)}
                        aria-label={`${label}, current shortcut ${settings.shortcuts[action]}, click to record`}
                        title="Click to record a new combination"
                        className={`flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          isRecording
                            ? "border-route/50 bg-route/10 text-route"
                            : "border-rule-strong bg-ink-900 text-ink-100 hover:border-route/40"
                        }`}
                      >
                        {isRecording ? (
                          <>
                            <span className="led led-amber led-pulse" style={{ width: "5px", height: "5px" }} />
                            REC…
                          </>
                        ) : (
                          settings.shortcuts[action]
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdate("shortcuts", { ...settings.shortcuts, [action]: DEFAULT_SHORTCUTS[action] })}
                        title="Reset to default shortcut"
                        aria-label={`Reset ${label} shortcut to default`}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
                      >
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d="M13 8a5 5 0 1 1-1.5-3.5" strokeLinecap="round" />
                          <path d="M13 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-ink-500">{t("settings.shortcutHint")}</p>
          </section>

          {/* Backup (v1.2.0) */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.data")}</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={onExport}
                className="flex w-full items-center gap-2.5 rounded-lg border border-rule bg-ink-900/70 px-3 py-2.5 text-left transition-colors hover:border-route/40 hover:bg-ink-900"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-route/15 text-route">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M8 2.5v7M5.4 7 8 9.6 10.6 7" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 11.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink-100">{t("settings.export")}</span>
                  <span className="block text-[10px] leading-snug text-ink-500">{t("settings.exportDesc")}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={onImport}
                className="flex w-full items-center gap-2.5 rounded-lg border border-rule bg-ink-900/70 px-3 py-2.5 text-left transition-colors hover:border-route/40 hover:bg-ink-900"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-signal/15 text-signal">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M8 10.5v-7M5.4 6 8 3.4 10.6 6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 11.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink-100">{t("settings.import")}</span>
                  <span className="block text-[10px] leading-snug text-ink-500">{t("settings.importDesc")}</span>
                </span>
              </button>
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">{t("settings.about")}</h3>
            <div className="rounded-lg bg-ink-950/70 border border-rule px-3 py-2.5">
              <p className="text-[12px] font-semibold text-ink-100">
                Sonora<span className="text-signal">Mix</span> v{appVersion}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-ink-500">{t("settings.aboutDesc")}</p>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
