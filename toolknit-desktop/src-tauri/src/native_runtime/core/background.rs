pub(crate) fn custom_background_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("custom-background"))
        .map_err(|error| format!("Cannot find application data folder: {}", error))
}

pub(crate) fn custom_background_media_type(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => Some("image"),
        "mp4" | "webm" | "ogv" | "ogg" | "mov" => Some("video"),
        _ => None,
    }
}

#[tauri::command]
pub(crate) async fn import_custom_background(
    app: tauri::AppHandle,
    source_path: String,
    job_id: Option<String>,
) -> Result<CustomBackgroundAsset, String> {
    tokio::task::spawn_blocking(move || {
        import_custom_background_blocking(&app, source_path, job_id)
    })
    .await
    .map_err(|error| format!("Background import worker failed: {}", error))?
}

pub(crate) fn import_custom_background_blocking(
    app: &tauri::AppHandle,
    source_path: String,
    job_id: Option<String>,
) -> Result<CustomBackgroundAsset, String> {
    let job_id = normalize_custom_background_job_id(job_id);
    let import_lock = CUSTOM_BACKGROUND_IMPORT_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if source_path.contains('\0') {
        return Err("Invalid background file".to_string());
    }
    let source = std::path::PathBuf::from(source_path)
        .canonicalize()
        .map_err(|error| format!("Cannot access background file: {}", error))?;
    let metadata = std::fs::metadata(&source)
        .map_err(|error| format!("Cannot read background file: {}", error))?;
    if !metadata.is_file() {
        return Err("Background must be a file".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .ok_or("Unsupported background file")?
        .to_ascii_lowercase();
    let media_type =
        custom_background_media_type(&extension).ok_or("Unsupported background format")?;
    let max_background_mb = if media_type == "video" { 500_u64 } else { 250_u64 };
    let max_background_bytes = max_background_mb * 1024 * 1024;
    if metadata.len() > max_background_bytes {
        return Err(format!(
            "Background {media_type} must be no larger than {max_background_mb}MB"
        ));
    }

    emit_custom_background_import_progress(
        app,
        &job_id,
        "prepare",
        0.0,
        media_type,
        None,
        Some(metadata.len()),
    );

    let target_dir = custom_background_dir(app)?;
    std::fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Cannot prepare background folder: {}", error))?;
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let target = target_dir.join(format!(
        "background-{}.{}",
        unique_id,
        if media_type == "video" {
            "mp4"
        } else {
            extension.as_str()
        }
    ));
    let temporary = custom_background_temporary_path(&target)?;

    let import_result = if media_type == "video" {
        let ffmpeg = get_ffmpeg_path()?;
        if !ffmpeg.is_file() {
            return Err(
                "Background video conversion requires the bundled FFmpeg engine".to_string(),
            );
        }
        convert_custom_background_video(app, &job_id, &ffmpeg, &source, &temporary, media_type)
    } else {
        copy_custom_background_image(
            app,
            &job_id,
            &source,
            &temporary,
            metadata.len(),
            media_type,
        )
    };

    if let Err(error) = import_result {
        let _ = std::fs::remove_file(&temporary);
        emit_custom_background_import_progress(
            app,
            &job_id,
            "error",
            1.0,
            media_type,
            None,
            Some(metadata.len()),
        );
        return Err(error);
    }

    emit_custom_background_import_progress(
        app,
        &job_id,
        "verify",
        0.98,
        media_type,
        None,
        Some(metadata.len()),
    );
    let target_metadata = std::fs::metadata(&temporary)
        .map_err(|error| format!("Cannot read imported background: {}", error))?;
    if !target_metadata.is_file()
        || target_metadata.len() == 0
        || target_metadata.len() > max_background_bytes
    {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!(
            "Imported background {media_type} must be a non-empty file no larger than {max_background_mb}MB"
        ));
    }

    if let Err(error) = std::fs::rename(&temporary, &target) {
        let _ = std::fs::remove_file(&temporary);
        emit_custom_background_import_progress(
            app,
            &job_id,
            "error",
            1.0,
            media_type,
            None,
            Some(metadata.len()),
        );
        return Err(format!("Cannot publish imported background: {}", error));
    }

    // The new file is now durable and addressable. Only after publishing it do
    // we remove previous completed backgrounds, so a failed import never
    // destroys the currently active setting.
    if let Ok(entries) = std::fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path != target && path.is_file() && is_completed_custom_background_file(&path) {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    emit_custom_background_import_progress(
        app,
        &job_id,
        "complete",
        1.0,
        media_type,
        Some(target_metadata.len()),
        Some(target_metadata.len()),
    );
    drop(import_lock);

    Ok(CustomBackgroundAsset {
        path: target.to_string_lossy().into_owned(),
        media_type: media_type.to_string(),
    })
}

pub(crate) fn normalize_custom_background_job_id(job_id: Option<String>) -> String {
    let value = job_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("desktop");
    value.chars().take(128).collect()
}

pub(crate) fn emit_custom_background_import_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    phase: &str,
    percent: f64,
    media_type: &str,
    bytes_copied: Option<u64>,
    total_bytes: Option<u64>,
) {
    let _ = app.emit(
        "custom-background-import-progress",
        serde_json::json!({
            "jobId": job_id,
            "phase": phase,
            "percent": percent.clamp(0.0, 1.0),
            "mediaType": media_type,
            "bytesCopied": bytes_copied,
            "totalBytes": total_bytes,
        }),
    );
}

pub(crate) fn custom_background_temporary_path(
    target: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let parent = target
        .parent()
        .ok_or("Cannot prepare temporary background path")?;
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Cannot prepare temporary background path")?;
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .ok_or("Cannot prepare temporary background path")?;
    Ok(parent.join(format!("{stem}.part.{extension}")))
}

pub(crate) fn is_completed_custom_background_file(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with("background-") && !name.contains(".part."))
        .unwrap_or(false)
}

pub(crate) fn copy_custom_background_image(
    app: &tauri::AppHandle,
    job_id: &str,
    source: &std::path::Path,
    temporary: &std::path::Path,
    total_bytes: u64,
    media_type: &str,
) -> Result<(), String> {
    use std::io::{Read, Write};

    let input = std::fs::File::open(source)
        .map_err(|error| format!("Cannot read background file: {}", error))?;
    let output = std::fs::File::create(temporary)
        .map_err(|error| format!("Cannot prepare background file: {}", error))?;
    let mut reader = std::io::BufReader::with_capacity(512 * 1024, input);
    let mut writer = std::io::BufWriter::with_capacity(512 * 1024, output);
    let mut buffer = vec![0_u8; 512 * 1024];
    let mut copied = 0_u64;
    let mut last_reported = 0_u64;
    let mut last_report_at = std::time::Instant::now();

    emit_custom_background_import_progress(
        app,
        job_id,
        "copying",
        0.0,
        media_type,
        Some(0),
        Some(total_bytes),
    );
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read background file: {}", error))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot import background file: {}", error))?;
        copied = copied.saturating_add(read as u64);
        let should_report = copied >= total_bytes
            || copied.saturating_sub(last_reported) >= 1_048_576
            || last_report_at.elapsed() >= std::time::Duration::from_millis(100);
        if should_report {
            let percent = if total_bytes == 0 {
                0.0
            } else {
                ((copied as f64 / total_bytes as f64) * 0.96).clamp(0.0, 0.96)
            };
            emit_custom_background_import_progress(
                app,
                job_id,
                "copying",
                percent,
                media_type,
                Some(copied),
                Some(total_bytes),
            );
            last_reported = copied;
            last_report_at = std::time::Instant::now();
        }
    }
    writer
        .flush()
        .map_err(|error| format!("Cannot finish importing background: {}", error))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|error| format!("Cannot finish importing background: {}", error))?;
    Ok(())
}

pub(crate) fn probe_custom_background_video_duration(
    ffmpeg: &std::path::Path,
    source: &std::path::Path,
) -> Option<f64> {
    let mut command = std::process::Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(source)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    parse_ffmpeg_duration(&String::from_utf8_lossy(&output.stderr))
}

pub(crate) fn convert_custom_background_video(
    app: &tauri::AppHandle,
    job_id: &str,
    ffmpeg: &std::path::Path,
    source: &std::path::Path,
    temporary: &std::path::Path,
    media_type: &str,
) -> Result<(), String> {
    use std::io::{BufRead, Read};

    emit_custom_background_import_progress(app, job_id, "probing", 0.01, media_type, None, None);
    let duration = probe_custom_background_video_duration(ffmpeg, source);
    emit_custom_background_import_progress(
        app,
        job_id,
        "converting",
        0.02,
        media_type,
        None,
        None,
    );

    let mut command = std::process::Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"])
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(temporary)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start background video conversion: {}", error))?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        "Cannot read background video conversion progress".to_string()
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        "Cannot read background video conversion errors".to_string()
    })?;
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut reader = std::io::BufReader::new(stderr);
        let _ = reader.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let mut last_percent = 0.02_f64;
    let progress_result = (|| -> Result<(), String> {
        for line in std::io::BufReader::new(stdout).lines() {
            let line = line.map_err(|error| {
                format!(
                    "Cannot read background video conversion progress: {}",
                    error
                )
            })?;
            let Some(seconds) = parse_ffmpeg_progress_seconds(&line) else {
                continue;
            };
            let Some(duration) = duration.filter(|value| *value > 0.0) else {
                continue;
            };
            let percent = (0.02 + (seconds / duration).clamp(0.0, 0.96) * 0.94).clamp(0.02, 0.96);
            if percent - last_percent < 0.003 && percent < 0.96 {
                continue;
            }
            last_percent = percent;
            emit_custom_background_import_progress(
                app,
                job_id,
                "converting",
                percent,
                media_type,
                None,
                None,
            );
        }
        Ok(())
    })();
    if progress_result.is_err() {
        let _ = child.kill();
    }
    let status_result = child.wait();
    let stderr = stderr_reader.join().unwrap_or_default();
    progress_result?;
    let status = status_result
        .map_err(|error| format!("Cannot finish background video conversion: {}", error))?;
    if !status.success() {
        let details = compact_video_convert_error(&stderr);
        return Err(format!(
            "Cannot convert background video to H.264: {}",
            details
        ));
    }
    log::info!("Custom background video conversion completed");
    Ok(())
}

#[tauri::command]
pub(crate) fn log_custom_background_event(event: String) {
    // Keep release logs useful without persisting user file names or paths.
    let category = event
        .split(':')
        .next()
        .filter(|value| matches!(*value, "resolve-failed" | "media-error"))
        .unwrap_or("unknown");
    log::info!("Custom background event: {}", category);
}

pub(crate) fn custom_background_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("mp4") => "video/mp4",
        Some(extension) if extension.eq_ignore_ascii_case("webm") => "video/webm",
        Some(extension) if extension.eq_ignore_ascii_case("png") => "image/png",
        Some(extension) if extension.eq_ignore_ascii_case("webp") => "image/webp",
        Some(extension) if extension.eq_ignore_ascii_case("gif") => "image/gif",
        Some(extension) if extension.eq_ignore_ascii_case("bmp") => "image/bmp",
        _ => "image/jpeg",
    }
}

pub(crate) fn write_background_http_error(
    stream: &mut std::net::TcpStream,
    status: &str,
) -> std::io::Result<()> {
    use std::io::Write;
    stream.write_all(
        format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
    )
}

pub(crate) fn parse_background_range(request: &str, file_len: u64) -> Option<(u64, u64)> {
    let range = request
        .lines()
        .find_map(|line| {
            line.strip_prefix("Range:")
                .or_else(|| line.strip_prefix("range:"))
        })?
        .trim()
        .strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    let start = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        file_len.saturating_sub(suffix)
    } else {
        start.parse::<u64>().ok()?
    };
    if start >= file_len {
        return None;
    }
    let end = if end.is_empty() {
        file_len - 1
    } else {
        end.parse::<u64>().ok()?.min(file_len - 1)
    };
    (start <= end).then_some((start, end))
}

pub(crate) fn serve_custom_background_connection(
    mut stream: std::net::TcpStream,
    root: &std::path::Path,
    access_token: &str,
) -> std::io::Result<()> {
    use std::io::{Read, Seek, Write};

    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
    let mut request_bytes = Vec::with_capacity(2048);
    let mut chunk = [0u8; 1024];
    while request_bytes.len() < 16 * 1024 {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            return Ok(());
        }
        request_bytes.extend_from_slice(&chunk[..count]);
        if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request_bytes);
    let mut request_parts = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let url_path = request_parts
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    if !matches!(method, "GET" | "HEAD") {
        return write_background_http_error(&mut stream, "405 Method Not Allowed");
    }
    let protected_path = url_path
        .strip_prefix("/custom-background/")
        .unwrap_or_default();
    let (request_token, filename) = protected_path.split_once('/').unwrap_or_default();
    if request_token != access_token
        || filename.is_empty()
        || filename.contains(['/', '\\'])
        || filename.contains("..")
        || !filename.starts_with("background-")
    {
        return write_background_http_error(&mut stream, "404 Not Found");
    }
    let path = root.join(filename);
    let file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(_) => return write_background_http_error(&mut stream, "404 Not Found"),
    };
    let file_len = file.metadata()?.len();
    if file_len == 0 {
        return write_background_http_error(&mut stream, "404 Not Found");
    }
    let range_header_present = request
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("range:"));
    let range = parse_background_range(&request, file_len);
    if range_header_present && range.is_none() {
        return write_background_http_error(&mut stream, "416 Range Not Satisfiable");
    }
    let (start, end, status) = range
        .map(|(start, end)| (start, end, "206 Partial Content"))
        .unwrap_or((0, file_len - 1, "200 OK"));
    let content_len = end - start + 1;
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {content_len}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n",
        custom_background_content_type(&path)
    );
    if status.starts_with("206") {
        response.push_str(&format!(
            "Content-Range: bytes {start}-{end}/{file_len}\r\n"
        ));
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes())?;
    if method == "HEAD" {
        return Ok(());
    }
    let mut file = file;
    file.seek(std::io::SeekFrom::Start(start))?;
    let mut body = file.take(content_len);
    std::io::copy(&mut body, &mut stream)?;
    Ok(())
}

pub(crate) fn custom_background_server_token() -> Result<&'static str, String> {
    if let Some(token) = CUSTOM_BACKGROUND_SERVER_TOKEN.get() {
        return Ok(token.as_str());
    }
    let mut random = [0_u8; 16];
    getrandom::getrandom(&mut random)
        .map_err(|_| "Cannot secure local background media service".to_string())?;
    let generated = hex::encode(random);
    let _ = CUSTOM_BACKGROUND_SERVER_TOKEN.set(generated);
    CUSTOM_BACKGROUND_SERVER_TOKEN
        .get()
        .map(String::as_str)
        .ok_or_else(|| "Cannot secure local background media service".to_string())
}

pub(crate) fn custom_background_server_port(root: std::path::PathBuf) -> Result<u16, String> {
    if let Some(port) = CUSTOM_BACKGROUND_SERVER_PORT.get() {
        return Ok(*port);
    }
    let init_lock = CUSTOM_BACKGROUND_SERVER_INIT_LOCK.get_or_init(|| std::sync::Mutex::new(()));
    let _init_guard = init_lock
        .lock()
        .map_err(|_| "Cannot start local background media service".to_string())?;
    if let Some(port) = CUSTOM_BACKGROUND_SERVER_PORT.get() {
        return Ok(*port);
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Cannot start local background media service: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Cannot read local background media port: {error}"))?
        .port();
    let access_token = custom_background_server_token()?.to_string();
    std::thread::Builder::new()
        .name("toolknit-background-media".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                if let Err(error) =
                    serve_custom_background_connection(stream, &root, &access_token)
                {
                    log::debug!("Custom background media request failed: {error}");
                }
            }
        })
        .map_err(|error| format!("Cannot run local background media service: {error}"))?;
    let _ = CUSTOM_BACKGROUND_SERVER_PORT.set(port);
    Ok(*CUSTOM_BACKGROUND_SERVER_PORT.get().unwrap_or(&port))
}

#[tauri::command]
pub(crate) fn get_custom_background_media_url(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = custom_background_dir(&app)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Cannot access background folder: {error}"))?;
    let file = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Cannot access imported background: {error}"))?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("Custom background path is not permitted".to_string());
    }
    let filename = file
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.starts_with("background-"))
        .ok_or("Invalid imported background file")?;
    let port = custom_background_server_port(root)?;
    let access_token = custom_background_server_token()?;
    Ok(format!(
        "http://127.0.0.1:{port}/custom-background/{access_token}/{filename}"
    ))
}

#[cfg(test)]
mod custom_background_media_tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn background_temp_path_keeps_the_real_media_extension() {
        let target = std::path::Path::new("C:/temp/background-42.mp4");
        let temporary = custom_background_temporary_path(target).unwrap();
        assert_eq!(
            temporary,
            std::path::PathBuf::from("C:/temp/background-42.part.mp4")
        );
        assert!(is_completed_custom_background_file(target));
        assert!(!is_completed_custom_background_file(&temporary));
    }

    #[test]
    fn background_import_job_id_is_bounded_and_has_a_default() {
        assert_eq!(normalize_custom_background_job_id(None), "desktop");
        assert_eq!(
            normalize_custom_background_job_id(Some("  import-1  ".to_string())),
            "import-1"
        );
        assert_eq!(
            normalize_custom_background_job_id(Some(" ".to_string())),
            "desktop"
        );
        assert_eq!(
            normalize_custom_background_job_id(Some("x".repeat(256)))
                .chars()
                .count(),
            128
        );
    }

    #[test]
    fn serves_custom_background_with_http_range_support() {
        let root =
            std::env::temp_dir().join(format!("toolknit-background-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let background = root.join("background-test.mp4");
        std::fs::write(&background, b"0123456789").unwrap();
        let port = custom_background_server_port(root.clone()).unwrap();
        let mut unauthorized = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        unauthorized
            .write_all(
                b"GET /custom-background/wrong/background-test.mp4 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            )
            .unwrap();
        let mut unauthorized_response = Vec::new();
        unauthorized.read_to_end(&mut unauthorized_response).unwrap();
        assert!(String::from_utf8(unauthorized_response)
            .unwrap()
            .starts_with("HTTP/1.1 404 Not Found"));

        let access_token = custom_background_server_token().unwrap();
        let mut client = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(format!(
                "GET /custom-background/{access_token}/background-test.mp4 HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=2-5\r\n\r\n"
            ).as_bytes())
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).unwrap();
        let response = String::from_utf8(response).unwrap();
        assert!(response.starts_with("HTTP/1.1 206 Partial Content"));
        assert!(response.contains("Content-Type: video/mp4"));
        assert!(response.contains("Content-Range: bytes 2-5/10"));
        assert!(response.ends_with("2345"));
        let _ = std::fs::remove_dir_all(root);
    }
}

#[tauri::command]
pub(crate) fn clear_custom_background(app: tauri::AppHandle) -> Result<(), String> {
    let target_dir = custom_background_dir(&app)?;
    if target_dir.exists() {
        std::fs::remove_dir_all(target_dir)
            .map_err(|error| format!("Cannot clear custom background: {}", error))?;
    }
    Ok(())
}
