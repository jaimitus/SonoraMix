//! Tauri IPC command surface.
//!
//! All commands are async and COM-thread-safe. Every command explicitly
//! guarantees COM apartment initialization on the calling thread and resolves
//! operations via the [`AudioEngine`] actor.

use serde::Serialize;
use tauri::{State, Window};

use crate::audio::engine::AudioEngine;
use crate::audio::wasapi::{self, DeviceInfo, SessionInfo};

/// Live engine diagnostics for the frontend health indicator.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineHealth {
    pub mode: &'static str,
    pub streaming: bool,
    pub frames_emitted: u64,
    pub sessions: u64,
    pub uptime_secs: u64,
    pub last_emit_micros: u64,
}

/// Retrieves all active audio sessions on the default endpoint.
/// Automatically starts the 60 Hz meter stream if not already active.
#[tauri::command]
pub async fn get_audio_sessions(
    engine: State<'_, AudioEngine>,
) -> Result<Vec<SessionInfo>, String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    
    // Auto-start meter stream when fetching sessions
    let _ = engine.start_meter();

    engine
        .sessions()
        .await
        .map_err(|e| e.to_user_message())
}

/// Sets the master volume for a specific session channel.
#[tauri::command]
pub async fn set_app_volume(
    engine: State<'_, AudioEngine>,
    id: String,
    volume: f32,
) -> Result<(), String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    let clamped = volume.clamp(0.0, 1.0);
    
    engine
        .set_volume(id, clamped)
        .await
        .map_err(|e| e.to_user_message())
}

/// Sets the mute state for a specific session channel.
#[tauri::command]
pub async fn set_app_mute(
    engine: State<'_, AudioEngine>,
    id: String,
    muted: bool,
) -> Result<(), String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    
    engine
        .set_mute(id, muted)
        .await
        .map_err(|e| e.to_user_message())
}

/// Enumerates all active audio endpoints (playback devices).
#[tauri::command]
pub async fn get_audio_devices(
    engine: State<'_, AudioEngine>,
) -> Result<Vec<DeviceInfo>, String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    
    engine
        .devices()
        .await
        .map_err(|e| e.to_user_message())
}

/// Routes audio output to a specific endpoint.
#[tauri::command]
pub async fn set_app_device(
    engine: State<'_, AudioEngine>,
    pid: u32,
    device_id: String,
) -> Result<(), String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    let _ = pid;
    
    engine
        .route_device(0, device_id)
        .await
        .map_err(|e| e.to_user_message())
}

/// Starts the 60 Hz vumeter stream.
#[tauri::command]
pub async fn start_vumeter_stream(engine: State<'_, AudioEngine>) -> Result<(), String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    
    engine.start_meter().map_err(|e| e.to_user_message())
}

/// Stops the vumeter stream.
#[tauri::command]
pub async fn stop_vumeter_stream(engine: State<'_, AudioEngine>) -> Result<(), String> {
    wasapi::ensure_com_init();
    let engine = engine.inner().clone();
    
    engine.stop_meter().map_err(|e| e.to_user_message())
}

/// Returns current engine health metrics.
#[tauri::command]
pub fn get_engine_health(engine: State<'_, AudioEngine>) -> Result<EngineHealth, String> {
    wasapi::ensure_com_init();
    let telemetry = engine.telemetry();
    
    Ok(EngineHealth {
        mode: "wasapi",
        streaming: telemetry.meter_running.load(std::sync::atomic::Ordering::Relaxed),
        frames_emitted: telemetry.frames_emitted.load(std::sync::atomic::Ordering::Relaxed),
        sessions: telemetry.session_count.load(std::sync::atomic::Ordering::Relaxed),
        uptime_secs: telemetry.started_at.elapsed().as_secs(),
        last_emit_micros: telemetry.last_emit_micros.load(std::sync::atomic::Ordering::Relaxed),
    })
}

/// Hides the console window to the system tray.
#[tauri::command]
pub fn minimize_to_tray(window: Window) -> Result<(), String> {
    window
        .hide()
        .map_err(|e| format!("Failed to hide window: {}", e))
}

/// Enables or disables an audio endpoint via IPolicyConfig::SetEndpointVisibility.
/// This allows users to activate disabled devices (e.g., PS5 controller mic)
/// directly from the SonoraMix UI without opening Windows Sound settings.
#[tauri::command]
pub async fn toggle_device_enabled(
    device_id: String,
    enabled: bool,
) -> Result<(), String> {
    wasapi::ensure_com_init();
    wasapi::toggle_device_enabled(&device_id, enabled)
        .map_err(|e| e.to_user_message())
}

/// Reads the master volume and mute state of the default render endpoint.
#[tauri::command]
pub async fn get_master_control() -> Result<wasapi::MasterControl, String> {
    wasapi::ensure_com_init();
    unsafe { wasapi::get_master_control() }.map_err(|e| e.to_user_message())
}

/// Sets the master volume (0..1) of the default render endpoint.
#[tauri::command]
pub async fn set_master_volume(volume: f32) -> Result<(), String> {
    wasapi::ensure_com_init();
    unsafe { wasapi::set_master_volume(volume) }.map_err(|e| e.to_user_message())
}

/// Sets the mute state of the default render endpoint.
#[tauri::command]
pub async fn set_master_mute(muted: bool) -> Result<(), String> {
    wasapi::ensure_com_init();
    unsafe { wasapi::set_master_mute(muted) }.map_err(|e| e.to_user_message())
}

/// Opens the Windows "App volume and device preferences" page for per-app routing.
#[tauri::command]
pub fn open_windows_app_volume() -> Result<(), String> {
    wasapi::open_windows_app_volume_settings().map_err(|e| e.to_user_message())
}

/// Sets whether closing the main window minimizes to the tray (true)
/// or fully quits the app (false).
#[tauri::command]
pub fn set_close_behavior(
    state: tauri::State<'_, crate::CloseBehavior>,
    minimize: bool,
) -> Result<(), String> {
    state
        .0
        .store(minimize, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Toggles mute on the system default microphone (capture endpoint) and
/// returns the new mute state. Used by the global mic-mute shortcut.
#[tauri::command]
pub async fn toggle_global_mic_mute() -> Result<bool, String> {
    wasapi::ensure_com_init();
    unsafe { wasapi::toggle_default_capture_mute() }.map_err(|e| e.to_user_message())
}

/// Toggles the main window between hidden (tray) and visible. Used by the
/// global show/hide shortcut.
#[tauri::command]
pub fn toggle_window_visibility(window: Window) -> Result<(), String> {
    if window.is_visible().map_err(|e| e.to_string())? {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}
