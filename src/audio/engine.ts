/**
 * Audio Bridge - Direct native WASAPI IPC interface.
 * 
 * All audio session operations, volume control, mute, endpoint routing,
 * and 60 Hz metering event streaming communicate directly with the Rust backend.
 * 
 * @module audio/engine
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioDeviceInfo, AudioSessionInfo, EngineMode, MeterFrame } from "../types";

/** Interface for audio operations */
export interface AudioBridge {
  readonly mode: EngineMode;
  
  /** Initialize the engine and get initial state */
  init(): Promise<{ sessions: AudioSessionInfo[]; devices: AudioDeviceInfo[] }>;
  
  /** Get current audio sessions */
  getSessions(): Promise<AudioSessionInfo[]>;
  
  /** Set volume for a specific session */
  setVolume(id: string, volume: number): Promise<void>;
  
  /** Set mute state for a specific session */
  setMute(id: string, muted: boolean): Promise<void>;
  
  /** Route output (pid 0 = system-wide) */
  setDevice(pid: number, deviceId: string): Promise<void>;
  
  /** Start the 60 Hz meter stream */
  startStream(): Promise<void>;
  
  /** Minimize window to system tray */
  minimizeToTray(): Promise<void>;
  
  /** Subscribe to meter updates. Returns unsubscribe function. */
  onVumeter(callback: (frames: MeterFrame[]) => void): () => void;
  
  /** Subscribe to session change events. Returns unsubscribe function. */
  onSessionsChanged(callback: () => void): () => void;
  
  /** Clean up resources */
  dispose(): void;
}

/** Detect if running inside Tauri webview */
export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Tauri bridge using native WASAPI backend.
 */
class TauriBridge implements AudioBridge {
  readonly mode: EngineMode = "wasapi";
  private unsubscribeVumeter: (() => void) | null = null;
  private unsubscribeSessions: (() => void) | null = null;

  async init(): Promise<{ sessions: AudioSessionInfo[]; devices: AudioDeviceInfo[] }> {
    try {
      const [sessions, devices] = await Promise.all([
        invoke<AudioSessionInfo[]>("get_audio_sessions").catch((e) => {
          console.error("get_audio_sessions error:", e);
          return [] as AudioSessionInfo[];
        }),
        invoke<AudioDeviceInfo[]>("get_audio_devices").catch((e) => {
          console.error("get_audio_devices error:", e);
          return [] as AudioDeviceInfo[];
        }),
      ]);
      await this.startStream().catch(() => {});
      return { sessions: sessions || [], devices: devices || [] };
    } catch (e) {
      console.error("TauriBridge init failed:", e);
      return { sessions: [], devices: [] };
    }
  }

  getSessions(): Promise<AudioSessionInfo[]> {
    return invoke<AudioSessionInfo[]>("get_audio_sessions");
  }

  setVolume(id: string, volume: number): Promise<void> {
    return invoke<void>("set_app_volume", { id, volume });
  }

  setMute(id: string, muted: boolean): Promise<void> {
    return invoke<void>("set_app_mute", { id, muted });
  }

  setDevice(pid: number, deviceId: string): Promise<void> {
    return invoke<void>("set_app_device", { pid, deviceId });
  }

  startStream(): Promise<void> {
    return invoke<void>("start_vumeter_stream");
  }

  minimizeToTray(): Promise<void> {
    return invoke<void>("minimize_to_tray");
  }

  onVumeter(callback: (frames: MeterFrame[]) => void): () => void {
    let disposed = false;
    
    listen<MeterFrame[]>("vumeter-update", (event) => {
      callback(event.payload);
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
      } else {
        this.unsubscribeVumeter = unsubscribe;
      }
    }).catch(console.error);

    return () => {
      disposed = true;
      this.unsubscribeVumeter?.();
      this.unsubscribeVumeter = null;
    };
  }

  onSessionsChanged(callback: () => void): () => void {
    let disposed = false;
    
    listen<void>("sessions-changed", () => {
      callback();
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
      } else {
        this.unsubscribeSessions = unsubscribe;
      }
    }).catch(console.error);

    return () => {
      disposed = true;
      this.unsubscribeSessions?.();
      this.unsubscribeSessions = null;
    };
  }

  dispose(): void {
    this.unsubscribeVumeter?.();
    this.unsubscribeSessions?.();
  }
}

/** Create bridge connected to native WASAPI backend */
export function createBridge(): AudioBridge {
  return new TauriBridge();
}
