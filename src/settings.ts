/**
 * SonoraMix — lightweight persistence layer.
 *
 * Backed by `localStorage` (persists inside the Tauri WebView2 data dir and
 * in browser previews). Stores:
 *   - App settings (accent theme, close-to-tray, launch minimized, autostart)
 *   - Pinned channel ids (pinned apps always sort first)
 *   - Custom channel names keyed by executable (e.g. "spotify.exe")
 */

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
}

export interface PersistedState {
  settings: AppSettings;
  /** Channel ids pinned on top (e.g. "render:discord.exe") */
  pinned: string[];
  /** Custom display names keyed by lowercase exe ("spotify.exe" -> "Spotify · Música") */
  renames: Record<string, string>;
}

const STORAGE_KEY = "sonoramix.v1.1";

export const DEFAULT_SETTINGS: AppSettings = {
  accent: "orange",
  closeToTray: true,
  launchMinimized: false,
  autostart: false,
  shortcuts: DEFAULT_SHORTCUTS,
  meters: DEFAULT_METER_SETTINGS,
};

const DEFAULTS: PersistedState = {
  settings: DEFAULT_SETTINGS,
  pinned: [],
  renames: {},
};

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const parsedSettings = (parsed.settings ?? {}) as Partial<AppSettings>;
    const savedMeters = (parsedSettings.meters ?? {}) as Partial<MeterSettings>;
    // Validate enumerations + numeric ranges so a hand-edited/corrupted saved
    // state can never feed NaN into the canvas renderer.
    const ledSize: LedSize = savedMeters.ledSize === "compact" || savedMeters.ledSize === "standard" || savedMeters.ledSize === "large"
      ? savedMeters.ledSize
      : DEFAULT_METER_SETTINGS.ledSize;
    const brightness = typeof savedMeters.brightness === "number" && Number.isFinite(savedMeters.brightness)
      ? Math.min(1.5, Math.max(0.5, savedMeters.brightness))
      : DEFAULT_METER_SETTINGS.brightness;
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...parsedSettings,
        // Deep-merge meters so partial/older saved states keep sane defaults.
        meters: {
          ...DEFAULT_METER_SETTINGS,
          ...savedMeters,
          ledSize,
          brightness,
          colors: {
            ...DEFAULT_METER_SETTINGS.colors,
            ...(savedMeters.colors ?? {}),
          },
        },
      },
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      renames: parsed.renames && typeof parsed.renames === "object" ? (parsed.renames as Record<string, string>) : {},
    };
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
