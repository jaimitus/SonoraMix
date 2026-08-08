//! Windows Audio Session API (WASAPI) bindings with memory-safe RAII wrappers.
//!
//! # Safety
//!
//! This module contains `unsafe` code for COM interop. All public functions
//! call `ensure_com_init()` to guarantee COM apartment initialization on the thread.
//!
//! RAII guards (`ComToken`, `ProcessHandle`, `BitmapGuard`) ensure cleanup.

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tracing::{debug, info, trace, warn};
use windows::core::{Interface, GUID, HRESULT, PCWSTR, PWSTR, IUnknown};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDIBits, GetDC, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS, HBITMAP, HDC,
};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    AudioSessionStateExpired, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED, eCapture, eMultimedia, eRender,
    IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, PKEY_AudioEndpoint_FormFactor,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    STGM_READ,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

use serde::Serialize;

use crate::error::{SonoraError, SonoraResult, WindowsResultExt};

// =============================================================================
// Data Structures
// =============================================================================

/// Serializable audio session information.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub pid: u32,
    pub exe: String,
    pub icon_base64: Option<String>,
    pub volume: f32,
    pub muted: bool,
    pub channels: u32,
    pub flow: String, // "render" | "capture"
}

/// Serializable audio endpoint information.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub form_factor: String,
    pub is_default: bool,
    pub flow: String, // "render" | "capture"
    pub enabled: bool,
    pub state: String, // "active" | "disabled" | "unplugged"
}

/// Single meter reading for a session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterFrame {
    pub id: String,
    pub pid: u32,
    pub peak: f32,
    pub left: f32,
    pub right: f32,
}

/// Internal entry holding live COM interfaces for a grouped application session.
pub struct SessionEntry {
    pub info: SessionInfo,
    pub exe_path: String,
    pub volumes: Vec<ISimpleAudioVolume>,
    pub meters: Vec<IAudioMeterInformation>,
}

struct RawSession {
    pid: u32,
    exe: String,
    exe_path: String,
    volume: ISimpleAudioVolume,
    meter: IAudioMeterInformation,
    vol_val: f32,
    muted_val: bool,
    channels: u32,
    flow: String,
}

/// Meter sample with per-channel peaks.
pub struct MeterSample {
    pub peak: f32,
    pub left: f32,
    pub right: f32,
}

// =============================================================================
// COM Apartment Management
// =============================================================================

/// Explicit helper to ensure COM multithreaded apartment is initialized on the current thread.
pub fn ensure_com_init() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// RAII token for COM apartment initialization.
pub struct ComToken {
    _private: (),
}

impl ComToken {
    pub fn initialize() -> SonoraResult<Self> {
        ensure_com_init();
        trace!("COM MTA apartment initialized");
        Ok(Self { _private: () })
    }
}

impl Drop for ComToken {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
        trace!("COM apartment uninitialized");
    }
}

/// RAII guard for process handles.
struct ProcessHandle(windows::Win32::Foundation::HANDLE);

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// RAII guard for GDI bitmaps.
struct BitmapGuard(HBITMAP);

impl Drop for BitmapGuard {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = DeleteObject(self.0);
            }
        }
    }
}

// =============================================================================
// Session Enumeration
// =============================================================================

/// Enumerates all active audio sessions across render and capture endpoints,
/// grouping multi-process applications into deterministic session entries per flow.
///
/// # Safety
/// Caller must have an active COM apartment.
pub unsafe fn collect_sessions() -> SonoraResult<Vec<SessionEntry>> {
    ensure_com_init();
    trace!("enumerating audio sessions");

    let enumerator: IMMDeviceEnumerator = match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
        Ok(e) => e,
        Err(err) => {
            warn!("creating device enumerator failed: {}", err);
            return Ok(Vec::new());
        }
    };

    let self_pid = std::process::id();
    let mut grouped: HashMap<String, Vec<RawSession>> = HashMap::new();

    let flows = [(eRender, "render"), (eCapture, "capture")];

    for (flow, flow_name) in flows {
        let collection = match unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) } {
            Ok(c) => c,
            Err(err) => {
                warn!("enumerating endpoints for {} sessions failed: {}", flow_name, err);
                continue;
            }
        };

        let dev_count = unsafe { collection.GetCount() }.unwrap_or(0);

        for d in 0..dev_count {
            let Ok(device) = (unsafe { collection.Item(d) }) else { continue; };
            let Ok(manager): Result<IAudioSessionManager2, _> = (unsafe { device.Activate(CLSCTX_ALL, None) }) else { continue; };
            let Ok(session_enum): Result<IAudioSessionEnumerator, _> = (unsafe { manager.GetSessionEnumerator() }) else { continue; };
            let count = unsafe { session_enum.GetCount() }.unwrap_or(0);

            for i in 0..count {
                let Ok(control) = (unsafe { session_enum.GetSession(i) }) else { continue; };
                if let Some(mut raw) = unsafe { build_raw_session(&control, self_pid) } {
                    raw.flow = flow_name.to_string();
                    let key = format!("{}:{}", flow_name, raw.exe.to_lowercase());
                    grouped.entry(key).or_default().push(raw);
                }
            }
        }
    }

    let mut entries = Vec::with_capacity(grouped.len());

    for (key, mut raws) in grouped {
        if raws.is_empty() { continue; }
        let main_pid = raws[0].pid;
        let exe = raws[0].exe.clone();
        let exe_path = raws[0].exe_path.clone();
        let flow = raws[0].flow.clone();
        let main_vol = raws[0].vol_val;
        let main_muted = raws[0].muted_val;
        let max_channels = raws.iter().map(|r| r.channels).max().unwrap_or(1);

        let mut volumes = Vec::with_capacity(raws.len());
        let mut meters = Vec::with_capacity(raws.len());

        for r in raws.drain(..) {
            volumes.push(r.volume);
            meters.push(r.meter);
        }

        entries.push(SessionEntry {
            info: SessionInfo {
                id: key,
                pid: main_pid,
                exe,
                icon_base64: None,
                volume: main_vol,
                muted: main_muted,
                channels: max_channels,
                flow,
            },
            exe_path,
            volumes,
            meters,
        });
    }

    debug!("found {} grouped audio session apps", entries.len());
    Ok(entries)
}

unsafe fn build_raw_session(control: &IAudioSessionControl, self_pid: u32) -> Option<RawSession> {
    unsafe {
        let control2: IAudioSessionControl2 = control.cast().ok()?;

        if control2.IsSystemSoundsSession() == windows::Win32::Foundation::S_OK {
            return None;
        }

        let pid = control2.GetProcessId().ok()?;
        if pid == 0 || pid == self_pid {
            return None;
        }

        let state = control.GetState().ok()?;
        if state == AudioSessionStateExpired {
            return None;
        }

        let volume: ISimpleAudioVolume = control.cast().ok()?;
        let meter: IAudioMeterInformation = control.cast().ok()?;

        let exe_path = process_image_path(pid).unwrap_or_default();
        let exe = exe_path
            .rsplit(['\\', '/'])
            .next()
            .map(str::to_string)
            .unwrap_or_else(|| format!("pid-{pid}.exe"));

        let vol_val = volume.GetMasterVolume().ok().unwrap_or(1.0);
        let muted_val = volume.GetMute().map(|b| b.as_bool()).ok().unwrap_or(false);
        let channels = meter.GetMeteringChannelCount().ok().unwrap_or(1);

        Some(RawSession {
            pid,
            exe,
            exe_path,
            volume,
            meter,
            vol_val,
            muted_val,
            channels,
            flow: "render".to_string(),
        })
    }
}

/// Retrieves the full executable path for a process ID.
pub fn process_image_path(pid: u32) -> SonoraResult<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| SonoraError::Enumeration(format!("opening process {}: {}", pid, e)))?;

        let _guard = ProcessHandle(handle);

        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;

        QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), PWSTR::from_raw(buffer.as_mut_ptr()), &mut len)
            .map_err(|e| SonoraError::Enumeration(format!("querying process name: {}", e)))?;

        Ok(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

// =============================================================================
// Volume and Metering Controls
// =============================================================================

pub unsafe fn set_session_volume(
    entry: &SessionEntry,
    scalar: f32,
) -> SonoraResult<()> {
    let clamped = scalar.clamp(0.0, 1.0);
    for volume in &entry.volumes {
        unsafe {
            let _ = volume.SetMasterVolume(clamped, std::ptr::null());
        }
    }
    trace!("volume set to {:.2} for {}", clamped, entry.info.exe);
    Ok(())
}

pub unsafe fn set_session_mute(
    entry: &SessionEntry,
    muted: bool,
) -> SonoraResult<()> {
    for volume in &entry.volumes {
        unsafe {
            let _ = volume.SetMute(BOOL::from(muted), std::ptr::null());
        }
    }
    trace!("mute set to {} for {}", muted, entry.info.exe);
    Ok(())
}

pub unsafe fn read_meter(entry: &SessionEntry) -> Option<MeterSample> {
    // Check ACTUAL mute state from COM interface (not the stale cached value,
    // since the meter thread has its own session cache that doesn't get mute updates).
    if let Some(vol_iface) = entry.volumes.first() {
        if unsafe { vol_iface.GetMute().map(|b| b.as_bool()).unwrap_or(false) } {
            return Some(MeterSample {
                peak: 0.0,
                left: 0.0,
                right: 0.0,
            });
        }
    }

    let mut max_peak = 0.0f32;
    let mut max_left = 0.0f32;
    let mut max_right = 0.0f32;
    let mut found = false;

    for meter in &entry.meters {
        unsafe {
            if let Ok(peak) = meter.GetPeakValue() {
                found = true;
                if peak > max_peak {
                    max_peak = peak;
                }
                let channels = meter.GetMeteringChannelCount().ok().unwrap_or(1).min(8) as usize;
                let mut levels = [0f32; 8];
                if channels >= 1 && meter.GetChannelsPeakValues(&mut levels[..channels]).is_ok() {
                    let l = levels[0];
                    let r = if channels >= 2 { levels[1] } else { levels[0] };
                    if l > max_left { max_left = l; }
                    if r > max_right { max_right = r; }
                } else {
                    if peak > max_left { max_left = peak; }
                    if peak > max_right { max_right = peak; }
                }
            }
        }
    }

    // Return raw WASAPI peak values WITHOUT multiplying by volume.
    // IAudioMeterInformation::GetPeakValue() already returns post-volume levels
    // (i.e., already attenuated by the session's ISimpleAudioVolume setting).
    // Multiplying by volume again would square the attenuation.
    if found {
        Some(MeterSample {
            peak: max_peak,
            left: max_left,
            right: max_right,
        })
    } else {
        None
    }
}

// =============================================================================
// Device Enumeration
// =============================================================================

pub unsafe fn enumerate_devices() -> SonoraResult<Vec<DeviceInfo>> {
    ensure_com_init();
    trace!("enumerating audio endpoints");

    let enumerator: IMMDeviceEnumerator = match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
        Ok(e) => e,
        Err(err) => {
            warn!("creating device enumerator failed: {}", err);
            return Ok(Vec::new());
        }
    };

    let default_render_id = enumerator
        .GetDefaultAudioEndpoint(eRender, eMultimedia)
        .and_then(|d| unsafe { d.GetId() })
        .map(|h| unsafe { h.to_string() }.unwrap_or_default())
        .unwrap_or_default();

    let default_capture_id = enumerator
        .GetDefaultAudioEndpoint(eCapture, eMultimedia)
        .and_then(|d| unsafe { d.GetId() })
        .map(|h| unsafe { h.to_string() }.unwrap_or_default())
        .unwrap_or_default();

    let flows = [(eRender, "render", default_render_id), (eCapture, "capture", default_capture_id)];
    let mut devices = Vec::new();

    for (flow_dir, flow_name, default_id) in flows {
        // Enumerate both ACTIVE and DISABLED devices so we can show disabled ones in UI
        let state_mask = windows::Win32::Media::Audio::DEVICE_STATE(DEVICE_STATE_ACTIVE.0 | DEVICE_STATE_DISABLED.0);
        let collection = match unsafe { enumerator.EnumAudioEndpoints(flow_dir, state_mask) } {
            Ok(c) => c,
            Err(err) => {
                warn!("enumerating {} endpoints failed: {}", flow_name, err);
                continue;
            }
        };

        let count = unsafe { collection.GetCount() }.unwrap_or(0);

        for i in 0..count {
            let Ok(device) = (unsafe { collection.Item(i) }) else { continue; };
            let Ok(id) = (unsafe { device.GetId() }) else { continue; };

            let id_str = unsafe { id.to_string() }.unwrap_or_default();

            // Get device state (Active, Disabled, NotPresent, Unplugged)
            let dev_state = unsafe { device.GetState() }.unwrap_or(DEVICE_STATE_DISABLED);
            let enabled = dev_state == DEVICE_STATE_ACTIVE;
            let state_str = if dev_state == DEVICE_STATE_ACTIVE {
                "active"
            } else if dev_state == DEVICE_STATE_DISABLED {
                "disabled"
            } else {
                "unplugged"
            };

            let (name, form_factor) = match read_device_properties(&device) {
                Ok(props) => props,
                Err(_) => (
                    id_str.rsplit('\\').next().unwrap_or("Audio endpoint").to_string(),
                    if flow_name == "capture" { "Microphone".to_string() } else { "Audio Endpoint".to_string() },
                ),
            };

            devices.push(DeviceInfo {
                is_default: id_str == default_id,
                id: id_str,
                name,
                form_factor,
                flow: flow_name.to_string(),
                enabled,
                state: state_str.to_string(),
            });
        }
    }

    debug!("found {} audio endpoints", devices.len());
    Ok(devices)
}

unsafe fn read_device_properties(device: &IMMDevice) -> SonoraResult<(String, String)> {
    unsafe {
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ)
            .into_sonora("opening property store")?;

        let name_var = store.GetValue(&PKEY_Device_FriendlyName)
            .into_sonora("reading friendly name")?;
        let name_str = name_var.to_string();
        let name = if name_str.is_empty() { "Audio endpoint".to_string() } else { name_str };

        let ff_var = store.GetValue(&PKEY_AudioEndpoint_FormFactor)
            .into_sonora("reading form factor")?;
        let form_factor = form_factor_label(u32::try_from(&ff_var).ok());

        Ok((name, form_factor))
    }
}

fn form_factor_label(raw: Option<u32>) -> String {
    match raw {
        Some(1) => "Speakers",
        Some(2) => "Line Level",
        Some(3) => "Headphones",
        Some(4) => "Microphone",
        Some(5) => "Headset",
        Some(6) => "Handset",
        Some(8) => "S/PDIF",
        Some(9) => "HDMI / DisplayPort",
        Some(10) => "Network",
        Some(11) => "Phone",
        _ => "Audio Endpoint",
    }
    .to_string()
}

// =============================================================================
// Endpoint Routing (IPolicyConfig)
// =============================================================================

const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const IID_IPOLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

#[repr(u32)]
#[derive(Copy, Clone)]
enum EndpointRole {
    Console = 0,
    Multimedia = 1,
    Communications = 2,
}

#[repr(C)]
#[allow(non_snake_case)]
struct IPolicyConfigVtbl {
    QueryInterface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
    AddRef: unsafe extern "system" fn(*mut c_void) -> u32,
    Release: unsafe extern "system" fn(*mut c_void) -> u32,
    GetMixFormat: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut *mut c_void) -> HRESULT,
    GetDeviceFormat: unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut *mut c_void) -> HRESULT,
    ResetDeviceFormat: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
    SetDeviceFormat: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void, *mut c_void) -> HRESULT,
    GetProcessingPeriod: unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut i64, *mut i64) -> HRESULT,
    SetProcessingPeriod: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut i64) -> HRESULT,
    GetShareMode: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut u32) -> HRESULT,
    SetShareMode: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut u32) -> HRESULT,
    GetPropertyValue: unsafe extern "system" fn(*mut c_void, PCWSTR, *const c_void, *mut c_void) -> HRESULT,
    SetPropertyValue: unsafe extern "system" fn(*mut c_void, PCWSTR, *const c_void, *mut c_void) -> HRESULT,
    SetDefaultEndpoint: unsafe extern "system" fn(*mut c_void, PCWSTR, u32) -> HRESULT,
    SetEndpointVisibility: unsafe extern "system" fn(*mut c_void, PCWSTR, i32) -> HRESULT,
}

struct PolicyConfig {
    raw: *mut c_void,
}

unsafe impl Send for PolicyConfig {}

impl PolicyConfig {
    fn activate() -> SonoraResult<Self> {
        ensure_com_init();
        unsafe {
            let unknown: IUnknown = CoCreateInstance(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
                .map_err(|e| SonoraError::Routing(format!("activating PolicyConfig: {}", e)))?;

            let mut raw: *mut c_void = std::ptr::null_mut();
            let hr = unknown.query(&IID_IPOLICY_CONFIG, &mut raw);
            if hr.is_err() {
                return Err(SonoraError::Routing(format!("querying IPolicyConfig failed: {:?}", hr)));
            }

            Ok(Self { raw })
        }
    }

    unsafe fn set_default_endpoint(&self, device_id: &str, role: EndpointRole) -> SonoraResult<()> {
        let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let vtbl = *(self.raw as *const *const IPolicyConfigVtbl);
            let hr = ((*vtbl).SetDefaultEndpoint)(self.raw, PCWSTR::from_raw(wide.as_ptr()), role as u32);
            if hr.is_err() {
                return Err(SonoraError::Routing(format!(
                    "SetDefaultEndpoint failed: {:?}",
                    hr
                )));
            }
        }
        Ok(())
    }

    /// Enable or disable an audio endpoint via IPolicyConfig::SetEndpointVisibility.
    /// `visible = 1` enables the device, `visible = 0` disables it.
    unsafe fn set_endpoint_visibility(&self, device_id: &str, visible: bool) -> SonoraResult<()> {
        let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let vtbl = *(self.raw as *const *const IPolicyConfigVtbl);
            let hr = ((*vtbl).SetEndpointVisibility)(self.raw, PCWSTR::from_raw(wide.as_ptr()), if visible { 1 } else { 0 });
            if hr.is_err() {
                return Err(SonoraError::Routing(format!(
                    "SetEndpointVisibility failed: {:?}",
                    hr
                )));
            }
        }
        Ok(())
    }
}

impl Drop for PolicyConfig {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe {
                let vtbl = *(self.raw as *const *const IPolicyConfigVtbl);
                ((*vtbl).Release)(self.raw);
            }
        }
    }
}

pub fn route_to_endpoint(device_id: &str) -> SonoraResult<()> {
    ensure_com_init();
    let policy = PolicyConfig::activate()?;

    unsafe {
        policy.set_default_endpoint(device_id, EndpointRole::Multimedia)?;
        policy.set_default_endpoint(device_id, EndpointRole::Console)?;
        policy.set_default_endpoint(device_id, EndpointRole::Communications)?;
    }

    info!("default audio endpoint routed to {}", device_id);
    Ok(())
}

/// Enable or disable an audio endpoint in Windows.
pub fn toggle_device_enabled(device_id: &str, enabled: bool) -> SonoraResult<()> {
    ensure_com_init();
    let policy = PolicyConfig::activate()?;

    unsafe {
        policy.set_endpoint_visibility(device_id, enabled)?;
    }

    info!("device {} {}", device_id, if enabled { "enabled" } else { "disabled" });
    Ok(())
}

// =============================================================================
// Icon Extraction
// =============================================================================

pub unsafe fn extract_icon_base64(exe_path: &str) -> Option<String> {
    ensure_com_init();
    unsafe {
        let wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut icon = HICON::default();

        let extracted = ExtractIconExW(PCWSTR::from_raw(wide.as_ptr()), 0, Some(&mut icon), None, 1);
        if extracted == 0 || icon.is_invalid() {
            return None;
        }

        let result = icon_to_base64_bmp(icon);
        let _ = DestroyIcon(icon);

        result
    }
}

unsafe fn icon_to_base64_bmp(icon: HICON) -> Option<String> {
    unsafe {
        let mut info = ICONINFO::default();
        if GetIconInfo(icon, &mut info).is_err() {
            return None;
        }

        let _mask_guard = BitmapGuard(info.hbmMask);
        let _color_guard = BitmapGuard(info.hbmColor);

        if info.hbmColor.is_invalid() {
            return None;
        }

        let mut bmp = BITMAP::default();
        GetObjectW(
            info.hbmColor,
            size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut BITMAP as *mut c_void),
        );

        let width = bmp.bmWidth.clamp(1, 256);
        let height = bmp.bmHeight.clamp(1, 256);

        let screen_dc: HDC = GetDC(HWND::default());
        if screen_dc.is_invalid() {
            return None;
        }

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = 0;

        let lines = GetDIBits(
            screen_dc,
            info.hbmColor,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        let _ = ReleaseDC(HWND::default(), screen_dc);

        if lines == 0 {
            return None;
        }

        let file = encode_bmp(width as u32, height as u32, &pixels);
        Some(format!("data:image/bmp;base64,{}", BASE64.encode(&file)))
    }
}

fn encode_bmp(width: u32, height: u32, bgra_bottom_up: &[u8]) -> Vec<u8> {
    let row_bytes = width * 4;
    let pixel_bytes = row_bytes * height;
    let file_size = 14 + 40 + pixel_bytes;

    let mut out = Vec::with_capacity(file_size as usize);

    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&54u32.to_le_bytes());

    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&pixel_bytes.to_le_bytes());
    out.extend_from_slice(&2835u32.to_le_bytes());
    out.extend_from_slice(&2835u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(bgra_bottom_up);

    out
}
