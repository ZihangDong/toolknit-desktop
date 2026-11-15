//! Visible-result previews; never part of the metadata index or elevated helper.
use super::*;
use std::{io::{Cursor, Read}, path::{Path, PathBuf}, sync::Arc};
use image::{ImageDecoder, ImageEncoder};

pub(super) const EDGE: u32 = 128;
pub(super) const MAX_PNG: usize = 72 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;
pub(super) struct State {
    slots: Arc<tokio::sync::Semaphore>,
    cancelled: Mutex<[Arc<AtomicBool>; 2]>,
}
impl Default for State {
    fn default() -> Self {
        Self { slots: Arc::new(tokio::sync::Semaphore::new(2)), cancelled: Mutex::new(std::array::from_fn(|_| Arc::new(AtomicBool::new(false)))) }
    }
}
impl State {
    pub fn cancel(&self, view: usize) {
        let mut values = lock(&self.cancelled);
        values[view].store(true, Ordering::Release);
        values[view] = Arc::new(AtomicBool::new(false));
    }
}
pub(super) async fn load(app: &tauri::AppHandle, view: usize, id: &str, ticket: &str) -> Result<Value, String> {
    let (path, roots) = super::service::leased_path(app, view, id, ticket)?;
    let state = app.state::<FileSearchState>();
    let permit = state.thumbnails.slots.clone().try_acquire_owned().map_err(|_| "file-search:busy")?;
    let cancel = lock(&state.thumbnails.cancelled)[view].clone();
    super::service::leased_path(app, view, id, ticket)?;
    let root = roots.into_iter().filter(|root| path.starts_with(root)).max_by_key(|root| root.as_os_str().len()).ok_or("file-search:forbidden")?;
    let expected = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        #[cfg(windows)]
        { super::filesystem_worker::thumbnail(&path, &root, &cancel) }
        #[cfg(not(windows))]
        { let _ = cancel; read(&path, &root) }
    }).await.map_err(|_| "file-search:worker")??;
    if super::service::leased_path(app, view, id, ticket)?.0 != expected { return Err("file-search:stale-query".into()); }
    match bytes {
        Some(bytes) if bytes.len() <= MAX_PNG && bytes.starts_with(b"\x89PNG\r\n\x1a\n") => {
            use base64::Engine;
            Ok(json!({"image":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes))}))
        }
        _ => Ok(Value::Null),
    }
}
fn safe_metadata(meta: &std::fs::Metadata) -> bool {
    if super::storage::reparse(meta) { return false; }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & (0x1000 | 0x40000 | 0x400000) != 0 { return false; }
    }
    true
}
pub(super) fn read(path: &Path, root: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.is_absolute() || !root.is_absolute() || path == root || !path.starts_with(root) { return Err("file-search:forbidden".into()); }
    // Refuse links and offline/cloud placeholders before opening content. Check
    // every ancestor so a replaced junction cannot escape the approved root.
    for ancestor in path.ancestors() {
        let meta = std::fs::symlink_metadata(ancestor).map_err(|_| "file-search:unavailable")?;
        if !safe_metadata(&meta) { return Ok(None); }
    }
    let meta = std::fs::symlink_metadata(path).map_err(|_| "file-search:unavailable")?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_FILE { return Ok(None); }
    let extension = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["png","jpg","jpeg","jfif","gif","webp","bmp","tif","tiff","svg","heic","heif","avif","ico","psd","ai"].contains(&extension.as_str()) { return Ok(None); }
    let mut options = std::fs::OpenOptions::new(); options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use ::windows::Win32::Storage::FileSystem::{FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_OPEN_NO_RECALL};
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0);
    }
    let file = options.open(path).map_err(|_| "file-search:unavailable")?;
    let actual = file.metadata().map_err(|_| "file-search:unavailable")?;
    if !safe_metadata(&actual) || !actual.is_file() || actual.len() > MAX_FILE { return Ok(None); }
    let canonical_root = root.canonicalize().map_err(|_| "file-search:unavailable")?;
    if !opened_path(&file, path)?.starts_with(&canonical_root) { return Err("file-search:forbidden".into()); }
    if extension == "svg" && actual.len() > 2 * 1024 * 1024 { return Ok(None); }
    if !["png","jpg","jpeg","jfif","gif","webp","bmp","tif","tiff","svg"].contains(&extension.as_str()) {
        #[cfg(windows)]
        if let Some(image) = shell(path, true) { return encode(image); }
        #[cfg(windows)]
        if ["heic","heif","avif","ico","psd"].contains(&extension.as_str()) {
            if let Some(image) = shell(path, false) { return encode(image); }
        }
        return Ok(None);
    }
    let mut bytes = Vec::with_capacity(actual.len().min(1024 * 1024) as usize);
    file.take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|_| "file-search:unavailable")?;
    if bytes.len() as u64 > MAX_FILE { return Ok(None); }
    // Decode supported formats directly. Shell cache/extension startup can
    // consume the entire child deadline before a small PNG is ever read.
    if extension == "svg" { return svg_impl::render(&bytes).map(encode).transpose().map(Option::flatten); }
    if let Ok(image) = raster(&bytes) { return encode(image); }
    Ok(None)
}
fn raster(bytes: &[u8]) -> image::ImageResult<image::DynamicImage> {
    let (width, height) = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?.into_dimensions()?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 24_000_000 {
        return Err(image::ImageError::Limits(image::error::LimitError::from_kind(image::error::LimitErrorKind::DimensionError)));
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default(); limits.max_alloc = Some(128 * 1024 * 1024); reader.limits(limits);
    let mut decoder = reader.into_decoder()?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = image::DynamicImage::from_decoder(decoder)?; image.apply_orientation(orientation);
    Ok(image)
}
fn encode(image: image::DynamicImage) -> Result<Option<Vec<u8>>, String> {
    let small = image.thumbnail(EDGE, EDGE).to_rgba8();
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes).write_image(small.as_raw(), small.width(), small.height(), image::ExtendedColorType::Rgba8).map_err(|_| "file-search:thumbnail")?;
    Ok((bytes.len() <= MAX_PNG).then_some(bytes))
}
#[cfg(windows)]
fn opened_path(file: &std::fs::File, _: &Path) -> Result<PathBuf, String> {
    use std::os::windows::{io::AsRawHandle, ffi::OsStringExt};
    use ::windows::Win32::{Foundation::HANDLE, Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED}};
    let mut buffer = vec![0u16; 32768];
    let count = unsafe { GetFinalPathNameByHandleW(HANDLE(file.as_raw_handle() as isize), &mut buffer, FILE_NAME_NORMALIZED) } as usize;
    if count == 0 || count >= buffer.len() { return Err("file-search:unavailable".into()); }
    Ok(std::ffi::OsString::from_wide(&buffer[..count]).into())
}
#[cfg(not(windows))]
fn opened_path(_: &std::fs::File, path: &Path) -> Result<PathBuf, String> { path.canonicalize().map_err(|_| "file-search:unavailable".into()) }

#[path = "thumbnail_svg.rs"]
mod svg_impl;

#[cfg(windows)]
#[path = "thumbnail_shell.rs"]
mod shell_impl;
#[cfg(windows)]
fn shell(path: &Path, cached: bool) -> Option<image::DynamicImage> { shell_impl::read(path, cached) }

#[cfg(test)]
mod tests {
    use super::*;
    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            let mut nonce = [0u8; 8]; getrandom::getrandom(&mut nonce).unwrap();
            let path = std::env::temp_dir().join(format!("toolknit-thumbnails-{}",hex::encode(nonce)));
            std::fs::create_dir(&path).unwrap(); Self(path)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn thumbnails_are_real_small_images_and_keep_sources_unchanged() {
        let folder = Folder::new();
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(240,120,|x,_| if x < 120 { image::Rgba([240,20,10,255]) } else { image::Rgba([10,30,230,255]) }));
        for (extension, format) in [("png",image::ImageFormat::Png),("jpg",image::ImageFormat::Jpeg),("webp",image::ImageFormat::WebP),("bmp",image::ImageFormat::Bmp),("gif",image::ImageFormat::Gif),("tiff",image::ImageFormat::Tiff)] {
            let source = folder.0.join(format!("图像, {extension}.{extension}"));
            let mut encoded = Cursor::new(Vec::new());
            if extension == "jpg" { image.to_rgb8().write_to(&mut encoded,format).unwrap(); } else { image.write_to(&mut encoded,format).unwrap(); }
            std::fs::write(&source,encoded.get_ref()).unwrap();
            let small = read(&source,&folder.0).unwrap().unwrap();
            assert!(small.len() <= MAX_PNG);
            let small = image::load_from_memory(&small).unwrap().to_rgba8();
            assert_eq!(small.dimensions(),(128,64),"{extension}");
            let left=small.get_pixel(20,30); let right=small.get_pixel(100,30);
            assert!(left[0]>200 && left[2]<50 && right[2]>200 && right[0]<50,"{extension}");
            assert_eq!(std::fs::read(source).unwrap(),*encoded.get_ref());
        }
    }
    #[test]
    fn invalid_oversized_and_unapproved_files_are_not_previewed() {
        let folder = Folder::new();
        let broken=folder.0.join("broken.png"); std::fs::write(&broken,b"invalid").unwrap();
        assert!(read(&broken,&folder.0).unwrap().is_none());
        let huge=folder.0.join("huge.jpg"); std::fs::File::create(&huge).unwrap().set_len(MAX_FILE+1).unwrap();
        assert!(read(&huge,&folder.0).unwrap().is_none());
        assert!(read(&broken,&folder.0.join("other")).is_err());
        assert!(read(&folder.0,&folder.0).is_err());
        assert!(read(Path::new("relative.png"),&folder.0).is_err());
    }
    #[test]
    fn camera_orientation_is_applied_before_reducing_the_image() {
        let image=image::RgbImage::from_pixel(200,100,image::Rgb([200,30,20]));
        let mut encoded=Cursor::new(Vec::new()); image.write_to(&mut encoded,image::ImageFormat::Jpeg).unwrap();
        let exif=b"Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut bytes=encoded.into_inner();
        let mut segment=vec![255,225]; segment.extend_from_slice(&((exif.len()+2) as u16).to_be_bytes());segment.extend_from_slice(exif);
        bytes.splice(2..2,segment);
        let oriented=raster(&bytes).unwrap(); assert_eq!((oriented.width(),oriented.height()),(100,200));
        let small=encode(oriented).unwrap().unwrap();
        let small=image::load_from_memory(&small).unwrap(); assert_eq!((small.width(),small.height()),(64,128));
    }
    #[test]
    fn thumbnail_workers_are_bounded_and_query_cancellation_is_isolated() {
        let state=State::default();
        let a=state.slots.clone().try_acquire_owned().unwrap(); let b=state.slots.clone().try_acquire_owned().unwrap();
        assert!(state.slots.clone().try_acquire_owned().is_err());
        let old=lock(&state.cancelled)[0].clone(); let other=lock(&state.cancelled)[1].clone();
        state.cancel(0); assert!(old.load(Ordering::Acquire)); assert!(!other.load(Ordering::Acquire));
        assert!(!lock(&state.cancelled)[0].load(Ordering::Acquire));
        drop(a);drop(b);assert_eq!(state.slots.available_permits(),2);
    }
}
