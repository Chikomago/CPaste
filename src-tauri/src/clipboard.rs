use crate::capture::title;
use crate::models::{Preferences, State};
use crate::privacy::contains_sensitive;
use crate::state::{db, err, now, prefs};
use crate::windows::{activate_target, hide_picker_window, reveal_picker};
use active_win_pos_rs::get_active_window;
use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext, RustImageData};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub(crate) fn toggle_pin(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    db(&s)?
        .execute("UPDATE clips SET pinned=1-pinned WHERE id=?1", [id])
        .map_err(err)?;
    app.emit("clips-changed", ()).map_err(err)
}
#[tauri::command]
pub(crate) fn toggle_favorite(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    db(&s)?
        .execute("UPDATE clips SET favorite=1-favorite WHERE id=?1", [id])
        .map_err(err)?;
    app.emit("clips-changed", ()).map_err(err)
}
#[tauri::command]
pub(crate) fn delete_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    db(&s)?
        .execute("DELETE FROM clips WHERE id=?1", [id])
        .map_err(err)?;
    app.emit("clips-changed", serde_json::json!({ "deleted_id": id }))
        .map_err(err)
}
#[tauri::command]
pub(crate) fn clear_clips(app: AppHandle, s: tauri::State<Arc<State>>) -> Result<(), String> {
    db(&s)?.execute("DELETE FROM clips", []).map_err(err)?;
    app.emit("clips-changed", ()).map_err(err)
}
#[tauri::command]
pub(crate) fn edit_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
    content: String,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".into());
    }
    if content.len() > 1_000_000 {
        return Err("内容不能超过 1 MB".into());
    }
    let mask = prefs(&s)?.sensitive_action == "mask";
    let c = db(&s)?;
    let (kind, old_text, html, rtf, files_json): (
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    ) = c
        .query_row(
            "SELECT kind,plain_text,html,rtf,files_json FROM clips WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("记录已不存在")?;
    if kind != "text" && kind != "rich" {
        return Err("只有文本记录可以编辑".into());
    }
    if mask
        && contains_sensitive(
            &old_text,
            html.as_deref(),
            rtf.as_deref(),
            &serde_json::from_str::<Vec<String>>(&files_json).unwrap_or_default(),
        )
    {
        return Err("敏感内容已遮盖，无法编辑".into());
    }
    let mut hash = Sha256::new();
    hash.update(b"text");
    hash.update(content.as_bytes());
    let fingerprint = hex::encode(hash.finalize());
    c.execute("UPDATE clips SET kind='text',title=?1,plain_text=?2,html=NULL,rtf=NULL,fingerprint=?3,updated_at=?4 WHERE id=?5", params![title(&content, "纯文本"), content, fingerprint, now(), id]).map_err(err)?;
    drop(c);
    app.emit("clips-changed", ()).map_err(err)
}
pub(crate) fn mark_clip_used(app: &AppHandle, s: &State, id: i64) -> Result<(), String> {
    db(s)?
        .execute("UPDATE clips SET use_count=use_count+1 WHERE id=?1", [id])
        .map_err(err)?;
    app.emit("clips-changed", ()).map_err(err)
}
pub(crate) fn restore(s: &State, id: i64) -> Result<(), String> {
    let (kind, text, html, rtf, files, image): (
        String,
        String,
        Option<String>,
        Option<String>,
        Vec<String>,
        Option<Vec<u8>>,
    ) = db(s)?
        .query_row(
            "SELECT kind,plain_text,html,rtf,files_json,image_data FROM clips WHERE id=?1",
            [id],
            |r| {
                let f: String = r.get(4)?;
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    serde_json::from_str(&f).unwrap_or_default(),
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(err)?
        .ok_or("记录已不存在")?;
    let ctx = ClipboardContext::new().map_err(err)?;
    s.suppress_next.store(true, Ordering::SeqCst);
    let result = match kind.as_str() {
        "files" => ctx.set_files(files),
        "image" => {
            let image = RustImageData::from_bytes(&image.ok_or("图片数据不存在")?).map_err(err)?;
            ctx.set_image(image)
        }
        _ => {
            let mut formats = vec![ClipboardContent::Text(text)];
            if let Some(v) = html {
                formats.push(ClipboardContent::Html(v))
            }
            if let Some(v) = rtf {
                formats.push(ClipboardContent::Rtf(v))
            }
            ctx.set(formats)
        }
    };
    if result.is_err() {
        s.suppress_next.store(false, Ordering::SeqCst)
    }
    result.map_err(err)
}
pub(crate) fn restore_plain(s: &State, id: i64) -> Result<(), String> {
    let (kind, text, files): (String, String, String) = db(s)?
        .query_row(
            "SELECT kind,plain_text,files_json FROM clips WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("记录已不存在")?;
    let plain = if kind == "files" {
        serde_json::from_str::<Vec<String>>(&files)
            .unwrap_or_default()
            .join("\n")
    } else {
        text
    };
    if plain.is_empty() {
        return Err("这条记录没有可粘贴的文字".into());
    }
    write_plain_text(s, &plain)
}
fn write_plain_text(s: &State, plain: &str) -> Result<(), String> {
    let ctx = ClipboardContext::new().map_err(err)?;
    s.suppress_next.store(true, Ordering::SeqCst);
    let result = ctx.set_text(plain.to_owned());
    if result.is_err() {
        s.suppress_next.store(false, Ordering::SeqCst);
    }
    result.map_err(err)
}
#[tauri::command]
pub(crate) fn copy_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    let kind: String = db(&s)?
        .query_row("SELECT kind FROM clips WHERE id=?1", [id], |row| row.get(0))
        .map_err(err)?;
    let p = prefs(&s)?;
    let result = if should_copy_plain(&kind, &p, None) {
        restore_plain(&s, id)
    } else {
        restore(&s, id)
    };
    if result.is_ok() {
        let _ = mark_clip_used(&app, &s, id);
    }
    result
}
#[tauri::command]
pub(crate) fn copy_plain_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    let result = restore_plain(&s, id);
    if result.is_ok() {
        let _ = mark_clip_used(&app, &s, id);
    }
    result
}
#[tauri::command]
pub(crate) fn copy_original_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
) -> Result<(), String> {
    let result = restore(&s, id);
    if result.is_ok() {
        let _ = mark_clip_used(&app, &s, id);
    }
    result
}
pub(crate) fn should_copy_plain(kind: &str, p: &Preferences, override_plain: Option<bool>) -> bool {
    override_plain.unwrap_or(match kind {
        "files" => p.default_copy_file_paths,
        "text" | "rich" => p.default_plain_copy,
        _ => false,
    })
}
fn validate_fragment(s: &State, id: i64, text: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 1_000_000 {
        return Err("请选择词块，组合内容不能超过 1 MB".into());
    }
    let (kind, source, html, rtf): (String, String, Option<String>, Option<String>) = db(s)?
        .query_row(
            "SELECT kind,plain_text,html,rtf FROM clips WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("记录已不存在")?;
    if !["text", "rich"].contains(&kind.as_str()) {
        return Err("这条记录不支持分词".into());
    }
    if prefs(s)?.sensitive_action == "mask"
        && contains_sensitive(&source, html.as_deref(), rtf.as_deref(), &[])
    {
        return Err("敏感内容已遮盖，无法分词".into());
    }
    Ok(())
}

#[cfg(test)]
mod fragment_tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64},
        Mutex,
    };

    #[test]
    fn fragments_reject_masked_sources_and_leave_original_text_untouched() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,plain_text TEXT,html TEXT,rtf TEXT); INSERT INTO clips VALUES(1,'text','hello world',NULL,NULL),(2,'text','password=abcdef123456',NULL,NULL),(3,'image','',NULL,NULL);").unwrap();
        let state = State {
            db: Mutex::new(c),
            prefs: Mutex::new(Preferences::default()),
            suppress_next: AtomicBool::new(false),
            listening: AtomicBool::new(true),
            picker_pinned: AtomicBool::new(false),
            target_pid: AtomicU64::new(0),
            #[cfg(target_os = "windows")]
            target_hwnd: AtomicU64::new(0),
        };
        assert!(validate_fragment(&state, 1, "hello").is_ok());
        assert!(validate_fragment(&state, 1, " ").is_err());
        assert!(validate_fragment(&state, 2, "abcdef").is_err());
        assert!(validate_fragment(&state, 3, "image").is_err());
        assert!(validate_fragment(&state, 99, "missing").is_err());
        let original: String = db(&state)
            .unwrap()
            .query_row("SELECT plain_text FROM clips WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(original, "hello world");
    }
}
#[tauri::command]
pub(crate) fn paste_text_fragment(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
    text: String,
    edge: String,
) -> Result<String, String> {
    validate_fragment(&s, id, &text)?;
    paste_with_mode(app, &s, id, Some(true), &edge, Some(&text))
}
#[tauri::command]
pub(crate) fn paste_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
    edge: String,
) -> Result<String, String> {
    paste_with_mode(app, &s, id, None, &edge, None)
}
#[tauri::command]
pub(crate) fn paste_plain_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
    edge: String,
) -> Result<String, String> {
    paste_with_mode(app, &s, id, Some(true), &edge, None)
}
#[tauri::command]
pub(crate) fn paste_original_clip(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    id: i64,
    edge: String,
) -> Result<String, String> {
    paste_with_mode(app, &s, id, Some(false), &edge, None)
}
pub(crate) fn should_paste_plain(
    kind: &str,
    p: &Preferences,
    override_plain: Option<bool>,
) -> bool {
    override_plain.unwrap_or(match kind {
        "files" => p.default_file_paths,
        "text" | "rich" => p.default_plain_paste,
        _ => false,
    })
}
pub(crate) fn paste_with_mode(
    app: AppHandle,
    s: &State,
    id: i64,
    override_plain: Option<bool>,
    edge: &str,
    fragment: Option<&str>,
) -> Result<String, String> {
    let kind: String = db(s)?
        .query_row("SELECT kind FROM clips WHERE id=?1", [id], |row| row.get(0))
        .map_err(err)?;
    let preferences = prefs(s)?;
    let plain = should_paste_plain(&kind, &preferences, override_plain);
    if let Some(text) = fragment {
        write_plain_text(s, text)?;
    } else if plain {
        restore_plain(s, id)?;
    } else {
        restore(s, id)?;
    }
    let _ = mark_clip_used(&app, s, id);
    let target = s.target_pid.load(Ordering::SeqCst);
    if target == 0 {
        return Ok("copied".into());
    }
    hide_picker_window(&app)?;
    #[cfg(target_os = "windows")]
    let _ = activate_target(s, target);
    let deadline = Instant::now() + Duration::from_millis(900);
    let mut focused = false;
    while Instant::now() < deadline {
        if get_active_window()
            .ok()
            .is_some_and(|w| w.process_id == target)
        {
            focused = true;
            break;
        }
        thread::sleep(Duration::from_millis(35));
    }
    #[cfg(target_os = "macos")]
    if !focused {
        let _ = activate_target(s, target);
        while Instant::now() < deadline + Duration::from_millis(400) {
            if get_active_window()
                .ok()
                .is_some_and(|w| w.process_id == target)
            {
                focused = true;
                break;
            }
            thread::sleep(Duration::from_millis(35));
        }
    }
    if !focused {
        let _ = reveal_picker(app.clone(), edge.to_string());
        return Ok("copied".into());
    }
    thread::sleep(Duration::from_millis(65));
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(v) => v,
        Err(e) => {
            let _ = reveal_picker(app.clone(), edge.to_string());
            return Err(err(e));
        }
    };
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(target_os = "windows")]
    let modifier = Key::Control;
    let result = (|| {
        enigo.key(modifier, Direction::Press).map_err(err)?;
        let click = enigo.key(Key::Unicode('v'), Direction::Click);
        let release = enigo.key(modifier, Direction::Release);
        click.map_err(err)?;
        release.map_err(err)
    })();
    if result.is_err() || !preferences.close_after_paste {
        if result.is_ok() {
            thread::sleep(Duration::from_millis(250));
        }
        let _ = reveal_picker(app.clone(), edge.to_string());
    }
    result.map(|_| "pasted".into())
}
