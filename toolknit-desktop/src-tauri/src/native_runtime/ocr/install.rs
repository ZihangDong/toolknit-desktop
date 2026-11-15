use super::{
    engine,
    runtime::{self, lock, OcrState, VERSION},
};
use crate::{native_runtime::*, platform::dependency_download as download};
use serde::Deserialize;
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tokio::io::AsyncWriteExt;
const MANIFEST: &str = include_str!("models.json");
#[derive(Deserialize)]
struct Manifest {
    files: Vec<File>,
}
#[derive(Deserialize)]
struct File {
    name: String,
    bytes: u64,
    sha256: String,
}
fn files() -> Vec<File> {
    serde_json::from_str::<Manifest>(MANIFEST)
        .expect("fixed OCR manifest")
        .files
}
pub(super) fn total_bytes() -> u64 {
    files().iter().map(|f| f.bytes).sum()
}
pub(super) fn safe_dir(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if let Ok(m) = std::fs::symlink_metadata(ancestor) {
            if !m.is_dir() || m.file_type().is_symlink() {
                return Err("ocr:storage".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if m.file_attributes() & 0x400 != 0 {
                    return Err("ocr:storage".into());
                }
            }
        }
    }
    std::fs::create_dir_all(path).map_err(|_| "ocr:storage".into())
}
fn regular(path: &Path, size: u64) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0 {
                return false;
            }
        }
        m.is_file() && !m.file_type().is_symlink() && m.len() == size
    })
}
pub(super) fn complete(dir: &Path) -> bool {
    let canonical = MANIFEST.replace("\r\n", "\n");
    let unix_bytes = canonical.len() as u64;
    let windows_bytes = unix_bytes + canonical.bytes().filter(|&b| b == b'\n').count() as u64;
    (regular(&dir.join("ready"), unix_bytes) || regular(&dir.join("ready"), windows_bytes))
        && std::fs::read_to_string(dir.join("ready")).is_ok_and(|s| s.lines().eq(MANIFEST.lines()))
        && files().iter().all(|f| regular(&dir.join(&f.name), f.bytes))
}
pub(super) fn verify(dir: &Path) -> Result<(), String> {
    safe_dir(dir)?;
    for file in files() {
        let path = dir.join(&file.name);
        if !regular(&path, file.bytes)
            || sha256_file(&path).map_err(|_| "ocr:checksum")? != file.sha256
        {
            return Err("ocr:checksum".into());
        }
    }
    Ok(())
}
fn check(state: &OcrState) -> Result<(), String> {
    if state.install_cancel.load(Ordering::SeqCst) {
        Err("ocr:cancelled".into())
    } else {
        Ok(())
    }
}
fn progress(app: &tauri::AppHandle, state: &OcrState, phase: &str, received: u64) {
    let value = serde_json::json!({"phase":phase,"received":received,"total":total_bytes()});
    *lock(&state.progress) = value.clone();
    let _ = app.emit_to("main", "local-ocr-progress", value);
}
fn net_error(error: String) -> String {
    if error.contains("cancelled") {
        "ocr:cancelled".into()
    } else {
        "ocr:download".into()
    }
}
async fn file(
    client: &reqwest::Client,
    record: &File,
    path: &Path,
    state: &OcrState,
    mut report: impl FnMut(u64),
) -> Result<(), String> {
    check(state)?;
    let part = path.with_extension("part");
    if let Ok(m) = std::fs::symlink_metadata(&part) {
        if !regular(&part, m.len()) {
            return Err("ocr:storage".into());
        }
    }
    let valid = download::verified_partial(&part, record.bytes, &record.sha256)
        .await
        .map_err(net_error)?;
    let mut size = if valid {
        record.bytes
    } else {
        std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0)
    };
    if size < record.bytes {
        let url = download::resource_url(&format!(
            "models/ocr/pp-ocrv5-mobile/{VERSION}/{}",
            record.name
        ));
        let mut request = client.get(url);
        if size > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={size}-"));
        }
        let mut response = download::network(request.send(), &state.install_cancel)
            .await
            .map_err(net_error)?;
        size = download::response_offset(&response, size, record.bytes).map_err(net_error)?;
        let mut output = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(size > 0)
            .truncate(size == 0)
            .open(&part)
            .await
            .map_err(|_| "ocr:storage")?;
        let mut last = Instant::now();
        while let Some(chunk) = download::network(response.chunk(), &state.install_cancel)
            .await
            .map_err(net_error)?
        {
            check(state)?;
            size = size.checked_add(chunk.len() as u64).ok_or("ocr:download")?;
            if size > record.bytes {
                return Err("ocr:download".into());
            }
            output.write_all(&chunk).await.map_err(|_| "ocr:storage")?;
            if last.elapsed() >= Duration::from_millis(100) {
                report(size);
                last = Instant::now();
            }
        }
        output.flush().await.map_err(|_| "ocr:storage")?;
        drop(output);
    }
    if size != record.bytes
        || !download::verified_partial(&part, record.bytes, &record.sha256)
            .await
            .map_err(net_error)?
    {
        return Err("ocr:checksum".into());
    }
    check(state)?;
    if path.exists() {
        if !regular(
            path,
            std::fs::metadata(path).map_err(|_| "ocr:storage")?.len(),
        ) {
            return Err("ocr:storage".into());
        }
        std::fs::remove_file(path).map_err(|_| "ocr:storage")?;
    }
    std::fs::rename(part, path).map_err(|_| "ocr:storage")?;
    report(size);
    Ok(())
}
pub(super) async fn install(app: &tauri::AppHandle, state: &OcrState) -> Result<(), String> {
    install_at(&runtime::root()?, state, |phase, received| {
        progress(app, state, phase, received)
    })
    .await
}
async fn install_at(
    root: &Path,
    state: &OcrState,
    report: impl Fn(&str, u64),
) -> Result<(), String> {
    safe_dir(root)?;
    let staging = root.join(format!("staging-{VERSION}"));
    safe_dir(&staging)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "ocr:download")?;
    let mut received = 0;
    for record in files() {
        file(
            &client,
            &record,
            &staging.join(&record.name),
            state,
            |count| report("download", received + count),
        )
        .await?;
        received += record.bytes;
    }
    report("testing", received);
    check(state)?;
    let dir = staging.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        verify(&dir)?;
        drop(engine::Engine::open(&dir)?);
        Ok(())
    })
    .await
    .map_err(|_| "ocr:model-load")??;
    check(state)?;
    std::fs::write(
        staging.join("LICENSE-Apache-2.0.txt"),
        include_str!("../../../../LICENSES/Apache-2.0.txt"),
    )
    .map_err(|_| "ocr:storage")?;
    std::fs::write(staging.join("manifest.json"), MANIFEST).map_err(|_| "ocr:storage")?;
    std::fs::write(staging.join("ready"), MANIFEST).map_err(|_| "ocr:storage")?;
    *lock(&state.engine) = None;
    let destination = root.join(VERSION);
    let backup = root.join(format!("previous-{VERSION}"));
    if backup.exists() {
        safe_dir(&backup)?;
        std::fs::remove_dir_all(&backup).map_err(|_| "ocr:storage")?;
    }
    if destination.exists() {
        safe_dir(&destination)?;
        std::fs::rename(&destination, &backup).map_err(|_| "ocr:storage")?;
    }
    if std::fs::rename(&staging, &destination).is_err() {
        if backup.exists() {
            let _ = std::fs::rename(&backup, &destination);
        }
        return Err("ocr:storage".into());
    }
    if backup.exists() {
        let _ = std::fs::remove_dir_all(backup);
    }
    report("ready", received);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_ocr_ready_marker_accepts_line_endings_but_not_changed_manifest() {
        let root=std::env::temp_dir().join(format!("toolknit-ocr-marker-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        for file in files() { std::fs::File::create(root.join(file.name)).unwrap().set_len(file.bytes).unwrap(); }
        let unix=MANIFEST.replace("\r\n","\n");
        for marker in [&unix,&unix.replace('\n',"\r\n")] {
            std::fs::write(root.join("ready"),marker).unwrap();assert!(complete(&root));
        }
        std::fs::write(root.join("ready"),unix.replace("sha256","broken")).unwrap();assert!(!complete(&root));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn manifest_is_fixed_and_bounded() {
        let list = files();
        assert_eq!(list.len(), 3);
        assert_eq!(total_bytes(), 21407098);
        for file in list {
            assert!(matches!(
                file.name.as_str(),
                "det.onnx" | "rec.onnx" | "dictionary.json"
            ));
            assert_eq!(file.sha256.len(), 64);
            assert!(file.bytes < 20 * 1024 * 1024);
        }
    }
    #[tokio::test]
    #[ignore = "Downloads fixed public OCR models into an explicitly provided isolated test directory"]
    async fn ocr_real_install_resume_and_integrity() {
        let root = std::path::PathBuf::from(
            std::env::var("TOOLKNIT_OCR_INSTALL_TEST_ROOT").expect("isolated install directory"),
        );
        assert!(!root.exists(), "do not replace an existing directory");
        let state = OcrState::default();
        install_at(&root, &state, |_, _| {})
            .await
            .expect("real pinned 7caiyun installation");
        let dir = root.join(VERSION);
        assert!(complete(&dir));
        verify(&dir).unwrap();
        state.install_cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            install_at(&root, &state, |_, _| {}).await.unwrap_err(),
            "ocr:cancelled"
        );
        assert!(
            complete(&dir),
            "cancellation preserves existing installation"
        );
        let image = std::fs::read(
            std::env::var("TOOLKNIT_OCR_INSTALL_FIXTURE").expect("explicit synthetic fixture"),
        )
        .unwrap();
        let mut engine = engine::Engine::open(&dir).unwrap();
        assert!(!engine
            .recognize(&image, &AtomicBool::new(false))
            .unwrap()
            .lines
            .is_empty());
        let cancelled = AtomicBool::new(true);
        assert_eq!(
            engine.recognize(&image, &cancelled).unwrap_err(),
            "ocr:cancelled"
        );
        drop(engine);
        std::fs::write(dir.join("det.onnx"), b"corrupt").unwrap();
        assert!(!complete(&dir));
        assert!(verify(&dir).is_err());
        // Leave this isolated directory for audit; no user installation is touched.
        println!("Pinned download, model load/inference, cancellation, preserved previous version and corruption rejection passed");
    }
}
