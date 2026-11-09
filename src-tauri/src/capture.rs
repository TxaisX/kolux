//! SKILL-035: pages Claude publishes through its Artifact tool are kept in the Artifacts library.
//! Claude Code writes each session's transcript as JSON lines under its config folder's
//! `projects` folder. A watcher reads the lines added to them and stores each page whose publish
//! succeeded, with the session's folder and id. Only the Artifact tool's own results count, so
//! prose and other tools' output that looks like a publish are never picked up.

use crate::artifacts::{self, Library, Origin};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, Manager};

/// Sent to the window when the library changed behind its back.
pub const EVENT: &str = "artifacts-changed";
const POLL: Duration = Duration::from_secs(2);
/// A publish older than the watcher by more than this is history replayed into a resumed or
/// copied session, not a new publish.
const REPLAY_SLACK_MS: u64 = 60_000;

#[derive(Debug, PartialEq)]
pub struct Publish {
    pub url: String,
    pub path: String,
    pub cwd: Option<String>,
    pub session: Option<String>,
    pub at: Option<u64>,
}

/// What a tool call will produce: a page Claude published, or a file it wrote. A call and its
/// result are separate transcript lines, so the call's id is held until the result arrives.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Call {
    Publish,
    Write,
}

fn text<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn is_artifact_url(url: &str) -> bool {
    url.starts_with("https://claude.ai/artifact/") || url.starts_with("https://claude.ai/code/artifact/")
}

fn is_html(path: &str) -> bool {
    let low = path.to_ascii_lowercase();
    low.ends_with(".html") || low.ends_with(".htm")
}

/// A folder whose files are the working copy of something (dependencies, build output, caches),
/// never a deliverable: a write there is not kept.
const NOISE: [&str; 12] = ["\\node_modules\\", "\\target\\", "\\dist\\", "\\build\\", "\\.git\\", "\\.next\\", "\\.venv\\", "\\__pycache__\\", "\\vendor\\", "\\.cache\\", "\\out\\", "\\.turbo\\"];

/// Whether a file an agent wrote is an artifact worth keeping: a full path, of a kept type, and
/// not inside a working-copy folder.
pub fn is_kept(path: &str) -> bool {
    if !Path::new(path).is_absolute() {
        return false;
    }
    let ext = Path::new(path).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !artifacts::KEPT.contains(&ext.as_str()) {
        return false;
    }
    let low = format!("{}\\", path.replace('/', "\\").to_ascii_lowercase());
    !NOISE.iter().any(|n| low.contains(n))
}

/// The publishes and kept files in a run of transcript lines. `calls` carries the tool calls seen
/// so far in the same transcript, since a call and its result are separate lines.
pub fn scan(lines: &str, calls: &mut HashMap<String, Call>) -> Vec<Publish> {
    let mut out = Vec::new();
    for line in lines.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(parts) = v.pointer("/message/content").and_then(|c| c.as_array()) else { continue };
        for p in parts {
            match text(p, "type") {
                Some("tool_use") => {
                    let Some(id) = text(p, "id") else { continue };
                    let input = &p["input"];
                    match text(p, "name") {
                        Some("Artifact") => {
                            let publish = text(input, "file_path").is_some_and(is_html)
                                && input.get("asset").and_then(|a| a.as_bool()) != Some(true)
                                && text(input, "action").is_none_or(|a| a == "publish");
                            if publish {
                                calls.insert(id.to_string(), Call::Publish);
                            }
                        }
                        // A file the agent creates is an artifact too: a screenshot, a report, a
                        // document. Edits to an existing file are not, and neither is anything the
                        // call does not name a path for.
                        Some("Write") if text(input, "file_path").is_some_and(is_kept) => {
                            calls.insert(id.to_string(), Call::Write);
                        }
                        _ => {}
                    }
                }
                Some("tool_result") => {
                    let Some(id) = text(p, "tool_use_id") else { continue };
                    let Some(call) = calls.remove(id) else { continue };
                    if p.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                        continue;
                    }
                    let r = &v["toolUseResult"];
                    let at = text(&v, "timestamp").and_then(parse_time);
                    let cwd = text(&v, "cwd").map(Into::into);
                    let session = text(&v, "sessionId").map(Into::into);
                    match call {
                        Call::Publish => {
                            let (Some(url), Some(path)) = (text(r, "url"), text(r, "path")) else { continue };
                            if is_artifact_url(url) && is_html(path) {
                                out.push(Publish { url: url.into(), path: path.into(), cwd, session, at });
                            }
                        }
                        Call::Write => {
                            // The result names the file it wrote; the path is the entry's origin,
                            // so writing the same file again refreshes it.
                            let Some(path) = text(r, "filePath").or_else(|| text(r, "file_path")) else { continue };
                            if is_kept(path) {
                                out.push(Publish { url: path.into(), path: path.into(), cwd, session, at });
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Milliseconds since 1970 from a UTC time such as 2026-09-24T09:56:01.421Z.
/// ponytail: offsets other than Z are read as UTC; Claude Code writes Z.
pub fn parse_time(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let frac: String = if b.get(19) == Some(&b'.') { s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect() } else { String::new() };
    let ms: i64 = format!("{frac:0<3}").parse().ok()?;
    // Days from the civil date (the well-known era / day-of-era method).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from((((days * 24 + hh) * 60 + mm) * 60 + ss) * 1000 + ms).ok()
}

/// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else .claude in the home folder.
pub fn claude_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(d.into());
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|h| PathBuf::from(h).join(".claude"))
}

/// A transcript found in a folder listing, with the size and change time the listing gave. On
/// Windows the listing carries them, so no file is opened to learn them.
struct Found {
    path: PathBuf,
    len: u64,
    at: Option<SystemTime>,
}

/// A folder's entries; a folder that could not be listed whole clears `whole` (one that is not
/// there is listed whole: it has nothing in it).
fn list(dir: &Path, whole: &mut bool) -> Vec<fs::DirEntry> {
    match fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(|e| e.map_err(|_| *whole = false).ok()).collect(),
        Err(e) => {
            *whole &= e.kind() == std::io::ErrorKind::NotFound;
            Vec::new()
        }
    }
}

fn found(e: &fs::DirEntry, path: PathBuf, out: &mut Vec<Found>, whole: &mut bool) {
    match e.metadata() {
        Ok(m) => out.push(Found { path, len: m.len(), at: m.modified().ok() }),
        Err(_) => *whole = false,
    }
}

/// Every session transcript: projects/<folder>/<session>.jsonl and the subagents' beside them,
/// into `out` (emptied first, its room kept). False when a folder could not be listed whole, so a
/// transcript missing from `out` may still be there.
fn transcripts(root: &Path, out: &mut Vec<Found>) -> bool {
    let jsonl = |p: &Path| p.extension().is_some_and(|e| e == "jsonl");
    let mut whole = true;
    out.clear();
    for project in list(root, &mut whole) {
        if !project.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        for e in list(&project.path(), &mut whole) {
            let p = e.path();
            if jsonl(&p) {
                found(&e, p, out, &mut whole);
            } else if e.file_type().is_ok_and(|t| t.is_dir()) {
                for s in list(&p.join("subagents"), &mut whole) {
                    let sp = s.path();
                    if jsonl(&sp) {
                        found(&s, sp, out, &mut whole);
                    }
                }
            }
        }
    }
    whole
}

fn read_span(path: &Path, from: u64, to: u64) -> Option<Vec<u8>> {
    let mut f = fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.take(to - from).read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// A file counts as busy for this long after it last changed: its size is asked for on every poll.
const HOT: Duration = Duration::from_secs(10 * 60);
/// Every this often each transcript's size is asked for, busy or not: a folder listing can lag
/// behind a file a writer holds open, so a quiet file that grows is still caught within this.
const SWEEP: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Seen {
    offset: u64,
    calls: HashMap<String, Call>,
    /// The size and change time the folder listing gave at the last poll.
    listed: (u64, Option<SystemTime>),
    /// When the file was last seen to change.
    changed: Option<Instant>,
    /// The poll that last listed the file; one no poll lists any more is let go.
    poll: u64,
}

/// What the watcher knows between polls.
#[derive(Default)]
struct Watch {
    seen: HashMap<PathBuf, Seen>,
    polls: u64,
    swept: Option<Instant>,
    found: Vec<Found>,
}

impl Watch {
    /// One poll at `now` (wall clock `wall`): the publishes added to the transcripts since the last
    /// one. `size` asks one file for its size; it is asked only of a file that changed in the last
    /// `HOT`, is new, or whose listing changed, and of every file each `SWEEP`. A file there at the
    /// first poll is read from its end then, so what was published before Kolux started is not
    /// replayed.
    fn poll(&mut self, root: &Path, now: Instant, wall: SystemTime, size: &mut dyn FnMut(&Path) -> Option<u64>) -> Vec<Publish> {
        let first = self.polls == 0;
        self.polls += 1;
        let sweep = self.swept.is_none_or(|t| now.saturating_duration_since(t) >= SWEEP);
        if sweep {
            self.swept = Some(now);
        }
        let mut found = std::mem::take(&mut self.found);
        let whole = transcripts(root, &mut found);
        let mut out = Vec::new();
        for f in found.drain(..) {
            let mut fresh = false;
            let s = if let Some(s) = self.seen.get_mut(&f.path) {
                s
            } else {
                fresh = true;
                self.seen.entry(f.path.clone()).or_default()
            };
            s.poll = self.polls;
            let listed = (f.len, f.at);
            let recent = f.at.is_none_or(|m| wall.duration_since(m).map_or(true, |d| d < HOT)) || s.changed.is_some_and(|t| now.saturating_duration_since(t) < HOT);
            let ask = sweep || fresh || recent || listed != s.listed;
            s.listed = listed;
            if !ask {
                continue;
            }
            let Some(len) = size(&f.path) else { continue };
            if fresh && first {
                s.offset = len;
            }
            if len < s.offset {
                // rewritten from the start
                (s.offset, s.calls) = (0, HashMap::new());
            }
            if len == s.offset {
                continue;
            }
            s.changed = Some(now);
            let Some(bytes) = read_span(&f.path, s.offset, len) else { continue };
            let Some(cut) = bytes.iter().rposition(|&c| c == b'\n') else { continue }; // a line still being written
            s.offset += cut as u64 + 1;
            out.extend(scan(&String::from_utf8_lossy(&bytes[..cut]), &mut s.calls));
        }
        self.found = found;
        if whole {
            let polls = self.polls;
            self.seen.retain(|_, s| s.poll == polls);
        }
        out
    }
}

/// Watches the transcripts from now on: files already there are read from their current end, so
/// publishes made before Kolux started are not replayed.
/// ponytail: polls every 2 s, and a call made before start whose result lands after it is missed.
/// A file quiet for 10 minutes whose growth the folder listing does not show yet is caught by the
/// 30 s sweep instead (DT-C row "transcript polling asks only busy files").
pub fn start(app: tauri::AppHandle) {
    let Some(root) = claude_dir().map(|d| d.join("projects")) else { return };
    std::thread::spawn(move || {
        let started = artifacts::now_ms();
        let mut watch = Watch::default();
        loop {
            for p in watch.poll(&root, Instant::now(), SystemTime::now(), &mut |f| fs::metadata(f).ok().map(|m| m.len())) {
                keep(&app, p, started);
            }
            std::thread::sleep(POLL);
        }
    });
}

fn keep(app: &tauri::AppHandle, p: Publish, started: u64) {
    let at = p.at.unwrap_or_else(artifacts::now_ms);
    if at + REPLAY_SLACK_MS < started {
        return;
    }
    let project = p.cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned());
    let from = Origin { origin: p.url, source: "claude", project, session: p.session, at };
    match app.state::<Library>().add(Path::new(&p.path), from, &|u| artifacts::fetch_script(app, u)) {
        Ok(_) => {
            let _ = app.emit(EVENT, ());
        }
        Err(e) => eprintln!("artifacts: could not keep {}: {e}", p.path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn line(v: serde_json::Value) -> String {
        v.to_string() + "\n"
    }

    fn call(id: &str, name: &str, input: serde_json::Value) -> String {
        line(serde_json::json!({"type": "assistant", "sessionId": "s-1", "cwd": "G:\\Dev\\repo", "message": {"content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}}))
    }

    fn result(id: &str, url: &str, path: &str, error: bool) -> String {
        line(serde_json::json!({"type": "user", "sessionId": "s-1", "cwd": "G:\\Dev\\repo", "timestamp": "2026-09-24T09:56:01.421Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": id, "is_error": error, "content": format!("Published {path} at {url} (Version 1)")}]},
            "toolUseResult": {"url": url, "path": path, "title": "T"}}))
    }

    #[test]
    fn only_successful_artifact_publishes_are_picked_up() {
        let url = "https://claude.ai/artifact/RtHRJW2CNxVSVEfdBezseR";
        let page = "G:\\Temp\\page.html";
        let mut t = String::new();
        t += &call("a", "Artifact", serde_json::json!({"file_path": page}));
        t += &result("a", url, page, false);
        // Another tool's result that looks the same, a failed publish, an asset upload, a read,
        // a Markdown page, and prose that mentions a publish: none count.
        t += &call("b", "Bash", serde_json::json!({"command": "echo"}));
        t += &result("b", url, page, false);
        t += &call("c", "Artifact", serde_json::json!({"file_path": page}));
        t += &result("c", url, page, true);
        t += &call("d", "Artifact", serde_json::json!({"file_path": "G:\\Temp\\a.png", "asset": true, "url": url}));
        t += &result("d", url, "G:\\Temp\\a.png", false);
        t += &call("e", "Artifact", serde_json::json!({"action": "read", "url": url}));
        t += &result("e", url, page, false);
        t += &call("f", "Artifact", serde_json::json!({"file_path": "G:\\Temp\\notes.md"}));
        t += &result("f", url, "G:\\Temp\\notes.md", false);
        t += &line(serde_json::json!({"type": "assistant", "message": {"content": [{"type": "text", "text": format!("Published {page} at {url}")}]}}));
        t += "not json\n";
        let mut calls = HashMap::new();
        let got = scan(&t, &mut calls);
        assert_eq!(got, [Publish { url: url.into(), path: page.into(), cwd: Some("G:\\Dev\\repo".into()), session: Some("s-1".into()), at: Some(1_790_243_761_421) }]);
        // A call in one read and its result in the next still pair up.
        let mut calls = HashMap::new();
        assert!(scan(&call("g", "Artifact", serde_json::json!({"file_path": page, "action": "publish"})), &mut calls).is_empty());
        assert_eq!(scan(&result("g", url, page, false), &mut calls).len(), 1);
    }

    fn wrote(id: &str, path: &str, error: bool) -> String {
        line(serde_json::json!({"type": "user", "sessionId": "s-2", "cwd": "G:\\Dev\\minecraft", "timestamp": "2026-10-31T08:00:00.000Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": id, "is_error": error, "content": format!("File created successfully at: {path}")}]},
            "toolUseResult": {"type": "create", "filePath": path, "content": ""}}))
    }

    #[test]
    fn files_an_agent_creates_are_kept_and_source_is_not() {
        let root = std::env::temp_dir().join("krs-capture-minecraft");
        let at = |n: &str| root.join(n).to_string_lossy().into_owned();
        let png = at("shot.png");
        let mut t = String::new();
        t += &call("w1", "Write", serde_json::json!({"file_path": png, "content": "x"}));
        t += &wrote("w1", &png, false);
        // A failed write, a file type that is source rather than an artifact, a file inside a
        // working-copy folder, a relative path, an edit of an existing file, and a Bash command
        // that writes something: none count.
        for (id, name, path) in [
            ("w2", "Write", at("report.html")),
            ("w3", "Write", at("src") + "\\main.rs"),
            ("w4", "Write", at("node_modules") + "\\x\\a.png"),
            ("w5", "Write", "shot.png".into()),
            ("w6", "Edit", at("notes.md")),
            ("w7", "Bash", at("b.png")),
        ] {
            let input = if name == "Bash" { serde_json::json!({"command": "copy a.png b.png"}) } else { serde_json::json!({"file_path": path, "content": "x"}) };
            t += &call(id, name, input);
            t += &wrote(id, &path, id == "w2");
        }
        let mut calls = HashMap::new();
        assert_eq!(scan(&t, &mut calls), [Publish { url: png.clone(), path: png, cwd: Some("G:\\Dev\\minecraft".into()), session: Some("s-2".into()), at: Some(1_793_433_600_000) }]);
    }

    #[test]
    fn times_parse_as_utc_milliseconds() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-09-24T09:56:01.421Z"), Some(1_790_243_761_421));
        assert_eq!(parse_time("2000-02-29T12:00:00.5Z"), Some(951_825_600_500));
        assert_eq!(parse_time("yesterday"), None);
    }

    /// SKILL-035 at scale: with 2,000 quiet transcripts, a poll between sweeps asks no file for its
    /// size; a file that grows is still read, a sweep asks every file, and a file that went is let go.
    #[test]
    fn skill_035_quiet_transcripts_are_not_asked_for_their_size_between_sweeps() {
        let t = crate::test_dir::temp("capture-quiet");
        let root = t.0.join("projects");
        let hour_ago = SystemTime::now() - Duration::from_secs(3600);
        let mut files = Vec::new();
        for i in 0..2000 {
            let dir = root.join(format!("G--proj-{}", i / 100));
            let p = if i % 50 == 0 { dir.join(format!("s-{i}")).join("subagents").join("agent.jsonl") } else { dir.join(format!("s-{i}.jsonl")) };
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, "{}\n").unwrap();
            fs::File::options().write(true).open(&p).unwrap().set_modified(hour_ago).unwrap();
            files.push(p);
        }
        let asked = std::cell::Cell::new(0usize);
        let mut size = |p: &Path| {
            asked.set(asked.get() + 1);
            fs::metadata(p).ok().map(|m| m.len())
        };
        let (mut w, t0, wall) = (Watch::default(), Instant::now(), SystemTime::now());
        let at = |s: u64| t0 + Duration::from_secs(s);
        assert!(w.poll(&root, at(0), wall, &mut size).is_empty(), "what was there at start is not replayed");
        assert_eq!((asked.replace(0), w.seen.len()), (2000, 2000), "the first poll sweeps");
        assert!(w.poll(&root, at(2), wall, &mut size).is_empty());
        assert_eq!(asked.replace(0), 0, "no per-file size between sweeps");
        // a publish lands in one quiet transcript
        let url = "https://claude.ai/artifact/RtHRJW2CNxVSVEfdBezseR";
        let page = "G:\\Temp\\page.html";
        let mut f = fs::OpenOptions::new().append(true).open(&files[7]).unwrap();
        f.write_all((call("a", "Artifact", serde_json::json!({"file_path": page})) + &result("a", url, page, false)).as_bytes()).unwrap();
        drop(f);
        assert_eq!(w.poll(&root, at(4), SystemTime::now(), &mut size).len(), 1, "a grown file is read");
        assert_eq!(asked.replace(0), 1, "only the grown file is asked");
        w.poll(&root, at(6), SystemTime::now(), &mut size);
        assert_eq!(asked.replace(0), 1, "a file that just changed stays busy");
        w.poll(&root, at(32), SystemTime::now(), &mut size);
        assert_eq!(asked.replace(0), 2000, "the 30 s sweep asks every file");
        fs::remove_file(&files[0]).unwrap();
        w.poll(&root, at(34), SystemTime::now(), &mut size);
        assert_eq!(w.seen.len(), 1999, "a transcript that went is let go");
    }

    #[test]
    fn skill_035_a_transcript_rewritten_shorter_is_read_from_its_start() {
        let t = crate::test_dir::temp("capture-rewrite");
        let root = t.0.join("projects");
        let p = root.join("G--proj").join("s.jsonl");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "x".repeat(4000) + "\n").unwrap();
        let mut size = |p: &Path| fs::metadata(p).ok().map(|m| m.len());
        let mut w = Watch::default();
        let t0 = Instant::now();
        w.poll(&root, t0, SystemTime::now(), &mut size);
        let url = "https://claude.ai/artifact/RtHRJW2CNxVSVEfdBezseR";
        let page = "G:\\Temp\\page.html";
        fs::write(&p, call("a", "Artifact", serde_json::json!({"file_path": page})) + &result("a", url, page, false)).unwrap();
        assert_eq!(w.poll(&root, t0 + Duration::from_secs(2), SystemTime::now(), &mut size).len(), 1);
    }
}
