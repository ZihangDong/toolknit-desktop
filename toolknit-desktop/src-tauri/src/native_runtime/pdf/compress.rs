pub(crate) fn create_pdf_compress_temp_path(
    output_dir: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "pdf-compress:compression-failed".to_string())?
        .as_nanos();
    for _ in 0..100 {
        let id = PDF_DECRYPT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let candidate = output_dir.join(format!(
            ".toolknit-compress-{}-{}-{}.pdf",
            std::process::id(),
            timestamp,
            id
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("pdf-compress:compression-failed".to_string())
}

pub(crate) fn create_pdf_compress_file_name(input_path: &std::path::Path) -> String {
    let raw_stem = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let sanitized: String = raw_stem
        .chars()
        .map(|character| {
            if matches!(
                character,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = sanitized
        .trim()
        .trim_end_matches(|character| character == '.' || character == ' ');
    let stem = if trimmed.is_empty() {
        "document"
    } else {
        trimmed
    };
    format!("{}_compressed.pdf", stem)
}

pub(crate) fn publish_pdf_compress_output(
    temporary_path: &std::path::Path,
    output_dir: &std::path::Path,
    file_name: &str,
) -> Result<String, String> {
    // Reuse the existing no-overwrite PDF publisher (MoveFileExW on Windows),
    // including volumes that do not support NTFS hard links.
    publish_pdf_enhance_output(temporary_path, output_dir, file_name)
        .map_err(|error| error.replace("pdf-enhance:", "pdf-compress:"))
}

struct CompressTemporary(std::path::PathBuf);
impl Drop for CompressTemporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) fn map_qpdf_compress_error(output: &std::process::Output) -> String {
    let details = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    if details.contains("invalid password") || details.contains("encrypted") {
        "pdf-compress:password-protected".to_string()
    } else if details.contains("not a pdf")
        || details.contains("damaged pdf")
        || details.contains("can't find pdf header")
    {
        "pdf-compress:invalid-pdf".to_string()
    } else {
        "pdf-compress:compression-failed".to_string()
    }
}

fn pdf_compress_cancelled() -> Result<(), String> {
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        Err("pdf-compress:cancelled".to_string())
    } else {
        Ok(())
    }
}

pub(in crate::native_runtime) async fn run_compress_qpdf(
    qpdf_path: &std::path::Path,
    args: &[std::ffi::OsString],
) -> Result<std::process::Output, String> {
    run_conversion_qpdf_with_stdin(qpdf_path, args, None, true).await
}

pub(in crate::native_runtime) async fn run_conversion_qpdf_with_stdin(
    qpdf_path: &std::path::Path,
    args: &[std::ffi::OsString],
    input: Option<&[u8]>,
    capture_stdout: bool,
) -> Result<std::process::Output, String> {
    use tokio::process::Command;
    use tokio::io::AsyncWriteExt;

    pdf_compress_cancelled()?;
    let arguments: Vec<std::ffi::OsString> = args.iter().map(|argument| {
        let path = std::path::Path::new(argument);
        if path.is_absolute() { cleanup_display_path(path).into() } else { argument.clone() }
    }).collect();
    let mut command = Command::new(qpdf_path);
    command
        .args(&arguments)
        .kill_on_drop(true)
        .stdin(if input.is_some() { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stdout(if capture_stdout { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "pdf-compress:compression-failed".to_string())?;
    let child_id = child.id().unwrap_or(0);
    if child_id != 0 {
        CURRENT_CHILD_ID.store(child_id, Ordering::SeqCst);
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            terminate_conversion_process(child_id);
        }
    }
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(QPDF_PROCESS_TIMEOUT_SECS),
        async {
            if let Some(bytes) = input {
                let mut stdin = child.stdin.take().ok_or_else(|| std::io::Error::other("missing stdin"))?;
                stdin.write_all(bytes).await?; stdin.shutdown().await?;
            }
            child.wait_with_output().await
        },
    )
    .await;
    if child_id != 0 {
        let _ = CURRENT_CHILD_ID.compare_exchange(child_id, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("pdf-compress:cancelled".to_string());
    }
    match result {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) => Err("pdf-compress:compression-failed".to_string()),
        Err(_) => Err("pdf-compress:timeout".to_string()),
    }
}

pub(super) fn parse_pdf_compress_page_count(output: &std::process::Output) -> Result<u32, String> {
    if !output.status.success() {
        return Err(map_qpdf_compress_error(output));
    }
    let page_count = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .map_err(|_| "pdf-compress:invalid-pdf".to_string())?;
    if page_count == 0 {
        return Err("pdf-compress:invalid-pdf".to_string());
    }
    Ok(page_count)
}

pub(super) fn compression_target_bytes(
    mb: Option<u32>,
    bytes: Option<u64>,
) -> Result<Option<u64>, String> {
    if mb.is_some_and(|value| !matches!(value, 5 | 10 | 15 | 20 | 50)) {
        return Err("pdf-compress:invalid-target-size".into());
    }
    let legacy = mb.map(|value| u64::from(value) * 1024 * 1024);
    if legacy.is_some() && bytes.is_some() && legacy != bytes {
        return Err("pdf-compress:invalid-target-size".into());
    }
    let target = bytes.or(legacy);
    if target.is_some_and(|value| !(50 * 1024..=50 * 1024 * 1024).contains(&value)) {
        return Err("pdf-compress:invalid-target-size".into());
    }
    Ok(target)
}

#[tauri::command]
pub(crate) async fn compress_pdf(
    input_path: String,
    level: String,
    target_size_mb: Option<u32>,
    output_dir: Option<String>,
    target_bytes: Option<u64>,
) -> Result<PdfCompressResult, String> {
    let _conversion_guard = begin_conversion().map_err(|_| "pdf-compress:busy".to_string())?;
    let input = std::path::Path::new(&input_path);
    let metadata = std::fs::symlink_metadata(input).map_err(|_| "pdf-compress:invalid-pdf")?;
    if input_path.contains('\0')
        || !input.is_absolute()
        || !metadata.is_file()
        || metadata.file_type().is_symlink()
        || !input
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
    {
        return Err("pdf-compress:invalid-pdf".to_string());
    }
    let original_size = metadata.len();
    if original_size == 0 { return Err("pdf-compress:invalid-pdf".into()); }
    if original_size > PDF_COMPRESS_MAX_INPUT_BYTES {
        return Err("pdf-compress:input-too-large".to_string());
    }
    if !matches!(level.as_str(), "low" | "medium" | "high") {
        return Err("pdf-compress:invalid-level".to_string());
    }
    let target_bytes = compression_target_bytes(target_size_mb, target_bytes)?;

    let qpdf_path = get_qpdf_path().map_err(|_| "pdf-compress:qpdf-unavailable".to_string())?;
    let page_output = run_compress_qpdf(
        &qpdf_path,
        &[
            std::ffi::OsString::from("--show-npages"),
            input.as_os_str().to_os_string(),
        ],
    )
    .await?;
    let page_count = parse_pdf_compress_page_count(&page_output)?;
    if page_count > PDF_COMPRESS_MAX_PAGES {
        return Err("pdf-compress:too-many-pages".to_string());
    }

    if target_bytes.is_some_and(|target| original_size <= target) {
        return Ok(PdfCompressResult {
            original_size,
            compressed_size: original_size,
            output_path: None,
            output_dir: output_dir.unwrap_or_default(),
            target_size_mb,
            target_bytes,
            target_reached: Some(true),
            status: "already-within-target".into(),
            page_count,
            candidate_size: None,
        });
    }

    let output_dir = output_dir
        .filter(|value| !value.trim().is_empty() && !value.contains('\0'))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            dirs::document_dir()
                .unwrap_or_default()
                .join("ToolKnit")
                .join("PDF_Compress")
        });
    is_path_safe(&output_dir).map_err(|_| "pdf-compress:output-path".to_string())?;
    std::fs::create_dir_all(&output_dir)
        .map_err(|_| "pdf-compress:compression-failed".to_string())?;
    is_path_safe(&output_dir).map_err(|_| "pdf-compress:output-path".to_string())?;
    let temporary_path = create_pdf_compress_temp_path(&output_dir)?;
    let _temporary = CompressTemporary(temporary_path.clone());
    let result = async {
        pdf_compress_cancelled()?;
        let mut args = vec![
            std::ffi::OsString::from("--warning-exit-0"),
            std::ffi::OsString::from("--object-streams=generate"),
            std::ffi::OsString::from("--compress-streams=y"),
        ];
        // Recompress flate streams for every preset. The low preset keeps the
        // lower zlib effort, but must still do real work on already-uncompressed
        // text streams instead of producing a byte-for-byte copy.
        args.push(std::ffi::OsString::from("--recompress-flate"));
        args.push(std::ffi::OsString::from(if level == "high" {
            "--compression-level=9"
        } else if level == "medium" {
            "--compression-level=8"
        } else {
            "--compression-level=6"
        }));
        args.push(input.as_os_str().to_os_string());
        args.push(temporary_path.as_os_str().to_os_string());
        let output = run_compress_qpdf(&qpdf_path, &args).await?;
        if !output.status.success() {
            return Err(map_qpdf_compress_error(&output));
        }
        pdf_compress_cancelled()?;
        let check_output = run_compress_qpdf(
            &qpdf_path,
            &[
                std::ffi::OsString::from("--check"),
                temporary_path.as_os_str().to_os_string(),
            ],
        )
        .await?;
        if !check_output.status.success() {
            return Err("pdf-compress:compression-failed".to_string());
        }
        let output_page_output = run_compress_qpdf(
            &qpdf_path,
            &[
                std::ffi::OsString::from("--show-npages"),
                temporary_path.as_os_str().to_os_string(),
            ],
        )
        .await?;
        let output_page_count = parse_pdf_compress_page_count(&output_page_output)?;
        if output_page_count != page_count {
            return Err("pdf-compress:output-invalid".to_string());
        }
        let compressed_size = std::fs::metadata(&temporary_path)
            .map_err(|_| "pdf-compress:compression-failed".to_string())?
            .len();
        if compressed_size == 0 {
            return Err("pdf-compress:output-invalid".to_string());
        }
        pdf_compress_cancelled()?;
        let target_reached = target_bytes.map(|target| compressed_size <= target);
        let status = if target_reached == Some(false) {
            "target-not-reached"
        } else if compressed_size >= original_size {
            "no-reduction"
        } else {
            "compressed"
        };
        // Never publish an oversized candidate as a successful target result.
        let output_path = if status == "compressed" {
            Some(publish_pdf_compress_output(
                &temporary_path,
                &output_dir,
                &create_pdf_compress_file_name(input),
            )?)
        } else {
            None
        };
        Ok(PdfCompressResult {
            original_size,
            compressed_size: compressed_size.min(original_size),
            output_path,
            output_dir: output_dir.to_string_lossy().into_owned(),
            target_size_mb,
            target_reached,
            target_bytes,
            status: status.into(),
            page_count,
            candidate_size: Some(compressed_size),
        })
    }
    .await;
    let _ = std::fs::remove_file(&temporary_path);
    result
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct ConvertProgress {
    pub(crate) file_name: String,
    pub(crate) current: usize,
    pub(crate) total: usize,
    pub(crate) progress: f64,
    pub(crate) status: String,
}

#[derive(serde::Serialize)]
pub(crate) struct BatchConvertResult {
    pub(crate) success_count: usize,
    pub(crate) fail_count: usize,
    pub(crate) output_dir: String,
    pub(crate) errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) original_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) compressed_size: Option<u64>,
}

#[derive(serde::Serialize)]
pub(crate) struct AudioBatchConvertResult {
    pub(crate) success_count: usize,
    pub(crate) fail_count: usize,
    pub(crate) output_dir: String,
    pub(crate) output_paths: Vec<String>,
    pub(crate) errors: Vec<String>,
}
