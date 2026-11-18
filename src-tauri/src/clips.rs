use crate::models::{Clip, State};
use crate::privacy::{contains_sensitive, mask_sensitive};
use crate::state::{db, err, prefs};
use rusqlite::OptionalExtension;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

// Keep large image allocations off the UI thread and avoid simultaneous
// full-resolution decodes while a list of thumbnails is loading.
static IMAGE_OPERATIONS: Semaphore = Semaphore::const_new(1);

pub(crate) async fn image_task<T: Send + 'static>(
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
    crate::resources::migrate_schema(&c)?;
    let mut q=c.prepare("SELECT id,kind,title,plain_text,html,rtf,files_json,source_app,source_path,created_at,pinned,favorite,updated_at,use_count,COALESCE(image_size,LENGTH(image_data)),SUBSTR(image_data,1,32),image_format FROM clips ORDER BY pinned DESC,id DESC").map_err(err)?;
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
                image_size: if sensitive {None} else {r.get(14)?},
                image_format: if sensitive {None} else {r.get::<_,Option<String>>(16)?.or_else(||r.get::<_,Option<Vec<u8>>>(15).ok().flatten().and_then(|header|image::guess_format(&header).ok()).map(|format|format.extensions_str()[0].to_uppercase()))},
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
fn image_record(s: &State, id: i64) -> Result<Option<(Option<String>, Option<Vec<u8>>)>, String> {
    let mask = prefs(s)?.sensitive_action == "mask";
    let c = db(s)?;
    crate::resources::migrate_schema(&c)?;
    c.query_row("SELECT image_key,image_data,plain_text,html,rtf,files_json FROM clips WHERE id=?1 AND kind='image'",[id],|r|{
        let text:String=r.get(2)?;let html:Option<String>=r.get(3)?;let rtf:Option<String>=r.get(4)?;let files:Vec<String>=serde_json::from_str(&r.get::<_,String>(5)?).unwrap_or_default();
        if mask&&contains_sensitive(&text,html.as_deref(),rtf.as_deref(),&files){Ok(None)}else{Ok(Some((r.get(0)?,r.get(1)?)))}
    }).optional().map_err(err).map(Option::flatten)
}
pub(crate) fn clip_image_bytes(s: &State, id: i64) -> Result<Option<Vec<u8>>, String> {
    let Some((key, legacy)) = image_record(s, id)? else {
        return Ok(None);
    };
    if let Some(bytes) = legacy {
        return Ok(Some(bytes));
    }
    key.map(|key| crate::resources::read(&*db(s)?, &key))
        .transpose()
}
fn clip_image_key(s: &State, id: i64) -> Result<Option<String>, String> {
    let Some((key, legacy)) = image_record(s, id)? else {
        return Ok(None);
    };
    if let Some(bytes) = legacy {
        return crate::resources::attach(&*db(s)?, id, &bytes).map(Some);
    }
    Ok(key)
}
#[tauri::command]
pub(crate) async fn get_clip_image_path(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    image_task(move || {
        let Some(key) = clip_image_key(&state, id)? else {
            return Ok(None);
        };
        Ok(Some(
            crate::resources::image_path(&*db(&state)?, &key, false)?
                .to_string_lossy()
                .into_owned(),
        ))
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_clip_thumbnail_path(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    image_task(move || {
        let Some(key) = clip_image_key(&state, id)? else {
            return Ok(None);
        };
        let cached = crate::resources::image_path(&*db(&state)?, &key, true)?;
        if cached.is_file() {
            return Ok(Some(cached.to_string_lossy().into_owned()));
        }
        let Some(bytes) = clip_image_bytes(&state, id)? else {
            return Ok(None);
        };
        let png = thumbnail_png(&bytes)?;
        if clip_image_key(&state, id)?.as_deref() != Some(key.as_str()) {
            return Ok(None);
        }
        Ok(Some(
            crate::resources::cache_thumbnail(&*db(&state)?, &key, &png)?
                .to_string_lossy()
                .into_owned(),
        ))
    })
    .await
}

pub(crate) fn thumbnail_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(&bytes).map_err(err)?;
    // Match EcoPaste: a persistent PNG thumbnail, longest edge at most 300px.
    let thumbnail = if image.width() > 300 || image.height() > 300 {
        image.resize(300, 300, image::imageops::FilterType::Lanczos3)
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
pub(crate) async fn get_app_icon_path(
    s: tauri::State<'_, Arc<State>>,
    source_path: String,
) -> Result<Option<String>, String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let stamp = std::fs::metadata(&source_path).ok().map(|metadata| {
            format!(
                "{}:{}",
                metadata.len(),
                metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            )
        });
        {
            let c = db(&state)?;
            crate::resources::migrate_schema(&c)?;
            if let Some(path) = crate::resources::cached_icon(&c, &source_path, stamp.as_deref())? {
                return Ok(Some(path.to_string_lossy().into_owned()));
            }
        }
        let Some(stamp) = stamp else {
            return Ok(None);
        };
        let Some(bytes) = app_icon_png(&source_path) else {
            return Ok(None);
        };
        Ok(Some(
            crate::resources::cache_icon(&*db(&state)?, &source_path, &stamp, &bytes)?
                .to_string_lossy()
                .into_owned(),
        ))
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
