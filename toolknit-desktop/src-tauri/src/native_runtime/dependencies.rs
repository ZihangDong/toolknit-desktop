use super::*;
#[path = "dependencies/libreoffice_install.rs"]
mod libreoffice_install;
#[path = "dependencies/libreoffice_extract.rs"]
mod libreoffice_extract;

// ===== Audio Conversion =====

pub(super) static IS_CONVERTING: AtomicBool = AtomicBool::new(false);
pub(super) static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
pub(super) static CURRENT_CHILD_ID: AtomicU32 = AtomicU32::new(0);
pub(super) static PDF_DECRYPT_TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static VIDEO_CONVERT_TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static AUDIO_CONVERT_TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static IS_MODEL_DOWNLOADING: AtomicBool = AtomicBool::new(false);
pub(super) static IS_FFMPEG_DOWNLOADING: AtomicBool = AtomicBool::new(false);
pub(super) static IS_LIBREOFFICE_DOWNLOADING: AtomicBool = AtomicBool::new(false);
pub(super) static CANCEL_MODEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
pub(super) static CANCEL_FFMPEG_DOWNLOAD: AtomicBool = AtomicBool::new(false);
pub(super) static CANCEL_LIBREOFFICE_DOWNLOAD: AtomicBool = AtomicBool::new(false);
pub(super) static TRANSCRIPTION_TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static PPT_RENDER_TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub(super) const PPT_RENDER_TIMEOUT_SECS: u64 = 180;
pub(super) const PPT_RENDER_PROBE_TIMEOUT_MS: u128 = 10_000;
pub(super) static ACTIVE_VIDEO_CHILDREN: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeSet<u32>>,
> = std::sync::OnceLock::new();
pub(super) static ACTIVE_OFFICE_CHILDREN: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeSet<u32>>,
> = std::sync::OnceLock::new();
pub(super) static ICON_ARCHIVE_WRITE_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static ICON_ARCHIVE_WRITES: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeMap<u64, IconArchiveWrite>>,
> = std::sync::OnceLock::new();
pub(super) static PDF_ENHANCE_WRITE_ID: AtomicU64 = AtomicU64::new(0);
pub(super) static PDF_ENHANCE_WRITES: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeMap<u64, PdfEnhanceWrite>>,
> = std::sync::OnceLock::new();

pub(super) const MAX_ICON_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
pub(super) const MAX_PDF_ENHANCE_OUTPUT_BYTES: u64 = 100 * 1024 * 1024;
pub(super) const MAX_PDF_ENHANCE_PAGES: u32 = 100;
pub(super) const MAX_PDF_ENHANCE_WRITE_SESSIONS: usize = 4;

#[derive(Clone)]
pub(super) struct IconArchiveWrite {
    pub(super) temporary_path: std::path::PathBuf,
    pub(super) output_directory: std::path::PathBuf,
    pub(super) file_name: String,
}

pub(super) struct PdfEnhanceWrite {
    pub(super) file: std::fs::File,
    pub(super) temporary_path: std::path::PathBuf,
    pub(super) output_directory: std::path::PathBuf,
    pub(super) file_name: String,
    pub(super) expected_pages: u32,
    pub(super) bytes_written: u64,
}

pub(super) fn icon_archive_writes(
) -> &'static std::sync::Mutex<std::collections::BTreeMap<u64, IconArchiveWrite>> {
    ICON_ARCHIVE_WRITES.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
}

pub(super) fn pdf_enhance_writes(
) -> &'static std::sync::Mutex<std::collections::BTreeMap<u64, PdfEnhanceWrite>> {
    PDF_ENHANCE_WRITES.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
}

pub(super) fn active_video_children() -> &'static std::sync::Mutex<std::collections::BTreeSet<u32>> {
    ACTIVE_VIDEO_CHILDREN.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeSet::new()))
}

pub(super) fn active_office_children() -> &'static std::sync::Mutex<std::collections::BTreeSet<u32>> {
    ACTIVE_OFFICE_CHILDREN.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeSet::new()))
}

pub(super) fn terminate_conversion_process(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .spawn();
    }
}

pub(super) const MAX_IMAGE_BATCH_FILES: usize = 100;
pub(super) const MAX_IMAGE_FILE_BYTES: u64 = 100 * 1024 * 1024;
pub(super) const MAX_IMAGE_PIXELS: u64 = 160_000_000;

pub(super) struct ConversionGuard;

impl Drop for ConversionGuard {
    fn drop(&mut self) {
        CURRENT_CHILD_ID.store(0, Ordering::SeqCst);
        IS_CONVERTING.store(false, Ordering::SeqCst);
        CANCEL_FLAG.store(false, Ordering::SeqCst);
    }
}

pub(super) fn begin_conversion() -> Result<ConversionGuard, String> {
    IS_CONVERTING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Another file conversion is already in progress".to_string())?;
    CANCEL_FLAG.store(false, Ordering::SeqCst);
    Ok(ConversionGuard)
}

pub(super) const FFMPEG_RUNTIME_DIRECTORY: &str = "ffmpeg";
pub(super) const FFMPEG_ARCHIVE_BYTES: u64 = 29_581_307;
pub(super) const FFMPEG_ARCHIVE_SHA256: &str =
    "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77";
pub(super) const FFMPEG_OFFICIAL_URL: &str =
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz";
pub(super) const FFMPEG_CHINA_URL: &str =
    "https://cdn.npmmirror.com/binaries/ffmpeg-static/b6.1.1/ffmpeg-win32-x64.gz";
pub(super) const FFMPEG_CHINA_FALLBACK_URL: &str = "https://gh-proxy.com/https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz";

pub(super) fn ffmpeg_runtime_dir() -> Result<std::path::PathBuf, String> {
    Ok(toolknit_app_data_dir()?.join(FFMPEG_RUNTIME_DIRECTORY))
}
pub(super) fn ffmpeg_runtime_path() -> Result<std::path::PathBuf, String> {
    Ok(ffmpeg_runtime_dir()?.join(if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }))
}

#[derive(Clone)]
pub(super) struct ResolvedFfmpegRuntime {
    path: std::path::PathBuf,
    source: String,
    version: Option<String>,
}

pub(super) static FFMPEG_RUNTIME_CACHE: OnceLock<std::sync::Mutex<Option<ResolvedFfmpegRuntime>>> =
    OnceLock::new();
pub(super) const FFMPEG_PROBE_TIMEOUT_MS: u128 = 2_000;

pub(super) fn ffmpeg_runtime_cache() -> &'static std::sync::Mutex<Option<ResolvedFfmpegRuntime>> {
    FFMPEG_RUNTIME_CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

pub(super) fn invalidate_ffmpeg_runtime_cache() {
    if let Ok(mut cache) = ffmpeg_runtime_cache().lock() {
        *cache = None;
    }
}

pub(super) fn ffmpeg_candidates() -> Vec<(std::path::PathBuf, &'static str)> {
    let executable = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let mut candidates = Vec::new();
    if let Ok(value) = std::env::var("TOOLKNIT_FFMPEG_PATH") {
        if !value.trim().is_empty() && !value.contains('\0') {
            candidates.push((std::path::PathBuf::from(value), "env:TOOLKNIT_FFMPEG_PATH"));
        }
    }
    if let Ok(managed) = ffmpeg_runtime_path() {
        candidates.push((managed, "managed"));
    }

    // These are fixed package-manager links or conventional install paths.
    // Avoid recursive disk and registry scans: all checks below are cheap file
    // metadata lookups and cover the common Winget, Scoop and Chocolatey cases.
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push((
                std::path::PathBuf::from(local_app_data)
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Links")
                    .join(executable),
                "system:winget",
            ));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            candidates.push((
                std::path::PathBuf::from(user_profile)
                    .join("scoop")
                    .join("shims")
                    .join(executable),
                "system:scoop",
            ));
        }
        if let Ok(chocolatey) = std::env::var("ChocolateyInstall") {
            candidates.push((
                std::path::PathBuf::from(chocolatey)
                    .join("bin")
                    .join(executable),
                "system:chocolatey",
            ));
        } else if let Ok(program_data) = std::env::var("ProgramData") {
            candidates.push((
                std::path::PathBuf::from(program_data)
                    .join("chocolatey")
                    .join("bin")
                    .join(executable),
                "system:chocolatey",
            ));
        }
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(root) = std::env::var(key) {
                let root = std::path::PathBuf::from(root);
                candidates.push((
                    root.join("ffmpeg").join("bin").join(executable),
                    "system:windows-install",
                ));
                candidates.push((
                    root.join("FFmpeg").join("bin").join(executable),
                    "system:windows-install",
                ));
            }
        }
    }

    #[cfg(debug_assertions)]
    candidates.push((
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg")
            .join(executable),
        "debug-resource",
    ));

    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&paths).map(|directory| (directory.join(executable), "PATH")),
        );
    }
    let mut seen = std::collections::BTreeSet::new();
    candidates
        .into_iter()
        .filter(|(path, _)| seen.insert(path.to_string_lossy().to_ascii_lowercase()))
        .collect()
}

pub(super) fn probe_ffmpeg_runtime(
    path: &std::path::Path,
    source: &'static str,
) -> Option<ResolvedFfmpegRuntime> {
    if !std::fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
    {
        return None;
    }
    let mut command = std::process::Command::new(path);
    command
        .arg("-version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    let child_id = child.id();
    let started_at = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started_at.elapsed().as_millis() < FFMPEG_PROBE_TIMEOUT_MS => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            _ => {
                terminate_conversion_process(child_id);
                let _ = child.wait();
                return None;
            }
        }
    }
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let version = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| line.to_ascii_lowercase().starts_with("ffmpeg version"))
        .map(str::to_string);
    Some(ResolvedFfmpegRuntime {
        path: path.to_path_buf(),
        source: source.to_string(),
        version,
    })
}

pub(super) fn resolve_ffmpeg_runtime() -> Option<ResolvedFfmpegRuntime> {
    if let Ok(cache) = ffmpeg_runtime_cache().lock() {
        if let Some(runtime) = cache.as_ref() {
            if std::fs::metadata(&runtime.path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
            {
                return Some(runtime.clone());
            }
        }
    }
    for (candidate, source) in ffmpeg_candidates() {
        if let Some(runtime) = probe_ffmpeg_runtime(&candidate, source) {
            if let Ok(mut cache) = ffmpeg_runtime_cache().lock() {
                *cache = Some(runtime.clone());
            }
            return Some(runtime);
        }
    }
    None
}

pub(super) fn get_ffmpeg_path() -> Result<std::path::PathBuf, String> {
    resolve_ffmpeg_runtime()
        .map(|runtime| runtime.path)
        .ok_or_else(|| {
            "ffmpeg not installed. Open Settings > FFmpeg Runtime to download it.".to_string()
        })
}

#[tauri::command]
pub(super) fn check_ffmpeg() -> bool {
    get_ffmpeg_path()
        .map(|path| path.is_file())
        .unwrap_or(false)
}

#[derive(Clone, serde::Serialize)]
pub(super) struct FfmpegRuntimeStatus {
    installed: bool,
    path: Option<String>,
    bytes: u64,
    source: Option<String>,
    version: Option<String>,
}
#[derive(Clone, serde::Serialize)]
pub(super) struct FfmpegDownloadProgress {
    downloaded_bytes: u64,
    total_bytes: u64,
    phase: String,
}
pub(super) struct FfmpegDownloadGuard;
impl Drop for FfmpegDownloadGuard {
    fn drop(&mut self) {
        IS_FFMPEG_DOWNLOADING.store(false, Ordering::SeqCst);
    }
}
pub(super) fn begin_ffmpeg_download() -> Result<FfmpegDownloadGuard, String> {
    IS_FFMPEG_DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "An FFmpeg download is already in progress".to_string())?;
    CANCEL_FFMPEG_DOWNLOAD.store(false, Ordering::SeqCst);
    Ok(FfmpegDownloadGuard)
}

#[tauri::command]
pub(super) fn get_ffmpeg_runtime_status() -> Result<FfmpegRuntimeStatus, String> {
    let runtime = resolve_ffmpeg_runtime();
    let path = runtime.as_ref().map(|runtime| runtime.path.as_path());
    Ok(FfmpegRuntimeStatus {
        installed: runtime.is_some(),
        path: path.map(cleanup_display_path),
        bytes: path
            .and_then(|path| std::fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        source: runtime.as_ref().map(|runtime| runtime.source.clone()),
        version: runtime.and_then(|runtime| runtime.version),
    })
}

pub(super) fn ffmpeg_download_candidates(source: &str) -> Result<Vec<(&'static str, &'static str)>, String> {
    let china = [
        ("china", FFMPEG_CHINA_URL),
        ("china-fallback", FFMPEG_CHINA_FALLBACK_URL),
    ];
    let official = [("official", FFMPEG_OFFICIAL_URL)];
    Ok(match source {
        "auto" | "auto-china" => china.into_iter().chain(official).collect(),
        "auto-official" => official.into_iter().chain(china).collect(),
        "china" => china.into_iter().collect(),
        "official" => official.into_iter().collect(),
        _ => return Err("Unknown FFmpeg download source".to_string()),
    })
}

pub(super) fn extract_ffmpeg_executable(
    archive: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::{Read, Write};
    let file = std::fs::File::open(archive)
        .map_err(|error| format!("Cannot open FFmpeg archive: {}", error))?;
    let mut entry = GzDecoder::new(file);
    let temporary = destination.with_extension("exe.part");
    let mut output = std::fs::File::create(&temporary)
        .map_err(|error| format!("Cannot create FFmpeg runtime: {}", error))?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut extracted = 0_u64;
    loop {
        let count = entry
            .read(&mut buffer)
            .map_err(|error| format!("Cannot extract FFmpeg: {}", error))?;
        if count == 0 {
            break;
        }
        extracted = extracted.saturating_add(count as u64);
        if extracted > 250 * 1024 * 1024 {
            drop(output);
            let _ = std::fs::remove_file(&temporary);
            return Err("FFmpeg executable in archive is invalid".to_string());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| format!("Cannot write FFmpeg runtime: {}", error))?;
    }
    if extracted < 1024 * 1024 {
        drop(output);
        let _ = std::fs::remove_file(&temporary);
        return Err("FFmpeg executable in archive is invalid".to_string());
    }
    output
        .sync_all()
        .map_err(|error| format!("Cannot finalize FFmpeg runtime: {}", error))?;
    drop(output);
    if destination.exists() {
        let _ = std::fs::remove_file(destination);
    }
    std::fs::rename(&temporary, destination)
        .map_err(|error| format!("Cannot install FFmpeg runtime: {}", error))
}

#[tauri::command]
pub(super) async fn download_ffmpeg_runtime(
    app_handle: tauri::AppHandle,
    source: Option<String>,
) -> Result<FfmpegRuntimeStatus, String> {
    use std::io::Write;
    let _guard = begin_ffmpeg_download()?;
    let directory = ffmpeg_runtime_dir()?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create FFmpeg runtime directory: {}", error))?;
    let archive = directory.join("ffmpeg-download.gz.part");
    let _ = std::fs::remove_file(directory.join("ffmpeg-download.zip.part"));
    let requested = source
        .as_deref()
        .unwrap_or("auto")
        .trim()
        .to_ascii_lowercase();
    let candidates = ffmpeg_download_candidates(&requested)?;
    let client = reqwest::Client::builder()
        .user_agent("ToolKnit/3.1.0 ffmpeg-runtime-manager")
        .connect_timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Cannot initialize FFmpeg download: {}", error))?;
    let mut last_error = None;
    for (candidate, url) in candidates {
        if CANCEL_FFMPEG_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        let mut resume_from = std::fs::metadata(&archive)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if resume_from > FFMPEG_ARCHIVE_BYTES {
            let _ = std::fs::remove_file(&archive);
            resume_from = 0;
        }
        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={}-", resume_from));
        }
        let mut response = match request.send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                last_error = Some(format!("{}: HTTP {}", candidate, response.status()));
                continue;
            }
            Err(error) => {
                last_error = Some(format!("{}: {}", candidate, error));
                continue;
            }
        };
        let append = resume_from > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !append && resume_from > 0 {
            resume_from = 0;
        }
        let mut downloaded = if append { resume_from } else { 0 };
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&archive)
            .map_err(|error| format!("Cannot create FFmpeg download: {}", error))?;
        let _ = app_handle.emit(
            "ffmpeg-runtime-download-progress",
            FfmpegDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: FFMPEG_ARCHIVE_BYTES,
                phase: "downloading".to_string(),
            },
        );
        let mut failed = None;
        loop {
            if CANCEL_FFMPEG_DOWNLOAD.load(Ordering::SeqCst) {
                let _ = file.sync_all();
                return Err("dependency-download:cancelled".to_string());
            }
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    downloaded = downloaded.saturating_add(chunk.len() as u64);
                    if downloaded > FFMPEG_ARCHIVE_BYTES {
                        failed =
                            Some("FFmpeg package is larger than the expected size".to_string());
                        break;
                    }
                    if let Err(error) = file.write_all(&chunk) {
                        failed = Some(format!("Cannot write FFmpeg download: {}", error));
                        break;
                    }
                    let _ = app_handle.emit(
                        "ffmpeg-runtime-download-progress",
                        FfmpegDownloadProgress {
                            downloaded_bytes: downloaded,
                            total_bytes: FFMPEG_ARCHIVE_BYTES,
                            phase: "downloading".to_string(),
                        },
                    );
                }
                Ok(None) => break,
                Err(error) => {
                    failed = Some(format!("FFmpeg download interrupted: {}", error));
                    break;
                }
            }
        }
        let _ = file.sync_all();
        drop(file);
        if let Some(error) = failed {
            last_error = Some(error);
            continue;
        }
        if downloaded != FFMPEG_ARCHIVE_BYTES {
            last_error = Some(format!(
                "Downloaded FFmpeg package is incomplete ({}/{})",
                downloaded, FFMPEG_ARCHIVE_BYTES
            ));
            continue;
        }
        let archive_for_hash = archive.clone();
        let actual_hash = tokio::task::spawn_blocking(move || sha256_file(&archive_for_hash))
            .await
            .map_err(|error| format!("Cannot verify FFmpeg package: {}", error))??;
        if actual_hash != FFMPEG_ARCHIVE_SHA256 {
            let _ = std::fs::remove_file(&archive);
            last_error = Some("FFmpeg package integrity check failed".to_string());
            continue;
        }
        let _ = app_handle.emit(
            "ffmpeg-runtime-download-progress",
            FfmpegDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: FFMPEG_ARCHIVE_BYTES,
                phase: "installing".to_string(),
            },
        );
        let archive_for_extract = archive.clone();
        let executable = ffmpeg_runtime_path()?;
        let extraction = tokio::task::spawn_blocking(move || {
            extract_ffmpeg_executable(&archive_for_extract, &executable)
        })
        .await
        .map_err(|error| format!("Cannot install FFmpeg runtime: {}", error))?;
        if let Err(error) = extraction {
            last_error = Some(error);
            let _ = std::fs::remove_file(&archive);
            continue;
        }
        let _ = std::fs::remove_file(&archive);
        let executable = ffmpeg_runtime_path()?;
        let valid = tokio::task::spawn_blocking(move || {
            std::process::Command::new(&executable)
                .arg("-version")
                .output()
                .map(|result| result.status.success())
                .unwrap_or(false)
        })
        .await
        .map_err(|error| format!("Cannot validate FFmpeg runtime: {}", error))?;
        if !valid {
            let _ = std::fs::remove_file(ffmpeg_runtime_path()?);
            return Err(
                "FFmpeg executable validation failed; the downloaded runtime was removed"
                    .to_string(),
            );
        }
        let _ = app_handle.emit(
            "ffmpeg-runtime-download-progress",
            FfmpegDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: FFMPEG_ARCHIVE_BYTES,
                phase: "complete".to_string(),
            },
        );
        invalidate_ffmpeg_runtime_cache();
        return get_ffmpeg_runtime_status();
    }
    Err(format!(
        "Cannot download FFmpeg: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

#[tauri::command]
pub(super) fn delete_ffmpeg_runtime() -> Result<(), String> {
    let directory = ffmpeg_runtime_dir()?;
    if directory.exists() {
        std::fs::remove_dir_all(directory)
            .map_err(|error| format!("Cannot delete FFmpeg runtime: {}", error))?;
    }
    Ok(())
}

// ===== Managed LibreOffice runtime for PPT rendering =====
//
// LibreOffice remains an optional component. The desktop installer stays small;
// users download and extract it to ToolKnit's private AppData location only when
// PPT to PDF/image rendering is needed.
pub(super) const LIBREOFFICE_RUNTIME_DIRECTORY: &str = "libreoffice";
pub(super) const LIBREOFFICE_RUNTIME_VERSION: &str = "26.2.5";
pub(super) const LIBREOFFICE_ARCHIVE_BYTES: u64 = 372_948_992;
pub(super) const LIBREOFFICE_ARCHIVE_SHA256: &str =
    "f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9";
pub(super) const LIBREOFFICE_OFFICIAL_URL: &str =
    "https://download.documentfoundation.org/libreoffice/stable/26.2.5/win/x86_64/LibreOffice_26.2.5_Win_x86-64.msi";
pub(super) const LIBREOFFICE_CHINA_URL: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/26.2.5/win/x86_64/LibreOffice_26.2.5_Win_x86-64.msi";

pub(super) fn libreoffice_runtime_dir() -> Result<std::path::PathBuf, String> {
    Ok(toolknit_app_data_dir()?
        .join(LIBREOFFICE_RUNTIME_DIRECTORY)
        .join(LIBREOFFICE_RUNTIME_VERSION))
}

pub(super) fn libreoffice_runtime_path() -> Result<std::path::PathBuf, String> {
    Ok(libreoffice_runtime_dir()?
        .join("program")
        .join(if cfg!(target_os = "windows") {
            "soffice.com"
        } else {
            "soffice"
        }))
}

#[derive(Clone, serde::Serialize)]
pub(super) struct LibreOfficeRuntimeStatus {
    installed: bool,
    path: Option<String>,
    bytes: u64,
    source: Option<String>,
    version: Option<String>,
}

#[derive(Default)]
pub(super) struct LibreOfficeRuntimeCache {
    /// The last runtime path that was resolved successfully. Keeping this in
    /// memory avoids launching soffice --version for every PPT conversion.
    runtime: Option<LibreOfficeRuntimeInfo>,
    /// Directory size is only presentation metadata. It is populated by a
    /// background scan so opening a PPT tool never waits on thousands of files.
    bytes: Option<u64>,
    size_scan_in_progress: bool,
    size_scan_generation: u64,
}

pub(super) static LIBREOFFICE_RUNTIME_CACHE: std::sync::OnceLock<
    std::sync::Mutex<LibreOfficeRuntimeCache>,
> = std::sync::OnceLock::new();
pub(super) static LIBREOFFICE_CACHE_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) fn libreoffice_runtime_cache() -> &'static std::sync::Mutex<LibreOfficeRuntimeCache> {
    LIBREOFFICE_RUNTIME_CACHE.get_or_init(|| std::sync::Mutex::new(LibreOfficeRuntimeCache::default()))
}

pub(super) fn invalidate_libreoffice_runtime_cache() {
    LIBREOFFICE_CACHE_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut cache) = libreoffice_runtime_cache().lock() {
        *cache = LibreOfficeRuntimeCache::default();
    }
}

pub(super) fn cache_libreoffice_runtime(runtime: LibreOfficeRuntimeInfo) {
    if let Ok(mut cache) = libreoffice_runtime_cache().lock() {
        cache.runtime = Some(runtime);
    }
}

pub(super) fn cached_libreoffice_runtime() -> Option<LibreOfficeRuntimeInfo> {
    libreoffice_runtime_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.runtime.clone())
}

#[derive(Clone, serde::Serialize)]
pub(super) struct LibreOfficeDownloadProgress {
    downloaded_bytes: u64,
    total_bytes: u64,
    phase: String,
}

#[derive(Clone, serde::Serialize)]
struct LibreOfficeInstallProgress {
    #[serde(flatten)]
    download: LibreOfficeDownloadProgress,
    extraction: libreoffice_extract::ExtractionProgress,
}

pub(super) struct LibreOfficeDownloadGuard;

impl Drop for LibreOfficeDownloadGuard {
    fn drop(&mut self) {
        IS_LIBREOFFICE_DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

pub(super) fn begin_libreoffice_download() -> Result<LibreOfficeDownloadGuard, String> {
    IS_LIBREOFFICE_DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A PPT runtime download is already in progress".to_string())?;
    CANCEL_LIBREOFFICE_DOWNLOAD.store(false, Ordering::SeqCst);
    Ok(LibreOfficeDownloadGuard)
}

pub(super) fn directory_size_bytes(path: &std::path::Path) -> u64 {
    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.metadata() {
                Ok(metadata) if metadata.is_file() => total = total.saturating_add(metadata.len()),
                Ok(metadata) if metadata.is_dir() => stack.push(path),
                _ => {}
            }
        }
    }
    total
}

pub(super) fn cached_or_schedule_libreoffice_size(root: &std::path::Path) -> u64 {
    let (cached, should_scan, generation) = match libreoffice_runtime_cache().lock() {
        Ok(mut cache) => {
            if let Some(bytes) = cache.bytes {
                (bytes, false, 0)
            } else if cache.size_scan_in_progress {
                (0, false, 0)
            } else {
                cache.size_scan_in_progress = true;
                let generation = LIBREOFFICE_CACHE_GENERATION.load(Ordering::SeqCst);
                cache.size_scan_generation = generation;
                (0, true, generation)
            }
        }
        Err(_) => (0, false, 0),
    };
    if !should_scan {
        return cached;
    }

    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let bytes = directory_size_bytes(&root);
        // A delete/reinstall may have happened while the scan was running;
        // never publish an old size into the new runtime status.
        if generation != LIBREOFFICE_CACHE_GENERATION.load(Ordering::SeqCst) {
            return;
        }
        if let Ok(mut cache) = libreoffice_runtime_cache().lock() {
            if cache.size_scan_generation == generation {
                cache.bytes = Some(bytes);
                cache.size_scan_in_progress = false;
            }
        }
    });
    0
}

/// Resolve an installed executable without starting LibreOffice. This is the
/// hot-path check used while opening the two PPT tools. A successful metadata
/// check is sufficient because conversion performs the real process launch
/// and reports a renderer error if a custom path is invalid.
pub(super) fn resolve_libreoffice_runtime_quick() -> Option<LibreOfficeRuntimeInfo> {
    for (candidate, source) in libreoffice_candidates() {
        let metadata = match std::fs::metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.is_file() {
            continue;
        }
        if source == "managed" && libreoffice_install::ensure_app_local_libraries(
            candidate.parent()?.parent()?
        ).is_err() {
            continue;
        }
        return Some(LibreOfficeRuntimeInfo {
            available: true,
            command: Some(candidate.to_string_lossy().into_owned()),
            source: Some(source.to_string()),
            version: cached_libreoffice_runtime().and_then(|runtime| runtime.version),
            message: None,
        });
    }
    None
}

#[tauri::command]
pub(super) fn is_libreoffice_runtime_available() -> bool {
    if let Some(runtime) = cached_libreoffice_runtime() {
        if runtime
            .command
            .as_deref()
            .map(std::path::Path::new)
            .is_some_and(|path| std::fs::metadata(path).map(|meta| meta.is_file()).unwrap_or(false))
        {
            return true;
        }
    }
    if let Some(runtime) = resolve_libreoffice_runtime_quick() {
        cache_libreoffice_runtime(runtime);
        return true;
    }
    false
}

#[tauri::command]
pub(super) fn get_libreoffice_runtime_status() -> Result<LibreOfficeRuntimeStatus, String> {
    // Status is also called from the settings page. Keep it responsive even
    // when the managed runtime contains tens of thousands of extracted files.
    // Detailed size metadata is filled asynchronously and appears on the next
    // refresh/open of the manager.
    let runtime = resolve_libreoffice_runtime_quick()
        .or_else(cached_libreoffice_runtime)
        .unwrap_or(LibreOfficeRuntimeInfo {
            available: false,
            command: None,
            source: None,
            version: None,
            message: None,
        });
    if runtime.available {
        cache_libreoffice_runtime(runtime.clone());
    }
    let bytes = if runtime.source.as_deref() == Some("managed") {
        cached_or_schedule_libreoffice_size(&libreoffice_runtime_dir()?)
    } else {
        0
    };
    Ok(LibreOfficeRuntimeStatus {
        installed: runtime.available,
        path: runtime.command,
        bytes,
        source: runtime.source,
        version: runtime.version,
    })
}

pub(super) fn libreoffice_download_candidates(
    source: &str,
) -> Result<Vec<(&'static str, &'static str)>, String> {
    let china = [("china", LIBREOFFICE_CHINA_URL)];
    let official = [("official", LIBREOFFICE_OFFICIAL_URL)];
    Ok(match source {
        "auto" | "auto-china" => china.into_iter().chain(official).collect(),
        "auto-official" => official.into_iter().chain(china).collect(),
        "china" => china.into_iter().collect(),
        "official" => official.into_iter().collect(),
        _ => return Err("Unknown PPT runtime download source".to_string()),
    })
}

#[cfg(target_os = "windows")]
fn extract_libreoffice_msi(
    archive: &std::path::Path,
    destination: &std::path::Path,
    report: impl FnMut(&str, libreoffice_extract::ExtractionProgress),
) -> Result<(), String> {
    libreoffice_install::extract_and_validate(archive, destination, report)
}

#[cfg(not(target_os = "windows"))]
fn extract_libreoffice_msi(
    _: &std::path::Path,
    _: &std::path::Path,
    _: impl FnMut(&str, libreoffice_extract::ExtractionProgress),
) -> Result<(), String> {
    Err("Managed LibreOffice download is currently available on Windows only".to_string())
}

#[tauri::command]
pub(super) async fn download_libreoffice_runtime(
    app_handle: tauri::AppHandle,
    source: Option<String>,
) -> Result<LibreOfficeRuntimeStatus, String> {
    use std::io::Write;
    let _guard = begin_libreoffice_download()?;
    invalidate_libreoffice_runtime_cache();
    let destination = libreoffice_runtime_dir()?;
    let parent = destination
        .parent()
        .ok_or("Invalid PPT runtime directory")?
        .to_path_buf();
    std::fs::create_dir_all(&parent)
        .map_err(|error| format!("Cannot create PPT runtime directory: {}", error))?;
    let archive = parent.join(format!(
        "LibreOffice_{}_Win_x86-64.msi.part",
        LIBREOFFICE_RUNTIME_VERSION
    ));
    let requested = source
        .as_deref()
        .unwrap_or("auto")
        .trim()
        .to_ascii_lowercase();
    let candidates = libreoffice_download_candidates(&requested)?;
    let client = reqwest::Client::builder()
        .user_agent("ToolKnit/3.1.0 libreoffice-runtime-manager")
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Cannot initialize PPT runtime download: {}", error))?;
    let mut last_error = None;
    for (candidate, url) in candidates {
        if CANCEL_LIBREOFFICE_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        let mut resume_from = std::fs::metadata(&archive)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if resume_from > LIBREOFFICE_ARCHIVE_BYTES {
            let _ = std::fs::remove_file(&archive);
            resume_from = 0;
        }
        let mut downloaded = resume_from;
        // A verified-length archive may be left by a failed startup check.
        // Recheck its hash below instead of requesting an invalid EOF range.
        if resume_from < LIBREOFFICE_ARCHIVE_BYTES {
            let mut request = client.get(url);
            if resume_from > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={}-", resume_from));
            }
            let mut response = match request.send().await {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    last_error = Some(format!("{}: HTTP {}", candidate, response.status()));
                    continue;
                }
                Err(error) => {
                    last_error = Some(format!("{}: {}", candidate, error));
                    continue;
                }
            };
            let append = resume_from > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
            if !append && resume_from > 0 {
                resume_from = 0;
            }
            downloaded = if append { resume_from } else { 0 };
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(append)
                .truncate(!append)
                .open(&archive)
                .map_err(|error| format!("Cannot create PPT runtime download: {}", error))?;
            let _ = app_handle.emit(
                "libreoffice-runtime-download-progress",
                LibreOfficeDownloadProgress {
                    downloaded_bytes: downloaded,
                    total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                    phase: "downloading".to_string(),
                },
            );
            let mut failed = None;
            loop {
                if CANCEL_LIBREOFFICE_DOWNLOAD.load(Ordering::SeqCst) {
                    let _ = file.sync_all();
                    return Err("dependency-download:cancelled".to_string());
                }
                match response.chunk().await {
                    Ok(Some(chunk)) => {
                        downloaded = downloaded.saturating_add(chunk.len() as u64);
                        if downloaded > LIBREOFFICE_ARCHIVE_BYTES {
                            failed = Some("PPT runtime package is larger than expected".to_string());
                            break;
                        }
                        if let Err(error) = file.write_all(&chunk) {
                            failed = Some(format!("Cannot write PPT runtime download: {}", error));
                            break;
                        }
                        let _ = app_handle.emit(
                            "libreoffice-runtime-download-progress",
                            LibreOfficeDownloadProgress {
                                downloaded_bytes: downloaded,
                                total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                                phase: "downloading".to_string(),
                            },
                        );
                    }
                    Ok(None) => break,
                    Err(error) => {
                        failed = Some(format!("PPT runtime download interrupted: {}", error));
                        break;
                    }
                }
            }
            let _ = file.sync_all();
            drop(file);
            if let Some(error) = failed {
                last_error = Some(error);
                continue;
            }
        }
        if downloaded != LIBREOFFICE_ARCHIVE_BYTES {
            last_error = Some(format!(
                "Downloaded PPT runtime is incomplete ({}/{})",
                downloaded, LIBREOFFICE_ARCHIVE_BYTES
            ));
            continue;
        }
        let _ = app_handle.emit(
            "libreoffice-runtime-download-progress",
            LibreOfficeDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                phase: "verifying".to_string(),
            },
        );
        let archive_for_hash = archive.clone();
        let actual_hash = tokio::task::spawn_blocking(move || sha256_file(&archive_for_hash))
            .await
            .map_err(|error| format!("Cannot verify PPT runtime: {}", error))??;
        if actual_hash != LIBREOFFICE_ARCHIVE_SHA256 {
            let _ = std::fs::remove_file(&archive);
            last_error = Some("PPT runtime integrity check failed".to_string());
            continue;
        }
        if CANCEL_LIBREOFFICE_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("dependency-download:cancelled".to_string());
        }
        let _ = app_handle.emit(
            "libreoffice-runtime-download-progress",
            LibreOfficeDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                phase: "installing".to_string(),
            },
        );
        let archive_for_extract = archive.clone();
        let destination_for_extract = destination.clone();
        let extraction_app = app_handle.clone();
        let extraction = tokio::task::spawn_blocking(move || {
            extract_libreoffice_msi(
                &archive_for_extract,
                &destination_for_extract,
                |phase, progress| {
                    let _ = extraction_app.emit(
                        "libreoffice-runtime-download-progress",
                        LibreOfficeInstallProgress {
                            download: LibreOfficeDownloadProgress {
                                downloaded_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                                total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                                phase: phase.to_string(),
                            },
                            extraction: progress,
                        },
                    );
                },
            )
        })
        .await
        .map_err(|error| format!("Cannot install PPT runtime: {}", error))?;
        // Extraction includes app-local CRT deployment and startup validation.
        // Keep the verified archive on failure so retry does not download again.
        extraction?;
        let _ = std::fs::remove_file(&archive);
        let _ = app_handle.emit(
            "libreoffice-runtime-download-progress",
            LibreOfficeDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: LIBREOFFICE_ARCHIVE_BYTES,
                phase: "complete".to_string(),
            },
        );
        // Do not perform a recursive directory-size scan on the download
        // completion path. The manager can refresh the cached size later while
        // the newly installed runtime is immediately usable.
        return get_libreoffice_runtime_status();
    }
    Err(format!(
        "Cannot download PPT runtime: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

#[tauri::command]
pub(super) fn delete_libreoffice_runtime() -> Result<(), String> {
    let directory = libreoffice_runtime_dir()?;
    if directory.exists() {
        std::fs::remove_dir_all(&directory)
            .map_err(|error| format!("Cannot delete PPT runtime: {}", error))?;
    }
    invalidate_libreoffice_runtime_cache();
    Ok(())
}

#[tauri::command]
pub(super) fn cancel_dependency_downloads() {
    CANCEL_FFMPEG_DOWNLOAD.store(true, Ordering::SeqCst);
    CANCEL_MODEL_DOWNLOAD.store(true, Ordering::SeqCst);
    CANCEL_LIBREOFFICE_DOWNLOAD.store(true, Ordering::SeqCst);
}

