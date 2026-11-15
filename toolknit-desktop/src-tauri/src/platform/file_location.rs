//! Reveal a directory entry, without following a shortcut or file symlink.
use std::path::Path;

pub(crate) fn reveal_file(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("file-search:invalid-path".into());
    }
    let meta = std::fs::symlink_metadata(path).map_err(|_| "file-search:unavailable")?;
    if meta.is_dir() {
        return Err("file-search:not-file".into());
    }
    open_shell_location(path.parent().ok_or("file-search:invalid-path")?, Some(path))
}

/// Open the directory itself; never dispatch its file association or parse a
/// command line. Shared with the legacy output/cleanup location commands.
pub(crate) fn open_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("file-search:invalid-path".into());
    }
    if !std::fs::metadata(path).map_err(|_| "file-search:unavailable")?.is_dir() {
        return Err("file-search:not-directory".into());
    }
    open_shell_location(path, None)
}

#[cfg(windows)]
fn shell_path(path: &Path) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;
    if !path.is_absolute() {
        return Err("file-search:invalid-path".into());
    }
    let mut text = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if text.starts_with(&[92, 92, 63, 92, 85, 78, 67, 92]) {
        text.splice(0..8, [92, 92]);
    } else if text.starts_with(&[92, 92, 63, 92])
        && text.get(4).is_some_and(|c| (65..=90).contains(c) || (97..=122).contains(c))
        && text.get(5) == Some(&58) && text.get(6) == Some(&92)
    {
        text.drain(0..4);
    }
    if text.len() >= 32767 || text.contains(&0) {
        return Err("file-search:invalid-path".into());
    }
    text.push(0);
    Ok(text)
}

fn open_shell_location(directory: &Path, selected: Option<&Path>) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::{
            core::{w, PCWSTR},
            Win32::{
                System::Com::{
                    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
                },
                UI::Shell::{
                    Common::ITEMIDLIST, ILFindLastID, SHOpenFolderAndSelectItems,
                    SHParseDisplayName, ShellExecuteExW, SHELLEXECUTEINFOW,
                    SEE_MASK_FLAG_NO_UI, SEE_MASK_IDLIST, SEE_MASK_NOASYNC,
                },
                UI::WindowsAndMessaging::SW_SHOWNORMAL,
            },
        };
        struct Apartment(bool);
        impl Drop for Apartment {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { CoUninitialize() }
                }
            }
        }
        struct Pidl(*mut ITEMIDLIST);
        impl Drop for Pidl {
            fn drop(&mut self) {
                unsafe { CoTaskMemFree(Some(self.0.cast())) }
            }
        }
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _com = Apartment(hr.is_ok());
        if hr.is_err() && hr.0 != 0x80010106u32 as i32 {
            return Err("file-search:explorer".into());
        }
        fn parse(path: &Path) -> Result<Pidl, String> {
            let text = shell_path(path)?;
            let mut item = Pidl(std::ptr::null_mut());
            unsafe { SHParseDisplayName(PCWSTR(text.as_ptr()), None, &mut item.0, 0, None) }
                .map_err(|_| "file-search:explorer")?;
            if item.0.is_null() { return Err("file-search:explorer".into()); }
            Ok(item)
        }
        let folder = parse(directory)?;
        if let Some(selected) = selected {
            let file = parse(selected)?;
            let child = ILFindLastID(file.0);
            if child.is_null() { return Err("file-search:explorer".into()); }
            SHOpenFolderAndSelectItems(folder.0, Some(&[child as *const ITEMIDLIST]), 0)
                .map_err(|_| "file-search:explorer")?;
        } else {
            // A zero-item SHOpenFolderAndSelectItems opens the parent and
            // selects this directory. Use the validated directory's PIDL to
            // open the directory itself instead (no Explorer path arguments).
            let mut execute = SHELLEXECUTEINFOW {
                cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                fMask: SEE_MASK_IDLIST | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
                lpVerb: w!("open"),
                lpIDList: folder.0.cast(),
                nShow: SW_SHOWNORMAL.0,
                ..Default::default()
            };
            ShellExecuteExW(&mut execute).map_err(|_| "file-search:explorer")?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (directory, selected);
        Err("file-search:windows-only".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn shell_paths_preserve_names_and_normalize_only_filesystem_prefixes() {
        for (input, expected) in [
            (r"C:\folder\file with spaces, (1).txt", r"C:\folder\file with spaces, (1).txt"),
            (r"\\?\D:\合同\100% & #, 终稿(1)😀.txt", r"D:\合同\100% & #, 终稿(1)😀.txt"),
            (r"\\?\UNC\server\share\合同, 终稿.txt", r"\\server\share\合同, 终稿.txt"),
            (r"\\server\share\plain.txt", r"\\server\share\plain.txt"),
        ] {
            let value = shell_path(Path::new(input)).unwrap();
            assert_eq!(value.last(), Some(&0));
            assert_eq!(String::from_utf16(&value[..value.len()-1]).unwrap(), expected);
        }
        assert!(shell_path(Path::new("relative.txt")).is_err());
        assert!(shell_path(Path::new("C:\\bad\0name")).is_err());
        assert!(shell_path(Path::new(&format!("C:\\{}", "x".repeat(32767)))).is_err());
        let root = std::env::temp_dir();
        assert!(reveal_file(&root).is_err());
        assert!(open_directory(&root.join("toolknit-absent-location-124" )).is_err());
    }
}
