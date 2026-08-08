/**
 * SonoraMix — main dashboard.
 *
 * Real WASAPI session management, post-fader metering, and output endpoint routing.
 * Meter data flows through a mutable Map and is polled by canvas at 60 Hz.
 * React only re-renders on session/device changes and a 2 Hz stats tick.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AudioDeviceInfo,
  AudioSessionInfo,
  EngineMode,
  LevelSample,
  LevelSource,
  ToastItem,
} from "./types";
import { createBridge, type AudioBridge } from "./audio/engine";
import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import StatusBar from "./components/StatusBar";
import VumeterCanvas, { DbReadout } from "./components/VumeterCanvas";

const ZERO_LEVEL: LevelSample = { peak: 0, left: 0, right: 0, ts: 0 };

interface EBState { hasError: boolean; message: string }

class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, message: "" };
  static getDerivedStateFromError(e: Error) { return { hasError: true, message: e.message }; }
  render() {
    if (this.state.hasError)
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-950 p-8 text-center">
          <div>
            <p className="font-medium text-[15px] tracking-tight text-led-red">Something went wrong</p>
            <p className="typo-monoline mt-1 text-[11px] text-ink-300">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="btn btn-primary mt-4"
            >
              Recover
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

function Dashboard() {
  const bridgeRef = useRef<AudioBridge | null>(null);
  const levelsRef = useRef(new Map<string, LevelSample>());
  const masterRef = useRef<LevelSample>({ ...ZERO_LEVEL });
  const frameCountRef = useRef(0);
  const startTimeRef = useRef(Date.now());
  const flushTimerRef = useRef<number | null>(null);
  const pendingVolumesRef = useRef(new Map<string, number>());
  const toastIdRef = useRef(0);

  const [mode] = useState<EngineMode>("wasapi");
  const [filterTab, setFilterTab] = useState<"all" | "render" | "capture">("all");
  const [booted, setBooted] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [sessions, setSessions] = useState<AudioSessionInfo[]>([]);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState("");
  const [inputDeviceId, setInputDeviceId] = useState("");
  const [stats, setStats] = useState({ hz: 0, frames: 0 });
  const [masterDb, setMasterDb] = useState("−∞");
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((kind: ToastItem["kind"], title: string, body?: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, title, body }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const sessionSource = useCallback((id: string): LevelSource => () => levelsRef.current.get(id) ?? ZERO_LEVEL, []);
  const masterSource = useCallback<LevelSource>(() => masterRef.current, []);

  useEffect(() => {
    let disposed = false;
    const cleanupFns: Array<() => void> = [];
    const b: AudioBridge = createBridge();

    const attach = (bridge: AudioBridge, data: { sessions: AudioSessionInfo[]; devices: AudioDeviceInfo[] }) => {
      bridgeRef.current = bridge;
      setSessions(data.sessions);
      setDevices(data.devices);
      const defOut = data.devices.find((d) => d.flow !== "capture" && d.isDefault)?.id ?? data.devices.find((d) => d.flow !== "capture")?.id ?? "";
      const defIn = data.devices.find((d) => d.flow === "capture" && d.isDefault)?.id ?? data.devices.find((d) => d.flow === "capture")?.id ?? "";
      setOutputDeviceId(defOut);
      setInputDeviceId(defIn);
      setBooted(true);

      showToast(
        "ok",
        "WASAPI Engine Online",
        `${data.sessions.length} active audio session${data.sessions.length === 1 ? "" : "s"} detected.`
      );

      cleanupFns.push(
        bridge.onVumeter((frames) => {
          const now = performance.now();
          let sumSq = 0, sumL = 0, sumR = 0;
          for (const f of frames) {
            levelsRef.current.set(f.id, { peak: f.peak, left: f.left, right: f.right, ts: now });
            sumSq += f.peak * f.peak;
            sumL += f.left * f.left;
            sumR += f.right * f.right;
          }
          const n = Math.max(1, frames.length);
          masterRef.current = {
            peak: Math.min(1, Math.sqrt(sumSq / n) * 1.12),
            left: Math.min(1, Math.sqrt(sumL / n) * 1.12),
            right: Math.min(1, Math.sqrt(sumR / n) * 1.12),
            ts: now,
          };
          frameCountRef.current++;
        })
      );

      cleanupFns.push(
        bridge.onSessionsChanged(() => {
          bridge.getSessions().then((s) => { if (!disposed) setSessions(s); }).catch(() => {});
        })
      );
    };

    (async () => {
      try {
        const data = await b.init();
        if (!disposed) attach(b, data);
      } catch (e) {
        showToast("error", "Initialization Error", String(e));
      }
    })();

    const statsIv = window.setInterval(() => {
      setStats((prev) => {
        const frames = frameCountRef.current;
        const hz = Math.max(0, (frames - prev.frames) * 2);
        const peak = masterRef.current.peak;
        setMasterDb(peak <= 0.0005 ? "−∞" : (20 * Math.log10(peak)).toFixed(1));
        return { hz, frames };
      });
    }, 500);

    const pollIv = window.setInterval(() => {
      const b2 = bridgeRef.current;
      if (b2) {
        b2.getSessions().then((s) => { if (!disposed) setSessions(s); }).catch(() => {});
      }
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(statsIv);
      window.clearInterval(pollIv);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      cleanupFns.forEach((fn) => fn());
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [showToast]);

  const flushVolumes = useCallback(() => {
    const b = bridgeRef.current;
    if (!b) return;
    pendingVolumesRef.current.forEach((volume, id) => {
      b.setVolume(id, volume).catch((e) => showToast("error", "Volume Error", String(e)));
    });
    pendingVolumesRef.current.clear();
  }, [showToast]);

  const handleVolume = useCallback(
    (id: string, volume: number) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume } : s)));
      pendingVolumesRef.current.set(id, volume);
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          flushVolumes();
        }, 45);
      }
    },
    [flushVolumes],
  );

  const handleMute = useCallback(
    (id: string, muted: boolean) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, muted } : s)));
      bridgeRef.current?.setMute(id, muted).catch((e) => showToast("error", "Mute Error", String(e)));
    },
    [showToast],
  );

  const handleOutputDevice = useCallback(
    (id: string) => {
      setOutputDeviceId(id);
      setDevices((prev) => prev.map((d) => (d.flow !== "capture" ? { ...d, isDefault: d.id === id } : d)));
      const name = devices.find((d) => d.id === id)?.name ?? id;
      bridgeRef.current?.setDevice(0, id).then(() => showToast("ok", "Default Output Set", name)).catch((e) => showToast("error", "Routing Error", String(e)));
    },
    [devices, showToast],
  );

  const handleInputDevice = useCallback(
    (id: string) => {
      setInputDeviceId(id);
      setDevices((prev) => prev.map((d) => (d.flow === "capture" ? { ...d, isDefault: d.id === id } : d)));
      const name = devices.find((d) => d.id === id)?.name ?? id;
      bridgeRef.current?.setDevice(0, id).then(() => showToast("ok", "Default Mic Input Set", name)).catch((e) => showToast("error", "Routing Error", String(e)));
    },
    [devices, showToast],
  );

  const handleTray = useCallback(() => {
    bridgeRef.current?.minimizeToTray().catch(() => {});
  }, []);

  const rescan = useCallback(() => {
    const b = bridgeRef.current;
    if (!b) return;
    Promise.all([b.getSessions(), b.getDevices()])
      .then(([s, d]) => {
        setSessions(s);
        setDevices(d);
        // Restart meter stream so it picks up new/changed sessions (especially capture)
        b.startStream().catch(() => {});
        showToast("ok", "Rescan Complete", `${s.length} active session${s.length === 1 ? "" : "s"}, ${d.length} audio endpoint${d.length === 1 ? "" : "s"}.`);
      })
      .catch((e) => showToast("error", "Rescan Failed", String(e)));
  }, [showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === "r") { e.preventDefault(); rescan(); }
      if (e.key === "Escape" && !bootDone) setBootDone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rescan, bootDone]);

  const handleToggleDevice = useCallback(
    (deviceId: string, enabled: boolean) => {
      const b = bridgeRef.current;
      if (!b) return;
      b.toggleDeviceEnabled(deviceId, enabled)
        .then(() => {
          const devName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
          showToast("ok", enabled ? "Device Enabled" : "Device Disabled", devName);
          // Re-fetch devices to update the state
          return b.getDevices();
        })
        .then((d) => {
          setDevices(d);
          // Also rescan sessions since newly enabled devices may have new sessions
          return b.getSessions();
        })
        .then((s) => setSessions(s))
        .catch((e) => showToast("error", "Device Toggle Failed", String(e)));
    },
    [devices, showToast],
  );

  const inputSessions = useMemo(() => sessions.filter((s) => s.flow === "capture"), [sessions]);
  const outputSessions = useMemo(() => sessions.filter((s) => s.flow !== "capture"), [sessions]);
  const isStreaming = stats.hz > 20;
  const deviceName = devices.find((d) => d.id === outputDeviceId)?.name ?? "";

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden font-sans text-ink-100">
      <Header
        devices={devices}
        outputDeviceId={outputDeviceId}
        inputDeviceId={inputDeviceId}
        onOutputDevice={handleOutputDevice}
        onInputDevice={handleInputDevice}
        onToggleDevice={handleToggleDevice}
        mode={mode}
        streaming={isStreaming}
        onTray={handleTray}
      />

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-[1480px] space-y-5">
          {/* Top Console Bar & View Mode Toggle */}
          <div className="glass-panel rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-signal shadow-[0_0_10px_rgba(255,121,64,0.6)]" />
              <div>
                <h1 className="font-display text-[16px] font-bold tracking-tight text-ink-100">
                  STUDIO MIXING CONSOLE
                </h1>
                <p className="typo-caption text-[10px]">Dual-Deck WASAPI Session Routing</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-ink-900/80 p-1 rounded-lg border border-rule/50">
              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${
                  filterTab === "all"
                    ? "bg-signal/20 text-signal border border-signal/40 shadow-sm"
                    : "text-ink-300 hover:text-ink-100"
                }`}
              >
                🎛️ DUAL CONSOLE ({sessions.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("render")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${
                  filterTab === "render"
                    ? "bg-signal/20 text-signal border border-signal/40 shadow-sm"
                    : "text-ink-300 hover:text-ink-100"
                }`}
              >
                🔊 OUTPUTS ({outputSessions.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("capture")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${
                  filterTab === "capture"
                    ? "bg-route/20 text-route border border-route/40 shadow-sm"
                    : "text-ink-300 hover:text-ink-100"
                }`}
              >
                🎙️ INPUTS ({inputSessions.length})
              </button>
            </div>
          </div>

          {!booted ? (
            <div className="glass-panel rounded-xl p-6">
              <LoadSkeleton />
            </div>
          ) : (
            <>
              {/* 🎙️ INPUT CONSOLE RACK (Microphones & Recording) */}
              {(filterTab === "all" || filterTab === "capture") && (
                <section className="glass-panel rounded-xl overflow-hidden relative" aria-label="Input recording console">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-route" aria-hidden="true" />
                  <div className="ml-1.5 px-5 pt-4 pb-5 sm:px-6">
                    <div className="mb-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-route/15 text-route font-bold text-[12px]">
                          🎙️
                        </span>
                        <div>
                          <h2 className="font-display text-[14px] font-bold tracking-tight text-route">
                            INPUT CONSOLE — MICROPHONES & RECORDING
                          </h2>
                          <p className="typo-caption text-[10px]">
                            {inputSessions.length} ACTIVE CAPTURE CHANNEL{inputSessions.length === 1 ? "" : "S"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {inputSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-rule/60 p-6 text-center">
                        <p className="typo-caption text-ink-300">No active microphone capture sessions detected</p>
                        <p className="text-[11px] text-ink-500 mt-1">Open Discord, OBS Studio, Teams, or Zoom to control microphone levels</p>
                      </div>
                    ) : (
                      <div
                        className="grid gap-3 sm:gap-3"
                        style={{ gridTemplateColumns: "repeat(auto-fill, 240px)" }}
                      >
                        {inputSessions.map((s, i) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            index={i}
                            source={sessionSource(s.id)}
                            onVolume={handleVolume}
                            onMute={handleMute}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 🔊 OUTPUT CONSOLE RACK (Application Playback & Music) */}
              {(filterTab === "all" || filterTab === "render") && (
                <section className="glass-panel rounded-xl overflow-hidden relative" aria-label="Output playback console">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-signal" aria-hidden="true" />
                  <div className="ml-1.5 px-5 pt-4 pb-5 sm:px-6">
                    <div className="mb-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-signal/15 text-signal font-bold text-[12px]">
                          🔊
                        </span>
                        <div>
                          <h2 className="font-display text-[14px] font-bold tracking-tight text-signal">
                            OUTPUT CONSOLE — APPLICATION PLAYBACK & GAMES
                          </h2>
                          <p className="typo-caption text-[10px]">
                            {outputSessions.length} ACTIVE PLAYBACK CHANNEL{outputSessions.length === 1 ? "" : "S"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {outputSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-rule/60 p-6 text-center">
                        <p className="typo-caption text-ink-300">No active playback audio sessions detected</p>
                        <button type="button" onClick={rescan} className="btn btn-primary mt-2">
                          Rescan Audio Sessions
                        </button>
                      </div>
                    ) : (
                      <div
                        className="grid gap-3 sm:gap-3"
                        style={{ gridTemplateColumns: "repeat(auto-fill, 240px)" }}
                      >
                        {outputSessions.map((s, i) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            index={i}
                            source={sessionSource(s.id)}
                            onVolume={handleVolume}
                            onMute={handleMute}
                          />
                        ))}
                        <MasterStrip
                          index={outputSessions.length}
                          source={masterSource}
                          deviceName={deviceName}
                          sessionsCount={sessions.length}
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

        <div className="mt-4 text-center typo-caption text-ink-500 flex flex-wrap items-center justify-center gap-2 pb-2">
          <span>SonoraMix v1.0.0 — Native WASAPI Session API · IPolicyConfig Endpoint Routing · 60 Hz Phase-Locked Stream</span>
          <span className="text-rule/60">•</span>
          <button
            type="button"
            onClick={rescan}
            className="inline-flex items-center gap-1.5 rounded bg-ink-900/80 px-2 py-0.5 text-[11px] font-bold text-signal border border-signal/40 hover:bg-ink-800 hover:border-signal transition-all cursor-pointer shadow-sm"
            title="Rescan audio sessions and devices (Hotkey: R)"
          >
            <span>🔄 RESCAN</span>
            <kbd className="inline-block min-w-[16px] rounded bg-ink-950 border border-rule/60 px-1 text-[9px] font-mono text-ink-300">R</kbd>
          </button>
        </div>
      </div>
    </main>

      <StatusBar
        mode={mode}
        streaming={isStreaming}
        hz={stats.hz}
        frames={stats.frames}
        sessions={booted ? sessions.length : 0}
        masterDb={masterDb}
        startedAt={startTimeRef.current}
      />

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {!bootDone && <BootOverlay onDone={() => setBootDone(true)} />}
    </div>
  );
}

function MasterStrip({ index, source, deviceName, sessionsCount }: {
  index: number;
  source: LevelSource;
  deviceName: string;
  sessionsCount: number;
}) {
  return (
    <article
      className="relative flex flex-col p-4 rounded-xl bg-panel-2/60 border border-signal/25 hover:border-signal/40 transition-[border-color,box-shadow] duration-200"
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,121,64,0.06), 0 8px 20px rgba(0,0,0,0.25)`,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
      aria-label="Master output bus"
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-signal/60 to-transparent" aria-hidden="true" />
      <div className="mt-1 flex items-center gap-2.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-signal/25 bg-signal/8 shadow-[0_0_10px_rgba(255,121,64,0.2)]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-signal" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="7.5" />
            <path d="M12 12 8 8" strokeLinecap="round" />
            <path d="M4 12h2M20 12h2M12 4v2M12 20v2" strokeLinecap="round" opacity="0.45" />
          </svg>
        </div>
        <div>
          <h3 className="font-medium text-[13px] tracking-tight text-signal">MASTER OUT</h3>
          <p className="typo-monoline text-[10px] text-ink-300 truncate max-w-[200px]" title={deviceName}>
            {deviceName || "awaiting endpoint…"}
          </p>
        </div>
        <div className="flex-1" />
        <span className="typo-monoline text-[10px] text-ink-500">
          {sessionsCount} session{sessionsCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="mt-3 flex min-h-[140px] flex-1 flex-col">
        <span className="mb-1.5 typo-monoline text-[9px] text-ink-500 tracking-widest">MONO SUM</span>
        <div className="relative flex-1">
          <VumeterCanvas source={source} channels={2} className="h-full w-full" />
          <div className="absolute left-0 top-0 flex w-full justify-between px-1" aria-hidden="true">
            <span className="typo-monoline text-[7px] text-ink-500/60">0 dBFS</span>
            <span className="typo-monoline text-[7px] text-ink-500/60">−60 dBFS</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end">
        <div className="flex items-baseline gap-1.5">
          <span className="typo-monoline text-[9px] text-ink-500 uppercase tracking-widest">Peak</span>
          <DbReadout source={source} muted={() => false} className="typo-number text-[12px] text-ink-100" />
          <span className="typo-monoline text-[9px] text-ink-500">dBFS</span>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ onRescan }: { onRescan: () => void }) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border border-dashed border-ink-500/40 px-8 py-16 text-center"
      style={{ background: "rgba(20,23,26,0.3)" }}
    >
      <svg className="h-11 w-11 text-ink-500/70" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="6" y="18" width="6" height="6" rx="1" />
        <rect x="14" y="12" width="6" height="12" rx="1" fill="currentColor" fillOpacity="0.4" />
        <rect x="22" y="16" width="6" height="8" rx="1" fill="currentColor" fillOpacity="0.6" />
      </svg>
      <h2 className="mt-4 font-medium text-[14px] tracking-tight text-ink-100">No active audio sessions</h2>
      <p className="mt-1.5 max-w-xs text-[12px] text-ink-300">
        Start playback in any application — channel strips appear automatically.
      </p>
      <button type="button" onClick={onRescan} className="btn btn-primary mt-4">
        <svg viewBox="0 0 10 6" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Rescan Sessions
      </button>
    </div>
  );
}

function LoadSkeleton() {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-[200px] rounded-lg bg-ink-50/40 animate-pulse"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
      <div className="h-[200px] w-full rounded-lg bg-ink-50/20 animate-pulse" style={{ animationDelay: "400ms" }} />
    </div>
  );
}

const TOAST_STYLE: Record<ToastItem["kind"], { led: string; border: string; label: string }> = {
  ok: { led: "led-green", border: "toast-border-ok", label: "OK" },
  info: { led: "led-amber", border: "toast-border-info", label: "INFO" },
  error: { led: "led-red", border: "toast-border-error", label: "ERR" },
};

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-[120px] z-50 flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => {
        const style = TOAST_STYLE[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={`toast flex w-full flex-col gap-0.5 rounded-lg bg-panel-2 border border-rule ${style.border} px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.5)]`}
          >
            <div className="flex items-start gap-2">
              <span className={`led ${style.led} shrink-0`} style={{ width: "6px", height: "6px" }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[12px] tracking-tight text-ink-100">{toast.title}</p>
                {toast.body && <p className="typo-monoline text-[10px] text-ink-300 leading-snug">{toast.body}</p>}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss"
                className="text-ink-500 transition-colors hover:text-ink-100"
              >
                <svg viewBox="0 0 10 6" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const BOOT_STEPS = [
  { text: "Initializing COM apartment (MTA)", status: "OK" as const },
  { text: "Scanning audio endpoints", status: "OK" as const },
  { text: "Enumerating active WASAPI sessions", status: "OK" as const },
  { text: "Meter stream · 60 Hz phase-locked", status: "LIVE" as const },
];

function BootOverlay({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(0);
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFading(true);
    window.setTimeout(onDone, 320);
  }, [onDone]);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setCount((c) => {
        if (c >= BOOT_STEPS.length) {
          window.clearInterval(iv);
          window.setTimeout(finish, 300);
          return c;
        }
        return c + 1;
      });
    }, 180);
    return () => window.clearInterval(iv);
  }, [finish]);

  return (
    <div
      onClick={finish}
      onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") finish(); }}
      role="button"
      tabIndex={0}
      aria-label="Boot sequence — click to skip"
      className={`fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center bg-ink-950/92 backdrop-blur-sm transition-opacity duration-300 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <svg viewBox="0 0 32 32" className="h-16 w-16" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="7" fill="#0e1013" stroke="rgba(255,255,255,0.08)" />
        <rect x="7" y="13" width="4" height="11" rx="1.5" fill="#eef0f3" />
        <rect x="14" y="7" width="4" height="17" rx="1.5" fill="#ff7940" />
        <rect x="21" y="16" width="4" height="8" rx="1.5" fill="#33d1b8" />
        <circle cx="23" cy="9" r="1.8" fill="#3fe082" />
      </svg>

      <h1 className="mt-4 font-display text-2xl font-bold tracking-[0.3em] text-ink-100">
        Sonora<span className="text-signal">Mix</span>
      </h1>
      <p className="typo-caption mt-1.5">Audio Session Console · v0.1.0</p>

      <div className="mt-8 w-[min(400px,86vw)] space-y-1.5 font-mono text-[11px] text-ink-300">
        {BOOT_STEPS.slice(0, count).map((step, i) => (
          <div
            key={step.text}
            className="flex justify-between gap-3"
            style={{ animationDelay: `${i * 25}ms`, animation: "fade-in 0.22s ease both" }}
          >
            <span className="leading-tight">{step.text}</span>
            <span className={`font-semibold tracking-wide ${step.status === "LIVE" ? "text-led-green" : "text-route"}`}>
              {step.status}
            </span>
          </div>
        ))}
        {count < BOOT_STEPS.length && (
          <span className="boot-cursor inline-block h-3.5 w-2 bg-route" aria-hidden="true" />
        )}
      </div>

      <p className="typo-caption absolute bottom-8">Click or press Esc to skip</p>
    </div>
  );
}
