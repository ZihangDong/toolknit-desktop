use super::*;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const WORD_DRIVER: &str = include_str!("../../../resources/office/word-to-pdf.py");
const WORD_MAX_BYTES: u64 = 50 * 1024 * 1024;
const WORD_MAX_OUTPUT_BYTES: u64 = 150 * 1024 * 1024;
static WORD_JOB: Mutex<Option<String>> = Mutex::new(None);
static WORD_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordFileResult {
    input_path: String,
    source_name: String,
    output_path: Option<String>,
    output_bytes: u64,
    page_count: usize,
    status: String,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordBatchResult {
    job_id: String,
    files: Vec<WordFileResult>,
    cancelled: bool,
}

struct WordWork(PathBuf);
impl Drop for WordWork {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
struct WordJobGuard;
impl Drop for WordJobGuard {
    fn drop(&mut self) {
        *WORD_JOB.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

fn word_work_dir(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    for _ in 0..1000 {
        let sequence = WORD_SEQUENCE.fetch_add(1, Ordering::SeqCst);
        let path = parent.join(format!("{}-{}-{}", prefix, std::process::id(), sequence));
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("word-render:output-path".into()),
        }
    }
    Err("word-render:output-path".into())
}

fn inspect_word_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "doc" | "docx") {
        return Err("word-render:invalid-extension".into());
    }
    if !path.is_absolute() || value.contains('\0') {
        return Err("word-render:invalid-input".into());
    }
    // Reject links in every existing component, including directory junctions.
    for component in path.ancestors() {
        let meta = std::fs::symlink_metadata(component).map_err(|_| "word-render:invalid-input")?;
        if meta.file_type().is_symlink() {
            return Err("word-render:invalid-input".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("word-render:invalid-input".into());
            }
        }
    }
    let metadata = std::fs::metadata(&path).map_err(|_| "word-render:invalid-input")?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("word-render:invalid-input".into());
    }
    if metadata.len() > WORD_MAX_BYTES {
        return Err("word-render:input-too-large".into());
    }
    path.canonicalize()
        .map_err(|_| "word-render:invalid-input".into())
}

fn word_output_name(source: &str) -> String {
    let stem = Path::new(source)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let safe: String = stem
        .chars()
        .take(100)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim_matches(|c| c == '.' || c == ' ');
    format!("{}.pdf", if safe.is_empty() { "document" } else { safe })
}

#[derive(Debug, serde::Deserialize)]
struct WordBatchStatusItem {
    index: usize,
    status: String,
    code: Option<String>,
}

#[derive(Debug, serde::Deserialize, Default)]
struct WordBatchStatus {
    files: Vec<WordBatchStatusItem>,
}

fn run_word_renderer_batch(
    runtime: &LibreOfficeRuntimeInfo,
    manifest: &Path,
    work: &Path,
    mut on_done: impl FnMut(usize, Result<(), String>),
) -> Result<(), String> {
    let soffice = runtime
        .command
        .as_deref()
        .ok_or("word-render:runtime-missing")?;
    let python = Path::new(soffice)
        .parent()
        .ok_or("word-render:runtime-missing")?
        .join(if cfg!(windows) { "python.exe" } else { "python3" });
    if !python.is_file() {
        return Err("word-render:python-missing".into());
    }
    let script = work.join("word-to-pdf.py");
    std::fs::write(&script, WORD_DRIVER).map_err(|_| "word-render:output-path")?;
    let status_path = work.join("status.json");
    let mut command = std::process::Command::new(&python);
    command
        .arg(&script)
        .arg(soffice)
        .arg("--manifest")
        .arg(manifest)
        .arg(work.join("profile"))
        .arg(&status_path)
        .current_dir(python.parent().unwrap())
        .env("SAL_USE_VCLPLUGIN", "svp")
        .env("SAL_DISABLE_PRINTERLIST", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "word-render:runtime-start-failed")?;
    let started = std::time::Instant::now();
    let mut reported = std::collections::BTreeSet::new();
    loop {
        if CANCEL_FLAG.load(Ordering::SeqCst) || started.elapsed().as_secs() >= 180 {
            stop_office_child(&mut child);
            return Err(if CANCEL_FLAG.load(Ordering::SeqCst) {
                "word-render:cancelled"
            } else {
                "word-render:timeout"
            }
            .into());
        }
        if let Ok(bytes) = std::fs::read(&status_path) {
            if let Ok(status) = serde_json::from_slice::<WordBatchStatus>(&bytes) {
                for item in status.files {
                    if !matches!(item.status.as_str(), "success" | "failed")
                        || !reported.insert(item.index)
                    {
                        continue;
                    }
                    if item.status == "success" {
                        on_done(item.index, Ok(()));
                    } else {
                        on_done(
                            item.index,
                            Err(format!(
                                "word-render:{}",
                                item.code.as_deref().unwrap_or("render-failed")
                            )),
                        );
                    }
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err("word-render:render-failed".into());
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(60)),
            Err(_) => {
                stop_office_child(&mut child);
                return Err("word-render:render-failed".into());
            }
        }
    }
}

fn convert_word_batch(
    input_paths: Vec<String>,
    output_dir: String,
    job_id: String,
    mut progress: impl FnMut(serde_json::Value),
) -> Result<WordBatchResult, String> {
    if input_paths.is_empty() || input_paths.len() > 20 {
        return Err("word-render:invalid-file-count".into());
    }
    let output_parent =
        validate_image_output_dir(&output_dir).map_err(|_| "word-render:output-path")?;
    let runtime = resolve_libreoffice_runtime();
    if !runtime.available {
        return Err("word-render:runtime-missing".into());
    }
    let work = WordWork(word_work_dir(&std::env::temp_dir(), "tk-word-batch")?);
    let inputs_dir = work.0.join("inputs");
    let outputs_dir = work.0.join("outputs");
    std::fs::create_dir_all(&inputs_dir).map_err(|_| "word-render:output-path")?;
    std::fs::create_dir_all(&outputs_dir).map_err(|_| "word-render:output-path")?;
    let mut files = Vec::new();
    let mut manifest_items = Vec::new();
    let mut prepared = std::collections::BTreeSet::new();
    for (index, input) in input_paths.iter().enumerate() {
        let name = Path::new(input)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("document")
            .to_string();
        let mut row = WordFileResult {
            input_path: input.clone(),
            source_name: name,
            output_path: None,
            output_bytes: 0,
            page_count: 0,
            status: "pending".into(),
            error: None,
        };
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            row.status = "cancelled".into();
            row.error = Some("word-render:cancelled".into());
            files.push(row);
            continue;
        }
        let result = (|| -> Result<(), String> {
            let source = inspect_word_path(input)?;
            use std::io::Read;
            let mut data = Vec::new();
            std::fs::File::open(source)
                .map_err(|_| "word-render:invalid-input")?
                .take(WORD_MAX_BYTES + 1)
                .read_to_end(&mut data)
                .map_err(|_| "word-render:invalid-input")?;
            if data.len() as u64 > WORD_MAX_BYTES {
                return Err("word-render:input-too-large".into());
            }
            let extension = Path::new(input)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("docx")
                .to_ascii_lowercase();
            let source_copy = inputs_dir.join(format!("{}.{}", index, extension));
            let output_copy = outputs_dir.join(format!("{}.pdf", index));
            std::fs::write(&source_copy, data).map_err(|_| "word-render:output-path")?;
            manifest_items.push(serde_json::json!({
                "index": index,
                "source": source_copy,
                "destination": output_copy,
            }));
            prepared.insert(index);
            Ok(())
        })();
        if let Err(error) = result {
            row.status = "failed".into();
            row.error = Some(error);
        } else {
            progress(serde_json::json!({
                "jobId": job_id,
                "index": index,
                "total": input_paths.len(),
                "phase": "converting",
                "file": row,
            }));
        }
        files.push(row);
    }
    if !manifest_items.is_empty() && !CANCEL_FLAG.load(Ordering::SeqCst) {
        let manifest = work.0.join("manifest.json");
        std::fs::write(
            &manifest,
            serde_json::to_vec(&serde_json::json!({ "items": manifest_items }))
                .map_err(|_| "word-render:output-path")?,
        )
        .map_err(|_| "word-render:output-path")?;
        let batch_result = run_word_renderer_batch(&runtime, &manifest, &work.0, |index, result| {
            if !prepared.contains(&index) || index >= files.len() {
                return;
            }
            let row = &mut files[index];
            match result {
                Ok(()) => {
                    let pdf = outputs_dir.join(format!("{}.pdf", index));
                    let metadata = std::fs::metadata(&pdf).ok();
                    let bytes = if metadata
                        .as_ref()
                        .is_some_and(|meta| meta.len() <= WORD_MAX_OUTPUT_BYTES)
                    {
                        std::fs::read(&pdf).unwrap_or_default()
                    } else {
                        Vec::new()
                    };
                    let page_count = count_pdf_pages_rough(&bytes);
                    if bytes.len() < 128
                        || !bytes.starts_with(b"%PDF-")
                        || !bytes.windows(5).rev().take(1024).any(|w| w == b"%%EOF")
                        || page_count == 0
                    {
                        row.status = "failed".into();
                        row.error = Some("word-render:empty-output".into());
                    } else if let Ok(destination) = word_work_dir(&output_parent, "Word-PDF") {
                        let target = destination.join(word_output_name(&row.source_name));
                        let partial = destination.join(".result.part");
                        if std::fs::write(&partial, &bytes)
                            .and_then(|_| std::fs::rename(&partial, &target))
                            .is_ok()
                        {
                            row.output_path = Some(cleanup_display_path(&target));
                            row.output_bytes = bytes.len() as u64;
                            row.page_count = page_count;
                            row.status = "success".into();
                        } else {
                            let _ = std::fs::remove_dir_all(destination);
                            row.status = "failed".into();
                            row.error = Some("word-render:output-path".into());
                        }
                    } else {
                        row.status = "failed".into();
                        row.error = Some("word-render:output-path".into());
                    }
                }
                Err(error) => {
                    row.status = "failed".into();
                    row.error = Some(error);
                }
            }
            progress(serde_json::json!({
                "jobId": job_id,
                "index": index,
                "total": input_paths.len(),
                "phase": "done",
                "file": row,
            }));
        });
        if let Err(error) = batch_result {
            if error != "word-render:cancelled" {
                for (index, row) in files.iter_mut().enumerate() {
                    if prepared.contains(&index) && row.status == "pending" {
                        row.status = "failed".into();
                        row.error = Some(error.clone());
                    }
                }
            }
        }
    }
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        for row in &mut files {
            if row.status == "pending" {
                row.status = "cancelled".into();
                row.error = Some("word-render:cancelled".into());
            }
        }
    }
    for (index, row) in files.iter_mut().enumerate() {
        if row.status == "failed" && row.error.is_none() {
            row.error = Some("word-render:render-failed".into());
        }
        if row.status == "failed" && !prepared.contains(&index) {
            progress(serde_json::json!({
                "jobId": job_id,
                "index": index,
                "total": input_paths.len(),
                "phase": "done",
                "file": row,
            }));
        }
    }
    Ok(WordBatchResult {
        job_id,
        files,
        cancelled: CANCEL_FLAG.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub(crate) async fn convert_word_to_pdf(
    app_handle: tauri::AppHandle,
    input_paths: Vec<String>,
    output_dir: String,
    job_id: String,
) -> Result<WordBatchResult, String> {
    if job_id.is_empty()
        || job_id.len() > 100
        || !job_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("word-render:invalid-options".into());
    }
    let _conversion = begin_conversion().map_err(|_| "word-render:busy")?;
    *WORD_JOB.lock().unwrap_or_else(|p| p.into_inner()) = Some(job_id.clone());
    let _job = WordJobGuard;
    tauri::async_runtime::spawn_blocking(move || {
        // The worker owns both guards even if the waiting webview disappears.
        let _conversion = _conversion;
        let _job = _job;
        convert_word_batch(input_paths, output_dir, job_id, |event| {
            let _ = app_handle.emit("word-to-pdf-progress", event);
        })
    })
    .await
    .map_err(|_| "word-render:render-failed".to_string())?
}

#[tauri::command]
pub(crate) fn cancel_word_to_pdf(job_id: String) -> bool {
    let active = WORD_JOB.lock().unwrap_or_else(|p| p.into_inner());
    if active.as_ref() == Some(&job_id) {
        CANCEL_FLAG.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_names_preserve_unicode_and_spaces() {
        assert_eq!(word_output_name("方案 v1.docx"), "方案 v1.pdf");
        assert_eq!(word_output_name("旧文档.doc"), "旧文档.pdf");
    }
    #[test]
    fn word_input_rejects_relative_and_other_formats() {
        assert!(inspect_word_path("local.docx").is_err());
        assert!(inspect_word_path("C:/file.pdf").is_err());
        assert!(!cancel_word_to_pdf("unrelated".into()));
    }
    #[test]
    #[ignore = "real LibreOffice integration, explicit fixture/output environment"]
    fn word_real_runtime_qa() {
        let inputs: Vec<String> =
            serde_json::from_str(&std::env::var("TOOLKNIT_WORD_QA_FILES").unwrap()).unwrap();
        let output = std::env::var("TOOLKNIT_WORD_QA_OUTPUT").unwrap();
        let _guard = begin_conversion().unwrap();
        let first_input = inputs[0].clone();
        let result =
            convert_word_batch(inputs, output.clone(), "native-qa".into(), |_| {}).unwrap();
        std::fs::write(
            Path::new(&output).join("report.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
        let cancel_output = Path::new(&output).join("cancelled-batch");
        std::fs::create_dir(&cancel_output).unwrap();
        *WORD_JOB.lock().unwrap() = Some("native-cancel-qa".into());
        let _job = WordJobGuard;
        let cancelled = convert_word_batch(
            vec![first_input.clone(), first_input],
            cancel_output.to_string_lossy().into_owned(),
            "native-cancel-qa".into(),
            |event| {
                if event["phase"] == "done" && event["index"] == 0 {
                    assert!(!cancel_word_to_pdf("unrelated-job".into()));
                    assert!(cancel_word_to_pdf("native-cancel-qa".into()));
                }
            },
        )
        .unwrap();
        assert!(cancelled.cancelled);
        assert_eq!(cancelled.files[0].status, "success");
        assert_eq!(cancelled.files[1].status, "cancelled");
        assert!(Path::new(cancelled.files[0].output_path.as_ref().unwrap()).is_file());
        assert_eq!(std::fs::read_dir(cancel_output).unwrap().count(), 1);
    }

    #[test]
    #[ignore = "real LibreOffice batch QA; provide local DOC/DOCX fixture paths"]
    fn word_real_batch_samples_qa() {
        let inputs: Vec<String> =
            serde_json::from_str(&std::env::var("TOOLKNIT_WORD_QA_FILES").unwrap()).unwrap();
        assert!(!inputs.is_empty() && inputs.len() <= 20);
        let output = std::env::var("TOOLKNIT_WORD_QA_OUTPUT").unwrap();
        std::fs::create_dir_all(&output).unwrap();
        let _guard = begin_conversion().unwrap();
        let started = std::time::Instant::now();
        let result =
            convert_word_batch(inputs, output.clone(), "native-batch-qa".into(), |_| {}).unwrap();
        assert!(
            result.files.iter().all(|file| file.status == "success"),
            "one or more local Word samples did not convert"
        );
        let report = serde_json::json!({
            "elapsedMs": started.elapsed().as_millis(),
            "files": result.files,
        });
        std::fs::write(
            Path::new(&output).join("report.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }
}
