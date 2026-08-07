//! Error types for SonoraMix.
//!
//! Provides structured error handling with `thiserror` for the entire
//! application, converting low-level Windows/COM errors into meaningful
//! error messages for the frontend.

use std::fmt;

/// Result type alias for SonoraMix operations.
pub type SonoraResult<T> = Result<T, SonoraError>;

/// Structured error types for all failure modes.
#[derive(Debug, thiserror::Error)]
pub enum SonoraError {
    /// COM initialization failed.
    #[allow(dead_code)]
    #[error("COM initialization failed: {0}")]
    ComInit(String),

    /// WASAPI enumeration failed.
    #[error("audio session enumeration failed: {0}")]
    Enumeration(String),

    /// Volume control operation failed.
    #[error("volume control failed for PID {pid}: {err}")]
    VolumeControl { pid: u32, err: String },

    /// Mute operation failed.
    #[error("mute control failed for PID {pid}: {err}")]
    MuteControl { pid: u32, err: String },

    /// Device enumeration failed.
    #[error("audio device enumeration failed: {0}")]
    DeviceEnumeration(String),

    /// Endpoint routing failed.
    #[error("endpoint routing failed: {0}")]
    Routing(String),

    /// Session not found.
    #[error("no active audio session found for PID {0}")]
    SessionNotFound(u32),

    /// Icon extraction failed (non-fatal, fallback available).
    #[allow(dead_code)]
    #[error("icon extraction failed: {0}")]
    IconExtraction(String),

    /// Internal channel communication error.
    #[error("internal communication error: {0}")]
    Internal(String),
}

impl SonoraError {
    /// Converts the error into a user-facing string for IPC transmission.
    pub fn to_user_message(&self) -> String {
        match self {
            Self::SessionNotFound(pid) => {
                format!(
                    "No active audio session found for process {}. \
                     The application may not be playing audio currently.",
                    pid
                )
            }
            Self::Routing(_) => {
                "Failed to switch audio output. \
                 The selected device may be unavailable or in use."
                    .to_string()
            }
            _ => self.to_string(),
        }
    }
}

/// Extension trait for converting Windows errors.
pub trait WindowsResultExt<T> {
    /// Converts a Windows result into a SonoraResult with context.
    fn into_sonora(self, context: impl fmt::Display) -> SonoraResult<T>;
}

impl<T> WindowsResultExt<T> for windows::core::Result<T> {
    fn into_sonora(self, context: impl fmt::Display) -> SonoraResult<T> {
        self.map_err(|e| SonoraError::Enumeration(format!("{}: {}", context, e)))
    }
}
