//! Immutable image resources; SQLite stores relative content keys and metadata.
use crate::state::err;
use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn migrate_schema(c: &Connection) -> Result<(), String> {
    let columns = {
        let mut q = c.prepare("PRAGMA table_info(clips)").map_err(err)?;
        let columns = q
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        columns
    };
    for (name, kind) in [
        ("image_key", "TEXT"),
        ("image_size", "INTEGER"),
        ("image_format", "TEXT"),
    ] {
        if !columns.iter().any(|column| column == name) {
            c.execute_batch(&format!("ALTER TABLE clips ADD COLUMN {name} {kind}"))
                .map_err(err)?;
        }
    }
    c.execute_batch("CREATE TABLE IF NOT EXISTS app_icons(source_path TEXT PRIMARY KEY,stamp TEXT NOT NULL,image_key TEXT NOT NULL);").map_err(err)
}
pub(crate) fn root(c: &Connection) -> Result<PathBuf, String> {
    let file: String = c
        .query_row("PRAGMA database_list", [], |r| r.get(2))
        .map_err(err)?;
    if !file.is_empty() {
        return Ok(Path::new(&file)
            .parent()
            .ok_or("数据目录不可用")?
            .join("resources"));
    }
    #[cfg(test)]
    {
        c.execute_batch("CREATE TEMP TABLE IF NOT EXISTS test_resource_root(path TEXT NOT NULL);")
            .map_err(err)?;
        let existing: Option<String> = c
            .query_row("SELECT path FROM test_resource_root LIMIT 1", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(path) = existing {
            return Ok(path.into());
        }
        let path = std::env::temp_dir().join(format!(
            "cpaste-resources-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        c.execute(
            "INSERT INTO test_resource_root VALUES(?1)",
            [path.to_string_lossy().as_ref()],
        )
        .map_err(err)?;
        return Ok(path);
    }
    #[cfg(not(test))]
    Err("图片资源需要本机数据目录".into())
}
pub(crate) fn content_key(bytes: &[u8]) -> Result<String, String> {
    let extension = image::guess_format(bytes).map_err(err)?.extensions_str()[0];
    Ok(format!(
        "{}.{extension}",
        hex::encode(Sha256::digest(bytes))
    ))
}
fn validate_key(key: &str) -> Result<&str, String> {
    let (hash, ext) = key.split_once('.').ok_or("图片资源标识无效")?;
    if hash.len() != 64
        || !hash.bytes().all(|v| v.is_ascii_hexdigit())
        || ext.is_empty()
        || ext.len() > 8
        || !ext.bytes().all(|v| v.is_ascii_alphanumeric())
    {
        return Err("图片资源标识无效".into());
    }
    Ok(hash)
}
pub(crate) fn image_path(c: &Connection, key: &str, thumbnail: bool) -> Result<PathBuf, String> {
    let hash = validate_key(key)?;
    Ok(root(c)?
        .join("clipboard-images")
        .join(if thumbnail { "thumbnails" } else { "origin" })
        .join(&hash[..2])
        .join(if thumbnail {
            format!("{hash}.png")
        } else {
            key.to_owned()
        }))
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.is_file() && std::fs::read(path).map_err(err)? == bytes {
        return Ok(());
    }
    let parent = path.parent().ok_or("图片目录不可用")?;
    std::fs::create_dir_all(parent).map_err(err)?;
    let temporary = parent.join(format!(
        ".write-{}-{}",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        if path.exists() {
            std::fs::remove_file(path).map_err(err)?;
        }
        std::fs::rename(&temporary, path).map_err(err)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
pub(crate) fn store(c: &Connection, bytes: &[u8]) -> Result<String, String> {
    let key = content_key(bytes)?;
    write_atomic(&image_path(c, &key, false)?, bytes)?;
    Ok(key)
}
pub(crate) fn read(c: &Connection, key: &str) -> Result<Vec<u8>, String> {
    std::fs::read(image_path(c, key, false)?).map_err(err)
}
pub(crate) fn attach(c: &Connection, id: i64, bytes: &[u8]) -> Result<String, String> {
    let key = store(c, bytes)?;
    let format = image::guess_format(bytes).map_err(err)?.extensions_str()[0].to_uppercase();
    c.execute(
        "UPDATE clips SET image_key=?1,image_size=?2,image_format=?3,image_data=NULL WHERE id=?4",
        rusqlite::params![key, bytes.len() as i64, format, id],
    )
    .map_err(err)?;
    Ok(key)
}
pub(crate) fn migrate_images(c: &mut Connection, safety_copy: bool) -> Result<(), String> {
    migrate_schema(c)?;
    let ids = {
        let mut q = c
            .prepare("SELECT id FROM clips WHERE image_data IS NOT NULL")
            .map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        ids
    };
    if !ids.is_empty() && safety_copy {
        let path: String = c
            .query_row("PRAGMA database_list", [], |r| r.get(2))
            .map_err(err)?;
        if !path.is_empty() {
            let backup = Path::new(&path).with_file_name("cpaste-before-resources.cpaste");
            if !backup.exists() {
                let temporary = backup.with_extension("cpaste.tmp");
                let result = crate::backup::export_snapshot(c, &temporary)
                    .and_then(|()| std::fs::rename(&temporary, &backup).map_err(err));
                if result.is_err() {
                    let _ = std::fs::remove_file(&temporary);
                }
                result?;
            }
        }
    }
    let transaction = c.transaction().map_err(err)?;
    for id in &ids {
        let bytes: Vec<u8> = transaction
            .query_row("SELECT image_data FROM clips WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        attach(&transaction, *id, &bytes)?;
    }
    transaction.execute_batch("DROP TRIGGER IF EXISTS delete_clip_thumbnail;DROP TRIGGER IF EXISTS invalidate_clip_thumbnail;DROP TABLE IF EXISTS clip_thumbnails;").map_err(err)?;
    transaction.commit().map_err(err)?;
    if !ids.is_empty() {
        c.execute_batch("VACUUM;").map_err(err)?;
        let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        eprintln!(
            "[resources] migrated {} image records to content-addressed files",
            ids.len()
        );
    }
    Ok(())
}
pub(crate) fn cache_thumbnail(c: &Connection, key: &str, png: &[u8]) -> Result<PathBuf, String> {
    let path = image_path(c, key, true)?;
    write_atomic(&path, png)?;
    Ok(path)
}
pub(crate) fn icon_path(c: &Connection, key: &str) -> Result<PathBuf, String> {
    validate_key(key)?;
    Ok(root(c)?.join("app-icons").join(key))
}
pub(crate) fn cached_icon(
    c: &Connection,
    source: &str,
    stamp: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    use rusqlite::OptionalExtension;
    let cached: Option<(String, String)> = c
        .query_row(
            "SELECT stamp,image_key FROM app_icons WHERE source_path=?1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((revision, key)) = cached {
        if stamp.is_none_or(|stamp| stamp == revision) {
            let path = icon_path(c, &key)?;
            if path.is_file() {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}
pub(crate) fn cache_icon(
    c: &Connection,
    source: &str,
    stamp: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let key = content_key(bytes)?;
    let path = icon_path(c, &key)?;
    write_atomic(&path, bytes)?;
    c.execute("INSERT INTO app_icons(source_path,stamp,image_key) VALUES(?1,?2,?3) ON CONFLICT(source_path) DO UPDATE SET stamp=excluded.stamp,image_key=excluded.image_key",rusqlite::params![source,stamp,key]).map_err(err)?;
    Ok(path)
}
pub(crate) fn collect_unused(c: &Connection) -> Result<(), String> {
    migrate_schema(c)?;
    let keys = {
        let mut q = c
            .prepare("SELECT image_key FROM clips WHERE image_key IS NOT NULL")
            .map_err(err)?;
        let keys = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(err)?;
        keys
    };
    let hashes: HashSet<_> = keys
        .iter()
        .filter_map(|key| validate_key(key).ok().map(str::to_owned))
        .collect();
    let base = root(c)?.join("clipboard-images");
    for (kind, thumbnail) in [("origin", false), ("thumbnails", true)] {
        if let Ok(shards) = std::fs::read_dir(base.join(kind)) {
            for shard in shards.flatten() {
                if let Ok(files) = std::fs::read_dir(shard.path()) {
                    for file in files.flatten() {
                        let name = file.file_name().to_string_lossy().into_owned();
                        let keep = if thumbnail {
                            name.strip_suffix(".png")
                                .is_some_and(|hash| hashes.contains(hash))
                        } else {
                            keys.contains(&name)
                        };
                        if !keep && file.path().is_file() {
                            let _ = std::fs::remove_file(file.path());
                        }
                    }
                }
                let _ = std::fs::remove_dir(shard.path());
            }
        }
    }
    let icons = {
        let mut q = c.prepare("SELECT image_key FROM app_icons").map_err(err)?;
        let keys = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(err)?;
        keys
    };
    if let Ok(files) = std::fs::read_dir(root(c)?.join("app-icons")) {
        for file in files.flatten() {
            if !icons.contains(file.file_name().to_string_lossy().as_ref()) {
                let _ = std::fs::remove_file(file.path());
            }
        }
    }
    Ok(())
}
pub(crate) fn directory_size(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .map(|files| {
            files
                .flatten()
                .map(|file| match file.file_type() {
                    Ok(kind) if kind.is_dir() => directory_size(&file.path()),
                    Ok(kind) if kind.is_file() => file.metadata().map(|m| m.len()).unwrap_or(0),
                    _ => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture() -> (Directory, Connection) {
        let dir = std::env::temp_dir().join(format!(
            "cpaste-resource-test-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let c = Connection::open(dir.join("cpaste.db")).unwrap();
        c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,image_data BLOB,created_at INTEGER NOT NULL DEFAULT 0);CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO app_settings VALUES('preferences','{}');").unwrap();
        (Directory(dir), c)
    }
    fn image_bytes(format: image::ImageFormat) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1600,
            900,
            image::Rgba([10, 20, 30, 255]),
        ));
        crate::media_tools::encode(&image, format.extensions_str()[0], 80).unwrap()
    }
    #[test]
    fn lazy_file_thumbnails_are_hashed_sharded_persistent_and_shared() {
        let (_dir, mut c) = fixture();
        let png = image_bytes(image::ImageFormat::Png);
        c.execute(
            "INSERT INTO clips(id,image_data) VALUES(1,?1),(2,?1)",
            [&png],
        )
        .unwrap();
        migrate_images(&mut c, true).unwrap();
        let key: String = c
            .query_row("SELECT image_key FROM clips WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(key, content_key(&png).unwrap());
        assert_eq!(read(&c, &key).unwrap(), png);
        assert!(image_path(&c, &key, false)
            .unwrap()
            .ends_with(Path::new("origin").join(&key[..2]).join(&key)));
        let thumb = image_path(&c, &key, true).unwrap();
        assert!(!thumb.exists(), "migration must not generate thumbnails");
        let thumbnail = crate::clips::thumbnail_png(&png).unwrap();
        let path = cache_thumbnail(&c, &key, &thumbnail).unwrap();
        let image = image::open(&path).unwrap();
        assert_eq!(image.width(), 300);
        assert!(image.height() <= 300);
        let modified = path.metadata().unwrap().modified().unwrap();
        assert_eq!(cache_thumbnail(&c, &key, &thumbnail).unwrap(), path);
        assert_eq!(path.metadata().unwrap().modified().unwrap(), modified);
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM clips WHERE image_data IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        c.execute("DELETE FROM clips WHERE id=1", []).unwrap();
        collect_unused(&c).unwrap();
        assert!(path.exists());
        c.execute("DELETE FROM clips WHERE id=2", []).unwrap();
        collect_unused(&c).unwrap();
        assert!(!path.exists());
        assert!(!image_path(&c, &key, false).unwrap().exists());
        assert!(image_path(&c, "../../cpaste.db", false).is_err());
    }
    #[test]
    fn legacy_migration_and_portable_backup_restore_keep_original_bytes() {
        let (source_dir, mut c) = fixture();
        let png = image_bytes(image::ImageFormat::Png);
        let jpeg = image_bytes(image::ImageFormat::Jpeg);
        c.execute("INSERT INTO clips(id,image_data) VALUES(1,?1)", [&png])
            .unwrap();
        c.execute("INSERT INTO clips(id,image_data) VALUES(2,?1)", [&jpeg])
            .unwrap();
        migrate_images(&mut c, true).unwrap();
        assert!(source_dir
            .0
            .join("cpaste-before-resources.cpaste")
            .is_file());
        let backup = source_dir.0.join("portable.cpaste");
        crate::backup::export_snapshot(&c, &backup).unwrap();
        assert_eq!(
            &std::fs::read(&backup).unwrap()[18..20],
            &[1, 1],
            "portable backups must not require WAL sidecar files"
        );
        let source = Connection::open(&backup).unwrap();
        assert_eq!(
            source
                .query_row("SELECT image_data FROM clips WHERE id=1", [], |r| r
                    .get::<_, Vec<u8>>(0))
                .unwrap(),
            png
        );
        assert_eq!(
            source
                .query_row("SELECT image_data FROM clips WHERE id=2", [], |r| r
                    .get::<_, Vec<u8>>(0))
                .unwrap(),
            jpeg
        );
        assert_eq!(
            source
                .query_row(
                    "SELECT COUNT(*) FROM clips WHERE image_key IS NOT NULL",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let (_target_dir, mut target) = fixture();
        crate::backup::restore_snapshot(&mut target, &source).unwrap();
        for (id, bytes) in [(1, png), (2, jpeg)] {
            let key: String = target
                .query_row("SELECT image_key FROM clips WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(read(&target, &key).unwrap(), bytes);
        }
    }
    #[test]
    fn failed_migration_rolls_back_and_icons_are_persistent_files() {
        let (_dir, mut c) = fixture();
        let png = image_bytes(image::ImageFormat::Png);
        c.execute(
            "INSERT INTO clips(id,image_data) VALUES(1,?1),(2,x'00')",
            [&png],
        )
        .unwrap();
        assert!(migrate_images(&mut c, false).is_err());
        assert_eq!(
            c.query_row("SELECT image_data FROM clips WHERE id=1", [], |r| r
                .get::<_, Vec<u8>>(0))
                .unwrap(),
            png
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM clips WHERE image_key IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        let first = cache_icon(&c, "app-a", "revision-1", &png).unwrap();
        let second = cache_icon(&c, "app-b", "revision-1", &png).unwrap();
        assert_eq!(first, second);
        assert!(first.is_file());
        assert_eq!(cached_icon(&c, "app-a", None).unwrap(), Some(first.clone()));
        assert_eq!(
            cached_icon(&c, "app-a", Some("revision-1")).unwrap(),
            Some(first.clone())
        );
        assert!(cached_icon(&c, "app-a", Some("revision-2"))
            .unwrap()
            .is_none());
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM app_icons", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}

#[cfg(test)]
mod restore_failure_tests {
    use super::*;
    #[test]
    fn bad_image_backup_does_not_replace_existing_history() {
        let directory = std::env::temp_dir().join(format!(
            "cpaste-restore-check-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("cpaste.db");
        let mut destination = Connection::open(&path).unwrap();
        destination.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,image_data BLOB,created_at INTEGER);INSERT INTO clips VALUES(99,NULL,1);").unwrap();
        let source = Connection::open_in_memory().unwrap();
        source.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,image_data BLOB,created_at INTEGER);INSERT INTO clips VALUES(1,x'00',1);").unwrap();
        assert!(crate::backup::restore_snapshot(&mut destination, &source).is_err());
        assert_eq!(
            destination
                .query_row("SELECT id FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            99
        );
        drop(destination);
        let _ = std::fs::remove_dir_all(directory);
    }
}
