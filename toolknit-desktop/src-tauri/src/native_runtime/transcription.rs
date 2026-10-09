use super::*;

// ===== Offline transcription model management =====

pub(super) const TRANSCRIPTION_MODEL_DIRECTORY: &str = "models";
pub(super) const TRANSCRIPTION_MODEL_CONFIG: &str = "transcription-model.json";

pub(super) struct TranscriptionModelSpec {
    id: &'static str,
    file_name: &'static str,
    display_name: &'static str,
    bytes: u64,
    sha256: &'static str,
}

pub(super) const TRANSCRIPTION_MODELS: [TranscriptionModelSpec; 3] = [
    TranscriptionModelSpec {
        id: "base",
        file_name: "ggml-base.bin",
        display_name: "Whisper Base",
        bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    },
    TranscriptionModelSpec {
        id: "small",
        file_name: "ggml-small.bin",
        display_name: "Whisper Small",
        bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    },
    TranscriptionModelSpec {
        id: "medium",
        file_name: "ggml-medium.bin",
        display_name: "Whisper Medium",
        bytes: 1_533_763_059,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    },
];

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub(super) struct TranscriptionModelConfig {
    current_model: Option<String>,
}

#[derive(serde::Serialize)]
pub(super) struct TranscriptionModelStatus {
    id: String,
    display_name: String,
    bytes: u64,
    installed: bool,
    current: bool,
}

#[derive(Clone, serde::Serialize)]
pub(super) struct ModelDownloadProgress {
    model_id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    phase: String,
}

#[derive(serde::Serialize)]
pub(super) struct ModelDownloadResult {
    model_id: String,
    path: String,
    current: bool,
}

pub(super) struct ModelDownloadGuard;

impl Drop for ModelDownloadGuard {
    fn drop(&mut self) {
        IS_MODEL_DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

pub(super) fn begin_model_download() -> Result<ModelDownloadGuard, String> {
    IS_MODEL_DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A model download is already in progress".to_string())?;
    CANCEL_MODEL_DOWNLOAD.store(false, Ordering::SeqCst);
    Ok(ModelDownloadGuard)
}

pub(super) fn transcription_model_spec(model_id: &str) -> Result<&'static TranscriptionModelSpec, String> {
    TRANSCRIPTION_MODELS
        .iter()
        .find(|model| model.id == model_id.trim().to_ascii_lowercase())
        .ok_or("Unknown transcription model".to_string())
}

pub(super) fn transcription_models_dir() -> Result<std::path::PathBuf, String> {
    Ok(toolknit_app_data_dir()?.join(TRANSCRIPTION_MODEL_DIRECTORY))
}

pub(super) fn transcription_model_path(model: &TranscriptionModelSpec) -> Result<std::path::PathBuf, String> {
    Ok(transcription_models_dir()?.join(model.file_name))
}

pub(super) fn transcription_model_config_path() -> Result<std::path::PathBuf, String> {
    Ok(toolknit_app_data_dir()?.join(TRANSCRIPTION_MODEL_CONFIG))
}

pub(super) fn read_transcription_model_config() -> TranscriptionModelConfig {
    transcription_model_config_path()
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub(super) fn write_transcription_model_config(config: &TranscriptionModelConfig) -> Result<(), String> {
    let path = transcription_model_config_path()?;
    let parent = path
        .parent()
        .ok_or("Invalid model configuration directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create model configuration directory: {}", error))?;
    let encoded = serde_json::to_vec(config)
        .map_err(|error| format!("Cannot save model configuration: {}", error))?;
    std::fs::write(path, encoded)
        .map_err(|error| format!("Cannot save model configuration: {}", error))
}

pub(super) fn installed_model_file(
    model: &TranscriptionModelSpec,
) -> Result<Option<std::path::PathBuf>, String> {
    let path = transcription_model_path(model)?;
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot inspect model file: {}", error)),
    };
    if metadata.is_file() && metadata.len() == model.bytes {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

pub(super) fn transcription_model_source(
    model: &TranscriptionModelSpec,
    source: Option<&str>,
) -> Result<String, String> {
    let source = source.unwrap_or("auto").trim().to_ascii_lowercase();
    let root = match source.as_str() {
        "official" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        "china" => "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main",
        // The desktop can retry with `china` after an official failure. `auto` begins with the upstream source.
        "auto" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        _ => return Err("Unknown model download source".to_string()),
    };
    Ok(format!("{}/{}", root, model.file_name))
}

pub(super) fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Cannot open model file: {}", error))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read model file: {}", error))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn get_whisper_cli_path() -> Result<std::path::PathBuf, String> {
    let executable = if cfg!(target_os = "windows") {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    };
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe.parent().ok_or("Cannot find executable directory")?;
    let bundled = exe_dir
        .join("resources")
        .join("whisper")
        .join("Release")
        .join(executable);
    if bundled.is_file() {
        return Ok(bundled);
    }

    let source_resource = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("whisper")
        .join("Release")
        .join(executable);
    if source_resource.is_file() {
        return Ok(source_resource);
    }
    Err("Offline transcription engine is unavailable. Please reinstall ToolKnit.".to_string())
}

#[tauri::command]
pub(super) fn check_transcription_engine() -> bool {
    get_whisper_cli_path()
        .map(|path| path.is_file())
        .unwrap_or(false)
}

pub(super) fn get_whisper_library_path() -> Result<std::path::PathBuf, String> {
    let library = if cfg!(target_os = "windows") {
        "whisper.dll"
    } else if cfg!(target_os = "macos") {
        "libwhisper.dylib"
    } else {
        "libwhisper.so"
    };
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe.parent().ok_or("Cannot find executable directory")?;
    let bundled = exe_dir
        .join("resources")
        .join("whisper")
        .join("Release")
        .join(library);
    if bundled.is_file() {
        return Ok(bundled);
    }

    let source_resource = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("whisper")
        .join("Release")
        .join(library);
    if source_resource.is_file() {
        return Ok(source_resource);
    }
    Err("Offline transcription engine is unavailable. Please reinstall ToolKnit.".to_string())
}

// ===== Teleprompter live offline recognition =====

#[derive(Default)]
pub(super) struct TeleprompterRecognitionState {
    session: std::sync::Mutex<Option<TeleprompterRecognitionSession>>,
    generation: std::sync::atomic::AtomicU64,
    next_session_id: std::sync::atomic::AtomicU64,
}

pub(super) struct TeleprompterRecognitionSession {
    id: String,
    model_id: String,
    language: String,
    whisper: std::sync::Arc<teleprompter_whisper::WhisperSession>,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[derive(serde::Serialize)]
pub(super) struct TeleprompterRecognitionResult {
    text: String,
    confidence: f32,
    model_id: String,
}

pub(super) fn teleprompter_recognition_language(language: &str) -> Result<String, String> {
    match language.trim().to_ascii_lowercase().as_str() {
        "auto" => Ok("auto".to_string()),
        "zh" | "zh-cn" | "chinese" => Ok("zh".to_string()),
        "en" | "en-us" | "english" => Ok("en".to_string()),
        _ => Err("teleprompter:invalid-language".to_string()),
    }
}

pub(super) fn cancel_teleprompter_session(session: &TeleprompterRecognitionSession) {
    session
        .cancelled
        .store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub(super) async fn start_teleprompter_recognition(
    state: tauri::State<'_, TeleprompterRecognitionState>,
    language: String,
) -> Result<String, String> {
    let language = teleprompter_recognition_language(&language)?;
    let config = read_transcription_model_config();
    let model_id = config
        .current_model
        .ok_or("transcription:model-not-installed".to_string())?;
    let model = transcription_model_spec(&model_id)?;
    let model_path =
        installed_model_file(model)?.ok_or("transcription:model-not-installed".to_string())?;
    let whisper_library = get_whisper_library_path()
        .map_err(|_| "teleprompter:engine-unavailable".to_string())?;
    let generation = state
        .generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        .saturating_add(1);
    let numeric_id = state
        .next_session_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        .saturating_add(1);
    let session_id = format!("teleprompter-{}-{}", std::process::id(), numeric_id);

    {
        let mut current = state
            .session
            .lock()
            .map_err(|_| "teleprompter:state-unavailable".to_string())?;
        if let Some(existing) = current.take() {
            cancel_teleprompter_session(&existing);
        }
    }

    let whisper = tokio::task::spawn_blocking(move || {
        teleprompter_whisper::WhisperSession::load(&whisper_library, &model_path)
    })
    .await
    .map_err(|_| "teleprompter:model-load-failed".to_string())??;

    if state.generation.load(std::sync::atomic::Ordering::SeqCst) != generation {
        return Err("teleprompter:stopped".to_string());
    }

    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut current = state
        .session
        .lock()
        .map_err(|_| "teleprompter:state-unavailable".to_string())?;
    *current = Some(TeleprompterRecognitionSession {
        id: session_id.clone(),
        model_id,
        language,
        whisper: std::sync::Arc::new(whisper),
        cancelled,
    });
    Ok(session_id)
}

#[tauri::command]
pub(super) async fn transcribe_teleprompter_audio(
    state: tauri::State<'_, TeleprompterRecognitionState>,
    session_id: String,
    samples: Vec<i16>,
    prompt: Option<String>,
) -> Result<TeleprompterRecognitionResult, String> {
    const MIN_SAMPLES: usize = 8_000;
    const MAX_SAMPLES: usize = 16_000 * 12;
    if session_id.trim().is_empty() || samples.len() < MIN_SAMPLES || samples.len() > MAX_SAMPLES {
        return Err("teleprompter:invalid-audio".to_string());
    }
    let (model_id, language, whisper, cancelled) = {
        let current = state
            .session
            .lock()
            .map_err(|_| "teleprompter:state-unavailable".to_string())?;
        let current = current
            .as_ref()
            .filter(|session| session.id == session_id)
            .ok_or("teleprompter:session-not-found".to_string())?;
        (
            current.model_id.clone(),
            current.language.clone(),
            current.whisper.clone(),
            current.cancelled.clone(),
        )
    };
    let prompt = prompt
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .take(600)
        .collect::<String>();

    let inference_cancelled = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        if inference_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("teleprompter:stopped".to_string());
        }
        whisper.transcribe(samples, &language, &prompt, inference_cancelled)
    })
    .await
    .map_err(|_| "teleprompter:recognition-failed".to_string())??;

    let is_current = state
        .session
        .lock()
        .map_err(|_| "teleprompter:state-unavailable".to_string())?
        .as_ref()
        .is_some_and(|session| session.id == session_id && !session.cancelled.load(std::sync::atomic::Ordering::SeqCst));
    if !is_current {
        return Err("teleprompter:stopped".to_string());
    }
    Ok(TeleprompterRecognitionResult {
        text: result.text,
        confidence: result.confidence,
        model_id,
    })
}

#[tauri::command]
pub(super) fn stop_teleprompter_recognition(
    state: tauri::State<'_, TeleprompterRecognitionState>,
    session_id: String,
) -> Result<(), String> {
    let mut current = state
        .session
        .lock()
        .map_err(|_| "teleprompter:state-unavailable".to_string())?;
    if current
        .as_ref()
        .is_some_and(|session| session.id == session_id)
    {
        if let Some(session) = current.take() {
            cancel_teleprompter_session(&session);
        }
        state
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub(super) fn list_transcription_models() -> Result<Vec<TranscriptionModelStatus>, String> {
    let config = read_transcription_model_config();
    TRANSCRIPTION_MODELS
        .iter()
        .map(|model| {
            let installed = installed_model_file(model)?.is_some();
            Ok(TranscriptionModelStatus {
                id: model.id.to_string(),
                display_name: model.display_name.to_string(),
                bytes: model.bytes,
                installed,
                current: installed && config.current_model.as_deref() == Some(model.id),
            })
        })
        .collect()
}

#[tauri::command]
pub(super) fn set_current_transcription_model(model_id: String) -> Result<(), String> {
    let model = transcription_model_spec(&model_id)?;
    if installed_model_file(model)?.is_none() {
        return Err("Install this offline model before selecting it".to_string());
    }
    write_transcription_model_config(&TranscriptionModelConfig {
        current_model: Some(model.id.to_string()),
    })
}

#[tauri::command]
pub(super) fn delete_transcription_model(model_id: String) -> Result<(), String> {
    let model = transcription_model_spec(&model_id)?;
    let path = transcription_model_path(model)?;
    let partial = path.with_extension("bin.part");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|error| format!("Cannot delete model: {}", error))?;
    }
    if partial.exists() {
        let _ = std::fs::remove_file(partial);
    }
    let mut config = read_transcription_model_config();
    if config.current_model.as_deref() == Some(model.id) {
        config.current_model = None;
        write_transcription_model_config(&config)?;
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn download_transcription_model(
    app_handle: tauri::AppHandle,
    model_id: String,
    source: Option<String>,
) -> Result<ModelDownloadResult, String> {
    use std::io::Write;

    let _download_guard = begin_model_download()?;
    let model = transcription_model_spec(&model_id)?;
    let target = transcription_model_path(model)?;
    let parent = target.parent().ok_or("Invalid model directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create model directory: {}", error))?;

    if let Some(existing) = installed_model_file(model)? {
        let expected = model.sha256.to_string();
        let verified = tokio::task::spawn_blocking(move || sha256_file(&existing))
            .await
            .map_err(|error| format!("Cannot verify model: {}", error))??;
        if verified == expected {
            let config = read_transcription_model_config();
            return Ok(ModelDownloadResult {
                model_id: model.id.to_string(),
                path: target.to_string_lossy().into_owned(),
                current: config.current_model.as_deref() == Some(model.id),
            });
        }
        let _ = std::fs::remove_file(&target);
    }

    let partial = target.with_extension("bin.part");
    let client = reqwest::Client::builder()
        .user_agent("ToolKnit/3.1.0 offline-model-manager")
        .build()
        .map_err(|error| format!("Cannot initialize model download: {}", error))?;
    let requested_source = source
        .as_deref()
        .unwrap_or("auto")
        .trim()
        .to_ascii_lowercase();
    let candidates: Vec<&str> = match requested_source.as_str() {
        "auto" => vec!["official", "china"],
        "official" | "china" => vec![requested_source.as_str()],
        _ => return Err("Unknown model download source".to_string()),
    };
    let mut last_error = None;
    for candidate in candidates {
        if CANCEL_MODEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        // A failed stream may have extended the partial file. Read its size
        // again for every mirror attempt so the Range header stays correct.
        let mut resume_from = std::fs::metadata(&partial)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if resume_from > model.bytes {
            let _ = std::fs::remove_file(&partial);
            resume_from = 0;
        }
        let url = transcription_model_source(model, Some(candidate))?;
        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={}-", resume_from));
        }
        let mut response = match request.send().await {
            Ok(candidate_response) if candidate_response.status().is_success() => {
                candidate_response
            }
            Ok(candidate_response) => {
                last_error = Some(format!("HTTP {}", candidate_response.status()));
                continue;
            }
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        let append = resume_from > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !append && resume_from > 0 {
            resume_from = 0;
        }
        let mut downloaded = if append { resume_from } else { 0 };
        let mut output = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .map_err(|error| format!("Cannot create model download: {}", error))?;
        let _ = app_handle.emit(
            "transcription-model-download-progress",
            ModelDownloadProgress {
                model_id: model.id.to_string(),
                downloaded_bytes: downloaded,
                total_bytes: model.bytes,
                phase: "downloading".to_string(),
            },
        );
        let stream_error = loop {
            if CANCEL_MODEL_DOWNLOAD.load(Ordering::SeqCst) {
                output
                    .sync_all()
                    .map_err(|error| format!("Cannot preserve model download: {}", error))?;
                return Err("dependency-download:cancelled".to_string());
            }
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let next_downloaded = downloaded.saturating_add(chunk.len() as u64);
                    if next_downloaded > model.bytes {
                        break Some(
                            "Downloaded model is larger than the expected package".to_string(),
                        );
                    }
                    output
                        .write_all(&chunk)
                        .map_err(|error| format!("Cannot write model download: {}", error))?;
                    downloaded = next_downloaded;
                    let _ = app_handle.emit(
                        "transcription-model-download-progress",
                        ModelDownloadProgress {
                            model_id: model.id.to_string(),
                            downloaded_bytes: downloaded,
                            total_bytes: model.bytes,
                            phase: "downloading".to_string(),
                        },
                    );
                }
                Ok(None) => break None,
                Err(error) => break Some(error.to_string()),
            }
        };
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize model download: {}", error))?;
        drop(output);
        if let Some(error) = stream_error {
            last_error = Some(format!("Model download interrupted: {}", error));
            continue;
        }
        if downloaded != model.bytes {
            if downloaded >= model.bytes {
                let _ = std::fs::remove_file(&partial);
            }
            last_error =
                Some("Downloaded model size does not match the expected package".to_string());
            continue;
        }
        let _ = app_handle.emit(
            "transcription-model-download-progress",
            ModelDownloadProgress {
                model_id: model.id.to_string(),
                downloaded_bytes: downloaded,
                total_bytes: model.bytes,
                phase: "verifying".to_string(),
            },
        );
        let path_for_hash = partial.clone();
        let actual_hash = tokio::task::spawn_blocking(move || sha256_file(&path_for_hash))
            .await
            .map_err(|error| format!("Cannot verify model: {}", error))??;
        if actual_hash != model.sha256 {
            let _ = std::fs::remove_file(&partial);
            last_error =
                Some("Model integrity check failed. The incomplete file was removed.".to_string());
            continue;
        }
        if target.exists() {
            let _ = std::fs::remove_file(&target);
        }
        std::fs::rename(&partial, &target)
            .map_err(|error| format!("Cannot install model: {}", error))?;

        let mut config = read_transcription_model_config();
        if config.current_model.is_none() || model.id == "small" {
            config.current_model = Some(model.id.to_string());
            write_transcription_model_config(&config)?;
        }
        let current = config.current_model.as_deref() == Some(model.id);
        let _ = app_handle.emit(
            "transcription-model-download-progress",
            ModelDownloadProgress {
                model_id: model.id.to_string(),
                downloaded_bytes: model.bytes,
                total_bytes: model.bytes,
                phase: "complete".to_string(),
            },
        );
        return Ok(ModelDownloadResult {
            model_id: model.id.to_string(),
            path: target.to_string_lossy().into_owned(),
            current,
        });
    }
    Err(format!(
        "Cannot download model: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

#[derive(serde::Serialize)]
pub(super) struct TranscriptionResult {
    model_id: String,
    raw_json_path: String,
    raw_srt_path: String,
    raw_txt_path: String,
}

#[derive(Clone, serde::Serialize)]
pub(super) struct TranscriptionProgress {
    phase: String,
    progress: u8,
}

pub(super) fn transcription_input_path(input_path: &str) -> Result<std::path::PathBuf, String> {
    const SUPPORTED_EXTENSIONS: &[&str] = &[
        "mp3", "aac", "m4a", "wav", "flac", "alac", "ogg", "wma", "mp4", "mkv", "avi", "mov",
        "webm", "flv", "wmv", "ts",
    ];
    if input_path.trim().is_empty() || input_path.contains('\0') {
        return Err("transcription:invalid-input".to_string());
    }
    let path = std::path::PathBuf::from(input_path)
        .canonicalize()
        .map_err(|_| "transcription:input-not-found".to_string())?;
    let metadata =
        std::fs::metadata(&path).map_err(|_| "transcription:input-not-found".to_string())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > 10 * 1024 * 1024 * 1024
        || !SUPPORTED_EXTENSIONS.contains(&extension.as_str())
    {
        return Err("transcription:invalid-input".to_string());
    }
    Ok(path)
}

pub(super) fn transcription_output_dir(output_dir: &str) -> Result<std::path::PathBuf, String> {
    if output_dir.trim().is_empty() || output_dir.contains('\0') {
        return Err("transcription:invalid-output".to_string());
    }
    let path = std::path::PathBuf::from(output_dir);
    is_path_safe(&path).map_err(|_| "transcription:invalid-output".to_string())?;
    std::fs::create_dir_all(&path).map_err(|_| "transcription:invalid-output".to_string())?;
    let path = path
        .canonicalize()
        .map_err(|_| "transcription:invalid-output".to_string())?;
    is_path_safe(&path).map_err(|_| "transcription:invalid-output".to_string())?;
    Ok(path)
}

pub(super) fn transcription_language(language: &str) -> Result<&str, String> {
    match language.trim().to_ascii_lowercase().as_str() {
        "auto" => Ok("auto"),
        "zh" | "zh-cn" | "chinese" => Ok("zh"),
        "en" | "en-us" | "english" => Ok("en"),
        _ => Err("transcription:invalid-language".to_string()),
    }
}

pub(super) fn transcription_output_stem(input: &std::path::Path) -> String {
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("transcript");
    let normalized: String = stem
        .chars()
        .map(|character| {
            if matches!(
                character,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'
            ) || character.is_control()
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let normalized = normalized.trim().trim_end_matches('.').trim_end();
    if normalized.is_empty() {
        "transcript".to_string()
    } else {
        normalized.chars().take(96).collect()
    }
}

pub(super) fn create_transcription_temp_dir(
    output_dir: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    for _ in 0..10_000 {
        let id = TRANSCRIPTION_TEMP_ID.fetch_add(1, Ordering::SeqCst);
        let candidate = output_dir.join(format!(
            ".toolknit-transcription-{}-{}",
            std::process::id(),
            id
        ));
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("transcription:invalid-output".to_string()),
        }
    }
    Err("transcription:invalid-output".to_string())
}

pub(super) struct TranscriptionTempDir {
    path: std::path::PathBuf,
}

impl TranscriptionTempDir {
    pub(super) fn create(output_dir: &std::path::Path) -> Result<Self, String> {
        Ok(Self {
            path: create_transcription_temp_dir(output_dir)?,
        })
    }

    pub(super) fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TranscriptionTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) fn is_ascii_path(path: &std::path::Path) -> bool {
    path.to_string_lossy().bytes().all(|byte| byte < 0x80)
}

fn transcription_whisper_workspace_root() -> Result<std::path::PathBuf, String> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Ok(program_data) = std::env::var("ProgramData") {
            candidates.push(std::path::PathBuf::from(program_data));
        }
        candidates.push(std::path::PathBuf::from(r"C:\Windows\Temp"));
        candidates.push(std::path::PathBuf::from(r"C:\ToolKnitTemp"));
    }
    #[cfg(not(target_os = "windows"))]
    candidates.push(std::env::temp_dir());

    for candidate in candidates {
        let root = candidate.join("ToolKnit").join("transcription-work");
        if !is_ascii_path(&root) {
            continue;
        }
        if std::fs::create_dir_all(&root).is_ok() {
            return Ok(root);
        }
    }
    Err("transcription:workspace-unavailable".to_string())
}

fn create_whisper_workspace() -> Result<TranscriptionTempDir, String> {
    let root = transcription_whisper_workspace_root()?;
    TranscriptionTempDir::create(&root)
        .map_err(|_| "transcription:workspace-unavailable".to_string())
}

fn stage_whisper_model(
    model: &std::path::Path,
    workspace: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let staged = workspace.join("model.bin");
    if std::fs::hard_link(model, &staged).is_err() {
        std::fs::copy(model, &staged)
            .map_err(|_| "transcription:model-stage-failed".to_string())?;
    }
    Ok(staged)
}

pub(super) fn transcription_prepare_error(
    command_succeeded: bool,
    wav_exists: bool,
    stderr: &str,
) -> Option<&'static str> {
    if command_succeeded && wav_exists {
        return None;
    }
    let diagnostic = stderr.to_ascii_lowercase();
    if diagnostic.contains("does not contain any stream")
        || diagnostic.contains("matches no streams")
        || diagnostic.contains("no audio stream")
        || diagnostic.contains("output file does not contain any stream")
    {
        return Some("transcription:no-audio-stream");
    }
    Some("transcription:prepare-failed")
}

pub(super) fn transcription_engine_error(
    command_succeeded: bool,
    output_files_exist: bool,
    stderr: &str,
) -> Option<&'static str> {
    if command_succeeded && output_files_exist {
        return None;
    }
    let diagnostic = stderr.to_ascii_lowercase();
    if diagnostic.contains("failed to load model")
        || diagnostic.contains("cannot load model")
        || diagnostic.contains("model file")
    {
        return Some("transcription:model-load-failed");
    }
    if diagnostic.contains("failed to read audio")
        || diagnostic.contains("cannot open audio")
        || diagnostic.contains("audio file")
    {
        return Some("transcription:audio-read-failed");
    }
    if command_succeeded && !output_files_exist {
        return Some("transcription:output-failed");
    }
    Some("transcription:engine-failed")
}

pub(super) async fn run_transcription_command(
    command: &std::path::Path,
    arguments: &[std::ffi::OsString],
) -> Result<std::process::Output, String> {
    let mut process = tokio::process::Command::new(command);
    process
        .args(arguments)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        process.creation_flags(0x08000000);
    }
    let child = process
        .spawn()
        .map_err(|_| "transcription:engine-failed".to_string())?;
    CURRENT_CHILD_ID.store(child.id().unwrap_or(0), Ordering::SeqCst);
    let output = child.wait_with_output().await;
    CURRENT_CHILD_ID.store(0, Ordering::SeqCst);
    let output = output.map_err(|_| "transcription:engine-failed".to_string())?;
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("transcription:cancelled".to_string());
    }
    Ok(output)
}

// Whisper models occasionally answer spoken Mandarin in traditional
// characters. Transcription outputs are rewritten to simplified so the
// published files match what Chinese users expect to edit and share.
pub(super) fn simplify_chinese_text(input: &str) -> String {
    crate::chinese_text::simplify(input)
}

pub(super) fn simplify_transcription_outputs(temp_dir: &std::path::Path) -> Result<(), String> {
    for name in ["transcript.json", "transcript.srt", "transcript.txt"] {
        let path = temp_dir.join(name);
        let content = std::fs::read_to_string(&path)
            .map_err(|error| format!("Cannot read transcription output: {error}"))?;
        let simplified = if name.ends_with(".json") {
            let mut value: serde_json::Value = serde_json::from_str(&content)
                .map_err(|_| "Invalid transcription JSON output".to_string())?;
            crate::chinese_text::simplify_transcription_json(&mut value);
            serde_json::to_string(&value)
                .map_err(|_| "Cannot serialize transcription JSON output".to_string())?
        } else {
            simplify_chinese_text(&content)
        };
        if simplified != content {
            std::fs::write(&path, simplified)
                .map_err(|error| format!("Cannot update transcription output: {error}"))?;
        }
    }
    Ok(())
}

pub(super) fn copy_transcription_output(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing output directory")
    })?;
    let mut staging = None;
    for _ in 0..10_000 {
        let id = TRANSCRIPTION_TEMP_ID.fetch_add(1, Ordering::SeqCst);
        let candidate = parent.join(format!(
            ".toolknit-transcription-publish-{}-{}.tmp",
            std::process::id(),
            id
        ));
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&candidate)
        {
            Ok(file) => {
                staging = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let (staging_path, mut staging_file) = staging.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "could not reserve a temporary output file",
        )
    })?;
    let result = (|| {
        let mut source_file = std::fs::File::open(source)?;
        std::io::copy(&mut source_file, &mut staging_file)?;
        staging_file.sync_all()?;
        drop(staging_file);
        if std::fs::hard_link(&staging_path, destination).is_ok() {
            return Ok(());
        }
        let mut staged_source = std::fs::File::open(&staging_path)?;
        let mut destination_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(destination)?;
        if let Err(error) = std::io::copy(&mut staged_source, &mut destination_file)
            .and_then(|_| destination_file.sync_all())
        {
            drop(destination_file);
            let _ = std::fs::remove_file(destination);
            return Err(error);
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&staging_path);
    result
}

fn publish_transcription_file(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    match std::fs::hard_link(source, destination) {
        Ok(()) => Ok(()),
        Err(_) => copy_transcription_output(source, destination),
    }
}

pub(super) fn publish_transcription_outputs(
    temp_dir: &std::path::Path,
    output_dir: &std::path::Path,
    stem: &str,
) -> Result<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf), String> {
    let source_json = temp_dir.join("transcript.json");
    let source_srt = temp_dir.join("transcript.srt");
    let source_txt = temp_dir.join("transcript.txt");
    if !source_json.is_file() || !source_srt.is_file() || !source_txt.is_file() {
        return Err("transcription:engine-failed".to_string());
    }
    for index in 0..10_000_u32 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("_{}", index)
        };
        let json = output_dir.join(format!("{}_transcript{}.json", stem, suffix));
        let srt = output_dir.join(format!("{}_transcript{}.srt", stem, suffix));
        let txt = output_dir.join(format!("{}_transcript{}.txt", stem, suffix));
        if json.exists() || srt.exists() || txt.exists() {
            continue;
        }
        if publish_transcription_file(&source_json, &json).is_err() {
            continue;
        }
        if publish_transcription_file(&source_srt, &srt).is_err() {
            let _ = std::fs::remove_file(&json);
            continue;
        }
        if publish_transcription_file(&source_txt, &txt).is_err() {
            let _ = std::fs::remove_file(&json);
            let _ = std::fs::remove_file(&srt);
            continue;
        }
        return Ok((json, srt, txt));
    }
    Err("transcription:invalid-output".to_string())
}

#[tauri::command]
pub(super) async fn transcribe_media(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_dir: String,
    language: String,
) -> Result<TranscriptionResult, String> {
    let _conversion_guard = begin_conversion()?;
    let input = transcription_input_path(&input_path)?;
    let output_dir = transcription_output_dir(&output_dir)?;
    let language = transcription_language(&language)?;
    let config = read_transcription_model_config();
    let model_id = config
        .current_model
        .ok_or("transcription:model-not-installed".to_string())?;
    let model = transcription_model_spec(&model_id)?;
    let model_path =
        installed_model_file(model)?.ok_or("transcription:model-not-installed".to_string())?;
    let ffmpeg = get_ffmpeg_path().map_err(|_| "transcription:ffmpeg-unavailable".to_string())?;
    let whisper =
        get_whisper_cli_path().map_err(|_| "transcription:engine-unavailable".to_string())?;
    // whisper.cpp 1.9.1 converts command-line paths as UTF-8 on Windows. Keep
    // every path passed to that CLI ASCII-only; the user's real paths remain
    // unchanged and are still used by FFmpeg and the final publisher.
    let temp_dir = create_whisper_workspace()?;
    let temp_path = temp_dir.path();
    let whisper_model = stage_whisper_model(&model_path, temp_path)?;
    let wav = temp_path.join("input.wav");
    let _ = app_handle.emit(
        "transcription-progress",
        TranscriptionProgress {
            phase: "preparing".to_string(),
            progress: 5,
        },
    );

    let ffmpeg_args = vec![
        std::ffi::OsString::from("-hide_banner"),
        std::ffi::OsString::from("-nostdin"),
        std::ffi::OsString::from("-y"),
        std::ffi::OsString::from("-i"),
        input.as_os_str().to_os_string(),
        std::ffi::OsString::from("-map"),
        std::ffi::OsString::from("0:a:0"),
        std::ffi::OsString::from("-vn"),
        std::ffi::OsString::from("-ac"),
        std::ffi::OsString::from("1"),
        std::ffi::OsString::from("-ar"),
        std::ffi::OsString::from("16000"),
        std::ffi::OsString::from("-c:a"),
        std::ffi::OsString::from("pcm_s16le"),
        std::ffi::OsString::from("-f"),
        std::ffi::OsString::from("wav"),
        wav.as_os_str().to_os_string(),
    ];
    let prepared = run_transcription_command(&ffmpeg, &ffmpeg_args)
        .await
        .map_err(|error| {
            if error == "transcription:engine-failed" {
                "transcription:prepare-failed".to_string()
            } else {
                error
            }
        })?;
    if let Some(error) = transcription_prepare_error(
        prepared.status.success(),
        wav.is_file(),
        &String::from_utf8_lossy(&prepared.stderr),
    ) {
        return Err(error.to_string());
    }
    let _ = app_handle.emit(
        "transcription-progress",
        TranscriptionProgress {
            phase: "transcribing".to_string(),
            progress: 15,
        },
    );
    let whisper_args = vec![
        std::ffi::OsString::from("-m"),
        whisper_model.as_os_str().to_os_string(),
        std::ffi::OsString::from("-f"),
        wav.as_os_str().to_os_string(),
        std::ffi::OsString::from("-l"),
        std::ffi::OsString::from(language),
        std::ffi::OsString::from("-otxt"),
        std::ffi::OsString::from("-osrt"),
        std::ffi::OsString::from("-oj"),
        std::ffi::OsString::from("-ojf"),
        std::ffi::OsString::from("-np"),
        std::ffi::OsString::from("-of"),
        temp_path.join("transcript").as_os_str().to_os_string(),
    ];
    let transcribed = run_transcription_command(&whisper, &whisper_args).await?;
    if let Some(error) = transcription_engine_error(
        transcribed.status.success(),
        temp_path.join("transcript.json").is_file()
            && temp_path.join("transcript.srt").is_file()
            && temp_path.join("transcript.txt").is_file(),
        &String::from_utf8_lossy(&transcribed.stderr),
    ) {
        return Err(error.to_string());
    }
    let _ = app_handle.emit(
        "transcription-progress",
        TranscriptionProgress {
            phase: "publishing".to_string(),
            progress: 95,
        },
    );
    simplify_transcription_outputs(temp_path)?;
    let stem = transcription_output_stem(&input);
    let published = publish_transcription_outputs(temp_path, &output_dir, &stem);
    let (raw_json_path, raw_srt_path, raw_txt_path) = published?;
    let _ = app_handle.emit(
        "transcription-progress",
        TranscriptionProgress {
            phase: "complete".to_string(),
            progress: 100,
        },
    );
    Ok(TranscriptionResult {
        model_id: model.id.to_string(),
        raw_json_path: raw_json_path.to_string_lossy().into_owned(),
        raw_srt_path: raw_srt_path.to_string_lossy().into_owned(),
        raw_txt_path: raw_txt_path.to_string_lossy().into_owned(),
    })
}

