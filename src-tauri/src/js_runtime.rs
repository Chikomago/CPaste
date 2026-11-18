use crate::content_tools::transform_source;
use crate::models::State;
use crate::state::err;
use rquickjs::{
    prelude::Func, CatchResultExt, CaughtError, Context, Ctx, Exception, Runtime, TypedArray,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

static EXECUTIONS: Semaphore = Semaphore::const_new(1);
#[cfg(test)]
const BUILTINS: &str = include_str!("builtin-js.generated.json");
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ScriptOutput {
    pub(crate) text: String,
    pub(crate) html: Option<String>,
    pub(crate) rtf: Option<String>,
}
fn segment(text: String, granularity: String) -> String {
    use icu_segmenter::{GraphemeClusterSegmenter, SentenceSegmenter, WordSegmenter};
    let boundaries: Vec<usize> = match granularity.as_str() {
        "sentence" => SentenceSegmenter::new(Default::default())
            .segment_str(&text)
            .collect(),
        "word" => WordSegmenter::new_auto(Default::default())
            .segment_str(&text)
            .collect(),
        "grapheme" => GraphemeClusterSegmenter::new().segment_str(&text).collect(),
        _ => return "[]".into(),
    };
    let mut index = 0;
    let mut result = Vec::new();
    for pair in boundaries.windows(2) {
        let part = &text[pair[0]..pair[1]];
        let mut item = json!({"segment":part,"index":index});
        if granularity == "word" {
            item["isWordLike"] = json!(part.chars().any(char::is_alphanumeric));
        }
        result.push(item);
        index += part.encode_utf16().count();
    }
    serde_json::to_string(&result).unwrap_or_else(|_| "[]".into())
}
pub(crate) struct ImageBridge {
    pub read_pixels: Box<dyn Fn() -> Result<Vec<u8>, String>>,
    pub write_pixels: Box<dyn Fn(u32, u32, Vec<u8>) -> Result<(), String>>,
}
fn native_work<T>(
    paused: &Arc<std::sync::atomic::AtomicU64>,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if paused.load(std::sync::atomic::Ordering::Relaxed) > 30_000_000_000 {
        return Err("图片处理超过 30 秒，原内容未修改".into());
    }
    let start = Instant::now();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
        .unwrap_or_else(|_| Err("Rust 图片处理失败，原内容未修改".into()));
    let elapsed = start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
    let total = paused
        .fetch_add(elapsed, std::sync::atomic::Ordering::Relaxed)
        .saturating_add(elapsed);
    if total > 30_000_000_000 {
        Err("图片处理超过 30 秒，原内容未修改".into())
    } else {
        result
    }
}
fn register_pixels<'js>(
    ctx: &Ctx<'js>,
    read: Box<dyn Fn() -> Result<Vec<u8>, String>>,
    write: Box<dyn Fn(u32, u32, Vec<u8>) -> Result<(), String>>,
    paused: Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), String> {
    let read_paused = paused.clone();
    ctx.globals()
        .set(
            "__imageReadPixels",
            Func::from(
                move |ctx: Ctx<'js>| -> rquickjs::Result<TypedArray<'js, u8>> {
                    let bytes = native_work(&read_paused, || read())
                        .map_err(|error| Exception::throw_message(&ctx, &error))?;
                    // Copy into engine-owned memory so QuickJS's memory limit accounts for the buffer.
                    TypedArray::new_copy(ctx, &bytes)
                },
            ),
        )
        .map_err(err)?;
    ctx.globals()
        .set(
            "__imageWritePixels",
            Func::from(
                move |ctx: Ctx<'js>,
                      width: u32,
                      height: u32,
                      data: TypedArray<'js, u8>|
                      -> rquickjs::Result<()> {
                    // SAFETY: copy the view synchronously before any JS callback or engine operation.
                    // The borrowed bytes cannot be mutated, detached or resized during this copy.
                    let bytes =
                        unsafe { data.as_bytes() }
                            .map(<[u8]>::to_vec)
                            .ok_or_else(|| {
                                Exception::throw_message(&ctx, "像素缓冲区已分离，请重新读取")
                            })?;
                    native_work(&paused, || write(width, height, bytes))
                        .map_err(|error| Exception::throw_message(&ctx, &error))
                },
            ),
        )
        .map_err(err)?;
    Ok(())
}
pub(crate) fn execute(
    code: &str,
    input: Value,
    validate_only: bool,
) -> Result<ScriptOutput, String> {
    execute_with_image(code, input, validate_only, None)
}
pub(crate) fn execute_with_image(
    code: &str,
    input: Value,
    validate_only: bool,
    bridge: Option<ImageBridge>,
) -> Result<ScriptOutput, String> {
    if code.trim().is_empty() || code.len() > 128 * 1024 {
        return Err("JS 代码需为非空文本，且不超过 128 KB".into());
    }
    // Pixel loops scale with resolution; retain a finite budget for runaway code.
    let image_budget_ms = 5000_u64
        .saturating_add(
            input
                .get("width")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .saturating_mul(input.get("height").and_then(Value::as_u64).unwrap_or(0))
                / 1000
                * 2,
        )
        .min(30000);
    let input = serde_json::to_string(&input).map_err(err)?;
    if input.len() > 12 * 1024 * 1024 {
        return Err("JS 返回内容过大，原内容未修改".into());
    }
    let script_timeout = Duration::from_millis(if bridge.is_some() {
        image_budget_ms
    } else {
        1500
    });
    let runtime = Runtime::new().map_err(err)?;
    runtime.set_memory_limit(if bridge.is_some() {
        128 * 1024 * 1024
    } else {
        32 * 1024 * 1024
    });
    runtime.set_max_stack_size(512 * 1024);
    let paused = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let interrupted_paused = paused.clone();
    let started = Instant::now();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        started.elapsed().saturating_sub(Duration::from_nanos(
            interrupted_paused.load(std::sync::atomic::Ordering::Relaxed),
        )) > script_timeout
    })));
    let context = Context::full(&runtime).map_err(err)?;
    context.with(|ctx|{
        if let Some(bridge)=bridge {
            let ImageBridge{read_pixels,write_pixels}=bridge;
            register_pixels(&ctx,read_pixels,write_pixels,paused.clone())?;
        }
        ctx.globals().set("__segment",Func::from(segment)).map_err(err)?;
        let setup=format!(r#"globalThis.__input=JSON.parse({input});
            if(__input.kind==='image'&&typeof __imageReadPixels==='function'){{
              const bytes=__imageReadPixels();
              __input.pixels={{width:__input.width,height:__input.height,data:new Uint8ClampedArray(bytes.buffer,bytes.byteOffset,bytes.byteLength)}};
            }}
            globalThis.Intl=Object.freeze({{Segmenter:class{{constructor(locale,options){{this.granularity=options?.granularity||'grapheme';if(!['sentence','word','grapheme'].includes(this.granularity))throw Error('Unsupported segmentation');}}segment(text){{return JSON.parse(__segment(String(text),this.granularity));}}}}}});
"#,
            input=serde_json::to_string(&input).map_err(err)?);
        ctx.eval::<(),_>(setup).catch(&ctx).map_err(|error|error.to_string())?;
        let script=format!(r#"(function(){{'use strict';
{code}
if(typeof transform!=='function')throw Error('请定义 transform 函数');
if({validate_only}){{if(__input.regexRule&&typeof validateRegexRule==='function')validateRegexRule(__input.regexRule);return JSON.stringify({{text:__input.text||'',html:null,rtf:null}});}}
let value=transform(__input.kind==='image'?__input.pixels:__input.kind==='files'?(__input.files??[]):__input.text,__input);
let output;
if(__input.kind==='image'){{
  if(value instanceof Uint8Array||value instanceof Uint8ClampedArray)value={{width:__input.width,height:__input.height,data:value}};
  if(!value||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>16384||value.height>16384)throw Error('图片规则需返回有效的像素尺寸');
  const data=value.data;
  if(!(data instanceof Uint8Array)&&!(data instanceof Uint8ClampedArray))throw Error('图片规则需返回像素数组');
  if(data.byteLength!==value.width*value.height*4)throw Error('像素数据长度需等于宽度 × 高度 × 4');
  __imageWritePixels(value.width,value.height,new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
  output={{text:JSON.stringify({{width:value.width,height:value.height,saveAs:value.saveAs??null,encoding:value.encoding??null}})}};
}}else output=typeof value==='string'?{{text:value}}:value;
if(!output||typeof output.text!=='string'||(output.html!=null&&typeof output.html!=='string')||(output.rtf!=null&&typeof output.rtf!=='string'))throw Error('JS 需返回字符串或含 text 的对象');
if(!output.text.trim())throw Error('处理结果为空，原内容未修改');
if(output.text.length>1000000||(output.html?.length||0)>4000000||(output.rtf?.length||0)>4000000)throw Error('JS 返回内容过大，原内容未修改');
return JSON.stringify({{text:output.text,html:output.html??null,rtf:output.rtf??null}});
}})()"#);
        let result=ctx.eval::<String,_>(script).catch(&ctx).map_err(|error|{
            if started.elapsed().saturating_sub(Duration::from_nanos(paused.load(std::sync::atomic::Ordering::Relaxed)))>script_timeout{return "JS 执行超时，原内容未修改".into();}
            match error{CaughtError::Exception(exception)=>exception.message().unwrap_or_else(||"JS 执行失败，原内容未修改".into()),other=>other.to_string()}
        })?;
        let output:ScriptOutput=serde_json::from_str(&result).map_err(err)?;
        if output.text.len()>1_000_000||output.html.as_ref().is_some_and(|v|v.len()>4_000_000)||output.rtf.as_ref().is_some_and(|v|v.len()>4_000_000){return Err("JS 返回内容过大，原内容未修改".into());}
        Ok(output)
    })
}
#[tauri::command]
pub(crate) async fn execute_js_rule(
    s: tauri::State<'_, Arc<State>>,
    id: Option<i64>,
    code: String,
    converted: Option<ScriptOutput>,
    regex_rule: Option<Value>,
    test_input: Option<ScriptOutput>,
    validate_only: bool,
) -> Result<ScriptOutput, String> {
    let state = s.inner().clone();
    let permit = EXECUTIONS.acquire().await.map_err(err)?;
    crate::background::run(move || {
        let _permit = permit;
        let mut input = if validate_only {
            json!({"text":""})
        } else if let Some(id) = id {
            serde_json::to_value(transform_source(&state, id)?).map_err(err)?
        } else {
            serde_json::to_value(test_input.ok_or("请输入测试文本")?).map_err(err)?
        };
        if let Some(converted) = converted {
            input["converted"] = serde_json::to_value(converted).map_err(err)?;
        }
        if let Some(rule) = regex_rule {
            input["regexRule"] = rule;
        }
        execute(&code, input, validate_only)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_scripts_match_existing_algorithms() {
        let scripts: std::collections::HashMap<String, String> =
            serde_json::from_str(BUILTINS).unwrap();
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("js-parity.generated.json")).unwrap();
        for case in cases {
            let id = case["id"].as_str().unwrap();
            let text = case["text"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            let result = execute(&scripts[id], json!({"text":text}), false);
            if expected.trim().is_empty() {
                assert!(result.is_err(), "{id}");
                continue;
            }
            let actual = result.unwrap_or_else(|error| panic!("{id}: {error}"));
            if id == "auto-lines" && text.chars().count() > 80 {
                assert_eq!(actual.text.replace('\n', ""), expected.replace('\n', ""));
                assert!(actual.text.contains('\n'));
            } else {
                assert_eq!(actual.text, expected, "{id}: {text}");
            }
        }
    }
    #[test]
    fn custom_js_preserves_explicit_rich_results_and_conversion_context() {
        let result = execute(
            "function transform(text){return {text:text.toUpperCase(),html:'<b>'+text+'</b>'};}",
            json!({"text":"hello"}),
            false,
        )
        .unwrap();
        assert_eq!(result.text, "HELLO");
        assert_eq!(result.html.as_deref(), Some("<b>hello</b>"));
        let result = execute(
            "function transform(text,context){return context.converted;}",
            json!({"text":"old","converted":{"text":"new","html":"<b>new</b>"}}),
            false,
        )
        .unwrap();
        assert_eq!(result.text, "new");
        assert_eq!(
            execute(
                "function transform(text){return text.trim();}",
                json!({"text":" hello "}),
                false
            )
            .unwrap()
            .text,
            "hello"
        );
    }
    #[test]
    fn validation_does_not_call_transform_and_rejects_invalid_results() {
        assert!(execute(
            "function transform(){throw Error('must not run');}",
            json!({"text":"safe"}),
            true
        )
        .is_ok());
        for code in [
            "function transform( {",
            "const value=1;",
            "function transform(){return undefined;}",
            "async function transform(){return 'async';}",
            "function transform(){return '';}",
            "function transform(){return {text:'safe',html:7};}",
        ] {
            assert!(
                execute(code, json!({"text":"safe"}), false).is_err(),
                "{code}"
            );
        }
    }
    #[test]
    fn native_engine_has_no_system_browser_or_network_capabilities() {
        let result=execute("function transform(){return JSON.stringify([typeof fetch,typeof XMLHttpRequest,typeof WebSocket,typeof document,typeof window,typeof process,typeof require,typeof __TAURI_INTERNALS__,typeof Worker,typeof postMessage,typeof console,typeof std,typeof os,typeof helpers]);}",json!({"text":"safe"}),false).unwrap();
        let types: Vec<String> = serde_json::from_str(&result.text).unwrap();
        assert!(types.iter().all(|value| value == "undefined"), "{types:?}");
        assert_eq!(
            execute(
                "function transform(){return Function('return typeof process')();}",
                json!({"text":"safe"}),
                false
            )
            .unwrap()
            .text,
            "undefined"
        );
    }
    #[test]
    fn time_memory_and_result_limits_do_not_break_the_next_execution() {
        assert!(execute(
            "function transform(){while(true){}}",
            json!({"text":"safe"}),
            false
        )
        .unwrap_err()
        .contains("超时"));
        assert!(execute(
            "function transform(){return /^(a+)+$/.test('a'.repeat(32)+'!')?'yes':'no';}",
            json!({"text":"safe"}),
            false
        )
        .is_err());
        for code in [
            "function transform(){return 'a'.repeat(1000001);}",
            "function transform(){return 'a'.repeat(100000000);}",
            "function transform(){return {get text(){while(true){}}};}",
        ] {
            assert!(execute(code, json!({"text":"safe"}), false).is_err());
        }
        assert_eq!(
            execute(
                "function transform(text){return text;}",
                json!({"text":"after failure"}),
                false
            )
            .unwrap()
            .text,
            "after failure"
        );
    }
    #[test]
    fn regex_rules_also_execute_in_native_js() {
        let scripts: std::collections::HashMap<String, String> =
            serde_json::from_str(BUILTINS).unwrap();
        let result=execute(&scripts["__regex"],json!({"text":"abc123中文def456","regexRule":{"pattern":"[a-z]+","flags":"g","mode":"extract","replacement":""}}),false).unwrap();
        assert_eq!(result.text, "abc\ndef");
    }
    #[test]
    fn native_segmenter_uses_utf16_indices_and_keeps_emoji_intact() {
        let result=execute("function transform(){return JSON.stringify([...new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment('😀a')]);}",json!({"text":"safe"}),false).unwrap();
        let values: Vec<Value> = serde_json::from_str(&result.text).unwrap();
        assert_eq!(values[0]["segment"], "😀");
        assert_eq!(values[1]["index"], 2);
    }
    #[test]
    fn ipc_reads_current_record_and_never_saves_trial_output() {
        use std::sync::{
            atomic::{AtomicBool, AtomicU64},
            Mutex,
        };
        use tauri::Manager;
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,plain_text TEXT,html TEXT,rtf TEXT);INSERT INTO clips VALUES(1,'text','current value',NULL,NULL),(2,'text','password=secret123456',NULL,NULL);").unwrap();
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
            .manage(state)
            .invoke_handler(tauri::generate_handler![execute_js_rule])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let invoke = |id| {
            tauri::test::get_ipc_response(
                &window,
                tauri::webview::InvokeRequest {
                    cmd: "execute_js_rule".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(target_os = "windows") {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: tauri::ipc::InvokeBody::Json(
                        json!({"id":id,"code":"function transform(text){return text.toUpperCase();}","validateOnly":false}),
                    ),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        let output: ScriptOutput = invoke(1).unwrap().deserialize().unwrap();
        assert_eq!(output.text, "CURRENT VALUE");
        assert!(invoke(2).is_err());
        assert!(invoke(99).is_err());
        for (id, expected) in [(None, "SAMPLE"), (Some(1), "CURRENT VALUE")] {
            let output:ScriptOutput=tauri::test::get_ipc_response(&window,tauri::webview::InvokeRequest{cmd:"execute_js_rule".into(),callback:tauri::ipc::CallbackFn(0),error:tauri::ipc::CallbackFn(1),url:if cfg!(target_os="windows"){"http://tauri.localhost"}else{"tauri://localhost"}.parse().unwrap(),body:tauri::ipc::InvokeBody::Json(json!({"id":id,"code":"function transform(text){return text.toUpperCase();}","testInput":{"text":"sample"},"validateOnly":false})),headers:Default::default(),invoke_key:tauri::test::INVOKE_KEY.into()}).unwrap().deserialize().unwrap();
            assert_eq!(output.text, expected);
        }
        let state = app.state::<Arc<State>>();
        let current: String = crate::state::db(&state)
            .unwrap()
            .query_row("SELECT plain_text FROM clips WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(current, "current value");
    }
}
