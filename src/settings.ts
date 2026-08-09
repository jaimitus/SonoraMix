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

export interface AppSettings {
  /** Accent color theme applied to the whole console */
  accent: AccentId;
  /** Minimize to system tray on window close (false = quit) */
  closeToTray: boolean;
  /** Start the app minimized to the tray */
  launchMinimized: boolean;
  /** Launch SonoraMix automatically when Windows starts */
  autostart: boolean;
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
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
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
