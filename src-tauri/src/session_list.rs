//! Session history across agents (VIEW-091, VIEW-083, VIEW-085; T-169). One list of the past
//! sessions of every agent whose transcripts Kolux can read, with titles, and the resume command
//! for any of them. Discovery reuses the chat reader's folders (`chat::homes`, `chat::jsonl_in`,
//! `chat::codex_rollouts`) and `sessions::claude_history_dir`; only a light summary of each file
//! (title, turns, working folder) is read here, never the whole conversation.
//!
//! Formats (PROVENANCE §5, 2026-10-20): Claude Code writes `<config>/projects/<folder>/<session>.jsonl`
//! with one event per line (`type` user, summary, ai-title or custom-title, `cwd`, `isSidechain`,
//! `isMeta`, `message.content`); Codex writes `<home>/sessions/YYYY/MM/DD/rollout-*.jsonl` and
//! `<home>/archived_sessions/*.jsonl`, first line `session_meta` (`payload.id`, `payload.cwd`,
//! `payload.source`), user turns as `event_msg` / `user_message`, and keeps a title index in
//! `<home>/session_index.jsonl` (`id`, `thread_name`). Other agents' readers wait for a public
//! description of their files (named on the PLAN line of T-169).
//!
//! A listed session carries no file path (council FIX-1): the window gets the id, title, times and
//! the session's working folder; anything that needs the file resolves it on this side.
// ponytail: the module is built and tested ahead of its command registration, which is
// evidence/sessions-T-169-lib.rs.patch (shared file); the allow goes when the patch lands.
#![allow(dead_code)]

use super::scan::{Budget, Listing, Report, Worker};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

/// How much of a transcript's start is read for its summary.
pub const HEAD_CAP: u64 = 1024 * 1024;
/// How much of a long transcript's end is read for a title written late.
pub const TAIL_CAP: u64 = 64 * 1024;
/// A shown title is cut to this many characters.
pub const TITLE_MAX: usize = 100;

/// One past session.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub agent: String,
    pub id: String,
    /// The session's title; empty when the transcript has none and no first message.
    pub title: String,
    pub modified_ms: u64,
    pub bytes: u64,
    /// How many messages the user sent; a session with none cannot be resumed.
    pub turns: u32,
    /// The folder the session ran in, when its transcript says.
    pub dir: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Summary {
    pub custom: String,
    pub ai: String,
    pub generated: String,
    pub first: String,
    pub turns: u32,
    pub cwd: Option<String>,
    pub id: Option<String>,
    /// A sub-agent or worker session: left out of the list.
    pub skip: bool,
    /// VIEW-090: the transcript could not be opened or read; it is counted as skipped, never cached.
    pub unreadable: bool,
    #[serde(skip)]
    seen_event: bool,
}

/// Where each agent keeps its sessions: Claude config folders (their `projects` folder holds the
/// sessions) and Codex homes, the first of each being the one the user chose, if any.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Roots {
    pub claude: Vec<PathBuf>,
    pub codex: Vec<PathBuf>,
}

pub enum Scope<'a> {
    /// Sessions that ran in these folders (blank entries match nothing).
    Dirs(&'a [String]),
    All,
}

/// Per-file summaries by (path, modified, size): a refocus reuses them, a forced refresh clears them.
pub type Cache = HashMap<PathBuf, (u64, u64, Summary)>;

fn cache() -> &'static Mutex<Cache> {
    static C: OnceLock<Mutex<Cache>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn text_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// One line of text for a title: whitespace collapsed, cut to [`TITLE_MAX`] characters.
pub fn tidy(text: &str) -> String {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= TITLE_MAX {
        return one;
    }
    let mut cut: String = one.chars().take(TITLE_MAX - 1).collect();
    cut.push('…');
    cut
}

/// The envelopes an agent injects into a user turn: not the user's words.
fn injected(text: &str) -> bool {
    let t = text.trim_start();
    ["<system-reminder", "<local-command", "<command-name", "<command-message", "<user-prompt-submit-hook", "<ide_", "<environment_context", "Caveat:"].iter().any(|p| t.starts_with(p))
}

fn claude_user_text(v: &Value) -> Option<String> {
    let content = v.pointer("/message/content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" "),
        _ => return None,
    };
    (!text.trim().is_empty() && !injected(&text)).then_some(text)
}

/// Reads one Claude line into the summary. `turns`: false for the tail, which only supplies titles.
pub fn claude_line(v: &Value, s: &mut Summary, turns: bool) {
    match v.get("type").and_then(Value::as_str) {
        Some("summary") => {
            if let Some(t) = text_of(v, "summary") {
                s.generated = t;
            }
        }
        Some("ai-title") => {
            if let Some(t) = text_of(v, "aiTitle") {
                s.ai = t;
            }
        }
        Some("custom-title") => {
            if let Some(t) = text_of(v, "customTitle") {
                s.custom = t;
            }
        }
        Some("user") if turns && v.get("isSidechain").and_then(Value::as_bool) != Some(true) && v.get("isMeta").and_then(Value::as_bool) != Some(true) => {
            if let Some(t) = claude_user_text(v) {
                s.turns = s.turns.saturating_add(1);
                if s.first.is_empty() {
                    s.first = tidy(&t);
                }
            }
        }
        _ => {}
    }
    if turns {
        if !s.seen_event && matches!(v.get("type").and_then(Value::as_str), Some("user" | "assistant")) {
            s.seen_event = true;
            // Sub-agent transcripts are sidechains from their first message.
            s.skip = v.get("isSidechain").and_then(Value::as_bool) == Some(true);
        }
        if s.cwd.is_none() {
            s.cwd = text_of(v, "cwd");
        }
    }
}

/// Reads one Codex line into the summary.
pub fn codex_line(v: &Value, s: &mut Summary) {
    let payload = v.get("payload");
    match v.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            if let Some(p) = payload {
                s.id = s.id.take().or_else(|| text_of(p, "id"));
                s.cwd = s.cwd.take().or_else(|| text_of(p, "cwd"));
                // A sub-agent thread spawned by another session is a worker, not a session of its own.
                if p.get("source").is_some_and(|src| src.is_object() && src.get("subagent").is_some()) {
                    s.skip = true;
                }
            }
        }
        Some("event_msg") => {
            if let Some(p) = payload.filter(|p| p.get("type").and_then(Value::as_str) == Some("user_message")) {
                if let Some(t) = text_of(p, "message").filter(|t| !injected(t)) {
                    s.turns = s.turns.saturating_add(1);
                    if s.first.is_empty() {
                        s.first = tidy(&t);
                    }
                }
            }
        }
        _ => {}
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

/// A transcript's summary: its first [`HEAD_CAP`] bytes, and for a longer one the last
/// [`TAIL_CAP`] bytes for a title written late (Claude).
pub fn summarize(agent: &str, path: &Path, len: u64) -> Summary {
    let mut s = Summary::default();
    #[cfg(test)]
    if path.file_name().is_some_and(|n| n.to_string_lossy().contains("stall")) {
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    #[cfg(test)]
    assert!(!path.file_name().is_some_and(|n| n.to_string_lossy().contains("boom")), "test panic");
    let Some(head) = slice(path, 0, HEAD_CAP) else {
        s.unreadable = true;
        return s;
    };
    let claude = agent != "codex";
    for line in head.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if claude {
                claude_line(&v, &mut s, true);
            } else {
                codex_line(&v, &mut s);
            }
        }
    }
    if claude && len > HEAD_CAP {
        if let Some(tail) = slice(path, len.saturating_sub(TAIL_CAP), TAIL_CAP) {
            // The first line of the tail may be cut: it fails to parse and is ignored.
            for line in tail.lines().skip(1) {
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    claude_line(&v, &mut s, false);
                }
            }
        }
    }
    s
}

type Job = (String, PathBuf, Option<(u64, u64, Summary)>);
type Found = Option<(u64, u64, Summary, bool)>;
/// The scan's one budgeted worker.
type Probe = Worker<Job, Found>;

/// Stats a transcript and, unless the saved summary still matches, reads it (the work of [`probe_file`]),
/// all on the scan's worker so a hung disk stalls neither step past the budget. `None`: gone,
/// unreadable, or the budget ran out.
fn look(cache: &mut Cache, agent: &str, path: &Path, report: &mut Report, probe: &Probe) -> Option<(u64, u64, Summary)> {
    let Some(found) = probe.call((agent.to_string(), path.to_path_buf(), cache.get(path).cloned())) else {
        // A helper that died on this file only skips it; a spent budget, or a second helper death (which also sets stalled), cuts the scan short.
        report.cut_short |= probe.stalled();
        return None;
    };
    let (modified, len, s, fresh) = found?;
    if s.unreadable {
        return None;
    }
    if fresh {
        report.parsed += 1;
        cache.insert(path.to_path_buf(), (modified, len, s.clone()));
    }
    Some((modified, len, s))
}

fn probe_file((agent, path, saved): Job) -> Found {
    let (modified, len) = stat(&path)?;
    if let Some((m, l, s)) = saved {
        if m == modified && l == len {
            return Some((modified, len, s, false));
        }
    }
    Some((modified, len, summarize(&agent, &path, len), true))
}

fn stat(path: &Path) -> Option<(u64, u64)> {
    #[cfg(test)]
    if path.file_name().is_some_and(|n| n.to_string_lossy().contains("statstall")) {
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
    Some((modified, meta.len()))
}

fn norm_dir(s: &str) -> String {
    s.trim_start_matches(r"\\?\").trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase()
}

fn in_scope(dir: Option<&str>, scope: &Scope) -> bool {
    match scope {
        Scope::All => true,
        Scope::Dirs(dirs) => dir.is_some_and(|d| dirs.iter().filter(|w| !w.trim().is_empty()).any(|w| norm_dir(w) == norm_dir(d))),
    }
}

fn title_of(s: &Summary, indexed: Option<&String>) -> String {
    [s.custom.as_str(), s.ai.as_str(), s.generated.as_str(), indexed.map_or("", String::as_str), s.first.as_str()]
        .into_iter()
        .find(|t| !t.is_empty())
        .map(tidy)
        .unwrap_or_default()
}

/// Claude sessions: for a folder scope the workspace's own history folder (`sessions::claude_history_dir`
/// finds it however the drive letter is cased), for All every history folder. Sub-agent transcripts
/// (`agent-*` files and sidechain sessions) are left out.
fn claude_entries(roots: &[PathBuf], scope: &Scope, cache: &mut Cache, budget: &Budget, probe: &Probe, report: &mut Report) -> Vec<Entry> {
    let mut out = Vec::new();
    for config in roots {
        let projects = config.join("projects");
        let folders: Vec<PathBuf> = match scope {
            Scope::All => fs::read_dir(&projects).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect(),
            Scope::Dirs(dirs) => {
                let mut v: Vec<PathBuf> = dirs.iter().filter(|d| !d.trim().is_empty()).filter_map(|d| crate::sessions::claude_history_dir(&projects, d)).collect();
                v.sort();
                v.dedup();
                v
            }
        };
        for folder in folders {
            for path in crate::chat::jsonl_in(&folder) {
                let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                if stem.is_empty() || stem.starts_with("agent-") {
                    continue;
                }
                if budget.spent() {
                    report.cut_short = true;
                    return out;
                }
                let Some((modified, len, s)) = look(cache, "claude", &path, report, probe) else {
                    report.skipped += 1;
                    continue;
                };
                if s.skip {
                    continue;
                }
                let title = title_of(&s, None);
                out.push(Entry { agent: "claude".into(), id: stem, title, modified_ms: modified, bytes: len, turns: s.turns, dir: s.cwd });
            }
        }
    }
    out
}

/// The title index Codex keeps: session id -> thread name.
pub fn codex_index(home: &Path) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let Some(text) = slice(&home.join("session_index.jsonl"), 0, HEAD_CAP * 4) else { return m };
    for line in text.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let (Some(id), Some(name)) = (text_of(&v, "id"), text_of(&v, "thread_name")) {
                m.insert(id, name);
            }
        }
    }
    m
}

/// Every Codex rollout of a home: the dated `sessions` tree and the flat `archived_sessions` folder.
pub fn codex_files(home: &Path) -> Vec<PathBuf> {
    let mut files = crate::chat::codex_rollouts(home, UNIX_EPOCH);
    files.extend(crate::chat::jsonl_in(&home.join("archived_sessions")));
    files
}

fn codex_entries(roots: &[PathBuf], scope: &Scope, cache: &mut Cache, budget: &Budget, probe: &Probe, report: &mut Report) -> Vec<Entry> {
    let mut out = Vec::new();
    for home in roots {
        let index = codex_index(home);
        let index_file = home.join("session_index.jsonl");
        if index_file.exists() && slice(&index_file, 0, 1).is_none() {
            report.note_unreadable("the Codex title index");
        }
        for path in codex_files(home) {
            if budget.spent() {
                report.cut_short = true;
                return out;
            }
            let Some((modified, len, s)) = look(cache, "codex", &path, report, probe) else {
                report.skipped += 1;
                continue;
            };
            if s.skip || !in_scope(s.cwd.as_deref(), scope) {
                continue;
            }
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let Some(id) = s.id.clone().or_else(|| stem.len().checked_sub(36).and_then(|at| stem.get(at..)).map(str::to_string)) else { continue };
            let title = title_of(&s, index.get(&id));
            out.push(Entry { agent: "codex".into(), id, title, modified_ms: modified, bytes: len, turns: s.turns, dir: s.cwd });
        }
    }
    out
}

/// The past sessions of every readable agent in `scope`, newest first, one row per (agent, id) even
/// when two roots hold the same session, cut to `depth` rows (None = unlimited) after the scope.
pub fn list(roots: &Roots, scope: &Scope, cache: &mut Cache, depth: Option<usize>) -> Vec<Entry> {
    list_scan(roots, scope, cache, depth, &Budget::none()).sessions
}

/// VIEW-090 / VIEW-092: the same list plus what the scan could not do (skipped transcripts, a cut-short
/// scan, an unreadable index, no session folder at all). A transcript that cannot be read is counted
/// and left out; it never fails the scan.
pub fn list_scan(roots: &Roots, scope: &Scope, cache: &mut Cache, depth: Option<usize>, budget: &Budget) -> Listing {
    let no_sources = roots.claude.iter().all(|c| !c.join("projects").is_dir()) && roots.codex.iter().all(|h| !h.join("sessions").is_dir() && !h.join("archived_sessions").is_dir());
    let mut report = Report { no_sources, ..Report::default() };
    let probe = budget.worker(probe_file);
    let mut all = claude_entries(&roots.claude, scope, cache, budget, &probe, &mut report);
    all.extend(codex_entries(&roots.codex, scope, cache, budget, &probe, &mut report));
    all.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.agent.cmp(&b.agent)).then_with(|| a.id.cmp(&b.id)));
    let mut seen = HashSet::new();
    all.retain(|e| seen.insert((e.agent.clone(), e.id.clone())));
    if let Some(n) = depth {
        all.truncate(n);
    }
    Listing { sessions: all, report }
}

// ---- roots from settings and environment ----

fn env_text(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn user_home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// An agent's own session-folder override (`agentOptions.<agent>.sessionFolder`), used exactly as given.
fn own_folder(settings: &Value, agent: &str) -> Option<PathBuf> {
    settings.get(crate::agents::OPTIONS_FIELD)?.get(agent)?.get("sessionFolder")?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from)
}

/// The folders to read, the user's choice first (VIEW-091, ACCT-022), then what the chat reader
/// would look in, then (when `profile` is the app's profile folder) each managed account's folder
/// (`<profile>\claude-accounts\<id>`) and the OpenRouter route's (`<profile>\providers\openrouter`),
/// so chats run there show in the past-sessions list too. `process_env` is injected so tests do not
/// depend on the real environment.
pub fn roots_for(settings: &Value, process_env: impl Fn(&str) -> Option<String>, user: Option<PathBuf>, profile: Option<&Path>) -> Roots {
    let mut claude: Vec<PathBuf> = own_folder(settings, "claude").into_iter().collect();
    claude.extend(crate::chat::homes("claude", &[], &process_env, user.clone()));
    if let Some(profile) = profile {
        claude.extend(profile_claude_folders(profile));
    }
    let mut codex: Vec<PathBuf> = own_folder(settings, "codex").into_iter().collect();
    let chosen = crate::agent_creds::sessions_home(settings, process_env(crate::codex_accounts::HOME_ENV).as_deref(), user.as_deref());
    codex.extend(chosen);
    codex.extend(crate::chat::homes("codex", &[], &process_env, user));
    for v in [&mut claude, &mut codex] {
        let mut seen = Vec::new();
        v.retain(|p| {
            let key = norm_dir(&p.to_string_lossy());
            let fresh = !seen.contains(&key);
            seen.push(key);
            fresh
        });
    }
    Roots { claude, codex }
}

/// The Claude config folders Kolux itself keeps in the profile, in a steady order: each managed
/// account's (a link is not an account; nothing is read from it) and then the OpenRouter route's.
/// Only folders that exist are listed.
fn profile_claude_folders(profile: &Path) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = fs::read_dir(profile.join(crate::claude_accounts::FOLDER))
        .map(|rd| rd.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect())
        .unwrap_or_default();
    folders.sort();
    let route = crate::openrouter::config_dir(profile);
    if route.is_dir() {
        folders.push(route);
    }
    folders
}

pub(super) fn live_roots(settings: &Value, profile: Option<&Path>) -> Roots {
    roots_for(settings, env_text, user_home(), profile)
}

// ---- resuming ----

/// The shell a resume command is written for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shell {
    Pwsh,
    Cmd,
    Posix,
}

/// The shell family of a shell program: `pwsh` / `powershell` / `cmd` by name (path and `.exe`
/// ignored, case ignored); everything else, WSL shells included, is POSIX.
pub fn shell_of(program: &str) -> Shell {
    let name = program.rsplit(['\\', '/']).next().unwrap_or(program).to_lowercase();
    match name.trim_end_matches(".exe") {
        "pwsh" | "powershell" => Shell::Pwsh,
        "cmd" => Shell::Cmd,
        _ => Shell::Posix,
    }
}

fn plain(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | '@' | '+' | ',' | '\\'))
}

fn quote(shell: Shell, s: &str) -> String {
    if plain(s) && !(shell == Shell::Posix && s.contains('\\')) {
        return s.to_string();
    }
    match shell {
        Shell::Pwsh => format!("'{}'", s.replace('\'', "''")),
        Shell::Cmd => format!("\"{}\"", s.replace('"', "\"\"")),
        Shell::Posix => format!("'{}'", s.replace('\'', r"'\''")),
    }
}

/// A folder or variable value: always quoted for Pwsh and cmd (a path may hold spaces).
fn quote_value(shell: Shell, s: &str) -> String {
    match shell {
        Shell::Pwsh => format!("'{}'", s.replace('\'', "''")),
        Shell::Cmd => format!("\"{}\"", s.replace('"', "\"\"")),
        Shell::Posix => quote(shell, s),
    }
}

/// The resume command as one line for `shell`: the folder to run in, the variables to set, then the program.
pub fn copy_command(shell: Shell, cwd: Option<&str>, env: &[(String, String)], program: &str, args: &[String]) -> String {
    let call = std::iter::once(program).chain(args.iter().map(String::as_str)).map(|p| quote(shell, p)).collect::<Vec<_>>();
    let (head, first) = call.split_first().map(|(h, r)| (h.clone(), r.to_vec())).unwrap_or_default();
    let mut steps: Vec<String> = Vec::new();
    match shell {
        Shell::Pwsh => {
            if let Some(d) = cwd {
                steps.push(format!("Set-Location -LiteralPath {}", quote_value(shell, d)));
            }
            for (k, v) in env {
                steps.push(format!("$env:{k} = {}", quote_value(shell, v)));
            }
            let run = if head.starts_with('\'') { format!("& {head}") } else { head };
            steps.push(std::iter::once(run).chain(first).collect::<Vec<_>>().join(" "));
            steps.join("; ")
        }
        Shell::Cmd => {
            if let Some(d) = cwd {
                steps.push(format!("cd /d {}", quote_value(shell, d)));
            }
            for (k, v) in env {
                steps.push(format!("set \"{k}={v}\""));
            }
            steps.push(std::iter::once(head).chain(first).collect::<Vec<_>>().join(" "));
            steps.join(" && ")
        }
        Shell::Posix => {
            if let Some(d) = cwd {
                steps.push(format!("cd {}", quote_value(shell, d)));
            }
            let vars: Vec<String> = env.iter().map(|(k, v)| format!("{k}={}", quote(shell, v))).collect();
            steps.push(vars.into_iter().chain(std::iter::once(head)).chain(first).collect::<Vec<_>>().join(" "));
            steps.join(" && ")
        }
    }
}

/// What a click on Resume, a drop on a pane or Copy command needs.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResumePlan {
    /// The start line to open in a terminal: the agent's resume form after its default arguments
    /// from settings, the program override, the environment (Codex: its own home, replacing any
    /// inherited one).
    pub line: crate::agents::StartLine,
    /// The folder to open in: the one the session ran in when it still exists, else the one given.
    pub cwd: Option<String>,
    pub program: String,
    /// The same command as one line for the chosen shell.
    pub copy: String,
}

/// The id a Codex rollout file stem (`rollout-<timestamp>-<id>`) carries: a trailing UUID, else the last dash-part.
fn rollout_id(stem: &str) -> Option<&str> {
    let tail = stem.strip_prefix("rollout-")?;
    let uuid_shaped = |u: &str| u.len() == 36 && u.char_indices().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { c == '-' } else { c.is_ascii_hexdigit() });
    let at = tail.len().checked_sub(36).filter(|&at| tail.is_char_boundary(at));
    match at.map(|at| (at, &tail[at..])) {
        Some((0, u)) if uuid_shaped(u) => Some(u),
        Some((at, u)) if uuid_shaped(u) && tail.as_bytes()[at - 1] == b'-' => Some(u),
        _ => tail.rsplit('-').next().filter(|id| !id.is_empty()),
    }
}

/// The one transcript file of session `id` and its Codex home, or why there is not exactly one.
/// A Claude session is `<id>.jsonl`; a Codex rollout matches only when its whole id equals `id`.
pub fn find_session_exact(roots: &Roots, agent: &str, id: &str) -> Result<(PathBuf, Option<PathBuf>), String> {
    let gone = || "That session is no longer on this computer.".to_string();
    match agent {
        "claude" | "openclaude" => roots.claude.iter().find_map(|c| fs::read_dir(c.join("projects")).ok()?.flatten().map(|e| e.path().join(format!("{id}.jsonl"))).find(|p| p.is_file()).map(|p| (p, None))).ok_or_else(gone),
        "codex" => {
            let mut hits: Vec<(PathBuf, Option<PathBuf>)> = roots.codex.iter().flat_map(|h| codex_files(h).into_iter().filter(|f| f.file_stem().is_some_and(|s| rollout_id(&s.to_string_lossy()) == Some(id))).map(|f| (f, Some(h.clone()))).collect::<Vec<_>>()).collect();
            match hits.len() {
                0 => Err(gone()),
                1 => Ok(hits.remove(0)),
                _ => Err("More than one session file has this id, so Kolux will not pick one.".into()),
            }
        }
        _ => Err(gone()),
    }
}

/// The transcript file of session `id` and its Codex home, searched in every root. An id that
/// names no file, or more than one, finds nothing.
pub fn find_session(roots: &Roots, agent: &str, id: &str) -> Option<(PathBuf, Option<PathBuf>)> {
    find_session_exact(roots, agent, id).ok()
}

/// The resume plan for session `id` of `agent`, or the plain reason it cannot be resumed.
pub fn plan(settings: &Value, roots: &Roots, agent: &str, id: &str, workspace: Option<&str>, shell: Shell) -> Result<ResumePlan, String> {
    if !crate::agents::safe_session(id) {
        return Err("That session's name cannot be used to resume it.".into());
    }
    if crate::agents::resume_args(agent, Some(id)).is_empty() {
        return Err(format!("Kolux does not know how to resume {agent} sessions yet."));
    }
    let (file, home) = find_session_exact(roots, agent, id)?;
    let len = stat(&file).map_or(0, |(_, l)| l);
    let s = summarize(agent, &file, len);
    if s.turns == 0 {
        return Err("This session has no messages yet, so there is nothing to resume.".into());
    }
    let mut line = crate::agents::start_line_as(settings, agent, &[], "", true, crate::agents::Start::Restore(Some(id)))?;
    if let Some(h) = home {
        // The session lives in this home: say so, replacing any CODEX_HOME the app inherited.
        line.env.retain(|(k, _)| k != crate::codex_accounts::HOME_ENV);
        line.env.push((crate::codex_accounts::HOME_ENV.into(), h.to_string_lossy().into_owned()));
    }
    // The session's own folder when it is still there (a resume "from another worktree" opens there),
    // else the workspace in front, else wherever the transcript says it ran.
    let cwd = s.cwd.clone().filter(|d| Path::new(d).is_dir()).or_else(|| workspace.map(str::to_string)).or(s.cwd);
    let program = line.program.clone().unwrap_or_else(|| crate::agents::CATALOGUE.iter().find(|e| e.0 == agent).and_then(|e| e.2.first()).map_or(agent, |p| p).to_string());
    let copy = copy_command(shell, cwd.as_deref(), &line.env, &program, &line.args);
    Ok(ResumePlan { line, cwd, program, copy })
}

// ---- commands ----

/// VIEW-091 / VIEW-083: the past sessions in scope. `force` is the refresh button (a full rescan);
/// without it, files that did not change reuse their last summary.
#[tauri::command]
pub async fn sessions_list(store: tauri::State<'_, Mutex<crate::state::Store>>, dirs: Vec<String>, all: bool, depth: Option<usize>, force: Option<bool>) -> Result<Listing, String> {
    let (settings, profile) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), store.dir())
    };
    let force = force.unwrap_or(false);
    // VIEW-092: the scan runs off the window's thread, and the window gets an answer even when a disk stalls.
    tauri::async_runtime::spawn_blocking(move || scan_now(&settings, &profile, &dirs, all, depth, force)).await.map_err(|e| e.to_string())
}

static RUNNING: super::scan::Running = super::scan::Running::new();
static DISK_LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// VIEW-090 / VIEW-092: one scan under the shared cache. The first scan of the run starts from the
/// summaries saved on disk; a forced one clears the cache unless another scan is running (it joins
/// that one); WSL roots whose distribution is stopped are left out; the scan stops reading after
/// [`super::scan::SCAN_BUDGET`]; new summaries are saved for the next run.
pub fn scan_now(settings: &Value, profile: &Path, dirs: &[String], all: bool, depth: Option<usize>, force: bool) -> Listing {
    let (_ticket, joined) = RUNNING.enter();
    let mut roots = live_roots(settings, Some(profile));
    let mut notes = Report::default();
    roots.claude = super::scan::without_stopped_wsl(roots.claude, &mut notes, super::scan::running_distros);
    roots.codex = super::scan::without_stopped_wsl(roots.codex, &mut notes, super::scan::running_distros);
    let file = profile.join(super::scan::CACHE_FILE);
    let mut guard = cache().lock().unwrap_or_else(|e| e.into_inner());
    if !DISK_LOADED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        for (k, v) in super::scan::load_disk(&file) {
            guard.entry(k).or_insert(v);
        }
    }
    if force && !joined {
        guard.clear();
    }
    let scope = if all { Scope::All } else { Scope::Dirs(dirs) };
    let mut got = list_scan(&roots, &scope, &mut guard, depth, &Budget::within(super::scan::SCAN_BUDGET));
    for what in notes.unreadable {
        got.report.note_unreadable(&what);
    }
    if got.report.parsed > 0 {
        let _ = super::scan::save_disk(&file, &guard);
    }
    got
}

/// VIEW-085: the resume plan for one listed session, written for `shell` (a shell program name or
/// path; unknown means POSIX).
#[tauri::command]
pub async fn session_resume_plan(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String, workspace: Option<String>, shell: Option<String>) -> Result<ResumePlan, String> {
    let (settings, profile) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), store.dir())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let kind = shell.as_deref().map_or(if cfg!(windows) { Shell::Pwsh } else { Shell::Posix }, shell_of);
        plan(&settings, &live_roots(&settings, Some(&profile)), &agent, &id, workspace.as_deref(), kind)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-sesslist-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn lines(path: &Path, rows: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n") + "\n").unwrap();
    }

    fn claude_user(text: &str, cwd: &str) -> Value {
        json!({ "type": "user", "cwd": cwd, "message": { "role": "user", "content": text } })
    }

    fn codex_session(path: &Path, id: &str, cwd: &str, source: Value, message: Option<&str>) {
        let mut rows = vec![json!({ "type": "session_meta", "payload": { "id": id, "cwd": cwd, "source": source } })];
        if let Some(m) = message {
            rows.push(json!({ "type": "event_msg", "payload": { "type": "user_message", "message": m } }));
        }
        lines(path, &rows);
    }

    /// Row 777 follow-up: one budgeted worker per scan, not a thread per transcript.
    #[test]
    fn a_warm_budgeted_scan_of_thousands_of_transcripts_starts_one_thread() {
        let root = tmp("warmthreads");
        let dir = root.join("projects").join("C--work-app");
        for i in 0..2000 {
            lines(&dir.join(format!("s{i}.jsonl")), &[claude_user("first", r"C:\work\app")]);
        }
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        let mut cache = Cache::new();
        assert_eq!(list_scan(&roots, &Scope::All, &mut cache, None, &Budget::none()).sessions.len(), 2000);
        super::super::scan::SPAWNS.with(|n| n.set(0));
        let began = std::time::Instant::now();
        let got = list_scan(&roots, &Scope::All, &mut cache, None, &Budget::within(std::time::Duration::from_secs(120)));
        let (took, spawns) = (began.elapsed(), super::super::scan::SPAWNS.with(|n| n.get()));
        eprintln!("p49 warm scan of 2000 transcripts: {took:?}, {spawns} budget threads");
        assert_eq!((got.sessions.len(), got.report.parsed, got.report.skipped, got.report.cut_short), (2000, 0, 0, false));
        assert_eq!(spawns, 1, "the warm scan started {spawns} threads");
        let _ = fs::remove_dir_all(&root);
    }

    /// Row 893: a panic while reading one transcript costs that file only; the helper is replaced and the rest parse.
    #[test]
    fn row893_a_panic_reading_one_transcript_skips_it_and_the_others_are_still_parsed() {
        let root = tmp("boom");
        let dir = root.join("projects").join("C--work-app");
        lines(&dir.join("a-boom.jsonl"), &[claude_user("first", r"C:\work\app")]);
        lines(&dir.join("b.jsonl"), &[claude_user("second", r"C:\work\app")]);
        lines(&dir.join("c.jsonl"), &[claude_user("third", r"C:\work\app")]);
        let got = list_scan(&Roots { claude: vec![root.clone()], codex: vec![] }, &Scope::All, &mut Cache::new(), None, &Budget::within(std::time::Duration::from_secs(60)));
        assert_eq!((got.sessions.len(), got.report.parsed, got.report.skipped, got.report.cut_short), (2, 2, 1, false));
        let _ = fs::remove_dir_all(&root);
    }

    /// after-list row 777: a stat that hangs (a dead network disk) counts against the scan budget too.
    #[test]
    fn row777_a_stalled_stat_does_not_hold_the_scan_past_its_budget() {
        let root = tmp("statstall");
        let dir = root.join("projects").join("C--work-app");
        lines(&dir.join("a-statstall.jsonl"), &[claude_user("first", r"C:\work\app")]);
        let sid = "019a0000-0000-7000-8000-0000000007c1";
        codex_session(&root.join("sessions/2026/10/01").join(format!("rollout-2026-10-01T00-00-00-{sid}-statstall.jsonl")), sid, r"C:\work\app", Value::String("cli".into()), Some("hi"));
        let both = Roots { claude: vec![root.clone()], codex: vec![root.clone()] };
        let began = std::time::Instant::now();
        let got = list_scan(&both, &Scope::All, &mut Cache::new(), None, &Budget::within(std::time::Duration::from_millis(400)));
        assert!(began.elapsed() < std::time::Duration::from_secs(3), "the scan waited {:?} on the stalled stat", began.elapsed());
        assert!(got.report.cut_short);
        assert!(got.sessions.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view091_claude_sessions_have_titles_and_sub_agents_are_pruned() {
        let root = tmp("claude");
        let dir = root.join("projects").join("C--work-app");
        lines(&dir.join("a.jsonl"), &[json!({ "type": "summary", "summary": "Fix the login bug" }), claude_user("please fix login", r"C:\work\app")]);
        lines(&dir.join("b.jsonl"), &[claude_user("<system-reminder>x</system-reminder>", r"C:\work\app"), claude_user("  add   a\ntest  ", r"C:\work\app")]);
        lines(&dir.join("agent-9.jsonl"), &[claude_user("sub agent task", r"C:\work\app")]);
        lines(&dir.join("c.jsonl"), &[json!({ "type": "user", "isSidechain": true, "message": { "content": "side" } })]);
        lines(&dir.join("d.jsonl"), &[json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "ok" }] } }), json!({ "type": "ai-title", "aiTitle": "Generated name" })]);
        lines(&dir.join("e.jsonl"), &[json!({ "type": "summary", "summary": "old" }), json!({ "type": "ai-title", "aiTitle": "ai" }), json!({ "type": "custom-title", "customTitle": "Mine" }), claude_user("hi", "x")]);
        let ws = vec![r"c:\work\app".to_string()];
        let got = list(&Roots { claude: vec![root.clone()], codex: vec![] }, &Scope::Dirs(&ws), &mut Cache::new(), None);
        let by: HashMap<&str, &Entry> = got.iter().map(|e| (e.id.as_str(), e)).collect();
        assert_eq!(by.len(), 4, "the agent- file and the sidechain are pruned: {got:?}");
        assert_eq!((by["a"].title.as_str(), by["a"].turns), ("Fix the login bug", 1), "a generated summary is the title");
        assert_eq!((by["b"].title.as_str(), by["b"].turns), ("add a test", 1), "the first real message, whitespace collapsed; the injected envelope is not a turn");
        assert_eq!((by["d"].title.as_str(), by["d"].turns), ("Generated name", 0), "a tool result is not a user turn, but the title stays");
        assert_eq!(by["e"].title, "Mine", "the user's own name beats a generated one");
        assert_eq!(by["a"].dir.as_deref(), Some(r"C:\work\app"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view091_a_title_written_late_in_a_long_transcript_is_found() {
        let root = tmp("late");
        let f = root.join("projects").join("C--w").join("long.jsonl");
        let mut rows = vec![claude_user("first words", "x")];
        rows.extend((0..30_000).map(|i| json!({ "type": "assistant", "message": { "content": format!("filler line {i} {}", "x".repeat(40)) } })));
        rows.push(json!({ "type": "ai-title", "aiTitle": "Late title" }));
        lines(&f, &rows);
        assert!(fs::metadata(&f).unwrap().len() > HEAD_CAP);
        let got = list(&Roots { claude: vec![root.clone()], codex: vec![] }, &Scope::All, &mut Cache::new(), None);
        assert_eq!(got[0].title, "Late title");
        assert_eq!(got[0].turns, 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view091_codex_merges_both_roots_without_duplicates_and_leaves_workers_out() {
        let home = tmp("codex");
        let sid = "019a0000-0000-7000-8000-000000000001";
        let dup = "019a0000-0000-7000-8000-000000000002";
        codex_session(&home.join("sessions/2026/10/01").join(format!("rollout-2026-10-01T00-00-00-{sid}.jsonl")), sid, r"C:\work\app", Value::String("cli".into()), Some("write the parser"));
        codex_session(&home.join("sessions/2026/10/02").join(format!("rollout-2026-10-02T00-00-00-{dup}.jsonl")), dup, r"C:\work\app", Value::Null, Some("same session, live copy"));
        codex_session(&home.join("archived_sessions").join(format!("rollout-2026-10-02T00-00-00-{dup}.jsonl")), dup, r"C:\work\app", Value::Null, Some("same session, archived copy"));
        codex_session(&home.join("archived_sessions/rollout-worker-019a0000-0000-7000-8000-000000000003.jsonl"), "019a0000-0000-7000-8000-000000000003", r"C:\work\app", json!({ "subagent": { "parent": "x" } }), Some("worker"));
        codex_session(&home.join("archived_sessions/rollout-other-019a0000-0000-7000-8000-000000000004.jsonl"), "019a0000-0000-7000-8000-000000000004", r"C:\elsewhere", Value::Null, Some("other folder"));
        fs::write(home.join("session_index.jsonl"), format!("{}\n{}\n", json!({ "id": sid, "thread_name": "Parser work" }), json!({ "id": "unrelated", "thread_name": "x" }))).unwrap();
        let ws = vec![r"C:\work\app\".to_string()];
        let roots = Roots { claude: vec![], codex: vec![home.clone()] };
        let got = list(&roots, &Scope::Dirs(&ws), &mut Cache::new(), None);
        let ids: Vec<&str> = got.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(got.len(), 2, "the duplicate id is one row; the worker and the other folder are out: {ids:?}");
        assert_eq!(got.iter().find(|e| e.id == sid).unwrap().title, "Parser work", "the title index is used");
        assert!(got.iter().find(|e| e.id == dup).unwrap().title.starts_with("same session"), "the first message is the fallback title");
        let all = list(&roots, &Scope::All, &mut Cache::new(), Some(2));
        assert_eq!(all.len(), 2, "depth cuts after the scope");
        assert!(list(&roots, &Scope::Dirs(&["".to_string(), "  ".to_string()]), &mut Cache::new(), None).is_empty(), "a blank folder never matches every session");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view083_unchanged_files_reuse_their_summary_and_a_forced_scan_does_not() {
        let root = tmp("cache");
        let f = root.join("projects").join("C--w").join("s.jsonl");
        lines(&f, &[claude_user("one", "x")]);
        let mut cache = Cache::new();
        let roots = Roots { claude: vec![root.clone()], codex: vec![] };
        assert_eq!(list(&roots, &Scope::All, &mut cache, None)[0].turns, 1);
        // Poison the cached summary: an unchanged file must come back from the cache.
        for v in cache.values_mut() {
            v.2.turns = 77;
        }
        assert_eq!(list(&roots, &Scope::All, &mut cache, None)[0].turns, 77, "refocus reads the cache");
        cache.clear();
        assert_eq!(list(&roots, &Scope::All, &mut cache, None)[0].turns, 1, "a forced refresh rescans");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view091_the_agents_own_session_folder_is_read_first_and_exactly_as_given() {
        let settings = json!({ "agentOptions": { "claude": { "sessionFolder": r"D:\mine\claude" }, "codex": { "sessionFolder": "  " } }, "codexSessionsHome": r"E:\codex-chosen" });
        let env = |k: &str| match k {
            "CLAUDE_CONFIG_DIR" => Some(r"C:\cfg".to_string()),
            _ => None,
        };
        let roots = roots_for(&settings, env, Some(PathBuf::from(r"C:\Users\me")), None);
        assert_eq!(roots.claude, [PathBuf::from(r"D:\mine\claude"), PathBuf::from(r"C:\cfg"), PathBuf::from(r"C:\Users\me").join(".claude")]);
        assert_eq!(roots.codex.first().unwrap(), &PathBuf::from(r"E:\codex-chosen"), "ACCT-022's chosen folder leads");
        assert!(roots.codex.contains(&PathBuf::from(r"C:\Users\me").join(".codex")));
        let plain = roots_for(&json!({}), |_| None, Some(PathBuf::from(r"C:\Users\me")), None);
        assert_eq!(plain.codex, [PathBuf::from(r"C:\Users\me").join(".codex")], "an empty field means the standard folder, once");
    }

    #[test]
    fn the_profiles_account_folders_and_the_openrouter_folder_are_scanned_too() {
        let dir = crate::test_dir::temp("roots-profile");
        let profile = dir.join("profile");
        let accounts = profile.join(crate::claude_accounts::FOLDER);
        fs::create_dir_all(accounts.join("b-second")).unwrap();
        fs::create_dir_all(accounts.join("a-first")).unwrap();
        fs::write(accounts.join("stray-file.txt"), "not a folder").unwrap();
        let route = crate::openrouter::config_dir(&profile);
        fs::create_dir_all(&route).unwrap();
        let home = dir.join("home");
        let roots = roots_for(&json!({}), |_| None, Some(home.clone()), Some(&profile));
        assert_eq!(roots.claude, [home.join(".claude"), accounts.join("a-first"), accounts.join("b-second"), route.clone()], "standard folder first, then accounts in name order, then the route");
        assert_eq!(roots.codex, [home.join(".codex")], "only Claude gains folders");
        let without = roots_for(&json!({}), |_| None, Some(home.clone()), None);
        assert_eq!(without.claude, [home.join(".claude")], "no profile, no extra folders");
    }

    #[test]
    fn a_profile_without_those_folders_adds_nothing_and_a_duplicate_is_listed_once() {
        let dir = crate::test_dir::temp("roots-profile-empty");
        let profile = dir.join("profile");
        fs::create_dir_all(&profile).unwrap();
        let home = dir.join("home");
        let bare = roots_for(&json!({}), |_| None, Some(home.clone()), Some(&profile));
        assert_eq!(bare.claude, [home.join(".claude")], "nothing there, nothing added");
        let route = crate::openrouter::config_dir(&profile);
        fs::create_dir_all(&route).unwrap();
        let env_route = route.to_string_lossy().into_owned();
        let same = roots_for(&json!({}), |k| (k == "CLAUDE_CONFIG_DIR").then(|| env_route.clone()), Some(home.clone()), Some(&profile));
        assert_eq!(same.claude, [route, home.join(".claude")], "a folder that is also the environment's is listed once");
    }

    #[test]
    fn view085_the_resume_command_fits_each_shell() {
        let args = vec!["--resume".to_string(), "abc-123".to_string()];
        assert_eq!(copy_command(Shell::Pwsh, Some(r"C:\work\my app"), &[], "claude", &args), r"Set-Location -LiteralPath 'C:\work\my app'; claude --resume abc-123");
        assert_eq!(copy_command(Shell::Cmd, Some(r"C:\work\my app"), &[], "claude", &args), r#"cd /d "C:\work\my app" && claude --resume abc-123"#);
        assert_eq!(copy_command(Shell::Posix, Some("/home/me/it's"), &[], "claude", &args), r"cd '/home/me/it'\''s' && claude --resume abc-123");
        let env = vec![("CODEX_HOME".to_string(), r"C:\Users\me\.codex".to_string())];
        let resume = vec!["resume".to_string(), "id9".to_string()];
        assert_eq!(copy_command(Shell::Pwsh, None, &env, r"C:\Program Files\codex.exe", &resume), r"$env:CODEX_HOME = 'C:\Users\me\.codex'; & 'C:\Program Files\codex.exe' resume id9");
        assert_eq!(copy_command(Shell::Cmd, None, &env, "codex", &resume), r#"set "CODEX_HOME=C:\Users\me\.codex" && codex resume id9"#);
        assert_eq!(copy_command(Shell::Posix, None, &env, "codex", &resume), r"CODEX_HOME='C:\Users\me\.codex' codex resume id9");
        assert_eq!(shell_of(r"C:\Program Files\Pwsh\7\pwsh.exe"), Shell::Pwsh);
        assert_eq!(shell_of("powershell"), Shell::Pwsh);
        assert_eq!(shell_of("CMD.EXE"), Shell::Cmd);
        assert_eq!(shell_of("wsl.exe"), Shell::Posix);
        assert_eq!(shell_of("/bin/zsh"), Shell::Posix);
    }

    #[test]
    fn view085_resume_is_argv_only_never_run_and_refuses_what_cannot_resume() {
        let root = tmp("resume");
        let dir = root.join("claude").join("projects").join("C--work-app");
        lines(&dir.join("s1.jsonl"), &[claude_user("do the thing", r"C:\work\app")]);
        lines(&dir.join("s0.jsonl"), &[json!({ "type": "summary", "summary": "nothing said" })]);
        let home = root.join("codex");
        let sid = "019a0000-0000-7000-8000-0000000000aa";
        codex_session(&home.join("sessions/2026/10/01").join(format!("rollout-2026-10-01T00-00-00-{sid}.jsonl")), sid, r"C:\work\app", Value::Null, Some("go"));
        let roots = Roots { claude: vec![root.join("claude")], codex: vec![home.clone()] };
        let settings = json!({ "agentOptions": { "claude": { "args": "--model opus" } } });
        let p = plan(&settings, &roots, "claude", "s1", Some(r"C:\work\app\ws\alpha"), Shell::Pwsh).unwrap();
        assert!(p.line.args.windows(2).any(|w| w == ["--resume", "s1"]), "{:?}", p.line.args);
        assert!(p.line.args.windows(2).any(|w| w == ["--model", "opus"]), "agent default arguments from settings are applied: {:?}", p.line.args);
        assert_eq!(p.cwd.as_deref(), Some(r"C:\work\app\ws\alpha"), "the session's own folder is gone, so the workspace given is used");
        assert!(p.copy.starts_with(r"Set-Location -LiteralPath 'C:\work\app\ws\alpha'; claude "), "{}", p.copy);
        assert_eq!(plan(&settings, &roots, "claude", "s1", None, Shell::Posix).unwrap().cwd.as_deref(), Some(r"C:\work\app"), "else the folder the session ran in");
        assert!(plan(&settings, &roots, "claude", "s0", None, Shell::Posix).unwrap_err().contains("no messages"), "no turns, no resume");
        assert!(plan(&settings, &roots, "claude", "../x", None, Shell::Posix).is_err(), "an id with a path in it is refused");
        assert!(plan(&settings, &roots, "claude", "gone", None, Shell::Posix).unwrap_err().contains("no longer"));
        assert!(plan(&settings, &roots, "aider", "s1", None, Shell::Posix).is_err(), "an agent with no resume-by-id form is refused");
        let here = root.join("elsewhere");
        fs::create_dir_all(&here).unwrap();
        lines(&dir.join("s2.jsonl"), &[claude_user("from another worktree", &here.to_string_lossy())]);
        let q = plan(&settings, &roots, "claude", "s2", Some(r"C:\work\app\ws\alpha"), Shell::Posix).unwrap();
        assert_eq!(q.cwd.as_deref(), Some(here.to_string_lossy().as_ref()), "a session whose folder exists opens there, not in the active workspace");
        let c = plan(&json!({}), &roots, "codex", sid, None, Shell::Posix).unwrap();
        assert_eq!(&c.line.args[c.line.args.len() - 2..], ["resume", sid]);
        assert!(c.line.env.contains(&("CODEX_HOME".to_string(), home.to_string_lossy().into_owned())), "Codex resumes against the home the session lives in: {:?}", c.line.env);
        assert!(c.copy.contains("CODEX_HOME="), "{}", c.copy);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fix1_a_listed_session_carries_no_file_path() {
        let e = Entry { agent: "claude".into(), id: "s".into(), title: "t".into(), modified_ms: 1, bytes: 2, turns: 3, dir: Some("C:/w".into()) };
        let json = serde_json::to_value(&e).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["agent", "bytes", "dir", "id", "modifiedMs", "title", "turns"]);
    }

    #[test]
    fn view089_codex_lookup_matches_the_whole_id_not_a_tail() {
        let home = tmp("exactid");
        let day = home.join("sessions/2026/10/01");
        let (long, short) = (day.join("rollout-2026-10-01T00-00-00-ab01.jsonl"), day.join("rollout-2026-10-01T00-00-01-b01.jsonl"));
        codex_session(&long, "ab01", r"C:\w", Value::Null, Some("long"));
        codex_session(&short, "b01", r"C:\w", Value::Null, Some("short"));
        let uuid = "019a0000-0000-7000-8000-000000000009";
        let by_uuid = day.join(format!("rollout-2026-10-01T00-00-02-{uuid}.jsonl"));
        codex_session(&by_uuid, uuid, r"C:\w", Value::Null, Some("uuid"));
        let roots = Roots { claude: vec![], codex: vec![home.clone()] };
        assert_eq!(find_session(&roots, "codex", "b01").map(|f| f.0), Some(short));
        assert_eq!(find_session(&roots, "codex", "ab01").map(|f| f.0), Some(long));
        assert!(find_session(&roots, "codex", "01").is_none(), "a tail of an id is not an id");
        assert!(find_session(&roots, "codex", "0000-7000-8000-000000000009").is_none(), "nor is the tail of a UUID");
        assert_eq!(find_session(&roots, "codex", uuid).map(|f| f.0), Some(by_uuid));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view089_two_codex_files_with_one_id_are_an_error_not_a_pick() {
        let home = tmp("dupid");
        for (d, t) in [("sessions/2026/10/01", "2026-10-01T00-00-00"), ("archived_sessions", "2026-10-02T00-00-00")] {
            codex_session(&home.join(d).join(format!("rollout-{t}-dup1.jsonl")), "dup1", r"C:\w", Value::Null, Some("x"));
        }
        let roots = Roots { claude: vec![], codex: vec![home.clone()] };
        assert!(find_session(&roots, "codex", "dup1").is_none());
        let err = find_session_exact(&roots, "codex", "dup1").unwrap_err();
        assert!(err.contains("More than one"), "{err}");
        let err = plan(&json!({}), &roots, "codex", "dup1", None, Shell::Pwsh).unwrap_err();
        assert!(err.contains("More than one"), "resume refuses too: {err}");
        let _ = fs::remove_dir_all(&home);
    }

    /// Row 897: release builds abort on panic, so a hostile transcript must never panic. Budget::none
    /// runs everything on this thread: a panic here fails the test instead of dying in a helper.
    #[test]
    fn row897_hostile_transcripts_never_panic_on_the_scan_thread() {
        let root = tmp("hostile");
        let claude_dir = root.join("projects").join("C--work-app");
        let archived = root.join("archived_sessions");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::create_dir_all(&archived).unwrap();
        let good = claude_user("hello", r"C:\work\app").to_string() + "\n";
        let mut claude: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("mid-line", good.as_bytes()[..good.len() - 9].to_vec()),
            ("bad-utf8", [b"{\"type\":\"user\",\"cwd\":\"C:\\\xff\xfe\xe2\x82\"}\n".as_slice(), &[0xC0, 0x80, 0xF8, b'\n']].concat()),
            ("nul-and-lone-quotes", b"\0\0\0\n\"\n{\n[[[[\n}}}}\n".to_vec()),
            ("deep", [vec![b'['; 100_000], vec![b'\n']].concat()),
            (
                "wrong-types",
                b"{\"type\":7,\"cwd\":[1],\"isSidechain\":\"yes\",\"message\":{\"content\":5}}\n{\"type\":\"user\",\"cwd\":{},\"message\":{\"content\":[1,null,{\"type\":\"text\",\"text\":9}]}}\n{\"type\":\"summary\",\"summary\":1e999}\n{\"type\":\"ai-title\",\"aiTitle\":null}\n[]\n\"str\"\n42\nnull\n".to_vec(),
            ),
        ];
        // A multibyte character straddling the head cap, the tail cap and the title cut.
        let straddle = |at: usize| {
            let mut v = good.clone().into_bytes();
            v.extend(" ".repeat(at - v.len() - 1).bytes());
            v.extend("\u{e9}\u{1f600}\n".bytes());
            v
        };
        claude.push(("head-cap-split", straddle(HEAD_CAP as usize)));
        claude.push(("tail-cap-split", straddle(HEAD_CAP as usize + 5000)));
        claude.push(("title-cut", (claude_user(&"\u{e9}\u{1f600}".repeat(TITLE_MAX * 3), r"C:\work\app").to_string() + "\n").into_bytes()));
        claude.push(("many-turns", good.repeat(20_000).into_bytes()));
        for (name, bytes) in &claude {
            fs::write(claude_dir.join(format!("{name}.jsonl")), bytes).unwrap();
        }
        // Codex: the same shapes, plus file names whose last 36 bytes cut a multibyte character.
        let meta = json!({ "type": "session_meta", "payload": { "cwd": 5, "source": "cli", "id": [] } }).to_string();
        let codex: Vec<(String, Vec<u8>)> = vec![
            ("empty".into(), vec![]),
            (
                "wrong-types".into(),
                format!("{meta}\n{{\"type\":\"event_msg\",\"payload\":\"x\"}}\n{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":7}}}}\n{{\"payload\":{{\"source\":{{\"subagent\":1}}}}}}\n").into_bytes(),
            ),
            ("bad-utf8".into(), b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"\xff\"}\n".to_vec()),
            (format!("{}a", "\u{e9}".repeat(20)), good.clone().into_bytes()),
            (format!("{}\u{1f600}", "b".repeat(37)), good.clone().into_bytes()),
            (format!("rollout-{}a", "\u{e9}".repeat(30)), good.clone().into_bytes()),
        ];
        for (name, bytes) in &codex {
            fs::write(archived.join(format!("{name}.jsonl")), bytes).unwrap();
        }
        fs::write(root.join("session_index.jsonl"), b"\xff{\"id\":1,\"thread_name\":[]}\n{\"id\":\"a\",\"thread_name\":\"t\"}\n\xe2\x82").unwrap();

        super::super::scan::SPAWNS.with(|n| n.set(0));
        let roots = Roots { claude: vec![root.clone()], codex: vec![root.clone()] };
        let mut cache = Cache::new();
        let got = list_scan(&roots, &Scope::All, &mut cache, None, &Budget::none());
        // Cached sizes and times at their extremes force a re-read.
        for entry in cache.values_mut() {
            entry.0 = u64::MAX;
            entry.1 = u64::MAX;
        }
        let again = list_scan(&roots, &Scope::All, &mut cache, None, &Budget::none());
        assert_eq!(super::super::scan::SPAWNS.with(|n| n.get()), 0, "everything ran on this thread");
        assert_eq!(got.sessions.len(), again.sessions.len());
        assert!(got.sessions.iter().any(|e| e.agent == "claude" && e.title == "hello"), "readable ones are still listed");
        // Direct calls with a size no file has, for every shape.
        for (name, _) in &claude {
            let f = claude_dir.join(format!("{name}.jsonl"));
            for len in [0, 1, HEAD_CAP + 1, u64::MAX] {
                let _ = summarize("claude", &f, len);
                let _ = summarize("codex", &f, len);
            }
            let _ = probe_file(("claude".into(), f, None));
        }
        let _ = summarize("claude", &root.join("no-such.jsonl"), u64::MAX);
        let hostile_stem = format!("rollout-{}", "\u{e9}".repeat(40));
        for cut in (0..hostile_stem.len()).filter(|c| hostile_stem.is_char_boundary(*c)) {
            let _ = rollout_id(&hostile_stem[..cut]);
        }
        let _ = rollout_id(&format!("rollout-a{}", "\u{e9}".repeat(20)));
        let _ = fs::remove_dir_all(&root);
    }
}
