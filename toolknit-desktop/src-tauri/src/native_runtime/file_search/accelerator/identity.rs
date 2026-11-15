use std::{
    mem::size_of,
    path::{Path, PathBuf},
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            GetTokenInformation, TokenElevation, TokenUser, PSECURITY_DESCRIPTOR, TOKEN_ELEVATION,
            TOKEN_QUERY, TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

pub(super) struct Handle(pub HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}
pub(super) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
pub(super) fn path_wide(value: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.as_os_str().encode_wide().chain(Some(0)).collect()
}
pub(super) fn valid_sid(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    value.len() <= 184
        && (4..=18).contains(&parts.len())
        && parts[0] == "S"
        && parts[1] == "1"
        && parts[2].parse::<u64>().is_ok_and(|n| n < 1u64 << 48)
        && parts[3..].iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|c| c.is_ascii_digit())
                && part.parse::<u32>().is_ok()
        })
}
fn token() -> Result<Handle, String> {
    unsafe {
        let mut value = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut value)
            .map_err(|_| "file-search:identity")?;
        Ok(Handle(value))
    }
}
pub(super) fn sid_of(token: HANDLE) -> Result<String, String> {
    unsafe {
        let mut length = 0;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut length);
        if length == 0 || length > 65536 {
            return Err("file-search:identity".into());
        }
        let mut words = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
        GetTokenInformation(
            token,
            TokenUser,
            Some(words.as_mut_ptr().cast()),
            length,
            &mut length,
        )
        .map_err(|_| "file-search:identity")?;
        let user = &*(words.as_ptr() as *const TOKEN_USER);
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid).map_err(|_| "file-search:identity")?;
        let result = sid
            .to_string()
            .map_err(|_| "file-search:identity".to_owned());
        let _ = LocalFree(HLOCAL(sid.0 as *mut _));
        result.and_then(|s| {
            if valid_sid(&s) {
                Ok(s)
            } else {
                Err("file-search:identity".into())
            }
        })
    }
}
pub(super) fn current_sid() -> Result<String, String> {
    sid_of(token()?.0)
}
pub(crate) fn protect_cache_directory(path: &Path) -> Result<(), String> {
    use windows::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };
    let sid = current_sid()?;
    let security = Descriptor::from_sddl(&format!(
        "D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
    ))?;
    let name = path_wide(path);
    if unsafe {
        SetFileSecurityW(
            PCWSTR(name.as_ptr()),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            security.0,
        )
    }
    .as_bool()
    {
        Ok(())
    } else {
        Err("file-search:storage".into())
    }
}
pub(super) fn elevated() -> bool {
    unsafe {
        let Ok(token) = token() else {
            return false;
        };
        let mut value = TOKEN_ELEVATION::default();
        let mut length = 0;
        GetTokenInformation(
            token.0,
            TokenElevation,
            Some((&mut value as *mut TOKEN_ELEVATION).cast()),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        )
        .is_ok()
            && value.TokenIsElevated != 0
    }
}
pub(super) fn service_name(sid: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    if !valid_sid(sid) {
        return Err("file-search:identity".into());
    }
    Ok(format!(
        "ToolKnitSearch_{}",
        &hex::encode(Sha256::digest(sid.as_bytes()))[..16]
    ))
}
pub(super) fn pipe_name(sid: &str) -> Result<String, String> {
    Ok(format!("\\\\.\\pipe\\{}_v1", service_name(sid)?))
}
pub(super) struct Descriptor(pub PSECURITY_DESCRIPTOR);
impl Descriptor {
    pub fn from_sddl(text: &str) -> Result<Self, String> {
        unsafe {
            let value = wide(text);
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(value.as_ptr()),
                1,
                &mut descriptor,
                None,
            )
            .map_err(|_| "file-search:service-security")?;
            Ok(Self(descriptor))
        }
    }
}
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(HLOCAL(self.0 .0));
        }
    }
}
pub(super) fn install_root() -> Result<PathBuf, String> {
    unsafe {
        use windows::Win32::{
            System::Com::CoTaskMemFree,
            UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
        };
        let value =
            SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, HANDLE::default())
                .map_err(|_| "file-search:service-install")?;
        let path = value
            .to_string()
            .map_err(|_| "file-search:service-install".to_owned());
        CoTaskMemFree(Some(value.0.cast()));
        Ok(PathBuf::from(path?).join("ToolKnit").join("FileSearch"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_names_are_bounded_and_account_specific() {
        assert_ne!(
            service_name("S-1-5-21-1").unwrap(),
            service_name("S-1-5-21-2").unwrap()
        );
        for value in ["S-1-5);D:(A;;GA;;;WD)", "..\\x", "S-2-5"] {
            assert!(!valid_sid(value));
            assert!(service_name(value).is_err());
        }
        let sid = current_sid().unwrap();
        assert!(valid_sid(&sid));
    }
}
