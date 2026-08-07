/**
 * Type definitions for SonoraMix.
 * 
 * These interfaces mirror the Rust data structures for IPC serialization
 * and provide strict typing for the entire application.
 */

/** 
 * Audio session information from WASAPI.
 * Mirrors Rust `SessionInfo` struct.
 */
export interface AudioSessionInfo {
  /** Unique session channel identifier (e.g., "render:spotify.exe") */
  id: string;
  /** Process ID */
  pid: number;
  /** Executable filename (e.g., "spotify.exe") */
  exe: string;
  /** Base64 BMP data URI or null for fallback */
  iconBase64: string | null;
  /** Master volume 0.0-1.0 */
  volume: number;
  /** Mute state */
  muted: boolean;
  /** Number of audio channels */
  channels: number;
  /** Audio flow direction: "render" (Playback) or "capture" (Microphone Input) */
  flow: "render" | "capture";
}

/**
 * Audio endpoint (playback/recording device) information.
 * Mirrors Rust `DeviceInfo` struct.
 */
export interface AudioDeviceInfo {
  /** Device ID string */
  id: string;
  /** Human-readable device name */
  name: string;
  /** Physical form factor (Speakers, Headphones, Microphone, etc.) */
  formFactor: string;
  /** Whether this is the current default device */
  isDefault: boolean;
  /** Audio flow direction: "render" (Playback) or "capture" (Microphone Input) */
  flow: "render" | "capture";
}

/**
 * Single meter frame from the 60 Hz stream.
 * Mirrors Rust `MeterFrame` struct.
 */
export interface MeterFrame {
  /** Unique session channel identifier */
  id: string;
  /** Process ID */
  pid: number;
  /** Overall peak level 0.0-1.0 */
  peak: number;
  /** Left channel peak 0.0-1.0 */
  left: number;
  /** Right channel peak 0.0-1.0 */
  right: number;
}

/** Engine runtime mode */
export type EngineMode = "wasapi";

/** Level sample stored in the mutable level bus */
export interface LevelSample {
  peak: number;
  left: number;
  right: number;
  /** Timestamp for staleness detection */
  ts: number;
}

/** Function type for reading from the level bus */
export type LevelSource = () => LevelSample;

/** Toast notification severity levels */
export type ToastKind = "ok" | "info" | "error";

/** Toast notification item */
export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

/** Engine health telemetry */
export interface EngineHealth {
  mode: "wasapi";
  streaming: boolean;
  framesEmitted: number;
  sessions: number;
  uptimeSecs: number;
  lastEmitMicros: number;
}
