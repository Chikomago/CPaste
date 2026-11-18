//! Pixel input/output for image rules. No native processing algorithms are exposed.
use crate::{
    media_tools::{commit_image, encode, MediaRuleResult},
    models::State,
    state::{db, err},
};
use image::DynamicImage;
#[cfg(test)]
use image::GenericImageView;
use serde_json::{json, Value};
use std::{cell::RefCell, io::Cursor, rc::Rc, sync::Arc};
use tauri::{AppHandle, Emitter, Manager};
fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 64_000_000
    {
        Err("尺寸需为 1–16384，且不超过 6400 万像素".into())
    } else {
        Ok(())
    }
}
struct Prepared {
    before: Vec<u8>,
    bytes: Vec<u8>,
    text: String,
    modified: bool,
    export: Option<String>,
}
fn prepare(
    bytes: Option<Vec<u8>>,
    code: &str,
    params: Option<Value>,
    test_context: Option<Value>,
    dry: bool,
) -> Result<Prepared, String> {
    let mut context = test_context.unwrap_or_else(|| json!({}));
    if !context.is_object() {
        return Err("测试数据需为 JSON 对象".into());
    }
    let before = bytes.unwrap_or_default();
    let image = if before.is_empty() {
        if !dry {
            return Err("请选择一条图片记录".into());
        }
        let w = context.get("width").and_then(Value::as_u64).unwrap_or(1200);
        let h = context.get("height").and_then(Value::as_u64).unwrap_or(800);
        let (w, h) = (
            u32::try_from(w).map_err(err)?,
            u32::try_from(h).map_err(err)?,
        );
        dimensions(w, h)?;
        if let Some(data) = context.as_object_mut().unwrap().remove("data") {
            let data: Vec<u8> = serde_json::from_value(data)
                .map_err(|_| "JSON 像素需为 0–255 的整数数组".to_owned())?;
            DynamicImage::ImageRgba8(
                image::RgbaImage::from_raw(w, h, data)
                    .ok_or("像素数据长度需等于宽度 × 高度 × 4")?,
            )
        } else {
            DynamicImage::new_rgba8(w, h)
        }
    } else {
        let (w, h) = image::ImageReader::new(Cursor::new(&before))
            .with_guessed_format()
            .map_err(err)?
            .into_dimensions()
            .map_err(err)?;
        dimensions(w, h)?;
        image::load_from_memory(&before).map_err(err)?
    };
    context["width"] = json!(image.width());
    context["height"] = json!(image.height());
    context["format"] = if before.is_empty() {
        json!(context
            .get("format")
            .and_then(Value::as_str)
            .unwrap_or("png")
            .to_ascii_lowercase())
    } else {
        json!(image::guess_format(&before).map_err(err)?.extensions_str()[0])
    };
    context["kind"] = json!("image");
    context["text"] = json!("");
    if let Some(params) = params {
        context["params"] = params;
    }
    let input_size = (image.width(), image.height());
    let source = Rc::new(image.into_rgba8().into_raw());
    let read = source.clone();
    let result = Rc::new(RefCell::new(None));
    let output = result.clone();
    let evaluated = crate::js_runtime::execute_with_image(
        code,
        context,
        false,
        Some(crate::js_runtime::ImageBridge {
            read_pixels: Box::new(move || Ok(read.as_ref().clone())),
            write_pixels: Box::new(move |width, height, data| {
                dimensions(width, height)?;
                let pixels = image::RgbaImage::from_raw(width, height, data)
                    .ok_or("像素数据长度需等于宽度 × 高度 × 4")?;
                *output.borrow_mut() = Some(pixels);
                Ok(())
            }),
        }),
    )?;
    let metadata: Value = serde_json::from_str(&evaluated.text).map_err(err)?;
    let image =
        DynamicImage::ImageRgba8(result.borrow_mut().take().ok_or("图片规则需返回像素数据")?);
    let modified = (image.width(), image.height()) != input_size
        || image.as_rgba8().unwrap().as_raw().as_slice() != source.as_slice();
    let save_as = metadata.get("saveAs").filter(|value| !value.is_null());
    let encoding = metadata.get("encoding").filter(|value| !value.is_null());
    if save_as.is_some() && encoding.is_some() {
        return Err("encoding 和 saveAs 只能选择一种".into());
    }
    let save = save_as.or(encoding);
    let export = if let Some(save) = save {
        if !save.is_object() {
            return Err("encoding 或 saveAs 需为输出设置对象".into());
        }
        let format = save.get("format").and_then(Value::as_str).unwrap_or("png");
        Some(
            image::ImageFormat::from_extension(format)
                .filter(|format| format.writing_enabled())
                .ok_or("当前构建不支持此导出格式")?
                .extensions_str()[0]
                .to_string(),
        )
    } else {
        None
    };
    let quality = match save.and_then(|save| save.get("quality")) {
        None => 80,
        Some(value) => value
            .as_u64()
            .filter(|value| (1..=100).contains(value))
            .ok_or("质量需为 1–100")? as u8,
    };
    let bytes = if dry {
        vec![]
    } else {
        encode(&image, export.as_deref().unwrap_or("png"), quality)?
    };
    Ok(Prepared {
        before,
        bytes,
        text: metadata.to_string(),
        modified: modified || encoding.is_some(),
        export: if save_as.is_some() { export } else { None },
    })
}
#[cfg(test)]
fn test_image(
    bytes: Vec<u8>,
    code: &str,
    params: Option<Value>,
) -> Result<(String, Vec<u8>), String> {
    let result = prepare(Some(bytes), code, params, None, false)?;
    Ok((result.text, result.bytes))
}
pub(crate) async fn run<R: tauri::Runtime>(
    app: AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    id: Option<i64>,
    code: String,
    params: Option<Value>,
    test_context: Option<Value>,
    dry: bool,
) -> Result<MediaRuleResult, String> {
    let state = s.inner().clone();
    let prepared = crate::clips::image_task(move || {
        let bytes = if let Some(id) = id {
            let kind: String = db(&state)?
                .query_row("SELECT kind FROM clips WHERE id=?1", [id], |row| row.get(0))
                .map_err(err)?;
            if kind != "image" {
                return Err("规则与条目类型不匹配".into());
            }
            Some(crate::clips::clip_image_bytes(&state, id)?.ok_or("图片不存在或已被遮盖")?)
        } else {
            if !dry {
                return Err("请选择一条记录".into());
            }
            None
        };
        prepare(
            bytes,
            &code,
            params,
            if id.is_some() { None } else { test_context },
            dry,
        )
    })
    .await?;

    if dry {
        return Ok(MediaRuleResult {
            text: prepared.text,
            token: None,
            path: None,
        });
    }
    let id = id.ok_or("请选择一条记录")?;
    if let Some(format) = &prepared.export {
        let downloads = app.path().download_dir().map_err(err)?;
        let parent = app.get_webview_window("main");
        let mut dialog = rfd::AsyncFileDialog::new()
            .set_directory(downloads)
            .set_file_name(format!("CPaste-{id}.{format}"))
            .add_filter(format.to_uppercase(), &[format.as_str()]);
        if let Some(window) = &parent {
            dialog = dialog.set_parent(window);
        }
        let pinned = s
            .picker_pinned
            .swap(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(window) = &parent {
            let _ = window.set_focus();
        }
        let selected = dialog.save_file().await;
        s.picker_pinned
            .store(pinned, std::sync::atomic::Ordering::SeqCst);
        let Some(path) = selected else {
            return Ok(MediaRuleResult {
                text: prepared.text,
                token: None,
                path: None,
            });
        };
        let path = path.path().to_path_buf();
        let state = s.inner().clone();
        return crate::background::run(move || {
            if crate::clips::clip_image_bytes(&state, id)?.as_deref()
                != Some(prepared.before.as_slice())
            {
                return Err("图片已更改，请重新执行规则".into());
            }
            crate::content_tools::write_image_file(&path, &prepared.bytes, true)?;
            Ok(MediaRuleResult {
                text: prepared.text,
                token: None,
                path: Some(path.to_string_lossy().into_owned()),
            })
        })
        .await;
    }
    if !prepared.modified {
        return Ok(MediaRuleResult {
            text: prepared.text,
            token: None,
            path: None,
        });
    }
    let state = s.inner().clone();
    crate::background::write(move||{
        // Recheck privacy after script execution and before persisting results.
        if crate::clips::clip_image_bytes(&state,id)?.as_deref()!=Some(prepared.before.as_slice()){return Err("图片已更改或已被遮盖，请重新选择记录".into());}
        let token=commit_image(&state,id,&prepared.before,&prepared.bytes)?;
        let image_format=image::guess_format(&prepared.bytes).ok().map(|format|format.extensions_str()[0].to_uppercase());let image_size=prepared.bytes.len();
        crate::content_tools::remove_external_preview(&app,Some(id));let _=app.emit("image-content-changed",json!({"id":id,"image_size":image_size,"image_format":image_format,"revision":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos,true)}));
        Ok(MediaRuleResult{text:prepared.text,token:Some(token),path:None})
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_rules_execute_as_plain_js_against_real_rgba_input() {
        let rules: Vec<Value> =
            serde_json::from_str(include_str!("image-rule-fixtures.generated.json")).unwrap();
        let mut input = image::RgbaImage::new(3, 2);
        for (index, pixel) in input.pixels_mut().enumerate() {
            *pixel = image::Rgba([index as u8 + 1, 10, 20, 255]);
        }
        let bytes = encode(&DynamicImage::ImageRgba8(input), "png", 90).unwrap();
        for rule in rules {
            let id = rule["id"].as_str().unwrap();
            let code = rule["code"].as_str().unwrap();
            assert!(!code.contains("image."));
            let (text, preview) = test_image(bytes.clone(), code, None).unwrap();
            let metadata: Value = serde_json::from_str(&text).unwrap();
            let result = image::load_from_memory(&preview).unwrap();
            let expected = match id {
                "image:rotate_left" => Some(vec![3, 6, 2, 5, 1, 4]),
                "image:rotate_right" => Some(vec![4, 1, 5, 2, 6, 3]),
                "image:flip_horizontal" => Some(vec![3, 2, 1, 6, 5, 4]),
                "image:flip_vertical" => Some(vec![4, 5, 6, 1, 2, 3]),
                _ => None,
            };
            if let Some(expected) = expected {
                assert_eq!(
                    result
                        .to_rgba8()
                        .pixels()
                        .map(|pixel| pixel[0])
                        .collect::<Vec<_>>(),
                    expected,
                    "{id}"
                );
            }
            if id == "image:resize" {
                assert_eq!((result.width(), result.height()), (2, 1));
            }
            if id == "image:convert" {
                assert_eq!(metadata["encoding"]["format"], "jpeg");
                assert_eq!(
                    image::guess_format(&preview).unwrap(),
                    image::ImageFormat::Jpeg
                );
                let (_, converted_back) = test_image(preview, code, None).unwrap();
                assert_eq!(
                    image::guess_format(&converted_back).unwrap(),
                    image::ImageFormat::Png
                );
            }
            if id == "image:compress" {
                assert_eq!(metadata["encoding"]["format"], "jpeg");
                assert_eq!(metadata["encoding"]["quality"], 80);
            }
        }
    }
    #[test]
    fn json_test_pixels_are_used_and_paths_are_never_read() {
        let source = json!({"width":1,"height":1,"data":[12,34,56,255],"path":"/file-that-must-not-be-read.png"});
        let output=prepare(None,"function transform(pixels){if(pixels.data[0]!==12||pixels.data[3]!==255)throw Error('ignored JSON data');return pixels;}",None,Some(source),true).unwrap();
        assert!(output.bytes.is_empty());
        assert!(prepare(None,"function transform(pixels){if(pixels.data.some(value=>value!==0))throw Error('not blank');return pixels;}",None,Some(json!({"width":1,"height":1,"path":"/file-that-must-not-be-read.png"})),true).is_ok());
        for data in [
            json!([1, 2, 3]),
            json!([256, 0, 0, 255]),
            json!([-1, 0, 0, 255]),
            json!([1.5, 0, 0, 255]),
        ] {
            assert!(prepare(
                None,
                "function transform(pixels){return pixels;}",
                None,
                Some(json!({"width":1,"height":1,"data":data})),
                true
            )
            .is_err());
        }
    }
    #[test]
    fn javascript_selects_replacement_or_export() {
        let input = Some(json!({"width":1,"height":1}));
        let replace = prepare(
            None,
            "function transform(pixels){return {...pixels,encoding:{format:'jpeg',quality:80}};}",
            None,
            input.clone(),
            true,
        )
        .unwrap();
        assert!(replace.export.is_none());
        assert!(replace.modified);
        let export = prepare(
            None,
            "function transform(pixels){return {...pixels,saveAs:{format:'jpeg',quality:80}};}",
            None,
            input.clone(),
            true,
        )
        .unwrap();
        assert_eq!(export.export.as_deref(), Some("jpg"));
        assert!(!export.modified);
        assert!(prepare(None,"function transform(pixels){return {...pixels,encoding:{format:'png'},saveAs:{format:'png'}};}",None,input,true).is_err());
    }
    #[test]
    fn large_pixel_rules_have_resolution_appropriate_budget() {
        let code = "function transform(pixels){const src=pixels.data;const data=new Uint8ClampedArray(src.length);for(let i=0;i<src.length;i++)data[i]=255-src[i];return {width:pixels.width,height:pixels.height,data};}";
        let result = prepare(
            None,
            code,
            None,
            Some(json!({"width":2560,"height":1440})),
            true,
        )
        .unwrap();
        assert!(result.modified);
    }
    #[test]
    fn only_pixels_are_exposed_and_standard_js_can_change_them() {
        let mut original = image::RgbaImage::new(3, 2);
        original.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        let before = encode(&DynamicImage::ImageRgba8(original), "png", 90).unwrap();
        let result=prepare(Some(before.clone()),"function transform(pixels){if(typeof image!=='undefined')throw Error('native tools still exposed');for(let i=0;i<pixels.data.length;i+=4)pixels.data[i]=255-pixels.data[i];return pixels;}",None,None,false).unwrap();
        let decoded = image::load_from_memory(&result.bytes).unwrap();
        assert_eq!(decoded.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(
            image::load_from_memory(&before).unwrap().get_pixel(0, 0).0,
            [255, 0, 0, 255]
        );
    }
    #[test]
    fn dimensions_and_exports_are_output_metadata_not_processing_commands() {
        let result=prepare(None,"function transform(pixels){return {width:2,height:3,data:new Uint8ClampedArray(24).fill(127),saveAs:{format:'bmp'}};}",None,Some(json!({"width":1,"height":1})),true).unwrap();
        let meta: Value = serde_json::from_str(&result.text).unwrap();
        assert_eq!(meta["width"], 2);
        assert_eq!(meta["height"], 3);
        assert_eq!(meta["saveAs"]["format"], "bmp");
        assert!(result.modified);
        assert!(result.bytes.is_empty());
        assert!(prepare(
            None,
            "function transform(pixels){return pixels.data;}",
            None,
            Some(json!({"width":1,"height":1})),
            true
        )
        .is_ok());
    }
    #[test]
    fn invalid_or_old_processing_interfaces_fail_without_partial_output() {
        for code in [
            "function transform(pixels){pixels.data[0]=99;throw Error('stop');}",
            "function transform(){return image.rotate90();}",
            "function transform(){return {action:'rotate_right'};}",
            "function transform(){return {width:2,height:2,data:new Uint8Array(4)};}",
            "function transform(){return new Uint8Array(160*1024*1024);}",
            "function transform(){while(true){}}",
        ] {
            assert!(prepare(None, code, None, Some(json!({"width":1,"height":1})), true).is_err());
        }
        assert!(prepare(
            None,
            "function transform(pixels){return pixels;}",
            None,
            Some(json!({"width":1,"height":1})),
            true
        )
        .is_ok());
    }
    #[test]
    fn byte_views_preserve_offsets_and_encoding() {
        let result=prepare(None,"function transform(pixels){const bytes=new Uint8Array(12);bytes.set([12,34,56,255],4);return {width:1,height:1,data:bytes.subarray(4,8)};}",None,Some(json!({"width":1,"height":1})),true).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&result.text).unwrap()["width"],
            1
        );
        let source = encode(&DynamicImage::new_rgba8(1, 1), "png", 90).unwrap();
        let result=prepare(Some(source),"function transform(pixels){pixels.data.set([12,34,56,255]);return {...pixels,saveAs:{format:'bmp'}};}",None,None,false).unwrap();
        assert!(result.bytes.starts_with(b"BM"));
        assert_eq!(
            image::load_from_memory(&result.bytes)
                .unwrap()
                .get_pixel(0, 0)
                .0,
            [12, 34, 56, 255]
        );
    }
}
