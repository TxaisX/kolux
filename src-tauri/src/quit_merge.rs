//! Txais (2026-11-17): "when we close the app, all temp folders get merged into the main and all the
//! temp worktrees disappear." On a real quit (never a restart, never Windows ending the session),
//! each workspace Kolux made (it has an origin record; the main checkout and worktrees made by other
//! tools are never touched) is tidied away:
//!
//! 1. Uncommitted work, untracked files included and ignored files left out, is committed as
//!    "Kolux: saved on quit". Never while a merge, cherry-pick, revert or rebase is unfinished in the
//!    workspace, never with a separate Git project inside it, a password-like file or a very large
//!    new file in it (the workspace stays instead), and the commit skips hooks and signing.
//! 2. A branch with commits main lacks is merged into the project's main branch (origin's HEAD, else
//!    `main`, else `master`) in the main checkout, locally (nothing is pushed), only while that
//!    checkout is on it with no uncommitted changes to tracked files. A fast-forward when it can be,
//!    else a merge commit; a merge Git predicts would clash is not tried, and a failed one is undone
//!    so main is left exactly as it was. Branches with a pull request, a remote copy or another base
//!    are merged the same way (owner decision, 2026-11-17).
//! 3. Only once the branch's tip is in main (or it had nothing new) does the workspace go, through the
//!    same removal the delete button uses, never forced: its branch goes with it when nothing is lost,
//!    unless the workspace had been moved onto a branch Kolux did not make (that branch stays).
//!
//! A quit that is cut short mid-merge leaves a marker (`quit-merge-marker.json` in the app's data
//! folder) that the next start reads: it puts the main checkout back to how it was before the merge
//! (`recover_at_start`).
//!
//! Anything locked, still holding changes, clashing, holding local files that removal would delete, or
//! out of time stays, with its reason; it is tried again at the next quit, and the next start shows
//! one notice naming what was kept and why.
//!
//! m5 (tool visibility, noted here for the commit): the git calls of this module go through the
//! trust layer in `git.rs`, so a folder it refuses to write in (a hook, filter or merge driver of its
//! own in a folder the user never trusted) is kept with Git's reason, not worked around.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::git::{Git, Worktree};
use crate::projects::{self, Project};
use crate::state::Store;
use crate::terminal::Terminals;

/// settings.json: false turns the merge at quit off. Missing means on.
pub const MERGE_ON_QUIT_SETTING: &str = "workspacesMergeOnQuit";
/// The store key for what the last quit kept (for the next start's notice) and which projects it
/// went through (their `.worktrees` trash is swept at the next start).
pub(crate) const RECORD_KEY: &str = "quitMergeRecord";
/// The commit message for work saved at quit.
pub const SAVE_MESSAGE: &str = "Kolux: saved on quit";
/// The second paragraph of every commit the quit makes (decision, 2026-11-17: an automatic commit at
/// quit skips hooks and signing, because either can wait for a person or fail with nobody there).
const AUTOMATIC: &str = "Made by Kolux when the app closed. Git hooks and commit signing are skipped for this automatic commit.";
/// How long the quit gives the merge. A new step starts only while `MIN_TO_START` of it is left.
pub const BUDGET: Duration = Duration::from_secs(5);
/// How long past `BUDGET` the quit waits for a step that already started.
pub const GRACE: Duration = Duration::from_secs(2);
/// The quit's whole wait for the merge (lifecycle::quit_deadline counts it).
pub const WAIT: Duration = Duration::from_secs(BUDGET.as_secs() + GRACE.as_secs());
const MIN_TO_START: Duration = Duration::from_millis(1500);
/// The longest a quit lets a merge into a main checkout run, from the moment the quit began: the
/// watchdog in lifecycle.rs holds the exit this long while a merge is half done, and not a moment more.
pub const HARD_CAP: Duration = Duration::from_secs(30);
/// A merge starts only with this much of the hard cap left: a clean merge takes a second or two, and
/// a failed one needs the time to be undone.
const MERGE_MIN: Duration = Duration::from_secs(8);
/// A new file bigger than this is not committed by the quit (the workspace stays).
const LARGE_FILE: u64 = 20 * 1024 * 1024;
/// How many entries of one ignored folder are looked through for local files before giving up.
const IGNORED_SCAN_LIMIT: usize = 20_000;
/// The marker's file name in the app's data folder, and the empty folder git is told to look for hooks in.
/// Each main folder's marker is `<MARKER_STEM>-<hash>.json` (review P2-1); `MARKER_FILE` is the older single one.
const MARKER_STEM: &str = "quit-merge-marker";
#[cfg(test)]
const MARKER_FILE: &str = "quit-merge-marker.json";
/// Main gained staged or changed files after it was looked at, so the merge did not start.
const MAIN_CHANGED: &str = "the main folder has changes that are not committed";
const NO_HOOKS_DIR: &str = "quit-merge-no-hooks";
/// Why a merge did not start once the quit had begun (re-review P2-B).
const CLOSING: &str = "Kolux is closing";

// Test hooks on this thread: right before merge_branch's last checks (tests let time run out or the
// quit begin there), and right after undo_merge looks for a lock (tests let another git act there).
// `BUSY_HERE` counts this thread's own Busy steps, so a test is not misled by another test's.
#[cfg(test)]
type Hook = std::cell::RefCell<Option<Box<dyn FnMut()>>>;
#[cfg(test)]
thread_local! {
    pub(crate) static BEFORE_LAST_CHECK: Hook = const { std::cell::RefCell::new(None) };
    pub(crate) static AFTER_LOCK_LOOK: Hook = const { std::cell::RefCell::new(None) };
    static BUSY_HERE: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn run_hook(hook: &'static std::thread::LocalKey<Hook>) {
    hook.with(|h| {
        if let Some(f) = h.borrow_mut().as_mut() {
            f();
        }
    });
}

/// Whether a Busy step started on this thread is still under way (tests only).
#[cfg(test)]
pub(crate) fn busy_on_this_thread() -> bool {
    BUSY_HERE.with(|b| b.get() > 0)
}

/// How many saves, merges, undos and removals are under way: the quit waits for them.
static BUSY: AtomicUsize = AtomicUsize::new(0);

/// True while a save, a merge (or its undo) or a removal runs, so the quit waits for it to end.
pub fn merging() -> bool {
    BUSY.load(Ordering::SeqCst) > 0
}

/// Counts one step under way until it is dropped, a panic included.
pub(crate) struct Busy<'a>(&'a AtomicUsize);

impl<'a> Busy<'a> {
    fn on(counter: &'a AtomicUsize) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        #[cfg(test)]
        BUSY_HERE.with(|b| b.set(b.get() + 1));
        Self(counter)
    }
}

impl Busy<'static> {
    pub(crate) fn start() -> Self {
        Self::on(&BUSY)
    }
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
        #[cfg(test)]
        BUSY_HERE.with(|b| b.set(b.get().saturating_sub(1)));
    }
}

const OUT_OF_TIME: &str = "Kolux ran out of time while closing";
pub(crate) const LOCKED: &str = "it is locked";
pub(crate) const DETACHED: &str = "it is not on a branch";
pub(crate) const NO_MAIN: &str = "Kolux could not tell which branch is main";
#[cfg(test)]
const BUSY_PROJECT: &str = "Kolux was still busy with this project";
const UNFINISHED: &str = "a merge, cherry-pick, revert or rebase is unfinished in it";
const CONFLICTED: &str = "it has files with unresolved conflicts";
#[cfg(test)]
const WAS_CUT: &str = "Kolux was still tidying it when the app closed, so look at it";

/// settings.json: whether a workspace whose agent says its task is finished is sent to main by itself.
pub const AUTO_LAND_SETTING: &str = "workspacesAutoLand";

/// Until it is set, it follows the old "merge on quit" switch, so whoever turned the quit merge off
/// does not get finished work sent to main by itself either.
pub fn auto_land_wanted(settings: &serde_json::Value) -> bool {
    settings[AUTO_LAND_SETTING].as_bool().unwrap_or(settings[MERGE_ON_QUIT_SETTING].as_bool() != Some(false))
}

#[cfg(test)]
/// Txais (2026-11-20): "keep the worktrees open unless we purposefully close them". A quit merges
/// each workspace into main and leaves its folder standing; the idle sweep (`retire.rs`) is the
/// only thing that removes one on its own. This opt-in restores the older behaviour of deleting
/// every workspace that merged cleanly as Kolux closes.
pub const REMOVE_ON_QUIT_SETTING: &str = "workspacesRemoveOnQuit";

#[cfg(test)]
pub fn removes_on_quit(settings: &serde_json::Value) -> bool {
    settings[REMOVE_ON_QUIT_SETTING].as_bool() == Some(true)
}

/// One workspace the quit kept, and why.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Left {
    pub project: String,
    pub path: String,
    #[serde(default)]
    pub branch: Option<String>,
    pub why: String,
}

#[cfg(test)]
#[derive(Debug, Default)]
pub struct Outcome {
    pub merged: Vec<String>,
    pub removed: Vec<String>,
    pub left: Vec<Left>,
    /// The main checkouts of the projects that had workspaces to tidy.
    pub repos: Vec<String>,
}

#[cfg(test)]
impl Outcome {
    fn keep(&mut self, project: &Project, w: &Worktree, why: impl Into<String>) {
        self.left.push(Left { project: project.name.clone(), path: w.path.clone(), branch: w.branch.clone(), why: why.into() });
    }
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Record {
    #[serde(default)]
    left: Vec<Left>,
    #[serde(default)]
    repos: Vec<String>,
}

fn read_record(store: &Store) -> Record {
    store.get(RECORD_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_record(store: &Store, record: &Record) -> Result<(), String> {
    store.set(RECORD_KEY, &serde_json::to_string(record).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// The deadlines every step checks: the soft one (no new step starts near it) and the hard one (the
/// quit's cap: a merge needs room before it, and a write is cut at it).
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    deadline: Instant,
    hard: Instant,
}

impl Clock {
    pub fn until(deadline: Instant) -> Self {
        Self { deadline, hard: deadline }
    }
    #[cfg(test)]
    pub fn with_hard(deadline: Instant, hard: Instant) -> Self {
        Self { deadline, hard }
    }
    fn left(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    fn hard_left(&self) -> Duration {
        self.hard.saturating_duration_since(Instant::now())
    }
    fn may_start(&self) -> bool {
        self.left() >= MIN_TO_START
    }
    /// A merge also needs `MERGE_MIN` of the hard cap, so a cut one is rare and an undo has room.
    pub(crate) fn may_merge(&self) -> bool {
        self.may_start() && self.hard_left() >= MERGE_MIN
    }
    /// A read is cut at the deadline (with a floor, so a read that starts always gets a fair try).
    pub(crate) fn read_limit(&self) -> Duration {
        self.left().clamp(Duration::from_secs(1), Duration::from_secs(10))
    }
    /// A commit or merge that started runs to the hard cap (a cut merge could leave main half done),
    /// less a second, and at least two seconds.
    fn write_limit(&self) -> Duration {
        self.hard_left().saturating_sub(Duration::from_secs(1)).max(Duration::from_secs(2))
    }
}

/// Git's error cut to its first line, for a reason the user reads.
pub(crate) fn short(e: &str) -> String {
    let line = e.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("Git gave no reason");
    line.chars().take(200).collect()
}

pub(crate) fn read(args: &[&str], dir: &Path, clock: &Clock) -> Result<String, String> {
    crate::git::run_within(args, Some(dir), clock.read_limit())
}

/// A write at quit: no hook runs (`core.hooksPath` is an empty folder, `--no-verify` where git has
/// one), nothing is signed (a signing program may wait for a passphrase nobody is there to type),
/// nothing prompts, and no editor opens. `GIT_EDITOR=:` is git's own no-op (`true` is not always on
/// the path on Windows).
pub(crate) fn write(args: &[&str], dir: &Path, clock: &Clock, hooks: &Path) -> Result<String, String> {
    let hooks_path = format!("core.hooksPath={}", hooks.to_string_lossy().replace('\\', "/"));
    let mut all: Vec<&str> = vec!["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", &hooks_path];
    all.extend_from_slice(args);
    crate::git::run_within_env(&all, Some(dir), clock.write_limit(), &[("GIT_TERMINAL_PROMPT", "0"), ("GIT_EDITOR", ":")])
}

/// The empty folder the quit points `core.hooksPath` at.
pub(crate) fn no_hooks(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = data_dir.join(NO_HOOKS_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{} could not be made: {e}", dir.display()))?;
    Ok(dir)
}

/// How long a sweep's own save may take. The quit answers to its clock; the sweep runs in the
/// background and only needs a bound so a hung git cannot wedge it forever.
const SWEEP_WINDOW: Duration = Duration::from_secs(120);

/// Makes a workspace safe to retire, the same way a quit makes it safe: refuses when the folder holds
/// the user's own local files (M7), then commits everything uncommitted, untracked included.
/// `retire.rs` calls this before it removes an idle workspace, so a sweep can never lose work.
pub(crate) fn prepare_retire(_git: &Git, _store: &Mutex<Store>, _terminals: &Terminals, data_dir: &Path, here: &Path, main: Option<&Path>) -> Result<(), String> {
    let clock = Clock::until(Instant::now() + SWEEP_WINDOW);
    let hooks = no_hooks(data_dir)?;
    local_files(here, main, &clock)?;
    save_with(&clock, &hooks, here, SAVE_MESSAGE, AUTOMATIC)
}

/// How many commits `to` has that `from` lacks (both local branches).
pub(crate) fn ahead(repo: &Path, from: &str, to: &str, clock: &Clock) -> Result<u64, String> {
    read(&["rev-list", "--count", &format!("refs/heads/{from}..refs/heads/{to}")], repo, clock)
        .and_then(|n| n.trim().parse::<u64>().map_err(|e| e.to_string()))
        .map_err(|e| format!("Kolux could not compare it with {from} ({})", short(&e)))
}

/// The main checkout of the repository a linked worktree at `worktree` belongs to, read from its
/// `.git` file (`gitdir: <common>/worktrees/<name>`), so workspaces made in an earlier session are
/// found even when their project is no longer listed. None for anything else.
pub(crate) fn repo_of(worktree: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(worktree.join(".git")).ok()?;
    let gitdir = text.lines().find_map(|l| l.trim().strip_prefix("gitdir:")).map(str::trim)?;
    let gitdir = worktree.join(gitdir);
    let common = gitdir.parent().filter(|w| w.file_name().is_some_and(|n| n == "worktrees"))?.parent()?;
    let main = if common.file_name().is_some_and(|n| n == ".git") { common.parent()? } else { common };
    // One separator style, so the same repository read from two places is one path.
    let main: PathBuf = main.components().collect();
    main.is_dir().then_some(main)
}

#[cfg(test)]
/// The listed projects, then the repositories of the workspaces Kolux made that no listed project
/// holds (a start forgets the list, but not the workspaces).
fn projects_to_tidy(listed: Vec<Project>, origins: &serde_json::Map<String, serde_json::Value>) -> Vec<Project> {
    let mut out = listed;
    for key in origins.keys() {
        let Some(repo) = repo_of(Path::new(key)) else { continue };
        if out.iter().any(|p| projects::same_folder(Path::new(&p.path), &repo)) {
            continue;
        }
        let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(Project { id: String::new(), name, path: repo.display().to_string(), workspaces_dir: None, base: None, display_name: None });
    }
    out
}

#[cfg(test)]
/// What every step of one quit's tidy shares.
struct Cx<'a> {
    git: &'a Git,
    store: &'a Mutex<Store>,
    terminals: &'a Terminals,
    clock: Clock,
    data_dir: &'a Path,
    /// The empty folder git looks for hooks in.
    hooks: PathBuf,
    /// Whether a merged workspace's folder goes at quit (`workspacesRemoveOnQuit`), false by default.
    remove: bool,
}

/// Tidies every workspace Kolux made, as the module says, stopping cleanly at `clock`. `data_dir` is
/// the app's data folder (the marker and the empty hooks folder live there). The app itself goes
/// through `run_with` (it saves progress); this is the plain form the tests use.
#[cfg(test)]
pub fn run(git: &Git, store: &Mutex<Store>, terminals: &Terminals, clock: Clock, data_dir: &Path) -> Outcome {
    run_with(git, store, terminals, clock, data_dir, &mut |_| {})
}

#[cfg(test)]
/// `run`, telling `progress` what is known after every workspace (and before each one starts, with
/// that one listed as still being worked on), so a quit that is cut short leaves the notice for the
/// next start.
pub fn run_with(git: &Git, store: &Mutex<Store>, terminals: &Terminals, clock: Clock, data_dir: &Path, progress: &mut dyn FnMut(&Outcome)) -> Outcome {
    let (listed, origins, remove) = match store.lock() {
        Ok(s) => (projects::load_projects(&s), projects::load_origins(&s), removes_on_quit(&s.settings())),
        Err(_) => return Outcome::default(),
    };
    let mut out = Outcome::default();
    let hooks = match no_hooks(data_dir) {
        Ok(h) => h,
        Err(_) => return out,
    };
    let cx = Cx { git, store, terminals, clock, data_dir, hooks, remove };
    let all = projects_to_tidy(listed, &origins);
    let project_paths: Vec<PathBuf> = all.iter().map(|p| PathBuf::from(&p.path)).collect();
    for project in &all {
        tidy_project(&cx, project, &project_paths, &origins, &mut out, progress);
    }
    out
}

#[cfg(test)]
fn tidy_project(cx: &Cx, project: &Project, project_paths: &[PathBuf], origins: &serde_json::Map<String, serde_json::Value>, out: &mut Outcome, progress: &mut dyn FnMut(&Outcome)) {
    let clock = cx.clock;
    let repo = Path::new(&project.path);
    if !clock.may_start() {
        return;
    }
    let Ok(all) = cx.git.worktrees(repo) else { return };
    // A folder that is itself a listed project (a worktree the user opened as a project) is theirs, not a workspace.
    let ours: Vec<Worktree> = projects::kolux_made(origins, all.clone())
        .into_iter()
        .filter(|w| !w.is_main && Path::new(&w.path).is_dir() && !project_paths.iter().any(|p| projects::same_folder(p, Path::new(&w.path))))
        .collect();
    if ours.is_empty() {
        return;
    }
    out.repos.push(project.path.clone());
    // Never waits on a create or rename that holds the project: the quit must not hang.
    let turn = projects::repo_turn(repo);
    let _turn = match turn.try_lock() {
        Ok(g) => g,
        Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
        Err(std::sync::TryLockError::WouldBlock) => {
            for w in &ours {
                out.keep(project, w, BUSY_PROJECT);
            }
            return;
        }
    };
    if repo.join(projects::PROJECT_LOCAL_DIR).is_dir() {
        let _ = projects::ensure_excluded(repo);
    }
    let target = target_branch(repo, project, &clock);
    let main = all.iter().find(|w| w.is_main);
    // Looked at again before each merge: an earlier one that could not be undone leaves main unready.
    let ready = || main_ready(main, target.as_deref(), &clock);
    for w in &ours {
        if !clock.may_start() {
            out.keep(project, w, OUT_OF_TIME);
            continue;
        }
        let origin = origins.get(&projects::name_key(&w.path)).cloned().unwrap_or_default();
        // Listed first, so a quit cut short while this one is under way still names it at the next start.
        out.keep(project, w, WAS_CUT);
        progress(out);
        let result = tidy_one(cx, project, w, &origin, target.as_deref(), main.map(|m| Path::new(&m.path)), &ready);
        out.left.pop();
        match result {
            Ok(merged) => {
                if merged {
                    out.merged.push(w.path.clone());
                }
                // The folder stays unless the opt-in asks for the old delete; `left` is only for what
                // needs the user's eye, so a clean keep is not listed there.
                if cx.remove {
                    out.removed.push(w.path.clone());
                }
            }
            Err(why) => out.keep(project, w, why),
        }
        progress(out);
    }
}

/// M6: the branch a merge goes into. The project's own saved base when it names a local branch, else
/// origin's HEAD, else `main`, else `master`. Never "whatever the main checkout happens to be on":
/// a checkout that is on another branch is kept with that reason (`main_ready`), not merged into.
pub(crate) fn target_branch(repo: &Path, project: &Project, clock: &Clock) -> Option<String> {
    let local = |b: &str| !b.is_empty() && read(&["rev-parse", "-q", "--verify", &format!("refs/heads/{b}")], repo, clock).is_ok();
    let bare = |b: &str| b.strip_prefix("origin/").unwrap_or(b).to_string();
    let explicit = project.base.as_deref().map(str::trim).filter(|b| !b.is_empty()).map(bare);
    let origin_head = read(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], repo, clock).ok().filter(|b| !b.is_empty()).map(|b| bare(&b));
    explicit.into_iter().chain(origin_head).chain(["main", "master"].map(String::from)).find(|b| local(b))
}

/// The main checkout's folder when a merge may go into it: on `target`, with no uncommitted changes
/// to tracked files and no merge left open. Untracked files do not count: Git itself refuses a merge
/// that would overwrite one, before it changes anything.
pub(crate) fn main_ready(main: Option<&Worktree>, target: Option<&str>, clock: &Clock) -> Result<PathBuf, String> {
    let main = main.ok_or("Kolux could not find the project's main folder")?;
    let target = target.ok_or(NO_MAIN)?;
    match main.branch.as_deref() {
        Some(b) if b == target => {}
        Some(b) => return Err(format!("the main folder is on {b}, not {target}")),
        None => return Err(format!("the main folder is not on {target}")),
    }
    let dir = PathBuf::from(&main.path);
    let status = read(&["status", "--porcelain", "--untracked-files=no"], &dir, clock).map_err(|e| format!("Kolux could not read the main folder ({})", short(&e)))?;
    if !status.trim().is_empty() {
        return Err("the main folder has changes that are not committed".into());
    }
    if read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], &dir, clock).is_ok() {
        return Err("a merge is unfinished in the main folder".into());
    }
    Ok(dir)
}

#[cfg(test)]
/// One workspace: checked, saved, and merged into main when it has something new. Its folder then
/// stays unless the user opted into removing it at quit (`REMOVE_ON_QUIT_SETTING`). Ok(true) when it
/// was merged.
fn tidy_one(cx: &Cx, project: &Project, w: &Worktree, origin: &serde_json::Value, target: Option<&str>, main: Option<&Path>, ready: &dyn Fn() -> Result<PathBuf, String>) -> Result<bool, String> {
    let clock = &cx.clock;
    if w.locked.is_some() {
        return Err(LOCKED.into());
    }
    let (repo, here) = (Path::new(&project.path), Path::new(&w.path));
    // B1: never save over a half-done merge, cherry-pick, revert or rebase (a rebase leaves the
    // workspace on no branch, so this comes before that check): that would commit its conflict markers.
    unfinished(here, clock)?;
    let Some(branch) = w.branch.as_deref() else { return Err(DETACHED.into()) };
    let target = target.ok_or(NO_MAIN)?;
    let dirty = !read(&["status", "--porcelain"], here, clock).map_err(|e| format!("Kolux could not read its changes ({})", short(&e)))?.trim().is_empty();
    let commits = ahead(repo, target, branch, clock)?;
    // m2: main is looked at before anything is saved, so a main that cannot take the merge costs no "saved on quit" commit.
    // A merge also needs room before the hard cap; without it nothing is saved either.
    let main_dir = if dirty || commits > 0 {
        if !clock.may_merge() {
            return Err(OUT_OF_TIME.into());
        }
        Some(ready()?)
    } else {
        None
    };
    // M7: only a removal deletes ignored files too, so the check that stops it is skipped while the
    // folder is kept.
    if cx.remove {
        local_files(here, main, clock)?;
    }
    if dirty {
        save_changes(cx, here)?;
    }
    let merged = if ahead(repo, target, branch, clock)? > 0 {
        let main_dir = main_dir.ok_or_else(|| "Kolux could not tell whether main can take the merge".to_string())?;
        merge_into(cx, repo, &main_dir, target, branch)?;
        true
    } else {
        false
    };
    if ahead(repo, target, branch, clock)? > 0 {
        return Err(format!("its commits are not in {target} yet"));
    }
    if !cx.remove {
        return Ok(merged);
    }
    if !clock.may_start() {
        return Err(OUT_OF_TIME.into());
    }
    // The branch goes with the folder only when Kolux made it: one the workspace was moved onto stays.
    let keep_branch = (!made_branch(repo, branch, origin, here, clock)).then_some(true);
    // The folder goes as the last step and the quit waits for it, so it is never half removed.
    let _removing = Busy::start();
    let check = projects::remove_check(cx.git, project, &w.path).map_err(|e| format!("it could not be removed ({})", short(&e)))?;
    projects::remove_with(cx.git, cx.store, cx.terminals, project, &w.path, false, &check.stamp, keep_branch, false).map_err(|e| format!("it could not be removed ({})", short(&e)))?;
    Ok(merged)
}

/// B1: Err when the workspace is in the middle of a merge, cherry-pick, revert or rebase, or has files
/// with unresolved conflicts. Each marker is looked for in the workspace's own git folder
/// (`rev-parse --git-path`), which is not the same folder for a linked worktree.
pub(crate) fn unfinished(here: &Path, clock: &Clock) -> Result<(), String> {
    for name in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"] {
        let at = read(&["rev-parse", "--git-path", name], here, clock).map_err(|e| format!("Kolux could not read its state ({})", short(&e)))?;
        if here.join(at.trim()).exists() {
            return Err(UNFINISHED.into());
        }
    }
    let unmerged = read(&["ls-files", "-u"], here, clock).map_err(|e| format!("Kolux could not read its state ({})", short(&e)))?;
    if unmerged.trim().is_empty() {
        Ok(())
    } else {
        Err(CONFLICTED.into())
    }
}

#[cfg(test)]
/// Whether the branch the workspace is on is the one Kolux made for it. The record names that branch
/// (kept current when Kolux renames it); a branch renamed by another path is found in the branch's
/// own reflog; a record from before the name was kept (or none) counts the placeholder name the
/// workspace was made with. Anything else, a branch the workspace was moved onto, is not Kolux's.
fn made_branch(repo: &Path, branch: &str, origin: &serde_json::Value, here: &Path, clock: &Clock) -> bool {
    let before = names_before(repo, branch, clock);
    let folder = here.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let placeholder = |name: &str| crate::scm::writers::is_placeholder(name, &folder);
    match origin[projects::MADE_BRANCH_KEY].as_str() {
        Some(made) => made == branch || before.iter().any(|n| n == made),
        None => placeholder(branch) || before.iter().any(|n| placeholder(n)),
    }
}

#[cfg(test)]
/// The names `branch` was renamed from, read from its reflog (`Branch: renamed refs/heads/a to refs/heads/b`).
fn names_before(repo: &Path, branch: &str, clock: &Clock) -> Vec<String> {
    let Ok(log) = read(&["reflog", "show", "--format=%gs", &format!("refs/heads/{branch}")], repo, clock) else { return Vec::new() };
    log.lines().filter_map(|l| l.split_once("renamed refs/heads/")).filter_map(|(_, rest)| rest.split_once(" to refs/heads/")).map(|(old, _)| old.to_string()).collect()
}

/// Folders of build output and dependencies, which removal may delete without asking.
const BUILD_FOLDERS: [&str; 25] = ["node_modules", "target", "dist", "build", "out", ".next", "__pycache__", ".venv", "venv", ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache", ".gradle", ".parcel-cache", "bin", "obj", "vendor", "Pods", ".nuxt", ".svelte-kit", ".angular", ".dart_tool", ".terraform"];

/// Whether an ignored file looks like one a person made for this checkout (settings, secrets, data).
fn local_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with(".env") || n.contains(".local.") || n == "claude.local.md" || n.ends_with(".db") || n.ends_with(".sqlite") || n.ends_with(".sqlite3")
}

/// Whether a new file looks like it holds a password or key.
fn secret_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n == ".env" || n.starts_with(".env.") || n.ends_with(".pem") || n.ends_with(".key") || n.starts_with("id_rsa") || n.starts_with("id_ed25519") || n.contains("credentials") || n.contains("secret")
}

fn last_part(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

/// What the scan of ignored files found that removal would delete.
enum Found {
    /// A separate Git project (a folder with its own `.git`, a file or a folder) in an ignored folder (F2).
    Repo(PathBuf),
    /// A file that looks like the person's own settings, secrets or data (M7).
    Local(PathBuf),
}

/// The scan of one workspace's ignored files: where it is, the main checkout (to tell a file the
/// include file copied from a file the person made here), and how many entries it may still look at.
struct Scan<'a> {
    here: &'a Path,
    main: Option<&'a Path>,
    budget: usize,
}

impl Scan<'_> {
    fn spend(&mut self) -> Result<(), String> {
        self.budget = self.budget.checked_sub(1).ok_or("it holds too many ignored files to look through")?;
        Ok(())
    }

    /// F3 and F4: a file named like the person's own (`local_name`) or like a secret (`secret_name`: `*.key`, `*.pem`,
    /// `id_rsa*`, `*credentials*`, `*secret*`) that is not just a copy of main's own
    /// file: `.worktreeinclude` copies `.env` and the like into every workspace, and an unchanged
    /// copy is no loss when the workspace goes.
    fn own_file(&self, path: &Path) -> bool {
        path.file_name().is_some_and(|n| local_name(&n.to_string_lossy()) || secret_name(&n.to_string_lossy())) && !self.copy_of_main(path)
    }

    fn copy_of_main(&self, path: &Path) -> bool {
        let (Some(main), Ok(rel)) = (self.main, path.strip_prefix(self.here)) else { return false };
        same_bytes(path, &main.join(rel))
    }

    /// The first separate Git project or local-looking file under `dir`; a build folder met on the
    /// way is only looked through for a Git project (`repo_in`). A link (a shared folder) is not
    /// followed: removing the workspace removes the link and leaves what it points at.
    fn local_in(&mut self, dir: &Path) -> Result<Option<Found>, String> {
        if is_link(dir) {
            return Ok(None);
        }
        if dir.join(".git").exists() {
            return Ok(Some(Found::Repo(dir.to_path_buf())));
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return Ok(None) };
        for entry in entries.flatten() {
            self.spend()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
            let found = if is_dir {
                if BUILD_FOLDERS.contains(&name.as_str()) {
                    self.repo_in(&entry.path())?
                } else {
                    self.local_in(&entry.path())?
                }
            } else {
                self.own_file(&entry.path()).then(|| Found::Local(entry.path()))
            };
            if found.is_some() {
                return Ok(found);
            }
        }
        Ok(None)
    }

    /// F2: whether a build or dependency folder holds a separate Git project: in the folder itself or in a
    /// folder up to `REPO_DEPTH` levels inside it (`build/sub/clone/.git`, `vendor/acme/lib/.git`). A
    /// `node_modules` inside is not looked into (thousands of folders), and a `node_modules` folder itself is
    /// only looked at one level down, plus inside an `@scope` folder, as before. The files in it are never read.
    fn repo_in(&mut self, dir: &Path) -> Result<Option<Found>, String> {
        if is_link(dir) {
            return Ok(None);
        }
        if dir.join(".git").exists() {
            return Ok(Some(Found::Repo(dir.to_path_buf())));
        }
        let own_depth = if dir.file_name().is_some_and(|n| n == "node_modules") { 1 } else { REPO_DEPTH };
        self.repo_below(dir, own_depth, own_depth == 1)
    }

    /// The folders directly in `dir` that hold a `.git`, then (while `depth` allows) those folders' own folders.
    /// `scoped`: a `node_modules`, where an `@scope` folder gets one more level.
    fn repo_below(&mut self, dir: &Path, depth: usize, scoped: bool) -> Result<Option<Found>, String> {
        let Ok(entries) = std::fs::read_dir(dir) else { return Ok(None) };
        let mut inside = Vec::new();
        for entry in entries.flatten() {
            self.spend()?;
            if !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let path = entry.path();
            if path.join(".git").exists() {
                return Ok(Some(Found::Repo(path)));
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "node_modules" || name == ".git" {
                continue;
            }
            if depth > 1 {
                inside.push((path, depth - 1, false));
            } else if scoped && name.starts_with('@') {
                inside.push((path, 1, false));
            }
        }
        for (path, depth, scoped) in inside {
            if let Some(found) = self.repo_below(&path, depth, scoped)? {
                return Ok(Some(found));
            }
        }
        Ok(None)
    }
}

/// How many folder levels below a build folder are looked through for a separate Git project.
const REPO_DEPTH: usize = 3;

/// Whether `path` is a symbolic link or a folder junction.
fn is_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

/// F3: whether the two paths are files with exactly the same bytes (a file bigger than `LARGE_FILE` never is).
fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if !ma.is_file() || !mb.is_file() || ma.len() != mb.len() || ma.len() > LARGE_FILE {
        return false;
    }
    matches!((std::fs::read(a), std::fs::read(b)), (Ok(x), Ok(y)) if x == y)
}

/// M7 and F2: Err when removal would delete something that is not build output. That is ignored
/// files that look like local settings, secrets or data (`.env*`, `*.local.*`, `CLAUDE.local.md`,
/// `*.db`, `*.sqlite`) unless they are only unchanged copies of the main checkout's own (F3), and any
/// separate Git project (a `.git` anywhere in an ignored folder: its commits live nowhere else).
/// Ignored output inside the build and dependency folders is deleted without a question, but those
/// folders are still looked through for a separate Git project, at their top (`Scan::repo_in`).
/// `main` is the project's main checkout.
fn local_files(here: &Path, main: Option<&Path>, clock: &Clock) -> Result<(), String> {
    let listing = crate::git::bytes_within(&["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], Some(here), clock.read_limit()).map_err(|e| format!("Kolux could not read its ignored files ({})", short(&e)))?;
    let mut scan = Scan { here, main, budget: IGNORED_SCAN_LIMIT };
    for entry in String::from_utf8_lossy(&listing).split('\0').filter(|e| !e.is_empty()) {
        let built = entry.trim_end_matches('/').split('/').any(|c| BUILD_FOLDERS.contains(&c));
        let found = match entry.strip_suffix('/') {
            Some(dir) if built => scan.repo_in(&here.join(dir))?,
            Some(dir) => scan.local_in(&here.join(dir))?,
            None if last_part(entry) == ".git" => Some(Found::Repo(here.join(entry))),
            None => (!built && scan.own_file(&here.join(entry))).then(|| Found::Local(here.join(entry))),
        };
        let shown = |f: &Path| f.strip_prefix(here).map(|p| p.display().to_string()).unwrap_or(f.display().to_string()).replace('\\', "/");
        match found {
            Some(Found::Repo(at)) => {
                let at = if at.file_name().is_some_and(|n| n == ".git") { at.parent().map(Path::to_path_buf).unwrap_or(at) } else { at };
                return Err(format!("it holds a separate Git project inside an ignored folder ({}), which removing the workspace would delete", shown(&at)));
            }
            Some(Found::Local(file)) => {
                return Err(format!("it holds an ignored file that looks like your own settings, keys or data ({}), which removing the workspace would delete", shown(&file)));
            }
            None => {}
        }
    }
    Ok(())
}

#[cfg(test)]
/// Commits everything in the workspace (untracked files too, ignored files not). Err, with nothing
/// staged, when a new file is a separate Git project (B2), looks like a password or key (M5), or is
/// very large (M5).
fn save_changes(cx: &Cx, here: &Path) -> Result<(), String> {
    save_with(&cx.clock, &cx.hooks, here, SAVE_MESSAGE, AUTOMATIC)
}

/// `save_changes` with its own commit message (`subject`, then `body`): the quit's save and a land's.
pub(crate) fn save_with(clock: &Clock, hooks: &Path, here: &Path, subject: &str, body: &str) -> Result<(), String> {
    let new = crate::git::bytes_within(&["ls-files", "--others", "--exclude-standard", "-z"], Some(here), clock.read_limit()).map_err(|e| format!("Kolux could not read its changes ({})", short(&e)))?;
    for entry in String::from_utf8_lossy(&new).split('\0').filter(|e| !e.is_empty()) {
        // A folder with its own .git is listed as one entry with a trailing slash; staging it would record a link to a
        // repository nobody can fetch, and removing the workspace would delete that repository's own commits.
        if entry.ends_with('/') {
            return Err(format!("it holds a separate Git project ({}), which cannot be saved as part of it", entry.trim_end_matches('/')));
        }
        if secret_name(last_part(entry)) {
            return Err(format!("it holds a new file that looks like a password or key ({entry}), which Kolux will not save for you"));
        }
        let size = std::fs::metadata(here.join(entry)).map(|m| m.len()).unwrap_or(0);
        if size > LARGE_FILE {
            return Err(format!("it holds a very large new file ({entry}, {} MB), which Kolux will not save for you", size / (1024 * 1024)));
        }
    }
    if !clock.may_start() {
        return Err(OUT_OF_TIME.into());
    }
    // m1: an `add` or `commit` the quit cuts off leaves an index.lock in the workspace that stops every
    // later save of it, so the exit waits for the save like it waits for a merge (the same hard cap).
    let _busy = Busy::start();
    let failed = |e: String| format!("its changes could not be saved ({})", short(&e));
    write(&["add", "-A"], here, clock, hooks).map_err(failed)?;
    // The same check again on what was really staged: a new link to another repository (mode 160000).
    let staged = read(&["diff", "--cached", "--raw", "--no-renames"], here, clock).map_err(failed)?;
    if let Some(link) = staged.lines().find_map(new_gitlink) {
        let _ = write(&["reset", "-q"], here, clock, hooks);
        return Err(format!("it holds a separate Git project ({link}), which cannot be saved as part of it"));
    }
    // Only changes inside a submodule: nothing is staged, so there is nothing to commit here.
    if read(&["diff", "--cached", "--quiet"], here, clock).is_ok() {
        return Ok(());
    }
    write(&["commit", "-q", "--no-verify", "-m", subject, "-m", body], here, clock, hooks).map(drop).map_err(failed)
}

/// The path of a new gitlink in one `diff --cached --raw` line (`:000000 160000 <sha> <sha> A<TAB>path`).
fn new_gitlink(line: &str) -> Option<String> {
    let (meta, path) = line.split_once('\t')?;
    let mut fields = meta.trim_start_matches(':').split_whitespace();
    let (old_mode, new_mode) = (fields.next()?, fields.next()?);
    (old_mode == "000000" && new_mode == "160000").then(|| path.to_string())
}

#[cfg(test)]
/// Merges `branch` into `target` in the main checkout: a fast-forward when main has nothing of its
/// own, else a merge commit, tried only when Git predicts no clash. A failure is undone. A marker in
/// the app's data folder says what is under way until main is whole again, so a quit that is cut
/// short is put right at the next start (`recover_at_start`).
fn merge_into(cx: &Cx, repo: &Path, main_dir: &Path, target: &str, branch: &str) -> Result<(), String> {
    let subject = format!("Kolux: merge {branch} on quit");
    merge_branch(&MergeEnv { git: cx.git, clock: cx.clock, data_dir: cx.data_dir, hooks: &cx.hooks, subject: &subject, body: AUTOMATIC, closing: &|| false }, repo, main_dir, target, branch)
}

/// What a merge needs besides the folders: the same pieces the quit's `Cx` holds, without the store
/// and the terminals, so a chat that ends can merge its branch through the very same code.
pub(crate) struct MergeEnv<'a> {
    pub git: &'a Git,
    pub clock: Clock,
    pub data_dir: &'a Path,
    pub hooks: &'a Path,
    /// The merge commit's first line, when main has moved on (a fast-forward makes no commit).
    pub subject: &'a str,
    /// Its second paragraph.
    pub body: &'a str,
    /// True once Kolux is closing: no merge write starts after that (re-review P2-B).
    pub closing: &'a dyn Fn() -> bool,
}

/// `merge_into` over `MergeEnv`: the one merge routine, used at quit and when a chat is finished.
pub(crate) fn merge_branch(env: &MergeEnv, repo: &Path, main_dir: &Path, target: &str, branch: &str) -> Result<(), String> {
    let clock = &env.clock;
    let (git, data_dir, hooks) = (env.git, env.data_dir, env.hooks);
    if !clock.may_merge() {
        return Err(OUT_OF_TIME.into());
    }
    let before = read(&["rev-parse", "HEAD"], main_dir, clock).map_err(|e| format!("Kolux could not read the main folder ({})", short(&e)))?;
    let behind = ahead(repo, branch, target, clock)?;
    let theirs = format!("refs/heads/{branch}");
    // The tree the no-ff merge will make, when git can predict it (`merge-tree --write-tree`: first line).
    let mut merged_tree: Option<String> = None;
    if behind > 0 && git.predicts_merges() {
        // Re-review P2-B: the merge-tree is cut by the land's own clock, not git's fixed short limit.
        let out = crate::git::read_exit_within(&["merge-tree", "--write-tree", &format!("refs/heads/{target}"), &theirs], Some(repo), clock.read_limit());
        match merge_tree_says(out.map(|o| (o.status.code(), String::from_utf8_lossy(&o.stdout).into_owned()))) {
            MergeTree::Clean(tree) => merged_tree = tree,
            MergeTree::Clash => return Err(clash_reason(target)),
            MergeTree::Unknown(e) => return Err(format!("Kolux could not check it against {target} ({})", short(&e))),
        }
    }
    let tip = read(&["rev-parse", "--verify", &theirs], repo, clock).map_err(|e| format!("Kolux could not read the branch's tip ({})", short(&e)))?;
    // A fast-forward leaves exactly the tip's tree; a merge commit leaves the predicted tree, if any.
    let expected_tree = if behind == 0 { read(&["rev-parse", "--verify", &format!("{tip}^{{tree}}")], repo, clock).ok() } else { merged_tree };
    let marker = Marker { main_dir: main_dir.display().to_string(), before_sha: before.clone(), branch: branch.to_string(), theirs_sha: Some(tip.clone()), expected_tree, time: now_secs() };
    // Review P1-1: main is looked at once more right before the write; staged work that arrived since
    // `main_ready` stops the merge before it starts.
    match read(&["status", "--porcelain", "--untracked-files=no"], main_dir, clock) {
        Ok(s) if s.trim().is_empty() => {}
        Ok(_) => return Err(MAIN_CHANGED.into()),
        Err(e) => return Err(format!("Kolux could not read the main folder ({})", short(&e))),
    }
    #[cfg(test)]
    run_hook(&BEFORE_LAST_CHECK);
    // F5, re-review P2-B: the reads above took time (a merge-tree of a big project can take seconds),
    // and the quit may have begun meanwhile: both are checked last, right before the merge is noted
    // and started. Nothing has been written yet, so either is a clean refusal.
    if !clock.may_merge() {
        return Err(OUT_OF_TIME.into());
    }
    if (env.closing)() {
        return Err(CLOSING.into());
    }
    note_merge(data_dir, &marker).map_err(|e| format!("Kolux could not note the merge, so it did not start it ({e})"))?;
    let _busy = Busy::start();
    // Review P3-2: `--no-overwrite-ignore`: an ignored file in main is never replaced by the merge.
    let tried = if behind == 0 {
        write(&["merge", "--ff-only", "--no-overwrite-ignore", "--no-verify", "-q", &tip], main_dir, clock, hooks)
    } else {
        write(&["merge", "--no-ff", "--no-overwrite-ignore", "--no-edit", "--no-verify", "-q", "-m", env.subject, "-m", env.body, &tip], main_dir, clock, hooks)
    };
    match tried {
        Ok(_) => {
            clear_marker(data_dir, main_dir);
            Ok(())
        }
        Err(e) => {
            let whole = undo_merge(main_dir, &before, clock, hooks);
            if whole {
                clear_marker(data_dir, main_dir);
            }
            let note = if whole { "" } else { ". The main folder may not be exactly as it was: look at it before you work there" };
            Err(format!("it could not be merged into {target} ({}){note}", short(&e)))
        }
    }
}

/// Why a merge was not made: its changes clash with `target` (git's merge-tree said so, exit 1).
pub(crate) fn clash_reason(target: &str) -> String {
    format!("its changes clash with {target}")
}

/// What `git merge-tree --write-tree` said, from its exit code (review P3-3): 0 is a clean merge (the
/// tree on the first line), 1 is a clash, and anything else (a timeout, an error) says nothing.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MergeTree {
    Clean(Option<String>),
    Clash,
    Unknown(String),
}

pub(crate) fn merge_tree_says(out: Result<(Option<i32>, String), String>) -> MergeTree {
    match out {
        Ok((Some(0), text)) => MergeTree::Clean(text.lines().next().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string)),
        Ok((Some(1), _)) => MergeTree::Clash,
        Ok((code, _)) => MergeTree::Unknown(format!("git merge-tree ended with {code:?}")),
        Err(e) => MergeTree::Unknown(e),
    }
}

/// Puts the main checkout back after a failed merge: an open merge is aborted, and changes a cut
/// merge left are reset (the checkout had none of its own: `main_ready`). True when it is as it was.
fn undo_merge(main_dir: &Path, before: &str, clock: &Clock, hooks: &Path) -> bool {
    let open = read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], main_dir, clock).is_ok();
    // Review P1-1: only a merge that got under way (MERGE_HEAD, or the lock a cut git left) is reset.
    // A merge git refused cleanly changed nothing, and a reset would throw away the user's staged work.
    // Re-review P2-A: a lock is never a reason to reset. It may be the user's own git (a `git add`)
    // that lets go and stages work a moment later. A lock our cut merge left is put right at the next
    // start (`recover` checks the lock's age and that the index is the merge's), so with one present
    // the undo does not call main whole and the marker is kept for that.
    let locked = read(&["rev-parse", "--git-path", "index.lock"], main_dir, clock).is_ok_and(|p| main_dir.join(p.trim()).exists());
    #[cfg(test)]
    run_hook(&AFTER_LOCK_LOOK);
    if open {
        let _ = write(&["merge", "--abort"], main_dir, clock, hooks);
    }
    let head = || read(&["rev-parse", "HEAD"], main_dir, clock).ok();
    let clean = || read(&["status", "--porcelain", "--untracked-files=no"], main_dir, clock).is_ok_and(|s| s.trim().is_empty());
    if open && head().as_deref() == Some(before) && !clean() {
        let _ = write(&["reset", "--merge"], main_dir, clock, hooks);
    }
    !locked && head().as_deref() == Some(before) && clean()
}

/// What a merge in a main checkout leaves behind while it runs, so a start can tell a cut one.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Marker {
    #[serde(rename = "mainDir")]
    main_dir: String,
    #[serde(rename = "beforeSha")]
    before_sha: String,
    branch: String,
    /// The merged branch's tip when the merge began (F1): recovery puts main back only for a merge of
    /// exactly this commit. A marker without it (an older one) never resets anything.
    #[serde(rename = "theirsSha", default, skip_serializing_if = "Option::is_none")]
    theirs_sha: Option<String>,
    /// The tree the merge leaves in the index (the tip's tree for a fast-forward, the predicted
    /// `merge-tree` result for a merge commit). Recovery resets only an index that is exactly this
    /// tree (or one with nothing staged): never one the user has since added work to. None when git
    /// could not say; with staged changes such a marker never resets anything.
    #[serde(rename = "expectedTree", default, skip_serializing_if = "Option::is_none")]
    expected_tree: Option<String>,
    /// Seconds since 1970 when the merge began.
    time: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Review P2-1: one marker per main folder (a hash of its name in the file name), so two projects
/// merging at once never overwrite each other's. `MARKER_FILE` (no hash) is an older single one.
fn marker_path(data_dir: &Path, main_dir: &Path) -> PathBuf {
    // FNV-1a over the folder's name key: stable across runs and builds (std's hasher is not).
    let hash = projects::name_key(&main_dir.to_string_lossy()).bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3));
    data_dir.join(format!("{MARKER_STEM}-{hash:016x}.json"))
}

/// Every marker file in `data_dir`: the per-folder ones and an older single one.
fn marker_files(data_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(data_dir) else { return Vec::new() };
    let mut all: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(MARKER_STEM) && n.ends_with(".json")))
        .collect();
    all.sort();
    all
}

fn note_merge(data_dir: &Path, marker: &Marker) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let file = marker_path(data_dir, Path::new(&marker.main_dir));
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(marker).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

fn clear_marker(data_dir: &Path, main_dir: &Path) {
    let _ = std::fs::remove_file(marker_path(data_dir, main_dir));
}

fn read_marker(file: &Path) -> Option<Marker> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// At start: a merge the last quit began and never finished (the marker is still there) is put right.
/// HEAD moved off where the marker says it was: the merge finished, nothing to do. A merge still open
/// (MERGE_HEAD is the marker's branch tip), or the dead run's own `index.lock` (not newer than the
/// merge's start plus the quit's hard cap) with HEAD still there: `git reset --merge` returns the
/// checkout to how it was, but only when the index is exactly the merge's own tree (`expectedTree`) or holds nothing staged, and every changed path is one the merge of that tip could have
/// changed (F1: the user may have staged work in main since). With no merge open and no lock nothing
/// is ever reset (the marker is only cleared, with a notice when main holds changes), and a marker
/// without a branch tip (an older one) never resets anything. The whole run is capped at `RECOVER_CAP`;
/// when the cap cuts it short the marker is kept, so the next launch tries again.
/// Returns what the start's notice should say, if anything.
pub fn recover_at_start(data_dir: &Path) -> Vec<String> {
    // Review P2-1: every project's marker is looked at, all under the one cap.
    let clock = Clock::until(Instant::now() + RECOVER_CAP);
    let mut notes = Vec::new();
    for file in marker_files(data_dir) {
        let Some(marker) = read_marker(&file) else {
            let _ = std::fs::remove_file(&file); // an unreadable one is no use to anyone
            continue;
        };
        let (note, cut_short) = recover(data_dir, &marker, &clock);
        if !cut_short {
            let _ = std::fs::remove_file(&file);
        } // else the cap ran out before main was looked through: the marker stays so the next launch tries again
        notes.extend(note);
    }
    notes
}

/// The longest a start spends putting main right (m2): every git step of `recover` is cut by this
/// one clock, so a stuck folder costs the launch at most this much (plus one short step), never more.
const RECOVER_CAP: Duration = Duration::from_secs(10);

/// Paths git lists with `-z`, as text.
fn paths(raw: Vec<u8>) -> Vec<String> {
    String::from_utf8_lossy(&raw).split('\0').filter(|p| !p.is_empty()).map(|p| p.to_string()).collect()
}

/// Every path of tracked files that differs from HEAD in the main checkout, staged or not (a new file
/// that was staged counts; a file nobody ever added does not). Renames are not paired, so both names show.
fn changed_in(main: &Path, clock: &Clock) -> Result<Vec<String>, String> {
    crate::git::bytes_within(&["diff", "HEAD", "--name-only", "--no-renames", "-z"], Some(main), clock.read_limit()).map(paths)
}

/// F1: every path the merge of `theirs` into `before` could have touched (`before` and `theirs` differ in it).
fn merge_paths(main: &Path, before: &str, theirs: &str, clock: &Clock) -> Result<Vec<String>, String> {
    crate::git::bytes_within(&["diff", "--name-only", "--no-renames", "-z", before, theirs], Some(main), clock.read_limit()).map(paths)
}

/// Whether the index holds exactly the merge's own result (`expectedTree`) or nothing staged at all
/// (equal to HEAD): the only two states a reset cannot cost the user staged work in. Any git
/// failure counts as "no".
fn index_is_the_merges(main: &Path, marker: &Marker, clock: &Clock) -> bool {
    let same = |tree: &str| read(&["diff", "--cached", "--quiet", tree], main, clock).is_ok();
    marker.expected_tree.as_deref().is_some_and(same) || same("HEAD")
}

/// Runs `recover_with` on `clock` (the `RECOVER_CAP` one). The flag is true when the cap cut the work
/// short: the marker is then kept, so the next launch tries again (the notice is shown either way).
fn recover(data_dir: &Path, marker: &Marker, clock: &Clock) -> (Option<String>, bool) {
    let note = recover_with(data_dir, marker, clock);
    let cut_short = note.is_some() && !clock.may_start() && !note.as_deref().is_some_and(|n| n.contains(DONE_NOTE));
    (note, cut_short)
}

/// A lock is the dead run's only when it is at least this old now (the previous quit ended before this launch began).
const LOCK_MIN_AGE: Duration = Duration::from_secs(10);

/// The notice for a recovery that finished: nothing is left to retry.
const DONE_NOTE: &str = "put the folder back the way it was before the merge";

fn recover_with(data_dir: &Path, marker: &Marker, clock: &Clock) -> Option<String> {
    let main = Path::new(&marker.main_dir);
    if !main.is_dir() {
        return None;
    }
    let cut = |what: &str| Some(format!("Kolux was closing while it merged {} into {}, and {what}", marker.branch, marker.main_dir));
    let left = "so Kolux left it as it is: look at the main folder before you work there";
    let Ok(head) = read(&["rev-parse", "HEAD"], main, clock) else { return cut("could not look at that folder now: check it before you work there") };
    if head != marker.before_sha {
        return None; // the merge got as far as moving the branch: it finished
    }
    let merge_head = read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], main, clock).ok();
    let lock = read(&["rev-parse", "--git-path", "index.lock"], main, clock).ok().map(|p| main.join(p.trim())).filter(|p| p.exists());
    if merge_head.is_none() && lock.is_none() {
        // The merge never got going or was undone: there is nothing of its to put back, so nothing is reset,
        // whatever main holds now is the user's own (F1). A leftover marker never costs anybody their work.
        return match changed_in(main, clock) {
            Ok(dirty) if dirty.is_empty() => None,
            _ => cut(&format!("main has changes in it Kolux did not make, {left}")),
        };
    }
    // Something of the merge is left. It is undone only when it is certainly this merge's, and only
    // where every changed path is one the merge could have changed.
    let Some(theirs) = marker.theirs_sha.as_deref() else {
        return cut(&format!("the note of that merge is from an older Kolux and cannot be checked, {left}"));
    };
    if merge_head.as_deref().is_some_and(|m| m != theirs) {
        return cut(&format!("the merge open in that folder is not the one Kolux began, {left}"));
    }
    if !clock.may_start() {
        return cut("it took too long to look at that folder: check it before you work there");
    }
    let (Ok(dirty), Ok(allowed)) = (changed_in(main, clock), merge_paths(main, &marker.before_sha, theirs, clock)) else {
        return cut("could not check what was changed in that folder: look at it before you work there");
    };
    if dirty.iter().any(|p| !allowed.contains(p)) {
        return cut(&format!("that folder holds changes the merge did not make, {left}"));
    }
    // By content, not by path: the index must be exactly what the merge makes, or hold nothing staged
    // (a cut merge plus the user's own `git add` on a merged file is what paths cannot tell apart).
    // Checked before the lock is touched, so a refusal leaves everything as it is.
    if !index_is_the_merges(main, marker, clock) {
        return cut(&format!("that folder holds changes the merge did not make, {left}"));
    }
    if let Some(lock) = lock {
        // Only the dead run can have made a lock this old: git processes end with the app.
        let made = std::fs::metadata(&lock).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
        // Not newer than the merge could have made it, and not fresh either: a lock made in the last few
        // seconds (an editor's git at this very launch) is somebody else's, whatever the marker says.
        let ours = made.is_some_and(|m| m <= marker.time + HARD_CAP.as_secs() && m + LOCK_MIN_AGE.as_secs() <= now_secs());
        if !ours || std::fs::remove_file(&lock).is_err() {
            return cut("a lock file in that folder is newer than the merge, so Kolux left it: look at it before you work there");
        }
    }
    if merge_head.is_none() && dirty.is_empty() {
        return None; // only the dead run's lock was left, and it is gone
    }
    if !clock.may_start() {
        return cut("it took too long to look at that folder: check it before you work there");
    }
    let Ok(hooks) = no_hooks(data_dir) else { return cut("could not put it back: look at it before you work there") };
    let reset = write(&["reset", "--merge"], main, clock, &hooks);
    let clean = |clock: &Clock| read(&["status", "--porcelain", "--untracked-files=no"], main, clock).is_ok_and(|s| s.trim().is_empty());
    let whole = read(&["rev-parse", "HEAD"], main, clock).is_ok_and(|h| h == marker.before_sha) && clean(clock) && read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], main, clock).is_err();
    if reset.is_ok() && whole {
        cut(DONE_NOTE)
    } else {
        cut("could not put it back the way it was: look at it before you work there")
    }
}

#[cfg(test)]
/// Saves what this quit kept (for the next start's notice) and which projects it went through.
pub fn save_outcome(store: &Store, out: &Outcome) -> Result<(), String> {
    save_record(store, &Record { left: out.left.clone(), repos: out.repos.clone() })
}

/// The next start's notice: what the last quit kept and why, told once (the list is cleared).
pub fn take_notes(store: &Store) -> Vec<String> {
    let mut record = read_record(store);
    if record.left.is_empty() {
        return Vec::new();
    }
    let notes = notes(&record.left);
    record.left.clear();
    let _ = save_record(store, &record);
    notes
}

/// The `.worktrees` folders of the projects the last quit went through, for the start's trash sweep.
pub fn swept_folders(store: &Store) -> Vec<PathBuf> {
    read_record(store).repos.iter().map(|r| Path::new(r).join(projects::PROJECT_LOCAL_DIR)).collect()
}

/// Plain sentences: a heading, at most five workspaces with their reasons, and what happens next.
pub fn notes(left: &[Left]) -> Vec<String> {
    if left.is_empty() {
        return Vec::new();
    }
    let n = left.len();
    let mut out = vec![if n == 1 { "When Kolux last closed, it kept 1 workspace instead of merging it into main:".to_string() } else { format!("When Kolux last closed, it kept {n} workspaces instead of merging them into main:") }];
    out.extend(left.iter().take(5).map(|l| {
        let name = l.branch.clone().unwrap_or_else(|| Path::new(&l.path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| l.path.clone()));
        format!("{name} in {}: {}.", l.project, l.why)
    }));
    let more = if n > 5 { format!("And {} more. ", n - 5) } else { String::new() };
    out.push(format!("{more}Kolux tries again the next time it closes."));
    out
}

#[cfg(test)]
#[path = "quit_merge_tests.rs"]
mod tests;
