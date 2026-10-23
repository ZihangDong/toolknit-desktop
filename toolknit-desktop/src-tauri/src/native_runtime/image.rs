use super::*;

// Image commands are divided by operation family. The parent re-exports are
// the only compatibility surface used by Tauri, CLI helpers and sibling domains.
pub(super) mod basic {
    use super::*;
    include!("image/basic.rs");
}
pub(super) use basic::*;
pub(super) mod stitch {
    use super::*;
    include!("image/stitch.rs");
}
pub(super) use stitch::*;
pub(super) mod pdf_tools {
    use super::*;
    include!("image/pdf.rs");
}
pub(super) use pdf_tools::*;
#[cfg(test)]
mod pdf_tests {
    use super::*;
    include!("image/pdf_tests.rs");
}
#[cfg(test)]
mod conversion_tests {
    use super::*;
    include!("image/conversion_tests.rs");
}
pub(super) mod image_ops {
    use super::*;
    include!("image/image_ops.rs");
}
pub(super) use image_ops::*;
pub(super) mod color_crypto {
    use super::*;
    include!("image/color_crypto.rs");
}
pub(super) use color_crypto::*;
pub(super) mod compression {
    use super::*;
    include!("image/compression.rs");
}
pub(super) use compression::*;
#[path = "image/image_pdf.rs"]
pub(super) mod image_pdf;
pub(super) use image_pdf::*;
