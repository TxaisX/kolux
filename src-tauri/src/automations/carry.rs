//! Carrying a conversation to another agent (SESS-031, VIEW-087; T-187-b, T-189-b). The Rust side
//! reads one past session's transcript (the files `session_list` finds) and returns a TRIMMED copy
//! of the conversation as plain text: the user's messages and the agent's replies, never tool
//! results, thinking, sub-agent turns or the envelopes an agent injects. The window puts that text
//! in the new agent's opening prompt.
//!
//! Formats (public, PROVENANCE §5 2026-10-20): Claude Code writes one event per line with `type`
//! user or assistant, `isSidechain`, `isMeta`, `cwd` and `message.content` (text or blocks);
//! Codex writes `event_msg` lines whose payload is a `user_message` or an `agent_message`.
//!
//! The commands are registered by the lib.rs hunk the coordinator applies
//! (evidence/automations-T-187-b-lib.rs.patch).

use crate::sessions::list::{find_session, roots_for, summarize, Roots};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The carried text is at most this many characters.
pub const TOTAL_CAP: usize = 24_000;
/// Room kept for the line saying how many messages were left out.
const NOTE_ROOM: usize = 60;
/// One message is cut to this many characters.
pub const TURN_CAP: usize = 2_000;
/// A transcript bigger than this is read from its end.
pub const READ_CAP: u64 = 16 * 1024 * 1024;

/// What the window needs to start the next agent.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub agent: String,
    pub id: String,
    pub title: String,
    /// The folder the session ran in, when its transcript says.
    pub dir: Option<String>,
    /// How many messages the user sent.
    pub turns: u32,
    /// The trimmed conversation, ready to paste into a prompt.
    pub text: String,
    /// Some messages were left out or cut.
    pub trimmed: bool,
    /// How many messages were left out whole.
    pub omitted: usize,
}

/// One message of the conversation.
#[derive(Clone, Debug, PartialEq)]
pub struct Turn {
    pub user: bool,
    pub text: String,
}

/// The envelopes an agent injects into a user turn: not the user's words.
fn injected(text: &str) -> bool {
    let t = text.trim_start();
    ["<system-reminder", "<local-command", "<command-name", "<command-message", "<user-prompt-submit-hook", "<ide_", "<environment_context", "Caveat:"].iter().any(|p| t.starts_with(p))
}

fn claude_text(v: &Value) -> Option<String> {
    let content = v.pointer("/message/content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => return None,
    };
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// The messages of a transcript's lines, in order.
pub fn turns_of(agent: &str, lines: &str) -> Vec<Turn> {
    let mut out = Vec::new();
    for line in lines.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if agent == "codex" {
            if v.get("type").and_then(Value::as_str) != Some("event_msg") {
                continue;
            }
            let Some(p) = v.get("payload") else { continue };
            let user = match p.get("type").and_then(Value::as_str) {
                Some("user_message") => true,
                Some("agent_message") => false,
                _ => continue,
            };
            let text = p.get("message").and_then(Value::as_str).map(str::trim).unwrap_or("");
            if !text.is_empty() && !(user && injected(text)) {
                out.push(Turn { user, text: text.to_string() });
            }
        } else {
            let user = match v.get("type").and_then(Value::as_str) {
                Some("user") => true,
                Some("assistant") => false,
                _ => continue,
            };
            if v.get("isSidechain").and_then(Value::as_bool) == Some(true) || v.get("isMeta").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            if let Some(text) = claude_text(&v).filter(|t| !(user && injected(t))) {
                out.push(Turn { user, text });
            }
        }
    }
    out
}

fn cut(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_string(), false);
    }
    let mut s: String = text.chars().take(max).collect();
    s.push_str(" […]");
    (s, true)
}

/// The conversation as plain text within `cap` characters: the first message (the task) stays, then
/// as many of the newest messages as fit, with a line saying how many were left out between them.
/// Returns the text, whether anything was cut or left out, and how many messages were left out.
pub fn trim(turns: &[Turn], cap: usize) -> (String, bool, usize) {
    let mut cut_any = false;
    let rendered: Vec<String> = turns
        .iter()
        .map(|t| {
            let (body, was) = cut(&t.text, TURN_CAP);
            cut_any |= was;
            format!("{}: {}", if t.user { "User" } else { "Assistant" }, body)
        })
        .collect();
    if rendered.is_empty() {
        return (String::new(), false, 0);
    }
    let size = |s: &String| s.chars().count() + 2;
    let all: usize = rendered.iter().map(size).sum();
    // When something must go, room is kept for the line that says how many messages did.
    let mut budget = if all <= cap { usize::MAX } else { cap.saturating_sub(size(&rendered[0]) + NOTE_ROOM) };
    let mut from = rendered.len();
    while from > 1 {
        let need = size(&rendered[from - 1]);
        if need > budget {
            break;
        }
        budget -= need;
        from -= 1;
    }
    let omitted = from - 1;
    let mut parts = vec![rendered[0].clone()];
    if omitted > 0 {
        parts.push(format!("[{omitted} earlier {} left out]", if omitted == 1 { "message was" } else { "messages were" }));
    }
    parts.extend(rendered[from..].iter().cloned());
    (parts.join("\n\n"), cut_any || omitted > 0, omitted)
}

/// A file's text, or for a huge one only its end (starting at a line boundary).
fn read_text(path: &Path) -> Option<String> {
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let from = len.saturating_sub(READ_CAP);
    if from > 0 {
        f.seek(SeekFrom::Start(from)).ok()?;
    }
    let mut buf = Vec::new();
    f.take(READ_CAP).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Some(if from > 0 { text.split_once('\n').map_or(String::new(), |(_, rest)| rest.to_string()) } else { text })
}

/// The trimmed conversation of session `id` of `agent`, or the plain reason it cannot be carried.
pub fn context(roots: &Roots, agent: &str, id: &str) -> Result<Context, String> {
    if !crate::agents::safe_session(id) {
        return Err("That session's name cannot be used to read it.".into());
    }
    if !matches!(agent, "claude" | "openclaude" | "codex") {
        return Err(format!("Kolux cannot read {agent} sessions yet, so it cannot carry one over."));
    }
    let (file, _) = find_session(roots, agent, id).ok_or("That session is no longer on this computer.")?;
    let len = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let s = summarize(agent, &file, len);
    if s.turns == 0 {
        return Err("This session has no messages yet, so there is nothing to carry over.".into());
    }
    let text = read_text(&file).ok_or("That session could not be read.")?;
    let turns = turns_of(agent, &text);
    let (body, trimmed, omitted) = trim(&turns, TOTAL_CAP);
    let title = [s.custom.as_str(), s.ai.as_str(), s.generated.as_str(), s.first.as_str()].into_iter().find(|t| !t.is_empty()).unwrap_or("").to_string();
    Ok(Context { agent: agent.to_string(), id: id.to_string(), title, dir: s.cwd, turns: s.turns, text: body, trimmed, omitted })
}

/// SESS-033: the folder an agent is about to start in must still exist.
pub fn dir_ready(dir: &str) -> Result<(), String> {
    let d = dir.trim();
    if d.is_empty() {
        return Err("There is no folder to start the agent in.".into());
    }
    if !Path::new(d).is_dir() {
        return Err(format!("{d} no longer exists, so no agent was started."));
    }
    Ok(())
}

fn env_text(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn user_home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// SESS-031 / VIEW-087: the trimmed conversation of one listed past session.
#[tauri::command]
#[allow(dead_code)] // T-187-b: registered by evidence/automations-T-187-b-lib.rs.patch
pub async fn session_carry_context(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String) -> Result<Context, String> {
    let (settings, profile) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), store.dir())
    };
    tauri::async_runtime::spawn_blocking(move || context(&roots_for(&settings, env_text, user_home(), Some(&profile)), &agent, &id)).await.map_err(|e| e.to_string())?
}

/// SESS-033: says why no agent can start in `dir`, or Ok when the folder is there.
#[tauri::command]
#[allow(dead_code)] // T-187-b: registered by evidence/automations-T-187-b-lib.rs.patch
pub fn agent_dir_ready(dir: String) -> Result<(), String> {
    dir_ready(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-carry-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_lines(path: &Path, rows: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n") + "\n").unwrap();
    }

    fn user(text: &str) -> Value {
        json!({ "type": "user", "cwd": "C:\\work\\app", "message": { "role": "user", "content": text } })
    }

    fn assistant(blocks: Value) -> Value {
        json!({ "type": "assistant", "message": { "role": "assistant", "content": blocks } })
    }

    #[test]
    fn sess031_a_claude_conversation_keeps_words_and_drops_tools_and_sub_agents() {
        let rows = [
            user("fix the login bug"),
            user("<system-reminder>ignore me</system-reminder>"),
            assistant(json!([{ "type": "thinking", "thinking": "hmm" }, { "type": "text", "text": "Looking at auth.rs." }, { "type": "tool_use", "name": "Read", "input": {} }])),
            json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "SECRET FILE DUMP" }] } }),
            json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "sub agent chatter" }] } }),
            json!({ "type": "user", "isMeta": true, "message": { "content": "meta" } }),
            user("thanks, now add a test"),
        ];
        let text = rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n");
        let turns = turns_of("claude", &text);
        let words: Vec<(bool, &str)> = turns.iter().map(|t| (t.user, t.text.as_str())).collect();
        assert_eq!(words, vec![(true, "fix the login bug"), (false, "Looking at auth.rs."), (true, "thanks, now add a test")]);
        let (body, trimmed, omitted) = trim(&turns, TOTAL_CAP);
        assert!(!trimmed && omitted == 0);
        assert_eq!(body, "User: fix the login bug\n\nAssistant: Looking at auth.rs.\n\nUser: thanks, now add a test");
        assert!(!body.contains("SECRET") && !body.contains("sub agent"));
    }

    #[test]
    fn sess031_a_codex_conversation_reads_user_and_agent_messages() {
        let rows = [
            json!({ "type": "session_meta", "payload": { "id": "abc", "cwd": "C:\\work\\app" } }),
            json!({ "type": "event_msg", "payload": { "type": "user_message", "message": "port the parser" } }),
            json!({ "type": "event_msg", "payload": { "type": "token_count", "info": {} } }),
            json!({ "type": "event_msg", "payload": { "type": "agent_message", "message": "Done, see parser.rs" } }),
            json!({ "type": "response_item", "payload": { "type": "function_call_output", "output": "RAW" } }),
        ];
        let text = rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n");
        let turns = turns_of("codex", &text);
        assert_eq!(turns, vec![Turn { user: true, text: "port the parser".into() }, Turn { user: false, text: "Done, see parser.rs".into() }]);
    }

    #[test]
    fn sess031_a_long_conversation_keeps_the_task_and_the_newest_messages_within_the_cap() {
        let turns: Vec<Turn> = (0..40).map(|i| Turn { user: i % 2 == 0, text: format!("message {i} {}", "x".repeat(900)) }).collect();
        let (body, trimmed, omitted) = trim(&turns, 6_000);
        assert!(trimmed && omitted > 0);
        assert!(body.chars().count() <= 6_000, "{} chars", body.chars().count());
        assert!(body.starts_with("User: message 0 "), "the first message (the task) stays");
        assert!(body.contains(&format!("[{omitted} earlier messages were left out]")));
        assert!(body.contains("message 39 "), "the newest message stays");
        assert!(!body.contains("message 1 "), "an early middle message is gone");
        // One message is cut to the per-message cap and says so.
        let big = vec![Turn { user: true, text: "y".repeat(TURN_CAP + 500) }];
        let (cut_body, cut_flag, left) = trim(&big, TOTAL_CAP);
        assert!(cut_flag && left == 0 && cut_body.ends_with(" […]"));
        assert_eq!(trim(&[], TOTAL_CAP), (String::new(), false, 0));
    }

    #[test]
    fn sess031_one_left_out_message_is_named_in_the_singular() {
        let turns: Vec<Turn> = (0..3).map(|i| Turn { user: i % 2 == 0, text: format!("m{i} {}", "z".repeat(1_500)) }).collect();
        let (body, _, omitted) = trim(&turns, 3_500);
        assert_eq!(omitted, 1);
        assert!(body.contains("[1 earlier message was left out]"), "{body}");
    }

    #[test]
    fn view087_context_finds_the_session_and_reports_why_it_cannot() {
        let root = tmp("ctx");
        let dir = root.join("projects").join("C--work-app");
        write_lines(&dir.join("s1.jsonl"), &[user("add a login page"), assistant(json!([{ "type": "text", "text": "Added login.tsx" }]))]);
        write_lines(&dir.join("empty.jsonl"), &[json!({ "type": "summary", "summary": "nothing yet" })]);
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        let c = context(&roots, "claude", "s1").unwrap();
        assert_eq!(c.turns, 1);
        assert_eq!(c.title, "add a login page");
        assert_eq!(c.dir.as_deref(), Some("C:\\work\\app"));
        assert_eq!(c.text, "User: add a login page\n\nAssistant: Added login.tsx");
        assert!(!c.trimmed);
        assert_eq!(context(&roots, "claude", "empty").unwrap_err(), "This session has no messages yet, so there is nothing to carry over.");
        assert_eq!(context(&roots, "claude", "gone").unwrap_err(), "That session is no longer on this computer.");
        assert!(context(&roots, "claude", "../escape").unwrap_err().contains("cannot be used"));
        assert!(context(&roots, "amp", "s1").unwrap_err().contains("cannot read amp sessions"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn view087_a_huge_transcript_is_read_from_its_end_at_a_line_boundary() {
        let root = tmp("huge");
        let file = root.join("big.jsonl");
        let filler = json!({ "type": "user", "message": { "content": "old ".repeat(2_000) } }).to_string();
        let mut body = String::new();
        while (body.len() as u64) < READ_CAP + 100_000 {
            body.push_str(&filler);
            body.push('\n');
        }
        body.push_str(&user("the very last ask").to_string());
        body.push('\n');
        fs::write(&file, body).unwrap();
        let text = read_text(&file).unwrap();
        assert!(text.lines().all(|l| serde_json::from_str::<Value>(l).is_ok()), "no half line at the start");
        assert!(turns_of("claude", &text).last().is_some_and(|t| t.text == "the very last ask"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sess033_a_removed_worktree_means_no_agent_starts() {
        let root = tmp("dir");
        assert!(dir_ready(root.to_str().unwrap()).is_ok());
        let gone = root.join("deleted-worktree");
        assert!(dir_ready(gone.to_str().unwrap()).unwrap_err().contains("no longer exists"));
        assert!(dir_ready("  ").unwrap_err().contains("no folder"));
        let _ = fs::remove_dir_all(root);
    }
}
