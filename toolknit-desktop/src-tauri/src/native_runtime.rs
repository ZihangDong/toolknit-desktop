use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{
    ai_provider, onnx_segmenter, platform, rsa_legacy_windows, system_cleanup, teleprompter_whisper,
};

// Each native domain is a real Rust module. The parent keeps a compatibility
// re-export boundary so the command registry and older tests retain their
// existing names while the implementation gains explicit ownership.
#[path = "native_runtime/core.rs"]
pub(super) mod core_runtime;
use core_runtime::*;
#[path = "native_runtime/dependencies.rs"]
pub(super) mod dependencies_runtime;
use dependencies_runtime::*;
#[path = "native_runtime/limits.rs"]
pub(super) mod limits_runtime;
use limits_runtime::*;
#[path = "native_runtime/transcription.rs"]
pub(super) mod transcription_runtime;
use transcription_runtime::*;
#[path = "native_runtime/pdf.rs"]
pub(super) mod pdf_runtime;
use pdf_runtime::*;
#[path = "native_runtime/image.rs"]
pub(super) mod image_commands;
pub(crate) use image_commands::basic::decode_oriented_image;
use image_commands::*;
#[path = "native_runtime/media.rs"]
pub(super) mod media_runtime;
use media_runtime::*;
#[path = "native_runtime/system.rs"]
pub(super) mod system_runtime;
use system_runtime::*;
mod office;
use office::LibreOfficeRuntimeInfo;
mod quick_screenshot;
mod file_search;
pub(crate) use quick_screenshot::open_clipboard_image;
mod local_translation;
mod runner;
pub use runner::run;
use runner::{minimize_main_window, show_main_window};
#[cfg(test)]
mod tests;
