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
import type { AudioDeviceInfo, AudioSessionInfo, EngineMode, MasterControl, MeterFrame } from "../types";

/** Interface for audio operations */
export interface AudioBridge {
  readonly mode: EngineMode;
  
  /** Initialize the engine and get initial state */
  init(): Promise<{ sessions: AudioSessionInfo[]; devices: AudioDeviceInfo[] }>;
  
  /** Get current audio sessions */
  getSessions(): Promise<AudioSessionInfo[]>;
  
  /** Get current audio devices (endpoints) */
  getDevices(): Promise<AudioDeviceInfo[]>;
  
  /** Set volume for a specific session */
  setVolume(id: string, volume: number): Promise<void>;
  
  /** Set mute state for a specific session */
  setMute(id: string, muted: boolean): Promise<void>;
  
  /** Route output (pid 0 = system-wide) */
  setDevice(pid: number, deviceId: string): Promise<void>;
  
  /** Route a specific app session (all its processes) to an output device, in-app */
  routeSessionDevice(pid: number, exe: string, deviceId: string): Promise<void>;
  
  /** Current persisted output device id for a session ("" = system default) */
  getSessionRoutedDevice(pid: number, exe: string): Promise<string>;
  
  /** Reset a session's per-app output route back to the system default */
  resetSessionDevice(pid: number, exe: string): Promise<void>;
  
  /** Start the 60 Hz meter stream */
  startStream(): Promise<void>;
  
  /** Minimize window to system tray */
  minimizeToTray(): Promise<void>;
  
  /** Subscribe to meter updates. Returns unsubscribe function. */
  onVumeter(callback: (frames: MeterFrame[]) => void): () => void;
  
  /** Subscribe to session change events. Returns unsubscribe function. */
  onSessionsChanged(callback: () => void): () => void;

  /** Subscribe to device/endpoint change events. Returns unsubscribe function. */
  onDevicesChanged(callback: () => void): () => void;
  
  /** Enable or disable an audio endpoint in Windows */
  toggleDeviceEnabled(deviceId: string, enabled: boolean): Promise<void>;

  /** Get master volume + mute of the default render endpoint */
  getMasterControl(): Promise<MasterControl>;

  /** Set master volume (0..1) */
  setMasterVolume(volume: number): Promise<void>;

  /** Set master mute */
  setMasterMute(muted: boolean): Promise<void>;

  /** Open the Windows per-app volume/routing settings page */
  openWindowsAppVolume(): Promise<void>;

  /** Set whether closing the window minimizes to tray (true) or quits (false) */
  setCloseBehavior(minimize: boolean): Promise<void>;

  /** Toggle mute on the default microphone device; returns the new mute state */
  toggleGlobalMicMute(): Promise<boolean>;

  /** Toggle the main window between hidden (tray) and visible */
  toggleWindowVisibility(): Promise<void>;

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
  private unsubscribeDevices: (() => void) | null = null;

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

  getDevices(): Promise<AudioDeviceInfo[]> {
    return invoke<AudioDeviceInfo[]>("get_audio_devices");
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

  routeSessionDevice(pid: number, exe: string, deviceId: string): Promise<void> {
    return invoke<void>("route_session_device", { pid, exe, deviceId });
  }

  getSessionRoutedDevice(pid: number, exe: string): Promise<string> {
    return invoke<string>("get_session_routed_device", { pid, exe });
  }

  resetSessionDevice(pid: number, exe: string): Promise<void> {
    return invoke<void>("reset_session_device", { pid, exe });
  }

  startStream(): Promise<void> {
    return invoke<void>("start_vumeter_stream");
  }

  minimizeToTray(): Promise<void> {
    return invoke<void>("minimize_to_tray");
  }

  toggleDeviceEnabled(deviceId: string, enabled: boolean): Promise<void> {
    return invoke<void>("toggle_device_enabled", { deviceId, enabled });
  }

  getMasterControl(): Promise<MasterControl> {
    return invoke<MasterControl>("get_master_control");
  }

  setMasterVolume(volume: number): Promise<void> {
    return invoke<void>("set_master_volume", { volume });
  }

  setMasterMute(muted: boolean): Promise<void> {
    return invoke<void>("set_master_mute", { muted });
  }

  openWindowsAppVolume(): Promise<void> {
    return invoke<void>("open_windows_app_volume");
  }

  setCloseBehavior(minimize: boolean): Promise<void> {
    return invoke<void>("set_close_behavior", { minimize });
  }

  toggleGlobalMicMute(): Promise<boolean> {
    return invoke<boolean>("toggle_global_mic_mute");
  }

  toggleWindowVisibility(): Promise<void> {
    return invoke<void>("toggle_window_visibility");
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

  onDevicesChanged(callback: () => void): () => void {
    let disposed = false;
    
    listen<void>("devices-changed", () => {
      callback();
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
      } else {
        this.unsubscribeDevices = unsubscribe;
      }
    }).catch(console.error);

    return () => {
      disposed = true;
      this.unsubscribeDevices?.();
      this.unsubscribeDevices = null;
    };
  }

  dispose(): void {
    this.unsubscribeVumeter?.();
    this.unsubscribeSessions?.();
    this.unsubscribeDevices?.();
  }
}

/**
 * Mock bridge — activated with `?demo=1` in the URL so the full UI (channel
 * cards, routing bars, master strip, live meters) can be previewed in a plain
 * browser without the WASAPI backend. Emits synthetic 60 Hz meter frames.
 */
class MockBridge implements AudioBridge {
  readonly mode: EngineMode = "wasapi";
  private sessions: AudioSessionInfo[] = [];
  private devices: AudioDeviceInfo[] = [];
  private routed = new Map<string, string>();
  private meterTimer: number | null = null;
  private meterCb: ((frames: MeterFrame[]) => void) | null = null;
  private phase = 0;

  async init(): Promise<{ sessions: AudioSessionInfo[]; devices: AudioDeviceInfo[] }> {
    this.devices = [
      { id: "dev-speakers", name: "Realtek High Definition Audio", formFactor: "Speakers", isDefault: true, flow: "render", enabled: true, state: "active" },
      { id: "dev-headphones", name: "WH-1000XM4 (Bluetooth)", formFactor: "Headphones", isDefault: false, flow: "render", enabled: true, state: "active" },
      { id: "dev-hdmi", name: "Samsung Odyssey G7 (HDMI)", formFactor: "HDMI / DisplayPort", isDefault: false, flow: "render", enabled: true, state: "active" },
      { id: "dev-mic", name: "HyperX QuadCast S", formFactor: "Microphone", isDefault: true, flow: "capture", enabled: true, state: "active" },
      { id: "dev-mic2", name: "Realtek Microphone Array", formFactor: "Microphone", isDefault: false, flow: "capture", enabled: false, state: "disabled" },
    ];
    this.sessions = [
      { id: "render:spotify.exe", pid: 4821, exe: "spotify.exe", iconBase64: null, volume: 0.82, muted: false, channels: 2, flow: "render", state: "active" },
      { id: "render:chrome.exe", pid: 19044, exe: "chrome.exe", iconBase64: null, volume: 0.45, muted: false, channels: 2, flow: "render", state: "active" },
      { id: "render:discord.exe", pid: 8392, exe: "discord.exe", iconBase64: null, volume: 0.66, muted: true, channels: 2, flow: "render", state: "active" },
      { id: "render:cs2.exe", pid: 22105, exe: "cs2.exe", iconBase64: null, volume: 1.0, muted: false, channels: 2, flow: "render", state: "active" },
      { id: "render:obs64.exe", pid: 6023, exe: "obs64.exe", iconBase64: null, volume: 0.91, muted: false, channels: 2, flow: "render", state: "active" },
      { id: "capture:discord.exe", pid: 8392, exe: "discord.exe", iconBase64: null, volume: 0.74, muted: false, channels: 1, flow: "capture", state: "active" },
      { id: "capture:obs64.exe", pid: 6023, exe: "obs64.exe", iconBase64: null, volume: 0.5, muted: false, channels: 1, flow: "capture", state: "inactive" },
      { id: "render:msedge.exe", pid: 3310, exe: "msedge.exe", iconBase64: null, volume: 0.3, muted: false, channels: 2, flow: "render", state: "inactive" },
    ];
    this.routed.set("render:cs2.exe", "dev-headphones");
    this.routed.set("render:discord.exe", "dev-headphones");
    return { sessions: this.sessions, devices: this.devices };
  }

  getSessions(): Promise<AudioSessionInfo[]> {
    return Promise.resolve(this.sessions);
  }

  getDevices(): Promise<AudioDeviceInfo[]> {
    return Promise.resolve(this.devices);
  }

  setVolume(id: string, volume: number): Promise<void> {
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, volume } : s));
    return Promise.resolve();
  }

  setMute(id: string, muted: boolean): Promise<void> {
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, muted } : s));
    return Promise.resolve();
  }

  setDevice(_pid: number, deviceId: string): Promise<void> {
    this.devices = this.devices.map((d) => ({ ...d, isDefault: d.id === deviceId }));
    return Promise.resolve();
  }

  routeSessionDevice(pid: number, exe: string, deviceId: string): Promise<void> {
    const s = this.sessions.find((x) => x.pid === pid && x.exe === exe);
    if (s) this.routed.set(s.id, deviceId);
    return Promise.resolve();
  }

  getSessionRoutedDevice(pid: number, exe: string): Promise<string> {
    const s = this.sessions.find((x) => x.pid === pid && x.exe === exe);
    return Promise.resolve(s ? (this.routed.get(s.id) ?? "") : "");
  }

  resetSessionDevice(pid: number, exe: string): Promise<void> {
    const s = this.sessions.find((x) => x.pid === pid && x.exe === exe);
    if (s) this.routed.delete(s.id);
    return Promise.resolve();
  }

  startStream(): Promise<void> {
    this.stopStream();
    const tick = () => {
      this.phase += 0.06;
      if (this.meterCb) {
        const frames: MeterFrame[] = this.sessions.map((s, i) => {
          const base = s.state === "inactive" ? 0.02 : 0.25 + 0.3 * Math.abs(Math.sin(this.phase + i * 1.7));
          const l = Math.min(1, base * (0.9 + 0.2 * Math.sin(this.phase * 1.3 + i)));
          const r = Math.min(1, base * (0.9 + 0.2 * Math.cos(this.phase * 1.1 + i)));
          return { id: s.id, pid: s.pid, peak: Math.max(l, r), left: l, right: r };
        });
        frames.push({ id: "device:render", pid: 0, peak: 0.6, left: 0.58, right: 0.55 });
        frames.push({ id: "device:capture", pid: 0, peak: 0.35, left: 0.34, right: 0.32 });
        this.meterCb(frames);
      }
      this.meterTimer = window.setTimeout(tick, 16);
    };
    tick();
    return Promise.resolve();
  }

  private stopStream() {
    if (this.meterTimer !== null) {
      window.clearTimeout(this.meterTimer);
      this.meterTimer = null;
    }
  }

  minimizeToTray(): Promise<void> {
    return Promise.resolve();
  }

  toggleDeviceEnabled(deviceId: string, enabled: boolean): Promise<void> {
    this.devices = this.devices.map((d) => (d.id === deviceId ? { ...d, enabled, state: enabled ? "active" : "disabled" } : d));
    return Promise.resolve();
  }

  getMasterControl(): Promise<MasterControl> {
    return Promise.resolve({ volume: 0.72, muted: false });
  }

  setMasterVolume(_volume: number): Promise<void> {
    return Promise.resolve();
  }

  setMasterMute(_muted: boolean): Promise<void> {
    return Promise.resolve();
  }

  openWindowsAppVolume(): Promise<void> {
    return Promise.resolve();
  }

  setCloseBehavior(_minimize: boolean): Promise<void> {
    return Promise.resolve();
  }

  toggleGlobalMicMute(): Promise<boolean> {
    return Promise.resolve(true);
  }

  toggleWindowVisibility(): Promise<void> {
    return Promise.resolve();
  }

  onVumeter(callback: (frames: MeterFrame[]) => void): () => void {
    this.meterCb = callback;
    return () => {
      this.meterCb = null;
      this.stopStream();
    };
  }

  onSessionsChanged(_callback: () => void): () => void {
    return () => {};
  }

  onDevicesChanged(_callback: () => void): () => void {
    return () => {};
  }

  dispose(): void {
    this.stopStream();
    this.meterCb = null;
  }
}

/** Create bridge connected to native WASAPI backend */
export function createBridge(): AudioBridge {
  // `?demo=1` lets the full UI be previewed in a plain browser with synthetic
  // data and live meters (useful for visual iteration without the desktop app).
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
    return new MockBridge();
  }
  return new TauriBridge();
}
