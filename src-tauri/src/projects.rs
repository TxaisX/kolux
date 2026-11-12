//! Projects and workspaces (PROJ-001, PROJ-007, PROJ-020, PROJ-021, PROJ-025, PROJ-028). A
//! project is a Git repository the user chose; a workspace is one of its worktrees. Projects are
//! saved in the state store; the workspaces folder and layout are user settings, and a project
//! may carry its own folder and base ref. The command line (PROJ-077) creates and removes
//! workspaces through the same functions. GIT-067: creations in one repository run one at a time,
//! a new worktree brings the include file's copies and kolux.yaml's shared folders along
//! (`include.rs`), and removal refuses uncommitted work unless forced.

use crate::creatures::creature_name;
use crate::git::{Git, Worktree};
use crate::names::safe_name;
use crate::state::Store;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use tauri::State;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    /// This project's own workspaces folder (PROJ-025); relative means from the project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspaces_dir: Option<String>,
    /// The ref new workspaces start from (PROJ-028); none means the default branch Git reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// SET-033: the name the sidebar shows instead of the folder's name; none shows the folder's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// A workspace just made (PROJ-028): the worktree, the ref it started from, and a note when
/// that ref was not the one saved for the project.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    #[serde(flatten)]
    pub worktree: Worktree,
    pub base: String,
    pub note: Option<String>,
    /// GIT-067: include-file and shared-folder entries that could not be brought along.
    pub warnings: Vec<String>,
    /// T-780 (review round 3, 2026-11-09): true only when `head_is_on_origin` proved, right after
    /// the checkout and before any record was written, that the new worktree's HEAD is on a branch
    /// of the `origin` remote. False means "not proven" (a fork's commit, a local-only commit, no
    /// origin, a git error, a timeout), and `record_made` then writes the sticky pull-request
    /// marker so `trust::made_by_kolux` never pre-trusts it. Never sent to the window.
    #[serde(skip)]
    pub own: bool,
}

/// GIT-067: creations in one repository take turns; a failed one hands the turn on at once.
pub(crate) fn repo_turn(repo: &Path) -> Arc<Mutex<()>> {
    static TURNS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let key = repo.to_string_lossy().to_lowercase();
    TURNS.get_or_init(Default::default).lock().unwrap_or_else(PoisonError::into_inner).entry(key).or_default().clone()
}

/// T-613: deciding whether a removed workspace's branch goes takes turns per repository, apart from
/// creations, so of two branches holding the same unpushed commits the second sees the first gone.
fn branch_turn(repo: &Path) -> Arc<Mutex<()>> {
    static TURNS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let key = repo.to_string_lossy().to_lowercase();
    TURNS.get_or_init(Default::default).lock().unwrap_or_else(PoisonError::into_inner).entry(key).or_default().clone()
}

/// Where a project's workspaces go and how they are laid out (PROJ-025).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub root: PathBuf,
    /// Flat: every workspace straight under the root; nested: under a folder named after the project.
    pub flat: bool,
    /// What new branch names start with (PROJ-022), e.g. `txais-xiong/`; empty for none.
    pub prefix: String,
    /// Why the custom prefix is not used, when Git would refuse it.
    pub prefix_warning: Option<String>,
    /// GIT-066: bring a local base branch up to its upstream before the workspace starts from it.
    pub refresh: bool,
}

pub(crate) const PROJECTS_KEY: &str = "projects";
/// Typed workspace names by folder (PROJ-021): the branch and folder carry the cleaned form,
/// the row shows exactly what was typed.
const NAMES_KEY: &str = "workspaceNames";
/// Child workspace path (as `name_key` writes it) to its parent's path (PROJ-047).
const PARENTS_KEY: &str = "workspaceParents";
/// How each workspace came to be (CLI-018): who made it, its parent worktree, the calling folder,
/// an issue number and a comment, keyed like the names. Lineage views (PROJ-047) read it.
const ORIGINS_KEY: &str = "workspaceOrigins";
/// Per project id, the worktrees (as `name_key` writes them) already shown to the user (PROJ-041).
const SEEN_KEY: &str = "worktreesSeen";
/// Worktrees the user hid from the sidebar (PROJ-042), keyed like the names.
const HIDDEN_KEY: &str = "worktreesHidden";
/// PROJ-068: each linked worktree's own Git folder (`.git/worktrees/<id>`, as `name_key` writes it)
/// to the folder it was last seen in; the Git folder stays put when the worktree is moved or renamed.
const ADMIN_KEY: &str = "workspaceGitDirs";
pub(crate) const WORKSPACES_DIR_SETTING: &str = "workspacesDir";
/// "nested" (the default) or "flat" (PROJ-025).
const LAYOUT_SETTING: &str = "workspacesLayout";
/// Workspaces folders used before, newest first, so they can be picked again (PROJ-025).
const USED_DIRS_SETTING: &str = "workspacesDirsUsed";
/// PROJ-022: "user" (the Git user name, the default), "custom" or "none".
pub const PREFIX_SETTING: &str = "branchPrefix";
pub const PREFIX_CUSTOM_SETTING: &str = "branchPrefixCustom";
/// GIT-066: refresh the local base before a new workspace (off by default).
pub const REFRESH_BASE_SETTING: &str = "refreshBaseFirst";
/// GIT-066: a user name longer than this (once cleaned) makes no branch prefix.
pub const MAX_USER_PREFIX: usize = 40;

/// Compares two folders the way Windows does: same canonical path, letter case ignored.
pub(crate) fn same_folder(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase();
    norm(a) == norm(b)
}

/// For display and lookup only: an unreadable list shows empty (after being kept aside).
pub fn load_projects(store: &Store) -> Vec<Project> {
    crate::orchestration::kept::or_default(store, PROJECTS_KEY)
}

/// The list a save starts from (row 895): a store or copy that fails is an error, never an empty list.
pub(crate) fn load_projects_for_write(store: &Store) -> Result<Vec<Project>, String> {
    crate::orchestration::kept::load(store, PROJECTS_KEY)
}

pub(crate) fn save_projects(store: &Store, projects: &[Project]) -> Result<(), String> {
    store.set(PROJECTS_KEY, &serde_json::to_string(projects).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// PROJ-015: takes projects out of Kolux's list; their folders on disk are not touched. The rest
/// of removing a project (PROJ-008) is `folder_projects::project_remove`.
pub(crate) fn forget_projects(store: &Store, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut projects = load_projects_for_write(store)?;
    let gone: Vec<String> = projects.iter().filter(|p| ids.contains(&p.id)).map(|p| p.path.clone()).collect();
    projects.retain(|p| !ids.contains(&p.id));
    // Row 890: every read comes first and every write lands in one transaction, so a failure
    // anywhere leaves the project listed with its icon, folder flag and setup state untouched.
    let mut writes = vec![(PROJECTS_KEY.to_string(), serde_json::to_string(&projects).map_err(|e| e.to_string())?)];
    // PROJ-019: a forgotten project's icon choice goes with it.
    let mut icons = project_icons(store);
    let before = icons.len();
    icons.retain(|id, _| !ids.contains(id));
    if icons.len() != before {
        writes.push((ICONS_KEY.to_string(), serde_json::to_string(&icons).map_err(|e| e.to_string())?));
    }
    // PROJ-005: a folder project's flag goes with it.
    writes.extend(crate::folder_projects::unflag_write(store, ids)?);
    // PROJ-035: and so do its dismissed setup card and its saved local setup.
    writes.extend(crate::setup::prune_setup_writes(store, ids, &gone)?);
    let pairs: Vec<(&str, &str)> = writes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    store.set_all(&pairs).map_err(|e| e.to_string())
}

/// PROJ-008: drops the retired suggested names kept for one workspaces folder.
pub(crate) fn clear_retired_scope(store: &Store, scope: &str) -> Result<(), String> {
    let mut all = retired_all(store);
    let before = all.len();
    all.retain(|r| r.scope != scope);
    if all.len() == before {
        return Ok(());
    }
    store.set(RETIRED_KEY, &serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn load_names(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(NAMES_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub(crate) fn name_key(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// Remembers (or with `None`, forgets) the typed name of the workspace at `path`.
pub fn set_name(store: &Store, path: &str, name: Option<&str>) -> Result<(), String> {
    let mut names = load_names(store);
    match name {
        Some(n) => names.insert(name_key(path), serde_json::Value::String(n.to_string())),
        None => names.remove(&name_key(path)),
    };
    store.set(NAMES_KEY, &serde_json::Value::Object(names).to_string()).map_err(|e| e.to_string())
}

/// Remembers (or with `None`, forgets) which workspace `path` was made from (PROJ-047).
pub fn set_parent(store: &Store, path: &str, parent: Option<&str>) -> Result<(), String> {
    let mut parents: serde_json::Map<String, serde_json::Value> = store.get(PARENTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    match parent {
        Some(p) => parents.insert(name_key(path), serde_json::Value::String(p.to_string())),
        None => parents.remove(&name_key(path)),
    };
    store.set(PARENTS_KEY, &serde_json::Value::Object(parents).to_string()).map_err(|e| e.to_string())
}

/// Drops what Kolux remembers about a removed workspace, so a later one in the same folder starts
/// clean: its typed name, its parent and its origin.
pub fn forget_workspace(store: &Store, path: &str) -> Result<(), String> {
    retire_workspace_names(store, path)?;
    // PROJ-068: Git can give a later worktree the same Git folder; it must not inherit this one's records.
    let mut admins = load_map(store, ADMIN_KEY);
    let before = admins.len();
    admins.retain(|_, v| v.as_str() != Some(name_key(path).as_str()));
    if admins.len() != before {
        store.set(ADMIN_KEY, &serde_json::Value::Object(admins).to_string()).map_err(|e| e.to_string())?;
    }
    set_name(store, path, None)?;
    set_parent(store, path, None)?;
    // EDIT-040: a later workspace in the same folder starts with an empty note.
    store.set(&format!("{NOTE_PREFIX}{}", name_key(path)), "").map_err(|e| e.to_string())?;
    // After-list row 59: every way a workspace goes drops its board status too.
    crate::bulk::clear_status(store, path)?;
    set_origin(store, path, None)
}

/// PROJ-024: the folder the workspace at `path` lived in is the scope; a suggested name, folder or
/// typed, is not offered again there. Used by every way a workspace goes: removed by the user
/// (`forget_workspace`) and found gone from disk (`forget_gone`).
pub fn retire_workspace_names(store: &Store, path: &str) -> Result<(), String> {
    let folder = Path::new(path);
    let scope = name_key(&folder.parent().unwrap_or(folder).to_string_lossy());
    let typed = load_names(store).get(&name_key(path)).and_then(|v| v.as_str().map(String::from));
    for name in folder.file_name().map(|n| n.to_string_lossy().to_string()).into_iter().chain(typed) {
        retire_name(store, &scope, &name)?;
    }
    Ok(())
}

/// EDIT-040: the handoff note of one workspace, stored under its own key (one write each, so a
/// save is all or nothing) as its text and when it last changed.
pub const NOTE_PREFIX: &str = "workspaceNote:";
pub const NOTE_MAX: usize = 256 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Note {
    pub text: String,
    /// Milliseconds since 1970; None before the first save.
    pub updated: Option<u64>,
}

/// The workspace's note; none yet, or a damaged one, reads as empty.
pub fn workspace_note(store: &Store, path: &str) -> Note {
    store.get(&format!("{NOTE_PREFIX}{}", name_key(path))).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Saves the note and returns when; one over 256 KB is refused and the saved one kept.
pub fn save_workspace_note(store: &Store, path: &str, text: &str) -> Result<u64, String> {
    if text.len() > NOTE_MAX {
        return Err(format!("the note is {} KB; a note holds at most 256 KB", text.len().div_ceil(1024)));
    }
    let updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let note = serde_json::to_string(&Note { text: text.to_string(), updated: Some(updated) }).map_err(|e| e.to_string())?;
    store.set(&format!("{NOTE_PREFIX}{}", name_key(path)), &note).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn workspace_note_get(store: StoreState<'_>, path: String) -> Result<Note, String> {
    Ok(workspace_note(&*store.lock().map_err(|e| e.to_string())?, &path))
}

#[tauri::command]
pub fn workspace_note_save(store: StoreState<'_>, path: String, text: String) -> Result<u64, String> {
    save_workspace_note(&*store.lock().map_err(|e| e.to_string())?, &path, &text)
}

pub(crate) fn load_origins(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(ORIGINS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// VIEW-038: the issue or pull request number an origin links to: `issue`, or the number at the
/// end of a `pr` address.
pub fn item_number(origin: &serde_json::Value) -> Option<u64> {
    origin["issue"].as_u64().or_else(|| origin["pr"].as_str()?.rsplit('/').next()?.parse().ok())
}

/// T-780 (review, 2026-11-09): the sticky marker `open_pull_request` writes beside `pr`. The details
/// form and the CLI may clear or replace `pr`, but never this key, so a worktree that once held a
/// pull request's branch is never pre-trusted again (`trust::made_by_kolux`).
pub const PR_EVER_KEY: &str = "prEver";

/// Records (or with `None`, forgets) how the workspace at `path` came to be. T-780 (round 3): a
/// record that holds the sticky marker `PR_EVER_KEY` keeps it through every rewrite, so no later
/// writer (the details form, the CLI's `worktree set`, a link to an issue) can bring the pre-trust
/// back; only forgetting the workspace (`None`) drops it.
pub fn set_origin(store: &Store, path: &str, origin: Option<&serde_json::Value>) -> Result<(), String> {
    let mut all = load_origins(store);
    let key = name_key(path);
    match origin {
        Some(o) => {
            let mut o = o.clone();
            // The carry-over honours every marker shape `trust::holds_pull_request` honours: present, not null, not false.
            if o.is_object() && all.get(&key).is_some_and(|was| !was[PR_EVER_KEY].is_null() && was[PR_EVER_KEY] != false) {
                o[PR_EVER_KEY] = true.into();
            }
            all.insert(key, o)
        }
        None => all.remove(&key),
    };
    store.set(ORIGINS_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// T-780 (review round 3, 2026-11-09): positive proof that the worktree at `dir` holds Kolux's
/// own code: its HEAD commit is reachable from at least one branch of the `origin` remote. Run
/// right after the checkout, before its first record, outside the store lock (T-442-b), and again
/// at each launch (`trust::made_by_kolux`). Anything short of that proof (no `origin`, HEAD only on
/// a fork or a local branch, a merge, cherry-pick, revert or rebase under way, a graft file in
/// effect, a git error or a timeout) is false, and the worktree then counts as foreign: the agent
/// asks about trust itself.
/// What it decides (round 5, coordinator decision): only whether Kolux writes a NEW trust mark. A
/// mark already written into an agent's config stays (one trust answer covers the folder, as in
/// Claude's own model); nothing is revoked. Refs that the user's own manual fetches or config put
/// under `refs/remotes/origin/` through origin's branch refspecs are trusted as origin's.
/// Gaps (A, 2026-11-09): a ref another CONFIGURED remote writes there is not (its destinations are
/// left out, and a remote named `origin` in another case, which on NTFS writes into origin's own
/// folder, refuses the proof outright). A one-off `git fetch <url> X:refs/remotes/origin/y` typed by
/// the user is accepted: it names the destination by hand, a deliberate act no config can tell
/// apart from origin's own fetch.
/// Also accepted as the user's own actions (final round, 2026-11-09): refs a remote left behind
/// under `refs/remotes/origin/` after it was removed, or after a case twin of origin was renamed
/// (only the config is read, and its refs stay until pruned), and tracking refs written by a push to
/// `remote.origin.pushurl` or a `pushInsteadOf` address (a push updates origin's tracking refs with
/// what the user pushed, wherever the push went).
/// Accepted cost: a user whose canonical remote is not named `origin` loses the pre-trust.
pub(crate) fn head_is_on_origin(dir: &Path) -> bool {
    // Review round 4 (P2): "under refs/remotes/origin/" is not proof by itself. A fetch refspec such
    // as `+refs/pull/*/head:refs/remotes/origin/pr/*` (a common setting) puts strangers' pull request
    // heads there too. Only a ref that origin's BRANCH refspecs write, and no other refspec does, counts.
    let Some((branches, others)) = origin_fetch_destinations(dir) else { return false };
    // Review round 4 (P3): `--no-replace-objects` reads commits as they are; a replacement ref
    // (`git replace`) could otherwise make origin's tip read as a descendant of a stranger's commit.
    let Ok(sha) = crate::git::run_within(&["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"], Some(dir), crate::git::READ_TIMEOUT) else { return false };
    let sha = sha.trim();
    if sha.len() < 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    if !settled(dir) {
        return false;
    }
    // Round 5 (P3): a symbolic ref (`refs/remotes/origin/HEAD`, which `git remote set-head` can point
    // anywhere) is no proof of its own; its target is listed itself. Round 5 (P2): on a case-folding
    // file system a fetched ref lands in an existing folder of another case (`origin/pr/12` read
    // back as `origin/PR/12`), so the other refspecs' destinations are compared ignoring ASCII case.
    // Gaps (C): a forged `objects/info/commit-graph` can give origin's tip any parent (and any
    // generation) for `--contains`, even under `--no-replace-objects`; the walk reads the commits.
    let Ok(refs) = crate::git::run_within(&["--no-replace-objects", "-c", "core.commitGraph=false", "for-each-ref", "--contains", sha, "--format=%(refname)%00%(symref)"], Some(dir), crate::git::READ_TIMEOUT) else { return false };
    let others: Vec<String> = others.iter().map(|p| p.to_ascii_lowercase()).collect();
    refs.lines()
        .filter_map(|line| line.split_once('\0').filter(|(_, symref)| symref.trim().is_empty()).map(|(r, _)| r.trim()))
        .any(|r| r.starts_with("refs/remotes/") && branches.iter().any(|p| refspec_side_matches(p, r, false)) && !others.iter().any(|p| refspec_side_matches(p, &r.to_ascii_lowercase(), true)))
}

/// Round 5 (P3): whether the checkout at `dir` is only what HEAD says. No merge, cherry-pick, revert
/// or rebase is under way (their working tree already holds the other side's files), and no graft
/// file is in effect (`info/grafts`, or `GIT_GRAFT_FILE`, which `--git-path` honours): grafts rewrite
/// parents even under `--no-replace-objects`. Kolux's git runner takes no extra environment, so the
/// graft file is refused rather than switched off. Unreadable = not settled.
/// Gaps (B, 2026-11-09): `merge --squash` leaves `SQUASH_MSG` and `cherry-pick -n` leaves
/// `AUTO_MERGE` and `MERGE_MSG` with HEAD unmoved, so those count as operations under way too
/// (`MERGE_MSG` as well, so the check does not lean on one marker alone; a commit or reset removes
/// all three). Only HEAD and in-progress operations are judged, never uncommitted content: a
/// `git checkout <rev> -- .` leaves no marker and is not caught. A clean-tree check was rejected,
/// since every ordinary edit before a launch would then lose the pre-trust.
/// Gaps (legacy remotes, 2026-11-09): git still reads a remote from a file in the common git dir's
/// `remotes/` or `branches/` folder when the config does not define it, and a `Pull:` line there can
/// write under `refs/remotes/origin/` without any config entry `origin_fetch_destinations` could
/// see. So either folder holding any entry, or one that cannot be listed, is not settled; an empty
/// or missing folder is fine. Both paths come from the same `rev-parse` (`--git-path` resolves them
/// in the common dir, also from a linked worktree).
/// Final round (P3-1b): no remote hides in a worktree's own config (`worktree_configs_clear`).
fn settled(dir: &Path) -> bool {
    let Ok(paths) = crate::git::run_within(&["--no-replace-objects", "rev-parse", "--git-dir", "--git-path", "info/grafts", "--git-path", "remotes", "--git-path", "branches", "--git-common-dir"], Some(dir), crate::git::READ_TIMEOUT) else { return false };
    let mut lines = paths.lines().map(str::trim);
    let (Some(git_dir), Some(grafts), Some(remotes), Some(branches), Some(common), None) = (lines.next(), lines.next(), lines.next(), lines.next(), lines.next(), lines.next()) else { return false };
    if [git_dir, grafts, remotes, branches, common].iter().any(|p| p.is_empty()) {
        return false;
    }
    if !worktree_configs_clear(dir, &dir.join(common)) {
        return false;
    }
    let git_dir = dir.join(git_dir);
    let in_effect = |p: &Path| p.symlink_metadata().is_ok() || !matches!(p.try_exists(), Ok(false));
    let legacy_remote = |p: &Path| match p.symlink_metadata() {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        _ => match fs::read_dir(p) {
            Ok(mut entries) => entries.next().is_some(),
            Err(_) => true,
        },
    };
    !legacy_remote(&dir.join(remotes)) && !legacy_remote(&dir.join(branches)) && !in_effect(&dir.join(grafts)) && !["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "SQUASH_MSG", "AUTO_MERGE", "MERGE_MSG"].iter().any(|f| in_effect(&git_dir.join(f)))
}

/// T-780 gaps (final round, P3-1b): with `extensions.worktreeConfig` on, each worktree also reads
/// its own `config.worktree`, and a linked worktree never sees the others' (the main checkout's
/// `<common>/config.worktree`, the rest under `<common>/worktrees/*/`). A remote defined there still
/// fetches into the shared refs, out of `origin_fetch_destinations`' sight. So with the extension on,
/// any `remote.*` key in any of those files is not clear; a missing file is fine, and a file or
/// folder that cannot be read, or an extension value git cannot read, is not clear. `--list` (rather
/// than a key pattern) so that "no remote key" and "unreadable" stay apart; `--includes` so a file
/// it includes counts too.
fn worktree_configs_clear(dir: &Path, common: &Path) -> bool {
    let not_found = |e: &std::io::Error| e.kind() == std::io::ErrorKind::NotFound;
    let Ok(on) = crate::git::run_within(&["--no-replace-objects", "config", "--type=bool", "--default=false", "--get", "extensions.worktreeConfig"], Some(dir), crate::git::READ_TIMEOUT) else { return false };
    match on.trim() {
        "false" => return true,
        "true" => {}
        _ => return false,
    }
    let mut files = vec![common.join("config.worktree")];
    match fs::read_dir(common.join("worktrees")) {
        Ok(entries) => {
            for entry in entries {
                let Ok(entry) = entry else { return false };
                files.push(entry.path().join("config.worktree"));
            }
        }
        Err(e) if not_found(&e) => {}
        Err(_) => return false,
    }
    files.iter().all(|file| match file.symlink_metadata() {
        Err(e) => not_found(&e),
        Ok(_) => {
            let path = file.to_string_lossy();
            crate::git::run_within(&["--no-replace-objects", "config", "-z", "--includes", "--file", &path, "--list"], Some(dir), crate::git::READ_TIMEOUT)
                .is_ok_and(|text| !text.split('\0').any(|entry| entry.trim_start().to_ascii_lowercase().starts_with("remote.")))
        }
    })
}

/// Where `origin`'s fetch refspecs put its branches (a source of `refs/heads/*`, `refs/heads/<dir>/*`
/// or one exact `refs/heads/<name>`) and where they put everything else, both as full-ref patterns.
/// None, and so no proof, when the config cannot be read, holds no branch refspec, or holds one this
/// code does not understand (a destination outside `refs/remotes/`, a second `*`, a negative refspec
/// that is not a plain ref pattern). A refspec without a destination fetches to FETCH_HEAD only.
/// Gaps (A, 2026-11-09): every remote's fetch refspecs are read in one go. A remote whose name is
/// `origin` in another ASCII case is None (on NTFS its refs land in origin's own folder), and every
/// other remote's destinations join the second list, lowercased, so a remote fetching into
/// `refs/remotes/origin/` proves nothing either.
fn origin_fetch_destinations(dir: &Path) -> Option<(Vec<String>, Vec<String>)> {
    // `-z`: each entry is `key\nvalue\0`, so no remote name or value can be misread across lines.
    let text = crate::git::run_within(&["--no-replace-objects", "config", "-z", "--get-regexp", r"^remote\..*\.fetch$"], Some(dir), crate::git::READ_TIMEOUT).ok()?;
    let (mut branches, mut others) = (Vec::new(), Vec::new());
    for entry in text.split('\0').filter(|e| !e.trim().is_empty()) {
        // A fetch key without a value is a config git itself refuses to fetch with: no proof.
        let (key, value) = entry.split_once('\n')?;
        let name = key.trim().strip_prefix("remote.")?.strip_suffix(".fetch")?;
        let line = value.trim();
        if name != "origin" {
            if name.eq_ignore_ascii_case("origin") {
                return None;
            }
            others.extend(foreign_destination(line)?);
            continue;
        }
        if line.is_empty() {
            continue;
        }
        if let Some(negative) = line.strip_prefix('^') {
            // A negative refspec only removes sources from a fetch; it writes nothing.
            if negative.starts_with("refs/") && !negative.contains(':') && negative.matches('*').count() <= 1 {
                continue;
            }
            return None;
        }
        let spec = line.strip_prefix('+').unwrap_or(line);
        let Some((src, dst)) = spec.split_once(':') else { continue };
        let (stars_src, stars_dst) = (src.matches('*').count(), dst.matches('*').count());
        if src.is_empty() || dst.is_empty() || stars_src > 1 || stars_dst > 1 || stars_src != stars_dst || !dst.starts_with("refs/remotes/") {
            return None;
        }
        let is_branches = src.strip_prefix("refs/heads/").is_some_and(|rest| !rest.is_empty() && (!rest.contains('*') || rest == "*" || rest.ends_with("/*")));
        if is_branches {
            branches.push(dst.to_string());
        } else if dst.is_ascii() {
            others.push(dst.to_string());
        } else {
            // Final round (P3-3): only ASCII case is folded when these are compared; not read.
            return None;
        }
    }
    if branches.is_empty() {
        return None;
    }
    Some((branches, others))
}

/// Gaps (A): where another remote's fetch refspec `spec` writes, lowercased as a full-ref pattern.
/// `Some(None)` for a refspec that writes no ref (a negative one, or one without a destination);
/// None, and so no proof, for a destination with more than one `*` or one that is not pure ASCII.
/// git completes a destination without `refs/` (`remotes/origin/x` is `refs/remotes/origin/x`), so
/// such a destination is read with `refs/` in front; a wider exclusion is the safe side.
fn foreign_destination(spec: &str) -> Option<Option<String>> {
    if spec.is_empty() || spec.starts_with('^') {
        return Some(None);
    }
    let spec = spec.strip_prefix('+').unwrap_or(spec);
    let Some((_, dst)) = spec.split_once(':') else { return Some(None) };
    let dst = dst.trim().to_ascii_lowercase();
    if dst.is_empty() {
        return Some(None);
    }
    // Final round (P3-3): the comparison folds ASCII case only, so anything else is not read.
    if !dst.is_ascii() || dst.matches('*').count() > 1 {
        return None;
    }
    Some(Some(if dst.starts_with("refs/") { dst } else { format!("refs/{dst}") }))
}

/// Whether one side of a fetch refspec (an exact ref, or a pattern with one `*`) covers `refname`.
/// `star_may_be_empty` widens a pattern so a doubtful ref is excluded rather than counted.
fn refspec_side_matches(pattern: &str, refname: &str, star_may_be_empty: bool) -> bool {
    match pattern.split_once('*') {
        None => pattern == refname,
        Some((pre, suf)) => {
            let fits = refname.len() >= pre.len() + suf.len() && refname.starts_with(pre) && refname.ends_with(suf);
            fits && (star_may_be_empty || refname.len() > pre.len() + suf.len())
        }
    }
}

/// T-780 (review round 3): the one place a worktree Kolux just made gets its first record. `origin`
/// is the caller's record (`madeBy` and its details); when the checkout was not proven to be on
/// `origin` (`Created::own`), the sticky marker `PR_EVER_KEY` goes into that same first write, so
/// there is never a record without it for `trust::made_by_kolux` to read. Then the worktree is
/// marked seen (PROJ-041). Every creation path (composer, CLI, agent-first launches, branch open,
/// issue links) comes through here.
pub fn record_made(store: &Store, project: &Project, made: &Created, origin: serde_json::Value) -> Result<(), String> {
    let mut origin = if origin.is_object() { origin } else { serde_json::json!({}) };
    if !made.own {
        origin[PR_EVER_KEY] = true.into();
    }
    set_origin(store, &made.worktree.path, Some(&origin))?;
    note_seen(store, project, &made.worktree.path)
}

fn load_map(store: &Store, key: &str) -> serde_json::Map<String, serde_json::Value> {
    store.get(key).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// PROJ-042: hides the worktree at `path` from the sidebar, or shows it again. The choice is
/// kept either way, so it wins over its source's visibility (`visibility.rs`).
pub fn set_hidden(store: &Store, path: &str, hidden: bool) -> Result<(), String> {
    let mut all = load_map(store, HIDDEN_KEY);
    all.insert(name_key(path), hidden.into());
    store.set(HIDDEN_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

pub(crate) fn seen_of(store: &Store, project: &Project) -> Option<std::collections::HashSet<String>> {
    load_map(store, SEEN_KEY).get(&project.id).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
}

fn save_seen<'a>(store: &Store, project: &Project, keys: impl IntoIterator<Item = &'a String>) -> Result<(), String> {
    let mut all = load_map(store, SEEN_KEY);
    all.insert(project.id.clone(), keys.into_iter().cloned().collect::<Vec<_>>().into());
    store.set(SEEN_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// A worktree Kolux itself just made is never offered as new (PROJ-041). T-780 (round 3): this
/// writes no origin record any more; the record, `madeBy` included, comes from `record_made`,
/// which decides the trust marker first. A path with no record is never pre-trusted (fail-safe).
pub fn note_seen(store: &Store, project: &Project, path: &str) -> Result<(), String> {
    match seen_of(store, project) {
        Some(mut seen) => {
            seen.insert(name_key(path));
            save_seen(store, project, &seen)
        }
        None => Ok(()), // the first scan takes everything there as seen
    }
}

/// PROJ-041: the worktrees that appeared since the user last looked, made with plain Git or another
/// tool (scratch worktrees are already left out by `list_workspaces`). The first scan of a project
/// takes what is there as seen, so adding a project never floods the notice. One list per scan, so a
/// burst of new worktrees is one notice. Worktrees that went away are forgotten, so the same folder
/// made again later counts as new.
/// ponytail: the sidebar polls this every 5 s instead of watching folders (DT-O2); a watcher can feed
/// the same call if 5 s ever feels slow.
#[cfg(test)]
pub fn unseen(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    unseen_of(store, project, git.worktrees(Path::new(&project.path))?)
}

/// `unseen` over a worktree list already scanned, so the scan can run without the store (T-442).
pub fn unseen_of(store: &Store, project: &Project, all: Vec<Worktree>) -> Result<Vec<Worktree>, String> {
    unseen_in(store, project, decorate(store, project, all)?)
}

/// `unseen_of` over a list already decorated, so one scan can give both answers (T-442-c).
fn unseen_in(store: &Store, project: &Project, list: Vec<Worktree>) -> Result<Vec<Worktree>, String> {
    let keys: Vec<String> = list.iter().map(|w| name_key(&w.path)).collect();
    let Some(seen) = seen_of(store, project) else {
        save_seen(store, project, &keys)?;
        return Ok(Vec::new());
    };
    let kept: Vec<&String> = keys.iter().filter(|k| seen.contains(*k)).collect();
    if kept.len() != seen.len() {
        save_seen(store, project, kept)?;
    }
    Ok(list.into_iter().filter(|w| !w.is_main && !seen.contains(&name_key(&w.path))).collect())
}

/// The review is closed: everything listed now counts as seen.
#[cfg(test)]
pub fn mark_all_seen(git: &Git, store: &Store, project: &Project) -> Result<(), String> {
    let keys: Vec<String> = git.worktrees(Path::new(&project.path))?.iter().map(|w| name_key(&w.path)).collect();
    save_seen(store, project, &keys)
}

/// How the workspace at `path` came to be, when Kolux recorded it.
pub fn origin(store: &Store, path: &str) -> Option<serde_json::Value> {
    load_origins(store).remove(&name_key(path))
}

/// The workspaces of a project as the sidebar lists them (PROJ-007): Git's list with the typed
/// names and parents laid over, and kind, source and visibility from `visibility::apply`, which
/// also drops the scratch worktrees other coding tools keep under a dot-folder of the main checkout.
/// PROJ-048: moves `path` under `parent` (`None` brings it to the top level). Both must be
/// workspaces of the project other than its main checkout, and the parent may not be the
/// workspace itself or anything nested under it.
pub fn reparent(git: &Git, store: &Store, project: &Project, path: &str, parent: Option<&str>) -> Result<(), String> {
    reparent_in(store, project, git.worktrees(Path::new(&project.path))?, path, parent)
}

/// `reparent` over worktrees already scanned, so a caller can run Git with the store unlocked
/// (T-442-b) and lock it only for this store work.
pub fn reparent_in(store: &Store, project: &Project, scanned: Vec<Worktree>, path: &str, parent: Option<&str>) -> Result<(), String> {
    let all = decorate(store, project, scanned)?;
    let find = |p: &str| all.iter().find(|w| same_folder(Path::new(&w.path), Path::new(p)));
    let gone = |p: &str| format!("{p} is no longer a workspace of {}", project.name);
    let me = find(path).ok_or_else(|| gone(path))?;
    if me.is_main {
        return Err("the main checkout always sits at the top; it cannot be moved under another workspace".into());
    }
    let Some(parent) = parent else { return set_parent(store, &me.path, None) };
    let to = find(parent).ok_or_else(|| gone(parent))?;
    if to.is_main {
        return Err("a workspace cannot be moved under the main checkout; pick No parent to put it at the top".into());
    }
    if to.path == me.path {
        return Err("a workspace cannot be its own parent".into());
    }
    let mut up = to.parent.clone();
    for _ in 0..all.len() {
        let Some(p) = up else { break };
        if same_folder(Path::new(&p), Path::new(&me.path)) {
            return Err(format!("{} is nested under {}, so making it the parent would make a loop", to.path, me.path));
        }
        up = find(&p).and_then(|w| w.parent.clone());
    }
    set_parent(store, &me.path, Some(&to.path))
}

// ---- CLI-009 / CLI-019: the selector pieces `worktree set` needs (called from the cli.rs patch) ----

/// `folder:<id>` where a parent worktree is expected: the folder project with that id and its
/// folder workspace. A Git project, an unknown id and a folder project that has since got Git
/// are refused with the reason.
pub fn folder_parent(store: &Store, id: &str) -> Result<(Project, Worktree), String> {
    let project = load_projects(store).into_iter().find(|p| p.id == id).ok_or_else(|| format!("no project has the id {id}"))?;
    let folder = crate::folder_projects::folder_only(store, &project).ok_or_else(|| format!("{} is not a folder workspace; folder: takes the id of a project without Git", project.name))?;
    Ok((project, folder))
}

/// CLI-019: the board status id `--workspace-status` names, by id or label in any case. The
/// built-in set is todo, in-progress, in-review and completed (the spec's word for "done").
pub fn resolve_status(store: &Store, wanted: &str) -> Result<String, String> {
    let list = crate::bulk::statuses(store);
    let find = |w: &str| list.iter().find(|s| s.id.eq_ignore_ascii_case(w) || s.label.eq_ignore_ascii_case(w)).map(|s| s.id.clone());
    let w = wanted.trim();
    find(w).or_else(|| w.eq_ignore_ascii_case("completed").then(|| find("done")).flatten()).ok_or_else(|| format!("there is no status {wanted}; the statuses are {}", list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(", ")))
}

/// The WSL distribution a Windows-side path belongs to (`\\wsl.localhost\<distro>\...` or
/// `\\wsl$\<distro>\...`).
pub fn wsl_distro_of(path: &str) -> Option<String> {
    let p = path.replace('/', "\\");
    let rest = p.strip_prefix("\\\\wsl.localhost\\").or_else(|| p.strip_prefix("\\\\wsl$\\"))?;
    rest.split('\\').next().filter(|d| !d.is_empty()).map(str::to_string)
}

/// CLI-009: a path written in a WSL shell, as Windows sees it. A Windows drive mounted into Linux
/// (`/mnt/c/...`) resolves with no distribution at all; any other Linux path belongs to the
/// caller's own distribution, so when two distributions write the same path the caller's wins.
/// Without a distribution a Linux path is left as written and matches nothing.
pub fn wsl_path(path: &str, distro: Option<&str>) -> String {
    let p = path.trim();
    if let Some(rest) = p.strip_prefix("/mnt/") {
        let (drive, tail) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
        if drive.len() == 1 && drive.chars().all(|c| c.is_ascii_alphabetic()) {
            return format!("{}:{}", drive.to_ascii_uppercase(), if tail.is_empty() { "\\".to_string() } else { tail.replace('/', "\\") });
        }
    }
    match distro.filter(|d| !d.is_empty()) {
        Some(d) if p.starts_with('/') && !p.starts_with("//") => format!("\\\\wsl.localhost\\{d}{}", p.replace('/', "\\")),
        _ => p.to_string(),
    }
}

/// PROJ-040: the folder workspace at `path`, when that is one (the folder of a project without Git).
fn folder_workspace_at(store: &Store, path: &str) -> Option<String> {
    load_projects(store).iter().find_map(|p| crate::folder_projects::folder_only(store, p).filter(|f| same_folder(Path::new(&f.path), Path::new(path))).map(|f| f.path))
}

/// PROJ-040: records the composer's parent for a workspace just made. A parent removed in the
/// meantime (or one that cannot hold it) is dropped with a warning; the workspace then sits under
/// `active_folder` when that is a folder workspace, else at the top level. Git scans the
/// worktrees with the store unlocked (T-442-b); only the store work holds the lock.
pub fn nest_under(git: &Git, store: &Mutex<Store>, project: &Project, made: &mut Created, parent: Option<&str>, active_folder: Option<&str>) -> Result<(), String> {
    let Some(parent) = non_blank(parent) else { return Ok(()) };
    let moved = match git.worktrees(Path::new(&project.path)) {
        Ok(all) => reparent_in(&*store.lock().map_err(|e| e.to_string())?, project, all, &made.worktree.path, Some(parent)),
        Err(e) => Err(e),
    };
    match moved {
        Ok(()) => made.worktree.parent = Some(parent.to_string()),
        Err(why) => {
            let home = {
                let store = store.lock().map_err(|e| e.to_string())?;
                let home = non_blank(active_folder).and_then(|f| folder_workspace_at(&store, f));
                if let Some(h) = &home {
                    set_parent(&store, &made.worktree.path, Some(h))?;
                }
                home
            };
            match home {
                Some(h) => {
                    made.warnings.push(format!("not nested under the parent you picked ({why}), so it sits under the active folder workspace"));
                    made.worktree.parent = Some(h);
                }
                None => made.warnings.push(format!("not nested under the parent you picked ({why}), so it sits at the top level")),
            }
        }
    }
    Ok(())
}

// T-442-b: this and the other Git-running commands here run off the window thread (a plain
// command blocks every other call, typing in a pane included) and unlock the store for Git.
#[tauri::command(async)]
pub fn workspace_set_parent(git: State<'_, Git>, store: StoreState<'_>, project_id: String, path: String, parent: Option<String>) -> Result<(), String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    let all = git.worktrees(Path::new(&project.path))?;
    reparent_in(&*store.lock().map_err(|e| e.to_string())?, &project, all, &path, non_blank(parent.as_deref()))
}

pub fn list_workspaces(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    let repo = Path::new(&project.path);
    let mut all = git.worktrees(repo)?;
    if repair_moved(git, repo, &all) {
        all = git.worktrees(repo)?;
    }
    decorate(store, project, all)
}

/// PROJ-068: the Git folder a linked worktree points at from its `.git` file; None for the main
/// checkout (its `.git` is a folder) and for a folder that is gone.
fn admin_dir(worktree: &Path) -> Option<String> {
    let text = std::fs::read_to_string(worktree.join(".git")).ok()?;
    Some(text.trim().strip_prefix("gitdir:")?.trim().to_string())
}

/// PROJ-068: a workspace whose folder moved (renamed outside Kolux, or `git worktree move`) keeps
/// what Kolux keeps about it: Kolux knows each worktree by its Git folder and rekeys the records
/// from the old path to the new one.
fn carry_over(store: &Store, project: &Project, all: &[Worktree]) -> Result<(), String> {
    let mut known = load_map(store, ADMIN_KEY);
    let mut moved: Vec<(String, String)> = Vec::new(); // (old key, new path)
    let mut changed = false;
    for w in all.iter().filter(|w| !w.is_main) {
        let Some(admin) = admin_dir(Path::new(&w.path)) else { continue };
        let (admin, now) = (name_key(&admin), name_key(&w.path));
        match known.get(&admin).and_then(|v| v.as_str()) {
            Some(old) if old == now => continue,
            Some(old) => moved.push((old.to_string(), w.path.clone())),
            None => {}
        }
        known.insert(admin, now.into());
        changed = true;
    }
    if changed {
        store.set(ADMIN_KEY, &serde_json::Value::Object(known).to_string()).map_err(|e| e.to_string())?;
    }
    for (old, new) in &moved {
        rekey_workspace(store, project, old, new)?;
    }
    Ok(())
}

/// PROJ-068: a workspace folder renamed by hand leaves Git pointing at the old place. Its folder is
/// looked for beside where it was (its `.git` file still names the worktree's Git folder, whose
/// record still names the old place) and Git is told where it went. True when one was repaired.
// ponytail: only the old folder's siblings are searched; a workspace moved elsewhere stays listed as
// missing until `git worktree repair <new folder>` is run.
fn repair_moved(git: &Git, repo: &Path, all: &[Worktree]) -> bool {
    let mut fixed = false;
    for w in all.iter().filter(|w| !w.is_main && !Path::new(&w.path).exists()) {
        let Some(Ok(entries)) = Path::new(&w.path).parent().map(std::fs::read_dir) else { continue };
        let was = name_key(&Path::new(&w.path).join(".git").to_string_lossy());
        for dir in entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            let Some(admin) = admin_dir(&dir) else { continue };
            let points = std::fs::read_to_string(Path::new(&admin).join("gitdir")).map(|s| name_key(s.trim())).unwrap_or_default();
            if points == was && git.worktree_repair(repo, &dir).is_ok() {
                fixed = true;
                break;
            }
        }
    }
    fixed
}

/// A repo's scanned worktrees with what Kolux keeps about them: visibility, names and parents.
pub fn decorate(store: &Store, project: &Project, all: Vec<Worktree>) -> Result<Vec<Worktree>, String> {
    carry_over(store, project, &all)?;
    let names = load_names(store);
    let parents: serde_json::Map<String, serde_json::Value> = store.get(PARENTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let hidden = load_map(store, HIDDEN_KEY);
    let origins = load_origins(store);
    Ok(crate::visibility::apply(store, project, &hidden, all)?
        .into_iter()
        .map(|mut w| {
            w.name = names.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w.parent = parents.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w.made_by = origins.get(&name_key(&w.path)).and_then(|o| o["madeBy"].as_str()).map(String::from);
            let origin = origins.get(&name_key(&w.path));
            w.number = origin.and_then(item_number);
            w.comment = origin.and_then(|o| o["comment"].as_str()).filter(|c| !c.trim().is_empty()).map(String::from);
            w
        })
        .collect())
}

/// Registers the repository that holds `path`; an already-registered one is handed back, not
/// added again. New projects go first (the Recent order). Picking the main checkout or any folder
/// inside it makes the main checkout the project (PROJ-007).
/// PROJ-006: a linked worktree whose repository is already a project selects that project (the
/// match is on the main checkout, never the folder picked); otherwise the folder picked is added.
pub fn add_project(git: &Git, store: &Store, path: &Path) -> Result<Project, String> {
    register_project(store, locate_repo(git, path)?)
}

/// The Git half of `add_project`: the top level of the repository holding `path` and its main
/// checkout. Needs no store, so commands run it unlocked (T-442-b).
pub fn locate_repo(git: &Git, path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let top = git.toplevel(path)?;
    let main = git.worktrees(&top)?.into_iter().find(|w| w.is_main).map(|w| PathBuf::from(w.path)).unwrap_or_else(|| top.clone());
    Ok((top, main))
}

/// The store half of `add_project`, over what `locate_repo` found.
pub fn register_project(store: &Store, (top, main): (PathBuf, PathBuf)) -> Result<Project, String> {
    let mut projects = load_projects_for_write(store)?;
    if let Some(existing) = projects.iter().find(|p| same_folder(Path::new(&p.path), &main) || same_folder(Path::new(&p.path), &top)) {
        return Ok(existing.clone());
    }
    let name = top.file_name().map(|n| n.to_string_lossy().trim_end_matches(".git").to_string()).unwrap_or_else(|| top.display().to_string());
    let project = Project {
        workspaces_dir: None,
        base: None,
        display_name: None,
        id: format!("{}-{}", name.to_lowercase(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)),
        name,
        path: top.display().to_string(),
    };
    // Projects already there keep their earlier visibility; this one follows the defaults (PROJ-042).
    crate::visibility::ensure(store, &projects)?;
    projects.insert(0, project.clone());
    save_projects(store, &projects)?;
    let _ = crate::activity::touch(store, &project.path); // PROJ-051: a new project starts at the top of Recent
    Ok(project)
}

/// GIT-061: one file of a plain folder's proposed first commit; a secret-looking one starts left out.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstFile {
    pub path: String,
    pub secret: bool,
}

/// GIT-061: a name that looks like a key, a token or an environment secrets file. Example and
/// template env files are not secrets. ponytail: a name list, not a content scan.
pub fn looks_secret(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let template = matches!(ext, "example" | "sample" | "template" | "dist");
    if name == ".env" || name.ends_with(".env") || (name.starts_with(".env.") && !template) {
        return true;
    }
    let keyish = matches!(ext, "pem" | "key" | "p12" | "pfx" | "jks" | "keystore" | "ppk" | "kdbx");
    let known = matches!(
        name.as_str(),
        "id_rsa" | "id_dsa" | "id_ecdsa" | "id_ed25519" | ".netrc" | "_netrc" | ".npmrc" | ".pypirc" | ".git-credentials" | "credentials" | "credentials.json" | "service-account.json"
    );
    let data = matches!(ext, "json" | "txt" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "") || ext == name.trim_start_matches('.');
    keyish || known || (data && !template && (name.contains("secret") || name.contains("token")))
}

/// GIT-061: only a full path to an existing folder that is not in a Git repository yet.
pub(crate) fn plain_folder(folder: &Path) -> Result<(), String> {
    if !folder.is_absolute() {
        return Err(format!("{} is not a full path; choose the folder itself", folder.display()));
    }
    if !folder.is_dir() {
        return Err(format!("{} is not an existing folder", folder.display()));
    }
    if crate::git::run(&["rev-parse", "--show-toplevel"], Some(folder)).is_ok() || folder.join(".git").exists() {
        return Err(format!("{} is already a Git repository", folder.display()));
    }
    Ok(())
}

/// GIT-061: what a first commit of this plain folder would hold, honouring its .gitignore. It
/// asks Git through a scratch repository elsewhere, so the folder itself is not touched.
pub fn first_commit_preview(folder: &Path) -> Result<Vec<FirstFile>, String> {
    plain_folder(folder)?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let scratch = std::env::temp_dir().join(format!("kolux-rs-first-commit-{}-{nanos}", std::process::id()));
    let listed = crate::git::run(&["init", "-q", &scratch.to_string_lossy()], None).and_then(|_| {
        let git_dir = scratch.join(".git");
        crate::git::output(&["--git-dir", &git_dir.to_string_lossy(), "--work-tree", &folder.to_string_lossy(), "ls-files", "--others", "--exclude-standard", "-z"], Some(folder))
    });
    let _ = std::fs::remove_dir_all(&scratch);
    let text = String::from_utf8_lossy(&listed?).into_owned();
    let mut files: Vec<FirstFile> = text.split('\0').filter(|f| !f.is_empty()).map(|f| FirstFile { path: f.to_string(), secret: looks_secret(f) }).collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// GIT-061: starts Git in a plain folder and commits exactly `files` as its first commit
/// (`ident` is extra `-c` settings, for tests). If any step fails the new .git is removed, so the
/// folder is left as it was.
pub fn start_git(folder: &Path, files: &[String], ident: &[&str]) -> Result<(), String> {
    plain_folder(folder)?;
    crate::git::run(&["init", "-q"], Some(folder))?;
    let commit = || -> Result<(), String> {
        for chunk in files.chunks(100) {
            let mut args = vec!["add", "--"];
            args.extend(chunk.iter().map(String::as_str));
            crate::git::run(&args, Some(folder))?;
        }
        let mut args = ident.to_vec();
        args.extend(["commit", "-q", "--allow-empty", "-m", "First commit"]);
        crate::git::run(&args, Some(folder)).map(|_| ())
    };
    let done = commit();
    if done.is_err() {
        let _ = std::fs::remove_dir_all(folder.join(".git"));
    }
    done
}

#[tauri::command]
pub fn git_first_commit_preview(path: String) -> Result<Vec<FirstFile>, String> {
    first_commit_preview(Path::new(path.trim()))
}

/// GIT-061: Start Git and commit, then the folder is added like any repository.
#[tauri::command(async)]
pub fn git_start(git: State<'_, Git>, store: StoreState<'_>, path: String, files: Vec<String>) -> Result<Project, String> {
    let folder = Path::new(path.trim());
    start_git(folder, &files, &[])?;
    let found = locate_repo(&git, folder)?;
    register_project(&*store.lock().map_err(|e| e.to_string())?, found)
}

/// The default workspaces root: `kolux-rs\workspaces` in the user's home folder. A different
/// name from the old app's folders, so the two never mix.
pub fn default_workspaces_dir() -> PathBuf {
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    home.join("kolux-rs").join("workspaces")
}

pub const WORKSPACES_DIR_ENV: &str = "KOLUX_WORKSPACES_DIR";

pub(crate) fn non_blank(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

/// The global workspaces folder (SET-032, PROJ-026): the saved setting, else the environment
/// variable (which only moves the default, so a folder the user saved still wins), else the
/// default. Both values are trimmed and a blank one counts as not set.
pub fn resolve_workspaces_dir(env: Option<&str>, setting: Option<&str>) -> PathBuf {
    non_blank(setting).or(non_blank(env)).map(PathBuf::from).unwrap_or_else(default_workspaces_dir)
}

pub fn workspaces_dir(store: &Store) -> PathBuf {
    resolve_workspaces_dir(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref(), store.settings()[WORKSPACES_DIR_SETTING].as_str())
}

/// The folder and layout for `project`'s workspaces (PROJ-025): the project's own folder when it
/// has one, else the global setting, else the default; a relative folder counts from the
/// project root (joining an absolute one leaves it as it is). It asks Git for the user name and
/// checks the prefix, so commands read `settings` under the store lock and call this with the
/// lock let go (T-442-b; `locked_place`).
pub fn place_from(project: &Project, settings: &serde_json::Value) -> Place {
    let own = project.workspaces_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from);
    let user = || prefix_user(|| crate::git::run(&["config", "user.name"], Some(Path::new(&project.path))).ok(), crate::scm::gh_login);
    let (prefix, prefix_warning) = branch_prefix(settings[PREFIX_SETTING].as_str(), settings[PREFIX_CUSTOM_SETTING].as_str(), user, &git_accepts);
    let refresh = settings[REFRESH_BASE_SETTING].as_bool() == Some(true);
    let dir = || resolve_workspaces_dir(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref(), settings[WORKSPACES_DIR_SETTING].as_str());
    Place { root: Path::new(&project.path).join(own.unwrap_or_else(dir)), flat: settings[LAYOUT_SETTING].as_str() == Some("flat"), prefix, prefix_warning, refresh }
}

/// GIT-066: the name behind the default prefix: the configured git user name, else the gh login.
pub fn prefix_user(git_name: impl Fn() -> Option<String>, gh_login: impl Fn() -> Option<String>) -> Option<String> {
    git_name().filter(|n| !n.trim().is_empty()).or_else(|| gh_login().filter(|n| !n.trim().is_empty()))
}

/// PROJ-022 / SET-031: the branch prefix for `mode`. The Git user name (the default) is cleaned
/// like a typed name, and no user name means no prefix; custom text loses surrounding spaces and
/// trailing slashes (only slashes means none); a prefix Git refuses is not used, with a warning.
pub fn branch_prefix(mode: Option<&str>, custom: Option<&str>, user: impl Fn() -> Option<String>, git_ok: &dyn Fn(&str) -> bool) -> (String, Option<String>) {
    let p = match mode {
        Some("none") => return (String::new(), None),
        Some("custom") => custom.unwrap_or("").trim().trim_end_matches('/').to_string(),
        _ => {
            let p = user().and_then(|u| safe_name(&u)).unwrap_or_default();
            if p.chars().count() > MAX_USER_PREFIX {
                return (String::new(), Some(format!("the user name \"{p}\" is too long for a branch prefix (over {MAX_USER_PREFIX} characters), so this branch has no prefix")));
            }
            p
        }
    };
    if p.is_empty() {
        return (String::new(), None);
    }
    let p = format!("{p}/");
    if git_ok(&p) {
        (p, None)
    } else {
        (String::new(), Some(format!("the branch prefix \"{p}\" is not a name Git accepts, so this branch has no prefix")))
    }
}

/// Whether Git takes `prefix` at the start of a branch name.
fn git_accepts(prefix: &str) -> bool {
    crate::git::run(&["check-ref-format", "--branch", &format!("{prefix}x")], None).is_ok()
}

/// SET-031: what the prefix field's draft comes to, for the live sample: the prefix new branches
/// would get (the global Git user name for the default), and whether Git refused it.
#[derive(serde::Serialize)]
pub struct PrefixCheck {
    pub prefix: String,
    pub refused: bool,
}

pub fn branch_prefix_check_now(mode: Option<String>, custom: Option<String>) -> PrefixCheck {
    let user = || prefix_user(|| crate::git::run(&["config", "user.name"], None).ok(), crate::scm::gh_login);
    let (prefix, warning) = branch_prefix(mode.as_deref(), custom.as_deref(), user, &git_accepts);
    PrefixCheck { prefix, refused: warning.is_some() }
}

/// Async so the git and gh lookups (up to 230 ms) run off the UI thread, which a sync command would hold.
#[tauri::command]
pub async fn branch_prefix_check(mode: Option<String>, custom: Option<String>) -> PrefixCheck {
    tauri::async_runtime::spawn_blocking(move || branch_prefix_check_now(mode, custom)).await.unwrap_or(PrefixCheck { prefix: String::new(), refused: false })
}

pub fn used_dirs(store: &Store) -> Vec<String> {
    store.settings()[USED_DIRS_SETTING].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Puts a folder the user chose at the front of the remembered list (ten kept).
pub fn remember_dir(store: &Store, dir: &str) -> Result<(), String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return Ok(());
    }
    let mut used = vec![dir.to_string()];
    used.extend(used_dirs(store).into_iter().filter(|d| !d.eq_ignore_ascii_case(dir)));
    used.truncate(10);
    let mut settings = store.settings();
    settings[USED_DIRS_SETTING] = serde_json::Value::Array(used.into_iter().map(serde_json::Value::String).collect());
    store.save_settings(&settings).map_err(|e| e.to_string())
}

/// Where a new workspace of `project` named `safe` lives: `<root>\<project>\<safe>` nested (the
/// project folder named without a `.git` ending), or `<root>\<safe>` flat.
pub fn workspace_path(place: &Place, project: &Project, safe: &str) -> PathBuf {
    if place.flat {
        place.root.join(safe)
    } else {
        place.root.join(project.name.trim_end_matches(".git")).join(safe)
    }
}

/// PROJ-028: what a new workspace starts from. The ref chosen for this one wins and must exist;
/// else the project's saved base, falling back to the default branch with a note when it is
/// gone; else the default branch. No default at all stops the create. A base that tracks a
/// remote is fetched first; a full commit id is used as it is.
pub fn resolve_base(git: &Git, repo: &Path, project: &Project, chosen: Option<&str>) -> Result<(String, Option<String>), String> {
    let chosen = chosen.map(str::trim).filter(|s| !s.is_empty());
    let saved = project.base.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let default = || git.default_branch(repo).ok_or_else(|| format!("no default branch was found in {}; set a base ref for the project", project.name));
    let (base, note) = match (chosen, saved) {
        (Some(c), _) if git.base_available(repo, c) => (c.to_string(), None),
        (Some(c), _) => return Err(format!("{c} is not a branch, tag or commit in {}", project.name)),
        (None, Some(s)) if git.base_available(repo, s) => (s.to_string(), None),
        (None, Some(s)) => {
            let d = default()?;
            let note = format!("the saved base {s} no longer exists in {}; this workspace started from {d} instead", project.name);
            (d, Some(note))
        }
        (None, None) => {
            let d = default()?;
            let _ = git.base_available(repo, &d); // the fetch, when the default tracks a remote
            (d, None)
        }
    };
    Ok((base, note))
}

/// GIT-066: brings the local branch `base` up to its upstream (already fetched by
/// `resolve_base`) when `apply` is on. Fast-forward only: a base with commits of its own, or one
/// whose worktree has uncommitted changes, is left alone with a note. With `apply` off it only
/// says the base is behind, and says nothing when its worktree is dirty.
fn refresh_base(git: &Git, repo: &Path, base: &str, apply: bool) -> Option<String> {
    let run = |args: &[&str], dir: &Path| crate::git::run(args, Some(dir));
    run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{base}")], repo).ok()?;
    let up = run(&["rev-parse", "--abbrev-ref", &format!("{base}@{{upstream}}")], repo).ok()?;
    let count = |range: String| run(&["rev-list", "--count", &range], repo).ok().and_then(|n| n.parse::<usize>().ok());
    let behind = count(format!("{base}..{up}"))?;
    if behind == 0 {
        return None;
    }
    let commits = if behind == 1 { "1 commit".to_string() } else { format!("{behind} commits") };
    let home = git.worktrees(repo).ok()?.into_iter().find(|w| w.branch.as_deref() == Some(base));
    let dirty = home.as_ref().is_some_and(|w| run(&["status", "--porcelain"], Path::new(&w.path)).map_or(true, |s| !s.is_empty()));
    if !apply {
        return (!dirty).then(|| format!("{base} is {commits} behind {up}; update it, or turn on Refresh the base first in Settings > Git & worktrees"));
    }
    if dirty {
        return Some(format!("{base} was not refreshed: its worktree has uncommitted changes, so this workspace starts from the local {base}"));
    }
    if count(format!("{up}..{base}"))? > 0 {
        return Some(format!("{base} was not refreshed: it has commits of its own that {up} lacks, so this workspace starts from the local {base}"));
    }
    let moved = match &home {
        Some(w) => run(&["merge", "--ff-only", "--quiet", &up], Path::new(&w.path)).map(drop),
        None => {
            let (new, old) = (run(&["rev-parse", &up], repo).ok()?, run(&["rev-parse", base], repo).ok()?);
            run(&["update-ref", &format!("refs/heads/{base}"), &new, &old], repo).map(drop)
        }
    };
    moved.err().map(|e| format!("{base} could not be refreshed ({e}), so this workspace starts from the local {base}"))
}

/// PROJ-020: the answer a create gives when a newer one overtook it.
pub const OVERTAKEN: &str = "cancelled: a newer workspace creation took its place";

/// PROJ-020: the window's create tickets that a newer create overtook. A ticket can be dropped
/// before its create even reaches Git (it then makes nothing) or while Git works (what it made
/// is removed again).
fn dropped_tickets() -> &'static Mutex<HashSet<u64>> {
    static DROPPED: OnceLock<Mutex<HashSet<u64>>> = OnceLock::new();
    DROPPED.get_or_init(Default::default)
}

pub fn drop_create(ticket: u64) {
    dropped_tickets().lock().unwrap_or_else(PoisonError::into_inner).insert(ticket);
}

pub fn dropped(ticket: Option<u64>) -> bool {
    ticket.is_some_and(|t| dropped_tickets().lock().unwrap_or_else(PoisonError::into_inner).contains(&t))
}

/// Forgets a ticket once its create has answered.
pub fn settle_create(ticket: u64) {
    dropped_tickets().lock().unwrap_or_else(PoisonError::into_inner).remove(&ticket);
}

/// PROJ-020: the window cancels a create that a newer one overtook.
#[tauri::command]
pub fn workspace_create_cancel(ticket: u64) {
    drop_create(ticket);
}

/// Undoes a create that was overtaken after Git made its worktree: the folder goes, and the
/// branch too unless it existed before (`branch` None).
fn undo_create(git: &Git, repo: &Path, dest: &Path, branch: Option<&str>) -> String {
    crate::include::unlink_shared(repo, dest);
    match git.worktree_remove(repo, dest, branch) {
        Ok(_) => OVERTAKEN.to_string(),
        Err(e) => format!("{OVERTAKEN}, but its folder could not be removed: {e}"),
    }
}

/// SESS-038: the retry policy for a failed `git worktree add`. A lock another Git process holds
/// is waited out: two more tries, 0.2 s and then 0.8 s later. Any other failure is final at once.
const CREATE_WAITS_MS: [u64; 2] = [200, 800];

/// Whether Git refused because another Git process holds one of its lock files.
pub fn lock_held(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains(".lock") || e.contains("another git process") || e.contains("cannot lock") || e.contains("could not lock")
}

/// What a failed `git worktree add` may have left: the folder (it did not exist before), Git's
/// record of it, and `made`, the branch the add was creating (none of that name existed before).
fn clear_failed_add(repo: &Path, dest: &Path, made: Option<&str>) {
    let _ = std::fs::remove_dir_all(dest);
    let _ = crate::git::run(&["worktree", "prune"], Some(repo));
    if let Some(branch) = made.filter(|b| crate::git::run(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")], Some(repo)).is_ok()) {
        let _ = crate::git::run(&["branch", "-D", branch], Some(repo));
    }
}

/// PROJ-031: what kind of problem a failed create was, so the message can say what to do.
#[derive(Debug, PartialEq, Eq)]
pub enum CreateKind {
    Stalled,
    MissingBase,
    NameInUse,
    Permissions,
    GitFailure,
}

pub fn create_kind(raw: &str) -> CreateKind {
    let t = raw.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if has(&["did not finish in"]) {
        CreateKind::Stalled
    } else if has(&["invalid reference", "not a valid object name", "unknown revision", "not a commit", "not a valid ref"]) {
        CreateKind::MissingBase
    } else if has(&["already exists", "already checked out", "already used by worktree", "is already registered"]) {
        CreateKind::NameInUse
    } else if has(&["permission denied", "access is denied", "operation not permitted", "read-only file system"]) {
        CreateKind::Permissions
    } else {
        CreateKind::GitFailure
    }
}

/// Separator the page splits on to show Git's own words in a details block.
pub const GIT_SAID: &str = "\nGit said: ";

/// PROJ-031: the failed create in Kolux's words (what kind of problem, what to do), followed by
/// Git's full output after `GIT_SAID`. A cancelled create passes through unchanged.
pub fn explain_create_error(raw: String) -> String {
    if raw.starts_with(OVERTAKEN) {
        return raw;
    }
    let (summary, next) = match create_kind(&raw) {
        CreateKind::Stalled => return raw, // already in Kolux's words
        CreateKind::MissingBase => ("The workspace could not start: the commit or branch it was to start from is missing.", "Pick another start point, or fetch the project and try again."),
        CreateKind::NameInUse => ("The workspace could not be made: that name or branch is already in use.", "Choose a different name, or open the existing branch from the New workspace menu."),
        CreateKind::Permissions => ("The workspace could not be made: Windows refused access to the folder.", "Check the workspaces folder is writable and that no program has it open, then try again."),
        CreateKind::GitFailure => ("Git could not create the workspace.", "Try again; if it keeps failing, the details below say why."),
    };
    format!("{summary} {next}{GIT_SAID}{raw}")
}

/// `add` (a `git worktree add` into `dest`, creating branch `made` if any) under the retry
/// policy: each failed try is cleared away first, and a cancel stops the waiting.
pub fn add_retrying(repo: &Path, dest: &Path, made: Option<&str>, overtaken: &dyn Fn() -> bool, add: impl Fn() -> Result<(), String>) -> Result<(), String> {
    let mut waits = CREATE_WAITS_MS.iter();
    while let Err(e) = add() {
        clear_failed_add(repo, dest, made);
        if overtaken() {
            return Err(OVERTAKEN.to_string());
        }
        match waits.next() {
            Some(ms) if lock_held(&e) => std::thread::sleep(std::time::Duration::from_millis(*ms)),
            _ => return Err(e),
        }
    }
    Ok(())
}

pub fn create_workspace(git: &Git, place: &Place, project: &Project, typed_name: &str, start: Option<&str>) -> Result<Created, String> {
    create_workspace_until(git, place, project, typed_name, start, &|| false)
}

/// `create_workspace`, asking `overtaken` before Git starts and again once the worktree is made:
/// a yes before makes nothing, a yes after removes the half-made checkout (PROJ-020).
pub fn create_workspace_until(git: &Git, place: &Place, project: &Project, typed_name: &str, start: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<Created, String> {
    // SESS-036: a name that cleans up to nothing becomes "workspace" (numbered when taken).
    let base = safe_name(typed_name).unwrap_or_else(|| "workspace".to_string());
    let repo = Path::new(&project.path);
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if overtaken() {
        return Err(OVERTAKEN.to_string());
    }
    let (from, note) = resolve_base(git, repo, project, start).map_err(|e| format!("The workspace could not start: {e}."))?;
    let refreshed = refresh_base(git, repo, &from, place.refresh);
    // PROJ-021: a name taken by a branch (local or on a remote) or a folder gets a number.
    let (safe, dest) = (1..)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|s| {
            let d = workspace_path(place, project, &s);
            (s, d)
        })
        .find(|(s, d)| !d.exists() && !git.branch_taken(repo, &format!("{}{s}", place.prefix)))
        .ok_or("no free name")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let new_branch = format!("{}{safe}", place.prefix);
    add_retrying(repo, &dest, Some(&new_branch), overtaken, || git.worktree_add(repo, &dest, &new_branch, &from)).map_err(explain_create_error)?;
    let mut warnings: Vec<String> = place.prefix_warning.iter().cloned().chain(refreshed).collect();
    warnings.extend(crate::include::bring_along(repo, &dest));
    if overtaken() {
        return Err(undo_create(git, repo, &dest, Some(&new_branch)));
    }
    let worktree = git
        .worktrees(repo)?
        .into_iter()
        .find(|w| same_folder(Path::new(&w.path), &dest))
        .ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    // T-780: decided here, before any record exists and with no store lock held.
    let own = head_is_on_origin(&dest);
    Ok(Created { worktree, base: from, note, warnings, own })
}

/// Every workspace folder name and branch in use across all registered projects (SESS-023 and
/// PROJ-023: a generated name never repeats one in use anywhere).
pub fn names_in_use(git: &Git, projects: &[Project]) -> Vec<String> {
    let mut names = Vec::new();
    for p in projects {
        for w in git.worktrees(Path::new(&p.path)).unwrap_or_default() {
            if let Some(folder) = Path::new(&w.path).file_name() {
                names.push(folder.to_string_lossy().to_string());
            }
            if let Some(branch) = w.branch {
                // A branch under a prefix (`kolux/amber-otter`) uses its last part as a name too.
                if let Some((_, tail)) = branch.rsplit_once('/') {
                    names.push(tail.to_string());
                }
                names.push(branch);
            }
        }
    }
    names
}

/// PROJ-023: the names workspaces were given by hand (the shown name can differ from the folder).
fn typed_names(store: &Store) -> Vec<String> {
    load_names(store).values().filter_map(|v| v.as_str().map(String::from)).collect()
}

/// PROJ-023: a creature name for the create flow's name field, free in every registered project
/// (case ignored) and never a retired one. Nothing is recorded: a suggestion nobody uses costs no
/// name. `lock` hands over the store only for the store work (T-442-b).
pub fn suggest_name<S: std::ops::Deref<Target = Store>>(git: &Git, lock: impl Fn() -> Result<S, String>, place: &Place, project: &Project, seed: u64) -> Result<String, String> {
    let projects = load_projects(&*lock()?);
    let taken = names_in_use(git, &projects);
    let store = lock()?;
    Ok(pick_name(&store, &retired_scope(place, project), taken, seed))
}

#[tauri::command(async)]
pub fn workspace_suggest_name(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<String, String> {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let (project, place) = locked_place(&store, &project_id)?;
    suggest_name(&git, || store.lock().map_err(|e| e.to_string()), &place, &project, seed)
}

/// PROJ-024: the suggested names of workspaces that were deleted, kept so they are not suggested
/// again, restarts included. The record is per scope: the folder the workspace lived in, so with the
/// flat layout every project sharing the workspaces folder shares it, and with the nested layout each
/// project's own subfolder keeps its own. Names compare ignoring case and spaces; only names from the
/// suggestion list are kept, never ones typed freely; the record is bounded (oldest names, then
/// oldest scopes, go first) and a damaged one counts as empty.
const RETIRED_KEY: &str = "retiredNames";
const RETIRED_PER_SCOPE: usize = 400;
const RETIRED_SCOPES: usize = 100;

#[derive(serde::Serialize, serde::Deserialize)]
struct Retired {
    scope: String,
    names: Vec<String>,
}

/// SESS-023's record: one flat list of every name handed out, kept under this key before PROJ-024.
const LEGACY_KEY: &str = "creatureNamesUsed";
/// The scope the old names are kept under: a name there is retired in every scope. (No folder is
/// ever named this, so it cannot meet a real scope.)
const GLOBAL_SCOPE: &str = "*";
/// The most old names carried over.
const LEGACY_MAX: usize = 4000;

/// The record. Until the first retirement writes "retiredNames", the old flat list stands in for it
/// as a global scope, so a name already handed out stays out of the suggestions without a separate
/// migration step; once the new key exists the old one is no longer read.
fn retired_all(store: &Store) -> Vec<Retired> {
    match store.get(RETIRED_KEY).ok().flatten() {
        Some(v) => serde_json::from_str(&v).unwrap_or_default(),
        None => {
            let old: Vec<String> = store.get(LEGACY_KEY).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
            let mut names: Vec<String> = Vec::new();
            for n in old {
                let form = name_form(&n);
                if !form.is_empty() && !names.contains(&form) {
                    names.push(form);
                }
            }
            let extra = names.len().saturating_sub(LEGACY_MAX);
            names.drain(..extra);
            if names.is_empty() {
                Vec::new()
            } else {
                vec![Retired { scope: GLOBAL_SCOPE.to_string(), names }]
            }
        }
    }
}

/// Case and spaces do not tell two names apart.
fn name_form(name: &str) -> String {
    name.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

/// Where a workspace of `project` would be kept under `place`, as the record's scope.
pub fn retired_scope(place: &Place, project: &Project) -> String {
    let folder = workspace_path(place, project, "x");
    name_key(&folder.parent().unwrap_or(&folder).to_string_lossy())
}

pub fn retired_names(store: &Store, scope: &str) -> Vec<String> {
    let mut out = Vec::new();
    for r in retired_all(store) {
        if r.scope == scope || r.scope == GLOBAL_SCOPE {
            for n in r.names {
                if !out.contains(&n) {
                    out.push(n);
                }
            }
        }
    }
    out
}

/// Every name the suggestion list can make, read back through the public picker (one pair per seed).
fn suggestion_list() -> &'static std::collections::HashSet<String> {
    static LIST: OnceLock<std::collections::HashSet<String>> = OnceLock::new();
    LIST.get_or_init(|| (0..4096u64).map(|seed| creature_name(&[], seed)).collect())
}

/// Is `name` one the suggestion list made (a numbered round, `amber-otter-2`, included)?
fn from_suggestions(name: &str) -> bool {
    let form = name_form(name);
    let base = match form.rsplit_once('-') {
        Some((b, n)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) => b,
        _ => form.as_str(),
    };
    suggestion_list().contains(base)
}

/// Keeps `name` as retired in `scope` when the suggestion list made it; any other name is left alone.
pub fn retire_name(store: &Store, scope: &str, name: &str) -> Result<(), String> {
    if !from_suggestions(name) {
        return Ok(());
    }
    let form = name_form(name);
    let mut all = retired_all(store);
    let at = match all.iter().position(|r| r.scope == scope) {
        Some(i) => i,
        None => {
            all.push(Retired { scope: scope.to_string(), names: Vec::new() });
            all.len() - 1
        }
    };
    if all[at].names.contains(&form) {
        return Ok(());
    }
    all[at].names.push(form);
    let extra = all[at].names.len().saturating_sub(RETIRED_PER_SCOPE);
    all[at].names.drain(..extra);
    // the oldest scopes go first; the old global names are never one of them
    while all.iter().filter(|r| r.scope != GLOBAL_SCOPE).count() > RETIRED_SCOPES {
        match all.iter().position(|r| r.scope != GLOBAL_SCOPE) {
            Some(i) => {
                all.remove(i);
            }
            None => break,
        }
    }
    store.set(RETIRED_KEY, &serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// A creature name in use nowhere, now or before (SESS-023).
#[cfg(test)]
pub fn fresh_name(git: &Git, store: &Store, projects: &[Project], scope: &str, seed: u64) -> String {
    pick_name(store, scope, names_in_use(git, projects), seed)
}

/// A creature name outside `taken` (the names Git has in use), the hand-typed ones and every name
/// retired in `scope`.
fn pick_name(store: &Store, scope: &str, mut taken: Vec<String>, seed: u64) -> String {
    taken.extend(retired_names(store, scope));
    taken.extend(typed_names(store));
    creature_name(&taken, seed)
}

/// A workspace an agent launch makes for itself: a creature name nobody uses, branched from the
/// main checkout, or from `base` when given (AUTO-005). The clock seeds the pick so launches do
/// not always start at the same pair. `lock` hands over the store only for the store work, so
/// Git runs unlocked (T-442-b); picking the name and recording it as used is one locked step, so
/// two launches at once never pick one name.
pub fn create_fresh_workspace<S: std::ops::Deref<Target = Store>>(git: &Git, lock: impl Fn() -> Result<S, String>, place: &Place, projects: &[Project], project: &Project, base: Option<&str>) -> Result<Worktree, String> {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let taken = names_in_use(git, projects);
    let name = {
        let store = lock()?;
        pick_name(&store, &retired_scope(place, project), taken, seed)
    };
    let created = create_workspace(git, place, project, &name, base)?;
    record_made(&*lock()?, project, &created, serde_json::json!({ "madeBy": "app" }))?;
    let made = created.worktree;
    // PROJ-039: Kolux invented this name, so the first work may rename the branch to fit it.
    mark_suggested(&*lock()?, &made.path, true)?;
    Ok(made)
}

/// GIT-067: uncommitted work (submodule work included) stops the removal unless `force`; the
/// branch goes with the folder unless another worktree still has it checked out.
#[cfg(test)]
pub fn remove_workspace(git: &Git, project: &Project, worktree_path: &str, force: bool) -> Result<(), String> {
    remove_worktree(git, project, worktree_path, force, false).map(|_| ())
}

/// PROJ-073: a branch left behind when its workspace went (kept by choice, or because another
/// worktree has it), with the commit it pointed at then, so a later delete
/// (`Git::delete_branch_if_at`) removes it only while it is still there. The one type for the
/// remove command, the cleanup dialog and the kept-branch list (after-list row 116).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Kept {
    pub branch: String,
    pub commit: String,
}

/// PROJ-030: a workspace opened on a branch that already existed keeps that branch when it goes.
pub fn keeps_branch(store: &Store, path: &str) -> bool {
    origin(store, path).is_some_and(|o| o["existingBranch"] == true)
}

/// `remove_workspace`, keeping the branch when `keep_branch`.
pub fn remove_worktree(git: &Git, project: &Project, worktree_path: &str, force: bool, keep_branch: bool) -> Result<Option<Kept>, String> {
    let repo = Path::new(&project.path);
    let target = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), Path::new(worktree_path))).ok_or_else(|| format!("{worktree_path} is not a worktree of {}", project.name))?;
    if target.is_main {
        return Err("the main checkout cannot be removed; remove the project instead".to_string());
    }
    if !force && Path::new(&target.path).exists() && git.dirty(Path::new(&target.path))? {
        return Err(format!("{} has uncommitted changes", target.branch.as_deref().unwrap_or(worktree_path)));
    }
    crate::include::unlink_shared(repo, Path::new(&target.path));
    let left = git.worktree_remove(repo, Path::new(&target.path), target.branch.as_deref().filter(|_| !keep_branch))?;
    // The branch stayed: because the user chose to keep it, or because another worktree has it.
    Ok(match (target.branch, keep_branch, left) {
        // An unborn branch (no commit yet) has nothing to keep, and the folder is already gone.
        (Some(branch), true, _) => crate::git::run(&["rev-parse", "--verify", &format!("refs/heads/{branch}")], Some(repo)).ok().map(|commit| Kept { branch, commit }),
        (Some(branch), false, Some(commit)) => Some(Kept { branch, commit }),
        _ => None,
    })
}

/// PROJ-030: a workspace on a branch that exists already, locally or only on a remote (Git then
/// makes the local branch that tracks it). The folder takes `folder` when given, else the
/// branch's name, numbered when taken; the branch itself never changes and is kept at removal.
#[cfg(test)]
pub fn open_branch_workspace(git: &Git, place: &Place, project: &Project, branch: &str, folder: Option<&str>) -> Result<Created, String> {
    open_branch_workspace_until(git, place, project, branch, folder, &|| false)
}

/// `open_branch_workspace` with the overtaken checks of `create_workspace_until`; the branch
/// existed before, so an undo keeps it.
pub fn open_branch_workspace_until(git: &Git, place: &Place, project: &Project, branch: &str, folder: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<Created, String> {
    let branch = branch.trim();
    let repo = Path::new(&project.path);
    if branch.is_empty() || !git.branch_taken(repo, branch) {
        return Err(format!("there is no branch {branch} in {}", project.name));
    }
    let base = safe_name(folder.map(str::trim).filter(|f| !f.is_empty()).unwrap_or(branch)).ok_or("that folder name leaves nothing usable; use some letters or digits")?;
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if overtaken() {
        return Err(OVERTAKEN.to_string());
    }
    let dest = (1..)
        .map(|n| workspace_path(place, project, &if n == 1 { base.clone() } else { format!("{base}-{n}") }))
        .find(|d| !d.exists())
        .ok_or("no free folder")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let limit = crate::git::add_timeout(std::env::var("KOLUX_WORKTREE_ADD_TIMEOUT_MS").ok().as_deref());
    add_retrying(repo, &dest, None, overtaken, || crate::git::run_within(&["worktree", "add", &dest.to_string_lossy(), branch], Some(repo), limit).map(drop)).map_err(explain_create_error)?;
    let warnings = crate::include::bring_along(repo, &dest);
    if overtaken() {
        return Err(undo_create(git, repo, &dest, None));
    }
    let worktree = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), &dest)).ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    // T-780: decided here, before any record exists and with no store lock held.
    let own = head_is_on_origin(&dest);
    Ok(Created { worktree, base: branch.to_string(), note: None, warnings, own })
}

/// `open_branch_workspace_until` plus the worktree's first record (T-780: the trust marker is
/// decided in that first write). `workspace_open_branch` is this with the composer's nesting.
pub fn open_named_until(git: &Git, store: &Mutex<Store>, project: &Project, place: &Place, branch: &str, folder: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<Created, String> {
    let made = open_branch_workspace_until(git, place, project, branch, folder, overtaken)?;
    record_made(&*store.lock().map_err(|e| e.to_string())?, project, &made, serde_json::json!({ "madeBy": "app", "existingBranch": true }))?;
    Ok(made)
}

/// The branches a workspace can be opened on (PROJ-030): local ones, then remote ones by their
/// short name (`origin/feat-x`), without the remotes' HEAD pointers.
pub fn branches(repo: &Path) -> Result<Vec<String>, String> {
    let out = crate::git::run(&["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], Some(repo))?;
    Ok(out.lines().filter(|l| !l.ends_with("/HEAD")).filter_map(|l| l.strip_prefix("refs/heads/").or_else(|| l.strip_prefix("refs/remotes/"))).map(str::to_string).collect())
}

#[tauri::command]
pub fn workspace_branches(store: StoreState<'_>, project_id: String) -> Result<Vec<String>, String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    branches(Path::new(&project.path))
}

// PROJ-020: off the main thread, so a newer create (and its cancel) can reach Kolux while Git works.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn workspace_open_branch(git: State<'_, Git>, store: StoreState<'_>, project_id: String, branch: String, folder: Option<String>, parent: Option<String>, ticket: Option<u64>, active_folder: Option<String>) -> Result<Created, String> {
    let (project, place) = locked_place(&store, &project_id)?;
    let made = open_named_until(&git, &store, &project, &place, &branch, folder.as_deref(), &|| dropped(ticket));
    if let Some(t) = ticket {
        settle_create(t);
    }
    let mut made = made?;
    nest_under(&git, &store, &project, &mut made, parent.as_deref(), active_folder.as_deref())?;
    let _ = crate::activity::touch(&*store.lock().map_err(|e| e.to_string())?, &made.worktree.path); // PROJ-051
    Ok(made)
}

/// PROJ-030: the open pull requests of the project's repository, for the composer to pick from.
#[tauri::command(async)]
pub fn workspace_prs(store: StoreState<'_>, project_id: String) -> Result<Vec<crate::pr_checkout::PrHead>, String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    crate::pr_checkout::list(&crate::scm::gh_program()?, Path::new(&project.path))
}

/// PROJ-030: opens pull request `number` as a workspace, linked to it. A pull request from a
/// fork is fetched through a remote for the fork, at the same kind of address as origin.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn workspace_open_pr(app: tauri::AppHandle, git: State<'_, Git>, store: StoreState<'_>, project_id: String, number: u64, folder: Option<String>, name: Option<String>, parent: Option<String>, ticket: Option<u64>, active_folder: Option<String>) -> Result<Created, String> {
    let (project, place) = locked_place(&store, &project_id)?;
    let repo = Path::new(&project.path);
    let pr = crate::pr_checkout::view(&crate::scm::gh_program()?, repo, number)?;
    let fork = if pr.is_cross_repository {
        let origin = crate::git::run(&["remote", "get-url", "origin"], Some(repo)).map_err(|_| "this project has no origin remote to find the fork from".to_string())?;
        let owner = pr.head_repository_owner.as_ref().map(|o| o.login.clone()).ok_or("gh did not say whose fork the pull request comes from")?;
        let repo_name = pr.head_repository.as_ref().map(|r| r.name.clone()).ok_or("gh did not say which fork the pull request comes from")?;
        Some(crate::pr_checkout::fork_url(&origin, &owner, &repo_name).ok_or("origin is not a GitHub address, so the fork's address is not known")?)
    } else {
        None
    };
    let opened = crate::pr_checkout::open(&git, &place, &project, &pr, fork.as_deref(), folder.as_deref(), &|| dropped(ticket));
    if let Some(t) = ticket {
        settle_create(t);
    }
    let (mut made, reused) = opened?;
    {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": reused, "pr": pr.url, PR_EVER_KEY: true })))?;
        if crate::scm::link_printed(&store, &made.worktree.path, &pr.url) {
            let _ = tauri::Emitter::emit(&app, "settings-saved", ()); // the window's copy of the links is stale otherwise
        }
        note_seen(&store, &project, &made.worktree.path)?;
        let shown = name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or(&pr.title).to_string();
        set_name(&store, &made.worktree.path, Some(&shown))?;
        made.worktree.name = Some(shown);
    }
    nest_under(&git, &store, &project, &mut made, parent.as_deref(), active_folder.as_deref())?;
    let _ = crate::activity::touch(&*store.lock().map_err(|e| e.to_string())?, &made.worktree.path); // PROJ-051
    Ok(made)
}
/// PROJ-037: an issue or pull request named by its address, as the palette read it.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct WorkItem {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub kind: String,
    pub number: u64,
}

/// SESS-036: the open issues and pull requests of the project's own repository that match the
/// text typed in the composer's name field.
#[tauri::command(async)]
pub fn workspace_items(store: StoreState<'_>, project_id: String, query: String) -> Result<Vec<crate::pr_checkout::Linkable>, String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    crate::pr_checkout::find(&crate::scm::gh_program()?, Path::new(&project.path), &query)
}

/// PROJ-037: Ok when the item's repository is a remote of `project`. The user's SSH config text is
/// read once by the caller (an alias remote counts as the host it stands for).
fn item_is_remote_of(project: &Project, item: &WorkItem, ssh_config: &str) -> Result<(), String> {
    if !crate::pr_checkout::has_repo_with(&crate::pr_checkout::remotes(Path::new(&project.path)), &item.host, &item.owner, &item.repo, ssh_config) {
        return Err(format!("That link is to {}/{}/{}, which is not a remote of {}; links here come from the chosen project's own repository.", item.host, item.owner, item.repo, project.name));
    }
    Ok(())
}

/// PROJ-037: the first project with a remote at the item's repository. The SSH config text is the
/// caller's single read, not one read per project.
fn project_with_remote(projects: Vec<Project>, item: &WorkItem, ssh_config: &str) -> Result<Project, String> {
    projects
        .into_iter()
        .find(|p| crate::pr_checkout::has_repo_with(&crate::pr_checkout::remotes(Path::new(&p.path)), &item.host, &item.owner, &item.repo, ssh_config))
        .ok_or_else(|| format!("No project here has {}/{}/{} as a remote; add that repository as a project first.", item.host, item.owner, item.repo))
}

/// SESS-036: the issue or pull request a link pasted in the composer names, when it belongs to
/// the chosen project's own repository (never another one, so no repository is asked for).
#[tauri::command(async)]
pub fn workspace_item(store: StoreState<'_>, project_id: String, item: WorkItem) -> Result<crate::pr_checkout::Linkable, String> {
    use crate::pr_checkout::Linkable;
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    let repo = Path::new(&project.path);
    item_is_remote_of(&project, &item, &crate::scm::ssh_config())?;
    let gh = crate::scm::gh_program()?;
    Ok(if item.kind == "pull" {
        let pr = crate::pr_checkout::view(&gh, repo, item.number)?;
        Linkable { kind: "pull".into(), number: pr.number, title: pr.title, url: pr.url }
    } else {
        let i = crate::pr_checkout::issue(&gh, repo, item.number)?;
        Linkable { kind: "issue".into(), number: i.number, title: i.title, url: i.url }
    })
}

/// PROJ-037: a workspace straight from an issue or pull request address, in the project that has
/// a remote at its repository: a pull request is checked out as `workspace_open_pr` does; an
/// issue gets a new branch named after its title, linked to it (the `issue:` selector finds it).
#[tauri::command(async)]
pub fn workspace_from_item(app: tauri::AppHandle, git: State<'_, Git>, store: StoreState<'_>, item: WorkItem) -> Result<Created, String> {
    let projects = load_projects(&*store.lock().map_err(|e| e.to_string())?);
    let project = project_with_remote(projects, &item, &crate::scm::ssh_config())?;
    if item.kind == "pull" {
        return workspace_open_pr(app, git, store, project.id, item.number, None, None, None, None, None);
    }
    let issue = crate::pr_checkout::issue(&crate::scm::gh_program()?, Path::new(&project.path), item.number)?;
    // T-780: the issue link rides in the first record, so the trust marker is decided with it.
    let made = create_named(&git, &store, &project.id, &issue.title, None, None, Some(serde_json::json!({ "madeBy": "app", "issue": issue.number, "issueUrl": issue.url })))?;
    Ok(made)
}

/// PROJ-070: what deleting a workspace would lose or run into, read when the question opens.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveCheck {
    /// Uncommitted and untracked changes, as `git status --porcelain` lists them.
    pub changes: Vec<String>,
    /// The lock reason when Git has the worktree locked (empty when none was given).
    pub locked: Option<String>,
    /// Other worktrees of the repository that sit inside this folder.
    pub nested: Vec<String>,
    /// What the workspace looked like when asked; a delete carrying another stamp is refused.
    pub stamp: String,
    /// PROJ-072: the folder is already gone while Git still lists it; deleting only tidies the record.
    pub missing: bool,
    /// T-613: commits on its branch (or detached HEAD) that no other branch and no remote holds,
    /// newest first as `<short id> <subject>`: deleting the branch would lose them.
    pub commits: Vec<String>,
}

/// T-613: the commits deleting `w`'s branch would lose: reachable from its branch (or a detached
/// HEAD) and from no other local branch and no remote-tracking branch. Reads only refs Git already
/// has, never the network; an unborn branch has none. T-613b: a read that fails (a broken ref, a
/// git error) is an error, never "nothing to lose", so the branch is kept.
/// ponytail: every such commit comes back, one short line each, so a branch with thousands never
/// pushed sends thousands of lines; count with `rev-list --count` and list the first few if one shows up.
fn only_here(_git: &Git, repo: &Path, branch: Option<&str>, head: &str) -> Result<Vec<String>, String> {
    // T-613b: a detached worktree whose HEAD Git could not tell has commits Kolux cannot see.
    if branch.is_none() && head.is_empty() {
        return Err(UNREAD_HEAD.into());
    }
    let rev = branch.map_or_else(|| head.to_string(), |b| format!("refs/heads/{b}"));
    if !Git::ref_ok(&rev) {
        return Err(format!("{rev} cannot be read as a branch"));
    }
    if branch.is_some() {
        // for-each-ref lists nothing for a ref that is not there (an unborn branch) and fails on a broken one.
        let listed = crate::git::run(&["for-each-ref", "--format=%(refname)", &rev], Some(repo)).map_err(|_| UNREAD_BRANCH.to_string())?;
        if !listed.lines().any(|l| l == rev) {
            return Ok(Vec::new());
        }
    }
    // `--exclude` drops the branch itself from the `--branches` it comes before (a ref name has no glob characters).
    let itself = branch.map(|b| format!("--exclude={b}"));
    let mut args = vec!["log", "--format=%h %s", rev.as_str(), "--not"];
    args.extend(itself.as_deref());
    args.extend(["--branches", "--remotes", "--"]);
    crate::git::run(&args, Some(repo)).map(|out| out.lines().map(str::to_string).collect()).map_err(|_| if branch.is_some() { UNREAD_BRANCH } else { UNREAD_HEAD }.to_string())
}

/// T-613b: why a delete is refused when the commits it could lose cannot be read.
const UNREAD_BRANCH: &str = "Kolux could not read this branch, so it was left in place.";
const UNREAD_HEAD: &str = "Kolux could not read this workspace's commit, so it was left in place.";

pub fn remove_check(git: &Git, project: &Project, worktree_path: &str) -> Result<RemoveCheck, String> {
    let all = git.worktrees(Path::new(&project.path))?;
    let target = all.iter().find(|w| same_folder(Path::new(&w.path), Path::new(worktree_path))).ok_or_else(|| format!("{worktree_path} is not a worktree of {}", project.name))?;
    if target.is_main {
        return Err("the main checkout cannot be removed; remove the project instead".to_string());
    }
    // PROJ-072: a folder that is already gone has no changes to lose; deleting it is cleanup.
    let missing = !Path::new(&target.path).exists();
    let mut changes = if missing { Vec::new() } else { git.status_lines(Path::new(&target.path))? };
    // GIT-013: work inside the worktree's submodules goes with it, so it is named in the changes.
    if !missing {
        changes = crate::sub_work::annotate(changes, &crate::sub_work::unsaved(Path::new(&target.path)).unwrap_or_default());
    }
    let here = Path::new(&target.path);
    // ponytail: only this repository's worktrees count as nested; other projects' folders inside it are not looked for.
    let nested = all.iter().filter(|w| Path::new(&w.path).ancestors().skip(1).any(|a| same_folder(a, here))).map(|w| w.path.clone()).collect();
    let stamp = format!("{}|{}", target.head, changes.join("|"));
    let commits = only_here(git, Path::new(&project.path), target.branch.as_deref(), &target.head)?;
    Ok(RemoveCheck { changes, locked: target.locked.clone(), nested, stamp, missing, commits })
}

/// Why a delete must not go ahead (PROJ-070), or `None` when it may: the workspace changed
/// since the question was asked, holds another worktree, is locked (never forced), or has
/// changes and the user did not choose to lose them.
pub fn removal_refused(now: &RemoveCheck, force: bool, asked: &str) -> Option<String> {
    if now.stamp != asked {
        return Some("This workspace changed after you were asked. Look again before deleting it.".into());
    }
    if let Some(first) = now.nested.first() {
        return Some(format!("This folder holds another workspace ({first}). Delete that one first."));
    }
    if let Some(reason) = &now.locked {
        let why = if reason.is_empty() { String::new() } else { format!(" ({reason})") };
        return Some(format!("This workspace is locked{why}, and Kolux never force-deletes a locked one. Unlock it with git worktree unlock first."));
    }
    if !now.changes.is_empty() && !force {
        let n = now.changes.len();
        let subs = crate::sub_work::note(&now.changes).map(|w| format!(" {w}")).unwrap_or_default();
        return Some(format!("{n} uncommitted or untracked change{} would be lost.{subs} Tick Delete my changes too to delete it anyway.", if n == 1 { "" } else { "s" }));
    }
    None
}

pub(crate) fn find_project(store: &Store, id: &str) -> Result<Project, String> {
    load_projects(store).into_iter().find(|p| p.id == id).ok_or_else(|| "that project is no longer registered".to_string())
}

type StoreState<'a> = State<'a, Mutex<Store>>;

#[tauri::command]
pub fn git_version(git: State<'_, Git>) -> String {
    git.version.clone()
}

#[tauri::command]
pub fn project_list(store: StoreState<'_>) -> Result<Vec<Project>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(load_projects(&store))
}

#[tauri::command(async)]
pub fn project_add(git: State<'_, Git>, store: StoreState<'_>, path: String) -> Result<Project, String> {
    let found = locate_repo(&git, Path::new(path.trim()))?;
    register_project(&*store.lock().map_err(|e| e.to_string())?, found)
}

/// A project's workspaces and the ones made outside Kolux that were not seen yet (T-442-c).
#[derive(Debug, serde::Serialize)]
pub struct Scanned {
    pub list: Vec<Worktree>,
    pub unseen: Vec<Worktree>,
}

/// Both answers, the workspaces and the unseen ones, from one scan of one project.
pub fn scanned_of(store: &Store, project: &Project, all: Vec<Worktree>) -> Result<Scanned, String> {
    let list = decorate(store, project, all)?;
    let unseen = unseen_in(store, project, list.clone())?;
    Ok(Scanned { list, unseen })
}

/// The sidebar's poll: one `git worktree list` per project instead of one per command.
#[tauri::command]
pub async fn workspace_scan(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Scanned, String> {
    let (project, all) = scan(&git, &store, &project_id)?;
    scanned_of(&*store.lock().map_err(|e| e.to_string())?, &project, all)
}

#[tauri::command]
pub async fn workspace_seen(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<(), String> {
    let (project, all) = scan(&git, &store, &project_id)?;
    let keys: Vec<String> = all.iter().map(|w| name_key(&w.path)).collect();
    save_seen(&*store.lock().map_err(|e| e.to_string())?, &project, &keys)
}

/// T-442 (TERM-115): a project's worktrees as Git lists them, with the store let go while git runs,
/// so a terminal printing a pull request link never waits on it. The commands that call this are
/// async, so they run off the window's thread and typing never queues behind a slow git.
/// ponytail: git still blocks one async worker while it runs; spawn_blocking if workers ever starve.
fn scan(git: &Git, store: &Mutex<Store>, project_id: &str) -> Result<(Project, Vec<Worktree>), String> {
    let (project, folder) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = find_project(&store, project_id)?;
        // PROJ-005: a folder project has its one folder workspace, until Git is started in it.
        let folder = crate::folder_projects::folder_only(&store, &project);
        (project, folder)
    };
    if let Some(only) = folder {
        return Ok((project, vec![only]));
    }
    let all = git.worktrees(Path::new(&project.path))?;
    Ok((project, all))
}

/// SET-032 / PROJ-042: the visibility sources, with the global choice and `project_id`'s own.
#[tauri::command]
pub fn visibility_get(store: StoreState<'_>, project_id: Option<String>) -> Result<Vec<crate::visibility::Source>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = project_id.map(|id| find_project(&store, &id)).transpose()?;
    Ok(crate::visibility::sources(&store, project.as_ref()))
}

/// Sets the global choice for a source, or a project's own (`show` empty: back to the global).
#[tauri::command]
pub fn visibility_set(store: StoreState<'_>, project_id: Option<String>, source: String, show: Option<bool>) -> Result<(), String> {
    crate::visibility::set_choice(&*store.lock().map_err(|e| e.to_string())?, project_id.as_deref(), &source, show)
}

#[tauri::command]
pub fn visibility_root_add(store: StoreState<'_>, path: String) -> Result<(), String> {
    crate::visibility::add_root(&*store.lock().map_err(|e| e.to_string())?, &path)
}

#[tauri::command]
pub fn visibility_root_remove(store: StoreState<'_>, path: String) -> Result<(), String> {
    crate::visibility::remove_root(&*store.lock().map_err(|e| e.to_string())?, &path)
}

/// PROJ-042: hide a worktree from the sidebar, or show it again.
#[tauri::command]
pub fn workspace_hide(store: StoreState<'_>, path: String, hidden: bool) -> Result<(), String> {
    set_hidden(&*store.lock().map_err(|e| e.to_string())?, &path, hidden)
}

/// PROJ-059: the inline rename. The sidebar trims the name and turns shortcodes into emoji first;
/// a blank name is refused here too, so no caller can wipe a name by accident.
pub fn rename(store: &Store, path: &str, name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("A workspace name cannot be blank".into());
    }
    set_name(store, path, Some(n))?;
    Ok(n.to_string())
}

#[tauri::command]
pub fn workspace_rename(store: StoreState<'_>, path: String, name: String) -> Result<String, String> {
    rename(&*store.lock().map_err(|e| e.to_string())?, &path, &name)
}

// ---- PROJ-039 / GIT-020 / SET-031: the branch is renamed to fit the work -----------------------

/// SET-031: branches get renamed after the work done on them; on unless this is false.
pub const RENAME_SETTING: &str = "renameBranches";
/// Workspaces whose name Kolux invented (keyed like the names); only these are ever renamed by
/// themselves, and a hand rename or the first automatic rename takes the mark away.
const SUGGESTED_KEY: &str = "workspaceSuggested";
/// The longest slug a rename makes, cut at a word edge.
pub const SLUG_MAX: usize = 40;

pub fn rename_enabled(settings: &serde_json::Value) -> bool {
    settings[RENAME_SETTING].as_bool() != Some(false)
}

/// STAT-039 (T-110-b): whether a renamed branch's folder is offered a new name too (on by
/// default); off keeps the folder while the branch and the shown name still change.
pub const RENAME_FOLDERS_SETTING: &str = "renameFolders";

pub fn rename_folders_enabled(settings: &serde_json::Value) -> bool {
    settings[RENAME_FOLDERS_SETTING].as_bool() != Some(false)
}

fn suggested_map(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(SUGGESTED_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// PROJ-039: marks (or unmarks) the workspace at `path` as one whose name Kolux suggested.
pub fn mark_suggested(store: &Store, path: &str, on: bool) -> Result<(), String> {
    let mut map = suggested_map(store);
    let changed = if on { map.insert(name_key(path), serde_json::Value::Bool(true)).is_none() } else { map.remove(&name_key(path)).is_some() };
    if !changed {
        return Ok(());
    }
    store.set(SUGGESTED_KEY, &serde_json::Value::Object(map).to_string()).map_err(|e| e.to_string())
}

/// PROJ-039: the branch name an agent's reply proposes, cleaned to a short lowercase hyphenated
/// slug. A reply that repeats the branch prefix has it removed; a reply that is only the prefix, or
/// nothing usable, gives `None`. Only the first line is read.
pub fn branch_slug(reply: &str, prefix: &str) -> Option<String> {
    let line = reply.lines().map(|l| l.trim().trim_matches(|c: char| matches!(c, '`' | '"' | '\'' | '*')).trim()).find(|l| !l.is_empty())?;
    let mut rest = line;
    let prefix = prefix.trim();
    if !prefix.is_empty() {
        let bare = prefix.trim_end_matches('/');
        let low = line.to_lowercase();
        let p = prefix.to_lowercase();
        if low.starts_with(&p) && line.is_char_boundary(p.len()) {
            rest = &line[p.len()..];
        } else if low == bare.to_lowercase() {
            return None;
        }
    }
    let cleaned = safe_name(rest)?.replace('.', "-");
    let mut out = String::new();
    for part in cleaned.split('-').filter(|p| !p.is_empty()) {
        let next = if out.is_empty() { part.len() } else { out.len() + 1 + part.len() };
        if next > SLUG_MAX && !out.is_empty() {
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(part);
    }
    let out: String = out.chars().take(SLUG_MAX).collect();
    let out = out.trim_matches('-').to_string();
    (!out.is_empty()).then_some(out)
}

/// PROJ-039: the readable form of a branch's last part: `fix-login-bug` shows as `Fix login bug`.
pub fn sentence_case(slug: &str) -> String {
    let words = slug.rsplit('/').next().unwrap_or(slug).replace(['-', '_'], " ");
    let mut chars = words.trim().chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// What a rename after the work did: whether it ran, why not when it did not, the names, and the
/// upstream the branch tracks (its commits and tracking stay with it).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAnswer {
    pub renamed: bool,
    pub reason: Option<String>,
    pub old: Option<String>,
    pub branch: Option<String>,
    pub name: Option<String>,
    pub tracking: Option<String>,
    /// STAT-039: the folder's proposed new last part, when the branch was renamed, folder renaming
    /// is on and the folder's name differs; the user is asked before `move_folder` runs.
    pub folder: Option<String>,
}

fn left_alone(why: &str) -> RenameAnswer {
    RenameAnswer { reason: Some(why.to_string()), ..Default::default() }
}

/// PROJ-039 / GIT-020: renames the branch of the workspace at `path` after the work begun in it,
/// from the agent's `reply`. It only ever renames (`git branch -m`: nothing is deleted or
/// overwritten) and only when the setting is on, the workspace is a Kolux-suggested one nobody
/// named by hand, and it is not the main checkout. The folder stays where it is (the agent holds it;
/// T-110-b). A failed rename comes back as the full Git output. The store is not locked while Git works.
pub fn rename_after_work(git: &Git, store: &Mutex<Store>, project: &Project, path: &str, reply: &str) -> Result<RenameAnswer, String> {
    let (settings, eligible) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (store.settings(), suggested_map(&store).contains_key(&name_key(path)) && !load_names(&store).contains_key(&name_key(path)))
    };
    if !rename_enabled(&settings) {
        return Ok(left_alone("Branch renaming is off in Settings."));
    }
    if !eligible {
        return Ok(left_alone("This workspace has a name of its own, so its branch keeps it."));
    }
    let repo = Path::new(&project.path);
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(w) = git.worktrees(repo)?.into_iter().find(|w| name_key(&w.path) == name_key(path)) else {
        return Ok(left_alone("That workspace is not listed by Git."));
    };
    let Some(old) = w.branch.clone().filter(|_| !w.is_main) else {
        return Ok(left_alone("Only a workspace's own branch is renamed."));
    };
    // T-107-d: a branch somebody already renamed (its last part no longer names the folder) has a
    // name of its own; a pushed branch, or one with a pull request, keeps the name the remote knows.
    if !crate::scm::writers::is_placeholder(&old, Path::new(&w.path).file_name().and_then(|n| n.to_str()).unwrap_or("")) {
        return Ok(left_alone("The branch already has a name of its own."));
    }
    if git.upstream_of(repo, &old).is_some() || git.tracks_remote(repo, &old) || git.on_remote(repo, &old) {
        return Ok(left_alone("The branch was pushed, so it keeps the name the remote knows."));
    }
    if linked_pr(&*store.lock().map_err(|e| e.to_string())?, path) {
        return Ok(left_alone("The branch has a pull request, so it keeps its name."));
    }
    let prefix = place_from(project, &settings).prefix;
    let Some(slug) = branch_slug(reply, &prefix) else {
        return Ok(left_alone("The reply did not hold a usable branch name."));
    };
    let new = (1..50)
        .map(|n| if n == 1 { format!("{prefix}{slug}") } else { format!("{prefix}{slug}-{n}") })
        .find(|c| *c == old || !git.branch_taken(repo, c))
        .ok_or("no free branch name")?;
    if new == old {
        return Ok(left_alone("The branch already has that name."));
    }
    // GIT-020: the upstream is read first, so the answer says what tracking the branch keeps.
    let tracking = git.upstream_of(repo, &old);
    git.rename_branch(repo, &old, &new)?;
    let shown = sentence_case(&new);
    // STAT-039: the folder may follow the branch's last part, after a question (never here).
    let folder = rename_folders_enabled(&settings)
        .then(|| new.rsplit('/').next().unwrap_or(&new).to_string())
        .filter(|f| Path::new(&w.path).file_name().and_then(|n| n.to_str()).is_none_or(|have| !have.eq_ignore_ascii_case(f)));
    let store = store.lock().map_err(|e| e.to_string())?;
    set_name(&store, path, Some(&shown))?;
    mark_suggested(&store, path, false)?;
    Ok(RenameAnswer { renamed: true, reason: None, old: Some(old), branch: Some(new), name: Some(shown), tracking, folder })
}

/// STAT-039 (T-110-b): moves the workspace folder at `path` to `name` beside it, once the user
/// said yes to the offer. It is `git worktree move` (Git's own records follow) and never deletes
/// or overwrites: a folder already at the new place refuses, and a folder a terminal or agent
/// holds open comes back as Git's complete error, with nothing changed. What Kolux remembers about
/// the folder follows it (`rekey_workspace`). The new path comes back.
pub fn move_folder(git: &Git, store: &Mutex<Store>, path: &str, name: &str) -> Result<String, String> {
    if name.trim().is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':']) {
        return Err(format!("{name:?} is not a folder name."));
    }
    let from = Path::new(path);
    let to = from.parent().ok_or("The workspace folder has no parent folder.")?.join(name);
    if to.exists() {
        return Err(format!("{} already exists, so nothing was moved.", to.display()));
    }
    let project = project_for_path(git, &*store.lock().map_err(|e| e.to_string())?, path).ok_or("That folder is not a workspace Kolux knows.")?;
    let repo = Path::new(&project.path);
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if !git.worktrees(repo)?.iter().any(|w| name_key(&w.path) == name_key(path) && !w.is_main) {
        return Err("Only a workspace's own folder is moved, never the main checkout.".to_string());
    }
    git.worktree_move(repo, from, &to)?;
    let to = to.to_string_lossy().to_string();
    rekey_workspace(&*store.lock().map_err(|e| e.to_string())?, &project, path, &to)?;
    Ok(to)
}

/// Moves everything Kolux keeps by workspace path from `from` to `to`: the typed name, parent
/// (as a child and as a parent), origin, hidden flag, suggested mark, seen entry and note. The
/// activity time is stamped afresh under the new path.
fn rekey_workspace(store: &Store, project: &Project, from: &str, to: &str) -> Result<(), String> {
    let (old, new) = (name_key(from), name_key(to));
    for key in [NAMES_KEY, PARENTS_KEY, ORIGINS_KEY, HIDDEN_KEY, SUGGESTED_KEY] {
        let mut map = load_map(store, key);
        let moved = map.remove(&old).map(|v| map.insert(new.clone(), v)).is_some();
        let mut parents_changed = false;
        if key == PARENTS_KEY {
            for v in map.values_mut().filter(|v| v.as_str().is_some_and(|p| name_key(p) == old)) {
                *v = to.into();
                parents_changed = true;
            }
        }
        if moved || parents_changed {
            store.set(key, &serde_json::Value::Object(map).to_string()).map_err(|e| e.to_string())?;
        }
    }
    if let Some(seen) = seen_of(store, project).filter(|s| s.contains(&old)) {
        save_seen(store, project, seen.iter().filter(|k| **k != old).chain(std::iter::once(&new)))?;
    }
    let note_key = |k: &str| format!("{NOTE_PREFIX}{k}");
    if let Some(note) = store.get(&note_key(&old)).map_err(|e| e.to_string())?.filter(|n| !n.is_empty()) {
        store.set_all(&[(&note_key(&new), &note), (&note_key(&old), "")]).map_err(|e| e.to_string())?;
    }
    crate::activity::touch(store, to)
}

#[tauri::command(async)]
pub fn workspace_move_folder(git: State<'_, Git>, store: StoreState<'_>, path: String, name: String) -> Result<String, String> {
    move_folder(&git, &store, &path, &name)
}

/// Whether the workspace at `path` is linked to a pull request (PROJ-060's details), in which
/// case its branch is never renamed by itself.
fn linked_pr(store: &Store, path: &str) -> bool {
    matches!(details_of(store, path).item.as_deref().map(parse_item), Some(Ok(Some(ItemLink::Pr(_)))))
}

/// T-107-d: the project a workspace at `path` belongs to: the one that saw it being made, else
/// the one whose own folder holds it, else the one whose Git lists it as a worktree.
pub fn project_for_path(git: &Git, store: &Store, path: &str) -> Option<Project> {
    let key = name_key(path);
    let projects = load_projects(store);
    if let Some(p) = projects.iter().find(|p| seen_of(store, p).is_some_and(|s| s.contains(&key))) {
        return Some(p.clone());
    }
    if let Some(p) = projects.iter().find(|p| name_key(&p.path) == key || key.starts_with(&format!("{}/", name_key(&p.path).trim_end_matches('/')))) {
        return Some(p.clone());
    }
    projects.into_iter().find(|p| git.worktrees(Path::new(&p.path)).is_ok_and(|ws| ws.iter().any(|w| name_key(&w.path) == key)))
}

/// Whether the workspace at `path` may still be renamed by its first work (the cheap checks only,
/// so no agent is asked for a name the rename would refuse anyway).
/// A folder project (`plain`) has no suggested mark: its one workspace is a placeholder until it
/// is named, by a title typed for the workspace or a display name for the project (STAT-039).
fn rename_wanted(store: &Mutex<Store>, project: &Project, plain: bool, path: &str) -> Result<bool, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let placeholder = if plain { project.display_name.is_none() } else { suggested_map(&store).contains_key(&name_key(path)) };
    Ok(rename_enabled(&store.settings()) && placeholder && !load_names(&store).contains_key(&name_key(path)))
}

/// PROJ-039 / STAT-039 (T-107-d, T-110-b): the first prompt an agent gets in the workspace at
/// `path` names its branch. The configured `writer` proposes the name from the task; when there is
/// none, or it answers nothing usable, the task's own words name it. Everything that would refuse the
/// rename is checked before any agent runs, and the rename itself is `rename_after_work` with all its
/// guards, so a second prompt, a hand-named workspace, a pushed branch or one with a pull request
/// changes nothing.
pub fn rename_on_first_prompt(git: &Git, store: &Mutex<Store>, path: &str, task: &str, writer: Option<&crate::scm::writers::WriterArg>) -> Result<RenameAnswer, String> {
    let task = task_words(task);
    if task.is_empty() {
        return Ok(left_alone("The prompt held nothing that could name a branch."));
    }
    let (project, plain) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = project_for_path(git, &store, path);
        let plain = project.as_ref().is_some_and(|p| crate::folder_projects::folder_only(&store, p).is_some());
        (project, plain)
    };
    let Some(project) = project else {
        return Ok(left_alone("That folder is not a workspace Kolux knows."));
    };
    if !rename_wanted(store, &project, plain, path)? {
        return Ok(left_alone("This workspace has a name of its own, so its branch keeps it."));
    }
    let reply = writer_reply(writer, &task, &|w, prompt| crate::scm::writers::ask(w, prompt, Path::new(path), &format!("name:{path}"), std::time::Duration::from_secs(60)));
    if plain {
        // STAT-039: a plain folder without Git has no branch and keeps its folder: it only gets a title.
        let Some(slug) = branch_slug(&reply, "") else {
            return Ok(left_alone("The reply did not hold a usable name."));
        };
        let shown = sentence_case(&slug);
        let store = store.lock().map_err(|e| e.to_string())?;
        set_name(&store, path, Some(&shown))?;
        mark_suggested(&store, path, false)?;
        return Ok(RenameAnswer { renamed: true, name: Some(shown), ..Default::default() });
    }
    rename_after_work(git, store, &project, path, &reply)
}

/// The name the writer proposes for `task`, else the task's own words. A writer that names no agent
/// and no command counts as none (row 931): `ask` would otherwise start Claude Code with AI off.
fn writer_reply(writer: Option<&crate::scm::writers::WriterArg>, task: &str, asker: &dyn Fn(&crate::scm::writers::WriterArg, &str) -> Result<String, String>) -> String {
    writer
        .filter(|w| crate::scm::writers::writer_chosen(w))
        .and_then(|w| asker(w, &crate::scm::writers::name_prompt(task)).ok())
        .map(|r| r.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string())
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| task.to_string())
}

/// STAT-039: the task's words without stray work-item markers (`#123`, `KOL-12`, `[KOL-12]`,
/// `(#12)`), so a marker never becomes the branch name; a prompt that is only markers gives nothing.
pub fn task_words(task: &str) -> String {
    let is_marker = |w: &str| {
        let w = w.trim_matches(|c: char| matches!(c, '[' | ']' | '(' | ')' | ':' | ',' | '.'));
        let bare = w.strip_prefix('#').unwrap_or(w);
        if bare.is_empty() {
            return false;
        }
        if bare.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
        match bare.split_once('-') {
            Some((key, num)) => key.len() >= 2 && key.chars().all(|c| c.is_ascii_uppercase()) && !num.is_empty() && num.chars().all(|c| c.is_ascii_digit()),
            None => false,
        }
    };
    task.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").split_whitespace().filter(|w| !is_marker(w)).collect::<Vec<_>>().join(" ")
}

#[tauri::command(async)]
pub fn workspace_rename_on_first_prompt(git: State<'_, Git>, store: StoreState<'_>, path: String, task: String, writer: Option<crate::scm::writers::WriterArg>) -> Result<RenameAnswer, String> {
    rename_on_first_prompt(&git, &store, &path, &task, writer.as_ref())
}

// ---- PROJ-060: a workspace's details: shown name, linked GitHub item, comment ---------------------

/// The longest comment a workspace keeps.
pub const COMMENT_MAX: usize = 8 * 1024;

/// What the details form shows and saves.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    /// The typed name; none means the branch names the row.
    pub name: Option<String>,
    /// The linked item as an address (or `#12` for a bare issue number); none when unlinked.
    pub item: Option<String>,
    pub comment: String,
}

/// A linked GitHub item: an issue (number, address if known) or a pull request (address).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ItemLink {
    Issue(u64, Option<String>),
    Pr(String),
}

/// What a pasted link-field text means: blank clears; an issue or pull request address on any host
/// (an Enterprise address counts, `/files` and the like after the number are dropped); a bare
/// number (with or without `#`) is an issue of the project's own repository. Anything else is refused.
pub fn parse_item(text: &str) -> Result<Option<ItemLink>, String> {
    let t = text.trim();
    if t.is_empty() {
        return Ok(None);
    }
    let bare = t.trim_start_matches('#');
    if !bare.is_empty() && bare.chars().all(|c| c.is_ascii_digit()) {
        return match bare.parse::<u64>() {
            Ok(n) if n > 0 => Ok(Some(ItemLink::Issue(n, None))),
            _ => Err("an issue number is 1 or more".into()),
        };
    }
    let rest = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://")).ok_or_else(|| format!("{t} is not an issue or pull request address or number"))?;
    let parts: Vec<&str> = rest.split(['?', '#']).next().unwrap_or("").split('/').collect();
    if parts.len() < 5 || parts[0].is_empty() || parts[1].is_empty() || parts[2].is_empty() {
        return Err(format!("{t} is not an issue or pull request address or number"));
    }
    let n = parts[4].parse::<u64>().ok().filter(|n| *n > 0).ok_or_else(|| format!("{t} has no issue or pull request number"))?;
    let host = parts[0].to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    match parts[3].to_lowercase().as_str() {
        "pull" => Ok(Some(ItemLink::Pr(format!("https://{host}/{}/{}/pull/{n}", parts[1], parts[2])))),
        "issues" => Ok(Some(ItemLink::Issue(n, Some(format!("https://{host}/{}/{}/issues/{n}", parts[1], parts[2]))))),
        _ => Err(format!("{t} is not an issue or pull request address")),
    }
}

/// PROJ-060: what the details form starts with for the workspace at `path`.
pub fn details_of(store: &Store, path: &str) -> Details {
    let o = origin(store, path).unwrap_or_default();
    let item = o["issueUrl"].as_str().or_else(|| o["pr"].as_str()).map(String::from).or_else(|| o["issue"].as_u64().map(|n| format!("#{n}")));
    Details { name: load_names(store).get(&name_key(path)).and_then(|v| v.as_str()).map(String::from), item, comment: o["comment"].as_str().unwrap_or_default().to_string() }
}

/// PROJ-060: saves the details. A blank name goes back to the branch name; a blank link or comment
/// clears it. A refused link or an over-long comment writes nothing at all.
pub fn save_details(store: &Store, path: &str, name: &str, item: &str, comment: &str) -> Result<Details, String> {
    let link = parse_item(item)?;
    if comment.len() > COMMENT_MAX {
        return Err(format!("the comment is {} KB; a comment holds at most {} KB", comment.len().div_ceil(1024), COMMENT_MAX / 1024));
    }
    let n = name.trim();
    set_name(store, path, if n.is_empty() { None } else { Some(n) })?;
    let mut o = origin(store, path).filter(serde_json::Value::is_object).unwrap_or_else(|| serde_json::json!({}));
    // T-780 (review P2-1): a pull request once linked leaves its sticky marker, records written
    // before the marker existed included, so clearing or replacing `pr` never restores pre-trust.
    if !o["pr"].is_null() && !matches!(o["pr"].as_str(), Some(u) if u.trim().is_empty()) {
        o[PR_EVER_KEY] = true.into();
    }
    o["issue"] = serde_json::Value::Null;
    o["issueUrl"] = serde_json::Value::Null;
    o["pr"] = serde_json::Value::Null;
    match link {
        Some(ItemLink::Issue(num, url)) => {
            o["issue"] = num.into();
            o["issueUrl"] = url.map_or(serde_json::Value::Null, Into::into);
        }
        Some(ItemLink::Pr(url)) => o["pr"] = url.into(),
        None => {}
    }
    let c = comment.trim();
    o["comment"] = if c.is_empty() { serde_json::Value::Null } else { c.into() };
    set_origin(store, path, Some(&o))?;
    Ok(details_of(store, path))
}

#[tauri::command]
pub fn workspace_details_get(store: StoreState<'_>, path: String) -> Result<Details, String> {
    Ok(details_of(&*store.lock().map_err(|e| e.to_string())?, &path))
}

#[tauri::command]
pub fn workspace_details_save(store: StoreState<'_>, path: String, name: String, item: String, comment: String) -> Result<Details, String> {
    save_details(&*store.lock().map_err(|e| e.to_string())?, &path, &name, &item, &comment)
}

/// PROJ-053: putting workspaces to sleep ends their terminals; the folders and branches stay, and
/// the sidebar keeps the list of who sleeps. Returns how many terminals were ended.
/// STAT-037 (T-167-b): the agents in them that can be resumed are recorded first.
#[tauri::command]
pub fn workspace_sleep(terminals: State<'_, crate::terminal::Terminals>, store: StoreState<'_>, paths: Vec<String>) -> usize {
    if let Ok(store) = store.lock() {
        crate::hooks::agent_hooks::saved::at_sleep(&store, &paths);
    }
    paths.iter().map(|p| terminals.kill_under(Path::new(p)).ended).sum()
}

#[tauri::command]
pub async fn workspace_list(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Vec<Worktree>, String> {
    let (project, all) = scan(&git, &store, &project_id)?;
    decorate(&*store.lock().map_err(|e| e.to_string())?, &project, all)
}

/// What a typed name becomes (PROJ-021 / PROJ-025): the branch, and the folder it would get in
/// the project; `branch` (Advanced) names the branch instead of the name (SESS-037).
#[derive(serde::Serialize)]
pub struct Preview {
    pub branch: String,
    pub folder: String,
}

/// `place_from` with the settings read from `store`.
#[cfg(test)]
pub fn place_for(store: &Store, project: &Project) -> Place {
    place_from(project, &store.settings())
}

// T-442-b: the prefix asks Git for the user name, so this runs off the window thread too.
#[tauri::command(async)]
pub fn workspace_preview(store: StoreState<'_>, name: String, project_id: Option<String>, branch: Option<String>) -> Result<Option<Preview>, String> {
    let typed = non_blank(branch.as_deref()).unwrap_or(&name);
    let branch = safe_name(typed).unwrap_or_else(|| "workspace".to_string());
    let folder = match project_id.filter(|id| !id.is_empty()) {
        Some(id) => {
            let (project, place) = locked_place(&store, &id)?;
            let folder = workspace_path(&place, &project, &branch).display().to_string();
            return Ok(Some(Preview { branch: format!("{}{branch}", place.prefix), folder }));
        }
        None => String::new(),
    };
    Ok(Some(Preview { branch, folder }))
}

/// Project `project_id` and where its workspaces go: the store is locked only to read them, and
/// Git (the user name behind the prefix) runs after it is let go (T-442-b).
fn locked_place(store: &Mutex<Store>, project_id: &str) -> Result<(Project, Place), String> {
    let (project, settings) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (find_project(&store, project_id)?, store.settings())
    };
    let place = place_from(&project, &settings);
    Ok((project, place))
}

/// Makes a workspace in a registered project and keeps the typed name (the sidebar's Create and
/// `kolux-dev worktree create` both come through here). `branch` (the composer's Advanced) names
/// the branch in place of the name (SESS-037). `origin` is the caller's record for the new
/// worktree (its `madeBy` and details), `{ "madeBy": "app" }` when None; T-780: it is written once,
/// by `record_made`, with the trust marker decided in that same write.
pub fn create_named(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>, branch: Option<&str>, origin: Option<serde_json::Value>) -> Result<Created, String> {
    create_named_until(git, store, project_id, name, base, branch, origin, &|| false)
}

/// `create_named` with the overtaken checks of `create_workspace_until` (PROJ-020).
#[allow(clippy::too_many_arguments)]
pub fn create_named_until(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>, branch: Option<&str>, origin: Option<serde_json::Value>, overtaken: &dyn Fn() -> bool) -> Result<Created, String> {
    let (project, place) = locked_place(store, project_id)?;
    let mut made = create_workspace_until(git, &place, &project, non_blank(branch).unwrap_or(name), base, overtaken)?;
    record_made(&*store.lock().map_err(|e| e.to_string())?, &project, &made, origin.unwrap_or_else(|| serde_json::json!({ "madeBy": "app" })))?;
    let typed = name.trim();
    if typed != made.worktree.branch.as_deref().unwrap_or_default() {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_name(&store, &made.worktree.path, Some(typed))?;
        made.worktree.name = Some(typed.to_string());
    }
    Ok(made)
}

// PROJ-020: off the main thread, so a newer create (and its cancel) can reach Kolux while Git works.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn workspace_create(git: State<'_, Git>, store: StoreState<'_>, project_id: String, name: String, base: Option<String>, branch: Option<String>, parent: Option<String>, ticket: Option<u64>, issue: Option<crate::pr_checkout::Linkable>, active_folder: Option<String>, suggested: Option<bool>) -> Result<Created, String> {
    // SESS-036: linked to the issue the composer named it from (the `issue:` selector finds it);
    // T-780: the link rides in the first record, where the trust marker is decided.
    let origin = issue.map(|i| serde_json::json!({ "madeBy": "app", "issue": i.number, "issueUrl": i.url }));
    let made = create_named_until(&git, &store, &project_id, &name, base.as_deref(), branch.as_deref(), origin, &|| dropped(ticket));
    if let Some(t) = ticket {
        settle_create(t);
    }
    let mut made = made?;
    // SESS-037: the parent picked in the composer (PROJ-047 nests it there, PROJ-040 checks it).
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        // PROJ-039 (T-107-d): a name the composer suggested and the user left alone may be renamed by the first work.
        if suggested == Some(true) && branch.is_none() {
            mark_suggested(&store, &made.worktree.path, true)?;
        }
        find_project(&store, &project_id)?
    };
    nest_under(&git, &store, &project, &mut made, parent.as_deref(), active_folder.as_deref())?;
    let _ = crate::activity::touch(&*store.lock().map_err(|e| e.to_string())?, &made.worktree.path); // PROJ-051
    Ok(made)
}

/// A fresh creature-named workspace in project `project_id`; see `create_fresh_workspace` for
/// how the store stays unlocked while Git works.
pub fn create_fresh(git: &Git, store: &Mutex<Store>, project_id: &str) -> Result<Worktree, String> {
    create_fresh_from(git, store, project_id, None)
}

/// As `create_fresh`, cut from `base` (a ref) when given, else the project's base (AUTO-005).
pub fn create_fresh_from(git: &Git, store: &Mutex<Store>, project_id: &str, base: Option<&str>) -> Result<Worktree, String> {
    let lock = || store.lock().map_err(|e| e.to_string());
    let (project, place) = locked_place(store, project_id)?;
    let projects = load_projects(&*lock()?);
    create_fresh_workspace(git, lock, &place, &projects, &project, base)
}

#[tauri::command(async)]
pub fn workspace_create_fresh(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Worktree, String> {
    create_fresh(&git, &store, &project_id)
}

/// PROJ-028 / CLI-015: saves the ref new workspaces of project `id` start from; None goes back to
/// the default branch Git reports.
pub fn set_base(store: &Store, id: &str, base: Option<&str>) -> Result<Project, String> {
    let mut projects = load_projects_for_write(store)?;
    let project = projects.iter_mut().find(|p| p.id == id).ok_or("that project is no longer registered")?;
    project.base = base.map(String::from);
    let project = project.clone();
    save_projects(store, &projects)?;
    Ok(project)
}

/// PROJ-025 / PROJ-028: a project's own workspaces folder and base ref; empty clears either.
#[tauri::command]
pub fn project_set(store: StoreState<'_>, project_id: String, workspaces_dir: String, base: String) -> Result<Project, String> {
    set_project_options(&*store.lock().map_err(|e| e.to_string())?, &project_id, &workspaces_dir, &base)
}

fn set_project_options(store: &Store, project_id: &str, workspaces_dir: &str, base: &str) -> Result<Project, String> {
    let mut projects = load_projects_for_write(store)?;
    let project = projects.iter_mut().find(|p| p.id == project_id).ok_or("that project is no longer registered")?;
    let clean = |s: &str| Some(s.trim().to_string()).filter(|s| !s.is_empty());
    project.workspaces_dir = clean(workspaces_dir);
    project.base = clean(base);
    let project = project.clone();
    save_projects(store, &projects)?;
    remember_dir(store, workspaces_dir)?;
    Ok(project)
}

/// The longest display name kept, in characters.
pub const DISPLAY_NAME_MAX: usize = 80;

/// SET-033: what a typed display name becomes: control characters dropped, runs of spaces made one,
/// ends trimmed, cut at `DISPLAY_NAME_MAX`; blank means no display name, so the folder's name shows.
pub fn clean_display_name(raw: &str) -> Option<String> {
    let kept: String = raw.chars().filter(|c| !c.is_control() || c.is_whitespace()).collect();
    let one_line = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = one_line.chars().take(DISPLAY_NAME_MAX).collect();
    Some(cut.trim().to_string()).filter(|s| !s.is_empty())
}

/// SET-033: saves (or with a blank `raw` clears) the display name of project `id`. The folder, the
/// base and every other field of the project stay as they are.
pub fn set_display_name(store: &Store, id: &str, raw: &str) -> Result<Project, String> {
    let mut projects = load_projects_for_write(store)?;
    let project = projects.iter_mut().find(|p| p.id == id).ok_or("that project is no longer registered")?;
    project.display_name = clean_display_name(raw);
    let project = project.clone();
    save_projects(store, &projects)?;
    Ok(project)
}

#[tauri::command]
#[allow(dead_code)] // T-116-c-c: registered by the lib.rs hunk the coordinator applies
pub fn project_display_name_set(store: StoreState<'_>, project_id: String, name: String) -> Result<Project, String> {
    set_display_name(&*store.lock().map_err(|e| e.to_string())?, &project_id, &name)
}

#[tauri::command(async)]
pub fn workspace_remove_check(git: State<'_, Git>, store: StoreState<'_>, project_id: String, path: String) -> Result<RemoveCheck, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    remove_check(&git, &project, &path)
}

/// PROJ-070: deletes the workspace only when the check made just now still matches `stamp` (what
/// the question showed) and nothing refuses it; `force` loses uncommitted changes. Async (T-033-e
/// FIX-1): it joins the watch's reader threads and runs git, never on the window's thread.
/// `keep_branch` is the remove form's choice; none means what the workspace's own record says, and
/// (T-613) keeps a branch holding commits no other branch and no remote has.
/// The branch that stayed, if any, comes back so it can be deleted later.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn workspace_remove(git: State<'_, Git>, store: StoreState<'_>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, path: String, force: bool, stamp: String, keep_branch: Option<bool>) -> Result<Option<Kept>, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    remove_one(&git, &store, &terminals, &project, &path, force, &stamp, keep_branch)
}

/// One delete, as the command and the batch (PROJ-071) both run it, archive script included.
#[allow(clippy::too_many_arguments)]
pub(crate) fn remove_one(git: &Git, store: &Mutex<Store>, terminals: &crate::terminal::Terminals, project: &Project, path: &str, force: bool, stamp: &str, keep_branch: Option<bool>) -> Result<Option<Kept>, String> {
    remove_with(git, store, terminals, project, path, force, stamp, keep_branch, true)
}

/// remove_one, with `archive` saying whether kolux.yaml's archive script runs (the CLI's rm passes
/// false until --run-hooks is wired, CLI-020).
#[allow(clippy::too_many_arguments)]
pub(crate) fn remove_with(git: &Git, store: &Mutex<Store>, terminals: &crate::terminal::Terminals, project: &Project, path: &str, force: bool, stamp: &str, keep_branch: Option<bool>, archive: bool) -> Result<Option<Kept>, String> {
    let now = remove_check(git, project, path)?;
    if let Some(why) = removal_refused(&now, force, stamp) {
        return Err(why);
    }
    // ORCH-058: a shell still sitting in the folder would keep Windows from deleting it, so its
    // terminals end first; one that cannot be shown gone blocks unless the force box waives it.
    // T-715: before the archive script, so nothing else writes there while it runs.
    let stopped = terminals.kill_under(Path::new(path));
    if !force && !stopped.stuck.is_empty() {
        let n = stopped.stuck.len();
        return Err(format!("{n} process{} in this workspace did not stop. Tick Delete my changes too to delete it anyway, leaving {} running.", if n == 1 { "" } else { "es" }, if n == 1 { "it" } else { "them" }));
    }
    // STAT-055 (T-715): the archive script runs in the folder before anything of it goes; one that
    // fails or runs past its time stops the delete unless forced. One that ran and exited 0 may leave
    // files there (a log, a marker), so the dirty check below is waived: the stamp check above
    // already guarded the user's own changes.
    let archived = archive
        && match crate::setup::archive_on_remove(store, Path::new(&project.path), Path::new(path)) {
            Ok(ran) => ran,
            Err(e) if !force => return Err(format!("{}. It was not deleted.", e.trim_end_matches('.'))),
            Err(_) => false,
        };
    // FIX-2 (T-033-e review): what to keep is decided first, so the one `?` that can return early
    // runs before the watch ends; an early return after it would drop the handle below without
    // telling the page.
    let keep = keep_branch.unwrap_or(keeps_branch(&*store.lock().map_err(|e| e.to_string())?, path));
    // T-613: unless it is kept, the folder goes with its branch kept for now, and whether the branch
    // goes too is decided below, after the folder, in the repository's branch turn: with no choice made
    // it stays when it holds commits found nowhere else; T-613b: Keep the branch unticked
    // (Some(false)) deletes it anyway, but in its turn too.
    let decide_after = !keep;
    let delete_anyway = keep_branch == Some(false);
    // T-613b: a detached HEAD has no branch to keep, so its commits found nowhere else are put on a
    // new one first (unless Keep the branch was unticked), before anything is deleted.
    let saved = if delete_anyway { None } else { keep_detached(git, project, path)? };
    // T-033-e: the Source Control watch on this folder ends first and its folder handles are
    // closed (joined) before git deletes the folder, so nothing of ours stands in the way.
    let watch = crate::scm::watch::unwatch_root(Path::new(path));
    let kept = match remove_worktree(git, project, path, force || archived, true) {
        Ok(k) => k,
        Err(e) => {
            // FIX-1: the folder stays after all, so its panel is told to watch it again.
            if let Some(w) = watch {
                w.tell_page();
            }
            // The folder and its HEAD are still there, so the keep-branch made for it goes again.
            if let Some(k) = &saved {
                let _ = git.delete_branch_if_at(Path::new(&project.path), &k.branch, &k.commit);
            }
            return Err(e);
        }
    };
    let kept = match kept {
        Some(k) if decide_after => branch_goes(git, Path::new(&project.path), k, delete_anyway),
        k => k,
    };
    let store = store.lock().map_err(|e| e.to_string())?;
    forget_workspace(&store, path)?;
    Ok(kept.or(saved))
}

/// T-613b: the branch a detached-HEAD workspace's commits are kept on when its folder goes:
/// `kolux/kept-<short id>` at its HEAD (numbered when that name is taken), made only when the HEAD
/// holds commits no branch and no remote has (or that cannot be read). None when the workspace is on
/// a branch or has nothing of its own. A branch that cannot be made refuses the delete.
fn keep_detached(git: &Git, project: &Project, path: &str) -> Result<Option<Kept>, String> {
    let repo = Path::new(&project.path);
    let Some(target) = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), Path::new(path))) else { return Ok(None) };
    if target.branch.is_some() {
        return Ok(None);
    }
    if target.head.is_empty() {
        return Err(UNREAD_HEAD.into());
    }
    // In the branch turn, so two detached workspaces at one HEAD deleted side by side make one branch.
    let turn = branch_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if only_here(git, repo, None, &target.head).is_ok_and(|c| c.is_empty()) {
        return Ok(None);
    }
    let short = &target.head[..target.head.len().min(7)];
    for n in 1..=50 {
        let name = if n == 1 { format!("kolux/kept-{short}") } else { format!("kolux/kept-{short}-{n}") };
        if git.branch_taken(repo, &name) {
            continue;
        }
        // Without --force, `git branch` never moves a branch that is already there.
        return match crate::git::run(&["branch", "--no-track", &name, &target.head], Some(repo)) {
            Ok(_) => Ok(Some(Kept { branch: name, commit: target.head.clone() })),
            Err(e) => Err(format!("Its commits are on no branch, and a branch to keep them could not be made ({e}), so it was not deleted.")),
        };
    }
    Err("Its commits are on no branch, and every kolux/kept name for them is taken, so it was not deleted.".into())
}

/// T-613: a branch whose folder just went is deleted unless it holds commits that no other branch
/// and no remote has (or it moved, or another worktree has it): then it stays and comes back as kept.
/// T-613b: `delete_anyway` (the user unticked Keep the branch) skips the commits check only.
/// Side-by-side deletes (PROJ-071) take turns here, so a parent and a child made from its tip, each
/// holding the same unpushed commits, never both see the other as the copy and both go.
fn branch_goes(git: &Git, repo: &Path, kept: Kept, delete_anyway: bool) -> Option<Kept> {
    let turn = branch_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    // Anything that cannot be read keeps the branch.
    let gone = (delete_anyway || only_here(git, repo, Some(&kept.branch), &kept.commit).is_ok_and(|c| c.is_empty())) && git.delete_branch_if_at(repo, &kept.branch, &kept.commit) == Ok(true);
    if gone {
        // As `git branch -D` would: the branch's own settings (its upstream) go with it.
        let _ = crate::git::run(&["config", "--remove-section", &format!("branch.{}", kept.branch)], Some(repo));
    }
    (!gone).then_some(kept)
}

/// The cleanup dialog's delete (T-113-b, T-162): `remove_one` by the workspace's own record, where
/// `keep_anyway` keeps the branch as if the workspace had been opened on it (the dialog does this for a
/// branch holding commits that are in no other branch). The kept branch comes back for the kept list.
#[allow(clippy::too_many_arguments)]
pub(crate) fn remove_now_keeping(git: &Git, store: &Mutex<Store>, terminals: &crate::terminal::Terminals, project: &Project, path: &str, force: bool, stamp: &str, keep_anyway: bool) -> Result<Option<Kept>, String> {
    remove_one(git, store, terminals, project, path, force, stamp, keep_anyway.then_some(true))
}

/// The global workspaces settings as the sidebar shows them (PROJ-025).
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaceInfo {
    /// The folder in use (the default when nothing is set).
    pub dir: String,
    pub flat: bool,
    pub used: Vec<String>,
    /// True while KOLUX_WORKSPACES_DIR supplies the folder (nothing saved), so the field can say so.
    pub from_env: bool,
}

fn place_info(store: &Store) -> PlaceInfo {
    let settings = store.settings();
    let saved = non_blank(settings[WORKSPACES_DIR_SETTING].as_str()).is_some();
    let from_env = !saved && non_blank(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref()).is_some();
    PlaceInfo { dir: workspaces_dir(store).display().to_string(), flat: settings[LAYOUT_SETTING].as_str() == Some("flat"), used: used_dirs(store), from_env }
}

#[tauri::command]
pub fn workspaces_place_get(store: StoreState<'_>) -> Result<PlaceInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(place_info(&store))
}

/// An empty folder means the default, which does not count as a choice (it is not remembered).
#[tauri::command]
pub fn workspaces_place_set(store: StoreState<'_>, dir: String, flat: bool) -> Result<PlaceInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    set_place(&store, &dir, flat)
}

/// An absolute folder is made right away (so a folder that cannot be made is a failed save the
/// user can retry, SET-032); a relative one counts from each project root, so it is only saved.
fn set_place(store: &Store, dir: &str, flat: bool) -> Result<PlaceInfo, String> {
    let mut settings = store.settings();
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        settings.as_object_mut().map(|o| o.remove(WORKSPACES_DIR_SETTING));
    } else {
        if Path::new(trimmed).is_absolute() {
            std::fs::create_dir_all(trimmed).map_err(|e| format!("{trimmed} cannot be made: {e}"))?;
        }
        settings[WORKSPACES_DIR_SETTING] = serde_json::Value::String(trimmed.to_string());
    }
    settings[LAYOUT_SETTING] = serde_json::Value::String(if flat { "flat" } else { "nested" }.to_string());
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    remember_dir(store, trimmed)?;
    Ok(place_info(store))
}

/// SESS-025: the handoff note of one agent launched side by side: `<repo>/.kolux/handoffs/<name>.md`
/// (COMPAT.md: one Markdown note per worktree, in the project's hidden Kolux folder, named after the
/// worktree). It is made before the agent starts, holding the headings the agent keeps current; an
/// existing note is never overwritten, so a relaunch keeps what the last agent wrote.
/// The notes are Kolux's scratch, so the folder ignores itself (a `.gitignore` of `*` inside it, made
/// only when there is none): they never show as untracked or get staged by "Stage all". The repo's own
/// ignore files and the rest of `.kolux/` (which may hold files meant to be committed) are left alone.
pub fn prepare_handoff(repo: &Path, name: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    let file = safe_name(name).ok_or_else(|| format!("{name} cannot name a handoff note"))?;
    let dir = repo.join(".kolux").join("handoffs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot make {}: {e}", dir.display()))?;
    match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(".gitignore")) {
        Ok(mut f) => f.write_all(b"# Kolux handoff notes are scratch, kept out of git.\n*\n").map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("cannot write {}: {e}", dir.join(".gitignore").display())),
    }
    let path = dir.join(format!("{file}.md"));
    let note = format!("# Handoff: {name}\n\n## Files added\n\n## Files updated\n\n## Files removed\n\n## Left to do\n");
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => f.write_all(note.as_bytes()).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("cannot write {}: {e}", path.display())),
    }
    Ok(path)
}

/// SESS-025: makes (or keeps) the handoff note `name` under `root` (the project's main checkout,
/// or the chooser's folder outside any project); its path.
#[tauri::command]
pub fn handoff_note_prepare(root: String, name: String) -> Result<String, String> {
    prepare_handoff(Path::new(&root), &name).map(|p| p.to_string_lossy().into_owned())
}

/// APP-051: linked worktrees whose folder is confirmed gone and that no session (`busy`, the
/// folders sessions run in) uses are dropped from Git's list. Only Git's own record goes, never a
/// folder or a branch. A folder counts as gone only when its drive or share is there and the
/// folder is not: storage that cannot be reached (a drive unplugged, a share offline) keeps it.
/// The paths forgotten; `on_forgotten` hears each one (the caller retires its suggested name, which
/// only the caller can do without holding the store through the git work).
pub fn forget_gone(repo: &Path, all: &[Worktree], busy: &[String], on_forgotten: impl Fn(&str)) -> Vec<String> {
    let used = |w: &Worktree| {
        let k = name_key(&w.path);
        busy.iter().map(|b| name_key(b)).any(|b| b == k || b.starts_with(&format!("{k}\\")))
    };
    let gone = |p: &Path| {
        matches!(std::fs::symlink_metadata(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
            && p.is_absolute()
            && p.ancestors().last().is_some_and(Path::exists)
    };
    all.iter()
        .filter(|w| !w.is_main && !used(w) && gone(Path::new(&w.path)))
        .filter(|w| forget_record(repo, &w.path).is_ok())
        .map(|w| {
            on_forgotten(&w.path);
            w.path.clone()
        })
        .collect()
}

/// The `<git common dir>/worktrees/<id>` entry whose `gitdir` points into `path`, removed.
pub(crate) fn forget_record(repo: &Path, path: &str) -> Result<(), String> {
    let record = find_record(repo, path)?;
    std::fs::remove_dir_all(record).map_err(|e| e.to_string())
}

/// The `<git common dir>/worktrees/<id>` entry whose `gitdir` points into `path`. A locked one is
/// never offered.
fn find_record(repo: &Path, path: &str) -> Result<PathBuf, String> {
    let common = crate::git::run(&["rev-parse", "--git-common-dir"], Some(repo))?;
    let admin = repo.join(common.trim()).join("worktrees");
    for entry in std::fs::read_dir(&admin).map_err(|e| e.to_string())?.flatten() {
        // git worktree lock (a worktree on removable storage, say) means: never prune this record.
        if entry.path().join("locked").exists() {
            continue;
        }
        let Ok(gitdir) = std::fs::read_to_string(entry.path().join("gitdir")) else { continue };
        if Path::new(gitdir.trim()).parent().is_some_and(|p| name_key(&p.to_string_lossy()) == name_key(path)) {
            return Ok(entry.path());
        }
    }
    Err(format!("no record of {path}"))
}

/// After-list row 127: Git's record of a worktree moved aside instead of deleted, so an undo puts
/// it back whole. It sits in `<git common dir>/kolux-set-aside/` (same disk, one rename), where
/// Git does not look; `discard` deletes it once the removal is confirmed.
#[derive(Debug)]
pub(crate) struct SetAside {
    from: PathBuf,
    to: PathBuf,
}

impl SetAside {
    /// Puts the record back where Git reads it.
    pub(crate) fn restore(&self) -> Result<(), String> {
        std::fs::rename(&self.to, &self.from).map_err(|e| format!("Git's record of the workspace could not be put back ({e}); it is kept at {}", self.to.display()))
    }

    /// The removal is confirmed: the record goes for good.
    pub(crate) fn discard(self) {
        let _ = std::fs::remove_dir_all(&self.to);
        if let Some(dir) = self.to.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

/// Row 127: `forget_record`, but undoable (see `SetAside`).
pub(crate) fn set_aside_record(repo: &Path, path: &str) -> Result<SetAside, String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let from = find_record(repo, path)?;
    let common = from.parent().and_then(Path::parent).ok_or_else(|| format!("no record folder for {path}"))?;
    let aside = common.join("kolux-set-aside");
    std::fs::create_dir_all(&aside).map_err(|e| e.to_string())?;
    let id = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let to = aside.join(format!("{:x}-{:x}-{id}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(SetAside { from, to })
}

/// T-441-c: the worktrees among `all` that Kolux made itself, by the origin record it keeps for
/// each one it creates (the same test as trust::made_by_kolux). Txais, 2026-10-13: "Only Kolux's
/// own": a worktree made by Claude Code or any other tool is never forgotten, folder gone or not.
pub(crate) fn kolux_made(origins: &serde_json::Map<String, serde_json::Value>, all: Vec<Worktree>) -> Vec<Worktree> {
    all.into_iter().filter(|w| origins.contains_key(&name_key(&w.path))).collect()
}

/// The sweep over one project's worktrees: `forget_gone`, and what Kolux remembers about each one
/// it forgets goes too, the same as when the user removes the workspace. The store is locked only
/// for each forgotten path, never while Git works. When what Kolux remembers cannot be cleared (the
/// store is locked up or a write failed) the line goes to the diagnostics log in `diag_dir`, so the
/// leftover note or origin that a later worktree at the same path would inherit can be traced.
fn sweep_gone(store: &Mutex<Store>, repo: &Path, all: &[Worktree], busy: &[String], diag_dir: Option<&Path>) -> Vec<String> {
    forget_gone(repo, all, busy, |path| {
        let cleared = match store.lock() {
            Ok(store) => forget_workspace(&store, path),
            Err(_) => Err("the store is locked up by a failed task".to_string()),
        };
        if let (Err(why), Some(dir)) = (cleared, diag_dir) {
            crate::diag::write(dir, &format!("forgot the worktree {path} from Git but could not clear what Kolux remembers about it: {why}"));
        }
    })
}

/// APP-051 at launch, off the startup path: every project's gone worktrees that Kolux made are
/// forgotten.
pub fn forget_gone_at_start(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let (projects, origins) = match app.state::<Mutex<Store>>().lock() {
            Ok(store) => (load_projects(&store), load_origins(&store)),
            Err(_) => return,
        };
        let busy: Vec<String> = app.state::<crate::terminal::Terminals>().list().into_iter().filter_map(|(_, _, dir)| dir).collect();
        let dir = app.path().app_data_dir().ok();
        // PROJ-074: trash folders a run left behind are cleared (this is off the startup path).
        let folders = trash_folders(&app.state::<Mutex<Store>>(), &app.state::<Git>(), &projects, &origins);
        for swept in folders.iter().map(|f| crate::git::sweep_trash(f)) {
            if let Some(dir) = dir.as_deref() {
                for gone in &swept.gone {
                    crate::diag::write(dir, &format!("cleared the leftover trash folder {}", gone.display()));
                }
                // After-list row 128: never deleted without a confirmed removal; the user decides.
                for kept in &swept.kept {
                    crate::diag::write(dir, &format!("kept the trash folder {}: its removal was never confirmed, so it may hold work; delete it by hand once checked", kept.display()));
                }
            }
        }
        for path in sweep_all_gone(&app.state::<Mutex<Store>>(), &app.state::<Git>(), &projects, &origins, &busy, dir.as_deref()) {
            if let Some(dir) = dir.as_deref() {
                crate::diag::write(dir, &format!("forgot the worktree {path}: its folder is gone and no session uses it"));
            }
        }
    });
}

/// PROJ-074: the folders a trash folder can sit in: each workspaces folder in use, and the parent
/// of every workspace Kolux made. Only names the trash uses are ever touched inside them.
pub(crate) fn trash_folders(store: &Mutex<Store>, git: &Git, projects: &[Project], origins: &serde_json::Map<String, serde_json::Value>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(store) = store.lock() {
        out.push(workspaces_dir(&store));
        out.extend(used_dirs(&store).into_iter().map(PathBuf::from));
    }
    for p in projects {
        out.extend(p.workspaces_dir.iter().map(PathBuf::from));
        if let Ok(all) = git.worktrees(Path::new(&p.path)) {
            out.extend(kolux_made(origins, all).iter().filter_map(|w| Path::new(&w.path).parent().map(Path::to_path_buf)));
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The sweep `forget_gone_at_start` runs: for every project, the gone worktrees Kolux made and no
/// session uses are forgotten. A project whose folder Git cannot read is skipped. Returns every path forgotten.
fn sweep_all_gone(store: &Mutex<Store>, git: &Git, projects: &[Project], origins: &serde_json::Map<String, serde_json::Value>, busy: &[String], diag_dir: Option<&Path>) -> Vec<String> {
    let mut forgotten = Vec::new();
    for p in projects {
        let repo = Path::new(&p.path);
        if let Ok(all) = git.worktrees(repo) {
            forgotten.extend(sweep_gone(store, repo, &kolux_made(origins, all), busy, diag_dir));
        }
    }
    forgotten
}

// ---- PROJ-019: a project's icon, chosen by hand
//
// The choice is kept beside the project list (not in it), by project id. Three kinds are accepted:
// "emoji:<emoji>", "icon:<built-in icon name>" and "image:<data URL of a small picture>". Reset
// removes the entry, which brings the automatic icon back. An icon name nobody knows is kept as it
// is (the drawing side shows a folder for it); anything that is none of the three is refused.

const ICONS_KEY: &str = "projectIcons";
/// The most an image icon may take, as the whole value.
pub const ICON_IMAGE_MAX: usize = 64 * 1024;
const ICON_IMAGE_TYPES: &[&str] = &["png", "jpeg", "gif", "webp", "svg+xml"];

/// What a typed or picked icon becomes: `None` for empty (reset), the cleaned value, or why not.
pub fn clean_icon(raw: &str) -> Result<Option<String>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let refuse = || "An icon is an emoji, a built-in icon or a small picture.".to_string();
    let (kind, rest) = raw.split_once(':').ok_or_else(refuse)?;
    match kind {
        "emoji" => {
            let one = !rest.is_empty() && rest.len() <= 32 && rest.chars().all(|c| !c.is_ascii() && !c.is_alphanumeric() && !c.is_whitespace() && !c.is_control());
            if one { Ok(Some(raw.to_string())) } else { Err("That is not an emoji.".to_string()) }
        }
        "icon" => {
            let name = rest.trim().to_lowercase();
            if !name.is_empty() && name.len() <= 32 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
                Ok(Some(format!("icon:{name}")))
            } else {
                Err("That is not a built-in icon name.".to_string())
            }
        }
        "image" => {
            let bad = || "A picture icon has to be a PNG, JPEG, GIF, WebP or SVG image.".to_string();
            let body = rest.strip_prefix("data:image/").ok_or_else(bad)?;
            let (mime, data) = body.split_once(";base64,").ok_or_else(bad)?;
            if !ICON_IMAGE_TYPES.contains(&mime) || data.is_empty() || !data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')) {
                return Err(bad());
            }
            if raw.len() > ICON_IMAGE_MAX {
                return Err(format!("That picture is too large; an icon may take {} KB at most.", ICON_IMAGE_MAX / 1024));
            }
            Ok(Some(raw.to_string()))
        }
        _ => Err(refuse()),
    }
}

type Icons = std::collections::BTreeMap<String, String>;

/// Every project's chosen icon by project id. A damaged record, or an entry that no longer passes
/// `clean_icon`, simply gives nothing, so that project shows its automatic icon.
pub fn project_icons(store: &Store) -> Icons {
    let all: Icons = store.get(ICONS_KEY).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    all.into_iter().filter(|(_, v)| matches!(clean_icon(v), Ok(Some(c)) if &c == v)).collect()
}

fn save_icons(store: &Store, icons: &Icons) -> Result<(), String> {
    store.set(ICONS_KEY, &serde_json::to_string(icons).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Saves (or with an empty `raw`, resets) the icon of project `id`; returns what is now kept.
pub fn set_icon(store: &Store, id: &str, raw: &str) -> Result<Option<String>, String> {
    find_project(store, id)?;
    let icon = clean_icon(raw)?;
    let mut icons = project_icons(store);
    match &icon {
        Some(i) => icons.insert(id.to_string(), i.clone()),
        None => icons.remove(id),
    };
    save_icons(store, &icons)?;
    Ok(icon)
}

#[tauri::command]
#[allow(dead_code)] // T-299: registered by the lib.rs hunk the coordinator applies
pub fn project_icons_list(store: StoreState<'_>) -> Result<Icons, String> {
    Ok(project_icons(&*store.lock().map_err(|e| e.to_string())?))
}

#[tauri::command]
#[allow(dead_code)] // T-299: registered by the lib.rs hunk the coordinator applies
pub fn project_icon_set(store: StoreState<'_>, project_id: String, icon: String) -> Result<Option<String>, String> {
    set_icon(&*store.lock().map_err(|e| e.to_string())?, &project_id, &icon)
}

// ---- PROJ-018: an icon found in the repository
//
// Places are tried in this order, the first hit wins: a small favicon inside the repository, icons
// of desktop app bundles, a picture the package manifest names inside the repository, the icon
// links the page source declares inside the repository, and last the avatar of the owner on the
// hosting site. Only files inside the repository are read (never through a link or a `..`), and a
// file over `AUTO_ICON_FILE_MAX` is passed over. FIX-4 (2026-10-19): a repository never makes the
// page load a web address of its choosing. T-302-c: the manifest's web `icon`, its `homepage` favicon
// and `https` icon links in the page source are fetched in Rust behind web_icon.rs's checks and come
// back as data URLs; the one address handed to the page is the owner's avatar on github.com, which the
// content policy allows and nothing else. No hit gives the folder symbol.

/// The most a file may take to be used as an icon: the biggest whole number of 3-byte groups whose
/// data URL (base64 text plus the longest header, 40 characters) still fits `ICON_IMAGE_MAX`.
/// `src/projects/projectIcon.ts` holds the same figure (49 122) and both are tested against it.
pub const AUTO_ICON_FILE_MAX: u64 = ((ICON_IMAGE_MAX as u64 - 40) / 4) * 3;
const FAVICON_DIRS: &[&str] = &["", "public", "static", "assets", "src", "app", "web", "www", "docs", "site"];
const FAVICON_NAMES: &[&str] = &["favicon.ico", "favicon.png", "favicon.svg"];
const BUNDLE_ICONS: &[&str] = &[
    "src-tauri/icons/icon.png",
    "src-tauri/icons/128x128.png",
    "build/icon.png",
    "build/icons/512x512.png",
    "electron/icon.png",
    "resources/icon.png",
    "assets/icon.png",
    "app-icon.png",
    "icon.png",
];
const PAGE_FILES: &[&str] = &["index.html", "public/index.html", "src/index.html", "app/index.html", "static/index.html", "web/index.html"];
const PAGE_READ_MAX: u64 = 256 * 1024;

/// What a project shows when the repository holds an icon: a picture as a data URL (`image`), or the
/// owner's avatar address on the hosting site (`avatar`, the only web address ever handed over).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct AutoIcon {
    pub kind: &'static str,
    pub src: String,
}

/// The picture type of `bytes`, by what the file starts with (the name only decides for SVG).
fn image_mime(bytes: &[u8], name: &str) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else if name.to_ascii_lowercase().ends_with(".svg") && String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).contains("<svg") {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// The picture at `rel` inside `repo` as a data URL; nothing for a path that leaves the repository,
/// goes through a link, is not a plain small picture file, or does not exist.
fn repo_image(repo: &Path, rel: &str) -> Option<String> {
    let rel = rel.split(['?', '#']).next().unwrap_or("").trim().trim_start_matches(['/', '\\']);
    if rel.is_empty() || rel.contains(':') || rel.split(['/', '\\']).any(|p| p.is_empty() || p == ".." || p == ".") {
        return None;
    }
    let path = rel.split(['/', '\\']).fold(repo.to_path_buf(), |p, part| p.join(part));
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > AUTO_ICON_FILE_MAX {
        return None;
    }
    // a folder on the way may be a link out of the repository
    if !fs::canonicalize(&path).ok()?.starts_with(fs::canonicalize(repo).ok()?) {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    use base64::Engine as _;
    let mime = image_mime(&bytes, rel)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// The text of the file at `rel` inside `repo` (at most `PAGE_READ_MAX` bytes), for a plain file only:
/// nothing for a missing file, a link, or a file that a link on the way leads out of the repository.
fn repo_text(repo: &Path, rel: &str) -> Option<String> {
    let path = rel.split('/').fold(repo.to_path_buf(), |p, part| p.join(part));
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > PAGE_READ_MAX || !fs::canonicalize(&path).ok()?.starts_with(fs::canonicalize(repo).ok()?) {
        return None;
    }
    fs::read_to_string(&path).ok()
}

/// The `href` of every icon link (`rel` holding "icon") in the page text.
fn icon_links(page: &str) -> Vec<String> {
    let mut found = Vec::new();
    let lower = page.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("<link") {
        let start = from + at;
        let end = lower[start..].find('>').map_or(lower.len(), |e| start + e);
        let tag = &page[start..end];
        let attr = |name: &str| {
            let low = tag.to_ascii_lowercase();
            let at = low.find(&format!("{name}="))?;
            let rest = &tag[at + name.len() + 1..];
            let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'');
            match quote {
                Some(q) => rest[1..].split(q).next().map(str::to_string),
                None => rest.split(|c: char| c.is_whitespace() || c == '>').next().map(str::to_string),
            }
        };
        if attr("rel").is_some_and(|r| r.to_ascii_lowercase().contains("icon")) {
            found.extend(attr("href"));
        }
        from = end.max(start + 5);
    }
    found
}

/// (host, owner, repository) of a remote address on the forms Git accepts, host in lower case.
fn remote_parts(url: &str) -> Option<(String, String, String)> {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).or_else(|| url.strip_prefix("ssh://")).or_else(|| url.strip_prefix("git://")) {
        let (host, path) = rest.split_once('/')?;
        (host.rsplit('@').next()?.split(':').next()?.to_string(), path.to_string())
    } else {
        let rest = url.split_once('@').map_or(url, |(_, r)| r);
        let (host, path) = rest.split_once(':')?;
        (host.to_string(), path.to_string())
    };
    let mut parts = path.1.trim_matches('/').split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    let plain = |s: &str| !s.is_empty() && s.len() <= 100 && !s.chars().all(|c| c == '.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    (path.0.contains('.') && plain(owner) && plain(repo) && parts.next().is_none()).then(|| (path.0.to_ascii_lowercase(), owner.to_string(), repo.to_string()))
}

/// The avatar address of the repository's owner on the hosting site. A fork shows the upstream
/// owner's avatar; a fork that was renamed (its name differs from upstream's) shows its own owner's.
fn owner_avatar(origin: Option<&str>, upstream: Option<&str>) -> Option<String> {
    let own = origin.and_then(remote_parts);
    let up = upstream.and_then(remote_parts);
    let chosen = match (&own, &up) {
        (Some(o), Some(u)) if u.0 == o.0 && u.2.eq_ignore_ascii_case(&o.2) => u,
        (Some(o), _) => o,
        (None, Some(u)) => u,
        (None, None) => return None,
    };
    (chosen.0 == "github.com").then(|| format!("https://github.com/{}.png", chosen.1))
}

/// The icon the repository at `repo` offers from its own files and remote only (no web fetch), for the tests.
#[cfg(test)]
pub fn auto_icon(repo: &Path) -> Option<AutoIcon> {
    auto_icon_with(repo, &|_| None)
}

/// The icon the repository at `repo` offers, trying the places in order; `None` means the folder symbol.
/// `web` fetches a checked web address (T-302-c: `web_icon::fetch`; tests pass a stand-in), at most
/// `web_icon::WEB_TRIES_MAX` times per project.
pub fn auto_icon_with(repo: &Path, web: &dyn Fn(&tauri::Url) -> Option<String>) -> Option<AutoIcon> {
    let image = |src: String| AutoIcon { kind: "image", src };
    let tries = std::cell::Cell::new(0);
    let web = |url: tauri::Url| {
        if tries.get() >= crate::web_icon::WEB_TRIES_MAX {
            return None;
        }
        tries.set(tries.get() + 1);
        web(&url)
    };
    for dir in FAVICON_DIRS {
        for name in FAVICON_NAMES {
            let rel = if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") };
            if let Some(src) = repo_image(repo, &rel) {
                return Some(image(src));
            }
        }
    }
    if let Some(src) = BUNDLE_ICONS.iter().find_map(|rel| repo_image(repo, rel)) {
        return Some(image(src));
    }
    // `repo_image` refuses anything with a scheme, so only a path inside the repository matches there;
    // a web address goes only through `web` (T-302-c), never to the page
    let manifest: Option<serde_json::Value> = repo_text(repo, "package.json").and_then(|t| serde_json::from_str(&t).ok());
    if let Some(src) = manifest.as_ref().and_then(|m| m["icon"].as_str()).and_then(|rel| repo_image(repo, rel)) {
        return Some(image(src));
    }
    if let Some(src) = manifest.as_ref().and_then(crate::web_icon::manifest_icon_url).and_then(web) {
        return Some(image(src));
    }
    if let Some(src) = manifest.as_ref().and_then(crate::web_icon::homepage_favicon_url).and_then(web) {
        return Some(image(src));
    }
    for page in PAGE_FILES {
        let Some(text) = repo_text(repo, page) else { continue };
        let beside = page.rsplit_once('/').map_or("", |(d, _)| d);
        for href in icon_links(&text) {
            let from_root = href.starts_with('/');
            let rel = if from_root || beside.is_empty() { href.clone() } else { format!("{beside}/{href}") };
            if let Some(src) = repo_image(repo, &rel).or_else(|| from_root.then(|| repo_image(repo, &format!("public/{}", href.trim_start_matches('/')))).flatten()) {
                return Some(image(src));
            }
            if let Some(src) = crate::web_icon::page_icon_urls(std::slice::from_ref(&href)).into_iter().next().and_then(web) {
                return Some(image(src));
            }
        }
    }
    // Git looks in the parent folders for a repository; a folder inside another repository is not that
    // repository, so its owner is not this project's owner (FIX-4). `--show-prefix` is empty at the top.
    if !crate::git::run(&["rev-parse", "--show-prefix"], Some(repo)).is_ok_and(|p| p.is_empty()) {
        return None;
    }
    let url = |name: &str| crate::git::run(&["remote", "get-url", name], Some(repo)).ok();
    owner_avatar(url("origin").as_deref(), url("upstream").as_deref()).map(|src| AutoIcon { kind: "avatar", src })
}

/// The automatic icon of project `project_id` (PROJ-018). The store lock is released before any file or
/// git work, and that work runs on the blocking pool so a panel asking for every row never stalls the async workers.
#[tauri::command]
pub async fn project_auto_icon(store: StoreState<'_>, project_id: String) -> Result<Option<AutoIcon>, String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || auto_icon_with(Path::new(&project.path), &crate::web_icon::fetch)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "projects_tests.rs"]
mod tests;

#[cfg(test)]
mod branch_prefix_async_tests {
    use super::*;

    fn is_async<F: std::future::Future>(_: fn(Option<String>, Option<String>) -> F) {}

    #[test]
    fn branch_prefix_check_is_an_async_command_that_matches_the_sync_one() {
        is_async(branch_prefix_check);
        for (mode, custom) in [(Some("custom"), Some("team/")), (Some("none"), None), (None, None)] {
            let (m, c) = (mode.map(String::from), custom.map(String::from));
            let new = tauri::async_runtime::block_on(branch_prefix_check(m.clone(), c.clone()));
            let old = branch_prefix_check_now(m, c);
            assert_eq!((new.prefix, new.refused), (old.prefix, old.refused), "{mode:?} {custom:?}");
        }
    }
}
