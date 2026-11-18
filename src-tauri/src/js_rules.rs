use crate::models::State;
use crate::state::{db, err};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Emitter;

#[derive(Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum RuleKind {
    #[default]
    Js,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct JsRule {
    id: String,
    name: String,
    #[serde(default)]
    code: String,
    enabled: bool,
    #[serde(default)]
    kind: RuleKind,
    #[serde(default = "text_target")]
    target: String,
}
fn text_target() -> String {
    "text".into()
}
fn load(c: &rusqlite::Connection) -> Result<Vec<JsRule>, String> {
    let raw: Option<String> = c
        .query_row(
            "SELECT value FROM app_settings WHERE key='js_rules'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    raw.map(|raw| {
        serde_json::from_str(&raw).map_err(|_| "自定义规则无法读取，请从备份恢复".to_owned())
    })
    .unwrap_or(Ok(Vec::new()))
}
fn persist(c: &rusqlite::Connection, rules: &[JsRule]) -> Result<(), String> {
    let raw = serde_json::to_string(rules).map_err(err)?;
    if rules.len() > 200 || raw.len() > 8 * 1024 * 1024 {
        return Err("自定义规则总量超过限制，请删除不需要的规则".into());
    }
    c.execute("INSERT INTO app_settings(key,value) VALUES('js_rules',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[raw]).map_err(err)?;
    Ok(())
}
fn validate_rule(rule: &JsRule) -> Result<(), String> {
    if !["text", "image", "files"].contains(&rule.target.as_str()) {
        return Err("规则适用类型或参数无效".into());
    }
    if rule.id.is_empty()
        || rule.id.len() > 80
        || !rule
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_:".contains(c))
    {
        return Err("规则标识无效".into());
    }
    if rule.name.trim().is_empty() || rule.name.chars().count() > 64 {
        return Err("规则名称需为 1–64 个字符".into());
    }
    if rule.code.len() > 128 * 1024 || rule.code.trim().is_empty() {
        return Err("JS 代码需为非空文本，且不超过 128 KB".into());
    }
    crate::js_runtime::execute(
        &rule.code,
        serde_json::json!({"text":"","kind":rule.target}),
        true,
    )?;
    Ok(())
}
fn validate_rules(rules: &[JsRule]) -> Result<(), String> {
    if rules.len() > 200 {
        return Err("规则不能超过 200 条".into());
    }
    let mut ids = std::collections::HashSet::new();
    for rule in rules {
        if !ids.insert(&rule.id) {
            return Err("规则标识重复".into());
        }
        validate_rule(rule)?;
    }
    if serde_json::to_vec(rules).map_err(err)?.len() > 8 * 1024 * 1024 {
        return Err("规则备份不能超过 8 MB".into());
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuleBackup {
    version: u32,
    rules: Vec<JsRule>,
}
#[tauri::command]
pub(crate) async fn backup_rules(rules: Vec<JsRule>) -> Result<bool, String> {
    let bytes = crate::background::run(move || {
        validate_rules(&rules)?;
        serde_json::to_vec_pretty(&RuleBackup { version: 1, rules }).map_err(err)
    })
    .await?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name("CPaste-rules.json")
        .add_filter("JSON", &["json"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    crate::background::write(move || {
        std::fs::write(file.path(), bytes).map_err(err)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
pub(crate) async fn choose_rules_backup() -> Result<Option<Vec<JsRule>>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    crate::background::run(move || {
        let file = std::fs::File::open(file.path()).map_err(err)?;
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(err)?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("规则备份不能超过 8 MB".into());
        }
        let backup: RuleBackup =
            serde_json::from_slice(&bytes).map_err(|_| "不是有效的规则备份".to_owned())?;
        if backup.version != 1 {
            return Err("不支持此规则备份版本".into());
        }
        validate_rules(&backup.rules)?;
        Ok(Some(backup.rules))
    })
    .await
}
#[tauri::command]
pub(crate) async fn restore_rules<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    rules: Vec<JsRule>,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::write(move || {
        validate_rules(&rules)?;
        persist(&*db(&state)?, &rules)?;
        app.emit("rules-changed", serde_json::json!({"reset":true}))
            .map_err(err)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_js_rules(s: tauri::State<'_, Arc<State>>) -> Result<Vec<JsRule>, String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let c = db(&state)?;
        load(&c)
    })
    .await
}
#[tauri::command]
pub(crate) async fn save_js_rule<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    rule: JsRule,
) -> Result<(), String> {
    validate_rule(&rule)?;
    let state = s.inner().clone();
    crate::background::write(move || {
        let c = db(&state)?;
        let mut rules = load(&c)?;
        rules.retain(|item| item.id != rule.id);
        rules.push(rule.clone());
        persist(&c, &rules)?;
        drop(c);
        app.emit("rules-changed", serde_json::json!({"rule":rule}))
            .map_err(err)
    })
    .await
}
#[tauri::command]
pub(crate) async fn delete_js_rule<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    s: tauri::State<'_, Arc<State>>,
    id: String,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::write(move || {
        let c = db(&state)?;
        let mut rules = load(&c)?;
        rules.retain(|rule| rule.id != id);
        persist(&c, &rules)?;
        drop(c);
        app.emit("rules-changed", serde_json::json!({"deleted_id":id}))
            .map_err(err)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64},
        Mutex,
    };
    use tauri::{Listener, Manager};
    #[test]
    fn rules_round_trip_update_delete_and_reject_invalid_values() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
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
            .manage(state)
            .invoke_handler(tauri::generate_handler![
                get_js_rules,
                save_js_rule,
                delete_js_rule,
                restore_rules
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let received = events.clone();
        app.listen("rules-changed", move |event| {
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap())
        });
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
        for enabled in [true, false] {
            invoke("save_js_rule",serde_json::json!({"rule":{"id":"custom:test","name":"Test","code":"function transform(text){return text.trim();}","enabled":enabled}})).unwrap();
            let rules: Vec<JsRule> = invoke("get_js_rules", serde_json::json!({}))
                .unwrap()
                .deserialize()
                .unwrap();
            assert_eq!(rules.len(), 1);
            assert_eq!(rules[0].enabled, enabled);
            assert_eq!(rules[0].id, "custom:test");
            assert_eq!(
                events.lock().unwrap().last().unwrap()["rule"]["enabled"],
                enabled
            );
        }
        for (id, name, code) in [
            ("../bad", "Rule", "function transform(text){return text;}"),
            ("safe", "", "function transform(text){return text;}"),
            ("safe", "Rule", ""),
        ] {
            assert!(invoke(
                "save_js_rule",
                serde_json::json!({"rule":{"id":id,"name":name,"code":code,"enabled":true}})
            )
            .is_err());
        }
        let state = app.state::<Arc<State>>();
        assert_eq!(load(&db(&state).unwrap()).unwrap().len(), 1);
        invoke("delete_js_rule", serde_json::json!({"id":"custom:test"})).unwrap();
        assert_eq!(
            events.lock().unwrap().last().unwrap()["deleted_id"],
            "custom:test"
        );
        let rules: Vec<JsRule> = invoke("get_js_rules", serde_json::json!({}))
            .unwrap()
            .deserialize()
            .unwrap();
        assert!(rules.is_empty());
        let imported = serde_json::json!([{"id":"custom:restored","name":"Restored","code":"function transform(text){return text.trim();}","enabled":false,"target":"text"}]);
        invoke("restore_rules", serde_json::json!({"rules":imported})).unwrap();
        assert_eq!(load(&db(&state).unwrap()).unwrap()[0].id, "custom:restored");
        assert_eq!(events.lock().unwrap().last().unwrap()["reset"], true);
        let duplicate = serde_json::json!([imported[0].clone(), imported[0].clone()]);
        assert!(invoke("restore_rules", serde_json::json!({"rules":duplicate})).is_err());
        assert_eq!(load(&db(&state).unwrap()).unwrap().len(), 1);
        assert!(invoke("restore_rules",serde_json::json!({"rules":[{"id":"bad","name":"Bad","code":"function {","enabled":true}]})).is_err());
        assert_eq!(load(&db(&state).unwrap()).unwrap()[0].id, "custom:restored");
    }
}
