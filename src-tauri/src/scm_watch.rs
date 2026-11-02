//! GIT-001 (T-033-b): the Source Control list, the diff tab and All Changes follow git state
//! through a folder watcher instead of a poll. One watch per worktree, shared by every caller that
//! asks for it (counted, so the last one to go stops it). A watch reads the working tree, the
//! worktree's own git folder (HEAD and index) and the shared refs; every change it counts restarts
//! a short quiet timer, and when the timer runs out (or a burst has gone on for a second) it reads
//! the status once and sends it to the window as `scm-status-<id>`, the same shape `scm_status`
//! returns. Behind it, a safety read every 30 s. A watch that cannot start (a network drive, a
//! junctioned path, a WSL distribution (EDIT-044, DT-C70), no handle), or that later errors, goes
//! back to reading every 4 s for that worktree and says so once in the diagnostics log; that 4 s
//! read is the fallback that never goes quiet. T-033-e: a change-buffer overflow is not an
//! error: the reader reads again and the worker catches up with one read; a worktree whose folder
//! is gone ends its watch instead of reading a missing folder for the rest of the session; a
//! workspace removal ends the watch and waits for the folder handles to close before git deletes
//! the folder; the window closing ends every watch; the shared `packed-refs` is watched too; and a
//! caller joining a watch that has already fallen back is told so. FIX-1 (the T-033-e review): a
//! watch that ends on its own, or whose workspace removal then failed, tells the page so it watches
//! again; an overflow forgets the remembered ignore answers; and a removal only ever ends the watch
//! of that very folder.
//!
//! The watcher is Windows' own folder-change reader (ReadDirectoryChangesW); the `notify` crate is
//! CC0-1.0 in every version, which the licence list refuses (T-033-b decision).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long the tree must stay quiet after a change before the status is read.
pub const QUIET: Duration = Duration::from_millis(250);
/// The longest a burst of changes can hold the read back.
pub const CAP: Duration = Duration::from_secs(1);
/// The safety read behind a working watch.
pub const SAFETY: Duration = Duration::from_secs(30);
/// The old poll, for a worktree whose watch could not start or broke.
pub const FALLBACK: Duration = Duration::from_secs(4);

/// The least time between the start of one read and the next change-driven read (T-033-c, council
/// FIX-SOON 2): churn that git does not ignore is read at most this often instead of every second.
pub const GAP: Duration = Duration::from_secs(4);

/// Folder names that stand in for git's answer when git cannot give one (no repository, git
/// missing): build output and package caches that are ignored in practice.
pub const SKIP: [&str; 4] = ["target", "node_modules", "dist", ".venv"];

/// GIT-001 (T-033-c): which working-tree folders git ignores, asked of git once per folder and
/// remembered per root. A change under an ignored folder never moves the status, so it never
/// starts a read. Folders are asked shortest first, so `target` is one answer for everything
/// beneath it. A folder git ignores but still tracks files in is kept (T-033-f: a change to a
/// tracked file moves the status whatever the ignore rules say). A change to a `.gitignore`, to
/// the main checkout's `.git/info/exclude` or, for a linked worktree, to the shared
/// `info/exclude` of its repository forgets the root's answers. Files are judged by their folder
/// (an ignored file in a kept folder costs one extra read, never a missed one).
#[derive(Debug, Default)]
pub struct Ignores {
    known: std::collections::HashMap<String, bool>,
    /// Tests: how often the answers were forgotten (each forget costs one `git check-ignore` later).
    #[cfg(test)]
    pub forgets: usize,
}

impl Ignores {
    /// Whether `rel` (forward slashes, relative to the root) lies under an ignored folder; `ask`
    /// answers for the folders not yet known, in order, or None when git could not say.
    pub fn ignored(&mut self, rel: &str, ask: &mut dyn FnMut(&[String]) -> Option<Vec<bool>>) -> bool {
        let segs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        let dirs: Vec<String> = (1..segs.len()).map(|n| segs[..n].join("/")).collect();
        if dirs.iter().any(|d| self.known.get(d) == Some(&true)) {
            return true;
        }
        let unknown: Vec<String> = dirs.iter().filter(|d| !self.known.contains_key(*d)).cloned().collect();
        if unknown.is_empty() {
            return false;
        }
        match ask(&unknown) {
            Some(answers) => {
                for (d, a) in unknown.iter().zip(answers) {
                    self.known.insert(d.clone(), a);
                }
                dirs.iter().any(|d| self.known.get(d) == Some(&true))
            }
            None => segs.iter().any(|s| SKIP.iter().any(|k| s.eq_ignore_ascii_case(k))),
        }
    }
    /// The ignore rules changed: every answer is stale.
    pub fn forget(&mut self) {
        self.known.clear();
        #[cfg(test)]
        {
            self.forgets += 1;
        }
    }
}

/// Whether a working-tree path is a `.gitignore` anywhere or the repository's own exclude file.
pub fn is_rule_file(rel: &str) -> bool {
    let rel = rel.trim_start_matches('/');
    rel.rsplit('/').next() == Some(".gitignore") || rel.eq_ignore_ascii_case(".git/info/exclude")
}

/// Asks git which of `dirs` it ignores, one `check-ignore --stdin` for the batch; None when git
/// could not answer (exit codes other than 0 and 1, or no git). With `-v -n -z` every path comes
/// back as source NUL line NUL pattern NUL path NUL; an empty source means not ignored, and a
/// pattern starting with `!` is a negation, which un-ignores.
pub fn ask_git(root: &Path, dirs: &[String]) -> Option<Vec<bool>> {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = crate::git::command(&["check-ignore", "--stdin", "-z", "-v", "-n"], Some(root)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    {
        let mut stdin = child.stdin.take()?;
        for d in dirs {
            stdin.write_all(format!("{d}/\0").as_bytes()).ok()?;
        }
    }
    let out = child.wait_with_output().ok()?;
    if !matches!(out.status.code(), Some(0 | 1)) {
        return None;
    }
    // T-033-f: a folder that is ignored but still holds tracked files already comes back as not
    // ignored from check-ignore itself (pinned by the t033f test), so one git process answers.
    Some(parse_check_ignore(&String::from_utf8_lossy(&out.stdout), dirs))
}

/// One answer per asked folder from `check-ignore -z -v -n` output.
pub fn parse_check_ignore(out: &str, dirs: &[String]) -> Vec<bool> {
    let mut map = std::collections::HashMap::new();
    let f: Vec<&str> = out.split('\0').collect();
    for rec in f.chunks(4) {
        if let [source, _line, pattern, path] = rec {
            map.insert(path.trim_end_matches('/').to_string(), !source.is_empty() && !pattern.starts_with('!'));
        }
    }
    dirs.iter().map(|d| map.get(d.as_str()).copied().unwrap_or(false)).collect()
}

/// The ignore answers of every watched root.
static IGNORES: Mutex<BTreeMap<String, Arc<Mutex<Ignores>>>> = Mutex::new(BTreeMap::new());

fn ignores_of(root: &Path) -> Arc<Mutex<Ignores>> {
    IGNORES.lock().unwrap_or_else(|e| e.into_inner()).entry(key(&root.to_string_lossy())).or_default().clone()
}

/// Whether a reported change can move the status: git's folder rules, and for the working tree
/// git's own ignore rules (a changed rule file first forgets the remembered answers).
pub fn matters(root: &Path, spot: Spot, rel: &str) -> bool {
    // A rule file first (T-033-f): `.git/info/exclude` is not one of the git-folder paths
    // `counts` lets through, and its change must still forget the answers and read once.
    let rule = match spot {
        Spot::Tree => is_rule_file(rel),
        Spot::Info => rel.trim_start_matches('/').eq_ignore_ascii_case("exclude"),
        Spot::GitDir | Spot::Refs | Spot::Common => false,
    };
    if rule {
        ignores_of(root).lock().unwrap_or_else(|e| e.into_inner()).forget();
        return true;
    }
    if !counts(spot, rel) {
        return false;
    }
    if spot != Spot::Tree || rel.trim_start_matches('/').split('/').next().is_some_and(|s| s.eq_ignore_ascii_case(".git")) {
        return true;
    }
    let ig = ignores_of(root);
    let mut ig = ig.lock().unwrap_or_else(|e| e.into_inner());
    !ig.ignored(rel, &mut |dirs| ask_git(root, dirs))
}

/// Where a changed path was reported from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spot {
    /// The worktree root; for a main checkout its `.git` folder is inside.
    Tree,
    /// A linked worktree's own git folder (outside the root).
    GitDir,
    /// The shared `refs` folder of a linked worktree's repository.
    Refs,
    /// The shared `info` folder of a linked worktree's repository (its `exclude` file).
    Info,
    /// The shared git folder itself of a linked worktree's repository, not recursive: only its
    /// `packed-refs` counts (T-033-e; a pack, a prune or a packed branch delete moves refs there
    /// without touching `refs/`).
    Common,
}

/// Whether a change at `rel` (relative to its spot, forward slashes) can move the status. Inside
/// git's folders only HEAD, the index, refs and packed-refs count: never objects, never
/// `index.lock` churn, never FETCH_HEAD or logs, so a fetch costs one read for its ref updates.
pub fn counts(spot: Spot, rel: &str) -> bool {
    let rel = rel.trim_start_matches('/');
    match spot {
        Spot::Refs => true,
        Spot::GitDir => rel == "HEAD" || rel == "index",
        Spot::Info => false,
        Spot::Common => rel == "packed-refs",
        Spot::Tree => {
            let mut segs = rel.split('/');
            let first = segs.next().unwrap_or_default();
            if first.eq_ignore_ascii_case(".git") {
                let rest = &rel[first.len()..].trim_start_matches('/');
                return *rest == "HEAD" || *rest == "index" || *rest == "packed-refs" || *rest == "refs" || rest.starts_with("refs/");
            }
            true
        }
    }
}

/// The quiet timer: a change restarts it, a burst is cut off at `cap` after its first change.
#[derive(Debug)]
pub struct Debounce {
    quiet: Duration,
    cap: Duration,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Debounce {
    pub fn new(quiet: Duration, cap: Duration) -> Self {
        Debounce { quiet, cap, first: None, last: None }
    }
    pub fn hit(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }
    /// How long until the pending read is due; None when nothing is pending.
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        let (first, last) = (self.first?, self.last?);
        Some(((last + self.quiet).min(first + self.cap)).saturating_duration_since(now))
    }
    /// True (and cleared) when the pending read is due.
    pub fn take(&mut self, now: Instant) -> bool {
        if self.wait(now) == Some(Duration::ZERO) {
            self.first = None;
            self.last = None;
            true
        } else {
            false
        }
    }
}

/// What a watch's worker hears.
#[derive(Debug)]
pub enum Signal {
    Change,
    /// T-033-e: the change buffer overflowed, so some changes were never reported; the reader is
    /// already reading again, and the worker reads once to catch up. Not a break.
    Overflow,
    /// The watch broke (an error, the folder went away); the reason is logged.
    Broken(String),
    Stop,
}

/// Watching (safety read every 30 s) or reading every 4 s because the watch is gone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Watching,
    Polling,
}

impl Mode {
    pub fn tick(self) -> Duration {
        match self {
            Mode::Watching => SAFETY,
            Mode::Polling => FALLBACK,
        }
    }
    /// The mode after the watch broke, and whether this is the first break (the one logged).
    pub fn broken(self) -> (Mode, bool) {
        (Mode::Polling, self == Mode::Watching)
    }
}

/// Where a worktree's state lives: its root, its own git folder and the repository's shared one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Places {
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common: PathBuf,
}

impl Places {
    /// The folders to watch: the root (recursive), and for a linked worktree its own git folder
    /// (HEAD, index) and the shared refs.
    pub fn watches(&self) -> Vec<(PathBuf, bool, Spot)> {
        let inner = self.root.join(".git");
        let same = |a: &Path, b: &Path| key(&a.to_string_lossy()) == key(&b.to_string_lossy());
        let mut out = vec![(self.root.clone(), true, Spot::Tree)];
        if !same(&self.git_dir, &inner) {
            out.push((self.git_dir.clone(), false, Spot::GitDir));
        }
        if !same(&self.common, &inner) {
            out.push((self.common.join("refs"), true, Spot::Refs));
            // Only when it exists: a missing folder cannot be watched and would cost the whole watch.
            if self.common.join("info").is_dir() {
                out.push((self.common.join("info"), false, Spot::Info));
            }
            out.push((self.common.clone(), false, Spot::Common));
        }
        out
    }
}

/// The same folder spelled with either slash or letter case maps to one key.
pub fn key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Asks git where the worktree holding `path` (a folder or a file in it) keeps its state.
pub fn places(path: &Path) -> Result<Places, String> {
    // T-033-c (council FIX-SOON 1): a diff tab on a deleted file, or a file in a deleted folder,
    // still gets its watch: git is asked from the nearest folder that exists.
    let dir = path.ancestors().find(|p| p.is_dir()).ok_or_else(|| format!("{} is not inside any folder", path.display()))?;
    let out = crate::git::run(&["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], Some(dir))?;
    let mut l = out.lines().map(|s| PathBuf::from(s.trim()));
    match (l.next(), l.next(), l.next()) {
        (Some(root), Some(git_dir), Some(common)) => Ok(Places { root, git_dir, common }),
        _ => Err(format!("{} is not inside a Git worktree", path.display())),
    }
}

/// Why a folder is not watched but read every 4 s: a network drive or a path that leads elsewhere
/// (a junction or a substituted drive), where change reports cannot be trusted.
/// EDIT-044 (T-062-b, DT-C70): a worktree inside a WSL distribution (`\\wsl$\` or `\\wsl.localhost\`)
/// is read every 4 s from the start. Nothing of ours runs inside the distribution, so there is no
/// watcher there to retry when it runs out of watch capacity, and change reports through the share
/// cannot be relied on; the 4 s read is the retry that never goes quiet. Decided from the spelling
/// alone, before the drive-type call, so no share is contacted.
pub fn unwatchable(root: &Path) -> Option<String> {
    if crate::fsops::is_wsl(root) {
        return Some("it is inside a WSL distribution, which is read every 4 s rather than watched".into());
    }
    #[cfg(windows)]
    {
        let drive: String = root.to_string_lossy().chars().take(3).collect();
        let wide: Vec<u16> = drive.encode_utf16().chain(Some(0)).collect();
        // SAFETY: a NUL-terminated wide string that outlives the call.
        if unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(wide.as_ptr()) } == 4 {
            return Some("it is on a network drive".into());
        }
    }
    let real = std::fs::canonicalize(root).map_err(|e| e.to_string()).ok()?;
    let real = real.to_string_lossy();
    let real = real.strip_prefix(r"\\?\").unwrap_or(&real);
    (key(real) != key(&root.to_string_lossy())).then(|| format!("its path leads to {real}"))
}

/// Splits a FILE_NOTIFY_INFORMATION chain into paths with forward slashes.
pub fn parse_notify(buf: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = 0usize;
    let word = |b: &[u8], i: usize| b.get(i..i + 4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]) as usize);
    while let (Some(next), Some(len)) = (word(buf, at), word(buf, at + 8)) {
        let Some(name) = buf.get(at + 12..at + 12 + len) else { break };
        let wide: Vec<u16> = name.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        out.push(String::from_utf16_lossy(&wide).replace('\\', "/"));
        if next == 0 {
            break;
        }
        at += next;
    }
    out
}

/// A kernel handle, closed once when its last owner goes.
#[cfg(windows)]
struct Owned(windows_sys::Win32::Foundation::HANDLE);
// SAFETY: a kernel handle may be used and closed from any thread.
#[cfg(windows)]
unsafe impl Send for Owned {}
// SAFETY: as above; the handle itself is never changed after it is made.
#[cfg(windows)]
unsafe impl Sync for Owned {}
#[cfg(windows)]
impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateFileW / CreateEventW and is closed once.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// T-033-e: the event that wakes every reader of a watch the moment it is stopped, so a stop never
/// waits out a reader's 500 ms wait slice: a workspace removal joins its readers before git deletes
/// the folder they hold open. Without the event (it could not be made) the readers still end on the
/// stop flag within that slice.
struct Wake {
    #[cfg(windows)]
    ev: Option<Owned>,
}

impl Wake {
    fn new() -> Arc<Wake> {
        #[cfg(windows)]
        {
            // SAFETY: a manual-reset, unnamed event; once set it stays set, which is what a stop is.
            let ev = unsafe { windows_sys::Win32::System::Threading::CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
            Arc::new(Wake { ev: (!ev.is_null()).then_some(Owned(ev)) })
        }
        #[cfg(not(windows))]
        {
            Arc::new(Wake {})
        }
    }
    fn set(&self) {
        #[cfg(windows)]
        if let Some(ev) = &self.ev {
            // SAFETY: our own event, open as long as self lives.
            unsafe { windows_sys::Win32::System::Threading::SetEvent(ev.0) };
        }
    }
}

/// One open watch, shared by every caller of the same worktree.
struct Watch {
    id: u64,
    refs: usize,
    tx: Sender<Signal>,
    stop: Arc<AtomicBool>,
    wake: Arc<Wake>,
    /// Live: the worker turns it off when the watch falls back to the 4 s read (T-033-e), so a
    /// caller joining later is told the truth.
    watching: Arc<AtomicBool>,
    /// The reader threads; joined only where the folder must be free of handles (`unwatch_root`).
    readers: Vec<std::thread::JoinHandle<()>>,
    /// FIX-1: tells the page the watch ended on its own, so it watches again.
    ended: Ended,
}

impl Watch {
    /// Tells the worker and every reader to end; nobody is waited for.
    fn halt(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.wake.set();
        let _ = self.tx.send(Signal::Stop);
    }
}

static WATCHES: Mutex<BTreeMap<String, Watch>> = Mutex::new(BTreeMap::new());

/// Takes watch `k` out of the table (and its ignore answers); the caller halts or joins it.
fn take(k: &str) -> Option<Watch> {
    take_from(&mut WATCHES.lock().unwrap_or_else(|e| e.into_inner()), k)
}

fn take_from(all: &mut BTreeMap<String, Watch>, k: &str) -> Option<Watch> {
    IGNORES.lock().unwrap_or_else(|e| e.into_inner()).remove(k);
    all.remove(k)
}
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStart {
    /// The event the status arrives on is `scm-status-<id>`.
    pub id: u64,
    pub worktree: String,
    /// False when the worktree is read every 4 s instead.
    pub watching: bool,
}

/// What the worker does with a fresh status.
type Sink = Arc<dyn Fn(&crate::scm::Status) + Send + Sync>;
type Log = Arc<dyn Fn(&str) + Send + Sync>;
/// FIX-1: told the id of a watch that ended on its own (its folder went, or its removal failed
/// after the watch was ended for it); the page hears it as `scm-watch-ended-<id>` and subscribes
/// again. Never called for the page's own `unwatch` or for the window going.
pub type Ended = Arc<dyn Fn(u64) + Send + Sync>;

/// The change-read buffer, in DWORDs: 256 KB, the most Windows passes over the network and plenty
/// for a local build's burst (a test passes a smaller one to force a real overflow).
const BUF_WORDS: usize = 64 * 1024;

/// Starts (or joins) the watch of the worktree holding `path`; nobody is told when it ends.
#[cfg(test)] // the app calls watch_with since MERGE 169; the tests still use this short form
pub fn watch(path: &Path, sink: impl Fn(u64) -> Sink, log: Log) -> Result<WatchStart, String> {
    watch_with(path, sink, Arc::new(|_| {}), log)
}

/// Starts (or joins) the watch of the worktree holding `path`; `ended` is told its id if it ends
/// on its own (FIX-1).
pub fn watch_with(path: &Path, sink: impl Fn(u64) -> Sink, ended: Ended, log: Log) -> Result<WatchStart, String> {
    let gen = generation();
    let p = places(path)?;
    watch_in(gen, p, sink, ended, log)
}

/// FIX-2 (review AFTER 5): the page generation; `unwatch_all` (a reload, the window going) moves
/// it on, and a watch call that read the old one before asking git is refused instead of inserting
/// or joining a watch the new page never releases.
static GENERATION: AtomicU64 = AtomicU64::new(1);

pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

/// Starts or joins the watch of `p` for a call that read generation `gen` before asking git.
fn watch_in(gen: u64, p: Places, sink: impl Fn(u64) -> Sink, ended: Ended, log: Log) -> Result<WatchStart, String> {
    let k = key(&p.root.to_string_lossy());
    let worktree = p.root.to_string_lossy().to_string();
    let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    // Under the same lock `unwatch_all` moves the generation on, so a call from before it is seen
    // here for sure, and refused before any reader starts.
    if generation() != gen {
        return Err("the page was torn down while its watch was starting".into());
    }
    if let Some(w) = all.get_mut(&k) {
        w.refs += 1;
        return Ok(WatchStart { id: w.id, worktree, watching: w.watching.load(Ordering::Relaxed) });
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    let stop = Arc::new(AtomicBool::new(false));
    let wake = Wake::new();
    let mut readers = Vec::new();
    let mut why = unwatchable(&p.root);
    if why.is_none() {
        for (dir, recursive, spot) in p.watches() {
            match start_reader(&dir, recursive, spot, tx.clone(), stop.clone(), wake.clone(), BUF_WORDS) {
                Ok(h) => readers.push(h),
                Err(e) => {
                    why = Some(format!("{} could not be watched: {e}", dir.display()));
                    stop.store(true, Ordering::Relaxed);
                    wake.set();
                    break;
                }
            }
        }
    }
    let mode = match &why {
        None => Mode::Watching,
        Some(w) => {
            log(&format!("source control: {worktree} is read every 4 s instead of watched: {w}"));
            Mode::Polling
        }
    };
    let root = p.root.clone();
    let send = sink(id);
    let wlog = log.clone();
    let watching = Arc::new(AtomicBool::new(mode == Mode::Watching));
    let live = watching.clone();
    let tell = ended.clone();
    if let Err(e) = std::thread::Builder::new().name(format!("scm-watch-{id}")).spawn(move || worker(id, &root, mode, rx, send, wlog, live, tell)) {
        // FIX-1 (review AFTER 12): the readers already started would otherwise stay alive holding
        // the folders open; they end on the flag and the wake event like any stopped watch.
        stop.store(true, Ordering::Relaxed);
        wake.set();
        return Err(e.to_string());
    }
    let start = WatchStart { id, worktree, watching: mode == Mode::Watching };
    all.insert(k, Watch { id, refs: 1, tx, stop, wake, watching, readers, ended });
    Ok(start)
}

/// FIX-1: a watch `unwatch_root` ended for a removal. If the removal then fails (a lock held on
/// the folder, say), `tell_page` has the page watch the folder again; after a removal that
/// succeeded it is dropped unused, since the workspace and its panel are gone.
#[must_use = "a removal that failed must call tell_page, or the panel stays silent"]
pub struct Stopped {
    id: u64,
    ended: Ended,
}

impl Stopped {
    #[cfg(test)] // only the tests read it
    pub fn id(&self) -> u64 {
        self.id
    }
    /// The folder stays after all: the page is told its watch ended, so it watches again.
    pub fn tell_page(self) {
        (self.ended)(self.id);
    }
}

/// One caller is done with watch `id`; the last one stops it (nobody is waited for).
pub fn unwatch(id: u64) {
    let w = {
        let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
        let Some(k) = all.iter().find(|(_, w)| w.id == id).map(|(k, _)| k.clone()) else { return };
        let w = all.get_mut(&k).expect("found above");
        w.refs -= 1;
        if w.refs > 0 {
            return;
        }
        take_from(&mut all, &k)
    };
    if let Some(w) = w {
        w.halt();
    }
}

/// T-033-e: a workspace is being removed: its watch ends whatever the callers' count, and the
/// readers are waited for, so no folder handle of ours stands in the way of git deleting the
/// folder. `root` is the worktree as the caller has it (any slashes or case); the handle to tell
/// the page with when there was a watch (FIX-1). It joins threads, so it runs on a background
/// command's thread (the caller, `workspace_remove`, is an `async` command since MERGE 169).
/// Only the watch of that very folder is ended (FIX-1): when the key misses, git is asked from the
/// folder, and its answer counts only if it is the same folder (a gone workspace, or a plain folder
/// inside the project, would otherwise end the project's own watch).
pub fn unwatch_root(root: &Path) -> Option<Stopped> {
    let k = key(&root.to_string_lossy());
    let w = take(&k).or_else(|| {
        if !root.is_dir() {
            return None;
        }
        let p = places(root).ok()?;
        let same = std::fs::canonicalize(&p.root).ok()? == std::fs::canonicalize(root).ok()?;
        same.then(|| take(&key(&p.root.to_string_lossy()))).flatten()
    });
    let w = w?;
    w.halt();
    for h in w.readers {
        let _ = h.join();
    }
    Some(Stopped { id: w.id, ended: w.ended })
}

/// T-033-e: the window is gone (closed, or its page torn down): every watch ends at once, none is
/// waited for (this is called from the window's own thread). Returns how many were open.
/// Its callers are in lib.rs (since MERGE 169): the main window's Destroyed handler, and
/// `on_page_load` when the main page starts loading (a reload destroys no window). FIX-2 (review
/// AFTER 5): it also moves the page generation on, so a watch call the old page started and that
/// finishes after this is refused.
pub fn unwatch_all() -> usize {
    let all: Vec<Watch> = {
        let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
        GENERATION.fetch_add(1, Ordering::SeqCst);
        std::mem::take(&mut *all).into_values().collect()
    };
    IGNORES.lock().unwrap_or_else(|e| e.into_inner()).clear();
    for w in &all {
        w.halt();
    }
    all.len()
}

/// Test seam and evidence harness: breaks watch `id` as an error would. False when no such watch
/// is open.
#[cfg(test)]
pub fn break_watch(id: u64, why: &str) -> bool {
    let all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    all.values().find(|w| w.id == id).is_some_and(|w| {
        w.stop.store(true, Ordering::Relaxed);
        w.tx.send(Signal::Broken(why.to_string())).is_ok()
    })
}

/// Test seam: overflows watch `id` as a too-full change buffer would (the readers keep going).
#[cfg(test)]
pub fn overflow_watch(id: u64) -> bool {
    let all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    all.values().find(|w| w.id == id).is_some_and(|w| w.tx.send(Signal::Overflow).is_ok())
}

/// Test seam: the stop flag every reader of watch `id` holds a count on, so a test can see the
/// readers go (the count falls to the test's own one).
#[cfg(test)]
pub fn stop_of(id: u64) -> Option<Arc<AtomicBool>> {
    let all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    all.values().find(|w| w.id == id).map(|w| w.stop.clone())
}

/// How many watches are open (tests and the evidence harness).
#[cfg(test)]
pub fn open_count() -> usize {
    WATCHES.lock().map(|a| a.len()).unwrap_or(0)
}

/// When each read began, per root (tests: a read's own length varies with load, its start does not).
#[cfg(test)]
pub static STARTS: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// When the worker reads: a settled change (the debounce) no sooner than `gap` after the last read
/// began, and the mode's tick regardless.
#[derive(Debug)]
pub struct Schedule {
    deb: Debounce,
    last: Instant,
    pending: bool,
    force: bool,
    gap: Duration,
}

impl Schedule {
    pub fn new(last: Instant, gap: Duration) -> Self {
        Schedule { deb: Debounce::new(QUIET, CAP), last, pending: false, force: false, gap }
    }
    pub fn change(&mut self, now: Instant) {
        self.deb.hit(now);
    }
    /// Read at the next turn whatever the gap says (changes may have been missed).
    pub fn at_once(&mut self) {
        self.force = true;
    }
    /// How long to wait for the next thing to do.
    pub fn wait(&self, now: Instant, tick: Duration) -> Duration {
        if self.force {
            return Duration::ZERO;
        }
        let mut until = self.last + tick;
        if self.pending {
            until = until.min(self.last + self.gap);
        }
        let until = until.saturating_duration_since(now);
        self.deb.wait(now).map_or(until, |d| d.min(until))
    }
    /// True when a read is due now (and counts it as begun).
    pub fn due(&mut self, now: Instant, tick: Duration) -> bool {
        if self.deb.take(now) {
            self.pending = true;
        }
        if self.force || (self.pending && now >= self.last + self.gap) || now >= self.last + tick {
            self.last = now;
            self.pending = false;
            self.force = false;
            true
        } else {
            false
        }
    }
}

/// Waits on the signals, reads the status when a change has settled or a tick is due, and sends it.
#[allow(clippy::too_many_arguments)]
fn worker(id: u64, root: &Path, mut mode: Mode, rx: std::sync::mpsc::Receiver<Signal>, send: Sink, log: Log, watching: Arc<AtomicBool>, ended: Ended) {
    let mut sched = Schedule::new(Instant::now(), GAP);
    let mut said_overflow = false;
    // FIX-2 (review AFTER 7): an overflow may have dropped a rule-file edit, so the remembered
    // ignore answers are forgotten; once, at the catch-up read, however many overflows the storm
    // brought (each forget costs a `git check-ignore` on the next change under a remembered folder).
    let mut forget_at_read = false;
    loop {
        let wait = sched.wait(Instant::now(), mode.tick());
        match rx.recv_timeout(wait) {
            Ok(Signal::Change) => sched.change(Instant::now()),
            Ok(Signal::Overflow) => {
                // T-033-e: the reader is reading again already; what was missed is caught up by one
                // read, on the same quiet time and gap as a change (a storm of overflows is still at
                // most 15 reads a minute).
                if !said_overflow {
                    said_overflow = true;
                    log(&format!("source control: too many changes at once under {}; read again, still watching", root.display()));
                }
                forget_at_read = true;
                sched.change(Instant::now());
            }
            Ok(Signal::Broken(why)) => {
                if !root.is_dir() {
                    return gone(id, root, &log, &ended);
                }
                let (next, first) = mode.broken();
                if first {
                    watching.store(false, Ordering::Relaxed);
                    log(&format!("source control: the watch on {} stopped ({why}); reading it every 4 s instead", root.display()));
                    sched.at_once(); // read now: changes may have been missed
                }
                mode = next;
            }
            Ok(Signal::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        if sched.due(now, mode.tick()) {
            if !root.is_dir() {
                return gone(id, root, &log, &ended);
            }
            if forget_at_read {
                forget_at_read = false;
                ignores_of(root).lock().unwrap_or_else(|e| e.into_inner()).forget();
            }
            #[cfg(test)]
            STARTS.lock().unwrap_or_else(|e| e.into_inner()).push((root.to_path_buf(), now));
            if let Ok(st) = crate::scm::status(root) {
                send(&st);
            }
        }
    }
}

/// T-033-e: the worktree folder is gone (removed from outside, or by git): the watch ends instead
/// of reading a missing folder every 4 s for the rest of the session. Said once in the log, and
/// the page is told (FIX-1), which watches again at once and then, while git still answers from
/// another folder or not at all, tries again with backoff (FIX-2, 1 s / 4 s / 15 s / every 30 s
/// while its panel is open): a folder that is only briefly unreadable gets watched again.
fn gone(id: u64, root: &Path, log: &Log, ended: &Ended) {
    let w = {
        let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
        let k = all.iter().find(|(_, w)| w.id == id).map(|(k, _)| k.clone());
        k.and_then(|k| take_from(&mut all, &k))
    };
    if let Some(w) = w {
        w.halt();
        log(&format!("source control: {} is gone; its watch stopped", root.display()));
        ended(id);
    }
}

/// Debug builds only: `KOLUX_DEV_INJECT=watch-error` breaks every watch on its first change, so
/// the fall-back read can be shown live.
fn injected_break() -> bool {
    cfg!(debug_assertions) && std::env::var("KOLUX_DEV_INJECT").is_ok_and(|v| v == "watch-error")
}

/// Starts the reader thread of one folder; the handle is the thread's, and the thread ends when the
/// stop flag is set (at once through `wake`, else within its 500 ms wait slice).
#[cfg(windows)]
fn start_reader(dir: &Path, recursive: bool, spot: Spot, tx: Sender<Signal>, stop: Arc<AtomicBool>, wake: Arc<Wake>, buf_words: usize) -> Result<std::thread::JoinHandle<()>, String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOTIFY_ENUM_DIR, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForMultipleObjects, WaitForSingleObject};
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    let root = dir.to_path_buf();
    let wide: Vec<u16> = dir.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    // SAFETY: a NUL-terminated wide path; the flags open a folder for overlapped change reads.
    let h = unsafe { CreateFileW(wide.as_ptr(), FILE_LIST_DIRECTORY, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, std::ptr::null(), OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, std::ptr::null_mut()) };
    if h == INVALID_HANDLE_VALUE {
        // SAFETY: plain thread-local error read.
        return Err(format!("could not open the folder (error {})", unsafe { GetLastError() }));
    }
    let h = Owned(h);
    // SAFETY: a manual-reset, unnamed event.
    let ev = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if ev.is_null() {
        return Err("could not make a wait event".into());
    }
    let ev = Owned(ev);
    let filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_CREATION;
    let label = dir.display().to_string();
    std::thread::Builder::new()
        .name("scm-watch-reader".into())
        .spawn(move || {
            let (h, ev) = (h, ev);
            let mut buf = vec![0u32; buf_words]; // DWORD-aligned as the call needs
            let bytes = buf.len() * 4;
            let broke = |why: String| drop(tx.send(Signal::Broken(why)));
            // FIX-2 (review AFTER 6): the kernel writes into the OVERLAPPED while a read is pending,
            // so it lives in an UnsafeCell and is only ever reached through this raw pointer; no
            // reference to it exists while a read is outstanding.
            let ov_cell: Box<std::cell::UnsafeCell<OVERLAPPED>> = Box::new(std::cell::UnsafeCell::new(unsafe { std::mem::zeroed() }));
            let ov: *mut OVERLAPPED = ov_cell.get();
            loop {
                // SAFETY: no read is pending here (the first turn, or the previous read completed or
                // was cancelled and waited for below); the cell outlives the thread's loop.
                unsafe {
                    ov.write(std::mem::zeroed());
                    (*ov).hEvent = ev.0;
                    ResetEvent(ev.0);
                }
                // SAFETY: the buffer and the OVERLAPPED stay put until the read completes or is
                // cancelled below, both before this iteration ends.
                let ok = unsafe { ReadDirectoryChangesW(h.0, buf.as_mut_ptr().cast(), bytes as u32, i32::from(recursive), filter, std::ptr::null_mut(), ov, None) };
                if ok == 0 {
                    return broke(format!("{label}: the change read failed (error {})", unsafe { GetLastError() }));
                }
                let mut n = 0u32;
                // FIX-1 (review AFTER 11): while a read is outstanding the kernel may still write
                // into `buf`, so every return first cancels the read and waits for it to end.
                let settle = |n: &mut u32| unsafe {
                    // SAFETY: cancels our pending read, then waits for it to finish with the buffer.
                    CancelIoEx(h.0, ov);
                    GetOverlappedResult(h.0, ov, n, 1);
                };
                loop {
                    // SAFETY: waits on our own read event and, when there is one, the watch's stop event.
                    let r = match &wake.ev {
                        Some(w) => unsafe { WaitForMultipleObjects(2, [ev.0, w.0].as_ptr(), 0, 500) },
                        None => unsafe { WaitForSingleObject(ev.0, 500) },
                    };
                    let stopped = r == WAIT_OBJECT_0 + 1 || (r == WAIT_TIMEOUT && stop.load(Ordering::Relaxed));
                    if stopped {
                        settle(&mut n);
                        return;
                    }
                    if r == WAIT_OBJECT_0 {
                        break; // the read signalled
                    }
                    if r != WAIT_TIMEOUT {
                        // The wait itself failed; the read is still outstanding.
                        let e = unsafe { GetLastError() };
                        settle(&mut n);
                        return broke(format!("{label}: the wait failed (error {e})"));
                    }
                }
                // SAFETY: the read has signalled; collects its byte count.
                if unsafe { GetOverlappedResult(h.0, ov, &mut n, 0) } == 0 {
                    let e = unsafe { GetLastError() };
                    if e == ERROR_NOTIFY_ENUM_DIR {
                        // T-033-e: the buffer overflowed. Windows dropped the records but keeps the
                        // watch, so the next read is issued and the worker catches up with one read.
                        if tx.send(Signal::Overflow).is_err() {
                            return;
                        }
                        continue;
                    }
                    return broke(format!("{label}: error {e}"));
                }
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                if n == 0 {
                    // The same overflow, reported as an empty result on some Windows versions.
                    if tx.send(Signal::Overflow).is_err() {
                        return;
                    }
                    continue;
                }
                // SAFETY: the first n bytes of the buffer were written by the read.
                let raw = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), n as usize) };
                if parse_notify(raw).iter().any(|p| matters(&root, spot, p)) {
                    if injected_break() {
                        return broke("injected for testing".into());
                    }
                    if tx.send(Signal::Change).is_err() {
                        return;
                    }
                }
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn start_reader(_dir: &Path, _recursive: bool, _spot: Spot, _tx: Sender<Signal>, _stop: Arc<AtomicBool>, _wake: Arc<Wake>, _buf_words: usize) -> Result<std::thread::JoinHandle<()>, String> {
    Err("folder watching is only built for Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn git_folder_counts_only_head_index_and_refs() {
        for rel in [".git/HEAD", ".git/index", ".git/refs/heads/main", ".git/refs/remotes/origin/x", ".git/refs"] {
            assert!(counts(Spot::Tree, rel), "{rel}");
        }
        for rel in [".git/index.lock", ".git/objects/ab/cdef", ".git/objects", ".git/FETCH_HEAD", ".git/logs/HEAD", ".git/ORIG_HEAD", ".git/config", ".git/COMMIT_EDITMSG"] {
            assert!(!counts(Spot::Tree, rel), "{rel}");
        }
        assert!(counts(Spot::GitDir, "HEAD") && counts(Spot::GitDir, "index"));
        assert!(!counts(Spot::GitDir, "index.lock") && !counts(Spot::GitDir, "logs/HEAD") && !counts(Spot::GitDir, "ORIG_HEAD"));
        assert!(counts(Spot::Refs, "heads/feature"));
    }

    #[test]
    fn ignored_folders_are_asked_of_git_once_and_remembered_per_root() {
        let mut ig = Ignores::default();
        let asked = std::cell::RefCell::new(Vec::<Vec<String>>::new());
        // git ignores `target/` and `web/node_modules/`; a negation pattern un-ignores `keep/`.
        let mut ask = |dirs: &[String]| {
            asked.borrow_mut().push(dirs.to_vec());
            Some(dirs.iter().map(|d| d == "target" || d == "web/node_modules").collect())
        };
        assert!(ig.ignored("target/debug/x.rlib", &mut ask));
        assert!(ig.ignored("target/debug/deps/a.d", &mut ask), "resolved from the remembered `target`");
        assert!(!ig.ignored("src/main.rs", &mut ask));
        assert!(!ig.ignored("src/lib.rs", &mut ask));
        assert!(!ig.ignored("README.md", &mut ask), "a root file asks nothing");
        assert!(ig.ignored("web/node_modules/react/index.js", &mut ask));
        assert_eq!(*asked.borrow(), vec![vec!["target".to_string(), "target/debug".into()], vec!["src".to_string()], vec!["web".to_string(), "web/node_modules".into(), "web/node_modules/react".into()]]);
        // The rules changed: the answers are forgotten and asked again.
        ig.forget();
        assert!(!ig.ignored("src/main.rs", &mut ask));
        assert_eq!(asked.borrow().len(), 4);
        // When git cannot answer, the fixed list stands in, on any segment, case-insensitive.
        let mut none = |_: &[String]| None;
        let mut fresh = Ignores::default();
        for rel in ["target/debug/x.rlib", "src-tauri/target/debug/deps/a.d", "pkg/dist/app.js", ".venv/lib/site.py", "a/Node_Modules/b"] {
            assert!(fresh.ignored(rel, &mut none), "{rel}");
        }
        for rel in ["src/main.rs", "targets.md", "distance/a.txt", "a b/ü.txt"] {
            assert!(!fresh.ignored(rel, &mut none), "{rel}");
        }
        // A stand-in answer is not remembered: once git can answer, it is asked.
        assert!(!fresh.ignored("target/debug/x.rlib", &mut |d: &[String]| Some(vec![false; d.len()])));
        assert!(is_rule_file(".gitignore") && is_rule_file("web/.gitignore") && is_rule_file(".git/info/exclude"));
        assert!(!is_rule_file("src/gitignore.md") && !is_rule_file(".gitignore.bak"));
    }

    #[test]
    fn check_ignore_output_is_read_per_asked_folder_with_negations() {
        let dirs: Vec<String> = ["target", "src", "keep", "later"].iter().map(|s| s.to_string()).collect();
        let out = ".gitignore\x001\x00target/\x00target/\x00\x00\x00\x00src/\x00.gitignore\x003\x00!keep/\x00keep/\x00\x00\x00\x00later/\x00";
        assert_eq!(parse_check_ignore(out, &dirs), vec![true, false, false, false]);
        assert_eq!(parse_check_ignore("", &dirs), vec![false; 4], "no output: nothing ignored");
    }

    #[test]
    fn a_real_repo_answers_check_ignore_for_folders_and_nested_rules() {
        let dir = repo("ignore");
        std::fs::write(dir.join(".gitignore"), "target/\n*.log\n").unwrap();
        std::fs::create_dir_all(dir.join("web")).unwrap();
        std::fs::write(dir.join("web/.gitignore"), "node_modules/\n").unwrap();
        let ask = |names: &[&str]| ask_git(&dir, &names.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(ask(&["target", "src", "web/node_modules", "web/src"]), Some(vec![true, false, true, false]));
        assert_eq!(ask(&["src"]), Some(vec![false]), "exit 1 (nothing ignored) is an answer");
        let mut ig = Ignores::default();
        assert!(ig.ignored("target/debug/f1", &mut |d| ask_git(&dir, d)));
        assert!(!ig.ignored("src/main.rs", &mut |d| ask_git(&dir, d)));
        assert!(ig.ignored("web/node_modules/react/index.js", &mut |d| ask_git(&dir, d)));
        let nowhere = std::env::temp_dir().join(format!("scm-watch-norepo-{}", std::process::id()));
        std::fs::create_dir_all(&nowhere).unwrap();
        assert_eq!(ask_git(&nowhere, &["target".to_string()]), None, "outside a repository git cannot answer");
        let _ = std::fs::remove_dir_all(&nowhere);
    }

    #[test]
    fn t033f_an_ignored_folder_with_tracked_files_is_kept_and_exclude_edits_forget_through_matters() {
        let dir = repo("t033f");
        std::fs::create_dir_all(dir.join("gen")).unwrap();
        std::fs::write(dir.join("gen/a.txt"), "tracked\n").unwrap();
        crate::git::run(&["add", "gen/a.txt"], Some(&dir)).unwrap();
        std::fs::write(dir.join(".gitignore"), "gen/\n").unwrap();
        assert!(matters(&dir, Spot::Tree, ".gitignore"));
        // Pins git's own behaviour: check-ignore says "not ignored" for a folder holding a tracked
        // file (no second git process needed), while the build/ checks below show a plain one ignored.
        assert_eq!(ask_git(&dir, &["gen".to_string()]), Some(vec![false]));
        assert!(matters(&dir, Spot::Tree, "gen/a.txt"), "gen/ is ignored but tracks a file: a change there counts");
        // The main checkout's exclude file: the answers it gave are forgotten when it changes.
        std::fs::create_dir_all(dir.join(".git/info")).unwrap();
        std::fs::write(dir.join(".git/info/exclude"), "build/\n").unwrap();
        assert!(matters(&dir, Spot::Tree, ".git/info/exclude"), "an exclude edit reads once");
        assert!(!matters(&dir, Spot::Tree, "build/out.bin"), "build/ is excluded and tracks nothing");
        std::fs::write(dir.join(".git/info/exclude"), "").unwrap();
        assert!(matters(&dir, Spot::Tree, ".git/info/exclude"));
        assert!(matters(&dir, Spot::Tree, "build/out.bin"), "the old answer was forgotten");
        // A linked worktree watches the shared info folder and its exclude forgets that worktree's answers.
        std::fs::write(dir.join(".git/info/exclude"), "cache/\n").unwrap();
        crate::git::run(&["commit", "-q", "-m", "gen"], Some(&dir)).unwrap();
        let linked = std::env::temp_dir().join(format!("scm-watch-t033f-linked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&linked);
        crate::git::run(&["worktree", "add", "-q", &linked.to_string_lossy(), "-b", "t033f-linked"], Some(&dir)).unwrap();
        let p = places(&linked).unwrap();
        assert!(p.watches().iter().any(|(d, r, s)| *s == Spot::Info && !r && d.ends_with("info")), "{:?}", p.watches());
        assert!(!matters(&p.root, Spot::Tree, "cache/x"), "the shared exclude applies to the linked worktree");
        std::fs::write(dir.join(".git/info/exclude"), "").unwrap();
        assert!(!matters(&p.root, Spot::Info, "other"), "only the exclude file counts in info/");
        assert!(matters(&p.root, Spot::Info, "exclude"));
        assert!(matters(&p.root, Spot::Tree, "cache/x"), "forgotten through the shared info folder");
        let _ = crate::git::run(&["worktree", "remove", "--force", &linked.to_string_lossy()], Some(&dir));
        let _ = std::fs::remove_dir_all(&linked);
    }

    #[test]
    fn a_diff_tab_on_a_deleted_file_still_finds_its_worktree() {
        let dir = repo("deleted-file");
        let whole = places(&dir).unwrap();
        assert_eq!(places(&dir.join("gone/deeper/deleted.txt")).unwrap(), whole);
        assert_eq!(places(&dir.join("a.txt")).unwrap(), whole);
        assert!(places(Path::new("Q:/no-such-drive/x.txt")).is_err());
    }

    #[test]
    fn a_change_soon_after_a_read_waits_for_the_gap_but_a_tick_never_does() {
        let t0 = Instant::now();
        let gap = Duration::from_secs(3);
        let tick = Duration::from_secs(30);
        // Just read at t0: a change at +100 ms settles at +350 ms but is read at +3 s.
        let mut s = Schedule::new(t0, gap);
        s.change(t0 + Duration::from_millis(100));
        assert_eq!(s.wait(t0 + Duration::from_millis(100), tick), QUIET);
        assert!(!s.due(t0 + Duration::from_millis(400), tick));
        assert_eq!(s.wait(t0 + Duration::from_millis(400), tick), Duration::from_millis(2600), "waits for the gap, not the tick");
        assert!(!s.due(t0 + Duration::from_millis(2999), tick));
        assert!(s.due(t0 + Duration::from_secs(3), tick));
        assert!(!s.due(t0 + Duration::from_secs(3), tick), "read once");
        // Churn for a minute: reads begin at most every `GAP` (4 s: 15 a minute).
        let mut s = Schedule::new(t0, GAP);
        let mut reads = 0;
        let mut t = t0;
        while t < t0 + Duration::from_secs(60) {
            s.change(t);
            if s.due(t, tick) {
                reads += 1;
            }
            t += Duration::from_millis(100);
        }
        assert!(reads <= 15, "{reads} reads in a minute");
        // Long quiet: a change is read as soon as it settles, and the tick comes on time.
        let mut s = Schedule::new(t0 - Duration::from_secs(10), gap);
        s.change(t0);
        assert!(s.due(t0 + QUIET, tick));
        assert_eq!(s.wait(t0 + QUIET, tick), tick);
        assert!(s.due(t0 + QUIET + tick, tick), "the tick reads regardless of the gap");
        // A broken watch reads at once, gap or not.
        let mut s = Schedule::new(t0, gap);
        s.at_once();
        assert_eq!(s.wait(t0 + Duration::from_millis(10), tick), Duration::ZERO);
        assert!(s.due(t0 + Duration::from_millis(10), tick));
        assert!(!s.due(t0 + Duration::from_millis(20), tick));
    }

    #[test]
    fn debounce_waits_for_quiet_and_caps_a_burst() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        let mut d = Debounce::new(ms(250), ms(1000));
        assert_eq!(d.wait(t0), None);
        assert!(!d.take(t0));
        d.hit(t0);
        assert_eq!(d.wait(t0 + ms(100)), Some(ms(150)));
        d.hit(t0 + ms(200)); // a second change restarts the quiet timer
        assert!(!d.take(t0 + ms(300)));
        assert!(d.take(t0 + ms(450)));
        assert_eq!(d.wait(t0 + ms(460)), None, "cleared once taken");
        // A change every 100 ms never goes quiet; the read still comes at 1 s.
        let b = t0 + ms(2000);
        let mut fired = None;
        for i in 0..30u64 {
            let now = b + ms(i * 100);
            if d.take(now) {
                fired = Some(i);
                break;
            }
            d.hit(now);
        }
        assert_eq!(fired, Some(10));
    }

    #[test]
    fn a_broken_watch_polls_every_4_s_and_logs_once() {
        assert_eq!(Mode::Watching.tick(), SAFETY);
        let (m, first) = Mode::Watching.broken();
        assert_eq!((m, first), (Mode::Polling, true));
        assert_eq!(m.tick(), FALLBACK);
        assert_eq!(m.broken(), (Mode::Polling, false));
    }

    #[test]
    fn notify_records_parse_into_forward_slash_paths() {
        let mut buf = Vec::new();
        let rec = |name: &str, act: u32, last: bool| {
            let w: Vec<u8> = name.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
            let mut r = Vec::new();
            let len = 12 + w.len();
            let pad = (4 - len % 4) % 4;
            r.extend((if last { 0 } else { (len + pad) as u32 }).to_le_bytes());
            r.extend(act.to_le_bytes());
            r.extend((w.len() as u32).to_le_bytes());
            r.extend(w);
            r.extend(vec![0; pad]);
            r
        };
        buf.extend(rec(r"src\main.rs", 3, false));
        buf.extend(rec(r".git\index", 1, false));
        buf.extend(rec("ü.txt", 2, true));
        assert_eq!(parse_notify(&buf), ["src/main.rs", ".git/index", "ü.txt"]);
        assert!(parse_notify(&[1, 2, 3]).is_empty());
    }

    #[test]
    fn linked_worktree_watches_its_git_folder_and_shared_refs() {
        let main = Places { root: "G:/r".into(), git_dir: "G:/r/.git".into(), common: "G:/r/.git".into() };
        assert_eq!(main.watches().len(), 1);
        let linked = Places { root: "G:/w".into(), git_dir: "G:/r/.git/worktrees/w".into(), common: "G:/r/.git".into() };
        let w = linked.watches();
        // T-033-e: the shared git folder itself too, not recursive, for its packed-refs.
        assert_eq!(w.iter().map(|(_, r, s)| (*r, *s)).collect::<Vec<_>>(), [(true, Spot::Tree), (false, Spot::GitDir), (true, Spot::Refs), (false, Spot::Common)]);
        assert_eq!(w[2].0, PathBuf::from("G:/r/.git").join("refs"));
        assert_eq!(w[3].0, PathBuf::from("G:/r/.git"));
    }

    #[test]
    fn t033e_packed_refs_count_in_the_git_folder_and_in_the_shared_common_folder() {
        assert!(counts(Spot::Tree, ".git/packed-refs"));
        assert!(!counts(Spot::Tree, ".git/packed-refs.lock"));
        assert!(counts(Spot::Common, "packed-refs"));
        for rel in ["packed-refs.lock", "HEAD", "index", "config", "FETCH_HEAD", "ORIG_HEAD", "logs/HEAD", "objects/ab/cd"] {
            assert!(!counts(Spot::Common, rel), "{rel}");
        }
        // Through `matters`: git's folders never ask the ignore rules.
        let nowhere = Path::new("Q:/no-such-drive/r");
        assert!(matters(nowhere, Spot::Common, "packed-refs"));
        assert!(!matters(nowhere, Spot::Common, "config"));
    }

    /// The live tests share the one process-wide watch table (and `unwatch_all` empties it), so
    /// they run one at a time.
    static LIVE: Mutex<()> = Mutex::new(());
    fn live() -> std::sync::MutexGuard<'static, ()> {
        LIVE.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The git processes one `scm::status` read starts, from git's own trace2 event log.
    fn git_argvs_of_one_status_read(dir: &Path) -> Vec<String> {
        let trace = std::env::temp_dir().join(format!("kolux-rs-watch-argvs-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&trace);
        crate::git::TRACE2.with(|t| *t.borrow_mut() = Some(trace.clone()));
        crate::scm::status(dir).unwrap();
        crate::git::TRACE2.with(|t| *t.borrow_mut() = None);
        let log = std::fs::read_to_string(&trace).unwrap_or_default();
        let _ = std::fs::remove_file(&trace);
        log.lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter(|e| matches!(e["event"].as_str(), Some("start" | "child_start")))
            .map(|e| e["argv"].as_array().map(|a| a.iter().skip(1).filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())
            .collect()
    }

    /// T-033-e: the raw log of T-033-b counts two things in its churn minute, 120 status reads and
    /// 404 git processes: one read is several git commands, so the process count is the read count
    /// times this, plus the 15 s timer's own reads. With the gap holding reads to 15 a minute, the
    /// watcher's git processes are bounded by 15 times what one read costs.
    #[test]
    fn t033e_one_status_read_is_several_git_processes_which_sizes_the_raw_logs_process_count() {
        let dir = repo("cost");
        let argvs = git_argvs_of_one_status_read(&dir);
        println!("T-033-e: one status read = {} git processes: {argvs:?}", argvs.len());
        assert!(!argvs.is_empty(), "trace2 log missing");
        assert_eq!(argvs.iter().filter(|a| a.starts_with("status")).count(), 1, "{argvs:?}");
        assert!(argvs.len() >= 5, "a read is status plus the base, the operation and the line counts: {argvs:?}");
        let a_minute = argvs.len() * 60 / GAP.as_secs() as usize;
        println!("T-033-e: at most {} reads a minute = at most {a_minute} git processes a minute", 60 / GAP.as_secs());
        assert!(a_minute <= 180, "{a_minute} git processes a minute is more than the raw log's burst allows: {argvs:?}");
    }

    /// T-033-e: what the 1 s cap bounds and what the gap bounds, replayed on a churn that pauses.
    /// The cap bounds one unbroken burst; a churn loop that pauses for longer than the 250 ms quiet
    /// time at every process start (a `cargo clean` + `cargo build` cycle does) reads at every
    /// pause, more than the cap's 60 a minute. The 4 s gap of T-033-c bounds the read starts
    /// themselves, pauses or not: 15 a minute. (That the raw log of T-033-b counted 120 reads this
    /// way is the hypothesis in evidence/T-033-e.txt; this replay proves the two bounds, not the
    /// history: review AFTER 9.)
    #[test]
    fn t033e_a_pausing_churn_reads_at_every_pause_without_the_gap_and_at_most_15_a_minute_with_it() {
        let t0 = Instant::now();
        let tick = Duration::from_secs(30);
        // One cycle, 700 ms: the clean's rename, a 300 ms pause while the build starts, 150 ms of
        // writes every 10 ms, a 250 ms pause while the next clean starts.
        let cycle = Duration::from_millis(700);
        let churn = |gap: Duration| {
            let mut s = Schedule::new(t0, gap);
            let (mut reads, mut cycles) = (0, 0);
            let mut t = t0;
            while t + cycle <= t0 + Duration::from_secs(60) {
                cycles += 1;
                let mut m = 0;
                while m < 700 {
                    let now = t + Duration::from_millis(m);
                    if m == 0 || (300..450).contains(&m) {
                        s.change(now);
                    }
                    if s.due(now, tick) {
                        reads += 1;
                    }
                    m += 10;
                }
                t += cycle;
            }
            (reads, cycles)
        };
        let (no_gap, cycles) = churn(Duration::ZERO);
        assert_eq!(cycles, 85);
        assert_eq!(no_gap, 2 * cycles, "a read at every pause, two a cycle");
        assert!(no_gap > 60, "{no_gap} reads: more than the 1 s cap's 60, because the cap is per burst");
        let (gapped, _) = churn(GAP);
        assert!(gapped <= 15, "{gapped} reads in a minute with the gap");
        println!("T-033-e: the T-033-b churn shape: {no_gap} reads a minute without the gap, {gapped} with it");
    }

    /// A one-commit repo under KOLUX_TEST_REPOS (the temp folder when unset), removed afterwards.
    fn repo(name: &str) -> crate::test_dir::TempDir {
        let base = std::env::var_os("KOLUX_TEST_REPOS").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let dir = crate::test_dir::TempDir(base.join(format!("scm-watch-{name}-{}", std::process::id())));
        let _ = std::fs::remove_dir_all(&*dir);
        std::fs::create_dir_all(&*dir).unwrap();
        let git = |a: &[&str]| assert!(crate::git::command(a, Some(&dir)).output().unwrap().status.success(), "{a:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@example.com"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        // T-033-c: the build folders are skipped because git ignores them, not by name.
        std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "--no-verify", "-m", "first"]);
        dir
    }

    /// Waits up to `limit` for `f` to hold.
    fn until(limit: Duration, f: impl Fn() -> bool) -> bool {
        let end = Instant::now() + limit;
        while Instant::now() < end {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        f()
    }

    #[cfg(windows)]
    #[test]
    fn a_real_repo_reports_tree_and_index_changes_but_not_build_folders() {
        let _live = live();
        let dir = repo("live");
        std::fs::create_dir_all(dir.join("crate")).unwrap();
        let seen = Arc::new(Mutex::new(Vec::<crate::scm::Status>::new()));
        let s = seen.clone();
        let logs = Arc::new(AtomicUsize::new(0));
        let l = logs.clone();
        let w = watch(&dir, move |_| { let s = s.clone(); Arc::new(move |st: &crate::scm::Status| s.lock().unwrap().push(st.clone())) as Sink }, Arc::new(move |_: &str| { l.fetch_add(1, Ordering::Relaxed); })).unwrap();
        assert!(w.watching);
        let n = || seen.lock().unwrap().len();
        std::thread::sleep(Duration::from_millis(300));
        // A build folder churns: nothing is read.
        std::fs::create_dir_all(dir.join("target/debug")).unwrap();
        for i in 0..50 {
            std::fs::write(dir.join(format!("target/debug/f{i}")), "x").unwrap();
        }
        // A nested build folder made and deleted again (cargo build / cargo clean in crate/): the
        // parent folder's own "modified" records must not count either.
        for _ in 0..5 {
            std::fs::create_dir_all(dir.join("crate/target/debug")).unwrap();
            std::fs::write(dir.join("crate/target/debug/x"), "x").unwrap();
            std::fs::remove_dir_all(dir.join("crate/target")).unwrap();
        }
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(n(), 0, "build-folder churn must not read the status");
        // A working-tree edit: one read, after the quiet time, with the change in it.
        let t = Instant::now();
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        assert!(until(Duration::from_secs(10), || n() >= 1), "a read after an edit");
        assert!(t.elapsed() >= QUIET);
        assert!(until(Duration::from_secs(10), || seen.lock().unwrap().last().is_some_and(|s| s.changed.len() == 1)));
        // Staging from outside moves the index: another read, now staged.
        assert!(crate::git::command(&["add", "a.txt"], Some(&dir)).output().unwrap().status.success());
        assert!(until(Duration::from_secs(10), || seen.lock().unwrap().last().is_some_and(|s| s.staged.len() == 1)));
        // The read itself must not move the index into another read (git status runs without optional locks).
        // How long one read takes right now: on a loaded PC it is seconds, and the windows scale with it.
        let r = Instant::now();
        crate::scm::status(&dir).unwrap();
        let window = QUIET + CAP + r.elapsed() * 2;
        let mut after = n();
        let settle = Instant::now() + Duration::from_secs(30);
        loop {
            std::thread::sleep(window); // let the add settle: no new read for a whole window
            if n() == after || Instant::now() > settle { break; }
            after = n();
        }
        std::thread::sleep(window);
        assert_eq!(n(), after, "reading the status must not trigger itself");
        // A second caller shares the watch; the last to leave stops it.
        let again = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert_eq!(again.id, w.id);
        let before = open_count();
        unwatch(w.id);
        assert_eq!(open_count(), before);
        unwatch(w.id);
        assert_eq!(open_count(), before - 1);
        assert_eq!(logs.load(Ordering::Relaxed), 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_reader_whose_folder_is_deleted_reports_the_break() {
        let dir = repo("gone");
        let sub = dir.join("watched");
        std::fs::create_dir_all(&sub).unwrap();
        let (tx, rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        start_reader(&sub, true, Spot::Refs, tx, stop.clone(), Wake::new(), BUF_WORDS).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert!(until(Duration::from_secs(5), || std::fs::remove_dir_all(&sub).is_ok() || !sub.exists()));
        let mut broke = false;
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Signal::Broken(_)) => {
                    broke = true;
                    break;
                }
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        stop.store(true, Ordering::Relaxed);
        assert!(broke, "deleting the watched folder must be reported, not go quiet");
    }

    #[cfg(windows)]
    #[test]
    fn a_broken_watch_falls_back_to_reading_every_4_s_and_says_so_once() {
        let _live = live();
        let dir = repo("fallback");
        let seen = Arc::new(Mutex::new(Vec::<Instant>::new()));
        let s = seen.clone();
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));
        let l = logs.clone();
        let w = watch(&dir, move |_| { let s = s.clone(); Arc::new(move |_: &crate::scm::Status| s.lock().unwrap().push(Instant::now())) as Sink }, Arc::new(move |m: &str| l.lock().unwrap().push(m.to_string()))).unwrap();
        assert!(w.watching);
        std::thread::sleep(Duration::from_millis(1000));
        let broke = Instant::now();
        assert!(break_watch(w.id, "test seam"));
        assert!(break_watch(w.id, "test seam again"));
        let after = || seen.lock().unwrap().iter().filter(|t| **t >= broke).copied().collect::<Vec<_>>();
        assert!(until(Duration::from_secs(120), || after().len() >= 3), "a read at once after the break, then every 4 s with no change at all");
        // Read starts, not finish times: a read is several git commands, 0.3 s alone but up to 20 s with
        // the full suite and other builds beside it. The worker reads one at a time and times the next
        // from the start of this one, so a gap is 4 s or, when the read ran longer, as long as the read:
        // the upper bound is 6 s or the read's own run (first answer after its start) plus 2 s. A slow
        // tick (30 s) still fails it; a faster one fails the 3.9 s floor.
        let st: Vec<Instant> = STARTS.lock().unwrap().iter().filter(|(r, at)| *at >= broke && std::fs::canonicalize(r).ok() == std::fs::canonicalize(&*dir).ok()).map(|(_, at)| *at).collect();
        let t: Vec<Duration> = st.iter().map(|at| *at - broke).collect();
        assert!(t.len() >= 3, "{t:?}");
        // At once is under 2 s; waiting for the 4 s tick would put it about 3 s after the break.
        assert!(t[0] < Duration::from_secs(2), "read at once: {t:?}");
        let answers = seen.lock().unwrap().clone();
        let ran = |i: usize| answers.iter().filter(|d| **d >= st[i] && **d < st[i + 1]).min().map_or(Duration::ZERO, |d| *d - st[i]);
        for i in 0..2 {
            let g = st[i + 1] - st[i];
            let room = Duration::from_secs(6).max(ran(i) + Duration::from_secs(2));
            assert!(g >= Duration::from_millis(3900) && g <= room, "every 4 s: {t:?}, read {i} ran {:?}", ran(i));
        }
        let l = logs.lock().unwrap().clone();
        assert_eq!(l.len(), 1, "said once: {l:?}");
        assert!(l[0].contains("reading it every 4 s instead") && l[0].contains("test seam"));
        // T-033-e: a caller joining now is told the watch is gone, not the flag from the start.
        let join = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert_eq!(join.id, w.id);
        assert!(!join.watching, "the watching flag stays true to life");
        unwatch(join.id);
        unwatch(w.id);
    }

    /// Whether `r` (a worker's root, as git spelled it) is the test's repo folder.
    fn same_dir(r: &Path, dir: &Path) -> bool {
        std::fs::canonicalize(r).ok() == std::fs::canonicalize(dir).ok()
    }

    #[cfg(windows)]
    #[test]
    fn t033e_an_overflow_reads_once_more_and_keeps_watching() {
        let _live = live();
        let dir = repo("overflow");
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));
        let l = logs.clone();
        let w = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(move |m: &str| l.lock().unwrap().push(m.to_string()))).unwrap();
        assert!(w.watching);
        std::thread::sleep(Duration::from_millis(300));
        // FIX-1 (review FIX-SOON 6): a `.gitignore` edit lost inside the dropped records would leave
        // the remembered answers stale, so an overflow forgets them. A planted wrong answer stands
        // in for the stale one: `src` is "ignored" until the overflow.
        let root = places(&dir).unwrap().root;
        ignores_of(&root).lock().unwrap().known.insert("src".into(), true);
        assert!(!matters(&root, Spot::Tree, "src/x.rs"), "remembered as ignored");
        let at = Instant::now();
        assert!(overflow_watch(w.id));
        assert!(overflow_watch(w.id), "two overflows close together");
        let starts = || STARTS.lock().unwrap().iter().filter(|(r, t)| *t >= at && same_dir(r, &dir)).count();
        assert!(until(Duration::from_secs(10), || starts() >= 1), "one catch-up read");
        assert!(until(Duration::from_secs(5), || matters(&root, Spot::Tree, "src/x.rs")), "the overflow forgot the remembered ignore answers (git is asked again: src is not ignored)");
        // Still watching: a joiner is told so, and no 4 s reads follow (one read, then quiet).
        let join = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert!(join.watching, "an overflow is not a break");
        std::thread::sleep(Duration::from_secs(9));
        assert_eq!(starts(), 1, "no fall-back reads after an overflow");
        // The readers went on reading: an edit is still seen.
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        assert!(until(Duration::from_secs(10), || starts() >= 2), "the watch still reports changes");
        let l = logs.lock().unwrap().clone();
        assert_eq!(l.len(), 1, "said once: {l:?}");
        assert!(l[0].contains("too many changes at once") && l[0].contains("still watching"), "{l:?}");
        unwatch(join.id);
        unwatch(w.id);
    }

    #[cfg(windows)]
    #[test]
    fn t033e_unwatch_ends_the_reader_and_worker_threads_and_the_window_going_waits_for_nobody() {
        let _live = live();
        let dir = repo("threads");
        let sink: Sink = Arc::new(|_: &crate::scm::Status| {});
        let s = sink.clone();
        let w = watch(&dir, move |_| s.clone(), Arc::new(|_: &str| {})).unwrap();
        let stop = stop_of(w.id).unwrap();
        // The table, the one reader (a main checkout) and this test hold the flag; the worker holds the sink.
        assert_eq!(Arc::strong_count(&stop), 3);
        assert!(Arc::strong_count(&sink) >= 2);
        let t = Instant::now();
        unwatch(w.id);
        let took_unwatch = t.elapsed();
        assert!(took_unwatch < Duration::from_millis(200), "unwatch waits for nobody: {took_unwatch:?}");
        // Non-regression (review FIX-SOON 8): the reader ends on the stop flag within its 500 ms wait
        // slice even without the wake event, so 3 s is the allowance, not the claim; the under-100 ms
        // claim is made by `fix1_unwatch_root_joins_five_readers...`.
        assert!(until(Duration::from_secs(3), || Arc::strong_count(&stop) == 1), "the reader thread ended (count {})", Arc::strong_count(&stop));
        assert!(until(Duration::from_secs(10), || Arc::strong_count(&sink) == 1), "the worker thread ended");
        assert!(stop_of(w.id).is_none());
        // The window going: every watch of every worktree ends at once, nobody is waited for, and
        // the ids are gone, so a page that comes back starts fresh instead of leaking the old ones.
        let other = repo("threads2");
        let a = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        let b = watch(&other, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert_ne!(a.id, b.id);
        let (sa, sb) = (stop_of(a.id).unwrap(), stop_of(b.id).unwrap());
        assert_eq!(open_count(), 2);
        let t = Instant::now();
        assert_eq!(unwatch_all(), 2);
        let took = t.elapsed();
        assert!(took < Duration::from_millis(200), "unwatch_all waits for nobody: {took:?}");
        assert_eq!(open_count(), 0);
        assert!(until(Duration::from_secs(3), || Arc::strong_count(&sa) == 1 && Arc::strong_count(&sb) == 1), "every reader thread ended ({}, {})", Arc::strong_count(&sa), Arc::strong_count(&sb));
        unwatch(a.id); // a late caller of a gone id is a no-op
        assert_eq!(open_count(), 0);
        println!("T-033-e: unwatch took {took_unwatch:?}, unwatch_all of two took {took:?}; readers ended within 3 s of each");
    }

    /// FIX-1 (review FIX-SOON 8): `unwatch_root` joins every reader, so its cost is what the Wake
    /// event makes it: a linked worktree's five readers end together, well under 100 ms, not the
    /// 500 ms wait slice each. And the page is told only when the caller says the removal failed.
    #[cfg(windows)]
    #[test]
    fn fix1_unwatch_root_joins_five_readers_in_under_100_ms_and_tells_the_page_only_when_asked() {
        let _live = live();
        let dir = repo("join5");
        let git = |args: &[&str], cwd: &Path| crate::git::command(args, Some(cwd)).output().unwrap();
        std::fs::create_dir_all(dir.join(".git/info")).unwrap();
        let linked = dir.parent().unwrap().join(format!("scm-watch-join5-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&linked);
        assert!(git(&["worktree", "add", "-q", &linked.to_string_lossy(), "-b", "fix1-join5"], &dir).status.success());
        let ended = Arc::new(Mutex::new(Vec::<u64>::new()));
        let e = ended.clone();
        let w = watch_with(&linked, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(move |id| e.lock().unwrap().push(id)), Arc::new(|_: &str| {})).unwrap();
        assert!(w.watching);
        let stop = stop_of(w.id).unwrap();
        assert_eq!(Arc::strong_count(&stop) - 2, 5, "tree, git folder, refs, info and common readers");
        std::thread::sleep(Duration::from_millis(300)); // every reader is inside its wait
        let t = Instant::now();
        let stopped = unwatch_root(&linked).expect("there was a watch");
        let took = t.elapsed();
        assert_eq!(Arc::strong_count(&stop), 1, "every reader was joined before unwatch_root returned");
        assert!(took < Duration::from_millis(100), "five readers joined in {took:?}");
        println!("FIX-1: unwatch_root joined 5 readers in {took:?}");
        assert_eq!(stopped.id(), w.id);
        assert!(ended.lock().unwrap().is_empty(), "the page is not told before the removal is known to have failed");
        stopped.tell_page();
        assert_eq!(*ended.lock().unwrap(), vec![w.id], "the removal failed: the page is told to watch again");
        unwatch(w.id); // the page's old release is a no-op
        assert!(git(&["worktree", "remove", "--force", &linked.to_string_lossy()], &dir).status.success());
        let _ = std::fs::remove_dir_all(&linked);
    }

    /// FIX-1 (review FIX-BEFORE 3): a workspace removal ends the watch of that folder and no other.
    /// Its folder may already be gone, or be a plain folder inside the project (its `.git` file
    /// lost): asked from there, git answers with the project's own root, which is not this watch.
    #[cfg(windows)]
    #[test]
    fn fix1_removing_a_gone_or_plain_workspace_inside_the_project_leaves_the_projects_watch_alive() {
        let _live = live();
        let dir = repo("fallback-root");
        let w = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        let count = open_count();
        // The per-project workspaces folder lives inside the repo (PROJ-028); this workspace is gone.
        let gone = dir.join("workspaces/feature-x");
        assert!(unwatch_root(&gone).is_none(), "a missing folder is nobody's watch");
        assert!(stop_of(w.id).is_some(), "the project's watch is still alive after a gone workspace's removal");
        // A folder that exists but is no worktree of its own.
        let plain = dir.join("workspaces/plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert!(unwatch_root(&plain).is_none(), "a folder that is not a worktree of its own is nobody's watch");
        assert!(stop_of(w.id).is_some(), "the project's watch is still alive after a plain folder's removal");
        assert_eq!(open_count(), count);
        // The fallback still finds the project's own watch by a spelling the key does not fold.
        let spelled = format!("{}\\.", dir.to_string_lossy().replace('/', "\\"));
        let s = unwatch_root(Path::new(&spelled)).expect("found by its canonical folder");
        assert_eq!(s.id(), w.id);
        assert_eq!(open_count(), count - 1);
        drop(s);
        unwatch(w.id);
    }

    /// FIX-1 (review FIX-SOON 5): a real change-buffer overflow (not the test seam): with a buffer
    /// too small for a storm, Windows drops the records and the reader must send Overflow, issue
    /// the next read and go on, so the same reader still reports a later change.
    #[cfg(windows)]
    #[test]
    fn fix1_a_real_buffer_overflow_sends_overflow_and_the_same_reader_still_reports_a_later_change() {
        let dir = repo("real-overflow");
        let sub = dir.join("storm");
        std::fs::create_dir_all(&sub).unwrap();
        let (tx, rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        // 64 DWORDs = 256 bytes: room for a handful of records, none for a storm.
        start_reader(&sub, true, Spot::Refs, tx, stop.clone(), Wake::new(), 64).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        // T-033-e (batch 2): one writer was slower than the reader on a fast disk, so the reader
        // always re-armed in time and nothing overflowed. Long names (one record is about 212 bytes,
        // two never fit in 256) and four writers at once leave the reader no time to re-arm.
        let writers: Vec<_> = (0..4)
            .map(|t| {
                let sub = sub.clone();
                std::thread::spawn(move || {
                    for i in 0..1000 {
                        std::fs::write(sub.join(format!("{}-{t}-{i}", "f".repeat(100))), "x").unwrap();
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let mut seen = Vec::new();
        let end = Instant::now() + Duration::from_secs(10);
        while Instant::now() < end && !seen.iter().any(|s| matches!(s, Signal::Overflow)) {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(s) => seen.push(s),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(seen.iter().any(|s| matches!(s, Signal::Overflow)), "a storm into a 256-byte buffer must overflow: {seen:?}");
        assert!(!seen.iter().any(|s| matches!(s, Signal::Broken(_))), "an overflow is not a break: {seen:?}");
        // The storm's tail: quiet means no signal for a second.
        while rx.recv_timeout(Duration::from_secs(1)).is_ok() {}
        let n_overflows = seen.iter().filter(|s| matches!(s, Signal::Overflow)).count();
        std::fs::write(sub.join("later"), "y").unwrap();
        let later = rx.recv_timeout(Duration::from_secs(5));
        assert!(matches!(later, Ok(Signal::Change)), "the same reader reports a later change after its overflow: {later:?}");
        println!("FIX-1: a 4000-file storm from 4 writers into a 256-byte buffer: {} signals before the first overflow was seen, {n_overflows} overflow(s), then a later change", seen.len());
        stop.store(true, Ordering::Relaxed);
    }

    #[cfg(windows)]
    #[test]
    fn t033e_a_linked_worktree_commit_is_seen_and_its_removal_ends_the_watch() {
        let _live = live();
        let dir = repo("linked");
        let git = |args: &[&str], cwd: &Path| crate::git::command(args, Some(cwd)).output().unwrap();
        let ok = |args: &[&str], cwd: &Path| assert!(git(args, cwd).status.success(), "{args:?}");
        let base = dir.parent().unwrap().to_path_buf();
        let linked = base.join(format!("scm-watch-linked-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&linked);
        ok(&["worktree", "add", "-q", &linked.to_string_lossy(), "-b", "t033e-linked"], &dir);
        let seen = Arc::new(Mutex::new(Vec::<crate::scm::Status>::new()));
        let s = seen.clone();
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));
        let l = logs.clone();
        let ended = Arc::new(Mutex::new(Vec::<u64>::new()));
        let e = ended.clone();
        let w = watch_with(&linked, move |_| { let s = s.clone(); Arc::new(move |st: &crate::scm::Status| s.lock().unwrap().push(st.clone())) as Sink }, Arc::new(move |id| e.lock().unwrap().push(id)), Arc::new(move |m: &str| l.lock().unwrap().push(m.to_string()))).unwrap();
        assert!(w.watching);
        let p = places(&linked).unwrap();
        assert!(p.watches().iter().any(|(d, r, s)| *s == Spot::Common && !r && d == &p.common), "{:?}", p.watches());
        let stop = stop_of(w.id).unwrap();
        let readers = Arc::strong_count(&stop) - 2;
        assert!(readers >= 4, "tree, git folder, refs, info and common readers: {readers}");
        std::thread::sleep(Duration::from_millis(300));
        let n = || seen.lock().unwrap().len();
        let last = |f: &dyn Fn(&crate::scm::Status) -> bool| seen.lock().unwrap().last().is_some_and(f);
        // An edit in the linked worktree: a read showing the change.
        std::fs::write(linked.join("a.txt"), "two\n").unwrap();
        assert!(until(Duration::from_secs(15), || last(&|s| s.changed.len() == 1)), "the edit is seen");
        // A commit from a terminal in the linked worktree (its own HEAD and index, the shared ref):
        // the next read shows it clean.
        ok(&["commit", "-q", "-a", "--no-verify", "-m", "linked"], &linked);
        assert!(until(Duration::from_secs(15), || last(&|s| s.changed.is_empty() && s.staged.is_empty())), "the commit is seen");
        // The shared packed-refs (what a pack, a gc or a prune writes): the common-folder reader sees it.
        ok(&["pack-refs", "--all"], &dir);
        let packed = p.common.join("packed-refs");
        assert!(until(Duration::from_secs(10), || packed.is_file()));
        std::thread::sleep(Duration::from_secs(5)); // let the pack's own refs/ changes settle and read
        let before = n();
        let same = std::fs::read(&packed).unwrap();
        std::fs::write(&packed, same).unwrap(); // rewritten as git does, nothing else touched
        assert!(until(Duration::from_secs(15), || n() > before), "a packed-refs write is read");
        // Removal from outside (a terminal), with our readers holding the folder: the watch ends by
        // itself once the folder is gone, says so once, and the readers go.
        let out = git(&["worktree", "remove", "--force", &linked.to_string_lossy()], &dir);
        println!("T-033-e: git worktree remove under a live watch: exit {:?}, stderr {:?}", out.status.code(), String::from_utf8_lossy(&out.stderr).trim());
        assert!(until(Duration::from_secs(20), || stop_of(w.id).is_none()), "the watch ends when its folder is gone");
        // FIX-1 (review FIX-SOON 7): a watch that ends on its own tells the page, which watches again.
        assert!(until(Duration::from_secs(5), || *ended.lock().unwrap() == vec![w.id]), "the page is told the watch ended: {:?}", ended.lock().unwrap());
        // Non-regression: the readers end on the stop flag (5 s is the allowance, not the claim).
        assert!(until(Duration::from_secs(5), || Arc::strong_count(&stop) == 1), "its readers ended ({})", Arc::strong_count(&stop));
        assert!(until(Duration::from_secs(10), || !linked.exists()), "the folder is gone once the handles are closed");
        let l = logs.lock().unwrap().clone();
        assert_eq!(l.iter().filter(|m| m.contains("is gone; its watch stopped")).count(), 1, "{l:?}");
        unwatch(w.id); // the page's late unwatch is a no-op
        // Kolux's own removal (workspace remove): unwatch_root first, by the path as the project has
        // it (backslashes, any case), joined, so no handle of ours is open when git deletes the folder.
        let linked2 = base.join(format!("scm-watch-linked-wt2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&linked2);
        ok(&["worktree", "add", "-q", &linked2.to_string_lossy(), "-b", "t033e-linked2"], &dir);
        let w2 = watch(&linked2, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        let w2_again = watch(&linked2, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert_eq!(w2.id, w2_again.id, "two callers");
        let stop2 = stop_of(w2.id).unwrap();
        let spelled = linked2.to_string_lossy().replace('/', "\\").to_uppercase();
        let count = open_count();
        let stopped = unwatch_root(Path::new(&spelled)).expect("found by the project's spelling");
        assert_eq!(stopped.id(), w2.id);
        assert_eq!(Arc::strong_count(&stop2), 1, "every reader was joined before unwatch_root returned");
        assert_eq!(open_count(), count - 1);
        let out = git(&["worktree", "remove", "--force", &linked2.to_string_lossy()], &dir);
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        // Non-regression (review FIX-SOON 8): git removes the folder with live readers too (the first
        // half above, share-delete handles); what unwatch_root adds is proven by the joined count.
        assert!(!linked2.exists(), "the folder is gone");
        drop(stopped); // the removal succeeded: the page is not told
        assert!(unwatch_root(&linked2).is_none(), "nothing left to end");
        assert_eq!(*ended.lock().unwrap(), vec![w.id], "only the watch that ended on its own told the page");
        unwatch(w2.id);
        unwatch(w2_again.id);
        let _ = std::fs::remove_dir_all(&linked);
        let _ = std::fs::remove_dir_all(&linked2);
    }

    /// FIX-2 (review AFTER 5): a watch call the old page made just before a reload can finish after
    /// the reload's `unwatch_all`; it must neither insert nor join a watch nobody will release.
    #[cfg(windows)]
    #[test]
    fn fix2_a_watch_started_before_a_reload_is_refused_after_it() {
        let _live = live();
        let dir = repo("reload-gen");
        let sink = |_: u64| Arc::new(|_: &crate::scm::Status| {}) as Sink;
        let quiet = || Arc::new(|_: &str| {}) as Log;
        let nobody = || Arc::new(|_: u64| {}) as Ended;
        // The old page's call read the generation and asked git; the reload came in between.
        let before = generation();
        let p = places(&dir).unwrap();
        let _ = unwatch_all();
        let late = watch_in(before, p, sink, nobody(), quiet());
        assert!(late.is_err(), "a watch started before the reload must be refused: {late:?}");
        assert_eq!(open_count(), 0, "nothing was inserted");
        // The new page watches as ever; an old call that would have joined its watch is refused too,
        // so the page's one release ends the watch.
        let w = watch(&dir, sink, quiet()).unwrap();
        let join = watch_in(before, places(&dir).unwrap(), sink, nobody(), quiet());
        assert!(join.is_err(), "a join from before the reload must be refused: {join:?}");
        unwatch(w.id);
        assert_eq!(open_count(), 0, "one release ended it: no leaked ref");
        // A call from after the reload joins as ever.
        let w = watch(&dir, sink, quiet()).unwrap();
        let again = watch_in(generation(), places(&dir).unwrap(), sink, nobody(), quiet()).unwrap();
        assert_eq!(again.id, w.id);
        unwatch(again.id);
        unwatch(w.id);
        assert_eq!(open_count(), 0);
    }

    /// FIX-2 (review AFTER 7): a storm of overflows forgets the remembered ignore answers once, at
    /// the one catch-up read, not once per overflow (each forget costs a `git check-ignore` on the
    /// next change under a remembered folder, which counts against T-033-d).
    #[cfg(windows)]
    #[test]
    fn fix2_an_overflow_storm_forgets_the_ignore_answers_once_per_catch_up_read() {
        let _live = live();
        let dir = repo("overflow-forget");
        let w = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let root = places(&dir).unwrap().root;
        let ig = ignores_of(&root);
        let forgets0 = ig.lock().unwrap().forgets;
        ig.lock().unwrap().known.insert("src".into(), true);
        let at = Instant::now();
        for _ in 0..5 {
            assert!(overflow_watch(w.id));
        }
        let starts = || STARTS.lock().unwrap().iter().filter(|(r, t)| *t >= at && same_dir(r, &dir)).count();
        assert!(until(Duration::from_secs(10), || starts() >= 1), "one catch-up read");
        assert!(until(Duration::from_secs(5), || !ig.lock().unwrap().known.contains_key("src")), "the catch-up read forgot the answers");
        assert_eq!(ig.lock().unwrap().forgets - forgets0, 1, "five overflows, one catch-up read, one forget");
        unwatch(w.id);
    }

    // EDIT-044 (T-062-b): a worktree inside a WSL distribution is read every 4 s from the start,
    // decided from the spelling alone (no share is contacted); a local folder is still watched.
    #[test]
    fn edit044_a_wsl_root_is_read_every_4_s_instead_of_watched() {
        for root in [r"\\wsl.localhost\Ubuntu\home\me\p", r"\\wsl$\Ubuntu\home\me\p", "//wsl.localhost/Debian/srv", r"\\?\UNC\wsl$\Ubuntu\home"] {
            let why = unwatchable(Path::new(root)).unwrap_or_else(|| panic!("{root} would be watched"));
            assert!(why.contains("WSL") && why.contains("4 s"), "{root}: {why}");
        }
        let local = std::env::temp_dir().join(format!("scm-watch-t062b-local-{}", std::process::id()));
        std::fs::create_dir_all(&local).unwrap();
        // A plain folder on every platform: resolve the temp folder's links (a runner's temp folder
        // can sit behind a junction), then drop the `\\?\` form `canonicalize` gives on Windows,
        // because `unwatchable` spells the resolved path without it before comparing.
        let real = std::fs::canonicalize(&local).unwrap();
        let real = real.to_string_lossy();
        let real = Path::new(real.strip_prefix(r"\\?\").unwrap_or(&real));
        assert_eq!(unwatchable(real), None, "a local folder is watched");
        let _ = std::fs::remove_dir_all(&local);
    }
}
