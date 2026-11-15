use super::*;

// Office conversion keeps PPT, Excel and external-file actions independent.
// The re-export boundary preserves the existing Tauri command names.
pub(super) mod ppt {
    use super::*;
    include!("office/ppt.rs");
}
pub(super) use ppt::*;
mod probe;
pub(super) use probe::*;
pub(super) mod excel {
    use super::*;
    include!("office/excel.rs");
}
pub(super) use excel::*;
mod word;
pub(super) use word::*;
pub(super) mod files {
    #[cfg(test)]
    use super::*;
    include!("office/files.rs");
}
pub(super) use files::*;
