use crate::capture::Handler;
use crate::database::{load_prefs, open_db};
use crate::menus::build_tray_menu;
use crate::models::ClipMenuAction;
use crate::models::State;
#[cfg(target_os = "macos")]
use crate::permissions::accessibility_trusted;
#[cfg(target_os = "macos")]
use crate::permissions::full_disk_access_granted;
#[cfg(target_os = "macos")]
use crate::permissions::open_full_disk_settings;
#[cfg(target_os = "macos")]
use crate::preferences::apply_dock_visibility;
use crate::state::prefs;
use crate::windows::{hide_picker_window, hide_preview, open_settings, show_picker};
use clipboard_rs::{ClipboardContext, ClipboardWatcher, ClipboardWatcherContext};
use rusqlite::OptionalExtension;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

mod applications;
mod backup;
mod capture;
mod clipboard;
mod clips;
mod database;
mod menus;
mod models;
mod permissions;
mod preferences;
mod privacy;
mod segmentation;
mod shortcuts;
mod state;
mod updates;
mod windows;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, PanelLevel, WebviewWindowExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(ClipboardPanel {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false
        }
    })
    panel_event!(ClipboardPanelEventHandler {
        window_did_resign_key(notification: &NSNotification) -> (),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    show_picker(app);
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_menu_event(|app, event| {
            let parts: Vec<&str> = event.id.as_ref().split(':').collect();
            if parts.len() == 3 && parts[0] == "clip-menu" {
                if let Ok(id) = parts[1].parse::<i64>() {
                    let _ = app.emit(
                        "clip-menu-action",
                        ClipMenuAction {
                            id,
                            action: parts[2].to_string(),
                        },
                    );
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle().plugin(tauri_nspanel::init())?;
            let c = open_db(app.handle())?;
            #[cfg(target_os = "macos")]
            let first_permission_request: bool = c
                .query_row(
                    "SELECT value FROM app_settings WHERE key='permissions_requested'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .is_none();
            #[cfg(target_os = "macos")]
            if first_permission_request {
                c.execute(
                    "INSERT INTO app_settings(key,value) VALUES('permissions_requested','1')",
                    [],
                )?;
            }
            let p = load_prefs(&c);
            let s = Arc::new(State {
                db: Mutex::new(c),
                prefs: Mutex::new(p.clone()),
                suppress_next: AtomicBool::new(false),
                listening: AtomicBool::new(true),
                picker_pinned: AtomicBool::new(false),
                target_pid: AtomicU64::new(0),
                #[cfg(target_os = "windows")]
                target_hwnd: AtomicU64::new(0),
            });
            app.manage(s.clone());
            updates::start(app.handle().clone());
            #[cfg(target_os = "macos")]
            if first_permission_request {
                let _ = accessibility_trusted(true);
                let permission_app = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(2));
                    if full_disk_access_granted(&permission_app) != Some(true) {
                        if let Err(error) = open_full_disk_settings() {
                            eprintln!("CPaste 无法打开完全磁盘访问设置：{error}");
                        }
                    }
                });
            }
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").ok_or("选择面板不可用")?;
                let panel = window.to_panel::<ClipboardPanel>()?;
                panel.set_corner_radius(18.0);
                panel.set_level(PanelLevel::Status.value());
                panel.add_style_mask(
                    tauri_nspanel::objc2_app_kit::NSWindowStyleMask::NonactivatingPanel,
                )?;
                let handler = ClipboardPanelEventHandler::new();
                let handle = app.handle().clone();
                handler.window_did_resign_key(move |_| {
                    if handle
                        .try_state::<Arc<State>>()
                        .is_some_and(|state| state.picker_pinned.load(Ordering::SeqCst))
                    {
                        return;
                    }
                    let _ = hide_preview(handle.clone());
                    let _ = hide_picker_window(&handle);
                });
                panel.set_event_handler(Some(handler.as_ref()));
            }
            if let Err(error) = app.global_shortcut().register(p.shortcut.as_str()) {
                eprintln!("CPaste 快捷键注册失败：{error}");
            }
            let menu = build_tray_menu(app.handle(), &p, true)?;
            let menu_state = s.clone();
            let tray = TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::new(
                    include_bytes!("../icons/tray-white.rgba"),
                    64,
                    64,
                ))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_picker(app),
                    "settings" => {
                        let _ = open_settings(app.clone());
                    }
                    "toggle-listening" => {
                        menu_state.listening.fetch_xor(true, Ordering::SeqCst);
                        if let (Some(tray), Ok(preferences)) =
                            (app.tray_by_id("main"), prefs(&menu_state))
                        {
                            if let Ok(menu) = build_tray_menu(
                                app,
                                &preferences,
                                menu_state.listening.load(Ordering::SeqCst),
                            ) {
                                let _ = tray.set_menu(Some(menu));
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_picker(app);
                    }
                })
                .build(app)?;
            tray.set_visible(p.show_tray_icon)?;
            #[cfg(target_os = "macos")]
            {
                let show_dock_icon = p.show_dock_icon;
                app.handle().run_on_main_thread(move || {
                    if let Err(error) = apply_dock_visibility(show_dock_icon) {
                        eprintln!("CPaste Dock 图标设置失败：{error}");
                    }
                })?;
            }
            let handle = app.handle().clone();
            thread::spawn(move || {
                let Ok(ctx) = ClipboardContext::new() else {
                    return;
                };
                let Ok(mut watcher) = ClipboardWatcherContext::new() else {
                    return;
                };
                watcher.add_handler(Handler {
                    app: handle,
                    state: s,
                    ctx,
                });
                watcher.start_watch();
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = hide_preview(window.app_handle().clone());
                        let _ = hide_picker_window(window.app_handle());
                    }
                    WindowEvent::Focused(false) => {
                        let pinned = window
                            .app_handle()
                            .try_state::<Arc<State>>()
                            .is_some_and(|state| state.picker_pinned.load(Ordering::SeqCst));
                        if pinned {
                            return;
                        }
                        let _ = hide_preview(window.app_handle().clone());
                        #[cfg(target_os = "windows")]
                        let _ = hide_picker_window(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            updates::get_update_status,
            updates::check_for_updates,
            updates::install_update,
            updates::restart_after_update,
            updates::open_project_link,
            clips::list_clips,
            clips::get_clip_image,
            clips::get_clip_thumbnail,
            clips::get_app_icon,
            windows::get_preview_clip,
            windows::show_preview,
            windows::resize_preview,
            windows::hide_preview,
            preferences::get_preferences,
            permissions::accessibility_status,
            permissions::full_disk_access_status,
            permissions::open_system_permission,
            windows::set_picker_pinned,
            preferences::save_preferences,
            database::get_database_size,
            applications::list_installed_apps,
            backup::backup_database,
            backup::choose_restore_file,
            backup::restore_database,
            clipboard::toggle_pin,
            clipboard::toggle_favorite,
            clipboard::delete_clip,
            clipboard::clear_clips,
            clipboard::edit_clip,
            clipboard::copy_clip,
            clipboard::copy_plain_clip,
            clipboard::copy_original_clip,
            clipboard::paste_clip,
            clipboard::paste_text_fragment,
            segmentation::segment_text,
            segmentation::import_dictionary,
            segmentation::get_dictionary_info,
            segmentation::get_downloaded_dictionary_info,
            segmentation::download_dictionary,
            clipboard::paste_plain_clip,
            clipboard::paste_original_clip,
            menus::show_clip_context_menu,
            windows::set_picker_editing,
            windows::hide_picker,
            windows::resize_edge_picker,
            windows::reveal_picker,
            windows::open_settings
        ])
        .run(tauri::generate_context!())
        .expect("CPaste failed to start")
}

#[cfg(test)]
mod tests;
