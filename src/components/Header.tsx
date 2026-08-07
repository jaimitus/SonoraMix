/**
 * SonoraMix header — clean glass panel with logo, separate Output and Input
 * device selectors, engine status badge, and tray minimize button.
 */
import type { AudioDeviceInfo, EngineMode } from "../types";

interface HeaderProps {
  devices: AudioDeviceInfo[];
  outputDeviceId: string;
  inputDeviceId: string;
  onOutputDevice: (id: string) => void;
  onInputDevice: (id: string) => void;
  mode: EngineMode;
  streaming: boolean;
  onTray: () => void;
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
  streaming,
  onTray,
}: HeaderProps) {
  const outputDevices = devices.filter((d) => d.flow !== "capture");
  const inputDevices = devices.filter((d) => d.flow === "capture");

  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto max-w-[1480px] px-4 sm:px-6">
        <div className="glass-panel mt-3 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1432px] items-center justify-between gap-2.5 sm:gap-4">
            <div className="flex items-center gap-3">
              <LogoMark className="h-[28px] w-[28px]" />
              <div className="leading-none">
                <p className="font-medium text-[15px] tracking-tight text-ink-100">
                  Sonora<span className="text-signal">Mix</span>
                </p>
                <p className="typo-caption mt-0.5">Audio Session Console</p>
              </div>
            </div>

            <div className="flex-1" />

            {/* Separate Output & Input Device Selectors */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Output Playback Device Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="typo-caption text-signal font-bold flex items-center gap-1">
                  <span>🔊</span> Output
                </span>
                <select
                  value={outputDeviceId}
                  onChange={(e) => onOutputDevice(e.target.value)}
                  aria-label="Select audio playback output device"
                  className="max-w-[200px] truncate text-[11px]"
                >
                  {outputDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.formFactor && d.formFactor !== "Speakers" ? ` · ${d.formFactor}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Microphone Device Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="typo-caption text-route font-bold flex items-center gap-1">
                  <span>🎙️</span> Mic
                </span>
                <select
                  value={inputDeviceId}
                  onChange={(e) => onInputDevice(e.target.value)}
                  aria-label="Select microphone recording device"
                  className="max-w-[200px] truncate text-[11px]"
                >
                  {inputDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.formFactor ? ` · ${d.formFactor}` : ""}
                    </option>
                  ))}
                </select>
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
                {streaming ? "WASAPI LIVE" : "WASAPI STANDBY"}
              </span>
            </div>

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
              <span className="hidden sm:inline text-[12px]">Tray</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
