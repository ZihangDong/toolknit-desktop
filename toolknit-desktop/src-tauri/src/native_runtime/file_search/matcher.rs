//! Ownership-safe bounded FFI. The immutable matcher never borrows Rust inputs.
#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
mod native {
    use std::{ffi::c_void, ptr::NonNull};
    unsafe extern "C" {
        fn tk_search_matcher_create(text: *const u8, length: usize) -> *mut c_void;
        fn tk_search_matcher_destroy(value: *mut c_void);
        fn tk_search_match(value: *const c_void, text: *const u8, length: usize) -> u32;
        fn tk_search_literal(value: *const c_void, text: *const u8, length: usize) -> bool;
    }
    pub(crate) struct Matcher(NonNull<c_void>);
    impl Matcher {
        pub fn new(text: &str) -> Result<Self, String> {
            // Upstream copies the term; no Rust pointer survives the call.
            NonNull::new(unsafe { tk_search_matcher_create(text.as_ptr(), text.len()) })
                .map(Self)
                .ok_or_else(|| "file-search:query".into())
        }
        pub fn rank(&self, text: &str) -> Option<u32> {
            match unsafe { tk_search_match(self.0.as_ptr(), text.as_ptr(), text.len()) } {
                0 => None,
                rank => Some(rank),
            }
        }
        pub fn literal(&self, text: &str) -> bool {
            unsafe { tk_search_literal(self.0.as_ptr(), text.as_ptr(), text.len()) }
        }
    }
    impl Drop for Matcher {
        fn drop(&mut self) {
            unsafe { tk_search_matcher_destroy(self.0.as_ptr()) };
        }
    }
}
#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
pub(super) use native::Matcher;

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
pub(super) struct Matcher(String);
#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
impl Matcher {
    pub fn new(text: &str) -> Result<Self, String> {
        Ok(Self(text.to_ascii_lowercase()))
    }
    pub fn rank(&self, text: &str) -> Option<u32> {
        let name = text.to_ascii_lowercase();
        if name == self.0 {
            Some(1)
        } else {
            name.find(&self.0).map(|at| if at == 0 { 2 } else { 3 })
        }
    }
    pub fn literal(&self, text: &str) -> bool {
        text.to_ascii_lowercase().contains(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn literal_matching_is_bounded_and_case_insensitive() {
        for _ in 0..200 {
            let m = Matcher::new("合同").unwrap();
            assert_eq!(m.rank("合同"), Some(1));
            assert_eq!(m.rank("合同.pdf"), Some(2));
            assert_eq!(m.rank("装修合同.docx"), Some(3));
            assert_eq!(m.rank("报价"), None);
            assert_eq!(Matcher::new("PDF").unwrap().rank("x.pdf"), Some(3));
            assert_eq!(Matcher::new("🧵").unwrap().rank("🧵文件"), Some(2));
        }
    }
    #[test]
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    fn pinyin_matches_initials_full_and_mixed() {
        for term in ["ht", "hetong", "het", "htong"] {
            assert_eq!(
                Matcher::new(term).unwrap().rank("装修合同.docx"),
                Some(4),
                "{term}"
            );
        }
        assert_eq!(Matcher::new("zxht").unwrap().rank("装修合同.docx"), Some(4));
        assert_eq!(Matcher::new("123").unwrap().rank("记录123.txt"), Some(3));
    }
}
