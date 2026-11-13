//! GIT-014 (T-313-b): a changed file opened in one of the apps of General settings' Open in list,
//! from the Source Control file menu. The app's command must be one the list holds (or VS Code's),
//! the worktree must sit inside a registered project or workspaces folder, and the file must be a
//! plain path inside the worktree that exists; anything else is refused before an app starts.

use std::path::{Component, Path, PathBuf};

/// The file `rel` names inside `worktree`: relative, with no `..`, drive or root part, existing,
/// and still inside the worktree once links are resolved.
pub fn file_in(worktree: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.trim().is_empty() || rel.contains('\0') || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("{rel} is not a path inside the workspace, so it was not opened"));
    }
    let full = worktree.join(rel_path);
    if !full.exists() {
        return Err(format!("{rel} no longer exists, so it was not opened"));
    }
    let (inside, root) = (full.canonicalize().map_err(|e| e.to_string())?, worktree.canonicalize().map_err(|e| e.to_string())?);
    if !inside.starts_with(&root) {
        return Err(format!("{rel} leads outside the workspace, so it was not opened"));
    }
    Ok(full)
}

/// Only VS Code's command or one saved in General settings' list may run.
pub fn command_allowed(settings: &serde_json::Value, command: &str) -> Result<String, String> {
    let c = command.trim();
    if c.is_empty() {
        return Err("no app was chosen".into());
    }
    if !crate::files::saved_command(settings, c) {
        return Err(format!("{c} is not one of the apps under General settings, so it was not run"));
    }
    Ok(c.to_string())
}

#[tauri::command]
pub async fn scm_open_with(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, worktree: String, path: String, command: String) -> Result<(), String> {
    let roots = crate::links::roots(&store);
    let settings = store.lock().map_err(|e| e.to_string())?.settings();
    tauri::async_runtime::spawn_blocking(move || {
        let command = command_allowed(&settings, &command)?;
        crate::links::fence(&worktree, &roots, &std::collections::HashSet::new(), true)?;
        let file = file_in(Path::new(&worktree), &path)?;
        crate::files::launch_in(&file, &command, std::env::var_os("PATH"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-scmopen-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn git014_only_a_plain_existing_path_inside_the_worktree_opens() {
        let wt = dir("wt");
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(wt.join("src/a.rs"), "x").unwrap();
        assert!(file_in(&wt, "src/a.rs").unwrap().ends_with("a.rs"));
        for bad in ["", "../outside.txt", "src/../../x", "/etc/passwd", "C:\\Windows\\win.ini", "src/a.rs\0"] {
            assert!(file_in(&wt, bad).unwrap_err().contains("not a path inside"), "{bad:?}");
        }
        assert!(file_in(&wt, "src/gone.rs").unwrap_err().contains("no longer exists"));
        let _ = fs::remove_dir_all(wt);
    }

    #[test]
    fn git014_only_vs_codes_command_or_a_saved_one_may_run() {
        let settings = serde_json::json!({ "openInApps": [{ "name": "Zed", "command": " zed " }] });
        assert_eq!(command_allowed(&settings, "code").unwrap(), "code");
        assert_eq!(command_allowed(&settings, "zed").unwrap(), "zed");
        assert!(command_allowed(&settings, "calc").unwrap_err().contains("not one of the apps"));
        assert!(command_allowed(&settings, "  ").unwrap_err().contains("no app was chosen"));
    }
}
