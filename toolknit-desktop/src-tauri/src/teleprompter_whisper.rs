use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::Path,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

const SUPPORTED_WHISPER_VERSION: &str = "1.9.1";

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperAhead {
    n_text_layer: c_int,
    n_head: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperAheads {
    n_heads: usize,
    heads: *const WhisperAhead,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperContextParams {
    use_gpu: bool,
    flash_attn: bool,
    gpu_device: c_int,
    dtw_token_timestamps: bool,
    dtw_aheads_preset: c_int,
    dtw_n_top: c_int,
    dtw_aheads: WhisperAheads,
    dtw_mem_size: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperVadParams {
    threshold: f32,
    min_speech_duration_ms: c_int,
    min_silence_duration_ms: c_int,
    max_speech_duration_s: f32,
    speech_pad_ms: c_int,
    samples_overlap: f32,
}

type NewSegmentCallback =
    Option<unsafe extern "C" fn(*mut c_void, *mut c_void, c_int, *mut c_void)>;
type ProgressCallback = Option<unsafe extern "C" fn(*mut c_void, *mut c_void, c_int, *mut c_void)>;
type EncoderBeginCallback =
    Option<unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> bool>;
type AbortCallback = Option<unsafe extern "C" fn(*mut c_void) -> bool>;
type LogitsFilterCallback = Option<
    unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_void, c_int, *mut f32, *mut c_void),
>;

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperGreedyParams {
    best_of: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperBeamSearchParams {
    beam_size: c_int,
    patience: f32,
}

// This layout is the public ABI from whisper.cpp v1.9.1. The bundled DLL
// version is checked before any parameter value is copied or passed by value.
#[repr(C)]
#[derive(Clone, Copy)]
struct WhisperFullParams {
    strategy: c_int,
    n_threads: c_int,
    n_max_text_ctx: c_int,
    offset_ms: c_int,
    duration_ms: c_int,
    translate: bool,
    no_context: bool,
    no_timestamps: bool,
    single_segment: bool,
    print_special: bool,
    print_progress: bool,
    print_realtime: bool,
    print_timestamps: bool,
    token_timestamps: bool,
    thold_pt: f32,
    thold_ptsum: f32,
    max_len: c_int,
    split_on_word: bool,
    max_tokens: c_int,
    debug_mode: bool,
    audio_ctx: c_int,
    tdrz_enable: bool,
    suppress_regex: *const c_char,
    initial_prompt: *const c_char,
    carry_initial_prompt: bool,
    prompt_tokens: *const i32,
    prompt_n_tokens: c_int,
    language: *const c_char,
    detect_language: bool,
    suppress_blank: bool,
    suppress_nst: bool,
    temperature: f32,
    max_initial_ts: f32,
    length_penalty: f32,
    temperature_inc: f32,
    entropy_thold: f32,
    logprob_thold: f32,
    no_speech_thold: f32,
    greedy: WhisperGreedyParams,
    beam_search: WhisperBeamSearchParams,
    new_segment_callback: NewSegmentCallback,
    new_segment_callback_user_data: *mut c_void,
    progress_callback: ProgressCallback,
    progress_callback_user_data: *mut c_void,
    encoder_begin_callback: EncoderBeginCallback,
    encoder_begin_callback_user_data: *mut c_void,
    abort_callback: AbortCallback,
    abort_callback_user_data: *mut c_void,
    logits_filter_callback: LogitsFilterCallback,
    logits_filter_callback_user_data: *mut c_void,
    grammar_rules: *const *const c_void,
    n_grammar_rules: usize,
    i_start_rule: usize,
    grammar_penalty: f32,
    vad: bool,
    vad_model_path: *const c_char,
    vad_params: WhisperVadParams,
}

type WhisperVersion = unsafe extern "C" fn() -> *const c_char;
type ContextDefaultParams = unsafe extern "C" fn() -> *mut WhisperContextParams;
type FreeContextParams = unsafe extern "C" fn(*mut WhisperContextParams);
type InitContext = unsafe extern "C" fn(*const c_char, WhisperContextParams) -> *mut c_void;
type InitState = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
type FullDefaultParams = unsafe extern "C" fn(c_int) -> *mut WhisperFullParams;
type FreeFullParams = unsafe extern "C" fn(*mut WhisperFullParams);
type FullWithState =
    unsafe extern "C" fn(*mut c_void, *mut c_void, WhisperFullParams, *const f32, c_int) -> c_int;
type SegmentCount = unsafe extern "C" fn(*mut c_void) -> c_int;
type SegmentText = unsafe extern "C" fn(*mut c_void, c_int) -> *const c_char;
type SegmentNoSpeech = unsafe extern "C" fn(*mut c_void, c_int) -> f32;
type FreeState = unsafe extern "C" fn(*mut c_void);
type FreeContext = unsafe extern "C" fn(*mut c_void);

struct WhisperApi {
    _library: libloading::Library,
    _backend_library: libloading::Library,
    context_default_params: ContextDefaultParams,
    free_context_params: FreeContextParams,
    init_context: InitContext,
    init_state: InitState,
    full_default_params: FullDefaultParams,
    free_full_params: FreeFullParams,
    full_with_state: FullWithState,
    segment_count: SegmentCount,
    segment_text: SegmentText,
    segment_no_speech: SegmentNoSpeech,
    free_state: FreeState,
    free_context: FreeContext,
}

impl WhisperApi {
    fn load(path: &Path) -> Result<Self, String> {
        unsafe fn load_library(path: &Path) -> Result<libloading::Library, String> {
            #[cfg(target_os = "windows")]
            {
                use libloading::os::windows::{
                    Library, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
                };
                return unsafe {
                    Library::load_with_flags(
                        path,
                        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
                    )
                }
                .map(Into::into)
                .map_err(|error| format!("teleprompter:engine-load-failed:{error}"));
            }

            #[cfg(not(target_os = "windows"))]
            unsafe {
                libloading::Library::new(path)
                    .map_err(|error| format!("teleprompter:engine-load-failed:{error}"))
            }
        }

        let resource_directory = path
            .parent()
            .ok_or("teleprompter:engine-path-invalid".to_string())?;
        let backend_name = if cfg!(target_os = "windows") {
            "ggml.dll"
        } else if cfg!(target_os = "macos") {
            "libggml.dylib"
        } else {
            "libggml.so"
        };
        let backend_path = resource_directory.join(backend_name);
        let backend_library = unsafe { load_library(&backend_path) }?;
        type LoadAllBackends = unsafe extern "C" fn(*const c_char);
        let load_all_backends: LoadAllBackends = unsafe {
            *backend_library
                .get::<LoadAllBackends>(b"ggml_backend_load_all_from_path\0")
                .map_err(|error| format!("teleprompter:engine-symbol-missing:{error}"))?
        };
        let backend_directory = CString::new(resource_directory.to_string_lossy().as_bytes())
            .map_err(|_| "teleprompter:engine-path-invalid".to_string())?;
        unsafe { load_all_backends(backend_directory.as_ptr()) };

        let library = unsafe { load_library(path) }?;

        unsafe fn load_symbol<T: Copy>(
            library: &libloading::Library,
            name: &[u8],
        ) -> Result<T, String> {
            unsafe { library.get::<T>(name) }
                .map(|symbol| *symbol)
                .map_err(|error| format!("teleprompter:engine-symbol-missing:{error}"))
        }

        unsafe {
            let version: WhisperVersion = load_symbol(&library, b"whisper_version\0")?;
            let version_pointer = version();
            if version_pointer.is_null() {
                return Err("teleprompter:engine-version-unavailable".to_string());
            }
            let actual_version = CStr::from_ptr(version_pointer).to_string_lossy();
            if actual_version.trim() != SUPPORTED_WHISPER_VERSION {
                return Err(format!(
                    "teleprompter:engine-version-mismatch:{}",
                    actual_version.trim()
                ));
            }

            Ok(Self {
                context_default_params: load_symbol(
                    &library,
                    b"whisper_context_default_params_by_ref\0",
                )?,
                free_context_params: load_symbol(&library, b"whisper_free_context_params\0")?,
                init_context: load_symbol(
                    &library,
                    b"whisper_init_from_file_with_params_no_state\0",
                )?,
                init_state: load_symbol(&library, b"whisper_init_state\0")?,
                full_default_params: load_symbol(
                    &library,
                    b"whisper_full_default_params_by_ref\0",
                )?,
                free_full_params: load_symbol(&library, b"whisper_free_params\0")?,
                full_with_state: load_symbol(&library, b"whisper_full_with_state\0")?,
                segment_count: load_symbol(&library, b"whisper_full_n_segments_from_state\0")?,
                segment_text: load_symbol(&library, b"whisper_full_get_segment_text_from_state\0")?,
                segment_no_speech: load_symbol(
                    &library,
                    b"whisper_full_get_segment_no_speech_prob_from_state\0",
                )?,
                free_state: load_symbol(&library, b"whisper_free_state\0")?,
                free_context: load_symbol(&library, b"whisper_free\0")?,
                _library: library,
                _backend_library: backend_library,
            })
        }
    }

    fn shared(path: &Path) -> Result<Arc<Self>, String> {
        static API: OnceLock<Result<Arc<WhisperApi>, String>> = OnceLock::new();
        API.get_or_init(|| Self::load(path).map(Arc::new)).clone()
    }
}

struct WhisperRuntime {
    api: Arc<WhisperApi>,
    context: *mut c_void,
    state: *mut c_void,
}

// A runtime is only accessed while its owning mutex is locked. whisper.cpp is
// deliberately never called concurrently for the same context/state pair.
unsafe impl Send for WhisperRuntime {}

impl Drop for WhisperRuntime {
    fn drop(&mut self) {
        unsafe {
            if !self.state.is_null() {
                (self.api.free_state)(self.state);
                self.state = ptr::null_mut();
            }
            if !self.context.is_null() {
                (self.api.free_context)(self.context);
                self.context = ptr::null_mut();
            }
        }
    }
}

pub struct WhisperSession {
    runtime: Mutex<WhisperRuntime>,
}

pub struct WhisperTranscript {
    pub text: String,
    pub confidence: f32,
}

unsafe extern "C" fn should_abort(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }
    let cancelled = unsafe { &*(user_data as *const AtomicBool) };
    cancelled.load(Ordering::SeqCst)
}

impl WhisperSession {
    pub fn load(library_path: &Path, model_path: &Path) -> Result<Self, String> {
        let api = WhisperApi::shared(library_path)?;
        let model_path = CString::new(model_path.to_string_lossy().as_bytes())
            .map_err(|_| "teleprompter:model-path-invalid".to_string())?;
        let context = unsafe {
            let params_pointer = (api.context_default_params)();
            if params_pointer.is_null() {
                return Err("teleprompter:engine-params-unavailable".to_string());
            }
            let mut params = *params_pointer;
            (api.free_context_params)(params_pointer);
            // The bundled runtime is the CPU distribution. Leaving whisper's
            // GPU defaults enabled aborts inside ggml when no GPU backend is
            // present instead of returning a recoverable error.
            params.use_gpu = false;
            params.flash_attn = false;
            (api.init_context)(model_path.as_ptr(), params)
        };
        if context.is_null() {
            return Err("teleprompter:model-load-failed".to_string());
        }
        let state = unsafe { (api.init_state)(context) };
        if state.is_null() {
            unsafe { (api.free_context)(context) };
            return Err("teleprompter:model-load-failed".to_string());
        }
        Ok(Self {
            runtime: Mutex::new(WhisperRuntime {
                api,
                context,
                state,
            }),
        })
    }

    pub fn transcribe(
        &self,
        samples: Vec<i16>,
        language: &str,
        prompt: &str,
        cancelled: Arc<AtomicBool>,
    ) -> Result<WhisperTranscript, String> {
        if cancelled.load(Ordering::SeqCst) {
            return Err("teleprompter:stopped".to_string());
        }
        let audio: Vec<f32> = samples
            .into_iter()
            .map(|sample| sample as f32 / 32768.0)
            .collect();
        let language = if language == "auto" {
            None
        } else {
            Some(CString::new(language).map_err(|_| "teleprompter:invalid-language".to_string())?)
        };
        let prompt = if prompt.trim().is_empty() {
            None
        } else {
            Some(CString::new(prompt).map_err(|_| "teleprompter:invalid-prompt".to_string())?)
        };
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "teleprompter:state-unavailable".to_string())?;

        unsafe {
            let params_pointer = (runtime.api.full_default_params)(0);
            if params_pointer.is_null() {
                return Err("teleprompter:engine-params-unavailable".to_string());
            }
            let mut params = *params_pointer;
            (runtime.api.free_full_params)(params_pointer);
            params.n_threads = std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(4)
                .clamp(2, 8) as c_int;
            params.translate = false;
            params.no_context = true;
            params.no_timestamps = true;
            params.single_segment = true;
            // Live windows need neither 30 seconds of encoder padding nor
            // temperature retries; the next overlapping window refines text.
            params.audio_ctx = ((audio.len().div_ceil(320) + 50) as c_int).clamp(512, 1500);
            params.max_tokens = ((audio.len().div_ceil(2_000) + 16) as c_int).clamp(24, 128);
            params.temperature_inc = 0.0;
            params.greedy.best_of = 1;
            params.print_special = false;
            params.print_progress = false;
            params.print_realtime = false;
            params.print_timestamps = false;
            params.suppress_blank = true;
            params.language = language
                .as_ref()
                .map_or(ptr::null(), |value| value.as_ptr());
            // A null language auto-detects and transcribes. detect_language stops after detection.
            params.detect_language = false;
            params.initial_prompt = prompt.as_ref().map_or(ptr::null(), |value| value.as_ptr());
            params.abort_callback = Some(should_abort);
            params.abort_callback_user_data = Arc::as_ptr(&cancelled) as *mut c_void;

            let status = (runtime.api.full_with_state)(
                runtime.context,
                runtime.state,
                params,
                audio.as_ptr(),
                audio.len() as c_int,
            );
            if cancelled.load(Ordering::SeqCst) {
                return Err("teleprompter:stopped".to_string());
            }
            if status != 0 {
                return Err(format!("teleprompter:recognition-failed:{status}"));
            }

            let segment_count = (runtime.api.segment_count)(runtime.state).max(0);
            let mut text_parts = Vec::with_capacity(segment_count as usize);
            let mut confidence_sum = 0.0_f32;
            let mut confidence_count = 0_u32;
            for index in 0..segment_count {
                let text_pointer = (runtime.api.segment_text)(runtime.state, index);
                if text_pointer.is_null() {
                    continue;
                }
                let no_speech =
                    (runtime.api.segment_no_speech)(runtime.state, index).clamp(0.0, 1.0);
                let text = CStr::from_ptr(text_pointer).to_string_lossy();
                let text = text.trim();
                if !text.is_empty() && no_speech < 0.86 {
                    text_parts.push(text.to_string());
                    confidence_sum += 1.0 - no_speech;
                    confidence_count = confidence_count.saturating_add(1);
                }
            }
            Ok(WhisperTranscript {
                text: crate::chinese_text::simplify(text_parts.join(" ").trim()),
                confidence: if confidence_count == 0 {
                    0.0
                } else {
                    confidence_sum / confidence_count as f32
                },
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_whisper_api_has_the_expected_abi() {
        let library = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("whisper")
            .join("Release")
            .join(if cfg!(target_os = "windows") {
                "whisper.dll"
            } else if cfg!(target_os = "macos") {
                "libwhisper.dylib"
            } else {
                "libwhisper.so"
            });
        if !library.is_file() {
            return;
        }
        let api = WhisperApi::load(&library).expect("load bundled whisper API");
        unsafe {
            let context_params = (api.context_default_params)();
            assert!(!context_params.is_null());
            assert!((-1..=16).contains(&(*context_params).gpu_device));
            (api.free_context_params)(context_params);

            let full_params = (api.full_default_params)(0);
            assert!(!full_params.is_null());
            assert!((1..=128).contains(&(*full_params).n_threads));
            assert!(matches!((*full_params).strategy, 0 | 1));
            (api.free_full_params)(full_params);
        }
    }

    #[test]
    fn optional_model_smoke_test_runs_full_inference() {
        let Ok(model) = std::env::var("TOOLKNIT_TEST_WHISPER_MODEL") else {
            return;
        };
        let model = Path::new(&model);
        if !model.is_file() {
            return;
        }
        let library = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("whisper")
            .join("Release")
            .join(if cfg!(target_os = "windows") {
                "whisper.dll"
            } else if cfg!(target_os = "macos") {
                "libwhisper.dylib"
            } else {
                "libwhisper.so"
            });
        let session = WhisperSession::load(&library, model).expect("load test Whisper model");
        let result = session
            .transcribe(
                vec![0_i16; 16_000 * 2],
                "en",
                "ToolKnit teleprompter",
                Arc::new(AtomicBool::new(false)),
            )
            .expect("run silence inference");
        assert!(result.text.len() < 256);
        assert!((0.0..=1.0).contains(&result.confidence));
    }

    fn read_wav_mono_i16(path: &Path) -> Result<Vec<i16>, String> {
        let bytes = std::fs::read(path).map_err(|error| format!("read wav failed: {error}"))?;
        if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("not a RIFF/WAVE file".to_string());
        }
        let mut position = 12usize;
        let mut data: Option<&[u8]> = None;
        while position + 8 <= bytes.len() {
            let id = &bytes[position..position + 4];
            let size =
                u32::from_le_bytes(bytes[position + 4..position + 8].try_into().unwrap()) as usize;
            if id == b"data" {
                let end = (position + 8 + size).min(bytes.len());
                data = Some(&bytes[position + 8..end]);
                break;
            }
            position += 8 + size + (size & 1);
        }
        let data = data.ok_or("wav data chunk missing".to_string())?;
        Ok(data
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect())
    }

    // Opt-in synthetic fixture only; never capture or log a user's microphone.
    #[test]
    fn rolling_synthetic_speech_benchmark() {
        let Ok(model) = std::env::var("TOOLKNIT_TEST_WHISPER_MODEL") else {
            return;
        };
        let Ok(wav) = std::env::var("TOOLKNIT_TEST_TTS_WAV") else {
            return;
        };
        let samples = read_wav_mono_i16(Path::new(&wav)).expect("synthetic mono 16k WAV");
        let library =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/whisper/Release/whisper.dll");
        let session = WhisperSession::load(&library, Path::new(&model)).expect("test model");
        let mut records = Vec::new();
        for seconds in [0.9_f32, 1.5, 2.1, 3.2, 4.8, 6.4, 8.0, 9.6, 11.2] {
            let end = ((seconds * 16_000.0) as usize).min(samples.len());
            let start = end.saturating_sub(51_200);
            let started = std::time::Instant::now();
            let result = session
                .transcribe(
                    samples[start..end].to_vec(),
                    "zh",
                    "",
                    Arc::new(AtomicBool::new(false)),
                )
                .expect("rolling inference");
            records.push(serde_json::json!({
                "start": start, "end": end, "ms": started.elapsed().as_millis(),
                "text": result.text, "confidence": result.confidence
            }));
        }
        println!(
            "[rolling-synthetic] {}",
            serde_json::to_string(&records).unwrap()
        );
        if let Ok(output) = std::env::var("TOOLKNIT_TEST_ROLLING_OUTPUT") {
            std::fs::write(output, serde_json::to_vec_pretty(&records).unwrap()).unwrap();
        }
        assert!(records
            .iter()
            .any(|record| !record["text"].as_str().unwrap().is_empty()));
    }

    #[test]
    fn weak_audio_synthetic_windows() {
        let Ok(model) = std::env::var("TOOLKNIT_TEST_WHISPER_MODEL") else {
            return;
        };
        let Ok(input) = std::env::var("TOOLKNIT_TEST_AUDIO_WINDOWS") else {
            return;
        };
        let fixture: serde_json::Value =
            serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
        let library =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/whisper/Release/whisper.dll");
        let session =
            WhisperSession::load(&library, Path::new(&model)).expect("synthetic test model");
        let mut cases = Vec::new();
        for case in fixture["cases"].as_array().unwrap() {
            let mut records = Vec::new();
            for window in case["windows"].as_array().unwrap() {
                let samples: Vec<i16> = serde_json::from_value(window["samples"].clone()).unwrap();
                let started = std::time::Instant::now();
                let result = session
                    .transcribe(samples, "zh", "", Arc::new(AtomicBool::new(false)))
                    .unwrap();
                records.push(serde_json::json!({"start":window["windowStart"], "end":window["windowEnd"], "utterance":window["utterance"], "ms":started.elapsed().as_millis(), "text":result.text, "confidence":result.confidence}));
            }
            cases.push(serde_json::json!({"name":case["name"], "records":records}));
        }
        let output = std::env::var("TOOLKNIT_TEST_ROLLING_OUTPUT").expect("synthetic output path");
        std::fs::write(output, serde_json::to_vec_pretty(&cases).unwrap()).unwrap();
    }

    // End-to-end proof for the follow-reading chain: a real TTS voice speaking
    // script sentences must come back as recognizable Chinese text. Opt-in via
    // TOOLKNIT_TEST_WHISPER_MODEL + TOOLKNIT_TEST_TTS_WAV
    // (+ optional TOOLKNIT_TEST_EXPECT substring).
    #[test]
    fn chinese_tts_speech_transcribes_end_to_end() {
        let Ok(model_var) = std::env::var("TOOLKNIT_TEST_WHISPER_MODEL") else {
            return;
        };
        let Ok(wav_var) = std::env::var("TOOLKNIT_TEST_TTS_WAV") else {
            return;
        };
        let model_path = Path::new(&model_var);
        let wav_path = Path::new(&wav_var);
        if !model_path.is_file() || !wav_path.is_file() {
            return;
        }
        let samples = read_wav_mono_i16(wav_path).expect("parse tts wav");
        assert!(
            samples.len() >= 16_000,
            "tts wav should carry at least one second of audio"
        );
        let library = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("whisper")
            .join("Release")
            .join(if cfg!(target_os = "windows") {
                "whisper.dll"
            } else if cfg!(target_os = "macos") {
                "libwhisper.dylib"
            } else {
                "libwhisper.so"
            });
        let session = WhisperSession::load(&library, model_path).expect("load model for tts test");
        let started = std::time::Instant::now();
        let result = session
            .transcribe(samples, "zh", "", Arc::new(AtomicBool::new(false)))
            .expect("transcribe tts speech");
        let elapsed = started.elapsed();
        println!("[tts-e2e] transcript = {}", result.text);
        println!("[tts-e2e] confidence = {:.3}", result.confidence);
        println!("[tts-e2e] elapsed = {elapsed:?} for {} samples", {
            // samples were moved; re-read length from the wav file size
            std::fs::metadata(wav_path).map(|m| m.len()).unwrap_or(0)
        });
        assert!(
            !result.text.trim().is_empty(),
            "whisper returned no text for TTS speech"
        );
        // The TTS fixture speaks script sentences containing 模型 — characters
        // identical in simplified and traditional output. Unicode escapes keep
        // this file ASCII-only for any console codepage.
        let expected: String = "\u{6a21}\u{578b}".to_string();
        let got: String = result
            .text
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect();
        assert!(
            got.contains(&expected),
            "expected transcript to contain {expected:?}, got {got:?}"
        );
        assert!(
            elapsed < std::time::Duration::from_secs(90),
            "inference took too long: {elapsed:?}"
        );
    }
}
