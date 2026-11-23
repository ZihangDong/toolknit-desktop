use super::*;
use std::io::Read;

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WordExpectedHash { input_path: String, source_hash: String }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WordHistoryRequest {
    input_path: String,
    archive: Option<WordArchiveInput>,
    source_hash: Option<String>,
    output_path: Option<String>,
    output_hash: Option<String>,
    #[serde(default)]
    output_bytes: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordHistoryProbe {
    source_state: String,
    source_hash: Option<String>,
    output_state: String,
    output_bytes: u64,
}
static HISTORY_BUSY: AtomicBool = AtomicBool::new(false);
struct HistoryGuard;
impl Drop for HistoryGuard { fn drop(&mut self) { HISTORY_BUSY.store(false, Ordering::SeqCst); } }
fn valid_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub(super) fn expected_hashes(values: Vec<WordExpectedHash>, inputs: &[String]) -> Result<std::collections::HashMap<String, String>, String> {
    if values.len() > 20 { return Err("word-render:history-invalid".into()); }
    let mut map = std::collections::HashMap::new();
    for item in values {
        if !inputs.contains(&item.input_path) || !valid_hash(&item.source_hash) || map.insert(item.input_path, item.source_hash).is_some() {
            return Err("word-render:history-invalid".into());
        }
    }
    Ok(map)
}
fn safe_file(value: &str, extension: &[&str], limit: u64) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if value.len() > 4096 || value.contains('\0') || !path.is_absolute()
        || !path.extension().and_then(|x| x.to_str()).is_some_and(|x| extension.iter().any(|e| x.eq_ignore_ascii_case(e))) {
        return Err("unsafe".into());
    }
    for component in path.ancestors() {
        let meta = std::fs::symlink_metadata(component).map_err(|_| "missing")?;
        if meta.file_type().is_symlink() { return Err("unsafe".into()); }
        #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if meta.file_attributes() & 0x400 != 0 { return Err("unsafe".into()); } }
    }
    let meta = std::fs::metadata(&path).map_err(|_| "missing")?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > limit { return Err("unavailable".into()); }
    path.canonicalize().map_err(|_| "missing".into())
}
fn file_hash(path: &Path, max: u64) -> Result<(String, u64), String> {
    let file = std::fs::File::open(path).map_err(|_| "unavailable")?;
    let mut source = file.take(max + 1); let mut digest = Sha256::new(); let mut buffer = [0_u8; 65536]; let mut total = 0;
    loop { let count = source.read(&mut buffer).map_err(|_| "unavailable")?; if count == 0 { break; }
        total += count as u64; if total > max { return Err("unavailable".into()); } digest.update(&buffer[..count]); }
    if total == 0 { return Err("unavailable".into()); }
    Ok((format!("{:x}", digest.finalize()), total))
}
pub(super) fn probe_history(items: Vec<WordHistoryRequest>) -> Result<Vec<WordHistoryProbe>, String> {
    if items.is_empty() || items.len() > 20 { return Err("word-render:history-invalid".into()); }
    let mut archives = word_zip::ArchiveCache::default(); let mut result = Vec::new();
    for item in items {
        if item.input_path.len() > 8192 || item.source_hash.as_ref().is_some_and(|s| !valid_hash(s))
            || item.output_hash.as_ref().is_some_and(|s| !valid_hash(s)) { return Err("word-render:history-invalid".into()); }
        let source = if let Some(archive) = item.archive {
            if archive.identity() != item.input_path { return Err("word-render:history-invalid".into()); }
            safe_file(&archive.archive_path, &["zip"], WORD_MAX_BYTES).and_then(|_| {
                archives.read_with_cancel(&archive, || false).map(|data| format!("{:x}", Sha256::digest(&data)))
                    .map_err(|error| if error == "word-render:archive-changed" { "changed".into() } else { "unavailable".into() })
            })
        } else { safe_file(&item.input_path, &["doc", "docx"], WORD_MAX_BYTES).and_then(|p| file_hash(&p, WORD_MAX_BYTES).map(|x| x.0)) };
        let (source_state, source_hash) = match source {
            Ok(hash) => (if item.source_hash.as_ref().is_some_and(|old| old != &hash) { "changed" } else { "available" }.to_string(), Some(hash)),
            Err(state) => (state, None),
        };
        let output = item.output_path.as_deref().ok_or_else(|| "missing".to_string())
            .and_then(|path| safe_file(path, &["pdf"], WORD_MAX_OUTPUT_BYTES))
            .and_then(|path| file_hash(&path, WORD_MAX_OUTPUT_BYTES));
        let (output_state, output_bytes) = match output {
            Ok((hash, bytes)) => (if item.output_hash.as_ref().is_some_and(|old| old != &hash) || (item.output_bytes > 0 && item.output_bytes != bytes) { "changed" } else { "available" }.to_string(), bytes),
            Err(state) => (state, 0),
        };
        result.push(WordHistoryProbe { source_state, source_hash, output_state, output_bytes });
    }
    Ok(result)
}
#[tauri::command]
pub(crate) async fn inspect_word_history(items: Vec<WordHistoryRequest>) -> Result<Vec<WordHistoryProbe>, String> {
    if HISTORY_BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() { return Err("word-render:history-busy".into()); }
    let guard = HistoryGuard;
    tauri::async_runtime::spawn_blocking(move || { let _guard = guard; probe_history(items) }).await.map_err(|_| "word-render:history-failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_history_rejects_unbounded_or_forged_checks() {
        assert!(probe_history(vec![]).is_err());
        let input = WordExpectedHash { input_path: "C:/other.docx".into(), source_hash: "a".repeat(64) };
        assert!(expected_hashes(vec![input], &["C:/source.docx".into()]).is_err());
        assert!(safe_file("relative.docx", &["docx"], WORD_MAX_BYTES).is_err());
    }
    #[test]
    #[ignore = "real Word history QA; only generated files under a marked fixture directory are modified"]
    fn word_history_real_runtime_qa() {
        let fixture = PathBuf::from(std::env::var("TOOLKNIT_WORD_HISTORY_FIXTURE").unwrap()).canonicalize().unwrap();
        assert_eq!(std::fs::read_to_string(fixture.join(".history-fixture")).unwrap(), "synthetic Word history QA");
        assert!(fixture.file_name().unwrap().to_string_lossy().starts_with("run-"));
        let root = PathBuf::from(std::env::var("TOOLKNIT_WORD_HISTORY_OUTPUT").unwrap()).canonicalize().unwrap();
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        assert!(root.file_name().unwrap().to_string_lossy().starts_with("toolknit-word-history-"));
        let source_a = cleanup_display_path(&fixture.join("source-a.docx"));
        let source_b = cleanup_display_path(&fixture.join("source-b.docx"));
        let zip = cleanup_display_path(&fixture.join("batch.zip"));
        let archive = WordArchiveInput { archive_path: zip.clone(), entry_name: "合同/source.docx".into(), archive_hash: format!("{:x}", Sha256::digest(std::fs::read(&zip).unwrap())) };
        let _lock = test_conversion_lock(); let _guard = begin_conversion().unwrap();
        let initial = convert_word_batch_with_options(vec![source_a.clone(), source_b.clone(), archive.identity()], vec![archive.clone()], false,
            None, None, vec![], root.to_string_lossy().into_owned(), "history-initial".into(), |_| {}).unwrap();
        assert!(initial.files.iter().all(|row| row.status == "success" && row.source_hash.is_some() && row.output_hash.is_some()));
        let requests = |files: &[WordFileResult]| files.iter().map(|row| WordHistoryRequest { input_path: row.input_path.clone(),
            archive: if row.input_path == archive.identity() { Some(archive.clone()) } else { None }, source_hash: row.source_hash.clone(),
            output_path: row.output_path.clone(), output_hash: row.output_hash.clone(), output_bytes: row.output_bytes }).collect();
        let before = probe_history(requests(&initial.files)).unwrap();
        assert!(before.iter().all(|row| row.source_state == "available" && row.output_state == "available"));
        let lost = PathBuf::from(initial.files[0].output_path.as_ref().unwrap()); assert!(lost.canonicalize().unwrap().starts_with(&root)); std::fs::remove_file(lost).unwrap();
        std::fs::copy(fixture.join("changed.docx"), &source_b).unwrap();
        let output = PathBuf::from(initial.files[2].output_path.as_ref().unwrap()); assert!(output.canonicalize().unwrap().starts_with(&root));
        let mut altered = std::fs::read(&output).unwrap(); assert_eq!(altered[8], b'\n'); altered[8] = b'\r'; std::fs::write(&output, &altered).unwrap();
        let changed = probe_history(requests(&initial.files)).unwrap();
        assert_eq!(changed[0].output_state, "missing"); assert_eq!(changed[0].source_state, "available");
        assert_eq!(changed[1].source_state, "changed"); assert_eq!(changed[1].output_state, "available");
        assert_eq!(changed[2].output_state, "changed"); assert_eq!(std::fs::read(&output).unwrap(), altered);
        let regenerated = convert_word_batch_with_options(vec![source_a.clone()], vec![], false, None, None,
            vec![WordExpectedHash { input_path: source_a.clone(), source_hash: initial.files[0].source_hash.clone().unwrap() }],
            root.to_string_lossy().into_owned(), "history-regenerate".into(), |_| {}).unwrap();
        assert_eq!(regenerated.files[0].status, "success"); assert_ne!(regenerated.files[0].output_path, initial.files[0].output_path);
        let rejected = convert_word_batch_with_options(vec![source_b.clone()], vec![], false, None, None,
            vec![WordExpectedHash { input_path: source_b.clone(), source_hash: initial.files[1].source_hash.clone().unwrap() }],
            root.to_string_lossy().into_owned(), "history-stale".into(), |_| {}).unwrap();
        assert_eq!(rejected.files[0].error.as_deref(), Some("word-render:source-changed")); assert!(rejected.files[0].output_path.is_none());
        let accepted = convert_word_batch_with_options(vec![source_b.clone()], vec![], false, None, None,
            vec![WordExpectedHash { input_path: source_b.clone(), source_hash: changed[1].source_hash.clone().unwrap() }],
            root.to_string_lossy().into_owned(), "history-current".into(), |_| {}).unwrap(); assert_eq!(accepted.files[0].status, "success");
        assert_ne!(accepted.files[0].output_path, initial.files[1].output_path);
        std::fs::copy(fixture.join("changed.docx"), &source_a).unwrap();
        let raced = convert_word_batch_with_options(vec![source_a.clone()], vec![], false, None, None,
            vec![WordExpectedHash { input_path: source_a.clone(), source_hash: changed[0].source_hash.clone().unwrap() }],
            root.to_string_lossy().into_owned(), "history-race".into(), |_| {}).unwrap();
        assert_eq!(raced.files[0].error.as_deref(), Some("word-render:source-changed")); assert!(raced.files[0].output_path.is_none());
        std::fs::rename(&source_a, fixture.join("moved-source.docx")).unwrap();
        let missing = probe_history(requests(&regenerated.files)).unwrap(); assert_eq!(missing[0].source_state, "missing"); assert_eq!(missing[0].output_state, "available");
        std::fs::copy(fixture.join("changed.zip"), &zip).unwrap();
        let zip_changed = probe_history(requests(&initial.files[2..])).unwrap(); assert_eq!(zip_changed[0].source_state, "changed");
        let report = serde_json::json!({"initial":initial,"before":before,"changed":changed,"regenerated":regenerated,"rejected":rejected,
            "accepted":accepted,"raced":raced,"missing":missing,"zipChanged":zip_changed});
        std::fs::write(root.join("report.json"), serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}
