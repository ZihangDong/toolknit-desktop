use super::identity::{self, path_wide, wide, Descriptor, Handle};
use std::{
    io::Read,
    mem::size_of,
    time::{Duration, Instant},
};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::HANDLE,
        Security::{
            SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
            SC_HANDLE,
        },
        System::{
            Services::*,
            Threading::{GetExitCodeProcess, WaitForSingleObject},
        },
        UI::{
            Shell::{
                ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_HIDE,
        },
    },
};

struct Service(SC_HANDLE);
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct HostRecord { revision: String, protocol: u32, hash: String }
impl HostRecord {
    fn compatible(&self) -> bool {
        self.revision == env!("TOOLKNIT_SEARCH_HOST_REVISION")
            && self.protocol == super::super::protocol::VERSION
            && self.hash.len() == 64 && self.hash.bytes().all(|c| c.is_ascii_hexdigit())
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseServiceHandle(self.0);
        }
    }
}
fn manager(access: u32) -> Result<Service, String> {
    unsafe {
        OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), access)
            .map(Service)
            .map_err(|_| "file-search:service-access".into())
    }
}
fn open(sid: &str, access: u32) -> Result<Service, String> {
    let manager = manager(SC_MANAGER_CONNECT)?;
    let name = wide(&identity::service_name(sid)?);
    unsafe {
        OpenServiceW(manager.0, PCWSTR(name.as_ptr()), access)
            .map(Service)
            .map_err(|_| "file-search:service-missing".into())
    }
}
fn state(service: &Service) -> Result<SERVICE_STATUS_PROCESS, String> {
    unsafe {
        let mut status = SERVICE_STATUS_PROCESS::default();
        let mut required = 0;
        let bytes = std::slice::from_raw_parts_mut(
            (&mut status as *mut SERVICE_STATUS_PROCESS).cast::<u8>(),
            size_of::<SERVICE_STATUS_PROCESS>(),
        );
        QueryServiceStatusEx(
            service.0,
            SC_STATUS_PROCESS_INFO,
            Some(bytes),
            &mut required,
        )
        .map_err(|_| "file-search:service-access")?;
        Ok(status)
    }
}
pub(super) fn installed(sid: &str) -> bool {
    open(sid, SERVICE_QUERY_STATUS).is_ok()
}
fn source_identity() -> Result<Vec<u8>, String> {
    use std::os::windows::ffi::OsStrExt;
    let source = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|_| "file-search:service-install")?;
    Ok(source
        .as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect())
}
fn belongs_to_installation(root: &std::path::Path, source: &[u8]) -> bool {
    let path = root.join("owner.source");
    std::fs::symlink_metadata(&path)
        .is_ok_and(|m| m.is_file() && m.len() <= 131072 && !super::super::storage::reparse(&m))
        && std::fs::read(path).is_ok_and(|bytes| bytes == source)
}
pub(super) fn current(sid: &str) -> bool {
    source_identity().is_ok_and(|source| current_for_source(sid, &source))
}
pub(super) fn current_for_source(sid: &str, source: &[u8]) -> bool {
    let Ok(service) = open(sid, SERVICE_QUERY_CONFIG) else {
        return false;
    };
    let Ok(root) = identity::install_root() else {
        return false;
    };
    let Ok(name) = identity::service_name(sid) else {
        return false;
    };
    if !belongs_to_installation(&root.join(&name), source) {
        return false;
    }
    let installed = root.join(&name);
    if installed.ancestors().any(|p| std::fs::symlink_metadata(p).is_ok_and(|m| super::super::storage::reparse(&m) || !m.is_dir())) { return false; }
    let manifest = installed.join("host.json");
    if !std::fs::symlink_metadata(&manifest).is_ok_and(|m| m.is_file() && m.len() < 16384 && !super::super::storage::reparse(&m)) { return false; }
    let Ok(record) = std::fs::read(&manifest).ok().and_then(|bytes| serde_json::from_slice::<HostRecord>(&bytes).ok()).ok_or(()) else { return false; };
    if !record.compatible() { return false; }
    let hash = record.hash.to_ascii_lowercase();
    let host = installed.join(format!("search-host-{}.exe", &hash[..20]));
    if !std::fs::symlink_metadata(&host).is_ok_and(|m| m.is_file() && !super::super::storage::reparse(&m))
        || !digest(&host).is_ok_and(|actual| actual == hash) { return false; }
    let expected = format!(
        "\"{}\" --file-search-service {sid}",
        root.join(name)
            .join(format!("search-host-{}.exe", &hash[..20]))
            .to_string_lossy()
    );
    unsafe {
        let mut required = 0;
        let _ = QueryServiceConfigW(service.0, None, 0, &mut required);
        if required == 0 || required > 65536 {
            return false;
        }
        let mut words = vec![0usize; (required as usize).div_ceil(size_of::<usize>())];
        let config = words.as_mut_ptr().cast::<QUERY_SERVICE_CONFIGW>();
        if QueryServiceConfigW(service.0, Some(config), required, &mut required).is_err() {
            return false;
        }
        (*config)
            .lpBinaryPathName
            .to_string()
            .is_ok_and(|s| s == expected)
    }
}
pub(super) fn running_pid(sid: &str) -> Result<u32, String> {
    let service = open(sid, SERVICE_QUERY_STATUS)?;
    let status = state(&service)?;
    if status.dwCurrentState != SERVICE_RUNNING || status.dwProcessId == 0 {
        return Err("file-search:service-start".into());
    }
    Ok(status.dwProcessId)
}
pub(super) fn start(sid: &str) -> Result<(), String> {
    let service = open(sid, SERVICE_START | SERVICE_QUERY_STATUS)?;
    let until = Instant::now() + Duration::from_secs(12);
    let mut requested = false;
    while Instant::now() < until {
        match state(&service)?.dwCurrentState {
            SERVICE_RUNNING => return Ok(()),
            SERVICE_STOPPED if !requested => {
                unsafe { StartServiceW(service.0, None) }
                    .map_err(|_| "file-search:service-start")?;
                requested = true;
            }
            SERVICE_STOPPED => return Err("file-search:service-start".into()),
            _ => {}
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("file-search:service-timeout".into())
}
fn stop(service: &Service) -> Result<(), String> {
    if state(service)?.dwCurrentState == SERVICE_STOPPED {
        return Ok(());
    }
    if state(service)?.dwCurrentState != SERVICE_STOP_PENDING {
        unsafe {
            let mut status = SERVICE_STATUS::default();
            ControlService(service.0, SERVICE_CONTROL_STOP, &mut status)
                .map_err(|_| "file-search:service-stop")?;
        }
    }
    let until = Instant::now() + Duration::from_secs(12);
    while Instant::now() < until {
        if state(service)?.dwCurrentState == SERVICE_STOPPED {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("file-search:service-timeout".into())
}
fn digest(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path).map_err(|_| "file-search:service-install")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "file-search:service-install")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hex::encode(hash.finalize()))
}
pub(super) fn install(sid: &str) -> Result<(), String> {
    if !identity::elevated() || !identity::valid_sid(sid) {
        return Err("file-search:administrator-required".into());
    }
    let root = identity::install_root()?.join(identity::service_name(sid)?);
    // Refuse a redirected installation directory. Do not copy an elevated
    // executable into an account-writable AppData or temporary directory.
    for path in root.ancestors() {
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if super::super::storage::reparse(&meta) || !meta.is_dir() {
                return Err("file-search:service-security".into());
            }
        }
    }
    std::fs::create_dir_all(&root).map_err(|_| "file-search:service-install")?;
    let security = Descriptor::from_sddl("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)")?;
    let root_name = path_wide(&root);
    if !unsafe {
        SetFileSecurityW(
            PCWSTR(root_name.as_ptr()),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            security.0,
        )
    }
    .as_bool()
    {
        return Err("file-search:service-security".into());
    }
    let source = std::env::current_exe().map_err(|_| "file-search:service-install")?;
    let hash = digest(&source)?;
    let target = root.join(format!("search-host-{}.exe", &hash[..20]));
    if target.exists() {
        if digest(&target)? != hash {
            return Err("file-search:service-integrity".into());
        }
    } else {
        let mut random = [0u8; 16];
        getrandom::getrandom(&mut random).map_err(|_| "file-search:service-install")?;
        let temp = root.join(format!("search-host-{}.tmp", hex::encode(random)));
        let staged = (|| -> Result<(), String> {
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|_| "file-search:service-install")?;
            let mut input =
                std::fs::File::open(&source).map_err(|_| "file-search:service-install")?;
            std::io::copy(&mut input, &mut output).map_err(|_| "file-search:service-install")?;
            output
                .sync_all()
                .map_err(|_| "file-search:service-install")?;
            drop(output);
            if digest(&temp)? != hash {
                return Err("file-search:service-integrity".into());
            }
            std::fs::rename(&temp, &target).map_err(|_| "file-search:service-install")?;
            Ok(())
        })();
        if staged.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        staged?;
    }
    let manager = manager(SC_MANAGER_CREATE_SERVICE | SC_MANAGER_CONNECT)?;
    let name = wide(&identity::service_name(sid)?);
    // SCM requires display names to be unique as well as internal names.
    let display = wide(&format!(
        "ToolKnit File Search ({})",
        identity::service_name(sid)?
    ));
    let command = wide(&format!(
        "\"{}\" --file-search-service {sid}",
        target.to_string_lossy()
    ));
    let service = unsafe {
        match OpenServiceW(manager.0, PCWSTR(name.as_ptr()), SERVICE_ALL_ACCESS) {
            Ok(handle) => {
                let service = Service(handle);
                stop(&service)?;
                ChangeServiceConfigW(
                    service.0,
                    SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_DEMAND_START,
                    SERVICE_ERROR_NORMAL,
                    PCWSTR(command.as_ptr()),
                    PCWSTR::null(),
                    None,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    PCWSTR::null(),
                    PCWSTR(display.as_ptr()),
                )
                .map_err(|_| "file-search:service-install")?;
                service
            }
            Err(_) => Service(
                CreateServiceW(
                    manager.0,
                    PCWSTR(name.as_ptr()),
                    PCWSTR(display.as_ptr()),
                    SERVICE_ALL_ACCESS,
                    SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_DEMAND_START,
                    SERVICE_ERROR_NORMAL,
                    PCWSTR(command.as_ptr()),
                    PCWSTR::null(),
                    None,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    PCWSTR::null(),
                )
                .map_err(|_| "file-search:service-install")?,
            ),
        }
    };
    // The account can start/stop/query this demand service, never reconfigure it.
    let rights =
        Descriptor::from_sddl(&format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;CCLCRPWP;;;{sid})"))?;
    unsafe {
        SetServiceObjectSecurity(service.0, DACL_SECURITY_INFORMATION, rights.0)
            .map_err(|_| "file-search:service-security")?;
    }
    std::fs::write(root.join("owner.sid"), sid).map_err(|_| "file-search:service-install")?;
    std::fs::write(root.join("owner.source"), source_identity()?)
        .map_err(|_| "file-search:service-install")?;
    let record = HostRecord { revision: env!("TOOLKNIT_SEARCH_HOST_REVISION").into(), protocol: super::super::protocol::VERSION, hash };
    let mut nonce = [0u8; 16]; getrandom::getrandom(&mut nonce).map_err(|_| "file-search:service-install")?;
    let temporary = root.join(format!("search-host-manifest-{}.tmp", hex::encode(nonce)));
    let written = (|| -> Result<(), String> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|_| "file-search:service-install")?;
        file.write_all(&serde_json::to_vec(&record).map_err(|_| "file-search:service-install")?).and_then(|_| file.sync_all()).map_err(|_| "file-search:service-install")?;
        drop(file);
        std::fs::rename(&temporary, root.join("host.json")).map_err(|_| "file-search:service-install".to_owned())
    })();
    if written.is_err() { let _ = std::fs::remove_file(&temporary); }
    written?;
    Ok(())
}
pub(super) fn uninstall(sid: &str) -> Result<(), String> {
    if !identity::elevated() {
        return Err("file-search:administrator-required".into());
    }
    if installed(sid) {
        let service = open(sid, SERVICE_ALL_ACCESS)?;
        stop(&service)?;
        unsafe {
            DeleteService(service.0).map_err(|_| "file-search:service-install")?;
        }
    }
    let root = identity::install_root()?.join(identity::service_name(sid)?);
    if let Ok(meta) = std::fs::symlink_metadata(&root) {
        if super::super::storage::reparse(&meta) {
            return Err("file-search:service-security".into());
        }
    }
    // Only this account's generated host files; other account services coexist.
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("search-host-")
                && (name.ends_with(".exe") || name.ends_with(".tmp"))
                && entry.file_type().is_ok_and(|t| t.is_file())
            {
                std::fs::remove_file(entry.path()).map_err(|_| "file-search:service-install")?;
            }
        }
        let _ = std::fs::remove_file(root.join("owner.sid"));
        let _ = std::fs::remove_file(root.join("owner.source"));
        let _ = std::fs::remove_file(root.join("host.json"));
        let _ = std::fs::remove_dir(&root);
    }
    Ok(())
}
pub(super) fn uninstall_all() -> Result<(), String> {
    if !identity::elevated() {
        return Err("file-search:administrator-required".into());
    }
    for sid in owners()? {
        uninstall(&sid)?;
    }
    Ok(())
}
fn owners() -> Result<Vec<String>, String> {
    let root = identity::install_root()?;
    let source = source_identity()?;
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut owners = Vec::new();
    for entry in entries.flatten().take(1024) {
        let path = entry.path();
        if !entry
            .metadata()
            .is_ok_and(|m| m.is_dir() && !super::super::storage::reparse(&m))
        {
            continue;
        }
        let manifest = path.join("owner.sid");
        if !std::fs::symlink_metadata(&manifest)
            .is_ok_and(|m| m.is_file() && m.len() <= 184 && !super::super::storage::reparse(&m))
        {
            continue;
        }
        let Ok(sid) = std::fs::read_to_string(manifest) else {
            continue;
        };
        if identity::service_name(&sid).is_ok_and(|name| path == root.join(name))
            && belongs_to_installation(&path, &source)
        {
            owners.push(sid);
        }
    }
    Ok(owners)
}
pub(super) fn request_cleanup() -> Result<(), String> {
    if owners()?.is_empty() {
        return Ok(());
    }
    if identity::elevated() {
        return uninstall_all();
    }
    launch_elevated("--file-search-uninstall-all")
}
pub(super) fn request_install(remove: bool) -> Result<(), String> {
    let sid = identity::current_sid()?;
    if identity::elevated() {
        return if remove {
            uninstall(&sid)
        } else {
            install(&sid)
        };
    }
    let parameters = format!(
        "{} {sid}",
        if remove {
            "--file-search-uninstall"
        } else {
            "--file-search-install"
        }
    );
    launch_elevated(&parameters)
}
fn launch_elevated(parameters: &str) -> Result<(), String> {
    let executable =
        path_wide(&std::env::current_exe().map_err(|_| "file-search:service-install")?);
    let parameters = wide(parameters);
    let mut launch = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(executable.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut launch).map_err(|_| "file-search:authorization-cancelled")?;
    }
    let process = Handle(launch.hProcess);
    if process.0 == HANDLE::default() {
        return Err("file-search:service-install".into());
    }
    let until = Instant::now() + Duration::from_secs(120);
    loop {
        if unsafe { WaitForSingleObject(process.0, 100) }.0 == 0 {
            let mut code = 1;
            unsafe {
                GetExitCodeProcess(process.0, &mut code)
                    .map_err(|_| "file-search:service-install")?;
            }
            return if code == 0 {
                Ok(())
            } else {
                Err("file-search:service-install".into())
            };
        }
        if Instant::now() > until {
            return Err("file-search:service-timeout".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_compatibility_requires_service_revision_protocol_and_integrity_shape() {
        let mut record = HostRecord { revision: env!("TOOLKNIT_SEARCH_HOST_REVISION").into(), protocol: super::super::super::protocol::VERSION, hash: "a".repeat(64) };
        assert!(record.compatible());
        record.hash.push('a'); assert!(!record.compatible()); record.hash.pop();
        record.protocol += 1; assert!(!record.compatible()); record.protocol -= 1;
        record.revision = "another-service-build".into(); assert!(!record.compatible());
    }
    #[test]
    fn cleanup_only_claims_the_exact_owning_installation() {
        let root = std::env::temp_dir().join(format!(
            "toolknit-service-owner-test-{}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("owner.source");
        let source = source_identity().unwrap();
        std::fs::write(&path, &source).unwrap();
        assert!(belongs_to_installation(&root, &source));
        let other = b"another-installation";
        assert!(
            !belongs_to_installation(&root, other),
            "an old or per-user uninstaller cannot remove another installation's service"
        );
        std::fs::write(&path, vec![0u8; 131073]).unwrap();
        assert!(!belongs_to_installation(&root, &source));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
