use crate::models::State;
use crate::state::prefs;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
pub(crate) struct UpdateStatus {
    phase: &'static str,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            phase: "idle",
            version: None,
            notes: None,
            downloaded: 0,
            total: None,
            error: None,
        }
    }
}

#[derive(Default)]
struct Inner {
    status: UpdateStatus,
    update: Option<Update>,
}
#[derive(Default)]
pub(crate) struct Updates(Mutex<Inner>);

fn publish(app: &AppHandle, status: &UpdateStatus) {
    let _ = app.emit("update-status", status);
}

#[tauri::command]
pub(crate) fn get_update_status(app: AppHandle) -> Result<UpdateStatus, String> {
    let state = app.state::<Updates>();
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.status.clone())
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: AppHandle) -> Result<UpdateStatus, String> {
    {
        let state = app.state::<Updates>();
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if matches!(
            inner.status.phase,
            "checking" | "downloading" | "installing" | "ready"
        ) {
            return Ok(inner.status.clone());
        }
        inner.status.phase = "checking";
        inner.status.error = None;
        publish(&app, &inner.status);
    }
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    let state = app.state::<Updates>();
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(update) => {
            inner.status = UpdateStatus {
                phase: if update.is_some() {
                    "available"
                } else {
                    "latest"
                },
                version: update.as_ref().map(|u| u.version.clone()),
                notes: update.as_ref().and_then(|u| u.body.clone()),
                ..Default::default()
            };
            inner.update = update;
        }
        Err(error) => {
            inner.status.phase = "error";
            inner.status.error = Some(error);
        }
    }
    publish(&app, &inner.status);
    Ok(inner.status.clone())
}

#[tauri::command]
pub(crate) async fn install_update(app: AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("开发版不安装更新，请使用正式安装包".into());
    }
    let update = {
        let state = app.state::<Updates>();
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if !matches!(inner.status.phase, "available" | "error") {
            return Err("请先检查更新".into());
        }
        let update = inner.update.clone().ok_or("请先检查更新")?;
        inner.status.phase = "downloading";
        inner.status.downloaded = 0;
        inner.status.total = None;
        inner.status.error = None;
        publish(&app, &inner.status);
        update
    };
    let progress_app = app.clone();
    let mut last_percent = None;
    let mut last_notice = std::time::Instant::now();
    let result = update
        .download(
            move |chunk, total| {
                let state = progress_app.state::<Updates>();
                if let Ok(mut inner) = state.0.lock() {
                    inner.status.downloaded += chunk as u64;
                    inner.status.total = total;
                    let percent = total
                        .filter(|t| *t > 0)
                        .map(|t| inner.status.downloaded.saturating_mul(100) / t);
                    if percent != last_percent
                        || last_notice.elapsed() >= Duration::from_millis(250)
                    {
                        publish(&progress_app, &inner.status);
                        last_percent = percent;
                        last_notice = std::time::Instant::now();
                    }
                };
            },
            || {},
        )
        .await;
    let result = match result {
        Ok(bytes) => {
            {
                let state = app.state::<Updates>();
                let mut inner = state.0.lock().map_err(|e| e.to_string())?;
                inner.status.phase = "installing";
                publish(&app, &inner.status);
            }
            crate::background::run(move || update.install(bytes).map_err(|e| e.to_string())).await
        }
        Err(error) => Err(error.to_string()),
    };
    let state = app.state::<Updates>();
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(()) => inner.status.phase = "ready",
        Err(error) => {
            inner.status.phase = "error";
            inner.status.error = Some(error.to_string());
        }
    }
    publish(&app, &inner.status);
    Ok(())
}

#[tauri::command]
pub(crate) fn restart_after_update(app: AppHandle) -> Result<(), String> {
    if get_update_status(app.clone())?.phase != "ready" {
        return Err("更新尚未安装".into());
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_project_link(kind: String) -> Result<(), String> {
    crate::background::run(move || {
        let url = match kind.as_str() {
            "project" => "https://github.com/Chikomago/CPaste",
            "license" => "https://github.com/Chikomago/CPaste/blob/main/LICENSE",
            _ => return Err("未知链接".into()),
        };
        #[cfg(target_os = "macos")]
        let result = std::process::Command::new("open").arg(url).spawn();
        #[cfg(target_os = "windows")]
        let result = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let result = std::process::Command::new("xdg-open").arg(url).spawn();
        result.map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

pub(crate) fn start(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        loop {
            let enabled = prefs(&app.state::<Arc<State>>())
                .map(|p| p.auto_check_updates)
                .unwrap_or(false);
            if enabled {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = check_for_updates(handle).await;
                });
            }
            std::thread::sleep(Duration::from_secs(6 * 60 * 60));
        }
    });
}
