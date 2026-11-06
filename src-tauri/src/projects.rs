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

/// Records (or with `None`, forgets) how the workspace at `path` came to be.
pub fn set_origin(store: &Store, path: &str, origin: Option<&serde_json::Value>) -> Result<(), String> {
    let mut all = load_origins(store);
    match origin {
        Some(o) => all.insert(name_key(path), o.clone()),
        None => all.remove(&name_key(path)),
    };
    store.set(ORIGINS_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
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

/// A worktree Kolux itself just made is never offered as new (PROJ-041), and its record makes it
/// managed wherever it sits (PROJ-044); a more detailed origin written by the caller is kept.
pub fn note_seen(store: &Store, project: &Project, path: &str) -> Result<(), String> {
    if origin(store, path).is_none() {
        set_origin(store, path, Some(&serde_json::json!({ "madeBy": "app" })))?;
    }
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
    Ok(Created { worktree, base: from, note, warnings })
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
    let made = create_workspace(git, place, project, &name, base)?.worktree;
    note_seen(&*lock()?, project, &made.path)?;
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
    Ok(Created { worktree, base: branch.to_string(), note: None, warnings })
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
    let made = open_branch_workspace_until(&git, &place, &project, &branch, folder.as_deref(), &|| dropped(ticket));
    if let Some(t) = ticket {
        settle_create(t);
    }
    let mut made = made?;
    {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": true })))?;
        note_seen(&store, &project, &made.worktree.path)?;
    }
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
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": reused, "pr": pr.url })))?;
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
    let made = create_named(&git, &store, &project.id, &issue.title, None, None)?;
    set_origin(&*store.lock().map_err(|e| e.to_string())?, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "issue": issue.number, "issueUrl": issue.url })))?;
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
/// the branch in place of the name (SESS-037).
pub fn create_named(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>, branch: Option<&str>) -> Result<Created, String> {
    create_named_until(git, store, project_id, name, base, branch, &|| false)
}

/// `create_named` with the overtaken checks of `create_workspace_until` (PROJ-020).
pub fn create_named_until(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>, branch: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<Created, String> {
    let (project, place) = locked_place(store, project_id)?;
    let mut made = create_workspace_until(git, &place, &project, non_blank(branch).unwrap_or(name), base, overtaken)?;
    note_seen(&*store.lock().map_err(|e| e.to_string())?, &project, &made.worktree.path)?;
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
    let made = create_named_until(&git, &store, &project_id, &name, base.as_deref(), branch.as_deref(), &|| dropped(ticket));
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
        if let Some(i) = issue {
            // SESS-036: linked to the issue the composer named it from (the `issue:` selector finds it)
            set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "issue": i.number, "issueUrl": i.url })))?;
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
// ponytail: the notes sit untracked in the main checkout; add `.kolux/` to the repo's ignore list
// if they ever clutter its status.
pub fn prepare_handoff(repo: &Path, name: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    let file = safe_name(name).ok_or_else(|| format!("{name} cannot name a handoff note"))?;
    let dir = repo.join(".kolux").join("handoffs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot make {}: {e}", dir.display()))?;
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
mod tests {

    #[test]
    fn row931_b_a_writer_naming_no_agent_and_no_command_never_asks_and_the_task_names_the_branch() {
        use crate::scm::writers::WriterArg;
        let calls = std::cell::Cell::new(0);
        let asker = |_: &WriterArg, _: &str| -> Result<String, String> {
            calls.set(calls.get() + 1);
            Ok("never-used".into())
        };
        assert_eq!(writer_reply(Some(&WriterArg::default()), "Fix the login bug", &asker), "Fix the login bug");
        let blank = WriterArg { command: Some("  ".into()), ..Default::default() };
        assert_eq!(writer_reply(Some(&blank), "Fix the login bug", &asker), "Fix the login bug");
        assert_eq!(writer_reply(None, "Fix the login bug", &asker), "Fix the login bug");
        assert_eq!(calls.get(), 0, "no agent or command named: nothing may be asked");
        let agent = WriterArg { agent: Some("claude".into()), ..Default::default() };
        assert_eq!(writer_reply(Some(&agent), "task", &asker), "never-used");
        assert_eq!(calls.get(), 1);
    }
    use super::*;
    use std::fs;

    #[test]
    fn app051_only_gone_unused_worktrees_on_reachable_storage_are_forgotten() {
        let base = temp("app051");
        let repo = base.join("r");
        init_repo(&repo);
        for w in ["gone", "used", "here"] {
            git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
        }
        fs::remove_dir_all(base.join("gone")).unwrap();
        fs::remove_dir_all(base.join("used")).unwrap();
        let git = Git::detect().unwrap();
        let mut all = git.worktrees(&repo).unwrap();
        let busy = vec![base.join("used").join("src").to_string_lossy().into_owned()];
        #[cfg(windows)]
        if let Some(letter) = (b'D'..=b'Z').map(char::from).find(|c| !Path::new(&format!("{c}:/")).exists()) {
            let mut away = all[1].clone();
            away.path = format!("{letter}:/unplugged/wt");
            all.push(away);
        }
        let forgot = forget_gone(&repo, &all, &busy, |_| {});
        assert_eq!(forgot.len(), 1, "{forgot:?}");
        assert!(name_key(&forgot[0]).ends_with("gone"));
        let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
        assert!(left.iter().any(|p| p.ends_with("used")) && left.iter().any(|p| p.ends_with("here")), "{left:?}");
        assert!(!left.iter().any(|p| p.ends_with("gone")), "{left:?}");
        assert!(base.join("here").join("a.txt").exists());
        git_in(&repo, &["rev-parse", "--verify", "refs/heads/gone"]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn t441c_the_launch_sweep_forgets_only_worktrees_kolux_made() {
        let base = temp("t441c-sweep");
        let repo = base.join("r");
        init_repo(&repo);
        for w in ["ours", "theirs"] {
            git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
        }
        let store = Store::open(&base.join("db")).unwrap();
        set_origin(&store, &base.join("ours").to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
        fs::remove_dir_all(base.join("ours")).unwrap();
        fs::remove_dir_all(base.join("theirs")).unwrap();
        let git = Git::detect().unwrap();
        let all = git.worktrees(&repo).unwrap();
        let forgot = forget_gone(&repo, &kolux_made(&load_origins(&store), all), &[], |_| {});
        assert_eq!(forgot.len(), 1, "{forgot:?}");
        assert!(name_key(&forgot[0]).ends_with("ours"));
        let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
        assert!(left.iter().any(|p| p.ends_with("theirs")), "the record another tool made is untouched: {left:?}");
        assert!(!left.iter().any(|p| p.ends_with("ours")), "{left:?}");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn app051_a_locked_worktree_record_survives_forget_gone_at_start() {
        // forget_gone is the sweep forget_gone_at_start runs for every project at launch.
        let base = temp("app051-locked");
        let repo = base.join("r");
        init_repo(&repo);
        let wt = base.join("locked");
        git_in(&repo, &["worktree", "add", "-q", &wt.to_string_lossy(), "-b", "locked"]);
        git_in(&repo, &["worktree", "lock", &wt.to_string_lossy()]);
        fs::remove_dir_all(&wt).unwrap();
        let git = Git::detect().unwrap();
        let all = git.worktrees(&repo).unwrap();
        assert_eq!(forget_gone(&repo, &all, &[], |_| {}), Vec::<String>::new());
        let admin = repo.join(".git").join("worktrees");
        let kept: Vec<_> = fs::read_dir(&admin).unwrap().flatten().filter(|e| e.path().join("locked").exists()).collect();
        assert_eq!(kept.len(), 1, "the locked record under {} is still there", admin.display());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn set033_a_display_name_is_one_clean_line_or_nothing() {
        assert_eq!(clean_display_name("  My   shop 	 app "), Some("My shop app".into()));
        assert_eq!(clean_display_name("a[31mb
c"), Some("a[31mb c".into()), "control characters drop, a line break is a space");
        assert_eq!(clean_display_name("   
	 "), None);
        assert_eq!(clean_display_name(""), None);
        let long = "x".repeat(200);
        assert_eq!(clean_display_name(&long).unwrap().chars().count(), DISPLAY_NAME_MAX);
        assert_eq!(clean_display_name("한글 이름"), Some("한글 이름".into()));
    }

    #[test]
    fn set033_a_display_name_is_kept_beside_the_other_fields_and_survives_edits_and_a_re_add() {
        let git = Git::detect().unwrap();
        let profile = temp("setdn-profile");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("setdn-repo");
        let p = add_project(&git, &store, &repo).unwrap();
        assert_eq!(p.display_name, None);
        let named = set_display_name(&store, &p.id, " Shop  front ").unwrap();
        assert_eq!(named.display_name.as_deref(), Some("Shop front"));
        assert_eq!((&named.name, &named.path), (&p.name, &p.path), "the folder name and path never change");
        // the per-repository folder and base edits (project_set) keep it
        let mut projects = load_projects(&store);
        projects[0].base = Some("develop".into());
        save_projects(&store, &projects).unwrap();
        assert_eq!(load_projects(&store)[0].display_name.as_deref(), Some("Shop front"));
        // adding the same repository again returns the saved record, name included
        assert_eq!(add_project(&git, &store, &repo).unwrap().display_name.as_deref(), Some("Shop front"));
        // an old record without the field still loads, and blank clears it
        assert!(!serde_json::to_string(&p).unwrap().contains("displayName"));
        let old: Project = serde_json::from_str(r#"{"id":"a","name":"a","path":"C:/a"}"#).unwrap();
        assert_eq!(old.display_name, None);
        assert_eq!(set_display_name(&store, &p.id, "  ").unwrap().display_name, None);
        assert!(set_display_name(&store, "nope", "x").is_err());
        drop(store);
        let _ = fs::remove_dir_all(&profile);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn view038_a_workspace_carries_the_number_of_the_issue_or_pull_request_it_is_linked_to() {
        assert_eq!(item_number(&serde_json::json!({ "madeBy": "app", "issue": 34, "issueUrl": "https://github.com/o/r/issues/34" })), Some(34));
        assert_eq!(item_number(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/12" })), Some(12));
        assert_eq!(item_number(&serde_json::json!({ "madeBy": "cli", "issue": null })), None);
        assert_eq!(item_number(&serde_json::json!({ "madeBy": "app" })), None);
    }

    #[test]
    fn sess025_handoff_note_is_made_once_and_never_overwritten() {
        let repo = temp("handoff");
        let path = prepare_handoff(&repo, "gentle-squid").unwrap();
        assert_eq!(path, repo.join(".kolux").join("handoffs").join("gentle-squid.md"));
        let text = fs::read_to_string(&path).unwrap();
        for heading in ["## Files added", "## Files updated", "## Files removed", "## Left to do"] {
            assert!(text.contains(heading), "{heading} in {text}");
        }
        fs::write(&path, "kept").unwrap();
        assert_eq!(prepare_handoff(&repo, "gentle-squid").unwrap(), path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
        let odd = prepare_handoff(&repo, "../escape").unwrap();
        assert_eq!(odd.parent().unwrap(), repo.join(".kolux").join("handoffs"));
        assert!(prepare_handoff(&repo, "///").is_err());
    }
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-proj-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn work_item(host: &str, owner: &str, repo: &str) -> WorkItem {
        WorkItem { host: host.into(), owner: owner.into(), repo: repo.into(), kind: "issue".into(), number: 3 }
    }
    fn project_at(id: &str, dir: &Path) -> Project {
        Project { id: id.into(), name: id.into(), path: dir.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None }
    }
    const ALIAS: &str = "Host work-gh
  HostName github.com
";

    #[test]
    fn proj037_workspace_item_accepts_a_remote_through_an_ssh_alias_only_when_the_config_names_it() {
        let base = temp("proj037-item-alias");
        let repo = base.join("r");
        init_repo(&repo);
        git_in(&repo, &["remote", "add", "origin", "git@work-gh:acme/app.git"]);
        let project = project_at("p", &repo);
        let link = work_item("github.com", "acme", "app");
        assert_eq!(item_is_remote_of(&project, &link, ALIAS), Ok(()));
        let refused = item_is_remote_of(&project, &link, "").unwrap_err();
        assert!(refused.contains("not a remote of p"), "{refused}");
        assert!(item_is_remote_of(&project, &work_item("github.com", "acme", "other"), ALIAS).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj037_workspace_from_item_finds_the_project_whose_remote_is_an_ssh_alias() {
        let base = temp("proj037-from-alias");
        let (plain, aliased) = (base.join("plain"), base.join("aliased"));
        for (dir, url) in [(&plain, "https://github.com/Corp/Lib.git"), (&aliased, "git@work-gh:acme/app.git")] {
            init_repo(dir);
            git_in(dir, &["remote", "add", "origin", url]);
        }
        let all = || vec![project_at("plain", &plain), project_at("aliased", &aliased)];
        let link = work_item("github.com", "acme", "app");
        assert_eq!(project_with_remote(all(), &link, ALIAS).unwrap().id, "aliased");
        assert!(project_with_remote(all(), &link, "").unwrap_err().contains("No project here has github.com/acme/app"));
        assert_eq!(project_with_remote(all(), &work_item("github.com", "corp", "lib"), "").unwrap().id, "plain");
        let _ = fs::remove_dir_all(&base);
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").args(args).current_dir(dir).output().unwrap().status.success();
        assert!(ok, "git {args:?} in {}", dir.display());
    }

    fn temp_repo(name: &str) -> PathBuf {
        let dir = temp(name);
        init_repo(&dir);
        dir
    }

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        git_in(dir, &["init", "-q", "-b", "main"]);
        git_in(dir, &["config", "user.email", "t@example.com"]);
        git_in(dir, &["config", "user.name", "t"]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        git_in(dir, &["add", "."]);
        git_in(dir, &["commit", "-q", "-m", "first"]);
    }

    fn rev(dir: &Path, r: &str) -> String {
        String::from_utf8(Command::new("git").args(["rev-parse", r]).current_dir(dir).output().unwrap().stdout).unwrap().trim().to_string()
    }

    fn nested(root: &Path) -> Place {
        Place { root: root.to_path_buf(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false }
    }

    #[test]
    fn a_new_workspace_can_start_from_a_refreshed_base() {
        let git = Git::detect().unwrap();
        let profile = temp("refresh");
        let store = Store::open(&profile).unwrap();
        let remote = temp("refresh-remote");
        git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
        let repo = temp_repo("refresh-r");
        let remote_url = remote.to_string_lossy().to_string();
        git_in(&repo, &["remote", "add", "origin", &remote_url]);
        git_in(&repo, &["push", "-q", "-u", "origin", "main"]);
        // Someone else moves origin/main on.
        let other = temp("refresh-other");
        git_in(&other, &["clone", "-q", &remote_url, "."]);
        let push_one = |file: &str| {
            git_in(&other, &["-c", "user.name=o", "-c", "user.email=o@o", "commit", "-q", "--allow-empty", "-m", file]);
            git_in(&other, &["push", "-q"]);
            rev(&other, "HEAD")
        };
        let ahead = push_one("b");
        let root = temp("refresh-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let head = |c: &Created| rev(Path::new(&c.worktree.path), "HEAD");
        let on = Place { refresh: true, ..nested(&root) };

        // Off: the workspace starts from the local base, and Kolux says it is behind.
        let made = create_workspace(&git, &nested(&root), &project, "off", None).unwrap();
        assert_ne!(head(&made), ahead);
        assert!(made.warnings.iter().any(|w| w.contains("main is 1 commit behind origin/main")), "{:?}", made.warnings);

        // On, but main's own worktree has uncommitted changes: left alone, with a note.
        fs::write(repo.join("a.txt"), "dirty").unwrap();
        let made = create_workspace(&git, &on, &project, "dirty", None).unwrap();
        assert_ne!(head(&made), ahead);
        assert!(made.warnings.iter().any(|w| w.contains("uncommitted changes")), "{:?}", made.warnings);
        // Off with that worktree dirty: no suggestion to update it.
        assert!(create_workspace(&git, &nested(&root), &project, "quiet", None).unwrap().warnings.is_empty());

        // On and clean: main fast-forwards and the workspace starts from it.
        git_in(&repo, &["checkout", "--", "a.txt"]);
        let made = create_workspace(&git, &on, &project, "on", None).unwrap();
        assert_eq!((head(&made), rev(&repo, "main")), (ahead.clone(), ahead.clone()));
        assert!(made.warnings.is_empty(), "{:?}", made.warnings);

        // Not checked out anywhere: the branch itself is moved on.
        git_in(&repo, &["checkout", "-q", "-b", "side"]);
        let ahead = push_one("c");
        let made = create_workspace(&git, &on, &project, "moved", Some("main")).unwrap();
        assert_eq!((head(&made), rev(&repo, "main")), (ahead.clone(), ahead.clone()));

        // A base with commits of its own is never rewound or merged.
        git_in(&repo, &["checkout", "-q", "main"]);
        git_in(&repo, &["commit", "-q", "--allow-empty", "-m", "mine"]);
        let mine = rev(&repo, "main");
        push_one("d");
        let made = create_workspace(&git, &on, &project, "kept", None).unwrap();
        assert_eq!((head(&made), rev(&repo, "main")), (mine.clone(), mine));
        assert!(made.warnings.iter().any(|w| w.contains("commits of its own")), "{:?}", made.warnings);

        drop(store);
        for d in [profile, remote, repo, other, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn secret_looking_names_are_spotted_and_templates_are_not() {
        for s in [".env", ".env.local", "config/.env.production", "prod.env", "id_rsa", "server.key", "cert.PEM", "store.p12", ".npmrc", "credentials.json", "api-token.txt", "secrets.yaml", ".git-credentials"] {
            assert!(looks_secret(s), "{s}");
        }
        for s in [".env.example", ".env.sample", "README.md", "src/tokens.ts", "id_rsa.pub", "package.json", "secret-santa.md"] {
            assert!(!looks_secret(s), "{s}");
        }
    }

    #[test]
    fn a_plain_folder_gets_git_and_a_first_commit_without_its_secrets() {
        let git = Git::detect().unwrap();
        let profile = temp("first-profile");
        let store = Store::open(&profile).unwrap();
        let dir = temp("first");
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("README.md"), "hi").unwrap();
        fs::write(dir.join("src").join("main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join(".env"), "API_KEY=not-real").unwrap();
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::write(dir.join("build").join("out.bin"), "x").unwrap();
        let preview = first_commit_preview(&dir).unwrap();
        let shown: Vec<(&str, bool)> = preview.iter().map(|f| (f.path.as_str(), f.secret)).collect();
        assert_eq!(shown, [(".env", true), (".gitignore", false), ("README.md", false), ("src/main.rs", false)]);
        assert!(!dir.join(".git").exists(), "the preview leaves the folder as it is");
        let chosen: Vec<String> = preview.iter().filter(|f| !f.secret).map(|f| f.path.clone()).collect();
        start_git(&dir, &chosen, &["-c", "user.name=t", "-c", "user.email=t@t"]).unwrap();
        let count = crate::git::run(&["rev-list", "--count", "HEAD"], Some(&dir)).unwrap();
        assert_eq!(count, "1");
        let tracked = crate::git::run(&["ls-files"], Some(&dir)).unwrap();
        assert_eq!(tracked.lines().collect::<Vec<_>>(), [".gitignore", "README.md", "src/main.rs"]);
        let p = add_project(&git, &store, &dir).unwrap();
        assert_eq!(load_projects(&store), [p]);
        // Once Git is there, neither step runs again.
        assert!(first_commit_preview(&dir).unwrap_err().contains("already a Git repository"));
        assert!(start_git(&dir, &chosen, &[]).unwrap_err().contains("already a Git repository"));
        drop(store);
        for d in [profile, dir] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn starting_git_refuses_a_relative_or_missing_path_and_a_failed_commit_leaves_no_git() {
        assert!(first_commit_preview(Path::new("some/where")).unwrap_err().contains("not a full path"));
        let gone = std::env::temp_dir().join("kolux-rs-proj-no-such-folder-61");
        assert!(start_git(&gone, &[], &[]).unwrap_err().contains("not an existing folder"));
        let dir = temp("first-fail");
        fs::write(dir.join("a.txt"), "a").unwrap();
        assert!(start_git(&dir, &["missing.txt".into()], &["-c", "user.name=t", "-c", "user.email=t@t"]).is_err());
        assert!(!dir.join(".git").exists(), "a failed first commit removes the Git it started");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn add_project_dedupes_and_rejects_non_repos() {
        let git = Git::detect().unwrap();
        let profile = temp("profile");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo");
        let p1 = add_project(&git, &store, &repo).unwrap();
        fs::create_dir_all(repo.join("deep").join("er")).unwrap();
        let p2 = add_project(&git, &store, &repo.join("deep").join("er")).unwrap();
        assert_eq!(p1, p2, "same repository registers once");
        assert_eq!(load_projects(&store).len(), 1);
        let plain = temp("plain");
        assert!(add_project(&git, &store, &plain).unwrap_err().contains("not inside a Git repository"));
        drop(store);
        for d in [profile, repo, plain] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_linked_worktree_selects_its_repository_or_is_added_itself() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("link-a");
        let linked = temp("link-wt").join("w");
        git_in(&repo, &["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy()]);
        // PROJ-006: A is a project already → picking A's linked worktree gives A, no duplicate.
        let profile = temp("link-p1");
        let store = Store::open(&profile).unwrap();
        let a = add_project(&git, &store, &repo).unwrap();
        assert_eq!(add_project(&git, &store, &linked).unwrap(), a);
        assert_eq!(load_projects(&store).len(), 1);
        drop(store);
        // A not added → the linked worktree folder itself becomes the project.
        let profile2 = temp("link-p2");
        let store = Store::open(&profile2).unwrap();
        let w = add_project(&git, &store, &linked).unwrap();
        assert!(same_folder(Path::new(&w.path), &linked), "{} is the folder picked", w.path);
        drop(store);
        git_in(&repo, &["worktree", "remove", "--force", &linked.to_string_lossy()]);
        for d in [profile, profile2, repo] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn the_branch_prefix_is_the_user_name_custom_text_or_nothing() {
        let ok = |p: &str| crate::git::run(&["check-ref-format", "--branch", &format!("{p}x")], None).is_ok();
        let user = || Some("Txais Xiong".to_string());
        assert_eq!(branch_prefix(None, None, user, &ok), ("txais-xiong/".into(), None), "the user name by default");
        assert_eq!(branch_prefix(Some("user"), None, || None, &ok), (String::new(), None), "no user name: the bare name");
        assert_eq!(branch_prefix(Some("custom"), Some(" tx// "), user, &ok).0, "tx/");
        assert_eq!(branch_prefix(Some("custom"), Some("tx"), user, &ok).0, "tx/");
        assert_eq!(branch_prefix(Some("custom"), Some("///"), user, &ok), (String::new(), None), "only slashes: none");
        assert_eq!(branch_prefix(Some("none"), Some("tx"), user, &ok), (String::new(), None));
        // GIT-066: an overly long user name gives no prefix, with a warning.
        let long = || Some("a".repeat(MAX_USER_PREFIX + 1));
        let (p, warn) = branch_prefix(None, None, long, &ok);
        assert!(p.is_empty() && warn.unwrap().contains("too long"), "a long user name is refused");
        assert_eq!(branch_prefix(None, None, || Some("a".repeat(MAX_USER_PREFIX)), &ok).0.len(), MAX_USER_PREFIX + 1);
        // The git user name first, then the gh login.
        assert_eq!(prefix_user(|| Some("Git Name".into()), || Some("ghlogin".into())).as_deref(), Some("Git Name"));
        assert_eq!(prefix_user(|| None, || Some("ghlogin".into())).as_deref(), Some("ghlogin"));
        assert_eq!(prefix_user(|| Some(" ".into()), || None), None);
        let (p, warn) = branch_prefix(Some("custom"), Some("a b"), user, &ok);
        assert!(p.is_empty() && warn.unwrap().contains("not a name Git accepts"), "Git refuses spaces");
        // The prefix goes on the branch only; the folder keeps the bare name.
        let git = Git::detect().unwrap();
        let profile = temp("prefix");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("prefix-r");
        let root = temp("prefix-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = Place { prefix: "tx/".into(), ..nested(&root) };
        let made = create_workspace(&git, &place, &project, "Fix login", None).unwrap();
        assert_eq!(made.worktree.branch.as_deref(), Some("tx/fix-login"));
        assert!(same_folder(Path::new(&made.worktree.path), &workspace_path(&place, &project, "fix-login")));
        let bad = Place { prefix_warning: Some("w".into()), ..nested(&root) };
        assert_eq!(create_workspace(&git, &bad, &project, "two", None).unwrap().warnings, vec!["w".to_string()]);
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn sess038_a_create_git_finds_locked_is_retried_and_a_failed_one_leaves_nothing() {
        use std::time::{Duration, Instant};
        assert!(lock_held("fatal: cannot lock ref 'refs/heads/x': Unable to create 'C:/r/.git/refs/heads/x.lock': File exists."));
        assert!(lock_held("Another git process seems to be running in this repository"));
        assert!(!lock_held("fatal: invalid reference: nope"));
        let git = Git::detect().unwrap();
        let profile = temp("locked");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("locked-r");
        let root = temp("locked-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);
        // Another Git process holds the new branch's lock the whole time: three tries, then the
        // error, and nothing half-made is left.
        let lock = repo.join(".git").join("refs").join("heads").join("held.lock");
        fs::write(&lock, "").unwrap();
        let started = Instant::now();
        let err = create_workspace_until(&git, &place, &project, "held", None, &|| false).unwrap_err();
        assert!(lock_held(&err), "{err}");
        assert!(started.elapsed() >= Duration::from_millis(900), "it waited between three tries");
        assert!(!workspace_path(&place, &project, "held").exists(), "no half-made folder");
        assert!(!git.branch_taken(&repo, "held"), "no half-made branch");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "only the main checkout");
        // The lock goes while Kolux waits: a later try makes the workspace.
        let gone = lock.clone();
        let other = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            fs::remove_file(gone).unwrap();
        });
        let made = create_workspace_until(&git, &place, &project, "held", None, &|| false).unwrap();
        other.join().unwrap();
        assert_eq!(made.worktree.branch.as_deref(), Some("held"));
        // Cancelled while it waits: no further try.
        fs::write(repo.join(".git").join("refs").join("heads").join("again.lock"), "").unwrap();
        let tries = std::cell::Cell::new(0);
        let cancel_after_first = || {
            tries.set(tries.get() + 1);
            tries.get() > 1
        };
        assert_eq!(create_workspace_until(&git, &place, &project, "again", None, &cancel_after_first).unwrap_err(), OVERTAKEN);
        assert!(!workspace_path(&place, &project, "again").exists());
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// A project with two made workspaces ("one", "two") for the PROJ-068 / PROJ-072 tests.
    fn project_with_workspaces(tag: &str) -> (Git, Store, Project, PathBuf, Vec<PathBuf>, Place) {
        let git = Git::detect().unwrap();
        let profile = temp(tag);
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo(&format!("{tag}-r"));
        let root = temp(&format!("{tag}-root"));
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);
        for n in ["one", "two"] {
            let made = create_workspace(&git, &place, &project, n, None).unwrap();
            set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
        }
        (git, store, project, repo, vec![profile, root], place)
    }

    #[test]
    fn proj072_a_folder_deleted_by_hand_is_cleaned_up_without_an_error() {
        let (git, _store, project, repo, junk, place) = project_with_workspaces("gone072");
        let dest = workspace_path(&place, &project, "one");
        fs::remove_dir_all(&dest).unwrap();
        assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&dest.to_string_lossy())), "Git still tracks it");
        let check = remove_check(&git, &project, &dest.to_string_lossy()).unwrap();
        assert!(check.missing && check.changes.is_empty(), "{check:?}");
        assert_eq!(removal_refused(&check, false, &check.stamp), None);
        remove_worktree(&git, &project, &dest.to_string_lossy(), false, false).unwrap();
        let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
        assert!(!left.iter().any(|p| p.ends_with("one")) && left.iter().any(|p| p.ends_with("two")), "{left:?}");
        assert!(!git.branch_taken(&repo, "one"), "its branch went with it");
        for d in junk.into_iter().chain([repo]) {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj072_a_registration_git_still_reports_is_never_removed_underneath_it() {
        let (git, _store, project, repo, junk, place) = project_with_workspaces("locked072");
        let dest = workspace_path(&place, &project, "two");
        git_in(&repo, &["worktree", "lock", "--reason", "on a stick", &dest.to_string_lossy()]);
        fs::remove_dir_all(&dest).unwrap();
        let err = remove_worktree(&git, &project, &dest.to_string_lossy(), true, false).unwrap_err();
        assert!(err.contains("still lists"), "{err}");
        assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&dest.to_string_lossy())), "the record is untouched");
        for d in junk.into_iter().chain([repo]) {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj072_a_too_long_path_failure_is_recognised_and_gits_other_failures_are_not() {
        for e in ["error: unable to delete 'x': Filename too long", "fatal: cannot remove: Path too long", "File name too long"] {
            assert!(crate::git::path_too_long(e), "{e}");
        }
        assert!(!crate::git::path_too_long("fatal: validation failed, cannot remove working tree: contains modified files"));
        assert_eq!(crate::git::long_path(Path::new("relative/x")), PathBuf::from("relative/x"));
        #[cfg(windows)]
        assert!(crate::git::long_path(Path::new("C:/a/b")).to_string_lossy().starts_with(r"\\?\C:"));
    }

    #[test]
    fn proj072_a_leftover_folder_after_git_let_go_is_cleaned_up() {
        let (git, _store, project, repo, junk, place) = project_with_workspaces("left072");
        let dest = workspace_path(&place, &project, "one");
        // Locked files cannot be faked portably; a read-only-free stand-in: an ignored deep tree Git itself removes.
        fs::create_dir_all(dest.join("a/b/c")).unwrap();
        fs::write(dest.join("a/b/c/f.txt"), "x").unwrap();
        fs::write(dest.join("stray.log"), "x").unwrap();
        remove_worktree(&git, &project, &dest.to_string_lossy(), true, false).unwrap();
        assert!(!dest.exists());
        for d in junk.into_iter().chain([repo]) {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj068_refreshing_twice_changes_no_row_and_names_and_parents_stay_with_their_workspace() {
        let (git, store, project, repo, junk, place) = project_with_workspaces("rows068");
        let (one, two) = (workspace_path(&place, &project, "one").to_string_lossy().into_owned(), workspace_path(&place, &project, "two").to_string_lossy().into_owned());
        set_name(&store, &one, Some("Alpha")).unwrap();
        set_parent(&store, &two, Some(&one)).unwrap();
        let first = list_workspaces(&git, &store, &project).unwrap();
        let second = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(first, second, "nothing changed, so nothing moved");
        let find = |all: &[Worktree], p: &str| all.iter().find(|w| name_key(&w.path) == name_key(p)).cloned().unwrap();
        assert_eq!(find(&second, &one).name.as_deref(), Some("Alpha"));
        assert_eq!(find(&second, &two).parent.as_deref().map(name_key), Some(name_key(&one)));
        // A name change on one workspace leaves the other's record and the order alone.
        set_name(&store, &one, Some("Beta")).unwrap();
        let third = list_workspaces(&git, &store, &project).unwrap();
        let order = |all: &[Worktree]| all.iter().map(|w| name_key(&w.path)).collect::<Vec<_>>();
        assert_eq!(order(&second), order(&third));
        assert_eq!(find(&third, &two).parent.as_deref().map(name_key), Some(name_key(&one)));
        for d in junk.into_iter().chain([repo]) {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj031_a_failed_create_says_what_kind_of_problem_it_was_and_keeps_gits_words() {
        let said = |raw: &str| explain_create_error(raw.to_string());
        for (raw, kind, word) in [
            ("fatal: invalid reference: origin/gone", CreateKind::MissingBase, "missing"),
            ("fatal: not a valid object name: 'x'", CreateKind::MissingBase, "missing"),
            ("fatal: a branch named 'x' already exists", CreateKind::NameInUse, "already in use"),
            ("fatal: 'x' is already checked out at 'C:/r'", CreateKind::NameInUse, "already in use"),
            ("error: unable to create file: Permission denied", CreateKind::Permissions, "refused access"),
            ("fatal: something odd", CreateKind::GitFailure, "Git could not"),
        ] {
            assert_eq!(create_kind(raw), kind, "{raw}");
            let out = said(raw);
            assert!(out.contains(word), "{out}");
            assert!(out.ends_with(&format!("{GIT_SAID}{raw}")), "Git's full output rides along: {out}");
        }
        assert_eq!(said(OVERTAKEN), OVERTAKEN, "a cancel is not rewritten");
        let stalled = "Git did not finish in 180 seconds, so Kolux stopped waiting.";
        assert_eq!(said(stalled), stalled);
    }

    #[test]
    fn proj031_opening_a_branch_that_is_already_checked_out_names_the_problem() {
        let git = Git::detect().unwrap();
        let profile = temp("explain");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("explain-r");
        let root = temp("explain-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);
        git_in(&repo, &["branch", "kept"]);
        open_branch_workspace_until(&git, &place, &project, "kept", None, &|| false).unwrap();
        let err = open_branch_workspace_until(&git, &place, &project, "kept", Some("again"), &|| false).unwrap_err();
        assert!(err.starts_with("The workspace could not be made: that name or branch is already in use."), "{err}");
        assert!(err.contains(GIT_SAID), "{err}");
        let err = create_workspace_until(&git, &place, &project, "x", Some("no-such-ref"), &|| false).unwrap_err();
        assert!(err.starts_with("The workspace could not start: no-such-ref is not a branch"), "{err}");
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj020_an_overtaken_create_is_cancelled_and_its_half_made_checkout_removed() {
        let git = Git::detect().unwrap();
        let profile = temp("overtaken");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("overtaken-r");
        let root = temp("overtaken-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);
        // Overtaken while Git was making the worktree: the folder and the new branch both go.
        let asked = std::cell::Cell::new(0);
        let late = || {
            asked.set(asked.get() + 1);
            asked.get() > 1
        };
        let err = create_workspace_until(&git, &place, &project, "first", None, &late).unwrap_err();
        assert_eq!(err, OVERTAKEN);
        assert!(!workspace_path(&place, &project, "first").exists(), "the half-made folder is removed");
        assert!(!git.branch_taken(&repo, "first"), "the half-made branch is removed");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "only the main checkout is left");
        // Overtaken before it began: nothing is made at all.
        assert_eq!(create_workspace_until(&git, &place, &project, "second", None, &|| true).unwrap_err(), OVERTAKEN);
        assert!(!workspace_path(&place, &project, "second").exists());
        // An existing branch opened as a workspace keeps its branch when overtaken.
        git_in(&repo, &["branch", "kept"]);
        asked.set(0);
        assert_eq!(open_branch_workspace_until(&git, &place, &project, "kept", None, &late).unwrap_err(), OVERTAKEN);
        assert!(!workspace_path(&place, &project, "kept").exists());
        assert!(git.branch_taken(&repo, "kept"), "a branch that existed before stays");
        // A create nobody overtook is untouched by the tickets of others.
        drop_create(41);
        assert!(dropped(Some(41)) && !dropped(Some(42)) && !dropped(None));
        assert!(create_workspace_until(&git, &place, &project, "third", None, &|| dropped(Some(42))).is_ok());
        settle_create(41);
        assert!(!dropped(Some(41)));
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn a_workspace_opens_on_an_existing_branch_and_keeps_it() {
        let git = Git::detect().unwrap();
        let profile = temp("open-b");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("open-r");
        let root = temp("open-root");
        git_in(&repo, &["checkout", "-q", "-b", "feat/x"]);
        fs::write(repo.join("b.txt"), "b").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "earlier work"]);
        git_in(&repo, &["checkout", "-q", "main"]);
        let tip = rev(&repo, "feat/x");
        let project = add_project(&git, &store, &repo).unwrap();
        assert!(branches(&repo).unwrap().contains(&"feat/x".to_string()));
        assert!(open_branch_workspace(&git, &nested(&root), &project, "nope", None).unwrap_err().contains("no branch nope"));
        // PROJ-030: a different folder name still checks out feat/x itself, with its commits.
        let made = open_branch_workspace(&git, &nested(&root), &project, "feat/x", Some("Review X")).unwrap();
        assert_eq!(made.worktree.branch.as_deref(), Some("feat/x"));
        assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), tip);
        assert!(made.worktree.path.replace(std::path::MAIN_SEPARATOR, "/").ends_with("/review-x"), "{}", made.worktree.path);
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "existingBranch": true }))).unwrap();
        assert!(keeps_branch(&store, &made.worktree.path));
        remove_worktree(&git, &project, &made.worktree.path, false, keeps_branch(&store, &made.worktree.path)).unwrap();
        assert_eq!(rev(&repo, "feat/x"), tip, "the branch stays when the workspace goes");
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn row116_one_kept_type_goes_out_and_comes_back_in_the_shape_the_page_sends() {
        let k = Kept { branch: "feat/x".into(), commit: "abc1234".into() };
        let json = serde_json::to_value(&k).unwrap();
        assert_eq!(json, serde_json::json!({ "branch": "feat/x", "commit": "abc1234" }));
        assert_eq!(serde_json::from_value::<Kept>(json).unwrap(), k);
    }

    #[test]
    fn a_branch_kept_at_removal_is_reported_and_deleted_later_only_while_it_has_not_moved() {
        let git = Git::detect().unwrap();
        let profile = temp("kept");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("kept-r");
        let root = temp("kept-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let a = create_workspace(&git, &nested(&root), &project, "keep-me", None).unwrap();
        let branch = a.worktree.branch.clone().unwrap();
        let tip = rev(&repo, &branch);
        // Keep chosen in the remove form: the folder goes, the branch stays, and we are told where it was.
        let kept = remove_worktree(&git, &project, &a.worktree.path, false, true).unwrap().unwrap();
        assert_eq!(kept, Kept { branch: branch.clone(), commit: tip.clone() });
        assert!(git.delete_branch_if_at(Path::new(&project.path), &kept.branch, &kept.commit).unwrap(), "unmoved: deleted");
        assert!(!branches(&repo).unwrap().contains(&branch));
        // Without the choice the branch goes with the workspace and nothing is kept.
        let b = create_workspace(&git, &nested(&root), &project, "drop-me", None).unwrap();
        assert_eq!(remove_worktree(&git, &project, &b.worktree.path, false, false).unwrap(), None);
        // A kept branch that moved on since is left alone.
        let c = create_workspace(&git, &nested(&root), &project, "moved-on", None).unwrap();
        let cb = c.worktree.branch.clone().unwrap();
        let kept = remove_worktree(&git, &project, &c.worktree.path, false, true).unwrap().unwrap();
        git_in(&repo, &["checkout", "-q", &cb]);
        fs::write(repo.join("n.txt"), "n").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "more"]);
        git_in(&repo, &["checkout", "-q", "main"]);
        assert!(!git.delete_branch_if_at(Path::new(&project.path), &kept.branch, &kept.commit).unwrap(), "moved: left alone");
        assert!(branches(&repo).unwrap().contains(&cb));
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn own_worktrees_are_managed_and_outside_ones_follow_the_visibility_choice() {
        use crate::visibility as vis;
        let git = Git::detect().unwrap();
        let profile = temp("vis");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("vis-r");
        let root = temp("vis-root");
        let side = temp("vis-side");
        let p = |d: &Path| d.to_string_lossy().to_string();
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
        // A fresh profile: a project added now starts with worktrees made elsewhere hidden.
        let project = add_project(&git, &store, &repo).unwrap();
        let made = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &load_projects(&store), &project, None).unwrap();
        let hand = root.join("by-hand");
        let claude = repo.join(".claude").join("worktrees").join("agent-1");
        let scratch = repo.join(".tool").join("x");
        let away = side.join("away");
        for (b, d) in [("hand", &hand), ("cc", &claude), ("scr", &scratch), ("away", &away)] {
            git_in(&repo, &["worktree", "add", "-q", "-b", b, &p(d)]);
        }
        let look = |store: &Store, project: &Project| -> Vec<(String, String, Option<String>, bool)> {
            list_workspaces(&git, store, project).unwrap().into_iter().map(|w| (w.branch.clone().unwrap_or_default(), w.kind.clone(), w.source.clone(), w.hidden)).collect()
        };
        let row = |rows: &[(String, String, Option<String>, bool)], b: &str| rows.iter().find(|r| r.0 == b).cloned();
        let rows = look(&store, &project);
        assert_eq!(row(&rows, "main").unwrap().1, "main");
        let mine = row(&rows, made.branch.as_deref().unwrap()).unwrap();
        assert_eq!((mine.1.as_str(), mine.3), ("managed", false), "Kolux's own is managed and shown");
        assert_eq!(row(&rows, "hand"), Some(("hand".into(), "external".into(), Some("other".into()), true)), "by hand inside the workspaces folder is external");
        assert_eq!(row(&rows, "cc"), Some(("cc".into(), "external".into(), Some("claude".into()), true)));
        assert_eq!(row(&rows, "away"), Some(("away".into(), "external".into(), Some("other".into()), true)));
        assert!(row(&rows, "scr").is_none(), "another tool's scratch folder is never listed");
        // Moved workspaces folder: Kolux's own record still makes it managed.
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&side.join("elsewhere")) })).unwrap();
        assert_eq!(row(&look(&store, &project), made.branch.as_deref().unwrap()).unwrap().1, "managed");
        // A base folder set on purpose beats the scratch rule.
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&repo.join(".tool")) })).unwrap();
        assert_eq!(row(&look(&store, &project), "scr").map(|r| r.2), Some(Some("other".into())));
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
        // Global and per-project choices; the global never overwrites the project's own.
        vis::set_choice(&store, None, "other", Some(true)).unwrap();
        assert!(!row(&look(&store, &project), "hand").unwrap().3);
        vis::set_choice(&store, Some(&project.id), "other", Some(false)).unwrap();
        vis::set_choice(&store, None, "other", Some(false)).unwrap();
        vis::set_choice(&store, None, "other", Some(true)).unwrap();
        assert!(row(&look(&store, &project), "hand").unwrap().3, "the project's own choice stays");
        let src = vis::sources(&store, Some(&project));
        let other = src.iter().find(|s| s.key == "other").unwrap();
        assert_eq!((other.global, other.own), (true, Some(false)), "the override shows the global value it replaces");
        vis::set_choice(&store, Some(&project.id), "other", None).unwrap();
        assert!(!row(&look(&store, &project), "hand").unwrap().3, "reset: back to the global choice");
        // Extra root folders start hidden, at most 32, each mistake its own error.
        vis::add_root(&store, &p(&side)).unwrap();
        let r = row(&look(&store, &project), "away").unwrap();
        assert!(r.2.as_deref().unwrap().starts_with("root:") && r.3, "{r:?}");
        assert!(vis::add_root(&store, "relative\\folder").unwrap_err().contains("not a folder"));
        assert!(vis::add_root(&store, &p(&side)).unwrap_err().contains("already"));
        for i in 1..32 {
            let d = side.join(format!("r{i}"));
            fs::create_dir_all(&d).unwrap();
            vis::add_root(&store, &p(&d)).unwrap();
        }
        let d = side.join("r32");
        fs::create_dir_all(&d).unwrap();
        assert!(vis::add_root(&store, &p(&d)).unwrap_err().contains("at most 32"));
        // One worktree shown by hand wins over its source's choice.
        set_hidden(&store, &p(&claude), false).unwrap();
        assert!(!row(&look(&store, &project), "cc").unwrap().3);
        // A profile that had projects before this choice existed keeps showing them.
        let profile2 = temp("vis-old");
        let old = Store::open(&profile2).unwrap();
        let project2 = add_project(&git, &old, &repo).unwrap();
        old.set("worktreeVisibility", "null").unwrap();
        assert!(!row(&look(&old, &project2), "hand").unwrap().3, "an earlier project keeps its earlier behaviour");
        assert!(row(&look(&old, &project2), "cc").unwrap().3, "Claude Code's scratch stayed hidden before, and still does");
        drop(store);
        drop(old);
        for d in [&hand, &claude, &scratch, &away] {
            let _ = git.worktree_remove(&repo, d, None);
        }
        for d in [profile, profile2, repo, root, side] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj044_a_worktree_gsd_marked_counts_as_made_by_gsd() {
        let git = Git::detect().unwrap();
        let profile = temp("gsd");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("gsd-r");
        let p = |d: &Path| d.to_string_lossy().to_string();
        let project = add_project(&git, &store, &repo).unwrap();
        let cc = repo.join(".claude").join("worktrees");
        let (gsd, plain) = (cc.join("agent-a1"), cc.join("agent-b2"));
        git_in(&repo, &["worktree", "add", "-q", "-b", "worktree-agent-a1", &p(&gsd)]);
        git_in(&repo, &["worktree", "add", "-q", "-b", "worktree-agent-b2", &p(&plain)]);
        // GSD's executor leaves `gsd-spawn-toplevel` in the worktree's own Git folder.
        let link = fs::read_to_string(gsd.join(".git")).unwrap();
        let admin = PathBuf::from(link.trim().strip_prefix("gitdir:").unwrap().trim());
        fs::write(admin.join("gsd-spawn-toplevel"), p(&gsd)).unwrap();
        let rows: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().map(|w| (w.branch.unwrap_or_default(), w.source, w.hidden)).collect();
        assert!(rows.contains(&("worktree-agent-a1".into(), Some("gsd".into()), true)), "{rows:?}");
        assert!(rows.contains(&("worktree-agent-b2".into(), Some("claude".into()), true)), "{rows:?}");
        let src = crate::visibility::sources(&store, Some(&project));
        assert_eq!(src.iter().map(|s| s.label.as_str()).take(3).collect::<Vec<_>>(), ["Made by Claude Code", "Made by GSD", "Elsewhere on disk"]);
        crate::visibility::set_choice(&store, None, "gsd", Some(true)).unwrap();
        let shown = list_workspaces(&git, &store, &project).unwrap();
        assert!(!shown.iter().find(|w| w.branch.as_deref() == Some("worktree-agent-a1")).unwrap().hidden, "its own choice shows it");
        assert!(shown.iter().find(|w| w.branch.as_deref() == Some("worktree-agent-b2")).unwrap().hidden, "Claude Code's stay hidden");
        drop(store);
        for d in [&gsd, &plain] {
            let _ = git.worktree_remove(&repo, d, None);
        }
        for d in [profile, repo] {
            let _ = fs::remove_dir_all(d);
        }
    }

    // T-442-c: the sidebar's one call gives what workspace_list and workspace_unseen gave in two.
    #[test]
    fn one_scan_gives_the_list_and_the_unseen_alike() {
        let git = Git::detect().unwrap();
        let profile = temp("scanned");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("scanned-r");
        let side = temp("scanned-side");
        let project = add_project(&git, &store, &repo).unwrap();
        let first = scanned_of(&store, &project, git.worktrees(Path::new(&project.path)).unwrap()).unwrap();
        assert!(first.unseen.is_empty(), "the first scan takes what is there as seen");
        assert_eq!(first.list.len(), 1);
        git_in(&repo, &["worktree", "add", "-q", "-b", "outside", &side.join("outside").to_string_lossy()]);
        crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
        let all = git.worktrees(Path::new(&project.path)).unwrap();
        let both = scanned_of(&store, &project, all.clone()).unwrap();
        assert_eq!(both.list, decorate(&store, &project, all).unwrap());
        let fresh: Vec<_> = both.unseen.iter().map(|w| w.branch.clone().unwrap()).collect();
        assert_eq!(fresh, ["outside"]);
        assert_eq!(both.list.len(), 2);
        for d in [profile, repo, side] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn worktrees_made_outside_kolux_are_noticed_once_and_can_be_hidden() {
        let git = Git::detect().unwrap();
        let profile = temp("unseen");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("unseen-r");
        let side = temp("unseen-side");
        let root = temp("unseen-root");
        git_in(&repo, &["worktree", "add", "-q", "-b", "before", &side.join("before").to_string_lossy()]);
        let project = add_project(&git, &store, &repo).unwrap();
        assert!(unseen(&git, &store, &project).unwrap().is_empty(), "the first scan takes what is there as seen");
        // Three made at once with plain Git: one list, so one notice.
        for n in ["a", "b", "c"] {
            git_in(&repo, &["worktree", "add", "-q", "-b", n, &side.join(n).to_string_lossy()]);
        }
        // One Kolux makes itself is not offered.
        create_fresh_workspace(&git, || Ok(&store), &nested(&root), &load_projects(&store), &project, None).unwrap();
        let fresh: Vec<_> = unseen(&git, &store, &project).unwrap().into_iter().map(|w| w.branch.unwrap()).collect();
        assert_eq!(fresh.len(), 3, "{fresh:?}");
        assert!(fresh.iter().all(|b| ["a", "b", "c"].contains(&b.as_str())));
        mark_all_seen(&git, &store, &project).unwrap();
        assert!(unseen(&git, &store, &project).unwrap().is_empty());
        // Gone and made again: new again.
        git_in(&repo, &["worktree", "remove", &side.join("a").to_string_lossy()]);
        assert!(unseen(&git, &store, &project).unwrap().is_empty());
        git_in(&repo, &["worktree", "add", "-q", &side.join("a").to_string_lossy(), "a"]);
        assert_eq!(unseen(&git, &store, &project).unwrap().len(), 1);
        // PROJ-042: hide one, show it again; the main checkout is never hidden. (Worktrees made
        // elsewhere start hidden in a new project, so show them first.)
        crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
        let b = side.join("b").to_string_lossy().to_string();
        let hidden = |store: &Store| list_workspaces(&git, store, &project).unwrap().into_iter().filter(|w| w.hidden).map(|w| w.branch.unwrap()).collect::<Vec<_>>();
        set_hidden(&store, &b, true).unwrap();
        set_hidden(&store, &project.path, true).unwrap();
        assert_eq!(hidden(&store), vec!["b".to_string()]);
        set_hidden(&store, &b, false).unwrap();
        assert!(hidden(&store).is_empty());
        drop(store);
        for d in [profile, repo, side, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn sess037_the_advanced_branch_name_wins_and_the_typed_name_stays_the_label() {
        let git = Git::detect().unwrap();
        let profile = temp("profile-sess037");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo-sess037");
        let root = temp("root-sess037");
        let mut settings = store.settings();
        settings["branchPrefix"] = serde_json::json!("none");
        settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
        store.save_settings(&settings).unwrap();
        let project = add_project(&git, &store, &repo).unwrap();
        let store = Mutex::new(store);
        let made = create_named(&git, &store, &project.id, "Fix login", None, Some("feat/x")).unwrap().worktree;
        assert_eq!(made.branch.as_deref(), Some("feat-x"));
        assert_eq!(made.name.as_deref(), Some("Fix login"));
        let plain = create_named(&git, &store, &project.id, "Fix login", None, None).unwrap().worktree;
        assert_eq!(plain.branch.as_deref(), Some("fix-login"));
        assert_eq!(plain.name.as_deref(), Some("Fix login"));
    }

    #[test]
    fn create_and_remove_workspace_through_the_project() {
        let git = Git::detect().unwrap();
        let profile = temp("profile2");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo2");
        let root = temp("root2");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);

        // SESS-036: a name that cleans up to nothing becomes "workspace".
        let blank = create_workspace(&git, &place, &project, "???", None).unwrap().worktree;
        assert_eq!(blank.branch.as_deref(), Some("workspace"));
        let wt = create_workspace(&git, &place, &project, "Fix login \u{1F525}", None).unwrap().worktree;
        assert_eq!(wt.branch.as_deref(), Some("fix-login-fire"));
        let expected = workspace_path(&place, &project, "fix-login-fire");
        assert!(expected.join("a.txt").is_file());
        let again = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
        assert_eq!(again.branch.as_deref(), Some("fix-login-fire-2"), "a taken name gets a number");
        git_in(&repo, &["update-ref", "refs/remotes/origin/fix-login-fire-3", "HEAD"]);
        let third = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
        assert_eq!(third.branch.as_deref(), Some("fix-login-fire-4"), "a name on a remote counts as taken");
        set_name(&store, &wt.path, Some("Fix login \u{1F525}")).unwrap();
        let listed = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(listed.iter().find(|w| w.path == wt.path).unwrap().name.as_deref(), Some("Fix login \u{1F525}"), "the typed name is shown");
        assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().name, None);
        // PROJ-047: a workspace made from another one is listed with that parent, and removing it
        // forgets the link so a later workspace in the same folder starts at the top level.
        set_parent(&store, &third.path, Some(&wt.path)).unwrap();
        let listed = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(listed.iter().find(|w| w.path == third.path).unwrap().parent.as_deref(), Some(wt.path.as_str()));
        assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().parent, None);
        for w in [&again, &third] {
            remove_workspace(&git, &project, &w.path, false).unwrap();
            forget_workspace(&store, &w.path).unwrap();
        }
        assert!(store.get("workspaceParents").unwrap().unwrap() == "{}");

        assert!(remove_workspace(&git, &project, &project.path, false).unwrap_err().contains("main checkout"));
        remove_workspace(&git, &project, &wt.path, false).unwrap();
        assert!(!expected.exists());
        assert!(!git.branch_taken(&repo, "fix-login-fire"));
        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn proj040_proj048_a_parent_must_still_be_there_and_never_makes_a_loop() {
        let git = Git::detect().unwrap();
        let profile = temp("profile-proj048");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo-proj048");
        let root = temp("root-proj048");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);
        let make = |n: &str| create_workspace(&git, &place, &project, n, None).unwrap();
        let (a, kid, b) = (make("a").worktree, make("kid").worktree, make("b").worktree);
        set_parent(&store, &kid.path, Some(&a.path)).unwrap();
        // PROJ-048: never itself, never under its own descendant, never under the main checkout.
        assert!(reparent(&git, &store, &project, &a.path, Some(&a.path)).unwrap_err().contains("its own parent"));
        assert!(reparent(&git, &store, &project, &a.path, Some(&kid.path)).unwrap_err().contains("loop"));
        assert!(reparent(&git, &store, &project, &a.path, Some(&project.path)).unwrap_err().contains("main checkout"));
        assert!(reparent(&git, &store, &project, &project.path, Some(&a.path)).unwrap_err().contains("main checkout"));
        assert!(reparent(&git, &store, &project, &a.path, Some("C:/nowhere")).unwrap_err().contains("no longer"));
        reparent(&git, &store, &project, &a.path, Some(&b.path)).unwrap();
        let parent_of = |p: &str| list_workspaces(&git, &store, &project).unwrap().into_iter().find(|w| w.path == p).unwrap().parent;
        assert_eq!(parent_of(&a.path).as_deref(), Some(b.path.as_str()));
        reparent(&git, &store, &project, &a.path, None).unwrap();
        assert_eq!(parent_of(&a.path), None);
        // PROJ-040: a parent removed while the composer was open is dropped with a warning.
        let store = Mutex::new(store);
        let parent_of = |p: &str| list_workspaces(&git, &store.lock().unwrap(), &project).unwrap().into_iter().find(|w| w.path == p).unwrap().parent;
        let mut made = make("late");
        remove_workspace(&git, &project, &b.path, false).unwrap();
        nest_under(&git, &store, &project, &mut made, Some(&b.path), None).unwrap();
        assert_eq!(made.worktree.parent, None);
        assert!(made.warnings.iter().any(|w| w.contains("top level")), "{:?}", made.warnings);
        assert_eq!(parent_of(&made.worktree.path), None);
        let mut nested_ok = make("under-a");
        nest_under(&git, &store, &project, &mut nested_ok, Some(&a.path), None).unwrap();
        assert_eq!(parent_of(&nested_ok.worktree.path).as_deref(), Some(a.path.as_str()));
        assert!(nested_ok.warnings.is_empty());
        // PROJ-040: with a folder workspace active, the dropped parent's place is the folder workspace; any other workspace does not count.
        let plain = temp("root-proj040-plain");
        let folder = crate::folder_projects::add_folder(&store.lock().unwrap(), &plain).unwrap();
        let folder_ws = crate::folder_projects::folder_only(&store.lock().unwrap(), &folder).unwrap().path;
        let mut fell = make("fell");
        nest_under(&git, &store, &project, &mut fell, Some(&b.path), Some(&folder_ws)).unwrap();
        assert_eq!(fell.worktree.parent.as_deref(), Some(folder_ws.as_str()));
        assert_eq!(parent_of(&fell.worktree.path).as_deref(), Some(folder_ws.as_str()));
        assert!(fell.warnings.iter().any(|w| w.contains("active folder workspace")), "{:?}", fell.warnings);
        let mut not_folder = make("not-folder");
        nest_under(&git, &store, &project, &mut not_folder, Some(&b.path), Some(&a.path)).unwrap();
        assert_eq!(not_folder.worktree.parent, None);
        assert!(not_folder.warnings.iter().any(|w| w.contains("top level")), "{:?}", not_folder.warnings);
        // a parent that is still there wins over the active folder workspace
        let mut kept = make("kept");
        nest_under(&git, &store, &project, &mut kept, Some(&a.path), Some(&folder_ws)).unwrap();
        assert_eq!(parent_of(&kept.worktree.path).as_deref(), Some(a.path.as_str()));
        let _ = fs::remove_dir_all(plain);
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj023_a_suggestion_skips_every_name_in_use_in_any_project_whatever_its_case() {
        let git = Git::detect().unwrap();
        let profile = temp("suggest-profile");
        let store = Store::open(&profile).unwrap();
        let (repo_a, repo_b) = (temp_repo("suggest-a"), temp_repo("suggest-b"));
        let (root_a, root_b) = (temp("suggest-root-a"), temp("suggest-root-b"));
        let a = add_project(&git, &store, &repo_a).unwrap();
        let b = add_project(&git, &store, &repo_b).unwrap();
        let place_a = nested(&root_a);
        let ask = |seed: u64| suggest_name(&git, || Ok(&store), &place_a, &a, seed).unwrap();

        let first = ask(11);
        assert_eq!(first, first.to_lowercase(), "lowercase");
        assert_eq!(ask(11), first, "asking records nothing: the same name is offered again");
        assert!(retired_names(&store, &retired_scope(&place_a, &a)).is_empty(), "a suggestion nobody uses costs no name");

        // The name is in use by a workspace of the OTHER project: never offered to this one.
        create_workspace(&git, &nested(&root_b), &b, &first, None).unwrap();
        let second = ask(11);
        assert_ne!(second, first);

        // Under a branch prefix the folder differs, but the last part of the branch still counts.
        let third_dir = root_a.join("wt3");
        git_in(&repo_a, &["worktree", "add", "-q", "-b", &format!("kolux/{second}"), &third_dir.to_string_lossy()]);
        let third = ask(11);
        assert!(![&first, &second].contains(&&third), "{third}");

        // A shown name typed by hand counts too, whatever its case.
        let made = create_workspace(&git, &nested(&root_a), &a, "plain", None).unwrap().worktree;
        set_name(&store, &made.path, Some(&third.to_uppercase())).unwrap();
        let fourth = ask(11);
        assert!(![&first, &second, &third].contains(&&fourth), "{fourth}");

        drop(store);
        for d in [profile, repo_a, repo_b, root_a, root_b] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj024_only_suggested_names_are_retired_per_scope_ignoring_case_and_spaces() {
        let profile = temp("retire-profile");
        let store = Store::open(&profile).unwrap();
        let (flat_a, flat_b) = (Project { id: "a".into(), name: "alpha".into(), path: "C:/alpha".into(), workspaces_dir: None, base: None, display_name: None }, Project { id: "b".into(), name: "beta".into(), path: "C:/beta".into(), workspaces_dir: None, base: None, display_name: None });
        let flat = Place { root: PathBuf::from("C:/ws"), flat: true, prefix: String::new(), prefix_warning: None, refresh: false };
        let nest = Place { root: PathBuf::from("C:/ws"), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
        let (fa, fb) = (retired_scope(&flat, &flat_a), retired_scope(&flat, &flat_b));
        assert_eq!(fa, fb, "flat layout: projects sharing the workspaces folder share their retired names");
        let (na, nb) = (retired_scope(&nest, &flat_a), retired_scope(&nest, &flat_b));
        assert_ne!(na, nb, "nested layout: each project keeps its own");

        // Delete a suggested name, a numbered one, and a freely typed one.
        let first = creature_name(&[], 3);
        forget_workspace(&store, &format!("C:/ws/alpha/{first}")).unwrap();
        forget_workspace(&store, "C:/ws/alpha/login-fix").unwrap();
        let numbered = creature_name(&(0..676).map(|s| creature_name(&[], s)).collect::<Vec<_>>(), 3);
        assert!(numbered.ends_with("-2"));
        forget_workspace(&store, &format!("C:/ws/alpha/{numbered}")).unwrap();
        assert_eq!(retired_names(&store, &na), vec![first.clone(), numbered.clone()], "login-fix was typed freely: not kept");
        assert!(retired_names(&store, &nb).is_empty(), "another project's nested folder is untouched");

        // Retired names survive a restart and are skipped for any seed, case and spaces ignored.
        drop(store);
        let store = Store::open(&profile).unwrap();
        retire_name(&store, &na, &first.to_uppercase().replace('-', " - ")).unwrap();
        assert_eq!(retired_names(&store, &na).len(), 2, "same name once: spaces differ, hyphen is the name");
        for seed in 0..700u64 {
            let pick = pick_name(&store, &na, vec![], seed);
            assert_ne!(pick, first, "seed {seed}");
        }
        // The shown (typed) name of the deleted workspace counts too when it is a suggested one.
        let other = creature_name(std::slice::from_ref(&first), 3);
        set_name(&store, "C:/ws/alpha/folder-x", Some(&other.to_uppercase())).unwrap();
        forget_workspace(&store, "C:/ws/alpha/folder-x").unwrap();
        assert!(retired_names(&store, &na).contains(&other));

        // Flat layout: both projects see the one record.
        forget_workspace(&store, &format!("C:/ws/{first}")).unwrap();
        assert_eq!(retired_names(&store, &fa), vec![first.clone()]);
        assert_eq!(retired_names(&store, &fb), retired_names(&store, &fa));
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    #[test]
    fn proj019_an_icon_is_an_emoji_a_built_in_icon_or_a_small_picture() {
        assert_eq!(clean_icon("  ").unwrap(), None, "empty resets");
        assert_eq!(clean_icon("emoji:\u{1F680}").unwrap().as_deref(), Some("emoji:\u{1F680}"));
        assert_eq!(clean_icon("emoji:\u{1F9D1}\u{200D}\u{1F4BB}").unwrap().as_deref(), Some("emoji:\u{1F9D1}\u{200D}\u{1F4BB}"), "a joined emoji is one emoji");
        let long = format!("emoji:{}", "\u{1F680}".repeat(9));
        for bad in ["emoji:", "emoji:rocket", "emoji:\u{e9}", "emoji:\u{1F680} \u{1F680}", long.as_str(), "rocket", "html:<b>", "icon:", "icon:Rock et", "icon:../x"] {
            assert!(clean_icon(bad).is_err(), "{bad}");
        }
        assert_eq!(clean_icon("icon:Rocket").unwrap().as_deref(), Some("icon:rocket"));
        assert_eq!(clean_icon("icon:no-such-icon-9").unwrap().as_deref(), Some("icon:no-such-icon-9"), "an unknown name is kept: the drawing side shows a folder");
        assert!(clean_icon("image:data:image/png;base64,iVBORw0KGgo=").unwrap().is_some());
        for bad in ["image:https://example.com/a.png", "image:data:text/html;base64,PGI+", "image:data:image/png;base64,", "image:data:image/png;base64,<script>", "image:data:image/bmp;base64,AAAA"] {
            assert!(clean_icon(bad).is_err(), "{bad}");
        }
        // The size limit is about the whole value, at its edge.
        let head = "image:data:image/png;base64,";
        let fits = format!("{head}{}", "A".repeat(ICON_IMAGE_MAX - head.len()));
        let over = format!("{fits}A");
        assert!(clean_icon(&fits).is_ok());
        assert!(clean_icon(&over).unwrap_err().contains("too large"));
    }

    #[test]
    fn proj019_a_chosen_icon_stays_after_a_restart_and_reset_brings_the_automatic_one_back() {
        let git = Git::detect().unwrap();
        let profile = temp("icon-profile");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("icon-repo");
        let project = add_project(&git, &store, &repo).unwrap();
        assert!(project_icons(&store).is_empty(), "no choice yet: the automatic icon");
        assert_eq!(set_icon(&store, &project.id, "icon:rocket").unwrap().as_deref(), Some("icon:rocket"));
        assert!(set_icon(&store, &project.id, "emoji:abc").is_err());
        assert!(set_icon(&store, "no-such", "icon:rocket").is_err());
        drop(store);
        let store = Store::open(&profile).unwrap();
        assert_eq!(project_icons(&store).get(&project.id).map(String::as_str), Some("icon:rocket"), "still there after a restart");
        // A damaged record, or an entry that no longer passes, gives the automatic icon.
        store.set(ICONS_KEY, "[1,2").unwrap();
        assert!(project_icons(&store).is_empty());
        store.set(ICONS_KEY, &format!("{{\"{}\": \"emoji:x\", \"keep\": \"icon:bug\"}}", project.id)).unwrap();
        assert_eq!(project_icons(&store).len(), 1);
        set_icon(&store, &project.id, "icon:rocket").unwrap();
        assert_eq!(set_icon(&store, &project.id, "").unwrap(), None);
        assert!(!project_icons(&store).contains_key(&project.id), "reset removes the choice");
        set_icon(&store, &project.id, "emoji:\u{1F680}").unwrap();
        forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
        assert!(!project_icons(&store).contains_key(&project.id), "a forgotten project's choice goes with it");
        drop(store);
        for d in [profile, repo] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix1_a_worktree_deleted_outside_kolux_retires_its_name_when_the_sweep_forgets_it() {
        let base = temp("fix1-gone");
        let repo = base.join("r");
        init_repo(&repo);
        let name = creature_name(&[], 3);
        let folder = base.join("ws").join(&name);
        git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", &name]);
        fs::remove_dir_all(&folder).unwrap();
        let store = Store::open(&base.join("db")).unwrap();
        let git = Git::detect().unwrap();
        let all = git.worktrees(&repo).unwrap();
        let forgot = forget_gone(&repo, &all, &[], |p| retire_workspace_names(&store, p).unwrap());
        assert_eq!(forgot.len(), 1, "{forgot:?}");
        let scope = name_key(&base.join("ws").to_string_lossy());
        assert_eq!(retired_names(&store, &scope), vec![name_form(&name)], "the name is retired in the folder it lived in");
        assert_ne!(pick_name(&store, &scope, vec![], 3), name, "and is not suggested again");
        // a worktree a session still uses (busy) is left alone: nothing is forgotten or retired
        let busy = base.join("ws").join("kept");
        git_in(&repo, &["worktree", "add", "-q", &busy.to_string_lossy(), "-b", "kept"]);
        fs::remove_dir_all(&busy).unwrap();
        let all = git.worktrees(&repo).unwrap();
        let forgot = forget_gone(&repo, &all, &[busy.to_string_lossy().into_owned()], |p| retire_workspace_names(&store, p).unwrap());
        assert!(forgot.is_empty());
        assert_eq!(retired_names(&store, &scope).len(), 1);
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn fix2_the_sweep_clears_the_same_record_as_a_removal_by_the_user() {
        let base = temp("fix2-sweep");
        let repo = base.join("r");
        init_repo(&repo);
        let git = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&base.join("db")).unwrap());
        let creature = creature_name(&[], 3);
        let (gone, kept) = (base.join("ws").join(&creature), base.join("ws").join("kept-one"));
        for f in [&gone, &kept] {
            let branch = f.file_name().unwrap().to_string_lossy().to_string();
            git_in(&repo, &["worktree", "add", "-q", &f.to_string_lossy(), "-b", &branch]);
        }
        let (gone_p, kept_p) = (gone.to_string_lossy().to_string(), kept.to_string_lossy().to_string());
        {
            let s = store.lock().unwrap();
            for p in [&gone_p, &kept_p] {
                set_name(&s, p, Some("typed name")).unwrap();
                set_parent(&s, p, Some("C:/ws/parent")).unwrap();
                save_workspace_note(&s, p, "handoff text").unwrap();
                set_origin(&s, p, Some(&serde_json::json!({"issue": 7}))).unwrap();
            }
        }
        fs::remove_dir_all(&gone).unwrap();
        let all = git.worktrees(&repo).unwrap();
        assert_eq!(sweep_gone(&store, &repo, &all, &[], None), vec![gone_p.clone()]);
        let s = store.lock().unwrap();
        // the swept workspace leaves no record, so a new one made at the same path starts clean
        assert!(!load_names(&s).contains_key(&name_key(&gone_p)), "typed name");
        let parents: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&s.get(PARENTS_KEY).unwrap().unwrap()).unwrap();
        assert!(!parents.contains_key(&name_key(&gone_p)) && parents.contains_key(&name_key(&kept_p)), "parent: {parents:?}");
        assert_eq!(workspace_note(&s, &gone_p).text, "", "note");
        assert!(!load_origins(&s).contains_key(&name_key(&gone_p)), "origin");
        // its suggested folder name is still retired in the folder it lived in
        let scope = name_key(&base.join("ws").to_string_lossy());
        assert_eq!(retired_names(&s, &scope), vec![name_form(&creature)]);
        // the one that is still there keeps everything
        assert!(load_names(&s).contains_key(&name_key(&kept_p)));
        assert_eq!(workspace_note(&s, &kept_p).text, "handoff text");
        assert!(load_origins(&s).contains_key(&name_key(&kept_p)));
        drop(s);
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    /// Every key a workspace record can live under, for one path, read back as text.
    fn record_of(store: &Store, path: &str) -> Vec<(String, Option<String>)> {
        let note = format!("{NOTE_PREFIX}{}", name_key(path));
        [NAMES_KEY, PARENTS_KEY, ORIGINS_KEY, RETIRED_KEY, LEGACY_KEY, note.as_str()]
            .iter()
            .map(|k| (k.to_string(), store.get(k).unwrap()))
            .collect()
    }

    fn full_record(store: &Store, path: &str) {
        set_name(store, path, Some("typed name")).unwrap();
        set_parent(store, path, Some("C:/ws/parent")).unwrap();
        save_workspace_note(store, path, "handoff text").unwrap();
        set_origin(store, path, Some(&serde_json::json!({"issue": 7}))).unwrap();
    }

    #[test]
    fn fix3_the_sweep_leaves_the_same_store_as_a_removal_by_the_user_on_a_twin_worktree() {
        let base = temp("fix3-twin");
        let repo = base.join("r");
        init_repo(&repo);
        let git = Git::detect().unwrap();
        let creature = creature_name(&[], 5);
        let folder = base.join("ws").join(&creature);
        git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", &creature]);
        let path = folder.to_string_lossy().to_string();
        // two stores hold the identical record for the same worktree; one is swept, one is removed by hand
        let swept = Mutex::new(Store::open(&base.join("db-swept")).unwrap());
        let removed = Store::open(&base.join("db-removed")).unwrap();
        full_record(&swept.lock().unwrap(), &path);
        full_record(&removed, &path);
        // (the note carries its save time, so the twins differ there until the record is cleared)
        let start = record_of(&swept.lock().unwrap(), &path);
        assert_eq!(start[..3], record_of(&removed, &path)[..3], "names, parents and origins start equal");
        assert!(start.iter().filter(|(k, _)| k != RETIRED_KEY && k != LEGACY_KEY).all(|(_, v)| v.is_some()), "{start:?}");
        fs::remove_dir_all(&folder).unwrap();
        let all = git.worktrees(&repo).unwrap();
        assert_eq!(sweep_gone(&swept, &repo, &all, &[], None), vec![path.clone()]);
        forget_workspace(&removed, &path).unwrap();
        let (a, b) = (record_of(&swept.lock().unwrap(), &path), record_of(&removed, &path));
        assert_eq!(a, b, "the sweep and a removal leave the same keys behind");
        assert!(a.iter().any(|(k, v)| k == RETIRED_KEY && v.is_some()), "and the comparison saw a retired name: {a:?}");
        drop(swept);
        drop(removed);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn fix3_a_busy_worktree_with_a_full_record_survives_the_sweep_though_its_folder_is_gone() {
        let base = temp("fix3-busy");
        let repo = base.join("r");
        init_repo(&repo);
        let git = Git::detect().unwrap();
        let folder = base.join("ws").join("in-use");
        git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", "in-use"]);
        let path = folder.to_string_lossy().to_string();
        let store = Mutex::new(Store::open(&base.join("db")).unwrap());
        full_record(&store.lock().unwrap(), &path);
        let before = record_of(&store.lock().unwrap(), &path);
        fs::remove_dir_all(&folder).unwrap();
        let all = git.worktrees(&repo).unwrap();
        // a session still runs in a folder inside it, so the sweep must leave Git's record and ours alone
        let busy = [folder.join("src").to_string_lossy().to_string()];
        assert!(sweep_gone(&store, &repo, &all, &busy, None).is_empty());
        assert_eq!(record_of(&store.lock().unwrap(), &path), before, "typed name, parent, note, origin and retired names untouched");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn fix3_a_record_that_cannot_be_cleared_is_written_to_the_diag_file() {
        let base = temp("fix3-diag");
        let repo = base.join("r");
        init_repo(&repo);
        let git = Git::detect().unwrap();
        let folder = base.join("ws").join("gone-one");
        git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", "gone-one"]);
        let path = folder.to_string_lossy().to_string();
        let profile = base.join("profile");
        let store = std::sync::Arc::new(Mutex::new(Store::open(&base.join("db")).unwrap()));
        full_record(&store.lock().unwrap(), &path);
        // a task that panicked holding the store leaves it poisoned: the record cannot be cleared
        let held = store.clone();
        let _ = std::thread::spawn(move || {
            let _guard = held.lock().unwrap();
            panic!("a task that died holding the store");
        })
        .join();
        assert!(store.lock().is_err(), "the store is poisoned");
        fs::remove_dir_all(&folder).unwrap();
        let all = git.worktrees(&repo).unwrap();
        // Git's record still goes; the failure is not dropped
        assert_eq!(sweep_gone(&store, &repo, &all, &[], Some(&profile)), vec![path.clone()]);
        let log = fs::read_to_string(profile.join("logs").join("kolux.log")).unwrap();
        assert!(log.contains("could not clear what Kolux remembers") && log.contains("gone-one"), "{log}");
        // and a sweep with nothing wrong writes nothing of the kind
        let fine = Mutex::new(Store::open(&base.join("db2")).unwrap());
        let folder2 = base.join("ws").join("gone-two");
        git_in(&repo, &["worktree", "add", "-q", &folder2.to_string_lossy(), "-b", "gone-two"]);
        fs::remove_dir_all(&folder2).unwrap();
        let all = git.worktrees(&repo).unwrap();
        let profile2 = base.join("profile2");
        assert_eq!(sweep_gone(&fine, &repo, &all, &[], Some(&profile2)).len(), 1);
        assert!(!profile2.join("logs").join("kolux.log").exists());
        drop(fine);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn fix1_names_the_old_list_held_stay_retired_without_a_migration_step() {
        let profile = temp("fix1-legacy");
        let store = Store::open(&profile).unwrap();
        let (old_a, old_b) = (creature_name(&[], 1), creature_name(&[], 2));
        store.set("creatureNamesUsed", &serde_json::to_string(&[old_a.to_uppercase(), old_b.clone(), old_a.clone()]).unwrap()).unwrap();
        assert!(store.get(RETIRED_KEY).unwrap().is_none());
        for scope in ["any-scope", "another"] {
            let got = retired_names(&store, scope);
            assert!(got.contains(&name_form(&old_a)) && got.contains(&name_form(&old_b)), "{scope}: {got:?}");
            assert_eq!(got.len(), 2, "the same name once: {got:?}");
            assert_ne!(pick_name(&store, scope, vec![], 1), old_a, "{scope}: not suggested again");
        }
        // the first new retirement writes the record; the old names go with it into the new key
        let fresh = creature_name(&[old_a.clone(), old_b.clone()], 9);
        retire_name(&store, "any-scope", &fresh).unwrap();
        assert!(store.get(RETIRED_KEY).unwrap().is_some());
        let got = retired_names(&store, "any-scope");
        assert_eq!(got.len(), 3, "{got:?}");
        assert!(retired_names(&store, "another").contains(&name_form(&old_a)), "old names count in every scope");
        assert!(!retired_names(&store, "another").contains(&name_form(&fresh)), "a new one only in its own");
        // once the new key exists the old list is not read again
        store.set("creatureNamesUsed", "[\"zebra-moth\"]").unwrap();
        assert!(!retired_names(&store, "another").contains(&"zebra-moth".to_string()));
        // a damaged old list is no list
        let profile2 = temp("fix1-legacy2");
        let store2 = Store::open(&profile2).unwrap();
        store2.set("creatureNamesUsed", "{oops").unwrap();
        assert!(retired_names(&store2, "x").is_empty());
        // the scope cap never drops the old names
        for i in 0..(RETIRED_SCOPES + 5) {
            retire_name(&store, &format!("s{i}"), &creature_name(&[], 1)).unwrap();
        }
        assert!(retired_names(&store, "another").contains(&name_form(&old_a)), "the oldest scope goes, not the old names");
        drop((store, store2));
        for d in [profile, profile2] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn fix1_forgetting_a_project_also_forgets_its_setup_card_state() {
        let git = Git::detect().unwrap();
        let profile = temp("fix1-forget");
        let store = Store::open(&profile).unwrap();
        let (a, b) = (temp_repo("fix1-forget-a"), temp_repo("fix1-forget-b"));
        for r in [&a, &b] {
            fs::write(r.join("package.json"), r#"{"packageManager":"pnpm@9"}"#).unwrap();
        }
        let (pa, pb) = (add_project(&git, &store, &a).unwrap(), add_project(&git, &store, &b).unwrap());
        for p in [&pa, &pb] {
            crate::setup::dismiss_card(&store, &p.id).unwrap();
            crate::setup::save_suggestion(&store, Path::new(&p.path), "install", "pnpm install", None).unwrap();
        }
        forget_projects(&store, std::slice::from_ref(&pa.id)).unwrap();
        assert!(!crate::setup::card_dismissed(&store, &pa.id) && crate::setup::card_dismissed(&store, &pb.id));
        assert_eq!(crate::setup::local_setup(&store, Path::new(&pa.path)), None, "the forgotten project's saved setup goes");
        assert_eq!(crate::setup::local_setup(&store, Path::new(&pb.path)).as_deref(), Some("pnpm install"), "the other stays");
        drop(store);
        for d in [profile, a, b] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj024_the_record_is_bounded_and_a_damaged_one_retires_nothing() {
        let profile = temp("retire-bound");
        let store = Store::open(&profile).unwrap();
        // More numbered rounds than the record holds: it stops growing at its limit, newest kept.
        let mut used: Vec<String> = Vec::new();
        for _ in 0..(RETIRED_PER_SCOPE + 300) {
            let n = creature_name(&used, 0);
            retire_name(&store, "scope", &n).unwrap();
            used.push(n);
        }
        let kept = retired_names(&store, "scope");
        assert_eq!(kept.len(), RETIRED_PER_SCOPE);
        assert_eq!(kept.last(), used.last());
        // Many-scopes: the oldest go.
        for i in 0..(RETIRED_SCOPES + 20) {
            retire_name(&store, &format!("s{i}"), &creature_name(&[], 1)).unwrap();
        }
        assert!(retired_names(&store, "s0").is_empty() && !retired_names(&store, &format!("s{}", RETIRED_SCOPES + 19)).is_empty());
        assert!(retired_all(&store).len() <= RETIRED_SCOPES);

        // A damaged record: nothing counts as retired and suggestions carry on; the next retire repairs it.
        store.set(RETIRED_KEY, "{not json").unwrap();
        assert!(retired_names(&store, "scope").is_empty());
        let pick = pick_name(&store, "scope", vec![], 5);
        assert_eq!(pick, creature_name(&[], 5));
        store.set(RETIRED_KEY, "[{\"scope\": 4}]").unwrap();
        assert!(retired_names(&store, "scope").is_empty());
        retire_name(&store, "scope", &pick).unwrap();
        assert_eq!(retired_names(&store, "scope"), vec![pick]);
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    #[test]
    fn a_fresh_workspace_gets_a_creature_name_that_is_not_in_use() {
        let git = Git::detect().unwrap();
        let profile = temp("profile4");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo4");
        let root = temp("root4");
        let project = add_project(&git, &store, &repo).unwrap();
        let projects = load_projects(&store);

        let first = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &projects, &project, None).unwrap();
        let second = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &projects, &project, None).unwrap();
        let name_of = |w: &Worktree| Path::new(&w.path).file_name().unwrap().to_string_lossy().to_string();
        assert_ne!(name_of(&first), name_of(&second), "two launches never share a name");
        for w in [&first, &second] {
            let name = name_of(w);
            assert!(name.split('-').count() == 2, "adjective-creature: {name}");
            assert_eq!(w.branch.as_deref(), Some(name.as_str()), "the branch carries the same name");
            assert!(Path::new(&w.path).join("a.txt").is_file(), "a real checkout");
        }
        let in_use = names_in_use(&git, &projects);
        assert!(in_use.contains(&name_of(&first)) && in_use.contains(&name_of(&second)));
        // SESS-023 / PROJ-024: a deleted workspace's name never comes back, even from the same seed.
        let scope = retired_scope(&nested(&root), &project);
        remove_workspace(&git, &project, &first.path, false).unwrap();
        forget_workspace(&store, &first.path).unwrap();
        assert!(!names_in_use(&git, &projects).contains(&name_of(&first)));
        for seed in [0u64, 7, 4242] {
            assert_ne!(fresh_name(&git, &store, &projects, &scope, seed), name_of(&first), "seed {seed}");
        }
        let x = fresh_name(&git, &store, &projects, &scope, 0);
        retire_name(&store, &scope, &x).unwrap();
        assert_ne!(fresh_name(&git, &store, &projects, &scope, 0), x);

        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn new_workspaces_bring_listed_files_along_and_removal_refuses_dirty_work_unless_forced() {
        let git = Git::detect().unwrap();
        let profile = temp("profile8");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo8");
        fs::write(repo.join(".gitignore"), ".env\nnode_modules/\n").unwrap();
        fs::write(repo.join("tracked.txt"), "committed\n").unwrap();
        fs::write(repo.join(".worktreeinclude"), "# bring these\n.env\n*.log\nmissing.txt\ntracked.txt\n").unwrap();
        fs::write(repo.join("kolux.yaml"), "worktree:\n  sharedDirectories:\n    - node_modules/\n    - src\n    - ../out\n").unwrap();
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src").join("a.txt"), "a").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "setup"]);
        fs::write(repo.join(".env"), "SECRET=1\n").unwrap();
        fs::write(repo.join("tracked.txt"), "edited in main\n").unwrap();
        let project = add_project(&git, &store, &repo).unwrap();
        let place = Place { root: temp("ws8"), flat: true, prefix: String::new(), prefix_warning: None, refresh: false };

        let made = create_workspace(&git, &place, &project, "feat", None).unwrap();
        let dest = PathBuf::from(&made.worktree.path);
        assert_eq!(fs::read_to_string(dest.join(".env")).unwrap(), "SECRET=1\n", "the ignored file came along");
        assert_eq!(fs::read_to_string(dest.join("tracked.txt")).unwrap().trim_end(), "committed", "a tracked file is never copied over (the checkout may add CR)");
        assert_eq!(made.warnings.len(), 3, "{:?}", made.warnings);
        assert!(made.warnings[0].contains("`*.log`") && made.warnings[1].contains("`missing.txt`") && made.warnings[2].contains("`src` is not git-ignored"), "{:?}", made.warnings);
        // the shared folder is one folder seen from both places
        fs::write(repo.join("node_modules").join("dep.js"), "1").unwrap();
        assert_eq!(fs::read_to_string(dest.join("node_modules").join("dep.js")).unwrap(), "1");
        assert!(!dest.join("out").exists());
        let status = Command::new("git").args(["status", "--porcelain"]).current_dir(&dest).output().unwrap().stdout;
        assert!(!git.dirty(&dest).unwrap(), "linked and copied files are ignored, so the worktree starts clean: {}", String::from_utf8_lossy(&status));

        fs::write(dest.join("work.txt"), "unsaved").unwrap();
        let err = remove_workspace(&git, &project, &made.worktree.path, false).unwrap_err();
        assert!(err.contains("feat has uncommitted changes"), "{err}");
        assert!(dest.join("work.txt").is_file(), "nothing was lost");
        remove_workspace(&git, &project, &made.worktree.path, true).unwrap();
        assert!(!dest.exists() && !git.branch_taken(&repo, "feat"));
        assert!(repo.join("node_modules").join("dep.js").is_file(), "removing the link left the shared folder alone");

        drop(store);
        for d in [profile, repo, place.root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_picked_worktree_is_added_itself_and_scratch_worktrees_stay_hidden() {
        let git = Git::detect().unwrap();
        let profile = temp("profile5");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo5");
        let side = temp("side5");
        let zeta = side.join("zeta");
        git.worktree_add(&repo, &zeta, "zeta", "HEAD").unwrap();
        let scratch = repo.join(".claude").join("worktrees").join("scratch");
        git.worktree_add(&repo, &scratch, "scratch", "HEAD").unwrap();

        let project = add_project(&git, &store, &zeta).unwrap();
        assert!(same_folder(Path::new(&project.path), &zeta), "PROJ-006: A not added, so the picked worktree folder itself is the project: {}", project.path);
        crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
        let names: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().filter(|w| !w.hidden).map(|w| (w.branch.unwrap_or_default(), w.is_main)).collect();
        assert_eq!(names, vec![("main".to_string(), true), ("zeta".to_string(), false)], "Claude Code's scratch worktree stays hidden");

        drop(store);
        git.worktree_remove(&repo, &scratch, Some("scratch")).unwrap();
        git.worktree_remove(&repo, &zeta, Some("zeta")).unwrap();
        for d in [profile, repo, side] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn workspaces_live_where_the_project_or_the_layout_says() {
        let git = Git::detect().unwrap();
        let profile = temp("profile6");
        let store = Store::open(&profile).unwrap();
        let outer = temp("repo6");
        let repo = outer.join("app.git");
        init_repo(&repo);
        let mut project = add_project(&git, &store, &repo).unwrap();
        // the default: the global folder, nested under the project's name without its .git ending
        let place = place_for(&store, &project);
        assert!(!place.flat);
        assert_eq!(workspace_path(&place, &project, "x"), workspaces_dir(&store).join("app").join("x"));
        // a folder set for one project wins, a relative one resolved from the project root
        project.workspaces_dir = Some("ws".into());
        let place = place_for(&store, &project);
        assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("app").join("x"));
        // the flat layout puts every workspace side by side
        let mut settings = store.settings();
        settings[LAYOUT_SETTING] = "flat".into();
        store.save_settings(&settings).unwrap();
        let place = place_for(&store, &project);
        assert!(place.flat);
        assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("x"));
        let made = create_workspace(&git, &place, &project, "x", None).unwrap();
        assert!(same_folder(Path::new(&made.worktree.path), &repo.join("ws").join("x")), "{}", made.worktree.path);
        remove_workspace(&git, &project, &made.worktree.path, false).unwrap();
        // folders used before are remembered, newest first, once each
        remember_dir(&store, "D:\\one").unwrap();
        remember_dir(&store, "D:\\two").unwrap();
        remember_dir(&store, "D:\\one").unwrap();
        assert_eq!(used_dirs(&store), vec!["D:\\one".to_string(), "D:\\two".to_string()]);
        drop(store);
        for d in [profile, outer] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_workspace_starts_from_the_chosen_ref_then_the_saved_base_then_the_default() {
        let git = Git::detect().unwrap();
        let profile = temp("profile7");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo7");
        let root = temp("root7");
        let mut project = add_project(&git, &store, &repo).unwrap();
        let first = rev(&repo, "HEAD");
        git_in(&repo, &["checkout", "-q", "-b", "dev"]);
        fs::write(repo.join("b.txt"), "b").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "second"]);
        let second = rev(&repo, "HEAD");
        git_in(&repo, &["checkout", "-q", "main"]);
        let place = nested(&root);

        // nothing chosen, nothing saved: the default branch
        assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("main".to_string(), None));
        // chosen for this one workspace: a branch, or a full commit id used as is
        assert_eq!(resolve_base(&git, &repo, &project, Some("dev")).unwrap().0, "dev");
        assert_eq!(resolve_base(&git, &repo, &project, Some(&second)).unwrap().0, second);
        assert!(resolve_base(&git, &repo, &project, Some("nope")).unwrap_err().contains("not a branch, tag or commit"));
        // the project's saved base, then the fallback with a note once it is gone
        project.base = Some("dev".into());
        assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("dev".to_string(), None));
        project.base = Some("gone".into());
        let (base, note) = resolve_base(&git, &repo, &project, None).unwrap();
        assert_eq!(base, "main");
        assert!(note.as_deref().is_some_and(|n| n.contains("gone") && n.contains("main")), "{note:?}");
        // and the checkout really begins there
        let made = create_workspace(&git, &place, &project, "from dev", Some("dev")).unwrap();
        assert_eq!((made.base.as_str(), made.note.as_deref()), ("dev", None));
        assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), second);
        let fallen = create_workspace(&git, &place, &project, "from saved", None).unwrap();
        assert_eq!(rev(Path::new(&fallen.worktree.path), "HEAD"), first);
        assert!(fallen.note.is_some());
        for m in [&made, &fallen] {
            remove_workspace(&git, &project, &m.worktree.path, false).unwrap();
        }
        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn workspaces_dir_setting_falls_back_to_default() {
        let profile = temp("profile3");
        let store = Store::open(&profile).unwrap();
        assert_eq!(workspaces_dir(&store), default_workspaces_dir());
        store.save_settings(&serde_json::json!({ "workspacesDir": "D:\\ws" })).unwrap();
        assert_eq!(workspaces_dir(&store), PathBuf::from("D:\\ws"));
        store.save_settings(&serde_json::json!({ "workspacesDir": "  " })).unwrap();
        assert_eq!(workspaces_dir(&store), default_workspaces_dir());
        drop(store);
        fs::remove_dir_all(profile).unwrap();
    }

    #[test]
    fn env_var_moves_the_default_but_a_setting_still_wins() {
        // PROJ-026 / SET-032: KOLUX_WORKSPACES_DIR is trimmed, ignored when blank, and only
        // replaces the default, never a folder the user saved.
        assert_eq!(resolve_workspaces_dir(Some("  D:\\wt  "), None), PathBuf::from("D:\\wt"));
        assert_eq!(resolve_workspaces_dir(Some("   "), None), default_workspaces_dir());
        assert_eq!(resolve_workspaces_dir(None, None), default_workspaces_dir());
        assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some("E:\\mine")), PathBuf::from("E:\\mine"));
        assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some(" ")), PathBuf::from("D:\\wt"));
    }

    #[test]
    fn saving_a_folder_that_cannot_be_made_fails_and_keeps_the_old_one() {
        let profile = temp("profile-place");
        let store = Store::open(&profile).unwrap();
        let bad = profile.join("file-not-folder");
        fs::write(&bad, "x").unwrap();
        let err = set_place(&store, &bad.join("ws").display().to_string(), false).unwrap_err();
        assert!(err.contains("cannot be made"), "{err}");
        assert_eq!(store.settings()[WORKSPACES_DIR_SETTING], serde_json::Value::Null, "the failed folder is not saved");
        assert!(used_dirs(&store).is_empty(), "nor remembered");
        let good = profile.join("ws").join("deep");
        let info = set_place(&store, &good.display().to_string(), true).unwrap();
        assert!(good.is_dir() && info.flat && info.dir == good.display().to_string() && info.used == vec![good.display().to_string()]);
        drop(store);
        let _ = fs::remove_dir_all(profile); // Windows may still hold the store file for a moment; the folder is throwaway
    }

    #[test]
    fn proj068_records_follow_a_workspace_moved_outside_kolux_and_a_quiet_refresh_keeps_the_order() {
        let git = Git::detect().unwrap();
        let profile = temp("profile068");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo068");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&temp("ws068"));
        let a = create_workspace(&git, &place, &project, "alpha", None).unwrap().worktree.path;
        let b = create_workspace(&git, &place, &project, "beta", None).unwrap().worktree.path;
        let c = create_workspace(&git, &place, &project, "gamma", None).unwrap().worktree.path;
        set_name(&store, &b, Some("Beta work")).unwrap();
        reparent(&git, &store, &project, &b, Some(&a)).unwrap();
        reparent(&git, &store, &project, &c, Some(&b)).unwrap();
        save_workspace_note(&store, &b, "half done").unwrap();
        note_seen(&store, &project, &b).unwrap(); // what the create commands record: made by Kolux
        assert!(unseen(&git, &store, &project).unwrap().is_empty());
        let key = |p: &Path| name_key(&p.to_string_lossy());
        let paths = |l: &[Worktree]| l.iter().map(|w| name_key(&w.path)).collect::<Vec<_>>();
        let find = |l: &[Worktree], p: &Path| l.iter().find(|w| name_key(&w.path) == key(p)).cloned();
        let parent_of = |l: &[Worktree], p: &Path| find(l, p).and_then(|w| w.parent).map(|x| name_key(&x));
        // refresh twice with nothing changed: the same rows in the same order
        let first = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(paths(&first), paths(&list_workspaces(&git, &store, &project).unwrap()));
        // moved from a terminal with git worktree move: name, parent, note, origin and children follow
        let moved = Path::new(&b).with_file_name("beta-moved");
        git.worktree_move(&repo, Path::new(&b), &moved).unwrap();
        let after = list_workspaces(&git, &store, &project).unwrap();
        let m = find(&after, &moved).expect("the moved workspace is listed");
        assert_eq!(m.name.as_deref(), Some("Beta work"));
        assert_eq!(m.kind, "managed");
        assert_eq!(parent_of(&after, &moved), Some(name_key(&a)));
        assert_eq!(parent_of(&after, Path::new(&c)), Some(key(&moved)));
        assert_eq!(workspace_note(&store, &m.path).text, "half done");
        assert!(unseen(&git, &store, &project).unwrap().is_empty(), "a moved workspace is not offered as new");
        // renamed by hand (Explorer, mv): Git is told where it went and the records follow again
        let by_hand = Path::new(&b).with_file_name("beta-by-hand");
        fs::rename(&moved, &by_hand).unwrap();
        let after = list_workspaces(&git, &store, &project).unwrap();
        assert!(find(&after, &moved).is_none());
        let h = find(&after, &by_hand).expect("the renamed workspace is listed");
        assert_eq!(h.name.as_deref(), Some("Beta work"));
        assert_eq!(parent_of(&after, &by_hand), Some(name_key(&a)));
        assert_eq!(parent_of(&after, Path::new(&c)), Some(key(&by_hand)));
        assert_eq!(workspace_note(&store, &h.path).text, "half done");
        // adding the project again hands back the same one, records intact
        assert_eq!(add_project(&git, &store, &repo).unwrap().id, project.id);
        assert_eq!(find(&list_workspaces(&git, &store, &project).unwrap(), &by_hand).unwrap().name.as_deref(), Some("Beta work"));
        // a removed workspace's Git folder is forgotten, so a later worktree reusing its id inherits nothing
        remove_workspace(&git, &project, &h.path, true).unwrap();
        forget_workspace(&store, &h.path).unwrap();
        assert!(!load_map(&store, ADMIN_KEY).values().any(|v| v.as_str() == Some(key(&by_hand).as_str())));
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn a_delete_is_refused_for_changes_a_lock_a_nested_workspace_or_a_changed_stamp() {
        let git = Git::detect().unwrap();
        let profile = temp("profile055");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo055");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&temp("ws055"));
        let ws = create_workspace(&git, &place, &project, "dirty", None).unwrap().worktree.path;
        // clean: nothing refuses it
        let clean = remove_check(&git, &project, &ws).unwrap();
        assert!(clean.changes.is_empty() && clean.locked.is_none() && clean.nested.is_empty());
        assert_eq!(removal_refused(&clean, false, &clean.stamp), None);
        // an untracked file: warned, refused without force, allowed with it
        fs::write(Path::new(&ws).join("new.txt"), "n").unwrap();
        fs::write(Path::new(&ws).join("a.txt"), "changed").unwrap();
        let dirty = remove_check(&git, &project, &ws).unwrap();
        assert_eq!(dirty.changes, vec![" M a.txt".to_string(), "?? new.txt".to_string()]);
        assert!(removal_refused(&dirty, false, &dirty.stamp).unwrap().contains("2 uncommitted"));
        assert_eq!(removal_refused(&dirty, true, &dirty.stamp), None);
        // the question showed the clean state: the stamp no longer matches
        assert!(removal_refused(&dirty, true, &clean.stamp).unwrap().contains("changed after"));
        // locked: refused even when forced
        git_in(&repo, &["worktree", "lock", "--reason", "on a stick", &ws]);
        let locked = remove_check(&git, &project, &ws).unwrap();
        assert_eq!(locked.locked.as_deref(), Some("on a stick"));
        assert!(removal_refused(&locked, true, &locked.stamp).unwrap().contains("locked (on a stick)"));
        git_in(&repo, &["worktree", "unlock", &ws]);
        // a workspace folder inside this one: refused
        let inner = Path::new(&ws).join("inner");
        git_in(&repo, &["worktree", "add", "-q", "-b", "inner", &inner.to_string_lossy()]);
        let outer = remove_check(&git, &project, &ws).unwrap();
        assert_eq!(outer.nested.len(), 1);
        assert!(removal_refused(&outer, true, &outer.stamp).unwrap().contains("holds another workspace"));
        // the main checkout is never offered
        assert!(remove_check(&git, &project, &repo.to_string_lossy()).is_err());
        remove_workspace(&git, &project, &inner.to_string_lossy(), true).unwrap();
        remove_workspace(&git, &project, &ws, true).unwrap();
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t715_removing_a_workspace_runs_its_trusted_archive_script_first() {
        let git = Git::detect().unwrap();
        let profile = temp("profile715");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let repo = temp_repo("repo715");
        let ok = "cd .. && echo done>archived.txt";
        fs::write(repo.join("kolux.yaml"), format!("scripts:\n  archive: {ok}\n")).unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "archive script"]);
        let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
        let place = nested(&temp("ws715"));
        let terminals = crate::terminal::Terminals::default();
        let remove = |ws: &str, force: bool| {
            let check = remove_check(&git, &project, ws).unwrap();
            remove_one(&git, &store, &terminals, &project, ws, force, &check.stamp, Some(false))
        };
        // SAFE-025: not trusted (Don't run, or nobody asked): the delete goes on and the script does not run
        let first = create_workspace(&git, &place, &project, "untrusted", None).unwrap().worktree;
        let done = Path::new(&first.path).parent().unwrap().join("archived.txt");
        remove(&first.path, false).unwrap();
        assert!(!Path::new(&first.path).exists() && !done.exists(), "an untrusted archive script never runs");
        // trusted: it runs inside the workspace before the folder goes
        crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", ok, false).unwrap();
        let second = create_workspace(&git, &place, &project, "trusted", None).unwrap().worktree;
        let done = Path::new(&second.path).parent().unwrap().join("archived.txt");
        remove(&second.path, false).unwrap();
        assert_eq!(fs::read_to_string(&done).unwrap().trim(), "done", "the archive script ran");
        assert!(!Path::new(&second.path).exists(), "and the folder went");
        // a trusted script that fails stops the delete and says why; the force box deletes it anyway
        let third = create_workspace(&git, &place, &project, "failing", None).unwrap().worktree;
        let bad = "echo boom 1>&2 && exit 3";
        fs::write(Path::new(&third.path).join("kolux.yaml"), format!("scripts:\n  archive: {bad}\n")).unwrap();
        git_in(Path::new(&third.path), &["commit", "-q", "-am", "failing archive"]);
        crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", bad, false).unwrap();
        let err = remove(&third.path, false).unwrap_err();
        assert!(err.starts_with("The archive script failed with exit code 3: boom") && err.contains("It was not deleted"), "{err}");
        assert!(Path::new(&third.path).exists(), "the folder stays");
        remove(&third.path, true).unwrap();
        assert!(!Path::new(&third.path).exists(), "forced, it goes");
        // a trusted script that leaves a file in the workspace (a log) does not make it "dirty"
        let fourth = create_workspace(&git, &place, &project, "writer", None).unwrap().worktree;
        let writes = "echo log>left.txt && cd .. && echo in>wrote.txt";
        fs::write(Path::new(&fourth.path).join("kolux.yaml"), format!("scripts:\n  archive: {writes}\n")).unwrap();
        git_in(Path::new(&fourth.path), &["commit", "-q", "-am", "writing archive"]);
        crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", writes, false).unwrap();
        remove(&fourth.path, false).unwrap();
        assert!(Path::new(&fourth.path).parent().unwrap().join("wrote.txt").exists(), "it ran");
        assert!(!Path::new(&fourth.path).exists(), "and the folder went without the force box");
        // the CLI's rm (remove_with, archive false) never runs it, trusted or not (CLI-020)
        fs::remove_file(&done).unwrap();
        crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", ok, false).unwrap();
        let fifth = create_workspace(&git, &place, &project, "cli", None).unwrap().worktree;
        let check = remove_check(&git, &project, &fifth.path).unwrap();
        remove_with(&git, &store, &terminals, &project, &fifth.path, false, &check.stamp, Some(false), false).unwrap();
        assert!(!Path::new(&fifth.path).exists() && !done.exists(), "the CLI's rm removes without the archive script");
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t613_commits_found_nowhere_else_are_named_and_keep_the_branch_unless_the_form_says_delete_it() {
        let git = Git::detect().unwrap();
        let profile = temp("profile613");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let repo = temp_repo("repo613");
        let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
        let place = nested(&temp("ws613"));
        let terminals = crate::terminal::Terminals::default();
        let made = |name: &str| create_workspace(&git, &place, &project, name, None).unwrap().worktree;
        let commit = |ws: &str, file: &str| {
            fs::write(Path::new(ws).join(file), file).unwrap();
            git_in(Path::new(ws), &["add", "."]);
            git_in(Path::new(ws), &["commit", "-q", "-m", file]);
        };
        let exists = |b: &str| crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")], Some(&repo)).is_ok();
        // nothing committed: nothing to lose, so the branch goes with the folder as before
        let fresh = made("fresh");
        let check = remove_check(&git, &project, &fresh.path).unwrap();
        assert!(check.commits.is_empty(), "{check:?}");
        assert_eq!(remove_one(&git, &store, &terminals, &project, &fresh.path, false, &check.stamp, None).unwrap(), None);
        assert!(!exists(fresh.branch.as_deref().unwrap()));
        // two commits on no other branch and never pushed: the check names them, newest first
        let work = made("fix-login");
        let branch = work.branch.clone().unwrap();
        commit(&work.path, "one.txt");
        commit(&work.path, "two.txt");
        let check = remove_check(&git, &project, &work.path).unwrap();
        assert_eq!(check.commits.len(), 2, "{check:?}");
        assert!(check.commits[0].ends_with(" two.txt") && check.commits[1].ends_with(" one.txt"), "{check:?}");
        // a commit another branch holds, or one already on a remote, is not lost
        git_in(&repo, &["branch", "copy-of-one", &format!("{branch}~1")]);
        assert_eq!(remove_check(&git, &project, &work.path).unwrap().commits.len(), 1);
        git_in(&repo, &["update-ref", &format!("refs/remotes/origin/{branch}"), &format!("refs/heads/{branch}")]);
        assert!(remove_check(&git, &project, &work.path).unwrap().commits.is_empty());
        git_in(&repo, &["update-ref", "-d", &format!("refs/remotes/origin/{branch}")]);
        git_in(&repo, &["branch", "-D", "copy-of-one"]);
        // no choice made (the record's default, as the batch and the multi-select send): the folder
        // goes, the branch stays with its commits and comes back for the kept-branch list
        let check = remove_check(&git, &project, &work.path).unwrap();
        let tip = crate::git::run(&["rev-parse", &format!("refs/heads/{branch}")], Some(&repo)).unwrap();
        let kept = remove_one(&git, &store, &terminals, &project, &work.path, false, &check.stamp, None).unwrap();
        assert_eq!(kept, Some(Kept { branch: branch.clone(), commit: tip }));
        assert!(!Path::new(&work.path).exists() && exists(&branch), "the folder went, the branch stayed");
        // the form's own choice to delete the branch still deletes it, commits and all
        let other = made("throwaway");
        commit(&other.path, "three.txt");
        let check = remove_check(&git, &project, &other.path).unwrap();
        assert_eq!(check.commits.len(), 1, "{check:?}");
        assert_eq!(remove_one(&git, &store, &terminals, &project, &other.path, false, &check.stamp, Some(false)).unwrap(), None);
        assert!(!exists(other.branch.as_deref().unwrap()));
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t613_a_parent_and_a_child_at_its_tip_deleted_side_by_side_keep_their_unpushed_commits() {
        let git = Git::detect().unwrap();
        let profile = temp("profile613b");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let repo = temp_repo("repo613b");
        let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
        let place = nested(&temp("ws613b"));
        let terminals = crate::terminal::Terminals::default();
        // the parent has three commits on no remote; the child starts at its tip with none of its own
        let parent = create_workspace(&git, &place, &project, "fix", None).unwrap().worktree;
        let parent_branch = parent.branch.clone().unwrap();
        for f in ["one.txt", "two.txt", "three.txt"] {
            fs::write(Path::new(&parent.path).join(f), f).unwrap();
            git_in(Path::new(&parent.path), &["add", "."]);
            git_in(Path::new(&parent.path), &["commit", "-q", "-m", f]);
        }
        let tip = crate::git::run(&["rev-parse", &format!("refs/heads/{parent_branch}")], Some(&repo)).unwrap();
        let child = create_workspace(&git, &place, &project, "fix-tests", Some(&parent_branch)).unwrap().worktree;
        // each sees the other's branch holding the commits
        let checks: Vec<RemoveCheck> = [&parent, &child].iter().map(|w| remove_check(&git, &project, &w.path).unwrap()).collect();
        assert!(checks.iter().all(|c| c.commits.is_empty()), "{checks:?}");
        // no branch choice, side by side, as the Space batch (workspace_remove_many) runs them
        let start = std::sync::Barrier::new(2);
        let kept: Vec<Option<Kept>> = std::thread::scope(|s| {
            let runs: Vec<_> = [(&parent, &checks[0]), (&child, &checks[1])]
                .into_iter()
                .map(|(w, c)| {
                    let (git, store, terminals, project, start) = (&git, &store, &terminals, &project, &start);
                    s.spawn(move || {
                        start.wait();
                        remove_one(git, store, terminals, project, &w.path, false, &c.stamp, None).unwrap()
                    })
                })
                .collect();
            runs.into_iter().map(|r| r.join().unwrap()).collect()
        });
        assert!(!Path::new(&parent.path).exists() && !Path::new(&child.path).exists(), "both folders went");
        let holding = crate::git::run(&["for-each-ref", "--format=%(refname:short)", "--contains", &tip, "refs/heads"], Some(&repo)).unwrap();
        let holders: Vec<&str> = holding.lines().filter(|b| *b == parent_branch || Some(*b) == child.branch.as_deref()).collect();
        assert_eq!(holders.len(), 1, "exactly one of the two branches stays, holding the commits: {holding:?}");
        let kept: Vec<Kept> = kept.into_iter().flatten().collect();
        assert_eq!(kept, vec![Kept { branch: holders[0].to_string(), commit: tip }], "and it comes back as kept");
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// T-613b (review of PR #10): a detached-HEAD workspace whose commits no branch and no remote
    /// holds gets a keep-branch at its HEAD (`kolux/kept-<short id>`) before its folder goes, with no
    /// choice made (the batch, the CLI) and with Keep the branch ticked; it comes back as kept. With
    /// nothing of its own, or with Keep the branch unticked, no branch is made.
    #[test]
    fn t613b_a_detached_workspace_with_commits_found_nowhere_else_keeps_them_on_a_new_branch() {
        let git = Git::detect().unwrap();
        let profile = temp("profile613d");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let repo = temp_repo("repo613d");
        let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
        let terminals = crate::terminal::Terminals::default();
        let ws_root = temp("ws613d");
        let detached = |name: &str, commit: bool| -> (String, String) {
            let path = ws_root.join(name);
            git_in(&repo, &["worktree", "add", "-q", "--detach", &path.to_string_lossy()]);
            if commit {
                fs::write(path.join(format!("{name}.txt")), name).unwrap();
                git_in(&path, &["add", "."]);
                git_in(&path, &["commit", "-q", "-m", name]);
            }
            let tip = crate::git::run(&["rev-parse", "HEAD"], Some(&path)).unwrap();
            (path.to_string_lossy().into_owned(), tip)
        };
        let on_a_branch = |tip: &str| crate::git::run(&["for-each-ref", "--format=%(refname:short)", "--contains", tip, "refs/heads"], Some(&repo)).unwrap();
        for (name, choice) in [("batch", None), ("ticked", Some(true))] {
            let (path, tip) = detached(name, true);
            let check = remove_check(&git, &project, &path).unwrap();
            assert_eq!(check.commits.len(), 1, "{check:?}");
            let kept = remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, choice).unwrap();
            assert!(!Path::new(&path).exists(), "the folder went");
            let want = format!("kolux/kept-{}", &tip[..7]);
            assert_eq!(kept, Some(Kept { branch: want.clone(), commit: tip.clone() }), "{name}: the new branch is named");
            assert_eq!(on_a_branch(&tip), want, "{name}: the commit survives on it");
        }
        // nothing of its own (its HEAD is on main): no branch is made
        let (path, tip) = detached("clean", false);
        let check = remove_check(&git, &project, &path).unwrap();
        let kept_now = || crate::git::run(&["for-each-ref", "--format=%(refname:short)", "refs/heads/kolux"], Some(&repo)).unwrap().lines().count();
        let before = kept_now();
        assert_eq!(remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, None).unwrap(), None);
        assert!(on_a_branch(&tip).lines().any(|b| b == "main") && kept_now() == before, "no new branch");
        // Keep the branch unticked, the commits listed in the question: the user let them go
        let (path, tip) = detached("letgo", true);
        let check = remove_check(&git, &project, &path).unwrap();
        assert_eq!(remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, Some(false)).unwrap(), None);
        assert_eq!(on_a_branch(&tip), "");
        drop(store);
        for d in [profile, repo, ws_root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// T-613b (review of PR #10): a branch whose commit cannot be read is not "nothing to lose": the
    /// read fails, so the check refuses rather than letting the branch go.
    #[test]
    fn t613b_a_branch_that_cannot_be_read_is_not_taken_for_one_with_nothing_to_lose() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("repo613r");
        git_in(&repo, &["branch", "broken"]);
        fs::write(repo.join(".git/refs/heads/broken"), "0000000000000000000000000000000000000bad\n").unwrap();
        let read = only_here(&git, &repo, Some("broken"), "");
        assert_eq!(read, Err("Kolux could not read this branch, so it was left in place.".to_string()), "a failed read is not an empty list");
        // a branch that is not there at all (unborn) still has nothing to lose
        assert_eq!(only_here(&git, &repo, Some("never-made"), ""), Ok(Vec::new()));
        let _ = fs::remove_dir_all(repo);
    }

    /// T-613b (review of lane2): a detached worktree whose HEAD Git could not tell (an empty head)
    /// is not taken for one with no commits: the check refuses with a plain message.
    #[test]
    fn t613b_a_detached_worktree_whose_head_cannot_be_read_is_refused() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("repo613h");
        assert_eq!(only_here(&git, &repo, None, ""), Err("Kolux could not read this workspace's commit, so it was left in place.".to_string()));
        let _ = fs::remove_dir_all(repo);
    }

    /// T-613b (review of PR #10): a delete with Keep the branch unticked (Some(false)) deletes the
    /// branch only in its turn, as the no-choice delete does, so it never races another delete's
    /// decision about the same commits.
    #[test]
    fn t613b_an_explicit_branch_delete_takes_the_branch_turn() {
        use std::time::Duration;
        let git = Git::detect().unwrap();
        let profile = temp("profile613t");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let repo = temp_repo("repo613t");
        let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
        let place = nested(&temp("ws613t"));
        let terminals = crate::terminal::Terminals::default();
        let work = create_workspace(&git, &place, &project, "gone", None).unwrap().worktree;
        let branch = work.branch.clone().unwrap();
        let exists = || crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")], Some(&repo)).is_ok();
        let check = remove_check(&git, &project, &work.path).unwrap();
        let turn = branch_turn(Path::new(&project.path));
        let held = turn.lock().unwrap();
        std::thread::scope(|s| {
            let run = s.spawn(|| remove_one(&git, &store, &terminals, &project, &work.path, false, &check.stamp, Some(false)));
            let start = std::time::Instant::now();
            while Path::new(&work.path).exists() && start.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(20));
            }
            std::thread::sleep(Duration::from_millis(200));
            let during = exists();
            drop(held);
            assert_eq!(run.join().unwrap(), Ok(None));
            assert!(during, "the branch waits for the turn before it goes");
        });
        assert!(!exists(), "and goes once the turn is free");
        drop(store);
        for d in [profile, repo, place.root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj039_a_reply_becomes_a_short_slug_without_the_prefix() {
        assert_eq!(branch_slug("Fix the login bug", "").as_deref(), Some("fix-the-login-bug"));
        assert_eq!(branch_slug("`tx/Fix login`\nignored second line", "tx/").as_deref(), Some("fix-login"), "the prefix is removed");
        assert_eq!(branch_slug("TX/fix-login", "tx/").as_deref(), Some("fix-login"), "any letter case");
        assert_eq!(branch_slug("tx", "tx/"), None, "only the prefix is ignored");
        assert_eq!(branch_slug("tx/", "tx/"), None);
        assert_eq!(branch_slug("   \n  ", ""), None);
        assert_eq!(branch_slug("???", ""), None);
        let long = branch_slug("add support for importing every kind of saved layout from the old settings folder", "").unwrap();
        assert!(long.len() <= SLUG_MAX && !long.ends_with('-'), "{long}");
        assert_eq!(long, "add-support-for-importing-every-kind-of");
        assert_eq!(sentence_case("fix-login-bug"), "Fix login bug");
        assert_eq!(sentence_case("tx/fix-login"), "Fix login");
    }

    #[test]
    fn cli009_a_wsl_path_on_a_mounted_drive_resolves_and_the_callers_distro_wins() {
        assert_eq!(wsl_path("/mnt/c/Users/x/repo", None), "C:\\Users\\x\\repo");
        assert_eq!(wsl_path("/mnt/d", Some("Ubuntu")), "D:\\");
        // Not a drive: /mnt/wsl is Linux's own folder, so it belongs to the caller's distro.
        assert_eq!(wsl_path("/mnt/wsl/x", Some("Debian")), "\\\\wsl.localhost\\Debian\\mnt\\wsl\\x");
        // The same Linux path written from two distros reaches each caller's own.
        assert_eq!(wsl_path("/home/u/app", Some("Ubuntu")), "\\\\wsl.localhost\\Ubuntu\\home\\u\\app");
        assert_eq!(wsl_path("/home/u/app", Some("Debian")), "\\\\wsl.localhost\\Debian\\home\\u\\app");
        assert_eq!(wsl_path("/home/u/app", None), "/home/u/app");
        assert_eq!(wsl_path("C:\\work\\a", Some("Ubuntu")), "C:\\work\\a");
        assert_eq!(wsl_distro_of("\\\\wsl.localhost\\Ubuntu\\home\\u"), Some("Ubuntu".into()));
        assert_eq!(wsl_distro_of("//wsl$/Debian/home"), Some("Debian".into()));
        assert_eq!(wsl_distro_of("C:\\work"), None);
    }

    #[test]
    fn cli019_a_workspace_status_is_found_by_id_label_or_the_word_completed() {
        let store = Store::open(&temp("status-profile")).unwrap();
        assert_eq!(resolve_status(&store, "in-review").unwrap(), "in-review");
        assert_eq!(resolve_status(&store, "In progress").unwrap(), "in-progress");
        assert_eq!(resolve_status(&store, " TODO ").unwrap(), "todo");
        assert_eq!(resolve_status(&store, "completed").unwrap(), "done");
        let why = resolve_status(&store, "blocked").unwrap_err();
        assert!(why.contains("no status blocked") && why.contains("in-review"), "{why}");
    }

    #[test]
    fn cli009_folder_names_the_folder_workspace_of_a_project_without_git_only() {
        let base = temp("folder-parent");
        let store = Store::open(&base.join("db")).unwrap();
        let plain = base.join("plain");
        fs::create_dir_all(&plain).unwrap();
        let project = crate::folder_projects::add_folder(&store, &plain).unwrap();
        let (found, ws) = folder_parent(&store, &project.id).unwrap();
        assert_eq!(found.id, project.id);
        assert!(same_folder(Path::new(&ws.path), &plain));
        assert!(folder_parent(&store, "nope").unwrap_err().contains("no project"));
        let repo = temp_repo("folder-parent-git");
        let git = Git::detect().unwrap();
        let git_project = add_project(&git, &store, &repo).unwrap();
        assert!(folder_parent(&store, &git_project.id).unwrap_err().contains("without Git"));
    }

    fn rename_fixture(name: &str, setting: Option<bool>) -> (Git, Mutex<Store>, Project, PathBuf, PathBuf, PathBuf) {
        let git = Git::detect().unwrap();
        let profile = temp(&format!("profile-{name}"));
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo(&format!("repo-{name}"));
        let root = temp(&format!("root-{name}"));
        let mut settings = store.settings();
        settings["branchPrefix"] = serde_json::json!("custom");
        settings["branchPrefixCustom"] = serde_json::json!("tx");
        settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
        if let Some(on) = setting {
            settings[RENAME_SETTING] = serde_json::json!(on);
        }
        store.save_settings(&settings).unwrap();
        let project = add_project(&git, &store, &repo).unwrap();
        (git, Mutex::new(store), project, profile, repo, root)
    }

    #[test]
    fn proj039_the_first_work_renames_a_suggested_branch_once_and_keeps_its_commits() {
        let (git, store, project, profile, repo, root) = rename_fixture("rename-ok", None);
        let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let old = made.branch.clone().unwrap();
        assert!(old.starts_with("tx/"), "{old}");
        // work already committed on the branch must still be on it afterwards
        fs::write(Path::new(&made.path).join("b.txt"), "b").unwrap();
        git_in(Path::new(&made.path), &["add", "."]);
        git_in(Path::new(&made.path), &["commit", "-q", "-m", "work"]);
        let tip = rev(Path::new(&made.path), "HEAD");
        let answer = rename_after_work(&git, &store, &project, &made.path, "tx/Fix the login bug").unwrap();
        assert!(answer.renamed, "{answer:?}");
        assert_eq!(answer.branch.as_deref(), Some("tx/fix-the-login-bug"));
        assert_eq!(answer.old.as_deref(), Some(old.as_str()));
        assert_eq!(answer.name.as_deref(), Some("Fix the login bug"));
        assert_eq!(rev(&repo, "refs/heads/tx/fix-the-login-bug"), tip, "the commits moved with the branch");
        assert!(!git.branch_taken(&repo, &old), "the old name is gone");
        assert_eq!(git.worktrees(&repo).unwrap().iter().find(|w| name_key(&w.path) == name_key(&made.path)).and_then(|w| w.branch.clone()).as_deref(), Some("tx/fix-the-login-bug"));
        assert_eq!(load_names(&store.lock().unwrap()).get(&name_key(&made.path)).and_then(|v| v.as_str()), Some("Fix the login bug"));
        // a second reply changes nothing: only a name Kolux suggested is replaced
        let again = rename_after_work(&git, &store, &project, &made.path, "something else").unwrap();
        assert!(!again.renamed && again.reason.is_some(), "{again:?}");
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj039_a_branch_is_left_alone_when_the_setting_is_off_the_name_is_yours_or_it_is_the_main_checkout() {
        let (git, store, project, profile, repo, root) = rename_fixture("rename-off", Some(false));
        let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let old = made.branch.clone().unwrap();
        let off = rename_after_work(&git, &store, &project, &made.path, "fix login").unwrap();
        assert!(!off.renamed && off.reason.as_deref().is_some_and(|r| r.contains("off")), "{off:?}");
        assert!(git.branch_taken(&repo, &old));
        // on again, but named by hand
        let mut settings = store.lock().unwrap().settings();
        settings[RENAME_SETTING] = serde_json::json!(true);
        store.lock().unwrap().save_settings(&settings).unwrap();
        rename(&store.lock().unwrap(), &made.path, "My own name").unwrap();
        let named = rename_after_work(&git, &store, &project, &made.path, "fix login").unwrap();
        assert!(!named.renamed, "{named:?}");
        assert!(git.branch_taken(&repo, &old), "a hand-named workspace keeps its branch");
        // the main checkout is never renamed, even when marked
        mark_suggested(&store.lock().unwrap(), &project.path, true).unwrap();
        let main = rename_after_work(&git, &store, &project, &project.path, "fix login").unwrap();
        assert!(!main.renamed, "{main:?}");
        assert!(git.branch_taken(&repo, "main"));
        // a reply with nothing usable changes nothing
        let fresh = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let none = rename_after_work(&git, &store, &project, &fresh.path, "???").unwrap();
        assert!(!none.renamed, "{none:?}");
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj039_a_taken_branch_name_gets_a_number_and_a_rename_never_overwrites() {
        let (git, store, project, profile, repo, root) = rename_fixture("rename-taken", None);
        let first = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let second = create_fresh_from(&git, &store, &project.id, None).unwrap();
        // an unmerged branch that already holds the wanted name
        git_in(&repo, &["branch", "tx/fix-login"]);
        let tip = rev(&repo, "refs/heads/tx/fix-login");
        let a = rename_after_work(&git, &store, &project, &first.path, "fix login").unwrap();
        assert_eq!(a.branch.as_deref(), Some("tx/fix-login-2"), "{a:?}");
        let b = rename_after_work(&git, &store, &project, &second.path, "fix login").unwrap();
        assert_eq!(b.branch.as_deref(), Some("tx/fix-login-3"), "{b:?}");
        assert_eq!(rev(&repo, "refs/heads/tx/fix-login"), tip, "the branch that held the name is untouched");
        // the Git layer alone refuses to replace a branch and says why
        let err = git.rename_branch(&repo, "tx/fix-login-2", "tx/fix-login").unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert!(git.rename_branch(&repo, "tx/fix-login-2", "--evil").is_err());
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t107d_the_first_prompt_renames_a_suggested_branch_once_from_the_task_and_finds_the_project_by_path() {
        let (git, store, project, profile, repo, root) = rename_fixture("first-prompt", None);
        let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let old = made.branch.clone().unwrap();
        assert_eq!(project_for_path(&git, &store.lock().unwrap(), &made.path).map(|p| p.id), Some(project.id.clone()), "the project is found from the folder");
        assert!(project_for_path(&git, &store.lock().unwrap(), "C:/nowhere/at/all").is_none());
        // no writer: the task's own words name the branch; a work-item marker never does
        let a = rename_on_first_prompt(&git, &store, &made.path, "Fix the login bug (#123)\nmore detail", None).unwrap();
        assert!(a.renamed, "{a:?}");
        assert_eq!(a.branch.as_deref(), Some("tx/fix-the-login-bug"));
        assert_eq!(a.name.as_deref(), Some("Fix the login bug"));
        assert!(!git.branch_taken(&repo, &old));
        // once per workspace: the next prompt changes nothing
        let b = rename_on_first_prompt(&git, &store, &made.path, "now do something else", None).unwrap();
        assert!(!b.renamed && b.reason.is_some(), "{b:?}");
        assert!(git.branch_taken(&repo, "tx/fix-the-login-bug"));
        // an unknown folder and a prompt of only markers are left alone without touching Git
        assert!(!rename_on_first_prompt(&git, &store, "C:/nowhere/at/all", "fix it", None).unwrap().renamed);
        let fresh = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let m = rename_on_first_prompt(&git, &store, &fresh.path, "#12 KOL-7 [ABC-99]", None).unwrap();
        assert!(!m.renamed && m.reason.as_deref().is_some_and(|r| r.contains("nothing")), "{m:?}");
        assert!(git.branch_taken(&repo, fresh.branch.as_deref().unwrap()));
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t107d_a_pushed_branch_one_with_a_pull_request_or_one_renamed_by_hand_is_never_renamed() {
        let (git, store, project, profile, repo, root) = rename_fixture("first-prompt-guards", None);
        // pushed without tracking: a remote holds the name
        let pushed = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let pb = pushed.branch.clone().unwrap();
        git_in(&repo, &["update-ref", &format!("refs/remotes/origin/{pb}"), "HEAD"]);
        assert!(git.on_remote(&repo, &pb));
        let a = rename_on_first_prompt(&git, &store, &pushed.path, "fix login", None).unwrap();
        assert!(!a.renamed && a.reason.as_deref().is_some_and(|r| r.contains("pushed")), "{a:?}");
        assert!(git.branch_taken(&repo, &pb), "the pushed branch keeps its name");
        // tracking configured
        let tracked = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let tb = tracked.branch.clone().unwrap();
        git_in(&repo, &["config", &format!("branch.{tb}.remote"), "origin"]);
        git_in(&repo, &["config", &format!("branch.{tb}.merge"), &format!("refs/heads/{tb}")]);
        let b = rename_on_first_prompt(&git, &store, &tracked.path, "fix login", None).unwrap();
        assert!(!b.renamed && b.reason.as_deref().is_some_and(|r| r.contains("pushed")), "{b:?}");
        assert!(git.branch_taken(&repo, &tb));
        // linked to a pull request
        let pr = create_fresh_from(&git, &store, &project.id, None).unwrap();
        set_origin(&store.lock().unwrap(), &pr.path, Some(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/5" }))).unwrap();
        let c = rename_on_first_prompt(&git, &store, &pr.path, "fix login", None).unwrap();
        assert!(!c.renamed && c.reason.as_deref().is_some_and(|r| r.contains("pull request")), "{c:?}");
        assert!(git.branch_taken(&repo, pr.branch.as_deref().unwrap()));
        // renamed by hand in Git: the branch's last part no longer names the folder
        let hand = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let hb = hand.branch.clone().unwrap();
        git_in(Path::new(&hand.path), &["branch", "-m", &hb, "tx/mine"]);
        let d = rename_on_first_prompt(&git, &store, &hand.path, "fix login", None).unwrap();
        assert!(!d.renamed && d.reason.as_deref().is_some_and(|r| r.contains("name of its own")), "{d:?}");
        assert!(git.branch_taken(&repo, "tx/mine"));
        // a workspace made from the composer with the suggested name is marked; a typed branch is not
        let kept = create_workspace(&git, &place_from(&project, &store.lock().unwrap().settings()), &project, "amber-otter", None).unwrap().worktree;
        assert!(!suggested_map(&store.lock().unwrap()).contains_key(&name_key(&kept.path)), "create_workspace itself marks nothing");
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn stat039_task_words_drop_work_item_markers_and_keep_the_first_line() {
        assert_eq!(task_words("Fix the login bug (#123)\nsecond line"), "Fix the login bug");
        assert_eq!(task_words("KOL-12: fix login [ABC-7]"), "fix login");
        assert_eq!(task_words("  #12 KOL-7 [ABC-99] "), "");
        assert_eq!(task_words("add T-shirt sizes for x-ray"), "add T-shirt sizes for x-ray");
        assert_eq!(task_words("\n\n  "), "");
    }

    #[test]
    fn t110b_a_renamed_branch_offers_the_folder_and_the_move_rekeys_what_kolux_remembers_without_deleting() {
        let (git, store, project, profile, repo, root) = rename_fixture("move-folder", None);
        let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let child = create_fresh_from(&git, &store, &project.id, None).unwrap();
        {
            let s = store.lock().unwrap();
            set_parent(&s, &child.path, Some(&made.path)).unwrap();
            set_hidden(&s, &made.path, true).unwrap();
            save_workspace_note(&s, &made.path, "handoff").unwrap();
            save_seen(&s, &project, &[name_key(&made.path), name_key(&child.path)]).unwrap(); // as the first scan would have
        }
        fs::write(Path::new(&made.path).join("work.txt"), "unsaved").unwrap(); // uncommitted work travels with the folder
        let a = rename_on_first_prompt(&git, &store, &made.path, "Fix the login bug", None).unwrap();
        assert!(a.renamed, "{a:?}");
        assert_eq!(a.folder.as_deref(), Some("fix-the-login-bug"), "the folder is offered, never moved here");
        assert!(Path::new(&made.path).is_dir(), "the question comes first");
        // a name that is not a folder name, and a taken place, refuse and move nothing
        assert!(move_folder(&git, &store, &made.path, "a/b").is_err());
        let taken = Path::new(&made.path).parent().unwrap().join("taken");
        fs::create_dir_all(&taken).unwrap();
        fs::write(taken.join("keep.txt"), "k").unwrap();
        let e = move_folder(&git, &store, &made.path, "taken").unwrap_err();
        assert!(e.contains("already exists"), "{e}");
        assert!(taken.join("keep.txt").is_file() && Path::new(&made.path).is_dir());
        // the main checkout is never moved
        assert!(move_folder(&git, &store, &repo.to_string_lossy(), "elsewhere").is_err());
        assert!(repo.is_dir());
        // the move itself
        let to = move_folder(&git, &store, &made.path, "fix-the-login-bug").unwrap();
        assert!(Path::new(&to).join("work.txt").is_file(), "the uncommitted file came along");
        assert!(!Path::new(&made.path).exists());
        assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&to) && w.branch.as_deref() == Some("tx/fix-the-login-bug")));
        let s = store.lock().unwrap();
        assert_eq!(load_names(&s).get(&name_key(&to)).and_then(|v| v.as_str()), Some("Fix the login bug"));
        assert!(!load_names(&s).contains_key(&name_key(&made.path)));
        assert_eq!(load_map(&s, PARENTS_KEY).get(&name_key(&child.path)).and_then(|v| v.as_str()).map(name_key), Some(name_key(&to)), "the child now names the moved folder as its parent");
        assert_eq!(load_map(&s, HIDDEN_KEY).get(&name_key(&to)), Some(&serde_json::Value::Bool(true)));
        let seen = seen_of(&s, &project).unwrap();
        assert!(seen.contains(&name_key(&to)) && !seen.contains(&name_key(&made.path)));
        assert!(load_origins(&s).contains_key(&name_key(&to)));
        assert!(s.get(&format!("{NOTE_PREFIX}{}", name_key(&to))).unwrap().unwrap().contains("handoff"));
        assert_eq!(s.get(&format!("{NOTE_PREFIX}{}", name_key(&made.path))).unwrap().as_deref(), Some(""));
        assert!(crate::activity::workspace_times(&s).contains_key(&crate::activity::key(&to)));
        // folder renaming off: the branch and the name still change, no folder is offered
        let mut settings = s.settings();
        settings[RENAME_FOLDERS_SETTING] = serde_json::json!(false);
        s.save_settings(&settings).unwrap();
        drop(s);
        let other = create_fresh_from(&git, &store, &project.id, None).unwrap();
        let b = rename_on_first_prompt(&git, &store, &other.path, "Write the docs", None).unwrap();
        assert!(b.renamed && b.folder.is_none(), "{b:?}");
        assert_eq!(b.name.as_deref(), Some("Write the docs"));
        assert!(Path::new(&other.path).is_dir());
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t110b_a_plain_folder_project_only_gets_a_title() {
        let profile = temp("profile-plain-title");
        let store = Store::open(&profile).unwrap();
        let plain = temp("plain-title");
        crate::folder_projects::add_folder(&store, &plain).unwrap();
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let a = rename_on_first_prompt(&git, &store, &plain.to_string_lossy(), "Sort the photos #4", None).unwrap();
        assert!(a.renamed && a.branch.is_none() && a.folder.is_none(), "{a:?}");
        assert_eq!(a.name.as_deref(), Some("Sort the photos"));
        assert!(plain.is_dir() && !plain.join(".git").exists(), "no Git was started, nothing moved");
        // once: the title it now has is its own
        let b = rename_on_first_prompt(&git, &store, &plain.to_string_lossy(), "do more", None).unwrap();
        assert!(!b.renamed, "{b:?}");
        // a project the user named is left alone
        let named = temp("plain-named");
        let p2 = crate::folder_projects::add_folder(&store.lock().unwrap(), &named).unwrap();
        set_display_name(&store.lock().unwrap(), &p2.id, "Mine").unwrap();
        let c = rename_on_first_prompt(&git, &store, &named.to_string_lossy(), "do things", None).unwrap();
        assert!(!c.renamed, "{c:?}");
        for d in [profile, plain, named] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn proj059_rename_trims_refuses_blank_and_lasts() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-rename-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        assert_eq!(rename(&s, "C:/r/wt", "  Login fix  ").unwrap(), "Login fix");
        assert!(rename(&s, "C:/r/wt", "   ").is_err(), "blank is refused");
        drop(s);
        let names = load_names(&Store::open(&dir).unwrap());
        assert_eq!(names.get(&name_key("C:/r/wt")).and_then(|v| v.as_str()), Some("Login fix"), "the old name survives the blank try and a restart");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit040_each_workspace_keeps_its_own_note_within_256_kb() {
        let profile = temp("note-profile");
        let store = Store::open(&profile).unwrap();
        assert_eq!(workspace_note(&store, "C:/ws/app/a"), Note::default(), "no note yet reads as empty");
        let at = save_workspace_note(&store, "C:/ws/app/a", "check the login flow").unwrap();
        let note = workspace_note(&store, "C:/ws/app/a");
        assert_eq!((note.text.as_str(), note.updated), ("check the login flow", Some(at)));
        assert_eq!(workspace_note(&store, "C:/ws/app/b"), Note::default(), "another worktree has its own, empty note");
        // A note over 256 KB is refused and the saved one is kept whole.
        assert!(save_workspace_note(&store, "C:/ws/app/a", &"x".repeat(NOTE_MAX + 1)).is_err());
        assert_eq!(workspace_note(&store, "C:/ws/app/a").text, "check the login flow");
        assert!(save_workspace_note(&store, "C:/ws/app/a", &"x".repeat(NOTE_MAX)).is_ok());
        // A damaged stored note reads as empty instead of failing.
        store.set(&format!("{NOTE_PREFIX}{}", name_key("C:/ws/app/c")), "{not json").unwrap();
        assert_eq!(workspace_note(&store, "C:/ws/app/c"), Note::default());
        // Forgetting a removed workspace forgets its note, so a new one in that folder starts empty.
        forget_workspace(&store, "C:/ws/app/a").unwrap();
        assert_eq!(workspace_note(&store, "C:/ws/app/a"), Note::default());
        drop(store);
        fs::remove_dir_all(profile).unwrap();
    }
    // ---- T-302 / PROJ-018: an icon from the repository

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-small-picture";

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }

    fn src_of(i: Option<AutoIcon>, kind: &str) -> String {
        let i = i.unwrap_or_else(|| panic!("an icon of kind {kind}"));
        assert_eq!(i.kind, kind, "{i:?}");
        i.src
    }

    #[test]
    fn t302_a_small_favicon_in_the_repository_becomes_the_project_icon() {
        let repo = temp("t302-fav");
        put(&repo, "public/favicon.png", PNG);
        // a later place never beats an earlier one
        put(&repo, "icon.png", b"\x89PNG\r\n\x1a\nother");
        let src = src_of(auto_icon(&repo), "image");
        assert!(src.starts_with("data:image/png;base64,"), "{src}");
        use base64::Engine as _;
        let body = src.trim_start_matches("data:image/png;base64,");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(body).unwrap(), PNG);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn t302_places_are_tried_in_the_order_the_card_gives() {
        let repo = temp("t302-order");
        // 4th: a link in the page source; 3rd: a picture the manifest names; 2nd: an app bundle
        put(&repo, "index.html", b"<html><head><link rel=\"icon\" href=\"/img/page.png\"></head></html>");
        put(&repo, "img/page.png", PNG);
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"), "the page link is the last place before the avatar");
        put(&repo, "package.json", br#"{"homepage":"https://example.org/site/","icon":"img/manifest.png"}"#);
        put(&repo, "img/manifest.png", b"\x89PNG\r\n\x1a\nmanifest");
        let manifest = src_of(auto_icon(&repo), "image");
        assert!(manifest.starts_with("data:image/png"), "a picture the manifest names beats the page link");
        use base64::Engine as _;
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(manifest.trim_start_matches("data:image/png;base64,")).unwrap(), b"\x89PNG\r\n\x1a\nmanifest");
        put(&repo, "src-tauri/icons/icon.png", PNG);
        let bundle = src_of(auto_icon(&repo), "image");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(bundle.trim_start_matches("data:image/png;base64,")).unwrap(), PNG, "an app bundle icon beats the manifest's picture");
        put(&repo, "favicon.ico", &[0, 0, 1, 0, 1, 0]);
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/x-icon"), "a favicon in the repository beats a bundle");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn t302_icon_links_in_the_page_source_are_followed_inside_the_repository_only() {
        let repo = temp("t302-links");
        put(&repo, "public/index.html", b"<link rel='shortcut icon' href='logo.png'><link rel=\"stylesheet\" href=\"a.css\">");
        put(&repo, "public/logo.png", PNG);
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
        // a link that climbs out of the repository is not followed
        let repo2 = temp("t302-links2");
        // the picture sits where the link points: beside the repository, not in it
        let outside = repo2.parent().unwrap().join(format!("t302-secret-{}.png", std::process::id()));
        fs::write(&outside, PNG).unwrap();
        let climb = format!("../{}", outside.file_name().unwrap().to_string_lossy());
        put(&repo2, "index.html", format!("<link rel=\"icon\" href=\"{climb}\"><link rel=\"icon\" href=\"C:/x/secret.png\">").as_bytes());
        assert_eq!(auto_icon(&repo2), None);
        assert_eq!(repo_image(&repo2, &climb), None);
        assert_eq!(repo_image(&repo2, &climb.replace('/', "\\")), None);
        // a web address that is not plain https is not used
        put(&repo2, "index.html", b"<link rel=\"icon\" href=\"http://example.org/a.png\"><link rel=\"icon\" href=\"javascript:alert(1)\">");
        assert_eq!(auto_icon(&repo2), None);
        for d in [repo, repo2] {
            let _ = fs::remove_dir_all(d);
        }
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn t302_a_file_that_is_too_large_or_not_a_picture_is_passed_over() {
        let repo = temp("t302-big");
        let mut big = PNG.to_vec();
        big.resize(AUTO_ICON_FILE_MAX as usize + 1, 0);
        put(&repo, "favicon.png", &big);
        put(&repo, "public/favicon.ico", b"this is not a picture at all");
        assert_eq!(auto_icon(&repo), None, "both are passed over");
        // the next place is tried instead
        put(&repo, "icon.png", PNG);
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
        // exactly at the limit still counts
        let mut edge = PNG.to_vec();
        edge.resize(AUTO_ICON_FILE_MAX as usize, 0);
        let repo2 = temp("t302-edge");
        put(&repo2, "favicon.png", &edge);
        assert!(src_of(auto_icon(&repo2), "image").starts_with("data:image/png"));
        // an SVG is told by its text
        let repo3 = temp("t302-svg");
        put(&repo3, "favicon.svg", b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>");
        assert!(src_of(auto_icon(&repo3), "image").starts_with("data:image/svg+xml"));
        for d in [repo, repo2, repo3] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn t302_no_icon_in_the_repository_shows_the_owners_avatar_or_the_folder_symbol() {
        let repo = temp_repo("t302-avatar");
        assert_eq!(auto_icon(&repo), None, "no remote: the folder symbol");
        git_in(&repo, &["remote", "add", "origin", "https://github.com/octo/widget.git"]);
        assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/octo.png");
        // a fork: the upstream owner's avatar wins
        git_in(&repo, &["remote", "add", "upstream", "git@github.com:original/widget.git"]);
        assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/original.png");
        // a fork that was renamed uses its own owner's avatar
        git_in(&repo, &["remote", "set-url", "origin", "https://github.com/octo/widget-fork.git"]);
        assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/octo.png");
        // a host without a known avatar address gives the folder symbol
        git_in(&repo, &["remote", "remove", "upstream"]);
        git_in(&repo, &["remote", "set-url", "origin", "https://git.example.org/octo/widget.git"]);
        assert_eq!(auto_icon(&repo), None);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn t302_remote_addresses_are_read_on_every_form_git_accepts_and_odd_ones_refused() {
        let want = Some(("github.com".to_string(), "o".to_string(), "r".to_string()));
        for url in ["https://github.com/o/r.git", "https://user@github.com/o/r", "git@github.com:o/r.git", "ssh://git@github.com/o/r.git", "https://GitHub.com/o/r/"] {
            assert_eq!(remote_parts(url), want, "{url}");
        }
        for url in ["", "https://github.com/o", "https://github.com/o/r/extra", "https://github.com/o%20x/r", "https://github.com/../r", "C:/some/folder"] {
            assert_eq!(remote_parts(url), None, "{url}");
        }
        assert_eq!(owner_avatar(Some("https://github.com/a b/r"), None), None);
    }

    // ---- FIX-4 (review of a771196e): what a repository may make the page load

    #[test]
    fn fix4_no_web_address_chosen_by_a_repository_file_is_ever_handed_to_the_page() {
        let repo = temp("fix4-nourl");
        put(&repo, "package.json", br#"{"homepage":"https://tracker.example.org/","icon":"https://tracker.example.org/logo.png"}"#);
        put(&repo, "index.html", b"<link rel=\"icon\" href=\"https://192.168.1.1/x.ico\"><link rel=\"icon\" href=\"https://localhost:8080/y.ico\">");
        assert_eq!(auto_icon(&repo), None, "package.json and the page source name web addresses; none may be handed over");
        // a local picture named beside them still works
        put(&repo, "icon.png", PNG);
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn fix4_only_the_hosting_sites_own_avatar_hosts_are_ever_returned() {
        let repo = temp_repo("fix4-hosts");
        git_in(&repo, &["remote", "add", "origin", "https://github.com/octo/widget.git"]);
        let src = src_of(auto_icon(&repo), "avatar");
        assert!(crate::github::avatar_ok(&src, "github.com"), "{src}");
        for host in ["evil.example", "github.com.evil.example", "127.0.0.1", "localhost"] {
            git_in(&repo, &["remote", "set-url", "origin", &format!("https://{host}/octo/widget.git")]);
            assert_eq!(auto_icon(&repo), None, "{host}");
        }
        assert_eq!(owner_avatar(Some("https://github.com/o/r"), None).as_deref(), Some("https://github.com/o.png"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn fix4_the_largest_accepted_file_still_fits_the_frontend_limit() {
        // the data URL a file makes is its base64 text plus the longest header (svg+xml)
        let url_len = |bytes: u64| (bytes.div_ceil(3) * 4) as usize + "data:image/svg+xml;base64,".len();
        assert!(url_len(AUTO_ICON_FILE_MAX) <= ICON_IMAGE_MAX, "a file of exactly AUTO_ICON_FILE_MAX bytes makes {} characters", url_len(AUTO_ICON_FILE_MAX));
        assert!(url_len(AUTO_ICON_FILE_MAX + 3) + 14 > ICON_IMAGE_MAX, "the limit keeps the frontend's 40-character header budget and no less");
        assert_eq!(AUTO_ICON_FILE_MAX, 49_122, "src/projects/projectIcon.ts AUTO_ICON_FILE_MAX is checked against this same figure");
        let mut edge = b"<svg ".to_vec();
        edge.resize(AUTO_ICON_FILE_MAX as usize, b' ');
        let repo = temp("fix4-edge");
        put(&repo, "favicon.svg", &edge);
        let src = src_of(auto_icon(&repo), "image");
        assert!(src.len() <= ICON_IMAGE_MAX, "{}", src.len());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn fix4_the_launch_sweep_forgets_only_gone_worktrees_kolux_made_that_no_session_uses_in_every_project() {
        // forget_gone_at_start gathers the projects, origins and busy folders, then runs this
        let base = temp("fix4-launch");
        let (a, b) = (base.join("a"), base.join("b"));
        init_repo(&a);
        init_repo(&b);
        let git = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&base.join("db")).unwrap());
        let add = |repo: &Path, name: &str| {
            let folder = base.join("ws").join(name);
            git_in(repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", name]);
            folder
        };
        let (a_made, a_mine, a_busy, b_made) = (add(&a, "a-made"), add(&a, "a-by-hand"), add(&a, "a-busy"), add(&b, "b-made"));
        let key = |p: &Path| p.to_string_lossy().to_string();
        {
            let s = store.lock().unwrap();
            for p in [&a_made, &a_busy, &b_made] {
                set_origin(&s, &key(p), Some(&serde_json::json!({"issue": 1}))).unwrap();
            }
        }
        for p in [&a_made, &a_mine, &a_busy, &b_made] {
            fs::remove_dir_all(p).unwrap();
        }
        let project = |id: &str, path: &Path| Project { id: id.into(), name: id.into(), path: key(path), workspaces_dir: None, base: None, display_name: None };
        let projects = [project("gone-folder", &base.join("nowhere")), project("a", &a), project("b", &b)];
        let origins = load_origins(&store.lock().unwrap());
        let mut forgotten = sweep_all_gone(&store, &git, &projects, &origins, &[key(&a_busy)], None);
        forgotten.sort();
        let mut want = vec![key(&a_made), key(&b_made)];
        want.sort();
        assert_eq!(forgotten, want, "both projects are swept; a folder Git cannot read is skipped; one made by hand or in use stays");
        let listed = |repo: &Path| git.worktrees(repo).unwrap().into_iter().map(|w| w.path).collect::<Vec<_>>();
        assert_eq!(listed(&a).len(), 3, "main, the one made by hand and the busy one: {:?}", listed(&a));
        assert_eq!(listed(&b).len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    /// A folder link from `link` to `target` (a junction on Windows, which needs no privilege).
    fn link_dir(link: &Path, target: &Path) {
        #[cfg(windows)]
        let ok = Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
        #[cfg(not(windows))]
        let ok = std::os::unix::fs::symlink(target, link).is_ok();
        assert!(ok, "could not link {} to {}", link.display(), target.display());
    }

    #[test]
    fn fix4_a_page_reached_through_a_link_out_of_the_repository_is_not_read() {
        let base = temp("fix4-link");
        let repo = base.join("repo");
        let outside = base.join("outside");
        put(&repo, "logo.png", PNG);
        put(&outside, "index.html", b"<link rel=\"icon\" href=\"/logo.png\">");
        put(&outside, "package.json", br#"{"icon":"logo.png"}"#);
        link_dir(&repo.join("public"), &outside);
        assert_eq!(repo_text(&repo, "public/index.html"), None, "read through a link that leaves the repository");
        assert_eq!(auto_icon(&repo), None, "the page outside the repository named logo.png; it must not be read at all");
        // the same page inside the repository is read
        put(&repo, "src/index.html", b"<link rel=\"icon\" href=\"/logo.png\">");
        assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
        // a package.json that is itself outside through a link is not read either
        let repo2 = base.join("repo2");
        put(&repo2, "logo.png", PNG);
        link_dir(&repo2.join("sub"), &outside);
        assert_eq!(repo_text(&repo2, "sub/package.json"), None);
        assert!(repo_text(&outside, "package.json").is_some(), "the same file read in place is fine");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn fix4_the_avatar_of_a_parent_repository_is_not_this_projects_avatar() {
        let parent = temp_repo("fix4-parent");
        git_in(&parent, &["remote", "add", "origin", "https://github.com/octo/dotfiles.git"]);
        let inner = parent.join("notes").join("plain-folder");
        fs::create_dir_all(&inner).unwrap();
        assert_eq!(auto_icon(&inner), None, "a plain folder inside another repository has no owner of its own");
        // the repository's own top folder still shows the owner
        assert_eq!(src_of(auto_icon(&parent), "avatar"), "https://github.com/octo.png");
        // a repository nested inside it with its own remote shows its own owner
        let nested = parent.join("vendor").join("lib");
        init_repo(&nested);
        git_in(&nested, &["remote", "add", "origin", "https://github.com/other/lib.git"]);
        assert_eq!(src_of(auto_icon(&nested), "avatar"), "https://github.com/other.png");
        // a nested repository without a remote does not borrow the parent's
        let bare = parent.join("vendor").join("bare");
        init_repo(&bare);
        assert_eq!(auto_icon(&bare), None);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn proj060_a_pasted_github_address_becomes_the_linked_item_and_a_bad_one_changes_nothing() {
        assert_eq!(parse_item("  ").unwrap(), None);
        assert_eq!(parse_item("#12").unwrap(), Some(ItemLink::Issue(12, None)));
        assert_eq!(parse_item("https://www.GitHub.com/acme/app/issues/34?x=1#top").unwrap(), Some(ItemLink::Issue(34, Some("https://github.com/acme/app/issues/34".into()))));
        assert_eq!(parse_item("https://git.corp.example/acme/app/pull/9/files").unwrap(), Some(ItemLink::Pr("https://git.corp.example/acme/app/pull/9".into())));
        assert!(parse_item("https://github.com/acme/app").is_err());
        assert!(parse_item("https://github.com/acme/app/pull/0").is_err());
        assert!(parse_item("not a link").is_err());
        assert!(parse_item("0").is_err());
        let profile = temp("proj060a");
        let store = Store::open(&profile).unwrap();
        let w = "C:\\ws\\one";
        let d = save_details(&store, w, "Login page", "https://github.com/acme/app/pull/12", "## Plan\nsee [spec](https://example.com)").unwrap();
        assert_eq!(d, Details { name: Some("Login page".into()), item: Some("https://github.com/acme/app/pull/12".into()), comment: "## Plan\nsee [spec](https://example.com)".into() });
        assert_eq!(item_number(&origin(&store, w).unwrap()), Some(12), "the sidebar's number reads the linked pull request");
        // a refused link writes nothing: the name and comment stay as saved
        assert!(save_details(&store, w, "Changed", "nonsense", "other").is_err());
        assert_eq!(details_of(&store, w), d);
        drop(store);
    }

    #[test]
    fn proj060_blank_fields_clear_and_an_issue_replaces_a_pull_request() {
        let profile = temp("proj060b");
        let store = Store::open(&profile).unwrap();
        let w = "C:\\ws\\two";
        save_details(&store, w, "Named", "https://github.com/acme/app/pull/12", "note").unwrap();
        let d = save_details(&store, w, "  ", "https://github.com/acme/app/issues/5", "").unwrap();
        assert_eq!(d, Details { name: None, item: Some("https://github.com/acme/app/issues/5".into()), comment: String::new() });
        assert_eq!(item_number(&origin(&store, w).unwrap()), Some(5));
        let d = save_details(&store, w, "", "", "").unwrap();
        assert_eq!(d, Details::default());
        assert_eq!(item_number(&origin(&store, w).unwrap()), None);
        let long = "x".repeat(COMMENT_MAX + 1);
        assert!(save_details(&store, w, "n", "", &long).is_err());
        assert_eq!(details_of(&store, w).name, None, "an over-long comment writes nothing");
        drop(store);
    }

    /// after-list row 882: a refused read of the folder flags or the saved setup must not leave the
    /// project removed with its flag and setup state orphaned; nothing changes and a retry finishes.
    #[test]
    fn row882_a_refused_flag_or_setup_read_leaves_the_project_listed() {
        let profile = temp("row882");
        let store = Store::open(&profile).unwrap();
        let project = project_at("p882", &profile);
        save_projects(&store, std::slice::from_ref(&project)).unwrap();
        store.set("folderProjects", "[1,2").unwrap(); // does not read, so it must be kept aside first
        crate::orchestration::kept::refuse_copies(&profile); // and the store refuses that copy
        assert!(forget_projects(&store, std::slice::from_ref(&project.id)).is_err());
        assert_eq!(load_projects(&store).len(), 1, "the project is still listed");
        assert_eq!(store.get("folderProjects").unwrap().as_deref(), Some("[1,2"), "the flags are untouched");
        let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
        conn.execute_batch("DROP TRIGGER no_copies;").unwrap();
        forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
        assert!(load_projects(&store).is_empty(), "a retry finishes the job");
        drop(conn);
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    /// Row 890: a write that fails after the project list's own save used to leave the list without
    /// the project but its icon, folder flag or setup state behind. All of them land together or none.
    #[test]
    fn row890_a_failing_cleanup_write_leaves_the_project_listed_and_everything_else_untouched() {
        for (tag, key, value) in [("icon", "projectIcons", r#"{"p890":"icon:bug"}"#), ("folder", "folderProjects", r#"["p890"]"#), ("dismissed", "setupCardDismissed", r#"["p890","keep"]"#)] {
            let profile = temp(&format!("row890-{tag}"));
            let store = Store::open(&profile).unwrap();
            let project = project_at("p890", &profile);
            save_projects(&store, std::slice::from_ref(&project)).unwrap();
            store.set(key, value).unwrap();
            let before = store.get(PROJECTS_KEY).unwrap();
            let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
            conn.execute_batch(&format!("CREATE TRIGGER no_cleanup BEFORE UPDATE ON kv WHEN NEW.key = '{key}' BEGIN SELECT RAISE(ABORT, 'disk full'); END;")).unwrap();
            let err = forget_projects(&store, std::slice::from_ref(&project.id)).unwrap_err();
            assert!(err.contains("disk full"), "{tag}: {err}");
            assert_eq!(store.get(PROJECTS_KEY).unwrap(), before, "{tag}: the project is still listed, byte for byte");
            assert_eq!(store.get(key).unwrap().as_deref(), Some(value), "{tag}: the failing key is untouched");
            conn.execute_batch("DROP TRIGGER no_cleanup;").unwrap();
            forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
            assert!(load_projects(&store).is_empty(), "{tag}: a retry finishes the job");
            drop(conn);
            drop(store);
            let _ = fs::remove_dir_all(profile);
        }
    }

    /// The saved-setup half of row 882 (`prune_setup`): its key unreadable and the copy refused.
    #[test]
    fn row882_a_refused_setup_read_leaves_the_project_listed() {
        let profile = temp("row882-setup");
        let store = Store::open(&profile).unwrap();
        let project = project_at("p882s", &profile);
        save_projects(&store, std::slice::from_ref(&project)).unwrap();
        store.set("setupCardDismissed", r#"["keep"]"#).unwrap();
        store.set("localSetups", "{not json").unwrap();
        crate::orchestration::kept::refuse_copies(&profile);
        assert!(forget_projects(&store, std::slice::from_ref(&project.id)).is_err());
        assert_eq!(load_projects(&store).len(), 1, "the project is still listed");
        assert_eq!(store.get("localSetups").unwrap().as_deref(), Some("{not json"), "the saved setups are untouched");
        assert_eq!(store.get("setupCardDismissed").unwrap().as_deref(), Some(r#"["keep"]"#), "the dismissed list is untouched");
        let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
        conn.execute_batch("DROP TRIGGER no_copies;").unwrap();
        forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
        assert!(load_projects(&store).is_empty(), "a retry finishes the job");
        assert_eq!(crate::orchestration::kept::asides(&store, "localSetups"), vec!["{not json".to_string()], "the unreadable blob was kept aside byte for byte on the retry");
        store.set("localSetups", "{}").unwrap();
        drop(conn);
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    /// after-list row 895: a project list that does not read must never be saved over by a
    /// read-then-save (forget, add, edit); the blob stays byte for byte, or is kept aside first.
    const BROKEN_LIST: &str = r#"[{"id":"keep-1","name":"keep","path":"C:/keep"},{"id":"keep-2","na"#;

    fn broken_list_store(tag: &str, refuse_copy: bool) -> (Store, PathBuf) {
        let profile = temp(tag);
        let store = Store::open(&profile).unwrap();
        store.set("projects", BROKEN_LIST).unwrap();
        if refuse_copy {
            crate::orchestration::kept::refuse_copies(&profile);
        }
        (store, profile)
    }

    /// The wording kept::load returns when the copy cannot be made.
    const NOT_KEPT_ASIDE: &str = "projects could not be kept aside";

    #[test]
    fn row895_forget_refuses_when_the_project_list_does_not_read_and_cannot_be_kept_aside() {
        let (store, profile) = broken_list_store("row895-forget", true);
        let err = forget_projects(&store, &["keep-1".to_string()]).unwrap_err();
        assert!(err.contains(NOT_KEPT_ASIDE) && err.contains("nothing was changed"), "{err}");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST), "the list blob is byte for byte what it was");
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    #[test]
    fn row895_forget_keeps_an_unreadable_list_aside_before_it_saves() {
        let (store, profile) = broken_list_store("row895-aside", false);
        forget_projects(&store, &["keep-1".to_string()]).unwrap();
        assert_eq!(crate::orchestration::kept::asides(&store, "projects"), vec![BROKEN_LIST.to_string()], "the unreadable list survives under a corrupt- name");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some("[]"), "the key starts fresh once the copy is safe");
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    #[test]
    fn row895_adding_a_project_refuses_rather_than_wiping_an_unreadable_list() {
        let (store, profile) = broken_list_store("row895-add", true);
        let repo = temp("row895-add-repo");
        let err = register_project(&store, (repo.clone(), repo.clone())).unwrap_err();
        assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST), "no one-project list replaced it");
        drop(store);
        let _ = fs::remove_dir_all(profile);
        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn row895_editing_a_project_refuses_rather_than_wiping_an_unreadable_list() {
        let (store, profile) = broken_list_store("row895-edit", true);
        let err = set_base(&store, "keep-1", Some("main")).unwrap_err();
        assert!(err.contains(NOT_KEPT_ASIDE), "an unreadable list is not 'no longer registered': {err}");
        let err = set_display_name(&store, "keep-1", "Shop").unwrap_err();
        assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST));
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }

    #[test]
    fn row895_setting_a_project_folder_and_base_refuses_rather_than_wiping_an_unreadable_list() {
        let (store, profile) = broken_list_store("row895-set", true);
        let err = set_project_options(&store, "keep-1", "D:/ws", "main").unwrap_err();
        assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST));
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }
}

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
