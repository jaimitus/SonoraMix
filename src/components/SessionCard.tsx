/**
 * Session channel strip — authentic studio hardware channel strip.
 * Fixed 272px module width to guarantee 100% layout stability on window resize.
 *
 * Anatomy:
 *   - Top: App Icon + Name (double-click to rename) + Pin/Flow badges
 *   - Device bar (render only): clickable "output → device" control that opens
 *     the in-app routing picker — the primary, always-visible routing surface
 *   - Center: Vertical Fader | dB Scale | Dual Stereo PPM Meter
 *   - Bottom: Mute Toggle + peak-hold + live dBFS readout
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioDeviceInfo, AudioSessionInfo, LevelSource } from "../types";
import { getDisplayName } from "../utils/names";
import { volumeToDb } from "../utils/db";
import Fader from "./Fader";
import VumeterCanvas, { DbReadout, PeakHoldReadout } from "./VumeterCanvas";

interface SessionCardProps {
  session: AudioSessionInfo;
  index: number;
  source: LevelSource;
  onVolume: (id: string, volume: number) => void;
  onMute: (id: string, muted: boolean) => void;
  /** Custom display name from the user's renames (falls back to the exe map) */
  customName?: string;
  /** Whether the channel is pinned to the top */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Commit a new display name (empty to revert to default) */
  onRename?: (name: string) => void;
  /** Output endpoints available for in-app per-app routing (render sessions only) */
  renderDevices?: AudioDeviceInfo[];
  /** Route this session to an output device, in-app (no Windows settings needed) */
  onRouteToDevice?: (deviceId: string) => void;
  /** Optional fallback: opens the Windows per-app output routing page */
  onRoute?: () => void;
  /** Device this session is currently persisted-routed to ("" = system default) */
  routedDeviceId?: string;
  /** Reset this session back to the system default output device */
  onResetRoute?: () => void;
}

const hueOf = (pid: number): number => (pid * 137 + 20) % 360;

export default function SessionCard({
  session,
  index,
  source,
  onVolume,
  onMute,
  customName,
  pinned,
  onTogglePin,
  onRename,
  renderDevices,
  onRouteToDevice,
  onRoute,
  routedDeviceId,
  onResetRoute,
}: SessionCardProps) {
  const mutedRef = useRef(session.muted);
  mutedRef.current = session.muted;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editingRef = useRef(false);

  // In-app per-app routing picker state (render sessions only).
  const [routeOpen, setRouteOpen] = useState(false);
  const routeRef = useRef<HTMLDivElement | null>(null);

  // Close the routing picker on outside click / Escape.
  useEffect(() => {
    if (!routeOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (routeRef.current && !routeRef.current.contains(e.target as Node)) {
        setRouteOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRouteOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [routeOpen]);

  const displayName = customName || getDisplayName(session.exe);
  const hue = useMemo(() => hueOf(session.pid), [session.pid]);
  const pid = session.pid;
  const standby = session.state === "inactive";

  // Commit only if we're still in editing mode — unmounting the input fires
  // `blur`, which must NOT commit a cancelled (Escape) rename.
  const commitRename = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    if (onRename) onRename(draft);
  };

  const cancelRename = () => {
    editingRef.current = false;
    setEditing(false);
  };

  const startEditing = () => {
    if (!onRename) return;
    setDraft(displayName);
    editingRef.current = true;
    setEditing(true);
  };

  const routedDeviceName = renderDevices?.find((d) => d.id === routedDeviceId)?.name;

  return (
    <article
      className={`group relative flex flex-col w-[272px] p-3.5 rounded-xl bg-panel-2/70 border border-rule hover:border-rule-strong transition-[border-color,box-shadow,opacity,filter] duration-200 ${
        standby ? "channel-standby" : ""
      }`}
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 22px rgba(0,0,0,0.3)`,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
      aria-label={`${displayName} channel strip, volume ${Math.round(session.volume * 100)}%, ${session.muted ? "muted" : "active"}`}
    >
      {/* Top Header: App icon + Display Name + Badges */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg border"
          style={{
            borderColor: `hsla(${hue},45%,50%,0.3)`,
            background: `linear-gradient(160deg, hsla(${hue},42%,24%,0.95), hsla(${hue},48%,12%,0.98))`,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.05), 0 2px 8px rgba(0,0,0,0.35)`,
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
              className="font-display text-[16px] font-semibold tracking-tight"
              style={{ color: `hsl(${hue},85%,66%)` }}
            >
              {displayName.charAt(0)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                }}
                className="w-full min-w-0 rounded border border-route/40 bg-ink-950 px-1.5 py-0.5 text-[13px] font-semibold text-ink-100 outline-none"
                aria-label="Channel name"
              />
            ) : (
              <h3
                className={`truncate font-semibold text-[13px] tracking-tight ${
                  session.muted ? "text-ink-300" : "text-ink-100"
                }`}
                title={`${session.exe} — double-click to rename`}
                onDoubleClick={startEditing}
              >
                {displayName}
              </h3>
            )}
            {onTogglePin && (
              <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={!!pinned}
                title={pinned ? `Unpin ${displayName}` : `Pin ${displayName} to the top`}
                className={`flex h-4 w-4 flex-none items-center justify-center rounded transition-colors ${
                  pinned ? "text-signal" : "text-ink-500 opacity-0 group-hover:opacity-100 hover:text-ink-100"
                }`}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M9.8 2.3a1 1 0 0 1 1.4 0l2.5 2.5a1 1 0 0 1 0 1.4l-1.5 1.5L9 5l1.5-1.5a1 1 0 0 1-.7-1.2Z" strokeLinejoin="round" />
                  <path d="M9 5 6.8 7.2a5.5 5.5 0 0 0-1.4 5.4l.4 1-2.5 2.5L2 14.6l2.5-2.5 1 .3a5.5 5.5 0 0 0 5.4-1.4L13 8.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate font-mono text-[9px] text-ink-500" title={`${session.exe} · PID ${pid}`}>
              {session.exe}
            </p>
            {session.flow === "capture" ? (
              <span className="shrink-0 rounded px-1 py-px text-[8px] font-bold tracking-wider uppercase text-route bg-route/15 border border-route/30">
                MIC
              </span>
            ) : (
              <span className="shrink-0 rounded px-1 py-px text-[8px] font-bold tracking-wider uppercase text-signal bg-signal/15 border border-signal/30">
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
                className={`shrink-0 rounded px-1 py-px text-[8px] font-bold tracking-wider uppercase ${
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
      </div>

      {/* Device Routing Bar (render sessions only) — the primary, always-visible
          routing control. Shows where the app currently outputs and opens the
          in-app picker on click. The reset control is a SIBLING button (never
          nested inside the trigger) for valid a11y. */}
      {session.flow === "render" && (onRouteToDevice || onRoute) && (
        <div ref={routeRef} className="relative mb-2.5">
          <div
            className={`flex h-7 w-full items-center gap-1.5 rounded-md border transition-all ${
              routedDeviceId
                ? "border-signal/40 bg-signal/10"
                : "border-rule/50 bg-ink-900/60"
            } ${routeOpen ? "border-signal/60 shadow-[0_0_0_3px_rgba(255,121,64,0.12)]" : ""}`}
          >
            <button
              type="button"
              onClick={() => setRouteOpen((o) => !o)}
              aria-expanded={routeOpen}
              aria-haspopup="menu"
              title={
                routedDeviceId
                  ? `Output: ${routedDeviceName ?? "custom device"} — click to change`
                  : `Output: system default — click to route ${displayName}`
              }
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-[10px] font-medium transition-colors ${
                routedDeviceId
                  ? "text-signal hover:bg-signal/15"
                  : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
              }`}
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 8h11M10.5 4.5 14 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 flex-1 truncate">
                {/* Routed to a device no longer in the list (unplugged) is NOT
                    "system default" — keep the old "Custom device" fallback. */}
                {routedDeviceId ? (routedDeviceName ?? "Custom device") : "System default"}
              </span>
              <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {routedDeviceId && onResetRoute && (
              <button
                type="button"
                onClick={onResetRoute}
                title={`Reset ${displayName} to the system default device`}
                aria-label={`Reset ${displayName} output to default`}
                className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-300 transition-colors hover:bg-ink-950/60 hover:text-led-red"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M13 8a5 5 0 1 1-1.5-3.5M13 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          {routeOpen && (
            <div
              role="menu"
              className="absolute top-full left-0 right-0 z-30 mt-1.5 w-full rounded-lg border border-rule bg-panel/95 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-sm"
              style={{ animation: "fade-in 0.14s ease both" }}
            >
              <p className="px-2 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-500">
                Route {displayName} to…
              </p>
              {onResetRoute && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setRouteOpen(false);
                      onResetRoute();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-100"
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3 text-led-amber" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Reset to system default
                  </button>
                  <div className="my-1 border-t border-rule/50" />
                </>
              )}
              <div className="max-h-[210px] overflow-y-auto pr-0.5">
                {renderDevices && renderDevices.length > 0 ? (
                  renderDevices.map((dev) => {
                    const isCurrent = routedDeviceId === dev.id;
                    return (
                      <button
                        key={dev.id}
                        type="button"
                        role="menuitem"
                        disabled={!dev.enabled}
                        onClick={() => {
                          setRouteOpen(false);
                          onRouteToDevice?.(dev.id);
                        }}
                        title={dev.enabled ? dev.name : `${dev.name} (disabled — enable it first)`}
                        aria-current={isCurrent || undefined}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                          dev.enabled
                            ? isCurrent
                              ? "bg-signal/10 text-signal"
                              : "text-ink-200 hover:bg-ink-800 hover:text-ink-100"
                            : "cursor-not-allowed text-ink-500 opacity-60"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            dev.enabled ? "bg-led-green" : "bg-led-red"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{dev.name}</span>
                        {isCurrent && (
                          <span className="shrink-0 rounded bg-signal/20 px-1 py-px text-[7px] font-bold uppercase tracking-wider text-signal">
                            Now
                          </span>
                        )}
                        <span className="shrink-0 text-[8px] text-ink-500">{dev.formFactor}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-2 py-1.5 text-[10px] text-ink-500">No output devices found</p>
                )}
              </div>
              {onRoute && (
                <>
                  <div className="my-1 border-t border-rule/50" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setRouteOpen(false);
                      onRoute();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] text-route transition-colors hover:bg-ink-800"
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M3.5 3.5h6a2 2 0 0 1 2 2v4M12.5 10.5 15 8l-2.5-2.5M3.5 12.5h6a2 2 0 0 0 2-2V2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Open Windows per-app settings…
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Console Strip Module: Vertical Fader | dB Scale Divider | Dual Stereo PPM Meter */}
      <div className="relative flex min-h-[165px] flex-1 items-stretch gap-2 px-0.5 py-1 bg-ink-950/60 rounded-lg border border-rule/40">
        {/* Fader Column (Left) */}
        <div className="flex w-[76px] flex-none flex-col items-center justify-between py-1">
          <Fader value={session.volume} onChange={(v) => onVolume(session.id, v)} showValue={false} />
          <div className="mt-1 flex flex-col items-center leading-none">
            <span className="font-mono text-[10px] font-bold text-ink-200 tracking-wider">
              {Math.round(session.volume * 100)}%
            </span>
            <span
              className={`mt-0.5 font-mono text-[8px] tracking-wider ${
                session.volume <= 0.0001 ? "text-ink-500" : "text-ink-400"
              }`}
            >
              {volumeToDb(session.volume)} dB
            </span>
          </div>
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

      {/* Bottom Footer: Mute Toggle + Peak hold + live dBFS Readout */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onMute(session.id, !session.muted)}
          aria-pressed={session.muted}
          title={session.muted ? `Unmute ${displayName}` : `Mute ${displayName}`}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold tracking-wider transition-all ${
            session.muted
              ? "btn-mute-active"
              : "bg-ink-800/80 text-ink-300 border border-rule/50 hover:bg-led-red/15 hover:text-led-red hover:border-led-red/40"
          }`}
        >
          <span className={`led ${session.muted ? "led-white" : "led-green"}`} style={{ width: "5px", height: "5px" }} />
          {session.muted ? "MUTED" : "MUTE"}
        </button>

        <div className="flex items-center gap-1.5">
          {session.flow === "render" && (
            <span className="flex items-center gap-1 font-mono text-[8px] text-ink-500 bg-ink-950/80 px-1.5 py-1 rounded border border-rule/30">
              <span className="text-ink-500">PK</span>
              <PeakHoldReadout source={source} className="font-mono text-[9px] text-led-amber cursor-pointer hover:text-ink-100" />
            </span>
          )}
          <div className="flex items-center gap-1 font-mono text-[9px] text-ink-300 bg-ink-950/80 px-2 py-1 rounded border border-rule/30">
            <span className="text-[8px] text-ink-500">dBFS</span>
            <DbReadout source={source} muted={() => mutedRef.current} />
          </div>
        </div>
      </div>
    </article>
  );
}
