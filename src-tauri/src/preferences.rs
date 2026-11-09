use crate::database::cleanup;
use crate::menus::build_tray_menu;
use crate::models::{Preferences, State};
use crate::shortcuts::{canonical_shortcut, CLIP_ACTIONS};
use crate::state::{db, err, prefs};
use regex::Regex;
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[tauri::command]
pub(crate) async fn get_preferences(
    s: tauri::State<'_, Arc<State>>,
) -> Result<Preferences, String> {
    let state = s.inner().clone();
    crate::background::run(move || {
        let s = state;
        prefs(&s)
    })
    .await
}
#[cfg(target_os = "macos")]
pub(crate) fn apply_dock_visibility(visible: bool) -> Result<(), String> {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSImage};
    use tauri_nspanel::objc2::AllocAnyThread;
    use tauri_nspanel::objc2_foundation::NSData;
    let marker =
        tauri_nspanel::objc2::MainThreadMarker::new().ok_or("Dock 图标只能在主线程设置")?;
    let application = NSApplication::sharedApplication(marker);
    let policy = if visible {
        NSApplicationActivationPolicy::Regular
    } else {
        NSApplicationActivationPolicy::Accessory
    };
    if application.activationPolicy() != policy && !application.setActivationPolicy(policy) {
        return Err("Dock 图标设置失败".into());
    }
    if visible {
        // An unbundled `tauri dev` executable can regain the generic exec icon
        // when macOS switches its activation policy back to Regular.
        let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
        let icon = NSImage::initWithData(NSImage::alloc(), &data).ok_or("应用图标加载失败")?;
        unsafe { application.setApplicationIconImage(Some(&icon)) };
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn set_dock_visibility(app: &AppHandle, visible: bool) -> Result<(), String> {
    if tauri_nspanel::objc2::MainThreadMarker::new().is_some() {
        return apply_dock_visibility(visible);
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(apply_dock_visibility(visible));
    })
    .map_err(err)?;
    receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Dock 图标设置超时".to_string())?
}

#[tauri::command]
pub(crate) async fn save_preferences(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    preferences: Preferences,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::write(move || {
        let s = state;
        validate_preferences(&preferences)?;
        activate_preferences(&app, &s, preferences, true)
    })
    .await
}
pub(crate) fn validate_preferences(preferences: &Preferences) -> Result<(), String> {
    crate::segmentation::dictionary_words(&preferences.segment_custom_words)?;
    let mut seen = HashSet::new();
    for (action, shortcut) in &preferences.action_shortcuts {
        if !CLIP_ACTIONS.contains(&action.as_str())
            || shortcut.len() > 64
            || shortcut.chars().any(char::is_whitespace)
        {
            return Err("记录快捷键无效".into());
        }
        if !shortcut.is_empty()
            && (!seen.insert(canonical_shortcut(shortcut))
                || canonical_shortcut(shortcut) == canonical_shortcut(&preferences.shortcut))
        {
            return Err("快捷键重复".into());
        }
    }
    if !(0..=3650).contains(&preferences.retention_days)
        || !(0..=1_000_000).contains(&preferences.max_items)
        || !(0..=102_400).contains(&preferences.max_storage_mb)
    {
        return Err("清理设置超出允许范围".into());
    }
    if !["system", "light", "dark"].contains(&preferences.theme.as_str()) {
        return Err("主题设置无效".into());
    }
    if !["zh-CN", "en-US"].contains(&preferences.language.as_str())
        || !["all", "favorite"].contains(&preferences.default_filter.as_str())
        || !(1..=10).contains(&preferences.item_max_lines)
    {
        return Err("外观设置无效".into());
    }
    if !Regex::new(r"^#[0-9a-fA-F]{6}$")
        .map_err(err)?
        .is_match(&preferences.accent_color)
    {
        return Err("主题色格式无效".into());
    }
    if !["center", "cursor", "left", "right", "top", "bottom"]
        .contains(&preferences.popup_position.as_str())
    {
        return Err("面板位置设置无效".into());
    }
    if !(1..=2).contains(&preferences.side_columns)
        || !(120..=360).contains(&preferences.edge_card_size)
    {
        return Err("侧边面板设置无效".into());
    }
    if !["save", "skip", "mask"].contains(&preferences.sensitive_action.as_str()) {
        return Err("敏感内容处理方式无效".into());
    }
    Ok(())
}
pub(crate) fn activate_preferences(
    app: &AppHandle,
    s: &Arc<State>,
    preferences: Preferences,
    persist: bool,
) -> Result<(), String> {
    let old = prefs(s)?;
    if old.shortcut != preferences.shortcut {
        app.global_shortcut()
            .unregister(old.shortcut.as_str())
            .map_err(err)?;
        if let Err(e) = app
            .global_shortcut()
            .register(preferences.shortcut.as_str())
        {
            let _ = app.global_shortcut().register(old.shortcut.as_str());
            return Err(format!("快捷键不可用：{e}"));
        }
    }
    if old.launch_at_login != preferences.launch_at_login {
        let result = if preferences.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        result.map_err(|e| format!("开机启动设置失败：{e}"))?;
    }
    #[cfg(target_os = "macos")]
    if old.show_dock_icon != preferences.show_dock_icon {
        set_dock_visibility(&app, preferences.show_dock_icon)?;
    }
    if persist {
        db(s)?.execute("INSERT INTO app_settings(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&preferences).map_err(err)?]).map_err(err)?;
    }
    let tray = app.tray_by_id("main").ok_or("菜单栏图标不可用")?;
    tray.set_visible(preferences.show_tray_icon).map_err(err)?;
    if old.language != preferences.language {
        tray.set_menu(Some(
            build_tray_menu(app, &preferences, s.listening.load(Ordering::SeqCst)).map_err(err)?,
        ))
        .map_err(err)?;
    }
    *s.prefs.lock().map_err(err)? = preferences;
    if persist {
        cleanup(s)?;
    }
    if persist {
        app.emit("clips-changed", ()).map_err(err)?;
    }
    Ok(())
}
