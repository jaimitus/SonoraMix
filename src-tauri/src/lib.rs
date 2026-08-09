//! SonoraMix — Native Windows audio session mixer and endpoint router.
//!
//! ## Architecture
//!
//! - **Zero UI Lock**: All WASAPI/COM operations run on a dedicated worker thread
//!   with its own MTA COM apartment. The Tauri event loop never blocks.
//!
//! - **Phase-Locked Metering**: A second dedicated thread emits `vumeter-update`
//!   events at exactly 60 Hz using `Instant`-based timing to prevent drift.
//!
//! - **Graceful Degradation**: The frontend includes a simulation mode that
//!   activates when running outside a Tauri webview (browser preview).
//!
//! - **Close-to-Tray**: Closing the window hides it to the system tray;
//!   the engine remains active with the 60 Hz stream running.

mod audio;
mod commands;
mod error;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use audio::engine::AudioEngine;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tracing::{debug, error, info};

/// Runtime flag for the "minimize to tray on close" behavior.
/// `true` (default) hides the window to the tray; `false` quits the app.
#[derive(Clone)]
pub struct CloseBehavior(pub Arc<AtomicBool>);

impl Default for CloseBehavior {
    fn default() -> Self {
        // Default to minimize-to-tray (matches the historical behavior) —
        // `#[derive(Default)]` on Arc<AtomicBool> would give `false` = quit.
        Self(Arc::new(AtomicBool::new(true)))
    }
}

/// Application entry point.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            info!("initializing SonoraMix v{}", app.package_info().version);

            app.manage(CloseBehavior::default());

            // Initialize the audio engine with a handle to the app for events
            let engine = AudioEngine::start(Some(app.handle().clone()));
            app.manage(engine);
            info!("audio engine initialized and managed");

            // Set up system tray with menu
            setup_tray(app)?;

            // Configure close-to-tray behavior
            setup_window_behavior(app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_audio_sessions,
            commands::set_app_volume,
            commands::set_app_mute,
            commands::get_audio_devices,
            commands::set_app_device,
            commands::start_vumeter_stream,
            commands::stop_vumeter_stream,
            commands::get_engine_health,
            commands::minimize_to_tray,
            commands::toggle_device_enabled,
            commands::get_master_control,
            commands::set_master_volume,
            commands::set_master_mute,
            commands::open_windows_app_volume,
            commands::set_close_behavior,
            commands::toggle_global_mic_mute,
            commands::toggle_window_visibility,
        ])
        .run(tauri::generate_context!())
        .expect("fatal error while running SonoraMix runtime");
}

/// Configures the system tray with icon and context menu.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open SonoraMix", true, None::<&str>)?;
    let restart_item =
        MenuItem::with_id(app, "restart-stream", "Restart Meter Stream", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit SonoraMix", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &restart_item, &separator, &quit_item])?;

    TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/icon.png"))
        .icon_as_template(false)
        .tooltip("SonoraMix — Audio Session Console")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open" => {
                    debug!("tray menu: open requested");
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "restart-stream" => {
                    info!("tray menu: restarting meter stream");
                    if let Some(engine) = app.try_state::<AudioEngine>() {
                        engine.restart_meter();
                    }
                }
                "quit" => {
                    info!("tray menu: quit requested");
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                debug!("tray icon clicked");
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    info!("system tray configured successfully");
    Ok(())
}

/// Sets up window event handlers for close behavior.
/// Reads the runtime [`CloseBehavior`] flag: `true` hides to tray, `false` quits.
fn setup_window_behavior(app: &tauri::App) {
    let close_behavior = app.state::<CloseBehavior>().inner().clone();
    if let Some(window) = app.get_webview_window("main") {
        let win = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_behavior.0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    if let Err(e) = win.hide() {
                        error!("failed to hide window: {}", e);
                    } else {
                        info!("window hidden to tray");
                    }
                } else {
                    info!("close requested with close-to-tray disabled — quitting");
                }
            }
        });
    }
}
