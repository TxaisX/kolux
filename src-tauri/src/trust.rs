//! SAFE-023 / SAFE-024: a new worktree is marked trusted in the agent's own configuration before
//! the agent starts, so its first prompt is never swallowed by a folder-trust menu.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// At most this many folders per launch (SAFE-024).
pub const MAX_PER_LAUNCH: usize = 12;

/// Writes happen one after another, so no mark can be lost to a sibling's rewrite.
static WRITE: Mutex<()> = Mutex::new(());

fn home_dir() -> PathBuf {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir())
}

/// Claude Code's user configuration: `.claude.json` under `CLAUDE_CONFIG_DIR`, else the home folder.
pub fn claude_config_file() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.trim().is_empty()).map(PathBuf::from).unwrap_or_else(home_dir).join(".claude.json")
}

/// Claude's key for a folder: the real path on disk (letter case included) with forward slashes,
/// because Claude ignores an entry written with backslashes (SAFE-023).
pub fn claude_key(path: &Path) -> Result<String, String> {
    Ok(real_path(path)?.replace('\\', "/"))
}

/// The folder's real path on disk (letter case included), without the `\\?\` prefix.
pub(crate) fn real_path(path: &Path) -> Result<String, String> {
    let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    let s = real.to_string_lossy();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

/// The batch rules (SAFE-024): something to trust, at most `MAX_PER_LAUNCH`, each folder real;
/// the keys come back sorted with duplicates dropped.
fn checked_keys(paths: &[PathBuf], key: fn(&Path) -> Result<String, String>) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("no folders to trust".into());
    }
    if paths.len() > MAX_PER_LAUNCH {
        return Err(format!("at most {MAX_PER_LAUNCH} folders can be trusted per launch, not {}", paths.len()));
    }
    let mut keys = paths.iter().map(|p| key(p)).collect::<Result<Vec<_>, _>>()?;
    keys.sort();
    keys.dedup();
    Ok(keys)
}

/// Whole file at once, then a rename: a crash mid-write can never leave an agent half a file.
/// The target's bytes are read first and read again just before the rename; when the program
/// that owns the file (Claude Code rewrites .claude.json often) changed it in between, nothing is
/// replaced and the error says so. The bytes being replaced are kept once as `<name>.bak-kolux`.
pub(crate) fn write_whole(file: &Path, text: &str) -> Result<(), String> {
    let now = read_bytes(file)?;
    write_checked(file, text, now.as_deref(), || {})
}

/// `write_whole` for a caller that parsed the file first: `parsed` is the text it read (None when
/// the file was missing). The write goes ahead only while the file still holds exactly those
/// bytes, checked before the temporary file is made and again just before the rename, so a write
/// by another program that lands between the parse and the save is never overwritten.
pub(crate) fn write_parsed(file: &Path, text: &str, parsed: Option<&str>) -> Result<(), String> {
    write_checked(file, text, parsed.map(str::as_bytes), || {})
}

fn read_bytes(f: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(f) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", f.display())),
    }
}

/// The save behind both: `base` is what the file must still hold. `between` runs after the
/// temporary file and the backup are on disk, before the re-read, so a test can change the target
/// at the worst moment.
fn write_checked(file: &Path, text: &str, base: Option<&[u8]>, between: impl FnOnce()) -> Result<(), String> {
    let changed = || format!("{} was changed by another program since Kolux read it; nothing written, try again", file.display());
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    if read_bytes(file)?.as_deref() != base {
        return Err(changed());
    }
    let tmp = file.with_extension("kolux-tmp");
    let written = (|| {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", tmp.display()));
    }
    // The backup goes down before the re-read, so the gap between that check and the rename is
    // as short as it can be. When the save is then abandoned, the earlier backup is put back.
    let mut name = file.file_name().unwrap_or_default().to_os_string();
    name.push(".bak-kolux");
    let backup = file.with_file_name(name);
    let old_backup = std::fs::read(&backup).ok();
    if let Some(bytes) = base {
        if let Err(e) = std::fs::write(&backup, bytes) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("could not keep a backup at {}: {e}", backup.display()));
        }
    }
    between();
    let again = read_bytes(file);
    if !matches!(&again, Ok(now) if now.as_deref() == base) {
        let _ = std::fs::remove_file(&tmp);
        if base.is_some() {
            let _ = match &old_backup {
                Some(b) => std::fs::write(&backup, b),
                None => std::fs::remove_file(&backup),
            };
        }
        return Err(again.err().unwrap_or_else(changed));
    }
    std::fs::rename(&tmp, file).map_err(|e| format!("{}: {e}", file.display()))
}

/// Marks `paths` trusted in Claude's configuration `file` and says how many were new. A file
/// that cannot be parsed is left alone; nothing is written when every folder was trusted already.
pub fn trust_claude(file: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    let keys = checked_keys(paths, claude_key)?;
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let raw = match std::fs::read_to_string(file) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let mut doc: Value = match &raw {
        Some(text) => serde_json::from_str(text).map_err(|e| format!("{} is not valid JSON ({e}); left untouched", file.display()))?,
        None => json!({}),
    };
    if !doc.is_object() {
        return Err(format!("{} does not hold a JSON object; left untouched", file.display()));
    }
    if !doc["projects"].is_object() {
        doc["projects"] = json!({});
    }
    let mut added = 0;
    for key in &keys {
        let entry = &mut doc["projects"][key.as_str()];
        if entry["hasTrustDialogAccepted"] == json!(true) {
            continue;
        }
        if !entry.is_object() {
            *entry = json!({});
        }
        entry["hasTrustDialogAccepted"] = json!(true);
        added += 1;
    }
    if added > 0 {
        write_parsed(file, &serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?, raw.as_deref())?;
    }
    Ok(added)
}


/// Codex's configuration: `config.toml` under `CODEX_HOME`, else `~/.codex`.
pub fn codex_config_file() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".codex"))
        .join("config.toml")
}

/// Codex's key for a folder: the real path, lower-cased on Windows (what Codex itself writes
/// and looks up).
pub fn codex_key(path: &Path) -> Result<String, String> {
    let real = real_path(path)?;
    Ok(if cfg!(windows) { real.to_ascii_lowercase() } else { real })
}

/// Marks `paths` trusted in Codex's `file` (`[projects."<key>"] trust_level = "trusted"`) and
/// says how many were new; everything else in the file stays byte for byte.
pub fn trust_codex(file: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    let keys = checked_keys(paths, codex_key)?;
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let raw = match std::fs::read_to_string(file) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let mut doc: toml_edit::DocumentMut = raw.as_deref().unwrap_or("").parse().map_err(|e| format!("{} is not valid TOML ({e}); left untouched", file.display()))?;
    let fresh = !doc.contains_key("projects");
    let projects = doc.as_table_mut().entry("projects").or_insert(toml_edit::table());
    let projects = projects.as_table_mut().ok_or_else(|| format!("{}: projects is not a table; left untouched", file.display()))?;
    if fresh {
        // `[projects."key"]` headers only, the way Codex writes them, never a bare `[projects]`.
        projects.set_implicit(true);
    }
    let mut added = 0;
    for key in &keys {
        let entry = projects.entry(key).or_insert(toml_edit::table());
        let table = entry.as_table_like_mut().ok_or_else(|| format!("{}: projects.{key} is not a table; left untouched", file.display()))?;
        if table.get("trust_level").and_then(|v| v.as_str()) == Some("trusted") {
            continue;
        }
        table.insert("trust_level", toml_edit::value("trusted"));
        added += 1;
    }
    if added > 0 {
        write_parsed(file, &doc.to_string(), raw.as_deref())?;
    }
    Ok(added)
}

/// Every folder a launch will use, trusted for `agent` in one write before it starts.
/// ponytail: Claude and Codex; Cursor and Copilot keep their trust in files whose shape no public
/// source describes, so they get nothing and their own prompt stays with the user (DT-C17).
pub fn trust_folders(claude_config: &Path, agent: &str, paths: &[PathBuf]) -> Result<usize, String> {
    trust_folders_in(claude_config, &codex_config_file(), agent, paths)
}

/// `trust_folders` with Codex's file named too (tests keep it out of `CODEX_HOME`).
///
/// N-03 (T-780): a worktree inherits only an answer the user already gave. Each folder is
/// pre-trusted only when its main checkout (the repository the worktree shares its `.git` with)
/// already carries the user's trust for `agent` in that same file; a folder whose main checkout
/// the user never accepted, or that is no git worktree at all, keeps the agent's own prompt. When
/// nothing in the batch qualifies the error says which folder and why, so a caller's notice can
/// repeat it.
pub(crate) fn trust_folders_in(claude_config: &Path, codex_config: &Path, agent: &str, paths: &[PathBuf]) -> Result<usize, String> {
    let file = match agent {
        "claude" => claude_config,
        "codex" => codex_config,
        _ => return Ok(0),
    };
    if paths.len() > MAX_PER_LAUNCH {
        return Err(format!("at most {MAX_PER_LAUNCH} folders can be trusted per launch, not {}", paths.len()));
    }
    let mut allowed = Vec::with_capacity(paths.len());
    let mut refused: Option<String> = None;
    for path in paths {
        match main_checkout(path) {
            Some(main) if carries_trust(file, agent, &main) => allowed.push(path.clone()),
            Some(main) => {
                refused.get_or_insert_with(|| format!("not trusted: the main checkout {} is not trusted for {agent} yet, so its worktree {} keeps the agent's own prompt", main.display(), path.display()));
            }
            None => {
                refused.get_or_insert_with(|| format!("not trusted: {} is not a git worktree, so it keeps the agent's own prompt", path.display()));
            }
        }
    }
    if allowed.is_empty() {
        if let Some(why) = refused {
            return Err(why);
        }
    }
    match agent {
        "claude" => trust_claude(file, &allowed),
        _ => trust_codex(file, &allowed),
    }
}

/// The main checkout `worktree` belongs to: the folder holding the `.git` directory all its
/// worktrees share (the folder itself for a main checkout). None for anything that is not a git
/// worktree with a checkout, a bare repository included.
pub(crate) fn main_checkout(worktree: &Path) -> Option<PathBuf> {
    let common = crate::git::run(&["rev-parse", "--path-format=absolute", "--git-common-dir"], Some(worktree)).ok()?;
    let common = PathBuf::from(common.trim());
    if common.file_name()? != ".git" {
        return None;
    }
    // Git answers with forward slashes; the real path on disk reads as the user knows it.
    Some(PathBuf::from(real_path(common.parent()?).ok()?))
}

/// Whether `file` already holds the user's trust in `folder` for `agent`, in the shape that
/// agent itself writes; an unreadable or unparsable file carries none.
fn carries_trust(file: &Path, agent: &str, folder: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(file) else { return false };
    match agent {
        "claude" => {
            let Ok(key) = claude_key(folder) else { return false };
            serde_json::from_str::<Value>(&text).map(|doc| doc["projects"][key]["hasTrustDialogAccepted"] == json!(true)).unwrap_or(false)
        }
        "codex" => {
            let Ok(key) = codex_key(folder) else { return false };
            text.parse::<toml_edit::DocumentMut>().ok().and_then(|doc| Some(doc.get("projects")?.get(&key)?.get("trust_level")?.as_str()? == "trusted")).unwrap_or(false)
        }
        _ => false,
    }
}

/// A repository with one commit at `dir/main` and a worktree of it at `dir/wt`, for tests here and
/// in `claude_accounts`.
#[cfg(test)]
pub(crate) fn test_repo_with_worktree(dir: &Path) -> (PathBuf, PathBuf) {
    let (main, wt) = (dir.join("main"), dir.join("wt"));
    std::fs::create_dir_all(&main).unwrap();
    crate::git::run(&["init", "-q", "-b", "main"], Some(&main)).unwrap();
    crate::git::run(&["config", "user.email", "test@example.com"], Some(&main)).unwrap();
    crate::git::run(&["config", "user.name", "Kolux test"], Some(&main)).unwrap();
    std::fs::write(main.join("README.md"), "hello
").unwrap();
    crate::git::run(&["add", "."], Some(&main)).unwrap();
    crate::git::run(&["commit", "-q", "-m", "first"], Some(&main)).unwrap();
    crate::git::run(&["worktree", "add", "-q", "-b", "kolux-wt", &wt.to_string_lossy()], Some(&main)).unwrap();
    (main, wt)
}

/// SAFE-023 (T-443): the folders of `paths` that are worktrees Kolux made itself (it keeps a record
/// of each one it creates). Any other folder, the project's own main checkout included, is never
/// trusted ahead of time and keeps the agent's own trust prompt. T-780 (review finding 2): a
/// worktree whose record carries a pull request (made from one, or linked to one later) holds
/// another author's branch, so it is never pre-trusted either, whoever made the folder. Review
/// 2026-11-09: only a record that names its maker (`madeBy`, written by every Kolux creator) counts;
/// the details form and the CLI write records for any folder a user names, without one.
pub fn made_by_kolux(store: &std::sync::Mutex<crate::state::Store>, paths: &[PathBuf]) -> Vec<PathBuf> {
    let Ok(store) = store.lock() else { return Vec::new() };
    paths.iter().filter(|p| crate::projects::origin(&store, &p.to_string_lossy()).is_some_and(|o| names_its_maker(&o) && !holds_pull_request(&o))).cloned().collect()
}

/// Whether an origin record was written by a Kolux creator (a non-empty `madeBy`).
fn names_its_maker(origin: &serde_json::Value) -> bool {
    origin["madeBy"].as_str().is_some_and(|who| !who.trim().is_empty())
}

/// Whether a worktree's origin record names a pull request (`pr`), i.e. the branch checked out is
/// a pull request's, possibly from a stranger's fork; or ever did (the sticky marker
/// `projects::PR_EVER_KEY`), since unlinking the pull request does not change the branch.
fn holds_pull_request(origin: &serde_json::Value) -> bool {
    origin["pr"].as_str().is_some_and(|url| !url.trim().is_empty()) || origin[crate::projects::PR_EVER_KEY] == true
}

/// T-780: why `path` is left out of the pre-trust, for a caller's notice: it holds a pull request's
/// branch, or Kolux has no record of making it.
pub fn not_pre_trusted_why(store: &std::sync::Mutex<crate::state::Store>, path: &Path) -> &'static str {
    let holds_pr = store.lock().ok().and_then(|s| crate::projects::origin(&s, &path.to_string_lossy())).is_some_and(|o| holds_pull_request(&o));
    if holds_pr {
        "not trusted: this worktree holds a pull request's branch, so the agent asks itself"
    } else {
        "not trusted: not a worktree Kolux made, so the agent asks itself"
    }
}

/// The window's pre-trust before a launch: only the Kolux-made worktrees among `paths` are trusted.
#[tauri::command]
pub fn trust_folders_cmd(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, agent: String, paths: Vec<String>) -> Result<usize, String> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    trust_for_launch(&store, &claude_config_file(), &agent, &paths)
}

/// Row 984: the trust goes into the `.claude.json` the launching pane reads (its managed
/// account's folder), not the app's own; `process_file` is that fallback.
pub(crate) fn trust_for_launch(store: &std::sync::Mutex<crate::state::Store>, process_file: &Path, agent: &str, paths: &[PathBuf]) -> Result<usize, String> {
    let file = match store.lock() {
        Ok(s) => crate::claude_accounts::pane_config_file(&s, process_file.to_path_buf()),
        Err(_) => process_file.to_path_buf(),
    };
    trust_folders(&file, agent, &made_by_kolux(store, paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_whole_leaves_the_file_alone_when_another_program_changed_it_meanwhile() {
        let d = temp("race");
        let file = d.join(".claude.json");
        std::fs::write(&file, r#"{"before":1}"#).unwrap();
        let err = write_checked(&file, r#"{"kolux":1}"#, Some(br#"{"before":1}"#), || std::fs::write(&file, r#"{"claude":2}"#).unwrap()).unwrap_err();
        assert!(err.contains("changed by another program"), "{err}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), r#"{"claude":2}"#, "the other program's write is kept");
        assert!(!file.with_extension("kolux-tmp").exists(), "no temporary file is left behind");
        assert!(!d.join(".claude.json.bak-kolux").exists(), "nothing was replaced, so no backup");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn t441c_a_write_landing_between_the_parse_and_the_save_is_kept() {
        let d = temp("parsed");
        let file = d.join(".claude.json");
        std::fs::write(&file, r#"{"projects":{}}"#).unwrap();
        std::fs::write(d.join(".claude.json.bak-kolux"), "older backup").unwrap();
        let parsed = std::fs::read_to_string(&file).unwrap();
        // Claude Code saves after Kolux parsed the file and before Kolux takes its baseline.
        std::fs::write(&file, r#"{"projects":{},"claude":"new"}"#).unwrap();
        let err = write_parsed(&file, r#"{"projects":{"x":{}}}"#, Some(&parsed)).unwrap_err();
        assert!(err.contains("nothing written"), "{err}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), r#"{"projects":{},"claude":"new"}"#, "the other program's bytes survive");
        assert_eq!(std::fs::read_to_string(d.join(".claude.json.bak-kolux")).unwrap(), "older backup", "the backup is untouched");
        assert!(!file.with_extension("kolux-tmp").exists());
        // The same change made after the backup, just before the rename, is refused as well and the
        // earlier backup is put back.
        let parsed = std::fs::read_to_string(&file).unwrap();
        let err = write_checked(&file, "kolux", Some(parsed.as_bytes()), || std::fs::write(&file, "claude again").unwrap()).unwrap_err();
        assert!(err.contains("nothing written"), "{err}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "claude again");
        assert_eq!(std::fs::read_to_string(d.join(".claude.json.bak-kolux")).unwrap(), "older backup");
        // A file that was missing when parsed but exists at save time is not overwritten either.
        let gone = d.join("config.toml");
        std::fs::write(&gone, "codex = 1").unwrap();
        assert!(write_parsed(&gone, "kolux = 1", None).is_err());
        assert_eq!(std::fs::read_to_string(&gone).unwrap(), "codex = 1");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn write_whole_keeps_one_backup_of_the_bytes_it_replaced() {
        let d = temp("backup");
        let file = d.join(".claude.json");
        write_whole(&file, "first").unwrap();
        assert!(!d.join(".claude.json.bak-kolux").exists(), "a new file has nothing to back up");
        write_whole(&file, "second").unwrap();
        write_whole(&file, "third").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "third");
        assert_eq!(std::fs::read_to_string(d.join(".claude.json.bak-kolux")).unwrap(), "second", "one generation: the bytes just replaced");
        let _ = std::fs::remove_dir_all(&d);
    }

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-trust-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn new_folders_are_trusted_once_and_everything_else_is_kept() {
        let d = temp("keep");
        let (a, b) = (d.join("MixedCase"), d.join("other"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let file = d.join(".claude.json");
        std::fs::write(&file, r#"{"userID":"u1","projects":{"G:/Elsewhere":{"hasTrustDialogAccepted":true,"allowedTools":["Bash"]}}}"#).unwrap();
        let lower = PathBuf::from(a.to_string_lossy().to_lowercase());
        assert_eq!(trust_claude(&file, &[lower.clone(), b.clone(), a.clone()]).unwrap(), 2, "the same folder twice counts once");
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let key = claude_key(&a).unwrap();
        assert!(!key.contains('\\') && !key.starts_with(r"\\?\"), "{key}");
        assert!(key.ends_with("/MixedCase"), "{key}");
        assert_eq!(doc["projects"][&key]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"][claude_key(&b).unwrap()]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"]["G:/Elsewhere"]["allowedTools"], json!(["Bash"]));
        assert_eq!(doc["userID"], "u1");
        // SAFE-023: trusting again changes nothing at all.
        let before = std::fs::read(&file).unwrap();
        assert_eq!(trust_claude(&file, std::slice::from_ref(&a)).unwrap(), 0);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        // A folder whose entry exists without the flag gets only the flag.
        let mut doc = doc;
        doc["projects"][claude_key(&b).unwrap()] = json!({ "allowedTools": ["Read"] });
        std::fs::write(&file, doc.to_string()).unwrap();
        assert_eq!(trust_claude(&file, std::slice::from_ref(&b)).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&b).unwrap()], json!({ "allowedTools": ["Read"], "hasTrustDialogAccepted": true }));
        assert_eq!(trust_folders(&file, "copilot", std::slice::from_ref(&a)).unwrap(), 0, "other agents: nothing yet");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_missing_file_is_made_and_a_broken_one_is_left_alone() {
        let d = temp("files");
        let a = d.join("wt");
        std::fs::create_dir_all(&a).unwrap();
        let missing = d.join("none").join(".claude.json");
        assert_eq!(trust_claude(&missing, std::slice::from_ref(&a)).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&missing).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&a).unwrap()]["hasTrustDialogAccepted"], true);
        let broken = d.join(".claude.json");
        std::fs::write(&broken, "{not json").unwrap();
        assert!(trust_claude(&broken, std::slice::from_ref(&a)).unwrap_err().contains("untouched"));
        assert_eq!(std::fs::read_to_string(&broken).unwrap(), "{not json");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_batch_is_capped_before_any_path_is_worked_out() {
        let d = temp("cap");
        let file = d.join(".claude.json");
        let many: Vec<PathBuf> = (0..13).map(|i| d.join(format!("nowhere-{i}"))).collect();
        assert!(trust_claude(&file, &many).unwrap_err().contains("12"));
        assert!(trust_claude(&file, &[]).unwrap_err().contains("no folders"));
        assert!(!file.exists(), "a refused batch writes nothing");
        assert!(trust_claude(&file, &many[..1]).unwrap_err().contains("nowhere-0"), "a folder that does not exist cannot be trusted");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn codex_entries_are_added_under_projects_and_the_rest_of_the_file_is_kept() {
        let d = temp("codex");
        let a = d.join("Repo");
        std::fs::create_dir_all(&a).unwrap();
        let file = d.join("config.toml");
        let given = "model = \"gpt\"\n\n[desktop]\nx = 1\n\n[projects.'g:\\other']\ntrust_level = \"trusted\"\n";
        std::fs::write(&file, given).unwrap();
        assert_eq!(trust_codex(&file, &[a.clone(), a.clone()]).unwrap(), 1, "the same folder twice counts once");
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.starts_with(given), "{text}");
        let key = codex_key(&a).unwrap();
        assert!(!key.starts_with(r"\\?\") && key.ends_with("repo") == cfg!(windows), "{key}");
        let doc: toml_edit::DocumentMut = text.parse().unwrap();
        assert_eq!(doc["projects"][key.as_str()]["trust_level"].as_str(), Some("trusted"));
        assert_eq!(doc["projects"]["g:\\other"]["trust_level"].as_str(), Some("trusted"));
        // Trusting again changes nothing at all.
        let before = std::fs::read(&file).unwrap();
        assert_eq!(trust_codex(&file, std::slice::from_ref(&a)).unwrap(), 0);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        assert_eq!(trust_folders(&file, "cursor", std::slice::from_ref(&a)).unwrap(), 0, "other agents: nothing yet");
        // A missing file is made; a broken one is left alone.
        let missing = d.join("none").join("config.toml");
        assert_eq!(trust_codex(&missing, std::slice::from_ref(&a)).unwrap(), 1);
        let doc: toml_edit::DocumentMut = std::fs::read_to_string(&missing).unwrap().parse().unwrap();
        assert_eq!(doc["projects"][key.as_str()]["trust_level"].as_str(), Some("trusted"));
        std::fs::write(&file, "[broken").unwrap();
        assert!(trust_codex(&file, std::slice::from_ref(&a)).unwrap_err().contains("untouched"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "[broken");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn t443_only_worktrees_kolux_made_are_trusted_ahead_of_time() {
        let d = temp("made");
        let (main, made) = test_repo_with_worktree(&d);
        let other = d.join("elsewhere");
        std::fs::create_dir_all(&other).unwrap();
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("profile")).unwrap());
        crate::projects::set_origin(&store.lock().unwrap(), &made.to_string_lossy(), Some(&json!({ "madeBy": "app" }))).unwrap();
        let picked = made_by_kolux(&store, &[made.clone(), main.clone(), other.clone()]);
        assert_eq!(picked, vec![made.clone()], "the main checkout and a folder made elsewhere are left out");
        let file = d.join(".claude.json");
        // T-780: the user accepted the main checkout themselves; Kolux adds only the worktree.
        trust_claude(&file, std::slice::from_ref(&main)).unwrap();
        assert_eq!(trust_folders_in(&file, &d.join("config.toml"), "claude", &picked).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&made).unwrap()]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"].as_object().unwrap().len(), 2, "the user's own entry and the worktree, nothing else: {doc}");
        assert!(doc["projects"].get(claude_key(&other).unwrap()).is_none());
        drop(store);
        let _ = std::fs::remove_dir_all(&d);
    }
    /// T-780 (review finding 2): a worktree Kolux made for a pull request holds a stranger's fork
    /// branch; its record carries the pull request, and that keeps it out of the pre-trust even
    /// though Kolux made the folder and the main checkout is trusted. Linking a pull request to a
    /// worktree later stops future trust marks, but does not remove one already written; unlinking
    /// it does not bring the pre-trust back (the record keeps a sticky marker of the pull request).
    #[test]
    fn t780_a_worktree_holding_a_pull_request_is_never_pre_trusted() {
        let d = temp("t780-pr");
        let (main, wt) = test_repo_with_worktree(&d);
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("profile")).unwrap());
        let key = wt.to_string_lossy().to_string();
        let pr_ever = crate::projects::PR_EVER_KEY;
        // Made from a pull request, as projects::open_pull_request records it.
        crate::projects::set_origin(&store.lock().unwrap(), &key, Some(&json!({ "madeBy": "app", "existingBranch": false, "pr": "https://github.com/o/r/pull/12", pr_ever: true }))).unwrap();
        assert!(made_by_kolux(&store, std::slice::from_ref(&wt)).is_empty(), "a pull request's branch is not pre-trusted");
        assert_eq!(not_pre_trusted_why(&store, &wt), "not trusted: this worktree holds a pull request's branch, so the agent asks itself");
        let file = d.join(".claude.json");
        trust_claude(&file, std::slice::from_ref(&main)).unwrap();
        assert_eq!(trust_for_launch(&store, &file, "claude", std::slice::from_ref(&wt)), Err("no folders to trust".to_string()), "nothing is written for a pull request worktree");
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!(doc["projects"].get(claude_key(&wt).unwrap()).is_none(), "{doc}");
        // Unlinking the pull request in the details form clears `pr` but the sticky marker stays,
        // so the worktree is still not pre-trusted and nothing is written.
        crate::projects::save_details(&store.lock().unwrap(), &key, "", "", "").unwrap();
        let o = crate::projects::origin(&store.lock().unwrap(), &key).unwrap();
        assert!(o["pr"].is_null() && o[crate::projects::PR_EVER_KEY] == true && o["madeBy"] == "app", "{o}");
        assert!(made_by_kolux(&store, std::slice::from_ref(&wt)).is_empty(), "unlinking the pull request does not bring the pre-trust back");
        assert_eq!(not_pre_trusted_why(&store, &wt), "not trusted: this worktree holds a pull request's branch, so the agent asks itself");
        assert_eq!(trust_for_launch(&store, &file, "claude", std::slice::from_ref(&wt)), Err("no folders to trust".to_string()));
        // A folder with no record at all says so.
        assert_eq!(not_pre_trusted_why(&store, &d.join("elsewhere")), "not trusted: not a worktree Kolux made, so the agent asks itself");
        drop(store);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// T-780 (review finding, 2026-11-09): the details form and the CLI's `worktree.set` write an
    /// origin record for any folder a user names (a link or a comment), without a `madeBy`. Such a
    /// record must not make a user-added folder count as Kolux-made, or it would be pre-trusted.
    #[test]
    fn t780_a_details_record_on_a_user_added_folder_does_not_pre_trust_it() {
        let d = temp("t780-details");
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("profile")).unwrap());
        let added = d.join("my-own-folder");
        std::fs::create_dir_all(&added).unwrap();
        let key = added.to_string_lossy().to_string();
        crate::projects::save_details(&store.lock().unwrap(), &key, "Mine", "", "a note").unwrap();
        let o = crate::projects::origin(&store.lock().unwrap(), &key).unwrap();
        assert!(o.get("madeBy").is_none(), "the details form never adds a madeBy: {o}");
        assert!(made_by_kolux(&store, std::slice::from_ref(&added)).is_empty(), "a user-added folder with a comment is not Kolux-made");
        assert_eq!(not_pre_trusted_why(&store, &added), "not trusted: not a worktree Kolux made, so the agent asks itself");
        let file = d.join(".claude.json");
        assert_eq!(trust_for_launch(&store, &file, "claude", std::slice::from_ref(&added)), Err("no folders to trust".to_string()));
        assert!(!file.exists(), "nothing is written");
        // An empty madeBy is no better than none.
        crate::projects::set_origin(&store.lock().unwrap(), &key, Some(&json!({ "madeBy": "", "comment": "x" }))).unwrap();
        assert!(made_by_kolux(&store, std::slice::from_ref(&added)).is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// T-780: a Kolux-made worktree stays pre-trusted when its details are edited (the record
    /// keeps its `madeBy`), while the same edit on the project's main checkout never makes the
    /// main checkout count as Kolux-made.
    #[test]
    fn t780_details_on_the_main_checkout_never_make_it_kolux_made() {
        let d = temp("t780-details-main");
        let (main, wt) = test_repo_with_worktree(&d);
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("profile")).unwrap());
        crate::projects::set_origin(&store.lock().unwrap(), &wt.to_string_lossy(), Some(&json!({ "madeBy": "app" }))).unwrap();
        crate::projects::save_details(&store.lock().unwrap(), &main.to_string_lossy(), "Main", "#7", "the main checkout").unwrap();
        crate::projects::save_details(&store.lock().unwrap(), &wt.to_string_lossy(), "Work", "#8", "the worktree").unwrap();
        assert_eq!(made_by_kolux(&store, &[main.clone(), wt.clone()]), vec![wt.clone()], "the main checkout is left out, the Kolux-made worktree stays in");
        assert_eq!(not_pre_trusted_why(&store, &main), "not trusted: not a worktree Kolux made, so the agent asks itself");
        let file = d.join(".claude.json");
        trust_claude(&file, std::slice::from_ref(&main)).unwrap();
        assert_eq!(trust_for_launch(&store, &file, "claude", &[main.clone(), wt.clone()]).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&wt).unwrap()]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"].as_object().unwrap().len(), 2, "{doc}");
        drop(store);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn t780_a_worktree_is_pre_trusted_only_when_its_main_checkout_already_is() {
        let d = temp("t780-main");
        let (main, wt) = test_repo_with_worktree(&d);
        let (claude, codex) = (d.join(".claude.json"), d.join("config.toml"));
        std::fs::write(&claude, "{}").unwrap();
        // The user never accepted the main checkout in Claude: Kolux adds nothing and says why.
        let err = trust_folders_in(&claude, &codex, "claude", std::slice::from_ref(&wt)).unwrap_err();
        assert!(err.contains("not trusted") && err.contains(&real_path(&main).unwrap()), "{err}");
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&claude).unwrap()).unwrap();
        assert!(doc["projects"].get(claude_key(&wt).unwrap()).is_none(), "the worktree is not pre-trusted: {doc}");
        // The user accepts the main checkout (what Claude Code writes on its own prompt): now the
        // worktree Kolux made from it inherits that answer.
        assert_eq!(trust_claude(&claude, std::slice::from_ref(&main)).unwrap(), 1);
        assert_eq!(trust_folders_in(&claude, &codex, "claude", std::slice::from_ref(&wt)).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&claude).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&wt).unwrap()]["hasTrustDialogAccepted"], true);
        // Codex keeps its own answer: trust in Claude's file says nothing about Codex's.
        let err = trust_folders_in(&claude, &codex, "codex", std::slice::from_ref(&wt)).unwrap_err();
        assert!(err.contains("not trusted"), "{err}");
        assert!(!codex.exists(), "no Codex file is made for a refused pre-trust");
        assert_eq!(trust_codex(&codex, std::slice::from_ref(&main)).unwrap(), 1);
        assert_eq!(trust_folders_in(&claude, &codex, "codex", std::slice::from_ref(&wt)).unwrap(), 1);
        let toml: toml_edit::DocumentMut = std::fs::read_to_string(&codex).unwrap().parse().unwrap();
        assert_eq!(toml["projects"][codex_key(&wt).unwrap().as_str()]["trust_level"].as_str(), Some("trusted"), "{toml}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn t780_a_folder_that_is_no_worktree_and_a_mixed_batch_keep_the_agents_own_prompt() {
        let d = temp("t780-mixed");
        let (main, wt) = test_repo_with_worktree(&d);
        let plain = d.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let (claude, codex) = (d.join(".claude.json"), d.join("config.toml"));
        // Not a git worktree at all: nothing to inherit from, so nothing is written.
        let err = trust_folders_in(&claude, &codex, "claude", std::slice::from_ref(&plain)).unwrap_err();
        assert!(err.contains("not a git worktree"), "{err}");
        assert!(!claude.exists());
        // A mixed batch trusts the worktrees whose main checkout is trusted and drops the rest.
        trust_claude(&claude, std::slice::from_ref(&main)).unwrap();
        assert_eq!(trust_folders_in(&claude, &codex, "claude", &[plain.clone(), wt.clone()]).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&claude).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&wt).unwrap()]["hasTrustDialogAccepted"], true);
        assert!(doc["projects"].get(claude_key(&plain).unwrap()).is_none());
        // The main checkout itself is its own main: already trusted means nothing new to add.
        assert_eq!(trust_folders_in(&claude, &codex, "claude", std::slice::from_ref(&main)).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&d);
    }
}
