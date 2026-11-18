use crate::models::{Preferences, State};
use rusqlite::Connection;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub(crate) fn db(s: &State) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    s.db.lock().map_err(err)
}
pub(crate) fn prefs(s: &State) -> Result<Preferences, String> {
    s.prefs
        .lock()
        .map(|p| {
            let mut preferences = p.clone();
            preferences
                .action_shortcuts
                .retain(|action, _| crate::shortcuts::CLIP_ACTIONS.contains(&action.as_str()));
            for (action, shortcut) in crate::shortcuts::default_action_shortcuts() {
                if preferences.action_shortcuts.contains_key(&action) {
                    continue;
                }
                let conflict = !shortcut.is_empty()
                    && (preferences.action_shortcuts.values().any(|value| {
                        crate::shortcuts::canonical_shortcut(value)
                            == crate::shortcuts::canonical_shortcut(&shortcut)
                    }) || crate::shortcuts::canonical_shortcut(&preferences.shortcut)
                        == crate::shortcuts::canonical_shortcut(&shortcut));
                preferences
                    .action_shortcuts
                    .insert(action, if conflict { String::new() } else { shortcut });
            }
            if !["center", "cursor"].contains(&preferences.popup_position.as_str()) {
                preferences.popup_position = "center".into();
            }
            preferences
        })
        .map_err(err)
}
