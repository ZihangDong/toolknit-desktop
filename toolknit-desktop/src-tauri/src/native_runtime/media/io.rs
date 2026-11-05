
pub(crate) fn is_path_safe(path: &std::path::Path) -> Result<(), String> {
    // Try to canonicalize the path. If it doesn't exist (e.g. a new output file
    // or a not-yet-created subdirectory), walk up ancestors until one exists.
    let canonical = path
        .canonicalize()
        .or_else(|_| {
            let mut ancestor = path.parent();
            while let Some(a) = ancestor {
                if let Ok(c) = a.canonicalize() {
                    return Ok(c);
                }
                ancestor = a.parent();
            }
            Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No existing ancestor",
            ))
        })
        .map_err(|e| format!("Invalid path: {}", e))?;
    let docs = dirs::document_dir().ok_or("Cannot find Documents folder")?;
    let dl = dirs::download_dir().ok_or("Cannot find Download folder")?;
    let appdata = dirs::data_dir().ok_or("Cannot find AppData folder")?;
    let temp = std::env::temp_dir();
    // Canonicalize all comparison dirs so prefixes match (Windows \\?\ prefix)
    let docs_c = docs.canonicalize().unwrap_or(docs.clone());
    let dl_c = dl.canonicalize().unwrap_or(dl.clone());
    let appdata_c = appdata.canonicalize().unwrap_or(appdata.clone());
    let temp_c = temp.canonicalize().unwrap_or(temp.clone());
    // Also allow the exe's parent directory (install directory) for output files
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        .and_then(|p| p.canonicalize().ok().or(Some(p)));
    // Also allow the install_path from install_config.json (may differ from exe_dir if exe is in a subdirectory)
    let install_dir = {
        let exe = std::env::current_exe().ok();
        exe.and_then(|e| {
            e.parent().and_then(|p| {
                let mut search = p.to_path_buf();
                for _ in 0..4 {
                    let candidate = search.join("install_config.json");
                    if candidate.exists() {
                        if let Ok(content) = std::fs::read_to_string(&candidate) {
                            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content)
                            {
                                if let Some(ip) = config.get("installPath").and_then(|v| v.as_str())
                                {
                                    let p = std::path::PathBuf::from(ip);
                                    return p.canonicalize().ok().or(Some(p));
                                }
                            }
                        }
                    }
                    match search.parent() {
                        Some(p2) => search = p2.to_path_buf(),
                        None => break,
                    }
                }
                None
            })
        })
    };
    let output_root = configured_output_root();
    let is_allowed = canonical.starts_with(&docs_c)
        || canonical.starts_with(&dl_c)
        || canonical.starts_with(&appdata_c)
        || canonical.starts_with(&temp_c)
        || exe_dir.as_ref().map_or(false, |d| canonical.starts_with(d))
        || install_dir
            .as_ref()
            .map_or(false, |d| canonical.starts_with(d))
        || output_root
            .as_ref()
            .map_or(false, |d| canonical.starts_with(d));
    if is_allowed {
        Ok(())
    } else {
        Err("Path outside allowed directories".to_string())
    }
}

#[tauri::command]
pub(crate) fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    // Reject files larger than 500MB to prevent OOM
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    if path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({}MB, max 500MB)",
            metadata.len() / 1024 / 1024
        ));
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub(crate) fn read_file_bytes_limited(path: String, max_bytes: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;

    const ABSOLUTE_MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    if path.contains('\0') || max_bytes == 0 || max_bytes > ABSOLUTE_MAX_FILE_SIZE {
        return Err("Invalid file read request".to_string());
    }

    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    if !metadata.is_file() {
        return Err("Input path must be a file".to_string());
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "File too large ({}MB)",
            metadata.len() / 1024 / 1024
        ));
    }

    // Read one byte past the limit so a concurrent file replacement cannot bypass the size check.
    let file = std::fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut reader = file.take(max_bytes + 1);
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "File too large (max {}MB)",
            max_bytes / 1024 / 1024
        ));
    }
    Ok(bytes)
}

#[derive(serde::Serialize)]
pub(crate) struct PreparedIconSourceImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) source_bytes: u64,
}

#[tauri::command]
pub(crate) fn prepare_icon_source_image(path: String) -> Result<PreparedIconSourceImage, String> {
    use image::ImageEncoder;

    const MAX_INPUT_BYTES: u64 = 20 * 1024 * 1024;
    const MAX_INPUT_PIXELS: u64 = 20_000_000;
    if path.contains('\0') {
        return Err("Invalid image path".to_string());
    }
    let source = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Cannot access image file: {}", error))?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("Only PNG, JPEG, and WebP images can be used for icon generation.".to_string());
    }
    let metadata = std::fs::metadata(&source)
        .map_err(|error| format!("Cannot read image file metadata: {}", error))?;
    if !metadata.is_file() {
        return Err("Input path must be an image file".to_string());
    }
    if metadata.len() == 0 || metadata.len() > MAX_INPUT_BYTES {
        return Err(
            "The image file is empty or exceeds the supported file size limit.".to_string(),
        );
    }

    let image = decode_oriented_image(&source)
        .map_err(|error| format!("Cannot decode image file: {}", error))?;
    let width = image.width();
    let height = image.height();
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > MAX_INPUT_PIXELS {
        return Err("Image dimensions exceed the supported pixel limit.".to_string());
    }

    let rgba = image.to_rgba8();
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(&rgba, width, height, image::ColorType::Rgba8.into())
        .map_err(|error| format!("Cannot prepare image for icon generation: {}", error))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err("Prepared image exceeds the supported file size limit.".to_string());
    }

    Ok(PreparedIconSourceImage {
        bytes,
        width,
        height,
        source_bytes: metadata.len(),
    })
}

#[tauri::command]
pub(crate) fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    let path = Path::new(&path);
    is_path_safe(path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(path, bytes).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub(crate) fn write_unique_file_bytes(
    directory: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::path::Path;

    if directory.contains('\0') || file_name.contains('\0') {
        return Err("Invalid path".to_string());
    }
    let directory = Path::new(&directory);
    let file_path = Path::new(&file_name);
    if file_path.is_absolute() || file_path.components().count() != 1 {
        return Err("Output file name must not contain a path".to_string());
    }
    is_path_safe(directory)?;
    fs::create_dir_all(directory).map_err(|e| format!("Failed to create directory: {}", e))?;

    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid output file name")?;
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for counter in 0..10_000_u32 {
        let candidate = if counter == 0 {
            file_name.clone()
        } else if extension.is_empty() {
            format!("{}_{}", stem, counter)
        } else {
            format!("{}_{}.{}", stem, counter, extension)
        };
        let output_path = directory.join(candidate);
        let mut output = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create output file: {}", error)),
        };

        if let Err(error) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(&output_path);
            return Err(format!("Failed to write output file: {}", error));
        }
        return Ok(output_path.to_string_lossy().into_owned());
    }

    Err("Unable to reserve a unique output file name".to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryOutputMetadata {
    directory: String,
    file_name: String,
}

fn decode_binary_output_metadata(
    encoded: &str,
    byte_count: usize,
) -> Result<BinaryOutputMetadata, String> {
    use base64::Engine;
    if byte_count == 0 || byte_count > 512 * 1024 * 1024 {
        return Err("Output file is empty or exceeds the 512MB limit".to_string());
    }
    if encoded.len() > 8000 {
        return Err("Output path is too long".to_string());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid output metadata".to_string())?;
    serde_json::from_slice(&decoded).map_err(|_| "Invalid output metadata".to_string())
}

#[tauri::command]
pub(crate) async fn write_unique_file_binary(
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Binary output requires a raw byte body".to_string()),
    };
    let encoded = request
        .headers()
        .get("x-toolknit-output")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing output metadata")?;
    let metadata = decode_binary_output_metadata(encoded, bytes.len())?;
    let owned_bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_unique_file_bytes(metadata.directory, metadata.file_name, owned_bytes)
    })
    .await
    .map_err(|_| "Cannot finish writing output file".to_string())?
}

#[cfg(test)]
mod binary_output_tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn binary_metadata_bounds_and_unicode() {
        let encode = |value: &str| base64::engine::general_purpose::STANDARD.encode(value);
        let valid = encode(r#"{"directory":"D:/测试目录","fileName":"结果.pdf"}"#);
        let metadata = decode_binary_output_metadata(&valid, 42_398_531).unwrap();
        assert_eq!(metadata.file_name, "结果.pdf");
        assert_eq!(metadata.directory, "D:/测试目录");
        assert!(decode_binary_output_metadata(&valid, 0).is_err());
        assert!(decode_binary_output_metadata(&valid, 512 * 1024 * 1024 + 1).is_err());
        assert!(decode_binary_output_metadata("!notbase64", 1).is_err());
        assert!(decode_binary_output_metadata(&"A".repeat(8001), 1).is_err());
        assert!(decode_binary_output_metadata(&encode(r#"{"directory":"D:/test"}"#), 1).is_err());
    }

    #[test]
    fn binary_write_keeps_unique_names_and_rejects_path_escape() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("toolknit-binary-{}-{}", std::process::id(), nonce));
        let directory_string = directory.to_string_lossy().to_string();
        let bytes = vec![0, 1, 128, 255];
        let first =
            write_unique_file_bytes(directory_string.clone(), "结果.pdf".into(), bytes.clone())
                .unwrap();
        let second =
            write_unique_file_bytes(directory_string.clone(), "结果.pdf".into(), vec![42]).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), bytes);
        assert_eq!(std::fs::read(second).unwrap(), vec![42]);
        for name in ["../escape.pdf", "..\\escape.pdf", "C:/escape.pdf", "bad\0.pdf"] {
            assert!(
                write_unique_file_bytes(directory_string.clone(), name.into(), vec![1]).is_err()
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[derive(serde::Serialize)]
pub(crate) struct PairedFileWriteResult {
    pub(crate) first_path: String,
    pub(crate) second_path: String,
}

#[tauri::command]
pub(crate) fn write_unique_file_pair(
    directory: String,
    first_file_name: String,
    first_bytes: Vec<u8>,
    second_file_name: String,
    second_bytes: Vec<u8>,
) -> Result<PairedFileWriteResult, String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::path::Path;

    const MAX_BYTES_PER_FILE: usize = 10 * 1024 * 1024;
    if directory.contains('\0')
        || first_file_name.contains('\0')
        || second_file_name.contains('\0')
        || first_bytes.len() > MAX_BYTES_PER_FILE
        || second_bytes.len() > MAX_BYTES_PER_FILE
    {
        return Err("Invalid paired output request".to_string());
    }
    let directory = Path::new(&directory);
    let first_path = Path::new(&first_file_name);
    let second_path = Path::new(&second_file_name);
    if first_file_name == second_file_name
        || first_path.is_absolute()
        || second_path.is_absolute()
        || first_path.components().count() != 1
        || second_path.components().count() != 1
    {
        return Err("Output file names must be distinct base names without paths".to_string());
    }
    is_path_safe(directory)?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create directory: {}", error))?;

    let first_stem = first_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid first output name")?;
    let first_extension = first_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let second_stem = second_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid second output name")?;
    let second_extension = second_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for counter in 0..10_000_u32 {
        let suffix = if counter == 0 {
            String::new()
        } else {
            format!("_{}", counter)
        };
        let first_name = if first_extension.is_empty() {
            format!("{}{}", first_stem, suffix)
        } else {
            format!("{}{}.{}", first_stem, suffix, first_extension)
        };
        let second_name = if second_extension.is_empty() {
            format!("{}{}", second_stem, suffix)
        } else {
            format!("{}{}.{}", second_stem, suffix, second_extension)
        };
        let first_output = directory.join(first_name);
        let second_output = directory.join(second_name);
        let mut first = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&first_output)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to create refined subtitle output: {}",
                    error
                ))
            }
        };
        if let Err(error) = first.write_all(&first_bytes).and_then(|_| first.sync_all()) {
            drop(first);
            let _ = fs::remove_file(&first_output);
            return Err(format!(
                "Failed to write refined subtitle output: {}",
                error
            ));
        }
        drop(first);
        let mut second = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&second_output)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&first_output);
                continue;
            }
            Err(error) => {
                let _ = fs::remove_file(&first_output);
                return Err(format!("Failed to create refined text output: {}", error));
            }
        };
        if let Err(error) = second
            .write_all(&second_bytes)
            .and_then(|_| second.sync_all())
        {
            drop(second);
            let _ = fs::remove_file(&first_output);
            let _ = fs::remove_file(&second_output);
            return Err(format!("Failed to write refined text output: {}", error));
        }
        return Ok(PairedFileWriteResult {
            first_path: first_output.to_string_lossy().into_owned(),
            second_path: second_output.to_string_lossy().into_owned(),
        });
    }
    Err("Unable to reserve paired output file names".to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownBundleAsset { pub(crate) file_name: String, pub(crate) bytes: Vec<u8> }

#[derive(serde::Serialize)]
pub(crate) struct MarkdownBundleResult { pub(crate) directory: String, pub(crate) markdown_path: String, pub(crate) asset_count: usize }

#[tauri::command]
pub(crate) fn export_markdown_bundle(output_root: String, base_name: String, markdown_bytes: Vec<u8>, assets: Vec<MarkdownBundleAsset>) -> Result<MarkdownBundleResult, String> {
    use std::io::Write;
    if output_root.trim().is_empty() || output_root.contains('\0') || markdown_bytes.len() > MARKDOWN_MAX_DOCUMENT_BYTES || assets.len() > MARKDOWN_MAX_ASSETS { return Err("markdown:invalid-export".to_string()); }
    let root = std::path::PathBuf::from(output_root).join("Markdown"); is_path_safe(&root)?; std::fs::create_dir_all(&root).map_err(|_| "markdown:output-dir".to_string())?;
    let clean = base_name.trim().replace(['<','>','"','/','\\','|','?','*',':'], "-").trim_end_matches([' ','.']).to_string(); let clean = if clean.is_empty() { "toolknit-document".to_string() } else { clean.chars().take(80).collect::<String>() };
    let mut asset_names = std::collections::BTreeSet::new(); let mut asset_bytes = 0usize;
    for asset in &assets { if asset.file_name.is_empty() || asset.file_name.contains(['\\','/','\0']) || asset.file_name == "." || asset.file_name == ".." || asset.bytes.len() > MARKDOWN_MAX_ASSET_BYTES || !asset_names.insert(asset.file_name.clone()) { return Err("markdown:invalid-asset".to_string()); } asset_bytes = asset_bytes.checked_add(asset.bytes.len()).ok_or("markdown:invalid-assets")?; if asset_bytes > MARKDOWN_MAX_TOTAL_ASSET_BYTES { return Err("markdown:assets-too-large".to_string()); } }
    for index in 0..10_000_u32 {
        let suffix = if index == 0 { String::new() } else { format!("_{}", index) }; let directory = root.join(format!("{}{}", clean, suffix)); if directory.exists() { continue; }
        let temporary = root.join(format!(".{}.part.{}", clean, std::process::id())); let _ = std::fs::remove_dir_all(&temporary); std::fs::create_dir_all(temporary.join("assets")).map_err(|_| "markdown:temp-dir".to_string())?;
        let write_result = (|| -> Result<(), String> {
            let mut markdown = std::fs::File::create(temporary.join(format!("{}.md", clean))).map_err(|_| "markdown:write-failed".to_string())?; markdown.write_all(&markdown_bytes).map_err(|_| "markdown:write-failed".to_string())?; markdown.sync_all().map_err(|_| "markdown:write-failed".to_string())?;
            for asset in &assets { if asset.file_name.is_empty() || asset.file_name.contains(['\\','/','\0']) || asset.bytes.len() > MARKDOWN_MAX_ASSET_BYTES { return Err("markdown:invalid-asset".to_string()); } let path=temporary.join("assets").join(&asset.file_name); let mut file=std::fs::File::create(path).map_err(|_| "markdown:asset-write-failed".to_string())?; file.write_all(&asset.bytes).map_err(|_| "markdown:asset-write-failed".to_string())?; file.sync_all().map_err(|_| "markdown:asset-write-failed".to_string())?; }
            Ok(())
        })();
        if let Err(error) = write_result { let _=std::fs::remove_dir_all(&temporary); return Err(error); }
        match std::fs::rename(&temporary, &directory) { Ok(()) => return Ok(MarkdownBundleResult { markdown_path: directory.join(format!("{}.md", clean)).to_string_lossy().into_owned(), directory: directory.to_string_lossy().into_owned(), asset_count: assets.len() }), Err(_) => { let _=std::fs::remove_dir_all(&temporary); continue; } }
    }
    Err("markdown:publish-failed".to_string())
}

#[cfg(test)]
mod paired_file_write_tests {
    use super::*;

    fn test_directory() -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("toolknit-paired-output-{}", suffix));
        std::fs::create_dir_all(&directory).expect("create test directory");
        directory
    }

    #[test]
    fn paired_write_uses_one_shared_unique_suffix_without_overwriting() {
        let directory = test_directory();
        let directory_string = directory.to_string_lossy().into_owned();

        let first = write_unique_file_pair(
            directory_string.clone(),
            "meeting_refined.srt".to_string(),
            b"first srt".to_vec(),
            "meeting_refined.txt".to_string(),
            b"first txt".to_vec(),
        )
        .expect("first pair should be written");
        let second = write_unique_file_pair(
            directory_string,
            "meeting_refined.srt".to_string(),
            b"second srt".to_vec(),
            "meeting_refined.txt".to_string(),
            b"second txt".to_vec(),
        )
        .expect("second pair should be uniquely written");

        assert!(first.first_path.ends_with("meeting_refined.srt"));
        assert!(first.second_path.ends_with("meeting_refined.txt"));
        assert!(second.first_path.ends_with("meeting_refined_1.srt"));
        assert!(second.second_path.ends_with("meeting_refined_1.txt"));
        assert_eq!(
            std::fs::read_to_string(&first.first_path).expect("read first SRT"),
            "first srt"
        );
        assert_eq!(
            std::fs::read_to_string(&second.second_path).expect("read second TXT"),
            "second txt"
        );

        std::fs::remove_dir_all(&directory).expect("remove test directory");
    }

    #[test]
    fn paired_write_rejects_paths_and_duplicate_file_names() {
        let directory = test_directory();
        let result = write_unique_file_pair(
            directory.to_string_lossy().into_owned(),
            "../unsafe.srt".to_string(),
            vec![],
            "unsafe.txt".to_string(),
            vec![],
        );
        assert!(result.is_err());

        let duplicate = write_unique_file_pair(
            directory.to_string_lossy().into_owned(),
            "same.txt".to_string(),
            vec![],
            "same.txt".to_string(),
            vec![],
        );
        assert!(duplicate.is_err());
        std::fs::remove_dir_all(&directory).expect("remove test directory");
    }
}

pub(crate) fn validate_icon_archive_file_name(file_name: &str) -> Result<(String, String), String> {
    if file_name.contains('\0') {
        return Err("Invalid icon archive file name".to_string());
    }
    let path = std::path::Path::new(file_name);
    if path.is_absolute() || path.components().count() != 1 {
        return Err("Icon archive file name must not contain a path".to_string());
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid icon archive file name")?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or("Icon archive file must use .zip")?;
    if stem.is_empty() || !extension.eq_ignore_ascii_case("zip") {
        return Err("Icon archive file must use .zip".to_string());
    }
    Ok((stem.to_string(), extension.to_string()))
}

pub(crate) fn unique_icon_archive_path(
    directory: &std::path::Path,
    file_name: &str,
    counter: u32,
) -> Result<std::path::PathBuf, String> {
    let (stem, extension) = validate_icon_archive_file_name(file_name)?;
    let candidate = if counter == 0 {
        format!("{}.{}", stem, extension)
    } else {
        format!("{}_{}.{}", stem, counter, extension)
    };
    Ok(directory.join(candidate))
}

#[tauri::command]
pub(crate) fn begin_icon_archive_write(directory: String, file_name: String) -> Result<u64, String> {
    if directory.contains('\0') {
        return Err("Invalid icon archive output directory".to_string());
    }
    validate_icon_archive_file_name(&file_name)?;
    let output_directory = std::path::PathBuf::from(directory);
    is_path_safe(&output_directory)?;
    std::fs::create_dir_all(&output_directory)
        .map_err(|error| format!("Failed to create icon output directory: {}", error))?;
    if !output_directory.is_dir() {
        return Err("Icon archive output path is not a directory".to_string());
    }
    let output_directory = output_directory
        .canonicalize()
        .map_err(|error| format!("Invalid icon output directory: {}", error))?;
    is_path_safe(&output_directory)?;

    for _ in 0..10_000 {
        let session_id = ICON_ARCHIVE_WRITE_ID.fetch_add(1, Ordering::SeqCst);
        let temporary_path = output_directory.join(format!(
            ".toolknit-icon-{}-{}.part",
            std::process::id(),
            session_id
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(_) => {
                let write = IconArchiveWrite {
                    temporary_path,
                    output_directory,
                    file_name,
                };
                icon_archive_writes()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .insert(session_id, write);
                return Ok(session_id);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create icon archive: {}", error)),
        }
    }
    Err("Unable to reserve icon archive output".to_string())
}

#[tauri::command]
pub(crate) fn append_icon_archive_chunk(session_id: u64, bytes: Vec<u8>) -> Result<(), String> {
    use std::io::Write;

    if bytes.is_empty() {
        return Err("Icon archive chunk is empty".to_string());
    }
    let temporary_path = icon_archive_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&session_id)
        .map(|write| write.temporary_path.clone())
        .ok_or("Icon archive write session is unavailable")?;
    let current_size = std::fs::metadata(&temporary_path)
        .map_err(|error| format!("Cannot inspect icon archive: {}", error))?
        .len();
    let next_size = current_size
        .checked_add(bytes.len() as u64)
        .ok_or("Icon archive is too large")?;
    if next_size > MAX_ICON_ARCHIVE_BYTES {
        return Err("Icon archive exceeds the 32 MB limit".to_string());
    }
    let mut output = std::fs::OpenOptions::new()
        .append(true)
        .open(&temporary_path)
        .map_err(|error| format!("Cannot append icon archive: {}", error))?;
    output
        .write_all(&bytes)
        .map_err(|error| format!("Cannot write icon archive: {}", error))
}

#[tauri::command]
pub(crate) fn finalize_icon_archive_write(session_id: u64) -> Result<String, String> {
    let write = icon_archive_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&session_id)
        .ok_or("Icon archive write session is unavailable")?;
    let result = (|| {
        let size = std::fs::metadata(&write.temporary_path)
            .map_err(|error| format!("Cannot inspect icon archive: {}", error))?
            .len();
        if size == 0 || size > MAX_ICON_ARCHIVE_BYTES {
            return Err("Icon archive has an invalid size".to_string());
        }
        for counter in 0..10_000_u32 {
            let output_path =
                unique_icon_archive_path(&write.output_directory, &write.file_name, counter)?;
            match std::fs::hard_link(&write.temporary_path, &output_path) {
                Ok(()) => return Ok(cleanup_display_path(&output_path)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Cannot publish icon archive: {}", error)),
            }
        }
        Err("Unable to reserve a unique icon archive name".to_string())
    })();
    let _ = std::fs::remove_file(&write.temporary_path);
    result
}

#[tauri::command]
pub(crate) fn discard_icon_archive_write(session_id: u64) -> Result<(), String> {
    let write = icon_archive_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&session_id)
        .ok_or("Icon archive write session is unavailable")?;
    std::fs::remove_file(&write.temporary_path)
        .map_err(|error| format!("Cannot discard icon archive: {}", error))
}

pub(crate) fn validate_pdf_enhance_file_name(file_name: &str) -> Result<String, String> {
    if file_name.contains('\0')
        || file_name.encode_utf16().count() > 240
        || file_name
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return Err("pdf-enhance:output-path".to_string());
    }
    let path = std::path::Path::new(file_name);
    if path.is_absolute() || path.components().count() != 1 {
        return Err("pdf-enhance:output-path".to_string());
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or("pdf-enhance:output-path")?;
    let is_pdf = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("pdf-enhance:output-path".to_string());
    }
    let normalized_stem = stem.trim_end_matches(['.', ' ']).to_ascii_uppercase();
    let is_reserved = matches!(
        normalized_stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$"
    ) || (normalized_stem.len() == 4
        && (normalized_stem.starts_with("COM") || normalized_stem.starts_with("LPT"))
        && normalized_stem
            .as_bytes()
            .last()
            .copied()
            .is_some_and(|value| matches!(value, b'1'..=b'9')));
    if normalized_stem != stem.to_ascii_uppercase() || is_reserved {
        return Err("pdf-enhance:output-path".to_string());
    }
    Ok(stem.to_string())
}

pub(crate) fn unique_pdf_enhance_path(
    directory: &std::path::Path,
    file_name: &str,
    counter: u32,
) -> Result<std::path::PathBuf, String> {
    let stem = validate_pdf_enhance_file_name(file_name)?;
    let candidate = if counter == 0 {
        format!("{}.pdf", stem)
    } else {
        format!("{}_{}.pdf", stem, counter)
    };
    Ok(directory.join(candidate))
}

#[tauri::command]
pub(crate) fn begin_pdf_enhance_write(
    directory: String,
    file_name: String,
    expected_pages: u32,
) -> Result<u64, String> {
    if expected_pages == 0 || expected_pages > MAX_PDF_ENHANCE_PAGES {
        return Err("pdf-enhance:too-many-pages".to_string());
    }
    if directory.contains('\0') {
        return Err("pdf-enhance:output-path".to_string());
    }
    validate_pdf_enhance_file_name(&file_name)?;

    let output_directory = std::path::PathBuf::from(directory);
    is_path_safe(&output_directory).map_err(|_| "pdf-enhance:output-path".to_string())?;
    std::fs::create_dir_all(&output_directory)
        .map_err(|_| "pdf-enhance:output-path".to_string())?;
    if !output_directory.is_dir() {
        return Err("pdf-enhance:output-path".to_string());
    }
    let output_directory = output_directory
        .canonicalize()
        .map_err(|_| "pdf-enhance:output-path".to_string())?;
    is_path_safe(&output_directory).map_err(|_| "pdf-enhance:output-path".to_string())?;

    let mut writes = pdf_enhance_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if writes.len() >= MAX_PDF_ENHANCE_WRITE_SESSIONS {
        return Err("pdf-enhance:enhancement-failed".to_string());
    }

    for _ in 0..10_000 {
        let session_id = PDF_ENHANCE_WRITE_ID.fetch_add(1, Ordering::SeqCst);
        let temporary_path = output_directory.join(format!(
            ".toolknit-pdf-enhance-{}-{}.part",
            std::process::id(),
            session_id
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => {
                writes.insert(
                    session_id,
                    PdfEnhanceWrite {
                        file,
                        temporary_path,
                        output_directory,
                        file_name,
                        expected_pages,
                        bytes_written: 0,
                    },
                );
                return Ok(session_id);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("pdf-enhance:output-path".to_string()),
        }
    }
    Err("pdf-enhance:output-path".to_string())
}

#[tauri::command]
pub(crate) fn append_pdf_enhance_chunk(session_id: u64, bytes: Vec<u8>) -> Result<(), String> {
    use std::io::Write;

    if bytes.is_empty() {
        return Err("pdf-enhance:enhancement-failed".to_string());
    }
    let mut writes = pdf_enhance_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let write = writes
        .get_mut(&session_id)
        .ok_or("pdf-enhance:enhancement-failed")?;
    let next_size = write
        .bytes_written
        .checked_add(bytes.len() as u64)
        .ok_or("pdf-enhance:output-too-large")?;
    if next_size > MAX_PDF_ENHANCE_OUTPUT_BYTES {
        return Err("pdf-enhance:output-too-large".to_string());
    }
    write
        .file
        .write_all(&bytes)
        .map_err(|_| "pdf-enhance:enhancement-failed".to_string())?;
    write.bytes_written = next_size;
    Ok(())
}

pub(crate) async fn validate_pdf_enhance_output(
    path: &std::path::Path,
    expected_pages: u32,
) -> Result<(), String> {
    let qpdf_path = get_qpdf_path().map_err(|_| "pdf-enhance:enhancement-failed".to_string())?;
    let qpdf_input_path = std::path::PathBuf::from(cleanup_display_path(path));
    let check_output = run_qpdf_with_stdin(
        &qpdf_path,
        &[
            std::ffi::OsString::from("--warning-exit-0"),
            std::ffi::OsString::from("--check"),
            qpdf_input_path.as_os_str().to_os_string(),
        ],
        None,
        false,
        "pdf-enhance:enhancement-failed",
    )
    .await?;
    if !check_output.status.success() {
        return Err("pdf-enhance:enhancement-failed".to_string());
    }

    let page_output = run_qpdf_with_stdin(
        &qpdf_path,
        &[
            std::ffi::OsString::from("--show-npages"),
            qpdf_input_path.as_os_str().to_os_string(),
        ],
        None,
        true,
        "pdf-enhance:enhancement-failed",
    )
    .await?;
    let page_count = String::from_utf8_lossy(&page_output.stdout)
        .trim()
        .parse::<u32>()
        .ok();
    if !page_output.status.success() || page_count != Some(expected_pages) {
        return Err("pdf-enhance:enhancement-failed".to_string());
    }
    Ok(())
}

pub(crate) fn publish_pdf_enhance_output(
    temporary_path: &std::path::Path,
    output_directory: &std::path::Path,
    file_name: &str,
) -> Result<String, String> {
    for counter in 0..10_000_u32 {
        let output_path = unique_pdf_enhance_path(output_directory, file_name, counter)?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

            let source_wide = temporary_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let output_wide = output_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let move_result = unsafe {
                MoveFileExW(
                    PCWSTR(source_wide.as_ptr()),
                    PCWSTR(output_wide.as_ptr()),
                    MOVE_FILE_FLAGS(0),
                )
            };
            match move_result {
                Ok(()) => return Ok(cleanup_display_path(&output_path)),
                Err(_) if output_path.exists() => continue,
                Err(_) => return Err("pdf-enhance:output-path".to_string()),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            match std::fs::hard_link(temporary_path, &output_path) {
                Ok(()) => {
                    let _ = std::fs::remove_file(temporary_path);
                    return Ok(cleanup_display_path(&output_path));
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("pdf-enhance:output-path".to_string()),
            }
        }
    }
    Err("pdf-enhance:output-path".to_string())
}

#[tauri::command]
pub(crate) async fn finalize_pdf_enhance_write(session_id: u64) -> Result<String, String> {
    let write = pdf_enhance_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&session_id)
        .ok_or("pdf-enhance:enhancement-failed")?;
    let PdfEnhanceWrite {
        file,
        temporary_path,
        output_directory,
        file_name,
        expected_pages,
        bytes_written,
    } = write;

    let sync_result = file.sync_all();
    drop(file);
    if bytes_written == 0 || bytes_written > MAX_PDF_ENHANCE_OUTPUT_BYTES || sync_result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
        return Err("pdf-enhance:enhancement-failed".to_string());
    }
    if let Err(error) = validate_pdf_enhance_output(&temporary_path, expected_pages).await {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(error);
    }
    let result = publish_pdf_enhance_output(
        &temporary_path,
        &output_directory,
        &file_name,
    );
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[tauri::command]
pub(crate) fn discard_pdf_enhance_write(session_id: u64) -> Result<(), String> {
    let write = pdf_enhance_writes()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&session_id)
        .ok_or("pdf-enhance:enhancement-failed")?;
    let temporary_path = write.temporary_path.clone();
    drop(write);
    match std::fs::remove_file(temporary_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("pdf-enhance:enhancement-failed".to_string()),
    }
}

#[cfg(test)]
mod pdf_enhance_write_tests {
    use super::*;

    fn test_directory() -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "toolknit-pdf-enhance-write-{}-{}",
            std::process::id(),
            suffix
        ));
        std::fs::create_dir_all(&directory).expect("create PDF enhance test directory");
        directory
    }

    #[test]
    fn pdf_enhance_chunk_session_discards_partial_output() {
        let directory = test_directory();
        assert!(begin_pdf_enhance_write(
            directory.to_string_lossy().into_owned(),
            "stream:name.pdf".to_string(),
            1,
        )
        .is_err());
        assert!(begin_pdf_enhance_write(
            directory.to_string_lossy().into_owned(),
            "CON.pdf".to_string(),
            1,
        )
        .is_err());
        let session_id = begin_pdf_enhance_write(
            directory.to_string_lossy().into_owned(),
            "scan_enhanced.pdf".to_string(),
            1,
        )
        .expect("begin PDF enhance write");
        append_pdf_enhance_chunk(session_id, b"partial".to_vec())
            .expect("append PDF enhance chunk");
        let temporary_path = pdf_enhance_writes()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&session_id)
            .expect("PDF enhance write session")
            .temporary_path
            .clone();
        assert!(temporary_path.exists());
        discard_pdf_enhance_write(session_id).expect("discard PDF enhance write");
        assert!(!temporary_path.exists());
        assert!(!directory.join("scan_enhanced.pdf").exists());
        std::fs::remove_dir_all(directory).expect("remove PDF enhance test directory");
    }

    #[test]
    fn pdf_enhance_publish_never_overwrites_an_existing_file() {
        let directory = test_directory();
        let existing = directory.join("scan_enhanced.pdf");
        let temporary = directory.join(".validated.part");
        std::fs::write(&existing, b"existing").expect("write existing output");
        std::fs::write(&temporary, b"validated").expect("write validated output");
        let published = publish_pdf_enhance_output(
            &temporary,
            &directory,
            "scan_enhanced.pdf",
        )
        .expect("publish unique PDF enhance output");
        assert!(published.ends_with("scan_enhanced_1.pdf"));
        assert_eq!(std::fs::read(existing).expect("read existing output"), b"existing");
        assert_eq!(
            std::fs::read(&published).expect("read published output"),
            b"validated"
        );
        assert!(!temporary.exists());
        std::fs::remove_dir_all(directory).expect("remove PDF enhance test directory");
    }

    #[tokio::test]
    async fn pdf_enhance_validation_removes_invalid_staging_file() {
        if get_qpdf_path().is_err() {
            return;
        }
        let directory = test_directory();
        let session_id = begin_pdf_enhance_write(
            directory.to_string_lossy().into_owned(),
            "broken_enhanced.pdf".to_string(),
            1,
        )
        .expect("begin invalid PDF enhance write");
        append_pdf_enhance_chunk(session_id, b"%PDF-1.7\ninvalid".to_vec())
            .expect("append invalid PDF bytes");
        assert!(finalize_pdf_enhance_write(session_id).await.is_err());
        let entries = std::fs::read_dir(&directory)
            .expect("read PDF enhance test directory")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect PDF enhance test entries");
        assert!(entries.is_empty());
        std::fs::remove_dir_all(directory).expect("remove PDF enhance test directory");
    }
}

#[tauri::command]
pub(crate) fn write_file_chunk(path: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::{Seek, SeekFrom, Write};
    is_path_safe(std::path::Path::new(&path))?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(&path)
        .map_err(|e| format!("Failed to open file: {}", e))?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("Failed to seek: {}", e))?;
    }
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write: {}", e))
}

#[tauri::command]
pub(crate) fn exists_path(path: String) -> Result<bool, String> {
    if path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub(crate) fn get_file_size(path: String) -> Result<u64, String> {
    if path.contains('\0') {
        return Err("Invalid path".to_string());
    }
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to read file metadata: {}", e))
}
