//! Safe metadata adapter around the audited WinShun MFT reader.
#![cfg(windows)]
use std::{
    ffi::c_void,
    panic::{catch_unwind, AssertUnwindSafe},
    slice,
};

#[repr(C)]
struct NativeRecord {
    number: u32,
    base: u32,
    parent: u64,
    name: *const u16,
    name_length: usize,
    size: u64,
    modified: i64,
    attributes: u32,
    directory: bool,
    size_known: bool,
    attribute_list: bool,
}
#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub(super) struct Journal {
    pub id: u64,
    pub first: i64,
    pub next: i64,
}
unsafe extern "C" {
    fn tk_ntfs_scan(
        drive: i8,
        context: *mut c_void,
        receive: extern "C" fn(*mut c_void, *const NativeRecord) -> bool,
        cancelled: extern "C" fn(*mut c_void) -> bool,
    ) -> i32;
    fn tk_ntfs_journal(drive: i8, out: *mut Journal) -> bool;
}
#[derive(Debug)]
pub(super) struct Record<'a> {
    pub number: u32,
    pub base: u32,
    pub parent: u64,
    pub name: &'a [u16],
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub attributes: u32,
    pub directory: bool,
    pub attribute_list: bool,
}
struct Context<'a> {
    receive: &'a mut dyn FnMut(Record<'_>) -> bool,
    cancelled: &'a dyn Fn() -> bool,
    failed: bool,
}
extern "C" fn receive(context: *mut c_void, record: *const NativeRecord) -> bool {
    // Both pointers originate synchronously in scan. The name is borrowed only
    // for this callback; upstream may reuse its record buffer immediately after.
    let context = unsafe { &mut *(context as *mut Context<'_>) };
    let result = catch_unwind(AssertUnwindSafe(|| {
        let Some(r) = (unsafe { record.as_ref() }) else {
            return false;
        };
        if r.name_length > 255 || (r.name.is_null() && r.name_length != 0) {
            return false;
        }
        let name = if r.name_length == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(r.name, r.name_length) }
        };
        (context.receive)(Record {
            number: r.number,
            base: r.base,
            parent: r.parent,
            name,
            size: r.size_known.then_some(r.size),
            modified: r
                .modified
                .checked_sub(116444736000000000)
                .and_then(|v| u64::try_from(v / 10_000_000).ok()),
            attributes: r.attributes,
            directory: r.directory,
            attribute_list: r.attribute_list,
        })
    }));
    match result {
        Ok(value) => value,
        Err(_) => {
            context.failed = true;
            false
        }
    }
}
extern "C" fn cancelled(context: *mut c_void) -> bool {
    let context = unsafe { &mut *(context as *mut Context<'_>) };
    catch_unwind(AssertUnwindSafe(|| context.failed || (context.cancelled)())).unwrap_or(true)
}
pub(super) fn scan(
    drive: u8,
    callback: &mut dyn FnMut(Record<'_>) -> bool,
    stop: &dyn Fn() -> bool,
) -> Result<(), String> {
    if !drive.is_ascii_uppercase() {
        return Err("file-search:volume".into());
    }
    let mut context = Context {
        receive: callback,
        cancelled: stop,
        failed: false,
    };
    match unsafe {
        tk_ntfs_scan(
            drive as i8,
            (&mut context as *mut Context<'_>).cast(),
            receive,
            cancelled,
        )
    } {
        0 => Ok(()),
        1 => Err("file-search:cancelled".into()),
        -2 => Err("file-search:volume-access".into()),
        _ => Err("file-search:volume-read".into()),
    }
}
pub(super) fn journal(drive: u8) -> Option<Journal> {
    if !drive.is_ascii_uppercase() {
        return None;
    }
    let mut out = Journal::default();
    unsafe { tk_ntfs_journal(drive as i8, &mut out) }.then_some(out)
}

#[repr(C)]
struct NativeChange {
    file: u64,
    parent: u64,
    name: *const u16,
    name_length: usize,
    reason: u32,
    attributes: u32,
}
pub(super) struct Change<'a> {
    pub file: u64,
    pub parent: u64,
    pub name: &'a [u16],
    pub reason: u32,
    pub attributes: u32,
}
struct Changes<'a> {
    receive: &'a mut dyn FnMut(Change<'_>) -> bool,
    stop: &'a dyn Fn() -> bool,
}
unsafe extern "C" {
    fn tk_ntfs_changes(
        drive: i8,
        journal_id: u64,
        start: i64,
        target: i64,
        context: *mut c_void,
        receive: extern "C" fn(*mut c_void, *const NativeChange) -> bool,
        cancelled: extern "C" fn(*mut c_void) -> bool,
        end: *mut i64,
    ) -> i32;
}
extern "C" fn changed(context: *mut c_void, record: *const NativeChange) -> bool {
    let context = unsafe { &mut *(context as *mut Changes<'_>) };
    catch_unwind(AssertUnwindSafe(|| {
        let Some(record) = (unsafe { record.as_ref() }) else {
            return false;
        };
        if record.name.is_null() || record.name_length == 0 || record.name_length > 255 {
            return false;
        }
        (context.receive)(Change {
            file: record.file,
            parent: record.parent,
            name: unsafe { slice::from_raw_parts(record.name, record.name_length) },
            reason: record.reason,
            attributes: record.attributes,
        })
    }))
    .unwrap_or(false)
}
extern "C" fn change_stop(context: *mut c_void) -> bool {
    let context = unsafe { &*(context as *mut Changes<'_>) };
    catch_unwind(AssertUnwindSafe(|| (context.stop)())).unwrap_or(true)
}
pub(super) fn changes(
    drive: u8,
    journal: u64,
    start: i64,
    target: i64,
    receive: &mut dyn FnMut(Change<'_>) -> bool,
    stop: &dyn Fn() -> bool,
) -> Result<i64, String> {
    if !drive.is_ascii_uppercase() || start < 0 || target < start {
        return Err("file-search:journal".into());
    }
    let mut context = Changes { receive, stop };
    let mut end = start;
    match unsafe {
        tk_ntfs_changes(
            drive as i8,
            journal,
            start,
            target,
            (&mut context as *mut Changes<'_>).cast(),
            changed,
            change_stop,
            &mut end,
        )
    } {
        0 => Ok(end),
        1 => Err("file-search:cancelled".into()),
        _ => Err("file-search:journal".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_volume_never_opens_a_device() {
        let mut called = false;
        assert!(scan(
            b'/',
            &mut |_| {
                called = true;
                true
            },
            &|| false
        )
        .is_err());
        assert!(!called);
        assert!(journal(b'0').is_none());
    }
}
