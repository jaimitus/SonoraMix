/**
 * SonoraMix header — clean glass panel with logo, separate Output and Input
 * device selectors, engine status badge, and tray minimize button.
 * Now shows disabled devices and allows enabling/disabling them.
 */
import type { AudioDeviceInfo, EngineMode } from "../types";
import { useT } from "../i18n";

interface HeaderProps {
  devices: AudioDeviceInfo[];
  outputDeviceId: string;
  inputDeviceId: string;
  onOutputDevice: (id: string) => void;
  onInputDevice: (id: string) => void;
  onToggleDevice: (deviceId: string, enabled: boolean) => void;
  mode: EngineMode;
  streaming: boolean;
  onTray: () => void;
  onOpenSettings: () => void;
  onCheckUpdates: () => void;
  checkingUpdates: boolean;
  downloading: boolean;
  updateAvailable: boolean;
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="#0e1013"
        stroke="rgba(255,255,255,0.08)"
      />
      <rect x="7" y="13" width="4" height="11" rx="1.5" fill="#eef0f3" />
      <rect x="14" y="7" width="4" height="17" rx="1.5" fill="#ff7940" />
      <rect x="21" y="16" width="4" height="8" rx="1.5" fill="#33d1b8" />
      <circle cx="23" cy="9" r="1.8" fill="#3fe082" />
    </svg>
  );
}

export default function Header({
  devices,
  outputDeviceId,
  inputDeviceId,
  onOutputDevice,
  onInputDevice,
  onToggleDevice,
  streaming,
  onTray,
  onOpenSettings,
  onCheckUpdates,
  checkingUpdates,
  downloading,
  updateAvailable,
}: HeaderProps) {
  const t = useT();
  const outputDevices = devices.filter((d) => d.flow !== "capture");
  const inputDevices = devices.filter((d) => d.flow === "capture");

  // Find the currently selected input device to show enable/disable toggle
  const selectedInput = inputDevices.find((d) => d.id === inputDeviceId);

  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="glass-panel mt-3 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1552px] items-center justify-between gap-2.5 sm:gap-4">
            <div className="flex items-center gap-3">
              <LogoMark className="h-[28px] w-[28px]" />
              <div className="leading-none">
                <p className="font-medium text-[15px] tracking-tight text-ink-100">
                  Sonora<span className="text-signal">Mix</span>
                </p>
                <p className="typo-caption mt-0.5">{t("header.tagline")}</p>
              </div>
            </div>

            <div className="flex-1" />

            {/* Separate Output & Input Device Selectors */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Output Playback Device Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="typo-caption text-signal font-bold flex items-center gap-1">
                  <span>🔊</span> {t("header.output")}
                </span>
                <select
                  id="header-output-device"
                  name="output-device"
                  value={outputDeviceId}
                  onChange={(e) => onOutputDevice(e.target.value)}
                  aria-label="Select audio playback output device"
                  className="max-w-[240px] truncate text-[11px]"
                >
                  {outputDevices.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.enabled}>
                      {!d.enabled ? "⛔ " : ""}{d.name} {d.formFactor && d.formFactor !== "Speakers" ? ` · ${d.formFactor}` : ""}
                      {!d.enabled ? " [DISABLED]" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Microphone Device Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="typo-caption text-route font-bold flex items-center gap-1">
                  <span>🎙️</span> {t("header.mic")}
                </span>
                <select
                  id="header-input-device"
                  name="input-device"
                  value={inputDeviceId}
                  onChange={(e) => onInputDevice(e.target.value)}
                  aria-label="Select microphone recording device"
                  className="max-w-[240px] truncate text-[11px]"
                >
                  {inputDevices.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.enabled}>
                      {!d.enabled ? "⛔ " : ""}{d.name} {d.formFactor ? ` · ${d.formFactor}` : ""}
                      {!d.enabled ? " [DISABLED]" : ""}
                    </option>
                  ))}
                </select>

                {/* Enable/Disable button for the currently selected input device */}
                {selectedInput && (
                  <button
                    type="button"
                    onClick={() => onToggleDevice(selectedInput.id, !selectedInput.enabled)}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold border transition-all cursor-pointer ${
                      selectedInput.enabled
                        ? "bg-green-900/30 text-green-400 border-green-500/40 hover:bg-green-800/40"
                        : "bg-red-900/30 text-red-400 border-red-500/40 hover:bg-red-800/40"
                    }`}
                    title={selectedInput.enabled ? "Disable this microphone in Windows" : "Enable this microphone in Windows"}
                  >
                    {selectedInput.enabled ? "✅ ON" : "❌ OFF"}
                  </button>
                )}
              </div>
            </div>

            <div
              className="flex h-7 items-center gap-2 rounded-md bg-ink-50 px-2.5 py-0.5"
              style={{ opacity: 0.96 }}
              role="status"
              aria-label={streaming ? "WASAPI engine live" : "WASAPI engine standby"}
            >
              <span className={`led ${streaming ? "led-green" : "led-amber"}`} />
              <span className="text-[11px] font-medium text-ink-300">
                {streaming ? t("header.wasapiLive") : t("header.wasapiStandby")}
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenSettings}
              className="btn btn-ghost"
              title="Settings"
              aria-label="Open settings"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <circle cx="8" cy="8" r="2" />
                <path
                  d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
                  strokeLinecap="round"
                />
              </svg>
              <span className="hidden sm:inline text-[12px]">{t("header.settings")}</span>
            </button>

            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={checkingUpdates || downloading}
              className={`btn relative disabled:cursor-default disabled:opacity-60 ${
                updateAvailable ? "btn-primary" : "btn-ghost"
              }`}
              title={
                checkingUpdates
                  ? "Checking for updates…"
                  : downloading
                    ? "Downloading update…"
                    : updateAvailable
                      ? "A new version is available — check again"
                      : "Check for updates on GitHub"
              }
              aria-label="Check for updates"
            >
              {checkingUpdates || downloading ? (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  aria-hidden="true"
                >
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  aria-hidden="true"
                >
                  <path
                    d="M4.5 6.5A3.5 3.5 0 1 1 8 3a3.5 3.5 0 0 1 4 2.5A2.5 2.5 0 0 1 12 10.5H10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M8 8v4M6.2 10.2 8 12l1.8-1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span className="hidden sm:inline text-[12px]">
                {downloading ? t("header.updating") : checkingUpdates ? t("header.checking") : updateAvailable ? t("header.update") : t("header.updates")}
              </span>
              {updateAvailable && <span className="led led-green led-pulse" aria-hidden="true" />}
            </button>

            <button
              type="button"
              onClick={onTray}
              className="btn btn-ghost"
              title="Minimize to system tray"
              aria-label="Minimize to system tray"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />
                <path d="M1.5 10h4l1.2 2h2.6l1.2-2h4" strokeLinejoin="round" />
                <path d="M8 4v4M6.4 6.6L8 8.2l1.6-1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden sm:inline text-[12px]">{t("header.tray")}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
