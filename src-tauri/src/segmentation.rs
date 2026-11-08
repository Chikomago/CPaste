use crate::models::{Preferences, State};
use crate::state::{db, err, prefs};
use jieba_rs::Jieba;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const MAX_DICTIONARY_BYTES: usize = 50 * 1024 * 1024;
const MAX_DICTIONARY_WORDS: usize = 500_000;
const CONTENT_KEY: &str = "segmentation_imported_words";
const REVISION_KEY: &str = "segmentation_imported_revision";
const INFO_KEY: &str = "segmentation_imported_info";
const BASE_CONTENT_KEY: &str = "segmentation_downloaded_words";
const BASE_REVISION_KEY: &str = "segmentation_downloaded_revision";
const BASE_INFO_KEY: &str = "segmentation_downloaded_info";
const DICTIONARY_URL: &str =
    "https://raw.githubusercontent.com/messense/jieba-rs/v0.11.0/jieba/src/data/dict.txt";
const DICTIONARY_BYTES: usize = 5_071_843;
const DICTIONARY_SHA256: &str = "139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f";

pub(crate) fn dictionary_words(text: &str) -> Result<Vec<String>, String> {
    if text.len() > MAX_DICTIONARY_BYTES {
        return Err("词典不能超过 50 MB".into());
    }
    let mut seen = HashSet::new();
    let mut words = Vec::new();
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let word = line.split_whitespace().next().unwrap_or_default();
        if word.chars().count() > 200 {
            return Err("每个词条不能超过 200 个字符".into());
        }
        if seen.insert(word.to_owned()) {
            words.push(word.to_owned());
        }
        if words.len() > MAX_DICTIONARY_WORDS {
            return Err("自定义词典最多支持 50 万个词条".into());
        }
    }
    Ok(words)
}

fn stored_value(c: &Connection, key: &str) -> Result<String, String> {
    Ok(
        c.query_row("SELECT value FROM app_settings WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_default(),
    )
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct DictionaryInfo {
    word_count: usize,
    bytes: usize,
}

struct PreparedDictionary {
    content: String,
    revision: String,
    info: DictionaryInfo,
}
static IMPORT_LOCK: Mutex<()> = Mutex::new(());

fn prepare_imported_dictionary(existing: &str, text: &str) -> Result<PreparedDictionary, String> {
    let incoming = dictionary_words(text)?;
    if incoming.is_empty() {
        return Err("词典中没有可导入的词条".into());
    }
    let existing = dictionary_words(existing)?;
    let mut seen = HashSet::new();
    let words: Vec<String> = existing
        .into_iter()
        .chain(incoming)
        .filter(|word| seen.insert(word.clone()))
        .collect();
    if words.len() > MAX_DICTIONARY_WORDS {
        return Err("自定义词典最多支持 50 万个词条".into());
    }
    let content = words.join("\n");
    if content.len() > MAX_DICTIONARY_BYTES {
        return Err("合并后的词典不能超过 50 MB".into());
    }
    let info = DictionaryInfo {
        word_count: words.len(),
        bytes: content.len(),
    };
    let revision = hex::encode(Sha256::digest(content.as_bytes()));
    Ok(PreparedDictionary {
        content,
        revision,
        info,
    })
}

fn persist_dictionary(
    c: &mut Connection,
    prepared: PreparedDictionary,
) -> Result<DictionaryInfo, String> {
    let PreparedDictionary {
        content,
        revision,
        info,
    } = prepared;
    let tx = c.transaction().map_err(err)?;
    for (key, value) in [
        (CONTENT_KEY, content),
        (REVISION_KEY, revision),
        (INFO_KEY, serde_json::to_string(&info).map_err(err)?),
    ] {
        tx.execute(
            "INSERT OR REPLACE INTO app_settings(key,value) VALUES(?1,?2)",
            params![key, value],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(info)
}

struct CachedDictionary {
    builtin: bool,
    base_revision: String,
    custom: String,
    imported_revision: String,
    jieba: Jieba,
}
static DICTIONARY: OnceLock<Mutex<Option<CachedDictionary>>> = OnceLock::new();

fn cut_with_dictionaries(
    text: &str,
    preferences: &Preferences,
    base_revision: &str,
    revision: &str,
    load_base: impl FnOnce() -> Result<String, String>,
    load_imported: impl FnOnce() -> Result<String, String>,
) -> Result<Vec<String>, String> {
    let base_revision = if preferences.segment_builtin_dictionary {
        base_revision
    } else {
        ""
    };
    let custom = if preferences.segment_custom_dictionary {
        preferences.segment_custom_words.as_str()
    } else {
        ""
    };
    let revision = if preferences.segment_custom_dictionary {
        revision
    } else {
        ""
    };
    let mut cache = DICTIONARY
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(err)?;
    if !cache.as_ref().is_some_and(|item| {
        item.builtin == preferences.segment_builtin_dictionary
            && item.base_revision == base_revision
            && item.custom == custom
            && item.imported_revision == revision
    }) {
        let mut jieba = Jieba::empty();
        if !base_revision.is_empty() {
            let raw = load_base()?;
            jieba
                .load_dict(&mut std::io::Cursor::new(raw.as_bytes()))
                .map_err(err)?;
        }
        if !revision.is_empty() {
            for word in dictionary_words(&load_imported()?)? {
                jieba.add_word(&word, Some(10_000_000), None);
            }
        }
        for word in dictionary_words(custom)? {
            jieba.add_word(&word, Some(10_000_000), None);
        }
        *cache = Some(CachedDictionary {
            builtin: preferences.segment_builtin_dictionary,
            base_revision: base_revision.to_owned(),
            custom: custom.to_owned(),
            imported_revision: revision.to_owned(),
            jieba,
        });
    }
    Ok(cache
        .as_ref()
        .unwrap()
        .jieba
        .cut(text, false)
        .into_iter()
        .filter(|token| !token.word.trim().is_empty())
        .map(|token| token.word.to_owned())
        .collect())
}

#[cfg(test)]
fn cut_with_imported(
    text: &str,
    p: &Preferences,
    revision: &str,
    load: impl FnOnce() -> Result<String, String>,
) -> Result<Vec<String>, String> {
    cut_with_dictionaries(text, p, "", revision, || Ok(String::new()), load)
}

#[cfg(test)]
fn cut(text: &str, p: &Preferences) -> Result<Vec<String>, String> {
    cut_with_imported(text, p, "", || Ok(String::new()))
}

#[tauri::command]
pub(crate) async fn segment_text(
    s: tauri::State<'_, Arc<State>>,
    text: String,
) -> Result<Vec<String>, String> {
    if text.len() > 1_000_000 {
        return Err("分词内容不能超过 1 MB".into());
    }
    let preferences = prefs(&s)?;
    let state = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let revision = if preferences.segment_custom_dictionary {
            stored_value(&*db(&state)?, REVISION_KEY)?
        } else {
            String::new()
        };
        let base_revision = if preferences.segment_builtin_dictionary {
            stored_value(&*db(&state)?, BASE_REVISION_KEY)?
        } else {
            String::new()
        };
        cut_with_dictionaries(
            &text,
            &preferences,
            &base_revision,
            &revision,
            || stored_value(&*db(&state)?, BASE_CONTENT_KEY),
            || stored_value(&*db(&state)?, CONTENT_KEY),
        )
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) fn get_dictionary_info(s: tauri::State<Arc<State>>) -> Result<DictionaryInfo, String> {
    let raw = stored_value(&*db(&s)?, INFO_KEY)?;
    if raw.is_empty() {
        return Ok(DictionaryInfo::default());
    }
    serde_json::from_str(&raw).map_err(err)
}

#[tauri::command]
pub(crate) fn get_downloaded_dictionary_info(
    s: tauri::State<Arc<State>>,
) -> Result<DictionaryInfo, String> {
    let raw = stored_value(&*db(&s)?, BASE_INFO_KEY)?;
    if raw.is_empty() {
        return Ok(DictionaryInfo::default());
    }
    serde_json::from_str(&raw).map_err(err)
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    received: usize,
    total: usize,
}
static DOWNLOADING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct DownloadGuard;
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

fn validate_download(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() != DICTIONARY_BYTES || hex::encode(Sha256::digest(bytes)) != DICTIONARY_SHA256 {
        return Err("词典校验失败，请重新下载".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn download_dictionary(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
) -> Result<DictionaryInfo, String> {
    use std::sync::atomic::Ordering;
    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("词典正在下载".into());
    }
    let _download = DownloadGuard;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(err)?;
    let mut response = client
        .get(DICTIONARY_URL)
        .send()
        .await
        .map_err(|e| format!("词典下载失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("词典下载失败：{e}"))?;
    let mut bytes = Vec::with_capacity(DICTIONARY_BYTES);
    let mut progress = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("词典下载失败：{e}"))?
    {
        if bytes.len() + chunk.len() > DICTIONARY_BYTES {
            return Err("词典校验失败，请重新下载".into());
        }
        bytes.extend_from_slice(&chunk);
        let percent = bytes.len() * 100 / DICTIONARY_BYTES;
        if percent != progress {
            progress = percent;
            let _ = app.emit(
                "dictionary-download-progress",
                DownloadProgress {
                    received: bytes.len(),
                    total: DICTIONARY_BYTES,
                },
            );
        }
    }
    let state = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        validate_download(&bytes)?;
        let text = String::from_utf8(bytes).map_err(err)?;
        let info = DictionaryInfo {
            word_count: text.lines().filter(|line| !line.trim().is_empty()).count(),
            bytes: text.len(),
        };
        // Only commit after download and checksum verification have completed.
        let mut c = db(&state)?;
        let tx = c.transaction().map_err(err)?;
        for (key, value) in [
            (BASE_CONTENT_KEY, text),
            (BASE_REVISION_KEY, DICTIONARY_SHA256.to_owned()),
            (BASE_INFO_KEY, serde_json::to_string(&info).map_err(err)?),
        ] {
            tx.execute(
                "INSERT OR REPLACE INTO app_settings(key,value) VALUES(?1,?2)",
                params![key, value],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        drop(c);
        app.emit("dictionary-changed", ()).map_err(err)?;
        Ok(info)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub(crate) async fn import_dictionary(
    app: AppHandle,
    s: tauri::State<'_, Arc<State>>,
) -> Result<Option<DictionaryInfo>, String> {
    let state = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("词典 / Dictionary", &["txt", "dict"])
            .pick_file()
        else {
            return Ok(None);
        };
        let file = std::fs::File::open(path).map_err(err)?;
        if file.metadata().map_err(err)?.len() > MAX_DICTIONARY_BYTES as u64 {
            return Err("词典不能超过 50 MB".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_DICTIONARY_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(err)?;
        if bytes.len() > MAX_DICTIONARY_BYTES {
            return Err("词典不能超过 50 MB".into());
        }
        let text = String::from_utf8(bytes)
            .map_err(|_| "无法读取词典，请使用 UTF-8 编码的文本文件".to_string())?;
        let _import = IMPORT_LOCK.lock().map_err(err)?;
        let existing = stored_value(&*db(&state)?, CONTENT_KEY)?;
        // Parse and merge on a worker without holding the clipboard database lock.
        let prepared = prepare_imported_dictionary(&existing, &text)?;
        let info = persist_dictionary(&mut *db(&state)?, prepared)?;
        app.emit("dictionary-changed", ()).map_err(err)?;
        Ok(Some(info))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn general_dictionary_is_optional_and_loaded_only_when_enabled() {
        let mut p = Preferences::default();
        assert!(!cut_with_dictionaries(
            "星云量子词典",
            &p,
            "",
            "",
            || panic!("no download to load"),
            || Ok(String::new())
        )
        .unwrap()
        .contains(&"星云量子词典".into()));
        let source = "星云量子词典 100 n\n剪贴板 50 n";
        assert!(cut_with_dictionaries(
            "星云量子词典",
            &p,
            "test-download",
            "",
            || Ok(source.into()),
            || Ok(String::new())
        )
        .unwrap()
        .contains(&"星云量子词典".into()));
        p.segment_custom_dictionary = true;
        p.segment_custom_words = "星云量子词典术语".into();
        assert!(cut_with_dictionaries(
            "星云量子词典术语",
            &p,
            "test-download",
            "",
            || Ok(source.into()),
            || Ok(String::new())
        )
        .unwrap()
        .contains(&"星云量子词典术语".into()));
        p.segment_builtin_dictionary = false;
        p.segment_custom_dictionary = false;
        assert!(!cut_with_dictionaries(
            "星云量子词典",
            &p,
            "test-download",
            "",
            || panic!("disabled download must not load"),
            || Ok(String::new())
        )
        .unwrap()
        .contains(&"星云量子词典".into()));
    }
    #[test]
    fn incomplete_or_modified_downloads_are_rejected() {
        assert!(validate_download(b"incomplete").is_err());
        assert!(validate_download(&vec![0; DICTIONARY_BYTES]).is_err());
    }
    fn store_imported_dictionary(c: &mut Connection, text: &str) -> Result<DictionaryInfo, String> {
        let existing = stored_value(c, CONTENT_KEY)?;
        persist_dictionary(c, prepare_imported_dictionary(&existing, text)?)
    }
    #[test]
    fn large_imports_exceed_old_limits_and_remain_outside_preferences() {
        let text: String = (0..80_000)
            .map(|index| format!("测试词条{index:06}\n"))
            .collect();
        assert!(text.len() > 1_000_000);
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_settings VALUES('preferences','{\"theme\":\"dark\"}');").unwrap();
        let info = store_imported_dictionary(&mut c, &text).unwrap();
        assert_eq!(info.word_count, 80_000);
        assert!(info.bytes > 1_000_000);
        let merged = store_imported_dictionary(&mut c, "测试词条000001\n额外词条").unwrap();
        assert_eq!(merged.word_count, 80_001);
        assert_eq!(
            stored_value(&c, "preferences").unwrap(),
            "{\"theme\":\"dark\"}"
        );
        assert!(stored_value(&c, INFO_KEY).unwrap().len() < 100);
    }
    #[test]
    fn imported_dictionary_revisions_rebuild_the_cached_tokenizer() {
        let mut p = Preferences::default();
        p.segment_builtin_dictionary = false;
        p.segment_custom_dictionary = true;
        assert!(cut_with_imported("星云量子词典", &p, "first", || Ok(
            "星云量子词典".into()
        ))
        .unwrap()
        .contains(&"星云量子词典".into()));
        assert!(!cut_with_imported("星云量子词典", &p, "second", || Ok(
            "银河剪贴记录".into()
        ))
        .unwrap()
        .contains(&"星云量子词典".into()));
    }
    #[test]
    fn custom_words_override_builtin_and_changes_invalidate_cache() {
        let mut p = Preferences::default();
        p.segment_custom_dictionary = true;
        p.segment_custom_words = "量子剪贴板星云 100 n".into();
        assert!(cut("打开量子剪贴板星云", &p)
            .unwrap()
            .contains(&"量子剪贴板星云".into()));
        p.segment_custom_dictionary = false;
        assert!(!cut("打开量子剪贴板星云", &p)
            .unwrap()
            .contains(&"量子剪贴板星云".into()));
        p.segment_builtin_dictionary = false;
        p.segment_custom_dictionary = true;
        assert!(cut("量子剪贴板星云", &p)
            .unwrap()
            .contains(&"量子剪贴板星云".into()));
    }
    #[test]
    fn imports_accept_plain_and_jieba_formats_without_duplicates() {
        assert_eq!(
            dictionary_words("\u{feff}# comment\n剪贴板 100 n\n剪贴板\n本机词典").unwrap(),
            vec!["剪贴板", "本机词典"]
        );
        assert!(dictionary_words(&"词".repeat(201)).is_err());
    }
    #[test]
    fn disabling_both_dictionaries_still_handles_unknown_text() {
        let mut p = Preferences::default();
        p.segment_builtin_dictionary = false;
        p.segment_custom_dictionary = false;
        assert_eq!(cut("你好 hello", &p).unwrap().concat(), "你好hello");
    }
}
