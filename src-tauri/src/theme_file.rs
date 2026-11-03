// T-648 (DT-C87): Export on the theme editor saves a theme file through the system's own Save dialog,
// the same way a note is saved as a PDF (browser_pdf.rs): a command opens the dialog off the async
// runtime, the user picks the place, and only then is the file written. The webview never names a path.

use std::path::Path;

use tauri::AppHandle;

/// Bigger than any real theme (about 2 KB); matches the editor's own limit.
const MAX_BYTES: usize = 16 * 1024;

/// `kolux-theme-<name>.json`, the name cut down to letters, digits and dashes.
pub fn default_name(name: &str) -> String {
    let mut slug = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    format!("kolux-theme-{}.json", if slug.is_empty() { "theme" } else { &slug[..slug.len().min(60)] })
}

/// Writes `text` to `path` only when it really is a Kolux theme file (a small JSON object with the theme
/// format), so this command cannot be used to save anything else.
pub fn write_theme(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("That theme is too big to be a Kolux theme file.".into());
    }
    let ok = serde_json::from_str::<serde_json::Value>(text).ok().is_some_and(|v| v.get("format").and_then(|f| f.as_str()) == Some("kolux-theme"));
    if !ok {
        return Err("Only a Kolux theme file can be saved here.".into());
    }
    crate::files::write_text(path, text)
}

/// The system Save dialog offering `kolux-theme-<name>.json`; then the file is written. Returns the saved
/// path, or none when the dialog was cancelled. The dialog itself asks before a file is replaced.
#[tauri::command]
pub async fn theme_export_save(app: AppHandle, name: String, text: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let pick = app.dialog().file().set_title("Export theme").add_filter("Kolux theme", &["json"]).set_file_name(default_name(&name));
    let picked = tauri::async_runtime::spawn_blocking(move || pick.blocking_save_file()).await.map_err(|e| e.to_string())?;
    let Some(chosen) = picked else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    write_theme(&path, &text)?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r##"{"format":"kolux-theme","version":1,"name":"Mine","base":"classic","overrides":{"accent":"#ff8800"},"terminal":{}}"##;

    #[test]
    fn the_suggested_name_is_a_safe_json_file_name() {
        assert_eq!(default_name("My Theme!"), "kolux-theme-my-theme.json");
        assert_eq!(default_name("../x/y"), "kolux-theme-x-y.json");
        assert_eq!(default_name("***"), "kolux-theme-theme.json");
    }

    #[test]
    fn a_theme_file_is_written_and_anything_else_is_refused() {
        let dir = std::env::temp_dir().join(format!("kolux-theme-file-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.json");
        write_theme(&path, GOOD).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), GOOD);
        let other = dir.join("o.json");
        assert!(write_theme(&other, r#"{"format":"something-else"}"#).is_err());
        assert!(write_theme(&other, "not json").is_err());
        assert!(write_theme(&other, &format!("{GOOD}{}", " ".repeat(MAX_BYTES))).is_err());
        assert!(!other.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
