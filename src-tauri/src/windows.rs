use active_win_pos_rs::get_active_window;
use rusqlite::OptionalExtension;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt as PanelManagerExt;

use crate::models::PreviewPlacement;
use crate::models::{PreviewClip, State};
use crate::privacy::{contains_sensitive, mask_sensitive};

use crate::models::PickerOpening;
use crate::state::{db, err, prefs};

pub(crate) fn remember_target(app: &AppHandle) {
    let pid = get_active_window().ok().map(|v| v.process_id).unwrap_or(0);
    if pid != 0 && pid != std::process::id() as u64 {
        if let Some(s) = app.try_state::<Arc<State>>() {
            s.target_pid.store(pid, Ordering::SeqCst);
            #[cfg(target_os = "windows")]
            s.target_hwnd.store(
                unsafe { GetForegroundWindow() } as usize as u64,
                Ordering::SeqCst,
            );
        }
    }
}
#[cfg(target_os = "macos")]
pub(crate) fn activate_target(_s: &State, pid: u64) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    if pid > i32::MAX as u64 {
        return false;
    }
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32).is_some_and(
        |application| application.activateWithOptions(NSApplicationActivationOptions::empty()),
    )
}
#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn GetForegroundWindow() -> *mut std::ffi::c_void;
    fn SetForegroundWindow(hwnd: *mut std::ffi::c_void) -> i32;
}

/// On Windows the picker is deliberately non-focusable so showing it does not
/// steal focus from the app the user is pasting into. That also means it never
/// receives a `Focused(false)` event, so a click outside the window has to be
/// detected globally.
#[cfg(target_os = "windows")]
pub(crate) mod outside_click {
    use crate::models::State;
    use crate::windows::hide_picker_window;
    use std::sync::{atomic::Ordering, Arc, OnceLock};
    use tauri::{AppHandle, Manager};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    const WH_MOUSE_LL: i32 = 14;
    const HC_ACTION: i32 = 0;
    const WM_LBUTTONDOWN: usize = 0x0201;
    const WM_RBUTTONDOWN: usize = 0x0204;
    const WM_MBUTTONDOWN: usize = 0x0207;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    #[allow(dead_code)]
    struct MouseHookData {
        pt: Point,
        mouse_data: u32,
        flags: u32,
        time: u32,
        extra: usize,
    }
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowsHookExW(
            hook_type: i32,
            callback: HookProc,
            module: *mut std::ffi::c_void,
            thread_id: u32,
        ) -> *mut std::ffi::c_void;
        fn CallNextHookEx(
            hook: *mut std::ffi::c_void,
            code: i32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
        fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut Rect) -> i32;
    }

    unsafe extern "system" fn on_mouse(code: i32, wparam: usize, lparam: isize) -> isize {
        if code == HC_ACTION && matches!(wparam, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN) {
            if let Some(app) = APP.get() {
                let point = unsafe { (*(lparam as *const MouseHookData)).pt };
                let app = app.clone();
                let (x, y) = (point.x, point.y);
                tauri::async_runtime::spawn(async move {
                    close_on_outside_click(&app, x, y);
                });
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
    }

    fn close_on_outside_click(app: &AppHandle, x: i32, y: i32) {
        let Some(picker) = app.get_webview_window("main") else {
            return;
        };
        if !matches!(picker.is_visible(), Ok(true)) {
            return;
        }
        if app
            .try_state::<Arc<State>>()
            .is_some_and(|state| state.picker_pinned.load(Ordering::SeqCst))
        {
            return;
        }
        // Keep the picker open for clicks on any of its own windows (preview,
        // rule menu, settings, ...).
        for (_, window) in app.webview_windows() {
            if !matches!(window.is_visible(), Ok(true)) {
                continue;
            }
            let Ok(hwnd) = window.hwnd() else {
                continue;
            };
            let mut rect = Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            if unsafe { GetWindowRect(hwnd.0, &mut rect) } != 0
                && x >= rect.left
                && x < rect.right
                && y >= rect.top
                && y < rect.bottom
            {
                return;
            }
        }
        let _ = hide_picker_window(app);
    }

    pub(crate) fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, on_mouse, std::ptr::null_mut(), 0) };
        if hook.is_null() {
            eprintln!(
                "CPaste 无法安装鼠标监听：{}",
                std::io::Error::last_os_error()
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn set_rounded_corners(window: &tauri::WebviewWindow) {
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWCP_ROUND: u32 = 2;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut std::ffi::c_void,
            attribute: u32,
            value: *const std::ffi::c_void,
            size: u32,
        ) -> i32;
    }

    if let Ok(hwnd) = window.hwnd() {
        let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                (&DWMWCP_ROUND as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_BORDER_COLOR,
                (&DWMWA_COLOR_NONE as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}
#[cfg(target_os = "windows")]
pub(crate) fn activate_target(s: &State, _pid: u64) -> bool {
    let hwnd = s.target_hwnd.load(Ordering::SeqCst);
    hwnd != 0 && unsafe { SetForegroundWindow(hwnd as usize as *mut std::ffi::c_void) } != 0
}
pub(crate) fn cursor_on_monitor(
    cursor: tauri::PhysicalPosition<f64>,
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
) -> bool {
    let left = position.x as f64;
    let top = position.y as f64;
    cursor.x >= left
        && cursor.x < left + size.width as f64
        && cursor.y >= top
        && cursor.y < top + size.height as f64
}
pub(crate) fn full_monitor_area(monitor: &tauri::Monitor) -> tauri::PhysicalRect<i32, u32> {
    tauri::PhysicalRect {
        position: *monitor.position(),
        size: *monitor.size(),
    }
}
pub(crate) fn show_picker(app: &AppHandle) {
    crate::diagnostics::record("picker_show", serde_json::json!({}));
    remember_target(app);
    if let Some(state) = app.try_state::<Arc<State>>() {
        state.picker_pinned.store(false, Ordering::SeqCst);
    }
    let _ = hide_preview(app.clone());
    if let Some(window) = app.get_webview_window("main") {
        let picker_prefs = app
            .try_state::<Arc<State>>()
            .and_then(|s| prefs(&s).ok())
            .unwrap_or_default();
        let edge = "none".to_string();
        let cursor = app.cursor_position().ok();
        let monitor = cursor.as_ref().and_then(|cursor| {
            app.available_monitors()
                .ok()?
                .into_iter()
                .find(|monitor| cursor_on_monitor(*cursor, *monitor.position(), *monitor.size()))
        });
        let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
        let width = if picker_prefs.hover_preview || picker_prefs.default_sidebar_open {
            650.0
        } else {
            350.0
        };
        let height = 600.0;
        if let Err(error) = window.set_size(tauri::LogicalSize::new(width, height)) {
            eprintln!("CPaste 面板尺寸设置失败：{error}");
        }
        let mut position = None;
        if let (Some(cursor), Some(monitor)) = (cursor, monitor) {
            let area = monitor.work_area();
            let left = area.position.x;
            let top = area.position.y;
            let right = left + area.size.width as i32;
            let bottom = top + area.size.height as i32;
            let panel_width = (width * scale).round() as i32;
            let panel_height = (height * scale).round() as i32;
            let max_x = right.saturating_sub(panel_width).max(left);
            let max_y = bottom.saturating_sub(panel_height).max(top);
            let (x, y) = if picker_prefs.popup_position == "cursor" {
                (
                    (cursor.x as i32 + 12).clamp(left, max_x),
                    (cursor.y as i32 + 12).clamp(top, max_y),
                )
            } else {
                (
                    (left + (area.size.width as i32 - panel_width) / 2).clamp(left, max_x),
                    top + (area.size.height as i32 - panel_height) / 2,
                )
            };
            position = Some(tauri::PhysicalPosition::new(
                x.clamp(left, max_x),
                y.clamp(top, max_y),
            ));
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(position) = position {
                let _ = window.set_position(position);
            } else {
                let _ = window.center();
            }
            let _ = window.emit(
                "picker-opening",
                PickerOpening {
                    edge: edge.clone(),
                    sidebar_open: picker_prefs.default_sidebar_open,
                    width,
                    height,
                },
            );
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(position) = position {
                let _ = window.set_position(position);
            } else {
                let _ = window.center();
            }
            let _ = window.set_focusable(false);
            let _ = window.emit(
                "picker-opening",
                PickerOpening {
                    edge: edge.clone(),
                    sidebar_open: picker_prefs.default_sidebar_open,
                    width,
                    height,
                },
            );
        }
    }
}
#[tauri::command]
pub(crate) fn reveal_picker(app: AppHandle, edge: String) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("选择面板不可用")?;
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let visible_window = window.clone();
        app.run_on_main_thread(move || {
            if let Ok(panel) = handle.get_webview_panel("main") {
                panel.set_corner_radius(18.0);
                panel.show_and_make_key();
                let _ = visible_window.emit("picker-opened", edge);
            }
        })
        .map_err(err)?;
    }
    #[cfg(target_os = "windows")]
    {
        window.show().map_err(err)?;
        set_rounded_corners(&window);
        window.emit("picker-opened", edge).map_err(err)?;
    }
    Ok(())
}
pub(crate) fn hide_picker_window(app: &AppHandle) -> Result<(), String> {
    crate::diagnostics::record("picker_hide", serde_json::json!({}));
    let _ = crate::menus::hide_rule_menu(app.clone());
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Ok(panel) = handle.get_webview_panel("main") {
                panel.hide();
            }
        })
        .map_err(err)?;
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(err)?;
        }
    }
    app.emit("picker-hidden", ()).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub(crate) fn set_picker_editing(app: AppHandle, editing: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        window.set_focusable(editing).map_err(err)?;
        if editing {
            window.set_focus().map_err(err)?;
        } else if let Some(state) = app.try_state::<Arc<State>>() {
            let target = state.target_pid.load(Ordering::SeqCst);
            let _ = activate_target(&state, target);
        }
    }
    #[cfg(target_os = "macos")]
    let _ = (app, editing);
    Ok(())
}
#[tauri::command]
pub(crate) async fn get_preview_clip(
    s: tauri::State<'_, Arc<State>>,
    id: i64,
) -> Result<Option<PreviewClip>, String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let s = state;
    let mask = prefs(&s)?.sensitive_action == "mask";
    let result = db(&s)?
        .query_row(
            "SELECT kind,plain_text,files_json,source_app,created_at,html,rtf,pinned,favorite,updated_at,use_count FROM clips WHERE id=?1",
            [id],
            |r| {
                let files: String = r.get(2)?;
                let ts: i64 = r.get(4)?;
                let plain_text: String = r.get(1)?;
                let files: Vec<String> = serde_json::from_str(&files).unwrap_or_default();
                let html: Option<String> = r.get(5)?;
                let rtf: Option<String> = r.get(6)?;
                let sensitive = mask && contains_sensitive(&plain_text, html.as_deref(), rtf.as_deref(), &files);
                let clip = PreviewClip {
                    id,
                    kind: r.get(0)?,
                    plain_text: if sensitive { if plain_text.is_empty() { "******".into() } else { mask_sensitive(&plain_text) } } else { plain_text },
                    files: if sensitive { files.iter().map(|v| mask_sensitive(v)).collect() } else { files.clone() },
                    file_sizes: Vec::new(),
                    source_app: r.get(3)?,
                    created_at: chrono::DateTime::from_timestamp(ts, 0)
                        .unwrap_or_default()
                        .to_rfc3339(),
                    pinned: r.get::<_,i64>(7)? != 0,
                    favorite: r.get::<_,i64>(8)? != 0,
                    updated_at: chrono::DateTime::from_timestamp(r.get(9)?,0).unwrap_or_default().to_rfc3339(),
                    use_count: r.get(10)?,
                    sensitive_masked: sensitive,
                };
                Ok((clip, files))
            },
        )
        .optional()
        .map_err(err)?;
    Ok(result.map(|(mut clip, paths)| {
        clip.file_sizes = paths
            .iter()
            .map(|path| {
                if clip.sensitive_masked {
                    None
                } else {
                    std::fs::metadata(path)
                        .ok()
                        .filter(|meta| meta.is_file())
                        .map(|meta| meta.len())
                }
            })
            .collect();
        clip
    }))

    }).await
}
#[tauri::command]
pub(crate) async fn show_preview(
    app: AppHandle,
    id: i64,
    edge: String,
    anchor_x: f64,
    anchor_y: f64,
) -> Result<(), String> {
    let preview = if let Some(window) = app.get_webview_window("preview") {
        window
    } else {
        let initial = serde_json::json!({
            "id": id,
            "edge": &edge,
            "anchor_x": anchor_x,
            "anchor_y": anchor_y,
        });
        WebviewWindowBuilder::new(&app, "preview", WebviewUrl::default())
            .initialization_script(format!("window.__previewInitial={initial};"))
            .title("")
            .inner_size(292.0, 120.0)
            .decorations(false)
            .transparent(true)
            .shadow(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focusable(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(err)?
    };
    place_preview(&app, &preview, &edge, anchor_x, anchor_y, 120.0)?;
    preview.show().map_err(err)?;
    preview
        .emit(
            "preview-changed",
            PreviewPlacement {
                id,
                edge,
                anchor_x,
                anchor_y,
            },
        )
        .map_err(err)
}
pub(crate) fn place_preview(
    app: &AppHandle,
    preview: &tauri::WebviewWindow,
    edge: &str,
    anchor_x: f64,
    anchor_y: f64,
    height: f64,
) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("选择面板未打开")?;
    let origin = main.outer_position().map_err(err)?;
    let main_size = main.outer_size().map_err(err)?;
    let scale = main.scale_factor().map_err(err)?;
    let monitor = main
        .current_monitor()
        .map_err(err)?
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        })
        .ok_or("屏幕不可用")?;
    let area = monitor.work_area();
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let preview_height = height.clamp(96.0, (area.size.height as f64 / scale - 16.0).min(560.0));
    preview
        .set_size(tauri::LogicalSize::new(292.0, preview_height))
        .map_err(err)?;
    let width = (292.0 * scale).round() as i32;
    let height = (preview_height * scale).round() as i32;
    let right_of_main = origin.x + main_size.width as i32 + 8;
    let x = if edge == "top" || edge == "bottom" {
        origin.x + (anchor_x * scale).round() as i32 - width / 2
    } else if right_of_main + width <= right {
        right_of_main
    } else {
        origin.x - width - 8
    };
    let x = x.clamp(area.position.x, (right - width).max(area.position.x));
    let y = (if edge == "top" {
        origin.y + main_size.height as i32 + 8
    } else if edge == "bottom" {
        origin.y - height - 8
    } else {
        origin.y + (anchor_y * scale).round() as i32 - height / 2
    })
    .clamp(area.position.y, (bottom - height).max(area.position.y));
    preview
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(err)
}
#[tauri::command]
pub(crate) fn resize_preview(
    app: AppHandle,
    edge: String,
    anchor_x: f64,
    anchor_y: f64,
    height: f64,
) -> Result<(), String> {
    let preview = app.get_webview_window("preview").ok_or("预览窗口不可用")?;
    place_preview(&app, &preview, &edge, anchor_x, anchor_y, height)
}
#[tauri::command]
pub(crate) fn hide_preview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preview") {
        window.hide().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn hide_picker(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<Arc<State>>() {
        state.picker_pinned.store(false, Ordering::SeqCst);
    }
    let _ = hide_preview(app.clone());
    hide_picker_window(&app)
}
#[tauri::command]
pub(crate) fn resize_edge_picker(
    app: AppHandle,
    edge: String,
    card_size: i64,
    details: Option<bool>,
) -> Result<(), String> {
    if !["left", "right", "top", "bottom"].contains(&edge.as_str())
        || !(120..=360).contains(&card_size)
    {
        return Err("面板尺寸超出允许范围".into());
    }
    let window = app.get_webview_window("main").ok_or("选择面板不可用")?;
    let monitor = window
        .current_monitor()
        .map_err(err)?
        .ok_or("无法确定面板所在屏幕")?;
    let area = full_monitor_area(&monitor);
    let scale = monitor.scale_factor();
    let p = app.try_state::<Arc<State>>().ok_or("设置不可用")?;
    let columns = prefs(&p)?.side_columns;
    let (width, height) = if matches!(edge.as_str(), "left" | "right") {
        let width = card_size as f64 * columns as f64 + 7.0 * (columns - 1) as f64 + 16.0;
        let width = width + if details.unwrap_or(false) { 300.0 } else { 0.0 };
        (
            width.min((area.size.width as f64 / scale - 16.0).max(120.0)),
            area.size.height as f64 / scale,
        )
    } else {
        (area.size.width as f64 / scale, card_size as f64 + 60.0)
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(err)?;
    let panel_width = (width * scale).round() as i32;
    let panel_height = (height * scale).round() as i32;
    let left = area.position.x;
    let top = area.position.y;
    let right = left + area.size.width as i32;
    let bottom = top + area.size.height as i32;
    let (x, y) = match edge.as_str() {
        "left" => (left, top),
        "right" => (right - panel_width, top),
        "top" => (left, top),
        _ => (left, bottom - panel_height),
    };
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(err)
}
#[tauri::command]
pub(crate) async fn open_settings(app: AppHandle) -> Result<(), String> {
    let _ = hide_preview(app.clone());
    let pinned = app
        .try_state::<Arc<State>>()
        .is_some_and(|state| state.picker_pinned.load(Ordering::SeqCst));
    if !pinned {
        let _ = hide_picker_window(&app);
    }
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(err)?;
        window.set_focus().map_err(err)?;
    } else {
        WebviewWindowBuilder::new(&app, "settings", WebviewUrl::default())
            .title("CPaste")
            .inner_size(720.0, 640.0)
            .min_inner_size(640.0, 520.0)
            .decorations(true)
            .resizable(true)
            .minimizable(true)
            .maximizable(true)
            .closable(true)
            .center()
            .build()
            .map_err(err)?;
    }
    if let Some(window) = app.get_webview_window("settings") {
        window.set_always_on_top(pinned).map_err(err)?;
        #[cfg(target_os = "macos")]
        if pinned {
            app.run_on_main_thread(move || {
                if let Ok(pointer) = window.ns_window() {
                    // The clipboard uses the macOS status level. Keep settings
                    // above it while the pinned panel remains visible.
                    let native =
                        unsafe { &*(pointer as *const tauri_nspanel::objc2_app_kit::NSWindow) };
                    native.setLevel((tauri_nspanel::PanelLevel::Status.value() + 1) as isize);
                }
                let _ = window.set_focus();
            })
            .map_err(err)?;
        }
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn set_picker_pinned(s: tauri::State<Arc<State>>, pinned: bool) -> bool {
    s.picker_pinned.store(pinned, Ordering::SeqCst);
    pinned
}
