use crate::{
    models::State,
    state::{db, err, prefs},
};
use serde::Serialize;
use std::{io::Cursor, sync::Arc};
use tauri::{AppHandle, Emitter};
#[derive(Serialize)]
pub(crate) struct ImageResult {
    token: Option<i64>,
    path: Option<String>,
}
pub(crate) fn encode(
    image: &image::DynamicImage,
    format: &str,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    match format {
        "jpeg" | "jpg" => {
            let mut rgb = image::RgbImage::new(image.width(), image.height());
            for (x, y, pixel) in image.to_rgba8().enumerate_pixels() {
                let a = u32::from(pixel[3]);
                rgb.put_pixel(
                    x,
                    y,
                    image::Rgb(
                        [0, 1, 2].map(|i| {
                            ((u32::from(pixel[i]) * a + 255 * (255 - a) + 127) / 255) as u8
                        }),
                    ),
                );
            }
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
                .encode_image(&rgb)
                .map_err(err)?
        }
        "png" => image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .map_err(err)?,
        "webp" => image
            .write_to(&mut bytes, image::ImageFormat::WebP)
            .map_err(err)?,
        _ => {
            let format = image::ImageFormat::from_extension(format)
                .filter(|format| format.writing_enabled())
                .ok_or("当前构建不支持此导出格式")?;
            image.write_to(&mut bytes, format).map_err(err)?;
        }
    }
    Ok(bytes.into_inner())
}
fn image_fingerprint(c: &rusqlite::Connection, id: i64, bytes: &[u8]) -> Result<String, String> {
    let (kind, text, html, rtf, files): (String, String, Option<String>, Option<String>, String) =
        c.query_row(
            "SELECT kind,plain_text,html,rtf,files_json FROM clips WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(err)?;
    let files: Vec<String> = serde_json::from_str(&files).map_err(err)?;
    Ok(crate::fingerprint::calculate(
        &kind,
        &text,
        html.as_deref(),
        rtf.as_deref(),
        &files,
        Some(bytes),
    ))
}
fn replace_image(state: &State, id: i64, expected: &[u8], next: &[u8]) -> Result<(), String> {
    let c = db(state)?;
    crate::resources::migrate_schema(&c)?;
    let hash = image_fingerprint(&c, id, next)?;
    let key = crate::resources::store(&c, next)?;
    let expected_key = crate::resources::content_key(expected)?;
    let format = image::guess_format(next).map_err(err)?.extensions_str()[0].to_uppercase();
    let changed=c.execute("UPDATE clips SET image_data=NULL,image_key=?1,fingerprint=?2,updated_at=?3,image_size=?6,image_format=?7 WHERE id=?4 AND kind='image' AND (image_data=?5 OR (image_data IS NULL AND image_key=?8))",rusqlite::params![key,hash,crate::state::now(),id,expected,next.len()as i64,format,expected_key]).map_err(err)?;
    if changed != 1 {
        return Err("图片已更改，请重新选择记录".into());
    }
    let _ = crate::resources::collect_unused(&c);
    Ok(())
}
pub(crate) fn commit_image(
    state: &State,
    id: i64,
    before: &[u8],
    after: &[u8],
) -> Result<i64, String> {
    db(state)?.execute_batch("CREATE TEMP TABLE IF NOT EXISTS image_tool_history(token INTEGER PRIMARY KEY,clip_id INTEGER NOT NULL,before BLOB NOT NULL,after BLOB NOT NULL);").map_err(err)?;
    if before.len() + after.len() > 128 * 1024 * 1024 {
        return Err("图片过大，无法保留撤销记录；请用系统预览处理".into());
    }
    let mut c = db(state)?;
    crate::resources::migrate_schema(&c)?;
    let transaction = c.transaction().map_err(err)?;
    transaction
        .execute(
            "INSERT INTO image_tool_history(clip_id,before,after) VALUES(?1,?2,?3)",
            rusqlite::params![id, before, after],
        )
        .map_err(err)?;
    let token = transaction.last_insert_rowid();
    let hash = image_fingerprint(&transaction, id, after)?;
    let key = crate::resources::store(&transaction, after)?;
    let expected_key = crate::resources::content_key(before)?;
    let format = image::guess_format(after).map_err(err)?.extensions_str()[0].to_uppercase();
    let changed=transaction.execute("UPDATE clips SET image_data=NULL,image_key=?1,fingerprint=?2,updated_at=?3,image_size=?6,image_format=?7 WHERE id=?4 AND kind='image' AND (image_data=?5 OR (image_data IS NULL AND image_key=?8))",rusqlite::params![key,hash,crate::state::now(),id,before,after.len()as i64,format,expected_key]).map_err(err)?;
    if changed != 1 {
        return Err("图片已更改，请重新选择记录".into());
    }
    loop {
        let (count,bytes):(i64,i64)=transaction.query_row("SELECT COUNT(*),COALESCE(SUM(LENGTH(before)+LENGTH(after)),0) FROM image_tool_history",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if count <= 20 && bytes <= 128 * 1024 * 1024 {
            break;
        }
        transaction.execute("DELETE FROM image_tool_history WHERE token=(SELECT MIN(token) FROM image_tool_history)",[]).map_err(err)?;
    }
    transaction.commit().map_err(err)?;
    let _ = crate::resources::collect_unused(&c);
    Ok(token)
}
#[tauri::command]
pub(crate) async fn image_history<R: tauri::Runtime>(
    app: AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    id: i64,
    action: String,
    token: i64,
) -> Result<ImageResult, String> {
    if !["undo", "redo"].contains(&action.as_str()) {
        return Err("只支持撤销或重做".into());
    }
    let state = s.inner().clone();
    crate::background::write(move||{
  crate::clips::clip_image_bytes(&state,id)?.ok_or("图片不存在或已被遮盖")?;
  let(a,b):(Vec<u8>,Vec<u8>)=db(&state)?.query_row("SELECT before,after FROM image_tool_history WHERE token=?1 AND clip_id=?2",rusqlite::params![token,id],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|_|"图片撤销记录已过期".to_owned())?;
  if action=="undo"{replace_image(&state,id,&b,&a)?;}else{replace_image(&state,id,&a,&b)?;}
  let bytes=if action=="undo"{&a}else{&b};let image_format=image::guess_format(bytes).ok().map(|format|format.extensions_str()[0].to_uppercase());
  crate::content_tools::remove_external_preview(&app,Some(id));let _=app.emit("image-content-changed",serde_json::json!({"id":id,"image_size":bytes.len(),"image_format":image_format,"revision":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos,true)}));Ok(ImageResult{token:Some(token),path:None})
 }).await
}
#[tauri::command]
pub(crate) async fn file_tool(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    id: i64,
    action: String,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let (kind, files): (String, String) = db(&state)?
            .query_row("SELECT kind,files_json FROM clips WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(err)?;
        if kind != "files" {
            return Err("请选择文件记录".into());
        }
        let files: Vec<String> = serde_json::from_str(&files).map_err(err)?;
        if prefs(&state)?.sensitive_action == "mask"
            && crate::privacy::contains_sensitive("", None, None, &files)
        {
            return Err("敏感内容已遮盖，无法处理".into());
        }
        if action != "reveal" {
            return Err("不支持的文件处理".into());
        }
        let file = std::path::PathBuf::from(files.first().ok_or("文件列表为空")?);
        if !file.exists() {
            return Err("文件已移动或删除".into());
        }
        let _ = crate::windows::hide_picker_window(&app);
        #[cfg(target_os = "macos")]
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&file)
            .status()
            .map_err(err)?;
        #[cfg(target_os = "windows")]
        let status = std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", file.display()))
            .status()
            .map_err(err)?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let status = std::process::Command::new("xdg-open")
            .arg(file.parent().ok_or("文件路径无效")?)
            .status()
            .map_err(err)?;
        if !status.success() {
            return Err("无法打开文件位置".into());
        }
        Ok(())
    })
    .await
}

#[derive(Serialize)]
pub(crate) struct MediaRuleResult {
    pub(crate) text: String,
    pub(crate) token: Option<i64>,
    pub(crate) path: Option<String>,
}
#[tauri::command]
pub(crate) async fn execute_media_rule<R: tauri::Runtime>(
    app: AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    id: Option<i64>,
    target: String,
    code: String,
    params: Option<serde_json::Value>,
    test_context: Option<serde_json::Value>,
    validate_only: bool,
    dry_run: bool,
) -> Result<MediaRuleResult, String> {
    if !["image", "files"].contains(&target.as_str()) {
        return Err("请选择图片或文件规则".into());
    }
    if validate_only {
        crate::background::run(move || {
            crate::js_runtime::execute(&code, serde_json::json!({"text":"","kind":target}), true)?;
            Ok(MediaRuleResult {
                text: String::new(),
                token: None,
                path: None,
            })
        })
        .await
    } else if target == "image" {
        let result =
            crate::image_scripts::run(app, s, id, code, params, test_context, dry_run).await;

        result
    } else {
        let state = s.inner().clone();
        let text=crate::background::run(move||{
   let mut context=if let Some(id)=id{let(kind,text,html,rtf,files):(String,String,Option<String>,Option<String>,String)=db(&state)?.query_row("SELECT kind,plain_text,html,rtf,files_json FROM clips WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;if kind!="files"{return Err("规则与条目类型不匹配".into());}let files:Vec<String>=serde_json::from_str(&files).map_err(err)?;if prefs(&state)?.sensitive_action=="mask"&&crate::privacy::contains_sensitive(&text,html.as_deref(),rtf.as_deref(),&files){return Err("敏感内容已遮盖，无法处理".into());}serde_json::json!({"files":files.into_iter().map(|path|{let name=std::path::Path::new(&path).file_name().map(|name|name.to_string_lossy().into_owned()).unwrap_or_default();serde_json::json!({"name":name,"path":path})}).collect::<Vec<_>>()})}else{if !dry_run{return Err("请选择一条记录".into());}test_context.unwrap_or_else(||serde_json::json!({}))};
   if !context.is_object(){return Err("测试数据需为 JSON 对象".into());}context["kind"]=serde_json::json!("files");context["text"]=serde_json::json!("");if let Some(params)=params{context["params"]=params;}
   Ok(crate::js_runtime::execute(&code,context,false)?.text)
  }).await?;
        if !dry_run {
            let state = s.inner().clone();
            let value = text.clone();
            crate::background::run(move || {
                crate::content_tools::write_result(&state, &value, None)
            })
            .await?;
        }
        Ok(MediaRuleResult {
            text,
            token: None,
            path: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64},
        Mutex,
    };
    #[test]
    fn pixel_results_commit_atomically_and_history_has_no_processing_commands() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,image_data BLOB,fingerprint TEXT,updated_at INTEGER);").unwrap();
        let mut pixels = image::RgbaImage::new(2, 1);
        pixels.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        let before = encode(&image::DynamicImage::ImageRgba8(pixels), "png", 90).unwrap();
        c.execute(
            "INSERT INTO clips VALUES(1,'image','',NULL,NULL,'[]',?1,'original',0)",
            [&before],
        )
        .unwrap();
        let state = Arc::new(State {
            db: Mutex::new(c),
            prefs: Mutex::new(crate::models::Preferences::default()),
            suppress_next: AtomicBool::new(false),
            listening: AtomicBool::new(true),
            picker_pinned: AtomicBool::new(false),
            target_pid: AtomicU64::new(0),
            #[cfg(target_os = "windows")]
            target_hwnd: AtomicU64::new(0),
        });
        let app = tauri::test::mock_builder()
            .manage(state.clone())
            .invoke_handler(tauri::generate_handler![execute_media_rule, image_history])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let invoke = |cmd: &str, body: serde_json::Value| {
            tauri::test::get_ipc_response(
                &window,
                tauri::webview::InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(target_os = "windows") {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        let verify_fingerprint = || {
            let bytes = crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap();
            let actual: String = db(&state)
                .unwrap()
                .query_row("SELECT fingerprint FROM clips WHERE id=1", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                actual,
                crate::fingerprint::calculate("image", "", None, None, &[], Some(&bytes))
            );
        };
        let rule = serde_json::json!({"id":1,"target":"image","code":"function transform(pixels){if(typeof image!=='undefined')throw Error('native API');pixels.data[0]=42;return pixels;}","validateOnly":false,"dryRun":false});
        let mut trial = rule.clone();
        trial["dryRun"] = serde_json::json!(true);
        invoke("execute_media_rule", trial).unwrap();
        assert_eq!(
            crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap(),
            before
        );
        let result: serde_json::Value = invoke("execute_media_rule", rule.clone())
            .unwrap()
            .deserialize()
            .unwrap();
        let token = result["token"].as_i64().unwrap();
        let after = crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap();
        verify_fingerprint();
        assert_eq!(
            image::load_from_memory(&after).unwrap().get_pixel(0, 0).0,
            [42, 0, 0, 255]
        );
        invoke(
            "image_history",
            serde_json::json!({"id":1,"action":"undo","token":token}),
        )
        .unwrap();
        verify_fingerprint();
        assert_eq!(
            crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap(),
            before
        );
        invoke(
            "image_history",
            serde_json::json!({"id":1,"action":"redo","token":token}),
        )
        .unwrap();
        verify_fingerprint();
        assert_eq!(
            crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap(),
            after
        );
        assert!(invoke(
            "image_history",
            serde_json::json!({"id":1,"action":"rotate_right","token":token})
        )
        .is_err());
        let mut invalid = rule.clone();
        invalid["code"]=serde_json::json!("function transform(pixels){pixels.data[0]=0;return {width:5,height:5,data:pixels.data};}");
        assert!(invoke("execute_media_rule", invalid).is_err());
        assert_eq!(
            crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap(),
            after
        );
        // Encoding-only rules must replace stored bytes even if pixels are unchanged.
        for format in ["jpeg", "png"] {
            let result:serde_json::Value=invoke("execute_media_rule",serde_json::json!({"id":1,"target":"image","code":format!("function transform(pixels){{return {{...pixels,encoding:{{format:'{format}',quality:80}}}};}}"),"validateOnly":false,"dryRun":false})).unwrap().deserialize().unwrap();
            let conversion_token = result["token"]
                .as_i64()
                .expect("conversion must commit instead of opening a dialog");
            assert!(result["path"].is_null());
            let bytes = crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap();
            assert_eq!(
                image::guess_format(&bytes).unwrap(),
                image::ImageFormat::from_extension(format).unwrap()
            );
            verify_fingerprint();
            invoke(
                "image_history",
                serde_json::json!({"id":1,"action":"undo","token":conversion_token}),
            )
            .unwrap();
            assert_eq!(
                crate::clips::clip_image_bytes(&state, 1).unwrap().unwrap(),
                after
            );
        }
        db(&state)
            .unwrap()
            .execute(
                "UPDATE clips SET plain_text='password=abcdef123456' WHERE id=1",
                [],
            )
            .unwrap();
        assert!(invoke("execute_media_rule", rule).is_err());
        assert!(invoke(
            "image_history",
            serde_json::json!({"id":1,"action":"undo","token":token})
        )
        .is_err());
    }
}
