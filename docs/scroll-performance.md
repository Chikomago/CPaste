> 当前实现已改为内容寻址文件与 300px 缩略图；下文旧测量仅作历史基线。当前布局见 [存储说明](storage.md)。

# Mixed-list scrolling optimization

## Changes

The picker now virtualizes both pinned and regular lists. Only the viewport plus
three rows of overscan are mounted. Normal panels measure variable row heights;
side panels virtualize rows of one or two square cards; top/bottom panels
virtualize a horizontal row. Keyboard navigation scrolls to an index before its
card is mounted. The existing 300-result limit is unchanged.

Thumbnail requests are deduplicated and limited to two in flight. Queued requests
whose consumers have unmounted are skipped. Resolved base64 strings use an LRU
budget of 64 entries or 8 MiB (conservatively counted as two bytes per code unit).
This budget covers cached strings, not total application or GPU memory. Images
use asynchronous decoding. A masking change clears an already displayed image.

## Verification

`pnpm test:scroll` checks all five layouts against 300 synthetic mixed records,
keyboard access to the last record, position reset on search changes, request
concurrency/cancellation/deduplication, LRU eviction, byte budget and retries.
At the test viewport, 8–12 cards mount instead of 300. The DOM test uses simulated
geometry; it does not measure rendering FPS.

`pnpm test:segmentation` and `pnpm build` also pass.

A local browser fixture using the actual virtual-list component and card CSS
verified variable image/text heights, pinned separation, square side cards and
horizontal navigation. In synthetic five-second scroll runs, the original and
virtualized lists both had roughly 16.7ms median frame intervals. One horizontal
virtualized run recorded a 483.4ms outlier; a repeat recorded 17.7ms maximum.
The cause of that outlier was not isolated. These small synthetic browser tests
do not establish a macOS WKWebView FPS improvement with real clipboard data.

The updated macOS development app is the next validation surface. Check fast
scrolling through real images/rich text in both directions, keyboard selection,
pinned records, image loading and preview. Production installation is unchanged.
Raw fixtures and measurements remain in ignored `.private/performance/`.

## Thumbnail follow-up

Virtual card remounts now read cached images synchronously instead of first
painting a placeholder. Already-started requests retain their completed result
within the existing memory budget, even if the card left the viewport. Queued,
not-yet-started off-screen requests still cancel.

The development build's unoptimized image processing was a separate bottleneck.
An explicit benchmark calls the real thumbnail function with a synthetic
3000×2000 PNG. One before/after run measured 4022.6ms versus 327.0ms after enabling
optimization for image/PNG processing dependencies in the dev profile. Resolution
(768×512 in this case) and Lanczos3 filtering are unchanged. This is thumbnail
processing time, excluding capture, database/queue waits, IPC and display.
Release builds already optimize these dependencies; this dev-profile speedup
must not be presented as a corresponding release-build improvement.

Run the benchmark explicitly:
`cargo test --manifest-path src-tauri/Cargo.toml --lib benchmark_large_image_thumbnail -- --ignored --nocapture`

The scroll test suite now also verifies that cached images exist in the very
first render after remount, masking hides them, and completed off-screen work is
reused.

## Reopen caching

Observed debug logs showed 67 thumbnail requests totaling about 20 MiB of base64
between two opening markers during scrolling. This exceeded the 8 MiB frontend
budget. Thumbnail generation now also has a persistent SQLite cache capped at
64 MiB. Cache eviction removes derived thumbnails, never clipboard history.
Deletion and original-image changes invalidate associated cached thumbnails via
SQLite triggers. Legacy backup restoration recreates cache schema/triggers.
Privacy is checked before serving a disk-cached thumbnail.

Original preview images now use a separate, bounded 32 MiB / four-entry memory
cache. Ordinary panel preview metadata is seeded from the current list so a
cached image does not wait for the metadata round trip before mounting. Cached
originals are shown on the first render after reopen. Originals larger than the
budget or evicted originals still need a fresh read; this is not a promise that
all images remain resident indefinitely.

Six frontend scroll/media tests, 28 Rust tests and the production frontend build
pass. Tests cover cache reuse on reopen, persisted thumbnails across SQLite
connections, deletion/image-change invalidation, eviction without losing history,
and an IPC regression that corrupts the original after populating cache to prove
that the actual command reuses the cached PNG. That IPC test also checks current
sensitive-content masking. Temporary reopening diagnostics have been removed.

## Preserving image elements while hidden

Caching encoded bytes does not by itself preserve an image element. A regression
fixture reproduced a second path: a zero-sized viewport notification caused the
virtual list to unmount its current images. The hide/reopen identity test failed
before the change and now passes. The list ignores transient zero-sized viewport,
scroll-offset and row measurements, preserving its last visible range. This
fixture does not establish that every macOS panel hide produces zero dimensions.

The side preview previously conditionally unmounted when closed. Both preview
surfaces now keep the last committed preview child hidden while closed/loading,
so reopening the same image reuses the element rather than replacing it. Only
one preview child is retained; switching records still replaces that child.
The eight frontend tests now include element-identity checks for small and large
images across hide/reopen. Actual macOS visual behavior still needs user
confirmation; first-time image loading remains necessary.

## Sidebar list-height invalidation

A regression test reproduced a concrete list flash mechanism: changing the
normal list viewport width by one pixel cleared measured row heights, changing
the total list height from 30629px to 30893px in the fixture. The list no longer
resets all measurements for width notifications in normal mode; individual row
ResizeObservers still handle genuine text-wrapping changes. Fixed-size edge
cards continue invalidating measurements when their actual size changes.

The shared picker outline now paints without consuming layout space. The main
pane retains its original transparent border allocation while details are
expanded. Browser inspection, including fractional pixel rounding, confirmed
identical client widths before/after expansion, aligned header dividers and the
delete action at the toolbar's far right. Ten frontend tests pass. This proves
the specific layout/measurement regression, not every possible native paint
artifact.

## Pin/favorite response

Previously a successful flag toggle emitted a generic history-change event and
also explicitly refreshed history in its caller, causing two list reads. Toggle
commands now return the committed boolean and emit a targeted flag patch. The
picker updates the flag immediately and saves in the background, merging pending
flags over older refresh snapshots. Failed saves restore the previous value;
matching event/response confirmations retain state identity. Sidebar flags use
the current list state rather than waiting for preview metadata to reload.

A browser fixture with a deliberate one-second save delay confirmed that pin
and favorite `aria-pressed` states change while the save is still pending. Twelve
frontend tests and 29 Rust tests pass, including rollback, stale-refresh overlay,
no duplicate state update on confirmation, and exact IPC response/event values.
