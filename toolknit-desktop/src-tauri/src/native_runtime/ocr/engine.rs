use super::core::{self, Detection, Line};
use image::{Rgb, RgbImage};
use ndarray::Array4;
use ort::{
    execution_providers::CPUExecutionProvider,
    session::{builder::GraphOptimizationLevel, Session},
};
use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
pub(super) struct Rule {
    pub axis: &'static str,
    pub at: f32,
    pub from: f32,
    pub to: f32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResultPage {
    pub text: String,
    pub lines: Vec<Line>,
    pub width: u32,
    pub height: u32,
    pub rules: Vec<Rule>,
    pub engine: &'static str,
    pub low_confidence_lines: usize,
    pub elapsed_ms: u128,
}
pub(super) struct Engine {
    detector: Session,
    recognizer: Session,
    dictionary: Vec<String>,
}

fn checkpoint(cancel: &AtomicBool, started: Instant) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("ocr:cancelled".into());
    }
    if started.elapsed() > Duration::from_secs(120) {
        return Err("ocr:timeout".into());
    }
    Ok(())
}
fn session(path: &Path) -> Result<Session, String> {
    Session::builder()
        .and_then(|builder| builder.with_optimization_level(GraphOptimizationLevel::Level3))
        .and_then(|builder| builder.with_intra_threads(2))
        .and_then(|builder| builder.with_inter_threads(1))
        .and_then(|builder| {
            builder.with_execution_providers([CPUExecutionProvider::default()
                .build()
                .error_on_failure()])
        })
        .and_then(|builder| builder.commit_from_file(path))
        .map_err(|_| "ocr:model-load".into())
}
fn tensor(image: &RgbImage, height: u32, width: u32, detector: bool) -> Array4<f32> {
    let mut array = Array4::zeros((1, 3, height as usize, width as usize));
    for (x, y, pixel) in image.enumerate_pixels() {
        if x >= width || y >= height {
            continue;
        }
        for c in 0..3 {
            let value = pixel[2 - c] as f32 / 255.; // Both official pipelines decode BGR.
            array[[0, c, y as usize, x as usize]] = if detector {
                (value - [0.485, 0.456, 0.406][c]) / [0.229, 0.224, 0.225][c]
            } else {
                (value - 0.5) / 0.5
            };
        }
    }
    array
}
fn decode(bytes: &[u8]) -> Result<RgbImage, String> {
    use image::ImageReader;
    if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
        return Err("ocr:image-too-large".into());
    }
    let reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "ocr:invalid-image")?;
    let format = reader.format().ok_or("ocr:invalid-image")?;
    let (w, h) = reader.into_dimensions().map_err(|_| "ocr:invalid-image")?;
    if w == 0 || h == 0 || w > 32768 || h > 32768 || u64::from(w) * u64::from(h) > 32_000_000 {
        return Err("ocr:image-too-large".into());
    }
    let mut reader = ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32768);
    limits.max_image_height = Some(32768);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let rgba = reader.decode().map_err(|_| "ocr:invalid-image")?.to_rgba8();
    let mut rgb = RgbImage::from_fn(w, h, |x, y| {
        let p = rgba.get_pixel(x, y);
        Rgb(std::array::from_fn(|c| {
            ((u16::from(p[c]) * u16::from(p[3]) + 255 * (255 - u16::from(p[3]))) / 255) as u8
        }))
    });
    // A dark UI canvas is inverted for inference, never for the user's source.
    let corners = [
        (w / 20, h / 20),
        (w * 19 / 20, h / 20),
        (w / 20, h * 19 / 20),
        (w * 19 / 20, h * 19 / 20),
    ];
    let dark = corners
        .iter()
        .filter(|&&(x, y)| {
            let p = rgb.get_pixel(x.min(w - 1), y.min(h - 1));
            u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]) < 240
        })
        .count()
        >= 3;
    if dark {
        for p in rgb.pixels_mut() {
            for c in 0..3 {
                p[c] = 255 - p[c];
            }
        }
    }
    Ok(rgb)
}

impl Engine {
    pub(super) fn open(directory: &Path) -> Result<Self, String> {
        crate::platform::onnx_runtime::prepare().map_err(|_| "ocr:runtime-unavailable")?;
        let dictionary: Vec<String> = serde_json::from_slice(
            &std::fs::read(directory.join("dictionary.json")).map_err(|_| "ocr:not-installed")?,
        )
        .map_err(|_| "ocr:model-dictionary")?;
        if dictionary.len() < 100
            || dictionary.len() > 40000
            || dictionary[0] != ""
            || dictionary.iter().any(|c| c.len() > 32)
        {
            return Err("ocr:model-dictionary".into());
        }
        Ok(Self {
            detector: session(&directory.join("det.onnx"))?,
            recognizer: session(&directory.join("rec.onnx"))?,
            dictionary,
        })
    }
    fn detect(&mut self, image: &RgbImage) -> Result<Vec<Detection>, String> {
        let scale = (1280. / image.width().max(image.height()) as f32).min(
            if image.width().max(image.height()) < 800 {
                2.0
            } else {
                1.0
            },
        );
        let dimension = |n: u32| (((n as f32 * scale / 32.).round() as u32).max(1) * 32).min(1536);
        let w = dimension(image.width());
        let h = dimension(image.height());
        let resized = image::imageops::resize(image, w, h, image::imageops::FilterType::Triangle);
        let value = ort::value::Tensor::from_array(tensor(&resized, h, w, true))
            .map_err(|_| "ocr:model-input")?;
        let name = self
            .detector
            .inputs
            .first()
            .ok_or("ocr:model-shape")?
            .name
            .clone();
        let outputs = self
            .detector
            .run(ort::inputs![name.as_str()=>value])
            .map_err(|_| "ocr:inference")?;
        let (shape, values) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|_| "ocr:model-output")?;
        if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
            return Err("ocr:model-shape".into());
        }
        core::detections(
            values,
            shape[3] as usize,
            shape[2] as usize,
            image.dimensions(),
        )
    }
    fn recognize_line(
        &mut self,
        image: &RgbImage,
        found: &Detection,
        id: usize,
    ) -> Result<Option<Line>, String> {
        let crop = core::crop(image, &found.quad)?;
        // Restore fine document strokes before the fixed 48 px recognition
        // resize. This affects inference only; exported source pixels stay intact.
        let crop = if crop.height() <= 80 {
            image::imageops::unsharpen(&image::imageops::contrast(&crop, 25.), 0.8, 3)
        } else {
            crop
        };
        let natural = (crop.width() as f32 * 48. / crop.height() as f32).ceil() as u32;
        let w = natural.clamp(320, 3200);
        let content = natural.min(w).max(1);
        let resized =
            image::imageops::resize(&crop, content, 48, image::imageops::FilterType::Triangle);
        let value = ort::value::Tensor::from_array(tensor(&resized, 48, w, false))
            .map_err(|_| "ocr:model-input")?;
        let name = self
            .recognizer
            .inputs
            .first()
            .ok_or("ocr:model-shape")?
            .name
            .clone();
        let outputs = self
            .recognizer
            .run(ort::inputs![name.as_str()=>value])
            .map_err(|_| "ocr:inference")?;
        let (shape, values) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|_| "ocr:model-output")?;
        if shape.len() != 3 || shape[0] != 1 {
            return Err("ocr:model-shape".into());
        }
        let ratio = content as f32 / w as f32;
        let tokens = core::decode_ctc(
            values,
            shape[1] as usize,
            shape[2] as usize,
            &self.dictionary,
            ratio,
        )?;
        Ok(core::line(
            id,
            found.quad,
            tokens,
            shape[1] as usize,
            ratio,
            found.score,
        ))
    }
    pub(super) fn recognize(
        &mut self,
        bytes: &[u8],
        cancel: &AtomicBool,
    ) -> Result<ResultPage, String> {
        let started = Instant::now();
        checkpoint(cancel, started)?;
        let image = decode(bytes)?;
        let (width, height) = image.dimensions();
        let mut detections = Vec::new();
        let vertical = height > width.saturating_mul(3) && height > 2400;
        let horizontal = width > height.saturating_mul(4) && width > 3200;
        let long = if vertical { height } else { width };
        let tile = if vertical || horizontal { 2000 } else { long };
        let mut at = 0;
        loop {
            checkpoint(cancel, started)?;
            let (x, y, w, h) = if vertical {
                (0, at, width, tile.min(height - at))
            } else if horizontal {
                (at, 0, tile.min(width - at), height)
            } else {
                (0, 0, width, height)
            };
            let part = image::imageops::crop_imm(&image, x, y, w, h).to_image();
            for mut found in self.detect(&part)? {
                // Overlap supplies a complete copy in the adjacent tile. Drop
                // clipped edge fragments before recognition/deduplication.
                let (left, top, right, bottom) = core::bounds(&found.quad);
                if (vertical
                    && ((y > 0 && top < 12.) || (y + h < height && bottom > h as f32 - 12.)))
                    || (horizontal
                        && ((x > 0 && left < 12.) || (x + w < width && right > w as f32 - 12.)))
                {
                    continue;
                }
                for point in &mut found.quad {
                    point[0] += x as f32;
                    point[1] += y as f32;
                }
                if !detections
                    .iter()
                    .any(|previous: &Detection| overlap(&previous.quad, &found.quad) > 0.6)
                {
                    detections.push(found);
                }
            }
            if detections.len() > 1000 {
                return Err("ocr:too-complex".into());
            }
            if !(vertical || horizontal) || at + tile >= long {
                break;
            }
            at += tile - 180;
        }
        let mut lines = Vec::new();
        let mut characters = 0;
        for found in detections {
            checkpoint(cancel, started)?;
            if let Some(line) = self.recognize_line(&image, &found, lines.len())? {
                characters += line.text.chars().count();
                if characters > 100000 {
                    return Err("ocr:too-complex".into());
                }
                lines.push(line);
            }
        }
        core::reading_order(&mut lines);
        checkpoint(cancel, started)?;
        let rules = ruled_lines(&image);
        Ok(ResultPage {
            text: lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
            low_confidence_lines: lines.iter().filter(|l| l.confidence < 0.8).count(),
            lines,
            width,
            height,
            rules,
            engine: "pp-ocrv5-mobile",
            elapsed_ms: started.elapsed().as_millis(),
        })
    }
}
fn overlap(a: &core::Quad, b: &core::Quad) -> f32 {
    let (ax, ay, ar, ab) = core::bounds(a);
    let (bx, by, br, bb) = core::bounds(b);
    let intersection = (ar.min(br) - ax.max(bx)).max(0.) * (ab.min(bb) - ay.max(by)).max(0.);
    intersection / ((ar - ax) * (ab - ay)).min((br - bx) * (bb - by)).max(1.)
}

fn ruled_lines(image: &RgbImage) -> Vec<Rule> {
    let mut result: Vec<Rule> = Vec::new();
    for horizontal in [true, false] {
        let (cross, length) = if horizontal {
            (image.height(), image.width())
        } else {
            (image.width(), image.height())
        };
        let minimum = (length / 25).max(40);
        for at in 0..cross {
            let mut start = None;
            let mut last = 0;
            for pos in 0..=length {
                let dark = pos < length && {
                    let p = if horizontal {
                        image.get_pixel(pos, at)
                    } else {
                        image.get_pixel(at, pos)
                    };
                    u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]) < 360
                };
                if dark {
                    start.get_or_insert(pos);
                    last = pos;
                } else if pos == length || pos.saturating_sub(last) > 2 {
                    if let Some(from) = start
                        .take()
                        .filter(|from| last.saturating_sub(*from) >= minimum)
                    {
                        let axis = if horizontal { "h" } else { "v" };
                        let existing = result.iter_mut().rev().take(30).find(|line| {
                            line.axis == axis
                                && (line.at - at as f32).abs() <= 3.
                                && (line.from - from as f32).abs() < 4.
                                && (line.to - last as f32).abs() < 4.
                        });
                        if let Some(line) = existing {
                            line.at = (line.at + at as f32) / 2.;
                        } else if result.len() < 3000 {
                            result.push(Rule {
                                axis,
                                at: at as f32,
                                from: from as f32,
                                to: last as f32,
                            });
                        }
                    }
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grid_rules_do_not_require_a_platform_engine() {
        let mut image = RgbImage::from_pixel(400, 300, Rgb([255, 255, 255]));
        for x in 20..380 {
            image.put_pixel(x, 40, Rgb([0, 0, 0]));
        }
        for y in 40..270 {
            image.put_pixel(20, y, Rgb([0, 0, 0]));
        }
        let rules = ruled_lines(&image);
        assert!(rules
            .iter()
            .any(|l| l.axis == "h" && l.from <= 20. && l.to >= 378.));
        assert!(rules
            .iter()
            .any(|l| l.axis == "v" && l.from <= 40. && l.to >= 268.));
        assert!(decode(&[1, 2, 3]).is_err());
    }
}
