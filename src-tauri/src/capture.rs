use crate::database::cleanup;
use crate::models::State;
use crate::privacy::contains_sensitive;
use crate::state::{db, now, prefs};
use active_win_pos_rs::get_active_window;
use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContext, ClipboardHandler};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(crate) struct Handler {
    pub(crate) app: AppHandle,
    pub(crate) state: Arc<State>,
    pub(crate) ctx: ClipboardContext,
}

fn read_image_png(ctx: &ClipboardContext) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    if let Ok(bytes) = ctx.get_buffer("public.png") {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Some(bytes);
        }
    }
    ctx.get_image()
        .ok()
        .and_then(|image| image.to_png().ok().map(|png| png.get_bytes().to_vec()))
}
#[cfg(target_os = "macos")]
pub(crate) fn frontmost_source() -> Option<(String, String)> {
    use objc2_app_kit::NSWorkspace;
    let application = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    if application.processIdentifier() == std::process::id() as i32 {
        return None;
    }
    let name = application
        .localizedName()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let path = application
        .bundleURL()
        .or_else(|| application.executableURL())
        .and_then(|url| url.path())
        .map(|value| value.to_string())
        .unwrap_or_default();
    Some((name, path))
}
pub(crate) fn source_is_excluded(excluded: &[String], name: &str, path: &str) -> bool {
    excluded.iter().any(|entry| {
        if entry.eq_ignore_ascii_case(name) || entry.eq_ignore_ascii_case(path) {
            return true;
        }
        let entry_lower = entry.to_lowercase();
        let path_lower = path.to_lowercase();
        entry_lower.ends_with(".app")
            && path_lower
                .strip_prefix(&entry_lower)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}
impl ClipboardHandler for Handler {
    fn on_clipboard_change(&mut self) {
        if !self.state.listening.load(Ordering::SeqCst) {
            return;
        }
        if self.state.suppress_next.swap(false, Ordering::SeqCst) {
            return;
        }
        let Ok(p) = prefs(&self.state) else { return };
        let source = get_active_window().ok();
        let mut app_name = source
            .as_ref()
            .map(|w| w.app_name.clone())
            .unwrap_or_default();
        let mut path = source
            .as_ref()
            .map(|w| w.process_path.to_string_lossy().to_string())
            .unwrap_or_default();
        #[cfg(target_os = "macos")]
        if app_name.is_empty() || path.is_empty() {
            if let Some((name, bundle)) = frontmost_source() {
                if app_name.is_empty() {
                    app_name = name;
                }
                if path.is_empty() {
                    path = bundle;
                }
            }
        }
        if !p.excluded_apps.is_empty() && app_name.is_empty() && path.is_empty() {
            return;
        }
        if source_is_excluded(&p.excluded_apps, &app_name, &path) {
            return;
        }
        let files = if p.capture_files {
            self.ctx.get_files().unwrap_or_default()
        } else {
            vec![]
        };
        let html = if p.capture_rich {
            self.ctx.get_html().ok().filter(|v| !v.is_empty())
        } else {
            None
        };
        let rtf = if p.capture_rich {
            self.ctx.get_rich_text().ok().filter(|v| !v.is_empty())
        } else {
            None
        };
        let text = if p.capture_text || p.capture_rich {
            self.ctx.get_text().unwrap_or_default()
        } else {
            String::new()
        };
        let image = if p.capture_image && files.is_empty() {
            read_image_png(&self.ctx)
        } else {
            None
        };
        let (kind, title) = if !files.is_empty() {
            ("files", format!("{} 个文件", files.len()))
        } else if image.is_some() {
            ("image", "图片".into())
        } else if html.is_some() || rtf.is_some() {
            ("rich", title(&text, "富文本"))
        } else if !text.is_empty() && p.capture_text {
            ("text", title(&text, "纯文本"))
        } else {
            return;
        };
        if p.sensitive_action == "skip"
            && contains_sensitive(&text, html.as_deref(), rtf.as_deref(), &files)
        {
            return;
        }
        let mut hash = Sha256::new();
        hash.update(kind.as_bytes());
        hash.update(text.as_bytes());
        if let Some(v) = &html {
            hash.update(v.as_bytes())
        }
        if let Some(v) = &rtf {
            hash.update(v.as_bytes())
        }
        for v in &files {
            hash.update(v.as_bytes())
        }
        if let Some(v) = &image {
            hash.update(v)
        }
        let fingerprint = hex::encode(hash.finalize());
        let Ok(c) = db(&self.state) else { return };
        let last: Option<String> = c
            .query_row(
                "SELECT fingerprint FROM clips ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if last.as_deref() == Some(&fingerprint) {
            return;
        }
        let captured_at = now();
        if c.execute("INSERT INTO clips(kind,title,plain_text,html,rtf,files_json,image_data,source_app,source_path,fingerprint,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![kind,title,text,html,rtf,serde_json::to_string(&files).unwrap_or_default(),image,app_name,path,fingerprint,captured_at,captured_at]).is_err(){return}
        drop(c);
        let _ = cleanup(&self.state);
        let _ = self.app.emit("clips-changed", ());
    }
}
pub(crate) fn title(text: &str, fallback: &str) -> String {
    text.lines()
        .find(|v| !v.trim().is_empty())
        .unwrap_or(fallback)
        .trim()
        .chars()
        .take(70)
        .collect()
}
