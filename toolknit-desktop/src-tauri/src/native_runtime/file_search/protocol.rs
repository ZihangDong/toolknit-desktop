//! Bounded local-only service messages. File contents and arbitrary commands
//! have no representation in this protocol.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

pub(super) const VERSION: u32 = 4;
pub(super) const MAX_FRAME: usize = 512 * 1024;
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum Request {
    Hello {
        version: u32,
        process: u32,
        nonce: String,
    },
    Scan {
        drive: String,
        roots: Vec<String>,
        #[serde(default)]
        policy: Option<super::scope_policy::Spec>,
    },
    Journal {
        drive: String,
        id: u64,
        usn: i64,
        roots: Vec<String>,
        #[serde(default)]
        policy: Option<super::scope_policy::Spec>,
    },
    Stop,
}
impl Request {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Hello {
                version,
                process,
                nonce,
            } if *version == VERSION
                && *process > 0
                && nonce.len() == 32
                && nonce.bytes().all(|c| c.is_ascii_hexdigit()) =>
            {
                Ok(())
            }
            Self::Scan { drive, roots, policy } | Self::Journal { drive, roots, policy, .. }
                if drive.len() == 1
                    && drive.as_bytes()[0].is_ascii_uppercase()
                    && !roots.is_empty()
                    && roots.len() <= 32
                    && roots.iter().all(|r| r.len() <= 90000)
                    && roots.iter().map(String::len).sum::<usize>() <= 256 * 1024 =>
            {
                super::scope_policy::Policy::from_spec(policy.clone()).map(|_| ())
            }
            Self::Stop => Ok(()),
            _ => Err("file-search:protocol".into()),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Metadata {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub deleted: bool,
    pub directory: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum Response {
    Ready {
        version: u32,
        nonce: String,
    },
    Files {
        items: Vec<Metadata>,
    },
    Progress {
        records: u64,
    },
    Done {
        serial: u32,
        journal_id: Option<u64>,
        next_usn: Option<i64>,
    },
    Rescan {
        reason: RescanReason,
    },
    Error {
        code: String,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum RescanReason {
    JournalUnavailable,
    JournalExpired,
    JournalRead,
    MetadataChanged,
    ParentUnavailable,
    AccessChanged,
    PathInvalid,
    MetadataUnavailable,
    DirectoryHistoryLimit,
}
pub(super) fn write_frame<T: Serialize>(writer: &mut impl Write, value: &T) -> Result<(), String> {
    let data = serde_json::to_vec(value).map_err(|_| "file-search:protocol")?;
    if data.is_empty() || data.len() > MAX_FRAME {
        return Err("file-search:protocol".into());
    }
    writer
        .write_all(&(data.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&data))
        .and_then(|_| writer.flush())
        .map_err(|_| "file-search:service-disconnected".into())
}
pub(super) fn read_frame<T: serde::de::DeserializeOwned>(
    reader: &mut impl Read,
) -> Result<T, String> {
    let mut size = [0u8; 4];
    reader
        .read_exact(&mut size)
        .map_err(|_| "file-search:service-disconnected")?;
    let size = u32::from_le_bytes(size) as usize;
    if size == 0 || size > MAX_FRAME {
        return Err("file-search:protocol".into());
    }
    let mut data = vec![0; size];
    reader
        .read_exact(&mut data)
        .map_err(|_| "file-search:service-disconnected")?;
    serde_json::from_slice(&data).map_err(|_| "file-search:protocol".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_protocol_rejects_truncation_unknown_actions_and_paths() {
        let request = Request::Hello {
            version: VERSION,
            process: 7,
            nonce: "0123456789abcdef0123456789abcdef".into(),
        };
        request.validate().unwrap();
        let mut wire = Vec::new();
        write_frame(&mut wire, &request).unwrap();
        read_frame::<Request>(&mut &wire[..])
            .unwrap()
            .validate()
            .unwrap();
        assert!(read_frame::<Request>(&mut &wire[..wire.len() - 1]).is_err());
        assert!(read_frame::<Request>(&mut &(MAX_FRAME as u32 + 1).to_le_bytes()[..]).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"kind":"execute","path":"x"}"#).is_err());
        for drive in ["C:", "/", "\\\\server", "a"] {
            assert!(Request::Scan {
                drive: drive.into(),
                roots: vec!["AA==".into()], policy: None,
            }
            .validate()
            .is_err());
        }
    }
}
