type Resolution = (Option<f64>, Option<f64>);

fn pair(x: Option<f64>, y: Option<f64>) -> Resolution {
    let valid = |value: &f64| value.is_finite() && (36.0..=2400.0).contains(value);
    let x = x.filter(valid);
    let y = y.filter(valid);
    (x.or(y), y.or(x))
}

fn u16_at(bytes: &[u8], offset: usize, little: bool) -> Option<u16> {
    let value: [u8; 2] = bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?;
    Some(if little {
        u16::from_le_bytes(value)
    } else {
        u16::from_be_bytes(value)
    })
}
fn u32_at(bytes: &[u8], offset: usize, little: bool) -> Option<u32> {
    let value: [u8; 4] = bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    Some(if little {
        u32::from_le_bytes(value)
    } else {
        u32::from_be_bytes(value)
    })
}
fn tag(bytes: &[u8], offset: usize, expected: &[u8]) -> bool {
    bytes
        .get(offset..)
        .is_some_and(|value| value.starts_with(expected))
}

fn exif(bytes: &[u8]) -> Resolution {
    let parse = || -> Option<Resolution> {
        let little = bytes.starts_with(b"II");
        if !little && !bytes.starts_with(b"MM") {
            return None;
        }
        if u16_at(bytes, 2, little)? != 42 {
            return None;
        }
        let directory = u32_at(bytes, 4, little)? as usize;
        let count = usize::from(u16_at(bytes, directory, little)?);
        if count > 512 || directory.checked_add(2 + count * 12)? > bytes.len() {
            return None;
        }
        let (mut x, mut y, mut unit) = (None, None, 2);
        for i in 0..count {
            let entry = directory + 2 + i * 12;
            let field = u16_at(bytes, entry, little)?;
            let kind = u16_at(bytes, entry + 2, little)?;
            if u32_at(bytes, entry + 4, little)? != 1 {
                continue;
            }
            if field == 0x128 && kind == 3 {
                unit = u16_at(bytes, entry + 8, little)?;
            }
            if kind != 5 || !matches!(field, 0x11a | 0x11b) {
                continue;
            }
            let offset = u32_at(bytes, entry + 8, little)? as usize;
            let Some(numerator) = u32_at(bytes, offset, little) else {
                continue;
            };
            let Some(denominator) = offset
                .checked_add(4)
                .and_then(|offset| u32_at(bytes, offset, little))
            else {
                continue;
            };
            if denominator == 0 {
                continue;
            }
            let value = f64::from(numerator) / f64::from(denominator);
            if field == 0x11a {
                x = Some(value);
            } else {
                y = Some(value);
            }
        }
        if unit != 2 && unit != 3 {
            return None;
        }
        let factor = if unit == 3 { 2.54 } else { 1.0 };
        Some(pair(
            x.map(|value| value * factor),
            y.map(|value| value * factor),
        ))
    };
    parse().unwrap_or((None, None))
}

// Metadata is bounded by both the input buffer and a header-entry budget.
// JPEG entropy streams and PNG pixel chunks are never scanned as metadata.
pub(super) fn resolution(bytes: &[u8], format: image::ImageFormat) -> Resolution {
    let (mut density, mut metadata) = ((None, None), (None, None));
    match format {
        image::ImageFormat::Png if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => {
            let mut offset = 8;
            for _ in 0..4096 {
                let Some(length) = u32_at(bytes, offset, false) else {
                    break;
                };
                let Some(end) = offset
                    .checked_add(length as usize)
                    .and_then(|value| value.checked_add(12))
                else {
                    break;
                };
                if end > bytes.len() {
                    break;
                }
                if tag(bytes, offset + 4, b"pHYs") && length == 9 && bytes[offset + 16] == 1 {
                    density = pair(
                        u32_at(bytes, offset + 8, false).map(|v| f64::from(v) * 0.0254),
                        u32_at(bytes, offset + 12, false).map(|v| f64::from(v) * 0.0254),
                    );
                }
                if tag(bytes, offset + 4, b"eXIf") {
                    metadata = exif(&bytes[offset + 8..end - 4]);
                }
                if tag(bytes, offset + 4, b"IDAT") {
                    break;
                }
                offset = end;
            }
            if density.0.is_some() {
                density
            } else {
                metadata
            }
        }
        image::ImageFormat::Jpeg if bytes.starts_with(b"\xff\xd8") => {
            let mut offset = 2;
            for _ in 0..4096 {
                if bytes.get(offset) != Some(&255) {
                    break;
                }
                offset += 1;
                while bytes.get(offset) == Some(&255) {
                    offset += 1;
                }
                let Some(&marker) = bytes.get(offset) else {
                    break;
                };
                offset += 1;
                if marker == 0xda || marker == 0xd9 {
                    break;
                }
                if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
                    continue;
                }
                let Some(length) = u16_at(bytes, offset, false).map(usize::from) else {
                    break;
                };
                let Some(end) = offset.checked_add(length) else {
                    break;
                };
                let start = offset + 2;
                if length < 2 || end > bytes.len() {
                    break;
                }
                if marker == 0xe0 && length >= 16 && tag(bytes, start, b"JFIF\0") {
                    let unit = bytes[start + 7];
                    if unit == 1 || unit == 2 {
                        let factor = if unit == 2 { 2.54 } else { 1.0 };
                        density = pair(
                            u16_at(bytes, start + 8, false).map(|v| f64::from(v) * factor),
                            u16_at(bytes, start + 10, false).map(|v| f64::from(v) * factor),
                        );
                    }
                }
                if marker == 0xe1 && length >= 8 && tag(bytes, start, b"Exif\0\0") {
                    metadata = exif(&bytes[start + 6..end]);
                }
                offset = end;
            }
            if metadata.0.is_some() {
                metadata
            } else {
                density
            }
        }
        image::ImageFormat::WebP
            if bytes.len() >= 12 && tag(bytes, 0, b"RIFF") && tag(bytes, 8, b"WEBP") =>
        {
            let mut offset = 12;
            for _ in 0..4096 {
                let Some(length) = u32_at(bytes, offset + 4, true) else {
                    break;
                };
                let Some(end) = offset
                    .checked_add(8)
                    .and_then(|value| value.checked_add(length as usize))
                else {
                    break;
                };
                if end > bytes.len() {
                    break;
                }
                if tag(bytes, offset, b"EXIF") {
                    let payload = &bytes[offset + 8..end];
                    return exif(payload.strip_prefix(b"Exif\0\0").unwrap_or(payload));
                }
                offset = end + (length as usize % 2);
            }
            (None, None)
        }
        image::ImageFormat::Bmp
            if bytes.starts_with(b"BM")
                && bytes.len() >= 54
                && u32_at(bytes, 14, true).is_some_and(|value| value >= 40) =>
        {
            pair(
                u32_at(bytes, 38, true).map(|v| f64::from(v as i32) * 0.0254),
                u32_at(bytes, 42, true).map(|v| f64::from(v as i32) * 0.0254),
            )
        }
        _ => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn put16(bytes: &mut [u8], offset: usize, value: u16, little: bool) {
        bytes[offset..offset + 2].copy_from_slice(&if little {
            value.to_le_bytes()
        } else {
            value.to_be_bytes()
        });
    }
    fn put32(bytes: &mut [u8], offset: usize, value: u32, little: bool) {
        bytes[offset..offset + 4].copy_from_slice(&if little {
            value.to_le_bytes()
        } else {
            value.to_be_bytes()
        });
    }
    fn exif_fixture(little: bool) -> Vec<u8> {
        let mut bytes = vec![0; 66];
        bytes[..2].copy_from_slice(if little { b"II" } else { b"MM" });
        put16(&mut bytes, 2, 42, little);
        put32(&mut bytes, 4, 8, little);
        put16(&mut bytes, 8, 3, little);
        for (i, tag, kind, value) in [(0, 0x11a, 5, 50), (1, 0x11b, 5, 58), (2, 0x128, 3, 2)] {
            let offset = 10 + i * 12;
            put16(&mut bytes, offset, tag, little);
            put16(&mut bytes, offset + 2, kind, little);
            put32(&mut bytes, offset + 4, 1, little);
            if kind == 3 {
                put16(&mut bytes, offset + 8, value as u16, little);
            } else {
                put32(&mut bytes, offset + 8, value, little);
            }
        }
        put32(&mut bytes, 50, 300, little);
        put32(&mut bytes, 54, 1, little);
        put32(&mut bytes, 58, 150, little);
        put32(&mut bytes, 62, 1, little);
        bytes
    }
    #[test]
    fn image_pdf_resolution_reads_physical_units_and_exif_endianness() {
        for little in [false, true] {
            let bytes = exif_fixture(little);
            assert_eq!(exif(&bytes), (Some(300.0), Some(150.0)));
            let mut jpeg = vec![255, 216, 255, 225, 0, 74];
            jpeg.extend_from_slice(b"Exif\0\0");
            jpeg.extend_from_slice(&bytes);
            jpeg.extend_from_slice(&[255, 217]);
            assert_eq!(
                resolution(&jpeg, image::ImageFormat::Jpeg),
                (Some(300.0), Some(150.0))
            );
            for length in 0..jpeg.len() {
                resolution(&jpeg[..length], image::ImageFormat::Jpeg);
            }
        }
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x09pHYs".to_vec();
        png.extend_from_slice(&11811_u32.to_be_bytes());
        png.extend_from_slice(&5906_u32.to_be_bytes());
        png.extend_from_slice(&[1, 0, 0, 0, 0]);
        let values = resolution(&png, image::ImageFormat::Png);
        assert!((values.0.unwrap() - 300.0).abs() < 0.03);
        assert!((values.1.unwrap() - 150.0).abs() < 0.03);
        let mut bmp = vec![0; 54];
        bmp[..2].copy_from_slice(b"BM");
        put32(&mut bmp, 14, 40, true);
        put32(&mut bmp, 38, 11811, true);
        put32(&mut bmp, 42, 11811, true);
        assert!((resolution(&bmp, image::ImageFormat::Bmp).0.unwrap() - 300.0).abs() < 0.03);
    }
    #[test]
    fn image_pdf_resolution_bounds_invalid_offsets_and_counts() {
        let mut bytes = exif_fixture(true);
        put32(&mut bytes, 18, u32::MAX, true);
        assert_eq!(exif(&bytes), (Some(150.0), Some(150.0)));
        put16(&mut bytes, 8, 513, true);
        assert_eq!(exif(&bytes), (None, None));
        let mut seed = 1234567_u32;
        for size in 0..256 {
            let mut data = vec![0; size];
            for value in &mut data {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                *value = seed as u8;
            }
            for format in [
                image::ImageFormat::Png,
                image::ImageFormat::Jpeg,
                image::ImageFormat::Bmp,
                image::ImageFormat::WebP,
            ] {
                assert_eq!(resolution(&data, format), (None, None));
            }
        }
    }
    #[test]
    fn image_pdf_webp_resolution_respects_chunk_boundaries() {
        for prefix in [b"".as_slice(), b"Exif\0\0".as_slice()] {
            let payload = [prefix, &exif_fixture(true)].concat();
            let mut webp = b"RIFF\0\0\0\0WEBPEXIF".to_vec();
            webp.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            webp.extend_from_slice(&payload);
            assert_eq!(
                resolution(&webp, image::ImageFormat::WebP),
                (Some(300.0), Some(150.0))
            );
            for length in 0..webp.len() {
                assert_eq!(
                    resolution(&webp[..length], image::ImageFormat::WebP),
                    (None, None)
                );
            }
        }
        // A prefix crossing the declared chunk boundary belongs to another chunk.
        for length in 0..6_u32 {
            let mut webp = b"RIFF\0\0\0\0WEBPEXIF".to_vec();
            webp.extend_from_slice(&length.to_le_bytes());
            webp.extend_from_slice(b"Exif\0\0");
            webp.extend_from_slice(&exif_fixture(true));
            assert_eq!(resolution(&webp, image::ImageFormat::WebP), (None, None));
        }
    }
}
