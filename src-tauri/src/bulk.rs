//! T-218: the workspace pieces around deleting and sorting many (PROJ-071 delete many at once,
//! PROJ-076 forget a workspace locally, PROJ-083 / VIEW-014 what each workspace costs on disk,
//! PROJ-084 the status workflow, and the later delete of a branch kept at removal). The planning,
//! sizing and status rules are pure or take a store, so tests prove them; the commands at the end
//! are thin.

use crate::git::Git;
use crate::projects::{find_project, name_key, remove_one, Kept, Project};
use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

type StoreState<'a> = State<'a, Mutex<Store>>;

// ---- PROJ-071: delete many at once ---------------------------------------------------------------

/// One row of the selection, with the stamp of what the confirmation showed for it.
#[derive(Clone, Debug, Deserialize)]
pub struct Pick {
    pub path: String,
    pub stamp: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub path: String,
    /// "removed", "changed" (it was not what the confirmation showed), "failed" or "left-out".
    pub outcome: String,
    pub message: Option<String>,
    pub kept: Option<Kept>,
}

/// The rows that go ahead, in order and each once, and the ones taken out of the batch with why.
pub fn plan_batch(picks: &[Pick], mains: &[String]) -> (Vec<Pick>, Vec<Done>) {
    let mut seen = HashSet::new();
    let (mut run, mut out) = (Vec::new(), Vec::new());
    for p in picks {
        if !seen.insert(name_key(&p.path)) {
            continue;
        }
        if mains.iter().any(|m| name_key(m) == name_key(&p.path)) {
            out.push(Done { path: p.path.clone(), outcome: "left-out".into(), message: Some("The main checkout cannot be deleted".into()), kept: None });
        } else {
            run.push(p.clone());
        }
    }
    (run, out)
}

/// Runs \`one\` for every pick, \`workers\` at a time, and returns the results in the order given.
/// A refusal that says the workspace changed is reported as such, not as a plain failure.
pub fn run_batch<F>(run: &[Pick], workers: usize, one: F) -> Vec<Done>
where
    F: Fn(&Pick) -> Result<Option<Kept>, String> + Sync,
{
    let next = Mutex::new(0usize);
    let results: Mutex<Vec<Option<Done>>> = Mutex::new(vec![None; run.len()]);
    std::thread::scope(|s| {
        for _ in 0..workers.clamp(1, run.len().max(1)) {
            s.spawn(|| loop {
                let i = {
                    let mut n = next.lock().unwrap_or_else(|e| e.into_inner());
                    let i = *n;
                    *n += 1;
                    i
                };
                let Some(pick) = run.get(i) else { break };
                let done = match one(pick) {
                    Ok(kept) => Done { path: pick.path.clone(), outcome: "removed".into(), message: None, kept },
                    Err(why) => {
                        let outcome = if why.contains("changed after you were asked") { "changed" } else { "failed" };
                        Done { path: pick.path.clone(), outcome: outcome.into(), message: Some(why), kept: None }
                    }
                };
                results.lock().unwrap_or_else(|e| e.into_inner())[i] = Some(done);
            });
        }
    });
    results.into_inner().unwrap_or_else(|e| e.into_inner()).into_iter().flatten().collect()
}

/// The one summary for the whole batch: how many went, which did not and why, and the branches kept.
pub fn summary(done: &[Done]) -> String {
    let count = |o: &str| done.iter().filter(|d| d.outcome == o).count();
    let plural = |n: usize, w: &str| format!("{n} {w}{}", if n == 1 { "" } else { "s" });
    let mut parts = vec![format!("Deleted {} of {}", count("removed"), plural(done.len(), "workspace"))];
    for (o, label) in [("changed", "changed since you were asked"), ("failed", "could not be deleted"), ("left-out", "left out of the batch")] {
        if count(o) > 0 {
            parts.push(format!("{} {label}", count(o)));
        }
    }
    let kept: Vec<&str> = done.iter().filter_map(|d| d.kept.as_ref().map(|k| k.branch.as_str())).collect();
    if !kept.is_empty() {
        parts.push(format!("{} kept: {}", plural(kept.len(), "branch"), kept.join(", ")));
    }
    parts.join(" · ")
}

#[derive(Serialize)]
pub struct Batch {
    pub items: Vec<Done>,
    pub summary: String,
}

/// PROJ-071: one confirmation, deletions side by side, each re-checked just before it runs.
#[tauri::command(async)]
pub fn workspace_remove_many(git: State<'_, Git>, store: StoreState<'_>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, picks: Vec<Pick>, force: bool, keep_branch: Option<bool>) -> Result<Batch, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    let mains: Vec<String> = git.worktrees(Path::new(&project.path))?.into_iter().filter(|w| w.is_main).map(|w| w.path).collect();
    let (run, mut items) = plan_batch(&picks, &mains);
    items.extend(run_batch(&run, 4, |p| remove_one(&git, &store, &terminals, &project, &p.path, force, &p.stamp, keep_branch)));
    let summary = summary(&items);
    Ok(Batch { items, summary })
}

// ---- PROJ-076: forget a workspace locally -----------------------------------------------------------

/// Whether the workspace at \`path\` may be forgotten: never a project's root, and while its project
/// is still there only when its folder is gone.
pub fn forget_check(project: Option<&Project>, path: &str, folder_exists: bool) -> Result<(), String> {
    if let Some(p) = project {
        if name_key(&p.path) == name_key(path) {
            return Err("A project's root cannot be forgotten this way; remove the project instead".into());
        }
        if folder_exists {
            return Err("This workspace's folder is still there. Delete the workspace instead; removing is for ones that are gone".into());
        }
    }
    Ok(())
}

/// PROJ-076: drops Kolux's records of the workspace; nothing on disk changes. Works after the
/// project itself was removed (\`project_id\` none or no longer registered).
#[tauri::command(async)]
pub fn workspace_forget(store: StoreState<'_>, project_id: Option<String>, path: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    forget_verdict(&store, project_id.as_deref(), &path)?;
    crate::projects::forget_workspace(&store, &path)
}

/// The verdict `workspace_forget` acts on, read from the store and the disk.
fn forget_verdict(store: &Store, project_id: Option<&str>, path: &str) -> Result<(), String> {
    let project = project_id.and_then(|id| find_project(store, id).ok());
    forget_check(project.as_ref(), path, Path::new(path).exists())
}

/// Why `workspace_forget` would refuse this workspace, or none; the panel asks before it offers "Remove".
#[tauri::command(async)]
pub fn workspace_forget_check(store: StoreState<'_>, project_id: Option<String>, path: String) -> Result<Option<String>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(forget_verdict(&store, project_id.as_deref(), &path).err())
}

// ---- PROJ-084: the status workflow ----------------------------------------------------------------

const STATUS_LIST_KEY: &str = "workspaceStatusList";
const STATUS_OF_KEY: &str = "workspaceStatusOf";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    pub id: String,
    pub label: String,
    /// Fields a newer version saved, carried through untouched.
    #[serde(flatten)]
    pub rest: serde_json::Map<String, serde_json::Value>,
}

pub fn default_statuses() -> Vec<Status> {
    [("todo", "To do"), ("in-progress", "In progress"), ("in-review", "In review"), ("done", "Done")].iter().map(|(id, label)| Status { id: id.to_string(), label: label.to_string(), rest: Default::default() }).collect()
}

/// The user's statuses in their order, or the default set when none were saved.
pub fn statuses(store: &Store) -> Vec<Status> {
    Some(crate::orchestration::kept::or_default_held::<Vec<Status>>(store, STATUS_LIST_KEY)).filter(|l| !l.is_empty()).unwrap_or_else(default_statuses)
}

fn slug(label: &str) -> String {
    let s: String = label.trim().to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "status".into() } else { s }
}

/// Saves the list: every status with a label is kept, in order, none cut off. A status keeps the
/// id it had (\`id\` given); a new one gets an id from its label, made unique. Blank labels drop.
pub fn set_statuses(store: &Store, list: &[(Option<String>, String)]) -> Result<Vec<Status>, String> {
    let mut out: Vec<Status> = Vec::new();
    // A list that cannot be read or kept aside is an error, never an empty one to save over.
    let old: Vec<Status> = crate::orchestration::kept::load(store, STATUS_LIST_KEY)?;
    let rows: Vec<&(Option<String>, String)> = list.iter().filter(|(_, l)| !l.trim().is_empty()).collect();
    // Every caller id is reserved first, so a new row's slug never takes the id a later row keeps.
    let reserved: std::collections::HashSet<&str> = rows.iter().filter_map(|(id, _)| id.as_deref()).filter(|i| !i.is_empty()).collect();
    for (id, label) in rows {
        let base = id.clone().filter(|i| !i.is_empty()).unwrap_or_else(|| slug(label));
        let owner = id.as_deref().is_some_and(|i| !i.is_empty()) && !out.iter().any(|s| s.id == base);
        let mut unique = base.clone();
        let mut n = 2;
        while out.iter().any(|s| s.id == unique) || (!owner && reserved.contains(unique.as_str())) {
            unique = format!("{base}-{n}");
            n += 1;
        }
        let rest = id.as_ref().filter(|_| unique == base).and_then(|i| old.iter().find(|s| s.id == *i)).map(|s| s.rest.clone()).unwrap_or_default();
        out.push(Status { id: unique, label: label.trim().to_string(), rest });
    }
    let out = if out.is_empty() { default_statuses() } else { out };
    store.set(STATUS_LIST_KEY, &serde_json::to_string(&out).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(out)
}

fn status_map(store: &Store) -> HashMap<String, String> {
    crate::orchestration::kept::or_default(store, STATUS_OF_KEY)
}

/// Card 13: the map a save starts from; a store or copy that fails is an error, never an empty map.
fn status_map_to_change(store: &Store) -> Result<HashMap<String, String>, String> {
    crate::orchestration::kept::load(store, STATUS_OF_KEY)
}

/// The status id of the workspace at \`path\`; one with none, or whose status was deleted, is in the first.
pub fn status_of(store: &Store, path: &str) -> String {
    let list = statuses(store);
    status_map(store).get(&name_key(path)).filter(|id| list.iter().any(|s| &s.id == *id)).cloned().unwrap_or_else(|| list[0].id.clone())
}

pub fn set_status(store: &Store, path: &str, id: &str) -> Result<(), String> {
    if !statuses(store).iter().any(|s| s.id == id) {
        return Err(format!("There is no status {id}"));
    }
    let mut map = status_map_to_change(store)?;
    map.insert(name_key(path), id.to_string());
    store.set(STATUS_OF_KEY, &serde_json::to_string(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn clear_status(store: &Store, path: &str) -> Result<(), String> {
    let mut map = status_map_to_change(store)?;
    if map.remove(&name_key(path)).is_none() {
        return Ok(());
    }
    store.set(STATUS_OF_KEY, &serde_json::to_string(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct StatusState {
    pub list: Vec<Status>,
    /// The status id of each path asked about, in the order asked.
    pub of: Vec<String>,
}

#[tauri::command]
pub fn workspace_statuses(store: StoreState<'_>, paths: Vec<String>) -> Result<StatusState, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(StatusState { list: statuses(&store), of: paths.iter().map(|p| status_of(&store, p)).collect() })
}

/// \`list\` is (existing id or none, label) in the order the user wants.
#[tauri::command]
pub fn workspace_statuses_set(store: StoreState<'_>, list: Vec<(Option<String>, String)>) -> Result<Vec<Status>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    set_statuses(&store, &list)
}

#[tauri::command]
pub fn workspace_status_set(store: StoreState<'_>, path: String, status: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    set_status(&store, &path, &status)
}

// ---- PROJ-083 / VIEW-014: what each workspace costs on disk -----------------------------------------

/// What walking a folder found. \`incomplete\` when the walk hit its entry budget, so the numbers
/// are a floor and are marked as such rather than shown as exact.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Size {
    pub bytes: u64,
    pub files: u64,
    pub incomplete: bool,
}

/// Total size and file count under \`root\`, never following links, stopping after \`budget\` entries.
pub fn dir_size(root: &Path, budget: u64) -> Size {
    let mut size = Size::default();
    let mut seen = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            seen += 1;
            if seen > budget {
                size.incomplete = true;
                return size;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                size.files += 1;
                size.bytes += meta.len();
            }
        }
    }
    size
}

/// One row of the Space table.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceRow {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
    pub size: Size,
    /// Seconds since 1970 of the folder's last change; 0 when unknown.
    pub modified: u64,
    /// Only a linked worktree's space comes back by deleting it; the main checkout's never counts.
    pub reclaimable: bool,
}

/// Rows for the worktrees that exist: a registration whose folder is gone is left out.
pub fn space_rows(worktrees: &[crate::git::Worktree], budget: u64) -> Vec<SpaceRow> {
    worktrees
        .iter()
        .filter(|w| Path::new(&w.path).exists())
        .map(|w| SpaceRow {
            path: w.path.clone(),
            branch: w.branch.clone(),
            is_main: w.is_main,
            size: dir_size(Path::new(&w.path), budget),
            modified: std::fs::metadata(&w.path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs()),
            reclaimable: !w.is_main,
        })
        .collect()
}

/// Scan budget: entries walked per worktree before the size is marked incomplete.
pub const SCAN_BUDGET: u64 = 2_000_000;

pub(crate) fn space_key(project_id: &str) -> String {
    format!("spaceScan:{project_id}")
}

pub fn save_space(store: &Store, project_id: &str, rows: &[SpaceRow]) -> Result<(), String> {
    store.set(&space_key(project_id), &serde_json::to_string(rows).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// The last scan, shown right away on reopening; rows whose folder has since gone are left out.
pub fn saved_space(store: &Store, project_id: &str) -> Vec<SpaceRow> {
    let rows: Vec<SpaceRow> = store.get(&space_key(project_id)).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    rows.into_iter().filter(|r| Path::new(&r.path).exists()).collect()
}

#[tauri::command(async)]
pub fn space_saved(store: StoreState<'_>, project_id: String) -> Result<Vec<SpaceRow>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(saved_space(&store, &project_id))
}

#[tauri::command(async)]
pub fn space_scan(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Vec<SpaceRow>, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    let rows = space_rows(&git.worktrees(Path::new(&project.path))?, SCAN_BUDGET);
    let saved = store.lock().map_err(|e| e.to_string())?;
    save_space(&saved, &project_id, &rows)?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-bulk-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn pick(p: &str) -> Pick {
        Pick { path: p.into(), stamp: "s".into() }
    }

    #[test]
    fn a_batch_counts_duplicates_once_and_leaves_the_main_checkout_out() {
        let (run, out) = plan_batch(&[pick("C:/ws/a"), pick("c:\\ws\\A"), pick("C:/repo"), pick("C:/ws/b")], &["C:/repo".to_string()]);
        assert_eq!(run.iter().map(|p| p.path.as_str()).collect::<Vec<_>>(), ["C:/ws/a", "C:/ws/b"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].outcome, "left-out");
    }

    #[test]
    fn a_hundred_deletions_run_side_by_side_with_one_summary_that_reports_changed_rows_and_kept_branches() {
        let picks: Vec<Pick> = (0..100).map(|i| pick(&format!("C:/ws/{i}"))).collect();
        let live = std::sync::atomic::AtomicUsize::new(0);
        let most = std::sync::atomic::AtomicUsize::new(0);
        let done = run_batch(&picks, 4, |p| {
            use std::sync::atomic::Ordering::SeqCst;
            let now = live.fetch_add(1, SeqCst) + 1;
            most.fetch_max(now, SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(2));
            live.fetch_sub(1, SeqCst);
            match p.path.as_str() {
                "C:/ws/7" => Err("This workspace changed after you were asked. Look again before deleting it.".into()),
                "C:/ws/9" => Err("locked".into()),
                "C:/ws/3" => Ok(Some(Kept { branch: "feat/x".into(), commit: "abc".into() })),
                _ => Ok(None),
            }
        });
        assert_eq!(done.len(), 100);
        assert_eq!(done[0].path, "C:/ws/0", "results keep the order given");
        assert!(most.load(std::sync::atomic::Ordering::SeqCst) > 1, "deletions overlapped");
        assert_eq!(done[7].outcome, "changed");
        assert_eq!(done[9].outcome, "failed");
        assert_eq!(summary(&done), "Deleted 98 of 100 workspaces · 1 changed since you were asked · 1 could not be deleted · 1 branch kept: feat/x");
        assert_eq!(summary(&[]), "Deleted 0 of 0 workspaces");
    }

    #[test]
    fn forgetting_is_refused_for_a_project_root_and_for_a_workspace_whose_folder_is_still_there() {
        let project = Project { id: "p".into(), name: "app".into(), path: "C:/repo".into(), workspaces_dir: None, base: None, display_name: None };
        assert!(forget_check(Some(&project), "c:\\repo", false).unwrap_err().contains("root"));
        assert!(forget_check(Some(&project), "C:/ws/a", true).unwrap_err().contains("still there"));
        assert!(forget_check(Some(&project), "C:/ws/a", false).is_ok());
        assert!(forget_check(None, "C:/ws/a", true).is_ok(), "after the project was removed, anything goes");
    }

    #[test]
    fn the_forget_question_is_asked_with_the_same_verdict_the_forget_acts_on() {
        let dir = temp("forgetv");
        let (repo, here, gone) = (dir.join("repo"), dir.join("ws-here"), dir.join("ws-gone"));
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&here).unwrap();
        let store = Store::open(&dir.join("db")).unwrap();
        let project = crate::projects::register_project(&store, (repo.clone(), repo.clone())).unwrap();
        let (here, gone, repo) = (here.display().to_string(), gone.display().to_string(), repo.display().to_string());
        let id = Some(project.id.as_str());
        assert!(forget_verdict(&store, id, &here).unwrap_err().contains("still there"), "an existing folder of an open project is refused");
        assert!(forget_verdict(&store, id, &repo).unwrap_err().contains("root"));
        assert!(forget_verdict(&store, id, &gone).is_ok(), "a folder that is gone may be forgotten");
        assert!(forget_verdict(&store, Some("no-such-project"), &here).is_ok(), "the project was removed: anything goes");
        assert!(forget_verdict(&store, None, &here).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn statuses_keep_every_label_in_order_and_a_workspace_without_one_is_in_the_first() {
        let dir = temp("status");
        let store = Store::open(&dir).unwrap();
        assert_eq!(statuses(&store), default_statuses());
        let saved = set_statuses(&store, &[(None, "Ideas".into()), (Some("done".into()), "Shipped".into()), (None, "  ".into()), (None, "Ideas".into()), (None, "Needs review!".into())]).unwrap();
        assert_eq!(saved.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(), ["Ideas", "Shipped", "Ideas", "Needs review!"]);
        assert_eq!(saved.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["ideas", "done", "ideas-2", "needs-review"]);
        let many: Vec<(Option<String>, String)> = (0..40).map(|i| (None, format!("Stage {i}"))).collect();
        assert_eq!(set_statuses(&store, &many).unwrap().len(), 40, "none is cut off");
        set_statuses(&store, &saved.iter().map(|s| (Some(s.id.clone()), s.label.clone())).collect::<Vec<_>>()).unwrap();
        assert_eq!(status_of(&store, "C:/ws/a"), "ideas");
        set_status(&store, "C:/ws/a", "done").unwrap();
        assert_eq!(status_of(&store, "c:\\ws\\A"), "done");
        assert!(set_status(&store, "C:/ws/a", "nope").is_err());
        // Removing a status moves its workspaces to the first.
        set_statuses(&store, &[(Some("ideas".into()), "Ideas".into())]).unwrap();
        assert_eq!(status_of(&store, "C:/ws/a"), "ideas");
        set_status(&store, "C:/ws/a", "ideas").unwrap();
        clear_status(&store, "C:/ws/a").unwrap();
        assert!(status_map(&store).is_empty());
        set_status(&store, "C:/ws/a", "ideas").unwrap();
        crate::projects::forget_workspace(&store, "c:\\ws\\A").unwrap();
        assert!(status_map(&store).is_empty(), "row 59: a workspace that goes takes its status with it");
        assert_eq!(set_statuses(&store, &[(None, "".into())]).unwrap(), default_statuses(), "an empty list falls back to the default set");
        drop(store);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_folder_is_measured_without_following_links_and_a_big_one_is_marked_incomplete() {
        let dir = temp("size");
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::write(dir.join("a.bin"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("sub/b.bin"), vec![0u8; 500]).unwrap();
        fs::write(dir.join("sub/deep/c.bin"), vec![0u8; 24]).unwrap();
        assert_eq!(dir_size(&dir, 1000), Size { bytes: 1524, files: 3, incomplete: false });
        let cut = dir_size(&dir, 2);
        assert!(cut.incomplete && cut.files < 3, "{cut:?}");
        assert_eq!(dir_size(&dir.join("missing"), 10), Size::default());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn space_counts_reclaimable_only_for_linked_worktrees_leaves_gone_folders_out_and_shows_the_saved_scan() {
        let root = temp("space");
        let main = root.join("main");
        let linked = root.join("linked");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&linked).unwrap();
        fs::write(main.join("m"), "12345").unwrap();
        fs::write(linked.join("l"), "123").unwrap();
        let wt = |p: &Path, main: bool| crate::git::Worktree {
            path: p.to_string_lossy().to_string(),
            branch: Some("b".into()),
            head: String::new(),
            is_main: main,
            name: None,
            parent: None,
            locked: None,
            hidden: false,
            kind: String::new(),
            source: None,
            made_by: None,
            number: None,
            comment: None,
        };
        let gone = root.join("gone");
        let rows = space_rows(&[wt(&main, true), wt(&linked, false), wt(&gone, false)], 100);
        assert_eq!(rows.len(), 2, "the leftover registration is left out");
        assert!(!rows[0].reclaimable && rows[1].reclaimable);
        assert_eq!((rows[0].size.bytes, rows[1].size.bytes), (5, 3));
        let store = Store::open(&root.join("db")).unwrap();
        assert!(saved_space(&store, "p").is_empty());
        save_space(&store, "p", &rows).unwrap();
        assert_eq!(saved_space(&store, "p"), rows);
        fs::remove_dir_all(&linked).unwrap();
        assert_eq!(saved_space(&store, "p").len(), 1, "a folder deleted since is not shown");
        drop(store);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn card13_a_status_map_that_could_not_be_kept_aside_is_never_saved_over() {
        let dir = temp("c13");
        let db = dir.join("db");
        let store = Store::open(&db).unwrap();
        let broken = "{\"C:/a\": \"s-1\"";
        store.set(STATUS_OF_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&db);
        let first = statuses(&store)[0].id.clone();
        let err = set_status(&store, "C:/a", &first).unwrap_err();
        assert!(err.contains(STATUS_OF_KEY) && !err.contains("s-1"), "{err}");
        assert!(clear_status(&store, "C:/a").is_err());
        assert_eq!(store.get(STATUS_OF_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row881_a_status_list_that_could_not_be_kept_aside_is_never_saved_over() {
        let dir = temp("r881");
        let db = dir.join("db");
        let store = Store::open(&db).unwrap();
        let broken = "[{\"id\": \"mine\", \"label\": \"Mine\"";
        store.set(STATUS_LIST_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&db);
        assert_eq!(statuses(&store), default_statuses(), "the page shows the defaults");
        let err = set_statuses(&store, &[(None, "Backlog".into())]).unwrap_err();
        assert!(err.contains(STATUS_LIST_KEY) && err.contains("could not be kept aside"), "{err}");
        assert_eq!(store.get(STATUS_LIST_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row922_a_save_with_the_list_refused_a_copy_never_replaces_it() {
        let dir = temp("r922a");
        let db = dir.join("db");
        let store = Store::open(&db).unwrap();
        let broken = "[{\"id\": \"mine\", \"label\": \"Mine\"";
        store.set(STATUS_LIST_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&db);
        // No statuses() call first: the save itself must notice the list was not kept aside.
        let err = set_statuses(&store, &[(None, "Backlog".into())]).unwrap_err();
        assert!(err.contains(STATUS_LIST_KEY), "{err}");
        assert_eq!(store.get(STATUS_LIST_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row922_a_renamed_duplicate_does_not_copy_the_unknown_fields_of_the_first() {
        let dir = temp("r922b");
        let store = Store::open(&dir).unwrap();
        store.set(STATUS_LIST_KEY, r##"[{"id":"ideas","label":"Ideas","color":"#f00"}]"##).unwrap();
        set_statuses(&store, &[(Some("ideas".into()), "A".into()), (Some("ideas".into()), "B".into())]).unwrap();
        let back: serde_json::Value = serde_json::from_str(&store.get(STATUS_LIST_KEY).unwrap().unwrap()).unwrap();
        assert_eq!((back[0]["id"].as_str(), back[0]["color"].as_str()), (Some("ideas"), Some("#f00")));
        assert_eq!(back[1]["id"], "ideas-2");
        assert!(back[1].get("color").is_none(), "{back}");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row927_a_new_row_never_takes_the_id_a_later_row_keeps() {
        let dir = temp("r927a");
        let store = Store::open(&dir).unwrap();
        store.set(STATUS_LIST_KEY, r##"[{"id":"todo","label":"To do"},{"id":"done","label":"Done","color":"#0f0"}]"##).unwrap();
        let out = set_statuses(&store, &[(Some("todo".into()), "To do".into()), (None, "Done".into()), (Some("done".into()), "Done".into())]).unwrap();
        assert_eq!(out.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["todo", "done-2", "done"]);
        let back: serde_json::Value = serde_json::from_str(&store.get(STATUS_LIST_KEY).unwrap().unwrap()).unwrap();
        assert_eq!(back[2]["color"], "#0f0", "the real Done keeps its id and its unknown fields");
        assert!(back[1].get("color").is_none(), "{back}");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row927_b_a_duplicate_id_gets_base_and_base_2_and_only_the_first_keeps_its_fields() {
        let dir = temp("r927b");
        let store = Store::open(&dir).unwrap();
        store.set(STATUS_LIST_KEY, r##"[{"id":"a","label":"A","color":"#f00"}]"##).unwrap();
        let out = set_statuses(&store, &[(Some("a".into()), "A".into()), (Some("a".into()), "A again".into())]).unwrap();
        assert_eq!(out.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["a", "a-2"]);
        assert!(out[0].rest.contains_key("color") && out[1].rest.is_empty());
        // A duplicate's suffix also steps over an id a later row keeps.
        let out = set_statuses(&store, &[(Some("a".into()), "A".into()), (Some("a".into()), "A again".into()), (Some("a-2".into()), "Two".into())]).unwrap();
        assert_eq!(out.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["a", "a-3", "a-2"]);
        assert!(out[1].rest.is_empty(), "the duplicate a-3 takes no stored fields");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row919_a_status_keeps_the_fields_this_version_does_not_know_when_the_list_is_saved_again() {
        let dir = temp("row919");
        let store = Store::open(&dir).unwrap();
        store.set(STATUS_LIST_KEY, r##"[{"id":"ideas","label":"Ideas","color":"#f00"},{"id":"done","label":"Done"}]"##).unwrap();
        set_statuses(&store, &[(Some("ideas".into()), "Ideas!".into()), (Some("done".into()), "Done".into())]).unwrap();
        let back: serde_json::Value = serde_json::from_str(&store.get(STATUS_LIST_KEY).unwrap().unwrap()).unwrap();
        assert_eq!(back[0]["label"], "Ideas!");
        assert_eq!(back[0]["color"], "#f00", "the unknown field survived the save");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }
}
