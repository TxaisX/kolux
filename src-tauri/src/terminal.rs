//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{check_start_dir, inherited_noise, is_shell_program, program_command, shell_commands, start_dir, PtySession};
use base64::Engine as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// T-066-d: the session id an id-only agent prints (its own resume hint), told to the window when its pane's program exits.
#[path = "terminal_session_id.rs"]
pub mod session_id;
#[cfg(test)]
mod flood;

pub const OUTPUT_EVENT: &str = "terminal-output";
pub const EXIT_EVENT: &str = "terminal-exit";
/// CLI-024: the app asks the window for a pane's visible frame; the window answers with
/// `terminal_screen_reply`.
pub const SCREEN_EVENT: &str = "terminal-screen-request";
/// Lines kept per terminal for `kolux terminal read` (CLI-024); older ones are dropped.
pub const LOG_LINES: usize = 2000;
/// Fix-term 786: the most a log keeps of a line that has not ended yet.
const PENDING_CAP: usize = 16 * 1024;
const SCREEN_WAIT: std::time::Duration = std::time::Duration::from_millis(1500);
/// APP-052: the terminal service's wire protocol. Additions only bump it; the window refuses a
/// service older than the oldest protocol it still speaks (src/terminal/reattach.ts).
pub const PROTOCOL: u32 = 1;

/// APP-052: this run of the terminal service, fixed for the life of the process. Typing carries
/// the generation it was meant for and is refused when another run owns the terminals now
/// (owns); output events carry it so a window drops events from a replaced run. Kept below 2^53
/// so the window reads it as a plain number.
pub fn generation() -> u64 {
    // T-184-b: a window linked to the background service answers for the service's run.
    let linked = LINKED.load(std::sync::atomic::Ordering::SeqCst);
    if linked != 0 {
        return linked;
    }
    static GENERATION: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *GENERATION.get_or_init(|| {
        let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(1);
        millis * 1000 + u64::from(std::process::id() % 1000)
    })
}

/// T-184-b: the run of the background service this window is linked to (0: none).
static LINKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// APP-052: typing meant for another run of the service never reaches this one's terminals
/// (None: a caller from before generations, let through).
pub fn owns(generation: Option<u64>) -> Result<(), String> {
    match generation {
        Some(g) if g != self::generation() => Err("the terminal service was replaced; the pane has to reattach before typing reaches a terminal".into()),
        _ => Ok(()),
    }
}

#[derive(Default, Clone)]
pub struct Terminals {
    inner: Arc<Mutex<Inner>>,
    /// CLI-023: where each terminal sits in the window (worktree pane, tab, title, in view), as the
    /// window last reported it, plus the command-line requests it could not open.
    layout: Arc<Mutex<Vec<serde_json::Value>>>,
    /// T-184-b: the link to the background terminal service.
    service: Arc<ServiceLink>,
}

#[derive(Default)]
struct Inner {
    next_id: u32,
    sessions: HashMap<u32, Session>,
    /// The folder each session was started in, so a workspace can close its shells before its
    /// folder is deleted.
    dirs: HashMap<u32, String>,
    /// When each program session started and last wrote, so a worker start can tell when its
    /// agent has come up (ORCH-016). Shells are not marked.
    marks: HashMap<u32, Mark>,
    /// CLI-007 / ORCH-001: each session secret pane key, put in its environment as
    /// `KOLUX_PANE_KEY` next to its handle, so a command run inside it can prove which pane it is.
    keys: HashMap<u32, String>,
    /// CLI-027: sessions whose process has ended, so a close can confirm the program is gone.
    ended: HashSet<u32>,
    /// CLI-024: what each session wrote, by line, for `kolux terminal read`.
    logs: HashMap<u32, OutputLog>,
    /// TERM-132: which sessions a program holds (alternate screen, mouse): `ALT | MOUSE` bits.
    owned: HashMap<u32, u8>,
    /// TERM-106: each session's output file, by pane key, replayed when the pane comes back after a restart.
    hist: HashMap<u32, History>,
    /// ACCT-054: how far each session's output has run ahead of its pane.
    flow: HashMap<u32, Arc<Flow>>,
    /// APP-052: the newest session each window pane started, so a pane takes it back after a webview reload.
    panes: HashMap<u32, u32>,
    /// ORCH-057: each session's output count and raw tail, for a viewer's resync.
    snaps: HashMap<u32, Snap>,
    /// Row 211: which process each session id holds now; a new number every time an id starts (a reused id too).
    process_gen: HashMap<u32, u64>,
    process_count: u64,
}

impl Inner {
    /// One chunk of a session's output, taken in: the snapshot tail and count (returned), the line log,
    /// the saved history, the screen-owner bits and the program's last-output time.
    fn book_chunk(&mut self, id: u32, chunk: &[u8], is_program: bool) -> u64 {
        let seq = self.snaps.entry(id).or_default().push(chunk);
        self.logs.entry(id).or_default().push(chunk);
        if let Some(h) = self.hist.get_mut(&id) {
            h.append(chunk);
        }
        if chunk.contains(&0x1b) {
            let prev = self.owned.get(&id).copied().unwrap_or(0);
            let now = screen_owner(prev, chunk);
            if now != prev {
                self.owned.insert(id, now);
            }
        }
        if is_program {
            if let Some(m) = self.marks.get_mut(&id) {
                m.last_output = Some(Instant::now());
            }
        }
        seq
    }

    /// ORCH-059: a session id about to be (re)used starts as a new incarnation: nothing an earlier
    /// session under the same handle left behind (log, screen bits, end flag, marks, snapshot) carries over.
    fn fresh_incarnation(&mut self, id: u32) {
        self.process_count += 1;
        self.process_gen.insert(id, self.process_count);
        self.dirs.remove(&id);
        self.marks.remove(&id);
        self.keys.remove(&id);
        self.ended.remove(&id);
        self.logs.remove(&id);
        self.owned.remove(&id);
        self.hist.remove(&id);
        self.snaps.remove(&id);
        if let Some(f) = self.flow.remove(&id) {
            f.release();
        }
    }
}

/// T-184-b: a session the window runs itself, or one the background terminal service runs for it
/// (it outlives the window: quitting leaves it running, closing its pane ends it).
pub(crate) enum Session {
    Local(PtySession),
    Remote(crate::pty::link::Remote),
}

impl From<PtySession> for Session {
    fn from(s: PtySession) -> Self {
        Session::Local(s)
    }
}

impl Session {
    fn writer(&self) -> Result<crate::pty::SharedWriter, String> {
        match self {
            Session::Local(s) => s.writer(),
            Session::Remote(r) => Ok(r.writer()),
        }
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self {
            Session::Local(s) => s.resize(cols, rows),
            Session::Remote(r) => r.resize(cols, rows),
        }
    }

    fn program(&self) -> &str {
        match self {
            Session::Local(s) => s.program(),
            Session::Remote(r) => &r.program,
        }
    }

    fn pid(&self) -> Option<u32> {
        match self {
            Session::Local(s) => s.pid(),
            Session::Remote(r) => r.pid,
        }
    }

    fn foreground_group(&self) -> Option<i32> {
        match self {
            Session::Local(s) => s.foreground_group(),
            Session::Remote(_) => None,
        }
    }

    fn kill(&mut self) {
        match self {
            Session::Local(s) => s.kill(),
            Session::Remote(r) => r.kill(),
        }
    }
}

/// T-184-b: where the window's link to the background terminal service stands.
#[derive(Default)]
enum Linking {
    /// No service (a development build, or it could not be reached): panes run in the window.
    #[default]
    Off,
    /// Linking and taking back the service's terminals; a pane asking for its terminal waits.
    Starting,
    Linked(Arc<crate::pty::link::Link>),
}

#[derive(Default)]
struct ServiceLink {
    state: Mutex<Linking>,
    ready: Condvar,
    /// The app's data folder: the service's `terminals.json` and the window's seen record.
    dir: Mutex<Option<std::path::PathBuf>>,
}

/// How long a pane's first question waits for the link (a service that has to start included).
const LINK_WAIT: Duration = Duration::from_secs(10);

/// ACCT-054: how far a session's output has run ahead of what its pane has drawn. Past
/// `FLOW_HIGH` unacknowledged bytes the reader thread stops reading the PTY (so the program blocks
/// on its own write) and goes on once the pane is down to `FLOW_LOW`; a pane that stops answering
/// (its webview busy, say) holds it `FLOW_WAIT` at most, so no program is ever stuck for good.
/// AFTER-699: the terminal service keeps one per terminal too, so a flood in a service pane pauses
/// its reader there instead of piling up in the service's buffers for the window.
#[derive(Default)]
pub(crate) struct Flow {
    unacked: Mutex<u64>,
    drawn: Condvar,
    pauses: std::sync::atomic::AtomicU32,
    /// ORCH-057: the pane stopped answering past `FLOW_WAIT` and the reader went on without it, so the
    /// output it still has queued is stale; its next acknowledgement is answered with a snapshot.
    behind: std::sync::atomic::AtomicBool,
}

pub(crate) const FLOW_HIGH: u64 = 512 * 1024;
const FLOW_LOW: u64 = 128 * 1024;
pub(crate) const FLOW_WAIT: Duration = Duration::from_secs(2);
/// The whole service stop at an update quit: the share of the quit budget it must fit (row 1014).
pub(crate) const UPDATE_STOP_LIMIT: Duration = Duration::from_secs(2);

impl Flow {
    /// Counts `bytes` just sent to the pane and, past the high mark, waits for it to catch up.
    pub(crate) fn sent(&self, bytes: u64) {
        self.sent_within(bytes, FLOW_WAIT);
    }

    pub(crate) fn sent_within(&self, bytes: u64, wait: Duration) {
        let Ok(mut n) = self.unacked.lock() else { return };
        *n += bytes;
        if *n < FLOW_HIGH {
            return;
        }
        self.pauses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut deadline = Instant::now() + wait;
        let mut lowest = *n;
        while *n > FLOW_LOW {
            // Fix-term 786: a pane that is slow but answering keeps the reader waiting; only one that has
            // acknowledged nothing for `wait` is given up on (else its backlog grew without bound).
            if *n < lowest {
                lowest = *n;
                deadline = Instant::now() + wait;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                // ponytail: a pane that never answers is taken as caught up; the next flood pauses again.
                *n = 0;
                self.behind.store(true, std::sync::atomic::Ordering::Relaxed);
                break;
            }
            n = match self.drawn.wait_timeout(n, left) {
                Ok((guard, _)) => guard,
                Err(_) => return,
            };
        }
    }

    /// The pane drew `bytes` more. True once after the reader gave up waiting for it (ORCH-057: resync due).
    pub(crate) fn ack(&self, bytes: u64) -> bool {
        if let Ok(mut n) = self.unacked.lock() {
            *n = n.saturating_sub(bytes);
            if *n <= FLOW_LOW {
                self.drawn.notify_all();
            }
        }
        self.behind.swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// The session is ending: a paused reader goes on at once.
    pub(crate) fn release(&self) {
        if let Ok(mut n) = self.unacked.lock() {
            *n = 0;
        }
        self.drawn.notify_all();
    }

    fn pauses(&self) -> u32 {
        self.pauses.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// ACCT-059: the memory profile for a machine with `total` bytes of memory, and the scrollback
/// lines each pane keeps under it. Pure, so the same machine gets the same caps every start.
pub fn profile_for(total: Option<u64>) -> (&'static str, u32) {
    const GIB: u64 = 1 << 30;
    match total {
        Some(t) if t < 8 * GIB => ("small", 2000),
        Some(t) if t >= 16 * GIB => ("large", 10000),
        _ => ("medium", 5000),
    }
}

/// ACCT-059: the machine's physical memory, in bytes.
fn total_memory() -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        // SAFETY: the struct is zeroed with dwLength set, as GlobalMemoryStatusEx requires.
        unsafe {
            let mut m: MEMORYSTATUSEX = std::mem::zeroed();
            m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            (GlobalMemoryStatusEx(&mut m) != 0).then_some(m.ullTotalPhys)
        }
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// TERM-106: past this many bytes a pane's saved output is rewritten down to `HISTORY_KEEP`.
/// Fix-term 787: 1 MB, so the rewrite (a read and a write of the file) runs once per ~900 KB of output, not per 128 KB.
const HISTORY_CAP: u64 = 1024 * 1024;
/// TERM-106: what a rewrite keeps (the newest bytes, from a line boundary), and the most a restore replays.
const HISTORY_KEEP: usize = 128 * 1024;

/// TERM-106: what a pane printed, kept on disk by pane key (`<app data>/history/<key>.log`) so a
/// reopened pane shows it above its new shell. Append-only, so a crash at any moment leaves a
/// usable copy; the rewrite past the cap goes through a temp file and a rename for the same reason.
/// ponytail: the file is opened per chunk; a kept handle only matters at thousands of chunks a second.
struct History {
    path: std::path::PathBuf,
    size: u64,
    /// Fix-term 787: kept open between chunks (an open per chunk cost ~1 ms on Windows); dropped for the rewrite.
    file: Option<std::fs::File>,
}

impl History {
    fn open(dir: &std::path::Path, key: u32) -> Option<History> {
        std::fs::create_dir_all(dir.join("history")).ok()?;
        let path = history_file(dir, key);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Some(History { path, size, file: None })
    }

    fn append(&mut self, chunk: &[u8]) {
        use std::io::Write as _;
        if self.file.is_none() {
            self.file = std::fs::OpenOptions::new().create(true).append(true).open(&self.path).ok();
        }
        if let Some(f) = &mut self.file {
            if f.write_all(chunk).is_ok() {
                self.size += chunk.len() as u64;
            } else {
                self.file = None;
            }
        }
        if self.size > HISTORY_CAP {
            self.file = None;
            self.compact();
        }
    }

    /// after-list 698: the newest `n` bytes on disk (nothing when the file cannot be read).
    fn end(&self, n: usize) -> Vec<u8> {
        let all = std::fs::read(&self.path).unwrap_or_default();
        all[all.len().saturating_sub(n)..].to_vec()
    }

    fn compact(&mut self) {
        let Ok(all) = std::fs::read(&self.path) else { return };
        let kept = trim_history(&all, HISTORY_KEEP);
        let tmp = self.path.with_extension("tmp");
        if std::fs::write(&tmp, kept).is_ok() && std::fs::rename(&tmp, &self.path).is_ok() {
            self.size = kept.len() as u64;
        }
    }
}

/// ORCH-057: every session's running output count and its newest `HISTORY_KEEP` raw bytes, kept under
/// the registry lock with each chunk, so a viewer that fell behind redraws from a snapshot and drops the
/// queued chunks the snapshot already holds (each output event carries the count after its chunk).
#[derive(Default)]
pub(crate) struct Snap {
    seq: u64,
    tail: std::collections::VecDeque<u8>,
}

impl Snap {
    /// T-184-b: a terminal taken back from the service: its output count there and its recent output.
    pub(crate) fn seeded(seq: u64, tail: &[u8]) -> Snap {
        let mut s = Snap { seq: seq.saturating_sub(tail.len() as u64), tail: Default::default() };
        s.push(tail);
        s
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> u64 {
        self.seq += chunk.len() as u64;
        self.tail.extend(chunk);
        let over = self.tail.len().saturating_sub(HISTORY_KEEP);
        self.tail.drain(..over);
        self.seq
    }

    /// The snapshot a viewer redraws from: the count it covers and the tail from a line boundary.
    pub(crate) fn snapshot(&mut self) -> Snapshot {
        let all = self.tail.make_contiguous();
        // a tail that lost its start begins at the next line break (or character), never mid-sequence
        let keep = if self.seq == all.len() as u64 { all.len() } else { all.len().saturating_sub(1) };
        Snapshot { seq: self.seq, data: base64::engine::general_purpose::STANDARD.encode(trim_history(all, keep)) }
    }
}

/// ORCH-057: what a viewer that fell behind redraws from (base64 bytes); output events up to `seq` are in it.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Snapshot {
    pub seq: u64,
    pub data: String,
}

fn history_file(dir: &std::path::Path, key: u32) -> std::path::PathBuf {
    dir.join("history").join(format!("{key}.log"))
}

/// The newest `keep` bytes of `all`, from the next line boundary so no escape sequence is cut in two.
/// ACCT-053: a tail without any line break (one huge line) starts at a character boundary, so a
/// wide character is never replayed as its stray trailing bytes (each one a replacement glyph) on
/// the redraw of a restored pane.
fn trim_history(all: &[u8], keep: usize) -> &[u8] {
    if all.len() <= keep {
        return all;
    }
    let from = all.len() - keep;
    match all[from..].iter().position(|b| *b == b'\n') {
        Some(i) => &all[from + i + 1..],
        None => {
            // UTF-8 continuation bytes are 10xxxxxx; the first byte that is not one starts a character
            let skip = all[from..].iter().take_while(|b| **b & 0xC0 == 0x80).count();
            &all[from + skip..]
        }
    }
}

/// TERM-106: removes the saved output of panes not in `keep`. A file not named by a pane key is
/// left alone (its owner is uncertain) and an empty list prunes nothing (the layout could not be read).
fn prune_history(dir: &std::path::Path, keep: &[u32]) {
    if keep.is_empty() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir.join("history")) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        let Some(key) = name.to_str().and_then(|n| n.strip_suffix(".log")).and_then(|n| n.parse::<u32>().ok()) else { continue };
        if !keep.contains(&key) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// TERM-132: the program in the pane took the alternate screen (vim, less, a full-screen agent view).
pub const ALT: u8 = 1;
/// TERM-132: the program in the pane captures the mouse.
pub const MOUSE: u8 = 2;

/// TERM-132: which DEC private modes in `chunk` hand the pane to a program (alternate screen
/// 47/1047/1049, mouse 1000..1003) or back; the last one in the chunk wins.
/// ponytail: a sequence split across two chunks is missed; the program's next full sequence or
/// its exit sets the record straight.
pub fn screen_owner(prev: u8, chunk: &[u8]) -> u8 {
    let mut owned = prev;
    let mut i = 0;
    while i + 3 < chunk.len() {
        if chunk[i] != 0x1b || chunk[i + 1] != b'[' || chunk[i + 2] != b'?' {
            i += 1;
            continue;
        }
        let mut j = i + 3;
        // An overflowing mode number is an unknown mode (none), never a wrapped known one.
        let mut n: Option<u32> = Some(0);
        while j < chunk.len() && chunk[j].is_ascii_digit() {
            n = n.and_then(|n| n.checked_mul(10)?.checked_add(u32::from(chunk[j] - b'0')));
            j += 1;
        }
        if j < chunk.len() && matches!(chunk[j], b'h' | b'l') {
            let bit = match n {
                Some(47 | 1047 | 1049) => ALT,
                Some(1000..=1003) => MOUSE,
                _ => 0,
            };
            if chunk[j] == b'h' {
                owned |= bit;
            } else {
                owned &= !bit;
            }
        }
        i = j;
    }
    owned
}

/// TERM-116: the snapshot text for a bug report. Every value and screen line goes through the
/// diagnostics scrub (tokens, key=value secrets) and the home folder reads `~`.
pub fn diagnostics_text(head: &[(&str, String)], screen: &[String], home: Option<&str>) -> String {
    let mask = |s: &str| {
        let s = match home.filter(|h| !h.is_empty()) {
            Some(h) => s.replace(h, "~"),
            None => s.to_string(),
        };
        crate::diag::scrub(&s)
    };
    let mut out = String::from("Kolux terminal diagnostics\n");
    for (k, v) in head {
        out.push_str(&format!("{k}: {}\n", mask(v)));
    }
    out.push_str("\nscreen:\n");
    for line in screen {
        out.push_str(&mask(line));
        out.push('\n');
    }
    out
}

/// CLI-024: a terminal's output by line, each line numbered with a cursor that only grows, so a
/// reader carries on from where it left off. Escape sequences are stripped; `\r` overwrites keep
/// the last version of the line. Bounded to `LOG_LINES`: the oldest lines go when it is full.
#[derive(Default, Debug)]
pub struct OutputLog {
    lines: std::collections::VecDeque<String>,
    /// The cursor of the first kept line; 1 until something was dropped.
    oldest: u64,
    /// Bytes since the last line break: a prompt, a progress line, a question. Bytes, not text,
    /// because a UTF-8 character can arrive split across two PTY chunks.
    pending: Vec<u8>,
    dropped: bool,
    /// When the session last wrote anything (CLI-025's idle fallback for panes without hooks).
    written: Option<Instant>,
}

#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct Line {
    pub cursor: u64,
    pub text: String,
}

/// One read of the log (CLI-024).
#[derive(serde::Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub lines: Vec<Line>,
    /// Text after the last line break, not yet a numbered line.
    pub pending: String,
    /// The cursor to read on from (the last line's number; 0 before any line).
    pub cursor: u64,
    /// The oldest cursor still kept.
    pub oldest: u64,
    /// Lines after the cursor asked for were dropped before this read.
    pub dropped: bool,
    /// More lines follow the ones returned (`limit` cut them).
    pub more: bool,
}

/// T-151-d: what a line shows after its last redraw. A repaint starts over at the line's first column
/// with a carriage return or its cursor-movement twin (CSI n G, CSI row;col H / f with the column
/// left out, 0 or 1, zero-padded forms included); a shell that repaints what is typed that way would
/// otherwise have every drawing run together and read as the command twice. A move to any other
/// column keeps the text. A column-1 H / f move starts over only on the row the last such move named
/// (or for the first one in the line); a row left out or 0 is row 1 (FIX-2), as a terminal reads it,
/// so home followed by a move to row 2 keeps both. A move to a different row is a new line of the
/// screen, so the earlier drawing stays (it runs on in this one log line).
/// ponytail: no column-aware buffer. A repaint that moves to a column above 1 and overwrites in place
/// would still read joined; unproven against real PSReadLine bytes (T-151-d live step 4).
fn last_drawing(s: &str) -> &str {
    if !s.as_bytes().contains(&b'\r') && !s.as_bytes().contains(&0x1b) {
        return s;
    }
    // A CSI parameter as a number: empty is "left out" (None), zero-padded forms read as their value.
    let num = |p: &str| if p.is_empty() { None } else { Some(p.bytes().fold(0u32, |n, d| n.saturating_mul(10).saturating_add(u32::from(d - b'0')))) };
    let b = s.as_bytes();
    let (mut start, mut i) = (0, 0);
    let mut row: Option<u32> = None;
    while i < b.len() {
        if b[i] == b'\r' {
            start = i + 1;
        } else if b[i] == 0x1b && b.get(i + 1) == Some(&b'[') {
            let mut j = i + 2;
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b';') {
                j += 1;
            }
            if j < b.len() && matches!(b[j], b'G' | b'H' | b'f') {
                let params = &s[i + 2..j];
                if b[j] == b'G' {
                    if matches!(num(params), None | Some(0 | 1)) {
                        start = j + 1;
                    }
                } else {
                    let mut it = params.split(';');
                    let (r, c) = (num(it.next().unwrap_or("")).unwrap_or(1).max(1), num(it.next().unwrap_or("")));
                    if matches!(c, None | Some(0 | 1)) && row.is_none_or(|last| last == r) {
                        start = j + 1;
                    }
                    row = Some(r);
                }
                i = j;
            } else {
                // Not a move: the byte that stopped the run is read again, a carriage return right after ESC[ included.
                i = j - 1;
            }
        }
        i += 1;
    }
    &s[start..]
}

/// Drops CSI, OSC and two-byte escape sequences, control characters other than tab.
pub fn strip_ansi(s: &str) -> String {
    // Fix-term 787: a line with no control character (nearly every line of a flood) is returned as it is.
    if !s.bytes().any(|b| b < 0x20 && b != b'\t' || b == 0x7f) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '\x1b' => match it.next() {
                Some('[') => {
                    let mut n = 0usize;
                    for d in it.by_ref() {
                        if ('@'..='~').contains(&d) {
                            // Cursor forward (`C`) and erase characters (`X`) leave a gap in the
                            // text; keep it as spaces so columns stay apart.
                            if matches!(d, 'C' | 'X') {
                                out.extend(std::iter::repeat_n(' ', n.max(1)));
                            }
                            break;
                        }
                        if let Some(v) = d.to_digit(10) {
                            n = n.saturating_mul(10).saturating_add(v as usize);
                        }
                    }
                }
                Some('(' | ')') => {
                    it.next();
                }
                Some(']') => {
                    let mut last = '\0';
                    for d in it.by_ref() {
                        if d == '\x07' || (last == '\x1b' && d == '\\') {
                            break;
                        }
                        last = d;
                    }
                }
                _ => {}
            },
            '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

impl OutputLog {
    pub fn push(&mut self, chunk: &[u8]) {
        self.written = Some(Instant::now());
        self.pending.extend_from_slice(chunk);
        let mut start = 0;
        while let Some(i) = self.pending[start..].iter().position(|b| *b == b'\n') {
            let end = start + i + 1;
            let raw = String::from_utf8_lossy(&self.pending[start..end]);
            start = end;
            let line = raw.trim_end_matches(['\n', '\r']);
            // A carriage return redraws the line from its start: keep what was drawn last.
            let line = last_drawing(line);
            if self.lines.is_empty() && self.oldest == 0 {
                self.oldest = 1;
            }
            self.lines.push_back(strip_ansi(line));
            self.trim();
        }
        self.pending.drain(..start);
        // A line that never ends (binary output, a progress bar drawn with CR alone) is cut into lines
        // at the cap instead of growing without bound.
        while self.pending.len() > PENDING_CAP {
            let at = match std::str::from_utf8(&self.pending[..PENDING_CAP]) {
                Err(e) if e.error_len().is_none() => e.valid_up_to(),
                _ => PENDING_CAP,
            };
            let rest = self.pending.split_off(at);
            let raw = String::from_utf8_lossy(&std::mem::replace(&mut self.pending, rest)).into_owned();
            if self.lines.is_empty() && self.oldest == 0 {
                self.oldest = 1;
            }
            self.lines.push_back(strip_ansi(last_drawing(&raw)));
            self.trim();
        }
    }

    fn trim(&mut self) {
        while self.lines.len() > LOG_LINES {
            self.lines.pop_front();
            self.oldest += 1;
            self.dropped = true;
        }
    }

    /// The pending bytes as text, minus a UTF-8 character still arriving at the end.
    fn pending_text(&self) -> &str {
        match std::str::from_utf8(&self.pending) {
            Ok(t) => t,
            Err(e) => std::str::from_utf8(&self.pending[..e.valid_up_to()]).unwrap_or_default(),
        }
    }

    /// The cursor to carry on from: the newest line's number, 0 before any line.
    pub fn cursor(&self) -> u64 {
        (self.oldest + self.lines.len() as u64).saturating_sub(1)
    }

    /// The lines after `after` (all of them when none is given). With `limit`, the first `limit`
    /// after a cursor (a reader pages forward), else the last `limit` (a reader wants the latest).
    pub fn read(&self, after: Option<u64>, limit: Option<usize>) -> Read {
        let from = after.unwrap_or(0);
        let oldest = self.oldest.max(1);
        let skip = (from + 1).saturating_sub(oldest) as usize;
        let mut lines: Vec<Line> = self.lines.iter().enumerate().skip(skip).map(|(i, t)| Line { cursor: self.oldest + i as u64, text: t.clone() }).collect();
        let mut more = false;
        if let Some(n) = limit {
            if lines.len() > n {
                more = true;
                if after.is_some() {
                    lines.truncate(n);
                } else {
                    lines.drain(..lines.len() - n);
                }
            }
        }
        let pending = if more && after.is_some() { String::new() } else { strip_ansi(last_drawing(self.pending_text())) };
        let cursor = lines.last().map_or(if from < oldest { 0 } else { from.min(self.cursor()) }, |l| l.cursor);
        Read { lines, pending, cursor, oldest, dropped: self.dropped && from + 1 < self.oldest, more }
    }
}

/// CLI-024's screen round trip: the serve thread opens a slot, emits `SCREEN_EVENT`, and waits for
/// the window to fill it. ponytail: a Vec, there is never more than one request in flight.
static SCREENS: Mutex<Vec<(String, Option<Vec<String>>)>> = Mutex::new(Vec::new());
static SCREEN_READY: Condvar = Condvar::new();

pub fn screen_open(request: &str) {
    if let Ok(mut s) = SCREENS.lock() {
        s.push((request.to_string(), None));
    }
}

/// The rows the window answered with, or none when it did not answer in time.
pub fn screen_wait(request: &str) -> Option<Vec<String>> {
    let mut guard = SCREENS.lock().ok()?;
    let until = Instant::now() + SCREEN_WAIT;
    loop {
        let i = guard.iter().position(|(r, _)| r == request)?;
        if guard[i].1.is_some() {
            return guard.remove(i).1;
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            guard.remove(i);
            return None;
        }
        guard = SCREEN_READY.wait_timeout(guard, left).ok()?.0;
    }
}

/// The window's answer to `SCREEN_EVENT`: the visible rows of that pane (CLI-024).
#[tauri::command]
pub fn terminal_screen_reply(request: String, rows: Vec<String>) {
    if let Ok(mut s) = SCREENS.lock() {
        if let Some(slot) = s.iter_mut().find(|(r, _)| *r == request) {
            slot.1 = Some(rows);
            SCREEN_READY.notify_all();
        }
    }
}

/// `dir` at the front of a search path (CLI-007).
fn cli_first(dir: &std::path::Path, path: Option<std::ffi::OsString>) -> std::ffi::OsString {
    let rest: Vec<std::path::PathBuf> = path.map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(rest)).unwrap_or_else(|_| dir.as_os_str().to_os_string())
}

/// GIT-063: an agent pane (automation runs start theirs the same way) gets git's prompts turned
/// off, so a remote that wants a password fails the command instead of stalling the agent; a shell
/// keeps prompting. Set before the user's own variables, which can turn them back on.
fn unattended(command: &mut portable_pty::CommandBuilder, is_program: bool) {
    if is_program {
        for (k, v) in crate::git::NO_PROMPT {
            command.env(k, v);
        }
    }
}

/// The handle a terminal is known by on the command line (`KOLUX_TERMINAL_HANDLE`).
pub fn handle_of(id: u32) -> String {
    format!("term-{id}")
}

fn id_of(handle: &str) -> Option<u32> {
    handle.strip_prefix("term-")?.parse().ok()
}

#[derive(Clone)]
struct Mark {
    started: Instant,
    last_output: Option<Instant>,
    /// The program the session runs (ORCH-013 tells agents from other programs by it).
    program: String,
    /// The agent the program is credited as (`claude`, `codex`), none for another program.
    agent: Option<&'static str>,
    /// The window pane the session runs in (CHAT-006 finds a pane's program by it).
    pane: Option<u32>,
    /// CLAUDE_CONFIG_DIR / CODEX_HOME as the program was started with them.
    home_env: Vec<(String, String)>,
    /// The folder the program started in (None: the app's own folder).
    cwd: Option<String>,
}

/// What a pane's program session is, for the chat view (CHAT-002, CHAT-006).
pub struct PaneRun {
    pub agent: Option<&'static str>,
    /// When the program started, on the wall clock.
    pub started: std::time::SystemTime,
    /// The program has printed something (it is past launching).
    pub wrote: bool,
    pub alive: bool,
    /// CLAUDE_CONFIG_DIR / CODEX_HOME as the program was started with them (CHAT-007).
    pub home_env: Vec<(String, String)>,
    /// The folder the program started in (None: the app's own folder).
    pub cwd: Option<String>,
}

/// One chunk of program output, base64 so split multi-byte characters survive the trip.
#[derive(serde::Serialize, Clone)]
struct OutputPayload {
    id: u32,
    data: String,
    /// TERM-098: the pane's own key, so output that arrives before the pane has learned its
    /// terminal id (the shell's first frame and its cursor question) is not dropped.
    pane: Option<u32>,
    /// APP-052: the run of the terminal service that wrote it; a window drops chunks from a replaced run.
    generation: u64,
    /// ORCH-057: the session's output count after this chunk; a viewer that redrew from a snapshot drops
    /// the chunks it already holds (seq not past the snapshot's).
    seq: u64,
}

#[derive(serde::Serialize, Clone)]
struct ExitPayload {
    id: u32,
    code: Option<u32>,
    /// ORCH-057: "exited" when the end was confirmed with an exit code, "unverifiable" when Kolux could
    /// not learn how the program ended (viewers say so instead of calling it an exit).
    outcome: &'static str,
    /// T-066-d: the session id the agent printed in its own resume hint before it exited, when it printed one.
    #[serde(skip_serializing_if = "Option::is_none")]
    session: Option<String>,
}

/// Terminal `id` ended, however: it exited, its pane closed, or (USAGE-011, T-067-b) the
/// connection to the background terminal service that carried it was lost, which runs every
/// carried pane's exit with no code. Any turn its panes had open ends in the activity counts, once:
/// a status the same terminal repeats after a reconnect starts nothing.
pub(crate) fn turns_end(id: u32) {
    crate::activity::terminal_ended(id);
    // TERM-122: after activity has closed its spells, the panes' sessions go with the
    // terminal, so a closed pane, or an agent that was the pane's own program and
    // exited or crashed, never keeps the computer awake (an agent typed into a shell
    // pane ends with the shell, not with the agent).
    crate::status::terminal_ended(id);
}

/// ORCH-057: how a session's end reads to its viewers.
fn outcome_of(code: Option<u32>) -> &'static str {
    if code.is_some() {
        "exited"
    } else {
        "unverifiable"
    }
}

/// ORCH-058: what `kill_under` did: how many sessions it ended, and the pids it could not show
/// gone in time (or could not check), which block a removal unless waived.
#[derive(Default, Debug, PartialEq)]
pub struct Stopped {
    pub ended: usize,
    pub stuck: Vec<u32>,
}

impl Terminals {
    /// Starts a pane. With no `program` it runs the user's shell; with one (an agent such as
    /// `claude`) it runs that program directly with `args`, in `cwd`.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16, cwd: Option<String>, program: Option<String>, args: Vec<String>, own_env: Vec<(String, String)>, env: Vec<(String, String)>, pane_key: Option<u32>, shell: Option<(String, Vec<String>)>, per_worktree_history: bool) -> Result<u32, String> {
        // TERM-115: a pane's Ctrl+C must reach its program. Windows hands "ignore Ctrl+C" down to
        // every child a process starts, and this app is itself started with CREATE_NEW_PROCESS_GROUP
        // (by `kolux-dev`, and by the dev runner), so its shells never saw the interrupt: the pty got
        // the byte, the shell kept running. Cleared once, before the first shell starts.
        #[cfg(windows)]
        {
            static CTRL_C: std::sync::Once = std::sync::Once::new();
            // SAFETY: a documented call on this process's own console state; no pointers are passed.
            CTRL_C.call_once(|| unsafe {
                windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
            });
        }
        // CHAT-007: the agent home folders the program really got; Kolux's account variable (applied last) wins.
        let home_env: Vec<(String, String)> = own_env.iter().chain(env.iter()).filter(|(k, _)| crate::chat::HOME_KEYS.contains(&k.as_str())).cloned().collect();
        let chat_cwd = cwd.clone();
        // ACCT-049: checked before the lock, so a drive that does not answer holds up only this pane.
        if let Some(dir) = cwd.as_deref() {
            check_start_dir(dir, program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty() && !is_shell_program(p)))?;
        }
        // ACCT-046: a program runs as asked; a shell pane has a line of fallbacks behind the
        // chosen default shell (SET-026), when there is one.
        let mut commands = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => vec![program_command(p, &args, cwd.as_deref())],
            None => shell_commands(cwd.as_deref(), shell),
        };
        // APP-041: each session's start and end go to the app's own log (no arguments: they may carry secrets).
        let log_dir = app.path().app_data_dir().ok();
        // ACCT-047: a shell pane's shell prints prompt marks (its own files still run first), so the pane
        // can hold its output until the prompt and type a startup command once, when the shell is ready.
        if program.as_deref().map(str::trim).is_none_or(str::is_empty) {
            if let Some(shim_dir) = log_dir.as_deref().map(|d| shell_hook_dir(&d.join("shell"))) {
                for c in commands.iter_mut() {
                    crate::shell_marks::apply(c, &shim_dir);
                }
            }
        }
        // TERM-119: a bash, zsh or fish shell keeps its history per worktree unless the user turned that off.
        // The disk work is done here, before the lock, so a slow folder holds up only this pane.
        let history_vars = match log_dir.as_deref().filter(|_| per_worktree_history) {
            Some(dir) => crate::shell_history::plan(&commands, dir, crate::shell_history::system_fish_dir(), &|name| own_env.iter().chain(env.iter()).any(|(k, _)| k == name)),
            None => vec![None; commands.len()],
        };
        let (mut inner, id) = self.claim_id()?;
        let history = pane_key.and_then(|k| log_dir.as_deref().and_then(|d| History::open(d, k)));
        let label = program.clone().unwrap_or_else(|| "shell".to_string());
        let exit_app = app;
        // Council MERGE 51: a shell (a chosen default shell too, SET-026) stays a plain terminal, not a program session.
        let is_program = program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty() && !is_shell_program(p));
        let link_dir = cwd.clone();
        let key = crate::cli::secret();
        let strip_key = crate::claude_key::strip_inherited(program.as_deref(), &env);
        for (command, history_var) in commands.iter_mut().zip(history_vars) {
            // APP-020 on macOS and Linux: what the login shell sets (read at startup), so tools set up in
            // a profile script are found as in a terminal outside Kolux.
            for (k, v) in crate::login_env::get() {
                command.env(k, v);
            }
            // ACCT-048: an ordinary terminal's environment: none of Kolux's own runtime or build
            // variables, no conda activation that came along only in part, no prompt-theme wizard.
            for (k, _) in std::env::vars_os() {
                if k.to_str().is_some_and(inherited_noise) {
                    command.env_remove(k);
                }
            }
            command.env("POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD", "true");
            // STAT-001: the pane's programs and their hooks know which pane to report for. Set first:
            // the hooks find their pane by KOLUX_HOOK_IDENTITY and only check that KOLUX_PANE_KEY is set,
            // so the command line's handle and pane key below (CLI-007, ORCH-013) take those two names.
            if let (Some(pane), Some(hooks)) = (pane_key, exit_app.try_state::<crate::hooks::Hooks>()) {
                for (k, v) in hooks.pane_env(pane, id) {
                    command.env(k, v);
                }
            }
            command.env("KOLUX_TERMINAL_HANDLE", handle_of(id));
            command.env("KOLUX_PANE_KEY", &key);
            // TERM-120: a new terminal's PATH is the one Windows would give a program started from the
            // desktop now (the machine then the user Path from the registry, expanded), so a folder added
            // in Windows settings reaches the next pane without restarting Kolux and the folders a dev run
            // put on Kolux's own PATH stay out; an unreadable registry keeps the last good read. The CLI
            // folder below goes in front of it, and the user's own variables (SET-027) still win after.
            if cfg!(windows) {
                let fresh = crate::pty::fresh_terminal_path(command.get_env("PATH").map(std::ffi::OsStr::to_os_string));
                command.env("PATH", fresh);
            }
            // CLI-007: the CLI that ships with this copy of Kolux comes first, ahead of any older one
            // registered system-wide, and it is told which app folder to call. An installed copy keeps
            // its CLI in the bin folder of the install (CLI-006); a development build runs kolux-dev
            // from its own folder (T-593: the rule registration and the setup guide share).
            // ponytail: the Linux `kolux` launcher folder lands with that build.
            if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(crate::cli::cli_register::cli_dir)) {
                // T-182 (APP-020): a tool installed after the app started is on the stored Path, not
                // the process's; the pane gets both, the process's entries first.
                let path = cli_first(&dir, Some(crate::lifecycle::fresh_path(command.get_env("PATH").map(std::ffi::OsStr::to_os_string))));
                command.env("PATH", path);
            }
            if let Ok(dir) = tauri::Manager::path(&exit_app).app_data_dir() {
                // CLI-007 / ORCH-054: the pane reaches the Kolux that opened it, so the other-build
                // override (COMPAT 7) it may have inherited from the shell that started Kolux, stripped
                // above with the rest of the noise (CLI-010), is pointed at this app's own folder.
                command.env("KOLUX_USER_DATA_PATH", &dir);
                command.env(crate::cli::APP_DIR_ENV, dir);
            }
            unattended(command, is_program);
            // ACCT-024: a Claude pane not handed the 1-year key drops one Kolux itself was started
            // with (Claude Code prefers the variable over its own login).
            if strip_key {
                command.env_remove(crate::claude_key::ENV);
            }
            // SET-027: the user's variables for this agent; Kolux's account variable below wins.
            for (k, v) in &own_env {
                command.env(k, v);
            }
            for (k, v) in &env {
                command.env(k, v);
            }
            // TERM-119: after the user's own variables, so a history they chose is kept.
            if let Some((k, v)) = history_var {
                command.env(k, v);
            }
        }
        let flow = Arc::new(Flow::default());
        // T-184-b: through the background service when the window is linked to one (a start it
        // refuses runs here instead). The service's events share one reader, so it never waits on a pane.
        let remote = self.linked().and_then(|link| {
            let meta = serde_json::json!({ "id": id, "pane": pane_key, "key": key.clone(), "program": program.clone(), "cwd": cwd.clone() });
            link.spawn(&commands, cols.max(2), rows.max(1), meta).map(|r| (link, r)).ok()
        });
        let (on_output, on_exit) = self.handlers(&exit_app, id, pane_key, link_dir, is_program, remote.is_none().then(|| flow.clone()));
        let mut flush = None;
        let session = match remote {
            Some((link, r)) => {
                link.register(r.id, on_output, on_exit);
                flush = Some((link, r.id));
                Session::Remote(r)
            }
            None => PtySession::spawn_first(commands, cols.max(2), rows.max(1), on_output, on_exit)?.into(),
        };
        inner.sessions.insert(id, session);
        inner.flow.insert(id, flow);
        if let Some(d) = &log_dir {
            crate::diag::write(d, &format!("terminal {id} started ({label})"));
        }
        inner.keys.insert(id, key);
        if let Some(k) = pane_key {
            inner.panes.insert(k, id);
        }
        if let Some(h) = history {
            inner.hist.insert(id, h);
        }
        if is_program {
            let agent = program.as_deref().and_then(crate::tools::credited_program);
            inner.marks.insert(id, Mark { started: Instant::now(), last_output: None, program: program.unwrap_or_default().trim().to_string(), agent, pane: pane_key, home_env, cwd: chat_cwd });
        }
        if let Some(dir) = cwd {
            inner.dirs.insert(id, dir);
        }
        drop(inner);
        if let Some((link, sid)) = flush {
            link.flush(sid);
        }
        Ok(id)
    }

    /// T-184-b: what a session's output and end do in the window, the same for a terminal the window
    /// runs and one the background service runs (started here, or adopted after a restart). With
    /// `flow` the reader waits while the pane is behind (ACCT-054): only a terminal's own reader may.
    #[allow(clippy::too_many_arguments)]
    fn handlers(&self, app: &AppHandle, id: u32, pane_key: Option<u32>, link_dir: Option<String>, is_program: bool, flow: Option<Arc<Flow>>) -> (crate::pty::link::OnOutput, crate::pty::link::OnExit) {
        let (out_app, exit_app) = (app.clone(), app.clone());
        let exit_dir = app.path().app_data_dir().ok();
        let (registry, out_registry) = (self.inner.clone(), self.inner.clone());
        // GIT-026: a pull-request link printed in any pane, hidden or parked ones too, attaches to its workspace.
        let mut prs = crate::scm::PrScan::default();
        (
            Box::new(move |chunk: &[u8]| {
                let data = base64::engine::general_purpose::STANDARD.encode(chunk);
                // ORCH-057: the count is taken under the registry lock with the snapshot tail, so a snapshot
                // holds exactly the chunks whose count is not past its own.
                let seq = out_registry.lock().map(|mut i| i.book_chunk(id, chunk, is_program)).unwrap_or(0);
                let _ = out_app.emit(OUTPUT_EVENT, OutputPayload { id, data, pane: pane_key, generation: generation(), seq });
                if let Some(dir) = link_dir.as_deref() {
                    for url in prs.feed(chunk) {
                        let linked = out_app.state::<Mutex<crate::state::Store>>().lock().is_ok_and(|s| crate::scm::link_printed(&s, dir, &url));
                        if linked {
                            let _ = out_app.emit("settings-saved", ());
                        }
                    }
                }
                // ACCT-054: after the bookkeeping, so no lock is held while the pane catches up.
                if let Some(f) = &flow {
                    f.sent(chunk.len() as u64);
                }
            }),
            Box::new(move |code: Option<u32>| {
                // Drop the session so the PTY closes and the reader thread can finish. A session
                // still listed ended by itself: Kolux's own kills take it off the list first.
                let mut by_itself = false;
                let mut tail = None;
                let mut session = None;
                let mut removed = None;
                if let Ok(mut inner) = registry.lock() {
                    // AUTO-014: keep the end of a followed run's output before the log goes.
                    tail = inner.logs.get(&id).map(|l| crate::automations::screen_text(&l.read(None, Some(crate::automations::RUN_OUTPUT_LINES))));
                    session = inner.marks.get(&id).and_then(|m| m.agent).zip(tail.as_ref()).and_then(|(agent, (text, _))| session_id::hint_session(agent, text));
                    removed = inner.sessions.remove(&id);
                    by_itself = removed.is_some();
                    inner.dirs.remove(&id);
                    inner.marks.remove(&id);
                    inner.keys.remove(&id);
                    inner.ended.insert(id);
                    inner.logs.remove(&id);
                    inner.owned.remove(&id);
                    inner.hist.remove(&id);
                    inner.snaps.remove(&id);
                    if let Some(f) = inner.flow.remove(&id) {
                        f.release();
                    }
                }
                // Row 784: the PTY closes here, not under the registry the pump needs.
                drop(removed);
                // Row 625: a worker's transcript path stays on its dispatch row before its hook sessions go.
                if let Ok(store) = exit_app.state::<Mutex<crate::state::Store>>().lock() {
                    crate::cli::keep_transcript_of(&store, id);
                }
                turns_end(id);
                // AUTO-012: an automation run followed in this pane is over with it.
                crate::automations::follow(&exit_app, |s| {
                    let run = crate::automations::pane_ended(s, id, code, crate::automations::now_ms())?;
                    if let (Some(r), Some((text, cut))) = (&run, &tail) {
                        crate::automations::keep_output(s, r, text, *cut)?;
                    }
                    Ok(run)
                });
                // ORCH-027: a worker's agent that died mid-task tells its coordinator.
                if by_itself && is_program {
                    if let Ok(store) = exit_app.state::<Mutex<crate::state::Store>>().lock() {
                        let _ = crate::cli::worker_exited(&store, id, code, crate::automations::now_ms());
                    }
                }
                if let Some(d) = &exit_dir {
                    crate::diag::write(d, &format!("terminal {id} exited ({code:?})"));
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code, outcome: outcome_of(code), session });
            }),
        )
    }

    /// The newest program session started in window pane `pane` (CHAT-002, CHAT-006).
    pub fn of_pane(&self, pane: u32) -> Option<PaneRun> {
        let inner = self.inner.lock().ok()?;
        let (id, m) = inner.marks.iter().filter(|(_, m)| m.pane == Some(pane)).max_by_key(|(id, _)| **id)?;
        let started = std::time::SystemTime::now().checked_sub(m.started.elapsed()).unwrap_or(std::time::UNIX_EPOCH);
        Some(PaneRun { agent: m.agent, started, wrote: m.last_output.is_some(), alive: !inner.ended.contains(id), home_env: m.home_env.clone(), cwd: m.cwd.clone() })
    }

    /// ACCT-046: the program session `id` actually started.
    pub fn started(&self, id: u32) -> Option<String> {
        self.inner.lock().ok()?.sessions.get(&id).map(|s| s.program().to_string())
    }

    /// CLI-024: what session `id` wrote after `cursor` (none for an open session that wrote nothing yet).
    pub fn read(&self, id: u32, cursor: Option<u64>, limit: Option<usize>) -> Option<Read> {
        let inner = self.inner.lock().ok()?;
        if !inner.sessions.contains_key(&id) {
            return None;
        }
        Some(inner.logs.get(&id).map(|l| l.read(cursor, limit)).unwrap_or_else(|| Read { oldest: 1, ..Read::default() }))
    }

    /// How long session `id` has written nothing (shells included); none when it never wrote.
    pub fn quiet_for(&self, id: u32) -> Option<std::time::Duration> {
        let inner = self.inner.lock().ok()?;
        inner.logs.get(&id).and_then(|l| l.written).map(|t| t.elapsed())
    }

    /// Council D2 MERGE 31 item 1: the registry lock is held only to find the session's writer; the
    /// write itself (which blocks for as long as the program takes to read, ~12 KB/s into ConPTY)
    /// runs under that writer's own lock, so other panes' ack, resize and kill never wait on it.
    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let writer = self.inner.lock().map_err(|e| e.to_string())?.sessions.get(&id).ok_or("no such terminal")?.writer()?;
        crate::pty::write_shared(&writer, data.as_bytes())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.sessions.get(&id).ok_or("no such terminal")?.resize(cols.max(2), rows.max(1))
    }

    /// TERM-045: whether closing session `id` would stop a live program: one started as the pane's
    /// program (an agent) is live while it runs; a shell is live while it has a program of its own
    /// running. A session that has ended, or a check that fails, reads as idle (fails open).
    pub fn busy(&self, id: u32) -> bool {
        let pid = match self.inner.lock() {
            Ok(inner) => match inner.sessions.get(&id) {
                // TERM-132: while a program holds the screen or the mouse the shell is never idle.
                Some(_) if inner.marks.contains_key(&id) || inner.owned.get(&id).is_some_and(|o| *o != 0) => return true,
                Some(s) => s.pid(),
                None => return false,
            },
            Err(_) => return false,
        };
        pid.and_then(crate::procs::has_children).unwrap_or(false)
    }


    /// TERM-116: what Kolux knows about session `id`, as label/value pairs; `None` when it is gone.
    pub fn describe(&self, id: u32) -> Option<Vec<(&'static str, String)>> {
        let inner = self.inner.lock().ok()?;
        let s = inner.sessions.get(&id)?;
        let mut out = vec![("session", id.to_string()), ("pid", s.pid().map_or("unknown".to_string(), |p| p.to_string()))];
        if let Some(d) = inner.dirs.get(&id) {
            out.push(("folder", d.clone()));
        }
        match inner.marks.get(&id) {
            Some(m) => {
                out.push(("program", m.program.clone()));
                out.push(("agent", m.agent.unwrap_or("none").to_string()));
                out.push(("started", format!("{} s ago", m.started.elapsed().as_secs())));
                out.push(("last output", m.last_output.map_or("never".to_string(), |t| format!("{} s ago", t.elapsed().as_secs()))));
            }
            None => out.push(("program", "shell".to_string())),
        }
        let owned = inner.owned.get(&id).copied().unwrap_or(0);
        let screen = match (owned & ALT != 0, owned & MOUSE != 0) {
            (true, true) => "full-screen program with the mouse",
            (true, false) => "full-screen program",
            (false, true) => "program with the mouse",
            (false, false) => "shell",
        };
        out.push(("screen", screen.to_string()));
        out.push(("lines logged", inner.logs.get(&id).map_or(0, |l| l.lines.len()).to_string()));
        out.push(("output paused", inner.flow.get(&id).map_or(0, |f| f.pauses()).to_string()));
        Some(out)
    }

    /// APP-054: every session with its process id and the folder it was started in.
    pub fn list(&self) -> Vec<(u32, Option<u32>, Option<String>)> {
        match self.inner.lock() {
            Ok(inner) => inner.sessions.iter().map(|(id, s)| (*id, s.pid(), inner.dirs.get(id).cloned())).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Ends one session. Its exit event follows from the waiter thread.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let gone = {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            inner.dirs.remove(&id);
            inner.marks.remove(&id);
            inner.keys.remove(&id);
            inner.hist.remove(&id);
            // ORCH-059: the screen bits and snapshot go with the handle at once (the log stays for the
            // waiter, which keeps an automation run's tail and then drops it; `read` already refuses it).
            inner.owned.remove(&id);
            inner.snaps.remove(&id);
            if let Some(f) = inner.flow.remove(&id) {
                f.release();
            }
            inner.sessions.remove(&id)
        };
        // Row 784: the teardown (ClosePseudoConsole) may wait on the pump, which needs the registry.
        if let Some(mut s) = gone {
            s.kill();
        }
        Ok(())
    }

    /// ACCT-054: the pane drew `bytes` more of session `id`'s output. ORCH-057: when the reader gave up
    /// waiting for this pane, the answer is a fresh snapshot to redraw from (once per give-up).
    pub fn ack(&self, id: u32, bytes: u64) -> Option<Snapshot> {
        // AFTER-699: a service terminal's reader waits in the service, so the count goes there (its
        // control connection is used outside the registry lock, like typing).
        let (flow, acker) = {
            let inner = self.inner.lock().ok()?;
            let acker = match inner.sessions.get(&id) {
                Some(Session::Remote(r)) => Some(r.acker()),
                _ => None,
            };
            (inner.flow.get(&id).cloned(), acker)
        };
        let behind = match acker {
            Some(a) => a.ack(bytes),
            None => flow?.ack(bytes),
        };
        if !behind {
            return None;
        }
        let mut inner = self.inner.lock().ok()?;
        Some(inner.snaps.entry(id).or_default().snapshot())
    }

    /// What session `id` runs: `None` when it is gone, `Some(None)` for a shell (the foreground
    /// cannot be told), `Some(Some(agent))` for a program Kolux started (USAGE-007).
    pub fn program(&self, id: u32) -> Option<Option<&'static str>> {
        let inner = self.inner.lock().ok()?;
        // ACCT-050: a shell credits the agent the user started in it by hand.
        inner.sessions.contains_key(&id).then(|| inner.marks.get(&id).and_then(|m| m.agent).or_else(|| crate::foreground::found(id)))
    }

    /// ACCT-050: every session with its process id and foreground process group, for the
    /// foreground poll. T-050-c: program sessions too, so a launch whose program changed (the
    /// agent exited, another was typed) is seen; `program` still reads the launch record first.
    pub fn shells(&self) -> Vec<(u32, Option<u32>, Option<i32>)> {
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        inner.sessions.iter().map(|(id, s)| (*id, s.pid(), s.foreground_group())).collect()
    }

    /// How long the program in `id` has printed nothing (since it started, when it never has), for
    /// the quiet alert (STAT-045). `None` for a shell or a gone session.
    pub fn silence(&self, id: u32) -> Option<std::time::Duration> {
        let inner = self.inner.lock().ok()?;
        inner.marks.get(&id).map(|m| m.last_output.unwrap_or(m.started).elapsed())
    }

    /// ORCH-058: ends every session started in `dir` or a folder under it, each with the processes
    /// it started, and waits up to three seconds for them to be shown gone, so the folder can be
    /// deleted. A record with no process behind it (stale) is swept and never counts as stuck.
    pub fn kill_under(&self, dir: &std::path::Path) -> Stopped {
        let wanted = |d: &str| {
            let d = std::path::Path::new(d);
            let same = |a: &std::path::Path, b: &std::path::Path| a.canonicalize().ok() == b.canonicalize().ok();
            same(d, dir) || d.ancestors().skip(1).any(|a| same(a, dir))
        };
        let found: Vec<(u32, Option<u32>)> = match self.inner.lock() {
            Ok(inner) => inner.dirs.iter().filter(|(_, d)| wanted(d)).map(|(id, _)| (*id, inner.sessions.get(id).and_then(Session::pid))).collect(),
            Err(_) => return Stopped::default(),
        };
        for (id, pid) in &found {
            // The tree first: a dev server the shell started holds the folder as much as the shell.
            if let Some(pid) = pid {
                crate::procs::kill_tree(*pid);
            }
            let _ = self.kill(*id);
        }
        let pids: Vec<u32> = found.iter().filter_map(|(_, p)| *p).collect();
        Stopped { ended: found.len(), stuck: crate::procs::wait_gone(&pids, std::time::Duration::from_secs(3)) }
    }

    /// The open terminal whose secret is `key` (ORCH-001: a pane the runtime saw), by its handle.
    pub fn by_key(&self, key: &str) -> Option<String> {
        if key.is_empty() {
            return None;
        }
        let inner = self.inner.lock().ok()?;
        inner.keys.iter().find(|(_, k)| k.as_str() == key).map(|(id, _)| handle_of(*id))
    }

    /// ORCH-013: the program a terminal was started with, once it has written and then been quiet
    /// for `settle` (fully started; part of a banner is not enough). Shells have none: what is
    /// typed into a shell, or a pane title, proves nothing.
    // ponytail: quiet after first output stands in for an idle detector (the STAT status cards).
    pub fn program_of(&self, handle: &str, settle: std::time::Duration) -> Option<String> {
        let id = id_of(handle)?;
        let inner = self.inner.lock().ok()?;
        let m = inner.marks.get(&id).filter(|_| inner.sessions.contains_key(&id))?;
        m.last_output.filter(|t| t.elapsed() >= settle)?;
        Some(m.program.clone())
    }

    /// CLI-017: every open session as (handle, the folder it started in, its program; none for a shell).
    pub fn sessions(&self) -> Vec<(String, String, Option<String>)> {
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        let mut ids: Vec<u32> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter().filter_map(|id| Some((handle_of(id), inner.dirs.get(&id).cloned()?, inner.marks.get(&id).map(|m| m.program.clone())))).collect()
    }

    /// CLI-023 (T-262-c): every open session with the folder it started in and the program it
    /// runs. A plain shell given no folder started in the home folder (as the PTY falls back), and
    /// its program is the shell that actually started (a fallback when the chosen one did not).
    pub fn every(&self) -> Vec<(String, Option<String>, Option<String>)> {
        let home = crate::pty::home_dir().map(|h| h.to_string_lossy().into_owned());
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        let mut ids: Vec<u32> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter()
            .map(|id| {
                let mark = inner.marks.get(&id);
                let dir = inner.dirs.get(&id).cloned().or_else(|| mark.is_none().then(|| home.clone()).flatten());
                let program = mark.map(|m| m.program.clone()).or_else(|| inner.sessions.get(&id).map(|s| s.program().to_string()));
                (handle_of(id), dir, program)
            })
            .collect()
    }

    /// CLI-023: the window's latest report of its panes and tabs.
    pub fn layout(&self) -> Vec<serde_json::Value> {
        self.layout.lock().map(|l| l.clone()).unwrap_or_default()
    }

    pub fn set_layout(&self, rows: Vec<serde_json::Value>) {
        if let Ok(mut l) = self.layout.lock() {
            *l = rows;
        }
    }

    /// CLI-027: ends a session and waits up to three seconds for its process to be gone; true only
    /// once that is confirmed. A session that had already ended counts as stopped.
    pub fn close(&self, handle: &str) -> bool {
        let Some(id) = id_of(handle) else { return false };
        if !self.live(handle) {
            return true;
        }
        let _ = self.kill(id);
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until {
            if self.inner.lock().map(|mut i| i.ended.remove(&id)).unwrap_or(false) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// The folder terminal `handle` was started in (ORCH-014 checks it for base drift).
    pub fn dir_of(&self, handle: &str) -> Option<String> {
        let id = id_of(handle)?;
        self.inner.lock().ok()?.dirs.get(&id).cloned()
    }

    /// cli FIX-7: a session over a fake writer, for tests in other modules. `program` is the mark
    /// Kolux recorded for it (none for a plain shell); it has been quiet for five seconds.
    #[cfg(any(test, feature = "test-fakes"))]
    pub fn fake_session(&self, id: u32, dir: &str, program: Option<&str>) {
        let long_ago = Instant::now() - Duration::from_secs(5);
        let mut inner = self.inner.lock().unwrap();
        inner.fresh_incarnation(id);
        inner.sessions.insert(id, PtySession::fake(Box::new(std::io::sink())).into());
        inner.dirs.insert(id, dir.to_string());
        inner.logs.insert(id, OutputLog { written: Some(long_ago), ..OutputLog::default() });
        if let Some(program) = program {
            inner.marks.insert(id, Mark { started: long_ago, last_output: Some(long_ago), program: program.into(), agent: None, pane: None, home_env: Vec::new(), cwd: None });
        }
    }

    /// APP-052: the session window pane `pane_key` started in this run, if it still runs.
    pub fn attached(&self, pane_key: u32) -> Option<u32> {
        let inner = self.inner.lock().ok()?;
        let id = *inner.panes.get(&pane_key)?;
        (inner.sessions.contains_key(&id) && !inner.ended.contains(&id)).then_some(id)
    }

    /// Row 211: the process generation of session `id` (changes on every spawn, respawn or adoption of that id), None for an unknown id.
    pub fn process_generation(&self, id: u32) -> Option<u64> {
        self.inner.lock().ok()?.process_gen.get(&id).copied()
    }

    /// Is `handle` an open terminal?
    pub fn live(&self, handle: &str) -> bool {
        let Some(id) = id_of(handle) else { return false };
        self.inner.lock().map(|i| i.sessions.contains_key(&id)).unwrap_or(false)
    }

    /// after-list 697: a new terminal's id, taken only once the service's terminals were taken back,
    /// so an adopted terminal keeps the id its programs and their hooks know it by (the hook
    /// identity names it, and VIEW-025 types an approval into the terminal it names). A pane that
    /// started while the link was still starting used to take that id and push the adopted one off it.
    fn claim_id(&self) -> Result<(std::sync::MutexGuard<'_, Inner>, u32), String> {
        self.wait_linked(LINK_WAIT);
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        let id = inner.next_id;
        inner.fresh_incarnation(id);
        Ok((inner, id))
    }

    /// T-184-b: the link to the background terminal service, while it is up.
    fn linked(&self) -> Option<Arc<crate::pty::link::Link>> {
        match &*self.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) {
            Linking::Linked(l) if l.alive() => Some(l.clone()),
            _ => None,
        }
    }

    /// T-184-b: waits (up to `limit`) while the link is starting, so a pane's question about its
    /// terminal is answered after the service's terminals were taken back.
    fn wait_linked(&self, limit: Duration) {
        let g = self.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = self.service.ready.wait_timeout_while(g, limit, |s| matches!(s, Linking::Starting));
    }

    /// T-184-b (TERM-105, APP-052): links the window to the background terminal service, starting it
    /// when none runs, and takes back the terminals it kept running, on a thread; a pane asking
    /// meanwhile waits (`wait_linked`). Panes then start, type, resize and close through it, and
    /// quitting leaves them running. An installed build only, unless `KOLUX_TERMINAL_SERVICE` says
    /// otherwise (`link::wanted`); without the service, panes run in the window as before.
    pub fn use_service(&self, app: &AppHandle) {
        let release = !cfg!(debug_assertions);
        if !crate::pty::link::wanted(release, std::env::var("KOLUX_TERMINAL_SERVICE").ok().as_deref()) {
            return;
        }
        let Ok(dir) = app.path().app_data_dir() else { return };
        *self.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Linking::Starting;
        *self.service.dir.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(dir.clone());
        let (me, app) = (self.clone(), app.clone());
        std::thread::spawn(move || {
            use crate::pty::service;
            let identifier = app.config().identifier.clone();
            let linked = std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| {
                let (ep, events) = service::ensure(&dir, || service::launch_detached(&exe, &identifier, &dir), service::START_LIMIT)?;
                crate::pty::link::Link::connect(ep, events)
            });
            let state = match linked {
                Ok((link, rows)) => {
                    LINKED.store(link.generation(), std::sync::atomic::Ordering::SeqCst);
                    me.adopt(&app, &link, &rows, &crate::pty::link::take_seen(&dir, link.generation()));
                    crate::diag::write(&dir, &format!("terminal service linked ({} terminals taken back)", rows.len()));
                    Linking::Linked(link)
                }
                Err(e) => {
                    crate::diag::write(&dir, &format!("terminal service not linked, panes run in the window: {e}"));
                    Linking::Off
                }
            };
            *me.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = state;
            me.service.ready.notify_all();
        });
    }

    /// T-184-b (TERM-105): takes back the terminals the service kept running since the last window.
    /// Each keeps its handle, pane, secret, folder and program mark; its pane's saved output gets
    /// what was printed while no window was open (`seen`: what the last window drew, by service id),
    /// so the pane's replay shows it before the pane reattaches.
    fn adopt(&self, app: &AppHandle, link: &Arc<crate::pty::link::Link>, rows: &[serde_json::Value], seen: &HashMap<u32, u64>) {
        use crate::pty::link::{adopted_id, missed, row_tail, Remote};
        let dir = app.path().app_data_dir().ok();
        let mut taken = Vec::new();
        if let Ok(mut inner) = self.inner.lock() {
            for row in rows {
                let Some(remote) = Remote::from_row(link, row, None) else { continue };
                let meta = &row["meta"];
                let as_u32 = |v: &serde_json::Value| v.as_u64().and_then(|n| u32::try_from(n).ok());
                let id = adopted_id(as_u32(&meta["id"]), &|i| inner.sessions.contains_key(&i), inner.next_id + 1);
                inner.next_id = inner.next_id.max(id);
                inner.fresh_incarnation(id);
                let pane = as_u32(&meta["pane"]);
                let program = meta["program"].as_str().map(str::trim).filter(|p| !p.is_empty()).map(str::to_string);
                let is_program = program.as_deref().is_some_and(|p| !is_shell_program(p));
                let cwd = meta["cwd"].as_str().map(str::to_string);
                let (seq, tail) = (row["seq"].as_u64().unwrap_or(0), row_tail(row));
                if let Some(mut h) = pane.and_then(|k| dir.as_deref().and_then(|d| History::open(d, k))) {
                    // after-list 698: without a clean quit's record the saved output's own end says where it stopped.
                    let saved = h.end(crate::pty::link::PROBE);
                    h.append(missed(seen.get(&remote.id).copied(), seq, &tail, &saved));
                    inner.hist.insert(id, h);
                }
                inner.snaps.insert(id, Snap::seeded(seq, &tail));
                inner.logs.entry(id).or_default().push(&tail);
                let (on_output, on_exit) = self.handlers(app, id, pane, cwd.clone(), is_program, None);
                link.register(remote.id, on_output, on_exit);
                taken.push(remote.id);
                if let Some(key) = meta["key"].as_str() {
                    inner.keys.insert(id, key.to_string());
                }
                if let Some(k) = pane {
                    inner.panes.insert(k, id);
                }
                if let Some(p) = program.filter(|_| is_program) {
                    let agent = crate::tools::credited_program(&p);
                    inner.marks.insert(id, Mark { started: Instant::now(), last_output: None, program: p, agent, pane, home_env: Vec::new(), cwd: cwd.clone() });
                }
                if let Some(d) = cwd {
                    inner.dirs.insert(id, d);
                }
                inner.flow.insert(id, Arc::new(Flow::default()));
                inner.sessions.insert(id, Session::Remote(remote));
            }
        }
        for sid in taken {
            link.flush(sid);
        }
    }

    /// T-153-f (VIEW-099): the service link and the service ids of the terminals this window owns;
    /// None when panes run in the window or the window has not finished taking its terminals back.
    fn host(&self) -> Option<(Arc<crate::pty::link::Link>, HashSet<u32>)> {
        self.wait_linked(Duration::from_secs(3));
        let link = match &*self.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) {
            Linking::Linked(l) => l.clone(),
            _ => return None,
        };
        let owned = self.inner.lock().ok()?.sessions.values().filter_map(|s| if let Session::Remote(r) = s { Some(r.id) } else { None }).collect();
        Some((link, owned))
    }

    /// Ends every session the window runs: the window is closing. T-184-b: the ones the background
    /// service runs go on (DT-C27 reversed); the window lets go of them and records how much of
    /// each one's output it drew, so the next window adds only what it missed.
    pub fn kill_all(&self) {
        crate::automations::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
        self.let_go();
    }

    /// AFTER-696: the restart to update. The installer replaces the program the background service
    /// runs from, so the service and its shells end too (update_restart: "the shells end") instead
    /// of holding the old program open. Coordinator default; Txais may overrule. False when the
    /// service was still answering at the deadline (true when no service dir is known).
    pub fn end_for_update(&self) -> bool {
        self.kill_all();
        self.stop_service(UPDATE_STOP_LIMIT)
    }

    /// Stops the linked service within `limit`. The dir is forgotten once it is stopped, so the
    /// installer's before-exit hook (second call on the quit path) returns at once; a failed stop
    /// keeps it, so a retry stops again. Only `use_service` (at startup) stores it.
    fn stop_service(&self, limit: Duration) -> bool {
        let Some(dir) = self.service.dir.lock().ok().and_then(|d| d.clone()) else { return true };
        let stopped = crate::pty::service::stop(&dir, limit);
        if stopped {
            *self.service.dir.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        }
        stopped
    }

    /// `kill_all` without the app-wide quitting flag (a test runs it alone).
    fn let_go(&self) {
        let link = match std::mem::take(&mut *self.service.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)) {
            Linking::Linked(l) => Some(l),
            _ => None,
        };
        if let Some(l) = &link {
            l.detach();
        }
        let mut gone = Vec::new();
        if let Ok(mut inner) = self.inner.lock() {
            let seen: Vec<(u32, u64)> = inner.sessions.iter().filter_map(|(id, s)| if let Session::Remote(r) = s { Some((r.id, inner.snaps.get(id).map_or(0, |n| n.seq))) } else { None }).collect();
            let dir = self.service.dir.lock().ok().and_then(|d| d.clone());
            if let (Some(l), Some(dir), false) = (&link, dir, seen.is_empty()) {
                crate::pty::link::write_seen(&dir, l.generation(), &seen);
            }
            inner.dirs.clear();
            inner.keys.clear();
            inner.hist.clear();
            inner.snaps.clear();
            for (_, f) in inner.flow.drain() {
                f.release();
            }
            gone.extend(inner.sessions.drain().map(|(_, s)| s));
        }
        // Row 784: killed after the registry is released (a teardown may wait on the pump).
        for s in gone {
            if let Session::Local(mut s) = s {
                s.kill();
            }
        }
    }
}

/// T-548-b: the managed account a new pane runs under: the Codex account when there is one, else the
/// active Claude account when the pane got that account's folder (not on the 1-year key, not on Claude's
/// own sign-in). `claude_active` is read only for a managed Claude pane.
pub(crate) fn spawn_account(codex: Option<String>, claude_managed: bool, claude_active: impl FnOnce() -> Option<String>) -> Option<String> {
    codex.or_else(|| if claude_managed { claude_active() } else { None })
}

/// What `terminal_spawn` answers: the session id and, for a Codex or Claude pane, the managed account it
/// runs on (ACCT-023: the pane remembers it; none for the agent's own sign-in).
#[derive(serde::Serialize)]
pub struct Spawned {
    pub id: u32,
    /// ACCT-046: the program the pane actually started (it names a fallback shell).
    pub program: Option<String>,
    pub account: Option<String>,
}

/// APP-052: which run of the terminal service answers, and what it speaks.
#[derive(serde::Serialize)]
pub struct ServiceInfo {
    pub generation: u64,
    pub protocol: u32,
}

/// T-184-b: async, and answered once the window has linked to the background service (when it
/// uses one), so the pane gets the service's run.
#[tauri::command(async)]
pub fn terminal_service_info(terminals: tauri::State<'_, Terminals>) -> ServiceInfo {
    terminals.wait_linked(LINK_WAIT);
    ServiceInfo { generation: generation(), protocol: PROTOCOL }
}

/// APP-052: what a pane gets when it asks for its terminal back.
#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct Attach {
    /// "attached" with the id when this run still runs the pane's terminal; "fresh" when nothing
    /// runs for the pane (start one; TERM-106 replays its history); "replaced" when the pane asked
    /// for another run's terminal (its typing must not reach ours until it has reattached).
    pub state: &'static str,
    pub id: Option<u32>,
    pub generation: u64,
    pub protocol: u32,
}

/// APP-052: the attach answer, pure: `ours` is this run's generation, `running` the pane's live
/// session in it, `asked` the generation the pane believes owns its terminal.
pub fn attach_answer(ours: u64, running: Option<u32>, asked: u64) -> Attach {
    let answer = |state, id| Attach { state, id, generation: ours, protocol: PROTOCOL };
    if asked != ours {
        return answer("replaced", None);
    }
    match running {
        Some(id) => answer("attached", Some(id)),
        None => answer("fresh", None),
    }
}

/// APP-052: a pane asks for the terminal it had before the window reloaded. Async so the registry
/// lock is taken off the window's thread.
#[tauri::command(async)]
pub fn terminal_attach(terminals: tauri::State<'_, Terminals>, pane_key: u32, generation: u64) -> Attach {
    terminals.wait_linked(LINK_WAIT);
    attach_answer(self::generation(), terminals.attached(pane_key), generation)
}

/// TERM-115: async for the same reason as `terminal_write`: starting a console host can take a
/// while on a loaded machine and must not hold the window's thread.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn terminal_spawn(app: AppHandle, terminals: tauri::State<'_, Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, cols: u16, rows: u16, cwd: Option<String>, start: Option<String>, program: Option<String>, args: Option<Vec<String>>, env: Option<Vec<(String, String)>>, pane_key: Option<u32>, account: Option<String>) -> Result<Spawned, String> {
    // TERM-040: `cwd` is the workspace folder; `start` may ask for a folder relative to it.
    let cwd = cwd.map(|w| start_dir(&w, start.as_deref()));
    // ACCT-023: a resumed Codex pane runs on the account it began on, or not at all.
    let codex = program.as_deref().and_then(crate::tools::credited_program) == Some("codex");
    let resumed = match account.as_deref().filter(|_| codex) {
        Some(id) => Some(crate::codex_accounts::wait_home(&store, id)?),
        None => None,
    };
    // ACCT-004: a Claude pane in key mode is handed the 1-year key; nothing else ever is.
    // ACCT-005: otherwise a Claude pane runs on the active managed account's own folder.
    let env_own = env.unwrap_or_default();
    let pinned = resumed.is_some();
    #[allow(clippy::type_complexity)]
    let (env, cap, account, hooks_on, plain, per_worktree_history): (Vec<(String, String)>, bool, Option<String>, bool, Option<serde_json::Value>, bool) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        // SET-026: a plain new terminal opens in the chosen default shell; the search for it on
        // PATH runs after the lock is let go (council), with the settings read here.
        let plain = program.is_none().then(|| settings.clone());
        let used = codex.then(|| account.clone().or_else(|| crate::codex_accounts::active_account(&store).map(|a| a.id))).flatten();
        let codex_home = resumed.or_else(|| crate::codex_accounts::active_home(&store));
        let token = crate::secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(serde_json::Value::as_str) == Some(crate::claude_key::KEY_MODE);
        let by_key = crate::claude_key::pane_env(program.as_deref(), &settings, token);
        let managed = if by_key.is_none() { crate::claude_accounts::pane_env(program.as_deref(), key_mode, crate::claude_accounts::active_dir(&store)) } else { None };
        // T-548-b: a Claude pane on a managed account answers which one, the way a Codex pane does.
        let used = spawn_account(used, managed.is_some(), || crate::claude_accounts::active(&store));
        let env: Vec<(String, String)> = by_key
            .or(managed)
            // ACCT-007: a Codex pane runs in the active Codex account's private home.
            .or_else(|| crate::codex_accounts::pane_env(program.as_deref(), codex_home))
            // ACCT-008: a Grok pane gets the saved xAI key; Grok itself prefers its own sign-in.
            .or_else(|| crate::grok::pane_env(program.as_deref(), crate::secrets::read_setting(&store, crate::grok::KEY_FIELD).ok().flatten()))
            .map(|(k, v)| (k.to_string(), v))
            .into_iter()
            .collect();
        (env, crate::cap::on(&settings), used, crate::hooks::agent_hooks::switch::on(&settings), plain, crate::shell_history::enabled(&settings))
    };
    let shell = plain.and_then(|s| crate::pty::default_shell(&s));
    // ACCT-024: on a managed Claude account, the user's own settings may not sign the pane in.
    if env.iter().any(|(k, _)| k == crate::claude_accounts::CONFIG_ENV) {
        let found = crate::claude_accounts::sign_in_overrides(&env_own, cfg!(windows));
        if !found.is_empty() {
            return Err(format!("This Claude pane runs on your managed account, but your Claude settings set {}. Remove those overrides in Settings > Agents and open it again.", found.join(", ")));
        }
    }
    let mut env = env;
    // ACCT-024: a Codex pane waits (about two seconds) for the chosen account's sign-in.
    // ponytail: blocks one async worker while it waits; a timer-based wait if panes queue up.
    if let Some(i) = env.iter().position(|(k, _)| k == crate::codex_accounts::HOME_ENV).filter(|_| !pinned) {
        let active = || store.lock().ok().and_then(|s| crate::codex_accounts::active_home(&s));
        let signed_in = |h: &str| std::path::Path::new(h).join("auth.json").is_file();
        match crate::codex_accounts::ready_home(active, signed_in, crate::codex_accounts::SIGN_IN_WAIT, std::time::Duration::from_millis(100))? {
            Some(home) => env[i].1 = home,
            None => drop(env.remove(i)),
        }
    }
    // USAGE-006: the 200k cap, added at start so the pane's saved start line stays free of it.
    let mut args = args.unwrap_or_default();
    if cap {
        crate::cap::apply(program.as_deref(), &mut args, &mut env, crate::cap::env_set());
    }
    // STAT-008: a managed Codex home gets Kolux's hooks (and their trust) before Codex reads it,
    // unless the status hooks are switched off (STAT-002).
    if let Some((_, home)) = env.iter().find(|(k, _)| k == crate::codex_accounts::HOME_ENV) {
        // ACCT-021: the user's own Codex settings first; a failed copy never stops the launch.
        let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(std::path::PathBuf::from);
        let own = crate::codex_accounts::user_dir(std::env::var(crate::codex_accounts::HOME_ENV).ok().as_deref(), user.as_deref());
        if let Some(own) = own.filter(|o| o.as_path() != std::path::Path::new(home)) {
            if let Err(e) = crate::codex_accounts::sync_settings(&own, std::path::Path::new(home)) {
                eprintln!("kolux-rs: codex settings: {e}");
            }
        }
        if hooks_on {
            crate::hooks::install_codex_home(std::path::Path::new(home));
        }
    }
    let agent = program.as_deref().and_then(crate::tools::credited_program);
    let dir = cwd.clone();
    // T-172-e: a worker start puts its dispatch id in the first session's environment; the start that is
    // waiting for it learns which session that is (only a start still waiting is told).
    // cli FIX-7: the last such entry in the environment names the dispatch (the window appends its own).
    // cli FIX-8: spawn_stamped reads it before the environment is handed over and stamps the new
    // session once the spawn succeeded (cli.rs fix8_d).
    let id = crate::cli::spawn_stamped(crate::cli::dispatch_in(&env_own), || terminals.spawn(app.clone(), cols, rows, cwd, program, args, env_own, env, pane_key, shell, per_worktree_history))?;
    // AUTO-012: an automation run dispatched to this worktree for this agent is followed here.
    if let Some(dir) = dir {
        crate::automations::follow(&app, |s| crate::automations::claim(s, id, pane_key, &dir, agent));
    }
    Ok(Spawned { id, program: terminals.started(id), account })
}

/// T-153-f (VIEW-099): the terminals the background service holds that this window does not own,
/// for Manage Sessions. Empty when panes run in the window or the window is still taking its
/// terminals back (none of them is offered before it has).
#[tauri::command]
pub async fn terminal_host_sessions(terminals: tauri::State<'_, Terminals>) -> Result<Vec<crate::pty::link::HostSession>, String> {
    let me = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match me.host() {
        Some((link, owned)) => link.unowned(&owned),
        None => Ok(Vec::new()),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// T-153-f (VIEW-099): ends background session `id` (its id in the service) that no window owns.
/// False when it had already ended; a pane's own, an agent's or a busy one is refused.
#[tauri::command]
pub async fn terminal_host_end(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<bool, String> {
    let me = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match me.host() {
        Some((link, owned)) => link.end_unowned(id, &owned),
        None => Ok(false),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// TERM-045: for each id, whether closing it would stop a live program.
#[tauri::command]
pub fn terminal_busy(terminals: tauri::State<'_, Terminals>, ids: Vec<u32>) -> Vec<bool> {
    ids.into_iter().map(|id| terminals.busy(id)).collect()
}

/// TERM-115: async, so a pipe write that blocks (a program not reading its input) holds a
/// runtime worker, never the window's thread; typing elsewhere stays responsive.
#[tauri::command]
pub async fn terminal_write(app: AppHandle, terminals: tauri::State<'_, Terminals>, id: u32, data: String, generation: Option<u64>) -> Result<(), String> {
    // APP-052: typing carries the run of the service it was meant for; a replaced run's typing is refused.
    owns(generation)?;
    // STAT-028: Ctrl+C or Escape on its own, while the agent works, marks the coming Stop interrupted.
    if data == "\x03" || data == "\x1b" {
        crate::status::cancel(id);
    }
    // USAGE-007: the user's own typing after a limit stop cancels the resume.
    crate::resume::user_typed(&app, id);
    // ORCH-055: a prompt the command line is typing holds its Enter back once the user writes here.
    crate::orchestration::sendonce::other_writer(id, &data);
    terminals.write(id, &data)
}


/// TERM-116: a snapshot of one session for a bug report, secrets and the home folder masked.
#[tauri::command]
pub fn terminal_diagnostics(app: AppHandle, terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16, renderer: String, screen: Vec<String>) -> Result<String, String> {
    let mut head = terminals.describe(id).ok_or_else(|| format!("terminal {id} is not running"))?;
    head.push(("app", app.package_info().version.to_string()));
    head.push(("size", format!("{cols}x{rows}, {renderer}")));
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    Ok(diagnostics_text(&head, &screen, home.as_deref()))
}

/// Council D2 MERGE 31 item 1: `async` so the registry lock is taken off the main thread; the
/// window keeps drawing while another pane's paste is in flight.
#[tauri::command(async)]
pub fn terminal_resize(terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terminals.resize(id, cols, rows)
}

/// ACCT-054: the pane drew `bytes` more of session `id`'s output.
/// Council D2 MERGE 31 item 1: `async` for the same reason as `terminal_resize`.
#[tauri::command(async)]
pub fn terminal_ack(terminals: tauri::State<'_, Terminals>, id: u32, bytes: u64) -> Option<Snapshot> {
    terminals.ack(id, bytes)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProfile {
    pub profile: &'static str,
    pub total_mb: u64,
    pub scrollback: u32,
}

/// ACCT-059: the memory profile this machine gets, and the scrollback each pane keeps under it.
#[tauri::command]
pub fn terminal_memory_profile() -> MemoryProfile {
    let total = total_memory();
    let (profile, scrollback) = profile_for(total);
    MemoryProfile { profile, total_mb: total.unwrap_or(0) >> 20, scrollback }
}

/// TERM-137: this build's shell hook files live in a folder named after their contents (FNV-1a of every
/// shim text) under `<lasting data folder>/shell`, so two builds that share the data folder never write
/// over each other's files and a shell never mixes halves from two builds. A folder another build left
/// there is kept untouched and never loaded (each shell is pointed at its own build's folder only);
/// `shell_marks::apply` writes a missing file again on every pane start while the host runs.
fn shell_hook_dir(base: &std::path::Path) -> std::path::PathBuf {
    use crate::shell_marks::{wrap, ShellKind};
    let texts = [ShellKind::Zsh, ShellKind::Bash, ShellKind::Fish].into_iter().flat_map(|k| wrap(k, &[], std::path::Path::new(""), None, None).files).map(|(_, t)| t);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in texts.flat_map(String::into_bytes) {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    base.join(format!("{h:016x}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-184-b: quitting ends the panes the window runs and leaves the service's running, after
    /// recording how much of each one's output the window drew (by its id in the service).
    #[test]
    fn t184b_quitting_leaves_the_service_terminals_running_and_records_what_was_drawn() {
        use crate::pty::link::{read_seen, tests as svc};
        let (r, dir) = svc::start("quit");
        let (link, _) = svc::link(&r);
        let remote = link.spawn(&svc::shell(), 80, 24, serde_json::json!({})).unwrap();
        let sid = remote.id;
        let t = Terminals::default();
        {
            let mut inner = t.inner.lock().unwrap();
            inner.sessions.insert(1, Session::Remote(remote));
            inner.snaps.insert(1, Snap::seeded(40, b"abc"));
            inner.sessions.insert(2, PtySession::fake(Box::new(std::io::sink())).into());
        }
        *t.service.state.lock().unwrap() = Linking::Linked(link.clone());
        *t.service.dir.lock().unwrap() = Some(dir.clone());
        assert!(t.linked().is_some());
        t.let_go();
        assert!(t.inner.lock().unwrap().sessions.is_empty());
        assert!(t.linked().is_none(), "the window let go of the service");
        assert_eq!(r.service.counts().0, 1, "the service's terminal goes on");
        assert_eq!(read_seen(&dir, link.generation()), HashMap::from([(sid, 40)]));
        assert_eq!(Snap::seeded(40, b"abc").push(b"d"), 41, "a taken-back terminal counts on from the service's count");
        drop(r);
        let _ = std::fs::remove_dir_all(dir);
    }


    /// Row 1031/M2: the quit path ends the service twice (install_on_quit, then the installer's hook); the second finds it done.
    #[test]
    fn row1031_a_second_service_stop_finds_it_done_and_returns_at_once() {
        let dir = std::env::temp_dir().join(format!("kolux-row1031-stop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let t = Terminals::default();
        assert!(t.stop_service(Duration::from_secs(2)), "no service is known: nothing to stop");
        *t.service.dir.lock().unwrap() = Some(dir.clone());
        assert!(t.stop_service(Duration::from_secs(2)), "no endpoint in the dir: stopped");
        assert!(t.service.dir.lock().unwrap().is_none(), "a stopped service's dir is forgotten");
        let again = std::time::Instant::now();
        assert!(t.stop_service(Duration::from_secs(2)));
        assert!(again.elapsed() < Duration::from_millis(200), "{:?}", again.elapsed());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// after-list 697: a terminal started while the window is still taking the service's terminals
    /// back waits for that, so it never takes the id an adopted terminal (and its hooks) carry.
    #[test]
    fn after697_a_new_terminal_waits_for_the_adoption_and_never_takes_an_adopted_id() {
        let t = Terminals::default();
        *t.service.state.lock().unwrap() = Linking::Starting;
        let early = t.clone();
        let claim = std::thread::spawn(move || early.claim_id().map(|(_, id)| id).unwrap());
        std::thread::sleep(Duration::from_millis(150));
        {
            // what `adopt` does for a terminal the service kept: it keeps its id 1
            let mut inner = t.inner.lock().unwrap();
            let id = crate::pty::link::adopted_id(Some(1), &|i| inner.sessions.contains_key(&i), inner.next_id + 1);
            assert_eq!(id, 1, "the adopted terminal keeps the id its hooks know");
            inner.next_id = inner.next_id.max(id);
            inner.sessions.insert(id, PtySession::fake(Box::new(std::io::sink())).into());
        }
        *t.service.state.lock().unwrap() = Linking::Off;
        t.service.ready.notify_all();
        assert_eq!(claim.join().unwrap(), 2, "the pane that asked meanwhile gets the next free id");
    }

    /// TERM-137: hook files of one build go to a folder named after their contents; a folder another build
    /// left beside it is kept exactly as it was when this build writes its hooks again.
    #[test]
    fn term137_each_build_keeps_its_hook_files_in_a_content_named_folder_beside_other_builds() {
        let base = std::env::temp_dir().join(format!("kolux-term137-{}", std::process::id())).join("shell");
        let _ = std::fs::remove_dir_all(base.parent().unwrap());
        let own = shell_hook_dir(&base);
        assert_eq!(own, shell_hook_dir(&base), "the same build names the same folder");
        let name = own.file_name().unwrap().to_string_lossy().into_owned();
        assert!(own.parent() == Some(base.as_path()) && name.len() == 16 && name.bytes().all(|b| b.is_ascii_hexdigit()), "{name}");
        let foreign = base.join("0123456789abcdef").join("zsh").join(".zshrc");
        std::fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        std::fs::write(&foreign, "older build's hooks").unwrap();
        for _ in 0..2 {
            let mut zsh = portable_pty::CommandBuilder::new("/bin/zsh");
            assert_eq!(crate::shell_marks::apply(&mut zsh, &own), Some(crate::shell_marks::ShellKind::Zsh));
            let zdotdir = zsh.get_env("ZDOTDIR").unwrap().to_string_lossy().into_owned();
            assert!(zdotdir.contains(&name) && !zdotdir.contains("0123456789abcdef"), "zsh reads this build's folder only: {zdotdir}");
        }
        assert!(own.join("zsh").join(".zshrc").is_file(), "this build's hooks are on disk");
        assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "older build's hooks", "the other build's file is untouched");
        std::fs::remove_file(own.join("zsh").join(".zshrc")).unwrap();
        let mut zsh = portable_pty::CommandBuilder::new("zsh");
        crate::shell_marks::apply(&mut zsh, &own);
        assert!(own.join("zsh").join(".zshrc").is_file(), "a hook file that went missing is written again on the next pane start");
        let _ = std::fs::remove_dir_all(base.parent().unwrap());
    }

    /// ACCT-053: the redraw buffer of a restored pane never starts inside a wide character. A tail with a
    /// line break starts after it; one without (a single huge line) starts at the next character boundary.
    #[test]
    fn acct053_history_trim_never_cuts_a_wide_character_in_two() {
        let text = "ab\n中文字 日本語 end".as_bytes();
        let kept = trim_history(text, text.len() - 2);
        assert_eq!(std::str::from_utf8(kept).unwrap(), "中文字 日本語 end", "a line break in the tail: start after it");
        let line = "中文字 日本語 end".as_bytes(); // 中 = E4 B8 AD; keep lands inside it
        for keep in [line.len() - 1, line.len() - 2] {
            let kept = trim_history(line, keep);
            let s = std::str::from_utf8(kept).expect("a character boundary");
            assert_eq!(s, "文字 日本語 end", "keep={keep}");
        }
        assert_eq!(trim_history(line, line.len()), line);
        assert_eq!(std::str::from_utf8(trim_history(line, 3)).unwrap(), "end");
    }

    /// APP-052: a pane gets its terminal back only from the run that started it: attached while the
    /// session runs, fresh once it ended or never was, replaced when the pane asked for another run.
    #[test]
    fn t075_c_attach_answers_attached_fresh_or_replaced_by_generation() {
        let t = Terminals::default();
        t.fake_session(7, "C:/w", None);
        t.inner.lock().unwrap().panes.insert(3, 7);
        t.inner.lock().unwrap().panes.insert(4, 8); // pane 4's session is gone
        let ours = generation();
        assert_eq!(attach_answer(ours, t.attached(3), ours), Attach { state: "attached", id: Some(7), generation: ours, protocol: PROTOCOL });
        assert_eq!(attach_answer(ours, t.attached(4), ours), Attach { state: "fresh", id: None, generation: ours, protocol: PROTOCOL });
        assert_eq!(attach_answer(ours, t.attached(3), ours - 1), Attach { state: "replaced", id: None, generation: ours, protocol: PROTOCOL });
        assert_eq!(t.attached(5), None, "a pane that never started anything");
        t.inner.lock().unwrap().ended.insert(7);
        assert_eq!(t.attached(3), None, "an ended session is not handed back");
    }

    /// APP-052: the generation is one number for the whole run, fits a JS number, and typing from
    /// another run is refused while typing without one (older callers) still goes through.
    #[test]
    fn t075_c_generation_is_fixed_and_typing_from_a_replaced_run_is_refused() {
        assert_eq!(generation(), generation());
        assert!(generation() > 0 && generation() < (1u64 << 53));
        assert!(owns(None).is_ok());
        assert!(owns(Some(generation())).is_ok());
        let err = owns(Some(generation() ^ 1)).unwrap_err();
        assert!(err.contains("replaced") && err.contains("reattach"), "{err}");
    }

    /// Council D2 MERGE 31 item 1: a pane whose program takes its input slowly (ConPTY reads a
    /// paste at ~12 KB/s) must not hold the registry while the write blocks, or every other
    /// pane's ack, resize and kill wait behind it on the main thread.
    #[test]
    fn merge31_slow_write_to_one_pane_does_not_block_another_panes_bookkeeping() {
        /// A program that takes 600 ms to read whatever it is given.
        struct Slow;
        impl std::io::Write for Slow {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                std::thread::sleep(Duration::from_millis(600));
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let t = Arc::new(Terminals::default());
        {
            let mut inner = t.inner.lock().unwrap();
            inner.sessions.insert(1, PtySession::fake(Box::new(Slow)).into());
            inner.sessions.insert(2, PtySession::fake(Box::new(std::io::sink())).into());
            inner.flow.insert(2, Arc::new(Flow::default()));
        }
        let slow = Arc::clone(&t);
        let paste = std::thread::spawn(move || slow.write(1, &"x".repeat(70_000)));
        std::thread::sleep(Duration::from_millis(100));
        let start = Instant::now();
        t.write(2, "y").expect("the other pane's key goes through");
        t.ack(2, 1);
        assert_eq!(t.resize(2, 80, 24), Err("session already closed".to_string()), "a fake has no PTY to resize, but the call returns at once");
        assert!(t.inner.lock().unwrap().sessions.contains_key(&2), "the registry itself is free");
        let waited = start.elapsed();
        assert!(waited < Duration::from_millis(300), "pane 2's bookkeeping waited {waited:?} behind pane 1's 600 ms write");
        paste.join().unwrap().expect("the slow write still completes");
    }

    /// Row 784: runs `close` on a pane whose teardown stalls (like ClosePseudoConsole waiting on a
    /// pipe drain that needs the registry) and says whether a second registry call finished meanwhile.
    fn registry_free_during_stalled_close(close: impl FnOnce(Arc<Terminals>) + Send + 'static) -> bool {
        use std::sync::mpsc;
        struct StallsOnClose(mpsc::Sender<()>, Arc<(Mutex<bool>, Condvar)>);
        impl std::io::Write for StallsOnClose {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        impl Drop for StallsOnClose {
            fn drop(&mut self) {
                let _ = self.0.send(());
                let (open, cv) = &*self.1;
                let guard = open.lock().unwrap();
                let _ = cv.wait_timeout_while(guard, Duration::from_secs(10), |o| !*o);
            }
        }
        let t = Arc::new(Terminals::default());
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (entered_tx, entered_rx) = mpsc::channel();
        t.inner.lock().unwrap().sessions.insert(1, PtySession::fake(Box::new(StallsOnClose(entered_tx, Arc::clone(&gate)))).into());
        let closer = Arc::clone(&t);
        let closing = std::thread::spawn(move || close(closer));
        let stalled = entered_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        let (done_tx, done_rx) = mpsc::channel();
        let prober = Arc::clone(&t);
        let probe = std::thread::spawn(move || {
            let _ = prober.list();
            let _ = done_tx.send(());
        });
        let free = done_rx.recv_timeout(Duration::from_secs(2)).is_ok();
        // Release the stall first, so a failing run still ends both threads.
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        closing.join().unwrap();
        probe.join().unwrap();
        assert!(stalled, "the close never reached the stalled teardown");
        assert!(t.list().is_empty(), "the closed pane is off the registry");
        free
    }

    #[test]
    fn row784_a_stalled_pane_close_does_not_hold_the_registry() {
        assert!(registry_free_during_stalled_close(|t| t.kill(1).unwrap()), "list() waited behind a stalled kill");
    }

    #[test]
    fn row784_a_stalled_quit_close_does_not_hold_the_registry() {
        assert!(registry_free_during_stalled_close(|t| t.let_go()), "list() waited behind a stalled let_go");
    }

    #[test]
    fn acct_054_a_flood_pauses_the_reader_until_the_pane_acknowledges_and_a_silent_pane_only_for_the_wait() {
        let flow = Arc::new(Flow::default());
        // Below the high mark nothing waits.
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH - 1, Duration::from_secs(5));
        assert!(t.elapsed() < Duration::from_millis(500));
        assert_eq!(flow.pauses(), 0);
        // Over it the reader waits until the pane has drawn down to the low mark.
        let acker = flow.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            acker.ack(FLOW_HIGH);
        });
        let t = Instant::now();
        flow.sent_within(1, Duration::from_secs(5));
        let took = t.elapsed();
        h.join().unwrap();
        assert!(took >= Duration::from_millis(90) && took < Duration::from_secs(4), "{took:?}");
        assert_eq!(flow.pauses(), 1);
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
        // A pane that never answers holds the reader for the wait only, then counts as caught up.
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH, Duration::from_millis(100));
        assert!(t.elapsed() >= Duration::from_millis(90));
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
        assert_eq!(flow.pauses(), 2);
        // release() lets a paused reader go at once.
        let releaser = flow.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            releaser.release();
        });
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH, Duration::from_secs(5));
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(4));
    }

    /// ORCH-057: a viewer paused past the wait while output floods is answered, at its next acknowledgement,
    /// with a snapshot it redraws from: the count it covers matches the output events' counts, and it starts
    /// at a line break once the tail lost its start. One snapshot per give-up; a caught-up viewer gets none.
    #[test]
    fn orch057_a_viewer_that_fell_behind_resyncs_from_a_snapshot_once() {
        let t = Terminals::default();
        let flow = Arc::new(Flow::default());
        t.inner.lock().unwrap().flow.insert(3, flow.clone());
        let mut seqs = Vec::new();
        for i in 0..20_000u32 {
            let line = format!("line {i:05} {}\r\n", "z".repeat(40));
            seqs.push(t.inner.lock().unwrap().snaps.entry(3).or_default().push(line.as_bytes()));
            flow.sent_within(line.len() as u64, Duration::from_millis(1));
        }
        assert!(seqs.windows(2).all(|w| w[1] > w[0]), "each chunk's count is past the last");
        assert_eq!(t.ack(3, 0), Some(t.inner.lock().unwrap().snaps.get_mut(&3).unwrap().snapshot()), "the paused viewer resyncs");
        let snap = t.inner.lock().unwrap().snaps.get_mut(&3).unwrap().snapshot();
        assert_eq!(snap.seq, *seqs.last().unwrap(), "the snapshot covers every chunk sent");
        let bytes = base64::engine::general_purpose::STANDARD.decode(&snap.data).unwrap();
        assert!(bytes.len() <= HISTORY_KEEP && bytes.len() > HISTORY_KEEP - 100, "{}", bytes.len());
        assert!(bytes.starts_with(b"line ") && bytes.ends_with(b"line 19999 zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\r\n"), "starts at a line, ends with the newest");
        assert_eq!(t.ack(3, 0), None, "one snapshot per give-up");
        // a viewer that keeps up is never resynced
        let quick = Arc::new(Flow::default());
        t.inner.lock().unwrap().flow.insert(4, quick.clone());
        quick.sent_within(FLOW_HIGH - 1, Duration::from_millis(1));
        assert_eq!(t.ack(4, FLOW_HIGH - 1), None);
        // a young session's snapshot is all it printed, from its first byte
        let mut young = Snap::default();
        young.push(b"no line break yet");
        assert_eq!(young.snapshot(), Snapshot { seq: 17, data: base64::engine::general_purpose::STANDARD.encode(b"no line break yet") });
        assert_eq!(outcome_of(Some(0)), "exited");
        assert_eq!(outcome_of(None), "unverifiable", "an end Kolux could not confirm is not called an exit");
    }

    /// Row 211: every process started under a session id has its own generation, so a pass minted
    /// for the earlier one can be told from the one running now.
    #[test]
    fn orch067_f_a_restarted_session_id_has_a_new_process_generation() {
        let t = Terminals::default();
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(t.process_generation(9), None, "an unknown id");
        t.fake_session(9, &dir, Some("claude"));
        t.fake_session(10, &dir, None);
        let (first, other) = (t.process_generation(9).unwrap(), t.process_generation(10).unwrap());
        assert_ne!(first, other);
        assert_eq!(t.process_generation(9), Some(first), "stable while the process runs");
        t.fake_session(9, &dir, Some("claude"));
        assert_ne!(t.process_generation(9), Some(first), "the reused id is a new process");
        assert_eq!(t.process_generation(10), Some(other), "another pane is untouched");
    }

    /// ORCH-059: a closed terminal is gone from every list and lookup at once, and a session opened again
    /// under the same handle starts as a new terminal with none of the old one's state.
    #[test]
    fn orch059_closing_retires_a_terminal_everywhere_and_a_reused_handle_is_a_new_incarnation() {
        let t = Terminals::default();
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        t.fake_session(9, &dir, Some("claude"));
        {
            let mut inner = t.inner.lock().unwrap();
            inner.keys.insert(9, "secret-9".into());
            inner.owned.insert(9, ALT | MOUSE);
            inner.logs.get_mut(&9).unwrap().push(b"old output\r\n");
            inner.snaps.entry(9).or_default().push(b"old output\r\n");
        }
        let h = handle_of(9);
        assert!(t.live(&h) && t.by_key("secret-9").is_some() && t.read(9, None, None).is_some());
        t.kill(9).unwrap();
        assert!(!t.list().iter().any(|(id, _, _)| *id == 9), "list");
        assert!(!t.sessions().iter().any(|(x, _, _)| *x == h), "sessions");
        assert!(!t.every().iter().any(|(x, _, _)| *x == h), "every");
        assert_eq!(t.by_key("secret-9"), None, "by_key");
        assert_eq!(t.dir_of(&h), None, "dir_of");
        assert_eq!(t.program_of(&h, Duration::ZERO), None, "program_of");
        assert!(!t.live(&h), "live");
        assert!(t.read(9, None, None).is_none(), "read");
        {
            let inner = t.inner.lock().unwrap();
            assert!(!inner.owned.contains_key(&9) && !inner.snaps.contains_key(&9), "screen bits and snapshot went with it");
        }
        // the waiter of the old run marked it ended and its log lingered: a reopened handle sees none of that
        {
            let mut inner = t.inner.lock().unwrap();
            inner.ended.insert(9);
            inner.owned.insert(9, ALT);
            inner.logs.entry(9).or_default().push(b"stale\r\n");
        }
        t.fake_session(9, &dir, None);
        let inner = t.inner.lock().unwrap();
        assert!(!inner.ended.contains(&9) && !inner.owned.contains_key(&9) && !inner.keys.contains_key(&9) && !inner.marks.contains_key(&9) && !inner.snaps.contains_key(&9), "new incarnation");
        assert_eq!(inner.logs.get(&9).map(|l| l.lines.len()), Some(0), "an empty log");
    }

    #[test]
    fn acct_059_the_memory_profile_scales_with_the_machine_and_is_the_same_for_the_same_machine() {
        const GIB: u64 = 1 << 30;
        assert_eq!(profile_for(Some(4 * GIB)), ("small", 2000));
        assert_eq!(profile_for(Some(8 * GIB)), ("medium", 5000));
        assert_eq!(profile_for(Some(15 * GIB)), ("medium", 5000));
        assert_eq!(profile_for(Some(16 * GIB)), ("large", 10000));
        assert_eq!(profile_for(Some(64 * GIB)), ("large", 10000));
        assert_eq!(profile_for(None), ("medium", 5000));
        assert!(profile_for(Some(4 * GIB)).1 < profile_for(Some(64 * GIB)).1);
        assert_eq!(profile_for(total_memory()), profile_for(total_memory()));
    }

    #[test]
    fn term_106_saved_output_keeps_the_newest_lines_within_the_cap_and_prunes_only_known_keys() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t068-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut h = History::open(&dir, 7).expect("history folder");
        let line = vec![b'x'; 1023];
        for _ in 0..300 {
            h.append(&line);
            h.append(b"\n");
        }
        let bytes = std::fs::read(history_file(&dir, 7)).unwrap();
        assert!(bytes.len() as u64 <= HISTORY_CAP, "capped: {}", bytes.len());
        assert!(bytes.len() >= HISTORY_KEEP / 2, "kept the newest half: {}", bytes.len());
        assert!(bytes.ends_with(b"xxx\n"));
        // The cut lands on a line boundary, never inside an escape sequence.
        assert_eq!(bytes[0], b'x');
        assert_eq!(trim_history(b"ab\ncd\nef", 4), b"ef");
        assert_eq!(trim_history(b"abc", 10), b"abc");
        // Panes gone from the layout lose their saved output; a name that is not a pane key and an
        // empty keep-list (the layout could not be read) prune nothing.
        std::fs::write(history_file(&dir, 8), b"old").unwrap();
        std::fs::write(dir.join("history").join("notes.log"), b"keep").unwrap();
        prune_history(&dir, &[]);
        assert!(history_file(&dir, 8).exists());
        prune_history(&dir, &[7]);
        assert!(!history_file(&dir, 8).exists());
        assert!(history_file(&dir, 7).exists());
        assert!(dir.join("history").join("notes.log").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row_832_an_overflowing_mode_number_is_an_unknown_mode() {
        assert_eq!(screen_owner(0, b"[?99999999999h"), 0);
        assert_eq!(screen_owner(0, b"[?4294968345h"), 0, "4294967296 + 1049 is not 1049");
        assert_eq!(screen_owner(ALT, b"[?4294968345l"), ALT);
        assert_eq!(screen_owner(0, b"[?4294968345h[?1049h"), ALT);
        assert_eq!(screen_owner(0, b"[?1049h"), ALT);
    }

    #[test]
    fn term_132_a_program_that_takes_the_screen_or_the_mouse_owns_the_pane_until_it_gives_it_back() {
        // vim enters the alternate screen; the shell is not idle until vim leaves it.
        let on = screen_owner(0, b"\x1b[?1049h\x1b[22;0;0t\x1b[?1h\x1b=");
        assert_eq!(on, ALT);
        assert_eq!(screen_owner(on, b"some drawing"), ALT);
        assert_eq!(screen_owner(on, b"\x1b[?1049l\x1b[23;0;0t"), 0);
        // less uses the older 47/1047 pair; a mouse capture counts on its own.
        assert_eq!(screen_owner(0, b"\x1b[?47h"), ALT);
        assert_eq!(screen_owner(ALT, b"\x1b[?1047l"), 0);
        assert_eq!(screen_owner(0, b"\x1b[?1000h\x1b[?1006h"), MOUSE);
        assert_eq!(screen_owner(ALT | MOUSE, b"\x1b[?1000l"), ALT);
        // The last word in a chunk wins: enter then leave in one burst is free again.
        assert_eq!(screen_owner(0, b"\x1b[?1049h...\x1b[?1049l$ "), 0);
    }

    #[test]
    fn term_116_diagnostics_carry_no_token_and_no_home_path() {
        let text = diagnostics_text(
            &[("session", "7".to_string()), ("folder", r"C:\Users\pat\code\app".to_string())],
            &["$ curl -H 'Authorization: Bearer sk-live-1234567890abcdef' https://api.example.com".to_string(), r"C:\Users\pat\code\app> ".to_string()],
            Some(r"C:\Users\pat"),
        );
        assert!(!text.contains("sk-live-1234567890abcdef"), "{text}");
        assert!(!text.contains(r"C:\Users\pat"), "{text}");
        assert!(text.contains("folder: ~\\code\\app"), "{text}");
        assert!(text.contains("~\\code\\app> "), "{text}");
        assert!(text.contains("session: 7"), "{text}");
    }

    fn cursors(r: &Read) -> Vec<u64> {
        r.lines.iter().map(|l| l.cursor).collect()
    }

    #[test]
    fn log_numbers_lines_and_pages_by_cursor() {
        let mut log = OutputLog::default();
        assert_eq!(log.read(None, None), Read { oldest: 1, ..Read::default() });
        log.push(b"one\r\ntwo\n\x1b[32mgreen\x1b[0m three\nprom");
        log.push(b"pt> ");
        let all = log.read(None, None);
        assert_eq!(all.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["one", "two", "green three"]);
        assert_eq!((all.cursor, all.pending.as_str(), all.dropped, all.more), (3, "prompt> ", false, false));
        let later = log.read(Some(2), None);
        assert_eq!((cursors(&later), later.cursor), (vec![3], 3));
        let nothing = log.read(Some(3), None);
        assert_eq!((cursors(&nothing), nothing.cursor, nothing.pending.as_str()), (vec![], 3, "prompt> "));
        // The last two without a cursor, the first two after one: both say more remains.
        let last = log.read(None, Some(2));
        assert_eq!((cursors(&last), last.more), (vec![2, 3], true));
        log.push(b"four\n");
        let page = log.read(Some(1), Some(2));
        assert_eq!((cursors(&page), page.cursor, page.more, page.pending.as_str()), (vec![2, 3], 3, true, ""));
        // A progress line redrawn with carriage returns keeps its last drawing.
        log.push(b"10%\r50%\r100%\n");
        assert_eq!(log.read(Some(4), None).lines[0].text, "100%");
        // A character split across two chunks is whole once both arrived, and not shown half-way.
        let bytes = "\u{2588}>\n".as_bytes();
        log.push(&bytes[..2]);
        assert_eq!(log.read(Some(5), None).pending, "");
        log.push(&bytes[2..]);
        assert_eq!(log.read(Some(5), None).lines[0].text, "\u{2588}>");
    }

    #[test]
    fn log_keeps_one_drawing_of_a_repainted_line() {
        let mut log = OutputLog::default();
        // T-151-d: a shell that repaints what is typed shows the command once, whichever way it starts over.
        log.push(b"PS> d\rPS> di\rPS> dir\r\n");
        log.push(b"PS> d\x1b[1GPS> di\x1b[0G\x1b[2KPS> dir\n");
        // FIX-2: the third one draws on row 3, then on row 1 (home): two screen rows, so both drawings are kept.
        log.push(b"\x1b[?25l\x1b[3;1HPS> dir\x1b[H\x1b[KPS> dir\x1b[?25h\n");
        log.push(b"PS> d\x1b[2;1fPS> dir\n");
        let texts: Vec<String> = log.read(None, None).lines.into_iter().map(|l| l.text).collect();
        assert_eq!(texts, ["PS> dir", "PS> dir", "PS> dirPS> dir", "PS> dir"]);
        // The part not finished yet reads the same way.
        log.push(b"PS> d\x1b[1GPS> dir");
        assert_eq!(log.read(None, None).pending, "PS> dir");
        log.push(b"\n");
        // FIX-1: a move to a different row keeps the rows drawn before it; only the same row (or no row) starts over.
        log.push(b"\x1b[1;1Hrow one\x1b[2;1Hrow two\x1b[3;1Hrow three\n");
        assert_eq!(log.read(Some(5), None).lines[0].text, "row onerow tworow three");
        log.push(b"\x1b[2;1Hold\x1b[2;1Hnew\x1b[3;1Hnext\n");
        assert_eq!(log.read(Some(6), None).lines[0].text, "newnext");
        // Not column-aware: a move to another column keeps the text drawn before it (not claimed to match a screen).
        log.push(b"ab\x1b[1;5Hcd\n");
        let l = log.read(Some(7), None).lines[0].text.clone();
        assert!(l.starts_with("ab") && l.ends_with("cd"), "{l}");
        // A carriage return right after ESC[ still starts over, and zero-padded column 1 is column 1.
        log.push(b"old\x1b[\rnew\nold\x1b[01Gnew\nold\x1b[1;01Hnew\nold\x1b[2;001Hnew\n");
        let texts: Vec<String> = log.read(Some(8), None).lines.into_iter().map(|l| l.text).collect();
        assert_eq!(texts, ["new"; 4]);
        // The 1-second progress line still keeps its last drawing.
        log.push(b"10%\r\x1b[K50%\r100%\n");
        assert_eq!(log.read(Some(12), None).lines[0].text, "100%");
        // FIX-2: a move with the row left out (home, or ";1") is row 1. The usual start of a full-screen frame, home
        // then a move to row 2, keeps line one; and row 2 then home keeps row two.
        log.push(b"\x1b[Hline one\x1b[2;1Hline two\n");
        assert_eq!(log.read(Some(13), None).lines[0].text, "line oneline two");
        log.push(b"\x1b[2;1Hrow two\x1b[;1Hrow one\n");
        assert_eq!(log.read(Some(14), None).lines[0].text, "row tworow one");
    }

    #[test]
    fn log_drops_the_oldest_lines_and_says_so() {
        let mut log = OutputLog::default();
        for i in 1..=(LOG_LINES as u64 + 5) {
            log.push(format!("line {i}\n").as_bytes());
        }
        let r = log.read(None, Some(1));
        assert_eq!((r.oldest, r.cursor, r.dropped, r.lines[0].text.as_str()), (6, LOG_LINES as u64 + 5, true, "line 2005"));
        // A cursor older than what is kept: dropped; one inside what is kept: not.
        assert!(log.read(Some(3), None).dropped);
        assert_eq!(log.read(Some(3), None).lines[0].cursor, 6);
        assert!(!log.read(Some(5), None).dropped);
        assert!(!log.read(Some(100), None).dropped);
    }

    #[test]
    fn strip_ansi_keeps_text_only() {
        assert_eq!(strip_ansi("\x1b]0;title\x07a\x1b[1;31mb\x1b[0m\tc\x1b(Bd\x07"), "ab\tcd");
        // Cursor moves and erases that make a gap keep it, so columns do not run together.
        assert_eq!(strip_ansi("A\x1b[5CB\x1b[CC\x1b[2XD"), "A     B C  D");
    }

    #[test]
    fn screen_reply_wakes_the_waiter_and_a_missing_reply_times_out() {
        screen_open("r1");
        let t = std::thread::spawn(|| screen_wait("r1"));
        std::thread::sleep(std::time::Duration::from_millis(50));
        terminal_screen_reply("r1".into(), vec!["row".into()]);
        assert_eq!(t.join().unwrap(), Some(vec!["row".to_string()]));
        terminal_screen_reply("nobody".into(), vec![]);
        screen_open("r2");
        assert_eq!(screen_wait("r2"), None);
        assert!(SCREENS.lock().unwrap().is_empty());
    }

    /// ORCH-058: the shells in a worktree are ended and shown gone before its folder is deleted,
    /// and a record with no process behind it never blocks.
    #[test]
    fn orch058_kill_under_ends_the_shells_in_a_folder_so_it_can_be_deleted() {
        let dir = std::env::temp_dir().join(format!("kolux-orch058-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let t = Terminals::default();
        let s = PtySession::spawn(shell_commands(Some(&dir.to_string_lossy()), None).remove(0), 80, 24, |_| {}, |_| {}).expect("spawn a shell in the folder");
        let pid = s.pid().expect("the platform reports the shell's pid");
        {
            let mut inner = t.inner.lock().unwrap();
            inner.sessions.insert(1, s.into());
            inner.dirs.insert(1, dir.to_string_lossy().into_owned());
            // A stale record: the folder above, with no session behind it.
            inner.dirs.insert(2, std::env::temp_dir().to_string_lossy().into_owned());
        }
        std::thread::sleep(std::time::Duration::from_millis(700));
        let stopped = t.kill_under(&dir);
        assert_eq!((stopped.ended, stopped.stuck.as_slice()), (1, &[][..]), "the shell ended and was shown gone");
        assert_eq!(crate::procs::alive(pid), Some(false));
        assert!(t.inner.lock().unwrap().sessions.is_empty());
        std::fs::remove_dir_all(&dir).expect("the folder is free once its shell is gone");
        let stale = t.kill_under(&std::env::temp_dir());
        assert_eq!((stale.ended, stale.stuck.len()), (1, 0), "a stale record is swept without blocking");
        assert!(t.inner.lock().unwrap().dirs.is_empty());
    }

    /// T-262-c (CLI-023): a plain shell given no folder lists the home folder it started in and
    /// the shell program that started; the CLI-017 session list keeps leaving it out.
    #[test]
    fn t262c_a_plain_shell_lists_its_start_folder_and_program() {
        let t = Terminals::default();
        let mut cmd = shell_commands(None, None);
        let s = PtySession::spawn(cmd.remove(0), 80, 24, |_| {}, |_| {}).expect("spawn a shell");
        let started = s.program().to_string();
        t.inner.lock().unwrap().sessions.insert(7, s.into());
        let every = t.every();
        let home = crate::pty::home_dir().map(|h| h.to_string_lossy().into_owned());
        assert!(home.is_some(), "this account has a home folder");
        assert_eq!(every, vec![(handle_of(7), home, Some(started))]);
        assert!(t.sessions().is_empty(), "a shell with no folder is not a worktree session");
        t.inner.lock().unwrap().sessions.remove(&7).unwrap().kill();
    }

    #[test]
    fn t548b_a_managed_claude_pane_answers_its_account_and_other_panes_do_not() {
        let active = || Some("acct-1".to_string());
        assert_eq!(spawn_account(None, true, active).as_deref(), Some("acct-1"), "a Claude pane on the managed account");
        assert_eq!(spawn_account(None, false, active), None, "key mode, Claude's own sign-in or a shell");
        assert_eq!(spawn_account(Some("cx-2".into()), false, active).as_deref(), Some("cx-2"), "a Codex pane keeps its own");
        assert_eq!(spawn_account(None, true, || None), None, "no active account");
        let mut read = false;
        assert_eq!(spawn_account(Some("cx-2".into()), true, || { read = true; active() }).as_deref(), Some("cx-2"));
        assert!(!read, "the Claude account is not read when Codex answered");
    }

    #[test]
    fn t066d_the_exit_event_carries_a_printed_session_id_only_when_there_is_one() {
        let with = ExitPayload { id: 3, code: Some(0), outcome: "exited", session: Some("run-2026.10.13-a1b2c3".into()) };
        assert_eq!(serde_json::to_value(&with).unwrap()["session"], "run-2026.10.13-a1b2c3");
        let without = ExitPayload { id: 3, code: None, outcome: "unverifiable", session: None };
        assert!(serde_json::to_value(&without).unwrap().get("session").is_none(), "an old window sees the payload it always saw");
    }

    /// T-066-e: a program that stands in for an agent's sessions command, by the agent's own program
    /// name, in a folder of its own: it prints `out`; sleeps ten seconds when `out` is None; and when
    /// `helper` is set it also forks a helper that inherits its output and outlives it by eight seconds
    /// (an updater or daemon a real list command leaves behind).
    fn stand_in(tag: &str, name: &str, out: Option<&str>, helper: bool) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t066e-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("w")).unwrap();
        let fixture = dir.join(format!("{name}.out"));
        std::fs::write(&fixture, out.unwrap_or_default()).unwrap();
        let (file, text) = if cfg!(windows) {
            let body = match out {
                Some(_) => format!("@type \"{}\"\r\n", fixture.display()),
                None => "@ping -n 11 127.0.0.1 >nul\r\n".to_string(),
            };
            let fork = if helper { "@start /b ping -n 9 127.0.0.1\r\n" } else { "" };
            (dir.join(format!("{name}.cmd")), format!("@echo off\r\n{body}{fork}"))
        } else {
            let body = match out {
                Some(_) => format!("cat '{}'\n", fixture.display()),
                None => "sleep 10\n".to_string(),
            };
            let fork = if helper { "(sleep 8 &)\n" } else { "" };
            (dir.join(name), format!("#!/bin/sh\n{body}{fork}"))
        };
        std::fs::write(&file, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        (dir, file)
    }

    const T066E_A: &str = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    const T066E_B: &str = "7d1e4a90-2b3c-4d5e-9f01-a2b3c4d5e6f7";

    #[test]
    fn t066e_a_lines_sessions_command_gives_the_newest_id_no_other_pane_holds() {
        // Cursor lists newest first.
        let out = format!("ID                                    Title          Updated\n{T066E_A}  Fix the build  1m ago\n{T066E_B}  Older          2d ago\n");
        let (dir, cursor) = stand_in("lines", "cursor", Some(&out), false);
        let src = session_id::source("cursor").unwrap();
        assert_eq!(listed_session(&cursor, src, &dir.join("w"), &[]).as_deref(), Some(T066E_A));
        assert_eq!(listed_session(&cursor, src, &dir.join("w"), &[T066E_A.to_string()]).as_deref(), Some(T066E_B), "the next newest when a pane holds the newest");
        assert_eq!(listed_session(&cursor, src, &dir.join("w"), &[T066E_A.to_string(), T066E_B.to_string()]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t066e_a_json_sessions_command_picks_by_folder_and_time() {
        // The stand-in prints its `.out` file, which is written once the folders it names exist.
        let (dir, goose) = stand_in("json", "goose", Some(""), false);
        let here = dir.join("w");
        let other = dir.join("elsewhere");
        let json_path = |p: &std::path::Path| p.display().to_string().replace('\\', "\\\\");
        let rows = format!(
            r#"{{"sessions":[{{"id":"20261013_090000_a1","working_dir":"{o}","updated_at":"2026-10-13T12:00:00Z"}},{{"id":"20261013_080000_b2","working_dir":"{h}","updated_at":"2026-10-13T08:30:00Z"}},{{"id":"20261012_070000_c3","working_dir":"{h}","updated_at":"2026-10-12T07:30:00Z"}}]}}"#,
            o = json_path(&other),
            h = json_path(&here)
        );
        std::fs::write(dir.join("goose.out"), rows).unwrap();
        let src = session_id::source("goose").unwrap();
        assert_eq!(listed_session(&goose, src, &here, &[]).as_deref(), Some("20261013_080000_b2"), "the other folder's newer row is skipped");
        assert_eq!(listed_session(&goose, src, &here, &["20261013_080000_b2".into()]).as_deref(), Some("20261012_070000_c3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t066e_a_sessions_command_that_hangs_or_is_missing_gives_nothing_within_the_wait() {
        let (dir, hermes) = stand_in("hang", "hermes", None, false);
        let src = session_id::source("hermes").unwrap();
        let began = Instant::now();
        assert_eq!(listed_session(&hermes, src, &dir.join("w"), &[]), None, "a hanging list gives nothing");
        let took = began.elapsed();
        assert!(took >= LIST_WAIT && took < LIST_WAIT + Duration::from_secs(2), "killed at the wait, not left to finish: {took:?}");
        let missing = dir.join("not-installed");
        let began = Instant::now();
        assert_eq!(listed_session(&missing, src, &dir.join("w"), &[]), None, "a missing program is no session, never an error");
        assert!(began.elapsed() < Duration::from_secs(1));
        // An agent with no sessions command is asked nothing.
        let (_, copilot) = stand_in("hang", "copilot", Some(&format!("{T066E_A}\n")), false);
        assert_eq!(listed_session(&copilot, session_id::source("copilot").unwrap(), &dir.join("w"), &[]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t066e_a_helper_the_list_leaves_behind_holding_its_output_never_holds_the_ask_past_the_wait() {
        // The command prints its list and exits at once; the helper it forked keeps the pipe open for eight
        // seconds more. The list it printed is read, and the ask ends at the wait, not when the helper does.
        let (dir, gemini) = stand_in("helper", "gemini", Some(&format!("{T066E_B}\n{T066E_A}\n")), true);
        let src = session_id::source("gemini").unwrap();
        let began = Instant::now();
        let got = listed_session(&gemini, src, &dir.join("w"), &[]);
        let took = began.elapsed();
        assert!(took < LIST_WAIT + Duration::from_secs(2), "the ask ends by the wait, whoever still holds the pipe: {took:?}");
        assert_eq!(got.as_deref(), Some(T066E_A), "what the command printed before it exited is still its list (gemini lists oldest first)");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t066e_the_output_read_is_capped_so_a_chatty_list_cannot_fill_memory() {
        // The first id sits after more than the cap of filler: nothing of it is read.
        let out = format!("{}\n{T066E_A}\n", "x".repeat(LIST_CAP as usize + 1024));
        let (dir, amp) = stand_in("cap", "amp", Some(&out), false);
        assert_eq!(listed_session(&amp, session_id::source("amp").unwrap(), &dir.join("w"), &[]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_agent_panes_have_git_prompts_turned_off() {
        let mut agent = crate::pty::program_command("claude", &[], None);
        unattended(&mut agent, true);
        assert_eq!(agent.get_env("GIT_TERMINAL_PROMPT").and_then(|v| v.to_str()), Some("0"));
        assert_eq!(agent.get_env("GCM_INTERACTIVE").and_then(|v| v.to_str()), Some("never"));
        let mut shell = crate::pty::shell_commands(None, None).remove(0);
        let before = shell.get_env("GIT_TERMINAL_PROMPT").map(|v| v.to_os_string());
        unattended(&mut shell, false);
        assert_eq!(shell.get_env("GIT_TERMINAL_PROMPT").map(|v| v.to_os_string()), before, "a shell still prompts");
    }

    #[test]
    fn the_bundled_cli_folder_comes_first_on_the_search_path() {
        let dir = std::path::Path::new("D:\\app");
        let rest = std::env::join_paths(["C:\\old\\kolux", "C:\\Windows"]).unwrap();
        let path = cli_first(dir, Some(rest));
        let parts: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(parts, ["D:\\app", "C:\\old\\kolux", "C:\\Windows"].map(std::path::PathBuf::from));
        assert_eq!(std::env::split_paths(&cli_first(dir, None)).count(), 1);
    }

    /// cli FIX-7 (council FIX-SOON 1 and 2 on 4dce90d5): the CLI's wait for a worker over a real
    /// `Terminals`. Two sessions sit in the folder and have settled, one of them marked as an agent
    /// Kolux started; with no stamp neither is taken, and once a spawn's environment names the
    /// dispatch (the step terminal_spawn runs) the stamped session, whichever it is, is the worker's.
    #[test]
    fn fix7_wait_ready_takes_the_stamped_session_of_a_real_terminals() {
        let t = Terminals::default();
        let dir = std::env::temp_dir();
        let long_ago = Instant::now() - Duration::from_secs(5);
        {
            let mut inner = t.inner.lock().unwrap();
            for id in [7, 8] {
                inner.sessions.insert(id, PtySession::fake(Box::new(std::io::sink())).into());
                inner.dirs.insert(id, dir.to_string_lossy().into_owned());
                inner.logs.insert(id, OutputLog { written: Some(long_ago), ..OutputLog::default() });
            }
            inner.marks.insert(7, Mark { started: long_ago, last_output: Some(long_ago), program: "claude".into(), agent: None, pane: None, home_env: Vec::new(), cwd: None });
        }
        // No stamp: the marked, settled session is not taken.
        crate::cli::expect_stamp("dispatch-term-test");
        let got = crate::cli::wait_ready(&t, "dispatch-term-test", Instant::now(), Duration::from_millis(600));
        assert_eq!(got, (None, false));
        // terminal_spawn's step: the last KOLUX_DISPATCH_ID in the spawn environment names the dispatch.
        let env_own = vec![
            (crate::cli::DISPATCH_ENV.to_string(), "dispatch-term-user".to_string()),
            (crate::cli::DISPATCH_ENV.to_string(), "dispatch-term-test".to_string()),
        ];
        // cli FIX-8: terminal_spawn runs the spawn through spawn_stamped, so the new session (8) is stamped by it.
        let stamped_id: Result<u32, String> = crate::cli::spawn_stamped(crate::cli::dispatch_in(&env_own), || Ok(8));
        assert_eq!(stamped_id, Ok(8));
        let got = crate::cli::wait_ready(&t, "dispatch-term-test", Instant::now(), Duration::from_millis(600));
        assert_eq!(got, (Some(8), true));
        for id in [7, 8] {
            t.inner.lock().unwrap().sessions.remove(&id).unwrap().kill();
        }
    }
}

/// CLI-023: the window reports which terminal sits in which pane and tab.
#[tauri::command]
pub fn terminal_layout(terminals: tauri::State<'_, Terminals>, rows: Vec<serde_json::Value>) {
    terminals.set_layout(rows);
}

#[tauri::command]
pub fn terminal_kill(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.kill(id)
}

/// TERM-106: what pane `pane_key` printed before the last restart, base64 (empty when nothing was saved).
#[tauri::command]
pub fn terminal_history(app: AppHandle, pane_key: u32) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(history_file(&dir, pane_key)).unwrap_or_default();
    Ok(base64::engine::general_purpose::STANDARD.encode(trim_history(&bytes, HISTORY_KEEP)))
}

/// T-066-e: how long an agent's sessions command may take, the reading of its output included, before
/// it is given up on (the command killed if it still runs), so a list that hangs, or a helper it left
/// behind holding its output, never holds up a layout save; and how much of its output is read at most.
pub const LIST_WAIT: Duration = Duration::from_secs(5);
pub const LIST_CAP: u64 = 256 * 1024;

/// T-066-e (SESS-030, source 2 of terminal_session_id.rs): the newest session `program`'s own sessions
/// command (`src.list`, run in `folder` with nothing on its input) lists for that folder which no
/// other pane holds (`taken`). Any trouble is no session, never an error: a program that is missing
/// or will not start, a list that takes longer than `LIST_WAIT` (it is killed), a list that
/// prints more than `LIST_CAP` before its first id (the rest is not read), or no sessions command for
/// this agent at all. The whole ask ends within `LIST_WAIT`: what the command printed before it exited
/// is its list even when a helper it forked (an updater, a daemon) keeps its output open after it.
pub fn listed_session(program: &std::path::Path, src: &session_id::Source, folder: &std::path::Path, taken: &[String]) -> Option<String> {
    let (args, _) = src.list?;
    let (exe, head) = crate::pty::start_line_on(program, cfg!(windows));
    let mut cmd = std::process::Command::new(exe);
    cmd.args(head).args(args).current_dir(folder).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: a layout save never flashes a console
    }
    let mut child = cmd.spawn().ok()?;
    let mut out = child.stdout.take()?;
    // Read on the side, a piece at a time, so a chatty list never blocks on a full pipe while the wait
    // below runs out, and so the wait bounds the read too: the pipe closes only when every process that
    // inherited the command's output has gone, and a helper the command forked may never go. The reader
    // is not waited for; it ends by itself when the pipe closes or when nobody takes its pieces any more.
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        use std::io::Read as _;
        let mut left = LIST_CAP;
        let mut piece = [0u8; 8192];
        while left > 0 {
            let room = piece.len().min(left as usize);
            let n = match out.read(&mut piece[..room]) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            left -= n as u64;
            if tx.send(piece[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let began = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if began.elapsed() < LIST_WAIT => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).output();
                }
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    // The command is done: its output is taken as it arrives, until the pipe closes or the wait runs out.
    let mut buf = Vec::new();
    while let Ok(piece) = rx.recv_timeout(LIST_WAIT.saturating_sub(began.elapsed())) {
        buf.extend_from_slice(&piece);
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    session_id::pick_listed(src.agent, &text, &folder.to_string_lossy(), taken)
}

/// T-066-e: the window asks, when it writes the layout down, for the session an id-only agent's own
/// sessions command lists for the pane's folder (the newest one no other pane holds, `taken`), so
/// the pane comes back resumed after a restart the way a hook-fed one does. The program is the one
/// the user set for the agent (SET-027), else the agent's installed program name. None when the
/// agent has no sessions command, no program is found, or the command gives nothing.
#[tauri::command]
pub async fn terminal_listed_session(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, folder: String, taken: Vec<String>) -> Result<Option<String>, String> {
    let Some(src) = session_id::source(&agent).filter(|s| s.list.is_some()) else { return Ok(None) };
    if folder.trim().is_empty() {
        return Err("a folder is needed to list the agent's sessions in".into());
    }
    let settings = store.lock().map_err(|e| e.to_string())?.settings();
    let name = crate::agents::command_override(&settings, &agent).map(str::to_string).or_else(|| crate::agents::installed_program(&agent));
    let Some(program) = name.and_then(|n| crate::agents::find_program(&n)) else { return Ok(None) };
    let got = tauri::async_runtime::spawn_blocking(move || listed_session(&program, src, std::path::Path::new(&folder), &taken)).await.map_err(|e| e.to_string())?;
    Ok(got)
}

/// TERM-106: a tab closed on purpose is not brought back, so its saved output goes with it.
#[tauri::command]
pub fn terminal_forget_history(app: AppHandle, pane_key: u32) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(history_file(&dir, pane_key));
    Ok(())
}

/// TERM-106: after a start, the saved output of panes no longer in the layout is removed in the background.
#[tauri::command]
pub fn terminal_prune_history(app: AppHandle, keep: Vec<u32>) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::thread::spawn(move || prune_history(&dir, &keep));
    Ok(())
}

/// TERM-106: what the pane itself wrote around the replay (the reset, the note, the push) goes into
/// the file too, so the file stays a transcript of what the terminal processed and replays true.
#[tauri::command]
pub fn terminal_history_append(app: AppHandle, pane_key: u32, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if let Some(mut h) = History::open(&dir, pane_key) {
        h.append(&bytes);
    }
    Ok(())
}

/// TERM-085 (T-306): the "switch input source" command, unbound until the user assigns it. On Windows the focused
/// window is asked to move to the next installed keyboard layout, as the OS language hotkey does
/// (WM_INPUTLANGCHANGEREQUEST with HKL_NEXT, both from Microsoft Learn). The pane keeps the chord, so nothing of it
/// reaches the terminal.
#[tauri::command]
pub fn terminal_next_input_source() -> Result<(), String> {
    next_input_source()
}

/// HKL_NEXT: "the next locale identifier in the list" for a layout change request (Microsoft Learn).
pub const HKL_NEXT: isize = 1;

#[cfg(windows)]
fn next_input_source() -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, PostMessageW, GUITHREADINFO,
        WM_INPUTLANGCHANGEREQUEST,
    };
    // SAFETY: plain Win32 calls on handles the OS hands back; GUITHREADINFO is zeroed with its size set first.
    unsafe {
        let top = GetForegroundWindow();
        if top.is_null() {
            return Err("no window has the keyboard".into());
        }
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        let thread = GetWindowThreadProcessId(top, std::ptr::null_mut());
        // The web view's own child window holds the focus; the request goes to it, else to the top window.
        let target = if GetGUIThreadInfo(thread, &mut info) != 0 && !info.hwndFocus.is_null() { info.hwndFocus } else { top };
        if PostMessageW(target, WM_INPUTLANGCHANGEREQUEST, 0, HKL_NEXT) == 0 {
            return Err("Windows refused the input source change".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn next_input_source() -> Result<(), String> {
    Err("switching the input source is built for Windows only".into())
}

#[cfg(test)]
mod input_source_tests {
    #[cfg(windows)]
    #[test]
    fn term085_the_request_is_the_documented_language_change_message() {
        // Microsoft Learn: WM_INPUTLANGCHANGEREQUEST is 0x0050 and HKL_NEXT is 1.
        assert_eq!(windows_sys::Win32::UI::WindowsAndMessaging::WM_INPUTLANGCHANGEREQUEST, 0x0050);
        assert_eq!(super::HKL_NEXT, 1);
    }
}
