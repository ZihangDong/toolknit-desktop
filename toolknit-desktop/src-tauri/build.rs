fn main() {
    tauri_build::build();

    // Unit tests link the Tauri resource library explicitly from lib.rs.
    #[cfg(windows)]
    {
        let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo");
        println!("cargo:rustc-link-search=native={out_dir}");
    }
}
