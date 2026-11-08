use crate::database::migrate_clip_sort_fields;
use crate::models::{Preferences, State};
use crate::preferences::{activate_preferences, validate_preferences};
use crate::state::{db, err};
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub(crate) fn backup_database(s: tauri::State<Arc<State>>) -> Result<Option<String>, String> {
    let name = format!(
        "CPaste-{}.cpaste",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let Some(path) = rfd::FileDialog::new()
        .add_filter("CPaste 备份", &["cpaste"])
        .set_file_name(&name)
        .save_file()
    else {
        return Ok(None);
    };
    let temporary = path.with_file_name(format!("{}.tmp", name));
    let _ = std::fs::remove_file(&temporary);
    let result = (|| -> Result<(), String> {
        let mut destination = Connection::open(&temporary).map_err(err)?;
        let source = db(&s)?;
        Backup::new(&source, &mut destination)
            .map_err(err)?
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(err)?;
        drop(source);
        drop(destination);
        if path.exists() {
            std::fs::remove_file(&path).map_err(err)?;
        }
        std::fs::rename(&temporary, &path).map_err(err)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map(|()| Some(path.to_string_lossy().into_owned()))
}
#[tauri::command]
pub(crate) fn choose_restore_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("CPaste 备份", &["cpaste"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) fn restore_database(
    app: AppHandle,
    s: tauri::State<Arc<State>>,
    path: String,
) -> Result<(), String> {
    let source = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "无法打开备份文件".to_string())?;
    let check: String = source
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(err)?;
    if check != "ok" {
        return Err("备份文件已损坏".into());
    }
    let raw: String = source
        .query_row(
            "SELECT value FROM app_settings WHERE key='preferences'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "非 CPaste 备份".to_string())?;
    let restored: Preferences =
        serde_json::from_str(&raw).map_err(|_| "备份设置无法读取".to_string())?;
    validate_preferences(&restored)?;
    source
        .query_row("SELECT id FROM clips LIMIT 1", [], |row| {
            row.get::<_, i64>(0)
        })
        .optional()
        .map_err(|_| "备份记录无法读取".to_string())?;
    {
        let mut destination = db(&s)?;
        Backup::new(&source, &mut destination)
            .map_err(err)?
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(err)?;
        migrate_clip_sort_fields(&destination)?;
    }
    activate_preferences(&app, &s, restored, false)?;
    app.emit("dictionary-changed", ()).map_err(err)?;
    app.emit("clips-changed", ()).map_err(err)
}
