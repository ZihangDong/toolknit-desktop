use super::*;
use image::GenericImageView;
use tiff::encoder::{colortype, Rational, TiffEncoder};
use tiff::tags::{ResolutionUnit, Tag};

fn multipage_tiff() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    {
        let mut writer = TiffEncoder::new(&mut bytes).unwrap();
        let mut first = writer.new_image::<colortype::RGB8>(12, 8).unwrap();
        first.resolution(ResolutionUnit::Inch, Rational { n: 300, d: 1 });
        first.write_data(&[255, 0, 0].repeat(12 * 8)).unwrap();
        let mut second = writer.new_image::<colortype::RGB8>(8, 12).unwrap();
        second.encoder().write_tag(Tag::Orientation, 6_u16).unwrap();
        second.resolution(ResolutionUnit::Centimeter, Rational { n: 100, d: 1 });
        second.write_data(&[0, 255, 0].repeat(8 * 12)).unwrap();
    }
    bytes.into_inner()
}

#[test]
fn image_pdf_tiff_frames_orientation_resolution_and_bounded_output() {
    let bytes = multipage_tiff();
    let original = bytes.clone();
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.frames.len(), 2);
    assert_eq!((info.frames[0].width, info.frames[0].height), (12, 8));
    assert_eq!(info.frames[0].dpi_x, Some(300.0));
    assert_eq!((info.frames[1].width, info.frames[1].height), (12, 8));
    assert_eq!(info.frames[1].dpi_x, Some(254.0));
    for (index, expected) in [(0, [255, 0, 0, 255]), (1, [0, 255, 0, 255])] {
        let png = decode_page(bytes.clone(), &info.digest, index, 6, 6).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!(decoded.dimensions(), (6, 4));
        assert_eq!(decoded.get_pixel(2, 2).0, expected);
    }
    assert_eq!(
        bytes, original,
        "selecting a TIFF frame must not change the input"
    );
    assert_eq!(
        decode_page(bytes, &info.digest, 2, 6, 6).unwrap_err(),
        err("page")
    );
}

#[test]
fn image_pdf_big_tiff_gray16_and_rgba() {
    let mut bytes = Cursor::new(Vec::new());
    {
        let mut writer = TiffEncoder::new_big(&mut bytes).unwrap();
        writer
            .write_image::<colortype::Gray16>(6, 4, &vec![32768; 24])
            .unwrap();
        let mut rgba = writer.new_image::<colortype::RGBA8>(5, 3).unwrap();
        rgba.encoder()
            .write_tag(Tag::ExtraSamples, &[2_u16][..])
            .unwrap();
        rgba.write_data(&[0, 0, 255, 128].repeat(15)).unwrap();
    }
    let bytes = bytes.into_inner();
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.frames.len(), 2);
    let gray =
        image::load_from_memory(&decode_page(bytes.clone(), &info.digest, 0, 100, 100).unwrap())
            .unwrap();
    assert!((127..=129).contains(&gray.get_pixel(0, 0).0[0]));
    let rgba =
        image::load_from_memory(&decode_page(bytes, &info.digest, 1, 100, 100).unwrap()).unwrap();
    assert_eq!(rgba.dimensions(), (5, 3));
    assert_eq!(rgba.get_pixel(0, 0).0, [127, 127, 255, 255]);
}

#[test]
fn image_pdf_decode_rejects_changed_input_bad_frames_and_oversized_requests() {
    let bytes = multipage_tiff();
    let hash = digest(&bytes);
    assert_eq!(
        decode_page(bytes.clone(), &"0".repeat(64), 0, 10, 10).unwrap_err(),
        err("changed")
    );
    assert_eq!(
        decode_page(bytes.clone(), &hash, 100, 10, 10).unwrap_err(),
        err("pixels")
    );
    assert_eq!(
        decode_page(bytes.clone(), &hash, 0, 8192, 8192).unwrap_err(),
        err("pixels")
    );
    assert_eq!(
        decode_page(bytes, &hash, 0, 0, 10).unwrap_err(),
        err("pixels")
    );
    assert!(inspect(b"not an image").is_err());
    assert!(dimensions(40_000, 1).is_err());
    assert!(dimensions(8000, 6000).is_err());
    assert!(dimensions(0, 50).is_err());
    assert_eq!(
        tiff_resolution(tiff::decoder::ifd::Value::Rational(300, 0)),
        None
    );
}

#[test]
fn image_pdf_png_alpha_and_non_tiff_page_validation() {
    let source = image::RgbaImage::from_pixel(16, 12, image::Rgba([90, 160, 210, 100]));
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(source.as_raw(), 16, 12, image::ExtendedColorType::Rgba8)
        .unwrap();
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.frames.len(), 1);
    assert!(!info.first_frame);
    let decoded =
        image::load_from_memory(&decode_page(bytes.clone(), &info.digest, 0, 8, 8).unwrap())
            .unwrap();
    assert_eq!(decoded.dimensions(), (8, 6));
    assert_eq!(decoded.get_pixel(4, 3).0, [190, 218, 237, 255]);
    assert_eq!(
        decode_page(bytes, &info.digest, 1, 8, 8).unwrap_err(),
        err("page")
    );
}

#[test]
fn image_pdf_file_and_result_validation_reject_untrusted_paths() {
    let folder = std::env::temp_dir().join(format!(
        "toolknit-image-pdf-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&folder).unwrap();
    let image = folder.join("source.tiff");
    let bytes = multipage_tiff();
    std::fs::write(&image, &bytes).unwrap();
    assert_eq!(read_source(image.to_str().unwrap()).unwrap(), bytes);
    assert!(read_source("relative.png").is_err());
    assert!(read_source(folder.to_str().unwrap()).is_err());
    let pdf = folder.join("result.pdf");
    std::fs::write(&pdf, b"invalid PDF header").unwrap();
    assert!(result_path(pdf.to_str().unwrap()).is_err());
    std::fs::write(&pdf, b"%PDF-1.7\n%%EOF").unwrap();
    assert!(result_path(pdf.to_str().unwrap()).is_ok());
    assert!(read_source(pdf.to_str().unwrap()).is_err());
    assert!(result_path(image.to_str().unwrap()).is_err());
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn image_pdf_transparent_white_edges_do_not_turn_gray_when_resized() {
    let mut source = image::RgbaImage::new(12, 12);
    for y in 3..9 {
        for x in 3..9 {
            source.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
        }
    }
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(source.as_raw(), 12, 12, image::ExtendedColorType::Rgba8)
        .unwrap();
    let result = decode_page(bytes.clone(), &digest(&bytes), 0, 4, 4).unwrap();
    let decoded = image::load_from_memory(&result).unwrap().to_rgba8();
    assert!(
        decoded
            .pixels()
            .all(|pixel| pixel.0 == [255, 255, 255, 255]),
        "transparent black padding must not bleed into white artwork"
    );
    assert_eq!(
        image::load_from_memory(&bytes).unwrap().get_pixel(0, 0).0[3],
        0
    );
}

#[test]
#[ignore = "Uses an explicitly supplied synthetic format matrix and keeps decoded PNGs for browser integration"]
fn image_pdf_format_matrix() {
    let root = std::path::PathBuf::from(std::env::var("TOOLKNIT_IMAGE_PDF_MATRIX_ROOT").unwrap());
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let mut report = Vec::new();
    for input in manifest.as_array().unwrap() {
        let name = input["name"].as_str().unwrap();
        let path = root.join(name);
        let source = read_source(path.to_str().unwrap()).unwrap();
        if let Some(code) = input["error"].as_str() {
            assert_eq!(inspect(&source).unwrap_err(), err(code), "{name}");
            report.push(serde_json::json!({"name": name, "error": code}));
            continue;
        }
        let info = inspect(&source).unwrap_or_else(|error| panic!("{name}: {error}"));
        if let Some(expected) = input["dpiX"].as_f64() {
            assert!(
                (info.frames[0].dpi_x.unwrap() - expected).abs() < 0.03,
                "{name}: horizontal DPI"
            );
        }
        if let Some(expected) = input["dpiY"].as_f64() {
            assert!(
                (info.frames[0].dpi_y.unwrap() - expected).abs() < 0.03,
                "{name}: vertical DPI"
            );
        }
        assert_eq!(
            info.frames.len(),
            input["frames"].as_u64().unwrap() as usize,
            "{name}"
        );
        assert_eq!(
            info.frames[0].width as u64,
            input["width"].as_u64().unwrap(),
            "{name}"
        );
        assert_eq!(
            info.frames[0].height as u64,
            input["height"].as_u64().unwrap(),
            "{name}"
        );
        let mut outputs = Vec::new();
        for frame in &info.frames {
            let bytes = decode_page(source.clone(), &info.digest, frame.index, 1200, 1200)
                .unwrap_or_else(|error| panic!("{name} page {}: {error}", frame.index));
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert_eq!(decoded.dimensions(), (frame.width, frame.height), "{name}");
            if name.starts_with("animated") {
                let pixel = decoded.get_pixel(60, 40).0;
                assert!(
                    pixel[0] > pixel[1] + 80,
                    "animation must use first red frame: {name}"
                );
            }
            let output = format!("{name}-{}.png", frame.index);
            std::fs::write(root.join(&output), bytes).unwrap();
            outputs.push(output);
        }
        assert_eq!(
            digest(&read_source(path.to_str().unwrap()).unwrap()),
            info.digest
        );
        report.push(serde_json::json!({"name": name, "info": info, "decoded": outputs}));
    }
    std::fs::write(
        root.join("native-report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("Validated {} native image input variants", report.len());
}

#[tokio::test]
#[ignore = "Publishes explicitly supplied synthetic browser PDFs through the real Windows writer and qpdf"]
async fn image_pdf_native_publication_matrix() {
    use super::super::super::media_runtime::{
        append_pdf_enhance_chunk, begin_pdf_enhance_write, discard_pdf_enhance_write,
        finalize_pdf_enhance_write,
    };
    let matrix = std::path::PathBuf::from(std::env::var("TOOLKNIT_IMAGE_PDF_MATRIX_ROOT").unwrap());
    let report: serde_json::Value =
        serde_json::from_slice(&std::fs::read(matrix.join("exports/bridge-report.json")).unwrap())
            .unwrap();
    let folder = std::env::temp_dir().join(format!(
        "toolknit-image-pdf-publish-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&folder).unwrap();
    let mut output = Vec::new();
    for item in report["published"].as_array().unwrap() {
        let input = std::fs::read(item["path"].as_str().unwrap()).unwrap();
        let pages = item["pages"].as_u64().unwrap() as u32;
        let mut ids = Vec::new();
        for _ in 0..2 {
            let id = begin_pdf_enhance_write(
                folder.to_string_lossy().into_owned(),
                "images.pdf".into(),
                pages,
            )
            .unwrap();
            for chunk in input.chunks(1024 * 1024) {
                append_pdf_enhance_chunk(id, chunk.to_vec()).unwrap();
            }
            ids.push(id);
        }
        let (first, second) = tokio::join!(
            finalize_pdf_enhance_write(ids[0]),
            finalize_pdf_enhance_write(ids[1])
        );
        let first = first.unwrap();
        let second = second.unwrap();
        assert_ne!(first, second, "concurrent saves must not overwrite");
        for path in [first, second] {
            assert_eq!(std::fs::read(&path).unwrap(), input);
            assert!(result_path(&path).is_ok());
            output.push(path);
        }
        let cancelled = begin_pdf_enhance_write(
            folder.to_string_lossy().into_owned(),
            "cancelled.pdf".into(),
            pages,
        )
        .unwrap();
        append_pdf_enhance_chunk(cancelled, input[..50].to_vec()).unwrap();
        discard_pdf_enhance_write(cancelled).unwrap();
        assert!(!folder.join("cancelled.pdf").exists());
        let broken = begin_pdf_enhance_write(
            folder.to_string_lossy().into_owned(),
            "broken.pdf".into(),
            pages,
        )
        .unwrap();
        append_pdf_enhance_chunk(broken, b"%PDF-1.7 broken document".to_vec()).unwrap();
        assert!(finalize_pdf_enhance_write(broken).await.is_err());
        assert!(!folder.join("broken.pdf").exists());
    }
    assert!(std::fs::read_dir(&folder).unwrap().all(|entry| entry
        .unwrap()
        .path()
        .extension()
        .is_some_and(|value| value == "pdf")));
    std::fs::write(
        matrix.join("native-publication.json"),
        serde_json::to_vec_pretty(&output).unwrap(),
    )
    .unwrap();
    println!("Native publication: {} valid unique outputs; cancellation and failed validation left no partial files", output.len());
}
