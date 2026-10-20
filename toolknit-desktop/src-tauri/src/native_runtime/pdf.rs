use super::*;

// PDF security, compression, audio conversion and cancellation each own their
// command handlers while sharing the parent runtime helpers.
pub(super) mod decrypt {
    use super::*;
    include!("pdf/decrypt.rs");
}
pub(super) use decrypt::*;
pub(super) mod encrypt {
    use super::*;
    include!("pdf/encrypt.rs");
}
pub(super) use encrypt::*;
pub(super) mod compress {
    use super::*;
    include!("pdf/compress.rs");
}
pub(super) use compress::*;
pub(super) mod compress_write {
    use super::*;
    include!("pdf/compress_write.rs");
}
pub(super) use compress_write::*;
pub(super) mod docx_write {
    use super::*;
    include!("pdf/docx_write.rs");
}
pub(super) use docx_write::*;
pub(super) mod audio_convert {
    use super::*;
    include!("pdf/audio_convert.rs");
}
pub(super) use audio_convert::*;
pub(super) mod audio_clip {
    use super::*;
    include!("pdf/audio_clip.rs");
}
pub(super) use audio_clip::*;
pub(super) mod cancel {
    use super::*;
    include!("pdf/cancel.rs");
}
pub(super) use cancel::*;
