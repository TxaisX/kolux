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
//! conversation measures as `Read::Tokens(0)`, which is what re-arms it for the next fill. A store
//! that cannot be read at all is `Read::Failed` (never the same silence as "nothing yet") and shows
//! up in Settings > Agents, so a reader that breaks is something the window says.
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

/// What one look at an agent's own store found.
///
/// Txais (2026-11-21): the reader used to answer `Option`, so "this store cannot be read" and "this
/// pane has not written anything yet" were the same silence, and a broken reader simply never fired.
/// A failure is now its own answer, named with the file and the reason, and `handoff_reads` shows it.
#[derive(Clone, Debug, PartialEq)]
pub enum Read {
    /// The prompt size of this pane's newest answered turn.
    Tokens(u64),
    /// The store was read and holds nothing for this pane yet: no conversation in this folder since
    /// it started, or one that has not answered. Not a failure, and not a clear either.
    Nothing,
    /// The store could not be read at all. The sentence says what was looked for and why it failed.
    Failed(String),
}

/// One reader's last look, as Settings > Agents shows it (`handoff_reads`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderHealth {
    /// The agent the row is about: `codex`, `opencode` or `grok`.
    pub agent: &'static str,
    /// `reading`, `nothing`, `failed`, or `never` (nothing has run yet this start).
    pub state: &'static str,
    /// What went wrong, for a failure; empty otherwise.
    pub detail: String,
    /// The last prompt size the reader put to the handoff check.
    pub tokens: Option<u64>,
    /// Milliseconds since that look; null when it has never looked.
    pub age_ms: Option<u64>,
}

#[derive(Clone, Default)]
struct Seen {
    state: &'static str,
    detail: String,
    tokens: Option<u64>,
    at: Option<SystemTime>,
    /// The failure line already written to the log, so a store that stays broken is said once.
    logged: String,
}

/// Every reader's last look, kept for the window. One row per agent, never cleared: a reader that
/// stopped working keeps saying so instead of looking healthy because it has nothing new to report.
pub struct Reads(std::sync::Mutex<std::collections::BTreeMap<&'static str, Seen>>);

impl Reads {
    const fn new() -> Self {
        Reads(std::sync::Mutex::new(std::collections::BTreeMap::new()))
    }

    /// Records one look. Answers the failure line to log when this is a new failure (a different
    /// sentence from the one already logged), so a store that stays broken is written once.
    fn put(&self, agent: &'static str, read: &Read) -> Option<String> {
        let mut seen = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let slot = seen.entry(agent).or_default();
        slot.at = Some(SystemTime::now());
        let failure = match read {
            Read::Tokens(n) => {
                slot.tokens = Some(*n);
                slot.logged.clear();
                String::new()
            }
            Read::Nothing => {
                slot.logged.clear();
                String::new()
            }
            Read::Failed(why) => why.clone(),
        };
        slot.state = match read {
            Read::Tokens(_) => "reading",
            Read::Nothing => "nothing",
            Read::Failed(_) => "failed",
        };
        slot.detail = failure.clone();
        if failure.is_empty() || failure == slot.logged {
            return None;
        }
        slot.logged = failure.clone();
        Some(failure)
    }

    fn rows(&self) -> Vec<ReaderHealth> {
        let seen = self.0.lock().unwrap_or_else(|e| e.into_inner());
        ["codex", "opencode", "grok"]
            .into_iter()
            .map(|agent| {
                let Some(s) = seen.get(agent) else {
                    return ReaderHealth { agent, state: "never", detail: String::new(), tokens: None, age_ms: None };
                };
                ReaderHealth {
                    agent,
                    state: s.state,
                    detail: s.detail.clone(),
                    tokens: s.tokens,
                    age_ms: s.at.and_then(|at| SystemTime::now().duration_since(at).ok()).map(|d| d.as_millis().min(u64::MAX as u128) as u64),
                }
            })
            .collect()
    }
}

static READS: Reads = Reads::new();

/// SET: what each reader last found, for Settings > Agents. A reader that cannot read its store is a
/// row that says so, so a session that will not hand off is never a mystery.
#[tauri::command]
pub fn handoff_reads() -> Vec<ReaderHealth> {
    READS.rows()
}

/// The prompt size of `agent`'s conversation in `cwd` that this pane owns, from its own store: the
/// newest one it has touched since `since` (the pane's start). `home` is the `CODEX_HOME` the pane was
/// started with. `Read::Nothing` when the store is readable but holds no conversation of this pane's,
/// `Read::Failed` when it cannot be read at all (the caller takes both as no clear).
pub fn reading(agent: &str, cwd: &str, home: Option<&str>, since: SystemTime) -> Read {
    match agent {
        "opencode" => match opencode_db() {
            Some(db) => opencode_context(&db, cwd, since),
            None => Read::Failed(match opencode_db_path() {
                Some(p) => format!("no OpenCode database at {}", p.display()),
                None => "no OpenCode data folder (XDG_DATA_HOME or ~/.local/share)".to_string(),
            }),
        },
        "codex" => match codex_home(home) {
            Some(home) => codex_context(&home, cwd, since),
            None => Read::Failed("no Codex home: neither CODEX_HOME nor ~/.codex was found".to_string()),
        },
        "grok" => match grok_home() {
            Some(home) => grok_context(&home, cwd, since),
            None => Read::Failed("no Grok home: neither GROK_HOME nor ~/.grok was found".to_string()),
        },
        other => Read::Failed(format!("{other} has no store Kolux reads")),
    }
}

/// Where OpenCode would keep its database, whether or not it is there yet.
pub fn opencode_db_path() -> Option<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".local").join("share")))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))?;
    Some(data.join("opencode").join("opencode.db"))
}

/// OpenCode's database: `$XDG_DATA_HOME/opencode/opencode.db` (on Windows the data folder may still
/// be `~/.local/share`). `None` when it is not there.
pub fn opencode_db() -> Option<PathBuf> {
    opencode_db_path().filter(|db| db.is_file())
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
/// signal. A folder with no session yet is `Nothing`; a session file that cannot be read or parsed is
/// `Failed`, with the file named.
pub fn grok_context(home: &Path, cwd: &str, since: SystemTime) -> Read {
    let folder = grok_folder(cwd);
    if folder.len() > 255 {
        return Read::Failed("Grok files this folder under a hashed name, so its context cannot be read".to_string());
    }
    let dir = home.join("sessions").join(&folder);
    let listing = match std::fs::read_dir(&dir) {
        Ok(listing) => listing,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Read::Nothing,
        Err(e) => return Read::Failed(format!("Grok's sessions at {} cannot be read: {e}", dir.display())),
    };
    let floor = since.checked_sub(GRACE).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in listing.flatten() {
        let file = entry.path().join("signals.json");
        let Ok(at) = std::fs::metadata(&file).and_then(|m| m.modified()) else { continue };
        if at < floor {
            continue;
        }
        if newest.as_ref().is_none_or(|(best, _)| at > *best) {
            newest = Some((at, file));
        }
    }
    let Some((_, file)) = newest else { return Read::Nothing };
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) => return Read::Failed(format!("Grok's {} cannot be read: {e}", file.display())),
    };
    match grok_tokens(&text) {
        Ok(Some(n)) => Read::Tokens(n),
        Ok(None) => Read::Nothing,
        Err(why) => Read::Failed(format!("Grok's {} {why}", file.display())),
    }
}

/// Grok's own live context signal: `contextTokensUsed`, what its current conversation holds. A session
/// that has not answered yet reads `Ok(Some(0))`, which re-arms the pane; a file that is not JSON is an
/// error, never a silent nothing.
pub fn grok_tokens(text: &str) -> Result<Option<u64>, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("is not JSON ({e})"))?;
    Ok(v.get("contextTokensUsed").and_then(serde_json::Value::as_u64))
}

/// OpenCode's reading, from its database file.
pub fn opencode_context(db: &Path, cwd: &str, since: SystemTime) -> Read {
    let conn = match rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(conn) => conn,
        Err(e) => return Read::Failed(format!("OpenCode's database at {} cannot be opened: {e}", db.display())),
    };
    // The terminal is writing to the same database: wait a little rather than read nothing.
    let _ = conn.busy_timeout(Duration::from_millis(400));
    opencode_context_in(&conn, cwd, since)
}

/// OpenCode's newest top-level conversation in `cwd` that this pane has touched, and the prompt size of
/// its last answered turn: uncached input plus the cache read plus the cache write, the three parts of
/// the prompt. A conversation with no answered turn yet reads `Tokens(0)`, which re-arms the pane for its
/// next fill. A table it cannot read is `Failed`, not an empty answer.
pub fn opencode_context_in(conn: &rusqlite::Connection, cwd: &str, since: SystemTime) -> Read {
    // The database counts milliseconds from 1970; a stamp before it (or a pane start that far back) is 0.
    let since_ms = since.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let floor_ms = i64::try_from(since_ms.saturating_sub(GRACE.as_millis())).unwrap_or(0);
    let session = match conn.query_row(
        "SELECT id FROM session_v2 WHERE parent_id IS NULL AND time_archived IS NULL \
         AND lower(replace(directory, '\\', '/')) = lower(?1) AND time_updated >= ?2 \
         ORDER BY time_updated DESC LIMIT 1",
        rusqlite::params![cwd.replace('\\', "/"), floor_ms],
        |r| r.get::<_, String>(0),
    ) {
        Ok(id) => id,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Read::Nothing,
        Err(e) => return Read::Failed(format!("OpenCode's conversation list cannot be read: {e}")),
    };
    let mut st = match conn.prepare(
        "SELECT json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.cache.read'), \
         json_extract(data, '$.tokens.cache.write') FROM session_message \
         WHERE session_id = ?1 AND json_extract(data, '$.tokens') IS NOT NULL \
         ORDER BY seq DESC LIMIT 1",
    ) {
        Ok(st) => st,
        Err(e) => return Read::Failed(format!("OpenCode's messages cannot be read: {e}")),
    };
    match st.query_row([&session], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<i64>>(2)?))) {
        Ok((input, read, write)) => {
            let sum = [input, read, write].into_iter().flatten().fold(0u64, |acc, n| acc.saturating_add(u64::try_from(n).unwrap_or(0)));
            Read::Tokens(sum)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Read::Tokens(0),
        Err(e) => Read::Failed(format!("OpenCode's token counts cannot be read: {e}")),
    }
}

/// Codex's reading, from its home's session logs.
pub fn codex_context(home: &Path, cwd: &str, since: SystemTime) -> Read {
    let file = match newest_rollout(home, cwd, since) {
        Ok(Some(file)) => file,
        Ok(None) => return Read::Nothing,
        Err(why) => return Read::Failed(why),
    };
    let Some(text) = tail(&file, TAIL) else {
        return Read::Failed(format!("Codex's log at {} cannot be read", file.display()));
    };
    // A log whose turns carry no count is `Nothing` rather than zero: a zero would claim the pane is
    // empty. `codex exec` writes no `token_count` events; the interactive TUI does.
    match codex_tokens(&text) {
        Some(n) => Read::Tokens(n),
        None => Read::Nothing,
    }
}

/// The newest rollout log in `home` whose session was started in `cwd` and written since the pane
/// started. Only the last few day folders are looked at: a pane doing anything at all has written to one
/// of them, and a resumed session appends to its own log, which moves its stamp. `Err` when the home has
/// no readable `sessions` folder at all, which is the reader saying it cannot work.
pub fn newest_rollout(home: &Path, cwd: &str, since: SystemTime) -> Result<Option<PathBuf>, String> {
    let root = home.join("sessions");
    if !root.is_dir() {
        return Err(format!("no Codex session logs under {}", root.display()));
    }
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
    Ok(found.into_iter().max_by_key(|(mtime, _)| *mtime).map(|(_, f)| f))
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
        let read = reading(agent, &cwd, home.as_deref(), started);
        // Every look is recorded, so a reader that cannot read its store shows up in Settings > Agents
        // (and once in the log) instead of never firing without a word.
        if let Some(line) = READS.put(agent, &read) {
            if let Ok(dir) = app.path().app_data_dir() {
                crate::secrets::log(&dir, &format!("handoff: cannot read {agent}'s context: {line}"));
            }
        }
        if let Read::Tokens(tokens) = read {
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
        assert_eq!(opencode_context_in(&conn, cwd, SystemTime::UNIX_EPOCH), Read::Tokens(819 + 124_160 + 256), "the newest session, newest answered turn");
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
        assert_eq!(opencode_context_in(&conn, cwd, SystemTime::UNIX_EPOCH), Read::Tokens(150), "the child is not the conversation, and an unanswered turn is skipped");
        let other = opencode("oc-elsewhere");
        assert_eq!(opencode_context_in(&other, cwd, SystemTime::UNIX_EPOCH), Read::Nothing, "no conversation in that folder: no reading");
    }

    #[test]
    fn a_fresh_opencode_conversation_reads_zero_so_the_pane_rearms() {
        let conn = opencode("oc-fresh");
        session(&conn, "new", "G:/Repo", None, 2);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", SystemTime::UNIX_EPOCH), Read::Tokens(0));
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
        assert_eq!(codex_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), Read::Tokens(171_500));
        assert_eq!(codex_context(&home, r"G:\Nope", SystemTime::UNIX_EPOCH), Read::Nothing, "no session in that folder");
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
        assert_eq!(codex_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), Read::Nothing, "no counts in the log: the pane is left alone");
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
        assert_eq!(grok_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH), Read::Tokens(171_500), "the newest session in that folder");
        assert_eq!(grok_context(&home, r"G:\Nope", SystemTime::UNIX_EPOCH), Read::Nothing, "no session in that folder: no reading");
        assert_eq!(grok_tokens(r#"{"contextTokensUsed":0}"#), Ok(Some(0)), "a fresh conversation re-arms the pane");
        assert_eq!(grok_tokens(r#"{"other":1}"#), Ok(None), "no signal: no reading");
    }

    #[test]
    fn a_conversation_untouched_since_the_pane_started_is_not_this_panes() {
        // A worktree keeps several conversations per folder. Resuming an old one must not read the
        // newer one a previous pane left behind, or the resumed pane would be cleared on its first look.
        let since = SystemTime::UNIX_EPOCH + Duration::from_secs(5);
        let conn = opencode("oc-resumed");
        session(&conn, "older", "G:/Repo", None, 1_000);
        message(&conn, "m", "older", 1, r#"{"tokens":{"input":190000,"output":1,"cache":{"read":0,"write":0}}}"#);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", since), Read::Nothing, "that session was last written before this pane started");
        session(&conn, "this-pane", "G:/Repo", None, 9_000);
        assert_eq!(opencode_context_in(&conn, r"G:\Repo", since), Read::Tokens(0), "the pane's own new conversation measures zero");

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
        assert_eq!(codex_context(&home, r"G:\Repo", later), Read::Nothing, "a rollout not written since the pane started is somebody else's");

        let home = temp("grok-resumed");
        let dir = home.join("sessions").join(grok_folder(r"G:\Repo")).join("s1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("signals.json"), r#"{"contextTokensUsed":171500}"#).unwrap();
        assert_eq!(grok_context(&home, r"G:\Repo", SystemTime::now() + Duration::from_secs(3600)), Read::Nothing);
    }

    #[test]
    fn rollout_cwd_reads_the_header_and_nothing_else() {
        assert_eq!(rollout_cwd(r#"{"type":"session_meta","payload":{"cwd":"G:\\Repo"}}"#), Some(r"G:\Repo".into()));
        assert_eq!(rollout_cwd("not json"), None);
        assert_eq!(rollout_cwd(r#"{"type":"event_msg","payload":{}}"#), None);
    }

    #[test]
    fn a_store_that_cannot_be_read_says_so_instead_of_reading_nothing() {
        // An OpenCode database with no tables at all: the file opens, the tables do not.
        let dir = temp("oc-broken");
        let db = dir.join("opencode.db");
        rusqlite::Connection::open(&db).unwrap().execute_batch("CREATE TABLE unrelated (x INT);").unwrap();
        let read = opencode_context(&db, r"G:\Repo", SystemTime::UNIX_EPOCH);
        assert!(matches!(read, Read::Failed(ref why) if why.contains("conversation list")), "{read:?}");
        let missing = opencode_context(&dir.join("missing.db"), r"G:\Repo", SystemTime::UNIX_EPOCH);
        assert!(matches!(missing, Read::Failed(ref why) if why.contains("cannot be opened")), "{missing:?}");
        // A Codex home with no sessions folder at all.
        let home = temp("cx-empty-home");
        let read = codex_context(&home, r"G:\Repo", SystemTime::UNIX_EPOCH);
        assert!(matches!(read, Read::Failed(ref why) if why.contains("no Codex session logs")), "{read:?}");
        // Grok's signals that are not JSON.
        let grok = temp("grok-bad");
        let sdir = grok.join("sessions").join(grok_folder(r"G:\Repo")).join("s1");
        std::fs::create_dir_all(&sdir).unwrap();
        std::fs::write(sdir.join("signals.json"), "not json").unwrap();
        let read = grok_context(&grok, r"G:\Repo", SystemTime::UNIX_EPOCH);
        assert!(matches!(read, Read::Failed(ref why) if why.contains("is not JSON")), "{read:?}");
    }

    #[test]
    fn a_reader_that_fails_is_named_once_and_stays_visible() {
        let reads = Reads::new();
        assert_eq!(reads.rows().iter().map(|r| r.state).collect::<Vec<_>>(), vec!["never", "never", "never"], "nothing has looked yet");
        let why = "no OpenCode database at C:\\x\\opencode.db".to_string();
        assert_eq!(reads.put("opencode", &Read::Failed(why.clone())), Some(why.clone()), "the first failure is logged");
        assert_eq!(reads.put("opencode", &Read::Failed(why.clone())), None, "the same failure again is not");
        let row = reads.rows().into_iter().find(|r| r.agent == "opencode").unwrap();
        assert_eq!((row.state, row.detail.as_str()), ("failed", why.as_str()));
        assert!(row.age_ms.is_some());
        assert_eq!(reads.put("opencode", &Read::Tokens(171_000)), None);
        let row = reads.rows().into_iter().find(|r| r.agent == "opencode").unwrap();
        assert_eq!((row.state, row.tokens), ("reading", Some(171_000)));
        assert_eq!(reads.put("opencode", &Read::Failed(why.clone())), Some(why), "a failure after a good reading is said again");
        assert_eq!(reads.put("grok", &Read::Nothing), None);
    }
}
