use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub entries: usize,
    pub depth: usize,
    pub duration: Duration,
    pub path_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            entries: 200_000,
            depth: 64,
            duration: Duration::from_secs(600),
            path_bytes: 64 * 1024 * 1024,
        }
    }
}
fn bytes_string<S: serde::Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Node {
    pub id: usize,
    pub parent: Option<usize>,
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    #[serde(serialize_with = "bytes_string")]
    pub bytes: u64,
    #[serde(serialize_with = "bytes_string")]
    pub logical_bytes: u64,
    pub files: u64,
    pub directories: u64,
    pub duplicate: bool,
    pub partial: bool,
    pub reason: Option<&'static str>,
    #[serde(skip)]
    pub children: Vec<usize>,
}
#[derive(Clone, Serialize)]
pub(super) struct Issue {
    pub path: String,
    pub reason: &'static str,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Summary {
    pub job_id: String,
    pub root: Node,
    pub files: u64,
    pub directories: u64,
    pub entries: usize,
    pub hard_links: u64,
    pub skipped: u64,
    pub issue_count: u64,
    pub issues: Vec<Issue>,
    pub cancelled: bool,
    pub partial: bool,
    pub limit_reason: Option<&'static str>,
    pub elapsed_ms: u128,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Progress {
    pub job_id: String,
    pub files: u64,
    pub directories: u64,
    pub entries: usize,
    #[serde(serialize_with = "bytes_string")]
    pub bytes: u64,
    pub skipped: u64,
    pub current_path: String,
    pub elapsed_ms: u128,
}
pub(super) struct Report {
    pub summary: Summary,
    pub nodes: Vec<Node>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct View {
    pub job_id: String,
    pub node: Node,
    pub breadcrumbs: Vec<Node>,
    pub items: Vec<Node>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub tiles: Vec<Node>,
    #[serde(serialize_with = "bytes_string")]
    pub other_bytes: u64,
    pub other_count: usize,
    pub zero_count: usize,
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
pub(super) fn excluded(meta: &fs::Metadata) -> Option<&'static str> {
    if meta.file_type().is_symlink() {
        return Some("link");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let flags = meta.file_attributes();
        if flags & 0x400 != 0 {
            return Some("link");
        }
        if flags & (0x1000 | 0x40000 | 0x400000) != 0 {
            return Some("offline");
        }
    }
    if !meta.is_dir() && !meta.is_file() {
        return Some("special");
    }
    None
}
pub(super) fn validate_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || display(path).contains('\0') || display(path).len() > 32760 {
        return Err("disk:root".into());
    }
    #[cfg(windows)]
    {
        use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDriveTypeW};
        let letter = match path.components().next() {
            Some(std::path::Component::Prefix(prefix)) => match prefix.kind() {
                std::path::Prefix::Disk(letter) | std::path::Prefix::VerbatimDisk(letter) => letter,
                _ => return Err("disk:root".into()),
            },
            _ => return Err("disk:root".into()),
        };
        let drive = format!("{}:\\\0", letter as char)
            .encode_utf16()
            .collect::<Vec<_>>();
        if ![2, 3].contains(&unsafe { GetDriveTypeW(PCWSTR(drive.as_ptr())) }) {
            return Err("disk:root".into());
        }
    }
    // Refuse explicit roots reached through a junction, symlink or cloud placeholder.
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|_| "disk:root")?;
        if excluded(&meta).is_some() {
            return Err("disk:root".into());
        }
    }
    let canonical = fs::canonicalize(path).map_err(|_| "disk:root")?;
    if !fs::symlink_metadata(&canonical)
        .map_err(|_| "disk:root")?
        .is_dir()
    {
        return Err("disk:root".into());
    }
    Ok(canonical)
}
type Identity = (u64, [u8; 16]);
fn identity(path: &Path, meta: &fs::Metadata) -> Result<Option<Identity>, &'static str> {
    #[cfg(windows)]
    {
        use std::{
            mem::size_of,
            os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
        };
        use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::*};
        let file = fs::OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode(7)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0 | FILE_FLAG_OPEN_NO_RECALL.0)
            .open(path)
            .map_err(|_| "identity")?;
        let handle = HANDLE(file.as_raw_handle() as isize);
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(handle, &mut info) }.map_err(|_| "identity")?;
        if info.dwFileAttributes & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0 {
            return Err("link");
        }
        let mut id = FILE_ID_INFO::default();
        if unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                (&mut id as *mut FILE_ID_INFO).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            )
        }
        .is_ok()
            && id.FileId.Identifier != [0; 16]
        {
            return Ok(Some((id.VolumeSerialNumber, id.FileId.Identifier)));
        }
        // Filesystems without stable IDs can safely count a known single-link file.
        if info.nNumberOfLinks == 1 {
            return Ok(None);
        }
        let _ = meta;
        return Err("identity");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let mut id = [0; 16];
        id[..8].copy_from_slice(&meta.ino().to_le_bytes());
        let _ = path;
        Ok(Some((meta.dev(), id)))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (path, meta);
        Err("identity")
    }
}
fn io_reason(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => "permission",
        std::io::ErrorKind::NotFound => "missing",
        _ => "read",
    }
}
fn new_node(path: &Path, parent: Option<usize>, id: usize, kind: &'static str) -> Node {
    Node {
        id,
        parent,
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| display(path)),
        path: display(path),
        kind,
        bytes: 0,
        logical_bytes: 0,
        files: 0,
        directories: 0,
        duplicate: false,
        partial: false,
        reason: None,
        children: Vec::new(),
    }
}
fn issue(report: &mut Report, id: usize, path: &Path, reason: &'static str) {
    report.nodes[id].partial = true;
    report.nodes[id].reason = Some(reason);
    report.summary.skipped += 1;
    report.summary.issue_count += 1;
    if report.summary.issues.len() < 100 {
        report.summary.issues.push(Issue {
            path: display(path),
            reason,
        });
    }
}

pub(super) fn scan(
    root: &Path,
    job_id: &str,
    cancel: &AtomicBool,
    limits: Limits,
    mut progress: impl FnMut(Progress),
) -> Result<Report, String> {
    let root = validate_root(root)?;
    let started = Instant::now();
    let root_node = new_node(&root, None, 0, "directory");
    let mut report = Report {
        summary: Summary {
            job_id: job_id.into(),
            root: root_node.clone(),
            files: 0,
            directories: 1,
            entries: 0,
            hard_links: 0,
            skipped: 0,
            issue_count: 0,
            issues: Vec::new(),
            cancelled: false,
            partial: false,
            limit_reason: None,
            elapsed_ms: 0,
        },
        nodes: vec![root_node],
    };
    let mut identities: HashMap<Identity, usize> = HashMap::new();
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut directories = 1u64;
    let mut stack = Vec::new();
    match fs::read_dir(&root) {
        Ok(entries) => stack.push((0usize, 0usize, entries)),
        Err(error) => issue(&mut report, 0, &root, io_reason(&error)),
    }
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut visited = 0usize;
    let mut path_bytes = display(&root).len();
    while !stack.is_empty() {
        if cancel.load(Ordering::Relaxed) {
            report.summary.cancelled = true;
            break;
        }
        if visited >= limits.entries || report.nodes.len() >= limits.entries {
            report.summary.limit_reason = Some("entries");
            break;
        }
        if started.elapsed() >= limits.duration {
            report.summary.limit_reason = Some("time");
            break;
        }
        let (parent, depth, entries) = stack.last_mut().unwrap();
        let parent = *parent;
        let depth = *depth;
        if last_progress.elapsed() >= Duration::from_millis(200) {
            progress(Progress {
                job_id: job_id.into(),
                files,
                directories,
                entries: visited,
                bytes,
                skipped: report.summary.skipped,
                current_path: report.nodes[parent].path.clone(),
                elapsed_ms: started.elapsed().as_millis(),
            });
            last_progress = Instant::now();
        }
        let entry = match entries.next() {
            Some(Ok(entry)) => entry,
            Some(Err(error)) => {
                visited += 1;
                let path = PathBuf::from(&report.nodes[parent].path);
                issue(&mut report, parent, &path, io_reason(&error));
                continue;
            }
            None => {
                stack.pop();
                continue;
            }
        };
        visited += 1;
        let path = entry.path();
        let entry_path_bytes = display(&path).len();
        if path_bytes.saturating_add(entry_path_bytes) > limits.path_bytes {
            report.summary.limit_reason = Some("memory");
            break;
        }
        path_bytes += entry_path_bytes;
        let id = report.nodes.len();
        report
            .nodes
            .push(new_node(&path, Some(parent), id, "skipped"));
        report.nodes[parent].children.push(id);
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) => {
                issue(&mut report, id, &path, io_reason(&error));
                continue;
            }
        };
        if let Some(reason) = excluded(&meta) {
            issue(&mut report, id, &path, reason);
            continue;
        }
        if meta.is_dir() {
            report.nodes[id].kind = "directory";
            directories += 1;
            if depth + 1 >= limits.depth {
                issue(&mut report, id, &path, "depth");
                report.summary.limit_reason.get_or_insert("depth");
                continue;
            }
            match fs::read_dir(&path) {
                Ok(entries) => stack.push((id, depth + 1, entries)),
                Err(error) => issue(&mut report, id, &path, io_reason(&error)),
            }
        } else {
            let key = match identity(&path, &meta) {
                Ok(key) => key,
                Err(reason) => {
                    issue(&mut report, id, &path, reason);
                    continue;
                }
            };
            let node = &mut report.nodes[id];
            node.kind = "file";
            node.logical_bytes = meta.len();
            node.bytes = meta.len();
            node.files = 1;
            files += 1;
            if let Some(first) = key.and_then(|key| identities.insert(key, id)) {
                report.summary.hard_links += 1;
                // Deterministic attribution even when directory enumeration order changes.
                let owner = if report.nodes[id].path < report.nodes[first].path {
                    id
                } else {
                    first
                };
                let alias = if owner == id { first } else { id };
                report.nodes[owner].bytes = report.nodes[first].bytes;
                report.nodes[owner].duplicate = false;
                report.nodes[alias].bytes = 0;
                report.nodes[alias].duplicate = true;
                if let Some(key) = key {
                    identities.insert(key, owner);
                }
            } else {
                bytes = bytes.checked_add(meta.len()).unwrap_or_else(|| {
                    report.summary.limit_reason = Some("overflow");
                    u64::MAX
                });
            }
        }
    }
    // Every unfinished ancestor is a lower bound after stopping or hitting a global limit.
    for (id, _, _) in &stack {
        report.nodes[*id].partial = true;
    }
    for id in (1..report.nodes.len()).rev() {
        let parent = report.nodes[id].parent.unwrap();
        let child = report.nodes[id].clone();
        let target = &mut report.nodes[parent];
        target.bytes = target.bytes.checked_add(child.bytes).unwrap_or_else(|| {
            report.summary.limit_reason = Some("overflow");
            u64::MAX
        });
        target.files += child.files;
        target.directories += child.directories + u64::from(child.kind == "directory");
        target.partial |= child.partial;
    }
    for id in 0..report.nodes.len() {
        let mut children = std::mem::take(&mut report.nodes[id].children);
        children.sort_unstable_by(|a, b| {
            report.nodes[*b]
                .bytes
                .cmp(&report.nodes[*a].bytes)
                .then_with(|| report.nodes[*a].name.cmp(&report.nodes[*b].name))
                .then_with(|| a.cmp(b))
        });
        report.nodes[id].children = children;
    }
    report.summary.files = report.nodes[0].files;
    report.summary.directories = report.nodes[0].directories + 1;
    report.summary.entries = visited;
    report.summary.elapsed_ms = started.elapsed().as_millis();
    report.summary.partial = report.summary.cancelled
        || report.summary.limit_reason.is_some()
        || report.summary.skipped > 0;
    report.nodes[0].partial |= report.summary.partial;
    report.summary.root = report.nodes[0].clone();
    Ok(report)
}
pub(super) fn view(
    report: &Report,
    node_id: usize,
    offset: usize,
    limit: usize,
) -> Result<View, String> {
    let node = report
        .nodes
        .get(node_id)
        .filter(|node| node.kind == "directory")
        .ok_or("disk:node")?;
    let limit = limit.clamp(1, 100);
    let offset = offset.min(node.children.len());
    let mut breadcrumbs = Vec::new();
    let mut parent = Some(node.id);
    while let Some(id) = parent {
        let node = &report.nodes[id];
        breadcrumbs.push(node.clone());
        parent = node.parent;
    }
    breadcrumbs.reverse();
    let positive = node
        .children
        .iter()
        .filter(|id| report.nodes[**id].bytes > 0)
        .copied()
        .collect::<Vec<_>>();
    let tiles = positive
        .iter()
        .take(60)
        .map(|id| report.nodes[*id].clone())
        .collect();
    let other_bytes = positive
        .iter()
        .skip(60)
        .fold(0u64, |sum, id| sum.saturating_add(report.nodes[*id].bytes));
    Ok(View {
        job_id: report.summary.job_id.clone(),
        node: node.clone(),
        breadcrumbs,
        items: node
            .children
            .iter()
            .skip(offset)
            .take(limit)
            .map(|id| report.nodes[*id].clone())
            .collect(),
        total: node.children.len(),
        offset,
        limit,
        tiles,
        other_bytes,
        other_count: positive.len().saturating_sub(60),
        zero_count: node.children.len() - positive.len(),
    })
}
