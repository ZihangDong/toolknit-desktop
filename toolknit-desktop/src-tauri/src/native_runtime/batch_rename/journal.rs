use super::{core, fingerprint, Entry, UndoEntry, UndoJournal};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const PENDING: &str = "batch-rename-pending.json";
pub(super) const UNDO: &str = "batch-rename-undo.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum Phase {
    Staging,
    Publishing,
    Committed,
}

#[derive(Serialize, Deserialize)]
struct Move {
    source: PathBuf,
    temporary: PathBuf,
    target: PathBuf,
    identity: (u64, u64),
}

#[derive(Serialize, Deserialize)]
struct Journal {
    version: u8,
    phase: Phase,
    undo: bool,
    moves: Vec<Move>,
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

pub(super) fn preflight(plan: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (source, _) in plan {
        #[cfg(windows)]
        {
            use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
            use windows::Win32::{
                Foundation::HANDLE,
                Storage::FileSystem::{GetVolumeInformationByHandleW, FILE_READ_ATTRIBUTES},
            };
            let file = OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES.0)
                .open(source)
                .map_err(|error| error.to_string())?;
            let mut name = [0u16; 32];
            unsafe {
                GetVolumeInformationByHandleW(
                    HANDLE(file.as_raw_handle() as isize),
                    None,
                    None,
                    None,
                    None,
                    Some(&mut name),
                )
            }
            .map_err(|error| error.to_string())?;
            let end = name
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(name.len());
            if String::from_utf16_lossy(&name[..end]) != "NTFS" {
                return Err("batch-rename:requires-ntfs".into());
            }
        }
        identity(source)?;
    }
    Ok(())
}

fn identity(path: &Path) -> Result<Option<(u64, u64)>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(format!("Cannot verify file identity: {}", path.display()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(format!("Cannot verify reparse point: {}", path.display()));
        }
        super::super::system_runtime::cleanup_guard::file_identity(path)
            .map(|id| id.map(|(volume, file)| (u64::from(volume), file)))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Some((meta.dev(), meta.ino())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn interrupted_worker() {
        let Some(root) = std::env::var_os("TOOLKNIT_TEST_RENAME_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let phase = match std::env::var("TOOLKNIT_TEST_RENAME_PHASE").as_deref() {
            Ok("staging") => Phase::Staging,
            Ok("publishing") => Phase::Publishing,
            _ => panic!("Missing rename phase"),
        };
        let plan = core::validate(
            &[("a", "b"), ("b", "a")].map(|(from, to)| core::RenameEntry {
                path: root.join(from).to_string_lossy().into_owned(),
                new_name: to.into(),
            }),
        )
        .unwrap();
        run_with_checkpoint(&root, plan, false, |current, index| {
            if current == phase && index == 0 {
                std::process::exit(71);
            }
        })
        .unwrap();
        panic!("Worker reached the end of the batch");
    }

    #[test]
    fn interrupted_swaps_recover_without_replacing_new_files() {
        for phase in ["staging", "publishing"] {
            let root = std::env::temp_dir().join(format!(
                "toolknit-rename-interrupt-{}-{}",
                std::process::id(),
                stamp()
            ));
            fs::create_dir(&root).unwrap();
            fs::write(root.join("a"), "A").unwrap();
            fs::write(root.join("b"), "B").unwrap();
            let worker = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "native_runtime::batch_rename::journal::tests::interrupted_worker",
                ])
                .env("TOOLKNIT_TEST_RENAME_ROOT", &root)
                .env("TOOLKNIT_TEST_RENAME_PHASE", phase)
                .output()
                .unwrap();
            assert_eq!(worker.status.code(), Some(71), "{worker:?}");
            assert_eq!(status(&root).unwrap(), 2);
            let conflict = root.join("a");
            let mut new_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&conflict)
                .unwrap();
            new_file.write_all(b"new A").unwrap();
            drop(new_file);
            assert!(recover(&root).is_err());
            assert_eq!(fs::read_to_string(&conflict).unwrap(), "new A");
            fs::rename(&conflict, root.join("kept-new-a")).unwrap();
            assert_eq!(recover(&root).unwrap(), 2);
            assert_eq!(status(&root).unwrap(), 0);
            assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "A");
            assert_eq!(fs::read_to_string(root.join("b")).unwrap(), "B");
            assert_eq!(
                fs::read_to_string(root.join("kept-new-a")).unwrap(),
                "new A"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }
}

fn save(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let writing = path.with_extension(format!("writing-{}-{}", std::process::id(), stamp()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&writing)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&writing, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(writing);
    }
    result.map_err(|error| error.to_string())
}

fn read(folder: &Path) -> Result<Option<Journal>, String> {
    let path = folder.join(PENDING);
    let data = match fs::read(&path) {
        Ok(data) => data,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let invalid = || {
        format!(
            "Cannot read recovery data. Keep this manifest for manual recovery: {}",
            path.display()
        )
    };
    let record: Journal = serde_json::from_slice(&data).map_err(|_| invalid())?;
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    let mut temporary = HashSet::new();
    let valid = record.version == 1
        && (1..=500).contains(&record.moves.len())
        && record.moves.iter().all(|item| {
            let parent = item.source.parent();
            item.source.is_absolute()
                && item.temporary.parent() == parent
                && item.target.parent() == parent
                && [&item.source, &item.temporary, &item.target]
                    .iter()
                    .all(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(core::valid_name)
                            && !path.components().any(|component| {
                                matches!(component, std::path::Component::ParentDir)
                            })
                    })
                && item
                    .temporary
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".toolknit-rename-")
                && sources.insert(core::key(&item.source))
                && targets.insert(core::key(&item.target))
                && temporary.insert(core::key(&item.temporary))
        })
        && temporary.is_disjoint(&sources)
        && temporary.is_disjoint(&targets);
    if !valid {
        return Err(invalid());
    }
    Ok(Some(record))
}

pub(super) fn status(folder: &Path) -> Result<usize, String> {
    Ok(read(folder)?.map_or(0, |record| record.moves.len()))
}

fn checked_move(from: &Path, to: &Path, expected: (u64, u64)) -> Result<(), String> {
    if identity(from)? != Some(expected) {
        return Err(format!("File changed or is missing: {}", from.display()));
    }
    core::move_without_replace(from, to)
}

fn revert_move(from: &Path, to: &Path, expected: (u64, u64)) -> Result<(), String> {
    let from_is_ours = identity(from)? == Some(expected);
    if !from_is_ours && identity(to)? == Some(expected) {
        return Ok(());
    }
    checked_move(from, to, expected)
}

fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn finish(folder: &Path, record: &Journal) -> Result<(), String> {
    let undo_path = folder.join(UNDO);
    if record.undo {
        remove(&undo_path)?;
    } else {
        let mut entries = Vec::with_capacity(record.moves.len());
        for item in &record.moves {
            if identity(&item.target)? != Some(item.identity) {
                return Err(format!(
                    "File changed or is missing: {}",
                    item.target.display()
                ));
            }
            let path = item.target.to_string_lossy().into_owned();
            let (bytes, modified_ms) = fingerprint(&path)?;
            entries.push(UndoEntry {
                rename: Entry {
                    path,
                    new_name: item
                        .source
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                },
                bytes,
                modified_ms,
            });
        }
        save(&undo_path, &UndoJournal { entries })?;
    }
    remove(&folder.join(PENDING))
}

pub(super) fn recover(folder: &Path) -> Result<usize, String> {
    let Some(mut record) = read(folder)? else {
        return Ok(0);
    };
    let pending = folder.join(PENDING);
    if record.phase == Phase::Committed {
        finish(folder, &record)?;
    } else {
        if record.phase == Phase::Publishing {
            for item in &record.moves {
                revert_move(&item.target, &item.temporary, item.identity)?;
            }
            record.phase = Phase::Staging;
            save(&pending, &record)?;
        }
        for item in &record.moves {
            revert_move(&item.temporary, &item.source, item.identity)?;
        }
        remove(&pending)?;
    }
    Ok(record.moves.len())
}

pub(super) fn run(folder: &Path, plan: Vec<(PathBuf, PathBuf)>, undo: bool) -> Result<(), String> {
    run_with_checkpoint(folder, plan, undo, |_, _| {})
}

fn run_with_checkpoint(
    folder: &Path,
    plan: Vec<(PathBuf, PathBuf)>,
    undo: bool,
    checkpoint: impl Fn(Phase, usize),
) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    let pending = folder.join(PENDING);
    if fs::symlink_metadata(&pending).is_ok() {
        return Err("batch-rename:recovery-required".into());
    }
    preflight(&plan)?;
    let id = stamp();
    let moves = plan
        .into_iter()
        .enumerate()
        .map(|(index, (source, target))| {
            let temporary = source.with_file_name(format!(
                ".toolknit-rename-{}-{id}-{index}",
                std::process::id()
            ));
            let identity = identity(&source)?.ok_or("Source is missing")?;
            Ok(Move {
                source,
                temporary,
                target,
                identity,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut record = Journal {
        version: 1,
        phase: Phase::Staging,
        undo,
        moves,
    };
    save(&pending, &record)?;
    let renamed = (|| {
        for (index, item) in record.moves.iter().enumerate() {
            checked_move(&item.source, &item.temporary, item.identity)?;
            checkpoint(Phase::Staging, index);
        }
        record.phase = Phase::Publishing;
        save(&pending, &record)?;
        for (index, item) in record.moves.iter().enumerate() {
            checked_move(&item.temporary, &item.target, item.identity)?;
            checkpoint(Phase::Publishing, index);
        }
        record.phase = Phase::Committed;
        save(&pending, &record)
    })();
    match renamed {
        Ok(()) => finish(folder, &record),
        Err(error) => match recover(folder) {
            Ok(_) => Err(error),
            Err(recovery) => Err(format!("{error}; Recovery pending: {recovery}")),
        },
    }
}
