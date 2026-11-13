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
    let path = std::env::temp_dir().join("kolux-test-empty-gitconfig");
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
/// S4 (DT-C241, Txais 2026-11-08: "Yes, include it"): the same listing also finds the keys through
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
/// DT-C241): a read always has them blanked; a write that runs the repository's clean or smudge
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
        let (key, value) = match entry.iter().position(|b| *b == b'\n') {
            Some(i) => (&entry[..i], &entry[i + 1..]),
            None => (entry, &entry[..0]),
        };
        // Review fix 8 follow-up (P1): a key that is not valid text cannot be blanked by name (the environment
        // carries text, and the lossy spelling names a key that does not exist while the real one stays live),
        // so the listing records it under `UNREADABLE_KEY` and an untrusted run is refused instead.
        let Ok(key) = std::str::from_utf8(key) else {
            if !found.iter().any(|(k, _)| k == UNREADABLE_KEY) {
                found.push((UNREADABLE_KEY.to_string(), String::from_utf8_lossy(key).into_owned()));
            }
            continue;
        };
        found.push((key.to_string(), String::from_utf8_lossy(value).trim_end_matches('\r').to_string()));
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

/// Review fix 8 follow-up (P1): the key a listing carries when a program key of the folder's own is not valid
/// text (its value: that key, lossily spelled, for the message). Such a key cannot be blanked (see
/// `parse_listing`), so every run in the folder is refused until the folder is trusted.
const UNREADABLE_KEY: &str = "kolux.listing-unreadable";

/// The refusal for an untrusted run in a folder whose listing carries `UNREADABLE_KEY`; None otherwise.
fn unreadable_program_key(found: &[(String, String)], dir: &Path) -> Option<String> {
    let (_, key) = found.iter().find(|(k, _)| k == UNREADABLE_KEY)?;
    if folder_trusted(dir) {
        return None;
    }
    Some(format!("the folder's git config names a program under a key that is not readable text ({key}), which Kolux cannot switch off"))
}

/// A git read Kolux refuses (see `command`): a process that cannot start, since its program does not exist,
/// with the reason in `KOLUX_REFUSAL` for anyone who inspects it. `command` returns a Command, not a Result,
/// so a refusal there has to be one that never runs git.
fn never_runs(reason: &str) -> Command {
    let mut cmd = crate::winproc::command("kolux-refused-git-read"); // T-816: hidden like every spawn
    cmd.env("KOLUX_REFUSAL", reason);
    cmd
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
    TRUST_FILES.with(|f| f.borrow().clone()).unwrap_or_else(|| (std::env::temp_dir().join("kolux-test-no-claude.json"), std::env::temp_dir().join("kolux-test-no-codex.toml")))
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
    let file = std::env::temp_dir().join(format!("kolux-test-trust-{}-{nanos}.json", std::process::id()));
    std::fs::write(&file, serde_json::Value::Object(doc).to_string()).unwrap();
    TRUST_FILES.with(|f| *f.borrow_mut() = Some((file, std::env::temp_dir().join("kolux-test-no-codex.toml"))));
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
/// and no `host:path` scp form; before the colon, Git for Windows' own drive rule (`has_dos_drive_prefix`):
/// any one ASCII byte, or one to four bytes with the high bit set, so `ä:/x`, `1:x`, `_:x`, `€:x` and `😀:x`
/// are paths to it, review fix 8 follow-up P3; Kolux applies the rule on every platform, fail-safe).
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
            let bytes = url.as_bytes();
            if bytes[0] & 0x80 == 0 {
                c == 1
            } else {
                let mut i = 1;
                while i < 4 && i < bytes.len() && bytes[i] & 0x80 != 0 {
                    i += 1;
                }
                c == i
            }
        }
        _ => true,
    }
}

/// The plain refusal (DT-C241): what Kolux did not run, why, and what to do about it.
fn refusal(args: &[&str], dir: &Path, what: &str) -> String {
    let rest = after_options(args);
    let verb = rest.iter().take(if rest.first() == Some(&"worktree") { 2 } else { 1 }).copied().collect::<Vec<_>>().join(" ");
    format!("Kolux did not run `git {verb}` in {}: {what}, and the folder is not trusted. Trust the folder (open an agent in it and accept its trust prompt), then try again.", dir.display())
}

/// What a run of `args` in `dir` may do with the repository's own program keys, decided from the
/// keys already listed (DT-C241). A read has them blanked. A write that runs clean or smudge
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

/// S4 (DT-C241): the ssh and proxy commands a folder's own config names (`core.sshCommand`,
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
    if let Some(what) = unreadable_program_key(&found, dir) {
        return Err(refusal(args, dir, &what));
    }
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
    if let Some(what) = cwd.and_then(|dir| unreadable_program_key(&found, dir).map(|what| refusal(args, dir, &what))) {
        return never_runs(&what);
    }
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
        cmd.creation_flags(crate::winproc::no_window());
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
    let _ = std::process::Command::new("attrib").arg("+h").arg(p).creation_flags(crate::winproc::no_window()).output();
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
    /// P2: the old path of a staged rename or copy (code `R` or `C`), as full as `path`; left out otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
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
        // the old name follows a rename or a copy
        let from = if x == 'R' || x == 'C' { parts.next().map(|old| worktree.join(native(old)).to_string_lossy().into_owned()) } else { None };
        let path = worktree.join(native(&entry[3..])).to_string_lossy().into_owned();
        if !matches!(x, ' ' | '?' | '!') {
            list.push(Change { path: path.clone(), staged: true, code: x, from });
        }
        if !matches!(y, ' ' | '!') {
            list.push(Change { path, staged: false, code: y, from: None });
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

    /// Finds git on the path; the version is shown to the user. The first version read is kept for
    /// the process (c2-agents audit 22: every status read, auto-PR check and test used to start its
    /// own `git --version`); a failed read is not kept, so a Git installed later is still found.
    pub fn detect() -> Result<Git, String> {
        static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        if let Some(v) = VERSION.get() {
            return Ok(Git { version: v.clone() });
        }
        let version = run(&["--version"], None).map_err(|e| format!("Git is not available: {e}"))?;
        Ok(Git { version: VERSION.get_or_init(|| version).clone() })
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
                    return Entry { path: c.path, staged: false, code: c.code, lines, binary, stamp: disk, from: None };
                }
                let s = (if c.staged { &staged } else { &unstaged }).get(&rel).cloned().unwrap_or_default();
                let stamp = if c.staged { s.ids } else { format!("{}|{disk}", s.ids) };
                Entry { path: c.path, staged: c.staged, code: c.code, lines: s.lines, binary: s.binary, stamp, from: c.from }
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
    /// P2: the old path of a staged rename or copy (see `Change::from`); left out otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
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
            Entry { path, staged: false, code: s.code, lines: s.lines, binary: s.binary, stamp: format!("{since}:{}|{disk}", s.ids), from: None }
        })
        .collect();
    let untracked = output(&["ls-files", "--others", "--exclude-standard", "-z"], Some(worktree))?;
    for rel in String::from_utf8_lossy(&untracked).split('\0').filter(|r| !r.is_empty()) {
        let path = worktree.join(native(rel)).to_string_lossy().into_owned();
        let disk = std::fs::metadata(&path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
        let (lines, binary) = whole_file(&path);
        out.push(Entry { path, staged: false, code: '?', lines, binary, stamp: disk, from: None });
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
#[path = "git_tests.rs"]
mod tests;
