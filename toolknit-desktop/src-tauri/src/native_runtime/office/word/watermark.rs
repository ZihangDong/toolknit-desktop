use super::*;
use base64::Engine;

const INVALID: &str = "word-render:watermark-options";

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WordWatermarkInput {
    pdf_base64: String,
    #[serde(default)]
    pages: String,
}

fn selected_pages(value: &str, count: u32) -> Result<Vec<u32>, String> {
    if value.len() > 500 { return Err("word-render:watermark-pages".into()); }
    if value.trim().is_empty() { return Ok((1..=count).collect()); }
    let mut pages = std::collections::BTreeSet::new();
    for part in value.split(',') {
        let pieces: Vec<_> = part.trim().split('-').map(str::trim).collect();
        if pieces.is_empty() || pieces.len() > 2 { return Err("word-render:watermark-pages".into()); }
        let number = |v: &str| -> Result<u32, String> {
            if v.is_empty() || v.starts_with('0') || v.len() > 5 || !v.bytes().all(|b| b.is_ascii_digit()) {
                return Err("word-render:watermark-pages".into());
            }
            v.parse().map_err(|_| "word-render:watermark-pages".into())
        };
        let start = number(pieces[0])?;
        let end = number(pieces[pieces.len() - 1])?;
        if start > end || end > count { return Err("word-render:watermark-pages".into()); }
        pages.extend(start..=end);
    }
    Ok(pages.into_iter().collect())
}

fn qpdf(command: &Path, args: Vec<std::ffi::OsString>) -> Result<std::process::Output, String> {
    tauri::async_runtime::block_on(crate::native_runtime::pdf_runtime::compress::run_compress_qpdf(command, &args))
        .map_err(|error| if error.ends_with(":cancelled") { "word-render:cancelled".into() }
            else if error.ends_with(":timeout") { "word-render:timeout".into() }
            else { "word-render:watermark-failed".into() })
        .and_then(|output| if output.status.success() { Ok(output) } else { Err("word-render:watermark-failed".into()) })
}

pub(super) struct PreparedWatermark {
    command: PathBuf,
    overlay: PathBuf,
    pages: String,
}
impl PreparedWatermark {
    pub(super) fn prepare(value: WordWatermarkInput, directory: &Path) -> Result<Self, String> {
        selected_pages(&value.pages, 10000)?;
        if value.pdf_base64.len() > 5_592_408 { return Err(INVALID.into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(&value.pdf_base64).map_err(|_| INVALID)?;
        if bytes.len() > 4 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") { return Err(INVALID.into()); }
        let command = get_qpdf_path().map_err(|_| "word-render:watermark-engine")?;
        let overlay = directory.join("watermark.pdf");
        std::fs::write(&overlay, bytes).map_err(|_| "word-render:output-path")?;
        qpdf(&command, vec!["--check".into(), overlay.as_os_str().into()])?;
        let output = qpdf(&command, vec!["--show-npages".into(), overlay.as_os_str().into()])?;
        if String::from_utf8_lossy(&output.stdout).trim() != "1" { return Err(INVALID.into()); }
        Ok(Self { command, overlay, pages: value.pages })
    }
    pub(super) fn apply(&self, source: &Path) -> Result<u32, String> {
        let output = qpdf(&self.command, vec!["--show-npages".into(), source.as_os_str().into()])?;
        let count: u32 = String::from_utf8_lossy(&output.stdout).trim().parse().map_err(|_| INVALID)?;
        if count == 0 || count > 10000 { return Err(INVALID.into()); }
        let selected = selected_pages(&self.pages, count)?;
        let destination = source.with_extension("watermarked.pdf");
        let result = (|| {
            let mut args = vec![source.as_os_str().into(), "--overlay".into(), self.overlay.as_os_str().into(),
                "--from=".into(), "--repeat=1".into()];
            if !self.pages.trim().is_empty() {
                let mut ranges = Vec::new(); let mut i = 0;
                while i < selected.len() {
                    let start = selected[i]; let mut end = start;
                    while i + 1 < selected.len() && selected[i + 1] == end + 1 { i += 1; end = selected[i]; }
                    ranges.push(if start == end { start.to_string() } else { format!("{start}-{end}") }); i += 1;
                }
                args.push(format!("--to={}", ranges.join(",")).into());
            }
            args.extend(["--".into(), destination.as_os_str().into()]);
            qpdf(&self.command, args)?;
            if std::fs::metadata(&destination).map_err(|_| "word-render:watermark-failed")?.len() > WORD_MAX_OUTPUT_BYTES {
                return Err("word-render:output-too-large".into());
            }
            qpdf(&self.command, vec!["--check".into(), destination.as_os_str().into()])?;
            if CANCEL_FLAG.load(Ordering::SeqCst) { return Err("word-render:cancelled".into()); }
            // Both paths are private temporary files; publish only the stamped result.
            std::fs::remove_file(source).map_err(|_| "word-render:watermark-failed")?;
            std::fs::rename(&destination, source).map_err(|_| "word-render:watermark-failed")?;
            Ok(selected.len() as u32)
        })();
        if result.is_err() { let _ = std::fs::remove_file(destination); }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn watermark_ranges_are_strict_and_bounded() {
        assert_eq!(selected_pages("3, 1-2,2", 3).unwrap(), vec![1,2,3]);
        assert_eq!(selected_pages("", 2).unwrap(), vec![1,2]);
        for value in ["0", "01", "3-1", "1,", "z", "1-4", "1-", "--1", "1-2-3"] {
            assert!(selected_pages(value, 3).is_err(), "{value}");
        }
    }
    #[test]
    #[ignore = "real Word/qpdf pipeline; requires generated local fixtures"]
    fn word_watermark_real_runtime_qa() {
        let request_path = std::env::var("TOOLKNIT_WORD_WATERMARK_REQUESTS").unwrap();
        let requests: serde_json::Value = serde_json::from_slice(&std::fs::read(&request_path).unwrap()).unwrap();
        let root = PathBuf::from(std::env::var("TOOLKNIT_WORD_WATERMARK_OUTPUT").unwrap());
        let _guard = begin_conversion().unwrap();
        let mut reports = Vec::new();
        for (index, case) in requests.as_array().unwrap().iter().enumerate() {
            let directory = root.join(index.to_string()); std::fs::create_dir(&directory).unwrap();
            let inputs: Vec<String> = serde_json::from_value(case["inputs"].clone()).unwrap();
            let value: WordWatermarkInput = serde_json::from_value(case["watermark"].clone()).unwrap();
            let result = convert_word_batch_with_options(inputs, vec![], case["refresh"].as_bool().unwrap_or(false),
                Some(value), None, Vec::new(), directory.to_string_lossy().into_owned(), format!("watermark-{index}"), |_| {}).unwrap();
            assert_eq!(result.files[0].status, "success", "{result:?}");
            assert!(result.files[0].watermark_pages.unwrap() > 0);
            for row in result.files.iter().skip(1) { assert_eq!(row.status, "failed"); assert!(row.output_path.is_none()); }
            reports.push(result);
        }
        std::fs::write(root.join("report.json"), serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    }
}
