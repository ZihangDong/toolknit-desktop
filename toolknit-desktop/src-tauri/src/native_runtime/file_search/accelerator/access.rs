use super::identity::{self, Handle};
use std::{collections::HashMap, mem::size_of};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{LocalFree, BOOL, HANDLE, HLOCAL},
        Security::{
            AccessCheck,
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            RevertToSelf, DACL_SECURITY_INFORMATION, GENERIC_MAPPING, GROUP_SECURITY_INFORMATION,
            OWNER_SECURITY_INFORMATION, PRIVILEGE_SET, PSECURITY_DESCRIPTOR, TOKEN_QUERY,
        },
        Storage::FileSystem::{
            FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
            FILE_LIST_DIRECTORY,
        },
        System::{
            Pipes::ImpersonateNamedPipeClient,
            Threading::{GetCurrentThread, OpenThreadToken},
        },
    },
};

pub(super) fn client_token(pipe: HANDLE, expected_sid: &str) -> Result<Handle, String> {
    unsafe {
        ImpersonateNamedPipeClient(pipe).map_err(|_| "file-search:identity")?;
        struct Revert;
        impl Drop for Revert {
            fn drop(&mut self) {
                unsafe {
                    if RevertToSelf().is_err() {
                        std::process::abort();
                    }
                }
            }
        }
        let _revert = Revert;
        let mut token = HANDLE::default();
        OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, true, &mut token)
            .map_err(|_| "file-search:identity")?;
        let token = Handle(token);
        if identity::sid_of(token.0)? != expected_sid {
            return Err("file-search:identity".into());
        }
        Ok(token)
    }
}
pub(super) struct Visibility {
    token: Handle,
    cache: HashMap<Vec<u16>, bool>,
}
impl Visibility {
    pub fn clear(&mut self) {
        self.cache.clear();
    }
    pub fn new(token: Handle) -> Self {
        Self {
            token,
            cache: HashMap::new(),
        }
    }
    pub fn allows(&mut self, path: &[u16]) -> bool {
        if path.len() < 3
            || path.len() > 32700
            || path.contains(&0)
            || path.iter().filter(|c| **c == 92).count() > 512
        {
            return false;
        }
        if let Some(allowed) = self.cache.get(path) {
            return *allowed;
        }
        // Listing a child must not reveal names below an ancestor that the
        // account cannot list. All calls use its identification token.
        if path.len() > 3 {
            if let Some(at) = path.iter().rposition(|c| *c == 92) {
                let parent = &path[..if at == 2 { 3 } else { at }];
                if !self.allows(parent) {
                    self.cache.insert(path.to_vec(), false);
                    return false;
                }
            }
        }
        let allowed = self.check(path);
        if self.cache.len() < 1_000_000 {
            self.cache.insert(path.to_vec(), allowed);
        }
        allowed
    }
    fn check(&self, path: &[u16]) -> bool {
        unsafe {
            let mut name = vec![92, 92, 63, 92];
            name.extend(path);
            name.push(0);
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            let result = GetNamedSecurityInfoW(
                PCWSTR(name.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION,
                None,
                None,
                None,
                None,
                &mut descriptor,
            );
            if result.0 != 0 {
                return false;
            }
            struct Free(PSECURITY_DESCRIPTOR);
            impl Drop for Free {
                fn drop(&mut self) {
                    unsafe {
                        let _ = LocalFree(HLOCAL(self.0 .0));
                    }
                }
            }
            let _free = Free(descriptor);
            let mapping = GENERIC_MAPPING {
                GenericRead: FILE_GENERIC_READ.0,
                GenericWrite: FILE_GENERIC_WRITE.0,
                GenericExecute: FILE_GENERIC_EXECUTE.0,
                GenericAll: FILE_ALL_ACCESS.0,
            };
            let mut privileges = vec![0usize; 64];
            let mut length = (privileges.len() * size_of::<usize>()) as u32;
            let mut granted = 0;
            let mut allowed = BOOL(0);
            AccessCheck(
                descriptor,
                self.token.0,
                FILE_LIST_DIRECTORY.0,
                &mapping,
                Some(privileges.as_mut_ptr().cast::<PRIVILEGE_SET>()),
                &mut length,
                &mut granted,
                &mut allowed,
            )
            .is_ok()
                && allowed.as_bool()
                && (granted & FILE_LIST_DIRECTORY.0) != 0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::identity::{path_wide, Descriptor};
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::{
        Security::{
            DuplicateToken, SecurityIdentification, SetFileSecurityW,
            PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_DUPLICATE,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    #[test]
    fn directory_visibility_uses_client_acl_and_denied_ancestors() {
        let sid = identity::current_sid().unwrap();
        let root = std::env::temp_dir().join(format!("toolknit-search-acl-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("child")).unwrap();
        let allowed =
            Descriptor::from_sddl(&format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)")).unwrap();
        struct Restore<'a> {
            root: &'a std::path::Path,
            acl: &'a Descriptor,
        }
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                unsafe {
                    let _ = SetFileSecurityW(
                        PCWSTR(path_wide(self.root).as_ptr()),
                        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                        self.acl.0,
                    );
                }
                let _ = std::fs::remove_dir(self.root.join("child"));
                let _ = std::fs::remove_dir(self.root);
            }
        }
        let _restore = Restore {
            root: &root,
            acl: &allowed,
        };
        let mut process = HANDLE::default();
        let mut token = HANDLE::default();
        unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_QUERY | TOKEN_DUPLICATE,
                &mut process,
            )
            .unwrap();
        }
        let process = Handle(process);
        unsafe {
            DuplicateToken(process.0, SecurityIdentification, &mut token).unwrap();
        }
        let mut visibility = Visibility::new(Handle(token));
        let name = root.as_os_str().encode_wide().collect::<Vec<_>>();
        assert!(visibility.allows(&name));
        let denied = Descriptor::from_sddl(&format!(
            "D:P(D;;0x1;;;{sid})(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)"
        ))
        .unwrap();
        assert!(unsafe {
            SetFileSecurityW(
                PCWSTR(path_wide(&root).as_ptr()),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                denied.0,
            )
        }
        .as_bool());
        visibility.clear();
        assert!(!visibility.allows(&name));
        assert!(
            !visibility.allows(
                &root
                    .join("child")
                    .as_os_str()
                    .encode_wide()
                    .collect::<Vec<_>>()
            ),
            "an allowed child must not expose names below a denied ancestor"
        );
    }
}
