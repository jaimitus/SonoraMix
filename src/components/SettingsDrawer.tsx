/**
 * Settings drawer — sliding panel for appearance + behavior preferences.
 * Opened from the gear button in the header.
 */
import { ACCENTS, type AppSettings } from "../settings";

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  appVersion: string;
  /** Whether we're inside the Tauri webview (autostart etc. only apply there) */
  desktop: boolean;
}

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

export default function SettingsDrawer({
  open,
  settings,
  onClose,
  onUpdate,
  appVersion,
  desktop,
}: SettingsDrawerProps) {
  if (!open) return null;

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
