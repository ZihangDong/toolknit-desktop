use image::{ImageDecoder, ImageEncoder};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::Path;

#[path = "image_pdf_metadata.rs"]
mod metadata;

const INPUT_LIMIT: u64 = 64 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 40_000_000;
const PAGE_LIMIT: usize = 100;
static IMAGE_PDF_DECODE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

fn err(code: &str) -> String {
    format!("image-pdf:{code}")
}

fn read_source(path: &str) -> Result<Vec<u8>, String> {
    let input = Path::new(path);
    if !input.is_absolute() || path.contains('\0') {
        return Err(err("input"));
    }
    let extension = input
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff"
    ) {
        return Err(err("format"));
    }
    let metadata = std::fs::symlink_metadata(input).map_err(|_| err("input"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(err("input"));
    }
    if metadata.len() == 0 || metadata.len() > INPUT_LIMIT {
        return Err(err("input-size"));
    }
    let file = std::fs::File::open(input).map_err(|_| err("input"))?;
    let mut bytes = Vec::new();
    file.take(INPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| err("input"))?;
    if bytes.len() as u64 > INPUT_LIMIT {
        return Err(err("input-size"));
    }
    Ok(bytes)
}

fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 32_768
        || height > 32_768
        || u64::from(width) * u64::from(height) > PIXEL_LIMIT
    {
        return Err(err("pixels"));
    }
    Ok(())
}

fn image_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(192 * 1024 * 1024);
    limits
}

fn tiff_limits() -> tiff::decoder::Limits {
    let mut limits = tiff::decoder::Limits::default();
    limits.decoding_buffer_size = 192 * 1024 * 1024;
    limits.intermediate_buffer_size = 64 * 1024 * 1024;
    limits.ifd_value_size = 1024 * 1024;
    limits
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePdfFrame {
    index: usize,
    width: u32,
    height: u32,
    dpi_x: Option<f64>,
    dpi_y: Option<f64>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePdfInfo {
    bytes: usize,
    digest: String,
    frames: Vec<ImagePdfFrame>,
    first_frame: bool,
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn image_format(bytes: &[u8]) -> Result<image::ImageFormat, String> {
    if bytes.starts_with(b"II+\0\x08\0\0\0") || bytes.starts_with(b"MM\0+\0\x08\0\0") {
        return Ok(image::ImageFormat::Tiff);
    }
    image::guess_format(bytes).map_err(|_| err("format"))
}

fn tiff_resolution(value: tiff::decoder::ifd::Value) -> Option<f64> {
    use tiff::decoder::ifd::Value;
    match value {
        Value::Rational(numerator, denominator) if denominator != 0 => {
            Some(f64::from(numerator) / f64::from(denominator))
        }
        Value::Double(value) => Some(value),
        Value::Float(value) => Some(f64::from(value)),
        _ => None,
    }
}

fn inspect(bytes: &[u8]) -> Result<ImagePdfInfo, String> {
    let format = image_format(bytes)?;
    let mut frames = Vec::new();
    if format == image::ImageFormat::Tiff {
        use tiff::tags::Tag;
        let mut decoder = tiff::decoder::Decoder::new(Cursor::new(bytes))
            .map_err(|_| err("decode"))?
            .with_limits(tiff_limits());
        loop {
            if frames.len() >= PAGE_LIMIT {
                return Err(err("pages"));
            }
            let color = decoder.colortype().map_err(|_| err("decode"))?;
            if !matches!(
                color,
                tiff::ColorType::Gray(1 | 8 | 16)
                    | tiff::ColorType::GrayA(8 | 16)
                    | tiff::ColorType::RGB(8 | 16 | 32)
                    | tiff::ColorType::RGBA(8 | 16 | 32)
                    | tiff::ColorType::CMYK(8 | 16)
            ) {
                return Err(err("tiff-format"));
            }
            let (mut width, mut height) = decoder.dimensions().map_err(|_| err("decode"))?;
            dimensions(width, height)?;
            let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(1);
            let to_dpi = |value: f64| {
                let value = value * if unit == 3 { 2.54 } else { 1.0 };
                if (unit == 2 || unit == 3) && value.is_finite() && (36.0..=2400.0).contains(&value)
                {
                    Some(value)
                } else {
                    None
                }
            };
            let mut dpi_x = decoder
                .get_tag(Tag::XResolution)
                .ok()
                .and_then(tiff_resolution)
                .and_then(to_dpi);
            let mut dpi_y = decoder
                .get_tag(Tag::YResolution)
                .ok()
                .and_then(tiff_resolution)
                .and_then(to_dpi);
            if matches!(decoder.get_tag_u32(Tag::Orientation).unwrap_or(1), 5..=8) {
                std::mem::swap(&mut width, &mut height);
                std::mem::swap(&mut dpi_x, &mut dpi_y);
            }
            frames.push(ImagePdfFrame {
                index: frames.len(),
                width,
                height,
                dpi_x,
                dpi_y,
            });
            if !decoder.more_images() {
                break;
            }
            decoder.next_image().map_err(|_| err("decode"))?;
        }
    } else {
        if !matches!(
            format,
            image::ImageFormat::Jpeg
                | image::ImageFormat::Png
                | image::ImageFormat::Bmp
                | image::ImageFormat::WebP
                | image::ImageFormat::Gif
        ) {
            return Err(err("format"));
        }
        let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
        reader.limits(image_limits());
        let mut decoder = reader.into_decoder().map_err(|_| err("decode"))?;
        let (mut width, mut height) = decoder.dimensions();
        dimensions(width, height)?;
        let orientation = decoder.orientation().map_err(|_| err("decode"))?;
        let (mut dpi_x, mut dpi_y) = metadata::resolution(bytes, format);
        if matches!(
            orientation,
            image::metadata::Orientation::Rotate90
                | image::metadata::Orientation::Rotate270
                | image::metadata::Orientation::Rotate90FlipH
                | image::metadata::Orientation::Rotate270FlipH
        ) {
            std::mem::swap(&mut width, &mut height);
            std::mem::swap(&mut dpi_x, &mut dpi_y);
        }
        frames.push(ImagePdfFrame {
            index: 0,
            width,
            height,
            dpi_x,
            dpi_y,
        });
    }
    Ok(ImagePdfInfo {
        bytes: bytes.len(),
        digest: digest(bytes),
        frames,
        first_frame: matches!(format, image::ImageFormat::Gif | image::ImageFormat::WebP),
    })
}

// Point an owned in-memory TIFF header at the validated page directory. All data
// offsets stay intact; the source file is never modified and image owns decoding.
fn tiff_page(bytes: &mut [u8], index: usize) -> Result<(), String> {
    let mut decoder = tiff::decoder::Decoder::new(Cursor::new(&*bytes))
        .map_err(|_| err("decode"))?
        .with_limits(tiff_limits());
    decoder.seek_to_image(index).map_err(|_| err("page"))?;
    let pointer = decoder.ifd_pointer().ok_or_else(|| err("page"))?.0;
    let (width, height) = decoder.dimensions().map_err(|_| err("decode"))?;
    dimensions(width, height)?;
    drop(decoder);
    if pointer >= bytes.len() as u64 || bytes.len() < 8 {
        return Err(err("decode"));
    }
    let little = &bytes[..2] == b"II";
    let version = if little {
        u16::from_le_bytes([bytes[2], bytes[3]])
    } else {
        u16::from_be_bytes([bytes[2], bytes[3]])
    };
    match version {
        42 => {
            let offset = u32::try_from(pointer).map_err(|_| err("decode"))?;
            bytes[4..8].copy_from_slice(&if little {
                offset.to_le_bytes()
            } else {
                offset.to_be_bytes()
            });
        }
        43 if bytes.len() >= 16 => bytes[8..16].copy_from_slice(&if little {
            pointer.to_le_bytes()
        } else {
            pointer.to_be_bytes()
        }),
        _ => return Err(err("decode")),
    }
    Ok(())
}

fn decode_page(
    mut bytes: Vec<u8>,
    expected_digest: &str,
    index: usize,
    max_width: u32,
    max_height: u32,
) -> Result<Vec<u8>, String> {
    if index >= PAGE_LIMIT
        || max_width == 0
        || max_height == 0
        || max_width > 8192
        || max_height > 8192
        || u64::from(max_width) * u64::from(max_height) > 16_000_000
    {
        return Err(err("pixels"));
    }
    if expected_digest.len() != 64 || digest(&bytes) != expected_digest {
        return Err(err("changed"));
    }
    let format = image_format(&bytes)?;
    if format == image::ImageFormat::Tiff {
        tiff_page(&mut bytes, index)?;
    } else if index != 0 {
        return Err(err("page"));
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(image_limits());
    let mut decoder = reader.into_decoder().map_err(|_| err("decode"))?;
    let (width, height) = decoder.dimensions();
    dimensions(width, height)?;
    let orientation = decoder.orientation().map_err(|_| err("decode"))?;
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(|_| err("decode"))?;
    decoded.apply_orientation(orientation);
    // PDF pages are opaque white. Composite before filtering so transparent
    // black pixels cannot create dark fringes around pale artwork.
    if decoded.color().has_alpha() {
        let mut rgba = decoded.into_rgba8();
        for pixel in rgba.pixels_mut() {
            let alpha = u32::from(pixel[3]);
            for channel in &mut pixel.0[..3] {
                *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
            }
            pixel[3] = 255;
        }
        decoded = image::DynamicImage::ImageRgba8(rgba);
    }
    if decoded.width() > max_width || decoded.height() > max_height {
        decoded = decoded.resize(max_width, max_height, image::imageops::FilterType::Lanczos3);
    }
    let rgba = decoded.into_rgba8();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| err("encode"))?;
    if png.len() > 64 * 1024 * 1024 {
        return Err(err("output-size"));
    }
    Ok(png)
}

#[tauri::command]
pub(crate) async fn inspect_image_pdf_input(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<ImagePdfInfo, String> {
    if window.label() != "main" {
        return Err(err("permission"));
    }
    let permit = IMAGE_PDF_DECODE
        .acquire()
        .await
        .map_err(|_| err("worker"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        inspect(&read_source(&path)?)
    })
    .await
    .map_err(|_| err("worker"))?
}

#[tauri::command]
pub(crate) async fn read_image_pdf_page(
    window: tauri::WebviewWindow,
    path: String,
    digest: String,
    index: usize,
    max_width: u32,
    max_height: u32,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err(err("permission"));
    }
    let permit = IMAGE_PDF_DECODE
        .acquire()
        .await
        .map_err(|_| err("worker"))?;
    let bytes = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        decode_page(read_source(&path)?, &digest, index, max_width, max_height)
    })
    .await
    .map_err(|_| err("worker"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn result_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err(err("open"));
    }
    let meta = std::fs::symlink_metadata(path).map_err(|_| err("open"))?;
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || meta.len() < 8
        || meta.len() > 100 * 1024 * 1024
    {
        return Err(err("open"));
    }
    let path = path.canonicalize().map_err(|_| err("open"))?;
    super::super::media_runtime::is_path_safe(&path).map_err(|_| err("open"))?;
    let mut header = [0; 5];
    std::fs::File::open(&path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| err("open"))?;
    if &header != b"%PDF-" {
        return Err(err("open"));
    }
    Ok(path)
}

#[tauri::command]
pub(crate) async fn open_image_pdf_result(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err(err("permission"));
    }
    tokio::task::spawn_blocking(move || opener::open(result_path(&path)?).map_err(|_| err("open")))
        .await
        .map_err(|_| err("open"))?
}

#[cfg(test)]
#[path = "image_pdf_tests.rs"]
mod image_pdf_tests;
