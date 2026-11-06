use super::*;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};
mod install;
mod process;

const VERSION: &str = "4.0.33";
const RECORDS: &str = include_str!("records.json");
const ENGINE_NAME: &str = "mtranserver.exe";
const ENGINE_BYTES: u64 = 129_295_360;
const ENGINE_HASH: &str = "70999a5842984247aeacbd381bc1df26737a129e1a6683be3572bd0cc1b5a798";
const ENGINE_URL: &str = crate::platform::dependency_download::TRANSLATION_ENGINE_URL;
const DOWNLOAD_BYTES: u64 = 201_647_315;

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> { value.lock().unwrap_or_else(|e| e.into_inner()) }
fn root() -> Result<PathBuf, String> { Ok(toolknit_app_data_dir()?.join("local-translation")) }
fn installed(root: &Path) -> PathBuf { root.join(VERSION) }
fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) { Err("translation:cancelled".into()) } else { Ok(()) }
}
fn safe_dir(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
    if let Ok(meta) = std::fs::symlink_metadata(ancestor) {
        if meta.file_type().is_symlink() || !meta.is_dir() { return Err("translation:storage".into()); }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 { return Err("translation:storage".into()); }
        }
    }
    }
    std::fs::create_dir_all(path).map_err(|_| "translation:storage".into())
}
fn regular_size(path: &Path, size: u64) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| {
        #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if m.file_attributes() & 0x400 != 0 { return false; } }
        m.is_file() && !m.file_type().is_symlink() && m.len() == size
    })
}
async fn cancellable<T>(future: impl std::future::Future<Output = T>, cancel: &AtomicBool) -> Result<T, String> {
    tokio::pin!(future);
    loop { tokio::select! { value = &mut future => return Ok(value), _ = tokio::time::sleep(Duration::from_millis(50)) => check_cancel(cancel)? } }
}
async fn hash_file(path: &Path) -> Result<String, String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || sha256_file(&path)).await.map_err(|_| "translation:checksum".to_string())?
}
struct MutationGuard<'a>(&'a AtomicBool);
impl Drop for MutationGuard<'_> { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }
fn mutate(state: &TranslationState) -> Result<MutationGuard<'_>, String> {
    state.installing.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| "translation:busy")?;
    Ok(MutationGuard(&state.installing))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record { source_language: String, target_language: String, file_type: String, attachment: Attachment, decompressed_hash: String, decompressed_size: u64 }
#[derive(Deserialize)]
struct Attachment { hash: String, size: u64, filename: String }
#[derive(Deserialize)]
struct Catalogue { data: Vec<Record> }
fn records() -> Vec<Record> { serde_json::from_str::<Catalogue>(RECORDS).expect("pinned model manifest").data }
fn model_path(dir: &Path, record: &Record) -> PathBuf {
    debug_assert!(matches!(record.file_type.as_str(), "model"|"lex"|"vocab"|"srcvocab"|"trgvocab"));
    dir.join("models").join(format!("{}_{}", record.source_language, record.target_language)).join(record.attachment.filename.trim_end_matches(".zst"))
}
fn complete(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join("ready")).is_ok_and(|s| s == ENGINE_HASH)
        && regular_size(&dir.join(ENGINE_NAME), ENGINE_BYTES)
        && records().iter().all(|r| regular_size(&model_path(dir,r),r.decompressed_size))
        && std::fs::read_to_string(dir.join("config/records.json")).is_ok_and(|s| s == RECORDS)
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress { phase: String, received: u64, total: u64, source: String }
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DownloadSource { #[default] Auto, Official, Accelerated }
impl DownloadSource {
    fn candidates(self) -> Vec<(&'static str, String)> {
        vec![("7caiyun", ENGINE_URL.to_string())]
    }
}
#[derive(Default)]
pub(super) struct TranslationState {
    engine: tokio::sync::Mutex<Option<process::Engine>>,
    installing: AtomicBool,
    install_cancel: AtomicBool,
    progress: Mutex<Progress>,
    tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
    cancelled: Mutex<HashMap<String, Instant>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    action: String,
    #[serde(default)] request_id: String,
    session: Option<u64>,
    target: Option<String>,
    texts: Option<Vec<String>>,
    source: Option<DownloadSource>,
}
fn valid_target(target: &str) -> bool { matches!(target,"en"|"zh-Hans") }
fn target(root: &Path) -> String {
    std::fs::read_to_string(root.join("target-language")).ok().filter(|t| valid_target(t)).unwrap_or_else(||"zh-Hans".into())
}
fn status(state: &TranslationState, root: &Path) -> serde_json::Value {
    serde_json::json!({"ready": complete(&installed(root)),"installing":state.installing.load(Ordering::Relaxed),"progress":lock(&state.progress).clone(),"targetLanguage":target(root),"version":VERSION,"downloadBytes":DOWNLOAD_BYTES})
}
fn validate_texts(texts: &[String], target: &str) -> Result<(), String> {
    if !valid_target(target) || texts.is_empty() || texts.len()>512 || texts.iter().any(|t|t.len()>8_000||t.trim().is_empty()) || texts.iter().map(String::len).sum::<usize>()>64_000 {
        return Err("translation:invalid-input".into());
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn local_translation(app: tauri::AppHandle, window: tauri::WebviewWindow, state: tauri::State<'_, TranslationState>, request: Request) -> Result<serde_json::Value, String> {
    let main = window.label() == "main";
    if !main {
        if window.label() != "screenshot-capture" { return Err("translation:forbidden".into()); }
        quick_screenshot::require_session(&app.state::<quick_screenshot::ScreenshotState>(), &serde_json::json!({"session": request.session}))?;
    }
    let root = root()?;
    match request.action.as_str() {
        "status" => Ok(status(&state,&root)),
        "target" => {
            let value = request.target.as_deref().filter(|t|valid_target(t)).ok_or("translation:invalid-input")?;
            safe_dir(&root)?;
            std::fs::write(root.join("target-language"),value).map_err(|_|"translation:storage")?;
            Ok(status(&state,&root))
        },
        "cancel-install" if main => { state.install_cancel.store(true,Ordering::Relaxed); Ok(serde_json::Value::Null) },
        "install" if main => {
            let mutation = mutate(&state)?;
            state.install_cancel.store(false,Ordering::Relaxed);
            let result = install::install(&root,&state,request.source.unwrap_or_default(),|p|{*lock(&state.progress)=p.clone();let _=app.emit_to("main","local-translation-progress",p);}).await;
            drop(mutation);
            let _=app.emit("local-translation-changed",status(&state,&root));
            result.map(|_|status(&state,&root))
        },
        "remove" if main => {
            let mutation = mutate(&state)?;
            let mut engine=state.engine.try_lock().map_err(|_|"translation:busy")?;
            *engine=None;
            safe_dir(&root)?;
            let dir=installed(&root);
            if dir.exists() { safe_dir(&dir)?; std::fs::remove_dir_all(dir).map_err(|_|"translation:storage")?; }
            drop(mutation);
            let value=status(&state,&root); let _=app.emit("local-translation-changed",&value); Ok(value)
        },
        "cancel" => {
            if request.request_id.is_empty()||request.request_id.len()>80 {return Err("translation:invalid-input".into());}
            let id=format!("{}:{}",window.label(),request.request_id);
            let tasks=lock(&state.tasks);
            if let Some(cancel)=tasks.get(&id) {cancel.store(true,Ordering::Relaxed);}
            else {
                let mut cancelled=lock(&state.cancelled);
                cancelled.retain(|_,at|at.elapsed()<Duration::from_secs(60));
                if cancelled.len()<32 {cancelled.insert(id,Instant::now());}
            }
            Ok(serde_json::Value::Null)
        },
        "translate" if !main => {
            let texts=request.texts.as_deref().ok_or("translation:invalid-input")?;
            let target=request.target.as_deref().ok_or("translation:invalid-input")?;
            validate_texts(texts,target)?;
            if request.request_id.is_empty()||request.request_id.len()>80 {return Err("translation:invalid-input".into());}
            if state.installing.load(Ordering::Relaxed)||!complete(&installed(&root)){return Err("translation:not-installed".into());}
            let id=format!("{}:{}",window.label(),request.request_id);
            let cancel=Arc::new(AtomicBool::new(false));
            {let mut tasks=lock(&state.tasks);
                if lock(&state.cancelled).remove(&id).is_some_and(|at|at.elapsed()<Duration::from_secs(60)){return Err("translation:cancelled".into());}
                if tasks.len()>=2||tasks.contains_key(&id){return Err("translation:busy".into());}tasks.insert(id.clone(),cancel.clone());}
            let result=process::translate(&installed(&root),&state,texts,target,&cancel).await;
            lock(&state.tasks).remove(&id);
            let idle_app=app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(121)).await;
                let state=idle_app.state::<TranslationState>();
                if let Ok(mut engine)=state.engine.try_lock() {
                    if engine.as_ref().is_some_and(|e| e.idle()) { *engine=None; }
                };
            });
            quick_screenshot::require_session(&app.state::<quick_screenshot::ScreenshotState>(),&serde_json::json!({"session":request.session}))?;
            result.map(|texts|serde_json::json!({"results":texts}))
        },
        _ => Err("translation:forbidden".into())
    }
}
pub(super) fn shutdown(app: &tauri::AppHandle) {
    let state=app.state::<TranslationState>();
    state.install_cancel.store(true,Ordering::Relaxed);
    for cancel in lock(&state.tasks).values(){cancel.store(true,Ordering::Relaxed);}
    if let Ok(mut engine)=state.engine.try_lock(){*engine=None;};
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn translation_sources_are_pinned_and_reject_arbitrary_urls() {
        assert_eq!(DownloadSource::Auto.candidates(),vec![("7caiyun",ENGINE_URL.into())]);
        assert_eq!(DownloadSource::Official.candidates(), DownloadSource::Auto.candidates());
        assert_eq!(DownloadSource::Accelerated.candidates(), DownloadSource::Auto.candidates());
        assert!(serde_json::from_value::<Request>(serde_json::json!({"action":"install"})).is_ok());
        assert!(serde_json::from_value::<Request>(serde_json::json!({"action":"install","source":"accelerated"})).is_ok());
        assert!(serde_json::from_value::<Request>(serde_json::json!({"action":"install","source":"https://example.invalid/model.exe"})).is_err());
    }
    #[test] fn translation_manifest_is_pinned_and_bounded() {
        let records=records();assert_eq!(records.len(),7);
        assert_eq!(ENGINE_BYTES+records.iter().map(|r|r.attachment.size).sum::<u64>(),DOWNLOAD_BYTES);
        for r in records { assert!(valid_target(&r.source_language)&&valid_target(&r.target_language)); assert!(!r.attachment.filename.contains('/'));assert_eq!(r.decompressed_hash.len(),64);assert_eq!(r.attachment.hash.len(),64); assert!(matches!(r.file_type.as_str(),"model"|"lex"|"vocab"|"srcvocab"|"trgvocab")); }
        assert!(validate_texts(&["Hello".into()],"zh-Hans").is_ok());
        assert!(validate_texts(&["x".repeat(8001)],"en").is_err());assert!(validate_texts(&["x".into()],"auto").is_err());assert!(validate_texts(&[],"en").is_err());
        assert!(validate_texts(&vec!["x".repeat(8000);9],"en").is_err());
        assert!(validate_texts(&vec!["x".into();513],"en").is_err());
    }
    #[test] fn translation_install_remove_are_exclusive_and_release_on_error() {
        let state=TranslationState::default();let guard=mutate(&state).unwrap();
        assert!(mutate(&state).is_err());drop(guard);assert!(mutate(&state).is_ok());
    }
    #[tokio::test] async fn translation_cancel_interrupts_pending_network() {
        let cancel=AtomicBool::new(true);let started=Instant::now();
        assert!(cancellable(std::future::pending::<()>(),&cancel).await.unwrap_err().contains("cancelled"));
        assert!(started.elapsed()<Duration::from_secs(1));
    }
}
