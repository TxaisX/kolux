// PROJ-005 / PROJ-008: a folder without Git can be a project, and any project can be removed.
//
// A folder project is an ordinary entry in the project list plus its id in a second list. It has
// one workspace, the folder itself, and becomes a Git project by itself the first time Kolux sees
// a `.git` in it (Git was started there outside Kolux, for example `git init`): the id leaves the
// list and the project is listed from Git from then on. Removing a project takes it out of
// Kolux's list and clears what Kolux remembered about its path (retired suggested names, saved
// setup, cached scan results) and ends its terminals; its files are never touched.
use crate::git::{Git, Worktree};
use crate::projects::{self, Project};
use crate::state::Store;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const FOLDERS_KEY: &str = "folderProjects";

fn folder_ids(store: &Store) -> Vec<String> {
    crate::orchestration::kept::or_default(store, FOLDERS_KEY)
}

/// Card 13: the list a save starts from; a store or copy that fails is an error, never an empty list.
fn ids_to_change(store: &Store) -> Result<Vec<String>, String> {
    crate::orchestration::kept::load(store, FOLDERS_KEY)
}

fn put_ids(store: &Store, ids: &[String]) -> Result<(), String> {
    store.set(FOLDERS_KEY, &serde_json::to_string(ids).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn is_folder(store: &Store, id: &str) -> bool {
    folder_ids(store).iter().any(|i| i == id)
}

/// Drops projects from the folder list (removed, or now Git projects).
pub(crate) fn unflag(store: &Store, ids: &[String]) -> Result<(), String> {
    match unflag_write(store, ids)? {
        Some((key, json)) => store.set(&key, &json).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// The folder list `unflag` would save, or None when nothing changes. Only reads.
pub(crate) fn unflag_write(store: &Store, ids: &[String]) -> Result<Option<(String, String)>, String> {
    let before = ids_to_change(store)?;
    let kept: Vec<String> = before.iter().filter(|i| !ids.contains(i)).cloned().collect();
    if kept.len() == before.len() {
        return Ok(None);
    }
    Ok(Some((FOLDERS_KEY.to_string(), serde_json::to_string(&kept).map_err(|e| e.to_string())?)))
}

/// What Kolux remembered about this project's path: the suggested names retired in its workspaces
/// folder and its cached scan results. Run when the project is added and when it is removed, so a
/// folder added again later starts clean (the saved setup goes with `forget_projects`).
pub(crate) fn clear_traces(store: &Store, project: &Project) -> Result<(), String> {
    let place = projects::place_from(project, &store.settings());
    projects::clear_retired_scope(store, &projects::retired_scope(&place, project))?;
    store.set(&crate::bulk::space_key(&project.id), "").map_err(|e| e.to_string())
}

/// The one workspace of a folder project: the folder itself.
fn folder_worktree(project: &Project) -> Worktree {
    Worktree {
        path: project.path.clone(),
        branch: None,
        head: String::new(),
        is_main: true,
        name: None,
        parent: None,
        locked: None,
        hidden: false,
        kind: "main".into(),
        source: None,
        made_by: None,
        number: None,
        comment: None,
    }
}

/// The folder workspace of a folder project. None for a Git project, and for a folder project
/// where Git has been started since (it stops being a folder project here and is listed from Git).
pub(crate) fn folder_only(store: &Store, project: &Project) -> Option<Worktree> {
    if !is_folder(store, &project.id) {
        return None;
    }
    if Path::new(&project.path).join(".git").exists() {
        let _ = unflag(store, std::slice::from_ref(&project.id));
        return None;
    }
    Some(folder_worktree(project))
}

/// PROJ-005: adds a folder that is not in a Git repository as a project with one folder workspace.
/// One already added is handed back; a Git repository is refused (it is added the usual way).
pub fn add_folder(store: &Store, folder: &Path) -> Result<Project, String> {
    projects::plain_folder(folder)?;
    let mut list = projects::load_projects_for_write(store)?;
    if let Some(existing) = list.iter().find(|p| projects::same_folder(Path::new(&p.path), folder)) {
        return Ok(existing.clone());
    }
    let name = folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| folder.display().to_string());
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let project = Project { id: format!("{}-{stamp}", name.to_lowercase()), name, path: folder.display().to_string(), workspaces_dir: None, base: None, display_name: None };
    clear_traces(store, &project)?;
    crate::visibility::ensure(store, &list)?;
    list.insert(0, project.clone());
    projects::save_projects(store, &list)?;
    let mut ids = ids_to_change(store)?;
    ids.push(project.id.clone());
    put_ids(store, &ids)?;
    let _ = crate::activity::touch(store, &project.path);
    Ok(project)
}

/// PROJ-008: the folders whose terminals end when the project is removed: its own folder first,
/// then each worktree (those live elsewhere), none twice.
pub fn session_dirs(project: &Project, worktrees: &[String]) -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from(&project.path)];
    for w in worktrees {
        let p = PathBuf::from(w);
        if !dirs.iter().any(|d| projects::same_folder(d, &p)) {
            dirs.push(p);
        }
    }
    dirs
}

/// PROJ-008: takes the project out of Kolux and clears what was kept about its path. Its files
/// stay on disk.
pub fn remove_project(store: &Store, project_id: &str) -> Result<Project, String> {
    let project = projects::find_project(store, project_id)?;
    clear_traces(store, &project)?;
    projects::forget_projects(store, std::slice::from_ref(&project.id))?;
    Ok(project)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    pub name: String,
    pub path: String,
    /// How many terminals were ended.
    pub ended: usize,
}

#[tauri::command(async)]
pub fn project_add_folder(store: State<'_, Mutex<Store>>, path: String) -> Result<Project, String> {
    add_folder(&*store.lock().map_err(|e| e.to_string())?, Path::new(path.trim()))
}

/// PROJ-008: ends the terminals in a project's folder and each of its worktrees, before the project
/// is taken out of Kolux. `kill` ends the sessions under one folder and says how many. Git runs here,
/// so call it with the store let go; a project whose folder is gone lists nothing. Shared by
/// `project_remove` and `groups::group_delete` (F21), so both end the same folders in the same way.
/// R-02: `kill` also gets the folders to spare, asked for only when a terminal runs under the folder.
pub(crate) fn end_sessions(git: &Git, project: &Project, folder: bool, staying: &mut Staying, mut kill: impl FnMut(&Path, &mut dyn FnMut() -> Vec<PathBuf>) -> usize) -> usize {
    let worktrees: Vec<String> = if folder { Vec::new() } else { git.worktrees(Path::new(&project.path)).map(|all| all.into_iter().map(|w| w.path).collect()).unwrap_or_default() };
    session_dirs(project, &worktrees).iter().map(|d| kill(d, &mut || staying.folders(git))).sum()
}

/// R-02: the projects that stay in Kolux when others are taken out. A terminal belongs to the deepest
/// project folder or worktree that holds it, so theirs are spared. Built under the store lock; the
/// folders (one Git call per Git project, at most once) are listed later with the store let go.
pub(crate) struct Staying {
    projects: Vec<(Project, bool)>,
    folders: Option<Vec<PathBuf>>,
}

impl Staying {
    pub(crate) fn new(store: &Store, going: &[String]) -> Staying {
        let projects = projects::load_projects(store).into_iter().filter(|p| !going.contains(&p.id)).map(|p| {
            let folder = is_folder(store, &p.id);
            (p, folder)
        });
        Staying { projects: projects.collect(), folders: None }
    }

    fn folders(&mut self, git: &Git) -> Vec<PathBuf> {
        let projects = &self.projects;
        self.folders
            .get_or_insert_with(|| {
                let worktrees = |(p, folder): &(Project, bool)| if *folder { Vec::new() } else { git.worktrees(Path::new(&p.path)).map(|all| all.into_iter().map(|w| w.path).collect()).unwrap_or_default() };
                projects.iter().flat_map(|p| session_dirs(&p.0, &worktrees(p))).collect()
            })
            .clone()
    }
}

/// PROJ-008: the sidebar asks first; this ends the project's terminals and removes it.
#[tauri::command(async)]
pub fn project_remove(git: State<'_, Git>, store: State<'_, Mutex<Store>>, terminals: State<'_, crate::terminal::Terminals>, project_id: String) -> Result<Removed, String> {
    let (project, folder, mut staying) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = projects::find_project(&store, &project_id)?;
        let folder = is_folder(&store, &project.id);
        let staying = Staying::new(&store, std::slice::from_ref(&project.id));
        (project, folder, staying)
    };
    let ended = end_sessions(&git, &project, folder, &mut staying, |d, spare| terminals.kill_under_sparing(d, spare).ended);
    remove_project(&*store.lock().map_err(|e| e.to_string())?, &project.id)?;
    Ok(Removed { name: project.name, path: project.path, ended })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-folderproj-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store(base: &Path) -> Store {
        Store::open(&base.join("db")).unwrap()
    }

    #[test]
    fn proj005_a_plain_folder_becomes_a_folder_project_with_one_folder_workspace() {
        let base = temp("add");
        let store = store(&base);
        let folder = base.join("notes");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.txt"), "x").unwrap();
        let p = add_folder(&store, &folder).unwrap();
        assert_eq!(p.name, "notes");
        assert!(is_folder(&store, &p.id));
        assert_eq!(projects::load_projects(&store).len(), 1);
        let only = folder_only(&store, &p).expect("a folder project lists its folder");
        assert_eq!((only.path.as_str(), only.is_main, only.branch.is_none(), only.kind.as_str()), (p.path.as_str(), true, true, "main"));
        // the same folder again is the same project
        assert_eq!(add_folder(&store, &folder).unwrap().id, p.id);
        assert_eq!(projects::load_projects(&store).len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj005_a_git_repository_or_a_missing_folder_is_refused_and_nothing_is_added() {
        let base = temp("refuse");
        let store = store(&base);
        let repo = base.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        assert!(add_folder(&store, &repo).unwrap_err().contains("already a Git repository"));
        assert!(add_folder(&store, &base.join("nope")).unwrap_err().contains("not an existing folder"));
        assert!(add_folder(&store, Path::new("relative/dir")).unwrap_err().contains("not a full path"));
        assert!(projects::load_projects(&store).is_empty());
        assert!(folder_ids(&store).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj005_a_folder_project_becomes_a_git_project_when_git_is_started_in_it() {
        let base = temp("promote");
        let store = store(&base);
        let folder = base.join("site");
        fs::create_dir_all(&folder).unwrap();
        let p = add_folder(&store, &folder).unwrap();
        assert!(folder_only(&store, &p).is_some());
        fs::create_dir_all(folder.join(".git")).unwrap(); // `git init` outside Kolux
        assert!(folder_only(&store, &p).is_none(), "Git lists it from now on");
        assert!(!is_folder(&store, &p.id));
        assert_eq!(projects::load_projects(&store).len(), 1, "same project, not a second one");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj008_removing_a_project_clears_what_was_kept_about_its_path_and_leaves_the_files() {
        let base = temp("remove");
        let store = store(&base);
        let folder = base.join("keep");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.txt"), "x").unwrap();
        let p = add_folder(&store, &folder).unwrap();
        let place = projects::place_from(&p, &store.settings());
        let scope = projects::retired_scope(&place, &p);
        let name = crate::creatures::creature_name(&[], 1);
        projects::retire_name(&store, &scope, &name).unwrap();
        assert!(!projects::retired_names(&store, &scope).is_empty());
        store.set(&crate::bulk::space_key(&p.id), "[{\"stale\":true}]").unwrap();
        let gone = remove_project(&store, &p.id).unwrap();
        assert_eq!(gone.id, p.id);
        assert!(projects::load_projects(&store).is_empty());
        assert!(!is_folder(&store, &p.id));
        assert!(projects::retired_names(&store, &scope).is_empty(), "retired names for that folder are cleared");
        assert_eq!(store.get(&crate::bulk::space_key(&p.id)).unwrap().unwrap_or_default(), "", "cached scan results are cleared");
        assert!(folder.join("a.txt").exists(), "files stay on disk");
        assert!(remove_project(&store, &p.id).is_err(), "removing twice says the project is gone");
        // added again, it starts clean
        let again = add_folder(&store, &folder).unwrap();
        assert!(projects::retired_names(&store, &projects::retired_scope(&projects::place_from(&again, &store.settings()), &again)).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj008_a_removed_project_ends_terminals_in_its_folder_and_each_worktree_once() {
        let p = Project { id: "p".into(), name: "p".into(), path: "C:/work/p".into(), workspaces_dir: None, base: None, display_name: None };
        let dirs = session_dirs(&p, &["C:/work/p".to_string(), "C:/ws/p/a".to_string(), "C:/ws/p/a".to_string()]);
        assert_eq!(dirs, vec![PathBuf::from("C:/work/p"), PathBuf::from("C:/ws/p/a")]);
    }

    /// R-02: removing one project (what `project_remove` does) ends only its own terminals: a nested
    /// project that stays keeps its terminals, and a removed project never spares a folder of its own.
    #[test]
    fn r02_removing_a_folder_project_spares_a_nested_project_that_stays() {
        let base = temp("r02");
        let store = store(&base);
        let git = Git::detect().unwrap();
        let (outer, inner) = (base.join("outer"), base.join("outer").join("inner"));
        fs::create_dir_all(&inner).unwrap();
        let (o, i) = (add_folder(&store, &outer).unwrap(), add_folder(&store, &inner).unwrap());
        let t = crate::terminal::Terminals::default();
        for (n, f) in [(1, &outer), (2, &outer.join("other")), (3, &inner), (4, &inner.join("deep"))] {
            t.fake_session(n, &f.to_string_lossy(), None);
        }
        let mut staying = Staying::new(&store, std::slice::from_ref(&o.id));
        let ended = end_sessions(&git, &o, true, &mut staying, |d, spare| t.kill_under_sparing(d, spare).ended);
        assert_eq!(ended, 2, "outer and outer\\other end");
        let mut left: Vec<String> = t.sessions().into_iter().map(|(_, d, _)| d).collect();
        left.sort();
        assert_eq!(left, vec![inner.to_string_lossy().to_string(), inner.join("deep").to_string_lossy().to_string()]);
        // Both removed in one step: nothing is spared.
        let mut staying = Staying::new(&store, &[o.id.clone(), i.id.clone()]);
        assert_eq!(end_sessions(&git, &o, true, &mut staying, |d, spare| t.kill_under_sparing(d, spare).ended), 2);
        drop(store);
        fs::remove_dir_all(&base).unwrap();
    }

    /// R-02: a Git project that stays and has a worktree inside a removed folder keeps that
    /// worktree's terminals. Its repository and worktree are made here, with local settings only.
    #[test]
    fn r02_a_staying_git_projects_worktree_under_a_removed_folder_is_spared() {
        let base = temp("r02git");
        let store = store(&base);
        let git = Git::detect().unwrap();
        let (outer, repo) = (base.join("outer"), base.join("repo"));
        fs::create_dir_all(&outer).unwrap();
        fs::create_dir_all(&repo).unwrap();
        let o = add_folder(&store, &outer).unwrap();
        let run = |args: &[&str]| crate::git::run(args, Some(&repo)).unwrap();
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "test@example.invalid"]);
        run(&["config", "user.name", "Kolux test"]);
        fs::write(repo.join("a.txt"), "a").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "first"]);
        let wt = outer.join("wt");
        run(&["worktree", "add", "-q", "-b", "r02-wt", &wt.to_string_lossy()]);
        let mut list = projects::load_projects_for_write(&store).unwrap();
        list.push(Project { id: "r02-repo".into(), name: "repo".into(), path: repo.display().to_string(), workspaces_dir: None, base: None, display_name: None });
        projects::save_projects(&store, &list).unwrap();
        let t = crate::terminal::Terminals::default();
        for (n, f) in [(1, &outer), (2, &wt), (3, &wt.join("src"))] {
            t.fake_session(n, &f.to_string_lossy(), None);
        }
        let mut staying = Staying::new(&store, std::slice::from_ref(&o.id));
        assert_eq!(end_sessions(&git, &o, true, &mut staying, |d, spare| t.kill_under_sparing(d, spare).ended), 1, "only outer's own terminal ends");
        assert_eq!(t.sessions().len(), 2, "the worktree's two stay");
        drop(store);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn row895_adding_a_folder_refuses_rather_than_wiping_an_unreadable_project_list() {
        let base = temp("row895");
        let store = store(&base);
        let list = r#"[{"id":"keep-1","name":"keep","path":"C:/keep"},{"id":"ke"#;
        store.set("projects", list).unwrap();
        crate::orchestration::kept::refuse_copies(&base.join("db"));
        let folder = base.join("notes");
        fs::create_dir_all(&folder).unwrap();
        let err = add_folder(&store, &folder).unwrap_err();
        assert!(err.contains("projects could not be kept aside"), "{err}");
        assert_eq!(store.get("projects").unwrap().as_deref(), Some(list), "no one-project list replaced it");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn card13_a_folder_list_that_could_not_be_kept_aside_is_never_saved_over() {
        let base = temp("c13");
        let store = store(&base);
        let broken = "[\"p-1\", \"p-2\"";
        store.set(FOLDERS_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&base.join("db"));
        let folder = base.join("notes");
        fs::create_dir_all(&folder).unwrap();
        let err = add_folder(&store, &folder).unwrap_err();
        assert!(err.contains(FOLDERS_KEY) && !err.contains("p-1"), "{err}");
        assert!(unflag(&store, &["p-1".to_string()]).is_err());
        assert_eq!(store.get(FOLDERS_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }
}
