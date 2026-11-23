use super::*;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};

const MAX_ENTRIES: usize = 1000;
const MAX_EXPANDED: u64 = 200 * 1024 * 1024;
const MAX_ARCHIVE_BATCH: usize = 200 * 1024 * 1024;
const INVALID: &str = "word-render:invalid-archive";
const LIMIT: &str = "word-render:archive-limit";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordArchiveInput {
    pub archive_path: String,
    pub entry_name: String,
    pub archive_hash: String,
}
impl WordArchiveInput {
    pub fn identity(&self) -> String {
        format!(
            "zip:{}",
            serde_json::to_string(&[&self.archive_path, &self.entry_name]).unwrap()
        )
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordArchiveEntry {
    entry_name: String,
    size: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordArchiveManifest {
    archive_path: String,
    archive_hash: String,
    entries: Vec<WordArchiveEntry>,
    skipped: usize,
}
pub(super) struct LoadedArchive {
    zip: zip::ZipArchive<Cursor<Vec<u8>>>,
    manifest: WordArchiveManifest,
    compressed: usize,
}
#[derive(Default)]
pub(super) struct ArchiveCache {
    archives: HashMap<String, LoadedArchive>,
    compressed: usize,
    expanded: u64,
}

// Bound the directory before ZipArchive allocates its index. ZIP64 and split
// archives are intentionally excluded from this small-document import format.
fn directory_count(bytes: &[u8]) -> Result<usize, String> {
    let end = (bytes.len().saturating_sub(65557)..bytes.len().saturating_sub(21))
        .rev()
        .find(|&i| bytes.get(i..i + 4) == Some(b"PK\x05\x06"))
        .ok_or(INVALID)?;
    let u16_at = |i| u16::from_le_bytes([bytes[end + i], bytes[end + i + 1]]) as usize;
    let u32_at = |i| u32::from_le_bytes(bytes[end + i..end + i + 4].try_into().unwrap()) as usize;
    let count = u16_at(10);
    if end + 22 + u16_at(20) != bytes.len()
        || u16_at(4) != 0
        || u16_at(6) != 0
        || u16_at(8) != count
        || u32_at(12).checked_add(u32_at(16)) != Some(end)
    {
        return Err(INVALID.into());
    }
    if count == 0 || count > MAX_ENTRIES {
        return Err(LIMIT.into());
    }
    Ok(count)
}
fn safe_name(name: &str) -> bool {
    let name = name.strip_suffix('/').unwrap_or(name);
    !name.is_empty()
        && name.len() <= 1024
        && !name.contains('\\')
        && name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part.len() <= 255
                && !part.ends_with([' ', '.'])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                && !matches!(
                    part.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
fn parse_archive(bytes: Vec<u8>, archive_path: String) -> Result<LoadedArchive, String> {
    let compressed = bytes.len();
    let count = directory_count(&bytes)?;
    let archive_hash = format!("{:x}", Sha256::digest(&bytes));
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| INVALID)?;
    if zip.len() != count {
        return Err(INVALID.into());
    }
    let mut expanded = 0u64;
    let mut names = HashSet::new();
    let mut entries = Vec::new();
    let mut skipped = 0;
    for index in 0..zip.len() {
        let file = zip.by_index_raw(index).map_err(|_| INVALID)?;
        let name = file.name().map_err(|_| INVALID)?.into_owned();
        let kind = file.unix_mode().unwrap_or(0) & 0o170000;
        if !safe_name(&name)
            || !names.insert(name.trim_end_matches('/').to_lowercase())
            || file.encrypted()
            || !matches!(kind, 0 | 0o100000 | 0o040000)
            || !matches!(
                file.compression(),
                zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
            )
        {
            return Err(INVALID.into());
        }
        expanded = expanded.checked_add(file.size()).ok_or(LIMIT)?;
        if expanded > MAX_EXPANDED {
            return Err(LIMIT.into());
        }
        if file.is_dir() {
            continue;
        }
        if matches!(
            Path::new(&name)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            "doc" | "docx"
        ) {
            if file.size() > WORD_MAX_BYTES || entries.len() >= 20 {
                return Err(LIMIT.into());
            }
            entries.push(WordArchiveEntry {
                entry_name: name,
                size: file.size(),
            });
        } else {
            skipped += 1;
        }
    }
    if entries.is_empty() {
        return Err("word-render:archive-empty".into());
    }
    Ok(LoadedArchive {
        zip,
        manifest: WordArchiveManifest {
            archive_path,
            archive_hash,
            entries,
            skipped,
        },
        compressed,
    })
}
fn load_archive(value: &str) -> Result<LoadedArchive, String> {
    let source = inspect_word_input_path(value, true)?;
    let mut bytes = Vec::new();
    std::fs::File::open(&source)
        .map_err(|_| INVALID)?
        .take(WORD_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID)?;
    if bytes.len() as u64 > WORD_MAX_BYTES {
        return Err(LIMIT.into());
    }
    parse_archive(bytes, cleanup_display_path(&source))
}
#[tauri::command]
pub(crate) async fn inspect_word_zip(path: String) -> Result<WordArchiveManifest, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_archive(&path).map(|archive| archive.manifest)
    })
    .await
    .map_err(|_| INVALID.to_string())?
}
impl ArchiveCache {
    pub fn read(&mut self, input: &WordArchiveInput) -> Result<Vec<u8>, String> {
        self.read_with_cancel(input, || CANCEL_FLAG.load(Ordering::SeqCst))
    }
    pub(super) fn read_with_cancel(
        &mut self,
        input: &WordArchiveInput,
        cancelled: impl Fn() -> bool,
    ) -> Result<Vec<u8>, String> {
        if cancelled() {
            return Err("word-render:cancelled".into());
        }
        if !self.archives.contains_key(&input.archive_path) {
            let archive = load_archive(&input.archive_path)?;
            self.compressed += archive.compressed;
            if self.compressed > MAX_ARCHIVE_BATCH {
                return Err(LIMIT.into());
            }
            self.archives.insert(input.archive_path.clone(), archive);
        }
        let archive = self.archives.get_mut(&input.archive_path).unwrap();
        if archive.manifest.archive_hash != input.archive_hash {
            return Err("word-render:archive-changed".into());
        }
        let entry = archive
            .manifest
            .entries
            .iter()
            .find(|entry| entry.entry_name == input.entry_name)
            .ok_or(INVALID)?;
        self.expanded = self.expanded.checked_add(entry.size).ok_or(LIMIT)?;
        if self.expanded > MAX_EXPANDED {
            return Err(LIMIT.into());
        }
        let mut file = archive
            .zip
            .by_name(&input.entry_name)
            .map_err(|_| INVALID)?;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            if cancelled() {
                return Err("word-render:cancelled".into());
            }
            let read = file.read(&mut buffer).map_err(|_| INVALID)?;
            if read == 0 {
                break;
            }
            if bytes.len() + read > entry.size as usize
                || bytes.len() + read > WORD_MAX_BYTES as usize
            {
                return Err(LIMIT.into());
            }
            bytes.extend_from_slice(&buffer[..read]);
        }
        if bytes.len() as u64 != entry.size {
            return Err(INVALID.into());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_zip_rejects_unsafe_names() {
        for name in [
            "../a.docx",
            "/a.doc",
            "C:/a.doc",
            "a\\b.docx",
            "a/./b.doc",
            "a//b.doc",
            "NUL.doc",
            "a./b.doc",
            "a:stream.doc",
            "a\0.doc",
        ] {
            assert!(!safe_name(name), "{name:?}");
        }
        assert!(safe_name("中文目录/合同 v1.docx"));
    }
    #[test]
    fn word_zip_cross_runtime_fixtures() {
        let Ok(root) = std::env::var("TOOLKNIT_WORD_ZIP_FIXTURES") else {
            return;
        };
        let cases: serde_json::Value =
            serde_json::from_slice(&std::fs::read(Path::new(&root).join("cases.json")).unwrap())
                .unwrap();
        for case in cases.as_array().unwrap() {
            let bytes =
                std::fs::read(Path::new(&root).join(case["file"].as_str().unwrap())).unwrap();
            let result = parse_archive(bytes, "C:/fixture.zip".into());
            assert_eq!(
                result.is_ok(),
                case["accepted"].as_bool().unwrap(),
                "{}",
                case["file"]
            );
            if let Ok(mut loaded) = result {
                if case["readInvalid"].as_bool() == Some(true) {
                    let mut file = loaded.zip.by_name("bad.docx").unwrap();
                    assert!(file.read_to_end(&mut Vec::new()).is_err());
                }
            }
        }
    }
    #[test]
    fn word_zip_cache_checks_crc_and_changed_archive() {
        let Ok(root) = std::env::var("TOOLKNIT_WORD_ZIP_FIXTURES") else {
            return;
        };
        let source = Path::new(&root).join("valid.zip");
        let loaded = load_archive(source.to_str().unwrap()).unwrap();
        let mut input = WordArchiveInput {
            archive_path: loaded.manifest.archive_path,
            entry_name: loaded.manifest.entries[0].entry_name.clone(),
            archive_hash: loaded.manifest.archive_hash,
        };
        let mut cache = ArchiveCache::default();
        assert!(cache
            .read_with_cancel(&input, || false)
            .unwrap()
            .starts_with(b"PK"));
        assert_eq!(
            cache.read_with_cancel(&input, || true).unwrap_err(),
            "word-render:cancelled"
        );
        input.archive_hash = "0".repeat(64);
        assert_eq!(
            cache.read_with_cancel(&input, || false).unwrap_err(),
            "word-render:archive-changed"
        );
        let loaded = load_archive(Path::new(&root).join("bad-crc.zip").to_str().unwrap()).unwrap();
        let bad = WordArchiveInput {
            archive_path: loaded.manifest.archive_path,
            entry_name: "bad.docx".into(),
            archive_hash: loaded.manifest.archive_hash,
        };
        assert_eq!(
            ArchiveCache::default()
                .read_with_cancel(&bad, || false)
                .unwrap_err(),
            INVALID
        );
    }
    #[test]
    #[ignore = "real LibreOffice ZIP conversion; use generated fixtures and explicit output directory"]
    fn word_zip_real_runtime_qa() {
        let root = std::env::var("TOOLKNIT_WORD_ZIP_FIXTURES").unwrap();
        let output = std::env::var("TOOLKNIT_WORD_ZIP_OUTPUT").unwrap();
        let manifest = load_archive(Path::new(&root).join("valid.zip").to_str().unwrap())
            .unwrap()
            .manifest;
        let inputs: Vec<WordArchiveInput> = manifest
            .entries
            .iter()
            .map(|entry| WordArchiveInput {
                archive_path: manifest.archive_path.clone(),
                entry_name: entry.entry_name.clone(),
                archive_hash: manifest.archive_hash.clone(),
            })
            .collect();
        let _guard = begin_conversion().unwrap();
        let result = convert_word_batch_with_archives(
            inputs.iter().map(|input| input.identity()).collect(),
            inputs.clone(),
            false,
            output.clone(),
            "zip-native-qa".into(),
            |_| {},
        )
        .unwrap();
        assert_eq!(result.files.len(), 3);
        assert_eq!(result.files[0].status, "success");
        assert_eq!(result.files[1].status, "success");
        assert_eq!(result.files[2].status, "failed");
        let cancelled_output = Path::new(&output).join("cancelled");
        std::fs::create_dir(&cancelled_output).unwrap();
        *WORD_JOB.lock().unwrap() = Some("zip-native-cancel".into());
        let _job = WordJobGuard;
        let selected = inputs[..2].to_vec();
        let cancelled = convert_word_batch_with_archives(
            selected.iter().map(|input| input.identity()).collect(),
            selected,
            false,
            cancelled_output.to_string_lossy().into_owned(),
            "zip-native-cancel".into(),
            |event| {
                if event["phase"] == "done" && event["index"] == 0 {
                    assert!(cancel_word_to_pdf("zip-native-cancel".into()));
                }
            },
        )
        .unwrap();
        assert!(cancelled.cancelled);
        assert_eq!(cancelled.files[0].status, "success");
        assert_eq!(cancelled.files[1].status, "cancelled");
        std::fs::write(
            Path::new(&output).join("report.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "result": result, "cancelled": cancelled, "manifest": manifest
            }))
            .unwrap(),
        )
        .unwrap();
    }
}
