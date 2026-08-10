/**
 * SonoraMix — lightweight persistence layer.
 *
 * Backed by `localStorage` (persists inside the Tauri WebView2 data dir and
 * in browser previews). Stores:
 *   - App settings (accent theme, close-to-tray, launch minimized, autostart,
 *     language, auto-duck)
 *   - Pinned channel ids (pinned apps always sort first)
 *   - Custom channel names keyed by executable (e.g. "spotify.exe")
 *   - Custom channel order (drag & drop)
 *   - Saved scenes (full mixer snapshots)
 */

import { detectLang, type Lang } from "./i18n";

export type AccentId = "orange" | "emerald" | "ocean" | "blossom" | "violet" | "gold";

/** Configurable global shortcuts (accelerator strings, e.g. "Ctrl+Shift+M"). */
export interface Shortcuts {
  /** Toggle the system microphone mute */
  micMute: string;
  /** Show / hide the SonoraMix window */
  toggleWindow: string;
}

export const DEFAULT_SHORTCUTS: Shortcuts = {
  micMute: "Ctrl+Shift+M",
  toggleWindow: "Alt+Shift+S",
};

/** VU meter zone colors (green / amber / red segments). */
export interface MeterColors {
  green: string;
  amber: string;
  red: string;
}

/** LED ladder segment density. */
export type LedSize = "compact" | "standard" | "large";

/** VU meter appearance settings. */
export interface MeterSettings {
  /** Segment colors per zone */
  colors: MeterColors;
  /** Glow/lit intensity multiplier (0.5–1.5) */
  brightness: number;
  /** LED segment size (fewer+thicker vs more+thinner) */
  ledSize: LedSize;
  /** Show the peak-hold line */
  showPeakHold: boolean;
}

/** Quick color presets for the meter ladder. */
export const METER_PRESETS: { id: string; label: string; colors: MeterColors }[] = [
  { id: "vivid", label: "Vivid", colors: { green: "#25e08a", amber: "#ffc01e", red: "#ff3d4d" } },
  { id: "classic", label: "Classic", colors: { green: "#3fe082", amber: "#ffb020", red: "#ff5d5d" } },
  { id: "neon", label: "Neon", colors: { green: "#00ff9d", amber: "#ffe600", red: "#ff2a6d" } },
  { id: "ice", label: "Ice", colors: { green: "#4ade80", amber: "#facc15", red: "#f87171" } },
  { id: "mono", label: "Mono", colors: { green: "#d4d4d8", amber: "#a1a1aa", red: "#71717a" } },
];

export const DEFAULT_METER_SETTINGS: MeterSettings = {
  colors: { green: "#25e08a", amber: "#ffc01e", red: "#ff3d4d" },
  brightness: 1,
  ledSize: "standard",
  showPeakHold: true,
};

/** Auto-duck: lower playback channels while the mic is hot. */
export interface DuckSettings {
  /** Master toggle */
  enabled: boolean;
  /** Mic level (0..1) above which ducking engages */
  threshold: number;
  /** How much to cut playback volume, in dB (positive, e.g. 12 = -12 dB) */
  amountDb: number;
}

export const DEFAULT_DUCK_SETTINGS: DuckSettings = {
  enabled: false,
  threshold: 0.12,
  amountDb: 12,
};

export interface AppSettings {
  /** Accent color theme applied to the whole console */
  accent: AccentId;
  /** Minimize to system tray on window close (false = quit) */
  closeToTray: boolean;
  /** Start the app minimized to the tray */
  launchMinimized: boolean;
  /** Launch SonoraMix automatically when Windows starts */
  autostart: boolean;
  /** Global shortcut combinations */
  shortcuts: Shortcuts;
  /** VU meter appearance */
  meters: MeterSettings;
  /** UI language */
  language: Lang;
  /** Auto-duck playback when the mic level crosses the threshold */
  ducking: DuckSettings;
}

/** One saved mixer snapshot: volumes/mutes per app + master + routes. */
export interface SceneSnapshot {
  id: string;
  name: string;
  createdAt: number;
  /** Per-exe state (keyed by lowercase exe). "" volume means follow live. */
  apps: Record<string, { volume: number; muted: boolean; route?: string }>;
  /** Master strip state */
  master?: { volume: number; muted: boolean };
}

export interface PersistedState {
  settings: AppSettings;
  /** Channel ids pinned on top (e.g. "render:discord.exe") */
  pinned: string[];
  /** Custom display names keyed by lowercase exe ("spotify.exe" -> "Spotify · Música") */
  renames: Record<string, string>;
  /** Preferred channel order (lowercase exe keys, front = first) */
  channelOrder: string[];
  /** Saved mixer scenes */
  scenes: SceneSnapshot[];
}

const STORAGE_KEY = "sonoramix.v1.1";

export const DEFAULT_SETTINGS: AppSettings = {
  accent: "orange",
  closeToTray: true,
  launchMinimized: false,
  autostart: false,
  shortcuts: DEFAULT_SHORTCUTS,
  meters: DEFAULT_METER_SETTINGS,
  language: detectLang(),
  ducking: DEFAULT_DUCK_SETTINGS,
};

const DEFAULTS: PersistedState = {
  settings: DEFAULT_SETTINGS,
  pinned: [],
  renames: {},
  channelOrder: [],
  scenes: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/**
 * Sanitize an arbitrary parsed backup/state object into a valid PersistedState.
 * Used by `loadState` and by the config import feature (backup restore).
 */
export function sanitizeState(parsed: unknown): PersistedState {
  const p = (isRecord(parsed) ? parsed : {}) as Partial<PersistedState>;
  const parsedSettings = (isRecord(p.settings) ? p.settings : {}) as Partial<AppSettings>;
  const savedMeters = (isRecord(parsedSettings.meters) ? parsedSettings.meters : {}) as Partial<MeterSettings>;
  // Validate enumerations + numeric ranges so a hand-edited/corrupted saved
  // state can never feed NaN into the canvas renderer.
  const ledSize: LedSize = savedMeters.ledSize === "compact" || savedMeters.ledSize === "standard" || savedMeters.ledSize === "large"
    ? savedMeters.ledSize
    : DEFAULT_METER_SETTINGS.ledSize;
  const brightness = typeof savedMeters.brightness === "number" && Number.isFinite(savedMeters.brightness)
    ? Math.min(1.5, Math.max(0.5, savedMeters.brightness))
    : DEFAULT_METER_SETTINGS.brightness;
  const language = parsedSettings.language === "es" ? "es" : "en";
  const duckRaw = (isRecord(parsedSettings.ducking) ? parsedSettings.ducking : {}) as Partial<DuckSettings>;
  const duckThreshold = typeof duckRaw.threshold === "number" && Number.isFinite(duckRaw.threshold)
    ? Math.min(1, Math.max(0, duckRaw.threshold))
    : DEFAULT_DUCK_SETTINGS.threshold;
  const duckAmountDb = typeof duckRaw.amountDb === "number" && Number.isFinite(duckRaw.amountDb)
    ? Math.min(40, Math.max(0, duckRaw.amountDb))
    : DEFAULT_DUCK_SETTINGS.amountDb;
  const scenes = Array.isArray(p.scenes)
    ? p.scenes.filter((s): s is SceneSnapshot => isRecord(s) && typeof s.name === "string" && isRecord(s.apps))
    : [];
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      language,
      ducking: {
        ...DEFAULT_DUCK_SETTINGS,
        ...duckRaw,
        threshold: duckThreshold,
        amountDb: duckAmountDb,
      },
      // Deep-merge meters so partial/older saved states keep sane defaults.
      meters: {
        ...DEFAULT_METER_SETTINGS,
        ...savedMeters,
        ledSize,
        brightness,
        colors: {
          ...DEFAULT_METER_SETTINGS.colors,
          ...(isRecord(savedMeters.colors) ? savedMeters.colors : {}),
        },
      },
    },
    pinned: Array.isArray(p.pinned) ? p.pinned.filter((x): x is string => typeof x === "string") : [],
    renames: isRecord(p.renames) ? (p.renames as Record<string, string>) : {},
    channelOrder: Array.isArray(p.channelOrder) ? p.channelOrder.filter((x): x is string => typeof x === "string") : [],
    scenes,
  };
}

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return sanitizeState(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / privacy-mode failures are non-fatal.
  }
}

/** Accent theme presets (mirrors the `[data-accent]` rules in index.css). */
export const ACCENTS: { id: AccentId; label: string; signal: string; route: string }[] = [
  { id: "orange", label: "Sunset", signal: "#ff7940", route: "#33d1b8" },
  { id: "emerald", label: "Emerald", signal: "#2dd4a0", route: "#38bdf8" },
  { id: "ocean", label: "Ocean", signal: "#38bdf8", route: "#2dd4a0" },
  { id: "blossom", label: "Blossom", signal: "#f472b6", route: "#38bdf8" },
  { id: "violet", label: "Violet", signal: "#a78bfa", route: "#2dd4a0" },
  { id: "gold", label: "Gold", signal: "#fbbf24", route: "#34d399" },
];
