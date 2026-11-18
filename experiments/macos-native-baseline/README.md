# macOS native comparison harness

Experimental, macOS-only release-mode Rust + AppKit window. Not a replacement for CPaste.
No WebView. Opens the existing database with `SQLITE_OPEN_READ_ONLY`; never listens to,
changes, or pastes clipboard data. Does not change the installed application.

Build: `cargo build --release --offline --manifest-path experiments/macos-native-baseline/Cargo.toml`
Run the resulting `target/release/cpaste-native-bench` executable in a GUI session.

- Control + Option + Shift + V: show/hide the native window.
- Escape: hide. Control + Option + Shift + Q: quit.
- Uses current text metadata and sensitive-content masking, up to 300 displayed rows.
- Search lazily loads the downloaded Jieba dictionary when enabled.
- No image thumbnails, previews, capture, editing, paste, settings, or background cleanup.

Compare memory only with the workload and missing features explicitly stated. This
harness cannot establish the memory, latency, or energy use of a full native port.
Measurements and local content stay in the ignored `.private/performance/` directory.
