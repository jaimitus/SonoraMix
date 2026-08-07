/**
 * Premium status bar — stream cadence, frame counter, session count,
 * master RMS, uptime, and WASAPI MTA status.
 */
import type { EngineMode } from "../types";

interface StatusBarProps {
  mode: EngineMode;
  streaming: boolean;
  hz: number;
  frames: number;
  sessions: number;
  masterDb: string;
  startedAt: number;
}

function formatUptime(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function StatusBar({
  streaming,
  hz,
  frames,
  sessions,
  masterDb,
  startedAt,
}: StatusBarProps) {
  return (
    <footer
      className="sticky bottom-0 z-30 border-t border-rule"
      style={{ background: "rgba(13,15,18,0.92)" }}
      role="status"
      aria-label="Engine telemetry"
    >
      <div className="mx-auto max-w-[1480px] px-4 py-2 pt-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`led ${streaming ? "led-green" : "led-amber"}`} />
            <span className="typo-monoline text-[11px]">
              Stream {hz.toFixed(1)} Hz
            </span>
          </div>

          <div className="typo-monoline text-[11px] text-ink-300">
            {sessions} active session{sessions !== 1 ? "s" : ""}
          </div>

          <div className="hidden sm:flex typo-monoline text-[11px] text-ink-300">
            {frames.toLocaleString("en-US")} frames
          </div>

          <div className="hidden md:flex items-center gap-1.5">
            <span className="typo-monoline text-[11px] text-ink-500">Master</span>
            <DbReadoutMaster value={masterDb} />
          </div>

          <div className="typo-monoline text-[11px] text-ink-300">
            UP {formatUptime(startedAt)}
          </div>

          <div
            className="ml-auto rounded px-2 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase text-led-green border border-led-green/25 bg-led-green/[0.04]"
          >
            WASAPI · COM-MTA
          </div>
        </div>
      </div>
    </footer>
  );
}

function DbReadoutMaster({ value }: { value: string }) {
  return (
    <span className="typo-number text-[11px] text-ink-100" aria-label={`Master level ${value} dBFS`}>
      {value} dBFS
    </span>
  );
}
