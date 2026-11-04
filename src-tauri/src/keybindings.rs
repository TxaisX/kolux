//! The shortcuts file the user owns: `~/.kolux/keybindings.json` (COMPAT.md section 4.1,
//! SET-011). This side finds the file, creates it empty when it is missing, reads it, and writes
//! one command at a time into this platform's section (SET-009), keeping the rest as it was.
//! It never writes over a file it cannot parse. Which chord fires which action is decided in the
//! page (`src/keys`), because that is where the keys are pressed.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "keybindings.json";

/// What an empty file looks like: version 1, no overrides anywhere. The defaults are built in,
/// so a fresh file lists none of them (COMPAT.md 4.1 "created empty").
const EMPTY: &str = "{\n  \"version\": 1,\n  \"keybindings\": {},\n  \"platforms\": {\n    \"darwin\": {},\n    \"linux\": {},\n    \"win32\": {}\n  }\n}\n";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsFile {
    pub path: String,
    /// The file parsed as a JSON object, or null when it could not be read or parsed
    /// (`error` says why, and the page falls back to the defaults).
    pub value: Option<serde_json::Value>,
    /// True when this read created the file because it was missing.
    pub created: bool,
    pub error: Option<String>,
}

/// `<home>/.kolux/keybindings.json`: the user's home, not the app's profile folder, so the file
/// is shared with the old app and survives an uninstall.
pub fn path_under(home: &Path) -> PathBuf {
    home.join(".kolux").join(FILE_NAME)
}

/// Reads the file, creating it empty first when it does not exist. A file that will not parse,
/// or is not a JSON object, is reported and left exactly as it was.
pub fn read(home: &Path) -> KeybindingsFile {
    let path = path_under(home);
    let shown = path.display().to_string();
    let mut created = false;
    if !path.exists() {
        if let Err(e) = create_empty(&path) {
            return KeybindingsFile { path: shown, value: None, created: false, error: Some(format!("Could not create the shortcuts file: {e}")) };
        }
        created = true;
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return KeybindingsFile { path: shown, value: None, created, error: Some(format!("Could not read the shortcuts file: {e}")) },
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) if v.is_object() => KeybindingsFile { path: shown, value: Some(v), created, error: None },
        Ok(_) => KeybindingsFile { path: shown, value: None, created, error: Some("The shortcuts file is not a JSON object; the default shortcuts are in use and the file was left alone.".into()) },
        Err(e) => KeybindingsFile { path: shown, value: None, created, error: Some(format!("The shortcuts file could not be read as JSON ({e}); the default shortcuts are in use and the file was left alone.")) },
    }
}

/// Writes the empty file through a temporary file, so a crash never leaves half a file behind.
fn create_empty(path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    write_whole(path, EMPTY)
}

fn write_whole(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

/// This platform's section name in the file: darwin, linux or win32.
pub fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        _ => "linux",
    }
}

/// SET-009 and COMPAT.md 4.1 "Writing": puts one command's chords (a chord, a list, or null for
/// disabled) into `platform`'s section and leaves the rest of the file as it was. `reset` takes the
/// command out of that section instead; when the all-platforms section still overrides it, `value`
/// (the shipped default) is written so the default really comes back.
pub fn write(home: &Path, platform: &str, id: &str, value: serde_json::Value, reset: bool) -> Result<KeybindingsFile, String> {
    use serde_json::Value;
    if id.is_empty() || id.len() > 100 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err(format!("\"{id}\" is not a command id"));
    }
    let ok = match &value {
        Value::Null | Value::String(_) => true,
        Value::Array(xs) => xs.iter().all(Value::is_string),
        _ => false,
    };
    if !ok {
        return Err("A shortcut must be a chord, a list of chords or null".into());
    }
    let now = read(home);
    let Some(Value::Object(mut file)) = now.value else {
        return Err(now.error.unwrap_or_else(|| "The shortcuts file could not be read".into()));
    };
    let shared_has = match file.get("keybindings") {
        Some(Value::Object(k)) => k.contains_key(id),
        Some(_) => false,
        None => file.contains_key(id),
    };
    let Value::Object(platforms) = file.entry("platforms").or_insert_with(|| Value::Object(Default::default())) else {
        return Err("\"platforms\" in the shortcuts file is not an object; the file was left alone.".into());
    };
    let Value::Object(section) = platforms.entry(platform).or_insert_with(|| Value::Object(Default::default())) else {
        return Err(format!("The {platform} section of the shortcuts file is not an object; the file was left alone."));
    };
    if reset && !shared_has {
        section.shift_remove(id);
    } else {
        section.insert(id.to_string(), value);
    }
    let text = serde_json::to_string_pretty(&Value::Object(file)).map_err(|e| e.to_string())? + "\n";
    write_whole(&path_under(home), &text).map_err(|e| format!("Could not write the shortcuts file: {e}"))?;
    Ok(read(home))
}

/// The folder whose `.kolux` holds the file: `KOLUX_KEYBINDINGS_HOME` when a test profile sets it,
/// else the home variable the other stores read (USERPROFILE on Windows, HOME elsewhere, as in
/// hooks.rs and trust.rs; unlike them an empty value is skipped and the last step is Tauri's lookup,
/// not the temp folder). T-761: Tauri's home_dir asks Windows for the profile folder and ignores
/// USERPROFILE, so a run started with a scratch USERPROFILE read and wrote the real file.
fn home_from(var: impl Fn(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    let set = |k: &str| var(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    set("KOLUX_KEYBINDINGS_HOME").or_else(|| set(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
}

fn home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    match home_from(|k| std::env::var_os(k)) {
        Some(h) => Ok(h),
        None => app.path().home_dir().map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn keybindings_read(app: tauri::AppHandle) -> Result<KeybindingsFile, String> {
    Ok(read(&home(&app)?))
}

/// Writes one command's chords and tells every window, so each reads the file again.
#[tauri::command]
pub fn keybindings_write(app: tauri::AppHandle, id: String, value: serde_json::Value, reset: bool) -> Result<KeybindingsFile, String> {
    use tauri::Emitter;
    let out = write(&home(&app)?, platform_name(), &id, value, reset)?;
    let _ = app.emit("keybindings-changed", ());
    Ok(out)
}

/// SET-012 Reload from Disk: every window reads the file again (there is no file watcher).
#[tauri::command]
pub fn keybindings_reload(app: tauri::AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("keybindings-changed", ());
}

/// SET-012: the file in the system's default app (`reveal` false) or selected in the file
/// manager. A missing file is created first, so there is always something to open.
#[tauri::command]
pub fn keybindings_show(app: tauri::AppHandle, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, reveal: bool, command: Option<String>) -> Result<(), String> {
    let home = home(&app)?;
    let path = path_under(&home);
    if !path.exists() {
        let made = read(&home);
        if !path.exists() {
            return Err(made.error.unwrap_or_else(|| "The shortcuts file could not be created".into()));
        }
    }
    // after-list 499: with a command the file opens in that Open in app instead of the system's default
    if let Some(c) = command.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        let settings = store.lock().map_err(|e| e.to_string())?.settings();
        return crate::files::open_file_in(&path, c, &settings, std::env::var_os("PATH"));
    }
    show_command(&path, reveal).spawn().map(|_| ()).map_err(|e| format!("Could not open {}: {e}", path.display()))
}

/// The command that opens `path`, or shows it selected in its folder.
fn show_command(path: &Path, reveal: bool) -> std::process::Command {
    #[cfg(windows)]
    {
        let mut c = std::process::Command::new("explorer.exe");
        // explorer takes "/select,<path>" as one argument.
        c.arg(if reveal { format!("/select,{}", path.display()) } else { path.display().to_string() });
        c
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = std::process::Command::new("open");
        if reveal {
            c.arg("-R");
        }
        c.arg(path);
        c
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(if reveal { path.parent().unwrap_or(path) } else { path });
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<std::ffi::OsString> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.into())
    }

    #[test]
    fn t761_the_file_follows_the_profile_home_and_the_override() {
        let user = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let scratch = home_from(env(&[(user, "/scratch/home")])).unwrap();
        assert_eq!(path_under(&scratch), Path::new("/scratch/home").join(".kolux").join(FILE_NAME), "a scratch profile reads its own file, not the account one");
        assert_eq!(home_from(env(&[(user, "/scratch/home"), ("KOLUX_KEYBINDINGS_HOME", "/proof/home")])), Some(PathBuf::from("/proof/home")), "the override still wins");
        assert_eq!(home_from(env(&[(user, ""), ("KOLUX_KEYBINDINGS_HOME", "")])), None, "empty values fall back to the app lookup");
        assert_eq!(home_from(env(&[(user, "/scratch/home"), ("KOLUX_KEYBINDINGS_HOME", "")])), Some(PathBuf::from("/scratch/home")), "an empty override is skipped");
        if cfg!(windows) {
            assert_eq!(home_from(env(&[("HOME", "/git/bash/home")])), None, "a shell's HOME is not the Windows profile");
        }
    }

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-keys-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_is_created_empty_in_the_home_folder() {
        let home = temp_home("missing");
        let first = read(&home);
        let path = home.join(".kolux").join("keybindings.json");
        assert_eq!(first.path, path.display().to_string());
        assert!(first.created);
        assert_eq!(first.error, None);
        let v = first.value.unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["keybindings"], serde_json::json!({}));
        assert_eq!(v["platforms"]["win32"], serde_json::json!({}));
        assert!(!path.with_extension("json.tmp").exists());
        // The second read finds the file and does not claim to have created it.
        let second = read(&home);
        assert!(!second.created);
        assert_eq!(second.value, Some(v));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_broken_file_is_reported_and_never_written_over() {
        let home = temp_home("broken");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let broken = "{ \"version\": 1, \"keybindings\": { \"terminal.clear\": null, }";
        fs::write(&path, broken).unwrap();
        let got = read(&home);
        assert!(!got.created);
        assert_eq!(got.value, None);
        assert!(got.error.as_deref().unwrap().contains("default shortcuts are in use"));
        assert_eq!(fs::read_to_string(&path).unwrap(), broken);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_file_that_is_not_an_object_is_reported() {
        let home = temp_home("array");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[1, 2]").unwrap();
        let got = read(&home);
        assert_eq!(got.value, None);
        assert!(got.error.as_deref().unwrap().contains("not a JSON object"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1, 2]");
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_write_touches_one_command_in_this_platforms_section_only() {
        let home = temp_home("write");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"$schema":"x","version":1,"keybindings":{"app.settings":"Mod+Shift+Comma"},"platforms":{"darwin":{"a.b":null},"win32":{"z.last":"Mod+Z","a.first":false}}}"#).unwrap();
        let v = write(&home, "win32", "terminal.clear", serde_json::json!("Mod+Shift+K"), false).unwrap().value.unwrap();
        assert_eq!(v["platforms"]["win32"]["terminal.clear"], "Mod+Shift+K");
        // Everything else stays, in the order it was written.
        assert_eq!(v["$schema"], "x");
        assert_eq!(v["platforms"]["darwin"]["a.b"], serde_json::Value::Null);
        let keys: Vec<_> = v["platforms"]["win32"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["z.last", "a.first", "terminal.clear"]);
        // Disabled is null; several chords are a list.
        write(&home, "win32", "terminal.clear", serde_json::Value::Null, false).unwrap();
        let v = write(&home, "win32", "tab.next", serde_json::json!(["Mod+Tab", "Alt+Right"]), false).unwrap().value.unwrap();
        assert_eq!(v["platforms"]["win32"]["terminal.clear"], serde_json::Value::Null);
        assert_eq!(v["platforms"]["win32"]["tab.next"], serde_json::json!(["Mod+Tab", "Alt+Right"]));
        // Reset takes the command out; when the all-platforms section still overrides it, the
        // shipped default is written instead.
        let v = write(&home, "win32", "terminal.clear", serde_json::json!(["Mod+K"]), true).unwrap().value.unwrap();
        assert!(v["platforms"]["win32"].get("terminal.clear").is_none());
        let v = write(&home, "win32", "app.settings", serde_json::json!(["Mod+Comma"]), true).unwrap().value.unwrap();
        assert_eq!(v["platforms"]["win32"]["app.settings"], serde_json::json!(["Mod+Comma"]));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_write_refuses_a_broken_file_and_bad_input() {
        let home = temp_home("write-bad");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ broken").unwrap();
        assert!(write(&home, "win32", "terminal.clear", serde_json::json!("Mod+K"), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ broken");
        fs::write(&path, "{}").unwrap();
        assert!(write(&home, "win32", "../x", serde_json::json!("Mod+K"), false).is_err());
        assert!(write(&home, "win32", "terminal.clear", serde_json::json!(5), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
        // A file with no platforms block gets one.
        let v = write(&home, "linux", "terminal.clear", serde_json::json!("Mod+K"), false).unwrap().value.unwrap();
        assert_eq!(v["platforms"]["linux"]["terminal.clear"], "Mod+K");
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn showing_the_file_opens_it_or_selects_it_in_its_folder() {
        let path = Path::new("C:/Users/x/.kolux/keybindings.json");
        let args = |c: &std::process::Command| c.get_args().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let open = show_command(path, false);
        let reveal = show_command(path, true);
        if cfg!(windows) {
            assert_eq!(open.get_program(), "explorer.exe");
            assert_eq!(args(&open), [path.display().to_string()]);
            assert_eq!(args(&reveal), [format!("/select,{}", path.display())]);
        } else if cfg!(target_os = "macos") {
            assert_eq!(args(&reveal)[0], "-R");
        }
    }

    #[test]
    fn overrides_come_back_as_written() {
        let home = temp_home("overrides");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"version\":1,\"keybindings\":{\"terminal.clear\":null},\"platforms\":{\"win32\":{\"worktree.palette\":\"Mod+Shift+P\"}}}").unwrap();
        let got = read(&home);
        let v = got.value.unwrap();
        assert_eq!(v["keybindings"]["terminal.clear"], serde_json::Value::Null);
        assert_eq!(v["platforms"]["win32"]["worktree.palette"], "Mod+Shift+P");
        fs::remove_dir_all(&home).unwrap();
    }
}
