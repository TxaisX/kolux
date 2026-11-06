//! T-122 (STAT-018): Grok status hooks, from xAI's public docs (PROVENANCE.md, T-122):
//! personal hook files are `*.json` in `hooks` under Grok's home (`~/.grok`, or `GROK_HOME`), each
//! `{"hooks": {"<event>": [{"matcher", "hooks": [{"type": "command", "command", "timeout"}]}]}}`;
//! payloads carry `hookEventName`, `sessionId`, `toolName`, `toolInput`.
//!
//! Kolux writes its own file there, `kolux-rs.json`, and takes it away again when it quits, unless
//! another running Kolux still owns it. Every removal takes out only the entries Kolux wrote; a
//! file the user emptied stays empty across launches and comes back only when the user switches the
//! hooks off and on again.

use super::super::super::{is_my_command, write_atomic, SCRIPT_DIR};
use super::super::{read_opt, target_dir};
use super::Memory;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SCRIPT: &str = "grok.cmd";
/// STAT-018: Grok's events, as its compat list names them.
pub const EVENTS: [&str; 9] = ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification"];
/// Seconds (Grok's default is 5).
const TIMEOUT: u64 = 10;
/// The Kolux runs that own Grok's file, in Kolux's own script folder.
const OWNERS: &str = "grok-owners.json";
/// The text Kolux last wrote into Grok's file, beside its other records for that file.
const WRITTEN: &str = "grok-written.json";
/// STAT-018: how long the quit waits for the removal.
pub const QUIT_LIMIT: Duration = Duration::from_secs(2);

/// Grok's home: `GROK_HOME` when set (for the real home only; a scratch home keeps it inside),
/// else `~/.grok`.
pub fn home_of(home: &Path) -> PathBuf {
    (home == super::super::super::home_dir()).then(|| std::env::var_os("GROK_HOME")).flatten().filter(|h| !h.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".grok"))
}

/// Kolux's own hook file in Grok's home.
pub fn file(home: &Path) -> PathBuf {
    home_of(home).join("hooks").join("kolux-rs.json")
}

pub fn write_script(home: &Path) -> Result<String, String> {
    // Grok reads stdout only for a tool decision; nothing printed means no decision.
    super::super::super::write_script(home, SCRIPT, &super::super::super::script("grok", "grok/%~1", false))
}

fn written_record(home: &Path, file: &Path) -> PathBuf {
    target_dir(home, file).join(WRITTEN)
}

/// An entry of Grok's file is Kolux's when its command runs a script from Kolux's folder.
fn entry_mine(h: &Value) -> bool {
    h.get("command").and_then(Value::as_str).is_some_and(is_my_command)
}

fn has_mine(v: &Value) -> bool {
    v.get("hooks").and_then(Value::as_object).is_some_and(|h| h.values().filter_map(Value::as_array).flatten().filter_map(|g| g.get("hooks").and_then(Value::as_array)).flatten().any(entry_mine))
}

/// A file with nothing in it: no text, `{}`, or an empty or entry-less `hooks` map.
fn emptied(text: &str) -> bool {
    if text.trim().is_empty() {
        return true;
    }
    let Ok(v) = serde_json::from_str::<Value>(text) else { return false };
    let Some(o) = v.as_object() else { return false };
    o.iter().all(|(k, v)| k == "hooks" && v.as_object().is_some_and(|h| h.values().all(|l| l.as_array().is_some_and(|l| l.iter().all(|g| g.get("hooks").and_then(Value::as_array).is_some_and(Vec::is_empty))))))
}

/// The whole file Kolux writes: one group per event, no matcher (every tool), the event as the
/// script's argument.
pub fn contents(script_path: &str) -> String {
    let hooks: Map<String, Value> = EVENTS.iter().map(|e| (e.to_string(), json!([{ "hooks": [{ "type": "command", "command": format!("\"{script_path}\" {e}"), "timeout": TIMEOUT }] }]))).collect();
    let mut s = serde_json::to_string_pretty(&json!({ "hooks": hooks })).expect("plain JSON");
    s.push('\n');
    s
}

/// STAT-018: Kolux's file goes in whole when it is absent, or when it still holds exactly what
/// Kolux last wrote. A hand edit of it, a file the user emptied, and a file of the user's under the
/// same name are left as they are.
pub fn install(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_script(home)?;
    let new = contents(&path);
    let text = read_opt(file)?;
    match text.as_deref() {
        Some(t) if t == new => return Ok(false),
        Some(t) if emptied(t) => return Ok(false),
        Some(t) if !serde_json::from_str::<Value>(t).is_ok_and(|v| has_mine(&v)) => return Err(format!("{} is not Kolux's own hook file; left alone", file.display())),
        // Kolux's file, edited by hand since Kolux wrote it: the edit stands.
        Some(t) if fs::read_to_string(written_record(home, file)).ok().as_deref() != Some(t) => return Ok(false),
        _ => {}
    }
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}; hooks not installed", dir.display()))?;
    }
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    // The record's place comes from the resolved file path, so it is taken once the folder exists.
    remember(&written_record(home, file), &new);
    Ok(true)
}

fn remember(record: &Path, text: &str) {
    if let Some(dir) = record.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(record, text);
}

/// Takes Kolux's entries out of Grok's file; the user's entries and keys stay. The file goes when
/// nothing else is left in it; `emptied_too` also takes away a file the user emptied (switching the
/// hooks off, so switching them on again puts them back). Never writes over a newer edit.
pub fn remove(home: &Path, file: &Path, emptied_too: bool) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let record = written_record(home, file);
    if emptied(&text) {
        if !emptied_too || !record.exists() {
            return Ok(false);
        }
        delete_if_same(file, &text)?;
        let _ = fs::remove_file(&record);
        return Ok(true);
    }
    let mut v: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    if !has_mine(&v) {
        return Ok(false);
    }
    let Some(hooks) = v.get_mut("hooks").and_then(Value::as_object_mut) else { return Ok(false) };
    for list in hooks.values_mut().filter_map(Value::as_array_mut) {
        for g in list.iter_mut() {
            if let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                hs.retain(|h| !entry_mine(h));
            }
        }
        list.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|h| !h.is_empty()));
    }
    hooks.retain(|_, l| l.as_array().is_none_or(|l| !l.is_empty()));
    let Some(root) = v.as_object_mut() else { return Ok(false) };
    if root.get("hooks").and_then(Value::as_object).is_some_and(Map::is_empty) {
        root.remove("hooks");
    }
    if root.is_empty() {
        delete_if_same(file, &text)?;
        let _ = fs::remove_file(&record);
    } else {
        let mut s = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
        s.push('\n');
        write_atomic(file, s.as_bytes(), Some(&text))?;
    }
    Ok(true)
}

/// Deletes `file` only while it still holds `text`.
fn delete_if_same(file: &Path, text: &str) -> Result<(), String> {
    if fs::read(file).map_err(|e| format!("{}: {e}", file.display()))? != text.as_bytes() {
        return Err(format!("{} {}", file.display(), super::super::super::CHANGED));
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))
}

/// One Kolux run that owns Grok's file.
#[derive(Clone, Debug, PartialEq)]
pub struct Owner {
    pub host: Option<String>,
    pub pid: u32,
    /// The moment the machine booted, in seconds since 1970, to the minute.
    pub boot: Option<u64>,
    pub profile: Option<String>,
}

impl Owner {
    fn to_json(&self) -> Value {
        json!({ "host": self.host, "pid": self.pid, "boot": self.boot, "profile": self.profile })
    }

    fn from_json(v: &Value) -> Option<Owner> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Some(Owner { host: s("host"), pid: u32::try_from(v.get("pid")?.as_u64()?).ok()?, boot: v.get("boot").and_then(Value::as_u64), profile: s("profile") })
    }
}

/// This run.
pub fn me(profile: &Path) -> Owner {
    Owner { host: std::env::var("COMPUTERNAME").ok().filter(|h| !h.is_empty()), pid: std::process::id(), boot: boot_moment(), profile: Some(profile.display().to_string()) }
}

#[cfg(windows)]
fn boot_moment() -> Option<u64> {
    // SAFETY: GetTickCount64 takes no arguments and only reads the tick count.
    let up = unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() } / 1000;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(now.checked_sub(up)? / 60 * 60)
}

#[cfg(not(windows))]
fn boot_moment() -> Option<u64> {
    None
}

/// STAT-018: whether `other` may still run, seen from `me`. An owner on another machine, or whose
/// boot, process or profile cannot be checked, counts as running, so the settings stay.
pub fn still_runs(other: &Owner, me: &Owner, running: impl Fn(u32) -> Option<bool>) -> bool {
    let (Some(h), Some(mh)) = (&other.host, &me.host) else { return true };
    if !h.eq_ignore_ascii_case(mh) {
        return true;
    }
    let (Some(b), Some(mb)) = (other.boot, me.boot) else { return true };
    // A run from an earlier boot has ended (the minute rounding is allowed for).
    if b.abs_diff(mb) > 120 {
        return false;
    }
    if other.profile.as_deref().is_none_or(|p| !Path::new(p).is_dir()) {
        return true;
    }
    running(other.pid).unwrap_or(true)
}

fn owners_file(home: &Path) -> PathBuf {
    home.join(SCRIPT_DIR).join(OWNERS)
}

fn read_owners(home: &Path) -> Vec<Owner> {
    fs::read_to_string(owners_file(home)).ok().and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok()).map(|l| l.iter().filter_map(Owner::from_json).collect()).unwrap_or_default()
}

fn write_owners(home: &Path, owners: &[Owner]) {
    let file = owners_file(home);
    if owners.is_empty() {
        let _ = fs::remove_file(file);
        return;
    }
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let v: Vec<Value> = owners.iter().map(Owner::to_json).collect();
    let _ = fs::write(file, serde_json::to_string(&v).unwrap_or_default());
}

/// This run owns Grok's file from now on (owners that have ended are dropped).
pub fn own(home: &Path, me: &Owner, running: impl Fn(u32) -> Option<bool>) {
    let mut owners: Vec<Owner> = read_owners(home).into_iter().filter(|o| o != me && still_runs(o, me, &running)).collect();
    owners.push(me.clone());
    write_owners(home, &owners);
}

/// STAT-018 at quit: this run lets go of Grok's file; when no other running Kolux owns it, Kolux's
/// entries come out (a file the user emptied stays empty). Returns what was done.
pub fn quit_at(home: &Path, file: &Path, me: &Owner, running: impl Fn(u32) -> Option<bool>) -> Result<&'static str, String> {
    let all = read_owners(home);
    let others: Vec<Owner> = all.iter().filter(|o| *o != me && still_runs(o, me, &running)).cloned().collect();
    write_owners(home, &others);
    if !others.is_empty() {
        return Ok("kept: another running Kolux owns them");
    }
    remove(home, file, false).map(|r| if r { "removed" } else { "nothing to remove" })
}

/// `quit_at` for the app's own quit, cut short after `QUIT_LIMIT`; fenced runs write only under a
/// scratch folder, as every install does. Called from the app's exit path (wired by
/// evidence/hooks-T-122-2-lib.rs.patch).
#[allow(dead_code)]
pub fn at_quit(profile: &Path) {
    let home = super::super::super::home_dir();
    let Ok(file) = super::target(profile, file(&home)) else { return };
    let me = me(profile);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(quit_at(&home, &file, &me, crate::procs::alive));
    });
    match rx.recv_timeout(QUIT_LIMIT) {
        Ok(Ok(what)) => eprintln!("kolux-rs: grok hooks at quit: {what}"),
        Ok(Err(e)) => eprintln!("kolux-rs: grok hooks at quit: {e}"),
        Err(_) => eprintln!("kolux-rs: grok hooks at quit: not finished within {} s; left as they are", QUIT_LIMIT.as_secs()),
    }
}

/// The status row for Grok.
pub fn inspect(home: &Path, file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) if emptied(&t) => ("not installed", Some(if written_record(home, file).exists() { "emptied by hand; switch the hooks off and on to put them back".into() } else { "the file is empty".into() })),
        Ok(Some(t)) => match serde_json::from_str::<Value>(&t) {
            Ok(v) if has_mine(&v) => {
                let has = |e: &str| v["hooks"].get(e).and_then(Value::as_array).is_some_and(|gs| gs.iter().filter_map(|g| g.get("hooks").and_then(Value::as_array)).flatten().any(entry_mine));
                let missing: Vec<&str> = EVENTS.iter().copied().filter(|e| !has(e)).collect();
                if missing.is_empty() { ("installed", None) } else { ("partial", Some(format!("no Kolux entry for {}", missing.join(", ")))) }
            }
            Ok(_) => ("error", Some(format!("{} is not Kolux's own hook file", file.display()))),
            Err(e) => ("error", Some(format!("{} is not JSON ({e})", file.display()))),
        },
        Err(e) => ("error", Some(e)),
    }
}

enum Notice {
    Routine,
    Permission,
    Ask,
    Idle,
}

/// STAT-018: a Grok notice by its wording. Only the generic per-tool permission notice at
/// information level is routine; one asking for permission or approval is needs you, one asking
/// for feedback or an answer is a question, one showing Grok back at its empty prompt is done.
fn notice(level: Option<&str>, message: &str, tool: Option<&str>) -> Option<Notice> {
    let m = message.to_ascii_lowercase();
    let info = level.is_some_and(|l| l.eq_ignore_ascii_case("info"));
    let per_tool = m.contains("tool") || tool.is_some_and(|t| m.contains(&t.to_ascii_lowercase()));
    if info && m.contains("permission") && per_tool && !m.contains("approv") && !m.contains('?') {
        Some(Notice::Routine)
    } else if m.contains("permission") || m.contains("approv") {
        Some(Notice::Permission)
    } else if m.contains("feedback") || m.contains("answer") {
        Some(Notice::Ask)
    } else if m.contains("waiting for input") || m.contains("waiting for your input") || m.contains("ready for input") || m.contains("input prompt") || m.contains("idle") {
        Some(Notice::Idle)
    } else {
        None
    }
}

/// One Grok event (route `grok/<event>`) as the status rules read it: the event name, the session
/// and the normalized body; `None` when it changes nothing. Both spellings of each field are read.
pub fn event<'a>(memory: &mut Memory, name: &str, event: &'a Value) -> Option<(&'static str, Option<&'a str>, Value)> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let either = |a: &str, b: &str| str_of(a).or_else(|| str_of(b));
    let session = either("sessionId", "session_id");
    let tool_name = either("toolName", "tool_name");
    let input = event.get("toolInput").or_else(|| event.get("tool_input"));
    let tool = |n: Option<&str>, i: Option<&Value>| json!({ "tool_name": n, "tool_input": i });
    let (name, out) = match name {
        // Notice text is never kept as the prompt: only the submitted prompt is.
        "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": either("prompt", "userPrompt") })),
        "PreToolUse" => {
            if let Some(s) = session {
                memory.tool(s, tool_name);
            }
            // STAT-061 (row 170): Grok's ask-the-user tool has no permission step, so its start is
            // the question; its end or failure is plain tool work again (the arm below).
            let normalized = tool(tool_name, input);
            match crate::grok_status::change(&json!({ "hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": input })) {
                Some(t) if t.state == "waiting" => ("PreToolUse", json!({ "kolux_ask": t.question.unwrap_or_else(|| "Grok is asking you something".into()) })),
                _ => ("PreToolUse", normalized),
            }
        }
        "PostToolUse" | "PostToolUseFailure" => ("PostToolUse", tool(tool_name, None)),
        // STAT-018: a failed stop and a session end both mean done.
        "Stop" | "StopFailure" | "SessionEnd" => ("Stop", json!({})),
        "Notification" => {
            let message = either("message", "text")?;
            let last = session.and_then(|s| memory.last_tool(s));
            match notice(either("level", "notificationLevel"), message, last)? {
                Notice::Routine => ("PostToolUse", json!({})),
                Notice::Permission => ("PermissionRequest", tool(last, None)),
                Notice::Ask => ("PreToolUse", json!({ "kolux_ask": message })),
                Notice::Idle => ("Stop", json!({})),
            }
        }
        // Session start fires while idle.
        _ => return None,
    };
    Some((name, session, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-t122-grok-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn owner(pid: u32, profile: &Path) -> Owner {
        Owner { host: Some("PC".into()), pid, boot: Some(1_000_000), profile: Some(profile.display().to_string()) }
    }

    #[test]
    fn stat_018_install_writes_kolux_own_file_and_respects_hand_edits_and_emptying() {
        let home = scratch("install");
        let file = home.join(".grok").join("hooks").join("kolux-rs.json");
        assert!(install(&home, &file).unwrap(), "absent: written");
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        for e in EVENTS {
            assert!(v["hooks"][e][0]["hooks"][0]["command"].as_str().unwrap().ends_with(&format!("grok.cmd\" {e}")), "{e}");
        }
        assert!(!install(&home, &file).unwrap(), "the same again writes nothing");
        assert_eq!(inspect(&home, &file).0, "installed");
        // A hand edit of Kolux's file stands.
        let mut edited = v.clone();
        edited["hooks"].as_object_mut().unwrap().remove("Notification");
        fs::write(&file, serde_json::to_string(&edited).unwrap()).unwrap();
        assert!(!install(&home, &file).unwrap());
        assert_eq!(inspect(&home, &file).0, "partial");
        // Emptied by hand: not put back on the next launch.
        fs::write(&file, "{}").unwrap();
        assert!(!install(&home, &file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
        assert!(inspect(&home, &file).1.unwrap().contains("emptied"));
        // Switching the hooks off takes the emptied file away; on again puts them back.
        assert!(remove(&home, &file, true).unwrap());
        assert!(!file.exists());
        assert!(install(&home, &file).unwrap());
        // A file of the user's under Kolux's name is never written.
        let theirs = r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify.sh"}]}]}}"#;
        fs::write(&file, theirs).unwrap();
        assert!(install(&home, &file).is_err());
        assert!(!remove(&home, &file, true).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), theirs);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn stat_018_removal_is_idempotent_and_takes_out_only_kolux_entries() {
        let home = scratch("remove");
        let file = home.join(".grok").join("hooks").join("kolux-rs.json");
        install(&home, &file).unwrap();
        // The user added an entry of their own next to Kolux's.
        let mut v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        v["hooks"]["Stop"][0]["hooks"].as_array_mut().unwrap().push(json!({ "type": "command", "command": "notify.sh" }));
        fs::write(&file, serde_json::to_string(&v).unwrap()).unwrap();
        assert!(remove(&home, &file, false).unwrap());
        let left: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(left, json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "notify.sh" }] }] } }));
        assert!(!remove(&home, &file, false).unwrap(), "a second removal changes nothing");
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&file).unwrap()).unwrap(), left);
        // Only Kolux's: the file goes whole.
        fs::remove_file(&file).unwrap();
        install(&home, &file).unwrap();
        assert!(remove(&home, &file, false).unwrap());
        assert!(!file.exists());
        assert!(!remove(&home, &file, false).unwrap(), "already gone: nothing to do");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn stat_018_quit_removes_the_file_unless_another_running_kolux_owns_it() {
        let home = scratch("quit");
        let file = home.join(".grok").join("hooks").join("kolux-rs.json");
        let me = owner(10, &home);
        let other = owner(20, &home);
        install(&home, &file).unwrap();
        own(&home, &other, |_| Some(true));
        own(&home, &me, |_| Some(true));
        assert_eq!(read_owners(&home).len(), 2);
        assert_eq!(quit_at(&home, &file, &me, |_| Some(true)).unwrap(), "kept: another running Kolux owns them");
        assert!(file.exists());
        // The other run cannot be checked: it counts as running.
        own(&home, &me, |_| Some(true));
        assert!(quit_at(&home, &file, &me, |_| None).unwrap().starts_with("kept"));
        // It has ended: the file goes, and the owners record with it.
        own(&home, &me, |_| Some(true));
        assert_eq!(quit_at(&home, &file, &me, |p| Some(p == 10)).unwrap(), "removed");
        assert!(!file.exists() && read_owners(&home).is_empty());
        assert_eq!(quit_at(&home, &file, &me, |_| Some(false)).unwrap(), "nothing to remove");
        // Emptied by hand: the quit leaves it empty.
        install(&home, &file).unwrap();
        fs::write(&file, "").unwrap();
        assert_eq!(quit_at(&home, &file, &me, |_| Some(false)).unwrap(), "nothing to remove");
        assert!(file.exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn stat_018_an_owner_that_cannot_be_checked_counts_as_running() {
        let dir = scratch("owner");
        let me = owner(1, &dir);
        let mut o = owner(2, &dir);
        assert!(!still_runs(&o, &me, |_| Some(false)), "same machine and boot, process gone");
        assert!(still_runs(&o, &me, |_| None), "process cannot be read");
        o.host = Some("OTHER".into());
        assert!(still_runs(&o, &me, |_| Some(false)), "another machine");
        o.host = None;
        assert!(still_runs(&o, &me, |_| Some(false)), "machine unknown");
        let mut o = owner(2, &dir);
        o.boot = None;
        assert!(still_runs(&o, &me, |_| Some(false)), "boot unknown");
        o.boot = Some(1_000_000 - 3600);
        assert!(!still_runs(&o, &me, |_| Some(true)), "an earlier boot has ended, whatever the id now is");
        let mut o = owner(2, &dir);
        o.profile = Some(dir.join("gone").display().to_string());
        assert!(still_runs(&o, &me, |_| Some(false)), "profile cannot be checked");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row_170_stat_061_grok_ask_tool_reaches_the_status_as_a_question() {
        // Through the listener's own entry (the `/grok/<event>` route) to the status change.
        let mut m = Memory::default();
        let run = |m: &mut Memory, path: &str, v: Value| super::super::normalize_with(m, path, &v).and_then(|n| super::super::change(&n)).flatten();
        let ask = run(&mut m, "/grok/PreToolUse", json!({ "sessionId": "s9", "toolName": "ask_user", "toolInput": { "question": "Which branch should I use?", "choices": ["main", "dev"] } })).unwrap();
        assert_eq!((ask.state, ask.ask.as_deref()), ("waiting", Some("Which branch should I use?")), "the ask tool starting is a question");
        // The end of that tool, or its failure (a cancelled question), is working again with no question.
        for end in ["/grok/PostToolUse", "/grok/PostToolUseFailure"] {
            let c = run(&mut m, end, json!({ "sessionId": "s9", "toolName": "ask_user" })).unwrap();
            assert_eq!((c.state, c.ask.is_none()), ("working", true), "{end}");
        }
        // An ask tool with no readable question still waits, with a stock line.
        let bare = run(&mut m, "/grok/PreToolUse", json!({ "sessionId": "s9", "toolName": "AskQuestion" })).unwrap();
        assert_eq!((bare.state, bare.ask.as_deref()), ("waiting", Some("Grok is asking you something")));
        // Any other tool start is plain work.
        let work = run(&mut m, "/grok/PreToolUse", json!({ "sessionId": "s9", "toolName": "Bash", "toolInput": { "command": "ls" } })).unwrap();
        assert_eq!((work.state, work.ask.is_none()), ("working", true));
    }

    #[test]
    fn stat_018_grok_events_drive_the_dot() {
        let mut m = Memory::default();
        let ev = |m: &mut Memory, n: &str, v: Value| event(m, n, &v).map(|(name, s, out)| (name, s.map(str::to_string), out));
        let (n, s, out) = ev(&mut m, "UserPromptSubmit", json!({ "sessionId": "s1", "prompt": "fix it" })).unwrap();
        assert_eq!((n, s.as_deref(), out["prompt"].as_str()), ("UserPromptSubmit", Some("s1"), Some("fix it")));
        assert_eq!(ev(&mut m, "PreToolUse", json!({ "sessionId": "s1", "toolName": "Bash", "toolInput": { "command": "ls" } })).unwrap().0, "PreToolUse");
        // The generic per-tool permission notice at information level is routine: working.
        assert_eq!(ev(&mut m, "Notification", json!({ "sessionId": "s1", "level": "info", "message": "Bash tool needs permission" })).unwrap().0, "PostToolUse");
        // The same wording at warning level asks the user.
        assert_eq!(ev(&mut m, "Notification", json!({ "sessionId": "s1", "level": "warning", "message": "Bash tool needs permission" })).unwrap().0, "PermissionRequest");
        assert_eq!(ev(&mut m, "Notification", json!({ "sessionId": "s1", "message": "Waiting for your approval" })).unwrap().0, "PermissionRequest");
        let (n, _, out) = ev(&mut m, "Notification", json!({ "sessionId": "s1", "message": "Grok needs your feedback" })).unwrap();
        assert_eq!((n, out["kolux_ask"].as_str()), ("PreToolUse", Some("Grok needs your feedback")));
        assert!(out.get("prompt").is_none(), "notice text is never kept as the prompt");
        assert_eq!(ev(&mut m, "Notification", json!({ "sessionId": "s1", "message": "Grok is waiting for input" })).unwrap().0, "Stop");
        assert!(ev(&mut m, "Notification", json!({ "sessionId": "s1", "message": "Compacted" })).is_none());
        for done in ["Stop", "StopFailure", "SessionEnd"] {
            assert_eq!(ev(&mut m, done, json!({ "sessionId": "s1" })).unwrap().0, "Stop", "{done}");
        }
        assert!(ev(&mut m, "SessionStart", json!({ "sessionId": "s1" })).is_none());
        assert_eq!(ev(&mut m, "PostToolUseFailure", json!({ "session_id": "s2", "tool_name": "Edit" })).unwrap().1.as_deref(), Some("s2"));
    }
}
