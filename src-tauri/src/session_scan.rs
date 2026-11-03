//! VIEW-090 / VIEW-092 (T-276): what a session scan reports besides the sessions, and how scans stay
//! quick and out of the way. A scan counts the transcripts it could not read (never an error for
//! those alone), notes a cut-short scan or an unreadable index, keeps its parsed summaries on disk
//! under a version stamp so the list is fast after a restart, lets overlapping scans share one
//! another's work, stops reading when its time budget is spent, and searches a WSL distribution
//! only when it is already running (a stopped one is never started for a scan).
use super::list::{Cache, Entry, Summary};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Bumped whenever the parsed summary changes shape or meaning, so an older file is ignored.
pub const CACHE_VERSION: u32 = 1;
/// The summaries file inside the profile folder.
pub const CACHE_FILE: &str = "session-scan-cache.json";
/// A scan reads no new transcript after this long; what it has is listed with a notice.
pub const SCAN_BUDGET: Duration = Duration::from_secs(25);

/// What a scan could not do. Skipped transcripts alone never mean failure.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Transcripts listed in the folders that could not be opened or read.
    pub skipped: u32,
    /// The scan ran out of time and listed what it had.
    pub cut_short: bool,
    /// Sources that could not be read as a whole (an index or database, a stopped WSL distribution).
    pub unreadable: Vec<String>,
    /// No session folder of any agent exists here at all.
    pub no_sources: bool,
    /// How many transcripts were parsed (not found in the cache) in this scan.
    #[serde(skip)]
    pub parsed: u32,
}

impl Report {
    /// Records an unreadable source once, however many times it is met.
    pub fn note_unreadable(&mut self, what: &str) {
        if !self.unreadable.iter().any(|w| w == what) {
            self.unreadable.push(what.to_string());
        }
    }
}

/// The scan's answer: the sessions and the report.
#[derive(Serialize, Clone, Debug)]
pub struct Listing {
    pub sessions: Vec<Entry>,
    pub report: Report,
}

// Budget threads started by the calling thread (the scan runs on it), so tests can count them.
#[cfg(test)]
thread_local! { pub static SPAWNS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

/// A time limit for one scan; `none` never runs out.
pub struct Budget(Option<Instant>);

impl Budget {
    pub fn none() -> Budget {
        Budget(None)
    }
    pub fn within(limit: Duration) -> Budget {
        Budget(Some(Instant::now() + limit))
    }
    pub fn spent(&self) -> bool {
        self.0.is_some_and(|t| Instant::now() >= t)
    }
    /// One worker for a whole scan: `work` runs on a single helper thread (started on the first call),
    /// and each call waits for its answer only while the budget lasts. `none` runs inline.
    pub fn worker<I: Send + 'static, O: Send + 'static>(&self, work: impl Fn(I) -> O + Send + Sync + 'static) -> Worker<I, O> {
        Worker { end: self.0, work: std::sync::Arc::new(work), line: RefCell::new(None), stalled: Cell::new(false), respawned: Cell::new(false) }
    }
}

type Line<I, O> = (mpsc::Sender<I>, mpsc::Receiver<O>);

/// See [`Budget::worker`]. Calls are one at a time; after the budget runs out on a call the helper is
/// left to finish on its own and every later call answers `None` at once. A helper that died (its work
/// panicked on one item) answers `None` for that item only and is replaced once per scan; a second
/// death also sets `stalled`, so the scan reports itself cut short.
pub struct Worker<I, O> {
    end: Option<Instant>,
    work: std::sync::Arc<dyn Fn(I) -> O + Send + Sync>,
    line: RefCell<Option<Line<I, O>>>,
    stalled: Cell<bool>,
    respawned: Cell<bool>,
}

impl<I: Send + 'static, O: Send + 'static> Worker<I, O> {
    /// `None` when the budget ran out first (a disk that hangs).
    pub fn call(&self, item: I) -> Option<O> {
        let Some(end) = self.end else { return Some((self.work)(item)) };
        if self.stalled.get() {
            return None;
        }
        let mut line = self.line.borrow_mut();
        let (jobs, answers) = line.get_or_insert_with(|| {
            let (jobs, queue) = mpsc::channel::<I>();
            let (reply, answers) = mpsc::channel();
            let work = self.work.clone();
            #[cfg(test)]
            SPAWNS.with(|n| n.set(n.get() + 1));
            std::thread::spawn(move || {
                for job in queue {
                    if reply.send(work(job)).is_err() {
                        break;
                    }
                }
            });
            (jobs, answers)
        });
        let answer = jobs.send(item).map_err(|_| mpsc::RecvTimeoutError::Disconnected).and_then(|()| answers.recv_timeout(end.saturating_duration_since(Instant::now())));
        match answer {
            Ok(done) => Some(done),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.stalled.set(true);
                None
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // The helper is gone, not hung: the next call starts a fresh one, once; a second death stops the scan's helper work.
                *line = None;
                if self.respawned.replace(true) {
                    self.stalled.set(true);
                }
                None
            }
        }
    }

    /// Whether the budget ran out on a call (or the helper died twice), so the scan was cut short.
    pub fn stalled(&self) -> bool {
        self.stalled.get()
    }
}

// ---- the summaries on disk (VIEW-092) ----

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u32,
    files: Vec<StoredFile>,
}

#[derive(Serialize, Deserialize)]
struct StoredFile {
    path: String,
    modified: u64,
    len: u64,
    summary: Summary,
}

/// The saved summaries; a missing, unreadable or other-version file gives an empty cache.
pub fn load_disk(file: &Path) -> Cache {
    let Ok(text) = fs::read_to_string(file) else { return Cache::new() };
    let Ok(stored) = serde_json::from_str::<Stored>(&text) else { return Cache::new() };
    if stored.version != CACHE_VERSION {
        return Cache::new();
    }
    stored.files.into_iter().map(|f| (PathBuf::from(f.path), (f.modified, f.len, f.summary))).collect()
}

/// Saves the summaries of files that still exist, through a temporary file so a cut-off write never
/// leaves half a cache behind.
pub fn save_disk(file: &Path, cache: &Cache) -> io::Result<()> {
    let files: Vec<StoredFile> = cache
        .iter()
        .filter(|(p, _)| p.is_file())
        .map(|(p, (modified, len, summary))| StoredFile { path: p.to_string_lossy().into_owned(), modified: *modified, len: *len, summary: summary.clone() })
        .collect();
    let text = serde_json::to_string(&Stored { version: CACHE_VERSION, files }).map_err(io::Error::other)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, file)
}

// ---- overlapping scans (VIEW-092) ----

/// Counts the scans in progress. A refresh that arrives while another scan runs joins it instead of
/// throwing the shared cache away under it.
#[derive(Default)]
pub struct Running(AtomicUsize);

pub struct Ticket<'a>(&'a Running);

impl Running {
    pub const fn new() -> Running {
        Running(AtomicUsize::new(0))
    }
    /// Enters a scan; the bool says whether another scan was already running.
    pub fn enter(&self) -> (Ticket<'_>, bool) {
        let before = self.0.fetch_add(1, Ordering::SeqCst);
        (Ticket(self), before > 0)
    }
    #[cfg(test)]
    pub fn count(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        self.0 .0.fetch_sub(1, Ordering::SeqCst);
    }
}

// ---- WSL (VIEW-092) ----

/// The distribution a `\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...` path lives in.
pub fn wsl_distro(path: &Path) -> Option<String> {
    let s = path.to_string_lossy().replace('/', "\\");
    let rest = s.strip_prefix(r"\\")?;
    let mut parts = rest.split('\\');
    let host = parts.next()?.to_lowercase();
    if host != "wsl.localhost" && host != "wsl$" {
        return None;
    }
    parts.next().filter(|d| !d.is_empty()).map(str::to_string)
}

/// The names `wsl.exe -l --running -q` prints: UTF-16 (with or without a byte-order mark) or plain text.
pub fn parse_running(raw: &[u8]) -> Vec<String> {
    let utf16 = raw.len() >= 2 && (raw[..2] == [0xFF, 0xFE] || raw.iter().skip(1).step_by(2).take(8).all(|b| *b == 0) && raw.len() > 2);
    let text = if utf16 {
        let units: Vec<u16> = raw.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(raw).into_owned()
    };
    text.trim_start_matches('\u{feff}').lines().map(|l| l.trim().trim_end_matches("(Default)").trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// Keeps the roots that can be searched: every non-WSL root, and a WSL root only when its distribution
/// is running. `running` is asked once, and only when a WSL root exists; None (could not tell) skips
/// them all. Skipped distributions are named in the report.
pub fn without_stopped_wsl(roots: Vec<PathBuf>, report: &mut Report, running: impl FnOnce() -> Option<Vec<String>>) -> Vec<PathBuf> {
    if !roots.iter().any(|r| wsl_distro(r).is_some()) {
        return roots;
    }
    let up: Option<HashSet<String>> = running().map(|v| v.into_iter().map(|d| d.to_lowercase()).collect());
    roots
        .into_iter()
        .filter(|r| match wsl_distro(r) {
            None => true,
            Some(d) => {
                let ok = up.as_ref().is_some_and(|u| u.contains(&d.to_lowercase()));
                if !ok {
                    report.note_unreadable(&format!("the WSL distribution {d}, which is not running"));
                }
                ok
            }
        })
        .collect()
}

/// The running WSL distributions, asked of `wsl.exe` (which lists and starts nothing). None when it
/// cannot be run in a few seconds.
#[cfg(windows)]
pub fn running_distros() -> Option<Vec<String>> {
    use std::os::windows::process::CommandExt;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new(crate::pty::system_program("wsl.exe")).args(["-l", "--running", "-q"]).creation_flags(0x0800_0000).output();
        let _ = tx.send(out.ok().map(|o| parse_running(&o.stdout)));
    });
    rx.recv_timeout(Duration::from_secs(3)).ok().flatten()
}

#[cfg(not(windows))]
pub fn running_distros() -> Option<Vec<String>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::list::{list_scan, Roots, Scope};
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-sescan-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn transcript(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, json!({ "type": "user", "cwd": r"C:\work\app", "message": { "role": "user", "content": text } }).to_string() + "\n").unwrap();
    }

    fn roots(root: &Path) -> Roots {
        Roots { claude: vec![root.to_path_buf()], codex: vec![] }
    }

    #[test]
    fn view090_one_unreadable_transcript_among_readable_ones_is_counted_and_the_rest_listed() {
        let root = tmp("skip");
        let dir = root.join("projects").join("C--work-app");
        transcript(&dir.join("a.jsonl"), "first");
        transcript(&dir.join("b.jsonl"), "second");
        fs::create_dir_all(dir.join("bad.jsonl")).unwrap(); // listed as a transcript, cannot be read
        let got = list_scan(&roots(&root), &Scope::All, &mut Cache::new(), None, &Budget::none());
        assert_eq!(got.sessions.len(), 2);
        assert_eq!(got.report.skipped, 1);
        assert!(!got.report.no_sources && !got.report.cut_short && got.report.unreadable.is_empty(), "a skipped file alone is no error");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view090_no_session_folder_at_all_says_why_the_list_is_empty() {
        let root = tmp("none");
        let got = list_scan(&roots(&root), &Scope::All, &mut Cache::new(), None, &Budget::none());
        assert!(got.sessions.is_empty() && got.report.no_sources && got.report.skipped == 0);
        fs::create_dir_all(root.join("projects")).unwrap();
        assert!(!list_scan(&roots(&root), &Scope::All, &mut Cache::new(), None, &Budget::none()).report.no_sources);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view090_an_unreadable_codex_index_is_named_once() {
        let root = tmp("index");
        fs::create_dir_all(root.join("sessions")).unwrap();
        fs::create_dir_all(root.join("session_index.jsonl")).unwrap(); // not a readable file
        let both = Roots { claude: vec![], codex: vec![root.clone(), root.clone()] };
        let got = list_scan(&both, &Scope::All, &mut Cache::new(), None, &Budget::none());
        assert_eq!(got.report.unreadable, vec!["the Codex title index".to_string()], "named once however many homes");
        assert!(!got.report.no_sources);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view092_a_spent_budget_stops_the_scan_and_says_so() {
        let root = tmp("budget");
        let dir = root.join("projects").join("C--work-app");
        transcript(&dir.join("a.jsonl"), "first");
        transcript(&dir.join("b.jsonl"), "second");
        let spent = Budget::within(Duration::ZERO);
        let got = list_scan(&roots(&root), &Scope::All, &mut Cache::new(), None, &spent);
        assert!(got.report.cut_short);
        assert!(got.sessions.len() < 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_worker_that_ran_out_of_budget_answers_none_at_once_and_starts_nothing_more() {
        SPAWNS.with(|n| n.set(0));
        let w = Budget::within(Duration::from_millis(150)).worker(|ms: u64| {
            std::thread::sleep(Duration::from_millis(ms));
            ms
        });
        assert_eq!(w.call(1), Some(1));
        assert_eq!(w.call(2), Some(2));
        assert_eq!(w.call(2_000), None);
        let began = Instant::now();
        assert_eq!(w.call(1), None);
        assert!(began.elapsed() < Duration::from_millis(100));
        assert_eq!(SPAWNS.with(|n| n.get()), 1);
        assert_eq!(Budget::none().worker(|x: u8| x + 1).call(1), Some(2));
    }

    #[test]
    fn row893_a_worker_whose_work_panicked_loses_that_item_only_and_is_replaced_once() {
        SPAWNS.with(|n| n.set(0));
        let w = Budget::within(Duration::from_secs(60)).worker(|n: u8| {
            assert!(n != 0, "test panic");
            n
        });
        assert_eq!(w.call(1), Some(1));
        assert_eq!(w.call(0), None);
        assert!(!w.stalled(), "a dead helper is not a stalled one");
        assert_eq!(w.call(2), Some(2), "later items still run");
        assert_eq!(SPAWNS.with(|n| n.get()), 2);
        assert_eq!(w.call(0), None);
        assert!(w.stalled(), "a second death ends the helper work for this scan");
        assert_eq!(w.call(3), None);
        assert_eq!(SPAWNS.with(|n| n.get()), 2, "nothing more is spawned");
    }

    /// after-list row 608: a read stalled inside one transcript (a hung network disk) does not hold
    /// the scan past its budget; the scan lists what it has and says it was cut short.
    #[test]
    fn view092_a_read_stalled_inside_one_transcript_does_not_hold_the_scan_past_its_budget() {
        let root = tmp("stall");
        let dir = root.join("projects").join("C--work-app");
        transcript(&dir.join("a-stall.jsonl"), "first"); // summarize() sleeps 5 s on this name in tests
        let began = Instant::now();
        let got = list_scan(&roots(&root), &Scope::All, &mut Cache::new(), None, &Budget::within(Duration::from_millis(400)));
        assert!(began.elapsed() < Duration::from_secs(3), "the scan waited {:?} on the stalled read", began.elapsed());
        assert!(got.report.cut_short);
        assert!(got.sessions.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view092_summaries_survive_a_restart_and_only_changed_files_are_parsed_again() {
        let root = tmp("disk");
        let dir = root.join("projects").join("C--work-app");
        transcript(&dir.join("a.jsonl"), "first");
        transcript(&dir.join("b.jsonl"), "second");
        let file = root.join(CACHE_FILE);
        let mut cache = Cache::new();
        let cold = list_scan(&roots(&root), &Scope::All, &mut cache, None, &Budget::none());
        assert_eq!(cold.report.parsed, 2);
        save_disk(&file, &cache).unwrap();
        // "restart": a fresh cache read back from disk parses nothing for unchanged files
        let mut again = load_disk(&file);
        let warm = list_scan(&roots(&root), &Scope::All, &mut again, None, &Budget::none());
        assert_eq!(warm.report.parsed, 0);
        assert_eq!(warm.sessions, cold.sessions);
        // a changed file is parsed again, the other is not
        transcript(&dir.join("a.jsonl"), "first, but much longer than before");
        assert_eq!(list_scan(&roots(&root), &Scope::All, &mut again, None, &Budget::none()).report.parsed, 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view092_a_cache_of_another_version_or_a_broken_one_is_ignored_and_deleted_files_are_dropped() {
        let root = tmp("version");
        let file = root.join(CACHE_FILE);
        fs::write(&file, r#"{"version":0,"files":[]}"#).unwrap();
        assert!(load_disk(&file).is_empty());
        fs::write(&file, "not json").unwrap();
        assert!(load_disk(&file).is_empty());
        assert!(load_disk(&root.join("missing.json")).is_empty());
        let mut cache = Cache::new();
        cache.insert(root.join("gone.jsonl"), (1, 1, Summary::default()));
        save_disk(&file, &cache).unwrap();
        assert!(load_disk(&file).is_empty(), "a transcript that no longer exists is not kept");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view092_a_refresh_during_a_scan_joins_it() {
        let running = Running::new();
        let (first, joined_first) = running.enter();
        assert!(!joined_first);
        let (second, joined_second) = running.enter();
        assert!(joined_second && running.count() == 2);
        drop(first);
        drop(second);
        assert_eq!(running.count(), 0);
        assert!(!running.enter().1, "after both end a new scan starts afresh");
    }

    #[test]
    fn view092_only_running_wsl_distributions_are_searched_and_a_stopped_one_is_never_asked_about_twice() {
        assert_eq!(wsl_distro(Path::new(r"\\wsl.localhost\Ubuntu\home\me\.claude")).as_deref(), Some("Ubuntu"));
        assert_eq!(wsl_distro(Path::new(r"\\wsl$\Debian\root")).as_deref(), Some("Debian"));
        assert_eq!(wsl_distro(Path::new(r"C:\Users\me\.claude")), None);
        assert_eq!(wsl_distro(Path::new(r"\\server\share")), None);
        let roots = vec![PathBuf::from(r"C:\Users\me\.claude"), PathBuf::from(r"\\wsl.localhost\Ubuntu\home\me\.claude"), PathBuf::from(r"\\wsl.localhost\Old\home\me\.claude")];
        let mut report = Report::default();
        let mut asked = 0;
        let kept = without_stopped_wsl(roots.clone(), &mut report, || {
            asked += 1;
            Some(vec!["ubuntu".to_string()])
        });
        assert_eq!(asked, 1);
        assert_eq!(kept, vec![roots[0].clone(), roots[1].clone()]);
        assert_eq!(report.unreadable, vec!["the WSL distribution Old, which is not running".to_string()]);
        // nobody asked when there is no WSL root; an unanswerable question skips every WSL root
        let plain = vec![PathBuf::from(r"C:\a")];
        assert_eq!(without_stopped_wsl(plain.clone(), &mut Report::default(), || panic!("must not ask")), plain);
        assert_eq!(without_stopped_wsl(roots.clone(), &mut Report::default(), || None), vec![roots[0].clone()]);
    }

    #[test]
    fn view092_wsl_exe_output_is_read_as_utf16_or_plain_text() {
        let utf16: Vec<u8> = "\u{feff}Ubuntu\r\nDebian (Default)\r\n".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(parse_running(&utf16), vec!["Ubuntu".to_string(), "Debian".to_string()]);
        assert_eq!(parse_running(b"Ubuntu\nDebian\n"), vec!["Ubuntu".to_string(), "Debian".to_string()]);
        assert!(parse_running(b"").is_empty());
    }
}
