use super::super::{
    protocol::{self, Metadata, Request, Response},
    query::{extension, Entry},
};
use super::{identity, install, pipe};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    path::{Component, PathBuf, Prefix},
    sync::{atomic::AtomicBool, Arc},
};
use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Checkpoint {
    pub serial: u32,
    pub journal_id: Option<u64>,
    pub next_usn: Option<i64>,
}
pub(crate) struct Client {
    pipe: pipe::Pipe,
    policy: Option<super::super::scope_policy::Spec>,
}
pub(crate) enum Change {
    File(Entry),
    Removed(PathBuf),
    Directory(PathBuf),
}
impl Client {
    pub(crate) fn set_policy(&mut self, policy: Option<super::super::scope_policy::Spec>) { self.policy = policy; }
    pub fn connect(cancel: Arc<AtomicBool>) -> Result<Self, String> {
        let sid = identity::current_sid()?;
        install::start(&sid)?;
        let mut pipe = pipe::connect(&sid, cancel)?;
        let mut pid = 0;
        unsafe { GetNamedPipeServerProcessId(pipe.handle.0, &mut pid) }
            .map_err(|_| "file-search:service-security")?;
        if pid != install::running_pid(&sid)? {
            return Err("file-search:service-security".into());
        }
        // SCM authenticates the pipe server above. A normal desktop token is
        // not allowed to open a LocalSystem process for SYNCHRONIZE. Monitor
        // server loss through the pipe's broken connection / bounded I/O;
        // only the privileged server watches the desktop process directly.
        let mut bytes = [0u8; 16];
        getrandom::getrandom(&mut bytes).map_err(|_| "file-search:identity")?;
        let nonce = hex::encode(bytes);
        protocol::write_frame(
            &mut pipe,
            &Request::Hello {
                version: protocol::VERSION,
                process: std::process::id(),
                nonce: nonce.clone(),
            },
        )?;
        match protocol::read_frame::<Response>(&mut pipe)? {
            Response::Ready {
                version,
                nonce: reply,
            } if version == protocol::VERSION && nonce == reply => Ok(Self { pipe, policy: None }),
            _ => Err("file-search:protocol".into()),
        }
    }
    pub fn scan(
        &mut self,
        drive: u8,
        roots: &[PathBuf],
        mut receive: impl FnMut(Entry) -> Result<(), String>,
    ) -> Result<Checkpoint, String> {
        if !drive.is_ascii_uppercase() {
            return Err("file-search:volume".into());
        }
        protocol::write_frame(
            &mut self.pipe,
            &Request::Scan {
                drive: (drive as char).to_string(),
                roots: super::scope::encode(roots),
                policy: self.policy.clone(),
            },
        )?;
        loop {
            match protocol::read_frame::<Response>(&mut self.pipe)? {
                Response::Files { items } => {
                    if items.len() > 512 {
                        return Err("file-search:protocol".into());
                    }
                    for item in items {
                        if item.deleted || item.directory {
                            return Err("file-search:protocol".into());
                        }
                        receive(decode(item, drive)?)?;
                    }
                }
                Response::Done {
                    serial,
                    journal_id,
                    next_usn,
                } => {
                    return Ok(Checkpoint {
                        serial,
                        journal_id,
                        next_usn,
                    })
                }
                Response::Progress { .. } => {}
                Response::Error { code } => {
                    return Err(if code.starts_with("file-search:") && code.len() < 80 {
                        code
                    } else {
                        "file-search:protocol".into()
                    })
                }
                _ => return Err("file-search:protocol".into()),
            }
        }
    }
    pub fn changes(
        &mut self,
        drive: u8,
        checkpoint: &Checkpoint,
        roots: &[PathBuf],
        mut receive: impl FnMut(Change) -> Result<(), String>,
    ) -> Result<Option<Checkpoint>, String> {
        if super::server::volume_serial(drive)? != checkpoint.serial {
            return Ok(None);
        }
        let (Some(id), Some(usn)) = (checkpoint.journal_id, checkpoint.next_usn) else {
            return Ok(None);
        };
        protocol::write_frame(
            &mut self.pipe,
            &Request::Journal {
                drive: (drive as char).to_string(),
                id,
                usn,
                roots: super::scope::encode(roots),
                policy: self.policy.clone(),
            },
        )?;
        loop {
            match protocol::read_frame::<Response>(&mut self.pipe)? {
                Response::Files { items } => {
                    if items.len() > 512 {
                        return Err("file-search:protocol".into());
                    }
                    for item in items {
                        let deleted = item.deleted;
                        let directory = item.directory;
                        let entry = decode(item, drive)?;
                        receive(if deleted {
                            Change::Removed(entry.path.to_path_buf())
                        } else if directory {
                            Change::Directory(entry.path.to_path_buf())
                        } else {
                            Change::File(entry)
                        })?;
                    }
                }
                Response::Done {
                    serial,
                    journal_id,
                    next_usn,
                } => {
                    return Ok(Some(Checkpoint {
                        serial,
                        journal_id,
                        next_usn,
                    }))
                }
                Response::Rescan { reason } => {
                    #[cfg(test)]
                    eprintln!("NTFS replay requires rescan: {reason:?}");
                    #[cfg(not(test))]
                    let _ = reason;
                    return Ok(None);
                }
                Response::Progress { .. } => {}
                Response::Error { code } => {
                    return Err(if code.starts_with("file-search:") && code.len() < 80 {
                        code
                    } else {
                        "file-search:protocol".into()
                    })
                }
                _ => return Err("file-search:protocol".into()),
            }
        }
    }
}
fn decode(item: Metadata, drive: u8) -> Result<Entry, String> {
    use std::os::windows::ffi::OsStringExt;
    if item.path.len() > 90000 {
        return Err("file-search:protocol".into());
    }
    let bytes = STANDARD
        .decode(&item.path)
        .map_err(|_| "file-search:protocol")?;
    if bytes.len() > 65534 || bytes.len() % 2 != 0 {
        return Err("file-search:protocol".into());
    }
    let units = bytes
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect::<Vec<_>>();
    if units.contains(&0) {
        return Err("file-search:protocol".into());
    }
    let path = PathBuf::from(std::ffi::OsString::from_wide(&units));
    let prefix = matches!(path.components().next(),Some(Component::Prefix(p))if matches!(p.kind(),Prefix::VerbatimDisk(d)|Prefix::Disk(d) if d.to_ascii_uppercase()==drive));
    if !prefix
        || !path.is_absolute()
        || path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err("file-search:protocol".into());
    }
    let name = path
        .file_name()
        .ok_or("file-search:protocol")?
        .to_string_lossy()
        .into_owned();
    let parent = path
        .parent()
        .ok_or("file-search:protocol")?
        .to_string_lossy()
        .into_owned();
    Ok(Entry {
        id: 0,
        path: path.into(),
        extension: extension(&name),
        name,
        parent: parent.into(),
        size: item.size,
        modified: item.modified,
        verified: true,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn item(path: &str) -> Metadata {
        Metadata {
            path: STANDARD.encode(
                path.encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            ),
            size: Some(5),
            modified: None,
            deleted: false,
            directory: false,
        }
    }
    #[test]
    fn pipe_paths_cannot_escape_the_requested_volume() {
        assert!(decode(item("\\\\?\\C:\\folder\\合同.pdf"), b'C').is_ok());
        for path in [
            "D:\\secret.txt",
            "C:\\folder\\..\\secret.txt",
            "relative.txt",
            "C:\\bad\0x",
        ] {
            assert!(decode(item(path), b'C').is_err());
        }
    }
}
