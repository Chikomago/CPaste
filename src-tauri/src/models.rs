use crate::shortcuts::default_action_shortcuts;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Preferences {
    pub(crate) retention_days: i64,
    pub(crate) max_items: i64,
    pub(crate) max_storage_mb: i64,
    pub(crate) capture_text: bool,
    pub(crate) capture_rich: bool,
    pub(crate) capture_image: bool,
    pub(crate) capture_files: bool,
    pub(crate) default_plain_paste: bool,
    pub(crate) default_file_paths: bool,
    pub(crate) close_after_paste: bool,
    pub(crate) return_to_top_after_paste: bool,
    pub(crate) default_filter: String,
    pub(crate) default_plain_copy: bool,
    pub(crate) default_copy_file_paths: bool,
    pub(crate) paste_on_single_click: bool,
    pub(crate) launch_at_login: bool,
    pub(crate) show_tray_icon: bool,
    pub(crate) show_dock_icon: bool,
    pub(crate) popup_position: String,
    pub(crate) side_columns: i64,
    pub(crate) edge_card_size: i64,
    pub(crate) hover_preview: bool,
    pub(crate) show_source_app_icon: bool,
    pub(crate) auto_check_updates: bool,
    pub(crate) item_max_lines: i64,
    pub(crate) segment_builtin_dictionary: bool,
    pub(crate) segment_custom_dictionary: bool,
    pub(crate) segment_custom_words: String,
    pub(crate) theme: String,
    pub(crate) language: String,
    pub(crate) accent_color: String,
    pub(crate) shortcut: String,
    #[serde(default = "default_action_shortcuts")]
    pub(crate) action_shortcuts: HashMap<String, String>,
    pub(crate) excluded_apps: Vec<String>,
    pub(crate) sensitive_action: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            retention_days: 30,
            max_items: 10000,
            max_storage_mb: 1024,
            capture_text: true,
            capture_rich: true,
            capture_image: true,
            capture_files: true,
            default_plain_paste: false,
            default_file_paths: false,
            close_after_paste: true,
            return_to_top_after_paste: true,
            default_filter: "all".into(),
            default_plain_copy: false,
            default_copy_file_paths: false,
            paste_on_single_click: true,
            launch_at_login: false,
            show_tray_icon: true,
            show_dock_icon: true,
            popup_position: "center".into(),
            side_columns: 2,
            edge_card_size: 200,
            hover_preview: false,
            show_source_app_icon: false,
            auto_check_updates: true,
            item_max_lines: 2,
            segment_builtin_dictionary: true,
            segment_custom_dictionary: false,
            segment_custom_words: String::new(),
            theme: "system".into(),
            language: "zh-CN".into(),
            accent_color: "#3569ed".into(),
            shortcut: "CommandOrControl+Shift+V".into(),
            action_shortcuts: default_action_shortcuts(),
            excluded_apps: vec![],
            sensitive_action: "mask".into(),
        }
    }
}
#[derive(Serialize)]
pub(crate) struct Clip {
    pub(crate) id: i64,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) plain_text: String,
    pub(crate) html: Option<String>,
    pub(crate) rtf: Option<String>,
    pub(crate) files: Vec<String>,
    pub(crate) image_data: Option<String>,
    pub(crate) source_app: String,
    pub(crate) source_path: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) use_count: i64,
    pub(crate) pinned: bool,
    pub(crate) favorite: bool,
    pub(crate) sensitive_masked: bool,
}
#[derive(Serialize)]
pub(crate) struct PreviewClip {
    pub(crate) id: i64,
    pub(crate) kind: String,
    pub(crate) plain_text: String,
    pub(crate) files: Vec<String>,
    pub(crate) file_sizes: Vec<Option<u64>>,
    pub(crate) source_app: String,
    pub(crate) created_at: String,
    pub(crate) sensitive_masked: bool,
}
pub(crate) struct State {
    pub(crate) db: Mutex<Connection>,
    pub(crate) prefs: Mutex<Preferences>,
    pub(crate) suppress_next: AtomicBool,
    pub(crate) listening: AtomicBool,
    pub(crate) picker_pinned: AtomicBool,
    pub(crate) target_pid: AtomicU64,
    #[cfg(target_os = "windows")]
    pub(crate) target_hwnd: AtomicU64,
}

#[derive(Clone, Serialize)]
pub(crate) struct ClipMenuAction {
    pub(crate) id: i64,
    pub(crate) action: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct PreviewPlacement {
    pub(crate) id: i64,
    pub(crate) edge: String,
    pub(crate) anchor_x: f64,
    pub(crate) anchor_y: f64,
}

#[derive(Clone, Serialize)]
pub(crate) struct PickerOpening {
    pub(crate) edge: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
}
