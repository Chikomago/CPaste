use crate::state::err;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
pub(crate) fn accessibility_trusted(prompt: bool) -> bool {
    use core_foundation::{
        base::TCFType,
        boolean::CFBoolean,
        dictionary::CFDictionary,
        string::{CFString, CFStringRef},
    };
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::dictionary::CFDictionaryRef,
        ) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let value = if prompt {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let options = CFDictionary::from_CFType_pairs(&[(key, value)]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}
#[cfg(target_os = "macos")]
pub(crate) fn open_full_disk_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map_err(err)?;
    Ok(())
}
#[cfg(target_os = "macos")]
pub(crate) fn full_disk_access_granted(app: &AppHandle) -> Option<bool> {
    let protected = app
        .path()
        .home_dir()
        .ok()?
        .join("Library/Containers/com.apple.stocks");
    if !protected.exists() {
        return None;
    }
    Some(match std::fs::read_dir(protected) {
        Ok(mut entries) => !matches!(entries.next(), Some(Err(_))),
        Err(_) => false,
    })
}
#[tauri::command]
pub(crate) fn full_disk_access_status(app: AppHandle) -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        full_disk_access_granted(&app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Some(true)
    }
}
#[tauri::command]
pub(crate) fn accessibility_status() -> bool {
    #[cfg(target_os = "macos")]
    {
        accessibility_trusted(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
#[tauri::command]
pub(crate) fn open_system_permission(app: AppHandle, kind: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        match kind.as_str() {
            "accessibility" => Ok(accessibility_trusted(true)),
            "full_disk" => {
                if full_disk_access_granted(&app) == Some(true) {
                    return Ok(true);
                }
                open_full_disk_settings()?;
                Ok(false)
            }
            _ => Err("系统权限类型无效".into()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, kind);
        Err("此系统无需单独授权".into())
    }
}
