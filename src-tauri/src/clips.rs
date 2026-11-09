use crate::models::{Clip, State};
use crate::privacy::{contains_sensitive, mask_sensitive};
use crate::state::{db, err, prefs};
use base64::Engine;
use rusqlite::OptionalExtension;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

// Keep large image allocations off the UI thread and avoid simultaneous
// full-resolution decodes while a list of thumbnails is loading.
static IMAGE_OPERATIONS: Semaphore = Semaphore::const_new(1);

async fn image_task<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = IMAGE_OPERATIONS.acquire().await.map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn list_clips(s: tauri::State<'_, Arc<State>>) -> Result<Vec<Clip>, String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let s = state;
    let c = db(&s)?;
    let mask = prefs(&s)?.sensitive_action == "mask";
    let mut q=c.prepare("SELECT id,kind,title,plain_text,html,rtf,files_json,source_app,source_path,created_at,pinned,favorite,updated_at,use_count FROM clips ORDER BY pinned DESC,id DESC").map_err(err)?;
    let result = q
        .query_map([], |r| {
            let files: String = r.get(6)?;
            let ts: i64 = r.get(9)?;
            let plain_text: String = r.get(3)?;
            let html: Option<String> = r.get(4)?;
            let rtf: Option<String> = r.get(5)?;
            let files: Vec<String> = serde_json::from_str(&files).unwrap_or_default();
            let sensitive =
                mask && contains_sensitive(&plain_text, html.as_deref(), rtf.as_deref(), &files);
            Ok(Clip {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: if sensitive {
                    "******".into()
                } else {
                    r.get(2)?
                },
                plain_text: if sensitive {
                    if plain_text.is_empty() {
                        "******".into()
                    } else {
                        mask_sensitive(&plain_text)
                    }
                } else {
                    plain_text
                },
                html: None,
                rtf: None,
                files: if sensitive {
                    files.iter().map(|v| mask_sensitive(v)).collect()
                } else {
                    files
                },
                image_data: None,
                source_app: r.get(7)?,
                source_path: r.get(8)?,
                created_at: chrono::DateTime::from_timestamp(ts, 0)
                    .unwrap_or_default()
                    .to_rfc3339(),
                updated_at: chrono::DateTime::from_timestamp(r.get(12)?, 0)
                    .unwrap_or_default()
                    .to_rfc3339(),
                use_count: r.get(13)?,
                pinned: r.get::<_, i64>(10)? != 0,
                favorite: r.get::<_, i64>(11)? != 0,
                sensitive_masked: sensitive,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    result

    }).await
}
#[tauri::command]
pub(crate) async fn get_clip_image(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    image_task(move || {
        Ok(clip_image_bytes(&state, id)?
            .map(|v| base64::engine::general_purpose::STANDARD.encode(v)))
    })
    .await
}
pub(crate) fn clip_image_bytes(s: &State, id: i64) -> Result<Option<Vec<u8>>, String> {
    let mask = prefs(s)?.sensitive_action == "mask";
    let image = db(s)?
        .query_row(
            "SELECT image_data,plain_text,html,rtf,files_json FROM clips WHERE id=?1",
            [id],
            |r| {
                let text: String = r.get(1)?;
                let html: Option<String> = r.get(2)?;
                let rtf: Option<String> = r.get(3)?;
                let files: String = r.get(4)?;
                let files: Vec<String> = serde_json::from_str(&files).unwrap_or_default();
                if mask && contains_sensitive(&text, html.as_deref(), rtf.as_deref(), &files) {
                    Ok(None)
                } else {
                    r.get(0)
                }
            },
        )
        .optional()
        .map_err(err)?
        .flatten();
    Ok(image)
}
#[tauri::command]
pub(crate) async fn get_clip_thumbnail(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    image_task(move || {
        let Some(bytes) = clip_image_bytes(&state, id)? else {
            return Ok(None);
        };
        Ok(Some(
            base64::engine::general_purpose::STANDARD.encode(thumbnail_png(&bytes)?),
        ))
    })
    .await
}
pub(crate) fn thumbnail_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(&bytes).map_err(err)?;
    // Cover the largest 360px card at 2x density without enlarging small images.
    let thumbnail = if image.width() > 768 || image.height() > 768 {
        image.resize(768, 768, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut output = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(err)?;
    Ok(output.into_inner())
}
#[tauri::command]
pub(crate) async fn get_app_icon(source_path: String) -> Result<Option<String>, String> {
    crate::background::run(move || {
        Ok(app_icon_png(&source_path)
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await
}
#[cfg(target_os = "macos")]
pub(crate) fn app_icon_png(source_path: &str) -> Option<Vec<u8>> {
    use std::path::Path;
    let end = source_path.find(".app")? + 4;
    let bundle = Path::new(&source_path[..end]);
    let info = plist::Value::from_file(bundle.join("Contents/Info.plist")).ok()?;
    let resources = bundle.join("Contents/Resources");
    let named = info
        .as_dictionary()?
        .get("CFBundleIconFile")
        .and_then(plist::Value::as_string)
        .map(|name| {
            resources.join(if name.ends_with(".icns") {
                name.to_string()
            } else {
                format!("{name}.icns")
            })
        });
    let icon = named.filter(|path| path.is_file()).or_else(|| {
        std::fs::read_dir(&resources)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|ext| ext == "icns"))
    })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let output =
        std::env::temp_dir().join(format!("cpaste-icon-{}-{nonce}.png", std::process::id()));
    let status = std::process::Command::new("sips")
        .args(["-s", "format", "png", "-Z", "64"])
        .arg(&icon)
        .arg("--out")
        .arg(&output)
        .output()
        .ok()?;
    if !status.status.success() {
        return None;
    }
    let bytes = std::fs::read(&output).ok();
    let _ = std::fs::remove_file(output);
    bytes
}
#[cfg(target_os = "windows")]
pub(crate) fn app_icon_png(source_path: &str) -> Option<Vec<u8>> {
    if !std::path::Path::new(source_path).is_file() {
        return None;
    }
    let script = "Add-Type -AssemblyName System.Drawing; $icon=[System.Drawing.Icon]::ExtractAssociatedIcon($args[0]); if($null -ne $icon){$m=New-Object System.IO.MemoryStream; $icon.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())}";
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
            source_path,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(String::from_utf8_lossy(&output.stdout).trim())
        .ok()
}
