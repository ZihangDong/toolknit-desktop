use super::*;
use image::{codecs::png::{CompressionType, FilterType, PngEncoder}, ImageEncoder};
use std::time::Instant;

// Synthetic pixels only. No desktop capture, files, clipboard or user settings.
#[test]
#[ignore = "explicit release-mode screenshot transport benchmark"]
fn screenshot_encoding_baseline() {
    for (width, height) in [(1920u32, 1080u32), (3840, 2160)] {
        let pixels: Vec<u8> = (0..width * height).flat_map(|i| {
            let x=i%width; let y=i/width;
            let text=(x%19<3 && y%24<15) || y%160<2;
            let color=if text { 30 } else { 245 };
            [color, color, if x>width/2 {(x.wrapping_mul(17)^y.wrapping_mul(11)) as u8} else {color}, 255]
        }).collect();
        for mode in ["default", "fast-adaptive", "fast-sub"] {
            let mut elapsed=Vec::new(); let mut size=0;
            for _ in 0..5 {
                let start=Instant::now(); let mut encoded=Vec::new();
                if mode=="default" {
                    image::DynamicImage::ImageRgba8(image::RgbaImage::from_raw(width,height,pixels.clone()).unwrap())
                        .write_to(&mut std::io::Cursor::new(&mut encoded),image::ImageFormat::Png).unwrap();
                } else {
                    PngEncoder::new_with_quality(&mut encoded,CompressionType::Fast,
                        if mode=="fast-sub" {FilterType::Sub} else {FilterType::Adaptive})
                        .write_image(&pixels,width,height,image::ExtendedColorType::Rgba8).unwrap();
                }
                elapsed.push(start.elapsed().as_secs_f64()*1000.0);size=encoded.len();
                assert_eq!(decode(&encoded).unwrap().to_rgba8().as_raw(),&pixels);
                std::hint::black_box(STANDARD.encode(&encoded));
            }
            elapsed.sort_by(f64::total_cmp);
            println!("ENCODE {width}x{height} {mode}: median_ms={:.2} max_ms={:.2} bytes={size}",elapsed[2],elapsed[4]);
        }
    }
}

#[cfg(windows)]
#[test]
#[ignore = "explicit Windows capture timings; pixels stay in memory and are never saved"]
fn screenshot_native_capture_timings() {
    let mut times=Vec::new();let mut dimensions=(0,0);let mut bytes=0;
    for _ in 0..10 {
        let start=Instant::now();let (desktop,png)=capture::capture().unwrap();
        times.push(start.elapsed().as_secs_f64()*1000.0);
        dimensions=(desktop.bounds.width,desktop.bounds.height);bytes=png.len();
        assert_eq!(image_dimensions(&png).unwrap(),dimensions);
    }
    times.sort_by(f64::total_cmp);
    println!("NATIVE_CAPTURE {}x{} n=10 median_ms={:.2} max_ms={:.2} png_bytes={bytes}; in-memory only",dimensions.0,dimensions.1,times[5],times[9]);
}
