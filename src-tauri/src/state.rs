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
    s.prefs.lock().map(|p| p.clone()).map_err(err)
}
