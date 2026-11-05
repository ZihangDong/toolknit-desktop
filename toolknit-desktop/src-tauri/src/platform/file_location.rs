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
    #[cfg(windows)]
    unsafe {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::{
                System::Com::{
                    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
                },
                UI::Shell::{
                    Common::ITEMIDLIST, ILFindLastID, SHOpenFolderAndSelectItems,
                    SHParseDisplayName,
                },
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
        fn shell_path(path: &Path) -> Result<Vec<u16>, String> {
            let mut text = path.as_os_str().encode_wide().collect::<Vec<_>>();
            if text.len() > 32767 || text.contains(&0) {
                return Err("file-search:invalid-path".into());
            }
            if text.starts_with(&[92, 92, 63, 92, 85, 78, 67, 92]) {
                text.splice(0..8, [92, 92]);
            } else if text.starts_with(&[92, 92, 63, 92]) {
                text.drain(0..4);
            }
            text.push(0);
            Ok(text)
        }
        let parent = shell_path(path.parent().ok_or("file-search:invalid-path")?)?;
        let full = shell_path(path)?;
        let mut folder = std::ptr::null_mut();
        SHParseDisplayName(PCWSTR(parent.as_ptr()), None, &mut folder, 0, None)
            .map_err(|_| "file-search:explorer")?;
        let folder = Pidl(folder);
        let mut file = std::ptr::null_mut();
        SHParseDisplayName(PCWSTR(full.as_ptr()), None, &mut file, 0, None)
            .map_err(|_| "file-search:explorer")?;
        let file = Pidl(file);
        let child = ILFindLastID(file.0);
        SHOpenFolderAndSelectItems(folder.0, Some(&[child as *const ITEMIDLIST]), 0)
            .map_err(|_| "file-search:explorer")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("file-search:windows-only".into())
    }
}
