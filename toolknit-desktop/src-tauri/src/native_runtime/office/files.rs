#[tauri::command]
pub(crate) fn reveal_in_folder(path: String) -> Result<(), String> {
    // Keep the legacy command name, but make its intended behavior explicit:
    // select an existing file, or open an existing directory.
    open_path(path)
}

fn resolve_open_folder(path: &str) -> Result<std::path::PathBuf, String> {
    if path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let requested = std::path::PathBuf::from(path);
    if !requested.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|_| "Path does not exist".to_string())?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| "Path is unavailable".to_string())?;
    let target = if metadata.is_file() {
        canonical
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| "File has no parent folder".to_string())?
    } else if metadata.is_dir() {
        canonical
    } else {
        return Err("Path must be a file or folder".to_string());
    };
    Ok(target)
}

#[tauri::command]
pub(crate) fn open_path(path: String) -> Result<(), String> {
    let target = resolve_open_folder(&path)?;
    let requested = std::path::PathBuf::from(path);
    let canonical_requested = requested
        .canonicalize()
        .map_err(|_| "Path does not exist".to_string())?;
    let is_file = canonical_requested.is_file();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer");
        if is_file {
            command.arg(format!("/select,{}", canonical_requested.display()));
        } else {
            command.arg(&target);
        }
        command
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        if is_file {
            command.arg("-R").arg(&canonical_requested);
        } else {
            command.arg(&target);
        }
        command
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(if is_file {
                canonical_requested.parent().unwrap_or(&target)
            } else {
                &target
            })
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn open_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg("shell:RecycleBinFolder")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Opening the Recycle Bin is currently available on Windows only.".to_string())
    }
}

#[cfg(test)]
mod external_open_security_tests {
    use super::*;

    #[test]
    fn external_urls_require_web_protocol_host_and_no_credentials() {
        assert!(validate_external_url("https://toolknit.com/changelog.html").is_ok());
        assert!(validate_external_url("http://127.0.0.1:1420/").is_ok());
        assert!(validate_external_url("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(validate_external_url("https://user:secret@example.com/").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("https://example.com/\nnext").is_err());
    }

    #[test]
    fn webviews_can_only_navigate_within_the_packaged_application() {
        assert!(allow_webview_navigation(
            &url::Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(allow_webview_navigation(
            &url::Url::parse("http://tauri.localhost/index.html?screen-picker=1").unwrap()
        ));
        assert!(!allow_webview_navigation(
            &url::Url::parse("https://toolknit.com/").unwrap()
        ));
        assert!(!allow_webview_navigation(
            &url::Url::parse("data:text/html,external").unwrap()
        ));
    }

    #[test]
    fn open_path_resolution_requires_an_existing_absolute_path() {
        let root = std::env::temp_dir().join(format!(
            "toolknit-open-folder-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("result.pdf");
        std::fs::write(&file, b"test").unwrap();

        assert_eq!(resolve_open_folder(root.to_str().unwrap()).unwrap(), root.canonicalize().unwrap());
        assert_eq!(resolve_open_folder(file.to_str().unwrap()).unwrap(), root.canonicalize().unwrap());
        assert!(file.canonicalize().unwrap().is_file());
        assert!(resolve_open_folder("relative-output").is_err());
        assert!(resolve_open_folder(root.join("missing").to_str().unwrap()).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod image_color_replace_tests {
    use super::*;

    #[test]
    fn perceptual_distance_and_feather_are_bounded() {
        let white = color_rgb_to_lab([255, 255, 255]);
        assert_eq!(color_delta_e(white, white), 0.0);
        assert_eq!(color_replace_weight(0.0, 20.0, 24.0), 1.0);
        assert_eq!(color_replace_weight(21.0, 20.0, 24.0), 0.0);
        assert!((0.0..=1.0).contains(&color_replace_weight(19.0, 20.0, 24.0)));
    }

    #[test]
    fn smart_and_global_exports_match_the_frontend_fixture() {
        let suffix = hex::encode({ let mut value = [0_u8; 8]; getrandom::getrandom(&mut value).unwrap(); value });
        let root = std::env::temp_dir().join(format!("toolknit-color-replace-test-{}", suffix));
        let output = root.join("output");
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("fixture.png");
        let bytes = vec![
            255,255,255,255, 255,255,255,255, 0,0,0,255, 255,255,255,255,
            255,255,255,255, 255,255,255,255, 0,0,0,255, 255,255,255,255,
            0,0,0,255,       0,0,0,255,       0,0,0,255, 255,255,255,255,
        ];
        image::RgbaImage::from_raw(4, 3, bytes).unwrap().save(&input).unwrap();
        let options = |smart, name: &str| ColorReplaceOptions {
            app: None,
            operation_id: None,
            input_path: input.to_string_lossy().into_owned(),
            output_dir: output.to_string_lossy().into_owned(),
            output_name: name.to_string(),
            source_rgb: vec![255, 255, 255],
            target_rgb: vec![0, 0, 255],
            threshold: 2.0,
            seed_x: 0,
            seed_y: 0,
            smart,
            softness: 0.0,
            preserve_luminance: false,
            format: "png".to_string(),
            jpeg_quality: 92,
            cancel_token: None,
        };
        let smart = color_replace_blocking(options(true, "smart")).unwrap();
        let global = color_replace_blocking(options(false, "global")).unwrap();
        assert_eq!(smart.changed_pixels, 4);
        assert_eq!(global.changed_pixels, 7);
        let smart_pixels = image::open(smart.output_path).unwrap().to_rgba8();
        assert_eq!(smart_pixels.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(smart_pixels.get_pixel(3, 2).0, [255, 255, 255, 255]);
        let global_pixels = image::open(global.output_path).unwrap().to_rgba8();
        assert_eq!(global_pixels.get_pixel(3, 2).0, [0, 0, 255, 255]);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod crypto_tool_tests {
    use super::*;

    #[test]
    fn tkaes_header_helpers_are_deterministic_and_nonce_is_per_chunk() {
        let base = [7_u8; 12];
        assert_ne!(tkaes_nonce(&base, 0), tkaes_nonce(&base, 1));
        assert_eq!(&tkaes_aad(3, 42)[..4], TKAE_MAGIC);
        assert_eq!(tkaes_aad(3, 42).len(), 16);
        assert_eq!(TKAE_VERSION, 2);
        assert_eq!(tkaes_encrypted_stem(std::path::Path::new("document.pdf")), "document.pdf");
        assert_eq!(tkaes_decrypted_stem(std::path::Path::new("document.pdf.tkaes")), "document.pdf");
        assert!(validate_tool_operation_id("123e4567-e89b-12d3-a456-426614174000").is_ok());
        assert!(validate_tool_operation_id("../invalid").is_err());
    }

    #[test]
    fn tkaes_round_trip_preserves_name_and_rejects_wrong_password() {
        let suffix = hex::encode({ let mut value = [0_u8; 8]; getrandom::getrandom(&mut value).unwrap(); value });
        let root = std::env::temp_dir().join(format!("toolknit-tkaes-test-{}", suffix));
        let encrypted_dir = root.join("encrypted");
        let decrypted_dir = root.join("decrypted");
        let rejected_dir = root.join("rejected");
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("document.txt");
        let payload = b"ToolKnit authenticated file container\n".repeat(64);
        std::fs::write(&input, &payload).unwrap();
        let token = || std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let encrypted = tkaes_encrypt_blocking(None, input.to_string_lossy().into_owned(), encrypted_dir.to_string_lossy().into_owned(), "correct horse battery staple".to_string(), "test-encrypt".to_string(), token()).unwrap();
        assert!(encrypted.output_path.ends_with("document.txt.tkaes"));
        let decrypted = tkaes_decrypt_blocking(None, encrypted.output_path.clone(), decrypted_dir.to_string_lossy().into_owned(), "correct horse battery staple".to_string(), "test-decrypt".to_string(), token()).unwrap();
        assert!(decrypted.output_path.ends_with("document.txt"));
        assert_eq!(std::fs::read(&decrypted.output_path).unwrap(), payload);

        let rejected = tkaes_decrypt_blocking(None, encrypted.output_path, rejected_dir.to_string_lossy().into_owned(), "wrong password".to_string(), "test-reject".to_string(), token());
        assert_eq!(rejected.unwrap_err(), "tkaes:authentication-failed");
        assert!(std::fs::read_dir(&rejected_dir).map(|mut entries| entries.next().is_none()).unwrap_or(true));
        std::fs::remove_dir_all(root).unwrap();
    }
}
