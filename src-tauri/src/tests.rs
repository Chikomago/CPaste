use super::*;
use crate::capture::source_is_excluded;
use crate::clipboard::{should_copy_plain, should_paste_plain};
use crate::clips::thumbnail_png;
use crate::database::{cleanup, migrate_clip_sort_fields};
use crate::models::{Preferences, State};
use crate::preferences::validate_preferences;
use crate::privacy::{contains_sensitive, mask_sensitive};
use crate::state::{db, now};
use crate::windows::cursor_on_monitor;
use rusqlite::backup::Backup;
use rusqlite::Connection;

#[test]
fn legacy_clips_get_sort_fields_without_losing_creation_time() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL); INSERT INTO clips(id,created_at) VALUES(1,12345);").unwrap();
    migrate_clip_sort_fields(&c).unwrap();
    migrate_clip_sort_fields(&c).unwrap();
    let fields: (i64, i64) = c
        .query_row(
            "SELECT updated_at,use_count FROM clips WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(fields, (12345, 0));
}

#[test]
fn new_appearance_preferences_default_for_existing_settings() {
    let preferences: Preferences = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
    assert_eq!(preferences.language, "zh-CN");
    assert_eq!(preferences.default_filter, "all");
    assert!(preferences.return_to_top_after_paste);
    assert!(!preferences.show_source_app_icon);
    assert!(preferences.auto_check_updates);
    assert_eq!(preferences.item_max_lines, 2);
    assert!(validate_preferences(&preferences).is_ok());
}

#[test]
fn shortcut_positions_include_all_four_sides() {
    let mut preferences = Preferences::default();
    for position in ["center", "cursor", "left", "right", "top", "bottom"] {
        preferences.popup_position = position.into();
        assert!(validate_preferences(&preferences).is_ok(), "{position}");
    }
    preferences.popup_position = "unknown".into();
    assert!(validate_preferences(&preferences).is_err());
}

#[test]
fn action_shortcuts_migrate_and_reject_conflicts() {
    let p: Preferences = serde_json::from_str("{}").unwrap();
    assert_eq!(
        p.action_shortcuts.get("paste").map(String::as_str),
        Some("Enter")
    );
    assert!(validate_preferences(&p).is_ok());
    let mut conflicting = p.clone();
    conflicting
        .action_shortcuts
        .insert("copy".into(), "Enter".into());
    assert!(validate_preferences(&conflicting).is_err());
    conflicting
        .action_shortcuts
        .insert("copy".into(), conflicting.shortcut.clone());
    assert!(validate_preferences(&conflicting).is_err());
}

#[test]
fn default_paste_formats_apply_to_matching_record_types() {
    let mut preferences = Preferences::default();
    preferences.default_plain_paste = true;
    preferences.default_file_paths = true;
    assert!(should_paste_plain("rich", &preferences, None));
    assert!(should_paste_plain("text", &preferences, None));
    assert!(should_paste_plain("files", &preferences, None));
    assert!(!should_paste_plain("image", &preferences, None));
    assert!(!should_paste_plain("rich", &preferences, Some(false)));
    assert!(!should_paste_plain("files", &preferences, Some(false)));
    assert!(should_paste_plain(
        "files",
        &Preferences::default(),
        Some(true)
    ));
}

#[test]
fn default_copy_formats_apply_to_matching_record_types() {
    let mut p = Preferences::default();
    p.default_plain_copy = true;
    p.default_copy_file_paths = true;
    assert!(should_copy_plain("rich", &p, None));
    assert!(should_copy_plain("text", &p, None));
    assert!(should_copy_plain("files", &p, None));
    assert!(!should_copy_plain("image", &p, None));
    assert!(!should_copy_plain("rich", &p, Some(false)));
    assert!(!should_copy_plain("files", &p, Some(false)));
}

#[test]
fn blocked_bundle_matches_its_executable_source() {
    assert!(source_is_excluded(
        &["/Applications/Example.app".into()],
        "Example",
        "/Applications/Example.app/Contents/MacOS/Example"
    ));
}

#[test]
fn sqlite_backup_preserves_records_and_settings() {
    let source = Connection::open_in_memory().unwrap();
    source.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY, image_data BLOB); CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
    source
        .execute(
            "INSERT INTO clips(image_data) VALUES(?1)",
            [vec![0, 1, 255, 42]],
        )
        .unwrap();
    source
        .execute(
            "INSERT INTO app_settings(key,value) VALUES('preferences', ?1)",
            [r#"{"theme":"dark"}"#],
        )
        .unwrap();
    let mut backup = Connection::open_in_memory().unwrap();
    Backup::new(&source, &mut backup)
        .unwrap()
        .run_to_completion(100, Duration::from_millis(1), None)
        .unwrap();
    let image: Vec<u8> = backup
        .query_row("SELECT image_data FROM clips", [], |row| row.get(0))
        .unwrap();
    let settings: String = backup
        .query_row("SELECT value FROM app_settings", [], |row| row.get(0))
        .unwrap();
    assert_eq!(image, vec![0, 1, 255, 42]);
    assert_eq!(settings, r#"{"theme":"dark"}"#);
}

#[test]
fn image_thumbnail_has_bounded_size() {
    let source = image::DynamicImage::new_rgb8(800, 400);
    let mut bytes = std::io::Cursor::new(Vec::new());
    source
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let result = thumbnail_png(&bytes.into_inner()).unwrap();
    let image = image::load_from_memory(&result).unwrap();
    assert_eq!((image.width(), image.height()), (768, 384));
    let small = image::DynamicImage::new_rgb8(40, 20);
    let mut bytes = std::io::Cursor::new(Vec::new());
    small.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let result = thumbnail_png(&bytes.into_inner()).unwrap();
    let image = image::load_from_memory(&result).unwrap();
    assert_eq!((image.width(), image.height()), (40, 20));
}

#[test]
fn physical_cursor_selects_retina_monitor() {
    let cursor = tauri::PhysicalPosition::new(964.0, 1787.0);
    let origin = tauri::PhysicalPosition::new(0, 0);
    let size = tauri::PhysicalSize::new(3360, 2100);
    assert!(cursor_on_monitor(cursor, origin, size));
    assert!(!cursor_on_monitor(
        tauri::PhysicalPosition::new(3500.0, 1787.0),
        origin,
        size
    ));
}

#[test]
fn sensitive_values_are_masked_without_losing_labels() {
    let text = "api_key=sk-abcdefghijklmnopqrstuvwxyz123456";
    assert_eq!(mask_sensitive(text), "api_key=sk-******456");
    assert_eq!(mask_sensitive("password=abcdefg"), "password=abc******efg");
    assert_eq!(mask_sensitive("password=abcdef"), "password=******");
    assert!(contains_sensitive(text, None, None, &[]));
    assert!(!contains_sensitive("普通文字", None, None, &[]));
}

#[test]
fn cleanup_keeps_pinned_and_newest_unpinned() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,image_data BLOB,created_at INTEGER,pinned INTEGER,favorite INTEGER);").unwrap();
    let timestamp = now();
    c.execute(
        "INSERT INTO clips VALUES(1,'old',NULL,NULL,'[]',NULL,?1,0,0)",
        [timestamp - 100_000],
    )
    .unwrap();
    c.execute(
        "INSERT INTO clips VALUES(2,'pinned',NULL,NULL,'[]',NULL,?1,1,0)",
        [timestamp - 100_000],
    )
    .unwrap();
    c.execute(
        "INSERT INTO clips VALUES(3,'new',NULL,NULL,'[]',NULL,?1,0,0)",
        [timestamp],
    )
    .unwrap();
    c.execute(
        "INSERT INTO clips VALUES(4,'favorite',NULL,NULL,'[]',NULL,?1,0,1)",
        [timestamp - 100_000],
    )
    .unwrap();
    let mut p = Preferences::default();
    p.retention_days = 1;
    p.max_items = 1;
    let state = State {
        db: Mutex::new(c),
        prefs: Mutex::new(p),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    };
    cleanup(&state).unwrap();
    let ids: Vec<i64> = db(&state)
        .unwrap()
        .prepare("SELECT id FROM clips ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(ids, vec![2, 3, 4]);
}

#[test]
fn zero_storage_limits_keep_old_records() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,image_data BLOB,created_at INTEGER,pinned INTEGER,favorite INTEGER); INSERT INTO clips VALUES(1,'old',NULL,NULL,'[]',NULL,1,0,0);").unwrap();
    let mut p = Preferences::default();
    p.retention_days = 0;
    p.max_items = 0;
    p.max_storage_mb = 0;
    validate_preferences(&p).unwrap();
    let state = State {
        db: Mutex::new(c),
        prefs: Mutex::new(p),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    };
    cleanup(&state).unwrap();
    let count: i64 = db(&state)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
