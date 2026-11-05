fn main() {
    search_service_revision();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if matches!(arch.as_str(), "x86" | "x86_64") {
        let root = "vendor/winshun-search";
        let mut build = cc::Build::new();
        build
            .cpp(true)
            .std("c++20")
            .include(root)
            .flag_if_supported("/utf-8")
            .flag_if_supported("/EHsc");
        // The optional search feature must not add an MSVCP140.dll loader
        // requirement to the main executable or its copied service host.
        if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
            build.static_crt(true);
        }
        for file in [
            "bridge.cpp",
            "Pinyin.cpp",
            "PinyinTable.cpp",
            "TextUtil.cpp",
        ] {
            let path = format!("{root}/{file}");
            println!("cargo:rerun-if-changed={path}");
            build.file(path);
        }
        for file in ["Pinyin.h", "TextUtil.h"] {
            println!("cargo:rerun-if-changed={root}/{file}");
        }
        build.compile("toolknit_filename_matcher");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let root = "vendor/winshun-search";
        let mut build = cc::Build::new();
        if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
            build.static_crt(true);
        }
        build
            .cpp(true)
            .std("c++20")
            .include(root)
            .flag_if_supported("/utf-8")
            .flag_if_supported("/EHsc")
            .define("NOMINMAX", None)
            .define("WIN32_LEAN_AND_MEAN", None)
            .define("UNICODE", None)
            .define("_UNICODE", None)
            .define("_WIN32_WINNT", Some("0x0A00"))
            .define("WINVER", Some("0x0A00"));
        for file in ["Ntfs.cpp", "ntfs-bridge.cpp"] {
            let path = format!("{root}/{file}");
            println!("cargo:rerun-if-changed={path}");
            build.file(path);
        }
        println!("cargo:rerun-if-changed={root}/Ntfs.h");
        build.compile("toolknit_ntfs_metadata");
    }
    tauri_build::build();

    // Unit tests link the Tauri resource library explicitly from lib.rs.
    #[cfg(windows)]
    {
        let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo");
        println!("cargo:rustc-link-search=native={out_dir}");
    }
}

// The copied service host is reusable across UI-only updates. Source changes
// that affect its protocol, security, metadata parsing or runtime invalidate it.
fn search_service_revision() {
    use sha2::{Digest, Sha256};
    let base = "src/native_runtime/file_search";
    let mut files = std::fs::read_dir(format!("{base}/accelerator")).expect("service sources")
        .map(|entry| entry.expect("source entry").path()).filter(|p| p.extension().is_some_and(|v| v == "rs")
            && p.file_name().is_some_and(|v| v != "integration_tests.rs")).collect::<Vec<_>>();
    for name in ["protocol.rs", "scope_policy.rs", "ntfs.rs", "ntfs_tree.rs", "storage.rs"] { files.push(format!("{base}/{name}").into()); }
    for name in ["Ntfs.cpp", "Ntfs.h", "ntfs-bridge.cpp"] { files.push(format!("vendor/winshun-search/{name}").into()); }
    files.sort(); let mut hash = Sha256::new();
    // Dependency changes may carry security fixes even with identical sources.
    files.push("Cargo.lock".into());
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        hash.update(path.to_string_lossy().as_bytes()); hash.update([0]);
        hash.update(std::fs::read(path).expect("service revision input")); hash.update([0]);
    }
    println!("cargo:rustc-env=TOOLKNIT_SEARCH_HOST_REVISION={:x}", hash.finalize());
}
