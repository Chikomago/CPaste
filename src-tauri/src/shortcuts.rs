use std::collections::HashMap;

pub(crate) const CLIP_ACTIONS: [&str; 24] = [
    "reveal_file",
    "open_image",
    "save_image_as",
    "settings",
    "sidebar",
    "window_pin",
    "sort",
    "search",
    "filter_favorite",
    "filter_next",
    "filter_previous",
    "tools",
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
        ("reveal_file", "CommandOrControl+Alt+O"),
        ("open_image", "CommandOrControl+O"),
        ("save_image_as", "CommandOrControl+Shift+S"),
        ("settings", "CommandOrControl+Alt+S"),
        ("sidebar", "Space"),
        ("window_pin", "CommandOrControl+Shift+P"),
        ("sort", "CommandOrControl+Alt+T"),
        ("search", "CommandOrControl+F"),
        ("filter_favorite", "CommandOrControl+Alt+7"),
        ("filter_next", "CommandOrControl+Alt+Right"),
        ("filter_previous", "CommandOrControl+Alt+Left"),
        ("tools", "CommandOrControl+R"),
        ("paste", "Enter"),
        ("paste_plain", "CommandOrControl+Shift+Enter"),
        ("paste_original", ""),
        ("copy", "CommandOrControl+C"),
        ("copy_plain", "CommandOrControl+Shift+C"),
        ("copy_original", ""),
        ("preview", ""),
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
