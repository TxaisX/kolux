//! Txais (2026-11-20): the handoff-and-clear is not Claude Code's alone.
//!
//! Claude Code hands Kolux its context size on every turn (the status line, `hooks::usage`), so its
//! clear is driven by a push. The other agents hand nothing. What Codex, OpenCode and Grok do leave is
//! their own session store, and it carries the prompt size of the newest turn: Codex writes a
//! `token_count` event into the rollout log, OpenCode writes `tokens` onto every assistant message, Grok
//! keeps `contextTokensUsed` in a session's `signals.json`. This module reads those and feeds the same
//! `handoff::check`, so those panes relay at the same point.
//!
//! Only an agent this module can actually read is ever cleared (`measured`). An agent with no reading
//! keeps its session: the clear is driven by a number, never by a guess. An agent starting a fresh
//! conversation measures as `Some(0)`, which is what re-arms it for the next fill.
//!
//! A conversation the pane resumed is only read once it has been touched since that pane started. A
//! worktree keeps several conversations per folder, and the newest one before the pane started is
//! somebody else's: reading it would clear the resumed pane on its first look. Nothing is lost by
//! waiting — a resumed conversation measures itself on its first turn.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// How often the meter looks. One small query per OpenCode pane, one short tail per Codex pane, and
/// nothing at all when neither is open. Faster than the clear needs, which is once a session.
pub const EVERY: Duration = Duration::from_secs(20);

/// How much of a Codex rollout is read from the end: the token events of the current turn are always
/// the last ones written.
const TAIL: u64 = 4 * 1024 * 1024;

/// The deepest day folder looked at for a Codex session (today and yesterday are enough for a pane
/// that is doing anything at all).
const DAYS: usize = 3;

/// How far before a pane's start a file may still count as its own, for file system stamps that round.
const GRACE: Duration = Duration::from_secs(2);

/// How long a pane must have printed nothing and been typed into not at all before its reading may
/// clear it. A turn in flight prints; a person mid-sentence is typing; a clear sent into either would
/// land in the middle of it.
const QUIET: Duration = Duration::from_secs(10);

/// The agents whose own store carries a context reading. Claude is not one: its status line pushes
/// the reading, so polling would be a second, slower answer to a question already answered.
pub fn measured(agent: &str) -> bool {
    matches!(agent, "codex" | "opencode" | "grok")
}

/// The prompt size of `agent`'s conversation in `cwd` that this pane owns, from its own store: the
/// newest one it has touched since `since` (the pane's start). `home` is the `CODEX_HOME` the pane was
/// started with. `None` when nothing can be read, which the caller takes as no clear.
pub fn reading(agent: &str, cwd: &str, home: Option<&str>, since: SystemTime) -> Option<u64> {
    match agent {
        "opencode" => opencode_context(&opencode_db()?, cwd, since),
        "codex" => codex_context(&codex_home(home)?, cwd, since),
        "grok" => grok_context(&grok_home()?, cwd, since),
        _ => None,
    }
}

/// OpenCode's database: `$XDG_DATA_HOME/opencode/opencode.db` (on Windows the data folder may still
/// be `~/.local/share`). `None` when it is not there.
pub fn opencode_db() -> Option<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".local").join("share")))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))?;
    let db = data.join("opencode").join("opencode.db");
    db.is_file().then_some(db)
}

/// Codex's home for a pane: the managed account's own home when the pane was started with one, then
/// `CODEX_HOME`, then `~/.codex`.
pub fn codex_home(pane_home: Option<&str>) -> Option<PathBuf> {
    pane_home
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()).map(PathBuf::from))
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".codex")))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex")))
}

/// Grok's home: `GROK_HOME` when set, then `~/.grok`.
pub fn grok_home() -> Option<PathBuf> {
    std::env::var_os("GROK_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".grok")))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".grok")))
}

/// The folder Grok names a working folder's sessions after: the path URL-encoded, `G:\Repo` as
/// `G%3A%5CRepo` (the shape Grok writes, seen live). Grok switches to a slug plus a hash for a path whose
/// encoded name passes 255 bytes; such a folder simply does not measure, which leaves its pane alone.
pub fn grok_folder(cwd: &str) -> String {
    let mut out = String::new();
    for b in cwd.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Grok's reading: the newest session in `cwd` that this pane has touched, and its own live context
/// signal.
pub fn grok_context(home: &Path, cwd: &str, since: SystemTime) -> Option<u64> {
    let dir = home.join("sessions").join(grok_folder(cwd));
    let floor = since.checked_sub(GRACE).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).ok()? {
        let Ok(entry) = entry else { continue };
        let file = entry.path().join("signals.json");
        let Ok(at) = std::fs::metadata(&file).and_then(|m| m.modified()) else { continue };
        if at < floor {
            continue;
        }
        if newest.as_ref().is_none_or(|(best, _)| at > *best) {
            newest = Some((at, file));
        }
    }
    grok_tokens(&std::fs::read_to_string(newest?.1).ok()?)
}

/// Grok's own live context signal: `contextTokensUsed`, what its current conversation holds. A session
/// that has not answered yet reads `0`, which re-arms the pane.
pub fn grok_tokens(text: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(text).ok()?.get("contextTokensUsed").and_then(serde_json::Value::as_u64)
}

/// OpenCode's reading, from its database file.
pub fn opencode_context(db: &Path, cwd: &str, since: SystemTime) -> Option<u64> {
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    // The terminal is writing to the same database: wait a little rather than read nothing.
    let _ = conn.busy_timeout(Duration::from_millis(400));
    opencode_context_in(&conn, cwd, since)
}

/// OpenCode's newest top-level conversation in `cwd` that this pane has touched, and the prompt size of
/// its last answered turn: uncached input plus the cache read plus the cache write, the three parts of
/// the prompt. A conversation with no answered turn yet is `Some(0)`, which re-arms the pane for its
/// next fill.
pub fn opencode_context_in(conn: &rusqlite::Connection, cwd: &str, since: SystemTime) -> Option<u64> {
    // The database counts milliseconds from 1970; a stamp before it (or a pane start that far back) is 0.
    let since_ms = since.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let floor_ms = i64::try_from(since_ms.saturating_sub(GRACE.as_millis())).unwrap_or(0);
    let session: String = conn
        .query_row(
            "SELECT id FROM session_v2 WHERE parent_id IS NULL AND time_archived IS NULL \
             AND lower(replace(directory, '\\', '/')) = lower(?1) AND time_updated >= ?2 \
             ORDER BY time_updated DESC LIMIT 1",
            rusqlite::params![cwd.replace('\\', "/"), floor_ms],
            |r| r.get(0),
        )
        .ok()?;
    let mut st = conn
        .prepare(
            "SELECT json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.cache.read'), \
             json_extract(data, '$.tokens.cache.write') FROM session_message \
             WHERE session_id = ?1 AND json_extract(data, '$.tokens') IS NOT NULL \
             ORDER BY seq DESC LIMIT 1",
        )
        .ok()?;
    let parts: Option<(Option<i64>, Option<i64>, Option<i64>)> = st
        .query_row([&session], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .ok();
    let Some((input, read, write)) = parts else { return Some(0) };
    let sum = [input, read, write].into_iter().flatten().fold(0u64, |acc, n| acc.saturating_add(u64::try_from(n).unwrap_or(0)));
    Some(sum)
}

/// Codex's reading, from its home's session logs.
pub fn codex_context(home: &Path, cwd: &str, since: SystemTime) -> Option<u64> {
    let file = newest_rollout(home, cwd, since)?;
    let text = tail(&file, TAIL)?;
    // A log whose turns carry no count reads nothing rather than zero: a zero would claim the pane is
    // empty. `codex exec` writes no `token_count` events; the interactive TUI does.
    codex_tokens(&text)
}

/// The newest rollout log in `home` whose session was started in `cwd` and written since the pane
/// started. Only the last few day folders are looked at: a pane doing anything at all has written to one
/// of them, and a resumed session appends to its own log, which moves its stamp.
pub fn newest_rollout(home: &Path, cwd: &str, since: SystemTime) -> Option<PathBuf> {
    let root = home.join("sessions");
    let mut days: Vec<PathBuf> = Vec::new();
    for year in read_dirs(&root) {
        for month in read_dirs(&year) {
            days.extend(read_dirs(&month));
        }
    }
    days.sort();
    let want = cwd.replace('\\', "/").to_lowercase();
    let floor = since.checked_sub(GRACE).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    for day in days.iter().rev().take(DAYS) {
        for file in std::fs::read_dir(day).into_iter().flatten().flatten().map(|e| e.path()) {
            if file.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(mtime) = std::fs::metadata(&file).and_then(|m| m.modified()) else { continue };
            if mtime < floor {
                continue;
            }
            let Some(head) = first_line(&file, 1024 * 1024) else { continue };
            let Some(at) = rollout_cwd(&head) else { continue };
            if at.replace('\\', "/").to_lowercase() == want {
                found.push((mtime, file));
            }
        }
    }
    found.into_iter().max_by_key(|(mtime, _)| *mtime).map(|(_, f)| f)
}

fn read_dirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
}

/// The folder a Codex rollout was started in: its first line, the session's own header.
pub fn rollout_cwd(head: &str) -> Option<String> {
    let first = head.lines().next()?;
    let v: serde_json::Value = serde_json::from_str(first).ok()?;
    v.get("payload")?.get("cwd")?.as_str().map(str::to_string)
}

/// The prompt size of the last answered turn in a Codex rollout: the `token_count` event's
/// `last_token_usage.input_tokens`. Codex counts cached input inside `input_tokens` (the reading
/// `token_usage.rs` takes), so the input figure is the whole prompt. A log with no such event is `None`.
pub fn codex_tokens(text: &str) -> Option<u64> {
    let mut last = None;
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(p) = v.get("payload") else { continue };
        if p.get("type").and_then(serde_json::Value::as_str) != Some("token_count") {
            continue;
        }
        let Some(u) = p.get("info").and_then(|i| i.get("last_token_usage")) else { continue };
        let input = u.get("input_tokens").and_then(serde_json::Value::as_u64);
        if let Some(n) = input {
            last = Some(n);
        }
    }
    last
}

/// The first line of a file, at most `limit` bytes: a Codex rollout's header, without reading the rest.
fn first_line(file: &Path, limit: u64) -> Option<String> {
    use std::io::{BufRead, BufReader, Read};
    let mut line = String::new();
    let file = std::fs::File::open(file).ok()?;
    let read = BufReader::new(file.take(limit)).read_line(&mut line).ok()?;
    (read > 0).then_some(line)
}

/// The last `limit` bytes of a file, as text. A line cut by the seek is dropped rather than parsed.
fn tail(file: &Path, limit: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(file).ok()?;
    let len = f.metadata().ok()?.len();
    let from = len.saturating_sub(limit);
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Some(if from == 0 { text } else { text.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or_default() })
}

/// One look: every live pane this module can measure, one reading each.
pub fn pass(app: &tauri::AppHandle) {
    use tauri::Manager;
    let terminals = app.state::<crate::terminal::Terminals>();
    let mut panes: Vec<(u32, &'static str, String, Option<String>, SystemTime)> = Vec::new();
    for (id, pane, _) in terminals.list() {
        let Some(pane) = pane else { continue };
        if panes.iter().any(|p| p.0 == pane) {
            continue;
        }
        let Some(run) = terminals.of_pane(pane) else { continue };
        let Some(agent) = run.agent else { continue };
        if !measured(agent) {
            continue;
        }
        // A pane that printed, or was typed into, a moment ago is in the middle of something: a clear
        // typed now would land in that turn. The look comes again; the reading will keep.
        if terminals.still_for(id).is_none_or(|quiet| quiet < QUIET) {
            continue;
        }
        let Some(cwd) = run.cwd.clone() else { continue };
        let home = run.home_env.iter().find(|(k, _)| k == "CODEX_HOME").map(|(_, v)| v.clone());
        panes.push((pane, agent, cwd, home, run.started));
    }
    // Two panes of one agent in one folder name the same conversation, so neither can be told from
    // the other: both are left alone rather than cleared on a reading that may be the other one's.
    let mut count = std::collections::HashMap::<String, usize>::new();
    for (_, agent, cwd, _, _) in &panes {
        *count.entry(format!("{agent}:{}", cwd.to_lowercase())).or_default() += 1;
    }
    for (pane, agent, cwd, home, started) in panes {
        if count[&format!("{agent}:{}", cwd.to_lowercase())] > 1 {
            continue;
        }
        if let Some(tokens) = reading(agent, &cwd, home.as_deref(), started) {
            crate::handoff::check(app, pane, Some(tokens), Some(agent));
        }
    }
}

/// Starts the meter: a look every `EVERY`, for as long as the app runs.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        pass(&app);
        std::thread::sleep(EVERY);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-meter-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An OpenCode database with the two tables the reading uses, in the shape OpenCode writes them.
    fn opencode(name: &str) -> rusqlite::Connection {
        let dir = temp(name);
        let conn = rusqlite::Connection::open(dir.join("opencode.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_archived INTEGER, time_updated INTEGER);
             CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, seq INTEGER, data TEXT);",
        )
        .unwrap();
        conn
    }

    fn session(conn: &rusqlite::Connection, id: &str, dir: &str, parent: Option<&str>, updated: i64) {
        conn.execute("INSERT INTO session_v2 VALUES (?1, ?2, ?3, NULL, ?4)", rusqlite::params![id, dir, parent, updated]).unwrap();
    }

    fn message(conn: &rusqlite::Connection, id: &str, session: &str, seq: i64, data: &str) {
        conn.execute("INSERT INTO session_message VALUES (?1, ?2, ?3, ?4)", rusqlite::params![id, session, seq, data]).unwrap();
    }

    #[test]
    fn a_pane_is_measured_only_when_its_store_carries_a_reading() {
        assert!(measured("codex"));
        assert!(measured("opencode"));
        assert!(measured("grok"));
        for other in ["claude", "gemini", "copilot", "aider", ""] {
            assert!(!measured(other), "{other} has no reading to read");
        }
    }

    #[test]
    fn opencode_prompt_is_input_plus_the_cache_both_ways_on_the_newest_session() {
        let conn = opencode("oc-newest");
        let cwd = r"G:\Desktop\kolux\.worktrees\coral-anemone";
        // The stored folder is written with forward slashes; the pane's is a Windows path.
        session(&conn, "old", "G:/Desktop/kolux/.worktrees/coral-anemone", None, 1);
        session(&conn, "new", "G:/Desktop/kolux/.worktrees/coral-anemone", None, 2);
        message(&conn, "m1", "old", 1, r#"{"tokens":{"input":900000,"output":1,"cache":{"read":0,"write":0}}}"#);
        message(&conn, "m2", "new", 1, r#"{"tokens":{"input":819,"output":390,"cache":{"read":124160,"write":256}}}"#);
        assert_eq!(opencode_context_in(&conn, cwd, SystemTime::UNIX_EPOCH), Some(819 + 124_160 + 256), "the newest session, newest answered turn");
    }

    #[test]
    fn opencode_ignores_sub_sessions_and_archived_ones_and_reads_only_answered_turns() {
        let conn = opencode("oc-skip");
        let cwd = r"G:\Repo";
        session(&conn, "main", "G:/Repo", None, 1);
        session(&conn, "child", "G:/Repo", Some("main"), 9);
        message(&conn, "c", "child", 1, r#"{"tokens":{"input":190000,"output":1,"cache":{"read":0,"write":0}}}"#);
        message(&conn, "a", "main", 1, r#"{"tokens":{"input":100,"output":1,"cache":{"read":50,"write":0}}}"#);
        message(&conn, "b", "main", 2, r#"{"agent":"x","content":[]}"#);
        assert_eq!(opencode_context_in(&conn, cwd, SystemTime::UNIX_EPOCH), Some(150), "the child is not the conversation, and an unanswered turn is skipped");
        let other = opencode("oc-elsewhere");
        assert_eq!(opencode_context_in(&other, cwd, SystemTime::UNIX_EPOCH), None, "no conversation in that folder: no reading");
    }

    #[test]
    fn a_fresh_opencode_conversation_reads_zero_so_the_pane_rearms() {
        let conn = opencode("oc-fresh");
        session(&conn, "new", "G:/Repo", None, 2);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", SystemTime::UNIX_EPOCH), Some(0));
    }

    #[test]
    fn codex_prompt_is_the_last_turn_input_and_a_log_without_one_reads_nothing() {
        let log = concat!(
            r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":40000,"cached_input_tokens":30000,"output_tokens":10}}}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":171000,"cached_input_tokens":160000,"output_tokens":500}}}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":999999}}}}"#,
            "\n",
        );
        assert_eq!(codex_tokens(log), Some(171_000), "the last answered turn's input, which already counts cached input");
        assert_eq!(codex_tokens(r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#), None, "no turn yet: no reading");
    }

    #[test]
    fn a_codex_session_is_found_by_the_folder_it_started_in() {
        let home = temp("cx-home");
        let day = home.join("sessions").join("2026").join("11").join("20");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(day.join("rollout-a.jsonl"), r#"{"type":"session_meta","payload":{"cwd":"G:\\Other"}}"#).unwrap();
        std::fs::write(
            day.join("rollout-b.jsonl"),
            format!(
                "{}\n{}",
                r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#,
                r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":171500}}}}"#
            ),
        )
        .unwrap();
        assert_eq!(codex_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), Some(171_500));
        assert_eq!(codex_context(&home, r"G:\Nope", SystemTime::UNIX_EPOCH), None, "no session in that folder");
    }

    #[test]
    fn a_codex_log_without_a_token_event_reads_nothing_rather_than_zero() {
        let home = temp("cx-no-tokens");
        let day = home.join("sessions").join("2026").join("11").join("20");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-exec.jsonl"),
            format!(
                "{}\n{}",
                r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#,
                r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#
            ),
        )
        .unwrap();
        assert_eq!(codex_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), None, "no counts in the log: the pane is left alone");
    }

    #[test]
    fn grok_names_a_folder_the_way_its_sessions_are_filed() {
        assert_eq!(grok_folder(r"G:\Dev\kolux-lanes\c2-agents"), "G%3A%5CDev%5Ckolux-lanes%5Cc2-agents");
        assert_eq!(grok_folder("G:/Dev/a b"), "G%3A%2FDev%2Fa%20b");
    }

    #[test]
    fn a_grok_session_reads_its_own_context_signal_from_the_newest_one() {
        let home = temp("grok-home");
        let base = home.join("sessions").join(grok_folder(r"G:\Repo"));
        let write = |id: &str, used: u64| {
            let dir = base.join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("signals.json"), format!(r#"{{"contextTokensUsed":{used},"contextWindowTokens":256000}}"#)).unwrap();
        };
        write("old", 40_000);
        std::thread::sleep(std::time::Duration::from_millis(20));
        write("new", 171_500);
        assert_eq!(grok_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), Some(171_500), "the newest session in that folder");
        assert_eq!(grok_context(&home, r"G:\Nope", SystemTime::UNIX_EPOCH), None, "no session in that folder: no reading");
        assert_eq!(grok_tokens(r#"{"contextTokensUsed":0}"#), Some(0), "a fresh conversation re-arms the pane");
        assert_eq!(grok_tokens(r#"{"other":1}"#), None, "no signal: no reading");
    }

    #[test]
    fn a_conversation_untouched_since_the_pane_started_is_not_this_panes() {
        // A worktree keeps several conversations per folder. Resuming an old one must not read the
        // newer one a previous pane left behind, or the resumed pane would be cleared on its first look.
        let since = SystemTime::UNIX_EPOCH + Duration::from_secs(5);
        let conn = opencode("oc-resumed");
        session(&conn, "older", "G:/Repo", None, 1_000);
        message(&conn, "m", "older", 1, r#"{"tokens":{"input":190000,"output":1,"cache":{"read":0,"write":0}}}"#);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", since), None, "that session was last written before this pane started");
        session(&conn, "this-pane", "G:/Repo", None, 9_000);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", since), Some(0), "the pane's own new conversation measures zero");

        let home = temp("cx-resumed");
        let day = home.join("sessions").join("2026").join("11").join("20");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-old.jsonl"),
            format!(
                "{}\n{}",
                r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#,
                r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":171500}}}}"#
            ),
        )
        .unwrap();
        let later = SystemTime::now() + Duration::from_secs(3600);
        assert_eq!(codex_context(&home, r"G:\Repo", later), None, "a rollout not written since the pane started is somebody else's");

        let home = temp("grok-resumed");
        let dir = home.join("sessions").join(grok_folder(r"G:\Repo")).join("s1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("signals.json"), r#"{"contextTokensUsed":171500}"#).unwrap();
        assert_eq!(grok_context(&home, r"G:\Repo", SystemTime::now() + Duration::from_secs(3600)), None);
    }

    #[test]
    fn rollout_cwd_reads_the_header_and_nothing_else() {
        assert_eq!(rollout_cwd(r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#), Some(r"G:\Repo".into()));
        assert_eq!(rollout_cwd("not json"), None);
        assert_eq!(rollout_cwd(r#"{"type":"event_msg","payload":{}}"#), None);
    }
}
