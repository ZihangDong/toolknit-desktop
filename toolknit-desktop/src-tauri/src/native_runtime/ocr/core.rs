//! Bounded DB geometry and CTC decoding; no network or platform calls.
use image::{GrayImage, Luma, Rgb, RgbImage};
use imageproc::{
    contours::{find_contours, BorderType},
    geometry::min_area_rect,
};
use serde::Serialize;

pub(super) type Quad = [[f32; 2]; 4];
#[derive(Clone, Debug, Serialize)]
pub(super) struct Word {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
}
#[derive(Clone, Debug, Serialize)]
pub(super) struct Line {
    pub id: usize,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
    pub polygon: Quad,
    pub words: Vec<Word>,
}
#[derive(Clone, Debug)]
pub(super) struct Detection {
    pub quad: Quad,
    pub score: f32,
}
#[derive(Clone, Debug)]
pub(super) struct Token {
    pub text: String,
    pub start: usize,
    pub end: usize,
    pub score: f32,
}

pub(super) fn distance(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}
pub(super) fn bounds(q: &Quad) -> (f32, f32, f32, f32) {
    let x = q.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min);
    let y = q.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let r = q.iter().map(|p| p[0]).fold(f32::NEG_INFINITY, f32::max);
    let b = q.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max);
    (x, y, r, b)
}
fn inside(q: &Quad, x: f32, y: f32) -> bool {
    let mut positive = false;
    let mut negative = false;
    for i in 0..4 {
        let a = q[i];
        let b = q[(i + 1) % 4];
        let c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        positive |= c > 0.01;
        negative |= c < -0.01;
    }
    !(positive && negative)
}
pub(super) fn detections(
    prob: &[f32],
    width: usize,
    height: usize,
    source: (u32, u32),
) -> Result<Vec<Detection>, String> {
    if width < 1 || height < 1 || width > 2048 || height > 2048 || prob.len() != width * height {
        return Err("ocr:model-shape".into());
    }
    let binary = GrayImage::from_fn(width as u32, height as u32, |x, y| {
        Luma([
            if prob[y as usize * width + x as usize].is_finite()
                && prob[y as usize * width + x as usize] > 0.3
            {
                255
            } else {
                0
            },
        ])
    });
    let contours = find_contours::<i32>(&binary);
    let mut outer: Vec<_> = contours
        .iter()
        .filter(|c| c.border_type == BorderType::Outer && c.points.len() >= 4)
        .collect();
    if outer.len() > 10000 {
        return Err("ocr:too-complex".into());
    }
    // Large text regions have priority when noise creates many tiny components.
    outer.sort_by_key(|c| std::cmp::Reverse(c.points.len()));
    let sx = source.0 as f32 / width as f32;
    let sy = source.1 as f32 / height as f32;
    let mut result = Vec::new();
    let mut evaluated = 0usize;
    for contour in outer.into_iter().take(1500) {
        let corners = min_area_rect(&contour.points);
        let mut points: Vec<_> = corners.iter().map(|p| [p.x as f32, p.y as f32]).collect();
        let center = [
            points.iter().map(|p| p[0]).sum::<f32>() / 4.,
            points.iter().map(|p| p[1]).sum::<f32>() / 4.,
        ];
        points.sort_by(|a, b| {
            (a[1] - center[1])
                .atan2(a[0] - center[0])
                .total_cmp(&(b[1] - center[1]).atan2(b[0] - center[0]))
        });
        let first = (0..4)
            .min_by(|&a, &b| {
                (points[a][0] + points[a][1]).total_cmp(&(points[b][0] + points[b][1]))
            })
            .unwrap();
        let q: Quad = std::array::from_fn(|i| points[(first + i) % 4]);
        let w = distance(q[0], q[1]);
        let h = distance(q[1], q[2]);
        if w.min(h) < 2.0 {
            continue;
        }
        let (x, y, r, b) = bounds(&q);
        let mut sum = 0.;
        let mut count = 0;
        for py in (y.max(0.) as usize)..=(b.ceil() as usize).min(height - 1) {
            for px in (x.max(0.) as usize)..=(r.ceil() as usize).min(width - 1) {
                evaluated += 1;
                if evaluated > width * height * 12 {
                    return Err("ocr:too-complex".into());
                }
                if inside(&q, px as f32, py as f32) {
                    let value = prob[py * width + px];
                    if !value.is_finite() {
                        return Err("ocr:model-output".into());
                    }
                    sum += value.clamp(0., 1.);
                    count += 1;
                }
            }
        }
        if count == 0 {
            continue;
        }
        let score = sum / count as f32;
        if score < 0.5 {
            continue;
        }
        // DB unclip distance: area * ratio / perimeter. For the minimum-area
        // rectangle this expands orthogonal edges, retaining perspective crop.
        let pad = (w * h * 1.5 / (2. * (w + h))).max(1.);
        let ux = [(q[1][0] - q[0][0]) / w, (q[1][1] - q[0][1]) / w];
        let uy = [(q[3][0] - q[0][0]) / h, (q[3][1] - q[0][1]) / h];
        let signs = [(-1., -1.), (1., -1.), (1., 1.), (-1., 1.)];
        let expanded = std::array::from_fn(|i| {
            [
                ((q[i][0] + pad * (signs[i].0 * ux[0] + signs[i].1 * uy[0])) * sx)
                    .clamp(0., source.0.saturating_sub(1) as f32),
                ((q[i][1] + pad * (signs[i].0 * ux[1] + signs[i].1 * uy[1])) * sy)
                    .clamp(0., source.1.saturating_sub(1) as f32),
            ]
        });
        result.push(Detection {
            quad: expanded,
            score,
        });
        if result.len() >= 1000 {
            break;
        }
    }
    Ok(result)
}

pub(super) fn crop(source: &RgbImage, q: &Quad) -> Result<RgbImage, String> {
    use imageproc::geometric_transformations::{warp_into, Interpolation, Projection};
    let width = distance(q[0], q[1])
        .max(distance(q[3], q[2]))
        .round()
        .clamp(2., 8192.) as u32;
    let height = distance(q[0], q[3])
        .max(distance(q[1], q[2]))
        .round()
        .clamp(2., 4096.) as u32;
    if u64::from(width) * u64::from(height) > 8_000_000 {
        return Err("ocr:too-complex".into());
    }
    let projection = Projection::from_control_points(
        q.map(|p| (p[0], p[1])),
        [
            (0., 0.),
            (width as f32 - 1., 0.),
            (width as f32 - 1., height as f32 - 1.),
            (0., height as f32 - 1.),
        ],
    )
    .ok_or("ocr:geometry")?;
    let mut result = RgbImage::new(width, height);
    warp_into(
        source,
        &projection,
        Interpolation::Bilinear,
        Rgb([255, 255, 255]),
        &mut result,
    );
    if height as f32 / width as f32 > 1.5 {
        result = image::imageops::rotate270(&result);
    }
    Ok(result)
}

pub(super) fn decode_ctc(
    data: &[f32],
    steps: usize,
    classes: usize,
    dictionary: &[String],
    ratio: f32,
) -> Result<Vec<Token>, String> {
    if steps == 0
        || steps > 4096
        || classes != dictionary.len()
        || classes < 2
        || data.len() != steps * classes
        || !ratio.is_finite()
        || ratio <= 0.
        || ratio > 1.
    {
        return Err("ocr:model-shape".into());
    }
    let limit = ((steps as f32 * ratio).ceil() as usize + 1).min(steps);
    let mut previous = 0;
    let mut result: Vec<Token> = Vec::new();
    for (step, row) in data.chunks_exact(classes).take(limit).enumerate() {
        let (id, &score) = row
            .iter()
            .enumerate()
            .filter(|(_, v)| v.is_finite())
            .max_by(|a, b| a.1.total_cmp(b.1))
            .ok_or("ocr:model-output")?;
        if id > 0 {
            if previous == id {
                if let Some(token) = result.last_mut() {
                    token.end = step + 1;
                    token.score = token.score.max(score.clamp(0., 1.));
                }
            } else {
                result.push(Token {
                    text: dictionary[id].clone(),
                    start: step,
                    end: step + 1,
                    score: score.clamp(0., 1.),
                });
            }
        }
        previous = id;
    }
    Ok(result)
}

pub(super) fn line(
    id: usize,
    quad: Quad,
    tokens: Vec<Token>,
    steps: usize,
    ratio: f32,
    det_score: f32,
) -> Option<Line> {
    let text = tokens
        .iter()
        .map(|t| t.text.as_str())
        .collect::<String>()
        .trim()
        .to_owned();
    if text.is_empty() {
        return None;
    }
    let (x, y, r, b) = bounds(&quad);
    let width = r - x;
    let height = b - y;
    if width < 1. || height < 1. {
        return None;
    }
    let confidence = tokens.iter().map(|t| t.score).sum::<f32>() / tokens.len().max(1) as f32;
    let words = tokens
        .iter()
        .map(|token| {
            let from = (token.start as f32 / (steps as f32 * ratio)).clamp(0., 1.);
            let to = (token.end as f32 / (steps as f32 * ratio)).clamp(from, 1.);
            Word {
                text: token.text.clone(),
                x: x + width * from,
                y,
                width: (width * (to - from)).max(0.1),
                height,
                confidence: token.score,
            }
        })
        .collect();
    Some(Line {
        id,
        text,
        x,
        y,
        width,
        height,
        confidence: confidence.min(det_score.max(0.7)),
        polygon: quad,
        words,
    })
}

pub(super) fn reading_order(lines: &mut [Line]) {
    lines.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
    let mut first = 0;
    while first < lines.len() {
        let mut end = first + 1;
        let anchor = lines[first].y;
        let mut height = lines[first].height;
        while end < lines.len()
            && (lines[end].y - anchor).abs() < height.min(lines[end].height) * 0.45
        {
            height = height.min(lines[end].height);
            end += 1;
        }
        lines[first..end].sort_by(|a, b| a.x.total_cmp(&b.x));
        first = end;
    }
    for (id, line) in lines.iter_mut().enumerate() {
        line.id = id;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ctc_repeats_blank_confidence_and_padding_are_distinct() {
        let dict = vec!["".into(), "中".into(), "文".into()];
        let ids = [1, 1, 0, 1, 2, 0, 2, 2];
        let mut logits = vec![0.; ids.len() * 3];
        for (t, id) in ids.iter().enumerate() {
            logits[t * 3 + id] = 0.99;
        }
        let out = decode_ctc(&logits, 8, 3, &dict, 1.).unwrap();
        assert_eq!(
            out.iter().map(|t| t.text.as_str()).collect::<String>(),
            "中中文文"
        );
        assert_eq!((out[0].start, out[0].end), (0, 2));
        assert!(decode_ctc(&logits, 8, 4, &dict, 1.).is_err());
    }
    #[test]
    fn db_coordinates_expand_and_restore_the_source_scale() {
        let mut prob = vec![0.; 64 * 32];
        for y in 10..18 {
            for x in 8..53 {
                prob[y * 64 + x] = 0.95;
            }
        }
        let found = detections(&prob, 64, 32, (640, 320)).unwrap();
        assert_eq!(found.len(), 1);
        let (x, y, r, b) = bounds(&found[0].quad);
        assert!(x < 80. && y < 100. && r > 520. && b > 170.);
        assert!(detections(&[], 64, 32, (640, 320)).is_err());
        let original = RgbImage::from_pixel(640, 320, Rgb([255, 255, 255]));
        let image = crop(&original, &found[0].quad).unwrap();
        assert!(image.width() > 400 && image.height() > 60);
    }
}
