//! PROJ-014 and PROJ-015: project groups. A group has a name and may sit inside another group;
//! projects are put into groups by id. Kept in the store, so groups last across restarts.
use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Groups {
    #[serde(default)]
    pub groups: Vec<Group>,
    /// project id -> group id
    #[serde(default)]
    pub members: BTreeMap<String, String>,
    /// Counts every change, so the sidebar keeps the newer of two answers that cross.
    #[serde(default)]
    pub rev: u64,
    /// Row 887: fields a newer build wrote, carried through a save. Flatten also makes a non-object
    /// blob (`[]`) a decode failure, so it is kept aside, not read as empty.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

const KEY: &str = "projectGroups";
pub const DEFAULT_NAME: &str = "New group";

pub fn load(store: &Store) -> Groups {
    crate::orchestration::kept::or_default(store, KEY)
}

fn named(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() { DEFAULT_NAME.to_string() } else { name.to_string() }
}

impl Groups {
    fn has(&self, id: &str) -> bool {
        self.groups.iter().any(|g| g.id == id)
    }

    fn known(&self, id: Option<&str>) -> Result<(), String> {
        match id {
            Some(id) if !self.has(id) => Err(format!("there is no group {id}; it may have been deleted")),
            _ => Ok(()),
        }
    }

    /// `id` and every group inside it, at any depth.
    fn subtree(&self, id: &str) -> Vec<String> {
        let mut out = vec![id.to_string()];
        let mut i = 0;
        while i < out.len() {
            let at = out[i].clone();
            out.extend(self.groups.iter().filter(|g| g.parent.as_deref() == Some(at.as_str())).map(|g| g.id.clone()));
            i += 1;
        }
        out
    }

    pub fn create(&mut self, name: &str, parent: Option<&str>) -> Result<Group, String> {
        self.known(parent)?;
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let mut n = 0;
        let id = loop {
            let id = format!("g{nanos}{}", if n == 0 { String::new() } else { format!("-{n}") });
            if !self.has(&id) {
                break id;
            }
            n += 1;
        };
        let group = Group { id, name: named(name), parent: parent.map(str::to_string) };
        self.groups.push(group.clone());
        Ok(group)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        self.known(Some(id))?;
        self.groups.iter_mut().filter(|g| g.id == id).for_each(|g| g.name = named(name));
        Ok(())
    }

    /// Moves group `id` inside `parent` (or to the top level); never inside itself.
    pub fn nest(&mut self, id: &str, parent: Option<&str>) -> Result<(), String> {
        self.known(Some(id))?;
        self.known(parent)?;
        if parent.is_some_and(|p| self.subtree(id).iter().any(|s| s == p)) {
            return Err("a group cannot go inside itself or one of its own sub-groups".into());
        }
        self.groups.iter_mut().filter(|g| g.id == id).for_each(|g| g.parent = parent.map(str::to_string));
        Ok(())
    }

    /// Puts a project into a group, or back at the top level with `None`.
    pub fn put(&mut self, project: &str, group: Option<&str>) -> Result<(), String> {
        self.known(group)?;
        match group {
            Some(g) => self.members.insert(project.to_string(), g.to_string()),
            None => self.members.remove(project),
        };
        Ok(())
    }

    /// PROJ-015: deletes a group and its sub-groups. Their projects move to the top level, or,
    /// with `remove_projects`, are returned for removal from Kolux.
    pub fn delete(&mut self, id: &str, remove_projects: bool) -> Result<Vec<String>, String> {
        self.known(Some(id))?;
        let gone = self.subtree(id);
        self.groups.retain(|g| !gone.contains(&g.id));
        let inside: Vec<String> = self.members.iter().filter(|(_, g)| gone.contains(g)).map(|(p, _)| p.clone()).collect();
        self.members.retain(|_, g| !gone.contains(g));
        Ok(if remove_projects { inside } else { vec![] })
    }
}

/// Loads, changes and saves the groups in one go, counting the change.
pub fn change<T>(store: &Store, f: impl FnOnce(&mut Groups) -> Result<T, String>) -> Result<(Groups, T), String> {
    // Card 13: a store or copy that fails is an error, never an empty set saved over the blob.
    let mut groups: Groups = crate::orchestration::kept::load(store, KEY)?;
    let out = f(&mut groups)?;
    groups.rev += 1;
    store.set(KEY, &serde_json::to_string(&groups).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok((groups, out))
}

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

fn with<T>(store: StoreState<'_>, f: impl FnOnce(&mut Groups) -> Result<T, String>) -> Result<Groups, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    change(&store, f).map(|(g, _)| g)
}

#[tauri::command]
pub fn groups_get(store: StoreState<'_>) -> Result<Groups, String> {
    Ok(load(&*store.lock().map_err(|e| e.to_string())?))
}

/// The new group is the last one in the list that comes back.
#[tauri::command]
pub fn group_create(store: StoreState<'_>, name: String, parent: Option<String>) -> Result<Groups, String> {
    with(store, |g| g.create(&name, parent.as_deref()))
}

#[tauri::command]
pub fn group_rename(store: StoreState<'_>, id: String, name: String) -> Result<Groups, String> {
    with(store, |g| g.rename(&id, &name))
}

#[tauri::command]
pub fn group_nest(store: StoreState<'_>, id: String, parent: Option<String>) -> Result<Groups, String> {
    with(store, |g| g.nest(&id, parent.as_deref()))
}

#[tauri::command]
pub fn group_put(store: StoreState<'_>, project_id: String, group: Option<String>) -> Result<Groups, String> {
    with(store, |g| g.put(&project_id, group.as_deref()))
}

/// PROJ-015: removing the projects takes them out of Kolux only; their folders stay on disk.
/// F21: like `project_remove`, each removed project's terminals end first.
#[tauri::command(async)]
pub fn group_delete(
    git: tauri::State<'_, crate::git::Git>,
    store: StoreState<'_>,
    terminals: tauri::State<'_, crate::terminal::Terminals>,
    id: String,
    remove_projects: bool,
) -> Result<Groups, String> {
    delete_with(&git, &store, &id, remove_projects, |d| terminals.kill_under(d).ended)
}

/// Deletes the group; with `remove_projects`, ends each removed project's terminals through
/// `folder_projects::end_sessions` (Git and the kills run with the store let go), then forgets them.
fn delete_with(git: &crate::git::Git, store: &Mutex<Store>, id: &str, remove_projects: bool, mut kill: impl FnMut(&std::path::Path) -> usize) -> Result<Groups, String> {
    let (groups, removed, going) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let (groups, removed) = change(&store, |g| g.delete(id, remove_projects))?;
        let going: Vec<_> = removed
            .iter()
            .filter_map(|p| crate::projects::find_project(&store, p).ok())
            .map(|p| {
                let folder = crate::folder_projects::is_folder(&store, &p.id);
                (p, folder)
            })
            .collect();
        (groups, removed, going)
    };
    if removed.is_empty() {
        return Ok(groups);
    }
    for (project, folder) in &going {
        crate::folder_projects::end_sessions(git, project, *folder, &mut kill);
    }
    crate::projects::forget_projects(&*store.lock().map_err(|e| e.to_string())?, &removed)?;
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-groups-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (Store::open(&dir).unwrap(), dir)
    }

    #[test]
    fn row193_unreadable_groups_survive_the_next_change() {
        let (s, dir) = store("aside");
        let broken = "{\"groups\": [{\"id\": \"g-1\", \"name\": \"Work\"";
        s.set(KEY, broken).unwrap();
        change(&s, |g| g.create("Fresh", None)).unwrap();
        assert_eq!(crate::orchestration::kept::asides(&s, KEY), vec![broken.to_string()], "the original bytes are kept aside");
        assert_eq!(load(&s).groups.len(), 1);
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row887_groups_from_a_newer_build_keep_their_unknown_fields_through_a_change() {
        let (s, dir) = store("newer");
        let blob = r#"{"groups":[{"id":"g-1","name":"Work","color":"red"}],"members":{"p-1":"g-1"},"rev":3,"future":{"a":[1,2]}}"#;
        s.set(KEY, blob).unwrap();
        change(&s, |g| g.create("Fresh", None)).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&s.get(KEY).unwrap().unwrap()).unwrap();
        assert_eq!(saved["future"], serde_json::json!({ "a": [1, 2] }), "the unknown top-level field survives the save");
        assert_eq!(saved["rev"], 4);
        assert!(crate::orchestration::kept::asides(&s, KEY).is_empty(), "a readable newer blob is not kept aside");
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row887_a_groups_blob_of_the_wrong_type_is_kept_aside_never_read_as_empty() {
        for (i, blob) in ["[]", "\"x\"", "7", "[1,2]", "true"].into_iter().enumerate() {
            let (s, dir) = store(&format!("wrongtype{i}"));
            s.set(KEY, blob).unwrap();
            change(&s, |g| g.create("Fresh", None)).unwrap();
            assert_eq!(crate::orchestration::kept::asides(&s, KEY), vec![blob.to_string()], "{blob}: a byte-identical copy is kept");
            assert_eq!(load(&s).groups.len(), 1, "{blob}: the change started from a fresh set");
            drop(s);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn card13_groups_are_not_saved_over_a_blob_that_could_not_be_kept_aside() {
        let (s, dir) = store("nocopy");
        let broken = "{\"groups\": [{\"id\": \"g-1\", \"name\": \"Work\"";
        s.set(KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let err = change(&s, |g| g.create("Fresh", None)).unwrap_err();
        assert!(err.contains(KEY) && !err.contains("Work"), "{err}");
        assert_eq!(s.get(KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card16b_a_failed_read_only_load_does_not_block_the_groups_writer() {
        let (s, dir) = store("readonly");
        s.set(KEY, "{\"groups\": [], \"rev\": 4}").unwrap();
        let side = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        side.execute_batch("ALTER TABLE kv RENAME TO kv_gone").unwrap();
        assert!(load(&s).groups.is_empty(), "the sidebar read falls back to the default");
        side.execute_batch("ALTER TABLE kv_gone RENAME TO kv").unwrap();
        let (g, _) = change(&s, |g| g.create("Work", None)).unwrap();
        assert_eq!((g.rev, g.groups.len()), (5, 1), "the next change loads, saves and counts on");
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn proj014_groups_last_across_restarts_and_an_empty_name_gets_a_default() {
        let (s, dir) = store("keep");
        let (g, made) = change(&s, |g| g.create("  ", None)).unwrap();
        assert_eq!(made.name, DEFAULT_NAME);
        assert_eq!(g.rev, 1);
        drop(s);
        let again = Store::open(&dir).unwrap();
        let back = load(&again);
        assert_eq!(back.groups, vec![made.clone()], "an empty group is still there after a restart");
        let (g, _) = change(&again, |g| g.rename(&made.id, "")).unwrap();
        assert_eq!(g.groups[0].name, DEFAULT_NAME);
        assert_eq!(g.rev, 2, "each change counts up, so an older read never wins in the sidebar");
        drop(again);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn proj014_groups_nest_without_loops_and_hold_projects() {
        let mut g = Groups::default();
        let a = g.create("Work", None).unwrap();
        let b = g.create("Clients", Some(&a.id)).unwrap();
        assert!(g.create("x", Some("missing")).is_err());
        assert!(g.nest(&a.id, Some(&b.id)).is_err(), "a group cannot go inside its own sub-group");
        assert!(g.nest(&a.id, Some(&a.id)).is_err());
        g.put("p1", Some(&b.id)).unwrap();
        assert_eq!(g.members.get("p1"), Some(&b.id));
        assert!(g.put("p1", Some("missing")).is_err());
        g.put("p1", None).unwrap();
        assert!(g.members.is_empty());
        g.nest(&b.id, None).unwrap();
        assert_eq!(g.groups[1].parent, None);
    }

    #[test]
    fn proj015_deleting_a_group_moves_its_projects_out_or_removes_them_sub_groups_included() {
        let mut g = Groups::default();
        let top = g.create("Top", None).unwrap();
        let sub = g.create("Sub", Some(&top.id)).unwrap();
        let other = g.create("Other", None).unwrap();
        g.put("p1", Some(&top.id)).unwrap();
        g.put("p2", Some(&sub.id)).unwrap();
        g.put("p3", Some(&other.id)).unwrap();
        let mut keep = g.clone();
        assert_eq!(keep.delete(&top.id, false).unwrap(), Vec::<String>::new());
        assert_eq!(keep.groups, vec![other.clone()]);
        assert_eq!(keep.members.len(), 1, "p1 and p2 are back at the top level");
        let mut gone = g.clone();
        let mut removed = gone.delete(&top.id, true).unwrap();
        removed.sort();
        assert_eq!(removed, vec!["p1".to_string(), "p2".to_string()]);
        assert_eq!(gone.groups, vec![other]);
        assert!(g.clone().delete("missing", false).is_err());
    }

    /// F21: "Also remove its projects" ends each removed project's terminals before it goes, through
    /// the same step `project_remove` uses; without it, nothing is ended and the projects stay.
    #[test]
    fn f21_deleting_a_group_with_its_projects_ends_their_terminals_first_and_only_theirs() {
        let (s, dir) = store("f21");
        let git = crate::git::Git::detect().unwrap();
        let folder = |n: &str| {
            let f = dir.join(n);
            std::fs::create_dir_all(&f).unwrap();
            crate::folder_projects::add_folder(&s, &f).unwrap()
        };
        let (a, b, c) = (folder("a"), folder("b"), folder("c"));
        let (top, sub) = {
            let (g, (top, sub)) = change(&s, |g| {
                let top = g.create("Top", None)?;
                let sub = g.create("Sub", Some(&top.id))?;
                g.put(&a.id, Some(&top.id))?;
                g.put(&b.id, Some(&sub.id))?;
                Ok((top, sub))
            })
            .unwrap();
            assert_eq!(g.members.len(), 2);
            (top, sub)
        };
        let store = Mutex::new(s);
        let mut ended: Vec<std::path::PathBuf> = Vec::new();
        // Without "remove its projects": nothing is ended and every project stays.
        let kept = delete_with(&git, &store, &sub.id, false, |d| {
            ended.push(d.to_path_buf());
            1
        })
        .unwrap();
        assert!(ended.is_empty(), "no terminal is ended when the projects stay");
        assert_eq!(kept.groups.len(), 1);
        assert_eq!(crate::projects::load_projects(&store.lock().unwrap()).len(), 3);
        // b is at the top level now; put it back under Top, then delete Top with its projects.
        change(&store.lock().unwrap(), |g| g.put(&b.id, Some(&top.id))).unwrap();
        let left = delete_with(&git, &store, &top.id, true, |d| {
            // The kill step runs while the projects are still known (the order project_remove uses).
            let s = store.try_lock().expect("the store is let go while terminals end");
            assert_eq!(crate::projects::load_projects(&s).len(), 3);
            ended.push(d.to_path_buf());
            1
        })
        .unwrap();
        assert!(left.groups.is_empty() && left.members.is_empty());
        let mut want = vec![std::path::PathBuf::from(&a.path), std::path::PathBuf::from(&b.path)];
        want.sort();
        ended.sort();
        assert_eq!(ended, want, "the folders of exactly the removed projects, each once");
        let s = store.into_inner().unwrap();
        let ids: Vec<String> = crate::projects::load_projects(&s).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![c.id.clone()], "only the project outside the group is left");
        assert!(dir.join("a").exists() && dir.join("b").exists(), "folders stay on disk");
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
