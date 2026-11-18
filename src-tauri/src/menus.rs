use crate::models::{Preferences, State};
use crate::privacy::contains_sensitive;
use crate::state::{db, err, prefs};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager};

pub(crate) fn menu_text<'a>(language: &str, chinese: &'a str) -> &'a str {
    if language != "en-US" {
        return chinese;
    }
    match chinese {
        "粘贴" => "Paste",
        "粘贴文件路径" => "Paste file paths",
        "粘贴为纯文本" => "Paste as plain text",
        "粘贴文件" => "Paste files",
        "粘贴原格式" => "Paste original format",
        "复制到剪贴板" => "Copy to clipboard",
        "复制文件路径" => "Copy file paths",
        "复制为纯文本" => "Copy as plain text",
        "复制文件" => "Copy files",
        "复制原格式" => "Copy original format",
        "分词" => "Split into words",
        "文字工具" => "Text tools",
        "保存到下载目录" => "Save to Downloads",
        "图片另存为" => "Save image as",
        "用系统预览打开" => "Open in image viewer",
        "预览内容" => "Preview",
        "编辑内容" => "Edit content",
        "取消收藏" => "Remove favorite",
        "收藏" => "Favorite",
        "取消置顶" => "Unpin",
        "置顶" => "Pin",
        "删除记录" => "Delete item",
        "打开 CPaste" => "Open CPaste",
        "设置" => "Settings",
        "停止监听" => "Stop capturing",
        "开始监听" => "Start capturing",
        "退出 CPaste" => "Quit CPaste",
        _ => chinese,
    }
}
pub(crate) fn build_tray_menu(
    app: &AppHandle,
    p: &Preferences,
    listening: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str| {
        MenuItem::with_id(app, id, menu_text(&p.language, label), true, None::<&str>)
    };
    let open = item("open", "打开 CPaste")?;
    let settings = item("settings", "设置")?;
    let toggle = item(
        "toggle-listening",
        if listening {
            "停止监听"
        } else {
            "开始监听"
        },
    )?;
    let quit = item("quit", "退出 CPaste")?;
    Menu::with_items(app, &[&open, &settings, &toggle, &quit])
}

#[tauri::command]
pub(crate) async fn show_clip_context_menu(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    id: i64,
    x: f64,
    y: f64,
    _edge: String,
    sidebar_open: Option<bool>,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let s = state;
        let (kind, pinned, favorite, plain_text, html, rtf): (
            String,
            bool,
            bool,
            String,
            Option<String>,
            Option<String>,
        ) = db(&s)?
            .query_row(
                "SELECT kind,pinned,favorite,plain_text,html,rtf FROM clips WHERE id=?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .map_err(err)?;
        let p = prefs(&s)?;
        let menu = Menu::new(&app).map_err(err)?;
        let add = |action: &str, label: &str| -> Result<(), String> {
            let shortcut = p
                .action_shortcuts
                .get(action)
                .map(String::as_str)
                .unwrap_or("");
            let item = MenuItem::with_id(
                &app,
                format!("clip-menu:{id}:{action}"),
                menu_text(&p.language, label),
                true,
                if shortcut.is_empty() {
                    None
                } else {
                    Some(shortcut)
                },
            )
            .map_err(err)?;
            menu.append(&item).map_err(err)
        };
        add("paste", "粘贴")?;
        if kind == "rich" || kind == "files" {
            add(
                "paste_plain",
                if kind == "files" {
                    "粘贴文件路径"
                } else {
                    "粘贴为纯文本"
                },
            )?;
        }
        if (kind == "rich" && p.default_plain_paste) || (kind == "files" && p.default_file_paths) {
            add(
                "paste_original",
                if kind == "files" {
                    "粘贴文件"
                } else {
                    "粘贴原格式"
                },
            )?;
        }
        add("copy", "复制到剪贴板")?;
        if kind == "rich" || kind == "files" {
            add(
                "copy_plain",
                if kind == "files" {
                    "复制文件路径"
                } else {
                    "复制为纯文本"
                },
            )?;
        }
        if (kind == "rich" && p.default_plain_copy)
            || (kind == "files" && p.default_copy_file_paths)
        {
            add(
                "copy_original",
                if kind == "files" {
                    "复制文件"
                } else {
                    "复制原格式"
                },
            )?;
        }
        if !sidebar_open.unwrap_or(false) {
            add("preview", "预览内容")?;
        }
        if (kind == "text" || kind == "rich")
            && !(p.sensitive_action == "mask"
                && contains_sensitive(&plain_text, html.as_deref(), rtf.as_deref(), &[]))
        {
            add("edit", "编辑内容")?;
            if !plain_text.trim().is_empty() {
                add("segment", "分词")?;
            }
        }
        if kind == "image"
            && !(p.sensitive_action == "mask"
                && contains_sensitive(&plain_text, html.as_deref(), rtf.as_deref(), &[]))
        {
            add("save_image", "保存到下载目录")?;
            add("save_image_as", "图片另存为")?;
            add("open_image", "用系统预览打开")?;
        }
        add("favorite", if favorite { "取消收藏" } else { "收藏" })?;
        add("pin", if pinned { "取消置顶" } else { "置顶" })?;
        add("delete", "删除记录")?;
        let window = app.get_webview_window("main").ok_or("选择面板不可用")?;
        window
            .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
            .map_err(err)
    })
    .await
}

static RULE_POINTER_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn rule_local_pointer(
    cursor: (f64, f64),
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
) -> Option<[f64; 2]> {
    let x = cursor.0 - origin.0 as f64;
    let y = cursor.1 - origin.1 as f64;
    if scale <= 0.0 || x < 0.0 || y < 0.0 || x >= size.0 as f64 || y >= size.1 as f64 {
        return None;
    }
    Some([x / scale, y / scale])
}

#[derive(serde::Deserialize, serde::Serialize)]
pub(crate) struct RuleMenuEntry {
    id: String,
    label: String,
}
#[tauri::command]
pub(crate) async fn show_rule_menu(
    app: AppHandle,
    id: i64,
    x: f64,
    y: f64,
    entries: Vec<RuleMenuEntry>,
    toggle: Option<bool>,
) -> Result<(), String> {
    if toggle.unwrap_or(false) {
        if let Some(window) = app.get_webview_window("rules") {
            if window.is_visible().map_err(err)? {
                return hide_rule_menu(app.clone());
            }
        }
    }
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
    let payload = serde_json::json!({"id":id,"entries":entries});
    let window = if let Some(window) = app.get_webview_window("rules") {
        window
    } else {
        WebviewWindowBuilder::new(
            &app,
            "rules",
            WebviewUrl::App("index.html?view=rules".into()),
        )
        .initialization_script(format!("window.__ruleMenu={};", payload))
        .title("")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .accept_first_mouse(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .inner_size(190.0, 320.0)
        .build()
        .map_err(err)?
    };
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        app.run_on_main_thread(move || {
            if let Ok(pointer) = window.ns_window() {
                let native =
                    unsafe { &*(pointer as *const tauri_nspanel::objc2_app_kit::NSWindow) };
                native.setAcceptsMouseMovedEvents(true);
            }
        })
        .map_err(err)?;
    }
    // Keep initial data available until the new WebView has installed its listener.
    window
        .eval(&format!(
            "window.__ruleMenu={};window.dispatchEvent(new Event('rule-menu-ready'));",
            payload
        ))
        .map_err(err)?;
    let main = app.get_webview_window("main").ok_or("选择面板不可用")?;
    let scale = main.scale_factor().map_err(err)?;
    let pos = main.outer_position().map_err(err)?;
    let size = main.outer_size().map_err(err)?;
    let monitor = main
        .current_monitor()
        .map_err(err)?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or("屏幕不可用")?;
    let area = monitor.work_area();
    let margin = 8.0 * scale;
    let width = (190.0 * scale).min((area.size.width as f64 - 2.0 * margin).max(1.0));
    let height = ((entries.len() as f64 * 29.0 + 16.0).clamp(44.0, 420.0) * scale)
        .min((area.size.height as f64 - 2.0 * margin).max(1.0));
    let min_x = area.position.x as f64 + margin;
    let min_y = area.position.y as f64 + margin;
    let max_x = (area.position.x as f64 + area.size.width as f64 - margin - width).max(min_x);
    let max_y = (area.position.y as f64 + area.size.height as f64 - margin - height).max(min_y);
    let right = pos.x as f64 + size.width as f64 + margin;
    let left = if right <= max_x {
        right
    } else {
        pos.x as f64 - margin - width
    };
    let top = (pos.y as f64 + y * scale).clamp(min_y, max_y);
    let _ = x;
    window
        .set_size(tauri::PhysicalSize::new(
            width.round() as u32,
            height.round() as u32,
        ))
        .map_err(err)?;
    window
        .set_position(tauri::PhysicalPosition::new(
            left.clamp(min_x, max_x).round() as i32,
            top.round() as i32,
        ))
        .map_err(err)?;
    window.emit("rule-menu-changed", &payload).map_err(err)?;
    window.show().map_err(err)?;
    let epoch = RULE_POINTER_EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let mut previous = None;
        while RULE_POINTER_EPOCH.load(std::sync::atomic::Ordering::SeqCst) == epoch
            && window.is_visible().unwrap_or(false)
        {
            let point = app.cursor_position().ok().and_then(|cursor| {
                let origin = window.inner_position().ok()?;
                let size = window.inner_size().ok()?;
                rule_local_pointer(
                    (cursor.x, cursor.y),
                    (origin.x, origin.y),
                    (size.width, size.height),
                    window.scale_factor().ok()?,
                )
            });
            if previous.as_ref() != Some(&point) {
                let _ = window.emit("rule-pointer", point);
                previous = Some(point);
            }
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_rule_menu(app: AppHandle) -> Result<(), String> {
    RULE_POINTER_EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("rules") {
        window.hide().map_err(err)?;
    }
    Ok(())
}

#[cfg(test)]
mod rule_pointer_tests {
    use super::rule_local_pointer;
    #[test]
    fn pointer_coordinates_respect_retina_scale_negative_monitor_origins_and_window_edges() {
        assert_eq!(
            rule_local_pointer((-1800.0, 240.0), (-1920, 200), (380, 840), 2.0),
            Some([60.0, 20.0])
        );
        assert_eq!(
            rule_local_pointer((380.0, 20.0), (0, 0), (380, 840), 2.0),
            None
        );
        assert_eq!(
            rule_local_pointer((-1.0, 20.0), (0, 0), (380, 840), 2.0),
            None
        );
        assert_eq!(
            rule_local_pointer((30.0, 840.0), (0, 0), (380, 840), 2.0),
            None
        );
    }
}
