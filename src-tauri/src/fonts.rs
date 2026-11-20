//! Enumerates font families installed on the machine so the appearance
//! settings can offer a self-styled font list. On macOS the real family names
//! come from NSFontManager on the main thread; on Windows they come from the
//! font registry keys (which carry the display name, unlike file names).

use tauri::AppHandle;

#[tauri::command]
pub(crate) async fn list_fonts(app: AppHandle) -> Result<Vec<String>, String> {
    crate::background::run(move || installed_fonts(&app)).await
}

fn installed_fonts(app: &AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    let fonts = macos_font_families(app)?;
    #[cfg(target_os = "windows")]
    let fonts = windows_font_families();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let fonts: Vec<String> = Vec::new();

    let mut fonts: Vec<String> = fonts
        .into_iter()
        .map(|name| clean_family(&name))
        .filter(|name| !name.is_empty() && name.chars().count() <= 128)
        .collect();
    fonts.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    fonts.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(fonts)
}

/// Strip the trailing "(TrueType)" / "(OpenType)" / "( All res.)" platform
/// annotations and surrounding whitespace from a registry font key.
fn clean_family(name: &str) -> String {
    let mut name = name.trim();
    if let Some(index) = name.rfind(" (") {
        let tail = &name[index..];
        let lower = tail.to_ascii_lowercase();
        if lower.contains("truetype")
            || lower.contains("opentype")
            || lower.contains("all res")
            || lower.contains("vertical")
        {
            name = &name[..index];
        }
    }
    name.trim().to_string()
}

#[cfg(target_os = "macos")]
fn macos_font_families(app: &AppHandle) -> Result<Vec<String>, String> {
    use tauri_nspanel::objc2::MainThreadMarker;

    if MainThreadMarker::new().is_some() {
        return Ok(ns_font_families());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(ns_font_families());
    })
    .map_err(crate::state::err)?;
    Ok(receiver.recv().map_err(crate::state::err)?)
}

#[cfg(target_os = "macos")]
fn ns_font_families() -> Vec<String> {
    use tauri_nspanel::objc2::MainThreadMarker;
    use tauri_nspanel::objc2_app_kit::NSFontManager;

    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let manager = NSFontManager::sharedFontManager(mtm);
    manager
        .availableFontFamilies()
        .to_vec()
        .into_iter()
        .map(|name| name.to_string())
        .collect()
}

#[cfg(target_os = "windows")]
fn windows_font_families() -> Vec<String> {
    use std::process::Command;

    // The registry value names are the human-readable font families (e.g.
    // "Microsoft YaHei (TrueType)"), unlike the file names in Windows\Fonts.
    let hives = [
        r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    ];
    let mut fonts = Vec::new();
    for hive in hives {
        let output = Command::new("reg")
            .args(["query", hive])
            .output();
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("HKEY") {
                continue;
            }
            let Some(marker) = line.find("REG_SZ") else {
                continue;
            };
            let name = line[..marker].trim();
            if !name.is_empty() {
                fonts.push(name.to_string());
            }
        }
    }
    fonts
}
