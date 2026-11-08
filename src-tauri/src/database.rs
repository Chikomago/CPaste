use crate::models::{Preferences, State};
use crate::state::{db, err, now, prefs};
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let c = Connection::open(dir.join("cpaste.db")).map_err(err)?;
    c.pragma_update(None, "journal_mode", "WAL").map_err(err)?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS clips(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,plain_text TEXT NOT NULL,html TEXT,rtf TEXT,files_json TEXT NOT NULL,image_data BLOB,source_app TEXT NOT NULL,source_path TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL);
 CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS clips_created ON clips(created_at DESC);
 CREATE INDEX IF NOT EXISTS clips_group ON clips(group_id);").map_err(err)?;
    let _ = c.execute(
        "ALTER TABLE clips ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
        [],
    );
    migrate_clip_sort_fields(&c)?;
    let _ = c.execute(
        "ALTER TABLE groups ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder'",
        [],
    );
    Ok(c)
}
pub(crate) fn migrate_clip_sort_fields(c: &Connection) -> Result<(), String> {
    let _ = c.execute(
        "ALTER TABLE clips ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = c.execute(
        "ALTER TABLE clips ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
        [],
    );
    c.execute(
        "UPDATE clips SET updated_at=created_at WHERE updated_at=0",
        [],
    )
    .map_err(err)?;
    Ok(())
}
pub(crate) fn load_prefs(c: &Connection) -> Preferences {
    c.query_row(
        "SELECT value FROM app_settings WHERE key='preferences'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}
pub(crate) fn database_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("cpaste.db"))
}
#[tauri::command]
pub(crate) fn get_database_size(app: AppHandle) -> Result<u64, String> {
    let path = database_path(&app)?;
    Ok([
        path.clone(),
        path.with_file_name("cpaste.db-wal"),
        path.with_file_name("cpaste.db-shm"),
    ]
    .iter()
    .filter_map(|file| std::fs::metadata(file).ok().map(|metadata| metadata.len()))
    .sum())
}
pub(crate) fn cleanup(s: &State) -> Result<(), String> {
    let p = prefs(s)?;
    let c = db(s)?;
    if p.retention_days > 0 {
        c.execute(
            "DELETE FROM clips WHERE pinned=0 AND favorite=0 AND created_at<?1",
            [now() - p.retention_days * 86400],
        )
        .map_err(err)?;
    }
    if p.max_items > 0 {
        c.execute("DELETE FROM clips WHERE id IN(SELECT id FROM clips WHERE pinned=0 AND favorite=0 ORDER BY id DESC LIMIT -1 OFFSET ?1)",[p.max_items]).map_err(err)?;
    }
    let mut size:i64=c.query_row("SELECT COALESCE(SUM(LENGTH(plain_text)+LENGTH(COALESCE(html,''))+LENGTH(COALESCE(rtf,''))+LENGTH(files_json)+LENGTH(COALESCE(image_data,x''))),0) FROM clips",[],|r|r.get(0)).map_err(err)?;
    while p.max_storage_mb > 0 && size > p.max_storage_mb * 1048576 {
        if c.execute(
            "DELETE FROM clips WHERE id=(SELECT id FROM clips WHERE pinned=0 AND favorite=0 ORDER BY id LIMIT 1)",
            [],
        )
        .map_err(err)?
            == 0
        {
            break;
        }
        size=c.query_row("SELECT COALESCE(SUM(LENGTH(plain_text)+LENGTH(COALESCE(html,''))+LENGTH(COALESCE(rtf,''))+LENGTH(files_json)+LENGTH(COALESCE(image_data,x''))),0) FROM clips",[],|r|r.get(0)).map_err(err)?;
    }
    Ok(())
}
