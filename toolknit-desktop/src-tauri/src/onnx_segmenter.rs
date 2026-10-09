// AI background removal via ONNX Runtime (DirectML with CPU fallback).
// Mirrors the whisper runtime pattern: dynamically loaded DLL next to the
// executable, models downloaded on demand with hash verification, and a
// process-wide session cache keyed by the current model.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

use image::GenericImageView;
use ndarray::Array4;
use ort::{
    execution_providers::{CPUExecutionProvider, DirectMLExecutionProvider},
    session::{builder::GraphOptimizationLevel, Session},
};
use std::time::Instant;
use tauri::Emitter;

const MATTING_MODEL_DIRECTORY: &str = "models";
const MATTING_MODEL_CONFIG: &str = "matting-model.json";
const MAX_PREVIEW_EDGE: u32 = 4096;
const MAX_SOURCE_PIXELS: u64 = 120_000_000;
const MAX_EXPORT_PIXELS: u64 = 80_000_000;
const MAX_MASK_BYTES: usize = 64 * 1024 * 1024;

pub struct MattingModelSpec {
    pub id: &'static str,
    pub file_name: &'static str,
    pub display_name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    pub input_size: u32,
    pub note: &'static str,
}

pub const MATTING_MODELS: [MattingModelSpec; 1] = [MattingModelSpec {
    id: "modnet",
    file_name: "modnet.onnx",
    display_name: "MODNet 人像精修",
    bytes: 25_888_640,
    sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
    input_size: 512,
    note: "轻量人像专用，适合证件照",
}];

#[derive(serde::Serialize, Clone)]
pub struct MattingModelStatus {
    pub id: String,
    pub display_name: String,
    pub note: String,
    pub bytes: u64,
    pub installed: bool,
    pub current: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct MattingModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub phase: String,
}

#[derive(serde::Serialize)]
pub struct MattingModelDownloadResult {
    pub model_id: String,
    pub path: String,
    pub current: bool,
}

#[derive(serde::Serialize)]
pub struct MattingSegmentResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub model_id: String,
    pub execution_provider: String,
    pub source_width: u32,
    pub source_height: u32,
}

#[derive(serde::Serialize)]
pub struct MattingExportResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct MattingState;

static MATTING_DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);
static MATTING_DOWNLOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn cancelled_segmentations() -> &'static Mutex<HashSet<u64>> {
    static CANCELLED: OnceLock<Mutex<HashSet<u64>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

struct MattingDownloadGuard;

impl MattingDownloadGuard {
    fn begin() -> Option<Self> {
        let acquired = MATTING_DOWNLOAD_IN_PROGRESS
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok();
        if !acquired {
            return None;
        }
        MATTING_DOWNLOAD_CANCEL.store(false, Ordering::SeqCst);
        Some(MattingDownloadGuard)
    }
}

impl Drop for MattingDownloadGuard {
    fn drop(&mut self) {
        MATTING_DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

struct MattingModel {
    spec: &'static MattingModelSpec,
    execution_provider: &'static str,
    session: Session,
}

pub struct MattingRuntime {
    current: Option<MattingModel>,
}

unsafe impl Send for MattingRuntime {}

fn matting_app_data_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or("Cannot find AppData folder")?
        .join("ToolKnit"))
}

fn matting_models_dir() -> Result<PathBuf, String> {
    Ok(matting_app_data_dir()?.join(MATTING_MODEL_DIRECTORY))
}

fn matting_model_config_path() -> Result<PathBuf, String> {
    Ok(matting_app_data_dir()?.join(MATTING_MODEL_CONFIG))
}

fn read_matting_model_config() -> Option<String> {
    std::fs::read_to_string(matting_model_config_path().ok()?)
        .ok()
        .and_then(|content| serde_json::from_str::<MattingModelConfig>(&content).ok())
        .and_then(|config| config.current_model)
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct MattingModelConfig {
    current_model: Option<String>,
}

fn write_matting_model_config(config: &MattingModelConfig) -> Result<(), String> {
    let path = matting_model_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create model directory: {error}"))?;
    }
    let encoded =
        serde_json::to_vec(config).map_err(|error| format!("Cannot save model config: {error}"))?;
    std::fs::write(&path, encoded).map_err(|error| format!("Cannot save model config: {error}"))
}

fn matting_model_spec(model_id: &str) -> Result<&'static MattingModelSpec, String> {
    MATTING_MODELS
        .iter()
        .find(|model| model.id == model_id.trim().to_ascii_lowercase())
        .ok_or("matting:model-unknown".to_string())
}

fn first_installed_matting_model() -> Option<&'static MattingModelSpec> {
    MATTING_MODELS
        .iter()
        .find(|spec| installed_matting_model_file(spec).ok().flatten().is_some())
}

fn installed_matting_model_file(spec: &MattingModelSpec) -> Result<Option<PathBuf>, String> {
    let path = matting_models_dir()?.join(spec.file_name);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("matting:model-stat-failed:{error}")),
    };
    if metadata.is_file() && metadata.len() == spec.bytes {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

fn get_onnxruntime_dll_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe.parent().ok_or("Cannot find executable directory")?;
    let bundled = exe_dir
        .join("resources")
        .join("onnxruntime")
        .join("onnxruntime.dll");
    if bundled.is_file() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("onnxruntime")
        .join("onnxruntime.dll");
    if development.is_file() {
        return Ok(development);
    }
    Err("matting:onnxruntime-dll-missing".to_string())
}

/// onnxruntime resolves its DirectML dependency by module name, so preload it
/// from the model directory with search flags that include the DLL's own
/// folder (same approach as the whisper ggml backends).
fn preload_directml(dll_dir: &Path) {
    #[cfg(target_os = "windows")]
    {
        let direct_ml = dll_dir.join("DirectML.dll");
        if direct_ml.is_file() {
            unsafe {
                use libloading::os::windows::{
                    Library, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
                };
                let _ = Library::load_with_flags(
                    &direct_ml,
                    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
                );
            }
        }
    }
}

fn matting_runtime() -> &'static Mutex<MattingRuntime> {
    static RUNTIME: OnceLock<Mutex<MattingRuntime>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(MattingRuntime { current: None }))
}

fn ort_dylib_ready() -> Result<(), String> {
    static PREPARED: OnceLock<Result<(), String>> = OnceLock::new();
    PREPARED
        .get_or_init(|| {
            let dll = get_onnxruntime_dll_path()?;
            if let Some(parent) = dll.parent() {
                preload_directml(parent);
            }
            std::env::set_var("ORT_DYLIB_PATH", &dll);
            Ok(())
        })
        .clone()
}

fn build_session(model_path: &Path) -> Result<(Session, &'static str), String> {
    let direct_ml = Session::builder()
        .and_then(|builder| {
            builder
                .with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_execution_providers([DirectMLExecutionProvider::default().build()])?
                .commit_from_file(model_path)
        })
        .map_err(|error| format!("matting:directml-init-failed:{error}"));
    match direct_ml {
        Ok(session) => Ok((session, "dml")),
        Err(direct_ml_error) => {
            let cpu = Session::builder()
                .and_then(|builder| {
                    builder
                        .with_optimization_level(GraphOptimizationLevel::Level3)?
                        .with_execution_providers([CPUExecutionProvider::default().build()])?
                        .commit_from_file(model_path)
                })
                .map_err(|error| format!("matting:cpu-init-failed:{error}"));
            match cpu {
                Ok(session) => Ok((session, "cpu")),
                Err(_) => Err(direct_ml_error),
            }
        }
    }
}

fn acquire_session<'a>(
    runtime: &'a mut MattingRuntime,
    spec: &'static MattingModelSpec,
    model_path: &Path,
) -> Result<(&'a mut Session, &'static str), String> {
    let reusable = runtime
        .current
        .as_ref()
        .is_some_and(|model| model.spec.id == spec.id);
    if !reusable {
        let (session, execution_provider) = build_session(model_path)?;
        runtime.current = Some(MattingModel {
            spec,
            execution_provider,
            session,
        });
    }
    let model = runtime
        .current
        .as_mut()
        .ok_or("matting:session-unavailable".to_string())?;
    Ok((&mut model.session, model.execution_provider))
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Letterbox {
    input_size: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn letterbox_for(width: u32, height: u32, input_size: u32) -> Letterbox {
    let scale = input_size as f64 / width.max(height).max(1) as f64;
    let resized_width = ((width as f64 * scale).round() as u32).clamp(1, input_size);
    let resized_height = ((height as f64 * scale).round() as u32).clamp(1, input_size);
    Letterbox {
        input_size,
        x: (input_size - resized_width) / 2,
        y: (input_size - resized_height) / 2,
        width: resized_width,
        height: resized_height,
    }
}

fn preprocess(image: &image::DynamicImage, spec: &MattingModelSpec) -> (Array4<f32>, Letterbox) {
    let letterbox = letterbox_for(image.width(), image.height(), spec.input_size);
    let resized = image
        .resize_exact(
            letterbox.width,
            letterbox.height,
            image::imageops::FilterType::Triangle,
        )
        .to_rgb8();
    let mut rgb = image::RgbImage::new(spec.input_size, spec.input_size);
    image::imageops::replace(&mut rgb, &resized, letterbox.x.into(), letterbox.y.into());
    let mut input =
        Array4::<f32>::zeros((1, 3, spec.input_size as usize, spec.input_size as usize));
    for (x, y, pixel) in rgb.enumerate_pixels() {
        for channel in 0..3 {
            input[[0, channel, y as usize, x as usize]] =
                (pixel.0[channel] as f32 / 255.0 - 0.5) / 0.5;
        }
    }
    (input, letterbox)
}

fn activate_mask_value(value: f32) -> f32 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 1.0)
}

fn decode_mask(data: &[f32], dims: &[i64]) -> Result<image::GrayImage, String> {
    let (mask_width, mask_height) = match dims.len() {
        4 => (dims[3].max(1) as u32, dims[2].max(1) as u32),
        3 => (dims[2].max(1) as u32, dims[1].max(1) as u32),
        2 => (dims[1].max(1) as u32, dims[0].max(1) as u32),
        _ => return Err("matting:mask-shape-unsupported".to_string()),
    };
    let expected = mask_width as usize * mask_height as usize;
    if data.len() < expected {
        return Err("matting:mask-data-incomplete".to_string());
    }
    let mut mask = image::GrayImage::new(mask_width, mask_height);
    for (index, pixel) in mask.pixels_mut().enumerate() {
        pixel.0[0] = (activate_mask_value(data[index]) * 255.0).round() as u8;
    }
    Ok(mask)
}

fn restore_letterboxed_mask(
    mask: &image::GrayImage,
    letterbox: Letterbox,
    output_size: (u32, u32),
) -> image::GrayImage {
    let scale_x = mask.width() as f64 / letterbox.input_size.max(1) as f64;
    let scale_y = mask.height() as f64 / letterbox.input_size.max(1) as f64;
    let x = ((letterbox.x as f64 * scale_x).round() as u32).min(mask.width().saturating_sub(1));
    let y = ((letterbox.y as f64 * scale_y).round() as u32).min(mask.height().saturating_sub(1));
    let width = ((letterbox.width as f64 * scale_x).round() as u32)
        .max(1)
        .min(mask.width() - x);
    let height = ((letterbox.height as f64 * scale_y).round() as u32)
        .max(1)
        .min(mask.height() - y);
    let cropped = image::imageops::crop_imm(mask, x, y, width, height).to_image();
    image::DynamicImage::ImageLuma8(cropped)
        .resize_exact(
            output_size.0,
            output_size.1,
            image::imageops::FilterType::Triangle,
        )
        .to_luma8()
}

#[derive(Clone, Copy, Debug)]
struct MaskSignal {
    mean_alpha: f32,
    visible_fraction: f32,
}

#[derive(Clone, Copy, Debug)]
struct FlatBackgroundProfile {
    rgb: [f32; 3],
    noise: f32,
}

fn mask_signal(mask: &image::GrayImage) -> MaskSignal {
    let pixel_count = u64::from(mask.width()).saturating_mul(u64::from(mask.height()));
    if pixel_count == 0 {
        return MaskSignal {
            mean_alpha: 0.0,
            visible_fraction: 0.0,
        };
    }
    let mut alpha_sum = 0_u64;
    let mut visible = 0_u64;
    for pixel in mask.pixels() {
        let alpha = u64::from(pixel.0[0]);
        alpha_sum += alpha;
        if alpha >= 32 {
            visible += 1;
        }
    }
    MaskSignal {
        mean_alpha: alpha_sum as f32 / (pixel_count as f32 * 255.0),
        visible_fraction: visible as f32 / pixel_count as f32,
    }
}

fn flat_background_profile(source: &image::RgbaImage) -> Option<FlatBackgroundProfile> {
    let (width, height) = source.dimensions();
    if width < 3 || height < 3 {
        return None;
    }
    let band = (width.min(height) / 64).clamp(1, 16);
    let inner_width = width.saturating_sub(band.saturating_mul(2));
    let inner_height = height.saturating_sub(band.saturating_mul(2));
    let border_pixels = u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_sub(u64::from(inner_width).saturating_mul(u64::from(inner_height)));
    let mut samples = 0_u64;
    let mut sums = [0_f64; 3];
    let mut square_sums = [0_f64; 3];
    for (x, y, pixel) in source.enumerate_pixels() {
        if x >= band && x < width - band && y >= band && y < height - band {
            continue;
        }
        if pixel.0[3] < 245 {
            continue;
        }
        samples += 1;
        for channel in 0..3 {
            let value = f64::from(pixel.0[channel]);
            sums[channel] += value;
            square_sums[channel] += value * value;
        }
    }
    if samples < border_pixels.max(8) / 2 {
        return None;
    }
    let divisor = samples as f64;
    let mut rgb = [0_f32; 3];
    let mut variance_sum = 0_f64;
    for channel in 0..3 {
        let mean = sums[channel] / divisor;
        rgb[channel] = mean as f32;
        variance_sum += (square_sums[channel] / divisor - mean * mean).max(0.0);
    }
    let noise = (variance_sum / 3.0).sqrt() as f32;
    (noise <= 14.0).then_some(FlatBackgroundProfile { rgb, noise })
}

fn flat_background_mask(
    source: &image::RgbaImage,
    profile: FlatBackgroundProfile,
) -> image::GrayImage {
    let low = (10.0 + profile.noise * 1.5).clamp(10.0, 30.0);
    let high = (low + 28.0 + profile.noise).clamp(36.0, 72.0);
    let mut mask = image::GrayImage::new(source.width(), source.height());
    for (source_pixel, target) in source.pixels().zip(mask.pixels_mut()) {
        if source_pixel.0[3] == 0 {
            target.0[0] = 0;
            continue;
        }
        let distance = ((f32::from(source_pixel.0[0]) - profile.rgb[0]).powi(2)
            + (f32::from(source_pixel.0[1]) - profile.rgb[1]).powi(2)
            + (f32::from(source_pixel.0[2]) - profile.rgb[2]).powi(2))
        .sqrt();
        let amount = ((distance - low) / (high - low)).clamp(0.0, 1.0);
        let smoothed = amount * amount * (3.0 - 2.0 * amount);
        target.0[0] = (smoothed * 255.0).round() as u8;
    }
    mask
}

fn recover_catastrophic_mask(
    source: &image::RgbaImage,
    predicted: image::GrayImage,
) -> (image::GrayImage, bool) {
    let predicted_signal = mask_signal(&predicted);
    if predicted_signal.mean_alpha >= 0.035 || predicted_signal.visible_fraction >= 0.08 {
        return (predicted, false);
    }
    let Some(profile) = flat_background_profile(source) else {
        return (predicted, false);
    };
    let recovered = flat_background_mask(source, profile);
    let recovered_signal = mask_signal(&recovered);
    let plausible_coverage = recovered_signal.visible_fraction >= 0.005
        && recovered_signal.visible_fraction <= 0.92
        && recovered_signal.mean_alpha <= 0.90;
    let materially_better = recovered_signal.mean_alpha
        >= (predicted_signal.mean_alpha * 2.5).max(predicted_signal.mean_alpha + 0.015);
    if plausible_coverage && materially_better {
        (recovered, true)
    } else {
        (predicted, false)
    }
}

fn run_segmentation(
    session: &mut Session,
    source_image: &image::DynamicImage,
    spec: &MattingModelSpec,
    output_size: (u32, u32),
) -> Result<image::RgbaImage, String> {
    let (input, letterbox) = preprocess(source_image, spec);
    let input_name = session.inputs.first().map(|v| v.name.clone());
    let output_name = session.outputs.first().map(|v| v.name.clone());
    let (input_name, output_name) = match (input_name, output_name) {
        (Some(input), Some(output)) => (input, output),
        _ => return Err("matting:model-io-unknown".to_string()),
    };
    let input_value = ort::value::Tensor::from_array(input)
        .map_err(|error| format!("matting:tensor-build-failed:{error}"))?;
    let outputs = session
        .run(ort::inputs![
            input_name.as_str() => input_value
        ])
        .map_err(|error| format!("matting:inference-failed:{error}"))?;
    let (shape, data) = outputs[output_name.as_str()]
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("matting:mask-read-failed:{error}"))?;
    let dims: Vec<i64> = shape.to_vec();
    #[cfg(test)]
    {
        let minimum = data.iter().copied().fold(f32::INFINITY, f32::min);
        let maximum = data.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        eprintln!(
            "[matting-test] output={} shape={dims:?} range={minimum:.6}..{maximum:.6}",
            output_name
        );
    }
    let mask = decode_mask(data, &dims)?;
    let predicted_alpha = restore_letterboxed_mask(&mask, letterbox, output_size);
    let mut matte = source_image
        .resize_exact(
            output_size.0,
            output_size.1,
            image::imageops::FilterType::Triangle,
        )
        .to_rgba8();
    let (alpha, _) = recover_catastrophic_mask(&matte, predicted_alpha);
    for (alpha_pixel, pixel) in alpha.pixels().zip(matte.pixels_mut()) {
        pixel.0[3] = ((u16::from(pixel.0[3]) * u16::from(alpha_pixel.0[0]) + 127) / 255) as u8;
    }
    Ok(matte)
}

fn compose_with_mask(
    source: &image::DynamicImage,
    encoded_mask: &image::DynamicImage,
) -> image::RgbaImage {
    let (width, height) = source.dimensions();
    let encoded_mask = encoded_mask.to_rgba8();
    let mut mask = image::GrayImage::new(encoded_mask.width(), encoded_mask.height());
    for (source_pixel, target) in encoded_mask.pixels().zip(mask.pixels_mut()) {
        target.0[0] = source_pixel.0[3];
    }
    let mask = image::DynamicImage::ImageLuma8(mask)
        .resize_exact(width, height, image::imageops::FilterType::Triangle)
        .to_luma8();
    let mut output = source.to_rgba8();
    for (alpha, pixel) in mask.pixels().zip(output.pixels_mut()) {
        pixel.0[3] = ((u16::from(pixel.0[3]) * u16::from(alpha.0[0]) + 127) / 255) as u8;
    }
    output
}

fn unique_matting_path(directory: &Path, stem: &str) -> Result<PathBuf, String> {
    for index in 0..10_000_u32 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("_{}", index)
        };
        let path = directory.join(format!("{stem}{suffix}.png"));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("matting:output-collision".to_string())
}

fn is_path_allowed(directory: &Path) -> Result<(), String> {
    if directory.to_string_lossy().contains('\0') {
        return Err("Invalid path".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn list_matting_models() -> Result<Vec<MattingModelStatus>, String> {
    let current = read_matting_model_config();
    MATTING_MODELS
        .iter()
        .map(|spec| {
            let installed = installed_matting_model_file(spec)?.is_some();
            Ok(MattingModelStatus {
                id: spec.id.to_string(),
                display_name: spec.display_name.to_string(),
                note: spec.note.to_string(),
                bytes: spec.bytes,
                installed,
                current: current.as_deref() == Some(spec.id),
            })
        })
        .collect()
}

#[tauri::command]
pub fn set_current_matting_model(model_id: String) -> Result<(), String> {
    let spec = matting_model_spec(&model_id)?;
    let installed = installed_matting_model_file(spec)?;
    if installed.is_none() {
        return Err("matting:model-not-installed".to_string());
    }
    write_matting_model_config(&MattingModelConfig {
        current_model: Some(spec.id.to_string()),
    })
}

#[tauri::command]
pub async fn download_matting_model(
    app_handle: tauri::AppHandle,
    model_id: String,
    source: Option<String>,
) -> Result<MattingModelDownloadResult, String> {
    use std::io::Write;

    let spec = matting_model_spec(&model_id)?;
    let Some(_download_guard) = MattingDownloadGuard::begin() else {
        while MATTING_DOWNLOAD_IN_PROGRESS.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        if MATTING_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        let existing = installed_matting_model_file(spec)?
            .ok_or("matting:download-failed:shared-task".to_string())?;
        write_matting_model_config(&MattingModelConfig {
            current_model: Some(spec.id.to_string()),
        })?;
        return Ok(MattingModelDownloadResult {
            model_id: spec.id.to_string(),
            path: existing.to_string_lossy().into_owned(),
            current: true,
        });
    };
    let target = matting_models_dir()?.join(spec.file_name);
    std::fs::create_dir_all(matting_models_dir()?)
        .map_err(|error| format!("Cannot create model directory: {error}"))?;

    if let Some(existing) = installed_matting_model_file(spec)? {
        write_matting_model_config(&MattingModelConfig {
            current_model: Some(spec.id.to_string()),
        })?;
        return Ok(MattingModelDownloadResult {
            model_id: spec.id.to_string(),
            path: existing.to_string_lossy().into_owned(),
            current: true,
        });
    }

    let partial = target.with_extension("onnx.part");
    let client = reqwest::Client::builder()
        .user_agent("ToolKnit/3.1.0 matting-model-manager")
        .build()
        .map_err(|error| format!("matting:download-init-failed:{error}"))?;
    let requested = source.unwrap_or_else(|| "auto".to_string());
    let candidates: Vec<&str> = match requested.as_str() {
        "china" => vec!["china"],
        _ => vec!["official", "china"],
    };
    let mut last_error = String::from("matting:download-failed");
    for candidate in candidates {
        if MATTING_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        let mut resume_from = std::fs::metadata(&partial)
            .map(|meta| meta.len())
            .unwrap_or(0);
        if resume_from > spec.bytes {
            let _ = std::fs::remove_file(&partial);
            resume_from = 0;
        }
        let url = matting_model_source(Some(candidate))?;
        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
        }
        let mut response = match request.send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                last_error = format!("matting:download-http:{}", response.status());
                continue;
            }
            Err(error) => {
                last_error = format!("matting:download-connect:{error}");
                continue;
            }
        };
        let append = resume_from > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut file = if append {
            std::fs::OpenOptions::new()
                .append(true)
                .open(&partial)
                .map_err(|error| format!("matting:partial-open-failed:{error}"))?
        } else {
            std::fs::File::create(&partial)
                .map_err(|error| format!("matting:partial-create-failed:{error}"))?
        };
        let mut downloaded = if append { resume_from } else { 0 };
        let mut last_report = Instant::now();
        let mut stream_failed = false;
        loop {
            if MATTING_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
                return Err("dependency-download:cancelled".to_string());
            }
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let next_downloaded = downloaded.saturating_add(chunk.len() as u64);
                    if next_downloaded > spec.bytes {
                        last_error = "matting:download-too-large".to_string();
                        stream_failed = true;
                        break;
                    }
                    file.write_all(&chunk)
                        .map_err(|error| format!("matting:partial-write-failed:{error}"))?;
                    downloaded = next_downloaded;
                    if last_report.elapsed().as_millis() > 120 {
                        last_report = Instant::now();
                        let _ = app_handle.emit(
                            "matting-model-progress",
                            MattingModelDownloadProgress {
                                model_id: spec.id.to_string(),
                                downloaded_bytes: downloaded,
                                total_bytes: spec.bytes,
                                phase: if append {
                                    "resuming".to_string()
                                } else {
                                    "downloading".to_string()
                                },
                            },
                        );
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    last_error = format!("matting:download-stream:{error}");
                    stream_failed = true;
                    break;
                }
            }
        }
        let _ = file.flush();
        if stream_failed {
            continue;
        }
        if downloaded == spec.bytes {
            break;
        }
    }

    let partial_meta = std::fs::metadata(&partial)
        .map_err(|_error| format!("matting:download-failed:{last_error}"))?;
    if partial_meta.len() != spec.bytes {
        return Err(format!(
            "matting:download-incomplete:{}:{}",
            partial_meta.len(),
            spec.bytes
        ));
    }
    let partial_for_hash = partial.clone();
    let verified = tokio::task::spawn_blocking(move || sha256_file(&partial_for_hash))
        .await
        .map_err(|error| format!("matting:hash-spawn-failed:{error}"))??;
    if verified != spec.sha256 {
        let _ = std::fs::remove_file(&partial);
        return Err("matting:hash-mismatch".to_string());
    }
    std::fs::rename(&partial, &target)
        .map_err(|error| format!("matting:publish-failed:{error}"))?;
    write_matting_model_config(&MattingModelConfig {
        current_model: Some(spec.id.to_string()),
    })?;
    Ok(MattingModelDownloadResult {
        model_id: spec.id.to_string(),
        path: target.to_string_lossy().into_owned(),
        current: true,
    })
}

fn matting_model_source(source: Option<&str>) -> Result<String, String> {
    let source = source.unwrap_or("auto").trim().to_ascii_lowercase();
    let url = match source.as_str() {
        "official" | "auto" => "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx",
        "china" => "https://hf-mirror.com/Xenova/modnet/resolve/main/onnx/model.onnx",
        _ => return Err("matting:unknown-source".to_string()),
    };
    Ok(url.to_string())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::Digest;
    use std::io::Read as _;
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Cannot open file: {error}"))?;
    let mut digest = sha2::Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read file: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[tauri::command]
pub fn cancel_matting_model_download() {
    MATTING_DOWNLOAD_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn delete_matting_model(model_id: String) -> Result<(), String> {
    let spec = matting_model_spec(&model_id)?;
    let path = matting_models_dir()?.join(spec.file_name);
    if installed_matting_model_file(spec)?.is_none() {
        return Err("matting:model-not-installed".to_string());
    }
    std::fs::remove_file(&path).map_err(|error| format!("matting:delete-failed:{error}"))?;
    if read_matting_model_config().as_deref() == Some(spec.id) {
        let _ = write_matting_model_config(&MattingModelConfig {
            current_model: None,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_matting_segmentation(request_id: u64) {
    if let Ok(mut cancelled) = cancelled_segmentations().lock() {
        cancelled.insert(request_id);
    }
}

struct SegmentationRequestGuard(u64);

impl SegmentationRequestGuard {
    fn begin(request_id: u64) -> Result<Self, String> {
        if request_id == 0 {
            return Err("matting:request-invalid".to_string());
        }
        cancelled_segmentations()
            .lock()
            .map_err(|_| "matting:cancel-state-unavailable".to_string())?
            .remove(&request_id);
        Ok(Self(request_id))
    }
}

impl Drop for SegmentationRequestGuard {
    fn drop(&mut self) {
        if let Ok(mut cancelled) = cancelled_segmentations().lock() {
            cancelled.remove(&self.0);
        }
    }
}

fn ensure_segmentation_active(request_id: u64) -> Result<(), String> {
    let cancelled = cancelled_segmentations()
        .lock()
        .map_err(|_| "matting:cancel-state-unavailable".to_string())?;
    if cancelled.contains(&request_id) {
        Err("matting:cancelled".to_string())
    } else {
        Ok(())
    }
}

fn matting_preview_dir() -> PathBuf {
    std::env::temp_dir()
        .join("ToolKnit")
        .join("background-removal")
}

#[tauri::command]
pub fn discard_matting_preview(path: String) -> Result<(), String> {
    let candidate = PathBuf::from(path);
    let directory = matting_preview_dir();
    let allowed_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("preview-") && name.ends_with(".png"));
    if candidate.parent() != Some(directory.as_path()) || !allowed_name {
        return Err("matting:preview-path-invalid".to_string());
    }
    match std::fs::remove_file(candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("matting:preview-delete-failed:{error}")),
    }
}

#[tauri::command]
pub async fn segment_image(
    input_path: String,
    model_id: Option<String>,
    preview_max_size: Option<u32>,
    request_id: u64,
) -> Result<MattingSegmentResult, String> {
    let _request_guard = SegmentationRequestGuard::begin(request_id)?;
    let spec = match model_id.as_deref() {
        Some(explicit) => matting_model_spec(explicit)?,
        None => {
            let current = read_matting_model_config()
                .or_else(|| first_installed_matting_model().map(|spec| spec.id.to_string()))
                .ok_or("matting:model-not-installed")?;
            matting_model_spec(&current)?
        }
    };
    let model_path = installed_matting_model_file(spec)?.ok_or("matting:model-not-installed")?;
    let started = Instant::now();
    let input_path = Path::new(&input_path).to_path_buf();
    let preview_max_size = preview_max_size
        .unwrap_or(MAX_PREVIEW_EDGE)
        .clamp(512, MAX_PREVIEW_EDGE);

    ort_dylib_ready()?;
    ensure_segmentation_active(request_id)?;

    let loaded = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let image = super::decode_oriented_image(&input_path)
            .map_err(|error| format!("matting:image-open-failed:{error}"))?;
        let (width, height) = image.dimensions();
        let pixels = u64::from(width).saturating_mul(u64::from(height));
        if width == 0 || height == 0 || pixels > MAX_SOURCE_PIXELS {
            return Err("matting:image-too-large".to_string());
        }
        ensure_segmentation_active(request_id)?;
        let scale_down = (width.max(height) > preview_max_size)
            .then(|| preview_max_size as f32 / width.max(height) as f32);
        let output_size = if let Some(scale) = scale_down {
            (
                ((width as f32 * scale).round() as u32).max(1),
                ((height as f32 * scale).round() as u32).max(1),
            )
        } else {
            (width, height)
        };
        let mut runtime = matting_runtime()
            .lock()
            .map_err(|_| "matting:session-busy".to_string())?;
        let (session, execution_provider) = acquire_session(&mut runtime, spec, &model_path)?;
        ensure_segmentation_active(request_id)?;
        let matte = run_segmentation(session, &image, spec, output_size)?;
        ensure_segmentation_active(request_id)?;
        Ok((
            matte,
            output_size,
            (width, height),
            execution_provider.to_string(),
        ))
    })
    .await
    .map_err(|error| format!("matting:segment-spawn-failed:{error}"))??;

    ensure_segmentation_active(request_id)?;
    let (matte, output_size, source_size, execution_provider) = loaded;
    let mut bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut bytes));
    image::DynamicImage::ImageRgba8(matte.clone())
        .write_with_encoder(encoder)
        .map_err(|error| format!("matting:png-encode-failed:{error}"))?;
    ensure_segmentation_active(request_id)?;
    let preview_dir = matting_preview_dir();
    std::fs::create_dir_all(&preview_dir)
        .map_err(|error| format!("matting:preview-dir-failed:{error}"))?;
    let target = preview_dir.join(format!("preview-{}-{request_id}.png", std::process::id()));
    std::fs::write(&target, bytes)
        .map_err(|error| format!("matting:preview-write-failed:{error}"))?;
    if let Err(error) = ensure_segmentation_active(request_id) {
        let _ = std::fs::remove_file(&target);
        return Err(error);
    }
    println!(
        "[matting] preview {}x{} with {} ({}) in {:.2?}",
        output_size.0,
        output_size.1,
        spec.id,
        execution_provider,
        started.elapsed()
    );
    Ok(MattingSegmentResult {
        path: target.to_string_lossy().into_owned(),
        width: output_size.0,
        height: output_size.1,
        model_id: spec.id.to_string(),
        execution_provider: execution_provider.to_string(),
        source_width: source_size.0,
        source_height: source_size.1,
    })
}

#[tauri::command]
pub async fn export_segmented_image(
    input_path: String,
    output_dir: String,
    file_name: String,
    mask_bytes: Vec<u8>,
) -> Result<MattingExportResult, String> {
    if mask_bytes.is_empty() || mask_bytes.len() > MAX_MASK_BYTES {
        return Err("matting:mask-size-invalid".to_string());
    }
    if file_name.contains('\0') || file_name.contains('/') || file_name.contains('\\') {
        return Err("matting:file-name-invalid".to_string());
    }
    is_path_allowed(Path::new(&output_dir))?;
    let input_path = PathBuf::from(input_path);
    let output_dir = PathBuf::from(output_dir);
    tokio::task::spawn_blocking(move || {
        let image = super::decode_oriented_image(&input_path)
            .map_err(|error| format!("matting:image-open-failed:{error}"))?;
        let (width, height) = image.dimensions();
        let pixels = u64::from(width).saturating_mul(u64::from(height));
        if width == 0 || height == 0 || pixels > MAX_EXPORT_PIXELS {
            return Err("matting:image-too-large".to_string());
        }

        let encoded_mask = image::load_from_memory(&mask_bytes)
            .map_err(|error| format!("matting:mask-decode-failed:{error}"))?;
        let output = compose_with_mask(&image, &encoded_mask);

        std::fs::create_dir_all(&output_dir)
            .map_err(|error| format!("matting:output-dir-failed:{error}"))?;
        let stem = Path::new(&file_name)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .filter(|stem| !stem.trim().is_empty())
            .unwrap_or_else(|| "cutout".to_string());
        let target = unique_matting_path(&output_dir, &stem)?;
        let temporary = target.with_extension(format!("png.{}.part", std::process::id()));
        let mut bytes = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut bytes));
        image::DynamicImage::ImageRgba8(output)
            .write_with_encoder(encoder)
            .map_err(|error| format!("matting:png-encode-failed:{error}"))?;
        std::fs::write(&temporary, bytes)
            .map_err(|error| format!("matting:output-write-failed:{error}"))?;
        if let Err(error) = std::fs::rename(&temporary, &target) {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("matting:output-publish-failed:{error}"));
        }
        Ok(MattingExportResult {
            path: target.to_string_lossy().into_owned(),
            width,
            height,
        })
    })
    .await
    .map_err(|error| format!("matting:export-spawn-failed:{error}"))?
}

#[cfg(test)]
mod matting_tests {
    use super::*;

    #[test]
    fn model_preprocessing_is_explicit_and_letterboxed() {
        let wide = letterbox_for(1600, 900, 512);
        assert_eq!(wide.width, 512);
        assert_eq!(wide.height, 288);
        assert_eq!(wide.x, 0);
        assert_eq!(wide.y, 112);

        let tall = letterbox_for(600, 1200, 320);
        assert_eq!(tall.width, 160);
        assert_eq!(tall.height, 320);
        assert_eq!(tall.x, 80);
        assert_eq!(tall.y, 0);

        let modnet = matting_model_spec("modnet").expect("modnet spec");
        assert_eq!(MATTING_MODELS.len(), 1);
        assert_eq!(modnet.id, "modnet");
        assert!(matting_model_spec("isnet").is_err());
        assert!(matting_model_spec("u2net").is_err());
    }

    #[test]
    fn mask_decoding_clamps_values_without_image_min_max() {
        let clamped = decode_mask(&[-1.0, 0.25, 0.75, 2.0], &[1, 1, 2, 2]).expect("clamped mask");
        let values: Vec<u8> = clamped.pixels().map(|pixel| pixel.0[0]).collect();
        assert_eq!(values, vec![0, 64, 191, 255]);
    }

    #[test]
    fn restored_letterbox_mask_matches_requested_dimensions() {
        let letterbox = letterbox_for(1600, 900, 512);
        let mask = image::GrayImage::from_pixel(512, 512, image::Luma([255]));
        let restored = restore_letterboxed_mask(&mask, letterbox, (800, 450));
        assert_eq!(restored.dimensions(), (800, 450));
        assert!(restored.pixels().all(|pixel| pixel.0[0] == 255));
    }

    #[test]
    fn flat_background_fallback_recovers_dark_graphic() {
        let mut source = image::RgbaImage::from_pixel(64, 64, image::Rgba([250, 250, 250, 255]));
        for y in 18..46 {
            for x in 14..50 {
                source.put_pixel(x, y, image::Rgba([8, 8, 8, 255]));
            }
        }
        let predicted = image::GrayImage::from_pixel(64, 64, image::Luma([0]));
        let (recovered, used_fallback) = recover_catastrophic_mask(&source, predicted);
        assert!(used_fallback);
        assert!(recovered.get_pixel(2, 2).0[0] < 4);
        assert!(recovered.get_pixel(32, 32).0[0] > 250);
    }

    #[test]
    fn valid_model_mask_is_never_replaced() {
        let source = image::RgbaImage::from_pixel(64, 64, image::Rgba([250, 250, 250, 255]));
        let mut predicted = image::GrayImage::from_pixel(64, 64, image::Luma([0]));
        for y in 12..52 {
            for x in 18..46 {
                predicted.put_pixel(x, y, image::Luma([255]));
            }
        }
        let expected = predicted.clone();
        let (result, used_fallback) = recover_catastrophic_mask(&source, predicted);
        assert!(!used_fallback);
        assert_eq!(result, expected);
    }

    #[test]
    fn varied_border_does_not_trigger_flat_background_fallback() {
        let mut source = image::RgbaImage::new(64, 64);
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            let value = ((x * 37 + y * 53) % 256) as u8;
            *pixel = image::Rgba([value, 255_u8.saturating_sub(value), value / 2, 255]);
        }
        let predicted = image::GrayImage::from_pixel(64, 64, image::Luma([0]));
        let expected = predicted.clone();
        let (result, used_fallback) = recover_catastrophic_mask(&source, predicted);
        assert!(!used_fallback);
        assert_eq!(result, expected);
    }

    #[test]
    fn edited_preview_mask_is_restored_to_original_export_size() {
        let source = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            8,
            4,
            image::Rgb([20, 40, 60]),
        ));
        let mut mask = image::RgbaImage::new(2, 1);
        mask.put_pixel(0, 0, image::Rgba([255, 255, 255, 0]));
        mask.put_pixel(1, 0, image::Rgba([255, 255, 255, 255]));
        let mask = image::DynamicImage::ImageRgba8(mask);
        let output = compose_with_mask(&source, &mask);
        assert_eq!(output.dimensions(), (8, 4));
        assert!(output.get_pixel(0, 0).0[3] < output.get_pixel(7, 0).0[3]);
        assert_eq!(&output.get_pixel(7, 3).0[..3], &[20, 40, 60]);

        let mut transparent_source =
            image::RgbaImage::from_pixel(2, 1, image::Rgba([20, 40, 60, 255]));
        transparent_source.get_pixel_mut(0, 0).0[3] = 0;
        let opaque_mask = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([255, 255, 255, 255]),
        ));
        let preserved = compose_with_mask(
            &image::DynamicImage::ImageRgba8(transparent_source),
            &opaque_mask,
        );
        assert_eq!(preserved.get_pixel(0, 0).0[3], 0);
        assert_eq!(preserved.get_pixel(1, 0).0[3], 255);
    }

    #[test]
    fn segment_runs_end_to_end_with_optional_model() {
        let Ok(model) = std::env::var("TOOLKNIT_TEST_MATTING_MODEL") else {
            return;
        };
        let Ok(image_path) = std::env::var("TOOLKNIT_TEST_MATTING_IMAGE") else {
            return;
        };
        if !Path::new(&model).is_file() || !Path::new(&image_path).is_file() {
            return;
        }
        std::env::set_var(
            "ORT_DYLIB_PATH",
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("onnxruntime")
                .join("onnxruntime.dll"),
        );
        let spec = matting_model_spec("modnet").expect("modnet spec");
        let image = image::open(&image_path).expect("open portrait");
        let (width, height) = image.dimensions();
        let started = std::time::Instant::now();
        let (mut session, _execution_provider) =
            build_session(Path::new(&model)).expect("build session");
        let matte = run_segmentation(&mut session, &image, spec, (width, height))
            .expect("segment portrait");
        println!(
            "[matting-e2e] {}x{} in {:?}",
            width,
            height,
            started.elapsed()
        );
        assert_eq!(matte.width(), width);
        assert_eq!(matte.height(), height);
        let opaque = matte.pixels().filter(|p| p.0[3] > 200).count();
        let ratio = opaque as f64 / (width * height) as f64;
        println!("[matting-e2e] opaque ratio = {:.3}", ratio);
        assert!(
            ratio > 0.05 && ratio < 0.95,
            "subject should occupy a plausible share of the frame"
        );
    }
}
