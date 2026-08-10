/**
 * SonoraMix — configuration export / import.
 *
 * Desktop (Tauri): uses the native save/open dialogs (tauri-plugin-dialog)
 * plus the `export_config` / `import_config` Rust commands for file IO.
 * Browser (demo): falls back to Blob download + `<input type=file>`.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./updater";
import { sanitizeState, type PersistedState } from "./settings";

function browserExport(state: PersistedState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sonoramix-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function browserImport(): Promise<PersistedState | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          resolve(sanitizeState(parsed));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

async function desktopExport(state: PersistedState): Promise<boolean> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      title: "Export SonoraMix configuration",
      defaultPath: `sonoramix-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return false; // cancelled
    await invoke("export_config", { path, contents: JSON.stringify(state, null, 2) });
    return true;
  } catch {
    return false;
  }
}

async function desktopImport(): Promise<PersistedState | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      title: "Import SonoraMix configuration",
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return null;
    const raw = await invoke<string>("import_config", { path });
    return sanitizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Export the current state; returns true on success. */
export async function exportConfig(state: PersistedState): Promise<boolean> {
  if (isTauri()) return desktopExport(state);
  try {
    browserExport(state);
    return true;
  } catch {
    return false;
  }
}

/** Import a config file; returns the sanitized state or null if cancelled/invalid. */
export async function importConfig(): Promise<PersistedState | null> {
  if (isTauri()) return desktopImport();
  return browserImport();
}
