/**
 * Device bus meters — real hardware level of the default output and input
 * endpoints (post-device-volume), independent of per-app sessions.
 *
 * The input meter is especially useful: it shows the actual microphone level
 * even when no app currently holds an open capture session.
 */
import type { LevelSource } from "../types";
import VumeterCanvas, { DbReadout } from "./VumeterCanvas";

interface DeviceMetersProps {
  outputSource: LevelSource;
  inputSource: LevelSource;
  outputName: string;
  inputName: string;
  outputMuted: boolean;
}

function Row({
  label,
  name,
  source,
  muted,
  accent,
}: {
  label: string;
  name: string;
  source: LevelSource;
  muted: boolean;
  accent: "signal" | "route";
}) {
  const signal = accent === "signal";
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-md border ${
          signal ? "border-signal/25 bg-signal/10 text-signal" : "border-route/25 bg-route/10 text-route"
        }`}
        aria-hidden="true"
      >
        {signal ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 2v9" strokeLinecap="round" />
            <path d="M5.5 5.5v2M10.5 5.5v2" strokeLinecap="round" />
            <path d="M3.5 7a4.5 4.5 0 0 0 9 0" strokeLinecap="round" />
            <path d="M8 11.5V14M5.5 14h5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="5.5" y="2" width="5" height="9" rx="2.5" />
            <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" strokeLinecap="round" />
            <path d="M8 12v2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="w-[132px] min-w-0 flex-none">
        <p
          className={`text-[9px] font-bold uppercase tracking-widest ${
            signal ? "text-signal" : "text-route"
          }`}
        >
          {label}
        </p>
        <p className="truncate text-[10px] text-ink-300" title={name}>
          {name || "—"}
        </p>
      </div>
      <div className="meter-face h-8 min-w-0 flex-1">
        <VumeterCanvas source={source} channels={2} className="h-full w-full" />
      </div>
      <DbReadout
        source={source}
        muted={() => muted}
        className="typo-number w-[52px] flex-none text-right text-[11px] text-ink-100"
      />
    </div>
  );
}

export default function DeviceMeters({
  outputSource,
  inputSource,
  outputName,
  inputName,
  outputMuted,
}: DeviceMetersProps) {
  return (
    <section className="glass-panel rounded-xl px-5 py-3.5" aria-label="Device bus meters">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-ink-900 text-[10px]" aria-hidden="true">
          📟
        </span>
        <h2 className="font-display text-[11px] font-bold tracking-widest text-ink-300">
          DEVICE BUS METERS
        </h2>
        <span className="typo-caption dim text-[8px]">actual hardware level — post device volume</span>
      </div>
      <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        <Row label="Output Device" name={outputName} source={outputSource} muted={outputMuted} accent="signal" />
        <Row label="Input Device" name={inputName} source={inputSource} muted={false} accent="route" />
      </div>
    </section>
  );
}
