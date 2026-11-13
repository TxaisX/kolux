//! CLI-036 / ORCH-021 / ORCH-020 (T-089-d): worker-read and worker-show's look at the pane.
//!
//! worker-read pages what a worker wrote: its own transcript (the file its pane's hooks reported,
//! read with the chat reader in `chat.rs`), else its terminal output (`terminal::Terminals::read`,
//! already plain text), labelled as a fallback, else the archive saved when it was released. A
//! cursor names the source that made it, so a read whose source changed asks for a fresh start.
//! Dispatch passes are hidden in every read (ORCH-067).
//!
//! Declared from cli.rs with `#[path]`, so the shared module list in lib.rs is untouched.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use serde_json::{json, Value};

use crate::chat::Item;
use super::Fail;
use crate::orchestration::{self as o, CLI};
use crate::terminal::Read;

/// CLI-036: a page holds 1 to 100 turns or lines; 20 when no --limit is given.
pub const MAX_LIMIT: usize = 100;
pub const DEFAULT_LIMIT: usize = 20;
/// ORCH-021: big reads are capped: a page stops once its text passes this many bytes, and one
/// turn's text is cut past `MAX_TURN` characters.
// ponytail: fixed caps; a --max-bytes flag if a coordinator ever needs whole long turns.
pub const MAX_PAGE_BYTES: usize = 64 * 1024;
pub const MAX_TURN: usize = 8_000;

/// Where a page came from. The cursor carries it, so a cursor from one source is never read
/// against another.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum From {
    Transcript,
    Terminal,
    Archive,
}

impl From {
    fn tag(self) -> &'static str {
        match self {
            From::Transcript => "tx",
            From::Terminal => "out",
            From::Archive => "arc",
        }
    }

    fn name(self) -> &'static str {
        match self {
            From::Transcript => "transcript",
            From::Terminal => "terminal output",
            From::Archive => "release archive",
        }
    }

    fn of_tag(tag: &str) -> Option<From> {
        [From::Transcript, From::Terminal, From::Archive].into_iter().find(|f| f.tag() == tag)
    }
}

/// What the caller asked for: `--source`, `--cursor`, `--limit`.
#[derive(Debug, PartialEq)]
pub struct Ask {
    pub source: &'static str,
    pub cursor: Option<(From, u64)>,
    pub limit: usize,
}

impl Ask {
    /// Reads the flags; a bad value is refused before anything is read.
    pub fn from_args(a: &Value) -> Result<Ask, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
        let source = match text("source").unwrap_or("auto") {
            "auto" => "auto",
            "transcript" => "transcript",
            "terminal" => "terminal",
            other => return Err(Fail::args(format!("--source takes auto, transcript or terminal, not `{other}`"))),
        };
        let limit = match text("limit") {
            None => DEFAULT_LIMIT,
            Some(v) => v.parse::<usize>().ok().filter(|n| (1..=MAX_LIMIT).contains(n)).ok_or_else(|| Fail::args(format!("--limit takes a whole number from 1 to {MAX_LIMIT}, not `{v}`")))?,
        };
        let cursor = match text("cursor") {
            None => None,
            Some(c) => Some(parse_cursor(c).ok_or_else(|| Fail::args(format!("`{c}` is not a worker-read cursor; pass back the cursor a worker-read printed, or leave --cursor out to start again")))?),
        };
        Ok(Ask { source, cursor, limit })
    }
}

fn cursor_of(from: From, n: u64) -> String {
    format!("{}.{n}", from.tag())
}

fn parse_cursor(c: &str) -> Option<(From, u64)> {
    let (tag, n) = c.split_once('.')?;
    Some((From::of_tag(tag)?, n.parse().ok()?))
}

/// The worker as this read sees it. `live` says its terminal is still open; `hook` is the state
/// its pane's own hooks report (none when no hook reports for it).
pub struct Worker<'a> {
    pub d: &'a Value,
    pub live: bool,
    pub hook: Option<&'a str>,
    pub passes: &'a [String],
}

/// ORCH-021 / CLI-036: one page of what the worker wrote. `transcript` gives the worker's own
/// transcript turns (none when no transcript provably its own was found), `terminal` its output
/// after a cursor, `archive` the lines saved at release.
pub fn read(w: &Worker, ask: &Ask, transcript: impl FnOnce() -> Option<Vec<Item>>, terminal: impl FnOnce(Option<u64>, usize) -> Option<Read>, archive: impl FnOnce(&Path) -> Option<Vec<String>>) -> Result<Value, Fail> {
    let d = w.d;
    let id = d["id"].as_str().unwrap_or_default().to_string();
    let released = d["released"] == true;
    let saved = d["archive"].as_str().filter(|p| !p.is_empty()).map(PathBuf::from);
    let handle = o::terminal_of(d);
    let mut notes: Vec<String> = Vec::new();
    // Which source answers. A worker with no terminal is turned away only when terminal output is
    // asked for by name; the automatic and transcript sources always answer.
    let mut items = None;
    let from = match ask.source {
        "transcript" => {
            items = transcript();
            From::Transcript
        }
        "terminal" if released && saved.is_some() => From::Archive,
        "terminal" if handle.is_none() => {
            o::terminal_for(std::slice::from_ref(d), &id)?;
            return Err(Fail::new("no_terminal", format!("{id} has no terminal output to read")));
        }
        "terminal" if !w.live => {
            return Err(Fail::new("not_found", format!("{id}'s terminal has ended and nothing was archived from it; read it with {CLI} orchestration worker-read --dispatch {id} --source transcript")));
        }
        "terminal" => From::Terminal,
        _ => {
            items = transcript();
            match items {
                Some(_) => From::Transcript,
                None if released && saved.is_some() => {
                    notes.push(format!("no transcript that belongs to {id}'s own session was found, so this is the output archived when it was released"));
                    From::Archive
                }
                None if w.live => {
                    notes.push(format!("no transcript that belongs to {id}'s own session was found, so this is its terminal output instead (a fallback)"));
                    From::Terminal
                }
                None => From::Transcript,
            }
        }
    };
    if let Some((was, _)) = ask.cursor.filter(|(was, _)| *was != from) {
        return Err(Fail::new(
            "cursor_mismatch",
            format!("that cursor belongs to {id}'s {}, but this read comes from its {}: the source changed, so start again without --cursor", was.name(), from.name()),
        ));
    }
    let after = ask.cursor.map(|(_, n)| n);
    let mut out = json!({ "dispatchId": id, "source": from.name(), "fallback": ask.source == "auto" && from != From::Transcript, "released": released, "process": process(handle.as_deref(), w.live, released), "agentState": agent_state(d, w.hook) });
    match from {
        From::Transcript => {
            match items {
                Some(all) => {
                    let (page, end, more) = page_turns(&all, after, ask.limit);
                    out["turns"] = Value::Array(page);
                    out["cursor"] = json!(cursor_of(From::Transcript, end));
                    out["more"] = json!(more);
                }
                None => {
                    notes.push(format!("no transcript that belongs to {id}'s own session was found yet (an agent without a transcript reader, or none written so far); nothing to read"));
                    out["turns"] = json!([]);
                    out["cursor"] = Value::Null;
                    out["more"] = json!(false);
                }
            }
        }
        From::Terminal => {
            let r = terminal(after, ask.limit).ok_or_else(|| Fail::new("not_found", format!("{id}'s terminal is gone")))?;
            if r.dropped {
                notes.push(format!("only part of the output is kept: lines before cursor {} are gone", r.oldest));
            }
            let lines: Vec<Value> = r.lines.iter().map(|l| json!({ "cursor": l.cursor, "text": l.text })).collect();
            out["lines"] = Value::Array(lines);
            out["pending"] = json!(r.pending);
            out["cursor"] = json!(cursor_of(From::Terminal, r.cursor));
            out["more"] = json!(r.more);
        }
        From::Archive => {
            let path = saved.unwrap_or_default();
            let all = archive(&path).ok_or_else(|| Fail::new("not_found", format!("{id} was released but its archive at {} cannot be read", path.display())))?;
            let (page, end, more) = page_lines(&all, after, ask.limit);
            notes.push(format!("{id} was released: this is the archive saved at {}, not a live worker", path.display()));
            out["archive"] = json!(path.to_string_lossy());
            out["lines"] = Value::Array(page);
            out["cursor"] = json!(cursor_of(From::Archive, end));
            out["more"] = json!(more);
        }
    }
    out["warnings"] = json!(notes);
    o::redact_read(&mut out, w.passes);
    Ok(out)
}

/// The verdict on the terminal process, kept apart from the agent's (CLI-036).
fn process(handle: Option<&str>, live: bool, released: bool) -> &'static str {
    match (handle, live) {
        _ if released => "released",
        (None, _) => "none",
        (Some(_), true) => "running",
        (Some(_), false) => "ended",
    }
}

/// The verdict on the agent: what its hooks say, else whether it ended before reporting, else
/// unknown.
fn agent_state(d: &Value, hook: Option<&str>) -> String {
    match hook {
        Some(s) => s.to_string(),
        None if !d["exitedAt"].is_null() => "exited".to_string(),
        None => "unknown".to_string(),
    }
}

fn cut(text: &str) -> String {
    match text.char_indices().nth(MAX_TURN) {
        Some((i, _)) => format!("{}\n[Kolux: cut here; the turn goes on for {} more characters]", &text[..i], text[i..].chars().count()),
        None => text.to_string(),
    }
}

/// A page of turns: the newest `limit` without a cursor, else the ones after it, stopping once
/// the page passes `MAX_PAGE_BYTES` (always at least one). Returns the page, the cursor to read
/// on from, and whether more follow.
fn page_turns(all: &[Item], after: Option<u64>, limit: usize) -> (Vec<Value>, u64, bool) {
    let start = match after {
        Some(n) => (n as usize).min(all.len()),
        None => all.len().saturating_sub(limit),
    };
    let mut page = Vec::new();
    let mut bytes = 0;
    let mut end = start;
    for item in all[start..].iter().take(limit) {
        if !page.is_empty() && bytes >= MAX_PAGE_BYTES {
            break;
        }
        let mut v = json!({ "id": item.id, "role": item.role, "kind": item.kind, "text": cut(&item.text), "at": item.at });
        if let Some(t) = &item.tool {
            v["tool"] = serde_json::to_value(t).unwrap_or_default();
        }
        if !item.images.is_empty() {
            v["images"] = json!(item.images.len());
        }
        bytes += v.to_string().len();
        page.push(v);
        end += 1;
    }
    (page, end as u64, end < all.len())
}

/// A page of archive lines, numbered from 1, paged the same way.
fn page_lines(all: &[String], after: Option<u64>, limit: usize) -> (Vec<Value>, u64, bool) {
    let start = match after {
        Some(n) => (n as usize).min(all.len()),
        None => all.len().saturating_sub(limit),
    };
    let end = (start + limit).min(all.len());
    let page = all[start..end].iter().enumerate().map(|(i, t)| json!({ "cursor": start + i + 1, "text": t })).collect();
    (page, end as u64, end < all.len())
}

/// ORCH-021: the transcript that provably belongs to the worker's own session: the one the hooks
/// of a pane in its own terminal reported.
pub fn own_transcript(terminal: u32) -> Option<PathBuf> {
    crate::status::panes_of(terminal).into_iter().filter_map(crate::status::transcript_of).map(PathBuf::from).find(|p| p.is_file())
}

/// Row 625: the transcript kept on the dispatch row while the pane's hooks still reported it; what
/// worker-read falls back to once the terminal has ended and its hook sessions are gone.
pub fn kept_transcript(d: &Value) -> Option<PathBuf> {
    d["transcript"].as_str().map(PathBuf::from).filter(|p| p.is_file())
}

/// The turns of `path`, read with the chat reader for `agent`'s format (Claude, Codex, omp). An
/// agent with no transcript reader (Gemini; Grok until its reader exists) gives none, so the read
/// falls back to the terminal.
pub fn transcript_items(agent: Option<&str>, path: &Path, alive: bool) -> Option<Vec<Item>> {
    let agent = crate::chat::chat_agent(agent)?;
    let now = Instant::now();
    let mut follow = crate::chat::Follow::new(agent, String::new(), Vec::new(), SystemTime::UNIX_EPOCH, now);
    let r = follow.poll(now, Some(path.to_path_buf()), alive, false);
    (r.state == "ready" || r.state == "empty").then_some(r.items)
}

/// The lines of a release archive.
pub fn archive_lines(path: &Path) -> Option<Vec<String>> {
    std::fs::read_to_string(path).ok().map(|t| t.lines().map(str::to_string).collect())
}

/// ORCH-020 / CLI-036: worker-show's waiting field after Kolux looked at the pane. `looked` says a
/// hook state or the pane's newest output was there to read; `hook` is the pane's own hook state.
/// A "yes" names its source; an "unknown" on an open terminal that Kolux did look at becomes an
/// explicit "no" (a long tool call reads working, so the field stays empty rather than guessing).
pub fn settle_waiting(shown: &mut Value, open: bool, looked: bool, hook: Option<&str>) {
    let from_hook = matches!(hook, Some("permission" | "waiting"));
    match shown["waiting"].as_str() {
        Some("yes") => shown["waitingSource"] = json!(if from_hook { "hook" } else { "prompt text" }),
        Some("unknown") if open && looked => {
            let (why, source) = match hook {
                Some(s) => (format!("its agent's hooks report it {s}, so nothing waits on a person"), "hook"),
                None => ("Kolux read its screen and found no open prompt".to_string(), "prompt text"),
            };
            shown["waiting"] = json!("no");
            shown["waitingWhy"] = json!(why);
            shown["waitingSource"] = json!(source);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::OutputLog;

    fn claude_transcript(dir: &Path, turns: usize) -> PathBuf {
        let mut text = String::new();
        for i in 0..turns {
            let (role, body) = if i % 2 == 0 { ("user", format!("question {i}")) } else { ("assistant", format!("answer {i}")) };
            let content = if role == "user" { json!(body) } else { json!([{ "type": "text", "text": body }]) };
            text.push_str(&json!({ "type": role, "uuid": format!("u{i}"), "timestamp": "2026-10-20T10:00:00Z", "isSidechain": false, "message": { "id": format!("m{i}"), "role": role, "content": content } }).to_string());
            text.push('\n');
        }
        let p = dir.join("session.jsonl");
        std::fs::write(&p, text).unwrap();
        p
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-worker-read-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ask(a: Value) -> Ask {
        Ask::from_args(&a).unwrap()
    }

    fn row(extra: Value) -> Value {
        let mut d = json!({ "id": "dispatch-3", "runId": "run-1", "status": "running", "terminal": 7, "runtime": std::process::id(), "agent": "claude" });
        for (k, v) in extra.as_object().unwrap() {
            d[k] = v.clone();
        }
        d
    }

    fn texts(v: &Value, key: &str) -> Vec<String> {
        v[key].as_array().unwrap().iter().map(|t| t["text"].as_str().unwrap().to_string()).collect()
    }

    /// ORCH-021 acceptance 1 with a fixture transcript: a Claude worker's read gives its newest
    /// turns from the transcript; handing back the cursor gives only newer turns.
    #[test]
    fn orch021_transcript_turns_then_only_newer_ones_with_the_cursor() {
        let dir = scratch("tx");
        let path = claude_transcript(&dir, 6);
        let d = row(json!({}));
        let w = Worker { d: &d, live: true, hook: Some("working"), passes: &[] };
        let items = || transcript_items(Some("claude"), &path, true);
        let first = read(&w, &ask(json!({ "limit": "4" })), items, |_, _| panic!("no terminal read when a transcript exists"), |_| None).unwrap();
        assert_eq!((first["source"].as_str(), first["fallback"].as_bool()), (Some("transcript"), Some(false)));
        assert_eq!(texts(&first, "turns"), ["question 2", "answer 3", "question 4", "answer 5"]);
        assert_eq!((first["process"].as_str(), first["agentState"].as_str()), (Some("running"), Some("working")), "the terminal's verdict and the agent's stay apart");
        let cursor = first["cursor"].as_str().unwrap().to_string();
        // Two more turns are written; the cursor gives only those.
        let mut more = std::fs::read_to_string(&path).unwrap();
        more.push_str(&json!({ "type": "user", "uuid": "u6", "isSidechain": false, "message": { "id": "m6", "role": "user", "content": "question 6" } }).to_string());
        more.push('\n');
        std::fs::write(&path, more).unwrap();
        let next = read(&w, &ask(json!({ "cursor": cursor })), || transcript_items(Some("claude"), &path, true), |_, _| None, |_| None).unwrap();
        assert_eq!(texts(&next, "turns"), ["question 6"]);
        assert_eq!(next["more"], false);
        // From the start: a page of two says more follow.
        let paged = read(&w, &ask(json!({ "cursor": "tx.0", "limit": "2" })), || transcript_items(Some("claude"), &path, true), |_, _| None, |_| None).unwrap();
        assert_eq!((texts(&paged, "turns"), paged["more"].as_bool(), paged["cursor"].as_str()), (vec!["question 0".to_string(), "answer 1".to_string()], Some(true), Some("tx.2")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ORCH-021 acceptance 2: a worker with no transcript reader (a Gemini stand-in) reads its
    /// terminal output on the automatic source, labelled as terminal output and as a fallback,
    /// plain text with accents and emoji kept; its cursor is refused against the transcript.
    #[test]
    fn orch021_no_transcript_falls_back_to_terminal_output_labelled_as_such() {
        let d = row(json!({ "agent": "gemini" }));
        let w = Worker { d: &d, live: true, hook: None, passes: &[] };
        let mut log = OutputLog::default();
        log.push("\x1b[32mcafé ✓ 🚀\x1b[0m\r\nline two\r\n".as_bytes());
        let items = || transcript_items(Some("gemini"), Path::new("G:/nowhere.jsonl"), true);
        let r = read(&w, &ask(json!({})), items, |after, limit| Some(log.read(after, Some(limit))), |_| None).unwrap();
        assert_eq!((r["source"].as_str(), r["fallback"].as_bool()), (Some("terminal output"), Some(true)));
        assert_eq!(texts(&r, "lines"), ["café ✓ 🚀", "line two"]);
        assert!(r["warnings"][0].as_str().unwrap().contains("this is its terminal output instead (a fallback)"), "{}", r["warnings"]);
        assert_eq!(r["agentState"], "unknown");
        let wrong = read(&w, &ask(json!({ "cursor": r["cursor"], "source": "transcript" })), || None, |_, _| None, |_| None).unwrap_err();
        assert_eq!(wrong.code, "cursor_mismatch");
        assert!(wrong.message.contains("the source changed, so start again without --cursor"), "{}", wrong.message);
    }

    /// CLI-036 acceptance 2: a released worker's read says it is the archive, not a live worker,
    /// and pages it; the terminal source reads the archive too. Passes are hidden in every read.
    #[test]
    fn cli036_a_released_worker_reads_as_its_archive() {
        let dir = scratch("arc");
        let path = dir.join("dispatch-3.txt");
        std::fs::write(&path, "one\ntwo pass-SECRET\nthree\n").unwrap();
        let d = row(json!({ "released": true, "archive": path.to_string_lossy(), "status": "completed" }));
        let passes = vec!["pass-SECRET".to_string()];
        let w = Worker { d: &d, live: false, hook: None, passes: &passes };
        let r = read(&w, &ask(json!({})), || None, |_, _| panic!("a released worker is never read live"), archive_lines).unwrap();
        assert_eq!((r["source"].as_str(), r["released"].as_bool(), r["process"].as_str()), (Some("release archive"), Some(true), Some("released")));
        assert!(r["warnings"].to_string().contains("was released: this is the archive saved at"), "{}", r["warnings"]);
        assert_eq!(texts(&r, "lines")[1], format!("two {}", crate::orchestration::PASS_HIDDEN));
        assert!(r["warnings"].to_string().contains("a dispatch pass was hidden"), "{}", r["warnings"]);
        let by_name = read(&w, &ask(json!({ "source": "terminal", "cursor": "arc.2" })), || None, |_, _| None, archive_lines).unwrap();
        assert_eq!(texts(&by_name, "lines"), ["three"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CLI-036: a worker with no terminal: the terminal source is refused by name with the way to
    /// read it; the transcript and automatic sources still answer (empty, saying why).
    #[test]
    fn cli036_no_terminal_refuses_terminal_output_but_transcript_always_answers() {
        let d = row(json!({ "terminal": null }));
        let w = Worker { d: &d, live: false, hook: None, passes: &[] };
        let no = read(&w, &ask(json!({ "source": "terminal" })), || None, |_, _| None, |_| None).unwrap_err();
        assert_eq!(no.code, "no_terminal");
        assert!(no.message.contains("worker-read --dispatch dispatch-3 --source transcript"), "{}", no.message);
        for source in ["transcript", "auto"] {
            let r = read(&w, &ask(json!({ "source": source })), || None, |_, _| None, |_| None).unwrap();
            assert_eq!((r["turns"].as_array().map(Vec::len), r["process"].as_str()), (Some(0), Some("none")), "{source}");
        }
    }

    /// Bad flags are refused before anything is read.
    #[test]
    fn cli036_bad_source_limit_and_cursor_are_refused() {
        assert!(Ask::from_args(&json!({ "source": "screen" })).unwrap_err().message.contains("auto, transcript or terminal"));
        assert!(Ask::from_args(&json!({ "limit": "0" })).unwrap_err().message.contains("1 to 100"));
        assert!(Ask::from_args(&json!({ "limit": "101" })).is_err());
        assert!(Ask::from_args(&json!({ "cursor": "12" })).unwrap_err().message.contains("not a worker-read cursor"));
        assert_eq!(ask(json!({ "cursor": "out.12" })).cursor, Some((From::Terminal, 12)));
    }

    /// ORCH-021: big reads are capped: one long turn is cut and says by how much.
    #[test]
    fn orch021_a_long_turn_is_cut() {
        let long = "x".repeat(MAX_TURN + 5);
        assert!(cut(&long).ends_with("[Kolux: cut here; the turn goes on for 5 more characters]"));
        assert_eq!(cut("short"), "short");
    }

    /// ORCH-020 with stand-in hook state: a permission hook makes "yes" from the hook; a working
    /// hook (a long tool call) is an explicit "no"; a pane read with no prompt is "no" from the
    /// prompt text; a pane Kolux could not look at stays unknown.
    #[test]
    fn orch020_waiting_names_its_source_and_says_no_only_after_looking() {
        let unknown = || json!({ "waiting": "unknown", "waitingWhy": "x" });
        let mut yes = json!({ "waiting": "yes" });
        settle_waiting(&mut yes, true, true, Some("permission"));
        assert_eq!(yes["waitingSource"], "hook");
        let mut scanned = json!({ "waiting": "yes" });
        settle_waiting(&mut scanned, true, true, None);
        assert_eq!(scanned["waitingSource"], "prompt text");
        let mut working = unknown();
        settle_waiting(&mut working, true, true, Some("working"));
        assert_eq!((working["waiting"].as_str(), working["waitingSource"].as_str()), (Some("no"), Some("hook")));
        let mut quiet = unknown();
        settle_waiting(&mut quiet, true, true, None);
        assert_eq!((quiet["waiting"].as_str(), quiet["waitingWhy"].as_str()), (Some("no"), Some("Kolux read its screen and found no open prompt")));
        let mut blind = unknown();
        settle_waiting(&mut blind, true, false, None);
        assert_eq!(blind["waiting"], "unknown");
        let mut closed = unknown();
        settle_waiting(&mut closed, false, true, None);
        assert_eq!(closed["waiting"], "unknown");
    }
}
