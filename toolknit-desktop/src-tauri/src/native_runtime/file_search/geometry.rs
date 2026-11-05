//! Physical desktop geometry. The saved anchor and expanded bounds are distinct.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
impl Rect {
    pub fn right(self) -> i64 {
        self.x as i64 + self.width as i64
    }
    pub fn bottom(self) -> i64 {
        self.y as i64 + self.height as i64
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Layout {
    pub anchor: Rect,
    pub bar: Rect,
    pub card: Rect,
    pub scale: f64,
    pub above: bool,
    pub origin_x: f64,
    pub origin_y: f64,
}

pub(super) fn clamp(area: Rect, rect: Rect) -> Rect {
    let width = rect.width.max(1).min(area.width.max(1));
    let height = rect.height.max(1).min(area.height.max(1));
    Rect {
        x: (rect.x as i64).clamp(
            area.x as i64,
            area.right().max(area.x as i64 + 1) - width as i64,
        ) as i32,
        y: (rect.y as i64).clamp(
            area.y as i64,
            area.bottom().max(area.y as i64 + 1) - height as i64,
        ) as i32,
        width,
        height,
    }
}

pub(super) fn layout(area: Rect, scale: f64, anchor: Option<Rect>, expanded: bool) -> Layout {
    let scale = if scale.is_finite() {
        scale.clamp(0.5, 8.0)
    } else {
        1.0
    };
    let px = |v: f64| (v * scale).round() as u32;
    let pad = px(12.0).min(area.width / 8).min(area.height / 8);
    let safe = Rect {
        x: area.x + pad as i32,
        y: area.y + pad as i32,
        width: area.width.saturating_sub(pad * 2).max(1),
        height: area.height.saturating_sub(pad * 2).max(1),
    };
    let anchor = clamp(
        safe,
        Rect {
            width: px(148.0),
            height: px(48.0),
            ..anchor.unwrap_or(Rect {
                x: safe.x + px(24.0) as i32,
                y: safe.y + px(40.0) as i32,
                ..Rect::default()
            })
        },
    );
    let width = px(500.0).min(safe.width);
    let height = px(56.0).min(safe.height);
    let gap = px(20.0);
    let mut bar = clamp(
        safe,
        Rect {
            x: anchor.x,
            y: anchor.y,
            width,
            height,
        },
    );
    // Pick the expansion side once from the anchor, not from a previous panel.
    if anchor.x as i64 + anchor.width as i64 / 2 > safe.x as i64 + safe.width as i64 / 2 {
        bar = clamp(
            safe,
            Rect {
                x: (anchor.right() - width as i64) as i32,
                ..bar
            },
        );
    }
    let below = (safe.bottom() - bar.bottom() - gap as i64).max(0) as u32;
    let above_space = (bar.y as i64 - safe.y as i64 - gap as i64).max(0) as u32;
    let mut above = below < px(210.0) && above_space > below;
    let mut available = if above { above_space } else { below };
    if available < px(140.0) && safe.height > height + gap {
        bar.y = safe.y;
        above = false;
        available = safe.height - height - gap;
    }
    let card_height = px(406.0).min(available).max(1);
    let card = Rect {
        x: bar.x,
        y: if above {
            bar.y - gap as i32 - card_height as i32
        } else {
            bar.bottom() as i32 + gap as i32
        },
        width,
        height: card_height,
    };
    let origin_x = (anchor.x - bar.x) as f64 / scale;
    let origin_y = (anchor.y - bar.y) as f64 / scale;
    Layout {
        anchor,
        bar: if expanded { bar } else { anchor },
        card,
        scale,
        above,
        origin_x,
        origin_y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paired_surfaces_keep_gap_and_fit_work_areas() {
        for area in [
            Rect {
                x: 60,
                y: 0,
                width: 1860,
                height: 1080,
            },
            Rect {
                x: -1920,
                y: -120,
                width: 1920,
                height: 1040,
            },
            Rect {
                x: 0,
                y: 56,
                width: 800,
                height: 544,
            },
            Rect {
                x: 0,
                y: 0,
                width: 640,
                height: 440,
            },
        ] {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                for (x, y) in [(-5000, -5000), (10, 40), (700, 800), (5000, 5000)] {
                    let a = Some(Rect {
                        x,
                        y,
                        ..Rect::default()
                    });
                    let expanded = layout(area, scale, a, true);
                    let collapsed = layout(area, scale, a, false);
                    assert_eq!(expanded.anchor, collapsed.anchor);
                    assert_eq!(expanded.bar.width, expanded.card.width);
                    let gap = if expanded.above {
                        expanded.bar.y as i64 - expanded.card.bottom()
                    } else {
                        expanded.card.y as i64 - expanded.bar.bottom()
                    };
                    assert_eq!(gap, (20.0 * scale).round() as i64);
                    for r in [expanded.bar, expanded.card, expanded.anchor] {
                        assert!(
                            r.x >= area.x
                                && r.y >= area.y
                                && r.right() <= area.right()
                                && r.bottom() <= area.bottom(),
                            "{expanded:?}"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn clamp_handles_extreme_coordinates_and_invalid_scale() {
        let area = Rect {
            x: -400,
            y: 0,
            width: 320,
            height: 480,
        };
        let l = layout(
            area,
            f64::NAN,
            Some(Rect {
                x: i32::MAX,
                y: i32::MIN,
                ..Rect::default()
            }),
            true,
        );
        assert_eq!(l.scale, 1.0);
        assert_eq!(l.card.y as i64 - l.bar.bottom(), 20);
    }
}
