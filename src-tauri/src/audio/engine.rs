//! SonoraMix audio engine actor.
//!
//! ## Threading Model
//!
//! - **Worker Thread**: Owns a COM MTA apartment, processes all WASAPI
//!   operations via request/response channels. Ensures the Tauri event
//!   loop never blocks on COM calls.
//!
//! - **Meter Thread**: Separate COM apartment, maintains hot interface
//!   cache, emits 60 Hz `vumeter-update` events via Tauri's `AppHandle`.
//!
//! ## Communication
//!
//! - Commands: `mpsc` channel with `tokio::sync::oneshot` replies
//! - Meter events: Direct `AppHandle::emit` calls
//! - Shutdown: `AtomicBool` flag for cooperative meter thread exit

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tracing::{debug, error, info, warn};

use super::wasapi::{
    self, ComToken, DeviceInfo, MeterFrame, SessionEntry, SessionInfo,
};
use crate::error::{SonoraError, SonoraResult};

/// Type alias for engine operation results.
pub type EngineResult<T> = SonoraResult<T>;

// =============================================================================
// Telemetry
// =============================================================================

/// Thread-safe telemetry metrics updated by the meter thread.
#[derive(Clone)]
pub struct Telemetry {
    pub frames_emitted: Arc<AtomicU64>,
    pub last_emit_micros: Arc<AtomicU64>,
    pub session_count: Arc<AtomicU64>,
    pub meter_running: Arc<AtomicBool>,
    pub started_at: Instant,
}

impl Default for Telemetry {
    fn default() -> Self {
        Self {
            frames_emitted: Arc::new(AtomicU64::new(0)),
            last_emit_micros: Arc::new(AtomicU64::new(0)),
            session_count: Arc::new(AtomicU64::new(0)),
            meter_running: Arc::new(AtomicBool::new(false)),
            started_at: Instant::now(),
        }
    }
}

// =============================================================================
// Request Protocol
// =============================================================================

enum Request {
    Sessions {
        reply: oneshot::Sender<EngineResult<Vec<SessionInfo>>>,
    },
    SetVolume {
        id: String,
        volume: f32,
        reply: oneshot::Sender<EngineResult<()>>,
    },
    SetMute {
        id: String,
        muted: bool,
        reply: oneshot::Sender<EngineResult<()>>,
    },
    Devices {
        reply: oneshot::Sender<EngineResult<Vec<DeviceInfo>>>,
    },
    RouteDevice {
        pid: u32,
        device_id: String,
        reply: oneshot::Sender<EngineResult<()>>,
    },
    StartMeter,
    StopMeter,
    #[allow(dead_code)]
    Shutdown,
}

// =============================================================================
// Public API
// =============================================================================

/// Handle to the audio engine. Clone to get additional references.
#[derive(Clone)]
pub struct AudioEngine {
    tx: mpsc::Sender<Request>,
    telemetry: Telemetry,
}

impl AudioEngine {
    /// Starts the audio engine worker thread.
    ///
    /// # Arguments
    /// * `app` - Optional AppHandle for emitting meter events. Pass None for headless testing.
    pub fn start(app: Option<AppHandle>) -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        let telemetry = Telemetry::default();
        let worker_telemetry = telemetry.clone();

        thread::Builder::new()
            .name("sonoramix-wasapi".to_string())
            .spawn(move || worker_loop(rx, app, worker_telemetry))
            .expect("failed to spawn WASAPI worker thread");

        info!("audio engine started");
        Self { tx, telemetry }
    }

    pub fn telemetry(&self) -> &Telemetry {
        &self.telemetry
    }

    /// Generic request/reply helper.
    async fn rpc<R, F>(&self, build: F) -> EngineResult<R>
    where
        R: Send + 'static,
        F: FnOnce(oneshot::Sender<EngineResult<R>>) -> Request,
    {
        let (reply, recv) = oneshot::channel();
        self.tx
            .send(build(reply))
            .map_err(|_| SonoraError::Internal("engine worker is offline".to_string()))?;

        recv.await
            .map_err(|_| SonoraError::Internal("worker dropped reply channel".to_string()))?
    }

    // Command wrappers
    pub async fn sessions(&self) -> EngineResult<Vec<SessionInfo>> {
        self.rpc(|reply| Request::Sessions { reply }).await
    }

    pub async fn set_volume(&self, id: String, volume: f32) -> EngineResult<()> {
        self.rpc(|reply| Request::SetVolume { id, volume, reply }).await
    }

    pub async fn set_mute(&self, id: String, muted: bool) -> EngineResult<()> {
        self.rpc(|reply| Request::SetMute { id, muted, reply }).await
    }

    pub async fn devices(&self) -> EngineResult<Vec<DeviceInfo>> {
        self.rpc(|reply| Request::Devices { reply }).await
    }

    pub async fn route_device(&self, pid: u32, device_id: String) -> EngineResult<()> {
        self.rpc(|reply| Request::RouteDevice {
            pid,
            device_id,
            reply,
        })
        .await
    }

    pub fn start_meter(&self) -> EngineResult<()> {
        self.tx
            .send(Request::StartMeter)
            .map_err(|_| SonoraError::Internal("engine offline".to_string()))
    }

    pub fn stop_meter(&self) -> EngineResult<()> {
        self.tx
            .send(Request::StopMeter)
            .map_err(|_| SonoraError::Internal("engine offline".to_string()))
    }

    pub fn restart_meter(&self) {
        let _ = self.stop_meter();
        let _ = self.start_meter();
    }

    #[allow(dead_code)]
    pub fn shutdown(&self) {
        let _ = self.tx.send(Request::Shutdown);
        info!("audio engine shutdown requested");
    }
}

// =============================================================================
// Worker Thread
// =============================================================================

fn worker_loop(rx: mpsc::Receiver<Request>, app: Option<AppHandle>, telemetry: Telemetry) {
    let _com = match ComToken::initialize() {
        Ok(token) => token,
        Err(e) => {
            error!("COM initialization failed: {}", e);
            return;
        }
    };

    let mut sessions: HashMap<String, SessionEntry> = HashMap::new();
    let mut icon_cache: HashMap<u32, Option<String>> = HashMap::new();
    let mut known_ids: Vec<String> = Vec::new();
    let mut refreshed_at = Instant::now() - Duration::from_secs(60);
    let mut meter_stop: Option<Arc<AtomicBool>> = None;
    let mut meter_handle: Option<thread::JoinHandle<()>> = None;

    for request in rx {
        match request {
            Request::Sessions { reply } => {
                if refreshed_at.elapsed() > Duration::from_millis(400) {
                    match refresh_sessions(&mut sessions, &mut icon_cache) {
                        Ok(()) => {
                            refreshed_at = Instant::now();
                            detect_session_set_change(&sessions, &mut known_ids, &app);
                        }
                        Err(e) => {
                            warn!("session refresh failed: {}", e);
                            let _ = reply.send(Err(e));
                            continue;
                        }
                    }
                }

                let mut infos: Vec<SessionInfo> = sessions.values().map(|e| e.info.clone()).collect();
                infos.sort_by(|a, b| {
                    a.flow
                        .cmp(&b.flow)
                        .then(a.exe.to_lowercase().cmp(&b.exe.to_lowercase()))
                        .then(a.pid.cmp(&b.pid))
                });

                telemetry
                    .session_count
                    .store(infos.len() as u64, Ordering::Relaxed);
                let _ = reply.send(Ok(infos));
            }

            Request::SetVolume { id, volume, reply } => {
                let result = with_session(
                    &mut sessions,
                    &mut icon_cache,
                    &mut refreshed_at,
                    &id,
                    |entry| {
                        let clamped = volume.clamp(0.0, 1.0);
                        unsafe { wasapi::set_session_volume(entry, clamped) }
                            .map_err(|e| SonoraError::VolumeControl {
                                pid: entry.info.pid,
                                err: e.to_string(),
                            })?;
                        entry.info.volume = clamped;
                        debug!("id {}: volume set to {:.2}", id, clamped);
                        Ok(())
                    },
                );
                let _ = reply.send(result);
            }

            Request::SetMute { id, muted, reply } => {
                let result = with_session(
                    &mut sessions,
                    &mut icon_cache,
                    &mut refreshed_at,
                    &id,
                    |entry| {
                        unsafe { wasapi::set_session_mute(entry, muted) }
                            .map_err(|e| SonoraError::MuteControl {
                                pid: entry.info.pid,
                                err: e.to_string(),
                            })?;
                        entry.info.muted = muted;
                        debug!("id {}: mute set to {}", id, muted);
                        Ok(())
                    },
                );
                let _ = reply.send(result);
            }

            Request::Devices { reply } => {
                let result = unsafe { wasapi::enumerate_devices() }
                    .map_err(|e| SonoraError::DeviceEnumeration(e.to_string()));
                let _ = reply.send(result);
            }

            Request::RouteDevice { pid, device_id, reply } => {
                let _ = pid;
                let result = wasapi::route_to_endpoint(&device_id)
                    .map_err(|e| SonoraError::Routing(e.to_string()));
                let _ = reply.send(result);
            }

            Request::StartMeter => {
                let already = meter_handle
                    .as_ref()
                    .map(|h| !h.is_finished())
                    .unwrap_or(false);

                if already || app.is_none() {
                    continue;
                }

                let stop = Arc::new(AtomicBool::new(false));
                meter_stop = Some(stop.clone());
                telemetry.meter_running.store(true, Ordering::Relaxed);

                let loop_app = app.clone().expect("checked above");
                let loop_telemetry = telemetry.clone();

                match thread::Builder::new()
                    .name("sonoramix-meter".to_string())
                    .spawn(move || meter_loop(loop_app, stop, loop_telemetry))
                {
                    Ok(handle) => {
                        meter_handle = Some(handle);
                        info!("meter stream started at 60 Hz");
                    }
                    Err(e) => {
                        error!("failed to spawn meter thread: {}", e);
                        telemetry.meter_running.store(false, Ordering::Relaxed);
                    }
                }
            }

            Request::StopMeter => {
                stop_meter_sync(&mut meter_stop, &mut meter_handle, &telemetry);
            }

            Request::Shutdown => break,
        }
    }

    stop_meter_sync(&mut meter_stop, &mut meter_handle, &telemetry);
    info!("worker thread exiting");
}

fn stop_meter_sync(
    meter_stop: &mut Option<Arc<AtomicBool>>,
    meter_handle: &mut Option<thread::JoinHandle<()>>,
    telemetry: &Telemetry,
) {
    if let Some(stop) = meter_stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = meter_handle.take() {
        let _ = handle.join();
    }
    telemetry.meter_running.store(false, Ordering::Relaxed);
}

fn refresh_sessions(
    sessions: &mut HashMap<String, SessionEntry>,
    icons: &mut HashMap<u32, Option<String>>,
) -> SonoraResult<()> {
    let entries = unsafe { wasapi::collect_sessions() }
        .map_err(|e| SonoraError::Enumeration(e.to_string()))?;

    let mut next = HashMap::with_capacity(entries.len());

    for mut entry in entries {
        let id = entry.info.id.clone();
        let pid = entry.info.pid;

        let icon = match icons.get(&pid) {
            Some(cached) => cached.clone(),
            None => {
                let fresh = if entry.exe_path.is_empty() {
                    None
                } else {
                    unsafe { wasapi::extract_icon_base64(&entry.exe_path) }
                };
                icons.insert(pid, fresh.clone());
                fresh
            }
        };

        entry.info.icon_base64 = icon;
        next.insert(id, entry);
    }

    *sessions = next;
    Ok(())
}

fn with_session<R>(
    sessions: &mut HashMap<String, SessionEntry>,
    icons: &mut HashMap<u32, Option<String>>,
    refreshed_at: &mut Instant,
    id: &str,
    op: impl FnOnce(&mut SessionEntry) -> EngineResult<R>,
) -> EngineResult<R> {
    let stale = !sessions.contains_key(id) || refreshed_at.elapsed() > Duration::from_secs(4);

    if stale {
        refresh_sessions(sessions, icons)?;
        *refreshed_at = Instant::now();
    }

    match sessions.get_mut(id) {
        Some(entry) => op(entry),
        None => Err(SonoraError::SessionNotFound(0)),
    }
}

fn detect_session_set_change(
    sessions: &HashMap<String, SessionEntry>,
    known_ids: &mut Vec<String>,
    app: &Option<AppHandle>,
) {
    let mut current: Vec<String> = sessions.keys().cloned().collect();
    current.sort_unstable();

    if &current != known_ids {
        *known_ids = current;
        if let Some(app) = app {
            let _ = app.emit("sessions-changed", ());
            debug!("session set changed, emitted event");
        }
    }
}

// =============================================================================
// Meter Thread
// =============================================================================

fn meter_loop(app: AppHandle, stop: Arc<AtomicBool>, telemetry: Telemetry) {
    let _com = match ComToken::initialize() {
        Ok(token) => token,
        Err(e) => {
            error!("meter thread COM init failed: {}", e);
            telemetry.meter_running.store(false, Ordering::Relaxed);
            return;
        }
    };

    let mut cache: Vec<SessionEntry> = Vec::new();
    let mut device_meters = wasapi::DeviceMeters {
        render: None,
        capture: None,
    };
    let mut refreshed_at = Instant::now() - Duration::from_secs(60);

    // Phase-locked 60 Hz cadence (16.666ms)
    const CADENCE: Duration = Duration::from_micros(16_666);
    let mut next_tick = Instant::now();

    while !stop.load(Ordering::Relaxed) {
        if refreshed_at.elapsed() > Duration::from_millis(600) {
            match unsafe { wasapi::collect_sessions() } {
                Ok(entries) => {
                    cache = entries;
                    telemetry
                        .session_count
                        .store(cache.len() as u64, Ordering::Relaxed);
                }
                Err(e) => {
                    warn!("meter cache refresh failed: {}", e);
                }
            }
            device_meters = unsafe { wasapi::acquire_default_device_meters() };
            refreshed_at = Instant::now();
        }

        let mut frames: Vec<MeterFrame> = Vec::with_capacity(cache.len() + 2);
        for entry in &cache {
            if let Some(sample) = unsafe { wasapi::read_meter(entry) } {
                frames.push(MeterFrame {
                    id: entry.info.id.clone(),
                    pid: entry.info.pid,
                    peak: sample.peak,
                    left: sample.left,
                    right: sample.right,
                });
            }
        }

        // Device-level bus meters (default endpoints) — the real hardware level.
        // Frontend distinguishes these by the "device:" id prefix. When the read
        // fails (device unplugged/disabled), emit a zeroed frame so the UI goes
        // silent instead of freezing on the last level.
        if let Some(render) = &device_meters.render {
            let sample = unsafe { wasapi::read_device_meter(render) };
            frames.push(MeterFrame {
                id: "device:render".to_string(),
                pid: 0,
                peak: sample.as_ref().map_or(0.0, |s| s.peak),
                left: sample.as_ref().map_or(0.0, |s| s.left),
                right: sample.as_ref().map_or(0.0, |s| s.right),
            });
        }
        if let Some(capture) = &device_meters.capture {
            let sample = unsafe { wasapi::read_device_meter(capture) };
            frames.push(MeterFrame {
                id: "device:capture".to_string(),
                pid: 0,
                peak: sample.as_ref().map_or(0.0, |s| s.peak),
                left: sample.as_ref().map_or(0.0, |s| s.left),
                right: sample.as_ref().map_or(0.0, |s| s.right),
            });
        }

        let emit_started = Instant::now();
        if app.emit("vumeter-update", &frames).is_ok() {
            telemetry.frames_emitted.fetch_add(1, Ordering::Relaxed);
            telemetry.last_emit_micros.store(
                emit_started.elapsed().as_micros() as u64,
                Ordering::Relaxed,
            );
        }

        next_tick += CADENCE;
        let now = Instant::now();
        if next_tick > now {
            thread::sleep(next_tick - now);
        } else {
            next_tick = now;
        }
    }

    telemetry.meter_running.store(false, Ordering::Relaxed);
    info!("meter thread exiting");
}
