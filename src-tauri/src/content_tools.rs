use crate::models::State;
use crate::privacy::contains_sensitive;
use crate::state::{db, err, prefs};
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub(crate) fn remove_external_preview<R: tauri::Runtime>(app: &AppHandle<R>, id: Option<i64>) {
    if let Ok(directory) = app.path().app_cache_dir() {
        let directory = directory.join("external-previews");
        if let Some(id) = id {
            if let Ok(files) = std::fs::read_dir(&directory) {
                for file in files.flatten() {
                    if file.path().file_stem().and_then(|value| value.to_str())
                        == Some(id.to_string().as_str())
                    {
                        let _ = std::fs::remove_file(file.path());
                    }
                }
            }
        } else {
            let _ = std::fs::remove_dir_all(directory);
        }
    }
}
pub(crate) fn remove_external_preview_scope<R: tauri::Runtime>(app: &AppHandle<R>, ids: &[i64]) {
    let ids: std::collections::HashSet<i64> = ids.iter().copied().collect();
    if let Ok(directory) = app.path().app_cache_dir() {
        if let Ok(files) = std::fs::read_dir(directory.join("external-previews")) {
            for file in files.flatten() {
                if file
                    .path()
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .and_then(|value| value.parse::<i64>().ok())
                    .is_some_and(|id| ids.contains(&id))
                {
                    let _ = std::fs::remove_file(file.path());
                }
            }
        }
    }
}
#[derive(Serialize, serde::Deserialize)]
pub(crate) struct TransformSource {
    pub(crate) text: String,
    pub(crate) html: Option<String>,
    pub(crate) rtf: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_transform_source(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<TransformSource, String> {
    let state = s.inner().clone();
    crate::background::run(move || transform_source(&state, id)).await
}
pub(crate) fn transform_source(state: &State, id: i64) -> Result<TransformSource, String> {
    let (kind, text, html, rtf): (String, String, Option<String>, Option<String>) = db(state)?
        .query_row(
            "SELECT kind,plain_text,html,rtf FROM clips WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("记录已不存在")?;
    if !["text", "rich"].contains(&kind.as_str()) {
        return Err("这条记录不支持文字工具".into());
    }
    if prefs(state)?.sensitive_action == "mask"
        && contains_sensitive(&text, html.as_deref(), rtf.as_deref(), &[])
    {
        return Err("敏感内容已遮盖，无法处理".into());
    }
    Ok(TransformSource { text, html, rtf })
}
pub(crate) fn write_result(s: &State, text: &str, html: Option<&str>) -> Result<(), String> {
    let ctx = ClipboardContext::new().map_err(err)?;
    let mut formats = vec![ClipboardContent::Text(text.to_owned())];
    if let Some(html) = html {
        formats.push(ClipboardContent::Html(html.to_owned()));
    }
    s.suppress_next.store(true, Ordering::SeqCst);
    let result = ctx.set(formats).map_err(err);
    if result.is_err() {
        s.suppress_next.store(false, Ordering::SeqCst);
    }
    result
}
pub(crate) fn write_image_file(
    path: &std::path::Path,
    bytes: &[u8],
    overwrite: bool,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    if overwrite {
        std::fs::write(path, bytes).map_err(err)
    } else {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(err)?
            .write_all(bytes)
            .map_err(err)
    }
}

#[tauri::command]
pub(crate) async fn save_image(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    id: i64,
    choose_path: Option<bool>,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    let extension = crate::background::run(move || {
        let bytes = crate::clips::clip_image_bytes(&state, id)?.ok_or("图片不存在或已被遮盖")?;
        Ok(image::guess_format(&bytes).map_err(err)?.extensions_str()[0].to_string())
    })
    .await?;
    let name = format!(
        "CPaste-{}-{id}.{extension}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let downloads = app.path().download_dir().map_err(err)?;
    let path = if choose_path.unwrap_or(false) {
        let _ = crate::windows::hide_picker_window(&app);
        let Some(file) = rfd::AsyncFileDialog::new()
            .add_filter(extension.to_uppercase(), &[extension.as_str()])
            .set_directory(downloads)
            .set_file_name(&name)
            .save_file()
            .await
        else {
            return Ok(None);
        };
        file.path().to_path_buf()
    } else {
        downloads.join(name)
    };
    let state = s.inner().clone();
    crate::background::run(move || {
        let bytes = crate::clips::clip_image_bytes(&state, id)?.ok_or("图片不存在或已被遮盖")?;
        if image::guess_format(&bytes).map_err(err)?.extensions_str()[0] != extension {
            return Err("图片格式已更改，请重新另存为".into());
        }
        write_image_file(&path, &bytes, choose_path.unwrap_or(false))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub(crate) async fn open_image(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("external-previews");
    let state = s.inner().clone();
    crate::background::run(move || {
        let bytes = crate::clips::clip_image_bytes(&state, id)?.ok_or("图片不存在或已被遮盖")?;
        std::fs::create_dir_all(&directory).map_err(err)?;
        let extension = image::guess_format(&bytes).map_err(err)?.extensions_str()[0];
        let path = directory.join(format!("{id}.{extension}"));
        std::fs::write(&path, bytes).map_err(err)?;
        let _ = crate::windows::hide_picker_window(&app);
        #[cfg(target_os = "macos")]
        let status = std::process::Command::new("open")
            .args(["-b", "com.apple.Preview", "--"])
            .arg(&path)
            .status()
            .map_err(err)?;
        #[cfg(target_os = "windows")]
        let status = std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(&path)
            .status()
            .map_err(err)?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let status = std::process::Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(err)?;
        if !status.success() {
            return Err("无法打开系统图片预览".into());
        }
        let mut files: Vec<_> = std::fs::read_dir(&directory)
            .map_err(err)?
            .filter_map(Result::ok)
            .filter(|file| file.path() != path)
            .collect();
        files.sort_by_key(|file| file.metadata().and_then(|m| m.modified()).ok());
        let mut bytes: u64 = std::fs::read_dir(&directory)
            .map_err(err)?
            .filter_map(Result::ok)
            .filter_map(|f| f.metadata().ok())
            .map(|m| m.len())
            .sum();
        let mut count = files.len() + 1;
        for file in files {
            if count <= 16 && bytes <= 128 * 1024 * 1024 {
                break;
            }
            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(file.path()).is_ok() {
                bytes = bytes.saturating_sub(size);
                count -= 1;
            }
        }
        Ok(())
    })
    .await
}
