//! Auxiliary windows receive bounded theme data, never CSS or credentials.
pub(super) fn normalize(value: &serde_json::Value, mode: &serde_json::Value) -> serde_json::Value {
    let mode = value.get("mode").unwrap_or(mode).as_str().unwrap_or("light");
    let preset = value["preset"].as_str().unwrap_or("neutral");
    let valid_preset = !preset.is_empty() && preset.len() <= 32
        && preset.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
    let color = value["customColor"].as_str().unwrap_or("#3565a6");
    let valid_color = color.len() == 7 && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
    serde_json::json!({
        "version": 1,
        "mode": if mode == "dark" { "dark" } else { "light" },
        "preset": if valid_preset { preset } else { "neutral" },
        "customColor": if valid_color { color } else { "#3565a6" },
        "wallpaperEnabled": value["wallpaperEnabled"].as_bool().unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn appearance_normalizes_untrusted_context() {
        let value = normalize(&json!({"preset":"custom","mode":"dark","customColor":"#ff0099","css":"url(file://secret)","wallpaperEnabled":true}), &json!("light"));
        assert_eq!(value["customColor"], "#ff0099");
        assert_eq!(value["mode"], "dark");
        assert!(value.get("css").is_none());
        let fallback = normalize(&json!({"preset":"unknown;css","customColor":"red; color:white"}), &json!("dark"));
        assert_eq!(fallback["preset"], "neutral");
        assert_eq!(fallback["customColor"], "#3565a6");
        assert_eq!(fallback["mode"], "dark");
    }
}
