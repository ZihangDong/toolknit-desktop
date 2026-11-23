mod core;
mod journal;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Entry {
    path: String,
    new_name: String,
}
impl From<&Entry> for core::RenameEntry {
    fn from(value: &Entry) -> Self {
        Self {
            path: value.path.clone(),
            new_name: value.new_name.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct UndoEntry {
    rename: Entry,
    bytes: u64,
    modified_ms: u64,
    identity: Option<(u64, u64)>,
}
#[derive(Serialize, Deserialize)]
struct UndoJournal {
    entries: Vec<UndoEntry>,
}

fn fingerprint(path: &std::path::Path) -> Result<(u64, u64), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Undo source is no longer a regular file".into());
    }
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    Ok((metadata.len(), modified))
}

#[tauri::command]
pub(crate) async fn batch_rename_files(
    app: tauri::AppHandle,
    entries: Vec<Entry>,
    preview: bool,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
        rename_in_folder(&folder, entries, preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rename_in_folder(
    folder: &std::path::Path,
    entries: Vec<Entry>,
    preview: bool,
) -> Result<usize, String> {
    let plan: Vec<_> = entries.iter().map(core::RenameEntry::from).collect();
    let plan = core::validate(&plan)?;
    if preview {
        journal::preflight(&plan)?;
        return Ok(entries.len());
    }
    journal::run(folder, plan, None)?;
    Ok(entries.len())
}

#[tauri::command]
pub(crate) async fn recover_batch_rename(
    app: tauri::AppHandle,
    preview: bool,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
        if preview {
            journal::status(&folder)
        } else {
            journal::recover(&folder)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn undo_batch_rename(
    app: tauri::AppHandle,
    preview: bool,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
        undo_in_folder(&folder, preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn undo_in_folder(folder: &std::path::Path, preview: bool) -> Result<usize, String> {
    let journal = folder.join(journal::UNDO);
    if !journal.exists() {
        return Ok(0);
    }
    let data = std::fs::read(&journal).map_err(|e| e.to_string())?;
    let record: UndoJournal = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let plan: Vec<_> = record
        .entries
        .iter()
        .map(|entry| core::RenameEntry::from(&entry.rename))
        .collect();
    if preview {
        return Ok(plan.len());
    }
    journal::run(folder, core::validate(&plan)?, Some(&record.entries))?;
    Ok(plan.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "toolknit-rename-journal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }
    #[test]
    fn durable_undo_and_modified_file_guard() {
        let folder = fixture();
        let source = folder.join("before.txt");
        std::fs::write(&source, "original").unwrap();
        let entries = vec![Entry {
            path: source.to_string_lossy().into_owned(),
            new_name: "after.txt".into(),
        }];
        assert_eq!(rename_in_folder(&folder, entries.clone(), true).unwrap(), 1);
        assert!(source.exists(), "preview cannot mutate files");
        assert_eq!(
            rename_in_folder(&folder, entries.clone(), false).unwrap(),
            1
        );
        assert_eq!(undo_in_folder(&folder, true).unwrap(), 1);
        assert_eq!(undo_in_folder(&folder, false).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "original");
        assert_eq!(undo_in_folder(&folder, true).unwrap(), 0);
        rename_in_folder(&folder, entries, false).unwrap();
        std::fs::write(folder.join("after.txt"), "changed since rename").unwrap();
        assert!(undo_in_folder(&folder, false)
            .unwrap_err()
            .contains("File changed"));
        assert_eq!(
            std::fs::read_to_string(folder.join("after.txt")).unwrap(),
            "changed since rename"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn undo_worker() {
        let Some(folder) = std::env::var_os("TOOLKNIT_TEST_UNDO_ROOT") else {
            return;
        };
        assert_eq!(
            undo_in_folder(std::path::Path::new(&folder), false).unwrap(),
            2
        );
    }
    #[test]
    fn replacement_with_matching_metadata_blocks_entire_undo() {
        use std::fs::{self, File, FileTimes};

        let folder = fixture();
        let entries = [("other", "other-renamed"), ("A", "B")]
            .map(|(from, to)| {
                let path = folder.join(from);
                fs::write(&path, "1111").unwrap();
                Entry {
                    path: path.to_string_lossy().into_owned(),
                    new_name: to.into(),
                }
            })
            .to_vec();
        rename_in_folder(&folder, entries, false).unwrap();
        let renamed = folder.join("B");
        let original = folder.join("original-B");
        let modified = fs::metadata(&renamed).unwrap().modified().unwrap();
        let expected = fingerprint(&renamed).unwrap();
        fs::rename(&renamed, &original).unwrap();
        fs::write(&renamed, "2222").unwrap();
        File::options()
            .write(true)
            .open(&renamed)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(fingerprint(&renamed).unwrap(), expected);
        let undo_path = folder.join(journal::UNDO);
        let record = fs::read(&undo_path).unwrap();
        assert!(undo_in_folder(&folder, false)
            .unwrap_err()
            .contains("File changed"));
        assert_eq!(fs::read(&undo_path).unwrap(), record);
        assert_eq!(journal::status(&folder).unwrap(), 0);
        assert!(!folder.join("A").exists());
        assert!(!folder.join("other").exists());
        assert_eq!(fs::read(folder.join("other-renamed")).unwrap(), b"1111");
        assert_eq!(fs::read(&renamed).unwrap(), b"2222");

        fs::rename(&renamed, folder.join("replacement")).unwrap();
        fs::rename(&original, &renamed).unwrap();
        let worker = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_runtime::batch_rename::tests::undo_worker",
            ])
            .env("TOOLKNIT_TEST_UNDO_ROOT", &folder)
            .output()
            .unwrap();
        assert!(worker.status.success(), "{worker:?}");
        assert_eq!(fs::read(folder.join("A")).unwrap(), b"1111");
        assert_eq!(fs::read(folder.join("other")).unwrap(), b"1111");
        assert_eq!(fs::read(folder.join("replacement")).unwrap(), b"2222");
        assert!(!undo_path.exists());
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn existing_recovery_manifest_blocks_new_mutation() {
        let folder = fixture();
        let source = folder.join("before.txt");
        std::fs::write(&source, "original").unwrap();
        std::fs::write(folder.join("batch-rename-pending.json"), "recovery").unwrap();
        let entries = vec![Entry {
            path: source.to_string_lossy().into_owned(),
            new_name: "after.txt".into(),
        }];
        assert!(rename_in_folder(&folder, entries, false).is_err());
        assert!(source.exists());
        assert_eq!(
            std::fs::read_to_string(folder.join("batch-rename-pending.json")).unwrap(),
            "recovery"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }
}
