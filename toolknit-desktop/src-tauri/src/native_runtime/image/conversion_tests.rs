
#[cfg(test)]
mod image_conversion_tests {
    use super::*;
    use image::{GenericImage, GenericImageView, ImageEncoder};

    fn image_test_directory(label: &str) -> std::path::PathBuf {
        let unique = format!(
            "toolknit-image-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary image test directory");
        directory
    }

    #[test]
    #[ignore = "Requires explicitly supplied local PNG samples; keeps outputs for inspection"]
    fn image_compression_source_file_matrix() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let paths: Vec<String> = serde_json::from_str(
            &std::env::var("TOOLKNIT_IMAGE_COMPRESSION_INPUTS").expect("local input paths JSON"),
        ).expect("valid local input paths JSON");
        let directory = image_test_directory("compression-source-matrix");
        for (index, path) in paths.iter().enumerate() {
            let input = std::fs::read(path).unwrap();
            let source = decode_oriented_image(std::path::Path::new(path)).unwrap();
            for (quality, compression) in [
                ("high", image::codecs::png::CompressionType::Fast),
                ("medium", image::codecs::png::CompressionType::Default),
                ("low", image::codecs::png::CompressionType::Best),
            ] {
                let mut legacy = Vec::new();
                source.write_with_encoder(image::codecs::png::PngEncoder::new_with_quality(
                    &mut legacy, compression, image::codecs::png::FilterType::Sub,
                )).unwrap();
                let start = std::time::Instant::now();
                let outputs = directory.join(format!("sample-{}-{}", index + 1, quality));
                let result = compress_image_batch_blocking_with_progress(
                    vec![path.clone()], outputs.to_string_lossy().into_owned(), quality.into(), |_| {},
                ).unwrap();
                assert_eq!((result.success_count, result.fail_count), (1, 0));
                assert!(result.errors.is_empty());
                let output = outputs.join(std::path::Path::new(path).file_name().unwrap());
                let optimized = std::fs::read(&output).unwrap();
                let decoded = decode_oriented_image(&output).unwrap();
                assert_eq!(decoded.dimensions(), source.dimensions());
                assert_eq!(decoded.to_rgba8(), source.to_rgba8());
                assert!(optimized.len() < input.len());
                assert_eq!(png_preserved_chunks(&input), png_preserved_chunks(&optimized));
                assert_eq!(result.original_size, Some(input.len() as u64));
                assert_eq!(result.compressed_size, Some(optimized.len() as u64));
                println!("sample={} quality={} source={} legacy={} optimized={} elapsed_ms={}",
                    index + 1, quality, input.len(), legacy.len(), optimized.len(), start.elapsed().as_millis());
            }
            assert_eq!(std::fs::read(path).unwrap(), input, "source must remain untouched");
        }
        println!("Sample outputs: {}", directory.display());
    }

    fn png_preserved_chunks(bytes: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        let mut chunks = Vec::new();
        let mut offset = 8;
        while offset + 12 <= bytes.len() {
            let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let kind: [u8; 4] = bytes[offset + 4..offset + 8].try_into().unwrap();
            if matches!(&kind, b"eXIf" | b"pHYs" | b"iCCP" | b"sRGB" | b"gAMA") {
                chunks.push((kind, bytes[offset + 8..offset + 8 + size].to_vec()));
            }
            offset += 12 + size;
        }
        chunks.sort_by_key(|chunk| chunk.0);
        chunks
    }

    #[test]
    fn png_compression_preserves_pixels_depth_transparency_and_orientation() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let directory = image_test_directory("png-lossless");
        let inputs = directory.join("inputs");
        std::fs::create_dir_all(&inputs).unwrap();
        let fixtures = [
            image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(192, 128, |x, y| {
                let shade = ((x + y) % 256) as u8;
                image::Rgb([shade; 3])
            })),
            image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(192, 128, |x, y| {
                image::Rgba([x as u8, y as u8, 73, ((x + y) % 256) as u8])
            })),
            image::DynamicImage::ImageRgba16(image::ImageBuffer::from_fn(192, 128, |x, y| {
                image::Rgba([x as u16 * 251, y as u16 * 509, 30001, (x + y) as u16 * 199])
            })),
            image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(192, 128, |x, y| {
                if (x / 16 + y / 16) % 2 == 0 { image::Rgb([255, 10, 0]) } else { image::Rgb([0, 190, 240]) }
            })),
        ];
        for (index, source) in fixtures.iter().enumerate() {
            let input = inputs.join(format!("source-{index}.png"));
            let mut bytes = Vec::new();
            let mut encoder = image::codecs::png::PngEncoder::new_with_quality(
                &mut bytes, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Sub,
            );
            encoder.set_exif_metadata(exif_orientation_payload(6)).unwrap();
            source.write_with_encoder(encoder).unwrap();
            std::fs::write(&input, &bytes).unwrap();
            let original_pixels = decode_oriented_image(&input).unwrap().to_rgba16();
            let mut prior = None;
            for quality in ["high", "medium", "low"] {
                let outputs = directory.join(format!("{index}-{quality}"));
                let result = compress_image_batch_blocking_with_progress(
                    vec![input.to_string_lossy().into_owned()], outputs.to_string_lossy().into_owned(),
                    quality.into(), |_| {},
                ).unwrap();
                assert_eq!((result.success_count, result.fail_count), (1, 0));
                assert!(result.errors.is_empty());
                let output = outputs.join(input.file_name().unwrap());
                let optimized = std::fs::read(&output).unwrap();
                assert!(optimized.len() < bytes.len());
                assert_eq!(decode_oriented_image(&output).unwrap().to_rgba16(), original_pixels);
                assert_eq!(png_preserved_chunks(&bytes), png_preserved_chunks(&optimized));
                if index == 2 { assert_eq!(optimized[24], 16, "do not truncate 16-bit samples"); }
                if index == 3 { assert_eq!(optimized[25], 3, "lossless palette reduction"); }
                if let Some(previous) = prior { assert_eq!(optimized, previous, "PNG is lossless at every preset"); }
                prior = Some(optimized);
            }
            assert_eq!(std::fs::read(&input).unwrap(), bytes);
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_compression_unchanged_is_not_failure_or_fake_output() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let directory = image_test_directory("compression-unchanged");
        let input = directory.join("already-optimized.png");
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(256, 128, image::Rgb([60; 3])))
            .write_with_encoder(image::codecs::png::PngEncoder::new(&mut bytes)).unwrap();
        // Find a stable, already optimized input without embedding a third-party fixture.
        loop {
            let next = oxipng::optimize_from_memory(&bytes, &oxipng::Options::from_preset(2)).unwrap();
            if next.len() >= bytes.len() { break; }
            bytes = next;
        }
        std::fs::write(&input, &bytes).unwrap();
        let broken = directory.join("damaged.png");
        std::fs::write(&broken, b"not a PNG").unwrap();
        let outputs = directory.join("outputs");
        let mut events = Vec::new();
        let result = compress_image_batch_blocking_with_progress(
            vec![input.to_string_lossy().into_owned(), broken.to_string_lossy().into_owned()],
            outputs.to_string_lossy().into_owned(), "low".into(), |event| events.push(event),
        ).unwrap();
        assert_eq!((result.success_count, result.fail_count), (0, 1));
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("damaged.png"));
        assert_eq!(result.original_size, Some(bytes.len() as u64));
        assert_eq!(result.compressed_size, result.original_size);
        assert_eq!(std::fs::read_dir(&outputs).unwrap().count(), 0);
        assert!(events.iter().any(|event| event.file_name == "already-optimized.png" && event.status == "done"));
        assert_eq!(std::fs::read(&input).unwrap(), bytes);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn png_compression_cancellation_and_existing_output_are_safe() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let directory = image_test_directory("png-cancel-publish");
        let input = directory.join("source.png");
        image::RgbImage::from_pixel(256, 256, image::Rgb([50; 3])).save(&input).unwrap();
        let outputs = directory.join("outputs");
        std::fs::create_dir_all(&outputs).unwrap();
        let previous = outputs.join("source.png");
        std::fs::write(&previous, b"existing output").unwrap();
        let paths = vec![input.to_string_lossy().into_owned()];
        let result = compress_image_batch_blocking_with_progress(
            paths.clone(), outputs.to_string_lossy().into_owned(), "medium".into(), |_| {},
        ).unwrap();
        assert_eq!((result.success_count, result.fail_count), (1, 0));
        assert_eq!(std::fs::read(previous).unwrap(), b"existing output");
        let cancel_outputs = directory.join("cancelled");
        let result = compress_image_batch_blocking_with_progress(
            paths, cancel_outputs.to_string_lossy().into_owned(), "medium".into(),
            |_| CANCEL_FLAG.store(true, Ordering::SeqCst),
        ).unwrap();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        assert_eq!((result.success_count, result.fail_count), (0, 0));
        assert_eq!(std::fs::read_dir(cancel_outputs).unwrap().count(), 0);
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn exif_orientation_payload(orientation: u16) -> Vec<u8> {
        let mut exif = vec![0_u8; 26];
        exif[0..2].copy_from_slice(b"II");
        exif[2..4].copy_from_slice(&42_u16.to_le_bytes());
        exif[4..8].copy_from_slice(&8_u32.to_le_bytes());
        exif[8..10].copy_from_slice(&1_u16.to_le_bytes());
        exif[10..12].copy_from_slice(&0x0112_u16.to_le_bytes());
        exif[12..14].copy_from_slice(&3_u16.to_le_bytes());
        exif[14..18].copy_from_slice(&1_u32.to_le_bytes());
        exif[18..20].copy_from_slice(&orientation.to_le_bytes());
        exif
    }

    fn write_exif_jpeg(path: &std::path::Path, image: &image::RgbImage, orientation: u16) {
        let file = std::fs::File::create(path).expect("create EXIF JPEG fixture");
        let writer = std::io::BufWriter::new(file);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 100);
        encoder
            .set_exif_metadata(exif_orientation_payload(orientation))
            .expect("attach EXIF orientation");
        encoder
            .encode(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgb8,
            )
            .expect("encode EXIF JPEG fixture");
    }

    fn assert_rgb_near(actual: image::Rgb<u8>, expected: [u8; 3], tolerance: i16) {
        for (actual, expected) in actual.0.into_iter().zip(expected) {
            assert!(
                (i16::from(actual) - i16::from(expected)).abs() <= tolerance,
                "channel {actual} differs from expected {expected} by more than {tolerance}"
            );
        }
    }

    #[test]
    fn jpeg_writers_flatten_transparent_pixels_onto_white() {
        let directory = image_test_directory("jpeg-alpha");
        let input = directory.join("transparent.png");
        let converted_output = directory.join("converted.jpg");
        let compressed_output = directory.join("compressed.jpg");

        let source = image::RgbaImage::from_fn(64, 64, |x, y| match (x < 32, y < 32) {
            (true, true) => image::Rgba([255, 0, 0, 0]),
            (false, true) => image::Rgba([0, 255, 0, 255]),
            (true, false) => image::Rgba([0, 0, 255, 128]),
            (false, false) => image::Rgba([0, 0, 0, 0]),
        });
        source.save(&input).expect("write transparent PNG fixture");
        let decoded = decode_oriented_image(&input).expect("decode transparent PNG fixture");
        write_converted_image(&decoded, &converted_output, image::ImageFormat::Jpeg)
            .expect("RGBA image should convert to JPEG");
        write_compressed_image(
            &decoded,
            &compressed_output,
            image::ImageFormat::Jpeg,
            92,
            image::codecs::png::CompressionType::Default,
        )
        .expect("RGBA image should compress to JPEG");

        for output in [&converted_output, &compressed_output] {
            let decoded = image::open(output)
                .expect("JPEG output should be readable")
                .to_rgb8();
            assert_eq!((decoded.width(), decoded.height()), (64, 64));
            assert_rgb_near(*decoded.get_pixel(4, 4), [255, 255, 255], 20);
            assert_rgb_near(*decoded.get_pixel(59, 4), [0, 255, 0], 20);
            assert_rgb_near(*decoded.get_pixel(4, 59), [127, 127, 255], 24);
            assert_rgb_near(*decoded.get_pixel(59, 59), [255, 255, 255], 20);
        }
        std::fs::remove_dir_all(&directory).expect("remove temporary image test directory");
    }

    #[test]
    fn exif_orientation_is_applied_to_shared_decode_and_icon_preparation() {
        let directory = image_test_directory("exif-orientation");
        let input = directory.join("orientation-6.jpg");
        let converted = directory.join("orientation-applied.png");
        let source = image::RgbImage::from_fn(64, 32, |x, y| match (x < 32, y < 16) {
            (true, true) => image::Rgb([255, 0, 0]),
            (false, true) => image::Rgb([0, 255, 0]),
            (true, false) => image::Rgb([0, 0, 255]),
            (false, false) => image::Rgb([255, 255, 0]),
        });
        write_exif_jpeg(&input, &source, 6);

        let decoded = decode_oriented_image(&input).expect("decode oriented JPEG");
        assert_eq!((decoded.width(), decoded.height()), (32, 64));
        let decoded_rgb = decoded.to_rgb8();
        assert_rgb_near(*decoded_rgb.get_pixel(4, 4), [0, 0, 255], 28);
        assert_rgb_near(*decoded_rgb.get_pixel(27, 4), [255, 0, 0], 28);
        assert_rgb_near(*decoded_rgb.get_pixel(4, 59), [255, 255, 0], 28);
        assert_rgb_near(*decoded_rgb.get_pixel(27, 59), [0, 255, 0], 28);

        write_converted_image(&decoded, &converted, image::ImageFormat::Png)
            .expect("write orientation-normalized PNG");
        let normalized = image::open(&converted)
            .expect("read orientation-normalized PNG")
            .to_rgb8();
        assert_eq!(normalized.dimensions(), (32, 64));
        assert_rgb_near(*normalized.get_pixel(4, 4), [0, 0, 255], 28);

        let prepared = prepare_icon_source_image(input.to_string_lossy().into_owned())
            .expect("prepare oriented icon source");
        assert_eq!((prepared.width, prepared.height), (32, 64));
        let prepared_image = image::load_from_memory(&prepared.bytes)
            .expect("decode prepared icon PNG")
            .to_rgb8();
        assert_rgb_near(*prepared_image.get_pixel(4, 4), [0, 0, 255], 28);
        std::fs::remove_dir_all(&directory).expect("remove temporary image test directory");
    }

    #[test]
    fn svg_conversion_produces_a_standard_embedded_image_document() {
        let unique = format!(
            "toolknit-svg-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary image test directory");
        let output = directory.join("converted.svg");
        let source = image::DynamicImage::new_rgba8(3, 2);
        write_raster_svg(&source, &output).expect("write SVG image document");

        let svg = std::fs::read_to_string(&output).expect("read SVG output");
        assert!(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("width=\"3\" height=\"2\""));
        assert!(svg.contains("data:image/png;base64,"));
        std::fs::remove_dir_all(&directory).expect("remove temporary image test directory");
    }

    #[test]
    fn image_batch_rejects_duplicate_inputs_and_never_overwrites_outputs() {
        let unique = format!(
            "toolknit-image-publish-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary image test directory");
        let input = directory.join("input.png");
        image::DynamicImage::new_rgba8(2, 2)
            .save_with_format(&input, image::ImageFormat::Png)
            .expect("write input PNG");

        let duplicate_result = validate_image_batch_inputs(&[
            input.to_string_lossy().to_string(),
            input.to_string_lossy().to_string(),
        ]);
        assert!(duplicate_result
            .expect_err("duplicate input must fail")
            .contains("Duplicate image file"));

        let temporary = directory.join("temporary.png");
        let output = directory.join("output.png");
        std::fs::write(&temporary, b"new-content").expect("write temporary output");
        std::fs::write(&output, b"existing-content").expect("write existing output");
        assert!(publish_image_output(&temporary, &output).is_err());
        assert_eq!(
            std::fs::read(&output).expect("read existing output"),
            b"existing-content"
        );
        assert!(temporary.exists());

        std::fs::remove_file(&output).expect("remove existing output");
        publish_image_output(&temporary, &output).expect("publish new output");
        assert_eq!(
            std::fs::read(&output).expect("read published output"),
            b"new-content"
        );
        assert!(!temporary.exists());
        std::fs::remove_dir_all(&directory).expect("remove temporary image test directory");
    }

    fn stitch_test_options(
        inputs: &[std::path::PathBuf],
        output: &std::path::Path,
        mode: &str,
        format: &str,
        background: &str,
    ) -> ImageStitchOptions {
        ImageStitchOptions {
            input_paths: inputs
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            output_dir: output.to_string_lossy().into_owned(),
            output_name: None,
            mode: mode.to_string(),
            reference: "first".to_string(),
            spacing_px: 0,
            scale_percent: 100,
            format: format.to_string(),
            jpeg_quality: 92,
            background_rgba: background.to_string(),
        }
    }

    #[test]
    fn image_stitch_layout_rounds_and_counts_only_between_item_gaps() {
        let layout =
            calculate_image_stitch_layout(&[(101, 10), (5, 7)], "vertical", "first", 9, 50)
                .expect("calculate vertical layout");
        assert_eq!(layout.width, 51);
        assert_eq!(layout.sizes, vec![(51, 5), (51, 71)]);
        assert_eq!(layout.height, 5 + 9 + 71);

        let one_hundred = vec![(1, 1); 100];
        let boundary = calculate_image_stitch_layout(&one_hundred, "vertical", "smallest", 0, 100)
            .expect("100-image boundary should be valid");
        assert_eq!((boundary.width, boundary.height), (1, 100));
        assert!(
            calculate_image_stitch_layout(&vec![(1, 1); 101], "vertical", "first", 0, 100,)
                .is_err()
        );
    }

    #[test]
    fn image_stitch_outputs_are_complete_unique_and_pixel_correct() {
        let _conversion_lock = test_conversion_lock();
        let unique = format!(
            "toolknit-stitch-native-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        let output = directory.join("导出 结果");
        std::fs::create_dir_all(&output).expect("create stitch output directory");
        let red = directory.join("红 色.png");
        let blue = directory.join("blue.png");
        let transparent = directory.join("透明.png");
        image::RgbaImage::from_pixel(10, 20, image::Rgba([255, 0, 0, 255]))
            .save(&red)
            .expect("write red input");
        image::RgbaImage::from_pixel(20, 10, image::Rgba([0, 0, 255, 255]))
            .save(&blue)
            .expect("write blue input");
        image::RgbaImage::from_pixel(10, 10, image::Rgba([0, 0, 0, 0]))
            .save(&transparent)
            .expect("write transparent input");
        CANCEL_FLAG.store(false, Ordering::SeqCst);

        let first = stitch_images_blocking(
            stitch_test_options(
                &[red.clone(), blue.clone()],
                &output,
                "vertical",
                "png",
                "#FFFFFFFF",
            ),
            |_, _, _, _| {},
        )
        .expect("stitch vertical PNG");
        assert_eq!((first.width, first.height), (10, 25));
        let decoded = image::open(&first.output_path)
            .expect("read vertical output")
            .to_rgba8();
        assert_eq!(decoded.get_pixel(5, 19).0, [255, 0, 0, 255]);
        assert_eq!(decoded.get_pixel(5, 20).0, [0, 0, 255, 255]);

        let mut horizontal_options = stitch_test_options(
            &[red.clone(), blue.clone()],
            &output,
            "horizontal",
            "png",
            "#00FF00FF",
        );
        horizontal_options.spacing_px = 3;
        horizontal_options.reference = "largest".to_string();
        horizontal_options.scale_percent = 50;
        let second = stitch_images_blocking(horizontal_options, |_, _, _, _| {})
            .expect("stitch horizontal PNG");
        assert_eq!((second.width, second.height), (28, 10));
        assert_ne!(first.output_path, second.output_path);
        let horizontal = image::open(&second.output_path)
            .expect("read horizontal output")
            .to_rgba8();
        assert_eq!(horizontal.get_pixel(4, 5).0, [255, 0, 0, 255]);
        assert_eq!(horizontal.get_pixel(5, 5).0, [0, 255, 0, 255]);
        assert_eq!(horizontal.get_pixel(7, 5).0, [0, 255, 0, 255]);
        assert_eq!(horizontal.get_pixel(8, 5).0, [0, 0, 255, 255]);

        let alpha_result = stitch_images_blocking(
            stitch_test_options(
                &[transparent.clone(), blue.clone()],
                &output,
                "vertical",
                "png",
                "#12345600",
            ),
            |_, _, _, _| {},
        )
        .expect("stitch transparent PNG");
        let alpha = image::open(&alpha_result.output_path)
            .expect("read transparent output")
            .to_rgba8();
        assert_eq!(alpha.get_pixel(2, 2).0[3], 0);

        let jpeg_result = stitch_images_blocking(
            stitch_test_options(
                &[transparent, blue],
                &output,
                "vertical",
                "jpg",
                "#FF00FF00",
            ),
            |_, _, _, _| {},
        )
        .expect("stitch flattened JPEG");
        let jpeg = image::open(&jpeg_result.output_path)
            .expect("read JPEG output")
            .to_rgb8();
        let pixel = jpeg.get_pixel(2, 2).0;
        assert!(pixel[0] > 220 && pixel[2] > 220);
        assert!(!std::fs::read_dir(&output)
            .expect("read output directory")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".toolknit-stitch-")));
        std::fs::remove_dir_all(&directory).expect("remove stitch test directory");
    }

    #[test]
    fn image_stitch_grid_counts_dimensions_and_limits() {
        for side in 2usize..=5 {
            let mode = format!("grid-{side}");
            let dimensions = (0..side * side).map(|i| (100, if i % 2 == 0 { 100 } else { 50 })).collect::<Vec<_>>();
            let grid = calculate_image_stitch_layout(&dimensions, &mode, "first", 4, 50).unwrap();
            let expected = side as u32 * 50 + (side as u32 - 1) * 4;
            assert_eq!((grid.width, grid.height), (expected, expected));
            assert_eq!(&grid.sizes[..2], &[(50, 50), (50, 25)]);
            for count in [side * side - 1, side * side + 1] {
                assert!(calculate_image_stitch_layout(&vec![(10, 10); count], &mode, "first", 0, 100).unwrap_err().contains("invalid-grid-count"));
            }
            assert!(calculate_image_stitch_layout(&vec![(65535, 65535); side * side], &mode, "first", 0, 100).is_err());
        }
        assert!(calculate_image_stitch_layout(&[(0, 10); 4], "grid-2", "first", 0, 100).is_err());
        assert!(calculate_image_stitch_layout(&[(10, 10); 36], "grid-6", "first", 0, 100).is_err());
    }

    #[test]
    fn image_stitch_grid_png_jpg_order_and_padding() {
        let _conversion_lock = test_conversion_lock();
        let directory = std::env::temp_dir().join(format!("toolknit-stitch-grid-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let output = directory.join("out");
        std::fs::create_dir_all(&output).unwrap();
        let inputs = (0..25).map(|i| {
            let file = directory.join(format!("image-{i}.png"));
            let shade = (i * 8) as u8;
            image::RgbaImage::from_pixel(40, if i % 2 == 0 { 40 } else { 20 }, image::Rgba([shade, shade, shade, 255])).save(&file).unwrap();
            file
        }).collect::<Vec<_>>();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        for side in 2usize..=5 {
            for format in ["png", "jpg"] {
                let mut options = stitch_test_options(&inputs[..side * side], &output, &format!("grid-{side}"), format, "#FFFFFFFF");
                options.spacing_px = 4;
                let result = stitch_images_blocking(options, |_, _, _, _| {}).unwrap();
                let decoded = image::open(&result.output_path).unwrap().to_rgba8();
                let expected = side as u32 * 40 + (side as u32 - 1) * 4;
                assert_eq!(decoded.dimensions(), (expected, expected));
                for i in 0..side * side {
                    let x = (i % side) as u32 * 44 + 20;
                    let y = (i / side) as u32 * 44 + 20;
                    let pixel = decoded.get_pixel(x, y).0;
                    let shade = (i * 8) as i16;
                    for channel in &pixel[..3] { assert!((*channel as i16 - shade).abs() <= if format == "png" { 0 } else { 5 }); }
                }
                assert!(decoded.get_pixel(60, 2).0[0] > 245, "short images must be padded, not stretched");
            }
        }
        assert_eq!(std::fs::read_dir(&output).unwrap().count(), 8, "unique outputs, no temporary files");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_stitch_rejects_damaged_duplicate_and_animated_inputs() {
        use image::codecs::gif::GifEncoder;
        use image::{Delay, Frame};
        let unique = format!("toolknit-stitch-invalid-{}", std::process::id());
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create invalid stitch test directory");
        let valid = directory.join("valid.png");
        let damaged = directory.join("damaged.png");
        let animated = directory.join("animated.gif");
        image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]))
            .save(&valid)
            .expect("write valid input");
        std::fs::write(&damaged, b"not an image").expect("write damaged input");
        let gif_file = std::fs::File::create(&animated).expect("create animated GIF");
        let mut encoder = GifEncoder::new(gif_file);
        for color in [[255, 0, 0, 255], [0, 0, 255, 255]] {
            encoder
                .encode_frame(Frame::from_parts(
                    image::RgbaImage::from_pixel(2, 2, image::Rgba(color)),
                    0,
                    0,
                    Delay::from_numer_denom_ms(100, 1),
                ))
                .expect("encode GIF frame");
        }
        drop(encoder);

        assert!(validate_image_batch_inputs(&[
            valid.to_string_lossy().into_owned(),
            damaged.to_string_lossy().into_owned(),
        ])
        .is_err());
        assert!(validate_image_batch_inputs(&[
            valid.to_string_lossy().into_owned(),
            valid.to_string_lossy().into_owned(),
        ])
        .expect_err("duplicate must fail")
        .contains("Duplicate"));
        assert!(validate_image_batch_inputs(&[
            valid.to_string_lossy().into_owned(),
            animated.to_string_lossy().into_owned(),
        ])
        .expect_err("animated GIF must fail")
        .contains("animated"));
        std::fs::remove_dir_all(&directory).expect("remove invalid stitch test directory");
    }

    #[test]
    fn icon_archive_session_publishes_uniquely_and_discards_partial_output() {
        let unique = format!(
            "toolknit-icon-archive-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary icon archive directory");
        std::fs::write(directory.join("icons.zip"), b"existing").expect("write existing archive");

        let session_id = begin_icon_archive_write(
            directory.to_string_lossy().to_string(),
            "icons.zip".to_string(),
        )
        .expect("begin archive write");
        append_icon_archive_chunk(session_id, b"generated".to_vec()).expect("append archive chunk");
        let output = finalize_icon_archive_write(session_id).expect("publish archive");
        assert!(output.ends_with("icons_1.zip"));
        assert_eq!(
            std::fs::read(&output).expect("read published archive"),
            b"generated"
        );
        assert_eq!(
            std::fs::read(directory.join("icons.zip")).expect("read original archive"),
            b"existing"
        );

        let discarded_session = begin_icon_archive_write(
            directory.to_string_lossy().to_string(),
            "discard.zip".to_string(),
        )
        .expect("begin archive discard test");
        append_icon_archive_chunk(discarded_session, b"partial".to_vec())
            .expect("append partial archive");
        discard_icon_archive_write(discarded_session).expect("discard partial archive");
        assert!(!directory.join("discard.zip").exists());
        std::fs::remove_dir_all(&directory).expect("remove temporary icon archive directory");
    }

    #[test]
    fn image_conversion_keeps_successful_outputs_when_one_input_is_damaged() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let directory = image_test_directory("partial-convert");
        let inputs = directory.join("inputs");
        let outputs = directory.join("outputs");
        std::fs::create_dir_all(&inputs).expect("create conversion input directory");
        let first = inputs.join("first.png");
        let damaged = inputs.join("damaged.png");
        let second = inputs.join("second.png");
        image::RgbaImage::from_pixel(8, 6, image::Rgba([240, 20, 30, 255]))
            .save(&first)
            .expect("write first conversion input");
        std::fs::write(&damaged, b"not an image").expect("write damaged conversion input");
        image::RgbaImage::from_pixel(5, 9, image::Rgba([10, 180, 220, 255]))
            .save(&second)
            .expect("write second conversion input");

        let mut progress = Vec::new();
        let result = convert_image_batch_blocking_with_progress(
            vec![
                first.to_string_lossy().into_owned(),
                damaged.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            outputs.to_string_lossy().into_owned(),
            "PNG".to_string(),
            |event| progress.push(event),
        )
        .expect("conversion batch should return a partial result");

        assert_eq!((result.success_count, result.fail_count), (2, 1));
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("damaged.png"));
        assert_eq!(
            image::open(outputs.join("first.png")).unwrap().dimensions(),
            (8, 6)
        );
        assert_eq!(
            image::open(outputs.join("second.png"))
                .unwrap()
                .dimensions(),
            (5, 9)
        );
        let damaged_error = progress
            .iter()
            .position(|event| event.file_name == "damaged.png" && event.status == "error")
            .expect("damaged input should emit an error result");
        let later_success = progress
            .iter()
            .position(|event| event.file_name == "second.png" && event.status == "done")
            .expect("later valid input should still complete");
        assert!(damaged_error < later_success);
        assert!(!std::fs::read_dir(&outputs)
            .expect("read conversion output directory")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("toolknit")));
        std::fs::remove_dir_all(&directory).expect("remove partial conversion test directory");
    }

    #[test]
    fn image_compression_keeps_successes_and_reports_bad_or_unsupported_inputs() {
        let _conversion_lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let directory = image_test_directory("partial-compress");
        let inputs = directory.join("inputs");
        let outputs = directory.join("outputs");
        std::fs::create_dir_all(&inputs).expect("create compression input directory");
        let first = inputs.join("first.jpg");
        let damaged = inputs.join("damaged.jpg");
        let unsupported = inputs.join("unsupported.bmp");
        let second = inputs.join("second.jpg");

        let mut source = image::DynamicImage::new_rgba8(256, 256);
        for y in 0..256 {
            for x in 0..256 {
                let value = ((x * 31 + y * 17) % 256) as u8;
                source.put_pixel(
                    x,
                    y,
                    image::Rgba([value, value.wrapping_mul(3), value.wrapping_mul(7), 255]),
                );
            }
        }
        write_converted_image(&source, &first, image::ImageFormat::Jpeg)
            .expect("write first JPEG input");
        std::fs::write(&damaged, b"not an image").expect("write damaged JPEG input");
        image::RgbaImage::from_pixel(12, 12, image::Rgba([30, 60, 90, 255]))
            .save(&unsupported)
            .expect("write unsupported BMP input");
        write_converted_image(&source, &second, image::ImageFormat::Jpeg)
            .expect("write second JPEG input");

        let input_paths = vec![
            first.to_string_lossy().into_owned(),
            damaged.to_string_lossy().into_owned(),
            unsupported.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ];
        assert!(validate_image_compression_inputs(&input_paths, "low").is_err());
        let expected_original_size =
            std::fs::metadata(&first).unwrap().len() + std::fs::metadata(&second).unwrap().len();
        let mut progress = Vec::new();
        let result = compress_image_batch_blocking_with_progress(
            input_paths,
            outputs.to_string_lossy().into_owned(),
            "low".to_string(),
            |event| progress.push(event),
        )
        .expect("compression batch should return a partial result");

        assert_eq!((result.success_count, result.fail_count), (2, 2));
        assert_eq!(result.errors.len(), 2);
        assert!(result
            .errors
            .iter()
            .any(|error| error.contains("damaged.jpg")));
        assert!(result
            .errors
            .iter()
            .any(|error| error.contains("unsupported.bmp")));
        assert_eq!(result.original_size, Some(expected_original_size));
        assert!(result.compressed_size.unwrap() < expected_original_size);
        assert!(image::open(outputs.join("first.jpg")).is_ok());
        assert!(image::open(outputs.join("second.jpg")).is_ok());
        assert!(!outputs.join("damaged.jpg").exists());
        assert!(!outputs.join("unsupported.bmp").exists());
        let damaged_error = progress
            .iter()
            .position(|event| event.file_name == "damaged.jpg" && event.status == "error")
            .expect("damaged compression input should emit an error result");
        let later_success = progress
            .iter()
            .position(|event| event.file_name == "second.jpg" && event.status == "done")
            .expect("later compression input should still complete");
        assert!(damaged_error < later_success);
        assert!(!std::fs::read_dir(&outputs)
            .expect("read compression output directory")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("toolknit")));
        std::fs::remove_dir_all(&directory).expect("remove partial compression test directory");
    }

    #[test]
    fn jpeg_compression_produces_a_smaller_readable_file() {
        let unique = format!(
            "toolknit-compression-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary compression test directory");
        let source_path = directory.join("source.jpg");
        let compressed_path = directory.join("compressed.jpg");

        let mut source = image::DynamicImage::new_rgba8(256, 256);
        for y in 0..256 {
            for x in 0..256 {
                let value = ((x * 31 + y * 17) % 256) as u8;
                source.put_pixel(
                    x,
                    y,
                    image::Rgba([value, value.wrapping_mul(3), value.wrapping_mul(7), 255]),
                );
            }
        }
        write_converted_image(&source, &source_path, image::ImageFormat::Jpeg)
            .expect("write high-quality source JPEG");
        write_compressed_image(
            &source,
            &compressed_path,
            image::ImageFormat::Jpeg,
            35,
            image::codecs::png::CompressionType::Best,
        )
        .expect("write compressed JPEG");

        let source_size = std::fs::metadata(&source_path)
            .expect("source metadata")
            .len();
        let compressed_size = std::fs::metadata(&compressed_path)
            .expect("compressed metadata")
            .len();
        assert!(compressed_size < source_size);
        assert!(image::open(&compressed_path).is_ok());
        std::fs::remove_dir_all(&directory).expect("remove temporary compression test directory");
    }

    #[test]
    fn webp_compression_is_lossless_and_quality_independent() {
        let unique = format!(
            "toolknit-webp-compression-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before Unix epoch")
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&directory).expect("create temporary image test directory");
        let high_quality_output = directory.join("high.webp");
        let low_quality_output = directory.join("low.webp");
        let mut source = image::DynamicImage::new_rgba8(2, 2);
        source.put_pixel(0, 0, image::Rgba([10, 20, 30, 40]));
        source.put_pixel(1, 1, image::Rgba([200, 150, 100, 50]));

        write_compressed_image(
            &source,
            &high_quality_output,
            image::ImageFormat::WebP,
            90,
            image::codecs::png::CompressionType::Fast,
        )
        .expect("write high preset lossless WebP");
        write_compressed_image(
            &source,
            &low_quality_output,
            image::ImageFormat::WebP,
            35,
            image::codecs::png::CompressionType::Best,
        )
        .expect("write low preset lossless WebP");
        assert_eq!(
            std::fs::read(&high_quality_output).expect("read high preset WebP"),
            std::fs::read(&low_quality_output).expect("read low preset WebP")
        );
        for output in [&high_quality_output, &low_quality_output] {
            let decoded = image::open(output).expect("decode WebP").to_rgba8();
            assert_eq!(decoded, source.to_rgba8());
        }
        std::fs::remove_dir_all(&directory).expect("remove temporary image test directory");
    }
}
