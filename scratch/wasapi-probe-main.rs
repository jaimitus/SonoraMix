// SonoraMix routing probe — exercises the EXACT AudioPolicyConfig machinery
// from src-tauri/src/audio/wasapi.rs against a real app session and reports
// every HRESULT so we can see where per-app routing fails on this machine.
#![allow(non_snake_case, unused)]

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::OnceLock;

use windows::core::{HSTRING, GUID, HRESULT, Interface, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE};
use windows::Win32::Media::Audio::{
    eCapture, eRender, AudioSessionStateExpired, AudioSessionStateActive, AudioSessionStateInactive,
    DEVICE_STATE_ACTIVE, IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};

fn ensure_com_init() {
    unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); }
}

struct ProcessHandle(HANDLE);
impl Drop for ProcessHandle {
    fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } }
}

fn process_image_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let _guard = ProcessHandle(handle);
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), PWSTR::from_raw(buffer.as_mut_ptr()), &mut len).ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

// ── AudioPolicyConfig (copied verbatim from wasapi.rs) ──────────────────────
const IID_AUDIO_POLICY_CONFIG_21H2: GUID = GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324);
const IID_AUDIO_POLICY_CONFIG_DOWNLEVEL: GUID = GUID::from_u128(0x2a59116d_6c4f_45e0_a74f_707e3fef9258);
const DEVINTERFACE_AUDIO_RENDER: &str = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";

type RoGetActivationFactoryFn = unsafe extern "system" fn(
    activatable_class_id: *const c_void,
    class_id: *const GUID,
    factory: *mut *mut c_void,
) -> HRESULT;

fn ro_get_activation_factory() -> Option<RoGetActivationFactoryFn> {
    static CACHED: OnceLock<Option<RoGetActivationFactoryFn>> = OnceLock::new();
    let cached = CACHED.get_or_init(|| unsafe {
        let module: HMODULE = LoadLibraryW(windows::core::w!("api-ms-win-core-winrt-l1-1-0.dll")).ok()?;
        let proc = GetProcAddress(module, windows::core::s!("RoGetActivationFactory"));
        Some(std::mem::transmute::<_, RoGetActivationFactoryFn>(proc?))
    });
    *cached
}

#[repr(C)]
struct AudioPolicyConfigVtbl {
    QueryInterface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
    AddRef: unsafe extern "system" fn(*mut c_void) -> u32,
    Release: unsafe extern "system" fn(*mut c_void) -> u32,
    __reserved: [unsafe extern "system" fn(*mut c_void) -> HRESULT; 22],
    SetPersistedDefaultAudioEndpoint: unsafe extern "system" fn(*mut c_void, u32, i32, i32, *const c_void) -> HRESULT,
    GetPersistedDefaultAudioEndpoint: unsafe extern "system" fn(*mut c_void, u32, i32, i32, *mut *mut c_void) -> HRESULT,
}

struct AudioPolicyConfig { raw: *mut c_void }

impl AudioPolicyConfig {
    fn activate() -> Result<Self, String> {
        ensure_com_init();
        unsafe {
            let class_name = HSTRING::from("Windows.Media.Internal.AudioPolicyConfig");
            let mut raw: *mut c_void = std::ptr::null_mut();
            let ro = ro_get_activation_factory().ok_or("RoGetActivationFactory not loadable")?;
            let mut hr = ro(core::mem::transmute_copy(&class_name), &IID_AUDIO_POLICY_CONFIG_21H2, &mut raw);
            let mut used_iid = "21H2 (ab3d4648)";
            if hr.is_err() || raw.is_null() {
                used_iid = "downlevel (2a59116d)";
                hr = ro(core::mem::transmute_copy(&class_name), &IID_AUDIO_POLICY_CONFIG_DOWNLEVEL, &mut raw);
            }
            println!("  [activate] RoGetActivationFactory({}) -> {:?} raw={}", used_iid, hr, !raw.is_null());
            if hr.is_err() || raw.is_null() {
                return Err(format!("activate failed: 0x{:08X}", hr.0));
            }
            Ok(Self { raw })
        }
    }

    unsafe fn set(&self, process_id: u32, device_id: Option<&HSTRING>, role: i32) -> HRESULT {
        unsafe {
            let vtbl = *(self.raw as *const *const AudioPolicyConfigVtbl);
            let device_ptr = match device_id {
                Some(h) => core::mem::transmute_copy(h),
                None => std::ptr::null(),
            };
            ((*vtbl).SetPersistedDefaultAudioEndpoint)(self.raw, process_id, 0, role, device_ptr)
        }
    }

    unsafe fn get(&self, process_id: u32, role: i32) -> (HRESULT, String) {
        unsafe {
            let vtbl = *(self.raw as *const *const AudioPolicyConfigVtbl);
            let mut raw: *mut c_void = std::ptr::null_mut();
            let hr = ((*vtbl).GetPersistedDefaultAudioEndpoint)(self.raw, process_id, 0, role, &mut raw);
            if hr.is_err() || raw.is_null() {
                return (hr, String::new());
            }
            let hstring: HSTRING = core::mem::transmute(raw);
            (hr, hstring.to_string_lossy())
        }
    }
}

impl Drop for AudioPolicyConfig {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe {
                let vtbl = *(self.raw as *const *const AudioPolicyConfigVtbl);
                ((*vtbl).Release)(self.raw);
            }
        }
    }
}

// ── session / device enumeration (trimmed) ─────────────────────────────────
struct FoundSession { pid: u32, exe: String }

fn find_render_session() -> Option<FoundSession> {
    unsafe {
        ensure_com_init();
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let self_pid = std::process::id();
        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).ok()?;
        let dev_count = collection.GetCount().unwrap_or(0);
        for d in 0..dev_count {
            let Ok(device) = collection.Item(d) else { continue };
            let Ok(manager): Result<IAudioSessionManager2, _> = device.Activate(CLSCTX_ALL, None) else { continue };
            let Ok(session_enum): Result<IAudioSessionEnumerator, _> = manager.GetSessionEnumerator() else { continue };
            let count = session_enum.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(control) = session_enum.GetSession(i) else { continue };
                let Ok(control2): Result<IAudioSessionControl2, _> = control.cast() else { continue };
                if control2.IsSystemSoundsSession() == windows::Win32::Foundation::S_OK { continue }
                let Ok(pid) = control2.GetProcessId() else { continue };
                if pid == 0 || pid == self_pid { continue }
                let Ok(state) = control.GetState() else { continue };
                if state == AudioSessionStateExpired { continue }
                let path = process_image_path(pid).unwrap_or_default();
                let exe = path.rsplit(['\\', '/']).next().unwrap_or("?").to_string();
                println!("  [session] pid={pid} exe={exe} state={:?}", state.0);
                return Some(FoundSession { pid, exe });
            }
        }
        None
    }
}

fn find_render_device_id() -> Option<String> {
    unsafe {
        ensure_com_init();
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).ok()?;
        let count = collection.GetCount().unwrap_or(0);
        for i in 0..count {
            let Ok(device) = collection.Item(i) else { continue };
            let Ok(id) = device.GetId() else { continue };
            let id_str = id.to_string().ok()?;
            println!("  [device] {id_str}");
            return Some(id_str);
        }
        None
    }
}

fn main() {
    ensure_com_init();
    println!("=== SonoraMix per-app routing probe ===");
    println!("OS: {}", std::env::consts::OS);

    let Some(sess) = find_render_session() else {
        println!("!! No active render session found (play some audio in an app).");
        return;
    };
    let Some(device_id) = find_render_device_id() else {
        println!("!! No render device found.");
        return;
    };

    println!("\nTarget: {} (pid {}) -> device {}", sess.exe, sess.pid, device_id);
    let full_id = format!("\\\\?\\SWD#MMDEVAPI#{}{}", device_id, DEVINTERFACE_AUDIO_RENDER);
    println!("Full endpoint id: {full_id}");

    let factory = match AudioPolicyConfig::activate() {
        Ok(f) => f,
        Err(e) => { println!("!! {e}"); return; }
    };

    unsafe {
        // 1) GET before
        let (hr, before) = factory.get(sess.pid, 1);
        println!("\n[1] GET before (role=1): hr=0x{:08X} value='{}'", hr.0, before);

        // 2) SET multimedia + console
        let device = HSTRING::from(&full_id);
        let hr_mm = factory.set(sess.pid, Some(&device), 1);
        let hr_con = factory.set(sess.pid, Some(&device), 0);
        println!("[2] SET eMultimedia: 0x{:08X}  SET eConsole: 0x{:08X}", hr_mm.0, hr_con.0);

        // 3) GET after (both roles)
        let (hr1, after1) = factory.get(sess.pid, 1);
        let (hr0, after0) = factory.get(sess.pid, 0);
        println!("[3] GET after role=1: 0x{:08X} value='{}'", hr1.0, after1);
        println!("    GET after role=0: 0x{:08X} value='{}'", hr0.0, after0);

        // 4) CLEAR (null HSTRING)
        let hr_c1 = factory.set(sess.pid, None, 1);
        let hr_c0 = factory.set(sess.pid, None, 0);
        println!("[4] CLEAR role=1: 0x{:08X}  role=0: 0x{:08X}", hr_c1.0, hr_c0.0);

        // 5) GET after clear
        let (hr2, after_clear) = factory.get(sess.pid, 1);
        println!("[5] GET after clear: 0x{:08X} value='{}'", hr2.0, after_clear);
    }

    println!("\n=== done ===");
    println!("If SET returns 0x80070005 (E_ACCESSDENIED) or 0x80004005 (E_FAIL),");
    println!("Windows itself is rejecting the internal API from this process.");
}
