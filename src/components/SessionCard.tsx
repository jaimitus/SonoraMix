/**
 * Session channel strip — authentic studio hardware channel strip.
 * Fixed 240px module width to guarantee 100% layout stability on window resize.
 *
 * Anatomy:
 *   - Top: App Icon + Name + Mic/Mute badges
 *   - Center: Vertical Fader (76px) | dB Scale (28px) | Dual Stereo PPM Meter (76px)
 *   - Bottom: Mute Toggle + live dBFS readout
 */
import { useMemo, useRef } from "react";
import type { AudioSessionInfo, LevelSource } from "../types";
import Fader from "./Fader";
import VumeterCanvas, { DbReadout } from "./VumeterCanvas";

interface SessionCardProps {
  session: AudioSessionInfo;
  index: number;
  source: LevelSource;
  onVolume: (id: string, volume: number) => void;
  onMute: (id: string, muted: boolean) => void;
}

const DISPLAY_NAMES: Record<string, string> = {
  "spotify.exe": "Spotify",
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
  "discord.exe": "Discord",
  "cs2.exe": "Counter-Strike 2",
  "obs64.exe": "OBS Studio",
  "vlc.exe": "VLC",
  "steam.exe": "Steam",
  "teams.exe": "Teams",
  "slack.exe": "Slack",
  "zoom.exe": "Zoom",
  "windowsterminal.exe": "Terminal",
  "code.exe": "VS Code",
  "devenv.exe": "Visual Studio",
  "ms-teams.exe": "Teams",
  "thunderbird.exe": "Thunderbird",
  "notion-app.exe": "Notion",
};

function getDisplayName(exe: string): string {
  const n = exe.toLowerCase();
  if (DISPLAY_NAMES[n]) return DISPLAY_NAMES[n];
  const base = exe.replace(/\.exe$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const hueOf = (pid: number): number => (pid * 137 + 20) % 360;

export default function SessionCard({
  session,
  index,
  source,
  onVolume,
  onMute,
}: SessionCardProps) {
  const mutedRef = useRef(session.muted);
  mutedRef.current = session.muted;

  const displayName = getDisplayName(session.exe);
  const hue = useMemo(() => hueOf(session.pid), [session.pid]);
  const pid = session.pid;

  return (
    <article
      className="group relative flex flex-col w-[240px] p-3.5 rounded-xl bg-panel-2/70 border border-rule hover:border-rule-strong transition-[border-color,box-shadow] duration-200"
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 22px rgba(0,0,0,0.3)`,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
      aria-label={`${displayName} channel strip, volume ${Math.round(session.volume * 100)}%, ${session.muted ? "muted" : "active"}`}
    >
      {/* Top Header: App icon + Display Name + Badge */}
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-md border"
          style={{
            borderColor: `hsla(${hue},45%,50%,0.25)`,
            background: `linear-gradient(160deg, hsla(${hue},42%,22%,0.9), hsla(${hue},48%,12%,0.95))`,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.04)`,
          }}
        >
          {session.iconBase64 ? (
            <img
              src={session.iconBase64}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <span
              className="font-display text-[14px] font-semibold tracking-tight"
              style={{ color: `hsl(${hue},80%,64%)` }}
            >
              {displayName.charAt(0)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <h3
              className={`truncate font-semibold text-[12px] tracking-tight ${
                session.muted ? "text-ink-300" : "text-ink-100"
              }`}
              title={session.exe}
            >
              {displayName}
            </h3>
            <div className="flex shrink-0 items-center gap-1">
              {session.flow === "capture" ? (
                <span className="rounded px-1 py-0.2 text-[8px] font-bold tracking-wider uppercase text-route bg-route/15 border border-route/30">
                  MIC
                </span>
              ) : (
                <span className="rounded px-1 py-0.2 text-[8px] font-bold tracking-wider uppercase text-signal bg-signal/15 border border-signal/30">
                  OUT
                </span>
              )}
              {session.flow === "capture" && (
                <span
                  title={
                    session.state === "active"
                      ? "Actively capturing audio"
                      : "Held by the app but silent — start talking or recording to see it go LIVE"
                  }
                  className={`rounded px-1 py-0.2 text-[8px] font-bold tracking-wider uppercase ${
                    session.state === "active"
                      ? "text-led-green bg-led-green/10 border border-led-green/30"
                      : "text-led-amber bg-led-amber/10 border border-led-amber/30"
                  }`}
                >
                  {session.state === "active" ? "LIVE" : "STANDBY"}
                </span>
              )}
            </div>
          </div>
          <p className="truncate font-mono text-[9px] text-ink-500">
            {session.exe} · PID {pid}
          </p>
        </div>
      </div>

      {/* Main Console Strip Module: Vertical Fader | dB Scale Divider | Dual Stereo PPM Meter */}
      <div className="relative flex min-h-[165px] flex-1 items-stretch gap-2 px-0.5 py-1 bg-ink-950/60 rounded-lg border border-rule/40">
        {/* Fader Column (Left) */}
        <div className="flex w-[72px] flex-none flex-col items-center justify-between py-1">
          <Fader value={session.volume} onChange={(v) => onVolume(session.id, v)} showValue={false} />
          <span className="mt-1 font-mono text-[9px] font-bold text-ink-200 tracking-wider">
            {Math.round(session.volume * 100)}%
          </span>
        </div>

        {/* dB Scale Markings (Center Divider) */}
        <div className="flex w-[26px] flex-none flex-col justify-between items-center py-2.5 font-mono text-[7px] text-ink-500 select-none border-x border-rule/30">
          <span>0dB</span>
          <span>−6</span>
          <span>−12</span>
          <span>−30</span>
          <span>−60</span>
        </div>

        {/* Dual Stereo PPM VU Meter Column (Right) */}
        <div className="relative flex-1 min-w-0">
          <div className="meter-face h-full">
            <VumeterCanvas
              source={source}
              channels={2}
              className={`h-full w-full block transition-opacity duration-200 ${
                session.muted ? "opacity-25" : "opacity-100"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Bottom Footer: Mute Toggle + live dBFS Readout */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onMute(session.id, !session.muted)}
          aria-pressed={session.muted}
          title={session.muted ? `Unmute ${displayName}` : `Mute ${displayName}`}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold tracking-wider transition-all ${
            session.muted
              ? "btn-mute-active"
              : "bg-ink-800/80 text-ink-300 border border-rule/50 hover:bg-ink-700 hover:text-ink-100"
          }`}
        >
          <span className={`led ${session.muted ? "led-red" : "led-green"}`} style={{ width: "5px", height: "5px" }} />
          {session.muted ? "MUTED" : "UNMUTE"}
        </button>

        <div className="flex items-center gap-1 font-mono text-[9px] text-ink-300 bg-ink-950/80 px-2 py-1 rounded border border-rule/30">
          <span className="text-[8px] text-ink-500">dBFS</span>
          <DbReadout source={source} muted={() => mutedRef.current} />
        </div>
      </div>
    </article>
  );
}
