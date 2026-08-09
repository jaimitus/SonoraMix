/**
 * Settings drawer — sliding panel for appearance + behavior preferences.
 * Opened from the gear button in the header. Includes a shortcut recorder
 * that captures a key combination (with at least one modifier) to assign it
 * to an action.
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

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  appVersion: string;
  /** Whether we're inside the Tauri webview (autostart etc. only apply there) */
  desktop: boolean;
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
}: SettingsDrawerProps) {
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
      label: "Toggle microphone mute",
      description: "Mute/unmute the system mic from anywhere.",
    },
    {
      action: "toggleWindow",
      label: "Show / hide window",
      description: "Summon or hide SonoraMix from anywhere.",
    },
  ];

  const ledSizes: { id: LedSize; label: string }[] = [
    { id: "compact", label: "Compact" },
    { id: "standard", label: "Standard" },
    { id: "large", label: "Large" },
  ];

  const setZoneColor = (zone: keyof MeterColors, value: string) =>
    onUpdate("meters", { ...settings.meters, colors: { ...settings.meters.colors, [zone]: value } });

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
            <h2 className="font-display text-[14px] font-bold tracking-tight text-ink-100">SETTINGS</h2>
            <p className="typo-caption mt-0.5 text-[9px]">SonoraMix preferences</p>
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
          {/* Appearance */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">Appearance</h3>
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
            <p className="mt-2 text-[10px] leading-snug text-ink-500">
              Accent color for the whole console (outputs, master, buttons).
            </p>
          </section>

          {/* Meters */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">VU Meters</h3>

            {/* Color presets */}
            <p className="mb-1.5 text-[10px] font-semibold text-ink-300">Color preset</p>
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
            <p className="mt-3 mb-1.5 text-[10px] font-semibold text-ink-300">Custom colors</p>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  { zone: "green", label: "Green zone", color: settings.meters.colors.green },
                  { zone: "amber", label: "Amber zone", color: settings.meters.colors.amber },
                  { zone: "red", label: "Red zone", color: settings.meters.colors.red },
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
              <span>Brightness</span>
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
              <span>50% · subtle</span>
              <span>100%</span>
              <span>150% · hot</span>
            </div>

            {/* LED size */}
            <p className="mt-3 mb-1.5 text-[10px] font-semibold text-ink-300">LED segment size</p>
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
                label="Show peak-hold line"
                description="Keep a bright line at the loudest level reached."
              />
            </div>
          </section>

          {/* Behavior */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">Behavior</h3>
            <div className="space-y-2">
              <Toggle
                checked={settings.closeToTray}
                onChange={(v) => onUpdate("closeToTray", v)}
                label="Minimize to tray on close"
                description="Keep running in the background when you close the window."
              />
              <Toggle
                checked={settings.launchMinimized}
                onChange={(v) => onUpdate("launchMinimized", v)}
                label="Start minimized to tray"
                description="Launch SonoraMix quietly in the background."
              />
              <Toggle
                checked={settings.autostart}
                onChange={(v) => onUpdate("autostart", v)}
                disabled={!desktop}
                label="Launch at Windows startup"
                description={
                  desktop
                    ? "Start SonoraMix automatically when you log in."
                    : "Only available in the desktop app."
                }
              />
            </div>
          </section>

          {/* Global Shortcuts */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">Global Shortcuts</h3>
            <div className="space-y-2">
              {shortcutRows.map(({ action, label, description }) => {
                const isRecording = recording === action;
                return (
                  <div key={action} className={`toggle-row ${isRecording ? "border-route/50" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold tracking-tight text-ink-100">{label}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-ink-500">
                        {isRecording ? "Press your combination… (Esc to cancel)" : description}
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
            <p className="mt-2 text-[10px] leading-snug text-ink-500">
              Click a shortcut to record a new combination (needs a modifier key). If it's already
              used by another app, it won't be assigned.
            </p>
          </section>

          {/* About */}
          <section>
            <h3 className="typo-caption mb-2.5 text-[10px] font-bold">About</h3>
            <div className="rounded-lg bg-ink-950/70 border border-rule px-3 py-2.5">
              <p className="text-[12px] font-semibold text-ink-100">
                Sonora<span className="text-signal">Mix</span> v{appVersion}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-ink-500">
                Native WASAPI audio session console · Rust + React (Tauri 2).
                <br />
                Per-app volume, mute, 60 Hz metering & endpoint routing.
              </p>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
