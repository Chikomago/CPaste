use crate::state::err;
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, SyncSender},
        OnceLock,
    },
};
use tauri::{AppHandle, Manager};
static ENABLED: AtomicBool = AtomicBool::new(false);
static LOGGER: OnceLock<SyncSender<Value>> = OnceLock::new();
const MAX_BYTES: u64 = 5 * 1024 * 1024;
fn append(root: &Path, value: &Value) -> std::io::Result<()> {
    fs::create_dir_all(root)?;
    let current = root.join("developer.jsonl");
    if fs::metadata(&current)
        .map(|m| m.len() >= MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(root.join("developer.3.jsonl"));
        for index in (1..3).rev() {
            let _ = fs::rename(
                root.join(format!("developer.{index}.jsonl")),
                root.join(format!("developer.{}.jsonl", index + 1)),
            );
        }
        fs::rename(&current, root.join("developer.1.jsonl"))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(current)?;
    writeln!(file, "{value}")
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_log_dir().map_err(err)?.join("developer"))
}
pub(crate) fn record(event: &str, details: Value) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    if let Some(sender) = LOGGER.get() {
        let _ = sender.try_send(
            json!({"time":chrono::Utc::now().to_rfc3339(),"event":event,"details":details}),
        );
    }
}
fn system_value(program: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
}
fn system_info() -> Value {
    let mut info = json!({"app_version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"logical_processors":std::thread::available_parallelism().map(|n|n.get()).unwrap_or(1),"build":if cfg!(debug_assertions){"development"}else{"release"}});
    #[cfg(target_os = "macos")]
    {
        info["system_version"] = json!(system_value("/usr/bin/sw_vers", &["-productVersion"]));
        info["device_model"] = json!(system_value("/usr/sbin/sysctl", &["-n", "hw.model"]));
        info["memory_bytes"] = json!(system_value("/usr/sbin/sysctl", &["-n", "hw.memsize"]));
    }
    #[cfg(target_os = "windows")]
    {
        info["system_version"] = json!(system_value("cmd", &["/C", "ver"]));
        info["processor"] = json!(std::env::var("PROCESSOR_IDENTIFIER").ok());
    }
    info
}
pub(crate) fn configure(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled && LOGGER.get().is_none() {
        let root = root(app)?;
        fs::create_dir_all(&root).map_err(err)?;
        let (sender, receiver) = sync_channel(1024);
        if LOGGER.set(sender).is_ok() {
            std::thread::spawn(move || {
                while let Ok(value) = receiver.recv() {
                    let _ = append(&root, &value);
                }
            });
        }
    }
    let old = ENABLED.swap(enabled, Ordering::SeqCst);
    if enabled && !old {
        record("developer_mode_enabled", json!({}));
        std::thread::spawn(|| record("environment", system_info()));
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn record_diagnostic(command: String, phase: String, duration_ms: u64) {
    if command.len() > 80
        || !command
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        || !["ok", "error"].contains(&phase.as_str())
    {
        return;
    }
    record(
        "operation_result",
        json!({"command":command,"result":phase,"duration_ms":duration_ms}),
    );
}
#[tauri::command]
pub(crate) async fn export_diagnostics(app: AppHandle) -> Result<bool, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name("CPaste-diagnostics.jsonl")
        .add_filter("JSON Lines", &["jsonl"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let directory = root(&app)?;
    crate::background::run(move || {
        let mut output = Vec::new();
        for name in [
            "developer.3.jsonl",
            "developer.2.jsonl",
            "developer.1.jsonl",
            "developer.jsonl",
        ] {
            match fs::read(directory.join(name)) {
                Ok(bytes) => output.extend(bytes),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(err(e)),
            }
        }
        if output.is_empty() {
            return Err("还没有日志，开启诊断模式后重现问题再导出".into());
        }
        fs::write(file.path(), output).map_err(err)?;
        Ok(true)
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_rotate_without_exceeding_four_files() {
        let root = std::env::temp_dir().join(format!(
            "cpaste-log-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        for _ in 0..5 {
            fs::write(root.join("developer.jsonl"), vec![b' '; MAX_BYTES as usize]).unwrap();
            append(&root, &json!({"event":"test"})).unwrap();
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 4);
        let line = fs::read_to_string(root.join("developer.jsonl")).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(line.trim()).unwrap()["event"],
            "test"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
