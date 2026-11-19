//! T-312 (ORCH-062, ORCH-063, ORCH-064): the runtime commands agents call for files, git and
//! GitHub, past sessions and automations. Each command works inside one worktree, which the CLI
//! resolves first (its `--worktree` selector, else the folder the call came from); this module does
//! the work so it can be tested without the app.
//!
//! - `file list`, `file read`, `file rename`: every path must lie inside the worktree, also after
//!   following links, and a rename checks both the old and the new path; a new letter case of the
//!   same name is allowed (ORCH-062).
//! - `git branch`, `git pr`: read from the worktree's own folder, so git and gh answer for that
//!   worktree's own remote and host (ORCH-063). Nothing here pushes; GitHub is read through the
//!   existing gh seam.
//! - `sessions list`: the worktree's past Claude sessions with titles, from one cache that every
//!   caller shares for a short while (ORCH-064).
//! - `automations mine`: the owner (a repo) is settled first, then only its automations are listed
//!   (ORCH-064).
//!
//! ORCH-061 (browser page leases) is T-312-b. `cli.rs` and the help table in `local_cli.rs` are
//! shared files: they gain this module's table, checks, text and dispatch arm through
//! `evidence/orchestration-T-312-cli.patch` and `evidence/orchestration-T-312-local_cli.patch`.

use crate::cli::Fail;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

pub const LIST: &str = "runtime.file.list";
pub const READ: &str = "runtime.file.read";
pub const RENAME: &str = "runtime.file.rename";
pub const BRANCH: &str = "runtime.git.branch";
pub const PR: &str = "runtime.git.pr";
pub const SESSIONS: &str = "runtime.sessions.list";
pub const MINE: &str = "runtime.automations.mine";

/// Command path, wire name and flags, in the shape of the CLI's own table.
pub const COMMANDS: &[(&str, &str, &[&str])] = &[
    ("file list", LIST, &["path", "worktree"]),
    ("file read", READ, &["path", "worktree"]),
    ("file rename", RENAME, &["path", "to", "worktree"]),
    ("git branch", BRANCH, &["worktree"]),
    ("git pr", PR, &["worktree"]),
    ("sessions list", SESSIONS, &["worktree"]),
    ("automations mine", MINE, &["repo"]),
];

pub fn is_runtime(command: &str) -> bool {
    COMMANDS.iter().any(|c| c.1 == command)
}

fn args(message: impl Into<String>) -> Fail {
    Fail::new("invalid_arguments", message)
}

/// The parse-time rules: no blank values, a path for read and rename, and a target for rename.
pub fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| text(k).is_some_and(str::is_empty)) {
        return Err(args(format!("--{k} cannot be empty")));
    }
    if (command == READ || command == RENAME) && text("path").is_none() {
        return Err(args("--path is required: the file, relative to the worktree or absolute inside it"));
    }
    if command == RENAME && text("to").is_none() {
        return Err(args("--to is required: the new path, inside the same worktree"));
    }
    Ok(flags.clone())
}

// ---------------------------------------------------------------- authority (ORCH-062)

/// `p` with `.` dropped and `..` applied, without touching the disk; None when `..` climbs above
/// its root.
fn tidy(p: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() || out.as_os_str().is_empty() {
                    return None;
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// The folder parts of `p` for comparing: lower case on Windows, where names ignore case.
fn parts(p: &Path) -> Vec<String> {
    let p = p.to_string_lossy();
    let p = p.strip_prefix(r"\\?\").unwrap_or(&p).replace('\\', "/");
    p.split('/').filter(|s| !s.is_empty()).map(|s| if cfg!(windows) { s.to_lowercase() } else { s.to_string() }).collect()
}

fn starts_with(full: &Path, root: &Path) -> bool {
    let (f, r) = (parts(full), parts(root));
    f.len() >= r.len() && f[..r.len()] == r[..]
}

/// The deepest part of `p` that exists, with every link followed.
fn real_existing(p: &Path) -> Option<PathBuf> {
    let mut at = p.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = at.canonicalize() {
            return Some(rest.iter().rev().fold(real, |acc, n| acc.join(n)));
        }
        rest.push(at.file_name()?.to_os_string());
        at = at.parent()?.to_path_buf();
    }
}

/// Where `given` points, as an absolute path inside the worktree `root`. A relative path is read
/// from `cwd` when that is inside the worktree, else from its top. The path must stay inside the
/// worktree as written and also once links are followed. `top_ok`: the worktree's own top folder
/// is accepted (listing it), else refused (it is not a file).
pub fn within(root: &Path, cwd: &Path, given: &str, top_ok: bool) -> Result<PathBuf, Fail> {
    let outside = || Fail::new("outside", format!("{given} is not inside the worktree {}", root.display()));
    let g = Path::new(given.trim());
    let base = if starts_with(cwd, root) { cwd } else { root };
    let joined = if g.is_absolute() || g.has_root() { g.to_path_buf() } else { base.join(g) };
    let full = tidy(&joined).ok_or_else(outside)?;
    if !starts_with(&full, root) {
        return Err(outside());
    }
    // A link inside the worktree that leads out of it does not carry authority with it.
    let real_root = root.canonicalize().map_err(|e| Fail::new("not_found", format!("{}: {e}", root.display())))?;
    if !real_existing(&full).is_some_and(|r| starts_with(&r, &real_root)) {
        return Err(outside());
    }
    if !top_ok && parts(&full) == parts(root) {
        return Err(Fail::new("not_a_file", format!("{given} is the worktree's top folder, not a file")));
    }
    Ok(full)
}

/// `p` relative to `root` with forward slashes ("" for the top folder).
fn rel(root: &Path, p: &Path) -> String {
    let n = parts(root).len();
    let p = p.to_string_lossy();
    let p = p.strip_prefix(r"\\?\").unwrap_or(&p).replace('\\', "/");
    p.split('/').filter(|s| !s.is_empty()).skip(n).collect::<Vec<_>>().join("/")
}

pub fn file_list(root: &Path, cwd: &Path, given: Option<&str>) -> Result<Value, Fail> {
    let dir = within(root, cwd, given.unwrap_or("."), true)?;
    if !dir.is_dir() {
        return Err(Fail::new("not_found", format!("{} is not a folder in {}", rel(root, &dir), root.display())));
    }
    let entries: Vec<Value> = crate::files::list_dir(&dir)?.into_iter().map(|e| json!({ "name": e.name, "path": rel(root, Path::new(&e.path)), "kind": e.kind })).collect();
    Ok(json!({ "worktree": root.to_string_lossy(), "path": rel(root, &dir), "entries": entries }))
}

pub fn file_read(root: &Path, cwd: &Path, given: &str) -> Result<Value, Fail> {
    let file = within(root, cwd, given, false)?;
    let shown = rel(root, &file);
    if file.is_dir() {
        return Err(Fail::new("not_a_file", format!("{shown} is a folder, not a file")));
    }
    if !file.is_file() {
        return Err(Fail::new("not_found", format!("{shown} does not exist in {}", root.display())));
    }
    let text = crate::files::read_text(&file)?;
    Ok(json!({ "worktree": root.to_string_lossy(), "path": shown, "text": text }))
}

/// ORCH-062: authority over both the old and the new path; a new spelling of the same name in the
/// same folder (letter case) is allowed; an existing other entry is never replaced.
pub fn file_rename(root: &Path, cwd: &Path, from: &str, to: &str) -> Result<Value, Fail> {
    let old = within(root, cwd, from, false)?;
    let new = within(root, cwd, to, false)?;
    if std::fs::symlink_metadata(&old).is_err() {
        return Err(Fail::new("not_found", format!("{} does not exist in {}", rel(root, &old), root.display())));
    }
    let same_folder = old.parent().map(parts) == new.parent().map(parts);
    let done = if same_folder {
        let name = new.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        crate::fsops::rename(&old, &name).map_err(|e| Fail::new("failed", e))?
    } else {
        if std::fs::symlink_metadata(&new).is_ok() {
            return Err(Fail::new("exists", format!("{} already exists", rel(root, &new))));
        }
        if !new.parent().is_some_and(Path::is_dir) {
            return Err(Fail::new("not_found", format!("the folder for {} does not exist", rel(root, &new))));
        }
        std::fs::rename(&old, &new).map_err(|e| Fail::new("failed", format!("could not rename {}: {e}", rel(root, &old))))?;
        new
    };
    Ok(json!({ "worktree": root.to_string_lossy(), "from": rel(root, &old), "to": rel(root, &done) }))
}

// ---------------------------------------------------------------- git and GitHub (ORCH-063)

pub fn git_branch(root: &Path) -> Result<Value, Fail> {
    let st = crate::scm::status(root).map_err(|e| Fail::new("failed", e))?;
    Ok(json!({ "worktree": root.to_string_lossy(), "branch": st.branch, "detached": st.branch.is_none(), "head": st.head, "upstream": st.upstream, "ahead": st.ahead, "behind": st.behind }))
}

/// The pull request of the worktree's branch. gh runs in the worktree's own folder, so it reads
/// that worktree's own remote and host. Only reads: nothing is pushed or created.
pub fn git_pr(gh: &Path, root: &Path, branch: Option<&str>) -> Result<Value, Fail> {
    let Some(branch) = branch else {
        return Err(Fail::new("detached", format!("{} is not on a branch, so it has no pull request", root.display())));
    };
    let pr = crate::scm::pr_find(gh, root, branch).map_err(|e| Fail::new("failed", e))?;
    Ok(json!({ "worktree": root.to_string_lossy(), "branch": branch, "pr": pr }))
}

// ---------------------------------------------------------------- past sessions and automations (ORCH-064)

/// How long a session list is answered from the shared cache.
pub const SESSION_TTL: Duration = Duration::from_secs(30);
/// How much of a transcript is read for its title.
const TITLE_SCAN: u64 = 256 * 1024;
const TITLE_MAX: usize = 80;

type Cached = (Instant, Value);
static SESSION_CACHE: LazyLock<Mutex<HashMap<String, Cached>>> = LazyLock::new(Mutex::default);

/// A session's title: its latest summary line, else its first typed prompt (its first line, up to
/// 80 characters). Wrapped tool and command messages (starting with `<`) are not prompts.
pub fn title_of(transcript: &Path) -> Option<String> {
    use std::io::{BufRead, Read};
    let f = std::fs::File::open(transcript).ok()?;
    let (mut summary, mut first) = (None, None);
    for line in std::io::BufReader::new(f.take(TITLE_SCAN)).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v["type"].as_str() {
            Some("summary") => summary = v["summary"].as_str().map(str::to_string).or(summary),
            Some("user") if first.is_none() => {
                let c = &v["message"]["content"];
                let text = c.as_str().map(str::to_string).or_else(|| c.as_array().and_then(|a| a.iter().find(|p| p["type"] == "text")).and_then(|p| p["text"].as_str()).map(str::to_string));
                first = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty() && !t.starts_with('<'));
            }
            _ => {}
        }
    }
    let t = summary.or(first)?;
    let line = t.lines().next().unwrap_or_default().trim();
    let mut out: String = line.chars().take(TITLE_MAX).collect();
    if line.chars().count() > TITLE_MAX {
        out.push('…');
    }
    Some(out)
}

/// The past Claude sessions of `workspace` with titles, newest first, and whether the answer came
/// from the shared cache. Every caller asking about the same workspace within `SESSION_TTL` gets
/// the same answer without the history being read again.
pub fn sessions(projects: &Path, workspace: &str, now: Instant) -> (Value, bool) {
    let key = format!("{}|{}", projects.to_string_lossy().to_lowercase(), crate::sessions::folder_key(workspace).to_lowercase());
    let mut cache = SESSION_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|_, (at, _)| now.saturating_duration_since(*at) < SESSION_TTL);
    if let Some((_, v)) = cache.get(&key) {
        return (v.clone(), true);
    }
    let dir = crate::sessions::claude_history_dir(projects, workspace);
    let list: Vec<Value> = crate::sessions::claude_sessions(projects, workspace)
        .into_iter()
        .map(|s| {
            let title = dir.as_ref().and_then(|d| title_of(&d.join(format!("{}.jsonl", s.id))));
            json!({ "id": s.id, "title": title, "modifiedMs": s.modified_ms, "bytes": s.bytes })
        })
        .collect();
    let v = json!({ "worktree": workspace, "agent": "claude", "sessions": list });
    cache.insert(key, (now, v.clone()));
    (v, false)
}

/// ORCH-064: only the automations `owner` (a repo's id) owns. The owner is settled before this is
/// called; an automation with no owner belongs to nobody's list.
pub fn owned(all: &Value, owner: &str) -> Vec<Value> {
    all["automations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["projectId"].as_str() == Some(owner))
        .map(|a| {
            let mut a = a.clone();
            if let Some(o) = a.as_object_mut() {
                o.remove("requestId");
            }
            a
        })
        .collect()
}

pub fn automations_mine(_store: &crate::state::Store, owner_id: &str, owner_name: &str) -> Result<Value, Fail> {
    // The automations were retired (slim-down wave B): no repo owns any.
    let all = json!({ "automations": [] });
    Ok(json!({ "repo": owner_name, "repoId": owner_id, "automations": owned(&all, owner_id) }))
}

// ---------------------------------------------------------------- the CLI's side

/// Where a runtime command works: the worktree the CLI resolved and the repo it belongs to.
pub struct Place<'a> {
    pub root: &'a Path,
    pub branch: Option<&'a str>,
    pub repo_id: &'a str,
    pub repo_name: &'a str,
}

/// Runs one runtime command in `place`. `cwd` is the folder the call came from.
pub fn run(command: &str, a: &Value, cwd: &Path, place: &Place, store: &Mutex<crate::state::Store>) -> Result<Value, Fail> {
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    let need = |k: &str| text(k).ok_or_else(|| args(format!("--{k} is required")));
    match command {
        LIST => file_list(place.root, cwd, text("path")),
        READ => file_read(place.root, cwd, need("path")?),
        RENAME => file_rename(place.root, cwd, need("path")?, need("to")?),
        BRANCH => git_branch(place.root),
        PR => git_pr(&crate::scm::gh_program().map_err(|e| Fail::new("failed", e))?, place.root, place.branch),
        SESSIONS => {
            let Some(projects) = crate::capture::claude_dir().map(|d| d.join("projects")) else {
                return Ok(json!({ "worktree": place.root.to_string_lossy(), "agent": "claude", "sessions": [], "cached": false }));
            };
            let (mut v, cached) = sessions(&projects, &place.root.to_string_lossy(), Instant::now());
            v["cached"] = json!(cached);
            Ok(v)
        }
        MINE => automations_mine(&*store.lock().map_err(|e| e.to_string())?, place.repo_id, place.repo_name),
        other => Err(args(format!("unknown command {other}"))),
    }
}

/// The lines each runtime command prints without `--json`.
pub fn text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    Some(match command {
        LIST => {
            let rows: Vec<String> = r["entries"].as_array().into_iter().flatten().map(|e| format!("{}{}", s(&e["path"]), if e["kind"] == "dir" { "/" } else { "" })).collect();
            if rows.is_empty() { "the folder is empty".into() } else { rows.join("\n") }
        }
        READ => s(&r["text"]),
        RENAME => format!("renamed {} to {}", s(&r["from"]), s(&r["to"])),
        BRANCH => match r["branch"].as_str() {
            Some(b) => format!("{b}{}", r["upstream"].as_str().map(|u| format!(" (tracks {u}, {} ahead, {} behind)", r["ahead"], r["behind"])).unwrap_or_default()),
            None => format!("detached at {}", s(&r["head"])),
        },
        PR => match r["pr"].as_object() {
            Some(p) => format!("#{} {} ({}) {}", p["number"], p.get("title").and_then(Value::as_str).unwrap_or_default(), p.get("state").and_then(Value::as_str).unwrap_or_default(), p.get("url").and_then(Value::as_str).unwrap_or_default()),
            None => format!("{} has no pull request", s(&r["branch"])),
        },
        SESSIONS => {
            let rows: Vec<String> = r["sessions"].as_array().into_iter().flatten().map(|x| format!("{}  {}", s(&x["id"]), x["title"].as_str().unwrap_or("(untitled)"))).collect();
            if rows.is_empty() { "no past sessions".into() } else { rows.join("\n") }
        }
        MINE => {
            let rows: Vec<String> = r["automations"].as_array().into_iter().flatten().map(|x| format!("{}  {}", s(&x["id"]), s(&x["name"]))).collect();
            if rows.is_empty() { format!("{} has no automations", s(&r["repo"])) } else { rows.join("\n") }
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn t312_the_parse_checks_refuse_blank_values_and_missing_paths_before_any_lookup() {
        assert!(check(READ, &obj(json!({}))).unwrap_err().message.contains("--path is required"));
        assert!(check(RENAME, &obj(json!({ "path": "a.txt" }))).unwrap_err().message.contains("--to is required"));
        assert!(check(LIST, &obj(json!({ "worktree": " " }))).unwrap_err().message.contains("--worktree cannot be empty"));
        assert!(check(LIST, &obj(json!({}))).is_ok());
        assert!(check(RENAME, &obj(json!({ "path": "a", "to": "b" }))).is_ok());
        assert!(COMMANDS.iter().all(|c| is_runtime(c.1)) && !is_runtime("file.open"));
    }

    #[test]
    fn orch062_paths_resolve_inside_the_worktree_and_climbing_out_is_turned_away() {
        let dir = crate::test_dir::temp("t312-within");
        let root = dir.join("wt");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.txt"), "a").unwrap();
        assert_eq!(within(&root, &root.join("src"), "a.txt", false).unwrap(), root.join("src").join("a.txt"));
        assert_eq!(within(&root, &dir, "src/a.txt", false).unwrap(), root.join("src").join("a.txt"), "a caller outside reads from the top");
        assert_eq!(within(&root, &root, "../outside.txt", false).unwrap_err().code, "outside");
        assert_eq!(within(&root, &root, &dir.join("wt-two").join("x").to_string_lossy(), false).unwrap_err().code, "outside", "a sibling folder whose name starts the same is outside");
        assert_eq!(within(&root, &root, ".", false).unwrap_err().code, "not_a_file");
        assert_eq!(within(&root, &root, ".", true).unwrap(), root);
        assert_eq!(within(&root, &root, "src/new/deeper.txt", false).unwrap(), root.join("src").join("new").join("deeper.txt"), "a path not made yet is still judged");
    }

    #[cfg(unix)]
    #[test]
    fn orch062_a_link_that_leads_out_of_the_worktree_carries_no_authority() {
        let dir = crate::test_dir::temp("t312-link");
        let root = dir.join("wt");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(dir.join("secret")).unwrap();
        std::os::unix::fs::symlink(dir.join("secret"), root.join("out")).unwrap();
        assert_eq!(within(&root, &root, "out/x.txt", false).unwrap_err().code, "outside");
    }

    #[test]
    fn orch062_rename_inside_succeeds_and_to_a_place_outside_is_turned_away() {
        let dir = crate::test_dir::temp("t312-rename");
        let root = dir.join("wt");
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("a.txt"), "one").unwrap();
        let r = file_rename(&root, &root, "a.txt", "docs/b.txt").unwrap();
        assert_eq!((r["from"].as_str(), r["to"].as_str()), (Some("a.txt"), Some("docs/b.txt")));
        assert_eq!(fs::read_to_string(root.join("docs/b.txt")).unwrap(), "one");
        let out = file_rename(&root, &root, "docs/b.txt", "../stolen.txt").unwrap_err();
        assert_eq!(out.code, "outside");
        assert!(!dir.join("stolen.txt").exists() && root.join("docs/b.txt").exists(), "nothing moved");
        // The old path is checked too: a file outside cannot be pulled in.
        fs::write(dir.join("loose.txt"), "x").unwrap();
        assert_eq!(file_rename(&root, &root, &dir.join("loose.txt").to_string_lossy(), "in.txt").unwrap_err().code, "outside");
        assert!(dir.join("loose.txt").exists());
        // An existing other entry is never replaced.
        fs::write(root.join("c.txt"), "c").unwrap();
        assert_eq!(file_rename(&root, &root, "c.txt", "docs/b.txt").unwrap_err().code, "exists");
        assert!(file_rename(&root, &root, "c.txt", "b.txt").is_ok_and(|v| v["to"] == "b.txt"));
        fs::write(root.join("d.txt"), "d").unwrap();
        assert!(file_rename(&root, &root, "d.txt", "b.txt").is_err(), "same folder, another file's name");
        assert_eq!(file_rename(&root, &root, "missing.txt", "m.txt").unwrap_err().code, "not_found");
    }

    #[test]
    fn orch062_renaming_to_the_same_name_in_another_letter_case_succeeds() {
        let dir = crate::test_dir::temp("t312-case");
        let root = dir.join("wt");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("readme.md"), "r").unwrap();
        let r = file_rename(&root, &root, "readme.md", "README.md").unwrap();
        assert_eq!(r["to"], "README.md");
        let names: Vec<String> = fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["README.md".to_string()]);
    }

    #[test]
    fn orch062_list_and_read_stay_inside_the_worktree() {
        let dir = crate::test_dir::temp("t312-read");
        let root = dir.join("wt");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.txt"), "hello").unwrap();
        fs::write(dir.join("outside.txt"), "no").unwrap();
        let top = file_list(&root, &root, None).unwrap();
        assert_eq!(top["entries"], json!([{ "name": "src", "path": "src", "kind": "dir" }]));
        assert_eq!(text(LIST, &top).unwrap(), "src/");
        assert_eq!(file_list(&root, &root, Some("src")).unwrap()["entries"][0]["path"], "src/a.txt");
        assert_eq!(file_list(&root, &root, Some("..")).unwrap_err().code, "outside");
        assert_eq!(file_read(&root, &root, "src/a.txt").unwrap()["text"], "hello");
        assert_eq!(file_read(&root, &root, "../outside.txt").unwrap_err().code, "outside");
        assert_eq!(file_read(&root, &root, "src").unwrap_err().code, "not_a_file");
        assert_eq!(file_read(&root, &root, "nope.txt").unwrap_err().code, "not_found");
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    #[test]
    fn orch063_a_worktrees_branch_matches_what_git_reports_in_that_folder() {
        let dir = crate::test_dir::temp("t312-branch");
        let repo = dir.join("repo");
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
        git(&repo, &["worktree", "add", "-q", "-b", "feature/x", "../wt"]);
        let wt = dir.join("wt");
        let b = git_branch(&wt).unwrap();
        assert_eq!(b["branch"], "feature/x");
        assert_eq!(git_branch(&repo).unwrap()["branch"], "main", "each worktree answers for its own folder");
        assert_eq!(text(BRANCH, &b).unwrap(), "feature/x");
        assert_eq!(git_pr(Path::new("gh"), &wt, None).unwrap_err().code, "detached");
    }

    /// A stand-in gh that keeps its arguments and its folder, and answers with `answer.json`.
    fn stand_in_gh(dir: &Path, answer: &str) -> PathBuf {
        fs::write(dir.join("answer.json"), answer).unwrap();
        if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\ncd>>\"%~dp0where.txt\"\r\ntype \"%~dp0answer.json\"\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\npwd >> \"$(dirname \"$0\")/where.txt\"\ncat \"$(dirname \"$0\")/answer.json\"\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        }
    }

    #[test]
    fn orch063_the_pull_request_of_a_worktrees_branch_is_read_in_that_worktrees_folder() {
        let dir = crate::test_dir::temp("t312-pr");
        let wt = dir.join("wt");
        fs::create_dir_all(&wt).unwrap();
        let gh = stand_in_gh(&dir, r#"{"number":7,"url":"https://github.com/me/app/pull/7","state":"OPEN","title":"Add x","headRefName":"feature/x","isDraft":false}"#);
        let r = git_pr(&gh, &wt, Some("feature/x")).unwrap();
        assert_eq!(r["pr"]["number"], 7);
        assert_eq!(r["pr"]["head"], "feature/x");
        assert_eq!(text(PR, &r).unwrap(), "#7 Add x (OPEN) https://github.com/me/app/pull/7");
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("pr view feature/x --json"), "{calls}");
        assert!(!calls.contains("push") && !calls.contains("create"), "only reads: {calls}");
        let at = fs::read_to_string(dir.join("where.txt")).unwrap();
        assert!(parts(Path::new(at.trim())) == parts(&wt), "gh ran in the worktree, so it reads that worktree's remote and host: {at}");
    }

    fn transcript(dir: &Path, id: &str, lines: &[Value]) {
        let body: Vec<String> = lines.iter().map(Value::to_string).collect();
        fs::write(dir.join(format!("{id}.jsonl")), body.join("\n")).unwrap();
    }

    #[test]
    fn orch064_session_titles_come_from_the_summary_else_the_first_typed_prompt() {
        let dir = crate::test_dir::temp("t312-titles");
        transcript(&dir, "a", &[json!({ "type": "user", "message": { "role": "user", "content": "<command-name>/clear</command-name>" } }), json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "Fix the login page\nand more" }] } })]);
        assert_eq!(title_of(&dir.join("a.jsonl")).as_deref(), Some("Fix the login page"));
        transcript(&dir, "b", &[json!({ "type": "summary", "summary": "Login fix" }), json!({ "type": "user", "message": { "content": "Fix it" } })]);
        assert_eq!(title_of(&dir.join("b.jsonl")).as_deref(), Some("Login fix"));
        transcript(&dir, "c", &[json!({ "type": "user", "message": { "content": "x".repeat(100) } })]);
        assert_eq!(title_of(&dir.join("c.jsonl")).unwrap().chars().count(), TITLE_MAX + 1, "cut at 80 with an ellipsis");
        transcript(&dir, "d", &[json!({ "type": "assistant" })]);
        assert_eq!(title_of(&dir.join("d.jsonl")), None);
    }

    #[test]
    fn orch064_listing_sessions_twice_answers_the_second_time_from_the_shared_cache() {
        let dir = crate::test_dir::temp("t312-sessions");
        let projects = dir.join("projects");
        let ws = dir.join("work").join("app");
        let ws_s = ws.to_string_lossy().into_owned();
        let hist = projects.join(crate::sessions::claude_folder_name(&crate::sessions::folder_key(&ws_s)));
        fs::create_dir_all(&hist).unwrap();
        transcript(&hist, "s1", &[json!({ "type": "user", "message": { "content": "First task" } })]);
        let t0 = Instant::now();
        let (one, cached) = sessions(&projects, &ws_s, t0);
        assert!(!cached);
        assert_eq!(one["sessions"][0]["id"], "s1");
        assert_eq!(one["sessions"][0]["title"], "First task");
        // A new session lands, but a second caller inside the window gets the same, cached answer.
        transcript(&hist, "s2", &[json!({ "type": "user", "message": { "content": "Second" } })]);
        let (two, cached) = sessions(&projects, &ws_s, t0 + Duration::from_secs(1));
        assert!(cached);
        assert_eq!(two, one);
        // After the window the history is read again.
        let (three, cached) = sessions(&projects, &ws_s, t0 + SESSION_TTL + Duration::from_secs(1));
        assert!(!cached);
        assert_eq!(three["sessions"].as_array().unwrap().len(), 2);
        assert!(text(SESSIONS, &three).unwrap().contains("Second"));
    }

    #[test]
    fn orch064_listing_automations_as_another_owner_shows_none_of_the_first_owners() {
        let all = json!({ "automations": [
            { "id": "auto-1", "name": "Nightly", "projectId": "p1", "requestId": "r" },
            { "id": "auto-2", "name": "Weekly", "projectId": "p1" },
            { "id": "auto-3", "name": "Theirs", "projectId": "p2" },
            { "id": "auto-4", "name": "Nobody's" }
        ] });
        let mine = owned(&all, "p2");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0]["id"], "auto-3");
        assert!(owned(&all, "p3").is_empty());
        let p1 = owned(&all, "p1");
        assert_eq!(p1.iter().map(|a| a["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["auto-1", "auto-2"]);
        assert!(p1[0].get("requestId").is_none());
        assert_eq!(text(MINE, &json!({ "repo": "app", "automations": [] })).unwrap(), "app has no automations");
    }
}
