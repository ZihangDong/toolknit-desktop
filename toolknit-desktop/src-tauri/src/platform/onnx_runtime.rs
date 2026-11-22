//! One process-wide loader for all local ONNX features.
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

fn runtime_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|_| "onnxruntime-dll-missing")?;
    let bundled = executable
        .parent()
        .ok_or("onnxruntime-dll-missing")?
        .join("resources")
        .join("onnxruntime")
        .join("onnxruntime.dll");
    if bundled.is_file() {
        return Ok(bundled);
    }
    // Windows uses native separators to find adjacent dependencies with LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR.
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("onnxruntime")
        .join("onnxruntime.dll");
    if development.is_file() {
        return Ok(development);
    }
    Err("onnxruntime-dll-missing".into())
}

#[cfg(windows)]
fn preload_onnx_libraries(dll: &Path) -> Result<(), String> {
    use libloading::os::windows::{
        Library, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
    };
    let flags = LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
    let runtime = unsafe { Library::load_with_flags(dll, flags) }
        .map_err(|error| format!("onnxruntime-load-failed:{error}"))?;
    // ORT and DirectML resolve dependencies by module name after initialization.
    // Every feature shares these handles and the same prepared flag.
    static LIBRARIES: OnceLock<Mutex<Vec<libloading::Library>>> = OnceLock::new();
    let mut libraries = LIBRARIES
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .map_err(|_| "onnxruntime-loader-busy")?;
    libraries.push(runtime.into());
    if let Some(direct_ml) = dll
        .parent()
        .map(|path| path.join("DirectML.dll"))
        .filter(|path| path.is_file())
    {
        if let Ok(library) = unsafe { Library::load_with_flags(direct_ml, flags) } {
            libraries.push(library.into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn preload_onnx_libraries(_dll: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) fn prepare() -> Result<(), String> {
    static PREPARED: OnceLock<Mutex<bool>> = OnceLock::new();
    let mut prepared = PREPARED
        .get_or_init(|| Mutex::new(false))
        .lock()
        .map_err(|_| "onnxruntime-loader-busy")?;
    if !*prepared {
        let dll = runtime_path()?;
        preload_onnx_libraries(&dll)?;
        std::env::set_var("ORT_DYLIB_PATH", &dll);
        *prepared = true;
    }
    Ok(())
}
