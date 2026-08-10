/**
 * SonoraMix — main dashboard.
 *
 * Real WASAPI session management, post-fader metering, and output endpoint routing.
 * Meter data flows through a mutable Map and is polled by canvas at 60 Hz.
 * React only re-renders on session/device changes and a 2 Hz stats tick.
 *
 * v1.2.0: Scenes (mixer snapshots), Auto-Duck (mic-gated playback attenuation),
 * Ctrl+click multi-select faders, drag-to-reorder channels, config export/import,
 * and full EN/ES i18n.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AudioDeviceInfo,
  AudioSessionInfo,
  EngineMode,
  LevelSample,
  LevelSource,
  MasterControl,
  ToastItem,
} from "./types";
import Fader from "./components/Fader";
import { createBridge, type AudioBridge } from "./audio/engine";
import { checkForUpdates, currentVersion, installUpdate, isTauri, APP_VERSION } from "./updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import { LogicalPosition, LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import DeviceMeters from "./components/DeviceMeters";
import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import SettingsDrawer from "./components/SettingsDrawer";
import StatusBar from "./components/StatusBar";
import UpdateBanner from "./components/UpdateBanner";
import VumeterCanvas, { DbReadout } from "./components/VumeterCanvas";
import { loadState, saveState, type AppSettings, type PersistedState, type SceneSnapshot } from "./settings";
import { MeterSettingsContext } from "./meterContext";
import { getDisplayName } from "./utils/names";
import { volumeToDb } from "./utils/db";
import { setLang, useT } from "./i18n";
import { exportConfig, importConfig } from "./io";

const ZERO_LEVEL: LevelSample = { peak: 0, left: 0, right: 0, ts: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface EBState { hasError: boolean; message: string }

/** State machine for the in-app update flow. */
type UpdateUiState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; progress: number; downloaded: number; total: number };

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
  const t = useT();
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
  const [updateUi, setUpdateUi] = useState<UpdateUiState>({ kind: "idle" });
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const updateBusyRef = useRef(false);
  const [master, setMaster] = useState<MasterControl>({ volume: 1, muted: false });
  const masterTimerRef = useRef<number | null>(null);
  const pendingMasterRef = useRef<number | null>(null);
  const masterVolumeRef = useRef(1);
  const masterMutedRef = useRef(false);

  const [persisted, setPersisted] = useState<PersistedState>(() => loadState());
  const settingsRef = useRef(persisted.settings);
  // Per-session persisted output device id ("" = follows system default).
  // Keyed by session id; refreshed when the session set changes or after a route.
  const [routedDevices, setRoutedDevices] = useState<Record<string, string>>({});
  const routedFetchKeyRef = useRef("");
  const routedFetchAtRef = useRef(0);
  const routedFetchIdRef = useRef(0);
  settingsRef.current = persisted.settings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Last set of shortcuts known to be registered (used to revert a failed change).
  const lastActiveShortcutsRef = useRef(persisted.settings.shortcuts);

  // ── v1.2.0 state ────────────────────────────────────────────────
  // Solo: session id -> soloed. Soloed channels play; everything else soft-mutes.
  const [solo, setSolo] = useState<Record<string, boolean>>({});
  const engineMuteRef = useRef<Record<string, boolean>>({});
  // Multi-select: set of session ids (Ctrl+click). Volumes/mutes apply to all.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Drag-to-reorder.
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragOverExe, setDragOverExe] = useState<string | null>(null);
  // Scenes panel.
  const [scenesOpen, setScenesOpen] = useState(false);
  const [sceneName, setSceneName] = useState("");
  // Auto-duck live state (UI indicator).
  const [duckingNow, setDuckingNow] = useState(false);
  const duckingRef = useRef(false);
  const duckBaseRef = useRef<Record<string, number>>({});
  const sessionsRef = useRef<AudioSessionInfo[]>([]);
  sessionsRef.current = sessions;
  const routedRef = useRef(routedDevices);
  routedRef.current = routedDevices;

  const showToast = useCallback((kind: ToastItem["kind"], title: string, body?: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, title, body }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((tt) => tt.id !== id)), 4500);
  }, []);

  // Apply the UI language to the i18n store whenever it changes.
  useEffect(() => {
    setLang(persisted.settings.language);
  }, [persisted.settings.language]);

  // Refresh the persisted route of every render session (in-app per-app routing).
  // Debounced + only when the set of session ids actually changed, so event
  // storms (60 Hz meter / volume drags) don't trigger N IPC calls per frame.
  const refreshRoutedDevices = useCallback((list: AudioSessionInfo[]) => {
    const b = bridgeRef.current;
    if (!b) return;
    const render = list.filter((s) => s.flow === "render");
    if (render.length === 0) {
      setRoutedDevices({});
      return;
    }
    const key = render.map((s) => s.id).sort().join("|");
    const now = Date.now();
    if (key === routedFetchKeyRef.current && now - routedFetchAtRef.current < 5000) return;
    routedFetchKeyRef.current = key;
    routedFetchAtRef.current = now;
    const fetchId = ++routedFetchIdRef.current;
    Promise.all(
      render.map((s) =>
        b
          .getSessionRoutedDevice(s.pid, s.exe)
          .then((deviceId) => [s.id, deviceId] as const)
          .catch(() => [s.id, ""] as const),
      ),
    ).then((pairs) => {
      // Drop stale responses: a fetch started before a route action must not
      // clobber the freshly-routed value applied by handleRouteSession.
      if (fetchId !== routedFetchIdRef.current) return;
      setRoutedDevices((prev) => {
        const next = { ...prev };
        const liveIds = new Set(render.map((s) => s.id));
        for (const id of Object.keys(next)) {
          if (!liveIds.has(id)) delete next[id];
        }
        pairs.forEach(([id, deviceId]) => {
          if (deviceId) next[id] = deviceId;
        });
        return next;
      });
    });
  }, []);

  const handleCheckUpdates = useCallback(
    async (opts?: { auto?: boolean }) => {
      if (updateBusyRef.current) return;
      updateBusyRef.current = true;
      setUpdateUi({ kind: "checking" });
      const result = await checkForUpdates();
      updateBusyRef.current = false;
      if (result.status === "update-available") {
        setUpdateDismissed(false);
        setUpdateUi({ kind: "available", update: result.update });
        if (!opts?.auto) {
          showToast("info", t("toast.updateAvailable"), t("toast.updateAvailableBody", { version: result.version }));
        }
      } else if (result.status === "up-to-date") {
        setUpdateUi({ kind: "idle" });
        if (!opts?.auto) {
          showToast("ok", t("toast.upToDate"), t("toast.upToDateBody", { version: result.current }));
        }
      } else if (result.status === "error") {
        setUpdateUi({ kind: "idle" });
        if (!opts?.auto) showToast("error", t("toast.updateCheckFailed"), result.message);
      } else {
        setUpdateUi({ kind: "idle" });
      }
    },
    [showToast, t],
  );

  const handleInstallUpdate = useCallback(async () => {
    if (updateUi.kind !== "available") return;
    updateBusyRef.current = true; // block re-checks while an install is in flight
    const update = updateUi.update;
    setUpdateUi({ kind: "downloading", update, progress: 0, downloaded: 0, total: 0 });
    try {
      await installUpdate(update, ({ ratio, downloaded, total }) => {
        setUpdateUi({ kind: "downloading", update, progress: ratio, downloaded, total });
      });
      updateBusyRef.current = false;
      setUpdateUi({ kind: "idle" });
    } catch (e) {
      updateBusyRef.current = false;
      setUpdateUi({ kind: "available", update });
      showToast("error", t("toast.updateFailed"), String(e));
    }
  }, [updateUi, showToast, t]);

  // Resolve the real runtime version for the footer / boot overlay.
  useEffect(() => {
    currentVersion().then(setAppVersion);
  }, []);

  // Auto-check for updates shortly after startup (desktop only).
  useEffect(() => {
    if (!isTauri()) return;
    const tm = window.setTimeout(() => handleCheckUpdates({ auto: true }), 4000);
    return () => window.clearTimeout(tm);
  }, [handleCheckUpdates]);

  const sessionSource = useCallback((id: string): LevelSource => () => levelsRef.current.get(id) ?? ZERO_LEVEL, []);
  const masterSource = useCallback<LevelSource>(() => masterRef.current, []);
  // Device-level bus meters (ids emitted by the Rust meter thread as "device:*").
  const deviceOutSource = useCallback<LevelSource>(() => levelsRef.current.get("device:render") ?? ZERO_LEVEL, []);
  const deviceInSource = useCallback<LevelSource>(() => levelsRef.current.get("device:capture") ?? ZERO_LEVEL, []);

  // Keep the meter-scaling refs in sync with the master control state.
  useEffect(() => {
    masterVolumeRef.current = master.volume;
    masterMutedRef.current = master.muted;
  }, [master]);

  // ── Persistence + accent theme ──────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.accent = persisted.settings.accent;
    saveState(persisted);
  }, [persisted]);

  // ── Close-to-tray behavior (initial value also applied at attach) ──
  useEffect(() => {
    bridgeRef.current?.setCloseBehavior(persisted.settings.closeToTray).catch(() => {});
  }, [persisted.settings.closeToTray]);

  // ── Autostart with Windows (desktop only) ───────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    if (persisted.settings.autostart) enableAutostart().catch(() => {});
    else disableAutostart().catch(() => {});
  }, [persisted.settings.autostart]);

  // ── Global shortcuts (desktop only, configurable) ───────────────
  // Each shortcut gets its own handler (no string matching — the plugin's
  // canonical rendering of modifiers is version-dependent). When a new
  // combination can't be registered (invalid or already in use by another
  // app) the setting reverts to the previously active one and the user is
  // notified.
  useEffect(() => {
    if (!isTauri()) return;
    const shortcuts = persisted.settings.shortcuts;
    const prev = lastActiveShortcutsRef.current;
    const unregisters: Array<() => Promise<void>> = [];
    let disposed = false;

    const registerOne = (key: string, handler: (event: ShortcutEvent) => void) =>
      registerShortcut(key, handler)
        .then(() => {
          unregisters.push(() => unregisterShortcut(key));
          return true as const;
        })
        .catch(() => false as const);

    (async () => {
      const okMute = await registerOne(shortcuts.micMute, (event) => {
        if (disposed || event.state !== "Pressed") return;
        bridgeRef.current
          ?.toggleGlobalMicMute()
          .then((muted) =>
            showToast("ok", t("toast.micMute"), muted ? t("toast.micMuted") : t("toast.micUnmuted"))
          )
          .catch((e) => showToast("error", t("toast.micMuteFailed"), String(e)));
      });
      const okWindow = await registerOne(shortcuts.toggleWindow, (event) => {
        if (disposed || event.state !== "Pressed") return;
        bridgeRef.current?.toggleWindowVisibility().catch(() => {});
      });

      if (disposed) return;

      if (!okMute) {
        showToast("error", t("toast.shortcutUnavailable"), t("toast.shortcutInUse", { combo: shortcuts.micMute }));
        if (shortcuts.micMute !== prev.micMute) {
          setPersisted((p) => ({
            ...p,
            settings: { ...p.settings, shortcuts: { ...p.settings.shortcuts, micMute: prev.micMute } },
          }));
        }
      }
      if (!okWindow) {
        showToast("error", t("toast.shortcutUnavailable"), t("toast.shortcutInUse", { combo: shortcuts.toggleWindow }));
        if (shortcuts.toggleWindow !== prev.toggleWindow) {
          setPersisted((p) => ({
            ...p,
            settings: {
              ...p.settings,
              shortcuts: { ...p.settings.shortcuts, toggleWindow: prev.toggleWindow },
            },
          }));
        }
      }
      if (okMute && okWindow) {
        lastActiveShortcutsRef.current = shortcuts;
      }
    })();

    return () => {
      disposed = true;
      unregisters.forEach((un) => un().catch(() => {}));
    };
  }, [persisted.settings.shortcuts, showToast, t]);

  // ── Launch minimized to tray ────────────────────────────────────
  useEffect(() => {
    if (!isTauri() || !persisted.settings.launchMinimized) return;
    const tm = window.setTimeout(() => {
      getCurrentWindow().minimize().catch(() => {});
    }, 1600);
    return () => window.clearTimeout(tm);
  }, [persisted.settings.launchMinimized]);

  // ── Window bounds persistence (restore on launch, save on move/resize) ──
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    try {
      const raw = localStorage.getItem("sonoramix.window.v1");
      if (raw) {
        const { x, y, width, height } = JSON.parse(raw) as { x: number; y: number; width: number; height: number };
        win.setSize(new LogicalSize(width, height)).catch(() => {});
        win.setPosition(new LogicalPosition(x, y)).catch(() => {});
      }
    } catch {
      /* corrupted state — ignore */
    }
    let timer: number | null = null;
    const save = () => {
      Promise.all([win.outerPosition(), win.outerSize()])
        .then(([pos, size]) => {
          localStorage.setItem(
            "sonoramix.window.v1",
            JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height })
          );
        })
        .catch(() => {});
    };
    const debounced = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(save, 400);
    };
    const unlistenResize = win.onResized(debounced);
    const unlistenMove = win.onMoved(debounced);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unlistenResize.then((f) => f()).catch(() => {});
      unlistenMove.then((f) => f()).catch(() => {});
    };
  }, []);

  // ── Settings handlers ───────────────────────────────────────────
  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setPersisted((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
  }, []);

  const togglePin = useCallback((id: string) => {
    setPersisted((prev) => {
      const pinned = prev.pinned.includes(id)
        ? prev.pinned.filter((p) => p !== id)
        : [...prev.pinned, id];
      return { ...prev, pinned };
    });
  }, []);

  const renameChannel = useCallback((exe: string, name: string) => {
    const key = exe.toLowerCase();
    setPersisted((prev) => {
      const renames = { ...prev.renames };
      const trimmed = name.trim();
      if (trimmed && trimmed !== getDisplayName(key)) renames[key] = trimmed;
      else delete renames[key];
      return { ...prev, renames };
    });
  }, []);

  // ── Config export / import (v1.2.0) ─────────────────────────────
  const handleExport = useCallback(async () => {
    const ok = await exportConfig(persisted);
    if (ok) showToast("ok", t("toast.exported"));
    else showToast("error", t("toast.exportFailed"));
  }, [persisted, showToast, t]);

  const handleImport = useCallback(async () => {
    const imported = await importConfig();
    if (!imported) return; // cancelled or invalid
    setPersisted(imported);
    showToast("ok", t("toast.imported"));
  }, [showToast, t]);

  // ── Scenes (v1.2.0) ─────────────────────────────────────────────
  const saveScene = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const apps: SceneSnapshot["apps"] = {};
      for (const s of sessionsRef.current) {
        const exe = s.exe.toLowerCase();
        const route = routedRef.current[s.id];
        apps[exe] = { volume: s.volume, muted: s.muted, ...(route ? { route } : {}) };
      }
      const scene: SceneSnapshot = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        createdAt: Date.now(),
        apps,
        master: { volume: master.volume, muted: master.muted },
      };
      setPersisted((prev) => ({ ...prev, scenes: [...prev.scenes, scene] }));
      setSceneName("");
      showToast("ok", t("scenes.saved"), trimmed);
    },
    [master, showToast, t],
  );

  const applyScene = useCallback(
    (scene: SceneSnapshot) => {
      const b = bridgeRef.current;
      if (!b) return;
      const apps = scene.apps;
      // Apply master first.
      if (scene.master) {
        setMaster(scene.master);
        b.setMasterVolume(scene.master.volume).catch(() => {});
        b.setMasterMute(scene.master.muted).catch(() => {});
      }
      setSessions((prev) =>
        prev.map((s) => {
          const app = apps[s.exe.toLowerCase()];
          if (!app) return s;
          // Volume/mute.
          b.setVolume(s.id, app.volume).catch(() => {});
          b.setMute(s.id, app.muted).catch(() => {});
          engineMuteRef.current[s.id] = app.muted;
          // Route.
          if (app.route) {
            b.routeSessionDevice(s.pid, s.exe, app.route)
              .then(() => {
                setRoutedDevices((r) => ({ ...r, [s.id]: app.route! }));
              })
              .catch(() => {});
          }
          return { ...s, volume: app.volume, muted: app.muted };
        }),
      );
      showToast("ok", t("scenes.applied"), scene.name);
    },
    [showToast, t],
  );

  const deleteScene = useCallback(
    (id: string) => {
      setPersisted((prev) => ({ ...prev, scenes: prev.scenes.filter((sc) => sc.id !== id) }));
      showToast("info", t("scenes.deleted"));
    },
    [showToast, t],
  );

  // ── Auto-duck (v1.2.0) ──────────────────────────────────────────
  // Sample the input device level ~6x/s; while above threshold, duck every
  // render session by `amountDb`; release (with hysteresis) when it drops.
  useEffect(() => {
    const d = persisted.settings.ducking;
    if (!d.enabled) {
      if (duckingRef.current) {
        duckingRef.current = false;
        setDuckingNow(false);
        const base = duckBaseRef.current;
        duckBaseRef.current = {};
        for (const [id, vol] of Object.entries(base)) {
          setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume: vol } : s)));
          pendingVolumesRef.current.set(id, vol);
        }
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushVolumes();
          }, 45);
        }
      }
      return;
    }
    const iv = window.setInterval(() => {
      const peak = deviceInSource().peak;
      if (!duckingRef.current && peak >= d.threshold) {
        // Engage: snapshot current render volumes, then attenuate.
        duckingRef.current = true;
        setDuckingNow(true);
        const gain = Math.pow(10, -d.amountDb / 20);
        const base: Record<string, number> = {};
        for (const s of sessionsRef.current) {
          if (s.flow !== "render") continue;
          base[s.id] = s.volume;
          const target = clamp01(s.volume * gain);
          setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, volume: target } : x)));
          pendingVolumesRef.current.set(s.id, target);
        }
        duckBaseRef.current = base;
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushVolumes();
          }, 45);
        }
      } else if (duckingRef.current && peak < d.threshold * 0.5) {
        // Release: restore snapshot volumes.
        duckingRef.current = false;
        setDuckingNow(false);
        const base = duckBaseRef.current;
        duckBaseRef.current = {};
        for (const [id, vol] of Object.entries(base)) {
          setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume: vol } : s)));
          pendingVolumesRef.current.set(id, vol);
        }
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushVolumes();
          }, 45);
        }
      }
    }, 150);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted.settings.ducking.enabled, persisted.settings.ducking.threshold, persisted.settings.ducking.amountDb]);

  // ── Search + pin-aware session lists ────────────────────────────
  const displayNameFor = useCallback(
    (s: AudioSessionInfo) => persisted.renames[s.exe.toLowerCase()] ?? getDisplayName(s.exe),
    [persisted.renames],
  );

  const matchesQuery = useCallback(
    (s: AudioSessionInfo) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return displayNameFor(s).toLowerCase().includes(q) || s.exe.toLowerCase().includes(q);
    },
    [searchQuery, displayNameFor],
  );

  // Pinned first, then saved drag-order, then alphabetical.
  const sortChannels = useCallback(
    (list: AudioSessionInfo[]) => {
      const pinnedSet = new Set(persisted.pinned);
      const orderIdx = new Map(persisted.channelOrder.map((exe, i) => [exe, i]));
      return [...list].sort((a, b) => {
        const pa = pinnedSet.has(a.id) ? 0 : 1;
        const pb = pinnedSet.has(b.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const ia = orderIdx.get(a.exe.toLowerCase()) ?? Infinity;
        const ib = orderIdx.get(b.exe.toLowerCase()) ?? Infinity;
        if (ia !== ib) return ia - ib;
        return a.exe.toLowerCase().localeCompare(b.exe.toLowerCase());
      });
    },
    [persisted.pinned, persisted.channelOrder],
  );

  const allFiltered = useMemo(() => sessions.filter(matchesQuery), [sessions, matchesQuery]);
  const inputSessions = useMemo(
    () => sortChannels(allFiltered.filter((s) => s.flow === "capture")),
    [allFiltered, sortChannels],
  );
  const outputSessions = useMemo(
    () => sortChannels(allFiltered.filter((s) => s.flow !== "capture")),
    [allFiltered, sortChannels],
  );

  // ── Solo engine-sync (v1.2.0) ───────────────────────────────────
  // The effective engine mute = user mute OR (solo engaged AND channel not soloed).
  // We only push to the engine when the effective value actually changes.
  useEffect(() => {
    const b = bridgeRef.current;
    if (!b) return;
    const soloActive = Object.values(solo).some(Boolean);
    for (const s of sessionsRef.current) {
      const eff = s.muted || (soloActive && !solo[s.id]);
      if (engineMuteRef.current[s.id] !== eff) {
        engineMuteRef.current[s.id] = eff;
        b.setMute(s.id, eff).catch(() => {});
      }
    }
  }, [solo, sessions]);

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
        t("toast.wasapiOnline"),
        t("toast.wasapiOnlineBody", {
          n: data.sessions.length,
          s: data.sessions.length === 1 ? "" : "s",
          s2: data.sessions.length === 1 ? "" : "s",
        }),
      );

      cleanupFns.push(
        bridge.onVumeter((frames) => {
          const now = performance.now();
          let sumSq = 0, sumL = 0, sumR = 0;
          for (const f of frames) {
            levelsRef.current.set(f.id, { peak: f.peak, left: f.left, right: f.right, ts: now });
            // Device bus meters are not sessions — exclude from the master sum.
            if (f.id.startsWith("device:")) continue;
            sumSq += f.peak * f.peak;
            sumL += f.left * f.left;
            sumR += f.right * f.right;
          }
          const n = Math.max(1, frames.length);
          // Scale the master bus meter by the current master volume/mute so the
          // strip tracks the fader (session meters are pre-master, so only this
          // meter can show the actual output level).
          const masterGain = masterMutedRef.current ? 0 : masterVolumeRef.current;
          masterRef.current = {
            peak: Math.min(1, Math.sqrt(sumSq / n) * 1.12 * masterGain),
            left: Math.min(1, Math.sqrt(sumL / n) * 1.12 * masterGain),
            right: Math.min(1, Math.sqrt(sumR / n) * 1.12 * masterGain),
            ts: now,
          };
          frameCountRef.current++;
        })
      );

      cleanupFns.push(
        bridge.onSessionsChanged(() => {
          bridge.getSessions().then((s) => { if (!disposed) { setSessions(s); refreshRoutedDevices(s); } }).catch(() => {});
        })
      );

      // WASAPI IMMNotificationClient fires this when endpoints are added/removed/
      // disabled or the default device changes — refresh devices instantly (no
      // polling), re-derive the default out/in selection, and resync sessions
      // since a device swap invalidates which sessions are visible.
      cleanupFns.push(
        bridge.onDevicesChanged(() => {
          if (disposed) return;
          bridge
            .getDevices()
            .then((d) => {
              if (disposed) return;
              setDevices(d);
              const defOut = d.find((dev) => dev.flow !== "capture" && dev.isDefault)?.id ?? d.find((dev) => dev.flow !== "capture")?.id ?? "";
              const defIn = d.find((dev) => dev.flow === "capture" && dev.isDefault)?.id ?? d.find((dev) => dev.flow === "capture")?.id ?? "";
              setOutputDeviceId(defOut);
              setInputDeviceId(defIn);
            })
            .catch(() => {});
          // (Sessions are refreshed by the paired sessions-changed event the
          // Rust side emits together with devices-changed — no duplicate fetch.)
        })
      );

      // Apply the persisted close-to-tray behavior as soon as the bridge exists.
      bridge.setCloseBehavior(settingsRef.current.closeToTray).catch(() => {});
    };

    (async () => {
      try {
        const data = await b.init();
        if (!disposed) {
          attach(b, data);
          refreshRoutedDevices(data.sessions);
        }
      } catch (e) {
        showToast("error", t("toast.initError"), String(e));
      }
    })();

    b.getMasterControl()
      .then((m) => { if (!disposed) setMaster(m); })
      .catch(() => {});

    const statsIv = window.setInterval(() => {
      setStats((prev) => {
        const frames = frameCountRef.current;
        const hz = Math.max(0, (frames - prev.frames) * 2);
        const peak = masterRef.current.peak;
        setMasterDb(peak <= 0.0005 ? "−∞" : (20 * Math.log10(peak)).toFixed(1));
        return { hz, frames };
      });
    }, 500);

    // Sessions/devices are event-driven (IAudioSessionNotification +
    // IMMNotificationClient), so changes arrive instantly. Two lightweight
    // safety polls remain:
    //  - master volume/mute every 3s (Windows changes it externally: media
    //    keys, mixer, hotkeys);
    //  - session list every 10s as a fallback, because WASAPI has no
    //    "session destroyed" callback — when an app closes its session dies
    //    without any event, and this poll sweeps the stale card away.
    const pollIv = window.setInterval(() => {
      const b2 = bridgeRef.current;
      if (b2) {
        b2.getMasterControl().then((m) => { if (!disposed) setMaster(m); }).catch(() => {});
      }
    }, 3000);

    const sessionSweepIv = window.setInterval(() => {
      const b2 = bridgeRef.current;
      if (b2) {
        b2.getSessions().then((s) => { if (!disposed) setSessions(s); }).catch(() => {});
      }
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(statsIv);
      window.clearInterval(pollIv);
      window.clearInterval(sessionSweepIv);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      if (masterTimerRef.current !== null) window.clearTimeout(masterTimerRef.current);
      cleanupFns.forEach((fn) => fn());
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [showToast, t]);

  const flushVolumes = useCallback(() => {
    const b = bridgeRef.current;
    if (!b) return;
    pendingVolumesRef.current.forEach((volume, id) => {
      b.setVolume(id, volume).catch((e) => showToast("error", t("toast.volumeError"), String(e)));
    });
    pendingVolumesRef.current.clear();
  }, [showToast, t]);

  const handleVolume = useCallback(
    (id: string, volume: number) => {
      if (selectedIds.has(id) && selectedIds.size > 1) {
        // Multi-select: apply the same relative delta to every selected channel.
        setSessions((prev) => {
          const target = prev.find((s) => s.id === id);
          if (!target) return prev;
          const delta = volume - target.volume;
          const next = prev.map((s) =>
            selectedIds.has(s.id) ? { ...s, volume: clamp01(s.volume + delta) } : s,
          );
          for (const s of next) {
            if (selectedIds.has(s.id)) pendingVolumesRef.current.set(s.id, s.volume);
          }
          return next;
        });
      } else {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, volume } : s)));
        pendingVolumesRef.current.set(id, volume);
      }
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          flushVolumes();
        }, 45);
      }
    },
    [selectedIds, flushVolumes],
  );

  const handleMute = useCallback(
    (id: string, muted: boolean) => {
      if (selectedIds.has(id) && selectedIds.size > 1) {
        const ids = new Set(selectedIds);
        setSessions((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, muted } : s)));
        const b = bridgeRef.current;
        ids.forEach((sid) => {
          engineMuteRef.current[sid] = muted;
          b?.setMute(sid, muted).catch((e) => showToast("error", t("toast.muteError"), String(e)));
        });
      } else {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, muted } : s)));
        engineMuteRef.current[id] = muted;
        bridgeRef.current?.setMute(id, muted).catch((e) => showToast("error", t("toast.muteError"), String(e)));
      }
    },
    [selectedIds, showToast, t],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Drag-to-reorder (v1.2.0).
  const moveChannel = useCallback((fromExe: string, toExe: string) => {
    if (fromExe === toExe) return;
    setPersisted((prev) => {
      const order = prev.channelOrder.filter((x) => x !== fromExe);
      const idx = order.indexOf(toExe);
      if (idx === -1) order.push(fromExe);
      else order.splice(idx, 0, fromExe);
      return { ...prev, channelOrder: order };
    });
  }, []);

  const handleDragStart = useCallback((exe: string) => {
    setDragSource(exe);
    setDragOverExe(null);
  }, []);

  const handleDragOver = useCallback((exe: string) => {
    setDragOverExe((prev) => (prev === exe ? prev : exe));
  }, []);

  const handleDrop = useCallback(
    (exe: string) => {
      if (dragSource) moveChannel(dragSource, exe);
      setDragSource(null);
      setDragOverExe(null);
    },
    [dragSource, moveChannel],
  );

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDragOverExe(null);
  }, []);

  const handleOutputDevice = useCallback(
    (id: string) => {
      setOutputDeviceId(id);
      setDevices((prev) => prev.map((d) => (d.flow !== "capture" ? { ...d, isDefault: d.id === id } : d)));
      const name = devices.find((d) => d.id === id)?.name ?? id;
      bridgeRef.current?.setDevice(0, id).then(() => showToast("ok", t("toast.defaultOutput"), name)).catch((e) => showToast("error", t("toast.routingError"), String(e)));
    },
    [devices, showToast, t],
  );

  const handleInputDevice = useCallback(
    (id: string) => {
      setInputDeviceId(id);
      setDevices((prev) => prev.map((d) => (d.flow === "capture" ? { ...d, isDefault: d.id === id } : d)));
      const name = devices.find((d) => d.id === id)?.name ?? id;
      bridgeRef.current?.setDevice(0, id).then(() => showToast("ok", t("toast.defaultInput"), name)).catch((e) => showToast("error", t("toast.routingError"), String(e)));
    },
    [devices, showToast, t],
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
        showToast("ok", t("toast.rescanComplete"), t("toast.rescanCompleteBody", {
          sessions: s.length,
          s: s.length === 1 ? "" : "s",
          devices: d.length,
          s2: d.length === 1 ? "" : "s",
        }));
      })
      .catch((e) => showToast("error", t("toast.rescanFailed"), String(e)));
  }, [showToast, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); rescan(); }
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          clearSelection();
          return;
        }
        if (scenesOpen) { setScenesOpen(false); return; }
        if (searchQuery) {
          setSearchQuery("");
          searchInputRef.current?.blur();
        } else if (!bootDone) {
          setBootDone(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rescan, bootDone, searchQuery, selectedIds.size, clearSelection, scenesOpen]);

  const flushMasterVolume = useCallback(() => {
    const v = pendingMasterRef.current;
    pendingMasterRef.current = null;
    if (v !== null) {
      bridgeRef.current?.setMasterVolume(v).catch((e) => showToast("error", t("toast.masterVolumeError"), String(e)));
    }
  }, [showToast, t]);

  const handleMasterVolume = useCallback(
    (volume: number) => {
      setMaster((prev) => ({ ...prev, volume }));
      pendingMasterRef.current = volume;
      if (masterTimerRef.current === null) {
        masterTimerRef.current = window.setTimeout(() => {
          masterTimerRef.current = null;
          flushMasterVolume();
        }, 45);
      }
    },
    [flushMasterVolume],
  );

  const handleMasterMute = useCallback((muted: boolean) => {
    setMaster((prev) => ({ ...prev, muted }));
    bridgeRef.current?.setMasterMute(muted).catch((e) => showToast("error", t("toast.masterMuteError"), String(e)));
  }, [showToast, t]);

  const handleOpenWindowsRouting = useCallback(() => {
    bridgeRef.current?.openWindowsAppVolume()
      .then(() => showToast("info", t("toast.windowsAppVolume"), t("toast.windowsAppVolumeBody")))
      .catch((e) => showToast("error", t("toast.openFailed"), String(e)));
  }, [showToast, t]);

  // Route a single app session to an output device WITHOUT leaving SonoraMix
  // (persisted per-app default via Windows.Media.Internal.AudioPolicyConfig).
  const handleRouteSession = useCallback(
    (session: AudioSessionInfo, deviceId: string) => {
      const devName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
      // Invalidate any in-flight routed-device fetch so its stale response
      // can't clobber the optimistic update below (or the reset handler's).
      routedFetchIdRef.current++;
      bridgeRef.current
        ?.routeSessionDevice(session.pid, session.exe, deviceId)
        .then(() => {
          showToast("ok", t("toast.appRouted"), t("toast.appRoutedBody", { app: getDisplayName(session.exe), device: devName }));
          // Refresh so the channel shows its new device immediately.
          setRoutedDevices((prev) => ({ ...prev, [session.id]: deviceId }));
        })
        .catch((e) => showToast("error", t("toast.routingFailed"), String(e)));
    },
    [devices, showToast, t],
  );

  // Return an app to the system default output device.
  const handleResetSession = useCallback(
    (session: AudioSessionInfo) => {
      routedFetchIdRef.current++;
      bridgeRef.current
        ?.resetSessionDevice(session.pid, session.exe)
        .then(() => {
          showToast("ok", t("toast.routeReset"), t("toast.routeResetBody", { app: getDisplayName(session.exe) }));
          setRoutedDevices((prev) => {
            const next = { ...prev };
            delete next[session.id];
            return next;
          });
        })
        .catch((e) => showToast("error", t("toast.resetFailed"), String(e)));
    },
    [showToast, t],
  );

  const handleToggleDevice = useCallback(
    (deviceId: string, enabled: boolean) => {
      const b = bridgeRef.current;
      if (!b) return;
      b.toggleDeviceEnabled(deviceId, enabled)
        .then(() => {
          const devName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
          showToast("ok", enabled ? t("toast.deviceEnabled") : t("toast.deviceDisabled"), devName);
          // Re-fetch devices to update the state
          return b.getDevices();
        })
        .then((d) => {
          setDevices(d);
          // Also rescan sessions since newly enabled devices may have new sessions
          return b.getSessions();
        })
        .then((s) => setSessions(s))
        .catch((e) => showToast("error", t("toast.deviceToggleFailed"), String(e)));
    },
    [devices, showToast, t],
  );

  const isStreaming = stats.hz > 20;
  const deviceName = devices.find((d) => d.id === outputDeviceId)?.name ?? "";
  const soloActive = Object.values(solo).some(Boolean);
  const filteredCount = allFiltered.length;

  return (
    <MeterSettingsContext.Provider value={persisted.settings.meters}>
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
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckUpdates={() => handleCheckUpdates()}
        checkingUpdates={updateUi.kind === "checking"}
        downloading={updateUi.kind === "downloading"}
        updateAvailable={updateUi.kind === "available" || updateUi.kind === "downloading"}
      />

      <SettingsDrawer
        open={settingsOpen}
        settings={persisted.settings}
        onClose={() => setSettingsOpen(false)}
        onUpdate={updateSetting}
        appVersion={appVersion}
        desktop={isTauri()}
        onExport={handleExport}
        onImport={handleImport}
      />

      {(updateUi.kind === "available" || updateUi.kind === "downloading") && !updateDismissed && (
        <UpdateBanner
          update={updateUi.update}
          installing={updateUi.kind === "downloading"}
          progress={updateUi.kind === "downloading" ? updateUi.progress : 0}
          downloaded={updateUi.kind === "downloading" ? updateUi.downloaded : 0}
          total={updateUi.kind === "downloading" ? updateUi.total : 0}
          onInstall={handleInstallUpdate}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-[1600px] space-y-5">
          {/* Top Console Bar & View Mode Toggle */}
          <div className="glass-panel rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-signal shadow-[0_0_10px_rgba(255,121,64,0.6)]" />
              <div>
                <h1 className="font-display text-[16px] font-bold tracking-tight text-ink-100">
                  {t("console.title")}
                </h1>
                <p className="typo-caption text-[10px]">{t("console.subtitle")}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Channel search (Ctrl+F) */}
              <div className="relative">
                <input
                  id="channel-search"
                  name="channel-search"
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("console.search")}
                  className="h-[30px] w-[170px] rounded-lg bg-ink-900/80 border border-rule/50 pl-2.5 pr-7 text-[11px] font-mono text-ink-100 placeholder:text-ink-500 outline-none focus:border-route/50 transition-colors"
                  aria-label="Search channels"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearchQuery("");
                      e.currentTarget.blur();
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-100"
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Scenes (v1.2.0) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setScenesOpen((o) => !o)}
                  aria-expanded={scenesOpen}
                  aria-haspopup="menu"
                  className={`btn ${scenesOpen ? "btn-primary" : "btn-ghost"}`}
                  title={t("scenes.title")}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <rect x="2" y="2" width="5" height="5" rx="1" />
                    <rect x="9" y="2" width="5" height="5" rx="1" />
                    <rect x="2" y="9" width="5" height="5" rx="1" />
                    <rect x="9" y="9" width="5" height="5" rx="1" />
                  </svg>
                  <span className="hidden sm:inline text-[12px]">{t("scenes.title")}</span>
                  {persisted.scenes.length > 0 && (
                    <span className="led led-green" aria-hidden="true" />
                  )}
                </button>

                {scenesOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-50 w-[290px] rounded-xl border border-rule bg-panel/95 p-3 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-sm"
                    style={{ animation: "fade-in 0.14s ease both" }}
                  >
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-400">
                      {t("scenes.title")} — {persisted.scenes.length}
                    </p>

                    {/* Save current as... */}
                    <div className="mb-2 flex items-center gap-1.5">
                      <input
                        value={sceneName}
                        onChange={(e) => setSceneName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveScene(sceneName);
                        }}
                        placeholder={t("scenes.namePlaceholder")}
                        aria-label={t("scenes.save")}
                        className="h-7 min-w-0 flex-1 rounded-md border border-rule bg-ink-900/80 px-2 text-[11px] text-ink-100 placeholder:text-ink-500 outline-none focus:border-route/50"
                      />
                      <button
                        type="button"
                        onClick={() => saveScene(sceneName)}
                        disabled={!sceneName.trim()}
                        className="btn btn-primary h-7 px-2.5 text-[10px] disabled:opacity-40"
                      >
                        {t("scenes.saveBtn")}
                      </button>
                    </div>

                    {persisted.scenes.length === 0 ? (
                      <p className="rounded-md border border-dashed border-rule/60 px-3 py-4 text-center text-[10px] text-ink-500">
                        {t("scenes.empty")}
                      </p>
                    ) : (
                      <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-0.5">
                        {[...persisted.scenes].sort((a, b) => b.createdAt - a.createdAt).map((scene) => (
                          <div
                            key={scene.id}
                            className="group flex items-center gap-2 rounded-lg border border-rule bg-ink-900/70 px-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-semibold text-ink-100">{scene.name}</p>
                              <p className="text-[9px] text-ink-500">
                                {new Date(scene.createdAt).toLocaleString()} · {Object.keys(scene.apps).length} ch
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => applyScene(scene)}
                              title={t("scenes.apply")}
                              aria-label={`${t("scenes.apply")}: ${scene.name}`}
                              className="flex h-6 w-6 items-center justify-center rounded text-route transition-colors hover:bg-route/15"
                            >
                              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                <path d="M3 8l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteScene(scene.id)}
                              title={t("scenes.delete")}
                              aria-label={`${t("scenes.delete")}: ${scene.name}`}
                              className="flex h-6 w-6 items-center justify-center rounded text-ink-500 opacity-0 transition-all hover:bg-led-red/15 hover:text-led-red group-hover:opacity-100"
                            >
                              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Ducking indicator */}
              {duckingNow && (
                <span className="flex items-center gap-1.5 rounded-lg border border-led-amber/40 bg-led-amber/10 px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-led-amber animate-pulse">
                  <span className="led led-amber" style={{ width: "5px", height: "5px" }} />
                  AUTO-DUCK
                </span>
              )}

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
                  🎛️ {t("console.dual")} ({filteredCount})
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
                  🔊 {t("console.outputs")} ({outputSessions.length})
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
                  🎙️ {t("console.inputs")} ({inputSessions.length})
                </button>
              </div>
            </div>
          </div>

          {!booted ? (
            <div className="glass-panel rounded-xl p-6">
              <LoadSkeleton />
            </div>
          ) : (
            <>
              {/* 📟 DEVICE BUS METERS — actual hardware level */}
              <DeviceMeters
                outputSource={deviceOutSource}
                inputSource={deviceInSource}
                outputName={
                  devices.find((d) => d.id === outputDeviceId)?.name ??
                  devices.find((d) => d.flow !== "capture")?.name ??
                  ""
                }
                inputName={
                  devices.find((d) => d.id === inputDeviceId)?.name ??
                  devices.find((d) => d.flow === "capture")?.name ??
                  ""
                }
                outputMuted={master.muted}
              />
              {/* 🎙️ INPUT CONSOLE RACK (Microphones & Recording) */}
              {(filterTab === "all" || filterTab === "capture") && (
                <section className="glass-panel rounded-xl relative" aria-label="Input recording console">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-route rounded-l-xl" aria-hidden="true" />
                  <div className="ml-1.5 px-5 pt-4 pb-5 sm:px-6">
                    <div className="mb-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-route/15 text-route font-bold text-[12px]">
                          🎙️
                        </span>
                        <div>
                          <h2 className="font-display text-[14px] font-bold tracking-tight text-route">
                            {t("inputConsole.title")}
                          </h2>
                          <p className="typo-caption text-[10px]">
                            {inputSessions.length === 1 ? t("inputConsole.channel") : t("inputConsole.channels")}
                          </p>
                        </div>
                      </div>
                    </div>

                    {inputSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-rule/60 p-6 text-center">
                        <p className="typo-caption text-ink-300">
                          {searchQuery ? t("search.noMatch", { query: searchQuery }) : t("inputConsole.empty")}
                        </p>
                        <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ink-500">
                          {searchQuery ? t("search.hint") : t("inputConsole.emptyHint")}
                        </p>
                        {searchQuery ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery("");
                              searchInputRef.current?.focus();
                            }}
                            className="btn btn-ghost mt-3"
                          >
                            {t("search.clear")}
                          </button>
                        ) : (
                          <button type="button" onClick={rescan} className="btn btn-ghost mt-3">
                            <svg
                              viewBox="0 0 16 16"
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              aria-hidden="true"
                            >
                              <path d="M13 8a5 5 0 1 1-1.5-3.5" strokeLinecap="round" />
                              <path d="M13 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {t("search.rescan")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        className="grid gap-3.5 sm:gap-3.5"
                        style={{ gridTemplateColumns: "repeat(auto-fill, 272px)" }}
                      >
                        {inputSessions.map((s, i) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            index={i}
                            source={sessionSource(s.id)}
                            onVolume={handleVolume}
                            onMute={handleMute}
                            customName={persisted.renames[s.exe.toLowerCase()]}
                            pinned={persisted.pinned.includes(s.id)}
                            onTogglePin={() => togglePin(s.id)}
                            onRename={(name) => renameChannel(s.exe, name)}
                            soloed={!!solo[s.id]}
                            soloActive={soloActive}
                            onToggleSolo={() =>
                              setSolo((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                            }
                            selected={selectedIds.has(s.id)}
                            onSelect={() => toggleSelect(s.id)}
                            dragging={dragSource === s.exe}
                            dragOver={dragOverExe === s.exe}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 🔊 OUTPUT CONSOLE RACK (Application Playback & Music) */}
              {(filterTab === "all" || filterTab === "render") && (
                <section className="glass-panel rounded-xl relative" aria-label="Output playback console">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-signal rounded-l-xl" aria-hidden="true" />
                  <div className="ml-1.5 px-5 pt-4 pb-5 sm:px-6">
                    <div className="mb-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-signal/15 text-signal font-bold text-[12px]">
                          🔊
                        </span>
                        <div>
                          <h2 className="font-display text-[14px] font-bold tracking-tight text-signal">
                            {t("outputConsole.title")}
                          </h2>
                          <p className="typo-caption text-[10px]">
                            {outputSessions.length === 1 ? t("outputConsole.channel") : t("outputConsole.channels")}
                          </p>
                        </div>
                      </div>
                    </div>

                    {outputSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-rule/60 p-6 text-center">
                        <p className="typo-caption text-ink-300">
                          {searchQuery ? t("search.noMatch", { query: searchQuery }) : t("outputConsole.empty")}
                        </p>
                        {!searchQuery && (
                          <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ink-500">
                            {t("outputConsole.emptyHint")}
                          </p>
                        )}
                        {searchQuery ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery("");
                              searchInputRef.current?.focus();
                            }}
                            className="btn btn-primary mt-2"
                          >
                            {t("search.clear")}
                          </button>
                        ) : (
                          <button type="button" onClick={rescan} className="btn btn-primary mt-2">
                            {t("search.rescanOutput")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        className="grid gap-3.5 sm:gap-3.5"
                        style={{ gridTemplateColumns: "repeat(auto-fill, 272px)" }}
                      >
                        {outputSessions.map((s, i) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            index={i}
                            source={sessionSource(s.id)}
                            onVolume={handleVolume}
                            onMute={handleMute}
                            customName={persisted.renames[s.exe.toLowerCase()]}
                            pinned={persisted.pinned.includes(s.id)}
                            onTogglePin={() => togglePin(s.id)}
                            onRename={(name) => renameChannel(s.exe, name)}
                            renderDevices={devices.filter((d) => d.flow !== "capture")}
                            onRouteToDevice={(deviceId) => handleRouteSession(s, deviceId)}
                            onResetRoute={() => handleResetSession(s)}
                            onRoute={handleOpenWindowsRouting}
                            routedDeviceId={routedDevices[s.id]}
                            soloed={!!solo[s.id]}
                            soloActive={soloActive}
                            onToggleSolo={() =>
                              setSolo((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                            }
                            selected={selectedIds.has(s.id)}
                            onSelect={() => toggleSelect(s.id)}
                            dragging={dragSource === s.exe}
                            dragOver={dragOverExe === s.exe}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                          />
                        ))}
                        <MasterStrip
                          index={outputSessions.length}
                          source={masterSource}
                          deviceName={deviceName}
                          sessionsCount={sessions.length}
                          volume={master?.volume ?? 1}
                          muted={master?.muted ?? false}
                          onVolume={handleMasterVolume}
                          onMute={handleMasterMute}
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Multi-select action bar */}
          {selectedIds.size > 1 && (
            <div className="glass-panel rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold text-route">
                {t("select.selected", { n: selectedIds.size })}
              </p>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-[9px] text-ink-500">{t("select.multiHint")}</span>
                <button type="button" onClick={clearSelection} className="btn btn-ghost text-[11px]">
                  {t("select.clear")}
                </button>
              </div>
            </div>
          )}

        <div className="mt-4 text-center typo-caption text-ink-500 flex flex-wrap items-center justify-center gap-2 pb-2">
          <span>SonoraMix v{appVersion} — {t("footer.engine")}</span>
          <span className="text-rule/60">•</span>
          <button
            type="button"
            onClick={rescan}
            className="inline-flex items-center gap-1.5 rounded bg-ink-900/80 px-2 py-0.5 text-[11px] font-bold text-signal border border-signal/40 hover:bg-ink-800 hover:border-signal transition-all cursor-pointer shadow-sm"
            title={t("footer.rescan")}
          >
            <span>🔄 {t("footer.rescan")}</span>
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

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((tt) => tt.id !== id))} />

      {!bootDone && <BootOverlay version={appVersion} onDone={() => setBootDone(true)} />}
    </div>
    </MeterSettingsContext.Provider>
  );
}

function MasterStrip({ index, source, deviceName, sessionsCount, volume, muted, onVolume, onMute }: {
  index: number;
  source: LevelSource;
  deviceName: string;
  sessionsCount: number;
  volume: number;
  muted: boolean;
  onVolume: (volume: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const t = useT();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  return (
    <article
      className="group relative flex flex-col w-[272px] p-3.5 rounded-xl border border-signal/30 bg-gradient-to-b from-signal/8 via-panel-2/70 to-panel-2/70 hover:border-signal/50 transition-[border-color,box-shadow] duration-200"
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,121,64,0.08), 0 8px 22px rgba(0,0,0,0.3), 0 0 24px rgba(255,121,64,0.04)",
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
      aria-label="Master output bus"
    >
      {/* Master header — same card anatomy as channels, master identity */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-signal/35 bg-signal/12 shadow-[0_0_14px_rgba(255,121,64,0.3)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-signal" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="7.5" />
            <path d="M12 12 8 8" strokeLinecap="round" />
            <path d="M4 12h2M20 12h2M12 4v2M12 20v2" strokeLinecap="round" opacity="0.45" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-display text-[13px] font-bold tracking-tight text-signal">{t("master.out")}</h3>
            <span className="shrink-0 rounded px-1 py-px text-[8px] font-bold tracking-wider uppercase text-signal bg-signal/15 border border-signal/40">
              {t("master.bus")}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[9px] text-ink-400" title={deviceName}>
            {deviceName || t("master.awaiting")}
          </p>
        </div>
      </div>

      {/* Main Console Strip Module: Fader | dB Scale | Meter (same as channels) */}
      <div className="relative flex min-h-[165px] flex-1 items-stretch gap-2 px-0.5 py-1 rounded-lg border border-signal/20 bg-ink-950/70">
        {/* Fader Column */}
        <div className="flex w-[76px] flex-none flex-col items-center justify-between py-1">
          <Fader value={volume} onChange={onVolume} showValue={false} />
          <div className="mt-1 flex flex-col items-center leading-none">
            <span className="font-mono text-[10px] font-bold text-signal tracking-wider">
              {Math.round(volume * 100)}%
            </span>
            <span
              className={`mt-0.5 font-mono text-[8px] tracking-wider ${
                volume <= 0.0001 ? "text-ink-500" : "text-signal/80"
              }`}
            >
              {volumeToDb(volume)} dB
            </span>
          </div>
        </div>

        {/* dB Scale Markings */}
        <div className="flex w-[26px] flex-none flex-col justify-between items-center py-2.5 font-mono text-[7px] text-ink-500 select-none border-x border-rule/30">
          <span>0dB</span>
          <span>−6</span>
          <span>−12</span>
          <span>−30</span>
          <span>−60</span>
        </div>

        {/* Meter Column */}
        <div className="relative flex-1 min-w-0">
          <div className="meter-face h-full">
            <VumeterCanvas
              source={source}
              channels={2}
              className={`h-full w-full block transition-opacity duration-200 ${
                muted ? "opacity-25" : "opacity-100"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Bottom Footer: Mute + live dBFS readout (same as channels) */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onMute(!muted)}
          aria-pressed={muted}
          title={muted ? t("master.unmuteTitle") : t("master.muteTitle")}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold tracking-wider transition-all ${
            muted
              ? "btn-mute-active"
              : "bg-ink-800/80 text-ink-300 border border-rule/50 hover:bg-led-red/15 hover:text-led-red hover:border-led-red/40"
          }`}
        >
          <span className={`led ${muted ? "led-white" : "led-green"}`} style={{ width: "5px", height: "5px" }} />
          {muted ? t("channel.muted") : t("channel.mute")}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 font-mono text-[8px] text-ink-500 bg-ink-950/80 px-1.5 py-1 rounded border border-rule/30">
            <span className="text-ink-500">{sessionsCount} ch</span>
          </span>
          <div className="flex items-center gap-1 font-mono text-[9px] text-ink-300 bg-ink-950/80 px-2 py-1 rounded border border-rule/30">
            <span className="text-[8px] text-ink-500">dBFS</span>
            <DbReadout source={source} muted={() => mutedRef.current} />
          </div>
        </div>
      </div>
    </article>
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

const BOOT_STEPS = ["boot.step1", "boot.step2", "boot.step3", "boot.step4"];

function BootOverlay({ version, onDone }: { version: string; onDone: () => void }) {
  const t = useT();
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
      <p className="typo-caption mt-1.5">Audio Session Console · v{version}</p>

      <div className="mt-8 w-[min(400px,86vw)] space-y-1.5 font-mono text-[11px] text-ink-300">
        {BOOT_STEPS.slice(0, count).map((key, i) => (
          <div
            key={key}
            className="flex justify-between gap-3"
            style={{ animationDelay: `${i * 25}ms`, animation: "fade-in 0.22s ease both" }}
          >
            <span className="leading-tight">{t(key)}</span>
            <span className={`font-semibold tracking-wide ${key === "boot.step4" ? "text-led-green" : "text-route"}`}>
              {key === "boot.step4" ? "LIVE" : "OK"}
            </span>
          </div>
        ))}
        {count < BOOT_STEPS.length && (
          <span className="boot-cursor inline-block h-3.5 w-2 bg-route" aria-hidden="true" />
        )}
      </div>

      <p className="typo-caption absolute bottom-8">{t("boot.skip")}</p>
    </div>
  );
}
