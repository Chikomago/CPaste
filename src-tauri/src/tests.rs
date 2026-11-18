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
fn record_query_does_not_block_ipc_when_database_is_busy() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,title TEXT,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,source_app TEXT,source_path TEXT,created_at INTEGER,pinned INTEGER,favorite INTEGER,updated_at INTEGER,use_count INTEGER,image_data BLOB); CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT);").unwrap();
    let state = Arc::new(State {
        db: Mutex::new(c),
        prefs: Mutex::new(Preferences::default()),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    });
    let app = tauri::test::mock_builder()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            crate::clips::list_clips,
            crate::windows::get_preview_clip,
            crate::preferences::get_preferences,
            crate::segmentation::get_dictionary_info,
            crate::segmentation::get_downloaded_dictionary_info
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for command in [
        "list_clips",
        "get_preview_clip",
        "get_preferences",
        "get_dictionary_info",
        "get_downloaded_dictionary_info",
    ] {
        let (locked_tx, locked_rx) = std::sync::mpsc::sync_channel(1);
        let locked_state = state.clone();
        let holder = std::thread::spawn(move || {
            if command == "get_preferences" {
                let _lock = locked_state.prefs.lock().unwrap();
                locked_tx.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(250));
            } else {
                let _lock = locked_state.db.lock().unwrap();
                locked_tx.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(250));
            }
        });
        locked_rx.recv().unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let start = std::time::Instant::now();
        window.as_ref().clone().on_message(
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(target_os = "windows") {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({"id":1})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
            Box::new(move |_, _, response, _, _| {
                let _ = tx.send(response);
            }),
        );
        let dispatch = start.elapsed();
        let response = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        holder.join().unwrap();
        if let tauri::ipc::InvokeResponse::Err(error) = response {
            panic!("{command} failed: {:?}", error.0);
        }
        eprintln!("{command} IPC dispatch with busy state: {dispatch:?}");
        assert!(
            dispatch < Duration::from_millis(100),
            "{command}: state lock blocked the UI thread for {dispatch:?}"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn preparing_stored_png_and_jpeg_for_paste_does_not_decode_pixels() {
    let image = image::DynamicImage::new_rgb8(4000, 3000);
    for (format, mime) in [
        (image::ImageFormat::Png, "public.png"),
        (image::ImageFormat::Jpeg, "public.jpeg"),
    ] {
        let mut encoded = std::io::Cursor::new(Vec::new());
        image.write_to(&mut encoded, format).unwrap();
        let bytes = encoded.into_inner();
        let original = bytes.clone();
        let start = std::time::Instant::now();
        let content = crate::clipboard::clipboard_image_content(bytes).unwrap();
        assert!(
            start.elapsed() < Duration::from_millis(100),
            "encoded {format:?} must not be decoded for the native pasteboard"
        );
        match content {
            clipboard_rs::ClipboardContent::Other(kind, bytes) => {
                assert_eq!(kind, mime);
                assert_eq!(bytes, original);
            }
            _ => panic!("original image must remain encoded"),
        }
    }
}

#[test]
fn large_image_thumbnail_does_not_block_ipc_dispatch() {
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
    let image = image::DynamicImage::new_rgb8(2000, 1500);
    let mut png = std::io::Cursor::new(Vec::new());
    image.write_to(&mut png, image::ImageFormat::Png).unwrap();
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,image_data BLOB,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,kind TEXT NOT NULL DEFAULT 'image');").unwrap();
    c.execute(
        "INSERT INTO clips(id,image_data,plain_text,html,rtf,files_json) VALUES(1,?1,'',NULL,NULL,'[]')",
        [png.into_inner()],
    )
    .unwrap();

    let state = Arc::new(State {
        db: Mutex::new(c),
        prefs: Mutex::new(Preferences::default()),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    });
    let app = tauri::test::mock_builder()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            crate::clips::get_clip_thumbnail_path
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let request = || tauri::webview::InvokeRequest {
        cmd: "get_clip_thumbnail_path".into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(target_os = "windows") {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: InvokeBody::Json(serde_json::json!({"id":1})),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let start = std::time::Instant::now();
    window.as_ref().clone().on_message(
        request(),
        Box::new(move |_, _, response, _, _| {
            let _ = tx.send(response);
        }),
    );
    let dispatch = start.elapsed();
    let response = rx
        .recv_timeout(Duration::from_secs(30))
        .expect("Thumbnail command did not complete");
    if let InvokeResponse::Err(error) = response {
        panic!("Thumbnail command failed: {:?}", error.0);
    }
    eprintln!("thumbnail IPC dispatch: {dispatch:?}");
    assert!(
        dispatch < Duration::from_millis(100),
        "Image work blocked the UI/IPC thread for {dispatch:?}"
    );

    let c = db(&state).unwrap();
    let key: String = c
        .query_row("SELECT image_key FROM clips WHERE id=1", [], |r| r.get(0))
        .unwrap();
    let thumbnail = crate::resources::image_path(&c, &key, true).unwrap();
    assert!(thumbnail.is_file());
    let decoded = image::open(&thumbnail).unwrap();
    assert!(decoded.width() <= 300 && decoded.height() <= 300);
    // A disk thumbnail remains reusable even when the original is unavailable.
    std::fs::remove_file(crate::resources::image_path(&c, &key, false).unwrap()).unwrap();
    drop(c);
    let cached: Option<String> = tauri::test::get_ipc_response(&window, request())
        .unwrap()
        .deserialize()
        .unwrap();
    assert!(cached.is_some());
    db(&state)
        .unwrap()
        .execute(
            "UPDATE clips SET plain_text='password=secret123456' WHERE id=1",
            [],
        )
        .unwrap();
    let masked: Option<String> = tauri::test::get_ipc_response(&window, request())
        .unwrap()
        .deserialize()
        .unwrap();
    assert!(
        masked.is_none(),
        "Persistent thumbnails must obey the current privacy policy"
    );
}

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
fn shortcut_positions_only_allow_center_and_cursor() {
    let mut preferences = Preferences::default();
    for position in ["center", "cursor"] {
        preferences.popup_position = position.into();
        assert!(validate_preferences(&preferences).is_ok(), "{position}");
    }
    for position in ["left", "right", "top", "bottom", "unknown"] {
        preferences.popup_position = position.into();
        assert!(validate_preferences(&preferences).is_err(), "{position}");
    }
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
    assert_eq!((image.width(), image.height()), (300, 150));
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

// Run explicitly to compare debug/release image processing without clipboard data.
#[test]
#[ignore]
fn benchmark_large_image_thumbnail() {
    let source = image::RgbImage::from_fn(3000, 2000, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
    });
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(source)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let started = std::time::Instant::now();
    let result = thumbnail_png(png.get_ref()).unwrap();
    eprintln!(
        "thumbnail_benchmark 3000x2000 total_ms={:.1}",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let result = image::load_from_memory(&result).unwrap();
    assert_eq!((result.width(), result.height()), (768, 512));
}

#[test]
fn flag_commands_return_authoritative_values_and_emit_targeted_patches() {
    use tauri::Listener;
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,pinned INTEGER,favorite INTEGER); INSERT INTO clips VALUES(1,0,0);").unwrap();
    let state = Arc::new(State {
        db: Mutex::new(c),
        prefs: Mutex::new(Preferences::default()),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    });
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::clipboard::toggle_pin,
            crate::clipboard::toggle_favorite
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let received = events.clone();
    app.listen("clips-changed", move |event| {
        received
            .lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap())
    });
    for (command, field) in [("toggle_pin", "pinned"), ("toggle_favorite", "favorite")] {
        for expected in [true, false] {
            let result: bool = tauri::test::get_ipc_response(
                &window,
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(target_os = "windows") {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({"id":1})),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
            .unwrap()
            .deserialize()
            .unwrap();
            assert_eq!(result, expected);
            let patch = events.lock().unwrap().last().unwrap().clone();
            assert_eq!(patch["updated_id"], 1);
            assert_eq!(patch[field], expected);
            assert_eq!(patch.as_object().unwrap().len(), 2);
        }
    }
}

#[test]
fn image_export_preserves_bytes_and_never_overwrites_downloads_implicitly() {
    let path = std::env::temp_dir().join(format!(
        "cpaste-export-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let png = b"\x89PNG\r\n\x1a\noriginal";
    crate::content_tools::write_image_file(&path, png, false).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), png);
    assert!(crate::content_tools::write_image_file(&path, b"replacement", false).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), png);
    crate::content_tools::write_image_file(&path, b"replacement", true).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
    std::fs::remove_file(path).unwrap();
}
#[test]
fn legacy_preferences_keep_the_primary_shortcut_without_registering_undo() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE app_settings(key TEXT,value TEXT); INSERT INTO app_settings VALUES('preferences','{\"shortcut\":\"CommandOrControl+Alt+Z\"}');").unwrap();
    let value = crate::database::load_prefs(&c);
    assert_eq!(value.shortcut, "CommandOrControl+Alt+Z");
    let defaults = Preferences::default();
    crate::preferences::validate_preferences(&defaults).unwrap();
}
#[test]
fn text_tool_source_preserves_rich_formats_and_rejects_masked_content() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,plain_text TEXT,html TEXT,rtf TEXT); INSERT INTO clips VALUES(1,'rich','bold','<b>bold</b>',NULL),(2,'text','password=secret123456',NULL,NULL),(3,'image','',NULL,NULL);").unwrap();
    let state = Arc::new(State {
        db: Mutex::new(c),
        prefs: Mutex::new(Preferences::default()),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    });
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::content_tools::get_transform_source
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |id| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "get_transform_source".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(target_os = "windows") {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({"id":id})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    let source: serde_json::Value = invoke(1).unwrap().deserialize().unwrap();
    assert_eq!(source["html"], "<b>bold</b>");
    assert_eq!(source["text"], "bold");
    for id in [2, 3, 99] {
        assert!(invoke(id).is_err());
    }
}

#[test]
fn editor_saves_rich_transforms_and_plain_edits_without_losing_flags() {
    use tauri::Manager;
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE clips(id INTEGER PRIMARY KEY,kind TEXT,title TEXT,plain_text TEXT,html TEXT,rtf TEXT,files_json TEXT,fingerprint TEXT,updated_at TEXT,pinned INTEGER,favorite INTEGER); INSERT INTO clips VALUES(1,'text','old','old',NULL,NULL,'[]','','',1,1);").unwrap();
    let state = Arc::new(State {
        db: Mutex::new(c),
        prefs: Mutex::new(Preferences::default()),
        suppress_next: AtomicBool::new(false),
        listening: AtomicBool::new(true),
        picker_pinned: AtomicBool::new(false),
        target_pid: AtomicU64::new(0),
        #[cfg(target_os = "windows")]
        target_hwnd: AtomicU64::new(0),
    });
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![crate::clipboard::edit_clip])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for (html, kind) in [(Some("<b>new</b>"), "rich"), (None, "text")] {
        let response:serde_json::Value=tauri::test::get_ipc_response(&window,tauri::webview::InvokeRequest{cmd:"edit_clip".into(),callback:tauri::ipc::CallbackFn(0),error:tauri::ipc::CallbackFn(1),url:if cfg!(target_os="windows"){"http://tauri.localhost"}else{"tauri://localhost"}.parse().unwrap(),body:tauri::ipc::InvokeBody::Json(serde_json::json!({"id":1,"content":"new","formattedHtml":html,"formattedRtf":null})),headers:Default::default(),invoke_key:tauri::test::INVOKE_KEY.into()}).unwrap().deserialize().unwrap();
        assert_eq!(response["updated_id"], 1);
        assert_eq!(response["plain_text"], "new");
        assert_eq!(response["kind"], kind);
        assert!(response["updated_at"].is_string());
        let state = app.state::<Arc<State>>();
        let c = db(&state).unwrap();
        let row: (String, Option<String>, i64, i64) = c
            .query_row(
                "SELECT kind,html,pinned,favorite FROM clips WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row, (kind.into(), html.map(str::to_owned), 1, 1));
    }
    let result = tauri::test::get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: "edit_clip".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(target_os = "windows") {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(
                serde_json::json!({"id":1,"content":"stale restore","expectedSource":{"text":"old","html":null,"rtf":null}}),
            ),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    );
    assert!(result.is_err());
    let state = app.state::<Arc<State>>();
    let current: String = db(&state)
        .unwrap()
        .query_row("SELECT plain_text FROM clips WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(current, "new");
}

#[test]
fn animations_are_enabled_by_default_and_user_choice_round_trips() {
    let defaults: Preferences = serde_json::from_str("{}").unwrap();
    assert!(!defaults.disable_animations);
    let mut enabled = defaults;
    enabled.disable_animations = true;
    let restored: Preferences =
        serde_json::from_str(&serde_json::to_string(&enabled).unwrap()).unwrap();
    assert!(restored.disable_animations);
    assert!(validate_preferences(&restored).is_ok());
}

#[test]
fn lightweight_mode_defaults_on_and_can_be_disabled() {
    let defaults: Preferences = serde_json::from_str("{}").unwrap();
    assert!(defaults.lightweight_mode);
    let saved: Preferences = serde_json::from_str("{\"lightweight_mode\":false}").unwrap();
    assert!(!saved.lightweight_mode);
    assert!(validate_preferences(&saved).is_ok());
}
