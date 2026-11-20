use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};

const PIN: &str = include_str!("../../../../office-kernel/runtime.lock.json");

pub(super) fn candidates() -> Vec<(PathBuf, &'static str)> {
    if !cfg!(target_os = "windows") { return Vec::new(); }
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.join("resources/office-kernel"));
        }
    }
    #[cfg(debug_assertions)]
    roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/office-kernel"));
    roots.into_iter().map(|root| (root.join("runtime/program/soffice.com"), "bundled")).collect()
}

fn verify(root: &Path, pin: &serde_json::Value) -> Result<(), String> {
    let fail = || "libreoffice-runtime:bundled-integrity".to_string();
    let manifest = std::fs::read(root.join("manifest.json")).map_err(|_| fail())?;
    if format!("{:x}", Sha256::digest(&manifest)) != pin["manifestSha256"].as_str().unwrap_or("") {
        return Err(fail());
    }
    let files = pin["criticalFiles"].as_object().ok_or_else(fail)?;
    for (name, expected) in files {
        let file = root.join(name);
        let meta = std::fs::symlink_metadata(&file).map_err(|_| fail())?;
        if !meta.is_file() || meta.file_type().is_symlink() { return Err(fail()); }
        let data = std::fs::read(&file).map_err(|_| fail())?;
        if format!("{:x}", Sha256::digest(&data)) != expected.as_str().unwrap_or("") {
            return Err(fail());
        }
    }
    Ok(())
}

pub(super) fn validate(command: &Path) -> Result<(), String> {
    let root = command.parent().and_then(Path::parent).and_then(Path::parent)
        .ok_or("libreoffice-runtime:bundled-path")?;
    let pin: serde_json::Value = serde_json::from_str(PIN)
        .map_err(|_| "libreoffice-runtime:bundled-pin")?;
    verify(root, &pin)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_runtime_rejects_changed_binary_and_manifest() {
        struct Temp(PathBuf);
        impl Drop for Temp { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let temp = Temp(std::env::temp_dir().join(format!("toolknit-bundle-{}-{}",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos())));
        std::fs::create_dir(&temp.0).unwrap();
        let root = &temp.0;
        std::fs::write(root.join("manifest.json"), b"approved manifest").unwrap();
        std::fs::write(root.join("writer.dll"), b"approved writer").unwrap();
        let pin = serde_json::json!({
            "manifestSha256": format!("{:x}", Sha256::digest(b"approved manifest")),
            "criticalFiles": {"writer.dll": format!("{:x}", Sha256::digest(b"approved writer"))}
        });
        assert!(verify(root, &pin).is_ok());
        std::fs::write(root.join("writer.dll"), b"different writer").unwrap();
        assert!(verify(root, &pin).is_err());
        std::fs::write(root.join("writer.dll"), b"approved writer").unwrap();
        std::fs::write(root.join("manifest.json"), b"different manifest").unwrap();
        assert!(verify(root, &pin).is_err());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn bundled_runtime_precedes_installed_runtime() {
        let candidates = super::super::libreoffice_candidates();
        let bundled = candidates.iter().position(|(_, source)| *source == "bundled").unwrap();
        let managed = candidates.iter().position(|(_, source)| *source == "managed").unwrap();
        assert!(bundled < managed);
    }
}
