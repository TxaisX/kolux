// Session history: where each agent keeps its past sessions for a workspace folder.
//
// PROJ-087 (T-273): Claude Code keeps one history folder per working folder under its config
// folder's `projects` folder, named after the folder path with every character that is not a letter
// or digit turned into `-`. On Windows the key is built from the path as the system reported it:
// backslashes become forward slashes first and the drive letter keeps its reported case, so
// `c:\work\app` and `C:\work\app` give `c--work-app` and `C--work-app`. When the exact name is not
// there (the drive letter reported the other way round, or a case-sensitive disk), the folder whose
// name matches ignoring case is used, so a workspace's sessions are found either way.

/// VIEW-083 / VIEW-085 / VIEW-091 (T-169): the multi-agent session list and the resume plan. Declared
/// here so the shared module list in lib.rs is untouched.
#[path = "session_list.rs"]
pub mod list;
/// VIEW-090 / VIEW-092 (T-276): scan reports, the on-disk summary cache, scan budgets and WSL rules.
#[path = "session_scan.rs"]
pub mod scan;
/// VIEW 089 (T-153-d): delete, reveal or open a past session's files.
#[path = "session_files.rs"]
pub mod files;

use std::fs;
use std::path::{Path, PathBuf};

/// PROJ-087: the folder key for a workspace path as the system reported it: the `\\?\` long-path
/// prefix dropped, forward slashes, the drive letter's case untouched, no trailing slash (a drive
/// root keeps its one slash).
pub fn folder_key(path: &str) -> String {
    let p = path.strip_prefix(r"\\?\").unwrap_or(path).replace('\\', "/");
    let trimmed = p.trim_end_matches('/');
    if trimmed.is_empty() || trimmed.ends_with(':') {
        format!("{trimmed}/")
    } else {
        trimmed.to_string()
    }
}

/// The name of Claude's history folder for a folder key: every character that is not an ASCII
/// letter or digit becomes `-`.
pub fn claude_folder_name(key: &str) -> String {
    key.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// The workspace's history folder under `projects` (Claude's config folder joined with
/// `projects`), or None when it has none yet. The exact name first, then a case-insensitive match.
pub fn claude_history_dir(projects: &Path, workspace: &str) -> Option<PathBuf> {
    let name = claude_folder_name(&folder_key(workspace));
    let exact = projects.join(&name);
    let names: Vec<String> = fs::read_dir(projects).ok()?.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    if names.contains(&name) {
        return Some(exact);
    }
    names.iter().find(|n| n.eq_ignore_ascii_case(&name)).map(|n| projects.join(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-sessions-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn proj087_the_key_uses_forward_slashes_and_keeps_the_drive_letter_as_reported() {
        assert_eq!(folder_key(r"C:\work\my app"), "C:/work/my app");
        assert_eq!(folder_key(r"c:\work\my app\"), "c:/work/my app", "lower case stays lower, the trailing slash goes");
        assert_eq!(folder_key(r"\\?\D:\deep\path"), "D:/deep/path");
        assert_eq!(folder_key(r"E:\"), "E:/");
        assert_eq!(folder_key("/home/me/app"), "/home/me/app");
        assert_eq!(claude_folder_name(&folder_key(r"C:\work\my app.v2")), "C--work-my-app-v2");
        assert_eq!(claude_folder_name(&folder_key(r"c:\work\my_app")), "c--work-my-app");
        assert_eq!(claude_folder_name(&folder_key(r"C:\Users\Zoë\x")), "C--Users-Zo--x", "a non-ASCII letter is a dash too");
    }

    #[test]
    fn proj087_a_lower_case_drive_letter_still_finds_the_sessions() {
        let root = tmp("case");
        fs::create_dir_all(root.join("C--work-app")).unwrap();
        fs::write(root.join("C--work-app").join("s1.jsonl"), "{}\n").unwrap();
        assert_eq!(claude_history_dir(&root, r"c:\work\app").unwrap().file_name().unwrap(), "C--work-app", "the system reported c:, Claude wrote C--");
        assert!(claude_history_dir(&root, r"C:\work\none").is_none(), "no history folder is none");
        // Both spellings on a case-sensitive disk: the exact one wins.
        if fs::create_dir_all(root.join("c--work-app")).is_ok() && fs::read_dir(&root).unwrap().count() == 2 {
            assert_eq!(claude_history_dir(&root, r"c:\work\app").unwrap().file_name().unwrap(), "c--work-app");
        }
        let _ = fs::remove_dir_all(&root);
    }
}
