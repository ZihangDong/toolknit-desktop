// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_DOCX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DOCX_CHUNK: usize = 2 * 1024 * 1024;
const MAX_DOCX_IMAGE_SIDE: u32 = 8_192;
const MAX_DOCX_IMAGE_PIXELS: u64 = 16_000_000;
const WRITE_LIFETIME: Duration = Duration::from_secs(600);
static DOCX_WRITES: OnceLock<Mutex<BTreeMap<String, Arc<DocxWrite>>>> = OnceLock::new();

struct PendingDocx {
    file: Option<std::fs::File>,
    temporary: PathBuf,
    directory: PathBuf,
    name: String,
    expected: u64,
    written: u64,
}
impl Drop for PendingDocx {
    fn drop(&mut self) {
        self.file.take();
        let _ = std::fs::remove_file(&self.temporary);
    }
}
struct DocxWrite {
    data: Mutex<Option<PendingDocx>>,
    cancelled: std::sync::atomic::AtomicBool,
    deadline: Instant,
}
fn writes() -> &'static Mutex<BTreeMap<String, Arc<DocxWrite>>> {
    DOCX_WRITES.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn failure(code: &str) -> String {
    format!("pdf-to-word:{code}")
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err(failure("permission"));
    }
    Ok(())
}
fn file_stem(name: &str) -> Result<&str, String> {
    let stem = name
        .strip_suffix(".docx")
        .ok_or_else(|| failure("output-name"))?;
    if stem.is_empty()
        || stem.len() > 400
        || stem.ends_with(['.', ' '])
        || stem
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err(failure("output-name"));
    }
    let first = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(first.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (first.starts_with("COM") || first.starts_with("LPT"))
            && first.len() == 4
            && first.as_bytes()[3].is_ascii_digit()
    {
        return Err(failure("output-name"));
    }
    Ok(stem)
}
fn safe_directory(directory: &Path) -> Result<PathBuf, String> {
    if !directory.is_absolute() {
        return Err(failure("output-path"));
    }
    is_path_safe(directory).map_err(|_| failure("output-path"))?;
    for ancestor in directory.ancestors() {
        if let Ok(meta) = std::fs::symlink_metadata(ancestor) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(failure("output-path"));
                }
            }
            if meta.file_type().is_symlink() {
                return Err(failure("output-path"));
            }
        }
    }
    std::fs::create_dir_all(directory).map_err(|_| failure("output-path"))?;
    let resolved = directory
        .canonicalize()
        .map_err(|_| failure("output-path"))?;
    is_path_safe(&resolved).map_err(|_| failure("output-path"))?;
    Ok(resolved)
}
fn begin_write(directory: PathBuf, name: String, expected: u64) -> Result<String, String> {
    file_stem(&name)?;
    if !(100..=MAX_DOCX_BYTES).contains(&expected) {
        return Err(failure("output-large"));
    }
    let directory = safe_directory(&directory)?;
    let mut sessions = writes().lock().unwrap_or_else(|e| e.into_inner());
    sessions.retain(|_, session| {
        if Instant::now() >= session.deadline {
            session.cancelled.store(true, Ordering::SeqCst);
            session
                .data
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            false
        } else {
            true
        }
    });
    if !sessions.is_empty() {
        return Err(failure("busy"));
    }
    let mut nonce = [0_u8; 24];
    getrandom::getrandom(&mut nonce).map_err(|_| failure("output-path"))?;
    let id = hex::encode(nonce);
    let temporary = directory.join(format!(".toolknit-docx-{id}.partial"));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| failure("output-path"))?;
    sessions.insert(
        id.clone(),
        Arc::new(DocxWrite {
            data: Mutex::new(Some(PendingDocx {
                file: Some(file),
                temporary,
                directory,
                name,
                expected,
                written: 0,
            })),
            cancelled: std::sync::atomic::AtomicBool::new(false),
            deadline: Instant::now() + WRITE_LIFETIME,
        }),
    );
    Ok(id)
}
fn get_write(id: &str) -> Result<Arc<DocxWrite>, String> {
    let session = writes()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned()
        .ok_or_else(|| failure("session"))?;
    if session.cancelled.load(Ordering::SeqCst) || Instant::now() >= session.deadline {
        return Err(failure("cancelled"));
    }
    Ok(session)
}
fn append_write(id: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_DOCX_CHUNK {
        return Err(failure("output-large"));
    }
    let session = get_write(id)?;
    let mut guard = session.data.lock().unwrap_or_else(|e| e.into_inner());
    let data = guard.as_mut().ok_or_else(|| failure("session"))?;
    if data.written != offset || bytes.len() as u64 > data.expected.saturating_sub(offset) {
        return Err(failure("output-invalid"));
    }
    data.file
        .as_mut()
        .ok_or_else(|| failure("session"))?
        .write_all(bytes)
        .map_err(|_| failure("output-path"))?;
    data.written += bytes.len() as u64;
    Ok(())
}

fn validate_xml(data: &[u8], name: &str, names: &BTreeSet<String>) -> Result<(), String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(data);
    let mut depth = 0_usize;
    let mut roots = 0_usize;
    let mut main_type = false;
    let mut has_body = false;
    let decoder = reader.decoder();
    loop {
        match reader.read_event().map_err(|_| failure("output-invalid"))? {
            Event::Start(element) | Event::Empty(element) => {
                if depth == 0 {
                    roots += 1;
                    let expected = match name {
                        "[Content_Types].xml" => Some(b"Types".as_slice()),
                        "word/document.xml" => Some(b"document".as_slice()),
                        "word/styles.xml" => Some(b"styles".as_slice()),
                        _ if name.ends_with(".rels") => Some(b"Relationships".as_slice()),
                        _ => None,
                    };
                    if expected.is_some_and(|value| element.local_name().as_ref() != value) {
                        return Err(failure("output-invalid"));
                    }
                }
                // Empty elements do not alter depth; determine from the consumed XML token.
                let is_empty =
                    data.get(reader.buffer_position().saturating_sub(2) as usize) == Some(&b'/');
                if !is_empty {
                    depth += 1;
                }
                if depth > 128 || roots > 1 {
                    return Err(failure("output-invalid"));
                }
                if name == "word/document.xml" && element.local_name().as_ref() == b"body" {
                    has_body = true;
                }
                if name == "[Content_Types].xml" && element.local_name().as_ref() == b"Override" {
                    let mut part = None;
                    let mut content = None;
                    for attr in element.attributes() {
                        let attr = attr.map_err(|_| failure("output-invalid"))?;
                        let value = attr
                            .decoded_and_normalized_value(
                                quick_xml::XmlVersion::Explicit1_0,
                                decoder,
                            )
                            .map_err(|_| failure("output-invalid"))?;
                        if value.to_ascii_lowercase().contains("macroenabled") {
                            return Err(failure("output-invalid"));
                        }
                        if attr.key.as_ref() == b"PartName" {
                            part = Some(value.to_string());
                        }
                        if attr.key.as_ref() == b"ContentType" {
                            content = Some(value.into_owned());
                        }
                    }
                    if part.as_deref() == Some("/word/document.xml") {
                        if content.as_deref() != Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") { return Err(failure("output-invalid")); }
                        main_type = true;
                    }
                }
                if element.local_name().as_ref() == b"Relationship" {
                    let mut target = None;
                    for attr in element.attributes() {
                        let attr = attr.map_err(|_| failure("output-invalid"))?;
                        let value = attr
                            .decoded_and_normalized_value(
                                quick_xml::XmlVersion::Explicit1_0,
                                decoder,
                            )
                            .map_err(|_| failure("output-invalid"))?;
                        if attr.key.as_ref() == b"TargetMode" && value != "Internal" {
                            return Err(failure("output-invalid"));
                        }
                        if attr.key.as_ref() == b"Type"
                            && (value.contains("oleObject")
                                || value.contains("attachedTemplate")
                                || value.contains("aFChunk")
                                || value.contains("vbaProject"))
                        {
                            return Err(failure("output-invalid"));
                        }
                        if attr.key.as_ref() == b"Target" {
                            target = Some(value.into_owned());
                        }
                    }
                    let target = target.ok_or_else(|| failure("output-invalid"))?;
                    if target.contains(['\\', ':', '#', '?', '%'])
                        || target.starts_with('/')
                        || target.split('/').any(|p| p == ".." || p.is_empty())
                    {
                        return Err(failure("output-invalid"));
                    }
                    let prefix = name
                        .rsplit_once("/_rels/")
                        .map(|(base, _)| format!("{base}/"))
                        .unwrap_or_default();
                    if !names.contains(&format!("{prefix}{target}")) {
                        return Err(failure("output-invalid"));
                    }
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| failure("output-invalid"))?;
            }
            Event::DocType(_) | Event::PI(_) => return Err(failure("output-invalid")),
            Event::Eof => break,
            _ => {}
        }
    }
    if roots != 1
        || depth != 0
        || name == "[Content_Types].xml" && !main_type
        || name == "word/document.xml" && !has_body
    {
        return Err(failure("output-invalid"));
    }
    Ok(())
}
fn jpeg_part(name: &str) -> bool {
    name.strip_prefix("word/media/").is_some_and(|file| {
        !file.contains('/') && (file.ends_with(".jpg") || file.ends_with(".jpeg"))
    })
}

fn validate_jpeg(data: &[u8]) -> Result<(), String> {
    if !data.starts_with(b"\xff\xd8\xff") || !data.ends_with(b"\xff\xd9") {
        return Err(failure("output-invalid"));
    }
    let (width, height) =
        image::ImageReader::with_format(std::io::Cursor::new(data), image::ImageFormat::Jpeg)
            .into_dimensions()
            .map_err(|_| failure("output-invalid"))?;
    if width == 0
        || height == 0
        || width > MAX_DOCX_IMAGE_SIDE
        || height > MAX_DOCX_IMAGE_SIDE
        || u64::from(width) * u64::from(height) > MAX_DOCX_IMAGE_PIXELS
    {
        return Err(failure("output-large"));
    }
    Ok(())
}

pub(crate) fn validate_docx_file(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|_| failure("output-path"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| failure("output-invalid"))?;
    if zip.len() > 4000 || zip.len() < 4 {
        return Err(failure("output-invalid"));
    }
    let mut names = BTreeSet::new();
    let mut expanded = 0_u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|_| failure("output-invalid"))?;
        let name = entry.name().map_err(|_| failure("output-invalid"))?;
        let lower = name.to_ascii_lowercase();
        if name.len() > 240
            || name.contains(['\\', ':', '%'])
            || name.starts_with('/')
            || name.split('/').any(|p| p == "..")
            || lower.contains("vba")
            || lower.contains("activex")
            || lower.contains("embeddings")
            || !names.insert(name.to_string())
            || entry.enclosed_name().is_none()
        {
            return Err(failure("output-invalid"));
        }
        if !entry.is_dir()
            && !(lower.ends_with(".xml")
                || lower.ends_with(".rels")
                || lower.ends_with(".png")
                || jpeg_part(&lower))
        {
            return Err(failure("output-invalid"));
        }
        if entry.size() > 64 * 1024 * 1024 {
            return Err(failure("output-large"));
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| failure("output-large"))?;
        if expanded > 256 * 1024 * 1024 {
            return Err(failure("output-large"));
        }
    }
    for required in [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/styles.xml",
    ] {
        if !names.contains(required) {
            return Err(failure("output-invalid"));
        }
    }
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| failure("output-invalid"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry
            .name()
            .map_err(|_| failure("output-invalid"))?
            .into_owned();
        let length = entry.size();
        let mut data = Vec::with_capacity(length.min(1024 * 1024) as usize);
        (&mut entry)
            .take(length + 1)
            .read_to_end(&mut data)
            .map_err(|_| failure("output-invalid"))?;
        if data.len() as u64 != length {
            return Err(failure("output-invalid"));
        }
        if name.ends_with(".xml") || name.ends_with(".rels") {
            validate_xml(&data, &name, &names)?;
        } else if jpeg_part(&name.to_ascii_lowercase()) {
            validate_jpeg(&data)?;
        } else if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err(failure("output-invalid"));
        }
    }
    Ok(())
}

fn publish(data: &PendingDocx) -> Result<String, String> {
    let stem = file_stem(&data.name)?;
    safe_directory(&data.directory)?;
    for number in 0..10_000 {
        let name = if number == 0 {
            data.name.clone()
        } else {
            format!("{stem}_{number}.docx")
        };
        let destination = data.directory.join(name);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};
            let source = data
                .temporary
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let target = destination
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            match unsafe {
                MoveFileExW(
                    PCWSTR(source.as_ptr()),
                    PCWSTR(target.as_ptr()),
                    MOVE_FILE_FLAGS(0),
                )
            } {
                Ok(()) => return Ok(cleanup_display_path(&destination)),
                Err(_) if destination.exists() => continue,
                Err(_) => return Err(failure("output-path")),
            }
        }
        #[cfg(not(windows))]
        match std::fs::hard_link(&data.temporary, &destination) {
            Ok(()) => return Ok(cleanup_display_path(&destination)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(failure("output-path")),
        }
    }
    Err(failure("output-path"))
}
fn finalize_write(id: &str) -> Result<String, String> {
    let session = get_write(id)?;
    let result = (|| {
        let mut data = session
            .data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .ok_or_else(|| failure("session"))?;
        data.file
            .take()
            .ok_or_else(|| failure("session"))?
            .sync_all()
            .map_err(|_| failure("output-path"))?;
        if data.written != data.expected
            || std::fs::metadata(&data.temporary)
                .map_err(|_| failure("output-path"))?
                .len()
                != data.expected
        {
            return Err(failure("output-invalid"));
        }
        validate_docx_file(&data.temporary)?;
        // Serialize cancellation and publication on the registry lock.
        let sessions = writes().lock().unwrap_or_else(|e| e.into_inner());
        if !sessions.contains_key(id)
            || session.cancelled.load(Ordering::SeqCst)
            || Instant::now() >= session.deadline
        {
            return Err(failure("cancelled"));
        }
        publish(&data)
    })();
    writes()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id);
    result
}
fn discard_write(id: &str) {
    if let Some(session) = writes()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id)
    {
        session.cancelled.store(true, Ordering::SeqCst);
        session
            .data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
    }
}

#[tauri::command]
pub(crate) async fn begin_pdf_to_word_write(
    window: tauri::WebviewWindow,
    directory: String,
    file_name: String,
    expected_bytes: u64,
) -> Result<String, String> {
    main_window(&window)?;
    let id = tokio::task::spawn_blocking(move || {
        begin_write(PathBuf::from(directory), file_name, expected_bytes)
    })
    .await
    .map_err(|_| failure("output-path"))??;
    let expiry = id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WRITE_LIFETIME).await;
        discard_write(&expiry);
    });
    Ok(id)
}
#[tauri::command]
pub(crate) async fn append_pdf_to_word_chunk(
    window: tauri::WebviewWindow,
    session_id: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    main_window(&window)?;
    tokio::task::spawn_blocking(move || append_write(&session_id, offset, &bytes))
        .await
        .map_err(|_| failure("output-path"))?
}
#[tauri::command]
pub(crate) async fn finalize_pdf_to_word_write(
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<String, String> {
    main_window(&window)?;
    tokio::task::spawn_blocking(move || finalize_write(&session_id))
        .await
        .map_err(|_| failure("output-path"))?
}
#[tauri::command]
pub(crate) fn discard_pdf_to_word_write(
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    main_window(&window)?;
    discard_write(&session_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_pdf_to_word_result(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<(), String> {
    main_window(&window)?;
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(path);
        if !path.is_absolute() || path.extension().and_then(|ext| ext.to_str()) != Some("docx") {
            return Err(failure("output-path"));
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|_| failure("output-path"))?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_DOCX_BYTES {
            return Err(failure("output-path"));
        }
        is_path_safe(&path).map_err(|_| failure("output-path"))?;
        validate_docx_file(&path)?;
        opener::open(path).map_err(|_| failure("output-path"))
    })
    .await
    .map_err(|_| failure("output-path"))?
}

#[cfg(test)]
mod docx_write_tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn package(external: bool) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let relationships = if external {
            r#"<Relationships><Relationship Target="https://example.test/payload" TargetMode="External"/></Relationships>"#
        } else {
            r#"<Relationships><Relationship Target="word/document.xml"/></Relationships>"#
        };
        for (name, content) in [
            (
                "[Content_Types].xml",
                r#"<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
            ("_rels/.rels", relationships),
            (
                "word/document.xml",
                "<document><body><paragraph>Sample</paragraph></body></document>",
            ),
            ("word/styles.xml", "<styles/>"),
        ] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn docx_part_names_preserve_unicode_and_reject_unsafe_paths() {
        let mut nonce = [0_u8; 12];
        getrandom::getrandom(&mut nonce).unwrap();
        let folder = std::env::temp_dir().join(format!("toolknit-docx-names-{}", hex::encode(nonce)));
        std::fs::create_dir(&folder).unwrap();
        let file = folder.join("names.docx");
        for (name, valid) in [
            ("word/\u{e9}.xml", true),
            ("../outside.xml", false),
            ("word/%2e%2e/outside.xml", false),
            ("word\\outside.xml", false),
        ] {
            let mut writer = zip::ZipWriter::new_append(std::io::Cursor::new(package(false))).unwrap();
            writer.start_file(name, SimpleFileOptions::default()).unwrap();
            writer.write_all(b"<part/>").unwrap();
            std::fs::write(&file, writer.finish().unwrap().into_inner()).unwrap();
            assert_eq!(validate_docx_file(&file).is_ok(), valid, "{name}");
        }
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn docx_jpeg_media_is_bounded_and_cannot_disguise_other_parts() {
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            2,
            2,
            image::Rgb([90, 160, 220]),
        ))
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg),
            image::ImageFormat::Jpeg,
        )
        .unwrap();
        validate_jpeg(&jpeg).unwrap();
        assert!(validate_jpeg(b"\xff\xd8\xff\xd9").is_err());
        assert!(validate_jpeg(&jpeg[..jpeg.len() - 2]).is_err());
        let marker = jpeg
            .windows(2)
            .position(|bytes| bytes == b"\xff\xc0")
            .unwrap();
        for (width, height) in [(8193_u16, 2_u16), (4096, 4097), (0, 2)] {
            let mut oversized = jpeg.clone();
            oversized[marker + 5..marker + 7].copy_from_slice(&height.to_be_bytes());
            oversized[marker + 7..marker + 9].copy_from_slice(&width.to_be_bytes());
            assert!(validate_jpeg(&oversized).is_err());
        }
        let mut nonce = [0_u8; 12];
        getrandom::getrandom(&mut nonce).unwrap();
        let directory =
            std::env::temp_dir().join(format!("toolknit-docx-jpeg-{}", hex::encode(nonce)));
        std::fs::create_dir(&directory).unwrap();
        for (index, (name, content, valid)) in [
            ("word/media/photo.jpg", jpeg.as_slice(), true),
            ("word/media/photo.jpeg", jpeg.as_slice(), true),
            ("word/media/photo.jpg", b"<svg/>".as_slice(), false),
            (
                "word/media/photo.jpg",
                b"\x89PNG\r\n\x1a\n".as_slice(),
                false,
            ),
            ("word/media/photo.png", jpeg.as_slice(), false),
            ("word/photo.jpg", jpeg.as_slice(), false),
            ("word/media/photo.svg", jpeg.as_slice(), false),
        ]
        .iter()
        .enumerate()
        {
            let mut writer =
                zip::ZipWriter::new_append(std::io::Cursor::new(package(false))).unwrap();
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content).unwrap();
            let file = directory.join(format!("case-{index}.docx"));
            std::fs::write(&file, writer.finish().unwrap().into_inner()).unwrap();
            assert_eq!(validate_docx_file(&file).is_ok(), *valid, "{name}");
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn docx_writes_validate_and_publish_without_overwriting() {
        let mut nonce = [0_u8; 12];
        getrandom::getrandom(&mut nonce).unwrap();
        let folder =
            std::env::temp_dir().join(format!("toolknit-docx-test-{}", hex::encode(nonce)));
        std::fs::create_dir_all(&folder).unwrap();
        let bytes = package(false);
        std::fs::write(folder.join("result.docx"), b"keep").unwrap();
        let id = begin_write(folder.clone(), "result.docx".into(), bytes.len() as u64).unwrap();
        assert!(append_write(&id, 1, &bytes).is_err());
        append_write(&id, 0, &bytes).unwrap();
        let published = finalize_write(&id).unwrap();
        assert!(published.ends_with("result_1.docx"));
        assert_eq!(std::fs::read(folder.join("result.docx")).unwrap(), b"keep");
        assert_eq!(std::fs::read(&published).unwrap(), bytes);

        let hostile = package(true);
        let id = begin_write(folder.clone(), "external.docx".into(), hostile.len() as u64).unwrap();
        append_write(&id, 0, &hostile).unwrap();
        assert!(finalize_write(&id).is_err());
        assert!(!folder.join("external.docx").exists());
        let id = begin_write(folder.clone(), "cancel.docx".into(), bytes.len() as u64).unwrap();
        append_write(&id, 0, &bytes[..32]).unwrap();
        discard_write(&id);
        assert!(finalize_write(&id).is_err());
        discard_write(&id);
        assert!(std::fs::read_dir(&folder).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".partial")));
        assert!(file_stem("../escape.docx").is_err());
        assert!(file_stem("CON.docx").is_err());
        if let Ok(path) = std::env::var("TOOLKNIT_DOCX_TEST_FILE") {
            validate_docx_file(Path::new(&path)).unwrap();
        }
        std::fs::remove_dir_all(folder).unwrap();
    }
}
