use crate::models::State;
use crate::state::db;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub(crate) struct InstalledApp {
    pub(crate) name: String,
    pub(crate) path: String,
}
#[tauri::command]
pub(crate) async fn list_installed_apps(
    s: tauri::State<'_, Arc<State>>,
) -> Result<Vec<InstalledApp>, String> {
    let state = s.inner().clone();
    crate::background::run(move || Ok(installed_apps(&state))).await
}
fn installed_apps(s: &State) -> Vec<InstalledApp> {
    let mut apps = Vec::new();
    if let Ok(connection) = db(s) {
        if let Ok(mut statement) = connection.prepare("SELECT DISTINCT source_app, source_path FROM clips WHERE source_app <> '' ORDER BY source_app") {
            if let Ok(rows) = statement.query_map([], |row| Ok(InstalledApp { name: row.get(0)?, path: row.get(1)? })) {
                apps.extend(rows.flatten());
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut roots = vec![
            std::path::PathBuf::from("/Applications"),
            std::path::PathBuf::from("/System/Applications"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(std::path::PathBuf::from(home).join("Applications"));
        }
        for root in roots {
            collect_macos_apps(&root, 2, &mut apps);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(data) = std::env::var_os("APPDATA") {
            roots
                .push(std::path::PathBuf::from(data).join("Microsoft/Windows/Start Menu/Programs"));
        }
        if let Some(data) = std::env::var_os("PROGRAMDATA") {
            roots
                .push(std::path::PathBuf::from(data).join("Microsoft/Windows/Start Menu/Programs"));
        }
        for root in roots {
            collect_windows_apps(&root, 5, &mut apps);
        }
    }
    #[cfg(target_os = "macos")]
    for app in &mut apps {
        if let Some(end) = app.path.find(".app") {
            app.path.truncate(end + 4);
        }
    }
    apps.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    apps.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}
#[cfg(target_os = "macos")]
pub(crate) fn collect_macos_apps(
    root: &std::path::Path,
    depth: usize,
    apps: &mut Vec<InstalledApp>,
) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|extension| extension == "app") {
            let info = plist::Value::from_file(path.join("Contents/Info.plist")).ok();
            let name = info
                .as_ref()
                .and_then(|value| value.as_dictionary())
                .and_then(|dictionary| {
                    dictionary
                        .get("CFBundleDisplayName")
                        .or_else(|| dictionary.get("CFBundleName"))
                })
                .and_then(|value| value.as_string())
                .map(str::to_owned)
                .or_else(|| {
                    path.file_stem()
                        .map(|name| name.to_string_lossy().into_owned())
                });
            if let Some(name) = name {
                apps.push(InstalledApp {
                    name,
                    path: path.to_string_lossy().into_owned(),
                });
            }
        } else if path.is_dir() {
            collect_macos_apps(&path, depth - 1, apps);
        }
    }
}
#[cfg(target_os = "windows")]
pub(crate) fn collect_windows_apps(
    root: &std::path::Path,
    depth: usize,
    apps: &mut Vec<InstalledApp>,
) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            if let Some(name) = path.file_stem() {
                apps.push(InstalledApp {
                    name: name.to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                });
            }
        } else if path.is_dir() {
            collect_windows_apps(&path, depth - 1, apps);
        }
    }
}
