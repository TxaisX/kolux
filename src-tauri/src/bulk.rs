//! T-218: the workspace pieces around sorting many (PROJ-076 forget a workspace locally, PROJ-083
//! what a folder costs on disk, PROJ-084 the status workflow). The sizing and status rules are pure
//! or take a store, so tests prove them; the commands are thin.

use crate::projects::{find_project, name_key, Project};
use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

type StoreState<'a> = State<'a, Mutex<Store>>;

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
    Some(crate::state::kept::or_default_held::<Vec<Status>>(store, STATUS_LIST_KEY)).filter(|l| !l.is_empty()).unwrap_or_else(default_statuses)
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
    let old: Vec<Status> = crate::state::kept::load(store, STATUS_LIST_KEY)?;
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
    crate::state::kept::or_default(store, STATUS_OF_KEY)
}

/// Card 13: the map a save starts from; a store or copy that fails is an error, never an empty map.
fn status_map_to_change(store: &Store) -> Result<HashMap<String, String>, String> {
    crate::state::kept::load(store, STATUS_OF_KEY)
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

// ---- PROJ-083: what a folder costs on disk ------------------------------------------------------------

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

/// The store key the Space table kept its last scan under; a removed project's is cleared.
pub(crate) fn space_key(project_id: &str) -> String {
    format!("spaceScan:{project_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-bulk-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
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
    fn card13_a_status_map_that_could_not_be_kept_aside_is_never_saved_over() {
        let dir = temp("c13");
        let db = dir.join("db");
        let store = Store::open(&db).unwrap();
        let broken = "{\"C:/a\": \"s-1\"";
        store.set(STATUS_OF_KEY, broken).unwrap();
        crate::state::kept::refuse_copies(&db);
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
        crate::state::kept::refuse_copies(&db);
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
        crate::state::kept::refuse_copies(&db);
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
