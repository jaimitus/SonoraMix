//! WASAPI change notifications — instant alternatives to polling.
//!
//! A dedicated thread owns its COM MTA and registers two COM callbacks:
//!
//! - [`IMMNotificationClient`] on the device enumerator → fires when audio
//!   endpoints are added/removed/disabled or the default device changes.
//! - [`IAudioSessionNotification`] on every active endpoint's session manager
//!   → fires when an application starts/stops an audio session.
//!
//! Callbacks run on COM pool threads and simply emit Tauri events
//! (`devices-changed`, `sessions-changed`); the frontend re-fetches on demand,
//! so no 3 s polling is needed for sessions/devices anymore.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tracing::warn;
use windows::core::{implement, Result as WinResult, PCWSTR};
use windows::Win32::Media::Audio::{
    IAudioSessionControl, IAudioSessionManager2, IAudioSessionNotification,
    IAudioSessionNotification_Impl, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow,
    ERole, eCapture, eRender,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

use super::wasapi::ComToken;

/// Receives device-level notifications (endpoints added/removed/state/default).
/// Note: `#[implement]` renames this to `DeviceNotifier_Impl` internally and
/// generates the `DeviceNotifier` wrapper — the interface trait must be
/// implemented for `DeviceNotifier_Impl`.
#[implement(IMMNotificationClient)]
struct DeviceNotifier {
    app: AppHandle,
}

impl DeviceNotifier_Impl {
    fn emit_changed(&self) {
        // Device changes also affect which sessions exist.
        let _ = self.app.emit("devices-changed", ());
        let _ = self.app.emit("sessions-changed", ());
    }
}

impl IMMNotificationClient_Impl for DeviceNotifier_Impl {
    fn OnDeviceStateChanged(&self, _device_id: &PCWSTR, _new_state: DEVICE_STATE) -> WinResult<()> {
        self.emit_changed();
        Ok(())
    }
    fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> WinResult<()> {
        self.emit_changed();
        Ok(())
    }
    fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> WinResult<()> {
        self.emit_changed();
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, _flow: EDataFlow, _role: ERole, _default_device_id: &PCWSTR) -> WinResult<()> {
        self.emit_changed();
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _device_id: &PCWSTR, _key: &PROPERTYKEY) -> WinResult<()> {
        Ok(())
    }
}

/// Receives session-level notifications (application starts/stops audio).
#[implement(IAudioSessionNotification)]
struct SessionNotifier {
    app: AppHandle,
}

impl IAudioSessionNotification_Impl for SessionNotifier_Impl {
    fn OnSessionCreated(&self, _new_session: Option<&IAudioSessionControl>) -> WinResult<()> {
        let _ = self.app.emit("sessions-changed", ());
        Ok(())
    }
}

/// Spawns the notification thread and returns its handle.
pub fn spawn_notification_thread(app: AppHandle) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("sonoramix-notify".to_string())
        .spawn(move || {
            let _com = match ComToken::initialize() {
                Ok(token) => token,
                Err(_) => return,
            };
            run(app);
        })
        .expect("failed to spawn notification thread")
}

fn run(app: AppHandle) {
    let enumerator: IMMDeviceEnumerator = match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
        Ok(e) => e,
        Err(err) => {
            warn!("notification thread: creating device enumerator failed: {err}");
            return;
        }
    };

    let device_notifier: IMMNotificationClient = DeviceNotifier { app: app.clone() }.into();
    if let Err(e) = unsafe { enumerator.RegisterEndpointNotificationCallback(&device_notifier) } {
        warn!("notification thread: registering endpoint callback failed: {e}");
    }

    let session_notifier: IAudioSessionNotification = SessionNotifier { app: app.clone() }.into();
    let mut managers: HashMap<String, IAudioSessionManager2> = HashMap::new();
    let mut last_scan = Instant::now() - Duration::from_secs(60);
    let mut scan_count: u64 = 0;

    // Poll-free: the loop only keeps the session-notification registrations in
    // sync with the current set of active endpoints (devices plug/unplug).
    loop {
        if last_scan.elapsed() > Duration::from_secs(2) {
            last_scan = Instant::now();
            scan_count += 1;
            // Periodically rebuild the registration set so removed devices
            // drop their (now stale) session-manager references.
            if scan_count % 15 == 0 {
                managers.clear();
            }
            unsafe { sync_session_notifications(&enumerator, &session_notifier, &mut managers) };
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

unsafe fn sync_session_notifications(
    enumerator: &IMMDeviceEnumerator,
    notifier: &IAudioSessionNotification,
    managers: &mut HashMap<String, IAudioSessionManager2>,
) {
    for flow in [eRender, eCapture] {
        let collection = match unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) } {
            Ok(c) => c,
            Err(_) => continue,
        };
        let count = unsafe { collection.GetCount() }.unwrap_or(0);

        for i in 0..count {
            let Ok(device) = (unsafe { collection.Item(i) }) else { continue };
            let Ok(id) = (unsafe { device.GetId() }) else { continue };
            let id_str = unsafe { id.to_string() }.unwrap_or_default();
            if id_str.is_empty() || managers.contains_key(&id_str) {
                continue;
            }
            let Ok(manager): Result<IAudioSessionManager2, _> =
                (unsafe { device.Activate(CLSCTX_ALL, None) })
            else {
                continue;
            };
            if unsafe { manager.RegisterSessionNotification(notifier) }.is_ok() {
                managers.insert(id_str, manager);
            }
        }
    }
}
