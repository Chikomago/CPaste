use std::collections::HashMap;

pub(crate) const CLIP_ACTIONS: [&str; 12] = [
    "paste",
    "paste_plain",
    "paste_original",
    "copy",
    "copy_plain",
    "copy_original",
    "preview",
    "edit",
    "segment",
    "favorite",
    "pin",
    "delete",
];
pub(crate) fn default_action_shortcuts() -> HashMap<String, String> {
    [
        ("paste", "Enter"),
        ("paste_plain", "CommandOrControl+Shift+Enter"),
        ("paste_original", ""),
        ("copy", "CommandOrControl+C"),
        ("copy_plain", "CommandOrControl+Shift+C"),
        ("copy_original", ""),
        ("preview", "Space"),
        ("edit", ""),
        ("segment", ""),
        ("favorite", "CommandOrControl+D"),
        ("pin", "CommandOrControl+P"),
        ("delete", "Delete"),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value.into()))
    .collect()
}
pub(crate) fn canonical_shortcut(shortcut: &str) -> String {
    let primary = if cfg!(target_os = "macos") {
        "Command"
    } else {
        "Control"
    };
    shortcut.replace("CommandOrControl", primary).to_lowercase()
}
