//! T-122 (STAT-019): Devin CLI status hooks, from Cognition's public docs (PROVENANCE.md, T-122):
//! the user's hooks live under the `hooks` key of Devin's user config, `%APPDATA%\devin\config.json`
//! on Windows (`~/.config/devin/config.json` elsewhere), keyed by event with Claude Code's matcher
//! groups; payloads carry `hook_event_name`, `session_id`, `prompt`, `tool_name`, `tool_input`.
//!
//! The file is commented JSON, so Kolux never rewrites it: its entries go in as blocks between
//! marker comments (`jsonc`), and taking them out gives the file back byte for byte.

use super::super::super::write_atomic;
use super::super::{backup_of, names_mine, read_opt, target_dir, was_created, BACKUP_RECORD};
use super::jsonc::{self, Kind};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const SCRIPT: &str = "devin.cmd";
/// STAT-019: Devin's events, as its compat list names them.
pub const EVENTS: [&str; 8] = ["SessionStart", "UserPromptSubmit", "Stop", "PostCompaction", "SessionEnd", "PreToolUse", "PostToolUse", "PermissionRequest"];
const TIMEOUT: u64 = 10;
/// The overlap warning the status row carries while Devin also loads Claude Code's settings.
pub const OVERLAP: &str = "Devin also loads Claude Code's settings (read_config_from.claude), so Kolux's Claude Code hooks run in Devin panes too";

/// Devin's user config: the roaming application-data folder on Windows.
pub fn file(home: &Path) -> PathBuf {
    if cfg!(windows) {
        // APPDATA for the real home; any other home (a scratch one) keeps the file inside it.
        let appdata = (home == super::super::super::home_dir()).then(|| std::env::var_os("APPDATA")).flatten().filter(|a| !a.is_empty());
        let roaming = appdata.map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"));
        roaming.join("devin").join("config.json")
    } else {
        home.join(".config").join("devin").join("config.json")
    }
}

pub fn write_script(home: &Path) -> Result<String, String> {
    // A Devin hook's output can carry a decision, so the script prints nothing.
    super::super::super::write_script(home, SCRIPT, &super::super::super::script("devin", "devin", false))
}

fn group(script_path: &str) -> Value {
    json!({ "hooks": [{ "type": "command", "command": format!("\"{script_path}\""), "timeout": TIMEOUT }] })
}

fn compact(v: &Value) -> String {
    serde_json::to_string(v).expect("plain JSON")
}

/// `base` (a file with none of Kolux's blocks) with Kolux's blocks put in: under each event the
/// user already hooks, one block opening that event's list; for the rest, one block opening the
/// `hooks` map (or, with no `hooks` key, one block opening the file holding the whole key).
pub fn with_blocks(file: &Path, base: Option<&str>, script_path: &str) -> Result<String, String> {
    let g = compact(&group(script_path));
    let Some(base) = base else {
        let hooks: serde_json::Map<String, Value> = EVENTS.iter().map(|e| (e.to_string(), json!([group(script_path)]))).collect();
        return Ok(format!("{{{}}}\n", jsonc::block(&format!("\"hooks\": {}", compact(&Value::Object(hooks))), false, "  ", "\n")));
    };
    let unreadable = |e: String| format!("{} is not readable commented JSON ({e}); left alone", file.display());
    let doc = jsonc::parse(base).map_err(unreadable)?;
    let nl = jsonc::newline(base);
    if !matches!(doc.root.kind, Kind::Object(_)) {
        return Err(format!("{} has a top level that is not an object; left alone", file.display()));
    }
    let Some(hooks) = doc.root.member("hooks") else {
        let all: Vec<String> = EVENTS.iter().map(|e| format!("\"{e}\": [{g}]")).collect();
        let content = format!("\"hooks\": {{{}}}", all.join(", "));
        return Ok(jsonc::insert_all(base, vec![(doc.root.start + 1, jsonc::block(&content, !doc.root.is_empty(), "  ", nl))]));
    };
    if !matches!(hooks.kind, Kind::Object(_)) {
        return Err(format!("{} has a \"hooks\" value that is not an object; left alone", file.display()));
    }
    let mut edits = Vec::new();
    let mut missing = Vec::new();
    for e in EVENTS {
        match hooks.member(e) {
            Some(list) if matches!(list.kind, Kind::Array(_)) => edits.push((list.start + 1, jsonc::block(&g, !list.is_empty(), "      ", nl))),
            Some(_) => return Err(format!("{} has a \"{e}\" value that is not a list; left alone", file.display())),
            None => missing.push(format!("\"{e}\": [{g}]")),
        }
    }
    if !missing.is_empty() {
        edits.push((hooks.start + 1, jsonc::block(&missing.join(", "), !hooks.is_empty(), "    ", nl)));
    }
    Ok(jsonc::insert_all(base, edits))
}

/// STAT-019: Kolux's blocks go in (an older set of them comes out first); comments, layout and
/// every key of the user's stay byte for byte. A copy is kept before the first write.
pub fn install(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_script(home)?;
    let text = read_opt(file)?;
    let broken = |e: String| format!("{}: {e}; left alone", file.display());
    let old = match text.as_deref() {
        Some(t) => jsonc::without(t).map_err(broken)?,
        None => None,
    };
    let mine_already = old.is_some();
    let base = old.as_deref().or(text.as_deref());
    let new = with_blocks(file, base, &path)?;
    if text.as_deref() == Some(new.as_str()) {
        return Ok(false);
    }
    super::keep_copy(home, file, "devin", mine_already)?;
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// STAT-019: Kolux's blocks come out and the file is the user's again, byte for byte; a file Kolux
/// created and left holding nothing goes. A second removal changes nothing.
pub fn remove(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let Some(rest) = jsonc::without(&text).map_err(|e| format!("{}: {e}; left alone", file.display()))? else { return Ok(false) };
    let record = target_dir(home, file).join(BACKUP_RECORD);
    if jsonc::to_value(&rest).is_ok_and(|v| v == json!({})) && !rest.contains("//") && !rest.contains("/*") && !backup_of(file).exists() && was_created(&record, file) {
        if fs::read(file).map_err(|e| format!("{}: {e}", file.display()))? != text.as_bytes() {
            return Err(format!("{} {}", file.display(), super::super::super::CHANGED));
        }
        fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
        let _ = fs::remove_file(record);
        return Ok(true);
    }
    write_atomic(file, rest.as_bytes(), Some(&text))?;
    Ok(true)
}

/// STAT-019: Devin loads Claude Code's settings unless `read_config_from.claude` is false (on by
/// default, per its docs).
pub fn loads_claude(v: &Value) -> bool {
    let set = v.get("read_config_from").and_then(|r| r.get("claude")).or_else(|| v.get("read_config_from.claude"));
    set.and_then(Value::as_bool) != Some(false)
}

/// The status row for Devin: the overlap warning rides along while Kolux's hooks are in.
pub fn inspect(file: &Path) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(None) => return ("not installed", None),
        Ok(Some(t)) => t,
        Err(e) => return ("error", Some(e)),
    };
    if let Err(e) = jsonc::blocks(&text) {
        return ("partial", Some(e));
    }
    let v = match jsonc::to_value(&text) {
        Ok(v) => v,
        Err(e) => return ("error", Some(format!("{} is not readable commented JSON ({e})", file.display()))),
    };
    let has = |e: &str| v.get("hooks").and_then(|h| h.get(e)).and_then(Value::as_array).is_some_and(|gs| gs.iter().filter_map(|g| g.get("hooks").and_then(Value::as_array)).flatten().any(names_mine));
    let missing: Vec<&str> = EVENTS.iter().copied().filter(|e| !has(e)).collect();
    if missing.len() == EVENTS.len() {
        return ("not installed", None);
    }
    let warn = loads_claude(&v).then_some(OVERLAP);
    match (missing.is_empty(), warn) {
        (true, w) => ("installed", w.map(str::to_string)),
        (false, w) => ("partial", Some([Some(format!("no Kolux entry for {}", missing.join(", "))), w.map(str::to_string)].into_iter().flatten().collect::<Vec<_>>().join("; "))),
    }
}

/// One Devin event (route `devin`, the event named in the payload) as the status rules read it.
pub fn event<'a>(name: &str, event: &'a Value) -> Option<(&'static str, Option<&'a str>, Value)> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input") });
    let (name, out) = match name {
        "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
        "PreToolUse" => ("PreToolUse", tool()),
        "PermissionRequest" => ("PermissionRequest", tool()),
        "PostToolUse" => ("PostToolUse", json!({ "tool_name": str_of("tool_name") })),
        // STAT-019: a compaction means working; session end means done.
        "PostCompaction" => ("PostToolUse", json!({})),
        "Stop" | "SessionEnd" => ("Stop", json!({})),
        // Session start is ignored.
        _ => return None,
    };
    Some((name, str_of("session_id"), out))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANNED: &str = "// Devin user config\n{\n  /* model choice */\n  \"model\": \"swe\", // keep\n  \"read_config_from\": { \"claude\": true, },\n  \"hooks\": {\n    // my own stop hook\n    \"Stop\": [\n      { \"hooks\": [{ \"type\": \"command\", \"command\": \"notify.sh\" }] },\n    ],\n  },\n}\n";

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-t122-devin-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stat_019_install_keeps_comments_and_removal_gives_the_file_back_byte_for_byte() {
        let home = scratch("keep");
        let file = home.join("AppData").join("Roaming").join("devin").join("config.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, CANNED).unwrap();
        assert!(install(&home, &file).unwrap());
        let after = fs::read_to_string(&file).unwrap();
        for kept in ["// Devin user config", "/* model choice */", "// keep", "// my own stop hook", "notify.sh"] {
            assert!(after.contains(kept), "{kept} survives the install");
        }
        let v = jsonc::to_value(&after).unwrap();
        assert_eq!(v["model"], "swe");
        for e in EVENTS {
            assert!(v["hooks"][e].as_array().unwrap().iter().any(|g| g["hooks"].as_array().unwrap().iter().any(names_mine)), "{e}");
        }
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 2, "the user's Stop group stays beside Kolux's");
        assert!(!install(&home, &file).unwrap(), "installing again changes nothing");
        assert_eq!(inspect(&file), ("installed", Some(OVERLAP.to_string())), "Claude settings loading on: the overlap warning rides along");
        assert!(backup_of(&file).exists(), "a copy is kept before the first write");
        assert!(remove(&home, &file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), CANNED, "byte for byte the user's file again");
        assert!(!remove(&home, &file).unwrap(), "a second removal changes nothing");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn stat_019_files_without_hooks_crlf_and_absent_files() {
        let home = scratch("shapes");
        let file = home.join("config.json");
        // No hooks key, CRLF line breaks, a trailing comma, Claude loading switched off.
        let crlf = "{\r\n  // comment\r\n  \"read_config_from\": { \"claude\": false },\r\n}\r\n";
        fs::write(&file, crlf).unwrap();
        assert!(install(&home, &file).unwrap());
        let after = fs::read_to_string(&file).unwrap();
        assert!(!after.replace("\r\n", "").contains('\n'), "the file's own line breaks are used");
        assert_eq!(inspect(&file), ("installed", None), "Claude loading off: no warning");
        assert!(remove(&home, &file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), crlf);
        // Absent: Kolux creates it, and taking its hooks out deletes it again.
        fs::remove_file(&file).unwrap();
        let _ = fs::remove_file(backup_of(&file));
        assert!(install(&home, &file).unwrap());
        assert!(jsonc::to_value(&fs::read_to_string(&file).unwrap()).unwrap()["hooks"]["Stop"].is_array());
        assert!(remove(&home, &file).unwrap());
        assert!(!file.exists(), "a file Kolux created goes with its hooks");
        // Shapes Kolux cannot edit safely are left alone.
        for bad in ["[1]", "{\"hooks\": []}", "{\"hooks\": {\"Stop\": {}}}", "{ /* open", "{\n// >>> kolux status hooks\n\"a\": 1}"] {
            fs::write(&file, bad).unwrap();
            assert!(install(&home, &file).is_err(), "{bad}");
            assert_eq!(fs::read_to_string(&file).unwrap(), bad);
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn stat_019_devin_events_drive_the_dot() {
        let ev = |n: &str, v: Value| event(n, &v).map(|(name, s, out)| (name, s.map(str::to_string), out));
        assert!(ev("SessionStart", json!({ "session_id": "d1" })).is_none(), "session start is ignored");
        let (n, s, out) = ev("UserPromptSubmit", json!({ "session_id": "d1", "prompt": "go" })).unwrap();
        assert_eq!((n, s.as_deref(), out["prompt"].as_str()), ("UserPromptSubmit", Some("d1"), Some("go")));
        assert_eq!(ev("PermissionRequest", json!({ "session_id": "d1", "tool_name": "exec", "tool_input": {} })).unwrap().0, "PermissionRequest");
        assert_eq!(ev("PostCompaction", json!({ "session_id": "d1", "summary": null })).unwrap().0, "PostToolUse");
        assert_eq!(ev("Stop", json!({ "session_id": "d1" })).unwrap().0, "Stop");
        assert_eq!(ev("SessionEnd", json!({ "session_id": "d1" })).unwrap().0, "Stop");
        assert!(loads_claude(&json!({})), "on by default");
        assert!(!loads_claude(&json!({ "read_config_from": { "claude": false } })));
    }
}
