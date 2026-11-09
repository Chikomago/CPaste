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
        add("preview", "预览内容")?;
        if (kind == "text" || kind == "rich")
            && !(p.sensitive_action == "mask"
                && contains_sensitive(&plain_text, html.as_deref(), rtf.as_deref(), &[]))
        {
            add("edit", "编辑内容")?;
            if !plain_text.trim().is_empty() {
                add("segment", "分词")?;
            }
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
