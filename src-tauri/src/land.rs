//! Txais (2026-11-23): "whenever you finish a task, you should be merging it into the main folder."
//! A workspace is sent to main ("landed") when its task is finished, one at a time, instead of every
//! workspace at once when Kolux quits.
//!
//! Two things land a workspace: its agent, through the hook listener (`from_pane`), once its task is
//! done, and the user, through "Send to main" (`workspace_land`). Nothing else does: not the end of a
//! turn, not a pane that exits, not a quiet spell, so half-done work never reaches main.
//!
//! - An agent's land refuses while the workspace holds any change (untracked files too) and names up
//!   to five of them: the agent commits, then lands again. The user's land saves them first, with the
//!   same refusals as the old quit save (a separate Git project, a password-like or very large file).
//! - The merge is the quit's own (`quit_merge::merge_branch`): a fast-forward when it can be, else a
//!   merge commit Git predicts will not clash, with hooks and signing skipped, a crash marker, and an
//!   undo when it fails. A predicted clash touches nothing: the workspace is "clashed" with the files
//!   named, and the agent is told to merge main into it, fix, commit and land again.
//! - A main folder with uncommitted changes to tracked files refuses every land.
//! - The workspace keeps its folder and its branch, and is brought up to the new main.
//! - Every other workspace Kolux made in the project then takes in the new main (`propagate`), only
//!   when that is safe: never one that is locked, off a branch, mid-merge, holding any change, or whose
//!   agent is working, and never one Git predicts would clash. Those are marked "behind" and tried
//!   again at their pane's next finished turn and at the next land. Nothing is rebased, stashed or reset.
//! - Folder projects, main folders and worktrees Kolux did not make are refused with a plain reason.
//!
//! What each workspace's last land or take-in left is kept in the store (`STATES_KEY`), for the chips.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::git::{Git, Worktree};
use crate::projects::{self, Project};
use crate::quit_merge::{self, Clock, MergeEnv};
use crate::state::Store;

/// The second paragraph of every commit a land makes.
pub const LAND_BODY: &str = "Made by Kolux when the task in this workspace was finished. Git hooks and commit signing are skipped for this automatic commit.";
/// The commit that saves the user's uncommitted work before it is sent.
pub const SAVED_MESSAGE: &str = "Kolux: saved before sending to main";
/// The merge commit a workspace that takes in the new main gets.
pub const TAKE_IN_MESSAGE: &str = "Kolux: take in main";
const TAKE_IN_BODY: &str = "Made by Kolux when another workspace's finished work reached main. Git hooks and commit signing are skipped for this automatic commit.";
/// The store key: workspace (by `projects::name_key`) to its last `LandRecord`.
pub const STATES_KEY: &str = "workspaceLandStates";
/// The event the window hears after every land, with the `LandOutcome`.
pub const EVENT: &str = "workspace-land";

/// How long one land may take in all (the clock every git step is cut by).
const WINDOW: Duration = Duration::from_secs(120);
/// How long a land waits for another one (or a create or rename) in the same project.
const TURN_WAIT: Duration = Duration::from_secs(30);
/// How many uncommitted or clashing files a refusal names.
const NAMED: usize = 5;

const BUSY_PROJECT: &str = "Kolux is busy with this project";
const FOLDER_PROJECT: &str = "this project is a plain folder without Git, so there is no main to send it to";
const NO_GIT: &str = "this folder is not in a Git project, so there is no main to send it to";
const MAIN_FOLDER: &str = "this is the project's main folder: only a workspace can be sent to main";
const NOT_OURS: &str = "Kolux did not make this workspace, so it does not send it to main";
const NOT_LISTED: &str = "Git does not list this folder as a workspace of its project";
const CLOSING: &str = "Kolux is closing";
const WORKING: &str = "its agent is working";
const HAS_CHANGES: &str = "it has changes that are not committed";

/// Who asked for the land.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// The agent in the pane with this hook key said its task is finished.
    Agent { pane_key: u32 },
    /// The user chose "Send to main".
    User,
}

impl Trigger {
    fn who(&self) -> String {
        match self {
            Trigger::Agent { pane_key } => format!("the agent in pane {pane_key}"),
            Trigger::User => "the user".to_string(),
        }
    }
}

/// What a land did with the workspace it was asked about.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LandState {
    /// Its work is in main now.
    Landed,
    /// Main already had all of it.
    NothingNew,
    /// Auto-land is off: an agent's finished work is marked ready for the user to send.
    Ready,
    /// Not sent, for the reason in `message`; nothing was changed.
    Refused,
    /// Its work clashes with main in `files`; nothing was changed.
    Clashed,
}

/// What taking in the new main did with one workspace.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SiblingState {
    /// It took in the new main (a fast-forward or a merge commit).
    Updated,
    /// It already had all of main.
    Current,
    /// It lacks some of main and was left as it was, for the reason in `why`.
    Behind,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sibling {
    pub path: String,
    pub state: SiblingState,
    pub why: Option<String>,
}

/// The answer to a land, for the window (the `EVENT` payload and `workspace_land`'s result) and,
/// as text, for the agent.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandOutcome {
    pub path: String,
    pub branch: Option<String>,
    pub state: LandState,
    /// One or two plain sentences.
    pub message: String,
    /// Refused for uncommitted work: up to five of the changed files. Clashed: up to five clashing files.
    pub files: Vec<String>,
    /// Every other workspace Kolux made in the project, after taking in the new main (and the landed
    /// one itself, brought up to main). Empty when nothing reached main.
    pub siblings: Vec<Sibling>,
}

impl LandOutcome {
    fn new(path: &str, branch: Option<String>, state: LandState, message: String) -> Self {
        Self { path: path.to_string(), branch, state, message, files: Vec::new(), siblings: Vec::new() }
    }
    fn refused(path: &str, branch: Option<String>, why: &str) -> Self {
        Self::new(path, branch, LandState::Refused, format!("Not sent to main: {why}."))
    }
}

/// What the store keeps per workspace: the last state ("landed", "nothingNew", "ready", "clashed",
/// "updated", "current" or "behind"), why, and when (seconds since 1970).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandRecord {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    pub at: u64,
}

/// What `workspace_land_preview` says before the user confirms.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandPreview {
    /// How many files hold uncommitted changes (untracked included): the land saves them first.
    pub uncommitted: usize,
    /// How many commits the workspace has that main lacks.
    pub ahead: u64,
    /// Whether a land would send something to main now.
    pub landable: bool,
    /// Why not, when it would not.
    pub why: Option<String>,
}

/// What a land needs from the app, so tests can give it their own.
pub struct Deps<'a> {
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    /// The app's data folder (the merge marker, the empty hooks folder, the log).
    pub data_dir: &'a Path,
    /// Whether an agent is working in the workspace at this folder.
    pub busy: &'a dyn Fn(&Path) -> bool,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn state_name(state: LandState) -> &'static str {
    match state {
        LandState::Landed => "landed",
        LandState::NothingNew => "nothingNew",
        LandState::Ready => "ready",
        LandState::Refused => "refused",
        LandState::Clashed => "clashed",
    }
}

fn sibling_name(state: SiblingState) -> &'static str {
    match state {
        SiblingState::Updated => "updated",
        SiblingState::Current => "current",
        SiblingState::Behind => "behind",
    }
}

/// Every workspace's last record.
pub(crate) fn states(store: &Store) -> BTreeMap<String, LandRecord> {
    store.get(STATES_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Writes one workspace's record, unless `keep` says the one there says more.
fn record(store: &Mutex<Store>, path: &str, state: &str, why: Option<String>, keep: impl Fn(&LandRecord) -> bool) {
    let Ok(store) = store.lock() else { return };
    let mut all = states(&store);
    let key = projects::name_key(path);
    if all.get(&key).is_some_and(keep) {
        return;
    }
    all.insert(key, LandRecord { state: state.to_string(), why, at: now_secs() });
    if let Ok(text) = serde_json::to_string(&all) {
        let _ = store.set(STATES_KEY, &text);
    }
}

/// A take-in result does not hide what a land said about the same workspace (its "finished" or
/// "not in main" chip), unless it is "behind", which needs the user's eye; a clash stays shown over it.
fn record_sibling(store: &Mutex<Store>, s: &Sibling) {
    let state = s.state;
    record(store, &s.path, sibling_name(state), s.why.clone(), |old| match state {
        SiblingState::Behind => old.state == "clashed",
        _ => matches!(old.state.as_str(), "landed" | "nothingNew" | "ready" | "clashed"),
    });
}

/// Takes the project's turn (creations, renames and other lands hold it), polling up to `wait`.
fn take_turn(turn: &Mutex<()>, wait: Duration) -> Option<MutexGuard<'_, ()>> {
    let until = Instant::now() + wait;
    loop {
        match turn.try_lock() {
            Ok(g) => return Some(g),
            Err(TryLockError::Poisoned(p)) => return Some(p.into_inner()),
            Err(TryLockError::WouldBlock) if Instant::now() >= until => return None,
            Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// The workspace's top folder and its project's main folder, or why it cannot be landed.
fn locate(deps: &Deps, folder: &Path) -> Result<(PathBuf, PathBuf), String> {
    if let Ok(store) = deps.store.lock() {
        let plain = projects::load_projects(&store).into_iter().any(|p| crate::folder_projects::is_folder(&store, &p.id) && projects::same_folder(Path::new(&p.path), folder));
        if plain {
            return Err(FOLDER_PROJECT.into());
        }
    }
    let top = deps.git.toplevel(folder).map_err(|_| NO_GIT.to_string())?;
    let repo = quit_merge::repo_of(&top).ok_or(MAIN_FOLDER)?;
    Ok((top, repo))
}

/// The project a repository's main folder belongs to (its saved base names main), else a stand-in.
fn project_of(deps: &Deps, repo: &Path) -> Project {
    let at = repo.display().to_string();
    let known = match deps.store.lock() {
        Ok(store) => projects::project_known(&store, &at),
        Err(_) => Err(Vec::new()),
    };
    let found = match known {
        Ok(p) => Some(p),
        Err(list) => projects::project_by_git(deps.git, list, &at),
    };
    found.unwrap_or_else(|| {
        let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Project { id: String::new(), name, path: at, workspaces_dir: None, base: None, display_name: None }
    })
}

/// One workspace, checked: Kolux made it, it is on a branch, nothing is half done in it, and the
/// project's main branch is known.
struct Checked {
    all: Vec<Worktree>,
    w: Worktree,
    branch: String,
    target: String,
}

fn check(deps: &Deps, top: &Path, repo: &Path, clock: &Clock) -> Result<Checked, (Option<String>, String)> {
    let all = deps.git.worktrees(repo).map_err(|e| (None, format!("Kolux could not list the project's workspaces ({})", quit_merge::short(&e))))?;
    let w = all.iter().find(|w| projects::same_folder(Path::new(&w.path), top)).cloned().ok_or((None, NOT_LISTED.to_string()))?;
    if w.is_main {
        return Err((None, MAIN_FOLDER.into()));
    }
    let ours = deps.store.lock().map(|s| projects::load_origins(&s).contains_key(&projects::name_key(&w.path))).unwrap_or(false);
    if !ours {
        return Err((w.branch.clone(), NOT_OURS.into()));
    }
    if w.locked.is_some() {
        return Err((w.branch.clone(), quit_merge::LOCKED.into()));
    }
    quit_merge::unfinished(Path::new(&w.path), clock).map_err(|why| (w.branch.clone(), why))?;
    let branch = w.branch.clone().ok_or((None, quit_merge::DETACHED.to_string()))?;
    let target = quit_merge::target_branch(repo, &project_of(deps, repo), clock).ok_or((Some(branch.clone()), quit_merge::NO_MAIN.to_string()))?;
    if branch == target {
        return Err((Some(branch), format!("it is on {target} itself")));
    }
    Ok(Checked { all, w, branch, target })
}

/// Every changed file in the workspace (untracked ones one by one, ignored ones left out).
fn changed_files(here: &Path, clock: &Clock) -> Result<Vec<String>, String> {
    let raw = crate::git::bytes_within(&["status", "--porcelain", "-z", "--untracked-files=all"], Some(here), Duration::from_secs(30).min(WINDOW))
        .map_err(|e| format!("Kolux could not read its changes ({})", quit_merge::short(&e)))?;
    let _ = clock;
    let text = String::from_utf8_lossy(&raw);
    let mut out = Vec::new();
    let mut entries = text.split('\0').filter(|e| !e.is_empty());
    while let Some(e) = entries.next() {
        let (xy, path) = (e.get(..2).unwrap_or(""), e.get(3..).unwrap_or(""));
        if xy.starts_with('R') || xy.starts_with('C') {
            entries.next(); // the name it had before
        }
        out.push(path.to_string());
    }
    Ok(out)
}

/// The first `NAMED` files, and how many more there are, as one phrase.
fn named(files: &[String]) -> String {
    let shown = files.iter().take(NAMED).cloned().collect::<Vec<_>>().join(", ");
    match files.len().saturating_sub(NAMED) {
        0 => shown,
        more => format!("{shown} and {more} more"),
    }
}

/// The files a merge of `theirs` into `ours` would clash in, when Git predicts a clash; None when it
/// predicts none or cannot say (the merge itself then finds out, and is undone).
fn clash_files(git: &Git, repo: &Path, ours: &str, theirs: &str) -> Option<Vec<String>> {
    if !git.predicts_merges() {
        return None;
    }
    let out = crate::git::read_exit(&["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], Some(repo)).ok()?;
    if out.status.code() != Some(1) {
        return None;
    }
    let mut files: Vec<String> = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines().skip(1).map(str::trim).filter(|l| !l.is_empty()) {
        if !files.iter().any(|f| f == line) {
            files.push(line.to_string());
        }
    }
    Some(files)
}

/// Lands the workspace at `folder`, as the module says, and records what came of it.
pub fn land(deps: &Deps, folder: &Path, trigger: Trigger) -> LandOutcome {
    let out = land_inner(deps, folder, trigger);
    if out.state != LandState::Refused {
        let why = matches!(out.state, LandState::Clashed | LandState::Ready).then(|| out.message.clone());
        record(deps.store, &out.path, state_name(out.state), why, |_| false);
    }
    crate::diag::write(deps.data_dir, &format!("land: {} asked to send {} to main: {} ({})", trigger.who(), out.path, state_name(out.state), out.message));
    out
}

fn land_inner(deps: &Deps, folder: &Path, trigger: Trigger) -> LandOutcome {
    let shown = folder.display().to_string();
    let agent = matches!(trigger, Trigger::Agent { .. });
    let (top, repo) = match locate(deps, folder) {
        Ok(found) => found,
        Err(why) => return LandOutcome::refused(&shown, None, &why),
    };
    let turn = projects::repo_turn(&repo);
    let Some(_turn) = take_turn(&turn, TURN_WAIT) else { return LandOutcome::refused(&shown, None, BUSY_PROJECT) };
    let clock = Clock::until(Instant::now() + WINDOW);
    let Checked { all, w, branch, target } = match check(deps, &top, &repo, &clock) {
        Ok(c) => c,
        Err((branch, why)) => return LandOutcome::refused(&shown, branch, &why),
    };
    let (path, here) = (w.path.clone(), PathBuf::from(&w.path));
    let refused = |why: &str| LandOutcome::refused(&path, Some(branch.clone()), why);
    let changed = match changed_files(&here, &clock) {
        Ok(c) => c,
        Err(why) => return refused(&why),
    };
    if agent && !changed.is_empty() {
        let mut out = LandOutcome::new(&path, Some(branch.clone()), LandState::Refused, format!("Not sent to main: {HAS_CHANGES} ({}). Commit them, then land again.", named(&changed)));
        out.files = changed.into_iter().take(NAMED).collect();
        return out;
    }
    let ahead = match quit_merge::ahead(&repo, &target, &branch, &clock) {
        Ok(n) => n,
        Err(why) => return refused(&why),
    };
    if changed.is_empty() && ahead == 0 {
        let mut out = LandOutcome::new(&path, Some(branch.clone()), LandState::NothingNew, format!("{target} already has everything in {branch}."));
        out.siblings = propagate(deps, &repo, &target, Some(&here), &clock);
        return out;
    }
    let auto = deps.store.lock().map(|s| quit_merge::auto_land_wanted(&s.settings())).unwrap_or(true);
    if agent && !auto {
        return LandOutcome::new(&path, Some(branch.clone()), LandState::Ready, "Sending finished work to main by itself is turned off, so Kolux marked this workspace ready. The user sends it with Send to main.".to_string());
    }
    // Main is looked at before anything is saved, so a main that cannot take the work costs no save commit.
    let main_dir = match quit_merge::main_ready(all.iter().find(|w| w.is_main), Some(&target), &clock) {
        Ok(d) => d,
        Err(why) => return refused(&why),
    };
    let hooks = match quit_merge::no_hooks(deps.data_dir) {
        Ok(h) => h,
        Err(why) => return refused(&why),
    };
    if !changed.is_empty() {
        if let Err(why) = quit_merge::save_with(&clock, &hooks, &here, SAVED_MESSAGE, LAND_BODY) {
            return refused(&why);
        }
    }
    let theirs = format!("refs/heads/{branch}");
    let behind = quit_merge::ahead(&repo, &branch, &target, &clock).unwrap_or(1);
    if behind > 0 {
        if let Some(files) = clash_files(deps.git, &repo, &format!("refs/heads/{target}"), &theirs) {
            let mut out = LandOutcome::new(&path, Some(branch.clone()), LandState::Clashed, format!("Not sent to main: its work clashes with {target} in {}. Run git merge {target} in this workspace, fix the clashes, commit, then land again.", named(&files)));
            out.files = files.into_iter().take(NAMED).collect();
            return out;
        }
    }
    let subject = format!("Kolux: send {branch} to main");
    let env = MergeEnv { git: deps.git, clock, data_dir: deps.data_dir, hooks: &hooks, subject: &subject, body: LAND_BODY };
    if let Err(why) = quit_merge::merge_branch(&env, &repo, &main_dir, &target, &branch) {
        let state = if why.contains("clash") { LandState::Clashed } else { LandState::Refused };
        return LandOutcome::new(&path, Some(branch.clone()), state, format!("Not sent to main: {why}."));
    }
    let siblings = propagate(deps, &repo, &target, Some(&here), &clock);
    let others: Vec<&Sibling> = siblings.iter().filter(|s| !projects::same_folder(Path::new(&s.path), &here)).collect();
    let behind_n = others.iter().filter(|s| s.state == SiblingState::Behind).count();
    let mut message = format!("Sent {branch} to {target}.");
    if behind_n > 0 {
        message.push_str(&format!(" {behind_n} other workspace{} could not take in the new {target} yet.", if behind_n == 1 { "" } else { "s" }));
    }
    let mut out = LandOutcome::new(&path, Some(branch), LandState::Landed, message);
    out.siblings = siblings;
    out
}

/// Every workspace Kolux made in the project takes in `target`, where that is safe. `landed` (the
/// workspace that just landed) is brought up even while its agent works: it asked for the land.
/// The caller holds the project's turn.
fn propagate(deps: &Deps, repo: &Path, target: &str, landed: Option<&Path>, clock: &Clock) -> Vec<Sibling> {
    let Ok(all) = deps.git.worktrees(repo) else { return Vec::new() };
    let Ok(hooks) = quit_merge::no_hooks(deps.data_dir) else { return Vec::new() };
    let (origins, listed) = match deps.store.lock() {
        Ok(s) => (projects::load_origins(&s), projects::load_projects(&s)),
        Err(_) => return Vec::new(),
    };
    // A worktree the user opened as a project of its own is theirs, not a workspace.
    let theirs = |w: &Worktree| listed.iter().any(|p| projects::same_folder(Path::new(&p.path), Path::new(&w.path)));
    projects::kolux_made(&origins, all)
        .into_iter()
        .filter(|w| !w.is_main && Path::new(&w.path).is_dir() && !theirs(w))
        .map(|w| {
            let is_landed = landed.is_some_and(|l| projects::same_folder(l, Path::new(&w.path)));
            let s = take_in_main(deps, &w, target, is_landed, clock, &hooks);
            if !is_landed {
                record_sibling(deps.store, &s);
            }
            s
        })
        .collect()
}

fn count(here: &Path, range: &str, clock: &Clock) -> Result<u64, String> {
    quit_merge::read(&["rev-list", "--count", range], here, clock).and_then(|n| n.trim().parse::<u64>().map_err(|e| e.to_string()))
}

/// One workspace takes in `target`: a fast-forward when it has nothing of its own, else a merge
/// commit Git predicts will not clash. Anything else leaves it exactly as it was, "behind".
fn take_in_main(deps: &Deps, w: &Worktree, target: &str, landed: bool, clock: &Clock, hooks: &Path) -> Sibling {
    let here = Path::new(&w.path);
    let done = |state: SiblingState, why: Option<String>| Sibling { path: w.path.clone(), state, why };
    let behind = |why: String| done(SiblingState::Behind, Some(why));
    if w.locked.is_some() {
        return behind(quit_merge::LOCKED.into());
    }
    if w.branch.is_none() {
        return behind(quit_merge::DETACHED.into());
    }
    let main_ref = format!("refs/heads/{target}");
    match count(here, &format!("HEAD..{main_ref}"), clock) {
        Ok(0) => return done(SiblingState::Current, None),
        Ok(_) => {}
        Err(e) => return behind(format!("Kolux could not compare it with {target} ({})", quit_merge::short(&e))),
    }
    if let Err(why) = quit_merge::unfinished(here, clock) {
        return behind(why);
    }
    match quit_merge::read(&["status", "--porcelain"], here, clock) {
        Ok(s) if s.trim().is_empty() => {}
        Ok(_) => return behind(HAS_CHANGES.into()),
        Err(e) => return behind(format!("Kolux could not read its changes ({})", quit_merge::short(&e))),
    }
    if !landed && (deps.busy)(here) {
        return behind(WORKING.into());
    }
    let own = match count(here, &format!("{main_ref}..HEAD"), clock) {
        Ok(n) => n,
        Err(e) => return behind(format!("Kolux could not compare it with {target} ({})", quit_merge::short(&e))),
    };
    let _busy = quit_merge::Busy::start();
    if own == 0 {
        return match quit_merge::write(&["merge", "--ff-only", "-q", &main_ref], here, clock, hooks) {
            Ok(_) => done(SiblingState::Updated, None),
            Err(e) => behind(format!("it could not be moved up to {target} ({})", quit_merge::short(&e))),
        };
    }
    if deps.git.predicts_merges() && quit_merge::read(&["merge-tree", "--write-tree", "HEAD", &main_ref], here, clock).is_err() {
        return behind(format!("its changes clash with {target}"));
    }
    let Ok(before) = quit_merge::read(&["rev-parse", "HEAD"], here, clock) else { return behind("Kolux could not read it".into()) };
    match quit_merge::write(&["merge", "--no-ff", "--no-edit", "--no-verify", "-q", "-m", TAKE_IN_MESSAGE, "-m", TAKE_IN_BODY, &main_ref], here, clock, hooks) {
        Ok(_) => done(SiblingState::Updated, None),
        Err(e) => {
            if quit_merge::read(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], here, clock).is_ok() {
                let _ = quit_merge::write(&["merge", "--abort"], here, clock, hooks);
            }
            let whole = quit_merge::read(&["rev-parse", "HEAD"], here, clock).is_ok_and(|h| h == before) && quit_merge::read(&["status", "--porcelain"], here, clock).is_ok_and(|s| s.trim().is_empty());
            let note = if whole { "" } else { ". It may not be exactly as it was: look at it before you work there" };
            behind(format!("it could not take in {target} ({}){note}", quit_merge::short(&e)))
        }
    }
}

/// A workspace marked "behind" tries again to take in main (its pane finished a turn). None when it
/// is not behind, its project is busy, or it cannot be found.
#[allow(dead_code)] // the hook listener calls it after a finished turn (auto-land slice B)
pub fn retry_behind(deps: &Deps, folder: &Path) -> Option<Sibling> {
    let top = deps.git.toplevel(folder).ok()?;
    let repo = quit_merge::repo_of(&top)?;
    let turn = projects::repo_turn(&repo);
    let _turn = match turn.try_lock() {
        Ok(g) => g,
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => return None,
    };
    let all = deps.git.worktrees(&repo).ok()?;
    let w = all.into_iter().find(|w| projects::same_folder(Path::new(&w.path), &top))?;
    let was = deps.store.lock().ok().map(|s| states(&s)).and_then(|all| all.get(&projects::name_key(&w.path)).cloned())?;
    if was.state != "behind" {
        return None;
    }
    let clock = Clock::until(Instant::now() + WINDOW);
    let target = quit_merge::target_branch(&repo, &project_of(deps, &repo), &clock)?;
    let hooks = quit_merge::no_hooks(deps.data_dir).ok()?;
    let s = take_in_main(deps, &w, &target, false, &clock, &hooks);
    record_sibling(deps.store, &s);
    Some(s)
}

/// What a land would do now, read only.
pub fn preview(deps: &Deps, folder: &Path) -> LandPreview {
    let no = |why: String| LandPreview { uncommitted: 0, ahead: 0, landable: false, why: Some(why) };
    let (top, repo) = match locate(deps, folder) {
        Ok(found) => found,
        Err(why) => return no(why),
    };
    let clock = Clock::until(Instant::now() + WINDOW);
    let Checked { all, w, branch, target } = match check(deps, &top, &repo, &clock) {
        Ok(c) => c,
        Err((_, why)) => return no(why),
    };
    let here = PathBuf::from(&w.path);
    let uncommitted = changed_files(&here, &clock).map(|c| c.len()).unwrap_or(0);
    let ahead = quit_merge::ahead(&repo, &target, &branch, &clock).unwrap_or(0);
    let mut why = None;
    if uncommitted == 0 && ahead == 0 {
        why = Some(format!("{target} already has everything in it"));
    } else if let Err(e) = quit_merge::main_ready(all.iter().find(|w| w.is_main), Some(&target), &clock) {
        why = Some(e);
    } else if quit_merge::ahead(&repo, &branch, &target, &clock).unwrap_or(1) > 0 {
        if let Some(files) = clash_files(deps.git, &repo, &format!("refs/heads/{target}"), &format!("refs/heads/{branch}")) {
            why = Some(format!("its work clashes with {target} in {}", named(&files)));
        }
    }
    LandPreview { uncommitted, ahead, landable: why.is_none(), why }
}

// ------------------------------------------------------------------ the app's side

/// Whether an agent in a pane started in `folder` (or a folder inside it) is mid-turn.
fn agent_working(terminals: &crate::terminal::Terminals, folder: &Path) -> bool {
    let want = projects::name_key(&folder.to_string_lossy());
    let inside = |d: &str| {
        let k = projects::name_key(d);
        k == want || k.starts_with(&format!("{want}\\"))
    };
    terminals.list().into_iter().any(|(id, _, dir)| dir.as_deref().is_some_and(inside) && crate::status::panes_of(id).into_iter().any(crate::status::working))
}

/// Runs `f` with the app's own `Deps`.
fn with_app<R>(app: &tauri::AppHandle, f: impl FnOnce(&Deps) -> R) -> Result<R, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (git, store, terminals) = (app.state::<Git>(), app.state::<Mutex<Store>>(), app.state::<crate::terminal::Terminals>());
    let busy = |p: &Path| agent_working(&terminals, p);
    Ok(f(&Deps { git: &git, store: &store, data_dir: &dir, busy: &busy }))
}

/// A land from the app: never once the quit has begun (the quit no longer waits for new merges),
/// and the window hears the outcome.
fn land_in_app(app: &tauri::AppHandle, folder: &Path, trigger: Trigger) -> Result<LandOutcome, String> {
    use tauri::Emitter;
    let out = if crate::lifecycle::quit_began().is_some() { LandOutcome::refused(&folder.display().to_string(), None, CLOSING) } else { with_app(app, |d| land(d, folder, trigger))? };
    let _ = app.emit(EVENT, &out);
    Ok(out)
}

/// "Send to main": lands the workspace at `path`, saving its uncommitted work first.
#[tauri::command]
pub async fn workspace_land(app: tauri::AppHandle, path: String) -> Result<LandOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || land_in_app(&app, Path::new(&path), Trigger::User)).await.map_err(|e| e.to_string())?
}

/// What "Send to main" would do, for its confirmation.
#[tauri::command]
pub async fn workspace_land_preview(app: tauri::AppHandle, path: String) -> Result<LandPreview, String> {
    tauri::async_runtime::spawn_blocking(move || with_app(&app, |d| preview(d, Path::new(&path)))).await.map_err(|e| e.to_string())?
}

/// Every workspace's last land or take-in, keyed by `projects::name_key` of its folder.
#[tauri::command]
pub fn workspace_land_states(store: tauri::State<'_, Mutex<Store>>) -> Result<BTreeMap<String, LandRecord>, String> {
    store.lock().map(|s| states(&s)).map_err(|e| e.to_string())
}

/// Whether `folder` is in the same workspace as the pane's own folder `pane_dir`.
fn own_workspace(git: &Git, pane_dir: &Path, folder: &Path) -> bool {
    match (git.toplevel(pane_dir), git.toplevel(folder)) {
        (Ok(a), Ok(b)) => projects::same_folder(&a, &b),
        // A folder that is in no Git project is refused by the land itself, with its own reason.
        (Ok(_), Err(_)) => true,
        (Err(_), _) => false,
    }
}

/// The hook listener's `/land`: the agent in pane `pane_key` (on `terminal`) says the task in the
/// workspace at `body` (a folder) is finished. 200 for landed, nothing new or ready, else 409, with
/// the plain text the agent reads.
#[allow(dead_code)] // the hook listener's /land (auto-land slice B)
pub fn from_pane(app: &tauri::AppHandle, pane_key: u32, terminal: Option<u32>, body: &str) -> (u16, String) {
    use tauri::Manager;
    let folder = PathBuf::from(body.trim());
    let pane_dir = terminal.and_then(|t| app.state::<crate::terminal::Terminals>().list().into_iter().find(|(id, _, _)| *id == t).and_then(|(_, _, d)| d));
    if let Some(dir) = pane_dir {
        if !own_workspace(&app.state::<Git>(), Path::new(&dir), &folder) {
            return (409, "Not sent to main: a pane can only send its own workspace.".to_string());
        }
    }
    match land_in_app(app, &folder, Trigger::Agent { pane_key }) {
        Ok(out) => (if matches!(out.state, LandState::Landed | LandState::NothingNew | LandState::Ready) { 200 } else { 409 }, reply(&out)),
        Err(e) => (409, format!("Not sent to main: {e}.")),
    }
}

/// The text an agent reads: the message, then each workspace that could not take in main.
fn reply(out: &LandOutcome) -> String {
    let mut text = out.message.clone();
    for s in out.siblings.iter().filter(|s| s.state == SiblingState::Behind) {
        let name = Path::new(&s.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| s.path.clone());
        text.push_str(&format!("\n{name} did not take in main: {}.", s.why.as_deref().unwrap_or("no reason given")));
    }
    text
}

#[cfg(test)]
#[path = "land_tests.rs"]
mod tests;
