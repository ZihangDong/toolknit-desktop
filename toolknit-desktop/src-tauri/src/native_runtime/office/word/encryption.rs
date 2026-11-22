use super::*;
use zeroize::{Zeroize, Zeroizing};

fn default_permissions() -> PdfEncryptPermissions {
    PdfEncryptPermissions { printing: Default::default(), modifying: true, copying: true, annotating: true,
        filling_forms: true, content_accessibility: true, document_assembly: true }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WordEncryptionInput {
    password: String,
    #[serde(default = "default_permissions")]
    permissions: PdfEncryptPermissions,
}
impl Drop for WordEncryptionInput { fn drop(&mut self) { self.password.zeroize(); } }
impl WordEncryptionInput {
    fn validate(&self) -> Result<(), String> {
        validate_pdf_encrypt_password(&self.password).map_err(|error| error.replace("pdf-encrypt:", "word-render:encryption-"))?;
        pdf_encrypt_print_option(&self.permissions.printing).map_err(|_| "word-render:encryption-permissions")?;
        // Modern PDF encryption always permits assistive-technology extraction.
        if !self.permissions.content_accessibility { return Err("word-render:encryption-permissions".into()); }
        Ok(())
    }
}
pub(super) struct PreparedEncryption { value: WordEncryptionInput, command: PathBuf }
impl PreparedEncryption {
    pub(super) fn prepare(value: WordEncryptionInput) -> Result<Self, String> {
        value.validate()?;
        Ok(Self { value, command: get_qpdf_path().map_err(|_| "word-render:encryption-engine")? })
    }
    fn run(&self, args: Vec<std::ffi::OsString>, input: Option<&[u8]>, capture: bool) -> Result<Vec<u8>, String> {
        let output = tauri::async_runtime::block_on(crate::native_runtime::pdf_runtime::compress::run_conversion_qpdf_with_stdin(
            &self.command, &args, input, capture));
        let mut output = output.map_err(|error| if error.ends_with(":cancelled") { "word-render:cancelled" }
            else if error.ends_with(":timeout") { "word-render:timeout" } else { "word-render:encryption-failed" })?;
        output.stderr.zeroize();
        if output.status.success() { Ok(output.stdout) }
        else { output.stdout.zeroize(); Err("word-render:encryption-failed".into()) }
    }
    pub(super) fn apply(&self, source: &Path) -> Result<usize, String> {
        let page_output = self.run(vec!["--show-npages".into(), source.as_os_str().into()], None, true)?;
        let pages: usize = String::from_utf8_lossy(&page_output).trim().parse().map_err(|_| "word-render:encryption-failed")?;
        if pages == 0 || pages > PDF_ENCRYPT_MAX_PAGES as usize { return Err("word-render:encryption-pages".into()); }
        let destination = source.with_extension("encrypted.pdf");
        let result = (|| {
            for path in [source, destination.as_path()] {
                validate_pdf_encrypt_argument(&cleanup_display_path(path), "word-render:encryption-failed")?;
            }
            let owner = Zeroizing::new(create_pdf_encrypt_owner_password().map_err(|_| "word-render:encryption-failed")?);
            let payload = Zeroizing::new(build_pdf_encrypt_qpdf_arguments(source, &destination, &self.value.password, &owner,
                &self.value.permissions).map_err(|_| "word-render:encryption-failed")?);
            self.run(vec!["@-".into()], Some(&payload), false)?;
            let length = std::fs::metadata(&destination).map_err(|_| "word-render:encryption-failed")?.len();
            if length == 0 || length > WORD_MAX_OUTPUT_BYTES { return Err("word-render:output-too-large".into()); }
            let password = Zeroizing::new(format!("{}\n", self.value.password).into_bytes());
            let prefix = vec!["--password-mode=unicode".into(), "--password-file=-".into()];
            let mut args = prefix.clone(); args.extend(["--check".into(), destination.as_os_str().into()]);
            self.run(args, Some(&password), false)?;
            let mut args = prefix; args.extend(["--show-npages".into(), destination.as_os_str().into()]);
            let output = self.run(args, Some(&password), true)?;
            if String::from_utf8_lossy(&output).trim() != pages.to_string() { return Err("word-render:encryption-failed".into()); }
            if CANCEL_FLAG.load(Ordering::SeqCst) { return Err("word-render:cancelled".into()); }
            // Both versions stay in the private workspace until this succeeds.
            std::fs::remove_file(source).map_err(|_| "word-render:encryption-failed")?;
            std::fs::rename(&destination, source).map_err(|_| "word-render:encryption-failed")?;
            Ok(pages)
        })();
        if result.is_err() { let _ = std::fs::remove_file(destination); }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_encryption_password_and_permission_boundaries() {
        for value in [serde_json::json!({"password":"short"}), serde_json::json!({"password":"01234567\n"}),
            serde_json::json!({"password":"字".repeat(43)}), serde_json::json!({"password":"01234567","permissions":{"contentAccessibility":false}}),
            serde_json::json!({"password":"01234567","permissions":{"printing":"unknown"}})] {
            assert!(serde_json::from_value::<WordEncryptionInput>(value).unwrap().validate().is_err());
        }
        let valid: WordEncryptionInput = serde_json::from_value(serde_json::json!({"password":"中英文安全密码😀","permissions":{"printing":"lowResolution","copying":false}})).unwrap();
        assert!(valid.validate().is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn word_encryption_cancel_stops_only_its_active_process() {
        use std::os::windows::process::CommandExt;
        let _lock = test_conversion_lock(); let _guard = begin_conversion().unwrap();
        *WORD_JOB.lock().unwrap() = Some("encryption-cancel-probe".into()); let _job = WordJobGuard;
        let mut child = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"])
            .creation_flags(0x08000000).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
        CURRENT_CHILD_ID.store(child.id(), Ordering::SeqCst);
        assert!(!cancel_word_to_pdf("different-job".into())); assert!(child.try_wait().unwrap().is_none());
        let started = std::time::Instant::now(); assert!(cancel_word_to_pdf("encryption-cancel-probe".into()));
        assert!(!child.wait().unwrap().success()); assert!(started.elapsed().as_secs() < 5);
        CURRENT_CHILD_ID.store(0, Ordering::SeqCst);
    }
    #[test]
    #[ignore = "real Word/qpdf AES-256 QA; requires generated fixtures and an ephemeral test password"]
    fn word_encryption_real_runtime_qa() {
        let request_path = std::env::var("TOOLKNIT_WORD_ENCRYPTION_REQUESTS").unwrap();
        let requests: serde_json::Value = serde_json::from_slice(&std::fs::read(&request_path).unwrap()).unwrap();
        let password = Zeroizing::new(std::env::var("TOOLKNIT_WORD_ENCRYPTION_PASSWORD").unwrap());
        let root = PathBuf::from(std::env::var("TOOLKNIT_WORD_ENCRYPTION_OUTPUT").unwrap());
        let _guard = begin_conversion().unwrap(); let mut reports = Vec::new();
        for (index, case) in requests.as_array().unwrap().iter().enumerate() {
            CANCEL_FLAG.store(false, Ordering::SeqCst);
            let directory = root.join(index.to_string()); std::fs::create_dir(&directory).unwrap();
            let inputs: Vec<String> = serde_json::from_value(case["inputs"].clone()).unwrap();
            let value: WordEncryptionInput = serde_json::from_value(serde_json::json!({"password":password.as_str(), "permissions":case["permissions"]})).unwrap();
            let watermark: Option<WordWatermarkInput> = serde_json::from_value(case.get("watermark").cloned().unwrap_or(serde_json::Value::Null)).unwrap();
            let mut events = Vec::new();
            let result = convert_word_batch_with_options(inputs, vec![], case["refresh"].as_bool().unwrap_or(false), watermark, Some(value), Vec::new(),
                directory.to_string_lossy().into_owned(), format!("encryption-{index}"), |event| {
                    if case["cancelAfterFirst"].as_bool().unwrap_or(false) && event["phase"] == "done" && event["index"] == 0 {
                        CANCEL_FLAG.store(true, Ordering::SeqCst);
                    }
                    events.push(event);
                }).unwrap();
            assert_eq!(result.files[0].status, "success", "{result:?}"); assert!(result.files[0].encrypted);
            for row in result.files.iter().skip(1) { assert!(matches!(row.status.as_str(), "failed" | "cancelled")); assert!(row.output_path.is_none() && !row.encrypted); }
            let report = serde_json::json!({"result":result,"events":events});
            assert!(!serde_json::to_string(&report).unwrap().contains(password.as_str())); reports.push(report);
        }
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        std::fs::write(root.join("report.json"), serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    }
}
