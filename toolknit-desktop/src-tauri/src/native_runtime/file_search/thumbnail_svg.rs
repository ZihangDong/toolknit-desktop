//! Static SVG rasterization in the bounded ordinary-user thumbnail child.
use resvg::{tiny_skia, usvg};

pub(super) fn render(bytes: &[u8]) -> Option<image::DynamicImage> {
    if bytes.len() > 2 * 1024 * 1024 || std::str::from_utf8(bytes).is_err() { return None; }
    let mut xml = quick_xml::Reader::from_reader(bytes);
    let mut nodes = 0usize;
    loop {
        match xml.read_event().ok()? {
            quick_xml::events::Event::Eof => break,
            quick_xml::events::Event::DocType(_) => return None,
            quick_xml::events::Event::Start(_) | quick_xml::events::Event::Empty(_) => {
                nodes += 1; if nodes > 10_000 { return None; }
            }
            _ => {}
        }
    }
    let mut options = usvg::Options::default();
    // Neither local paths nor remote URLs may be read by an SVG. Embedded
    // raster images are allowed only after the same bounded dimension check.
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    options.image_href_resolver.resolve_data = Box::new(|mime, data, options| {
        if data.len() > 1024 * 1024 || !matches!(mime, "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif") { return None; }
        let (w, h) = image::ImageReader::new(std::io::Cursor::new(data.as_slice())).with_guessed_format().ok()?.into_dimensions().ok()?;
        if u64::from(w) * u64::from(h) > 24_000_000 { return None; }
        usvg::ImageHrefResolver::default_data_resolver()(mime, data, options)
    });
    // Load only fixed system fallback fonts, and only for SVGs containing text.
    // Do not scan user font directories or resolve font URLs from the document.
    #[cfg(windows)]
    if bytes.windows(5).any(|s| s == b"<text") {
        if let Some(directory) = std::env::var_os("WINDIR") {
            let fonts = std::path::PathBuf::from(directory).join("Fonts");
            for name in ["segoeui.ttf", "msyh.ttc"] {
                let path = fonts.join(name);
                if std::fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= 32 * 1024 * 1024) {
                    if let Ok(data) = std::fs::read(path) { options.fontdb_mut().load_font_data(data); }
                }
            }
            options.font_family = "Segoe UI".into();
        }
    }
    let tree = usvg::Tree::from_data(bytes, &options).ok()?;
    let size = tree.size();
    let scale = super::EDGE as f32 / size.width().max(size.height());
    let width = (size.width() * scale).round().clamp(1.0, super::EDGE as f32) as u32;
    let height = (size.height() * scale).round().clamp(1.0, super::EDGE as f32) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let mut rgba = pixmap.take();
    for pixel in rgba.chunks_exact_mut(4) {
        if pixel[3] > 0 && pixel[3] < 255 {
            for channel in 0..3 { pixel[channel] = (u32::from(pixel[channel]) * 255 / u32::from(pixel[3])).min(255) as u8; }
        }
    }
    Some(image::DynamicImage::ImageRgba8(image::RgbaImage::from_raw(width, height, rgba)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn static_svg_renders_real_pixels_without_shell_extensions() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="120" height="120" fill="#ee2010"/><rect x="120" width="120" height="120" fill="#1040ee"/></svg>"##;
        let image = render(svg).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (128, 64));
        assert!(image.get_pixel(20, 30)[0] > 200 && image.get_pixel(100, 30)[2] > 200);
        assert!(render(b"<!DOCTYPE svg [<!ENTITY test 'x'>]><svg/>").is_none());
        assert!(render(b"not an SVG").is_none());
    }
    #[test]
    fn external_references_and_scripts_never_become_pixels() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><script>throw 'no execution'</script><image href="file:///C:/private.png" width="128" height="64"/><image href="https://127.0.0.1/private.png" width="128" height="64"/></svg>"#;
        let image = render(svg).unwrap().to_rgba8();
        assert!(image.pixels().all(|pixel| pixel[3] == 0));
    }
}
