//! On-demand NTFS metadata service, isolated from Tauri and UI privileges.
mod access;
mod client;
pub(super) use client::{Change, Checkpoint, Client};
pub(super) fn installed() -> bool {
    identity::current_sid().is_ok_and(|sid| install::installed(&sid))
}
pub(super) fn current() -> bool {
    identity::current_sid().is_ok_and(|sid| install::current(&sid))
}
pub(super) fn configure(remove: bool) -> Result<(), String> {
    install::request_install(remove)
}
pub(super) fn volumes() -> Vec<String> {
    let mask = unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() };
    (b'A'..=b'Z')
        .filter(|drive| {
            mask & (1u32 << (*drive - b'A')) != 0 && server::volume_serial(*drive).is_ok()
        })
        .map(|d| format!("{}:\\", d as char))
        .collect()
}
mod identity;
pub(super) use identity::protect_cache_directory;
mod install;
#[cfg(test)]
mod integration_tests;
mod journal_paths;
mod pipe;
mod scope;
mod server;

pub(super) fn dispatch_install_mode() -> Option<i32> {
    let args = std::env::args().collect::<Vec<_>>();
    let action = args.get(1)?.as_str();
    if args.len() == 2 && ["--file-search-cleanup", "--file-search-uninstall-all"].contains(&action)
    {
        let result = if action == "--file-search-cleanup" {
            install::request_cleanup()
        } else {
            install::uninstall_all()
        };
        return Some(if result.is_ok() { 0 } else { 1 });
    }
    if ![
        "--file-search-install",
        "--file-search-uninstall",
        "--file-search-service",
    ]
    .contains(&action)
    {
        return None;
    }
    if args.len() != 3 || !identity::valid_sid(&args[2]) {
        return Some(2);
    }
    let result = match action {
        "--file-search-install" => install::install(&args[2]),
        "--file-search-uninstall" => install::uninstall(&args[2]),
        _ => server::dispatch(&args[2]),
    };
    Some(if result.is_ok() { 0 } else { 1 })
}
