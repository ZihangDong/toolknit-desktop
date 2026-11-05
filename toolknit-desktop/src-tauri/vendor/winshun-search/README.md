# WinShun filename matching components

Source: https://github.com/LingCore/WinShun
Commit: `7e47148a8300bf019d969ad523ec8cbe3c7eae07` (2026-11-03 audit).

`Pinyin.h`, `Pinyin.cpp`, `PinyinTable.cpp`, `TextUtil.h`, and `TextUtil.cpp`
are unmodified upstream files from `src/core/`. Copyright 2026 LingCore,
MIT; see LICENSE. The generated pinyin table also uses mozillazg/pinyin-data,
copyright 2016 mozillazg, MIT; see pinyin-data-LICENSE.txt.

ToolKnit's separate `bridge.cpp` uses bounded string views and the non-padded
matcher. It never passes a Rust string to the SIMD function that reads past
the logical end. No Qt, UIAccess, clipboard, plugin or content-extraction code
is included. The upstream SSE2 implementation is built only on x86/x86_64;
other architectures retain literal filename search until separately validated.

On MSVC, these adapters use a static C++ runtime so the main executable and
copied service host do not require an external MSVCP140 DLL. Allocation and
destruction remain inside the C++ adapter; Rust only borrows callback data or
owns an opaque matcher released through its matching destructor. Validate the
actual Windows executable with `npm run test:native-loader` after building.

These third-party files retain MIT terms. ToolKnit's own licensing does not
replace or restrict the rights already granted by their authors.

`Ntfs.h` and `Ntfs.cpp` are from the same commit. ToolKnit changes
`queryJournal` to a read-only probe, removing `FSCTL_CREATE_USN_JOURNAL`,
and includes security changes in the journal reason mask so access changes
can invalidate metadata visibility.
The separate `ntfs-bridge.cpp` exports bounded metadata records and a read-only
journal probe. Journal replay stops at the caller's frozen USN endpoint;
records appended during the read are left for the next checkpoint. This keeps
the bounded directory-history and replay passes consistent. No bulk
content-reader implementation is included or exposed.
