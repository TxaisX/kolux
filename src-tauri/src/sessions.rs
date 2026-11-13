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

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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

/// One past session found on disk: its id (the transcript's file name), when it last changed
/// (ms since 1970) and how big its transcript is. Council FIX-1: no file path goes to the window (it
/// holds the Windows user name and the config folder); a caller that needs the file resolves it on
/// this side from the workspace and the id.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PastSession {
    pub id: String,
    pub modified_ms: u64,
    pub bytes: u64,
}

/// The Claude sessions kept for a workspace, newest first. Only the top-level transcripts count;
/// subagents' files in sub-folders belong to their parent session.
pub fn claude_sessions(projects: &Path, workspace: &str) -> Vec<PastSession> {
    let Some(dir) = claude_history_dir(projects, workspace) else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<PastSession> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                return None;
            }
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            Some(PastSession { id: path.file_stem()?.to_string_lossy().into_owned(), modified_ms, bytes: meta.len() })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.id.cmp(&b.id)));
    out
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
    fn proj087_a_workspace_lists_its_own_sessions_newest_first() {
        let root = tmp("own");
        let mine = root.join("C--work-app-ws-alpha");
        let other = root.join("C--work-app");
        fs::create_dir_all(mine.join("sub")).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(mine.join("older.jsonl"), "{}\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(mine.join("newer.jsonl"), "{}\n{}\n").unwrap();
        fs::write(mine.join("notes.txt"), "x").unwrap();
        fs::write(mine.join("sub").join("agent.jsonl"), "{}\n").unwrap();
        fs::write(other.join("main.jsonl"), "{}\n").unwrap();
        let got = claude_sessions(&root, r"C:\work\app\ws\alpha");
        assert_eq!(got.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["newer", "older"]);
        assert_eq!(got[0].bytes, 6);
        assert_eq!(claude_sessions(&root, r"C:\work\app").iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["main"]);
        assert!(claude_sessions(&root, r"C:\work\none").is_empty(), "no history folder is an empty list");
        assert!(claude_sessions(&root.join("missing"), r"C:\work\app").is_empty(), "no projects folder is an empty list");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fix1_a_listed_session_carries_no_file_path() {
        let root = tmp("nopath");
        let dir = root.join("C--work-app");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("abc.jsonl"), "{}").unwrap();
        let got = claude_sessions(&root, r"C:\work\app");
        assert_eq!(got.len(), 1);
        let json = serde_json::to_value(&got[0]).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["bytes", "id", "modifiedMs"], "only the id, the time and the size go to the window");
        let text = json.to_string();
        let root_json = serde_json::to_string(&root.to_string_lossy()).unwrap();
        let root_json = root_json.trim_matches('"');
        assert!(!text.contains(root_json) && !text.contains("C--work-app") && !text.contains(".jsonl"), "no folder name or path leaks: {text}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proj087_a_lower_case_drive_letter_still_finds_the_sessions() {
        let root = tmp("case");
        fs::create_dir_all(root.join("C--work-app")).unwrap();
        fs::write(root.join("C--work-app").join("s1.jsonl"), "{}\n").unwrap();
        let got = claude_sessions(&root, r"c:\work\app");
        assert_eq!(got.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["s1"], "the system reported c:, Claude wrote C--");
        assert_eq!(claude_history_dir(&root, r"c:\work\app").unwrap().file_name().unwrap(), "C--work-app");
        // Both spellings on a case-sensitive disk: the exact one wins.
        if fs::create_dir_all(root.join("c--work-app")).is_ok() && fs::read_dir(&root).unwrap().count() == 2 {
            assert_eq!(claude_history_dir(&root, r"c:\work\app").unwrap().file_name().unwrap(), "c--work-app");
        }
        let _ = fs::remove_dir_all(&root);
    }
}
