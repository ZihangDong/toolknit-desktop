use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct RenameEntry {
    pub path: String,
    pub new_name: String,
}

pub(super) fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

pub(super) fn valid_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "CLOCK$"].contains(&stem.as_str())
        || (stem.starts_with("COM") || stem.starts_with("LPT"))
            && ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"]
                .contains(&stem.get(3..).unwrap_or(""));
    !name.is_empty()
        && name.encode_utf16().count() <= 240
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
        && !reserved
}

pub fn validate(entries: &[RenameEntry]) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    if entries.is_empty() || entries.len() > 500 {
        return Err("Select 1–500 regular files".into());
    }
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    let mut plan = Vec::new();
    for entry in entries {
        if !valid_name(&entry.new_name) {
            return Err(format!("Invalid filename: {}", entry.new_name));
        }
        let path = Path::new(&entry.path);
        if !path.is_absolute() {
            return Err("An absolute file path is required".into());
        }
        let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", entry.path))?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Only regular files can be renamed".into());
        }
        let source = path.canonicalize().map_err(|e| e.to_string())?;
        let parent = source.parent().ok_or("File has no parent directory")?;
        let target = parent.join(&entry.new_name);
        if !sources.insert(key(&source)) {
            return Err("A source file occurs more than once".into());
        }
        if !targets.insert(key(&target)) {
            return Err(format!("Duplicate target: {}", entry.new_name));
        }
        plan.push((source, target));
    }
    for (_, target) in &plan {
        if fs::symlink_metadata(target).is_ok() && !sources.contains(&key(target)) {
            return Err(format!("Target already exists: {}", target.display()));
        }
    }
    Ok(plan)
}

#[cfg(windows)]
pub(super) fn move_without_replace(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
    };
    let from: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| format!("{} → {}: {error}", source.display(), target.display()))
}

#[cfg(not(windows))]
pub(super) fn move_without_replace(source: &Path, target: &Path) -> Result<(), String> {
    fs::hard_link(source, target)
        .map_err(|e| format!("{} → {}: {e}", source.display(), target.display()))?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(format!("{}: {error}", source.display()));
    }
    Ok(())
}

#[cfg(test)]
pub fn execute(entries: &[RenameEntry]) -> Result<Vec<RenameEntry>, String> {
    let folder = Path::new(&entries.first().ok_or("Empty batch")?.path)
        .parent()
        .unwrap();
    let plan = validate(entries)?;
    super::journal::run(folder, plan.clone(), false)?;
    Ok(plan
        .into_iter()
        .map(|(source, target)| RenameEntry {
            path: target.to_string_lossy().into_owned(),
            new_name: source.file_name().unwrap().to_string_lossy().into_owned(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "toolknit-rename-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        root
    }
    fn entry(root: &Path, from: &str, to: &str) -> RenameEntry {
        RenameEntry {
            path: root.join(from).to_string_lossy().into_owned(),
            new_name: to.into(),
        }
    }
    #[test]
    fn swaps_and_undo_preserve_contents() {
        let root = fixture();
        fs::write(root.join("a.txt"), "A").unwrap();
        fs::write(root.join("b.txt"), "B").unwrap();
        let undo = execute(&[
            entry(&root, "a.txt", "b.txt"),
            entry(&root, "b.txt", "a.txt"),
        ])
        .unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "B");
        execute(&undo).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "A");
        assert_eq!(fs::read_to_string(root.join("b.txt")).unwrap(), "B");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn collisions_and_invalid_names_never_mutate() {
        let root = fixture();
        fs::write(root.join("a.txt"), "A").unwrap();
        fs::write(root.join("b.txt"), "B").unwrap();
        for name in [
            "b.txt",
            "../oops",
            "CON.txt",
            "bad.",
            "NUL",
            "COM¹.txt",
            "x/y",
        ] {
            assert!(execute(&[entry(&root, "a.txt", name)]).is_err());
        }
        assert!(execute(&[
            entry(&root, "a.txt", "new.txt"),
            entry(&root, "b.txt", "NEW.txt")
        ])
        .is_err());
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "A");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn atomic_publication_never_replaces() {
        let root = fixture();
        fs::write(root.join("a"), "A").unwrap();
        fs::write(root.join("b"), "B").unwrap();
        assert!(move_without_replace(&root.join("a"), &root.join("b")).is_err());
        assert_eq!(fs::read_to_string(root.join("b")).unwrap(), "B");
        fs::remove_dir_all(root).unwrap();
    }
}
