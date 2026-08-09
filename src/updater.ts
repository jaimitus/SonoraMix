/**
 * SonoraMix — updater integration.
 *
 * Thin typed wrapper around the Tauri updater + process plugins so the UI can
 * check for, download and install new versions published on GitHub Releases.
 * Every function is safe to call from a plain browser preview (they report
 * "unsupported" instead of throwing).
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

/** Compile-time fallback version — kept in sync with `tauri.conf.json`. */
export const APP_VERSION = "1.0.2";

/** True when running inside the Tauri webview (vs. a plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Resolve the running app version (falls back to APP_VERSION in browsers). */
export async function currentVersion(): Promise<string> {
  if (!isTauri()) return APP_VERSION;
  try {
    return await getVersion();
  } catch {
    return APP_VERSION;
  }
}

export type UpdateCheckResult =
  | { status: "up-to-date"; current: string }
  | { status: "update-available"; update: Update; version: string; current: string }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/** Ask the GitHub Releases endpoint whether a newer SonoraMix exists. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { status: "unsupported" };
  const current = await currentVersion();
  try {
    const update = await check();
    if (update) {
      return { status: "update-available", update, version: update.version, current };
    }
    return { status: "up-to-date", current };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface DownloadProgress {
  /** Bytes downloaded so far */
  downloaded: number;
  /** Total bytes to download (0 until the server reports it) */
  total: number;
  /** 0..1 completion ratio */
  ratio: number;
}

/**
 * Download + install a pending update, reporting progress through the
 * callback. The app is relaunched automatically once installation finishes.
 */
export async function installUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress({ downloaded: 0, total, ratio: 0 });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress({ downloaded, total, ratio: total > 0 ? Math.min(1, downloaded / total) : 0 });
    } else if (event.event === "Finished") {
      onProgress({ downloaded: total, total, ratio: 1 });
    }
  });
  await relaunch();
}
