mod core;
mod engine;
mod install;
pub(super) mod runtime;
pub(crate) use runtime::{cancel_owner, recognize, shutdown, OcrState};

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Uses explicitly provided local OCR and translation models; no external requests"]
    async fn ocr_local_translation_roundtrip() {
        let models =
            std::path::PathBuf::from(std::env::var("TOOLKNIT_OCR_MODEL_DIR").expect("OCR models"));
        let translation = std::path::PathBuf::from(
            std::env::var("TOOLKNIT_OCR_TRANSLATION_DIR").expect("local translation models"),
        );
        let image =
            std::fs::read(std::env::var("TOOLKNIT_OCR_INSTALL_FIXTURE").expect("synthetic image"))
                .unwrap();
        let mut engine = engine::Engine::open(&models).unwrap();
        let page = engine
            .recognize(&image, &std::sync::atomic::AtomicBool::new(false))
            .unwrap();
        let texts: Vec<_> = page
            .lines
            .into_iter()
            .filter(|l| {
                l.text
                    .chars()
                    .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
            })
            .take(2)
            .map(|l| l.text)
            .collect();
        assert_eq!(texts.len(), 2);
        let translated =
            crate::native_runtime::local_translation::ocr_translation_fixture(&translation, &texts)
                .await
                .expect("OCR to local translation");
        assert_eq!(translated.len(), texts.len());
        assert!(translated
            .iter()
            .all(|t| t.chars().filter(char::is_ascii_alphabetic).count() > 5));
        println!("Chinese screenshot OCR -> local English translation passed; no AI key or external image upload");
    }
    #[test]
    #[ignore = "Runs fixed local ONNX models against explicitly provided image fixtures"]
    fn ocr_native_model_matrix() {
        let root = std::path::PathBuf::from(
            std::env::var("TOOLKNIT_OCR_MODEL_DIR").expect("model directory"),
        );
        let fixtures = std::path::PathBuf::from(
            std::env::var("TOOLKNIT_OCR_FIXTURES").expect("fixture directory"),
        );
        let mut engine =
            engine::Engine::open(&root).expect("load exported models with bundled ORT DLL");
        let cancel = std::sync::atomic::AtomicBool::new(false);
        for entry in std::fs::read_dir(&fixtures).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|ext| ext != "png") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            let result = engine
                .recognize(&bytes, &cancel)
                .expect("recognize fixture");
            let output = path.with_extension("ocr.json");
            std::fs::write(output, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
            println!(
                "OCR fixture: {} lines, {} ms, {} x {}",
                result.lines.len(),
                result.elapsed_ms,
                result.width,
                result.height
            );
        }
    }
}
