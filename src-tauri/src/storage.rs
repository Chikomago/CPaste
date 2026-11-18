use crate::{
    models::State,
    state::{db, err},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StorageKind {
    Database,
    Originals,
    Thumbnails,
    Icons,
}
#[derive(Serialize)]
pub(crate) struct StorageItem {
    kind: StorageKind,
    bytes: u64,
    included: bool,
}
#[derive(Serialize)]
pub(crate) struct StorageReport {
    total: u64,
    items: Vec<StorageItem>,
}
struct Locations {
    database: PathBuf,
    resources: PathBuf,
}
impl Locations {
    fn for_app(app: &AppHandle) -> Result<Self, String> {
        let database = crate::database::database_path(app)?;
        let parent = database.parent().ok_or("数据目录不可用")?;
        Ok(Self {
            resources: parent.join("resources"),
            database,
        })
    }
    fn image_dir(&self, thumbnail: bool) -> PathBuf {
        self.resources.join("clipboard-images").join(if thumbnail {
            "thumbnails"
        } else {
            "origin"
        })
    }
}
fn file_bytes(path: &Path) -> u64 {
    std::fs::metadata(path).map(|file| file.len()).unwrap_or(0)
}
fn report(paths: &Locations) -> StorageReport {
    let items = vec![
        StorageItem {
            kind: StorageKind::Database,
            bytes: [
                paths.database.clone(),
                paths.database.with_extension("db-wal"),
                paths.database.with_extension("db-shm"),
            ]
            .iter()
            .map(|p| file_bytes(p))
            .sum(),
            included: true,
        },
        StorageItem {
            kind: StorageKind::Originals,
            bytes: crate::resources::directory_size(&paths.image_dir(false)),
            included: true,
        },
        StorageItem {
            kind: StorageKind::Thumbnails,
            bytes: crate::resources::directory_size(&paths.image_dir(true)),
            included: true,
        },
        StorageItem {
            kind: StorageKind::Icons,
            bytes: crate::resources::directory_size(&paths.resources.join("app-icons")),
            included: true,
        },
    ];
    StorageReport {
        total: items
            .iter()
            .filter(|item| item.included)
            .map(|item| item.bytes)
            .sum(),
        items,
    }
}
fn remove_directory(path: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(err(error)),
    }
}
fn clear_local(
    c: &mut rusqlite::Connection,
    paths: &Locations,
    kind: StorageKind,
) -> Result<Option<Vec<i64>>, String> {
    match kind {
        StorageKind::Database => {
            c.execute_batch(
                "PRAGMA wal_checkpoint(TRUNCATE);VACUUM;PRAGMA wal_checkpoint(TRUNCATE);",
            )
            .map_err(err)?;
        }
        StorageKind::Originals => {
            let ids = {
                let mut q = c
                    .prepare("SELECT id FROM clips WHERE kind='image'")
                    .map_err(err)?;
                let ids = q
                    .query_map([], |row| row.get::<_, i64>(0))
                    .map_err(err)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(err)?;
                ids
            };
            crate::clipboard::delete_clip_scope(c, &ids)?;
            crate::resources::collect_unused(c)?;
            return Ok(Some(ids));
        }
        StorageKind::Thumbnails => remove_directory(&paths.image_dir(true))?,
        StorageKind::Icons => {
            c.execute("DELETE FROM app_icons", []).map_err(err)?;
            remove_directory(&paths.resources.join("app-icons"))?;
        }
    }
    Ok(None)
}
#[tauri::command]
pub(crate) async fn get_storage_breakdown(app: AppHandle) -> Result<StorageReport, String> {
    let paths = Locations::for_app(&app)?;
    crate::background::run(move || Ok(report(&paths))).await
}
#[tauri::command]
pub(crate) async fn clear_storage_category(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
    kind: StorageKind,
) -> Result<StorageReport, String> {
    {
        let paths = Locations::for_app(&app)?;
        let state = s.inner().clone();
        let result =
            crate::background::write(move || clear_local(&mut *db(&state)?, &paths, kind)).await;
        if matches!(
            kind,
            StorageKind::Originals | StorageKind::Thumbnails | StorageKind::Icons
        ) {
            let _ = app.emit("media-cache-cleared", serde_json::json!({"kind":kind}));
        }
        match result? {
            Some(ids) => {
                crate::content_tools::remove_external_preview_scope(&app, &ids);
                app.emit("clips-changed", serde_json::json!({"deleted_ids":ids}))
                    .map_err(err)?;
            }
            None => (),
        }
    }
    app.emit("storage-changed", ()).map_err(err)?;
    get_storage_breakdown(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn category_cleanup_preserves_other_records_and_reports_backups_separately() {
        let root = std::env::temp_dir().join(format!(
            "cpaste-storage-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("cpaste.db");
        let mut c = rusqlite::Connection::open(&database).unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,image_data BLOB);INSERT INTO clips VALUES(1,'image',NULL),(2,'text',NULL);").unwrap();
        crate::resources::migrate_schema(&c).unwrap();
        let image =
            crate::media_tools::encode(&image::DynamicImage::new_rgb8(4, 4), "png", 80).unwrap();
        let key = crate::resources::attach(&c, 1, &image).unwrap();
        crate::resources::cache_thumbnail(&c, &key, &image).unwrap();
        crate::resources::cache_icon(&c, "app", "1", &image).unwrap();
        let paths = Locations {
            database,
            resources: root.join("resources"),
        };
        let backup = root.join("before.cpaste");
        std::fs::write(&backup, b"backup").unwrap();
        let before = report(&paths);
        assert_eq!(
            before.total,
            before
                .items
                .iter()
                .filter(|item| item.included)
                .map(|item| item.bytes)
                .sum::<u64>()
        );
        clear_local(&mut c, &paths, StorageKind::Thumbnails).unwrap();
        assert!(crate::resources::image_path(&c, &key, false)
            .unwrap()
            .exists());
        assert!(!crate::resources::image_path(&c, &key, true)
            .unwrap()
            .exists());
        clear_local(&mut c, &paths, StorageKind::Icons).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM app_icons", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(backup.exists());
        assert_eq!(
            clear_local(&mut c, &paths, StorageKind::Originals).unwrap(),
            Some(vec![1])
        );
        assert_eq!(
            c.query_row("SELECT id FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        clear_local(&mut c, &paths, StorageKind::Database).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(backup.exists());
        drop(c);
        let _ = std::fs::remove_dir_all(root);
    }
}
