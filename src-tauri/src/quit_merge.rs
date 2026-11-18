//! Txais (2026-11-17): "when we close the app, all temp folders get merged into the main and all the
//! temp worktrees disappear." On a real quit (never a restart, never Windows ending the session),
//! each workspace Kolux made (it has an origin record; the main checkout and worktrees made by other
//! tools are never touched) is tidied away:
//!
//! 1. Uncommitted work, untracked files included and ignored files left out, is committed as
//!    "Kolux: saved on quit".
//! 2. A branch with commits main lacks is merged into the project's main branch in the main
//!    checkout, locally (nothing is pushed), only while that checkout is on main with no
//!    uncommitted changes to tracked files. A fast-forward when it can be, else a merge commit; a
//!    merge Git predicts would clash is not tried, and a failed one is aborted so main is left
//!    exactly as it was.
//! 3. Only once the branch's tip is in main (or it had nothing new) does the workspace go, through the
//!    same removal the delete button uses, never forced: its branch goes with it when nothing is lost.
//!
//! Anything locked, still holding changes, clashing, or out of time stays, with its reason; it is tried
//! again at the next quit, and the next start shows one notice naming what was kept and why.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

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
/// How long the quit gives the merge. A new step starts only while `MIN_TO_START` of it is left.
pub const BUDGET: Duration = Duration::from_secs(5);
/// How long past `BUDGET` the quit waits for a step that already started.
pub const GRACE: Duration = Duration::from_secs(2);
/// The quit's whole wait for the merge (lifecycle::quit_deadline counts it).
pub const WAIT: Duration = Duration::from_secs(BUDGET.as_secs() + GRACE.as_secs());
const MIN_TO_START: Duration = Duration::from_millis(1500);
/// A commit or merge that started is not cut short before this (a cut merge could leave main half done).
const WRITE_LIMIT: Duration = Duration::from_secs(60);

/// True while a merge (or its undo) runs in a main checkout, so the quit waits for it to end.
static MERGING: AtomicBool = AtomicBool::new(false);

const OUT_OF_TIME: &str = "Kolux ran out of time while closing";
const LOCKED: &str = "it is locked";
const DETACHED: &str = "it is not on a branch";
const OWN_BRANCH: &str = "it was opened on a branch that already existed (or a pull request), so it is left for you";
const NO_MAIN: &str = "Kolux could not tell which branch is main";
const BUSY: &str = "Kolux was still busy with this project";

pub fn wanted(settings: &serde_json::Value) -> bool {
    settings[MERGE_ON_QUIT_SETTING].as_bool() != Some(false)
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

#[derive(Debug, Default)]
pub struct Outcome {
    pub merged: Vec<String>,
    pub removed: Vec<String>,
    pub left: Vec<Left>,
    /// The main checkouts of the projects that had workspaces to tidy.
    pub repos: Vec<String>,
}

impl Outcome {
    fn keep(&mut self, project: &Project, w: &Worktree, why: impl Into<String>) {
        self.left.push(Left { project: project.name.clone(), path: w.path.clone(), branch: w.branch.clone(), why: why.into() });
    }

    /// The one line the diagnostics log gets.
    pub fn line(&self) -> String {
        let kept: Vec<String> = self.left.iter().map(|l| format!("{} ({})", l.path, l.why)).collect();
        format!("quit merge: {} merged, {} removed, {} kept{}{}", self.merged.len(), self.removed.len(), self.left.len(), if kept.is_empty() { "" } else { ": " }, kept.join("; "))
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

/// The deadline every step checks.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    deadline: Instant,
}

impl Clock {
    pub fn until(deadline: Instant) -> Self {
        Self { deadline }
    }
    fn left(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    fn may_start(&self) -> bool {
        self.left() >= MIN_TO_START
    }
    /// A read is cut at the deadline (with a floor, so a read that starts always gets a fair try).
    fn read_limit(&self) -> Duration {
        self.left().clamp(Duration::from_secs(1), Duration::from_secs(10))
    }
}

/// Git's error cut to its first line, for a reason the user reads.
fn short(e: &str) -> String {
    let line = e.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("Git gave no reason");
    line.chars().take(200).collect()
}

fn read(args: &[&str], dir: &Path, clock: &Clock) -> Result<String, String> {
    crate::git::run_within(args, Some(dir), clock.read_limit())
}

fn write(args: &[&str], dir: &Path) -> Result<String, String> {
    crate::git::run_within(args, Some(dir), WRITE_LIMIT)
}

/// How many commits `to` has that `from` lacks (both local branches).
fn ahead(repo: &Path, from: &str, to: &str, clock: &Clock) -> Result<u64, String> {
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

/// Tidies every workspace Kolux made, as the module says, stopping cleanly at `clock`.
pub fn run(git: &Git, store: &Mutex<Store>, terminals: &Terminals, clock: Clock) -> Outcome {
    let (listed, origins) = match store.lock() {
        Ok(s) => (projects::load_projects(&s), projects::load_origins(&s)),
        Err(_) => return Outcome::default(),
    };
    let mut out = Outcome::default();
    for project in projects_to_tidy(listed, &origins) {
        tidy_project(git, store, terminals, &project, &origins, clock, &mut out);
    }
    out
}

fn tidy_project(git: &Git, store: &Mutex<Store>, terminals: &Terminals, project: &Project, origins: &serde_json::Map<String, serde_json::Value>, clock: Clock, out: &mut Outcome) {
    let repo = Path::new(&project.path);
    if !clock.may_start() {
        return;
    }
    let Ok(all) = git.worktrees(repo) else { return };
    let ours: Vec<Worktree> = projects::kolux_made(origins, all.clone()).into_iter().filter(|w| !w.is_main && Path::new(&w.path).is_dir()).collect();
    if ours.is_empty() {
        return;
    }
    out.repos.push(project.path.clone());
    // Never waits on a create or rename that holds the project: the quit must not hang.
    let turn = projects::repo_turn(repo);
    let _turn = match turn.try_lock() {
        Ok(g) => g,
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => {
            for w in &ours {
                out.keep(project, w, BUSY);
            }
            return;
        }
    };
    if repo.join(projects::PROJECT_LOCAL_DIR).is_dir() {
        let _ = projects::ensure_excluded(repo);
    }
    let target = git.default_branch(repo).map(|b| b.strip_prefix("origin/").map(str::to_string).unwrap_or(b));
    let ready = main_ready(all.iter().find(|w| w.is_main), target.as_deref(), &clock);
    for w in &ours {
        if !clock.may_start() {
            out.keep(project, w, OUT_OF_TIME);
            continue;
        }
        let origin = origins.get(&projects::name_key(&w.path)).cloned().unwrap_or_default();
        match tidy_one(git, store, terminals, project, w, &origin, target.as_deref(), &ready, &clock) {
            Ok(merged) => {
                if merged {
                    out.merged.push(w.path.clone());
                }
                out.removed.push(w.path.clone());
            }
            Err(why) => out.keep(project, w, why),
        }
    }
}

/// The main checkout's folder when a merge may go into it: on `target`, with no uncommitted changes
/// to tracked files. Untracked files do not count: Git itself refuses a merge that would overwrite
/// one, before it changes anything.
fn main_ready(main: Option<&Worktree>, target: Option<&str>, clock: &Clock) -> Result<PathBuf, String> {
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
    Ok(dir)
}

/// One workspace: saved, merged when it has something new, then removed. Ok(true) when it was merged.
#[allow(clippy::too_many_arguments)]
fn tidy_one(git: &Git, store: &Mutex<Store>, terminals: &Terminals, project: &Project, w: &Worktree, origin: &serde_json::Value, target: Option<&str>, ready: &Result<PathBuf, String>, clock: &Clock) -> Result<bool, String> {
    if w.locked.is_some() {
        return Err(LOCKED.into());
    }
    let Some(branch) = w.branch.as_deref() else { return Err(DETACHED.into()) };
    // A branch the user opened (or a pull request's) is theirs to merge; Kolux never merges it for them.
    if origin["existingBranch"] == true || origin["pr"].is_string() {
        return Err(OWN_BRANCH.into());
    }
    let repo = Path::new(&project.path);
    save_changes(Path::new(&w.path), clock)?;
    let target = target.ok_or(NO_MAIN)?;
    let merged = if ahead(repo, target, branch, clock)? > 0 {
        let main_dir = ready.as_ref().map_err(Clone::clone)?;
        merge_into(git, repo, main_dir, target, branch, clock)?;
        true
    } else {
        false
    };
    if ahead(repo, target, branch, clock)? > 0 {
        return Err(format!("its commits are not in {target} yet"));
    }
    if !clock.may_start() {
        return Err(OUT_OF_TIME.into());
    }
    let check = projects::remove_check(git, project, &w.path).map_err(|e| format!("it could not be removed ({})", short(&e)))?;
    projects::remove_with(git, store, terminals, project, &w.path, false, &check.stamp, None, false).map_err(|e| format!("it could not be removed ({})", short(&e)))?;
    Ok(merged)
}

/// Commits everything in the workspace (untracked files too, ignored files not).
fn save_changes(here: &Path, clock: &Clock) -> Result<(), String> {
    let status = read(&["status", "--porcelain"], here, clock).map_err(|e| format!("Kolux could not read its changes ({})", short(&e)))?;
    if status.trim().is_empty() {
        return Ok(());
    }
    if !clock.may_start() {
        return Err(OUT_OF_TIME.into());
    }
    let failed = |e: String| format!("its changes could not be saved ({})", short(&e));
    write(&["add", "-A"], here).map_err(failed)?;
    // Only changes inside a submodule: nothing is staged, so there is nothing to commit here.
    if read(&["diff", "--cached", "--quiet"], here, clock).is_ok() {
        return Ok(());
    }
    write(&["commit", "-q", "-m", SAVE_MESSAGE], here).map(drop).map_err(failed)
}

/// Merges `branch` into `target` in the main checkout: a fast-forward when main has nothing of its
/// own, else a merge commit, tried only when Git predicts no clash. A failure is undone.
fn merge_into(git: &Git, repo: &Path, main_dir: &Path, target: &str, branch: &str, clock: &Clock) -> Result<(), String> {
    if !clock.may_start() {
        return Err(OUT_OF_TIME.into());
    }
    let before = read(&["rev-parse", "HEAD"], main_dir, clock).map_err(|e| format!("Kolux could not read the main folder ({})", short(&e)))?;
    let behind = ahead(repo, branch, target, clock)?;
    let theirs = format!("refs/heads/{branch}");
    if behind > 0 && git.predicts_merges() && read(&["merge-tree", "--write-tree", &format!("refs/heads/{target}"), &theirs], repo, clock).is_err() {
        return Err(format!("its changes clash with {target}"));
    }
    MERGING.store(true, Ordering::SeqCst);
    let tried = if behind == 0 {
        write(&["merge", "--ff-only", "-q", &theirs], main_dir)
    } else {
        write(&["merge", "--no-ff", "--no-edit", "-q", "-m", &format!("Kolux: merge {branch} on quit"), &theirs], main_dir)
    };
    let result = match tried {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("it could not be merged into {target} ({}){}", short(&e), undo_merge(main_dir, &before, clock))),
    };
    MERGING.store(false, Ordering::SeqCst);
    result
}

/// Puts the main checkout back after a failed merge: an open merge is aborted, and changes a cut
/// merge left are reset (the checkout had none of its own: `main_ready`). Says so when it could not.
fn undo_merge(main_dir: &Path, before: &str, clock: &Clock) -> String {
    if read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], main_dir, clock).is_ok() {
        let _ = write(&["merge", "--abort"], main_dir);
    }
    let head = || read(&["rev-parse", "HEAD"], main_dir, clock).ok();
    let clean = || read(&["status", "--porcelain", "--untracked-files=no"], main_dir, clock).is_ok_and(|s| s.trim().is_empty());
    if head().as_deref() == Some(before) && !clean() {
        let _ = write(&["reset", "--merge"], main_dir);
    }
    if head().as_deref() == Some(before) && clean() {
        String::new()
    } else {
        ". The main folder may not be exactly as it was: look at it before you work there".into()
    }
}

/// Why the merge does not run at this exit, or None when it does.
pub fn skip_reason(settings: &serde_json::Value, restart: bool, session_end: bool, terminals_stay: bool) -> Option<&'static str> {
    if !wanted(settings) {
        Some("turned off in Settings")
    } else if restart {
        Some("a restart, not a quit")
    } else if session_end {
        Some("Windows is ending the session")
    } else if terminals_stay {
        Some("the terminal service keeps sessions running")
    } else {
        None
    }
}

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

/// The quit's merge, on its own thread so the WebView2 wait runs beside it. Returns what `finish`
/// waits on; the thread saves the outcome and writes the log line itself.
pub fn start(app: tauri::AppHandle) -> std::sync::mpsc::Receiver<()> {
    use tauri::Manager;
    let (tx, rx) = std::sync::mpsc::channel();
    let clock = Clock::until(Instant::now() + BUDGET);
    std::thread::spawn(move || {
        let out = run(&app.state::<Git>(), &app.state::<Mutex<Store>>(), &app.state::<Terminals>(), clock);
        if let Ok(store) = app.state::<Mutex<Store>>().lock() {
            if let Err(e) = save_outcome(&store, &out) {
                if let Ok(dir) = app.path().app_data_dir() {
                    crate::diag::write(&dir, &format!("quit merge: what it kept could not be saved ({e})"));
                }
            }
        }
        if let Ok(dir) = app.path().app_data_dir() {
            crate::diag::write(&dir, &out.line());
        }
        let _ = tx.send(());
    });
    rx
}

/// Waits for `start`'s thread up to `WAIT`, and past it only while a merge is under way in a main
/// checkout (the quit's watchdog still ends the process at its hard limit).
pub fn finish(app: &tauri::AppHandle, done: std::sync::mpsc::Receiver<()>, started: Instant) {
    use tauri::Manager;
    if done.recv_timeout(WAIT.saturating_sub(started.elapsed())).is_ok() {
        return;
    }
    while MERGING.load(Ordering::SeqCst) {
        if done.recv_timeout(Duration::from_millis(50)).is_ok() {
            return;
        }
    }
    if let Ok(dir) = app.path().app_data_dir() {
        crate::diag::write(&dir, "quit merge: still going at its deadline; the rest is tried at the next quit");
    }
}

#[cfg(test)]
#[path = "quit_merge_tests.rs"]
mod tests;
