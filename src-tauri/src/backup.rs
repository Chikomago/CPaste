use crate::database::migrate_clip_sort_fields;
use crate::models::{Preferences, State};
use crate::preferences::{activate_preferences, validate_preferences};
use crate::state::{db, err};
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub(crate) fn export_snapshot(source: &Connection, path: &std::path::Path) -> Result<(), String> {
    let mut destination = Connection::open(path).map_err(err)?;
    Backup::new(source, &mut destination)
        .map_err(err)?
        .run_to_completion(100, Duration::from_millis(10), None)
        .map_err(err)?;
    crate::resources::migrate_schema(&destination)?;
    let rows = {
        let mut q = destination
            .prepare("SELECT id,image_key FROM clips WHERE image_key IS NOT NULL")
            .map_err(err)?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    let transaction = destination.transaction().map_err(err)?;
    for (id, key) in rows {
        let bytes = crate::resources::read(source, &key)?;
        transaction
            .execute(
                "UPDATE clips SET image_data=?1,image_key=NULL WHERE id=?2",
                rusqlite::params![bytes, id],
            )
            .map_err(err)?;
    }
    transaction.execute_batch("DROP TRIGGER IF EXISTS delete_clip_thumbnail;DROP TRIGGER IF EXISTS invalidate_clip_thumbnail;DROP TABLE IF EXISTS clip_thumbnails;DELETE FROM app_icons;").map_err(err)?;
    transaction.commit().map_err(err)?;
    destination
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);PRAGMA journal_mode=DELETE;VACUUM;")
        .map_err(err)?;
    Ok(())
}
pub(crate) fn restore_snapshot(
    destination: &mut Connection,
    source: &Connection,
) -> Result<(), String> {
    let root = crate::resources::root(destination)?;
    let parent = root.parent().ok_or("数据目录不可用")?;
    std::fs::create_dir_all(parent).map_err(err)?;
    let temporary = parent.join(format!(
        ".restore-{}-{}.db",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    let result = (|| {
        let mut staged = Connection::open(&temporary).map_err(err)?;
        Backup::new(source, &mut staged)
            .map_err(err)?
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(err)?;
        migrate_clip_sort_fields(&staged)?;
        crate::resources::migrate_images(&mut staged, false)?;
        Backup::new(&staged, destination)
            .map_err(err)?
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(err)?;
        Ok(())
    })();
    for path in [
        temporary.clone(),
        temporary.with_extension("db-wal"),
        temporary.with_extension("db-shm"),
    ] {
        let _ = std::fs::remove_file(path);
    }
    let _ = crate::resources::collect_unused(destination);
    result
}
#[tauri::command]
pub(crate) async fn backup_database(
    s: tauri::State<'_, Arc<State>>,
) -> Result<Option<String>, String> {
    let name = format!(
        "CPaste-{}.cpaste",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let Some(path) = rfd::AsyncFileDialog::new()
        .add_filter("CPaste 备份", &["cpaste"])
        .set_file_name(&name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = path.path().to_path_buf();
    let state = s.inner().clone();
    crate::background::run(move || {
        let s = state;
        let temporary = path.with_file_name(format!("{}.tmp", name));
        let _ = std::fs::remove_file(&temporary);
        let result = (|| -> Result<(), String> {
            let source = db(&s)?;
            export_snapshot(&source, &temporary)?;
            drop(source);
            if path.exists() {
                std::fs::remove_file(&path).map_err(err)?;
            }
            std::fs::rename(&temporary, &path).map_err(err)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map(|()| Some(path.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub(crate) async fn choose_restore_file() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .add_filter("CPaste 备份", &["cpaste"])
        .pick_file()
        .await
        .map(|path| path.path().to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) async fn restore_database(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    path: String,
) -> Result<(), String> {
    let state = s.inner().clone();
    crate::background::write(move || {
        let s = state;
        let mut uri = tauri::Url::from_file_path(std::path::Path::new(&path))
            .map_err(|_| "无法打开备份文件".to_string())?;
        uri.query_pairs_mut().append_pair("immutable", "1");
        let source = Connection::open_with_flags(
            uri.as_str(),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
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
            restore_snapshot(&mut destination, &source)?;
        }
        activate_preferences(&app, &s, restored, false)?;
        app.emit("dictionary-changed", ()).map_err(err)?;
        app.emit("rules-changed", serde_json::json!({"reset":true}))
            .map_err(err)?;
        app.emit("clips-changed", serde_json::json!({"reset":true}))
            .map_err(err)
    })
    .await
}
