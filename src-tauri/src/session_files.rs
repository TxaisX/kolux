// VIEW 089 (T-153-d): delete, reveal or open a past session's files. The window names a session by
// agent and id only; the paths come from the session roots, and a path that is not strictly inside
// the folder that agent keeps sessions in (a `..` hop, a link leading out) is refused.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use super::list::{find_session_exact, Roots};

/// A session's transcript and what travels with it, inside `root`.
#[derive(Debug, PartialEq)]
pub struct Located {
    pub root: PathBuf,
    pub file: PathBuf,
    /// Claude keeps a session's sub-agent runs and tool output in a folder named after its id.
    pub extra: Option<PathBuf>,
}

/// `path` as a real location strictly below `root`, or the reason it is refused. Links are refused
/// outright: a session file is never a link, and one that leads out must not be followed.
pub fn confined(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let refused = || format!("{} is not inside the sessions folder, so Kolux leaves it alone.", path.display());
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(refused());
    }
    if fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.file_type().is_symlink() {
        return Err(refused());
    }
    let (real_root, real) = (root.canonicalize().map_err(|e| format!("{}: {e}", root.display()))?, path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?);
    if real == real_root || !real.starts_with(&real_root) {
        return Err(refused());
    }
    Ok(real)
}

/// The folders an agent's sessions live in.
fn session_dirs(roots: &Roots, agent: &str) -> Vec<PathBuf> {
    match agent {
        "claude" | "openclaude" => roots.claude.iter().map(|c| c.join("projects")).collect(),
        "codex" => roots.codex.iter().flat_map(|h| [h.join("sessions"), h.join("archived_sessions")]).collect(),
        _ => Vec::new(),
    }
}

/// Where session `id` of `agent` is on disk, every path checked against its sessions folder.
pub fn locate(roots: &Roots, agent: &str, id: &str) -> Result<Located, String> {
    if !crate::agents::safe_session(id) {
        return Err("That session's name cannot be used to find its files.".into());
    }
    let (file, _) = find_session_exact(roots, agent, id)?;
    let root = session_dirs(roots, agent).into_iter().find(|d| file.starts_with(d)).ok_or("That session is not in a folder Kolux manages.")?;
    let file = confined(&root, &file)?;
    let extra = (agent != "codex").then(|| file.with_file_name(id)).filter(|d| d.is_dir()).map(|d| confined(&root, &d)).transpose()?;
    Ok(Located { root, file, extra })
}

/// Removes exactly these paths. Every path is checked before the first is touched, so a refused one
/// leaves the rest in place; each is checked again right before its own removal, in case the disk
/// changed in between. Answers how many were removed; an error names what was already gone.
pub fn delete_all(root: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    let real: Vec<PathBuf> = paths.iter().map(|p| confined(root, p)).collect::<Result<_, _>>()?;
    let mut removed: Vec<String> = Vec::new();
    for p in &real {
        let step = confined(root, p).and_then(|now| {
            let gone = if now.is_dir() { fs::remove_dir_all(&now) } else { fs::remove_file(&now) };
            gone.map_err(|e| format!("could not delete {}: {e}", now.display()))
        });
        if let Err(e) = step {
            let done = if removed.is_empty() { "nothing was removed".to_string() } else { format!("already removed: {}", removed.join(", ")) };
            return Err(format!("{e} ({done})"));
        }
        removed.push(p.display().to_string());
    }
    Ok(real.len())
}

/// Stricter than resume's name check, because a name here becomes a folder to delete: letters,
/// digits, `_`, `.`, `-` only (no `:` that names a stream or drive), and no trailing dot.
fn safe_delete_id(id: &str) -> bool {
    crate::agents::safe_session(id) && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')) && !id.ends_with('.')
}

/// Deletes session `id` of `agent` with no pane holding it: the tests' entry point (the command always
/// passes the window's open list, so this is not reachable from the app).
#[cfg(test)]
pub fn delete(roots: &Roots, agent: &str, id: &str) -> Result<usize, String> {
    delete_with_open(roots, agent, id, &[])
}

/// C28-R5-01: `open` is the (agent, session) pairs the window has open in a pane. A pane resumed from
/// History records its id at once, so the delete is refused before any hook has named the transcript
/// (and forever for an agent whose hooks are not installed). `transcript_live` stays: this is additive.
pub fn delete_with_open(roots: &Roots, agent: &str, id: &str, open: &[(String, String)]) -> Result<usize, String> {
    if !safe_delete_id(id) {
        return Err("That session's name cannot be used to delete its files.".into());
    }
    let at = locate(roots, agent, id)?;
    // T-722: the files of a session an open pane is still running are never deleted under it.
    // (A pane resuming it in the moment between this check and the delete is not caught.)
    if open.iter().any(|(a, s)| a == agent && s == id) || crate::status::transcript_live(&at.file, at.extra.as_deref()) {
        return Err("This session is still open in a pane. Close that pane, then delete the session.".into());
    }
    let all: Vec<PathBuf> = at.extra.into_iter().chain([at.file]).collect();
    delete_all(&at.root, &all)
}

fn roots_now(store: &Mutex<crate::state::Store>) -> Result<Roots, String> {
    Ok(super::list::live_roots(&store.lock().map_err(|e| e.to_string())?.settings()))
}

/// The session's own transcript file, found and checked off the window's thread.
async fn file_of(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String) -> Result<PathBuf, String> {
    let roots = roots_now(&store)?;
    tauri::async_runtime::spawn_blocking(move || locate(&roots, &agent, &id).map(|l| l.file)).await.map_err(|e| e.to_string())?
}

/// The Delete button, after the window has asked "are you sure". Answers how many items went.
/// C28-R5-01: `open` is the sessions the window's panes hold; a session among them is refused.
#[tauri::command]
pub async fn session_delete(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String, open: Option<Vec<(String, String)>>) -> Result<usize, String> {
    let roots = roots_now(&store)?;
    let open = open.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || delete_with_open(&roots, &agent, &id, &open)).await.map_err(|e| e.to_string())?
}

/// Show the session's transcript in the file manager (the same door a file link uses).
#[tauri::command]
pub async fn session_reveal(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String) -> Result<(), String> {
    let file = file_of(store, agent, id).await?;
    crate::links::reveal(&file)
}

/// Open the session's transcript in the system's own program for it.
#[tauri::command]
pub async fn session_open(store: tauri::State<'_, Mutex<crate::state::Store>>, agent: String, id: String) -> Result<(), String> {
    let file = file_of(store, agent, id).await?;
    crate::artifacts::system_open(&file.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-sessfiles-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    const USER: &str = "{\"type\":\"user\",\"cwd\":\"/w\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n";

    fn claude_roots(root: &Path) -> Roots {
        Roots { claude: vec![root.to_path_buf()], codex: vec![] }
    }

    #[test]
    fn c28r501_a_resumed_pane_holds_a_session_before_any_hook_reports() {
        let root = tmp("resumed");
        let dir = root.join("projects").join("C--w");
        put(&dir.join("run.jsonl"), USER);
        put(&dir.join("run").join("subagents").join("agent-1.jsonl"), USER);
        let roots = claude_roots(&root);
        // No report() for any pane: the agent's first hook has not landed yet.
        let open = [("claude".to_string(), "run".to_string())];
        let err = delete_with_open(&roots, "claude", "run", &open).unwrap_err();
        assert!(err.contains("still open in a pane"), "{err}");
        assert!(dir.join("run.jsonl").exists() && dir.join("run").exists(), "nothing went");
        // Another agent's pane holding the same id text does not block this one.
        let other = [("codex".to_string(), "run".to_string())];
        assert_eq!(delete_with_open(&roots, "claude", "run", &other), Ok(2), "a codex pane is not this session's");
        // The guard is additive to transcript_live, never a replacement: with no pane and no report it goes.
        put(&dir.join("idle.jsonl"), USER);
        assert_eq!(delete_with_open(&roots, "claude", "idle", &[]), Ok(1), "no pane says it is open, so it goes");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view089_delete_removes_one_session_and_its_folder_and_leaves_the_neighbours() {
        let root = tmp("one");
        let dir = root.join("projects").join("C--w");
        put(&dir.join("aaa.jsonl"), USER);
        put(&dir.join("bbb.jsonl"), USER);
        put(&dir.join("aaa").join("subagents").join("agent-1.jsonl"), USER);
        put(&dir.join("bbb").join("tool-results").join("t.txt"), "x");
        put(&dir.join("agent-9.jsonl"), USER);
        let roots = claude_roots(&root);
        assert_eq!(delete(&roots, "claude", "aaa"), Ok(2), "the transcript and the folder of the same name");
        assert!(!dir.join("aaa.jsonl").exists() && !dir.join("aaa").exists());
        for kept in ["bbb.jsonl", "bbb/tool-results/t.txt", "agent-9.jsonl"] {
            assert!(dir.join(kept).exists(), "{kept} is another session's and stays");
        }
        assert!(delete(&roots, "claude", "aaa").unwrap_err().contains("no longer"), "a second delete finds nothing");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn t722_a_session_an_open_pane_is_running_is_not_deleted_until_its_terminal_ends() {
        use crate::status::{report, terminal_ended, Agent};
        const PANE: u32 = 722_001;
        const TERM: u32 = 722_002;
        let root = tmp("live");
        let dir = root.join("projects").join("C--w");
        put(&dir.join("run.jsonl"), USER);
        put(&dir.join("run").join("subagents").join("agent-1.jsonl"), USER);
        put(&dir.join("idle.jsonl"), USER);
        let roots = claude_roots(&root);
        // The hooks name the transcript with forward slashes and, on Windows, in another case.
        let mut said = dir.join("run.jsonl").to_string_lossy().replace('\\', "/");
        if cfg!(windows) {
            said = said.to_uppercase();
        }
        report(PANE, Some(TERM), Agent::Claude, &serde_json::json!({ "hook_event_name": "SessionStart", "transcript_path": said }));
        let err = delete(&roots, "claude", "run").unwrap_err();
        assert!(err.contains("still open in a pane"), "{err}");
        assert!(dir.join("run.jsonl").exists() && dir.join("run").exists(), "nothing went");
        assert_eq!(delete(&roots, "claude", "idle"), Ok(1), "a session no pane runs still goes");
        // A sub-agent's hook names its own transcript, inside the session's folder: still refused.
        let sub = dir.join("run").join("subagents").join("agent-1.jsonl").to_string_lossy().replace('\\', "/");
        report(PANE, Some(TERM), Agent::Claude, &serde_json::json!({ "hook_event_name": "PreToolUse", "agent_id": "x", "transcript_path": sub }));
        assert!(delete(&roots, "claude", "run").unwrap_err().contains("still open in a pane"), "a sub-agent of it runs");
        assert!(dir.join("run.jsonl").exists());
        terminal_ended(TERM);
        assert_eq!(delete(&roots, "claude", "run"), Ok(2), "the pane closed: now it goes");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn t722_a_codex_rollout_an_open_pane_is_running_is_not_deleted() {
        use crate::status::{report, terminal_ended, Agent};
        const PANE: u32 = 722_011;
        const TERM: u32 = 722_012;
        let home = tmp("livecodex");
        let f = home.join("sessions").join("2026").join("11").join("03").join("rollout-2026-11-03T10-00-00-c722.jsonl");
        put(&f, "{}\n");
        let roots = codex_roots(&home);
        report(PANE, Some(TERM), Agent::Codex, &serde_json::json!({ "hook_event_name": "SessionStart", "transcript_path": f.to_string_lossy() }));
        assert!(delete(&roots, "codex", "c722").unwrap_err().contains("still open in a pane"));
        assert!(f.exists());
        terminal_ended(TERM);
        assert_eq!(delete(&roots, "codex", "c722"), Ok(1));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view089_delete_handles_a_codex_rollout_in_either_folder() {
        let home = tmp("codex");
        let live = home.join("sessions").join("2026").join("10").join("20").join("rollout-2026-10-20T10-00-00-abc123.jsonl");
        let kept = home.join("sessions").join("2026").join("10").join("20").join("rollout-2026-10-20T11-00-00-def456.jsonl");
        let old = home.join("archived_sessions").join("rollout-2026-09-01T10-00-00-old789.jsonl");
        for f in [&live, &kept, &old] {
            put(f, "{}\n");
        }
        let roots = Roots { claude: vec![], codex: vec![home.clone()] };
        assert_eq!(delete(&roots, "codex", "abc123"), Ok(1));
        assert_eq!(delete(&roots, "codex", "old789"), Ok(1));
        assert!(!live.exists() && !old.exists() && kept.exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view089_an_outside_path_and_a_dotdot_path_are_refused_and_nothing_is_deleted() {
        let root = tmp("fence");
        let inside = root.join("projects").join("p").join("s.jsonl");
        let outside = root.join("outside.txt");
        put(&inside, USER);
        put(&outside, "keep");
        let sessions = root.join("projects");
        assert!(delete_all(&sessions, std::slice::from_ref(&outside)).unwrap_err().contains("not inside"));
        let hop = sessions.join("p").join("..").join("..").join("outside.txt");
        assert!(delete_all(&sessions, &[hop]).unwrap_err().contains("not inside"));
        assert!(delete_all(&sessions, std::slice::from_ref(&sessions)).unwrap_err().contains("not inside"), "the sessions folder itself is not a session");
        assert!(delete_all(&sessions, &[inside.clone(), outside.clone()]).is_err());
        assert!(inside.exists() && outside.exists(), "a refused path stops the whole delete before it starts");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view089_a_session_name_that_climbs_out_is_refused() {
        let root = tmp("name");
        put(&root.join("projects").join("p").join("s.jsonl"), USER);
        let roots = claude_roots(&root);
        for bad in ["..", "../s", "a/b", "a\\b", "-x", ""] {
            assert!(delete(&roots, "claude", bad).is_err(), "{bad:?}");
        }
        assert!(root.join("projects").join("p").join("s.jsonl").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view089_a_link_leading_out_of_the_sessions_folder_is_not_followed() {
        let root = tmp("link");
        let sessions = root.join("projects");
        let outside = root.join("elsewhere");
        put(&outside.join("secret.jsonl"), USER);
        fs::create_dir_all(&sessions).unwrap();
        let link = sessions.join("proj");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
        if !made {
            eprintln!("no link could be made here; the test is skipped");
            let _ = fs::remove_dir_all(&root);
            return;
        }
        let through = link.join("secret.jsonl");
        assert!(delete_all(&sessions, &[through]).is_err(), "a path through a link that leaves the folder");
        assert!(locate(&claude_roots(&root), "claude", "secret").is_err(), "a session found through such a link is not located");
        assert!(outside.join("secret.jsonl").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view089_locate_names_the_transcript_reveal_and_open_hand_over() {
        let root = tmp("locate");
        let f = root.join("projects").join("p").join("zzz.jsonl");
        put(&f, USER);
        let got = locate(&claude_roots(&root), "claude", "zzz").unwrap();
        assert_eq!(got.file, f.canonicalize().unwrap());
        assert_eq!(got.extra, None);
        assert!(locate(&claude_roots(&root), "gemini", "zzz").is_err(), "an agent whose sessions Kolux does not read");
        let _ = fs::remove_dir_all(&root);
    }


    fn codex_roots(home: &Path) -> Roots {
        Roots { claude: vec![], codex: vec![home.to_path_buf()] }
    }

    #[test]
    fn view089_deleting_b01_leaves_the_session_whose_id_only_ends_the_same_way() {
        let home = tmp("tail");
        let day = home.join("sessions").join("2026").join("10").join("20");
        let (long, short) = (day.join("rollout-2026-10-20T09-00-00-ab01.jsonl"), day.join("rollout-2026-10-20T10-00-00-b01.jsonl"));
        for f in [&long, &short] {
            put(f, "{}
");
        }
        let roots = codex_roots(&home);
        assert!(delete(&roots, "codex", "01").unwrap_err().contains("no longer"), "a tail of an id finds nothing");
        assert!(long.exists() && short.exists());
        assert_eq!(delete(&roots, "codex", "b01"), Ok(1));
        assert!(long.exists() && !short.exists(), "only the exact id went");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view089_two_files_with_one_id_delete_nothing() {
        let home = tmp("dup");
        let live = home.join("sessions").join("2026").join("10").join("20").join("rollout-2026-10-20T09-00-00-same1.jsonl");
        let old = home.join("archived_sessions").join("rollout-2026-09-01T09-00-00-same1.jsonl");
        for f in [&live, &old] {
            put(f, "{}
");
        }
        let err = delete(&codex_roots(&home), "codex", "same1").unwrap_err();
        assert!(err.contains("More than one"), "{err}");
        assert!(live.exists() && old.exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn view089_a_name_with_a_colon_or_a_trailing_dot_is_never_deleted() {
        let root = tmp("strict");
        let dir = root.join("projects").join("p");
        let keep = [dir.join("a.jsonl"), dir.join("abc.jsonl"), dir.join("a").join("t.txt")];
        for f in &keep {
            put(f, USER);
        }
        let roots = claude_roots(&root);
        for bad in ["a:b", "C:x", "abc.", "a:", "a b", "a*"] {
            let err = delete(&roots, "claude", bad).unwrap_err();
            assert!(err.contains("cannot be used"), "{bad:?}: {err}");
        }
        assert!(keep.iter().all(|f| f.exists()), "nothing was touched");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn view089_a_path_gone_before_its_turn_stops_the_delete_and_names_what_was_removed() {
        let root = tmp("race");
        let sessions = root.join("projects");
        let (folder, inner, other) = (sessions.join("p").join("one"), sessions.join("p").join("one").join("t.txt"), sessions.join("p").join("three.jsonl"));
        put(&inner, "x");
        put(&other, USER);
        // `inner` passes the up-front check, then the folder holding it is removed first.
        let err = delete_all(&sessions, &[folder.clone(), inner, other.clone()]).unwrap_err();
        assert!(err.contains("already removed") && err.contains("one"), "{err}");
        assert!(!folder.exists(), "the folder had already gone");
        assert!(other.exists(), "the delete stopped at the bad path");
        assert!(delete_all(&sessions, std::slice::from_ref(&other)).is_ok());
        let _ = fs::remove_dir_all(&root);
    }
}
