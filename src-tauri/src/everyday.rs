// The Everyday folder (plan v6, 2026-11-19): one plain folder above the project list for daily asks.
//
// It is an ordinary folder project (no Git, so nothing is committed or merged) at
// `<home>\Kolux\Everyday`. Chats started there get `GIT_CEILING_DIRECTORIES` from
// `claude_shared::everyday_env`, so a repository above the folder stays invisible to git. The folder
// is made on the first New chat, never at start-up, and `project_remove` refuses it: the user's files
// stay even when every other project can be taken out of Kolux.
use crate::projects::Project;
use crate::state::Store;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// The folder's name on disk and in the sidebar.
pub const FOLDER_NAME: &str = "Everyday";

/// The user's home, the way the rest of the app reads it (`USERPROFILE`, then `HOME`).
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// `<home>\Kolux\Everyday`, or None when the home folder cannot be found.
pub fn path() -> Option<PathBuf> {
    home().map(|h| h.join("Kolux").join(FOLDER_NAME))
}

/// Whether `folder` is the Everyday folder. Used by `project_remove` and by the chat engine's fence.
pub fn is_everyday(folder: &Path) -> bool {
    path().is_some_and(|p| crate::projects::same_folder(&p, folder))
}

/// Makes `dir` (when missing) and adds it as a folder project. The same folder again is the same
/// project, because `folder_projects::add_folder` hands an existing one back.
pub fn open_at(store: &Store, dir: &Path) -> Result<Project, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("The Everyday folder could not be made: {e}"))?;
    crate::folder_projects::add_folder(store, dir)
}

/// Makes the everyday folder when it is missing and returns its project.
pub fn open(store: &Store) -> Result<Project, String> {
    let dir = path().ok_or("Kolux could not find your home folder, so the Everyday folder cannot be made.")?;
    open_at(store, &dir)
}

/// The path the sidebar uses to draw the Everyday row before the folder exists. Reading only.
#[tauri::command]
pub fn everyday_path() -> Option<String> {
    path().map(|p| p.display().to_string())
}

/// New chat on the Everyday row: make the folder if needed, then hand back its project.
#[tauri::command(async)]
pub fn everyday_open(store: State<'_, Mutex<Store>>) -> Result<Project, String> {
    open(&*store.lock().map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_path_is_under_the_users_home_and_named_everyday() {
        let p = path().expect("a test machine has a home folder");
        assert!(p.ends_with(Path::new("Kolux").join(FOLDER_NAME)));
        assert!(is_everyday(&p), "the path names itself");
        assert!(!is_everyday(Path::new(r"C:\somewhere\else")), "another folder is not the Everyday folder");
    }

    #[test]
    fn open_at_makes_the_folder_and_hands_back_the_same_project_twice() {
        let base = crate::test_dir::temp("everyday-open");
        let store = crate::state::Store::open(&base.join("db")).unwrap();
        let dir = base.join(FOLDER_NAME);
        let a = open_at(&store, &dir).unwrap();
        assert!(dir.is_dir(), "the folder is made");
        assert_eq!(a.name, FOLDER_NAME);
        assert!(!dir.join(".git").exists(), "no Git repository is made");
        let b = open_at(&store, &dir).unwrap();
        assert_eq!(a.id, b.id, "a second New chat is the same project");
        assert_eq!(crate::projects::load_projects(&store).len(), 1, "one project, not two");
    }
}
