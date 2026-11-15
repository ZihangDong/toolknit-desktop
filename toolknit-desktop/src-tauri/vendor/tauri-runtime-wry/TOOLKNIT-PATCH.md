# ToolKnit runtime ownership patch

Upstream: `tauri-runtime-wry` 2.12.1 from crates.io, Tauri commit
`30da1fd6e17de6107ecc850c95dfb16b5729f2dd`. Original MIT and Apache-2.0
licenses are included. This directory is selected by `[patch.crates-io]`.

`Context` is marked Send/Sync and cloned from worker threads. Its Windows
`DispatcherMainThreadContext.window_target` contains Tao 0.37.1's
`Rc<EventLoopRunner>`. Derived Context cloning therefore races its non-atomic
reference count, even though actual dispatcher access checks the GUI thread.

The patch shares the dispatcher via `Arc`, leaving thread checks and dispatch
unchanged. Fields extracted in `make_event_handler` are explicitly cloned
instead of moved out (including optional tracing). No new unsafe trait implementation or cross-thread
dispatcher access is introduced. The event loop retains dispatcher ownership
while running.

The regression is the real isolated WebView2 test in
`native_runtime/file_search/native_frame_tests.rs`: concurrent public window
handle clone/drop plus 100 filter/collapse cycles and window recreation. Run
both debug and release. The unpatched dependency repeatedly corrupted the heap
or aborted in Rc on a Tokio worker; the patched debug test completed.

When updating Tauri/Tao, check upstream ownership and repeat that regression.
Remove the local patch once an equivalent upstream fix is verified. Do not
edit the Cargo registry cache or silently substitute a different version.
