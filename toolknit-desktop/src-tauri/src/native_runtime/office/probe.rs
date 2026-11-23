use super::*;

pub(crate) fn libreoffice_io_error(stage: &str, error: &std::io::Error) -> String {
    format!(
        "libreoffice-runtime:{}:os={}",
        stage,
        error.raw_os_error().unwrap_or(0)
    )
}

pub(crate) fn libreoffice_exit_error(code: Option<i32>) -> String {
    let value = code.unwrap_or(-1) as u32;
    let kind = match value {
        0xC0000135 => "missing-library",
        0xC0000139 => "incompatible-system",
        0xC000007B => "invalid-architecture",
        _ => "startup-exit",
    };
    format!("libreoffice-runtime:{}:0x{:08X}", kind, value)
}

struct ProbeProfile(std::path::PathBuf);
impl Drop for ProbeProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn stop_office_child(child: &mut std::process::Child) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Wait for tree termination before killing the parent; otherwise
        // taskkill can lose the parent and leave its soffice.bin child alive.
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn probe_libreoffice_detailed(
    path: &std::path::Path,
    source: &'static str,
    timeout_ms: u128,
    cancelled: impl Fn() -> bool,
) -> Result<LibreOfficeRuntimeInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| libreoffice_io_error("executable", &e))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("libreoffice-runtime:executable".into());
    }
    // A distinct profile avoids locks from another Office process or CLI probe.
    let profile_path = std::env::temp_dir().join(format!(
        "toolknit-lo-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir(&profile_path).map_err(|e| libreoffice_io_error("profile", &e))?;
    let profile = ProbeProfile(profile_path);
    let mut command = std::process::Command::new(path);
    command
        .arg(format!(
            "-env:UserInstallation={}",
            file_url_for_libreoffice(&profile.0)
        ))
        .args([
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--version",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    if cancelled() {
        return Err("dependency-download:cancelled".into());
    }
    let mut child = command
        .spawn()
        .map_err(|e| libreoffice_io_error("spawn", &e))?;
    // Drain stdout while polling so even unexpected verbose output cannot fill
    // the pipe and masquerade as a startup timeout. Keep only the version line.
    let stdout = child.stdout.take().ok_or("libreoffice-runtime:stdout")?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        use std::io::Read;
        let mut stdout = stdout;
        let mut retained = Vec::new();
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stdout.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let keep = count.min(4096_usize.saturating_sub(retained.len()));
            retained.extend_from_slice(&buffer[..keep]);
        }
        let _ = sender.send(retained);
    });
    let started = std::time::Instant::now();
    let status = loop {
        let failure = if cancelled() {
            Some("dependency-download:cancelled".to_string())
        } else if started.elapsed().as_millis() >= timeout_ms {
            Some(format!("libreoffice-runtime:timeout:{}ms", timeout_ms))
        } else {
            None
        };
        if let Some(error) = failure {
            stop_office_child(&mut child);
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(40)),
            Err(error) => {
                stop_office_child(&mut child);
                return Err(libreoffice_io_error("wait", &error));
            }
        }
    };
    if !status.success() {
        return Err(libreoffice_exit_error(status.code()));
    }
    let remaining = timeout_ms
        .saturating_sub(started.elapsed().as_millis())
        .max(1) as u64;
    let output = receiver
        .recv_timeout(std::time::Duration::from_millis(remaining))
        .map_err(|_| "libreoffice-runtime:stdout:timeout".to_string())?;
    let text = String::from_utf8_lossy(&output);
    // Do not expose arbitrary process output or local paths as diagnostics.
    let version = text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("LibreOffice ") || line.starts_with("LibreOfficeDev "))
        .map(|line| line.chars().take(160).collect())
        .ok_or_else(|| "libreoffice-runtime:version".to_string())?;
    Ok(LibreOfficeRuntimeInfo {
        available: true,
        command: Some(path.to_string_lossy().into_owned()),
        source: Some(source.into()),
        version: Some(version),
        message: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn office_probe_errors_preserve_loader_codes() {
        assert_eq!(
            libreoffice_exit_error(Some(0xC0000135_u32 as i32)),
            "libreoffice-runtime:missing-library:0xC0000135"
        );
        assert_eq!(
            libreoffice_exit_error(Some(0xC0000139_u32 as i32)),
            "libreoffice-runtime:incompatible-system:0xC0000139"
        );
        assert_eq!(
            libreoffice_exit_error(Some(0xC000007B_u32 as i32)),
            "libreoffice-runtime:invalid-architecture:0xC000007B"
        );
        assert_eq!(
            libreoffice_exit_error(Some(1)),
            "libreoffice-runtime:startup-exit:0x00000001"
        );
        assert_eq!(
            libreoffice_io_error("spawn", &std::io::Error::from_raw_os_error(5)),
            "libreoffice-runtime:spawn:os=5"
        );
    }
}
