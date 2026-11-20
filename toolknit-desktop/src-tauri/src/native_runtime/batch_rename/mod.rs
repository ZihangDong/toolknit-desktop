mod core;
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
}
#[derive(Serialize, Deserialize)]
struct UndoJournal {
    entries: Vec<UndoEntry>,
}

fn fingerprint(path: &str) -> Result<(u64, u64), String> {
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
    core::validate(&plan)?;
    if preview {
        return Ok(entries.len());
    }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let journal = folder.join("batch-rename-undo.json");
    // Reserve a writable journal before changing user files.
    let pending = folder.join("batch-rename-pending.json");
    let undo: Vec<_> = plan
        .iter()
        .map(|entry| {
            let source = std::path::Path::new(&entry.path);
            let (bytes, modified_ms) = fingerprint(&entry.path)?;
            Ok(UndoEntry {
                rename: Entry {
                    path: source
                        .with_file_name(&entry.new_name)
                        .to_string_lossy()
                        .into_owned(),
                    new_name: source.file_name().unwrap().to_string_lossy().into_owned(),
                },
                bytes,
                modified_ms,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    use std::io::Write;
    let data = serde_json::to_vec(&UndoJournal { entries: undo }).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| {
            format!(
                "Cannot create undo journal (check {}): {e}",
                pending.display()
            )
        })?;
    if let Err(error) = file.write_all(&data).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(&pending);
        return Err(error.to_string());
    }
    drop(file);
    match core::execute(&plan) {
        Ok(_) => {
            // copy retains the recovery manifest if saving the undo slot fails.
            std::fs::copy(&pending, &journal).map_err(|e| {
                format!(
                    "Renamed successfully; recovery manifest: {} ({e})",
                    pending.display()
                )
            })?;
            std::fs::remove_file(&pending).map_err(|e| e.to_string())?;
            Ok(entries.len())
        }
        Err(error) => {
            if !error.contains("Recovery file retained") {
                let _ = std::fs::remove_file(pending);
            }
            Err(error)
        }
    }
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
    let journal = folder.join("batch-rename-undo.json");
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
    for entry in &record.entries {
        if fingerprint(&entry.rename.path)? != (entry.bytes, entry.modified_ms) {
            return Err(format!(
                "File changed after rename; undo stopped: {}",
                entry.rename.path
            ));
        }
    }
    core::execute(&plan)?;
    std::fs::remove_file(journal).map_err(|e| e.to_string())?;
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
