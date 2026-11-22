use super::*;
use std::sync::{Arc, Mutex};

pub(super) struct MeetingJob {
    id: String,
    phase: Mutex<(bool, bool)>, // cancelled, publishing
}
#[derive(Default)]
struct Registry {
    active: Option<Arc<MeetingJob>>,
    pending: std::collections::HashMap<String, std::time::Instant>,
}
fn registry() -> &'static Mutex<Registry> {
    static JOBS: OnceLock<Mutex<Registry>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(Registry::default()))
}
fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("meeting:invalid-job".into());
    }
    Ok(())
}
pub(super) struct MeetingGuard {
    pub(super) job: Arc<MeetingJob>,
}
impl MeetingGuard {
    pub(super) fn begin(id: String) -> Result<Self, String> {
        valid_id(&id)?;
        let mut jobs = registry().lock().unwrap_or_else(|e| e.into_inner());
        if jobs.active.is_some() {
            return Err("meeting:busy".into());
        }
        jobs.pending.retain(|_, at| at.elapsed().as_secs() < 60);
        let cancelled = jobs.pending.remove(&id).is_some();
        let job = Arc::new(MeetingJob {
            id,
            phase: Mutex::new((cancelled, false)),
        });
        jobs.active = Some(job.clone());
        Ok(Self { job })
    }
}
impl Drop for MeetingGuard {
    fn drop(&mut self) {
        let mut jobs = registry().lock().unwrap_or_else(|e| e.into_inner());
        if jobs
            .active
            .as_ref()
            .is_some_and(|job| Arc::ptr_eq(job, &self.job))
        {
            jobs.active = None;
        }
    }
}
impl MeetingJob {
    pub(super) fn check(&self) -> Result<(), String> {
        if self.phase.lock().unwrap_or_else(|e| e.into_inner()).0
            || CANCEL_FLAG.load(Ordering::SeqCst)
        {
            return Err("transcription:cancelled".into());
        }
        Ok(())
    }
    pub(super) fn commit(&self) -> Result<(), String> {
        let mut phase = self.phase.lock().unwrap_or_else(|e| e.into_inner());
        if phase.0 || CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("transcription:cancelled".into());
        }
        phase.1 = true;
        Ok(())
    }
    pub(super) fn emit(&self, app: &tauri::AppHandle, phase: &str, progress: u8) {
        let _ = app.emit(
            "meeting-transcription-progress",
            serde_json::json!({ "jobId": self.id, "phase": phase, "progress": progress }),
        );
    }
}

pub(super) fn cancel_meeting_transcription(job_id: String) -> Result<bool, String> {
    valid_id(&job_id)?;
    let mut jobs = registry().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(job) = jobs.active.as_ref().filter(|job| job.id == job_id) {
        let mut phase = job.phase.lock().unwrap_or_else(|e| e.into_inner());
        if phase.1 {
            return Ok(false);
        }
        phase.0 = true;
        return Ok(true);
    }
    // IPC cancellation may arrive before the asynchronous start command executes.
    // A bounded, expiring tombstone applies only to this random job ID.
    jobs.pending.retain(|_, at| at.elapsed().as_secs() < 60);
    if jobs.pending.len() >= 64 {
        jobs.pending.clear();
    }
    jobs.pending.insert(job_id, std::time::Instant::now());
    Ok(true)
}

async fn drain(mut pipe: impl tokio::io::AsyncRead + Unpin) -> Vec<u8> {
    use tokio::io::AsyncReadExt;
    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    while let Ok(count) = pipe.read(&mut buffer).await {
        if count == 0 {
            break;
        }
        let kept = count.min((512 * 1024usize).saturating_sub(output.len()));
        output.extend_from_slice(&buffer[..kept]);
    }
    output
}
pub(super) async fn run_owned(
    command: &std::path::Path,
    arguments: &[std::ffi::OsString],
    job: &MeetingJob,
) -> Result<std::process::Output, String> {
    job.check()?;
    let mut process = tokio::process::Command::new(command);
    process
        .args(arguments)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    process.creation_flags(0x08000000);
    let mut child = process
        .spawn()
        .map_err(|_| "transcription:engine-failed".to_string())?;
    let stdout = tokio::spawn(drain(child.stdout.take().unwrap()));
    let stderr = tokio::spawn(drain(child.stderr.take().unwrap()));
    let started = std::time::Instant::now();
    let (status, failure) = loop {
        let failure = job.check().err().or_else(|| {
            (started.elapsed().as_secs() > 7200).then(|| "meeting:timeout".to_string())
        });
        if let Some(error) = failure {
            let _ = child.start_kill();
            break (child.wait().await, Some(error));
        }
        match child.try_wait() {
            Ok(Some(status)) => break (Ok(status), None),
            Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(40)).await,
            Err(error) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                break (Err(error), Some("transcription:engine-failed".into()));
            }
        }
    };
    let stdout = stdout.await.unwrap_or_default();
    let stderr = stderr.await.unwrap_or_default();
    if let Some(error) = failure {
        return Err(error);
    }
    job.check()?;
    Ok(std::process::Output {
        status: status.map_err(|_| "transcription:engine-failed")?,
        stdout,
        stderr,
    })
}

pub(super) async fn transcribe_meeting_media(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_dir: String,
    language: String,
    job_id: String,
) -> Result<TranscriptionResult, String> {
    transcribe_media_inner(app_handle, input_path, output_dir, language, Some(job_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_owned_and_covers_start_races_and_commit() {
        let _lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        assert!(cancel_meeting_transcription("pre-start".into()).unwrap());
        {
            let guard = MeetingGuard::begin("pre-start".into()).unwrap();
            assert!(guard.job.check().is_err());
        }
        let guard = MeetingGuard::begin("active".into()).unwrap();
        cancel_meeting_transcription("other-job".into()).unwrap();
        guard.job.check().unwrap();
        guard.job.commit().unwrap();
        assert!(!cancel_meeting_transcription("active".into()).unwrap());
        guard.job.check().unwrap();
        assert!(cancel_meeting_transcription("!bad".into()).is_err());
    }
    #[tokio::test]
    async fn cancellation_stops_only_the_owned_child_and_drains_pipes() {
        let _lock = test_conversion_lock();
        CANCEL_FLAG.store(false, Ordering::SeqCst);
        let guard = MeetingGuard::begin("child-test".into()).unwrap();
        let job = guard.job.clone();
        #[cfg(target_os = "windows")]
        let (command, args) = (
            std::path::PathBuf::from("powershell.exe"),
            vec![
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::Write('fixture'); Start-Sleep -Seconds 30",
            ],
        );
        #[cfg(not(target_os = "windows"))]
        let (command, args) = (
            std::path::PathBuf::from("sh"),
            vec!["-c", "printf fixture; exec sleep 30"],
        );
        let arguments = args
            .iter()
            .map(|arg| std::ffi::OsString::from(*arg))
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            cancel_meeting_transcription("child-test".into()).unwrap();
        };
        let (result, _) = tokio::join!(run_owned(&command, &arguments, &job), cancel);
        assert_eq!(result.unwrap_err(), "transcription:cancelled");
        assert!(started.elapsed().as_secs() < 5);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "explicit local model and synthetic WAV/WebM fixtures; no microphone access"]
    fn meeting_native_transcription() {
        use std::os::windows::process::CommandExt;
        const TEST: &str =
            "native_runtime::transcription_runtime::meeting::tests::meeting_native_transcription";
        if std::env::var_os("TOOLKNIT_MEETING_ISOLATED").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    TEST,
                    "--ignored",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env("TOOLKNIT_MEETING_ISOLATED", "1")
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            print!("{}", String::from_utf8_lossy(&output.stdout));
            return;
        }
        let mut context = tauri::generate_context!();
        context.config_mut().identifier = "com.toolknit.meeting-qa".into();
        context.config_mut().app.windows.clear();
        let report = Arc::new(Mutex::new(None));
        let result = report.clone();
        let app = tauri::Builder::default()
            .any_thread()
            .setup(move |app| {
                let app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    *result.lock().unwrap() = Some(exercise_native(&app).await);
                    app.exit(0);
                });
                Ok(())
            })
            .build(context)
            .unwrap();
        let running = report.clone();
        app.run_return(move |_, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if running.lock().unwrap().is_none() {
                    api.prevent_exit();
                }
            }
        });
        report.lock().unwrap().take().unwrap().unwrap();
    }

    #[cfg(target_os = "windows")]
    async fn exercise_native(app: &tauri::AppHandle) -> Result<(), String> {
        use tauri::Listener;
        let wav = std::path::PathBuf::from(
            std::env::var_os("TOOLKNIT_MEETING_QA_WAV").ok_or("missing synthetic WAV")?,
        );
        let webm = std::path::PathBuf::from(
            std::env::var_os("TOOLKNIT_MEETING_QA_WEBM").ok_or("missing recorded WebM")?,
        );
        let root = std::path::PathBuf::from(
            std::env::var_os("TOOLKNIT_MEETING_QA_ROOT").ok_or("missing QA output root")?,
        );
        if !root.is_absolute() || !root.ends_with("meeting-browser") {
            return Err("invalid QA output root".into());
        }
        let evidence = root.join(format!(
            "native-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        std::fs::create_dir(&evidence).map_err(|e| e.to_string())?;
        let pcm = std::fs::read(root.join("live-segment.pcm")).map_err(|e| e.to_string())?;
        if pcm.len() != 128000 * 2 {
            return Err("invalid browser PCM fixture".into());
        }
        let samples: Vec<i16> = pcm
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let live = TeleprompterRecognitionState::default();
        let session = start_live_recognition(&live, "auto".into(), "meeting-live").await?;
        let recognized = transcribe_live_audio(&live, session.clone(), samples.clone(), None).await?;
        if !["meeting", "report", "alice", "friday"]
            .iter()
            .any(|word| recognized.text.to_ascii_lowercase().contains(word))
        {
            return Err(format!("live auto language did not transcribe: {}", recognized.text));
        }
        stop_live_recognition(&live, &session)?;
        if transcribe_live_audio(&live, session, samples, None).await.is_ok() {
            return Err("closed live session accepted audio".into());
        }
        // Exercise the same allowed output roots as production without changing
        // the user's configured output folder. Copy only synthetic evidence out.
        let temporary = TranscriptionTempDir::create(&std::env::temp_dir())?;
        let run = temporary.path().to_path_buf();
        let untouched = Arc::new(AtomicU64::new(0));
        let events = untouched.clone();
        let event_id = app.listen("transcription-progress", move |_| {
            events.fetch_add(1, Ordering::SeqCst);
        });
        let mut results = Vec::new();
        for (index, input) in [wav.clone(), webm].iter().enumerate() {
            let before = sha256_file(input)?;
            let result = super::transcribe_meeting_media(
                app.clone(),
                input.to_string_lossy().into_owned(),
                run.to_string_lossy().into_owned(),
                "en".into(),
                format!("native-{index}"),
            )
            .await?;
            let text = std::fs::read_to_string(&result.raw_txt_path).map_err(|e| e.to_string())?;
            if !["meeting", "report", "alice", "friday"]
                .iter()
                .any(|word| text.to_ascii_lowercase().contains(word))
            {
                return Err(format!("synthetic speech did not transcribe: {text}"));
            }
            for file in [
                &result.raw_txt_path,
                &result.raw_srt_path,
                &result.raw_json_path,
            ] {
                if std::fs::metadata(file).map_err(|e| e.to_string())?.len() == 0 {
                    return Err("empty transcript".into());
                }
            }
            if sha256_file(input)? != before {
                return Err("source audio changed".into());
            }
            results.push(serde_json::to_value(result).unwrap());
        }
        if untouched.load(Ordering::SeqCst) != 0 {
            return Err("meeting progress leaked to legacy transcription".into());
        }
        app.unlisten(event_id);
        let cancellation = app.listen("meeting-transcription-progress", move |event| {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                if value["jobId"] == "native-cancel" && value["phase"] == "transcribing" {
                    let _ = cancel_meeting_transcription("native-cancel".into());
                }
            }
        });
        let cancelled = super::transcribe_meeting_media(
            app.clone(),
            wav.to_string_lossy().into_owned(),
            run.to_string_lossy().into_owned(),
            "en".into(),
            "native-cancel".into(),
        )
        .await;
        app.unlisten(cancellation);
        if cancelled.err().as_deref() != Some("transcription:cancelled") {
            return Err("cancellation failed".into());
        }
        if std::fs::read_dir(&run).map_err(|e| e.to_string())?.count() != 6 {
            return Err("cancelled task published files".into());
        }
        let legacy = transcribe_media(
            app.clone(),
            wav.to_string_lossy().into_owned(),
            run.to_string_lossy().into_owned(),
            "en".into(),
        )
        .await?;
        let long = run.join("over-two-hours.flac");
        let mut generator = tokio::process::Command::new(get_ffmpeg_path()?);
        generator
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=16000:cl=mono",
                "-t",
                "7201",
                "-c:a",
                "flac",
            ])
            .arg(&long)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        generator.creation_flags(0x08000000);
        if !generator
            .status()
            .await
            .map_err(|e| e.to_string())?
            .success()
        {
            return Err("long synthetic audio creation failed".into());
        }
        let oversized = super::transcribe_meeting_media(
            app.clone(),
            long.to_string_lossy().into_owned(),
            run.to_string_lossy().into_owned(),
            "en".into(),
            "native-duration".into(),
        )
        .await;
        if oversized.err().as_deref() != Some("meeting:duration-limit") {
            return Err("duration limit did not reject oversized audio".into());
        }
        let mut summary = serde_json::json!({ "passed": true, "results": results, "legacy": legacy, "cancellation": true, "isolatedProgress": true, "sourceUnchanged": true, "durationLimit": true, "liveAutoLanguage": true, "liveStopRejectsAudio": true });
        let copy = |value: &mut serde_json::Value| -> Result<(), String> {
            for key in ["raw_txt_path", "raw_srt_path", "raw_json_path"] {
                let source = std::path::PathBuf::from(value[key].as_str().ok_or("missing output")?);
                let target = evidence.join(source.file_name().ok_or("invalid output name")?);
                std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
                value[key] = serde_json::json!(target.to_string_lossy());
            }
            Ok(())
        };
        for value in summary["results"].as_array_mut().unwrap() {
            copy(value)?;
        }
        copy(&mut summary["legacy"])?;
        std::fs::write(
            root.join("native-report.json"),
            serde_json::to_vec_pretty(&summary).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        println!("Native meeting: synthetic WAV and recorded WebM, JSON/SRT/TXT, job cancellation, isolated progress, duration limit and legacy regression passed.");
        Ok(())
    }
}
