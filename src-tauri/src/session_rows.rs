//! What a past session's row shows when it is opened (VIEW-084) and the name a tab takes from its
//! session (VIEW-093); T-127-b. Reads only the one transcript the row names, found through the
//! same folders the session list reads (`sessions::list::roots_for`, `find_session`):
//! - the first prompt (and, when a very long transcript has none in its first megabyte, the most
//!   recent one, flagged so the card can say "recent prompt"),
//! - a preview of the latest assistant turn,
//! - child runs (Claude's sub-agent transcripts) with a running or finished state,
//! - whether the session's working folder still exists.
//!
//! Formats (PROVENANCE §5): Claude Code transcripts are `<config>/projects/<folder>/<session>.jsonl`
//! with `type` user / assistant, `message.content` (string or blocks with `type` text), `isSidechain`
//! and `isMeta`; sub-agent transcripts sit either beside it as `agent-*.jsonl` carrying the parent's
//! `sessionId`, or under `<session>/subagents/`. Codex rollouts carry `event_msg` lines whose payload
//! type is `user_message` or `agent_message`. A session's name is the same title the list shows
//! (custom title, else the generated one, else the summary; Codex: its title index).
// ponytail: built and tested ahead of its registration, which is evidence/repo-T-127-b-lib.rs.patch
// (shared file); the allow goes when the patch lands.
#![allow(dead_code)]

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::sessions::list::{codex_index, find_session, roots_for, summarize, Roots};

/// A shown first prompt is cut to this many characters.
pub const PROMPT_MAX: usize = 400;
/// A shown latest-turn preview is cut to this many characters.
pub const LATEST_MAX: usize = 300;
/// A child run's task line is cut to this many characters.
pub const CHILD_MAX: usize = 90;
/// How much of a transcript's end is read for the latest turn (and a recent prompt).
pub const TAIL_BYTES: u64 = 256 * 1024;
/// How much of a transcript's start is read for the first prompt.
pub const HEAD_BYTES: u64 = 1024 * 1024;
/// A child run whose transcript changed this recently counts as running.
pub const RUNNING_MS: u64 = 2 * 60 * 1000;
/// At most this many child runs are listed.
pub const CHILD_CAP: usize = 20;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub id: String,
    pub title: String,
    pub running: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub prompt: Option<String>,
    /// True when `prompt` is the most recent one because the first is out of reach.
    pub recent_prompt_only: bool,
    pub latest: Option<String>,
    pub children: Vec<Child>,
    /// Whether the working folder still exists; none when it is unknown or not a local folder.
    pub dir_exists: Option<bool>,
}

// ---- text ----

/// A character that must stay with the one before it: joiner, variation selector, combining mark,
/// skin-tone modifier, enclosing keycap or tag character.
fn sticks(c: char) -> bool {
    matches!(c as u32, 0x200D | 0xFE00..=0xFE0F | 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0x1F3FB..=0x1F3FF | 0xE0020..=0xE007F)
}

fn indicator(c: char) -> bool {
    matches!(c as u32, 0x1F1E6..=0x1F1FF)
}

/// Whether text may be cut after its first `n` characters without splitting a multi-part character
/// (a joined emoji, a base with its marks, a flag's two letters).
fn can_cut(chars: &[char], n: usize) -> bool {
    if n == 0 || n >= chars.len() {
        return true;
    }
    if sticks(chars[n]) || chars[n - 1] == '\u{200D}' {
        return false;
    }
    if indicator(chars[n - 1]) && indicator(chars[n]) {
        let run = chars[..n].iter().rev().take_while(|c| indicator(**c)).count();
        return run % 2 == 0;
    }
    true
}

/// One line of text: whitespace collapsed, cut to `max` characters at a boundary that keeps every
/// multi-part character whole, with an ellipsis when something was left out.
pub fn clip(text: &str, max: usize) -> String {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = one.chars().collect();
    if chars.len() <= max {
        return one;
    }
    let mut n = max.saturating_sub(1);
    while n > 0 && !can_cut(&chars, n) {
        n -= 1;
    }
    let mut out: String = chars[..n].iter().collect();
    out.push('…');
    out
}

/// The envelopes an agent injects into a user turn: not the user's words.
fn injected(text: &str) -> bool {
    let t = text.trim_start();
    ["<system-reminder", "<local-command", "<command-name", "<command-message", "<user-prompt-submit-hook", "<ide_", "<environment_context", "Caveat:"].iter().any(|p| t.starts_with(p))
}

fn block_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" "),
        _ => return None,
    };
    (!text.trim().is_empty()).then_some(text)
}

#[derive(PartialEq)]
enum Say {
    User,
    Agent,
}

/// What one transcript line says, when it is a turn of the main conversation.
fn turn_of(agent: &str, v: &Value) -> Option<(Say, String)> {
    if agent == "codex" {
        if v.get("type").and_then(Value::as_str) != Some("event_msg") {
            return None;
        }
        let p = v.get("payload")?;
        let text = p.get("message").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())?.to_string();
        return match p.get("type").and_then(Value::as_str) {
            Some("user_message") if !injected(&text) => Some((Say::User, text)),
            Some("agent_message") => Some((Say::Agent, text)),
            _ => None,
        };
    }
    if v.get("isSidechain").and_then(Value::as_bool) == Some(true) || v.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let text = block_text(v.pointer("/message/content")?)?;
    match v.get("type").and_then(Value::as_str) {
        Some("user") if !injected(&text) => Some((Say::User, text)),
        Some("assistant") => Some((Say::Agent, text)),
        _ => None,
    }
}

fn slice(path: &Path, from: u64, cap: u64) -> Option<String> {
    let mut f = fs::File::open(path).ok()?;
    if from > 0 {
        f.seek(SeekFrom::Start(from)).ok()?;
    }
    let mut buf = Vec::new();
    f.take(cap).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// First prompt, most recent prompt and latest agent turn of a transcript, read from its start and end.
pub fn turns_of(agent: &str, path: &Path) -> (Option<String>, bool, Option<String>) {
    let len = fs::metadata(path).map_or(0, |m| m.len());
    let head = slice(path, 0, HEAD_BYTES).unwrap_or_default();
    let first = head.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find_map(|v| turn_of(agent, &v).filter(|(s, _)| *s == Say::User).map(|(_, t)| t));
    // A short transcript is all in the head; a longer one's end is read for the latest turn.
    let tail = if len > HEAD_BYTES { slice(path, len.saturating_sub(TAIL_BYTES), TAIL_BYTES).unwrap_or_default() } else { head };
    let skip = usize::from(len > HEAD_BYTES); // the first tail line may be cut
    let turns: Vec<(Say, String)> = tail.lines().skip(skip).filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|v| turn_of(agent, &v)).collect();
    let latest = turns.iter().rev().find(|(s, _)| *s == Say::Agent).map(|(_, t)| clip(t, LATEST_MAX));
    match first {
        Some(t) => (Some(clip(&t, PROMPT_MAX)), false, latest),
        None => {
            let recent = turns.iter().rev().find(|(s, _)| *s == Say::User).map(|(_, t)| clip(t, PROMPT_MAX));
            let flagged = recent.is_some();
            (recent, flagged, latest)
        }
    }
}

// ---- child runs ----

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

fn jsonl_files(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "jsonl") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(prefix))).collect();
    v.sort();
    v
}

/// The first line of a child's transcript says which session it belongs to and what it was asked.
fn child_of(path: &Path, parent: &str, strict: bool, now: u64) -> Option<Child> {
    let head = slice(path, 0, 64 * 1024)?;
    let mut belongs = !strict;
    let mut title = None;
    for v in head.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if let Some(s) = v.get("sessionId").and_then(Value::as_str) {
            belongs = s == parent;
        }
        if title.is_none() {
            if let Some(text) = v.pointer("/message/content").and_then(block_text).filter(|t| !injected(t)) {
                if v.get("type").and_then(Value::as_str) == Some("user") {
                    title = Some(clip(&text, CHILD_MAX));
                }
            }
        }
        if title.is_some() && belongs {
            break;
        }
    }
    if !belongs {
        return None;
    }
    let id = path.file_stem()?.to_string_lossy().trim_start_matches("agent-").to_string();
    Some(Child { id, title: title.unwrap_or_default(), running: now.saturating_sub(modified_ms(path)) < RUNNING_MS })
}

/// Claude's sub-agent runs of a session: files beside it that name it as their parent, and those
/// under its own `subagents` folder.
pub fn children_of(session_file: &Path, id: &str, now: u64) -> Vec<Child> {
    let Some(folder) = session_file.parent() else { return Vec::new() };
    let mut out: Vec<Child> = jsonl_files(folder, "agent-").iter().filter_map(|p| child_of(p, id, true, now)).collect();
    out.extend(jsonl_files(&folder.join(id).join("subagents"), "").iter().filter_map(|p| child_of(p, id, false, now)));
    out.truncate(CHILD_CAP);
    out
}

// ---- folder ----

/// Whether a session's working folder still exists. A network path is never asked about (its server
/// would be contacted), and a missing answer stays unknown.
pub fn folder_exists(dir: Option<&str>) -> Option<bool> {
    let d = dir?.trim();
    if d.is_empty() || (d.starts_with(r"\\") && !d.starts_with(r"\\?\")) || d.starts_with("//") {
        return None;
    }
    Some(Path::new(d).is_dir())
}

// ---- entry points ----

pub fn detail_of(roots: &Roots, agent: &str, id: &str, dir: Option<&str>, now: u64) -> Result<Detail, String> {
    if !crate::agents::safe_session(id) {
        return Err("That is not a session id".into());
    }
    let mut d = Detail { dir_exists: folder_exists(dir), ..Detail::default() };
    let Some((path, _)) = find_session(roots, agent, id) else { return Ok(d) };
    let (prompt, recent, latest) = turns_of(agent, &path);
    d.prompt = prompt;
    d.recent_prompt_only = recent;
    d.latest = latest;
    if agent != "codex" {
        d.children = children_of(&path, id, now);
    }
    Ok(d)
}

/// The name a session was given: the custom title, else the generated one, else the summary; for
/// Codex the title index. None when it has no name (a first message is not a name).
pub fn name_of(roots: &Roots, agent: &str, id: &str) -> Result<Option<String>, String> {
    if !crate::agents::safe_session(id) {
        return Err("That is not a session id".into());
    }
    let Some((path, home)) = find_session(roots, agent, id) else { return Ok(None) };
    let len = fs::metadata(&path).map_or(0, |m| m.len());
    let s = summarize(agent, &path, len);
    let indexed = home.map(|h| codex_index(&h)).and_then(|m| m.get(id).cloned());
    let name = [s.custom.as_str(), s.ai.as_str(), s.generated.as_str(), indexed.as_deref().unwrap_or("")].into_iter().find(|t| !t.is_empty());
    Ok(name.map(|n| clip(n, crate::sessions::list::TITLE_MAX)))
}

fn live_roots(settings: &Value, profile: &Path) -> Roots {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    roots_for(settings, env, std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from), Some(profile))
}

/// VIEW-084: the opened row's prompt, latest turn, child runs and folder state.
#[tauri::command]
pub async fn session_row_detail(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String, dir: Option<String>) -> Result<Detail, String> {
    let (settings, profile) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), store.dir())
    };
    tauri::async_runtime::spawn_blocking(move || detail_of(&live_roots(&settings, &profile), &agent, &id, dir.as_deref(), now_ms())).await.map_err(|e| e.to_string())?
}

/// VIEW-093: the name of a pane's session, read in the background; none while it has no name yet.
#[tauri::command]
pub async fn session_name(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String) -> Result<Option<String>, String> {
    let (settings, profile) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), store.dir())
    };
    tauri::async_runtime::spawn_blocking(move || name_of(&live_roots(&settings, &profile), &agent, &id)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-sessrows-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(path: &Path, rows: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n") + "\n").unwrap();
    }

    fn user(text: &str) -> Value {
        json!({ "type": "user", "message": { "role": "user", "content": text } })
    }

    fn assistant(text: &str) -> Value {
        json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] } })
    }

    #[test]
    fn view084_previews_never_split_a_multi_part_character() {
        let family = "👨\u{200D}👩\u{200D}👧"; // one character made of five code points
        let text = format!("{}{family}tail", "a".repeat(8));
        // Cutting at 10 characters would land inside the family: the cut backs up to before it.
        assert_eq!(clip(&text, 11), format!("{}…", "a".repeat(8)));
        // A flag is two regional indicators; a cut between them backs up to before the flag.
        let flag = "\u{1F1FA}\u{1F1F8}";
        assert_eq!(clip(&format!("ab{flag}cdef"), 4), "ab…");
        // A letter with its combining accent stays whole; a short text is untouched; spaces collapse.
        assert_eq!(clip("e\u{0301}e\u{0301}e\u{0301}e\u{0301}", 3), "e\u{0301}…");
        assert_eq!(clip("  a \n b  ", 20), "a b");
        assert_eq!(clip(&"x".repeat(30), 10).chars().count(), 10);
    }

    #[test]
    fn view084_claude_row_has_prompt_latest_turn_and_children_with_state() {
        let root = tmp("claude");
        let dir = root.join("projects").join("C--work-app");
        write(
            &dir.join("sess-1.jsonl"),
            &[
                user("<system-reminder>injected</system-reminder>"),
                user("  Fix the   login bug  "),
                assistant("Looking at it."),
                json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "side chatter" }] } }),
                assistant("Fixed: the token was expired."),
            ],
        );
        write(&dir.join("agent-a1.jsonl"), &[json!({ "type": "user", "sessionId": "sess-1", "message": { "content": "Search the repo for token handling" } })]);
        write(&dir.join("agent-zz.jsonl"), &[json!({ "type": "user", "sessionId": "other", "message": { "content": "not mine" } })]);
        write(&dir.join("sess-1").join("subagents").join("agent-b2.jsonl"), &[json!({ "type": "user", "message": { "content": "Write the test" } })]);
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        let d = detail_of(&roots, "claude", "sess-1", None, now_ms()).unwrap();
        assert_eq!(d.prompt.as_deref(), Some("Fix the login bug"));
        assert!(!d.recent_prompt_only);
        assert_eq!(d.latest.as_deref(), Some("Fixed: the token was expired."));
        let titles: Vec<&str> = d.children.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["Search the repo for token handling", "Write the test"]);
        assert!(d.children.iter().all(|c| c.running)); // just written
        // A long way past two minutes later they read as finished.
        let later = detail_of(&roots, "claude", "sess-1", None, now_ms() + 10 * RUNNING_MS).unwrap();
        assert!(later.children.iter().all(|c| !c.running));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view084_a_long_transcript_without_an_early_prompt_offers_the_recent_one() {
        let root = tmp("long");
        let file = root.join("projects").join("C--w").join("big.jsonl");
        let mut rows: Vec<Value> = vec![json!({ "type": "summary", "summary": "x".repeat(HEAD_BYTES as usize + 10) })];
        rows.push(user("the recent ask"));
        rows.push(assistant("done"));
        write(&file, &rows);
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        let d = detail_of(&roots, "claude", "big", None, now_ms()).unwrap();
        assert_eq!(d.prompt.as_deref(), Some("the recent ask"));
        assert!(d.recent_prompt_only);
        assert_eq!(d.latest.as_deref(), Some("done"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view084_codex_row_and_unknown_or_unsafe_sessions() {
        let home = tmp("codex");
        let id = "019a0000-0000-7000-8000-000000000001";
        let file = home.join("sessions").join("2026").join("10").join("20").join(format!("rollout-2026-10-20T00-00-00-{id}.jsonl"));
        write(
            &file,
            &[
                json!({ "type": "session_meta", "payload": { "id": id, "cwd": "C:/w" } }),
                json!({ "type": "event_msg", "payload": { "type": "user_message", "message": "add a flag" } }),
                json!({ "type": "event_msg", "payload": { "type": "agent_message", "message": "Added --flag." } }),
            ],
        );
        let roots = Roots { claude: vec![], codex: vec![home.clone()] };
        let d = detail_of(&roots, "codex", id, None, now_ms()).unwrap();
        assert_eq!(d.prompt.as_deref(), Some("add a flag"));
        assert_eq!(d.latest.as_deref(), Some("Added --flag."));
        assert!(d.children.is_empty());
        assert_eq!(detail_of(&roots, "claude", "nope", None, 0).unwrap(), Detail::default());
        assert!(detail_of(&roots, "claude", "../x", None, 0).is_err());
        assert!(name_of(&roots, "claude", "a/b").is_err());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view084_worktree_line_knows_a_missing_folder_and_never_asks_a_network_path() {
        let here = std::env::temp_dir();
        assert_eq!(folder_exists(Some(&here.to_string_lossy())), Some(true));
        assert_eq!(folder_exists(Some(&here.join("kolux-sessrows-gone-xyz").to_string_lossy())), Some(false));
        assert_eq!(folder_exists(Some(r"\\server\share\x")), None);
        assert_eq!(folder_exists(Some("//server/share/x")), None);
        assert_eq!(folder_exists(Some("  ")), None);
        assert_eq!(folder_exists(None), None);
    }

    #[test]
    fn view093_a_session_name_is_its_title_and_a_first_message_is_not_a_name() {
        let root = tmp("name");
        let dir = root.join("projects").join("C--w");
        write(&dir.join("named.jsonl"), &[user("hello"), json!({ "type": "ai-title", "aiTitle": "Generated name" })]);
        write(&dir.join("mine.jsonl"), &[json!({ "type": "ai-title", "aiTitle": "ai" }), json!({ "type": "custom-title", "customTitle": "Mine" }), user("hello")]);
        write(&dir.join("plain.jsonl"), &[user("hello")]);
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        assert_eq!(name_of(&roots, "claude", "named").unwrap().as_deref(), Some("Generated name"));
        assert_eq!(name_of(&roots, "claude", "mine").unwrap().as_deref(), Some("Mine"));
        assert_eq!(name_of(&roots, "claude", "plain").unwrap(), None);
        assert_eq!(name_of(&roots, "claude", "missing").unwrap(), None);
        let _ = fs::remove_dir_all(&root);
    }
}
