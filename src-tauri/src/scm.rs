//! GIT-002 / GIT-003 / GIT-004 / GIT-006 / GIT-007: the Source Control panel's back end: what one
//! worktree has changed, staging and unstaging by path, discarding work, committing, and the remote actions (push, pull,
//! sync, fetch, fast-forward, force push with lease, publish, rebase from base). Every call names
//! the worktree it acts on, so one workspace's index is never touched from another's panel.
//! Reading status never touches the network: the ahead / behind counts come from the refs git
//! already has, so an unpublished branch is not checked against the remote over and over.

use crate::git::{command, native, output, run, Git};

#[path = "scm_watch.rs"]
pub mod watch;
// GIT-018 / GIT-020 / GIT-022 (T-228-d): the writer agents, branch naming and review text.
#[path = "scm_writers.rs"]
pub mod writers;
// Row 917: the provider-neutral repository id that keys the per-repository AI switch.
#[path = "scm_repo_id.rs"]
pub mod repo_id;
use std::fs;
use std::io::Write;
use std::path::{Component, Path};

/// One changed file. `status` is a single letter: M modified, A added, D deleted, R renamed
/// (`from` holds the old path), C copied, T type changed, U untracked, X unmerged.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub status: String,
    pub from: Option<String>,
}

/// A worktree's state as the panel shows it, from `git status --porcelain=v2 --branch -z`.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// None while HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    /// The remote the upstream sits on, as Git names it (the name may hold a slash, so `upstream`
    /// alone cannot say); None without an upstream or when the upstream is a local branch.
    pub upstream_remote: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// GIT-006: the branch differs from its upstream only by commits whose patches it already
    /// holds, as after a rebase, so a force push with lease loses nothing.
    pub rewritten: bool,
    /// The branch work rebases onto (origin's HEAD, else main or master); None without one.
    pub base: Option<String>,
    /// The commit HEAD points at; None before the first commit. VIEW-068 refreshes on a change.
    pub head: Option<String>,
    pub staged: Vec<Change>,
    pub changed: Vec<Change>,
    pub untracked: Vec<Change>,
    pub conflicts: Vec<Change>,
    /// GIT-015: the operation stopped part-way (merge, rebase, cherry-pick or revert); None
    /// when there is none.
    pub operation: Option<String>,
    /// GIT-015: conflicted files whose clash markers are gone, so they only need staging.
    pub resolved: Vec<String>,
    /// GIT-001: the lines each file adds and removes, per section; a binary file has no entry.
    pub lines: LineCounts,
    /// GIT-013: each changed submodule's path with what changed in it ("new commits", "changed
    /// files", "untracked files", joined with commas); git already gives one row per submodule.
    pub submodules: std::collections::BTreeMap<String, String>,
    /// GIT-013: submodule rows left out past `SUBMODULE_ROWS`, for the panel's note.
    pub submodules_cut: u32,
    /// GIT-012: how many changes the panel's lists leave out (each list shows its first
    /// `PANEL_CAP`); 0 when nothing is cut.
    pub cut: usize,
    /// GIT-012: heavy folders (dependencies, build output) at the top of the worktree that are
    /// not ignored yet; looked for only when the lists are cut.
    pub heavy: Vec<String>,
}

/// GIT-012: the most rows one section of the panel lists.
pub const PANEL_CAP: usize = 1_000;
/// GIT-012: folders that hold dependencies or build output, offered for the ignore file.
pub const HEAVY: [&str; 12] = ["node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".gradle", "obj", "coverage"];

/// GIT-012: the panel's view of a status: each section cut to `PANEL_CAP` rows and, when that cuts
/// anything, the heavy folders that exist and are not ignored yet.
pub fn capped(mut st: Status, worktree: &Path) -> Status {
    for list in [&mut st.staged, &mut st.changed, &mut st.untracked] {
        st.cut += list.len().saturating_sub(PANEL_CAP);
        list.truncate(PANEL_CAP);
    }
    if st.cut > 0 {
        st.heavy = heavy_folders(worktree);
    }
    st
}

/// GIT-012: the heavy folders (see `HEAVY`) that exist at the top of the worktree and are not
/// ignored yet. `git check-ignore` exits 0 for an ignored path and 1 for one that is not.
pub(crate) fn heavy_folders(worktree: &Path) -> Vec<String> {
    HEAVY.iter().filter(|h| worktree.join(h).is_dir() && command(&["check-ignore", "-q", &format!("{h}/")], Some(worktree)).status().is_ok_and(|s| s.code() == Some(1))).map(|h| h.to_string()).collect()
}

/// GIT-012: adds a `/<folder>/` line to the worktree's `.gitignore` for each named heavy folder,
/// making the file when there is none. Only names from `HEAVY` are taken.
pub fn ignore_heavy(worktree: &Path, folders: &[String]) -> Result<(), String> {
    if folders.is_empty() || folders.iter().any(|f| !HEAVY.contains(&f.as_str())) {
        return Err("Only dependency and build folders can be added to the ignore file here".into());
    }
    let file = worktree.join(".gitignore");
    let had = fs::read_to_string(&file).unwrap_or_default();
    let mut add = String::new();
    if !had.is_empty() && !had.ends_with('\n') {
        add.push('\n');
    }
    for f in folders {
        if !had.lines().any(|l| l.trim() == format!("/{f}/")) {
            add.push_str(&format!("/{f}/\n"));
        }
    }
    fs::OpenOptions::new().create(true).append(true).open(&file).and_then(|mut w| w.write_all(add.as_bytes())).map_err(|e| format!("could not write {}: {e}", file.display()))
}

type Shared = std::sync::Arc<(std::sync::Mutex<Option<Result<Status, String>>>, std::sync::Condvar)>;
type Running = std::sync::Mutex<Vec<(std::path::PathBuf, Shared)>>;

/// Hands the answer to everyone waiting on it and takes the read off the running list, even when
/// the read itself panicked.
struct Publish<'a>(&'a Running, &'a Path, Shared);

impl Drop for Publish<'_> {
    fn drop(&mut self) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).retain(|(p, _)| p != self.1);
        let mut slot = self.2 .0.lock().unwrap_or_else(|e| e.into_inner());
        slot.get_or_insert_with(|| Err("The status read stopped; refresh to try again".into()));
        self.2 .1.notify_all();
    }
}

/// GIT-070: a status read of a worktree that another caller is already reading waits for that
/// answer instead of starting git again.
fn shared(running: &Running, worktree: &Path, read: impl FnOnce() -> Result<Status, String>) -> Result<Status, String> {
    let (first, s) = {
        let mut r = running.lock().unwrap_or_else(|e| e.into_inner());
        match r.iter().find(|(p, _)| p == worktree) {
            Some((_, s)) => (false, s.clone()),
            None => {
                let s = Shared::default();
                r.push((worktree.to_path_buf(), s.clone()));
                (true, s)
            }
        }
    };
    if first {
        let publish = Publish(running, worktree, s.clone());
        let answer = read();
        *s.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(answer.clone());
        drop(publish);
        return answer;
    }
    let mut slot = s.0.lock().unwrap_or_else(|e| e.into_inner());
    while slot.is_none() {
        slot = s.1.wait(slot).unwrap_or_else(|e| e.into_inner());
    }
    slot.clone().unwrap_or_else(|| Err("The status read stopped; refresh to try again".into()))
}

/// GIT-013: at most this many changed submodules are listed; the rest are counted in the note.
pub const SUBMODULE_ROWS: usize = 50;

/// GIT-013: what the `S<c><m><u>` field of a status line says changed inside a submodule; None
/// for an ordinary file (`N...`).
pub fn submodule_state(field: &str) -> Option<String> {
    let f = field.strip_prefix('S')?.as_bytes();
    let words: Vec<&str> = [(0, b'C', "new commits"), (1, b'M', "changed files"), (2, b'U', "untracked files")]
        .into_iter()
        .filter(|(i, c, _)| f.get(*i) == Some(c))
        .map(|(_, _, w)| w)
        .collect();
    Some(if words.is_empty() { "changed".to_string() } else { words.join(", ") })
}

/// GIT-001: `[added, removed]` by path for the staged, changed and untracked sections.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct LineCounts {
    pub staged: std::collections::BTreeMap<String, [u32; 2]>,
    pub changed: std::collections::BTreeMap<String, [u32; 2]>,
    pub untracked: std::collections::BTreeMap<String, [u32; 2]>,
}

/// `git diff --numstat -M -z` output by path; a rename is keyed by its new path and a binary
/// file ("-" for both counts) is left out.
fn numstat(text: &str) -> std::collections::BTreeMap<String, [u32; 2]> {
    let mut out = std::collections::BTreeMap::new();
    let mut f = text.split('\0');
    while let Some(head) = f.next() {
        let mut p = head.splitn(3, '\t');
        let (Some(a), Some(r), Some(path)) = (p.next(), p.next(), p.next()) else { continue };
        // A rename leaves the path empty and gives the old and new paths as the next two fields.
        let path = if path.is_empty() { f.nth(1).unwrap_or_default() } else { path };
        if let (Ok(a), Ok(r)) = (a.parse(), r.parse()) {
            out.insert(path.to_string(), [a, r]);
        }
    }
    out
}

/// An untracked file's lines, the last one counted without its newline; None for a binary file
/// (a NUL byte) or one over a megabyte.
fn file_lines(path: &Path) -> Option<u32> {
    if std::fs::metadata(path).ok()?.len() > 1_000_000 {
        return None;
    }
    let b = std::fs::read(path).ok()?;
    if b.contains(&0) {
        return None;
    }
    Some(b.iter().filter(|&&c| c == b'\n').count() as u32 + u32::from(b.last().is_some_and(|&c| c != b'\n')))
}

/// What a commit attempt came to: `id` is the new commit when it worked; otherwise `output` is
/// what git and its hooks printed, and `blocked` says a hook refused it.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcome {
    pub id: Option<String>,
    pub blocked: bool,
    pub output: String,
}

pub fn status(worktree: &Path) -> Result<Status, String> {
    static RUNNING: Running = std::sync::Mutex::new(Vec::new());
    shared(&RUNNING, worktree, || read_status(worktree))
}

fn read_status(worktree: &Path) -> Result<Status, String> {
    // Every untracked file by name, not a collapsed folder, so each can be staged on its own.
    // GIT-070: a short read, so it takes the worktree's turn and has a time limit.
    let out = output(&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], Some(worktree))?;
    let mut st = parse_status(&String::from_utf8_lossy(&out));
    if let (Some(branch), Some(_)) = (st.branch.as_deref(), st.upstream.as_deref()) {
        st.upstream_remote = run(&["config", "--get", &format!("branch.{branch}.remote")], Some(worktree)).ok().map(|t| t.trim().to_string()).filter(|r| !r.is_empty() && r != ".");
    }
    if st.upstream.is_some() && st.behind > 0 {
        // Every upstream-only commit marked `-` has an identical patch in HEAD.
        st.rewritten = run(&["cherry", "HEAD", "@{upstream}"], Some(worktree)).is_ok_and(|t| !t.is_empty() && t.lines().all(|l| l.starts_with('-')));
    }
    st.base = Git::detect().ok().and_then(|g| g.default_branch(worktree));
    st.operation = operation(worktree);
    st.lines.staged = run(&["diff", "--cached", "--numstat", "-M", "-z"], Some(worktree)).map(|t| numstat(&t)).unwrap_or_default();
    st.lines.changed = run(&["diff", "--numstat", "-z"], Some(worktree)).map(|t| numstat(&t)).unwrap_or_default();
    // ponytail: the first 2 000 untracked files are counted; a folder of thousands shows the rest bare.
    st.lines.untracked = st.untracked.iter().take(2_000).filter_map(|c| Some((c.path.clone(), [file_lines(&worktree.join(&c.path))?, 0]))).collect();
    st.resolved = st
        .conflicts
        .iter()
        .filter(|c| matches!(c.status.as_str(), "UU" | "AA"))
        .filter(|c| std::fs::read_to_string(worktree.join(&c.path)).is_ok_and(|t| !t.lines().any(|l| l.starts_with("<<<<<<<"))))
        .map(|c| c.path.clone())
        .collect();
    Ok(st)
}

/// GIT-015: which operation is stopped part-way, from the markers git leaves in this worktree's
/// own git folder (a linked worktree has its own).
fn operation(worktree: &Path) -> Option<String> {
    const MARKS: [(&str, &str); 5] = [("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")];
    let mut args = vec!["rev-parse"];
    for (mark, _) in MARKS {
        args.extend(["--git-path", mark]);
    }
    let out = run(&args, Some(worktree)).ok()?;
    out.lines().zip(MARKS).find(|(p, _)| worktree.join(p.trim()).exists()).map(|(_, (_, op))| op.to_string())
}

/// GIT-015: aborts whichever operation is in progress, putting the worktree back where it was
/// before it began.
pub fn abort(worktree: &Path) -> Result<(), String> {
    let op = operation(worktree).ok_or("Nothing to abort: no merge, rebase, cherry-pick or revert is in progress")?;
    run(&[op.as_str(), "--abort"], Some(worktree)).map(|_| ())
}

/// GIT-065: whether a workspace's commits are on its remote, for the sidebar badge. `state` is
/// synced, ahead (`count` commits not pushed), unpublished (no upstream; `count` commits past the
/// base) or unknown (the count could not be read, which is never shown as synced).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Pushed {
    pub path: String,
    pub state: &'static str,
    pub count: u32,
}

/// GIT-065: None while HEAD is detached. Reads only refs git already has, never the network.
pub fn pushed(worktree: &Path) -> Option<Pushed> {
    run(&["symbolic-ref", "-q", "HEAD"], Some(worktree)).ok()?;
    let count = |range: &str| run(&["rev-list", "--count", range], Some(worktree)).ok().and_then(|n| n.parse::<u32>().ok());
    let (state, n) = if run(&["rev-parse", "--verify", "-q", "@{upstream}"], Some(worktree)).is_ok() {
        match count("@{upstream}..HEAD") {
            Some(0) => ("synced", Some(0)),
            n => ("ahead", n),
        }
    } else {
        ("unpublished", Git::detect().ok().and_then(|g| g.default_branch(worktree)).and_then(|b| count(&format!("{b}..HEAD"))))
    };
    let path = worktree.display().to_string();
    Some(match n {
        Some(count) => Pushed { path, state, count },
        None => Pushed { path, state: "unknown", count: 0 },
    })
}

/// GIT-065: the badge for each listed workspace, read off the UI thread (the sidebar asks every
/// few seconds).
#[tauri::command]
pub async fn scm_pushed(worktrees: Vec<String>) -> Vec<Pushed> {
    tauri::async_runtime::spawn_blocking(move || worktrees.iter().filter_map(|w| pushed(Path::new(w))).collect()).await.unwrap_or_default()
}

/// TERM-022: what the pane header's branch chip reads: the branch, else the commit a detached
/// HEAD is on (None before the first commit). None for a folder outside git.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Head {
    pub branch: Option<String>,
    pub head: Option<String>,
}

pub fn head_of(dir: &Path) -> Option<Head> {
    run(&["rev-parse", "--git-dir"], Some(dir)).ok()?;
    let branch = run(&["symbolic-ref", "-q", "--short", "HEAD"], Some(dir)).ok().filter(|b| !b.is_empty());
    Some(Head { branch, head: run(&["rev-parse", "-q", "--verify", "HEAD"], Some(dir)).ok().filter(|h| !h.is_empty()) })
}

/// TERM-022: read off the UI thread; every pane asks when it shows and when it takes focus.
#[tauri::command]
pub async fn scm_head(dir: String) -> Option<Head> {
    tauri::async_runtime::spawn_blocking(move || head_of(Path::new(&dir))).await.ok().flatten()
}

/// Lines added and removed in one row of the branch summary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Lines {
    pub added: u64,
    pub removed: u64,
}

/// VIEW-068: the branch against the ref it is measured with: commits ahead and behind, and the
/// lines its commits changed since they parted, split into source, tests and generated files.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub against: String,
    pub ahead: u32,
    pub behind: u32,
    pub source: Lines,
    pub tests: Lines,
    pub generated: Lines,
    /// GIT-011: how many files the branch's own commits touched since it parted from the base.
    pub files: u32,
    /// GIT-011: those files, the first `COMMITTED_CAP` of them.
    pub committed: Vec<Change>,
    /// GIT-011: the branch touched more files than `LINES_FILE_CAP`, so its lines were not counted
    /// (the totals read zero and the window says so).
    pub lines_skipped: bool,
}

/// GIT-011: the most committed files sent to the window; the count stays whole.
const COMMITTED_CAP: usize = 1000;

/// GIT-011: a branch touching more files than this gets no line totals; counting them would stall the panel.
pub const LINES_FILE_CAP: u32 = 20_000;

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    Source,
    Tests,
    Generated,
}

/// Which row of the summary a changed path counts in.
/// ponytail: names only (lock files, minified files, snapshots, a `generated` folder); reading
/// `linguist-generated` from .gitattributes comes when a repository needs it.
fn kind(path: &str) -> Kind {
    let parts: Vec<&str> = path.split('/').collect();
    let file = parts.last().copied().unwrap_or("");
    const LOCKS: [&str; 10] = ["Cargo.lock", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "poetry.lock", "Gemfile.lock", "composer.lock", "go.sum", "uv.lock"];
    if LOCKS.contains(&file) || [".min.js", ".min.css", ".map", ".snap"].iter().any(|e| file.ends_with(e)) || file.contains(".generated.") || parts.iter().any(|p| ["generated", "__generated__", "__snapshots__"].contains(p)) {
        return Kind::Generated;
    }
    let dirs = &parts[..parts.len().saturating_sub(1)];
    if dirs.iter().any(|p| ["test", "tests", "__tests__", "spec", "specs"].contains(p)) || [".test.", ".spec."].iter().any(|m| file.contains(m)) || file.starts_with("test_") || file.split('.').next().is_some_and(|stem| stem.ends_with("_test")) {
        return Kind::Tests;
    }
    Kind::Source
}

/// CLI-021: every file `worktree` differs from `base` in, committed and uncommitted work together
/// (untracked files as `U`). Committed work counts from where the branch parted from the base, or
/// from the base itself when they share no history; with no base, only the uncommitted work.
pub fn changes(worktree: &Path, base: Option<&str>) -> Result<Vec<Change>, String> {
    let since = match base {
        Some(b) => run(&["merge-base", b, "HEAD"], Some(worktree)).unwrap_or_else(|_| b.to_string()),
        None => "HEAD".to_string(),
    };
    let mut out = Vec::new();
    let diff = run(&["diff", "--name-status", "--no-renames", "-z", &since, "--"], Some(worktree))?;
    let mut parts = diff.split('\0').filter(|s| !s.is_empty());
    while let (Some(st), Some(path)) = (parts.next(), parts.next()) {
        out.push(Change { path: path.to_string(), status: st.chars().take(1).collect(), from: None });
    }
    for path in run(&["ls-files", "--others", "--exclude-standard", "-z"], Some(worktree))?.split('\0').filter(|s| !s.is_empty()) {
        out.push(Change { path: path.to_string(), status: "U".into(), from: None });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// CLI-021: would two committed tips merge cleanly? Never "clean" unless Git said so.
#[derive(Debug, PartialEq, Eq)]
pub enum Clash {
    Clean,
    Conflict(Vec<String>),
    Unverifiable(String),
}

pub fn clash(repo: &Path, a: &str, b: &str) -> Clash {
    match command(&["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b], Some(repo)).output() {
        Err(e) => Clash::Unverifiable(format!("could not run git: {e}")),
        Ok(o) => clash_of(o.status.code(), &String::from_utf8_lossy(&o.stdout), &String::from_utf8_lossy(&o.stderr)),
    }
}

/// `git merge-tree --write-tree`: 0 merges cleanly, 1 conflicts (the tree id, then the files);
/// anything else (an old Git, unrelated histories, a missing commit) cannot be checked.
fn clash_of(code: Option<i32>, out: &str, err: &str) -> Clash {
    match code {
        Some(0) => Clash::Clean,
        Some(1) => Clash::Conflict(out.lines().skip(1).take_while(|l| !l.is_empty()).map(String::from).collect()),
        _ => Clash::Unverifiable(err.lines().next().map(str::trim).filter(|l| !l.is_empty()).unwrap_or("git could not check the merge").to_string()),
    }
}

/// VIEW-068: a base pinned for the repository wins; otherwise the branch's upstream when
/// `upstream` is on and there is one, else the default branch. Lines count the commits since the
/// branch parted from that ref, so the ref's own new commits show only as "behind".
pub fn summary(worktree: &Path, pinned: Option<&str>, upstream: bool) -> Result<Summary, String> {
    summary_capped(worktree, pinned, upstream, LINES_FILE_CAP)
}

/// `summary` with the file count past which line totals are given up on.
pub fn summary_capped(worktree: &Path, pinned: Option<&str>, upstream: bool, lines_cap: u32) -> Result<Summary, String> {
    let st = status(worktree)?;
    let pinned = pinned.map(str::trim).filter(|p| !p.is_empty() && run(&["rev-parse", "--verify", "-q", &format!("{p}^{{commit}}")], Some(worktree)).is_ok());
    let against = pinned.map(String::from).or(if upstream { st.upstream.clone() } else { None }).or(st.base.clone()).ok_or("no base branch to compare with")?;
    let range = format!("{against}...HEAD");
    let counts = run(&["rev-list", "--left-right", "--count", &range], Some(worktree))?;
    let mut n = counts.split_whitespace().map(|x| x.parse::<u32>().unwrap_or(0));
    let (behind, ahead) = (n.next().unwrap_or(0), n.next().unwrap_or(0));
    let mut s = Summary { against, ahead, behind, ..Summary::default() };
    // ponytail: an enormous branch still counts every line; a time limit on the counting comes
    // when a real branch stalls the panel.
    s.committed = name_status(&run(&["diff", "--name-status", "-M", "-z", &range], Some(worktree))?);
    s.files = s.committed.len() as u32;
    s.committed.truncate(COMMITTED_CAP);
    if s.files > lines_cap {
        s.lines_skipped = true;
        return Ok(s);
    }
    for line in run(&["diff", "--numstat", "--no-renames", "-z", &range], Some(worktree))?.split('\0').filter(|l| !l.is_empty()) {
        let mut f = line.splitn(3, '\t');
        let (Some(a), Some(r), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        // A binary file shows "-" for both counts and adds no lines.
        let row = match kind(path) {
            Kind::Source => &mut s.source,
            Kind::Tests => &mut s.tests,
            Kind::Generated => &mut s.generated,
        };
        row.added += a.parse().unwrap_or(0);
        row.removed += r.parse().unwrap_or(0);
    }
    Ok(s)
}

/// What a remote action came to: `ok`, and everything git printed either way.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    pub ok: bool,
    pub output: String,
    /// GIT-009: what kind of failure it was (see `failure_kind`); None when it worked.
    pub kind: Option<&'static str>,
    /// GIT-009: for a hook failure, what an agent is handed: the end of the hook's output with
    /// colour codes removed and a capped list of the files in the push.
    pub detail: Option<String>,
}

/// GIT-009: sorts a failed push, pull or fetch by what git and the remote printed: protected,
/// sign-in, network, submodule, non-fast-forward, hook (a remote hook, or a local pre-push hook
/// when `local_hook` says one ran) or other.
pub fn failure_kind(output: &str, local_hook: bool) -> &'static str {
    let t = output.to_lowercase();
    let any = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if any(&["protected branch", "gh006", "gl-protected"]) {
        "protected"
    } else if any(&["authentication failed", "could not read username", "could not read password", "terminal prompts disabled", "permission denied (publickey", "invalid username or password", "returned error: 403", "returned error: 401"]) {
        "sign-in"
    } else if any(&["could not resolve host", "connection refused", "connection timed out", "timed out", "network is unreachable", "failed to connect", "connection reset"]) {
        "network"
    } else if any(&["divergent branches", "how to reconcile"]) {
        // GIT-008: git has no pull policy for split histories; the panel offers the three.
        "no-policy"
    } else if t.contains("submodule") {
        "submodule"
    } else if any(&["non-fast-forward", "(fetch first)", "[rejected]", "stale info"]) {
        "non-fast-forward"
    } else if t.contains("hook declined") || local_hook {
        "hook"
    } else {
        "other"
    }
}

/// Removes terminal colour and cursor codes (ESC [ ... letter) from hook output.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// GIT-009: the end of the hook output (40 lines at most) and the files the push carries (30 at
/// most), for the agent asked to fix it.
fn hook_detail(worktree: &Path, output: &str, against: Option<&str>) -> String {
    let text = plain(output);
    let lines: Vec<&str> = text.lines().collect();
    let tail = lines[lines.len().saturating_sub(40)..].join("\n");
    let range = format!("{}..HEAD", against.unwrap_or("HEAD~1"));
    let files: Vec<String> = run(&["diff", "--name-only", &range], Some(worktree)).unwrap_or_default().lines().map(String::from).collect();
    let mut shown: Vec<String> = files.iter().take(30).map(|f| format!("- {f}")).collect();
    if files.len() > 30 {
        shown.push(format!("- and {} more", files.len() - 30));
    }
    format!("{tail}\n\nFiles in this push:\n{}", shown.join("\n"))
}

/// UX-D: how long one network git step (push, pull, fetch) may run before Kolux stops it. Local steps
/// (a rebase) have no limit: stopping one halfway can leave index.lock or rebase state behind.
const REMOTE_LIMIT: std::time::Duration = std::time::Duration::from_secs(600);

/// What a timed network git step came to; `timed_out` says Kolux stopped it.
struct NetOut {
    success: bool,
    timed_out: bool,
    stdout: String,
    stderr: String,
}

/// UX-D: a git step with every prompt off (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never), no
/// standard input, and a time limit: a step that has not finished by `limit` is stopped with its
/// whole tree (ssh and the remote helpers included), so a hidden credential prompt can never hang
/// the app. Saved credentials still work. `None` is no limit, for local steps that must not be cut
/// off halfway.
fn git_network(args: &[&str], worktree: &Path, limit: Option<std::time::Duration>) -> Result<NetOut, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = command(args, Some(worktree)).envs(crate::git::NO_PROMPT).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    // Each pipe is read on its own thread into a shared buffer; the channel says it reached its end.
    let drain = |mut r: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let into = seen.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            while let Ok(n) = r.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                into.lock().unwrap_or_else(|e| e.into_inner()).extend_from_slice(&chunk[..n]);
            }
            let _ = tx.send(());
        });
        (rx, seen)
    };
    let (out, partial_out) = drain(Box::new(child.stdout.take().expect("piped")));
    let (err, partial_err) = drain(Box::new(child.stderr.take().expect("piped")));
    let deadline = limit.map(|l| std::time::Instant::now() + l);
    let (success, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (status.success(), false),
            Ok(None) if deadline.is_some_and(|d| std::time::Instant::now() >= d) => {
                crate::procs::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break (false, true);
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
            Err(e) => return Err(format!("could not wait for git: {e}")),
        }
    };
    // A program git started may still hold a pipe after git is gone (or was stopped): wait a moment,
    // then go on with whatever was read so far instead of losing it all.
    let grace = std::time::Duration::from_secs(if timed_out { 1 } else { 2 });
    let (stdout, stderr) = (pipe_text(&out, &partial_out, grace), pipe_text(&err, &partial_err, grace));
    Ok(NetOut { success, timed_out, stdout, stderr })
}

/// The text a pipe gave: waits up to `grace` for its end, then keeps whatever has come so far.
fn pipe_text(done: &std::sync::mpsc::Receiver<()>, seen: &std::sync::Mutex<Vec<u8>>, grace: std::time::Duration) -> String {
    let _ = done.recv_timeout(grace);
    String::from_utf8_lossy(&seen.lock().unwrap_or_else(|e| e.into_inner())).to_string()
}

/// UX-D: the sentence for a network step Kolux stopped; "timed out" sorts it as a network failure.
fn timed_out_note(args: &[&str], limit: std::time::Duration) -> String {
    format!("git {} timed out after {} seconds: the step took too long, so Kolux stopped it. Causes include a slow remote, a large push, a slow pre-push hook, or a sign-in that cannot be shown here (sign in with your git credential helper, then try again).", args.first().copied().unwrap_or("push"), limit.as_secs())
}

/// GIT-007: one remote action against the branch's own remote, never a target of its own:
/// `publish` pushes to origin and makes it the upstream, `force` always carries a lease, `sync`
/// is pull then push, `ff` pulls fast-forward only, `rebase` fetches and rebases onto the base
/// branch, and the rest are git's plain forms, so the user's own pull and push settings apply.
/// The output of every step is kept; a failing step stops the rest.
pub fn remote(worktree: &Path, action: &str) -> Result<ActionOutcome, String> {
    remote_within(worktree, action, REMOTE_LIMIT)
}

/// `remote` with the time limit of each git step given, so a test can use a short one.
fn remote_within(worktree: &Path, action: &str, limit: std::time::Duration) -> Result<ActionOutcome, String> {
    let st = status(worktree)?;
    let branch = st.branch.clone().ok_or("no branch checked out")?;
    let base = st.base.clone();
    // GIT-010: a branch taken from a fork's pull request pushes to the fork's branch of its name there.
    let target = matches!(action, "push" | "sync" | "pullpush" | "force").then(|| crate::pr_checkout::push_target(worktree)).flatten();
    let (plain_push, lease_push) = (crate::pr_checkout::push_args(target.as_ref(), false), crate::pr_checkout::push_args(target.as_ref(), true));
    let (plain_push, lease_push): (Vec<&str>, Vec<&str>) = (plain_push.iter().map(String::as_str).collect(), lease_push.iter().map(String::as_str).collect());
    let steps: Vec<Vec<&str>> = match action {
        "push" => vec![plain_push],
        "pull" => vec![vec!["pull"]],
        "sync" => vec![vec!["pull"], plain_push],
        // GIT-005: the last step of commit then pull and push: the new commit is rebased onto
        // what the remote gained, then pushed.
        "pullpush" => vec![vec!["pull", "--rebase"], plain_push],
        "fetch" => vec![vec!["fetch"]],
        "ff" => vec![vec!["pull", "--ff-only"]],
        // GIT-008: the pull again with the policy the user picked from the notice.
        "pullmerge" => vec![vec!["pull", "--no-rebase"]],
        "pullrebase" => vec![vec!["pull", "--rebase"]],
        "force" => vec![lease_push],
        "publish" => vec![vec!["push", "--set-upstream", "origin", &branch]],
        "rebase" => vec![vec!["fetch"], vec!["rebase", base.as_deref().ok_or("no base branch to rebase from")?]],
        other => return Err(format!("unknown remote action {other}")),
    };
    let mut output = String::new();
    for args in steps {
        // A rebase is local work: it runs to its end, since stopping it halfway can leave index.lock
        // or rebase state behind. Every other step is network and keeps the limit.
        let local = args[0] == "rebase";
        let out = git_network(&args, worktree, (!local).then_some(limit))?;
        output.push_str(out.stdout.trim());
        output.push_str(out.stderr.trim());
        if out.timed_out {
            output.push_str(&timed_out_note(&args, limit));
        }
        output.push('\n');
        if !out.success {
            let pushing = args[0] == "push";
            let hooks = run(&["rev-parse", "--git-path", "hooks"], Some(worktree)).map(|d| worktree.join(native(&d))).ok();
            let local_hook = pushing && hooks.is_some_and(|d| d.join("pre-push").is_file());
            let kind = failure_kind(&output, local_hook);
            let detail = (kind == "hook").then(|| hook_detail(worktree, &output, st.upstream.as_deref().or(base.as_deref())));
            return Ok(ActionOutcome { ok: false, output: plain(output.trim()), kind: Some(kind), detail });
        }
    }
    Ok(ActionOutcome { ok: true, output: output.trim().to_string(), kind: None, detail: None })
}

/// GIT-021: a branch's pull request as `gh pr view --json number,url,state` gives it; `state`
/// is OPEN, MERGED or CLOSED.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pr {
    pub number: u64,
    pub url: String,
    pub state: String,
    #[serde(default)]
    pub title: Option<String>,
    /// GIT-025: the branch the pull request is for, so a hand link to another branch is flagged.
    #[serde(alias = "headRefName", default)]
    pub head: Option<String>,
    #[serde(alias = "isDraft", default)]
    pub draft: bool,
}

/// What every lookup asks gh for.
pub(crate) const PR_FIELDS: &str = "number,url,state,title,headRefName,isDraft";

/// The GitHub CLI, which carries the user's sign-in and works with GitHub Enterprise Server too.
/// GIT-060: a GitHub (or GitHub Enterprise) repository named by a remote. `api` is the REST
/// address (api.github.com, or `/api/v3` on an Enterprise host); `key` is one per project, so
/// checkouts with different remote forms group together.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct GhRepo {
    pub host: String,
    pub owner: String,
    pub name: String,
    pub api: String,
    pub key: String,
}

impl GhRepo {
    fn new(host: String, owner: &str, name: &str) -> Self {
        let api = if host.eq_ignore_ascii_case("github.com") { "https://api.github.com".into() } else { format!("https://{host}/api/v3") };
        let key = format!("{host}/{owner}/{name}").to_lowercase();
        GhRepo { host, owner: owner.to_string(), name: name.to_string(), api, key }
    }
}

/// The real host an SSH alias stands for, from `Host` / `HostName` lines; wildcard blocks and
/// `Include` are not followed.
// ponytail: plain Host blocks only; Include and Match come if someone's config needs them.
fn ssh_host(alias: &str, config: &str) -> Option<String> {
    let mut hit = false;
    for line in config.lines().map(str::trim) {
        let (key, rest) = line.split_once(|c: char| c.is_whitespace() || c == '=').unwrap_or((line, ""));
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();
        if key.eq_ignore_ascii_case("host") {
            hit = rest.split_whitespace().any(|h| h == alias);
        } else if hit && key.eq_ignore_ascii_case("hostname") && !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    None
}

/// GIT-060: reads HTTPS, SSH (`ssh://` or `user@host:path`), `git://` and SSH-alias remotes.
/// `ssh_config` is the text of the user's SSH config, used only for SSH forms.
pub fn github_repo(url: &str, ssh_config: &str) -> Option<GhRepo> {
    let url = url.trim();
    let (host, path, ssh) = if let Some((scheme, rest)) = url.split_once("://") {
        let ssh = match scheme {
            "https" | "http" | "git" => false,
            "ssh" | "git+ssh" => true,
            _ => return None,
        };
        let (auth, path) = rest.split_once('/')?;
        let host = auth.rsplit('@').next()?.split(':').next()?;
        (host, path, ssh)
    } else {
        // scp form; one letter before the colon is a Windows drive, not a host.
        let (auth, path) = url.split_once(':')?;
        let host = auth.rsplit('@').next()?;
        if host.len() < 2 || host.contains(['/', '\\']) {
            return None;
        }
        (host, path, true)
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if host.is_empty() || !ok(owner) || !ok(name) {
        return None;
    }
    let host = if ssh { ssh_host(host, ssh_config).unwrap_or_else(|| host.to_string()) } else { host.to_string() };
    Some(GhRepo::new(host, owner, name))
}

/// The user's SSH config text, empty when there is none.
pub(crate) fn ssh_config() -> String {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.and_then(|h| std::fs::read_to_string(Path::new(&h).join(".ssh").join("config")).ok()).unwrap_or_default()
}

/// GIT-060: `HOST/OWNER/REPO` for gh's `--repo`, from origin, so gh never has to guess the host
/// from a remote it cannot read (an SSH alias, an Enterprise host).
pub(crate) fn gh_repo_arg(worktree: &Path, ssh_config: &str) -> Option<String> {
    let url = run(&["remote", "get-url", "origin"], Some(worktree)).ok()?;
    github_repo(&url, ssh_config).map(|g| format!("{}/{}/{}", g.host, g.owner, g.name))
}

/// GIT-060: the worktree's GitHub repository, for grouping checkouts (the Tasks picker, T-231-b).
#[tauri::command]
pub async fn scm_github_repo(worktree: String) -> Option<GhRepo> {
    let url = run(&["remote", "get-url", "origin"], Some(Path::new(&worktree))).ok()?;
    github_repo(&url, &ssh_config())
}

/// GIT-066: the signed-in gh login, read from gh's own config (no network); None without gh.
pub fn gh_login() -> Option<String> {
    gh_account(&gh_program().ok()?, "github.com")
}

/// GIT-043 / GIT-066: the account gh is signed in with on `host`, from gh's own config (no network).
/// None when gh is signed out there, cannot run, or does not answer within GH_ACCOUNT_LIMIT.
fn gh_account(program: &Path, host: &str) -> Option<String> {
    gh_account_within(program, host, GH_ACCOUNT_LIMIT).ok().flatten()
}

/// FIX-R2: `gh_account` with a time limit: Ok(None) when gh says it is signed out on `host`, Err
/// when gh cannot run or has not answered by `limit` (it is stopped then).
fn gh_account_within(program: &Path, host: &str, limit: std::time::Duration) -> Result<Option<String>, String> {
    let read = gh_config_within(program, &["config", "get", "-h", host, "user"], limit)?;
    Ok((read.ok && !read.out.is_empty()).then_some(read.out))
}

/// FIX-4 (tasks): what one finished `gh config get ...` printed: whether gh exited 0, its standard
/// output and its standard error, both trimmed. The host gate in github.rs tells gh's own "key not
/// found" answer from any other failure by these.
pub(crate) struct GhConfigRead {
    pub ok: bool,
    pub out: String,
    pub err: String,
}

/// FIX-3 / FIX-4 (tasks): one `gh config get ...` through the bounded runner (the whole process
/// tree ends at the limit): Ok with what gh printed and whether it exited 0, Err when it cannot
/// run or has not answered by `limit`. It runs in the temp folder, so a gh that cannot find that
/// folder fails (gh_login and gh_account then answer None). The host gate in github.rs reads gh's
/// config through this, refuses the host on an Err, and counts a non-zero exit as "not set" only
/// when the error text is gh's own "key not found".
pub(crate) fn gh_config_within(program: &Path, args: &[&str], limit: std::time::Duration) -> Result<GhConfigRead, String> {
    let mut cmd = quiet(program);
    cmd.args(args).current_dir(std::env::temp_dir()).envs(crate::git::NO_PROMPT).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1");
    let (ok, out, err) = run_within(cmd, None, limit)?;
    Ok(GhConfigRead { ok, out: out.trim().to_string(), err: err.trim().to_string() })
}

/// FIX-2 / FIX-3: a pull request request goes only to a host Kolux may talk to (github.com, the host
/// GH_HOST names, or one gh is signed in to with a user of its own), so a link to some other host
/// never hands it anything. The one shared gate, github::host_allowed, decides.
fn signed_host(gh: &Path, host: &str) -> Result<(), String> {
    crate::github::host_allowed(gh, host)
}

/// FIX-2: every program this module starts comes through here, so none flashes a console window
/// up behind the app (CREATE_NO_WINDOW; a window-owning program like the file manager is unaffected).
fn quiet(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    // Its own process group, so the tree kill's group signal (procs::kill_tree) has a group to end.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

pub(crate) fn gh_program() -> Result<std::path::PathBuf, String> {
    // Development builds only: KOLUX_DEV_GH (or the worktrees lane's KOLUX_RS_GH) names a stand-in
    // gh for live proofs, since the registry's search path (which finds the real gh) comes before
    // the process PATH.
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("KOLUX_DEV_GH").or_else(|| std::env::var_os("KOLUX_RS_GH")) {
        return Ok(p.into());
    }
    crate::agents::find_program("gh").ok_or_else(|| "The GitHub CLI (gh) is not installed; install it, then run gh auth login".to_string())
}

/// GIT-028: how long one gh call may take before Kolux gives up on it.
const GH_LIMIT: std::time::Duration = std::time::Duration::from_secs(30);
/// FIX-R2: how long gh may take to say which account it is signed in with (a local config read).
const GH_ACCOUNT_LIMIT: std::time::Duration = std::time::Duration::from_secs(5);

/// Runs gh in the worktree with every prompt off; `input` goes to standard input. A failure
/// carries what gh printed.
pub(crate) fn gh_run(program: &Path, worktree: &Path, args: &[&str], input: Option<&str>) -> Result<String, String> {
    gh_run_for(program, worktree, args, input, GH_LIMIT)
}

/// GIT-028: `gh_run` with a time limit; a gh that has not finished by then is stopped.
fn gh_run_for(program: &Path, worktree: &Path, args: &[&str], input: Option<&str>, limit: std::time::Duration) -> Result<String, String> {
    let mut cmd = quiet(program);
    cmd.args(args);
    // A pull request link names its own repository; everything else is pointed at origin's.
    if args.first() != Some(&"api") && !args.iter().any(|a| a.starts_with("https://")) {
        if let Some(repo) = gh_repo_arg(worktree, &ssh_config()) {
            cmd.args(["--repo", &repo]);
        }
    }
    cmd.current_dir(worktree).envs(crate::git::NO_PROMPT).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1");
    let (ok, out, err) = run_within(cmd, input, limit)?;
    let said = format!("{}\n{}", out.trim(), err.trim()).trim().to_string();
    if ok { Ok(out.trim().to_string()) } else { Err(plain(&said)) }
}

/// GIT-028 / FIX-R2: runs a gh command, `input` on standard input, and waits about `limit`:
/// (succeeded, standard output, standard error), or Err when it cannot start or has not finished in
/// time (it is stopped then, with everything it started). The call can end a little after `limit`: a
/// finished gh's output gets a grace of at least 200 ms, then up to two 200 ms waits for the last
/// of it, and without a job the tree kill takes its own time (FIX-5).
/// On Windows gh runs in a kill-on-close job, so when the call ends it also ends background helpers
/// a gh child auto-started (a git fsmonitor daemon, say); that costs only a restart of the helper,
/// and no gh call here opens a browser, so nothing the user sees is cut.
fn run_within(cmd: std::process::Command, input: Option<&str>, limit: std::time::Duration) -> Result<(bool, String, String), String> {
    run_within_in(cmd, input, limit, true, &crate::procs::kill_tree, &kill_leftover)
}

/// FIX-5: what ends a program a finished gh left holding its output, when no job holds gh. gh has
/// been reaped by then (on Unix `try_wait` is a waitpid), so its pid may already belong to another
/// program: only the process group is signalled (the group id stays reserved while any member
/// lives), never the bare pid. That greatly narrows the window for a stray kill; it does not close
/// it: a leftover that moved into its own session leaves the group empty, and the id could then
/// have been taken by a new group leader inside the grace (a pid wrap in 500 ms at most, very
/// unlikely). Closing it needs gh kept as a zombie until after the group kill (waitid with
/// WNOWAIT, which needs libc; recorded, not done). The Unix-only parts (the `kill` program, the
/// group signal) are compiled nowhere on this PC and run nowhere (FIX-6); the runner that starts
/// the program is shared code and is run by a test here (FIX-7). Windows has no group; taskkill needs the root alive, so there this
/// is best effort and the job is what reaches a leftover.
fn kill_leftover(pid: u32) {
    #[cfg(unix)]
    {
        kill_leftover_with(pid, &run_program);
    }
    #[cfg(not(unix))]
    crate::procs::kill_tree(pid);
}

/// The arguments of the group-only signal: the group form (`-pid`), never the bare pid. The `--`
/// ends the options first, so a negative process-group id is never read as one (FIX-6).
#[cfg_attr(not(unix), allow(dead_code))]
fn group_kill_args(pid: u32) -> Vec<String> {
    vec!["-9".into(), "--".into(), format!("-{pid}")]
}

/// FIX-6 (review AFTER 2): the whole leftover kill with the program runner passed in, so a test
/// can see exactly what `kill_leftover` asks for without a Unix host: the program `kill` and the
/// group arguments, nothing else.
#[cfg_attr(not(unix), allow(dead_code))]
fn kill_leftover_with(pid: u32, run: &dyn Fn(&str, &[String])) {
    run("kill", &group_kill_args(pid));
}

/// FIX-7 (review AFTER 1): the real runner behind `kill_leftover`: starts the program with its
/// arguments through `quiet` (no console window), drops its output and waits for it to end. It is
/// shared code, not behind `cfg(unix)`, so a Windows test runs it.
#[cfg_attr(not(unix), allow(dead_code))]
fn run_program(program: &str, args: &[String]) {
    let _ = run_program_output(program, args);
}

/// The one line `run_program` stands on, with the result kept so a test can read it.
#[cfg_attr(not(unix), allow(dead_code))]
fn run_program_output(program: &str, args: &[String]) -> std::io::Result<std::process::Output> {
    quiet(program).args(args).output()
}

/// The body of `run_within`: `with_job` false starts gh with no job (the fallback path), `tree_kill`
/// is what ends a tree when there is no job and gh is still running (a timeout: gh is not reaped,
/// so its pid is still its own), and `leftover_kill` is what ends the program a gh that already
/// finished left holding its output (gh is reaped: its pid must not be signalled, FIX-5).
fn run_within_in(mut cmd: std::process::Command, input: Option<&str>, limit: std::time::Duration, with_job: bool, tree_kill: &dyn Fn(u32), leftover_kill: &dyn Fn(u32)) -> Result<(bool, String, String), String> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("could not run gh: {e}"))?;
    let pid = child.id();
    // What gh starts after the assignment below joins this job and ends with it (Windows
    // kill-on-close); the job is the precise way to end the tree. A child gh.cmd starts in the
    // instants between `spawn` and the assignment is not in the job, and nothing ends it on a
    // timeout (FIX-5: a rare leak, not a safety problem; closing it needs a suspended spawn). Where
    // there is no job (not Windows, or the assignment failed) the tree kill is the fallback, and
    // only then: it walks by parent pid, which can reach a program gh never started.
    let job = if with_job && cfg!(windows) { crate::procs::Job::new().ok().filter(|j| j.assign_pid(pid).is_ok()) } else { None };
    let deadline = std::time::Instant::now() + limit;
    let secs = limit.as_secs();
    let too_slow = || format!("gh did not answer within {secs} second{}; try again in a moment", if secs == 1 { "" } else { "s" });
    // FIX-3: the description goes to gh on its own thread, so a gh that never reads it cannot hold
    // this call past its limit (the pipe closes when gh is stopped, which ends the write).
    if let (Some(text), Some(mut pipe)) = (input, child.stdin.take()) {
        let text = text.to_string();
        std::thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
        });
    }
    // The pipes are drained on their own threads so a chatty gh never blocks on a full pipe; what
    // they have read so far is kept, so a program left holding a pipe cannot take the answer away.
    type Pipe = (std::sync::Arc<std::sync::Mutex<Vec<u8>>>, std::sync::mpsc::Receiver<()>);
    let drain = |pipe: Option<Box<dyn Read + Send>>| -> Pipe {
        let (tx, rx) = std::sync::mpsc::channel();
        let kept = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = kept.clone();
        std::thread::spawn(move || {
            if let Some(mut p) = pipe {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = p.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut k) = sink.lock() {
                        k.extend_from_slice(&chunk[..n]);
                    }
                }
            }
            let _ = tx.send(());
        });
        (kept, rx)
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let code = loop {
        if let Some(code) = child.try_wait().map_err(|e| format!("gh did not finish: {e}"))? {
            break code;
        }
        if std::time::Instant::now() >= deadline {
            // FIX-3 / FIX-4: a timeout ends gh and every program it started (a gh.cmd shim's real gh
            // keeps the pipes open): through the job when one holds gh, the tree kill otherwise.
            match job {
                Some(j) => drop(j),
                None => tree_kill(pid),
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(too_slow());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    // gh is done. Its output normally closes at once; a program it left behind that still holds the
    // pipes gets a short grace, then goes with the job, and the call still answers (a little past its
    // limit at worst, see the doc on `run_within`).
    let grace = grace_after(std::time::Instant::now(), deadline);
    let until = std::time::Instant::now() + grace;
    let closed = [&stdout, &stderr].map(|(_, rx)| rx.recv_timeout(until.saturating_duration_since(std::time::Instant::now())).is_ok());
    if closed.contains(&false) {
        match job {
            Some(j) => drop(j),
            None => leftover_kill(pid),
        }
        // The leftover is gone now, so its pipes close; give the drains a moment to hand over the
        // last of what gh printed before it is read.
        for (_, rx) in [&stdout, &stderr] {
            let _ = rx.recv_timeout(std::time::Duration::from_millis(200));
        }
    }
    let text = |(kept, _): &Pipe| kept.lock().map(|k| String::from_utf8_lossy(&k).into_owned()).unwrap_or_default();
    Ok((code.success(), text(&stdout), text(&stderr)))
}

/// How long a finished gh's output gets to close: what is left of the limit up to 500 ms, but never
/// under 200 ms, so a gh that ends just as the limit runs out is not read before its last chunk
/// (the floor is why a call can end a little after its limit).
fn grace_after(now: std::time::Instant, deadline: std::time::Instant) -> std::time::Duration {
    std::time::Duration::from_millis(500).min(deadline.saturating_duration_since(now)).max(std::time::Duration::from_millis(200))
}

/// GIT-023: gh's failures in the words the panel shows. GIT-045: signed out, a sign-in that no
/// longer works, and an account that cannot see the repository are told apart (a missing gh is
/// `gh_program`'s own message).
pub fn gh_words(said: &str) -> String {
    let low = said.to_lowercase();
    if low.contains("known github host") || low.contains("not a github") {
        "This remote's host is not supported; pull requests need a GitHub remote".into()
    } else if low.contains("bad credentials") || low.contains("http 401") {
        "gh's sign-in no longer works (it expired or was revoked): run gh auth login again".into()
    } else if low.contains("gh auth login") || low.contains("not logged in") || low.contains("authentication") {
        "Sign in to GitHub first: run gh auth login".into()
    } else if !low.contains("rate limit") && (low.contains("resource not accessible") || low.contains("http 403")) {
        // A search refused over one repository (HTTP 422) and "Could not resolve to a Repository" keep
        // gh's words: Tasks names the refused repository from them (repo_trouble, github::lookup_error).
        "The account gh is signed in with cannot see this repository: run gh auth status to check which account it is, or gh auth login with one that has access".into()
    } else {
        said.trim().to_string()
    }
}

/// GIT-021 / GIT-023: the branch's pull request, None when it has none. Err when gh cannot
/// say (signed out, offline, another host), so creation is refused rather than risking a second.
pub fn pr_find(gh: &Path, worktree: &Path, branch: &str) -> Result<Option<Pr>, String> {
    match gh_run(gh, worktree, &["pr", "view", branch, "--json", PR_FIELDS], None) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}")),
        Err(e) if e.to_lowercase().contains("no pull requests found") => Ok(None),
        Err(e) => Err(gh_words(&e)),
    }
}

/// GIT-025: a pull request linked by hand, read through its link wherever its branch is.
pub fn pr_link(gh: &Path, worktree: &Path, url: &str) -> Result<Pr, String> {
    let url = url.trim();
    if !safe_pr_url(url) {
        return Err("Paste a pull request link, such as https://github.com/owner/repo/pull/12".into());
    }
    // FIX-3 (review AFTER 1): gh gets the cleaned form of the link, never the raw text.
    let clean = pr_url_in(url).ok_or("Paste a pull request link, such as https://github.com/owner/repo/pull/12")?;
    let (host, ..) = pr_parts(&clean).ok_or("Paste a pull request link, such as https://github.com/owner/repo/pull/12")?;
    signed_host(gh, &host)?;
    let text = gh_run(gh, worktree, &["pr", "view", &clean, "--json", PR_FIELDS], None).map_err(|e| gh_words(&e))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// VIEW-073: one check on a pull request, in the Checks panel's words.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Check {
    pub name: String,
    pub workflow: Option<String>,
    /// passed, failed, running, skipped, cancelled or unresolved.
    pub outcome: String,
    pub link: Option<String>,
    pub started: Option<String>,
    pub finished: Option<String>,
    pub description: Option<String>,
}

/// VIEW-073: the Checks panel's answer; `pr` is None when the branch has no pull request.
/// Row 76: `provider`/`host` are set (and otherwise left out of the wire) when the remote is not GitHub, so gh was never asked.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, Default)]
pub struct PrChecks {
    pub pr: Option<Pr>,
    pub conflict: bool,
    pub checks: Vec<Check>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

const CHECK_FIELDS: &str = "number,url,state,title,headRefName,isDraft,mergeable,statusCheckRollup";

/// VIEW-073: a check run's status and conclusion, or a commit status's state, as one word. A run
/// that finished without a conclusion is unresolved, never pending.
fn check_outcome(v: &serde_json::Value) -> &'static str {
    let word = |k: &str| v[k].as_str().unwrap_or("").to_ascii_uppercase();
    if v["__typename"] == "StatusContext" || v.get("status").is_none() {
        return match word("state").as_str() {
            "SUCCESS" => "passed",
            "PENDING" | "EXPECTED" => "running",
            "FAILURE" | "ERROR" => "failed",
            _ => "unresolved",
        };
    }
    if word("status") != "COMPLETED" {
        return "running";
    }
    match word("conclusion").as_str() {
        "SUCCESS" => "passed",
        // GIT-029: a neutral check is not counted as passed.
        "NEUTRAL" => "neutral",
        "FAILURE" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => "failed",
        "SKIPPED" | "STALE" => "skipped",
        "CANCELLED" => "cancelled",
        _ => "unresolved",
    }
}

/// VIEW-073: gh's pull request answer, read into the review header, the conflict notice and the checks.
pub fn checks_from(text: &str) -> Result<PrChecks, String> {
    let bad = |e: serde_json::Error| format!("gh answered in a form Kolux cannot read: {e}");
    let v: serde_json::Value = serde_json::from_str(text).map_err(bad)?;
    let pr: Pr = serde_json::from_value(v.clone()).map_err(bad)?;
    // gh writes a zero time for a run that has not finished yet.
    let time = |x: &serde_json::Value| x.as_str().filter(|t| !t.is_empty() && !t.starts_with("0001-")).map(String::from);
    let text_of = |x: &serde_json::Value| x.as_str().filter(|t| !t.is_empty()).map(String::from);
    let checks = v["statusCheckRollup"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| Check {
                    name: text_of(&c["name"]).or_else(|| text_of(&c["context"])).unwrap_or_else(|| "check".into()),
                    workflow: text_of(&c["workflowName"]),
                    outcome: check_outcome(c).into(),
                    link: text_of(&c["detailsUrl"]).or_else(|| text_of(&c["targetUrl"])),
                    started: time(&c["startedAt"]),
                    finished: time(&c["completedAt"]),
                    description: text_of(&c["description"]),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(PrChecks { pr: Some(pr), conflict: v["mergeable"] == "CONFLICTING", checks, ..Default::default() })
}

/// VIEW-073: the checks of the pull request for `target` (a branch or a hand-linked PR link).
pub fn pr_checks(gh: &Path, worktree: &Path, target: &str) -> Result<PrChecks, String> {
    match gh_run(gh, worktree, &["pr", "view", target, "--json", CHECK_FIELDS], None) {
        Ok(text) => checks_from(&text),
        Err(e) if e.to_lowercase().contains("no pull requests found") => Ok(PrChecks::default()),
        Err(e) => Err(gh_words(&e)),
    }
}

/// VIEW-073 / FIX-BEFORE-1: the checks of a linked pull request (one linked by hand or printed in a
/// pane). Like every other gh call on a link, it goes only to a host gh is signed in to, and gh gets
/// the cleaned `https://host/owner/repo/pull/N` form, never the raw text.
pub fn pr_checks_linked(gh: &Path, worktree: &Path, url: &str) -> Result<PrChecks, String> {
    const NOT_A_LINK: &str = "The linked pull request is not a pull request link";
    let url = url.trim();
    if !safe_pr_url(url) {
        return Err(NOT_A_LINK.into());
    }
    let clean = pr_url_in(url).ok_or(NOT_A_LINK)?;
    let (host, ..) = pr_parts(&clean).ok_or(NOT_A_LINK)?;
    signed_host(gh, &host)?;
    pr_checks(gh, worktree, &clean)
}

/// GIT-017: the most diff text a commit-message prompt carries.
pub const MESSAGE_BUDGET: usize = 24_000;

/// GIT-017: `diff` cut to about `budget` bytes, shared fairly across its files (a small file keeps
/// all of its share's worth, the rest goes to the big ones), each cut at a line end and marked.
pub fn trim_diff(diff: &str, budget: usize) -> String {
    if diff.len() <= budget {
        return diff.to_string();
    }
    let mut files: Vec<&str> = Vec::new();
    let mut rest = diff;
    while let Some(i) = rest.get(1..).and_then(|r| r.find("\ndiff --git ")).map(|i| i + 2) {
        files.push(&rest[..i]);
        rest = &rest[i..];
    }
    files.push(rest);
    let mut order: Vec<usize> = (0..files.len()).collect();
    order.sort_by_key(|&i| files[i].len());
    let mut share = vec![0usize; files.len()];
    let mut left = budget;
    for (n, &i) in order.iter().enumerate() {
        let give = files[i].len().min(left / (files.len() - n));
        share[i] = give;
        left -= give;
    }
    let mut out = String::new();
    for (i, f) in files.iter().enumerate() {
        if share[i] >= f.len() {
            out.push_str(f);
            continue;
        }
        let keep = f.as_bytes()[..share[i]].iter().rposition(|&b| b == b'\n').map_or(0, |e| e + 1);
        out.push_str(&f[..keep]);
        out.push_str(&format!("[{} more lines of this file left out]\n", f[keep..].lines().count()));
    }
    out
}

/// GIT-017: an agent's answer as a commit message: code fences, an opening line that announces the
/// message, and list bullets are stripped.
pub fn clean_message(text: &str) -> String {
    let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim_start().starts_with("```")).collect();
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    if let Some(first) = lines.first() {
        let low = first.trim().to_lowercase();
        if low.ends_with(':') && (low.starts_with("here") || low.contains("commit message")) {
            lines.remove(0);
        }
    }
    let bare = |l: &&str| {
        let t = l.trim_start();
        ["- ", "* ", "\u{2022} "].iter().find_map(|b| t.strip_prefix(b)).unwrap_or(l).to_string()
    };
    lines.iter().map(bare).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// GIT-018: the most custom instructions a commit-message prompt carries.
pub const INSTRUCTIONS_MAX: usize = 2_000;

/// GIT-017 / GIT-018: what the agent is asked: the job, the user's own instructions in their own
/// size-capped part (blank ones add nothing), and the (trimmed) staged diff at the end.
pub fn message_prompt(diff: &str, instructions: &str) -> String {
    let own = instructions.trim();
    let own = match own.char_indices().nth(INSTRUCTIONS_MAX) {
        Some((i, _)) => &own[..i],
        None => own,
    };
    let part = if own.is_empty() { String::new() } else { format!("\n\nInstructions from the user for this message:\n{own}") };
    format!("Write a git commit message for the staged changes below. Reply with the commit message only: a summary line under 72 characters, then, when it helps, a blank line and a few plain sentences on what changed and why. No code fences, no bullets, no preamble.{part}\n\n{diff}")
}

/// GIT-018: a custom command split into words: double quotes keep spaces inside one word, and
/// backslashes stay exactly as typed (Windows paths).
pub fn split_command(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut quoted, mut started) = (false, false);
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }
    words
}

/// GIT-018: a custom command's arguments with the prompt wherever `{prompt}` appears; with no
/// placeholder the prompt goes on standard input instead (the second value).
pub fn writer_args(args: &[String], prompt: &str) -> (Vec<String>, Option<String>) {
    if args.iter().any(|a| a.contains("{prompt}")) {
        (args.iter().map(|a| a.replace("{prompt}", prompt)).collect(), None)
    } else {
        (args.to_vec(), Some(prompt.to_string()))
    }
}

/// GIT-017: runs whose stop was asked for, by key (the worktree).
static STOPS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// GIT-017: stops the message run for `key`, if one is going.
pub fn stop_message(key: &str) {
    STOPS.lock().unwrap_or_else(|e| e.into_inner()).push(key.to_string());
}

fn stop_asked(key: &str) -> bool {
    let mut stops = STOPS.lock().unwrap_or_else(|e| e.into_inner());
    let had = stops.iter().any(|k| k == key);
    stops.retain(|k| k != key);
    had
}

/// GIT-017: the end of an agent's output for an error notice, keys masked.
fn excerpt(text: &str) -> String {
    let t = text.trim();
    let cut = t.char_indices().rev().nth(399).map_or(0, |(i, _)| i);
    crate::secrets::mask(&t[cut..])
}

/// GIT-017: runs an agent CLI in `dir` with `prompt` on its standard input and returns its answer
/// as a commit message. `stop_message(key)` ends the run early with the error "stopped".
pub fn write_message(program: &Path, args: &[&str], dir: &Path, input: Option<&str>, key: &str, limit: std::time::Duration) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;
    stop_asked(key);
    let mut cmd = quiet(program);
    cmd.args(args).current_dir(dir).env("NO_COLOR", "1").stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the agent: {e}"))?;
    if let (Some(mut pipe), Some(text)) = (child.stdin.take(), input.map(str::to_string)) {
        std::thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
        });
    }
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut text);
            }
            let _ = tx.send(text);
        });
        rx
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let deadline = std::time::Instant::now() + limit;
    let end = |child: &mut std::process::Child| {
        // A .cmd shim runs the agent as its child, so the whole tree goes.
        #[cfg(windows)]
        let _ = quiet("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).output();
        let _ = child.kill();
        let _ = child.wait();
    };
    let code = loop {
        if let Some(code) = child.try_wait().map_err(|e| format!("The agent did not finish: {e}"))? {
            break code;
        }
        if stop_asked(key) {
            end(&mut child);
            return Err("stopped".into());
        }
        if std::time::Instant::now() >= deadline {
            end(&mut child);
            return Err(format!("The agent did not finish within {} seconds", limit.as_secs()));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let out = stdout.recv().unwrap_or_default();
    let err = stderr.recv().unwrap_or_default();
    if !code.success() {
        return Err(format!("The agent failed: {}", excerpt(if err.trim().is_empty() { &out } else { &err })));
    }
    let message = clean_message(&out);
    if message.is_empty() {
        let said = excerpt(&err);
        return Err(if said.is_empty() { "The agent wrote nothing".to_string() } else { format!("The agent wrote nothing: {said}") });
    }
    Ok(message)
}

/// GIT-017 (T-227-d): files with an unresolved conflict, by path. Their staged text is clash markers, so it never goes into a message prompt.
pub fn conflicted_files(dir: &Path) -> Vec<String> {
    run(&["diff", "--name-only", "--diff-filter=U", "-z"], Some(dir)).map(|t| t.split('\0').filter(|n| !n.is_empty()).map(String::from).collect()).unwrap_or_default()
}

/// GIT-017 (T-227-d): the note that opens the diff when conflicted files were left out of it.
pub fn conflict_note(files: &[String]) -> String {
    if files.is_empty() {
        return String::new();
    }
    let shown: Vec<&str> = files.iter().take(20).map(String::as_str).collect();
    let more = if files.len() > shown.len() { format!(" and {} more", files.len() - shown.len()) } else { String::new() };
    format!("Note: {} with unresolved conflicts left out of this diff, so do not describe them: {}{more}

", if files.len() == 1 { "1 file".to_string() } else { format!("{} files", files.len()) }, shown.join(", "))
}

/// GIT-017 (T-227-d): the staged diff for a message, conflicted files excluded, with the note about them (empty when none).
pub fn message_diff(dir: &Path) -> Result<(String, String), String> {
    let left_out = conflicted_files(dir);
    let mut args: Vec<String> = ["diff", "--cached", "--no-color", "--no-ext-diff"].iter().map(|a| a.to_string()).collect();
    if !left_out.is_empty() {
        args.push("--".into());
        args.push(".".into());
        args.extend(left_out.iter().map(|f| format!(":(exclude,literal){f}")));
    }
    let diff = run(&args.iter().map(String::as_str).collect::<Vec<_>>(), Some(dir))?;
    if diff.trim().is_empty() {
        return Err(if left_out.is_empty() { "Nothing is staged to describe".into() } else { "Only files with unresolved conflicts are staged: resolve them first".into() });
    }
    Ok((conflict_note(&left_out), diff))
}

/// GIT-017 (T-227-d): the whole prompt for `diff` (after `note`) kept within `room` bytes, for a writer that takes it on the command line; `None` room keeps the usual budget.
pub fn fit_prompt(note: &str, diff: &str, instructions: &str, room: Option<usize>) -> String {
    let build = |budget: usize| message_prompt(&format!("{note}{}", trim_diff(diff, budget)), instructions);
    let Some(room) = room else { return build(MESSAGE_BUDGET) };
    let mut budget = MESSAGE_BUDGET.min(room.saturating_sub(message_prompt(note, instructions).len()));
    let mut text = build(budget);
    while text.len() > room && budget > 200 {
        budget = budget * 4 / 5;
        text = build(budget);
    }
    text
}

/// GIT-017 / GIT-018: a commit message for what is staged in `worktree`, written by Claude Code, or
/// by the user's own `command` when one is set, following their `instructions`.
#[tauri::command]
pub async fn scm_commit_message(worktree: String, command: Option<String>, instructions: Option<String>, agent: Option<String>, model: Option<String>, effort: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let (note, diff) = message_diff(dir)?;
        // Development builds only: KOLUX_DEV_WRITER names a stand-in agent for live proofs (as KOLUX_DEV_GH).
        #[cfg(debug_assertions)]
        let stand_in = std::env::var_os("KOLUX_DEV_WRITER").map(std::path::PathBuf::from);
        #[cfg(not(debug_assertions))]
        let stand_in: Option<std::path::PathBuf> = None;
        let prompt = fit_prompt(&note, &diff, instructions.as_deref().unwrap_or(""), None);
        let limit = std::time::Duration::from_secs(180);
        if let Some(line) = command.filter(|c| !c.trim().is_empty()) {
            let words = split_command(&line);
            let (args, input) = writer_args(&words[1..], &prompt);
            let program = crate::agents::find_program(&words[0]).unwrap_or_else(|| std::path::PathBuf::from(&words[0]));
            return write_message(&program, &args.iter().map(String::as_str).collect::<Vec<_>>(), dir, input.as_deref(), &worktree, limit);
        }
        let id = agent.as_deref().filter(|a| !a.is_empty()).unwrap_or("claude");
        if id == "claude" {
            if let Some(program) = stand_in {
                let spec = writers::spec("claude").ok_or("no writer")?;
                let inv = writers::invocation(spec, model.as_deref(), effort.as_deref(), &prompt);
                // T-606 (R05-git-scm.1): a writer agent runs from an empty folder, never the workspace.
                return writers::run(spec, &program, &inv, &worktree, limit);
            }
        }
        let spec = writers::spec(id).ok_or_else(|| format!("unknown writer {id}"))?;
        let program = writers::program_of(spec).ok_or_else(|| format!("{} was not found on this computer", spec.name))?;
        // An agent that takes the prompt as an argument gets a diff cut to fit the command line.
        let prompt = if spec.prompt_in_args {
            fit_prompt(&note, &diff, instructions.as_deref().unwrap_or(""), Some(writers::arg_limit(&program)))
        } else {
            prompt
        };
        let inv = writers::invocation(spec, model.as_deref(), effort.as_deref(), &prompt);
        writers::run(spec, &program, &inv, &worktree, limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-017: stops the commit-message run for `worktree`.
#[tauri::command]
pub async fn scm_commit_message_stop(worktree: String) {
    stop_message(&worktree);
}

/// GIT-027: one workspace the background poll looks up, with its hand-linked pull request if any.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct PollItem {
    pub path: String,
    #[serde(default)]
    pub linked: Option<String>,
}

/// GIT-027: what the poll found for one workspace. `error` means "keep what you had".
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PolledPr {
    pub path: String,
    pub linked: bool,
    pub pr: Option<Pr>,
    pub error: Option<String>,
}

/// GIT-027 / GIT-028: one round of the background poll. `limited_until` (Unix seconds) is set when
/// GitHub's rate limit stopped the round; nothing more should be asked before then.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPoll {
    pub prs: Vec<PolledPr>,
    pub limited_until: Option<u64>,
}

/// GIT-027: the most a round looks up; the caller puts the visible workspace first.
pub const POLL_MAX: usize = 60;

/// GIT-027: looks up the pull requests of many workspaces with one `gh pr list` per GitHub project
/// (checkouts under different remote forms share it), in the order the items come, a short `gap`
/// apart. A rate-limit answer stops the round (the circuit breaker) and reads when it resets.
// ponytail: each project's 100 most recent pull requests; a branch whose PR is older shows none.
pub fn prs_poll(gh: &Path, items: &[PollItem], gap: std::time::Duration) -> PrPoll {
    let config = ssh_config();
    let mut groups: Vec<(String, Vec<&PollItem>)> = Vec::new();
    let mut out = PrPoll::default();
    for it in items.iter().take(POLL_MAX) {
        let url = run(&["remote", "get-url", "origin"], Some(Path::new(&it.path))).ok();
        match url.and_then(|u| github_repo(&u, &config)) {
            Some(g) => match groups.iter_mut().find(|(k, _)| *k == g.key) {
                Some((_, list)) => list.push(it),
                None => groups.push((g.key, vec![it])),
            },
            None => out.prs.push(PolledPr { path: it.path.clone(), linked: it.linked.is_some(), pr: None, error: None }),
        }
    }
    let mut stopped: Option<String> = None;
    for (n, (_, list)) in groups.iter().enumerate() {
        if n > 0 && stopped.is_none() {
            std::thread::sleep(gap);
        }
        let answer = match &stopped {
            Some(why) => Err(why.clone()),
            None => gh_run(gh, Path::new(&list[0].path), &["pr", "list", "--state", "all", "--limit", "100", "--json", PR_FIELDS], None).map_err(|e| gh_words(&e)).and_then(|t| serde_json::from_str::<Vec<Pr>>(&t).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))),
        };
        if let Err(e) = &answer {
            if stopped.is_none() && e.to_lowercase().contains("rate limit") {
                stopped = Some(e.clone());
                out.limited_until = gh_budget(gh).ok().and_then(|b| b.iter().find(|x| x.name == "REST").map(|x| x.reset));
            }
        }
        for it in list {
            let dir = Path::new(&it.path);
            let found = answer.as_ref().map_err(String::clone).and_then(|prs| match &it.linked {
                Some(url) => prs.iter().find(|p| p.url.eq_ignore_ascii_case(url.trim())).cloned().map(Some).ok_or_else(|| "The linked pull request is not among the project's latest".to_string()),
                None => {
                    let branch = run(&["rev-parse", "--abbrev-ref", "HEAD"], Some(dir)).unwrap_or_default();
                    let mine: Vec<&Pr> = prs.iter().filter(|p| p.head.as_deref() == Some(branch.as_str())).collect();
                    let pick = mine.iter().find(|p| p.state == "OPEN").or(mine.first()).map(|p| (*p).clone());
                    let base = run(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], Some(dir)).ok().map(|b| b.trim_start_matches("origin/").to_string());
                    let default = base.as_deref().map_or(branch == "main" || branch == "master", |b| b == branch);
                    // GIT-025: a closed or merged pull request from the default branch stays hidden.
                    Ok(pick.filter(|p| !(default && p.state != "OPEN")))
                }
            });
            let (pr, error) = match found {
                Ok(pr) => (pr, None),
                Err(e) => (None, Some(e)),
            };
            out.prs.push(PolledPr { path: it.path.clone(), linked: it.linked.is_some(), pr, error });
        }
    }
    out
}

/// T-085-d (AUTO-004): the number-to-node-id table of `gh pr list --json number,id`.
fn open_ids(text: &str) -> std::collections::HashMap<u64, String> {
    serde_json::from_str::<Vec<serde_json::Value>>(text).unwrap_or_default().iter().filter_map(|v| Some((v["number"].as_u64()?, v["id"].as_str()?.to_string()))).collect()
}

/// T-085-d (AUTO-004): the checks word (GIT-043's `checks_of`) of every open pull request found by a
/// poll round, by workspace path, for the "checks failed" automation trigger. One `gh pr list` per
/// GitHub project and one GraphQL call per host; a failed read leaves that project's folders out,
/// which the trigger reads as "no news".
pub fn polled_checks(gh: &Path, polled: &[PolledPr]) -> std::collections::HashMap<String, String> {
    let config = ssh_config();
    // Per project: its host, the first folder (gh runs there) and each open pull request wanted.
    type Wanted = Vec<(String, u64)>;
    let mut groups: Vec<(String, String, Wanted)> = Vec::new();
    for p in polled.iter().filter(|p| p.error.is_none()) {
        let Some(pr) = p.pr.as_ref().filter(|pr| pr.state.eq_ignore_ascii_case("open")) else { continue };
        let Some(g) = run(&["remote", "get-url", "origin"], Some(Path::new(&p.path))).ok().and_then(|u| github_repo(&u, &config)) else { continue };
        match groups.iter_mut().find(|(k, _, _)| *k == g.key) {
            Some((_, _, list)) => list.push((p.path.clone(), pr.number)),
            None => groups.push((g.key.clone(), g.host.clone(), vec![(p.path.clone(), pr.number)])),
        }
    }
    let mut out = std::collections::HashMap::new();
    for (_, host, list) in groups {
        let Ok(text) = gh_run(gh, Path::new(&list[0].0), &["pr", "list", "--state", "open", "--limit", "100", "--json", "number,id"], None) else { continue };
        let ids = open_ids(&text);
        let wanted: Vec<String> = list.iter().filter_map(|(_, n)| ids.get(n).cloned()).collect();
        let words = checks_of(gh, &host, &wanted);
        for (path, n) in list {
            if let Some(w) = ids.get(&n).and_then(|id| words.get(id)) {
                out.insert(path, w.clone());
            }
        }
    }
    out
}

#[tauri::command]
pub async fn scm_prs_poll(app: tauri::AppHandle, items: Vec<PollItem>) -> Result<PrPoll, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let gh = gh_program()?;
        let out = prs_poll(&gh, &items, std::time::Duration::from_millis(400));
        // AUTO-004: each round is what pull-request-opened automations listen to.
        crate::automations::on_poll(&app, &out.prs);
        // AUTO-004 (T-085-d): checks are looked up only while a checks-failed automation is on.
        if crate::automations::listens(&app, "checks-failed") {
            crate::automations::on_checks(&app, &out.prs, &polled_checks(&gh, &out.prs));
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-021: creates the branch's pull request against `base` on origin, pushing unpushed work
/// first. An open one the branch already has is returned instead of a second being made. The
/// head must still be checked out and ahead of the base, with no uncommitted tracked change.
/// T-652: with `push` false nothing is pushed here; a branch whose commits are not all on
/// `origin/<branch>` is refused instead, so the automatic flow's guarded push is the only push.
/// `push`: the automatic flow must always pass false, so that the guarded push in `auto_pr.rs` stays the only push.
pub fn pr_create(gh: &Path, worktree: &Path, title: &str, body: &str, base: &str, draft: bool, push: bool) -> Result<Pr, String> {
    let st = status(worktree)?;
    let branch = st.branch.clone().ok_or("No branch is checked out here; check out the head branch first")?;
    let base = base.trim().trim_start_matches("origin/");
    if base.is_empty() || base == branch {
        return Err(format!("{branch} is the base branch; move to a feature branch first"));
    }
    if !st.staged.is_empty() || !st.changed.is_empty() || !st.conflicts.is_empty() {
        return Err("Commit or stash the changes to tracked files first".into());
    }
    let remote_base = format!("refs/remotes/origin/{base}");
    if run(&["rev-parse", "--verify", "-q", &remote_base], Some(worktree)).is_err() {
        let local = run(&["rev-parse", "--verify", "-q", &format!("refs/heads/{base}")], Some(worktree)).is_ok();
        return Err(if local { format!("{base} is only on this computer; publish it, then create the pull request") } else { format!("origin has no branch {base}; pick another base") });
    }
    // Counted again now, not taken from the panel's last refresh.
    let ahead = run(&["rev-list", "--count", &format!("{remote_base}..HEAD")], Some(worktree)).ok().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    if ahead == 0 {
        return Err(format!("No commits ahead of {base}; there is nothing to review"));
    }
    if title.trim().is_empty() {
        return Err("Write a title first".into());
    }
    match pr_find(gh, worktree, &branch)? {
        Some(pr) if pr.state == "OPEN" => return Ok(pr),
        Some(pr) if pr.state == "MERGED" => return Err(format!("Pull request #{} for {branch} is already merged", pr.number)),
        _ => {}
    }
    let published = st.upstream.as_deref() == Some(format!("origin/{branch}").as_str()) && st.ahead == 0;
    if !push && !published {
        return Err("The branch has commits that are not pushed yet; push first".into());
    }
    if branch.starts_with('-') {
        return Err(format!("{branch} cannot be pushed from here: a branch name must not start with a dash"));
    }
    let push: Vec<&str> = if st.upstream.is_none() { vec!["push", "--set-upstream", "--", "origin", &branch] } else { vec!["push"] };
    if st.upstream.is_none() || st.ahead > 0 {
        let out = git_network(&push, worktree, Some(REMOTE_LIMIT))?;
        if out.timed_out {
            return Err(format!("Push failed, so no pull request was made: {}", timed_out_note(&push, REMOTE_LIMIT)));
        }
        if !out.success {
            return Err(format!("Push failed, so no pull request was made: {}", plain(out.stderr.trim())));
        }
    }
    let mut args = vec!["pr", "create", "--title", title.trim(), "--body-file", "-", "--base", base, "--head", &branch];
    if draft {
        args.push("--draft");
    }
    let said = gh_run(gh, worktree, &args, Some(body)).map_err(|e| gh_words(&e))?;
    let url = said.lines().rev().map(str::trim).find(|l| l.contains("/pull/")).ok_or_else(|| format!("gh did not say where the pull request is: {said}"))?;
    let number = url.rsplit('/').next().and_then(|n| n.parse().ok()).ok_or_else(|| format!("gh gave a link without a number: {url}"))?;
    crate::activity::pr_created(); // USAGE-011
    Ok(Pr { number, url: url.to_string(), state: "OPEN".into(), title: Some(title.trim().to_string()), head: Some(branch.clone()), draft })
}

/// GIT-026: finds pull-request links in a terminal's output. The unfinished end of a chunk is
/// carried into the next, so a link split across chunks is found once it is whole; each link
/// is reported once per terminal.
#[derive(Default)]
pub struct PrScan {
    carry: String,
    seen: std::collections::HashSet<String>,
}

impl PrScan {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        let text = std::mem::take(&mut self.carry) + &String::from_utf8_lossy(chunk);
        let is_url = |c: char| c.is_ascii_alphanumeric() || "-._~/:%?#=&+@".contains(c);
        let mut found = Vec::new();
        let mut rest = text.as_str();
        while let Some(at) = rest.find("https://") {
            let tail = &rest[at..];
            let end = tail.find(|c: char| !is_url(c));
            let Some(end) = end else {
                // The link runs to the end of the chunk: wait for the rest (a runaway is dropped).
                if tail.len() < 400 {
                    self.carry = tail.to_string();
                }
                return found;
            };
            if let Some(url) = pr_url_in(&tail[..end]) {
                if self.seen.insert(url.clone()) {
                    found.push(url);
                }
            }
            rest = &tail[end..];
        }
        // A link may start in the last few characters ("htt" before "ps://").
        let keep = rest.char_indices().rev().nth(6).map_or(0, |(i, _)| i);
        self.carry = rest[keep..].to_string();
        found
    }
}

/// GIT-026: `https://host/owner/repo/pull/<number>`, with anything after the number dropped.
fn pr_url_in(link: &str) -> Option<String> {
    let parts: Vec<&str> = link.strip_prefix("https://")?.split('/').collect();
    let number = parts.get(4).map(|n| n.split(['#', '?']).next().unwrap_or(""))?;
    // FIX-2: the owner and name follow GitHub's rules (no @, no leading dot, no slash of either
    // kind), so neither can reach gh as a file to read or a path to walk.
    // FIX-3 (review AFTER 2): the host starts with a letter or digit (never `-`, so it cannot read as
    // an option) and is lower case in the cleaned form.
    let host_ok = |h: &str| h.starts_with(|c: char| c.is_ascii_alphanumeric()) && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    // FIX-SOON: an Enterprise Managed User login is name_shortcode, so `_` may follow the first character.
    let owner_ok = |o: &str| (1..=39).contains(&o.len()) && o.starts_with(|c: char| c.is_ascii_alphanumeric()) && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let name_ok = |n: &str| (1..=100).contains(&n.len()) && !n.starts_with('.') && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let ok = parts.len() >= 5 && host_ok(parts[0]) && owner_ok(parts[1]) && name_ok(parts[2]) && parts[3] == "pull" && !number.is_empty() && number.chars().all(|c| c.is_ascii_digit());
    ok.then(|| format!("https://{}/{}/{}/pull/{number}", parts[0].to_ascii_lowercase(), parts[1], parts[2]))
}

/// GIT-026: makes a printed link the workspace's linked pull request (the `scmLinkedPrs`
/// setting a hand link uses); false when it already was. Only that one setting is written.
/// ponytail: per top-level key; a hand link or unlink sent in the same moment still writes the
/// whole `scmLinkedPrs` map, so one of the two would be lost. Patch inside the map if that bites.
pub fn link_printed(store: &crate::state::Store, dir: &str, url: &str) -> bool {
    let mut links = store.settings()["scmLinkedPrs"].clone();
    if links[dir] == url {
        return false;
    }
    if !links.is_object() {
        links = serde_json::json!({});
    }
    links[dir] = url.into();
    let mut set = serde_json::Map::new();
    set.insert("scmLinkedPrs".into(), links);
    store.patch_settings(&set, &[]).is_ok()
}

/// GIT-028: one of GitHub's API budgets as `gh api rate_limit` gives it; `reset` is in Unix seconds.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Budget {
    pub name: String,
    pub limit: u64,
    pub remaining: u64,
    pub reset: u64,
}

/// GIT-028: the REST, search and GraphQL budgets left. Reading them costs no budget.
// ponytail: github.com's budget only; an Enterprise host would need its own --hostname read.
pub fn gh_budget(gh: &Path) -> Result<Vec<Budget>, String> {
    let text = gh_run(gh, &std::env::temp_dir(), &["api", "rate_limit"], None).map_err(|e| gh_words(&e))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let read = |key: &str, name: &str| {
        let r = &v["resources"][key];
        Some(Budget { name: name.into(), limit: r["limit"].as_u64()?, remaining: r["remaining"].as_u64()?, reset: r["reset"].as_u64()? })
    };
    Ok([("core", "REST"), ("search", "Search"), ("graphql", "GraphQL")].iter().filter_map(|(k, n)| read(k, n)).collect())
}

#[tauri::command]
pub async fn scm_gh_budget() -> Result<Vec<Budget>, String> {
    tauri::async_runtime::spawn_blocking(|| gh_budget(&gh_program()?)).await.map_err(|e| e.to_string())?
}

/// GIT-043: a label as GitHub draws it; `color` is six hex digits or empty.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct TaskLabel {
    pub name: String,
    pub color: String,
}

/// GIT-043: one issue or pull request found by a Tasks search.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Task {
    /// "issue" or "pr".
    pub kind: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    /// owner/name.
    pub repo: String,
    /// open, closed or merged.
    pub state: String,
    pub draft: bool,
    pub labels: Vec<TaskLabel>,
    pub assignees: Vec<String>,
    pub updated: String,
    /// passing, failing, running or unresolved; None for an issue.
    pub checks: Option<String>,
}

/// GIT-043: one page of a Tasks search. `total` adds up every search's matches; `deepest` is the
/// largest single search, which sets how many pages there are.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct TaskPage {
    pub total: u64,
    pub deepest: u64,
    pub items: Vec<Task>,
    /// GIT-045: repositories GitHub refused to search (gone, renamed, no access); the others still list.
    pub failed: Vec<RepoFail>,
}

/// GIT-045: one repository of a multi-repository list that could not be searched, and why.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct RepoFail {
    pub repo: String,
    pub error: String,
}

/// What one search answered: its total and its items with their node ids.
type Hits = (u64, Vec<(Task, String)>);
/// A repository-by-repository retry costs one search call each; past this many the list fails as one.
const SPLIT_MAX: usize = 20;

/// GIT-045: GitHub's refusal of a search because of the repositories in it (gone, renamed or no access), not
/// because of the account, the limit or the network: those would fail every repository alike.
fn repo_trouble(e: &str) -> bool {
    let t = e.to_lowercase();
    t.contains("cannot be searched") || t.contains("validation failed") || t.contains("http 422")
}

/// GIT-045: runs a search; when GitHub refuses it because of one of its `repo:` words, each repository is
/// searched alone, the ones that work are kept and the ones that do not are named in `failed`.
fn search_split(q: &str, one: &mut dyn FnMut(&str) -> Result<Hits, String>, failed: &mut Vec<RepoFail>) -> Result<Hits, String> {
    let e = match one(q) {
        Ok(h) => return Ok(h),
        Err(e) => e,
    };
    let (repos, rest): (Vec<&str>, Vec<&str>) = q.split_whitespace().partition(|w| w.starts_with("repo:"));
    if repos.len() < 2 || repos.len() > SPLIT_MAX || !repo_trouble(&e) {
        return Err(e);
    }
    let rest = rest.join(" ");
    let (mut total, mut items, mut bad, mut first) = (0, Vec::new(), 0, None);
    for r in &repos {
        match one(&format!("{rest} {r}")) {
            Ok((n, mut got)) => {
                total += n;
                items.append(&mut got);
            }
            Err(e2) => {
                bad += 1;
                let name = r.trim_start_matches("repo:");
                if !failed.iter().any(|f| f.repo == name) {
                    failed.push(RepoFail { repo: name.into(), error: e2.clone() });
                }
                first.get_or_insert(e2);
            }
        }
    }
    match first {
        Some(e) if bad == repos.len() => Err(e),
        _ => Ok((total, items)),
    }
}

/// GIT-043: one GitHub search, one page.
fn search_once(gh: &Path, host: &str, q: &str, page: u32) -> Result<Hits, String> {
    let (q, per, pg) = (format!("q={q}"), format!("per_page={TASKS_PER_PAGE}"), format!("page={page}"));
    let args = ["api", "search/issues", "--hostname", host, "-X", "GET", "-f", &q, "-f", "sort=updated", "-f", "order=desc", "-f", &per, "-f", &pg];
    let text = gh_run(gh, &std::env::temp_dir(), &args, None).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    Ok((v["total_count"].as_u64().unwrap_or(0), v["items"].as_array().into_iter().flatten().filter_map(task_from).collect()))
}

pub const TASKS_PER_PAGE: u32 = 25;
/// GitHub's search hands out only its first 1000 results.
const SEARCH_WINDOW: u32 = 1000;

/// GIT-043: the checks pill's word for a commit's rollup state.
pub fn checks_word(state: Option<&str>) -> &'static str {
    match state {
        Some("SUCCESS") => "passing",
        Some("FAILURE") | Some("ERROR") => "failing",
        Some("PENDING") | Some("EXPECTED") => "running",
        _ => "unresolved",
    }
}

fn task_from(v: &serde_json::Value) -> Option<(Task, String)> {
    let pr = v.get("pull_request").filter(|p| !p.is_null());
    let state = if pr.is_some_and(|p| p["merged_at"].is_string()) { "merged" } else { v["state"].as_str()? };
    let mut parts = v["repository_url"].as_str()?.rsplit('/');
    let (name, owner) = (parts.next()?, parts.next()?);
    let hex = |c: &str| if c.len() == 6 && c.chars().all(|x| x.is_ascii_hexdigit()) { c.to_string() } else { String::new() };
    let labels = v["labels"].as_array().map(|a| a.iter().filter_map(|l| Some(TaskLabel { name: l["name"].as_str()?.into(), color: hex(l["color"].as_str().unwrap_or("")) })).collect()).unwrap_or_default();
    let assignees = v["assignees"].as_array().map(|a| a.iter().filter_map(|u| u["login"].as_str().map(String::from)).collect()).unwrap_or_default();
    let task = Task {
        kind: if pr.is_some() { "pr" } else { "issue" }.into(),
        number: v["number"].as_u64()?,
        title: v["title"].as_str()?.into(),
        url: v["html_url"].as_str()?.into(),
        repo: format!("{owner}/{name}"),
        state: state.to_lowercase(),
        draft: v["draft"].as_bool().unwrap_or(false),
        labels,
        assignees,
        updated: v["updated_at"].as_str().unwrap_or("").into(),
        checks: None,
    };
    Some((task, v["node_id"].as_str().unwrap_or("").into()))
}

/// GIT-043: the checks rollup of each pull request, by node id, in one GraphQL call. A failed read
/// leaves every pill unresolved rather than failing the list.
fn checks_of(gh: &Path, host: &str, ids: &[String]) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let ok = |i: &String| !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '=');
    let ids: Vec<&String> = ids.iter().filter(|i| ok(i)).collect();
    if ids.is_empty() {
        return out;
    }
    let list = ids.iter().map(|i| format!("\"{i}\"")).collect::<Vec<_>>().join(",");
    let query = format!("query{{nodes(ids:[{list}]){{... on PullRequest{{id commits(last:1){{nodes{{commit{{statusCheckRollup{{state}}}}}}}}}}}}}}");
    let Ok(text) = gh_run(gh, &std::env::temp_dir(), &["api", "graphql", "--hostname", host, "-f", &format!("query={query}")], None) else { return out };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return out };
    for n in v["data"]["nodes"].as_array().into_iter().flatten() {
        if let Some(id) = n["id"].as_str() {
            out.insert(id.to_string(), checks_word(n["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"].as_str()).to_string());
        }
    }
    out
}

/// GIT-043: one page of every search in `queries` on `host`, newest first, each item once.
pub fn tasks_search(gh: &Path, host: &str, queries: &[String], page: u32) -> Result<TaskPage, String> {
    // FIX-1 (tasks council FB 1): the same host gate as github.rs, for a host taken from a remote.
    crate::github::host_allowed(gh, host)?;
    if page == 0 || page * TASKS_PER_PAGE > SEARCH_WINDOW {
        return Err(format!("GitHub search reaches only the first {SEARCH_WINDOW} results; this page cannot be reached"));
    }
    let mut out = TaskPage::default();
    let mut ids = Vec::new();
    for q in queries {
        let (total, hits) = search_split(q, &mut |q| search_once(gh, host, q, page), &mut out.failed)?;
        out.total += total;
        out.deepest = out.deepest.max(total);
        for (t, id) in hits {
            if out.items.iter().all(|x| x.url != t.url) {
                if t.kind == "pr" {
                    ids.push(id);
                }
                out.items.push(t);
            }
        }
    }
    let checks = checks_of(gh, host, &ids);
    for (at, t) in out.items.iter_mut().filter(|t| t.kind == "pr").enumerate() {
        t.checks = Some(checks.get(&ids[at]).cloned().unwrap_or_else(|| "unresolved".into()));
    }
    out.items.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

#[tauri::command]
pub async fn scm_tasks_search(host: String, queries: Vec<String>, page: u32) -> Result<TaskPage, String> {
    tauri::async_runtime::spawn_blocking(move || tasks_search(&gh_program()?, &host, &queries, page)).await.map_err(|e| e.to_string())?
}

/// GIT-043: the account gh is signed in with on `host`, from gh's own config (no network).
#[tauri::command]
pub async fn scm_gh_account(host: String) -> Option<String> {
    // Off the async thread, so a slow gh never holds up other commands, and bounded by
    // GH_ACCOUNT_LIMIT (FIX-R2), so a gh that never answers reads as no account instead of a hang.
    tauri::async_runtime::spawn_blocking(move || gh_account(&gh_program().ok()?, &host)).await.ok()?
}

fn host_ok(host: &str) -> Result<(), String> {
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':') {
        return Err("This repository's GitHub host cannot be read".into());
    }
    Ok(())
}

/// GIT-050: one entry in an item's timeline. `detail` is the label, the person, the new title or the
/// start of a comment, as the event has it.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct TaskEvent {
    pub kind: String,
    pub actor: String,
    pub at: String,
    pub detail: String,
}

/// GIT-050: what the preview dialog shows for one issue or pull request.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct TaskDetail {
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<TaskLabel>,
    pub assignees: Vec<String>,
    pub updated: String,
    pub events: Vec<TaskEvent>,
}

/// The API address of item `number` in `repo` (owner/name), refused unless both are plain names.
fn item_path(host: &str, repo: &str, number: u64) -> Result<String, String> {
    host_ok(host)?;
    let plain = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    match repo.split_once('/') {
        Some((o, n)) if plain(o) && plain(n) => Ok(format!("repos/{o}/{n}/issues/{number}")),
        _ => Err("This item's repository cannot be read".into()),
    }
}

fn label_list(v: &serde_json::Value) -> Vec<TaskLabel> {
    let hex = |c: &str| if c.len() == 6 && c.chars().all(|x| x.is_ascii_hexdigit()) { c.to_string() } else { String::new() };
    v.as_array().map(|a| a.iter().filter_map(|l| Some(TaskLabel { name: l["name"].as_str()?.into(), color: hex(l["color"].as_str().unwrap_or("")) })).collect()).unwrap_or_default()
}

fn gh_value(gh: &Path, host: &str, args: &[&str], input: Option<&str>) -> Result<serde_json::Value, String> {
    crate::github::host_allowed(gh, host)?;
    let text = gh_run(gh, &std::env::temp_dir(), args, input).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

fn detail_from(v: &serde_json::Value) -> TaskDetail {
    let merged = v["pull_request"]["merged_at"].is_string() || v["merged_at"].is_string();
    TaskDetail {
        title: v["title"].as_str().unwrap_or("").into(),
        body: v["body"].as_str().unwrap_or("").into(),
        state: if merged { "merged".into() } else { v["state"].as_str().unwrap_or("").to_lowercase() },
        labels: label_list(&v["labels"]),
        assignees: v["assignees"].as_array().map(|a| a.iter().filter_map(|u| u["login"].as_str().map(String::from)).collect()).unwrap_or_default(),
        updated: v["updated_at"].as_str().unwrap_or("").into(),
        events: Vec::new(),
    }
}

/// GIT-050: the item's body, labels and assignees, and its timeline (the first 100 events).
// ponytail: one timeline page of 100; follow the Link header when long threads need more.
pub fn task_detail(gh: &Path, host: &str, repo: &str, number: u64) -> Result<TaskDetail, String> {
    let path = item_path(host, repo, number)?;
    let mut d = detail_from(&gh_value(gh, host, &["api", &path, "--hostname", host], None)?);
    let line = |v: &serde_json::Value| v.as_str().unwrap_or("").lines().next().unwrap_or("").chars().take(200).collect::<String>();
    let timeline = gh_value(gh, host, &["api", &format!("{path}/timeline"), "--hostname", host, "-X", "GET", "-f", "per_page=100"], None)?;
    for e in timeline.as_array().into_iter().flatten() {
        let kind = e["event"].as_str().unwrap_or("");
        if kind.is_empty() || matches!(kind, "subscribed" | "unsubscribed") {
            continue;
        }
        let detail = match kind {
            "labeled" | "unlabeled" => line(&e["label"]["name"]),
            "assigned" | "unassigned" => line(&e["assignee"]["login"]),
            "review_requested" | "review_request_removed" => line(&e["requested_reviewer"]["login"]),
            "renamed" => format!("{} \u{2192} {}", line(&e["rename"]["from"]), line(&e["rename"]["to"])),
            "commented" | "reviewed" => line(&e["body"]),
            "committed" => line(&e["message"]),
            "cross-referenced" => line(&e["source"]["issue"]["title"]),
            "referenced" => e["commit_id"].as_str().unwrap_or("").chars().take(7).collect(),
            _ => String::new(),
        };
        let actor = [&e["actor"]["login"], &e["user"]["login"], &e["author"]["name"]].into_iter().find_map(|a| a.as_str()).unwrap_or("").to_string();
        let at = [&e["created_at"], &e["submitted_at"], &e["author"]["date"]].into_iter().find_map(|a| a.as_str()).unwrap_or("").to_string();
        d.events.push(TaskEvent { kind: kind.into(), actor, at, detail });
    }
    Ok(d)
}

/// GIT-050: the labels `repo` offers (its first 100), for the dialog's label picker.
pub fn repo_labels(gh: &Path, host: &str, repo: &str) -> Result<Vec<TaskLabel>, String> {
    let path = item_path(host, repo, 0)?;
    let base = path.trim_end_matches("/issues/0");
    Ok(label_list(&gh_value(gh, host, &["api", &format!("{base}/labels"), "--hostname", host, "-X", "GET", "-f", "per_page=100"], None)?))
}

/// Percent-encodes everything but unreserved characters, for a name inside an API address.
fn path_part(text: &str) -> String {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// GIT-050: adds then removes labels on an item; answers with the labels it has afterwards.
pub fn task_labels(gh: &Path, host: &str, repo: &str, number: u64, add: &[String], remove: &[String]) -> Result<Vec<TaskLabel>, String> {
    let path = item_path(host, repo, number)?;
    let mut now = None;
    if !add.is_empty() {
        let fields: Vec<String> = add.iter().map(|l| format!("labels[]={l}")).collect();
        let mut args = vec!["api", "-X", "POST", "", "--hostname", host];
        let at = format!("{path}/labels");
        args[3] = &at;
        for f in &fields {
            args.extend(["-f", f.as_str()]);
        }
        now = Some(label_list(&gh_value(gh, host, &args, None)?));
    }
    for l in remove {
        let at = format!("{path}/labels/{}", path_part(l));
        now = Some(label_list(&gh_value(gh, host, &["api", "-X", "DELETE", &at, "--hostname", host], None)?));
    }
    match now {
        Some(l) => Ok(l),
        None => Ok(detail_from(&gh_value(gh, host, &["api", &path, "--hostname", host], None)?).labels),
    }
}

/// GIT-050: saves an item's description; answers with the item as GitHub now has it.
pub fn task_body(gh: &Path, host: &str, repo: &str, number: u64, body: &str) -> Result<TaskDetail, String> {
    let path = item_path(host, repo, number)?;
    let input = serde_json::json!({ "body": body }).to_string();
    Ok(detail_from(&gh_value(gh, host, &["api", "-X", "PATCH", &path, "--hostname", host, "--input", "-"], Some(&input))?))
}

#[tauri::command]
pub async fn scm_task_detail(host: String, repo: String, number: u64) -> Result<TaskDetail, String> {
    tauri::async_runtime::spawn_blocking(move || task_detail(&gh_program()?, &host, &repo, number)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_repo_labels(host: String, repo: String) -> Result<Vec<TaskLabel>, String> {
    tauri::async_runtime::spawn_blocking(move || repo_labels(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_task_labels(host: String, repo: String, number: u64, add: Vec<String>, remove: Vec<String>) -> Result<Vec<TaskLabel>, String> {
    tauri::async_runtime::spawn_blocking(move || task_labels(&gh_program()?, &host, &repo, number, &add, &remove)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_task_body(host: String, repo: String, number: u64, body: String) -> Result<TaskDetail, String> {
    tauri::async_runtime::spawn_blocking(move || task_body(&gh_program()?, &host, &repo, number, &body)).await.map_err(|e| e.to_string())?
}

/// GIT-033: what the merge box needs, read in one GraphQL call when the box is opened.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeInfo {
    pub state: String,
    pub draft: bool,
    /// MERGEABLE, CONFLICTING or UNKNOWN (GitHub is still working it out).
    pub mergeable: String,
    /// GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, DRAFT, UNSTABLE, HAS_HOOKS or UNKNOWN.
    pub merge_state: String,
    pub review: Option<String>,
    /// The last commit's combined check state: SUCCESS, PENDING, EXPECTED, FAILURE or ERROR.
    pub checks: Option<String>,
    pub in_queue: bool,
    pub queue_enabled: bool,
    /// The method auto-merge will use, when it is on.
    pub auto_merge: Option<String>,
    /// The merge methods the repository permits, of merge, squash and rebase.
    pub methods: Vec<String>,
    pub auto_allowed: bool,
}

const MERGE_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed pullRequest(number:$number){state isDraft mergeable mergeStateStatus reviewDecision isInMergeQueue isMergeQueueEnabled autoMergeRequest{mergeMethod} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}";

/// `host`, `owner`, `repo` and the number of a pull request link.
pub(crate) fn pr_parts(url: &str) -> Option<(String, String, String, u64)> {
    let clean = pr_url_in(url.trim())?;
    let parts: Vec<&str> = clean.strip_prefix("https://")?.split('/').collect();
    Some((parts[0].into(), parts[1].into(), parts[2].into(), parts[4].parse().ok()?))
}

pub fn merge_info(gh: &Path, worktree: &Path, url: &str) -> Result<MergeInfo, String> {
    let (host, owner, name, number) = pr_parts(url).ok_or("That is not a pull request link")?;
    signed_host(gh, &host)?;
    // FIX-2: owner and name go as raw strings (-f); gh reads a -F value that starts with @ from a file.
    let (q, o, n, k) = (format!("query={MERGE_QUERY}"), format!("owner={owner}"), format!("name={name}"), format!("number={number}"));
    let text = gh_run(gh, worktree, &["api", "graphql", "--hostname", &host, "-f", &q, "-f", &o, "-f", &n, "-F", &k], None).map_err(|e| gh_words(&e))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let repo = &v["data"]["repository"];
    let pr = &repo["pullRequest"];
    if !pr.is_object() {
        return Err(format!("GitHub has no pull request #{number} in {owner}/{name}"));
    }
    let word = |x: &serde_json::Value| x.as_str().map(str::to_string);
    let methods = [("mergeCommitAllowed", "merge"), ("squashMergeAllowed", "squash"), ("rebaseMergeAllowed", "rebase")];
    Ok(MergeInfo {
        state: word(&pr["state"]).unwrap_or_default(),
        draft: pr["isDraft"].as_bool().unwrap_or(false),
        mergeable: word(&pr["mergeable"]).unwrap_or_else(|| "UNKNOWN".into()),
        merge_state: word(&pr["mergeStateStatus"]).unwrap_or_else(|| "UNKNOWN".into()),
        review: word(&pr["reviewDecision"]),
        checks: word(&pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]),
        in_queue: pr["isInMergeQueue"].as_bool().unwrap_or(false),
        queue_enabled: pr["isMergeQueueEnabled"].as_bool().unwrap_or(false),
        auto_merge: word(&pr["autoMergeRequest"]["mergeMethod"]).map(|m| if m == "MERGE" { "merge".into() } else { m.to_lowercase() }),
        methods: methods.iter().filter(|(f, _)| repo[*f].as_bool().unwrap_or(false)).map(|(_, m)| m.to_string()).collect(),
        auto_allowed: repo["autoMergeAllowed"].as_bool().unwrap_or(false),
    })
}

/// GIT-033: one merge-box action through gh. `queue` merges with no method, which gh turns
/// into joining the base branch's merge queue.
pub fn merge_act(gh: &Path, worktree: &Path, url: &str, action: &str, method: Option<&str>) -> Result<String, String> {
    let (host, ..) = pr_parts(url).ok_or("That is not a pull request link")?;
    signed_host(gh, &host)?;
    // FIX-3 (review AFTER 1): gh gets the cleaned form of the link, never the raw text.
    let clean = pr_url_in(url.trim()).ok_or("That is not a pull request link")?;
    let url = clean.as_str();
    let flag = match method {
        None => None,
        Some(m @ ("merge" | "squash" | "rebase")) => Some(format!("--{m}")),
        Some(m) => return Err(format!("{m} is not a merge method")),
    };
    let need = || flag.as_deref().ok_or("Pick a merge method first");
    let args: Vec<&str> = match action {
        "merge" => vec!["pr", "merge", url, need()?],
        "auto" => vec!["pr", "merge", url, "--auto", need()?],
        "disable-auto" => vec!["pr", "merge", url, "--disable-auto"],
        "queue" => vec!["pr", "merge", url],
        "ready" | "close" | "reopen" => vec!["pr", action, url],
        other => return Err(format!("{other} is not a pull request action")),
    };
    gh_run(gh, worktree, &args, None).map_err(|e| gh_words(&e))
}

#[tauri::command]
pub async fn scm_merge_info(worktree: String, url: String) -> Result<MergeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || merge_info(&gh_program()?, Path::new(&worktree), &url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_merge(worktree: String, url: String, action: String, method: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || merge_act(&gh_program()?, Path::new(&worktree), &url, &action, method.as_deref())).await.map_err(|e| e.to_string())?
}

/// Only an https link to a pull request, with nothing a shell could read as an option.
/// The host part may not name a user, a password or a port, so the link opens the host it shows.
fn safe_pr_url(url: &str) -> bool {
    let host = url.strip_prefix("https://").map(|rest| rest.split('/').next().unwrap_or(""));
    let plain_host = host.is_some_and(|h| !h.is_empty() && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    plain_host && url.contains("/pull/") && !url.chars().any(|c| c.is_whitespace() || c == '"')
}

/// Row 953: `scm_pr`'s body with the gh resolver passed in, so a test can prove gh is never resolved off GitHub.
pub(crate) fn pr_answer(dir: &Path, linked: Option<String>, gh: &dyn Fn() -> Result<std::path::PathBuf, String>) -> Result<crate::pr_review::PrAnswer, String> {
    // Row 953: gh is asked only for a GitHub remote (a hand link included); any other provider answers which one it is.
    let provider = crate::pr_review::provider_for(repo_id::primary_host(dir, &ssh_config())?.as_deref());
    crate::pr_review::pr_for(&provider, || {
        if let Some(url) = linked {
            return pr_link(&gh()?, dir, &url).map(Some);
        }
        let branch = status(dir)?.branch.ok_or("No branch is checked out here")?;
        pr_find(&gh()?, dir, &branch)
    })
}

#[tauri::command]
pub async fn scm_pr(worktree: String, linked: Option<String>) -> Result<crate::pr_review::PrAnswer, String> {
    tauri::async_runtime::spawn_blocking(move || pr_answer(Path::new(&worktree), linked, &gh_program))
        .await
        .map_err(|e| e.to_string())?
}

/// VIEW-073: the Checks panel's lookup, for the worktree's branch or its hand-linked pull request.
#[tauri::command]
pub async fn scm_pr_checks(worktree: String, linked: Option<String>) -> Result<PrChecks, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        if let Some(url) = linked {
            return pr_checks_linked(&gh_program()?, dir, &url);
        }
        let branch = status(dir)?.branch.ok_or("No branch is checked out here")?;
        // Row 76: gh is asked only for a GitHub remote; any other provider answers "no pull request" and names itself.
        let provider = crate::pr_review::provider_for(repo_id::primary_host(dir, &ssh_config())?.as_deref());
        crate::pr_review::checks_for(&provider, || pr_checks(&gh_program()?, dir, &branch))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_pr_create(worktree: String, title: String, body: String, base: String, draft: bool, push: Option<bool>) -> Result<Pr, String> {
    // T-652: a caller that says nothing keeps the old behaviour (push first); the automatic flow passes false.
    let push = push.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        // Row 76: gh creates pull requests on GitHub only; any other remote is refused by name before gh is looked for.
        let provider = crate::pr_review::provider_for(repo_id::primary_host(dir, &ssh_config())?.as_deref());
        crate::pr_review::create_for(&provider, || pr_create(&gh_program()?, dir, &title, &body, &base, draft, push))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-014: shows a changed file in the file manager (its folder when the file was deleted); the
/// path is relative to the worktree and must stay inside it.
#[tauri::command]
pub async fn scm_reveal(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, worktree: String, path: String) -> Result<(), String> {
    let roots = crate::links::roots(&store);
    tauri::async_runtime::spawn_blocking(move || {
        let full = reveal_place(&roots, &worktree, &path)?;
        crate::links::reveal(&full)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-014: the place a reveal shows. The worktree must be on this machine (SAFE-021) and inside a
/// registered project or workspaces folder, its real place included (EDIT-045's fence), so a
/// forged call cannot show an arbitrary folder.
fn reveal_place(roots: &[String], worktree: &str, path: &str) -> Result<std::path::PathBuf, String> {
    crate::links::fence(worktree, roots, &std::collections::HashSet::new(), true)?;
    reveal_target(Path::new(worktree), path)
}

/// GIT-014: the file a reveal shows: inside the worktree, or its nearest folder that still exists.
fn reveal_target(worktree: &Path, path: &str) -> Result<std::path::PathBuf, String> {
    check_paths(std::slice::from_ref(&path.to_string()))?;
    // The text stays inside; a link or junction inside the worktree could still lead out (to a
    // private folder, or a share whose server would be contacted), so no part below the worktree
    // may be one. Read without following links; a missing part ends the walk (nothing past it
    // exists), and any other lookup error refuses rather than guessing. A part swapped for a link
    // between this walk and the file manager opening is not caught here (a narrow race on the
    // user's own disk; the file manager then shows that place, nothing is read or written).
    let mut at = worktree.to_path_buf();
    for part in Path::new(&native(path)).components() {
        at.push(part);
        match fs::symlink_metadata(&at) {
            Ok(m) if m.file_type().is_symlink() => return Err(format!("{path} goes through a link that leads outside the worktree")),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(format!("{path} cannot be looked up: {e}")),
        }
    }
    let mut full = worktree.join(native(path));
    while !full.exists() && full != worktree {
        full = full.parent().map(Path::to_path_buf).unwrap_or_else(|| worktree.to_path_buf());
    }
    Ok(full)
}

/// FIX-3 (review AFTER 3): what the browser is handed for a pull request link: the cleaned
/// `https://host/owner/repo/pull/N` form, never the raw text.
fn open_target(url: &str) -> Result<String, String> {
    let url = url.trim();
    if !safe_pr_url(url) {
        return Err("That is not a pull request link".into());
    }
    pr_url_in(url).ok_or_else(|| "That is not a pull request link".into())
}

/// Opens a pull request in the browser.
#[tauri::command]
pub async fn scm_open_pr(url: String) -> Result<(), String> {
    let url = open_target(&url)?;
    #[cfg(windows)]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    quiet(opener).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// GIT-035: one ref drawn on a commit; `kind` is current, head (detached), branch, upstream,
/// base, remote or tag.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Label {
    pub name: String,
    pub kind: &'static str,
}

/// GIT-035: one commit of the history; `outgoing` is here and not on the upstream, `incoming`
/// the other way round.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub time: i64,
    pub subject: String,
    pub message: String,
    pub labels: Vec<Label>,
    pub outgoing: bool,
    pub incoming: bool,
    /// UX-D: set (only) on the last commit when older commits exist that the `limit` left out, so
    /// the list can say it stops there. Absent otherwise, so older readers see the same shape.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub capped: bool,
}

/// The refs `git log --decorate=full` printed for one commit, sorted into kinds. A remote label
/// beside a local branch of the same name is left out, and so is a remote's HEAD.
fn labels(decor: &str, upstream: Option<&str>, base: Option<&str>) -> Vec<Label> {
    let mut out = Vec::new();
    for part in decor.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        let (name, kind) = if let Some(b) = part.strip_prefix("HEAD -> refs/heads/") {
            (b, "current")
        } else if part == "HEAD" {
            ("HEAD", "head")
        } else if let Some(t) = part.strip_prefix("tag: refs/tags/") {
            (t, "tag")
        } else if let Some(b) = part.strip_prefix("refs/heads/") {
            (b, "branch")
        } else if let Some(r) = part.strip_prefix("refs/remotes/") {
            if r.ends_with("/HEAD") {
                continue;
            }
            (r, "remote")
        } else {
            continue;
        };
        let kind = if kind == "remote" && Some(name) == upstream {
            "upstream"
        } else if (kind == "remote" && Some(name) == base) || (kind == "branch" && base.and_then(|b| b.split_once('/')).map(|(_, b)| b) == Some(name)) {
            "base"
        } else {
            kind
        };
        out.push(Label { name: name.to_string(), kind });
    }
    let locals: Vec<String> = out.iter().filter(|l| l.kind == "current" || l.kind == "branch" || (l.kind == "base" && !l.name.contains('/'))).map(|l| l.name.clone()).collect();
    out.retain(|l| !(matches!(l.kind, "remote" | "upstream" | "base") && l.name.split_once('/').is_some_and(|(_, rest)| locals.iter().any(|n| n == rest))));
    out
}

/// GIT-035: the newest `limit` commits of HEAD and its upstream in topological order, so commits
/// the upstream gained later sit apart at the top instead of inside older history. Empty for a
/// repository with no commits.
pub fn history(worktree: &Path, limit: usize) -> Result<Vec<Commit>, String> {
    if run(&["rev-parse", "--verify", "-q", "HEAD"], Some(worktree)).is_err() {
        return Ok(Vec::new());
    }
    let st = status(worktree)?;
    // One more than asked for, so a cut-off history can be told from one that ends here.
    let count = format!("-n{}", limit + 1);
    let mut args = vec!["log", "--topo-order", count.as_str(), "--decorate=full", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1f%B%x1e", "HEAD"];
    if st.upstream.is_some() {
        args.push("@{upstream}");
    }
    let text = run(&args, Some(worktree))?;
    let set = |range: &str| run(&["rev-list", range], Some(worktree)).map(|t| t.lines().map(str::to_string).collect::<std::collections::HashSet<_>>()).unwrap_or_default();
    let (outgoing, incoming) = if st.upstream.is_some() { (set("@{upstream}..HEAD"), set("HEAD..@{upstream}")) } else { Default::default() };
    let mut commits: Vec<Commit> = text
        .split('\x1e')
        .map(|r| r.trim_start_matches(['\n', '\r']))
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.splitn(8, '\x1f').collect();
            (f.len() == 8).then(|| Commit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents: f[2].split_whitespace().map(str::to_string).collect(),
                author: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                labels: labels(f[5], st.upstream.as_deref(), st.base.as_deref()),
                subject: f[6].to_string(),
                message: f[7].trim_end().to_string(),
                outgoing: outgoing.contains(f[0]),
                incoming: incoming.contains(f[0]),
                capped: false,
            })
        })
        .collect();
    if commits.len() > limit {
        commits.truncate(limit);
        if let Some(last) = commits.last_mut() {
            last.capped = true;
        }
    }
    Ok(commits)
}

/// GIT-035: the files one commit changed (against its first parent; a root commit adds all).
pub fn commit_files(worktree: &Path, hash: &str) -> Result<Vec<Change>, String> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That is not a commit id".into());
    }
    Ok(name_status(&run(&["diff-tree", "--no-commit-id", "-r", "--root", "-M", "--name-status", "-z", hash], Some(worktree))?))
}

/// `--name-status -z` output as changes; a rename or copy carries the name it came from.
fn name_status(text: &str) -> Vec<Change> {
    let mut parts = text.split('\0').filter(|p| !p.is_empty());
    let mut out = Vec::new();
    while let Some(code) = parts.next() {
        let letter = code.chars().next().unwrap_or('M').to_string();
        if letter == "R" || letter == "C" {
            let from = parts.next().unwrap_or_default().to_string();
            let path = parts.next().unwrap_or_default().to_string();
            out.push(Change { path, status: letter, from: Some(from) });
        } else if let Some(path) = parts.next() {
            out.push(Change { path: path.to_string(), status: letter, from: None });
        }
    }
    out
}

#[tauri::command]
pub async fn scm_history(worktree: String) -> Result<Vec<Commit>, String> {
    tauri::async_runtime::spawn_blocking(move || history(Path::new(&worktree), 200)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_commit_files(worktree: String, hash: String) -> Result<Vec<Change>, String> {
    tauri::async_runtime::spawn_blocking(move || commit_files(Path::new(&worktree), &hash)).await.map_err(|e| e.to_string())?
}

/// Parses porcelain v2 with NUL separators, so names with spaces, quotes or non-ASCII letters
/// come through as they are. A file changed in both the index and the tree is in both lists.
pub fn parse_status(text: &str) -> Status {
    let mut st = Status::default();
    let mut items = text.split('\0').filter(|s| !s.is_empty());
    let change = |path: &str, letter: char, from: Option<&str>| Change { path: path.to_string(), status: letter.to_string(), from: from.map(String::from) };
    while let Some(item) = items.next() {
        if let Some(rest) = item.strip_prefix("# ") {
            match rest.split_once(' ') {
                Some(("branch.oid", oid)) if oid != "(initial)" => st.head = Some(oid.to_string()),
                Some(("branch.head", head)) if head != "(detached)" => st.branch = Some(head.to_string()),
                Some(("branch.upstream", up)) => st.upstream = Some(up.to_string()),
                Some(("branch.ab", ab)) => {
                    for part in ab.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            st.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let (kind, rest) = item.split_at(1);
        let rest = rest.trim_start();
        match kind {
            "?" => st.untracked.push(change(rest, 'U', None)),
            "1" | "2" | "u" => {
                let fields = if kind == "1" { 9 } else if kind == "2" { 10 } else { 11 };
                let mut parts = rest.splitn(fields - 1, ' ');
                let xy = parts.next().unwrap_or("..");
                let sub = if kind == "u" { None } else { parts.next().and_then(submodule_state) };
                let path = parts.last().unwrap_or("");
                let from = if kind == "2" { items.next() } else { None };
                let (x, y) = (xy.chars().next().unwrap_or('.'), xy.chars().nth(1).unwrap_or('.'));
                if kind == "u" {
                    st.conflicts.push(Change { path: path.to_string(), status: xy.to_string(), from: None });
                    continue;
                }
                if let Some(state) = sub {
                    if st.submodules.len() >= SUBMODULE_ROWS {
                        st.submodules_cut += 1;
                        continue;
                    }
                    st.submodules.insert(path.to_string(), state);
                }
                if x != '.' {
                    st.staged.push(change(path, x, from));
                }
                if y != '.' {
                    st.changed.push(change(path, y, None));
                }
            }
            _ => {}
        }
    }
    st
}

/// GIT-002: paths are relative to the worktree and must stay inside it; anything else is refused
/// before git sees it. A folder covers every file beneath it (git does that itself).
fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("nothing to stage".into());
    }
    for p in paths {
        let path = Path::new(p);
        let inside = !p.trim().is_empty() && path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if !inside {
            return Err(format!("{p} is outside this workspace"));
        }
    }
    Ok(())
}

/// Stages (`on`) or unstages the paths in this worktree's index. The list goes to git on its
/// standard input, NUL separated and taken literally, so any number of names fits and a name
/// holding `*` or `[` matches only itself.
pub fn stage(worktree: &Path, paths: &[String], on: bool) -> Result<(), String> {
    check_paths(paths)?;
    // `restore --staged` needs a commit to restore from; in a repository with none, unstaging is
    // taking the paths out of the index.
    let no_commits = !on && run(&["rev-parse", "--verify", "-q", "HEAD"], Some(worktree)).is_err();
    let args: &[&str] = if on {
        &["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else if no_commits {
        &["--literal-pathspecs", "rm", "--cached", "-r", "-q", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else {
        &["--literal-pathspecs", "restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
    };
    piped(worktree, args, paths)
}

/// Runs git with the paths on its standard input, NUL separated; git's own words when it fails.
fn piped(worktree: &Path, args: &[&str], paths: &[String]) -> Result<(), String> {
    let mut child = command(args, Some(worktree)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let input = paths.iter().map(|p| format!("{p}\0")).collect::<String>();
    child.stdin.take().ok_or("git has no input")?.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// GIT-003: throws away the uncommitted work on `paths`. A new file (untracked, or only staged)
/// is removed for good, a deleted file comes back from the last commit, a modified or renamed
/// file is put back as the last commit had it; staged work is unstaged first. A link is only ever
/// removed or rewritten as a link: what it points at is never followed, so nothing outside the
/// repository is touched. An untracked folder (`box/`) goes with everything in it.
pub fn discard_paths(worktree: &Path, paths: &[String]) -> Result<(), String> {
    check_paths(paths)?;
    let st = status(worktree)?;
    let (mut staged, mut tracked, mut remove) = (Vec::new(), Vec::new(), Vec::new());
    for p in paths {
        let p = p.trim_end_matches('/');
        let index = st.staged.iter().find(|c| c.path == p);
        if let Some(c) = index {
            staged.push(c.path.clone());
            if let Some(from) = &c.from {
                staged.push(from.clone());
                tracked.push(from.clone());
            }
        }
        if st.untracked.iter().any(|c| c.path.trim_end_matches('/') == p) || index.is_some_and(|c| c.status == "A" || c.from.is_some()) {
            remove.push(p.to_string());
        } else {
            tracked.push(p.to_string());
        }
    }
    if !staged.is_empty() {
        with_paths(worktree, &["reset", "-q"], &staged)?;
    }
    for p in &tracked {
        // A link is removed before git rewrites it, so git never writes through it.
        let full = worktree.join(native(p));
        if fs::symlink_metadata(&full).is_ok_and(|m| m.is_symlink()) {
            fs::remove_file(&full).or_else(|_| fs::remove_dir(&full)).map_err(|e| format!("{p}: {e}"))?;
        }
    }
    if !tracked.is_empty() {
        with_paths(worktree, &["checkout", "-q", "HEAD"], &tracked)?;
    }
    for p in &remove {
        let full = worktree.join(native(p));
        let Ok(meta) = fs::symlink_metadata(&full) else { continue };
        let done = if meta.is_dir() { fs::remove_dir_all(&full) } else { fs::remove_file(&full).or_else(|_| fs::remove_dir(&full)) };
        done.map_err(|e| format!("{p}: {e}"))?;
    }
    Ok(())
}

/// Runs `git <args>` over `paths` handed on stdin, NUL-separated and literal, so no name is
/// read as a pattern.
fn with_paths(worktree: &Path, args: &[&str], paths: &[String]) -> Result<(), String> {
    let mut all = vec!["--literal-pathspecs"];
    all.extend_from_slice(args);
    all.extend_from_slice(&["--pathspec-from-file=-", "--pathspec-file-nul"]);
    let mut child = command(&all, Some(worktree)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let input = paths.iter().map(|p| format!("{p}\0")).collect::<String>();
    child.stdin.take().ok_or("git has no input")?.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// VIEW-067: throws away the changes in one section of the panel. Staged rows go back to the last
/// commit in the index and on disk (so a staged new file is deleted), changed rows go back to what
/// is staged, untracked rows are deleted. git clean only ever removes untracked files, so a tracked
/// name sent as untracked is left alone.
pub fn discard(worktree: &Path, section: &str, paths: &[String]) -> Result<(), String> {
    check_paths(paths)?;
    match section {
        "staged" => piped(worktree, &["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], paths),
        "changed" => piped(worktree, &["--literal-pathspecs", "restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], paths),
        "untracked" => {
            // ponytail: git clean reads no list from its input, so the names go on the command line
            // in chunks that stay well under the Windows command-line limit.
            for chunk in paths.chunks(100) {
                let mut args = vec!["--literal-pathspecs", "clean", "-f", "-d", "-q", "--"];
                args.extend(chunk.iter().map(String::as_str));
                run(&args, Some(worktree))?;
            }
            Ok(())
        }
        _ => Err(format!("the {section} section cannot be discarded")),
    }
}

/// GIT-004: commits what is staged with `message`. A refusal by a hook (one is installed and git
/// said no) comes back as blocked, with everything the hook printed.
pub fn commit(worktree: &Path, message: &str) -> Result<CommitOutcome, String> {
    if message.trim().is_empty() {
        return Err("a commit needs a message".into());
    }
    let mut child = command(&["commit", "--quiet", "-F", "-"], Some(worktree)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    child.stdin.take().ok_or("git has no input")?.write_all(message.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let output = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() {
        let id = run(&["rev-parse", "--short", "HEAD"], Some(worktree))?;
        return Ok(CommitOutcome { id: Some(id), blocked: false, output });
    }
    Ok(CommitOutcome { id: None, blocked: has_commit_hook(worktree), output })
}

/// Is a hook installed that can refuse a commit? (`core.hooksPath` is honoured by git itself.)
fn has_commit_hook(worktree: &Path) -> bool {
    let Ok(dir) = run(&["rev-parse", "--git-path", "hooks"], Some(worktree)) else { return false };
    let dir = worktree.join(native(&dir));
    ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-merge-commit"].iter().any(|h| dir.join(h).is_file())
}

#[tauri::command]
pub async fn scm_status(worktree: String) -> Result<Status, String> {
    // GIT-070: the panel on screen is foreground work, off the async workers so a burst of
    // background calls cannot hold it up; GIT-012: its lists are capped.
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        crate::git::foreground(|| status(dir).map(|st| capped(st, dir)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// PROJ-062 (T-609, cycle 3): the sidebar card's changed-file count. A count-only read in the background
/// lane: one `git status`, no file lists, no line counts, and no `git::foreground`, so a slow count on one
/// workspace waits behind the panel and the editor's reads instead of holding them up (GIT-070).
#[tauri::command]
pub async fn scm_count(worktree: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || count(Path::new(&worktree))).await.map_err(|e| e.to_string())?
}

/// PROJ-062: how many files differ from HEAD in `worktree`, each path once wherever git lists it. The same
/// status read the panel makes, without the numstat diff, the untracked line counts or the upstream look.
fn count(worktree: &Path) -> Result<usize, String> {
    let out = output(&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], Some(worktree))?;
    Ok(count_paths(&parse_status(&String::from_utf8_lossy(&out))))
}

/// PROJ-062: each changed path once across staged, changed, untracked and conflicted files. The window's
/// `changedCount` (src/look/cardChanges.ts) has the same rule; this is its back-end twin.
fn count_paths(st: &Status) -> usize {
    let mut paths = std::collections::HashSet::new();
    for c in st.staged.iter().chain(&st.changed).chain(&st.untracked).chain(&st.conflicts) {
        paths.insert(c.path.as_str());
    }
    paths.len()
}

/// GIT-012: the cut-short banner's offer; only inside a project or worktree (ACCT-055, fence.rs).
#[tauri::command]
pub async fn scm_ignore_heavy(worktree: String, folders: Vec<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    ignore_heavy(&fence.allow(&worktree, &store, &git, false)?, &folders)
}

/// GIT-038 (T-033-c): All Changes measured against the branch's base: `against` is the pinned
/// base when it resolves, else the detected one; `since` is the snapshot (the merge-base with
/// HEAD, so the base moving on afterwards changes nothing here); `entries` every file that
/// differs between that snapshot and the working tree.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseChanges {
    pub against: String,
    pub since: String,
    pub entries: Vec<crate::git::Entry>,
    /// T-033-g: set when the branch and the base share no history (unrelated histories, or a
    /// shallow clone cut before the fork): the changes are then measured against the base's tip,
    /// and the tab says so instead of passing them off as the branch's own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A commit for `rev` (ref-name rules first, so nothing starting with `-` reaches git as an option).
fn commit_of(worktree: &Path, rev: &str) -> Option<String> {
    if !Git::ref_ok(rev) {
        return None;
    }
    run(&["rev-parse", "--verify", "-q", "--end-of-options", &format!("{rev}^{{commit}}")], Some(worktree)).ok().map(|s| s.trim().to_string())
}

/// `known` is the base the tab already has from the last status (T-033-g): with it no second
/// status runs on every refresh. Without a pin or a known base, status finds it.
pub fn base_changes(worktree: &Path, pinned: Option<&str>, known: Option<&str>) -> Result<BaseChanges, String> {
    let pinned = pinned.map(str::trim).filter(|p| !p.is_empty() && commit_of(worktree, p).is_some());
    let known = known.map(str::trim).filter(|k| Git::ref_ok(k));
    let against = match (pinned, known) {
        (Some(p), _) => p.to_string(),
        (None, Some(k)) => k.to_string(),
        (None, None) => status(worktree)?.base.ok_or("no base branch to compare with")?,
    };
    let (since, note) = match run(&["merge-base", "--end-of-options", &against, "HEAD"], Some(worktree)) {
        Ok(s) => (s.trim().to_string(), None),
        // The rare path: find out why, never compare silently against something else.
        Err(_) => {
            if commit_of(worktree, "HEAD").is_none() {
                return Err("this branch has no commits yet, so there is nothing to compare with its base".into());
            }
            let Some(tip) = commit_of(worktree, &against) else {
                return Err(format!("the base {against} no longer exists"));
            };
            (tip, Some(format!("vs {against} tip: no common ancestor found")))
        }
    };
    let entries = crate::git::base_entries(worktree, &since)?;
    Ok(BaseChanges { against, since, entries, note })
}

#[tauri::command]
pub async fn scm_base_changes(worktree: String, pinned: Option<String>, known: Option<String>) -> Result<BaseChanges, String> {
    tauri::async_runtime::spawn_blocking(move || base_changes(Path::new(&worktree), pinned.as_deref(), known.as_deref())).await.map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Serialize)]
pub struct BaseSides {
    pub original: String,
    pub modified: String,
}

/// The two texts of one file against the base snapshot; the file must lie in the worktree.
#[tauri::command]
pub async fn scm_base_sides(worktree: String, path: String, since: String) -> Result<BaseSides, String> {
    let (root, file) = (Path::new(&worktree), Path::new(&path));
    if !file.starts_with(root) {
        return Err(format!("{path} is not inside {worktree}"));
    }
    let file = file.to_path_buf();
    let (original, modified) = tauri::async_runtime::spawn_blocking(move || crate::git::base_sides(&file, &since)).await.map_err(|e| e.to_string())??;
    Ok(BaseSides { original, modified })
}

/// GIT-001 (T-033-b): starts or joins the watch of the worktree holding `path`; its status arrives
/// as the `scm-status-<id>` event, the same shape `scm_status` returns. FIX-1 (T-033-e review): a
/// watch that ends on its own says so as `scm-watch-ended-<id>`, and the page subscribes again.
#[tauri::command]
pub async fn scm_watch(app: tauri::AppHandle, path: String) -> Result<watch::WatchStart, String> {
    use tauri::{Emitter, Manager};
    let dir = app.path().app_data_dir().ok();
    let ended = {
        let app = app.clone();
        std::sync::Arc::new(move |id: u64| drop(app.emit(&format!("scm-watch-ended-{id}"), ()))) as watch::Ended
    };
    let sink = move |id: u64| {
        let (app, event) = (app.clone(), format!("scm-status-{id}"));
        std::sync::Arc::new(move |st: &Status| drop(app.emit(&event, st))) as std::sync::Arc<dyn Fn(&Status) + Send + Sync>
    };
    let log = std::sync::Arc::new(move |line: &str| {
        if let Some(d) = &dir {
            crate::diag::write(d, line);
        }
    });
    watch::watch_with(Path::new(&path), sink, ended, log)
}

#[tauri::command]
pub async fn scm_unwatch(id: u64) {
    watch::unwatch(id);
}

#[tauri::command]
pub async fn scm_summary(worktree: String, pinned: Option<String>, upstream: bool) -> Result<Summary, String> {
    // GIT-070: the branch summary of the panel on screen is foreground work too.
    tauri::async_runtime::spawn_blocking(move || crate::git::foreground(|| summary(Path::new(&worktree), pinned.as_deref(), upstream))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_abort(worktree: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort(Path::new(&worktree))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
/// ACCT-055: stage and discard only in a project or worktree (fence.rs).
pub async fn scm_stage(worktree: String, paths: Vec<String>, on: bool, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let root = fence.allow(&worktree, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || stage(&root, &paths, on)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
/// VIEW-067 discards one section; GIT-003 rows picked across sections come without one.
/// ACCT-055: only inside a project or worktree (fence.rs).
pub async fn scm_discard(worktree: String, section: Option<String>, paths: Vec<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let root = fence.allow(&worktree, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || match section {
        Some(section) => discard(&root, &section, &paths),
        None => discard_paths(&root, &paths),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_commit(worktree: String, message: String) -> Result<CommitOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || commit(Path::new(&worktree), &message)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_remote(worktree: String, action: String) -> Result<ActionOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || remote(Path::new(&worktree), &action)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-scm-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&dir)).unwrap();
        run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        dir
    }

    #[test]
    fn git012_a_huge_change_set_is_cut_and_its_heavy_folder_offered_until_ignored() {
        let dir = temp_repo("git012-heavy");
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        for i in 0..PANEL_CAP + 200 {
            fs::write(dir.join("node_modules").join(format!("m{i}.js")), "x").unwrap();
        }
        fs::create_dir_all(dir.join("target")).unwrap();
        fs::write(dir.join("target").join("out.bin"), "x").unwrap();
        fs::write(dir.join(".gitignore"), "/target/").unwrap();
        let st = capped(status(&dir).unwrap(), &dir);
        // node_modules' 1,200 files plus .gitignore: the list shows 1,000 and counts the rest.
        assert_eq!((st.untracked.len(), st.cut), (PANEL_CAP, 201));
        assert_eq!(st.heavy, ["node_modules"], "target is ignored already and the other heavy names are not there");
        ignore_heavy(&dir, &["node_modules".into()]).unwrap();
        assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), "/target/\n/node_modules/\n");
        let st = capped(status(&dir).unwrap(), &dir);
        assert_eq!((st.untracked.len(), st.cut, st.heavy.len()), (1, 0, 0), "the list shrinks and nothing is offered again");
        ignore_heavy(&dir, &["node_modules".into()]).unwrap();
        assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), "/target/\n/node_modules/\n", "never written twice");
        assert!(ignore_heavy(&dir, &["src".into()]).is_err(), "only known heavy folders");
        assert!(ignore_heavy(&dir, &[]).is_err());
        let fresh = temp_repo("git012-fresh");
        ignore_heavy(&fresh, &["dist".into()]).unwrap();
        assert_eq!(fs::read_to_string(fresh.join(".gitignore")).unwrap(), "/dist/\n", "made when there is none");
        // A small change set is left whole and nothing is looked for.
        let small = capped(status(&fresh).unwrap(), &fresh);
        assert_eq!((small.cut, small.heavy.len()), (0, 0));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&fresh);
    }

    /// PROJ-062 (T-609, cycle 3): the card's count is each changed path once, across staged, changed,
    /// untracked and conflicted files (the window's changedCount has the same rule), read from one git
    /// status on a real worktree.
    #[test]
    fn proj062_the_card_count_is_each_changed_path_once_and_matches_the_panel() {
        let dir = temp_repo("card-count");
        fs::write(dir.join("README.md"), "hello again\n").unwrap();
        fs::write(dir.join("new.md"), "new\n").unwrap();
        fs::write(dir.join("staged.md"), "staged\n").unwrap();
        run(&["add", "staged.md"], Some(&dir)).unwrap();
        fs::write(dir.join("staged.md"), "staged and changed\n").unwrap();
        let panel = status(&dir).unwrap();
        assert_eq!(count(&dir).unwrap(), 3, "{:?} {:?} {:?}", panel.staged, panel.changed, panel.untracked);
        assert_eq!(count(&dir).unwrap(), count_paths(&panel), "the count is the panel's rule without the lists");
        let c = |path: &str| Change { path: path.into(), status: "M".into(), from: None };
        assert_eq!(count_paths(&Status { staged: vec![c("a")], changed: vec![c("a")], ..Status::default() }), 1, "a path listed twice counts once");
        let _ = fs::remove_dir_all(&dir);
    }

    /// PROJ-062: the count reads in the background lane. It never wraps its read in `git::foreground`, so a
    /// waiting count goes behind the panel on screen and the editor's reads on the same worktree (GIT-070).
    #[test]
    fn proj062_the_card_count_reads_in_the_background_lane() {
        let dir = temp_repo("card-count-lane");
        assert!(!crate::git::foreground_lane(), "a plain thread is background work");
        assert_eq!(count(&dir).unwrap(), 0);
        assert!(!crate::git::foreground_lane(), "the count must not enter the foreground lane");
        crate::git::foreground(|| assert!(crate::git::foreground_lane(), "the lane hook works"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git070_a_status_read_already_running_is_shared_not_started_again() {
        static R: Running = std::sync::Mutex::new(Vec::new());
        static READS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        static SECOND_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        let dir = Path::new("git070-shared-worktree");
        // Load flake fix: no sleep decides who is first. The first read holds until the second
        // caller has joined it (its share of the answer is counted) or has answered on its own (the
        // regression: a second git started), with a 60 s ceiling; the second starts only once the
        // first read is running.
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let first = std::thread::spawn(move || {
            shared(&R, dir, || {
                let mine = R.lock().unwrap().iter().find(|(p, _)| p == dir).map(|(_, s)| s.clone()).unwrap();
                let alone = std::sync::Arc::strong_count(&mine);
                started_tx.send(()).unwrap();
                let end = std::time::Instant::now() + std::time::Duration::from_secs(60);
                while std::sync::Arc::strong_count(&mine) <= alone && !SECOND_DONE.load(std::sync::atomic::Ordering::SeqCst) && std::time::Instant::now() < end {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                READS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(Status { ahead: 7, ..Status::default() })
            })
        });
        started_rx.recv_timeout(std::time::Duration::from_secs(60)).expect("the first read started");
        let second = shared(&R, dir, || Err("a second git was started".into()));
        SECOND_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(second.unwrap().ahead, 7);
        assert_eq!(first.join().unwrap().unwrap().ahead, 7);
        assert_eq!(READS.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(R.lock().unwrap().is_empty());
        let again = || {
            READS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(Status { ahead: 7, ..Status::default() })
        };
        assert_eq!(shared(&R, dir, again).unwrap().ahead, 7, "a later read runs on its own");
        assert_eq!(READS.load(std::sync::atomic::Ordering::SeqCst), 2);
        // Another worktree is never handed this one's answer.
        assert!(shared(&R, Path::new("other"), || Err("own read".into())).is_err());
    }

    /// FIX-2 (b) / FIX-R2: no console window flashes up behind the app, so every program this file
    /// builds a command for, its tests included, goes through `quiet`, the one place that hides the
    /// console. (git runs go through git::command, which hides it the same way.)
    /// FIX-3 (review AFTER 4): lines (1-based) of every program started with a bare `Command`
    /// constructor call (any spacing around the path) in `src` that neither sits inside `fn quiet`
    /// nor has a `creation_flags` call within the next thirty lines. A file whose commands all come
    /// from `quiet` or `git::command` has none.
    fn bare_spawns(src: &str) -> Vec<usize> {
        let quiet_at = src.find("fn quiet(");
        let quiet_end = quiet_at.map(|q| q + src[q..].find("\n}").unwrap_or(0));
        let lines: Vec<&str> = src.lines().collect();
        let mut found = Vec::new();
        let bytes = src.as_bytes();
        let mut from = 0;
        while let Some(i) = src[from..].find("Command") {
            let at = from + i;
            from = at + "Command".len();
            let rest: String = src[from..].chars().filter(|c| !c.is_whitespace()).take(6).collect();
            if !rest.starts_with("::new(") {
                continue;
            }
            if quiet_at.zip(quiet_end).is_some_and(|(q, e)| (q..e).contains(&at)) {
                continue;
            }
            let line = bytes[..at].iter().filter(|b| **b == b'\n').count();
            if lines[line].trim_start().starts_with("//") {
                continue;
            }
            let hidden = lines[line..lines.len().min(line + 30)].iter().any(|l| l.contains("creation_flags"));
            if !hidden {
                found.push(line + 1);
            }
        }
        found
    }

    #[test]
    fn fix2_every_spawn_hides_its_console() {
        // The scanner itself: a bare spawn is seen, however it is spaced; one with its own flag is not.
        let new = ["Command", "::new("].concat();
        let spaced = ["Command", "\n        ::new("].concat();
        let bad = format!("fn a() {{\n    let c = std::process::{new}\"x\");\n}}\nfn b() {{\n    let c = {spaced}\"y\");\n}}\n// {new}\"z\") in a comment\n");
        assert_eq!(bare_spawns(&bad), vec![2, 5]);
        let good = format!("fn a() {{\n    let mut c = {new}\"x\");\n    c.creation_flags(0x0800_0000);\n}}\n");
        assert!(bare_spawns(&good).is_empty());
        // The files that start programs for source control and gh: none opens a console window.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for name in ["scm.rs", "scm_watch.rs", "git.rs", "github.rs"] {
            let body = fs::read_to_string(dir.join(name)).unwrap();
            let bare = bare_spawns(&body);
            assert!(bare.is_empty(), "{name}: programs started without hiding their console, at lines {bare:?}");
        }
    }

    /// FIX-2 AFTER 1: Show in file manager only works on a worktree inside a registered project or
    /// workspaces folder, so a forged call cannot open any folder on the machine.
    #[test]
    fn fix2_reveal_refuses_a_worktree_outside_every_project() {
        let dir = temp_repo("fix2-fence");
        let inside = vec![dir.to_string_lossy().into_owned()];
        assert_eq!(reveal_place(&inside, &dir.to_string_lossy(), "README.md").unwrap(), dir.join("README.md"));
        let elsewhere = vec![std::env::temp_dir().join("kolux-rs-no-such-project").to_string_lossy().into_owned()];
        assert!(reveal_place(&elsewhere, &dir.to_string_lossy(), "README.md").unwrap_err().contains("outside"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// FIX-2 AFTER 2: only a part that is not there ends the walk; any other lookup error refuses.
    #[test]
    fn fix2_reveal_refuses_when_a_part_cannot_be_read() {
        let dir = temp_repo("fix2-lookup");
        let long = "a".repeat(300);
        assert!(reveal_target(&dir, &format!("{long}/b.txt")).is_err(), "a name the file system cannot look up is refused, not walked past");
        assert_eq!(reveal_target(&dir, "gone/b.txt").unwrap(), dir);
        let _ = fs::remove_dir_all(&dir);
    }

    /// FIX-2 FS 1 (server side): a pull request link that names a user, a password or a port is
    /// never opened, so `https://github.com@evil.example/...` cannot pass for github.com.
    #[test]
    fn fix2_a_pull_request_link_with_a_user_or_port_is_not_opened() {
        assert!(!safe_pr_url("https://github.com@evil.example/o/r/pull/1"));
        assert!(!safe_pr_url("https://user:tok@github.com/o/r/pull/1"));
        assert!(!safe_pr_url("https://github.com:8443/o/r/pull/1"));
        assert!(!safe_pr_url("https:///o/r/pull/1"));
        assert!(safe_pr_url("https://github.com/o/r/pull/1"));
    }

    #[test]
    fn git008_a_pull_with_split_history_and_no_policy_is_named_and_the_picked_policy_finishes_it() {
        assert_eq!(failure_kind("hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches.", false), "no-policy");
        assert_eq!(failure_kind(" ! [rejected] main -> main (non-fast-forward)", false), "non-fast-forward");
        // Every git below reads only the repositories' own config: a pull.rebase in this PC's
        // global or system config (Git for Windows writes pull.rebase=false there) would decide
        // the split pull on its own and the no-policy path would never run.
        crate::git::ISOLATED.with(|i| i.set(true));
        let origin = std::env::temp_dir().join(format!("kolux-rs-scm-git008-origin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&origin);
        fs::create_dir_all(&origin).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&origin)).unwrap();
        let url = origin.to_string_lossy().replace('\\', "/");
        let a = temp_repo("git008-a");
        run(&["remote", "add", "origin", &url], Some(&a)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&a)).unwrap();
        let b = std::env::temp_dir().join(format!("kolux-rs-scm-git008-b-{}", std::process::id()));
        let _ = fs::remove_dir_all(&b);
        run(&["clone", "-q", &url, &b.to_string_lossy()], None).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&b)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&b)).unwrap();
        fs::write(b.join("theirs.txt"), "theirs\n").unwrap();
        run(&["add", "."], Some(&b)).unwrap();
        run(&["commit", "-q", "-m", "theirs"], Some(&b)).unwrap();
        run(&["push", "-q"], Some(&b)).unwrap();
        fs::write(a.join("ours.txt"), "ours\n").unwrap();
        run(&["add", "."], Some(&a)).unwrap();
        run(&["commit", "-q", "-m", "ours"], Some(&a)).unwrap();
        // No pull policy anywhere: not in this repository, and the isolated global/system are empty.
        assert!(run(&["config", "--get", "pull.rebase"], Some(&a)).is_err() && run(&["config", "--get", "pull.ff"], Some(&a)).is_err());
        let config_before = fs::read_to_string(a.join(".git").join("config")).unwrap();
        // The real git's own words for the split are read as no-policy...
        let real = command(&["pull"], Some(&a)).output().unwrap();
        let said = format!("{}{}", String::from_utf8_lossy(&real.stdout), String::from_utf8_lossy(&real.stderr));
        assert!(!real.status.success(), "a split pull with no policy fails: {said}");
        assert_eq!(failure_kind(&said, false), "no-policy", "{said}");
        // ...and so is the app's own Pull.
        let out = remote(&a, "pull").unwrap();
        assert_eq!((out.ok, out.kind), (false, Some("no-policy")), "{}", out.output);
        // Picking rebase runs the pull again with it, and the repository's config is untouched.
        let again = remote(&a, "pullrebase").unwrap();
        assert!(again.ok, "{}", again.output);
        assert!(a.join("theirs.txt").is_file() && a.join("ours.txt").is_file());
        assert_eq!(status(&a).unwrap().behind, 0);
        assert_eq!(fs::read_to_string(a.join(".git").join("config")).unwrap(), config_before);
        // A second split, finished by picking merge: one merge commit joins both sides.
        fs::write(b.join("theirs2.txt"), "theirs 2\n").unwrap();
        run(&["add", "."], Some(&b)).unwrap();
        run(&["commit", "-q", "-m", "theirs 2"], Some(&b)).unwrap();
        run(&["push", "-q"], Some(&b)).unwrap();
        fs::write(a.join("ours2.txt"), "ours 2\n").unwrap();
        run(&["add", "."], Some(&a)).unwrap();
        run(&["commit", "-q", "-m", "ours 2"], Some(&a)).unwrap();
        let out = remote(&a, "pull").unwrap();
        assert_eq!((out.ok, out.kind), (false, Some("no-policy")), "{}", out.output);
        let merged = remote(&a, "pullmerge").unwrap();
        assert!(merged.ok, "{}", merged.output);
        assert!(a.join("theirs2.txt").is_file() && a.join("ours2.txt").is_file());
        let parents = run(&["rev-list", "--parents", "-n", "1", "HEAD"], Some(&a)).unwrap();
        assert_eq!(parents.split_whitespace().count(), 3, "HEAD is a merge commit with two parents: {parents}");
        assert_eq!(status(&a).unwrap().behind, 0);
        assert_eq!(fs::read_to_string(a.join(".git").join("config")).unwrap(), config_before);
        crate::git::ISOLATED.with(|i| i.set(false));
        for d in [&a, &b, &origin] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn git013_a_changed_submodule_is_one_row_with_its_state_and_rows_past_the_limit_are_counted() {
        assert_eq!(submodule_state("N..."), None);
        assert_eq!(submodule_state("SC.."), Some("new commits".into()));
        assert_eq!(submodule_state("S.MU"), Some("changed files, untracked files".into()));
        let line = |i: usize| format!("1 .M SC.. 160000 160000 160000 {h} {h} lib/sub{i}\0", h = "a".repeat(40));
        let mut text = String::from("# branch.head main\0");
        text.push_str(&format!("1 .M N... 100644 100644 100644 {h} {h} plain.txt\0", h = "b".repeat(40)));
        for i in 0..SUBMODULE_ROWS + 3 {
            text.push_str(&line(i));
        }
        let st = parse_status(&text);
        assert_eq!(st.submodules.len(), SUBMODULE_ROWS);
        assert_eq!(st.submodules_cut, 3);
        assert_eq!(st.submodules.get("lib/sub0").map(String::as_str), Some("new commits"));
        assert!(!st.submodules.contains_key("plain.txt"));
        assert_eq!(st.changed.len(), SUBMODULE_ROWS + 1, "the plain file and the listed submodules, each once");
        // A real submodule moved to another commit shows as one row under changes.
        let lib = temp_repo("git013-lib");
        let top = temp_repo("git013-top");
        let lib_url = lib.to_string_lossy().replace('\\', "/");
        run(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &lib_url, "vendor/lib"], Some(&top)).unwrap();
        run(&["commit", "-q", "-m", "add lib"], Some(&top)).unwrap();
        let inner = top.join("vendor").join("lib");
        run(&["config", "user.email", "test@example.com"], Some(&inner)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&inner)).unwrap();
        fs::write(inner.join("x.txt"), "x\n").unwrap();
        run(&["add", "."], Some(&inner)).unwrap();
        run(&["commit", "-q", "-m", "moved"], Some(&inner)).unwrap();
        fs::write(inner.join("y.txt"), "y\n").unwrap();
        let st = status(&top).unwrap();
        assert_eq!(st.changed.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), vec!["vendor/lib"]);
        assert!(st.untracked.is_empty(), "nothing inside the submodule is listed: {:?}", st.untracked);
        assert_eq!(st.submodules.get("vendor/lib").map(String::as_str), Some("new commits, untracked files"));
        for d in [&lib, &top] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn git014_reveal_stays_inside_the_worktree_through_links_too_and_falls_back_to_the_nearest_folder() {
        let dir = temp_repo("git014");
        fs::create_dir_all(dir.join("a")).unwrap();
        assert_eq!(reveal_target(&dir, "README.md").unwrap(), dir.join("README.md"));
        assert_eq!(reveal_target(&dir, "a/gone.txt").unwrap(), dir.join("a"));
        assert_eq!(reveal_target(&dir, "b/c/gone.txt").unwrap(), dir);
        assert!(reveal_target(&dir, "../outside.txt").is_err());
        assert!(reveal_target(&dir, "C:/Windows/notepad.exe").is_err());
        // A junction (or symlink) inside the worktree that leads out is refused, the file under it
        // and the link itself alike, even though the path text stays inside.
        let outside = std::env::temp_dir().join(format!("kolux-rs-scm-git014-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("b.txt"), "private\n").unwrap();
        #[cfg(windows)]
        let made = quiet("cmd").args(["/c", "mklink", "/J"]).arg(dir.join("j")).arg(&outside).output().unwrap().status.success();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, dir.join("j")).is_ok();
        assert!(made, "the junction was made");
        assert!(dir.join("j").join("b.txt").is_file(), "the file is reachable through it");
        assert!(reveal_target(&dir, "j/b.txt").unwrap_err().contains("link"));
        assert!(reveal_target(&dir, "j").is_err());
        assert!(reveal_target(&dir, "j/gone/deeper.txt").is_err());
        // A plain folder with a missing file still falls back as before.
        assert_eq!(reveal_target(&dir, "a/b/gone.txt").unwrap(), dir.join("a"));
        #[cfg(windows)]
        let _ = fs::remove_dir(dir.join("j"));
        #[cfg(unix)]
        let _ = fs::remove_file(dir.join("j"));
        let _ = fs::remove_dir_all(&outside);
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn git038_base_changes_measure_against_the_snapshot_not_a_base_that_moved_on() {
        let dir = temp_repo("base-snapshot");
        run(&["checkout", "-q", "-b", "feature"], Some(&dir)).unwrap();
        fs::write(dir.join("f.txt"), "feature\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "feature"], Some(&dir)).unwrap();
        let snapshot = run(&["merge-base", "main", "HEAD"], Some(&dir)).unwrap().trim().to_string();
        // main moves on: that change is not the branch's and must not show up.
        run(&["checkout", "-q", "main"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "moved on\n").unwrap();
        run(&["commit", "-q", "-am", "main moves"], Some(&dir)).unwrap();
        run(&["checkout", "-q", "feature"], Some(&dir)).unwrap();
        fs::write(dir.join("f.txt"), "feature\nmore\n").unwrap();
        let got = base_changes(&dir, Some("main"), None).unwrap();
        assert_eq!((got.against.as_str(), got.since.as_str(), got.note.as_deref()), ("main", snapshot.as_str(), None));
        let rel = |e: &crate::git::Entry| Path::new(&e.path).strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
        assert_eq!(got.entries.iter().map(|e| (rel(e), e.code, e.lines)).collect::<Vec<_>>(), vec![("f.txt".to_string(), 'A', Some(2))]);
        // A pin that does not resolve falls back to the detected base; no base at all is an error.
        assert_eq!(base_changes(&dir, Some("no-such-branch"), None).map(|b| b.against).ok(), status(&dir).unwrap().base);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Every git process (top level and children) `f` starts on this thread, as its arguments.
    fn git_argvs(f: impl FnOnce()) -> Vec<String> {
        let trace = std::env::temp_dir().join(format!("kolux-rs-scm-argvs-{}-{:?}.json", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_file(&trace);
        crate::git::TRACE2.with(|t| *t.borrow_mut() = Some(trace.clone()));
        f();
        crate::git::TRACE2.with(|t| *t.borrow_mut() = None);
        let log = fs::read_to_string(&trace).unwrap_or_default();
        let _ = fs::remove_file(&trace);
        log.lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter(|e| matches!(e["event"].as_str(), Some("start" | "child_start")))
            .map(|e| e["argv"].as_array().map(|a| a.iter().skip(1).filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())
            .collect()
    }

    #[test]
    fn t033g_a_known_base_skips_the_second_status_and_no_shared_history_is_labelled_never_silent() {
        let dir = temp_repo("t033g");
        run(&["checkout", "-q", "-b", "feature"], Some(&dir)).unwrap();
        fs::write(dir.join("f.txt"), "feature\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "feature"], Some(&dir)).unwrap();
        let known = status(&dir).unwrap().base.expect("main is detected as the base");
        let snapshot = run(&["merge-base", "main", "HEAD"], Some(&dir)).unwrap().trim().to_string();
        // (b) The base the tab already has: the same answer, and not one `git status` behind it.
        let mut with = None;
        let argvs = git_argvs(|| with = Some(base_changes(&dir, None, Some(&known)).unwrap()));
        let with = with.unwrap();
        assert_eq!((with.against.as_str(), with.since.as_str(), with.note.as_deref()), (known.as_str(), snapshot.as_str(), None));
        assert!(!argvs.is_empty(), "trace2 log missing");
        assert_eq!(argvs.iter().filter(|a| a.starts_with("status")).count(), 0, "{argvs:?}");
        // Without it (first read before any status arrived) status finds the base, as before.
        let argvs = git_argvs(|| assert_eq!(base_changes(&dir, None, None).unwrap().since, snapshot));
        assert!(argvs.iter().any(|a| a.starts_with("status")), "{argvs:?}");
        // A pin still wins over the known base; option-looking text is never handed to git.
        assert_eq!(base_changes(&dir, Some("feature"), Some(&known)).unwrap().against, "feature");
        let argvs = git_argvs(|| assert_eq!(base_changes(&dir, Some("--output=x"), Some("-x")).map(|b| b.against).ok(), status(&dir).unwrap().base));
        assert!(argvs.iter().all(|a| !a.contains("--output=x") && !a.split(' ').any(|w| w == "-x")), "{argvs:?}");
        // (c) Unrelated histories: labelled, measured against the base tip.
        run(&["checkout", "-q", "--orphan", "other"], Some(&dir)).unwrap();
        run(&["rm", "-q", "-rf", "."], Some(&dir)).unwrap();
        fs::write(dir.join("o.txt"), "other\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "other root"], Some(&dir)).unwrap();
        let other_tip = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap().trim().to_string();
        run(&["checkout", "-q", "feature"], Some(&dir)).unwrap();
        let apart = base_changes(&dir, Some("other"), None).unwrap();
        assert_eq!((apart.since.as_str(), apart.note.as_deref()), (other_tip.as_str(), Some("vs other tip: no common ancestor found")));
        // A known base that has since been deleted is an error, not a silent compare.
        run(&["branch", "-q", "gone"], Some(&dir)).unwrap();
        run(&["branch", "-q", "-D", "gone"], Some(&dir)).unwrap();
        assert!(base_changes(&dir, None, Some("gone")).unwrap_err().contains("no longer exists"));
        // Unborn HEAD (a new orphan branch with nothing committed): an error that says so.
        run(&["checkout", "-q", "--orphan", "fresh"], Some(&dir)).unwrap();
        assert!(base_changes(&dir, Some("main"), None).unwrap_err().contains("no commits yet"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git001_each_change_carries_its_added_and_removed_lines_and_a_binary_file_none() {
        let dir = temp_repo("lines");
        commit_file(&dir, "a.txt", "one\ntwo\nthree\n");
        commit_file(&dir, "old name.txt", "keep\nthis\n");
        fs::write(dir.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();
        fs::write(dir.join("b.txt"), "x\n").unwrap();
        run(&["add", "b.txt"], Some(&dir)).unwrap();
        run(&["mv", "old name.txt", "new ü.txt"], Some(&dir)).unwrap();
        fs::write(dir.join("new.txt"), "1\n2\n3").unwrap();
        fs::write(dir.join("pic.bin"), [0u8, 1, 2, 10, 0]).unwrap();
        let st = status(&dir).unwrap();
        assert_eq!(st.lines.changed.get("a.txt"), Some(&[2, 1]));
        assert_eq!(st.lines.staged.get("b.txt"), Some(&[1, 0]));
        assert_eq!(st.lines.staged.get("new ü.txt"), Some(&[0, 0]), "a rename counts at its new path");
        assert_eq!(st.lines.untracked.get("new.txt"), Some(&[3, 0]), "the last line counts without its newline");
        assert_eq!(st.lines.untracked.get("pic.bin"), None, "a binary file carries no counts");
        let _ = fs::remove_dir_all(&dir);
    }

    fn paths(list: &[Change]) -> Vec<&str> {
        list.iter().map(|c| c.path.as_str()).collect()
    }

    fn commit_file(dir: &Path, name: &str, text: &str) {
        fs::write(dir.join(name), text).unwrap();
        run(&["add", "."], Some(dir)).unwrap();
        run(&["commit", "-q", "-m", name], Some(dir)).unwrap();
    }

    fn counts(dir: &Path) -> (Option<String>, u32, u32, bool) {
        let st = status(dir).unwrap();
        (st.upstream, st.ahead, st.behind, st.rewritten)
    }

    /// A stand-in for gh: `pr view` finds nothing until `pr create` has run, every call is noted
    /// in calls.txt and the description read from standard input lands in body.txt.
    #[test]
    fn a_gh_call_that_hangs_gives_up_after_its_time_limit() {
        let tools = std::env::temp_dir().join(format!("kolux-gh-hang-{}", std::process::id()));
        fs::create_dir_all(&tools).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\nping -n 30 127.0.0.1 >nul\r\necho late\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\nsleep 30\necho late\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let started = std::time::Instant::now();
        let err = gh_run_for(&gh, &tools, &["pr", "view"], None, std::time::Duration::from_secs(1)).unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "took {:?}", started.elapsed());
        assert!(err.contains("did not answer within 1 second"), "{err}");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-R2: asking gh which account it is signed in with has a time limit, so a gh that never
    /// answers cannot hold up the Tasks page or onboarding; the caller gets a timeout error, and the
    /// host gate passes that error on rather than calling the host signed out.
    #[test]
    fn fixr2_a_gh_that_never_answers_the_account_question_times_out_within_the_bound() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fixr2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        // Never exits: the loop lives in the script's own process, so stopping it ends it.
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\n:again\r\nping -n 2 127.0.0.1 >nul\r\ngoto again\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\nwhile :; do sleep 1; done\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let ask = |limit: std::time::Duration| {
            let (tx, rx) = std::sync::mpsc::channel();
            let g = gh.clone();
            std::thread::spawn(move || {
                let _ = tx.send(gh_account_within(&g, "github.com", limit));
            });
            rx
        };
        let started = std::time::Instant::now();
        let got = ask(std::time::Duration::from_secs(1)).recv_timeout(std::time::Duration::from_secs(8)).expect("the account question returns within its bound");
        assert!(started.elapsed() < std::time::Duration::from_secs(8), "took {:?}", started.elapsed());
        assert!(got.as_ref().unwrap_err().contains("did not answer within 1 second"), "{got:?}");
        // The host gate (FIX-3: github::host_allowed, which asks gh only about a host other than
        // github.com) and the plain lookup use their own bounds and give up too; a gh that never
        // answers counts as not signed in there.
        let gate = crate::github::host_allowed(&gh, "ghe.example").unwrap_err();
        assert!(gate.contains("ghe.example is not one of them"), "{gate}");
        assert_eq!(gh_account(&gh, "github.com"), None);
        assert!(started.elapsed() < std::time::Duration::from_secs(1 + 2 * GH_ACCOUNT_LIMIT.as_secs() + 6), "took {:?}", started.elapsed());
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn checks_read_every_kind_and_a_finished_check_without_an_outcome_is_unresolved() {
        // VIEW-073: gh's statusCheckRollup mixes check runs (status + conclusion) and commit
        // statuses (state); each reads as one word, and COMPLETED with no conclusion is unresolved.
        let text = r#"{"number":12,"url":"https://github.com/o/r/pull/12","state":"OPEN","title":"Helper work","headRefName":"helper","isDraft":false,"mergeable":"CONFLICTING","statusCheckRollup":[
            {"__typename":"CheckRun","name":"build","workflowName":"CI","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://github.com/o/r/runs/1","startedAt":"2026-10-13T10:00:00Z","completedAt":"2026-10-13T10:04:00Z"},
            {"__typename":"CheckRun","name":"test","workflowName":"CI","status":"IN_PROGRESS","conclusion":"","detailsUrl":"https://github.com/o/r/runs/2","startedAt":"2026-10-13T10:00:00Z","completedAt":"0001-01-01T00:00:00Z"},
            {"__typename":"CheckRun","name":"lint","status":"COMPLETED","conclusion":"","startedAt":"2026-10-13T10:00:00Z","completedAt":"2026-10-13T10:01:00Z"},
            {"__typename":"CheckRun","name":"docs","status":"COMPLETED","conclusion":"SKIPPED"},
            {"__typename":"CheckRun","name":"deploy","status":"COMPLETED","conclusion":"CANCELLED"},
            {"__typename":"StatusContext","context":"ci/legacy","state":"FAILURE","targetUrl":"https://ci.example/9","description":"2 tests failed","startedAt":"2026-10-13T10:02:00Z"}
        ]}"#;
        let got = checks_from(text).unwrap();
        let pr = got.pr.as_ref().unwrap();
        assert_eq!((pr.number, pr.title.as_deref()), (12, Some("Helper work")));
        assert!(got.conflict, "CONFLICTING is a merge conflict notice");
        let words: Vec<(&str, &str)> = got.checks.iter().map(|c| (c.name.as_str(), c.outcome.as_str())).collect();
        assert_eq!(words, [("build", "passed"), ("test", "running"), ("lint", "unresolved"), ("docs", "skipped"), ("deploy", "cancelled"), ("ci/legacy", "failed")]);
        assert_eq!(got.checks[0].workflow.as_deref(), Some("CI"));
        assert_eq!(got.checks[0].link.as_deref(), Some("https://github.com/o/r/runs/1"));
        assert_eq!(got.checks[1].finished, None, "gh's zero time for a running check is no finish time");
        assert_eq!(got.checks[5].description.as_deref(), Some("2 tests failed"));
        assert_eq!(got.checks[5].link.as_deref(), Some("https://ci.example/9"));

        // A PR without checks, or mergeable, reads as none and no conflict.
        let bare = checks_from(r#"{"number":3,"url":"https://github.com/o/r/pull/3","state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[]}"#).unwrap();
        assert!(!bare.conflict && bare.checks.is_empty());
    }

    #[test]
    fn a_neutral_check_is_not_counted_as_passed_and_one_needing_action_is_failing() {
        // GIT-029
        let run = |c: &str| check_outcome(&serde_json::json!({"__typename":"CheckRun","status":"COMPLETED","conclusion":c}));
        assert_eq!(run("NEUTRAL"), "neutral");
        assert_eq!(run("ACTION_REQUIRED"), "failed");
        assert_eq!(run("SUCCESS"), "passed");
    }

    #[test]
    fn a_branch_without_a_pull_request_has_no_checks_rather_than_an_error() {
        // VIEW-073: gh's "no pull requests found" is the plain no-review answer.
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-checks-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let got = pr_checks(&gh, &tools, "feat").unwrap();
        assert!(got.pr.is_none() && got.checks.is_empty() && !got.conflict);
        assert!(fs::read_to_string(tools.join("calls.txt")).unwrap().contains("statusCheckRollup"));
        let _ = fs::remove_dir_all(&tools);
    }

    fn stand_in_gh(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        if cfg!(windows) {
            let file = dir.join("gh.cmd");
            let script = [
                "@echo off",
                "echo %*>>\"%~dp0calls.txt\"",
                "if \"%1\"==\"config\" goto config",
                "if \"%2\"==\"create\" goto create",
                "echo %3| findstr /b \"https\" >nul && goto linked",
                "if exist \"%~dp0made\" (",
                "  echo {\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}",
                "  exit /b 0",
                ")",
                "echo no pull requests found for branch \"feat\" 1>&2",
                "exit /b 1",
                ":linked",
                "echo {\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}",
                "exit /b 0",
                ":create",
                "more > \"%~dp0body.txt\"",
                "type nul > \"%~dp0made\"",
                "echo https://github.com/o/r/pull/7",
                "exit /b 0",
                ":config",
                "if \"%4\"==\"nobody.example\" (echo could not find key \"user\" 1>&2 & exit /b 1)",
                "if \"%3\"==\"-h\" echo octo",
            ];
            fs::write(&file, script.join("\r\n")).unwrap();
            file
        } else {
            let file = dir.join("gh");
            let script = "#!/bin/sh\nd=$(dirname \"$0\")\necho \"$*\" >> \"$d/calls.txt\"\nif [ \"$1\" = config ]; then [ \"$4\" = nobody.example ] && { echo 'could not find key \"user\"' >&2; exit 1; }; [ \"$3\" = -h ] && echo octo; exit 0; fi\ncase \"$3\" in https*) echo '{\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}'; exit 0;; esac\nif [ \"$2\" = create ]; then cat > \"$d/body.txt\"; touch \"$d/made\"; echo https://github.com/o/r/pull/7; exit 0; fi\nif [ -f \"$d/made\" ]; then echo '{\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}'; exit 0; fi\necho 'no pull requests found for branch \"feat\"' >&2\nexit 1\n";
            fs::write(&file, script).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
            }
            file
        }
    }

    #[test]
    fn a_pull_request_is_made_once_after_the_branch_is_pushed_and_states_that_cannot_have_one_are_refused() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-pr-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("pr");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-pr-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let calls = || fs::read_to_string(tools.join("calls.txt")).unwrap_or_default();

        // GIT-023: on the default branch there is nothing to compare.
        let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
        assert!(err.contains("feature branch"), "{err}");

        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
        assert!(err.contains("No commits"), "{err}");
        commit_file(&dir, "feat.txt", "f\n");

        // GIT-021: uncommitted tracked changes block it; a base only on this computer says what to do.
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
        assert!(err.contains("Commit or stash"), "{err}");
        run(&["checkout", "--", "README.md"], Some(&dir)).unwrap();
        run(&["branch", "only-here", "main"], Some(&dir)).unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "only-here", false, true).unwrap_err();
        assert!(err.contains("only on this computer"), "{err}");
        assert!(calls().is_empty(), "nothing reached gh while the branch could not have a PR");

        // None yet; creating pushes the unpublished branch first, then hands gh the title, base,
        // head and draft flag, with the description on standard input.
        assert_eq!(pr_find(&gh, &dir, "feat").unwrap(), None);
        let counted = crate::activity::activity_counts().prs_created;
        let pr = pr_create(&gh, &dir, "Add feat", "Why:\nbecause", "origin/main", true, true).unwrap();
        // USAGE-011: a pull request Kolux made counts once on the Stats & Usage page.
        assert_eq!(crate::activity::activity_counts().prs_created, counted + 1);
        assert_eq!((pr.number, pr.url.as_str(), pr.state.as_str()), (7, "https://github.com/o/r/pull/7", "OPEN"));
        assert!(run(&["rev-parse", "--verify", "refs/heads/feat"], Some(&bare)).is_ok(), "the branch was pushed first");
        let said = calls();
        assert!(said.contains("pr create") && said.contains("--draft") && said.contains("--base main") && said.contains("--head feat"), "{said}");
        assert!(fs::read_to_string(tools.join("body.txt")).unwrap().contains("because"));

        // A second create links the PR the branch already has instead of making another.
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", false, true).unwrap().number, 7);
        assert_eq!(calls().matches("pr create").count(), 1);
        assert_eq!(crate::activity::activity_counts().prs_created, counted + 1, "linking the PR a branch has is not a new one");

        // gh's own failures come back in plain words.
        assert!(gh_words("none of the git remotes configured for this repository point to a known GitHub host").contains("not supported"));
        assert!(gh_words("To get started with GitHub CLI, please run:  gh auth login").contains("Sign in"));
        // GIT-045: a sign-in that stopped working and an account without access are told apart; a
        // refused search and a gone repository keep gh's words (Tasks names the repository from them).
        assert!(gh_words("HTTP 401: Bad credentials (https://api.github.com/search/issues)").contains("no longer works"));
        assert!(gh_words("GraphQL: Resource not accessible by integration (repository.issues)").contains("cannot see this repository"));
        assert!(gh_words("HTTP 403: Must have admin rights to Repository.").contains("cannot see this repository"));
        assert!(gh_words("HTTP 403: API rate limit exceeded for user ID 1.").contains("rate limit"), "a spent limit stays a limit");
        assert!(gh_words("HTTP 422: Validation Failed: The listed users and repositories cannot be searched").contains("cannot be searched"));
        assert!(gh_words("GraphQL: Could not resolve to a Repository with the name 'a/b'.").contains("Could not resolve to a Repository"));
        let _ = fs::remove_dir_all(&tools);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&dir);
    }

    // T-652: the automatic flow asks for no push at all; unpushed work is refused in words, and nothing reaches the remote.
    #[test]
    fn t652_pr_create_without_push_refuses_unpushed_commits_and_pushes_nothing() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-pr-nopush-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("pr-nopush");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-pr-nopush-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let want = "The branch has commits that are not pushed yet; push first";
        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        commit_file(&dir, "feat.txt", "f\n");
        // No upstream at all.
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
        assert!(run(&["rev-parse", "--verify", "-q", "refs/heads/feat"], Some(&bare)).is_err(), "nothing was pushed");
        // An upstream with another name (the branch still tracks origin/main).
        run(&["branch", "--set-upstream-to=origin/main"], Some(&dir)).unwrap();
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
        // Published, then one more commit: ahead of its own upstream.
        run(&["push", "-q", "origin", "feat:feat"], Some(&dir)).unwrap();
        run(&["branch", "--set-upstream-to=origin/feat"], Some(&dir)).unwrap();
        commit_file(&dir, "more.txt", "m\n");
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
        assert_ne!(run(&["rev-parse", "refs/heads/feat"], Some(&bare)).unwrap(), run(&["rev-parse", "HEAD"], Some(&dir)).unwrap(), "the new commit stayed here");
        // Everything is on origin/feat: now the pull request is made, still without a push.
        run(&["push", "-q", "origin", "feat:feat"], Some(&dir)).unwrap();
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap().number, 7);
        // With push true (the old callers) the unpushed work is still pushed first.
        commit_file(&dir, "later.txt", "l\n");
        fs::remove_file(tools.join("made")).unwrap();
        assert!(pr_create(&gh, &dir, "Add feat", "", "main", true, true).is_ok());
        assert_eq!(run(&["rev-parse", "refs/heads/feat"], Some(&bare)).unwrap(), run(&["rev-parse", "HEAD"], Some(&dir)).unwrap());
        let _ = fs::remove_dir_all(&tools);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pull_request_linked_by_hand_is_read_through_its_link_with_its_branch() {
        let dir = temp_repo("prlink");
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-prlink-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let pr = pr_link(&gh, &dir, "https://github.com/o/r/pull/12").unwrap();
        assert_eq!((pr.number, pr.state.as_str(), pr.title.as_deref(), pr.head.as_deref(), pr.draft), (12, "MERGED", Some("Other work"), Some("other"), false));
        assert!(fs::read_to_string(tools.join("calls.txt")).unwrap().contains("headRefName"), "the branch is asked for, so a mismatch can be flagged");
        assert!(pr_link(&gh, &dir, "file:///C:/Windows/notepad.exe").unwrap_err().contains("pull request link"));
        let _ = fs::remove_dir_all(&tools);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_marks_outgoing_and_incoming_commits_and_keeps_its_labels_tidy() {
        let empty = std::env::temp_dir().join(format!("kolux-rs-scm-hist-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&empty);
        fs::create_dir_all(&empty).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&empty)).unwrap();
        assert!(history(&empty, 50).unwrap().is_empty(), "a repository with no commits has no history");

        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-hist-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("hist");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        run(&["tag", "v1"], Some(&dir)).unwrap();
        let names = |c: &Commit| {
            let mut n = c.labels.iter().map(|l| format!("{}:{}", l.kind, l.name)).collect::<Vec<_>>();
            n.sort();
            n
        };

        // main and origin/main on one commit: the remote label says nothing new and is left out.
        let h = history(&dir, 50).unwrap();
        assert_eq!(names(&h[0]), vec!["current:main", "tag:v1"]);

        // One commit only on the remote (incoming) and one only here (outgoing).
        commit_file(&dir, "two.txt", "2\n");
        run(&["push", "-q"], Some(&dir)).unwrap();
        run(&["reset", "-q", "--hard", "HEAD~1"], Some(&dir)).unwrap();
        fs::write(dir.join("three.txt"), "3\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "feat: three", "-m", "A longer body that explains the change."], Some(&dir)).unwrap();
        let h = history(&dir, 50).unwrap();
        let by = |s: &str| h.iter().find(|c| c.subject == s).unwrap_or_else(|| panic!("no {s}"));
        assert_eq!((by("feat: three").outgoing, by("feat: three").incoming), (true, false));
        assert_eq!((by("two.txt").outgoing, by("two.txt").incoming), (false, true));
        assert_eq!((by("first").outgoing, by("first").incoming), (false, false));
        assert!(by("feat: three").message.contains("A longer body"));
        assert_eq!(names(by("feat: three")), vec!["current:main"]);
        assert_eq!(names(by("two.txt")), vec!["upstream:origin/main"]);
        assert_eq!(names(by("first")), vec!["tag:v1"]);
        assert_eq!(h.last().unwrap().subject, "first", "the shared root comes last");
        assert_eq!(h.len(), 3);

        // On a feature branch the local copy of the base reads as the base.
        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        assert_eq!(names(&history(&dir, 50).unwrap()[0]), vec!["base:main", "current:feat"]);

        // The selected commit's files.
        let files = commit_files(&dir, &by("feat: three").hash).unwrap();
        assert_eq!(paths(&files), vec!["three.txt"]);
        assert_eq!(files[0].status, "A");
        assert!(commit_files(&dir, "HEAD; rm -rf").is_err(), "only a commit id is accepted");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn github_repositories_are_read_from_every_remote_form() {
        let ssh = "# work account\nHost gh-work other-alias\n  HostName github.com\n  User git\n\nHost *\n  ServerAliveInterval 30\n";
        let r = |url: &str| github_repo(url, ssh).map(|g| (g.host, g.owner, g.name));
        let want = Some(("github.com".to_string(), "o".to_string(), "r".to_string()));
        for url in ["https://github.com/o/r", "https://github.com/o/r.git", "https://github.com/o/r/", "https://user@github.com/o/r.git", "http://github.com/o/r", "ssh://git@github.com/o/r.git", "ssh://git@github.com:22/o/r.git", "git@github.com:o/r.git", "github.com:o/r", "git://github.com/o/r.git", "git@gh-work:o/r.git", "ssh://git@other-alias/o/r"] {
            assert_eq!(r(url), want, "{url}");
        }
        // An HTTPS host is never an SSH alias.
        assert_eq!(r("https://gh-work/o/r").map(|x| x.0), Some("gh-work".to_string()));
        // GitHub Enterprise keeps its host and uses its own API address.
        let ghe = github_repo("git@ghe.corp.example:Team/App.git", ssh).unwrap();
        assert_eq!((ghe.host.as_str(), ghe.owner.as_str(), ghe.name.as_str()), ("ghe.corp.example", "Team", "App"));
        assert_eq!(ghe.api, "https://ghe.corp.example/api/v3");
        assert_eq!(github_repo("https://github.com/o/r", "").unwrap().api, "https://api.github.com");
        // Two checkouts of one project share a key, whatever form or case their remote uses.
        assert_eq!(github_repo("git@gh-work:O/R.git", ssh).unwrap().key, github_repo("https://github.com/o/r", "").unwrap().key);
        // Local paths and odd shapes are not GitHub repositories.
        for url in ["G:/Temp/x/remote.git", "C:\\repo\\r.git", "/srv/git/r.git", "file:///srv/o/r.git", "https://github.com/o", "https://github.com/o/r/pull/3", "", "git@github.com:o/r b.git"] {
            assert_eq!(r(url), None, "{url}");
        }

        // gh is pointed at the resolved repository, so an alias remote still finds its pull request.
        let dir = temp_repo("ghrepo");
        assert_eq!(gh_repo_arg(&dir, ssh), None, "no origin, no repository");
        run(&["remote", "add", "origin", "git@gh-work:o/r.git"], Some(&dir)).unwrap();
        assert_eq!(gh_repo_arg(&dir, ssh).as_deref(), Some("github.com/o/r"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_plain_https_pull_request_link_is_opened() {
        assert!(safe_pr_url("https://github.com/o/r/pull/7"));
        assert!(safe_pr_url("https://git.example.com/o/r/pull/12"));
        assert!(!safe_pr_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!safe_pr_url("https://github.com/o/r/pull/7 --flag"));
        assert!(!safe_pr_url("https://github.com/o/r/issues/7"));
    }

    #[test]
    fn push_failures_are_sorted_by_kind() {
        let kind = |text: &str| failure_kind(text, false);
        assert_eq!(kind("remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)"), "protected");
        assert_eq!(kind("fatal: Authentication failed for 'https://github.com/a/b.git/'"), "sign-in");
        assert_eq!(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "sign-in");
        assert_eq!(kind("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), "sign-in");
        assert_eq!(kind("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"), "network");
        assert_eq!(kind(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"), "non-fast-forward");
        assert_eq!(kind("The following submodule paths contain changes that can\nnot be found on any remote:\n  lib"), "submodule");
        assert_eq!(kind(" ! [remote rejected] main -> main (pre-receive hook declined)"), "hook");
        assert_eq!(failure_kind("lint: 2 problems\nerror: failed to push some refs to 'origin'", true), "hook");
        assert_eq!(kind("error: something odd"), "other");
    }

    #[test]
    fn a_failing_pre_push_hook_hands_its_output_and_files_to_an_agent_and_commit_then_pull_and_push_works() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-hook-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("hook");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        commit_file(&dir, "login.ts", "x\n");
        let hook = dir.join(".git").join("hooks").join("pre-push");
        fs::write(&hook, "#!/bin/sh\nprintf '\\033[31mlint: 2 problems in login.ts\\033[0m\\n' >&2\nexit 1\n").unwrap();
        let out = remote(&dir, "push").unwrap();
        assert!(!out.ok);
        assert_eq!(out.kind, Some("hook"), "{}", out.output);
        let detail = out.detail.unwrap();
        assert!(detail.contains("lint: 2 problems in login.ts"), "{detail}");
        assert!(!detail.contains('\u{1b}'), "colour codes are removed: {detail:?}");
        assert!(!out.output.contains(char::from(27)), "and from the notice");
        assert!(detail.contains("Files in this push:\n- login.ts"), "{detail}");

        // Commit then pull (rebasing onto the remote) and push: the commit lands on the remote.
        fs::remove_file(&hook).unwrap();
        commit_file(&dir, "two.txt", "2\n");
        let done = remote(&dir, "pullpush").unwrap();
        assert!(done.ok, "{}", done.output);
        assert_eq!((done.kind, counts(&dir).1), (None, 0));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn a_network_git_step_runs_with_prompts_off_and_a_stuck_one_is_stopped() {
        let dir = temp_repo("net-limit");
        // The prompt switches reach the step (an alias prints what git was given).
        let seen = git_network(&["-c", "alias.seen=!echo $GIT_TERMINAL_PROMPT $GCM_INTERACTIVE", "seen"], &dir, Some(std::time::Duration::from_secs(60))).unwrap();
        assert!(seen.success && !seen.timed_out, "{}", seen.stderr);
        assert_eq!(seen.stdout.trim(), "0 never");
        // A step that never ends is stopped at the limit and says so.
        let started = std::time::Instant::now();
        let stuck = git_network(&["-c", "alias.stuck=!sleep 60", "stuck"], &dir, Some(std::time::Duration::from_secs(1))).unwrap();
        assert!(stuck.timed_out && !stuck.success);
        assert!(started.elapsed() < std::time::Duration::from_secs(30), "stopped long after the limit: {:?}", started.elapsed());
        let note = timed_out_note(&["push"], std::time::Duration::from_secs(600));
        assert!(note.contains("timed out after 600 seconds") && note.contains("took too long"), "{note}");
        assert!(note.contains("slow") && note.contains("sign-in"), "{note}");
        assert!(!note.starts_with("The remote may be waiting for a sign-in"), "{note}");
        assert_eq!(REMOTE_LIMIT.as_secs(), 600);
        // No limit: a step that takes longer than a short wait is left to finish.
        let slow = git_network(&["-c", "alias.slow=!sleep 2; echo done", "slow"], &dir, None).unwrap();
        assert!(slow.success && !slow.timed_out && slow.stdout.trim() == "done", "{}", slow.stderr);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_program_holding_the_pipe_after_git_exits_costs_a_short_wait_and_keeps_the_output() {
        let dir = temp_repo("net-grace");
        // The alias prints, then leaves a background process holding stdout and stderr for 20 seconds.
        let started = std::time::Instant::now();
        let out = git_network(&["-c", "alias.held=!echo kept; (sleep 20 &) ; true", "held"], &dir, Some(std::time::Duration::from_secs(60))).unwrap();
        assert!(out.success && !out.timed_out);
        assert!(out.stdout.contains("kept"), "output lost: {:?}", out.stdout);
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "waited on the held pipe: {:?}", started.elapsed());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unstaging_works_on_the_whole_worktree_on_a_renamed_file_and_before_the_first_commit() {
        let dir = temp_repo("unstage-all");
        commit_file(&dir, "old.txt", "some content here
and more
");
        run(&["mv", "old.txt", "new.txt"], Some(&dir)).unwrap();
        // Only the new path leaves the old one's delete staged; both together put the rename back.
        stage(&dir, &["new.txt".into()], false).unwrap();
        let half = status(&dir).unwrap();
        assert_eq!(half.staged.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["old.txt"]);
        run(&["add", "-A"], Some(&dir)).unwrap();
        let renamed = status(&dir).unwrap();
        let r = renamed.staged.iter().find(|c| c.from.is_some()).expect("a staged rename");
        stage(&dir, &[r.from.clone().unwrap(), r.path.clone()], false).unwrap();
        assert!(status(&dir).unwrap().staged.is_empty());
        // "." takes the whole worktree, in both directions.
        stage(&dir, &[".".into()], true).unwrap();
        assert!(!status(&dir).unwrap().staged.is_empty());
        stage(&dir, &[".".into()], false).unwrap();
        assert!(status(&dir).unwrap().staged.is_empty());
        let _ = fs::remove_dir_all(&dir);
        // A repository with no commit yet: unstage all still works.
        let fresh = std::env::temp_dir().join(format!("kolux-rs-scm-nohead-{}", std::process::id()));
        let _ = fs::remove_dir_all(&fresh);
        fs::create_dir_all(&fresh).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&fresh)).unwrap();
        fs::write(fresh.join("a.txt"), "a
").unwrap();
        stage(&fresh, &[".".into()], true).unwrap();
        assert_eq!(status(&fresh).unwrap().staged.len(), 1);
        stage(&fresh, &[".".into()], false).unwrap();
        let st = status(&fresh).unwrap();
        assert!(st.staged.is_empty() && st.untracked.len() == 1, "{:?}", st.staged);
        let _ = fs::remove_dir_all(&fresh);
    }

    #[test]
    fn a_push_that_hangs_comes_back_as_a_network_failure_that_says_it_timed_out() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-hang-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("hang");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        commit_file(&dir, "slow.txt", "x\n");
        fs::write(dir.join(".git").join("hooks").join("pre-push"), "#!/bin/sh\nsleep 60\n").unwrap();
        let out = remote_within(&dir, "push", std::time::Duration::from_secs(1)).unwrap();
        assert!(!out.ok);
        assert_eq!(out.kind, Some("network"), "{}", out.output);
        assert!(out.output.contains("timed out after 1 second") && out.output.contains("took too long"), "{}", out.output);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn history_flags_the_last_commit_only_when_the_cap_cut_older_ones_off() {
        let dir = temp_repo("hist-cap");
        for i in 0..4 {
            commit_file(&dir, &format!("f{i}.txt"), "x\n");
        }
        // Five commits in all.
        let all = history(&dir, 10).unwrap();
        assert_eq!(all.len(), 5);
        assert!(all.iter().all(|c| !c.capped), "nothing was cut");
        let exact = history(&dir, 5).unwrap();
        assert_eq!(exact.len(), 5);
        assert!(exact.iter().all(|c| !c.capped), "a history that ends exactly at the cap is not cut");
        let cut = history(&dir, 3).unwrap();
        assert_eq!(cut.len(), 3);
        assert_eq!(cut.iter().map(|c| c.capped).collect::<Vec<_>>(), vec![false, false, true]);
        // The wire shape: the flag is absent unless set.
        assert!(!serde_json::to_string(&all[0]).unwrap().contains("capped"));
        assert!(serde_json::to_string(&cut[2]).unwrap().contains("\"capped\":true"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_sidebar_badge_counts_unpushed_commits_and_never_calls_an_unreadable_count_synced() {
        let state = |dir: &Path| pushed(dir).map(|p| (p.state, p.count));
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-pushed-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("pushed");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), Some(("synced", 0)));
        commit_file(&dir, "one.txt", "1\n");
        commit_file(&dir, "two.txt", "2\n");
        assert_eq!(state(&dir), Some(("ahead", 2)), "two commits not pushed");
        run(&["push", "-q"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), Some(("synced", 0)), "pushing clears it");

        // A branch never published counts what it holds past the base.
        run(&["switch", "-q", "-c", "feature"], Some(&dir)).unwrap();
        commit_file(&dir, "three.txt", "3\n");
        assert_eq!(state(&dir), Some(("unpublished", 1)));
        // The base cannot be read: it cannot be checked, never synced.
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let origin_main = dir.join(".git").join("refs").join("remotes").join("origin").join("main");
        fs::write(&origin_main, "0123456789012345678901234567890123456789\n").unwrap();
        assert_eq!(state(&dir), Some(("unknown", 0)));

        run(&["switch", "-q", "--detach"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), None, "a detached HEAD has no branch to push");
        // TERM-022: the header chip shows the commit a detached HEAD is on, and a branch by name.
        let head = head_of(&dir).unwrap();
        assert_eq!(head.branch, None);
        assert_eq!(head.head.as_deref().map(str::len), Some(40));
        run(&["switch", "-q", "feature"], Some(&dir)).unwrap();
        assert_eq!(head_of(&dir).unwrap().branch.as_deref(), Some("feature"));
        let plain = std::env::temp_dir().join(format!("kolux-rs-scm-plain-{}", std::process::id()));
        fs::create_dir_all(&plain).unwrap();
        assert_eq!(head_of(&plain), None, "a plain folder has no chip");
        let _ = fs::remove_dir_all(&plain);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn remote_actions_move_commits_through_a_bare_remote_and_rebased_work_offers_a_lease() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let bare_url = bare.to_string_lossy().replace('\\', "/");
        let dir = temp_repo("remote");
        run(&["remote", "add", "origin", &bare_url], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let st = status(&dir).unwrap();
        assert_eq!((st.upstream.as_deref(), st.ahead, st.behind, st.base.as_deref()), (Some("origin/main"), 0, 0, Some("origin/main")));

        // Two local commits: push moves them and the count falls to zero (GIT-007 acceptance).
        commit_file(&dir, "one.txt", "1\n");
        commit_file(&dir, "two.txt", "2\n");
        assert_eq!(counts(&dir), (Some("origin/main".into()), 2, 0, false));
        assert!(remote(&dir, "push").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/main".into()), 0, 0, false));

        // A new branch has no upstream until publish sets origin as its upstream.
        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        commit_file(&dir, "feat.txt", "f\n");
        assert_eq!(counts(&dir), (None, 0, 0, false));
        assert!(remote(&dir, "publish").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

        // Main moves on the remote; rebasing feat onto it leaves the upstream with only
        // already-held patches, so force push with lease is the next step, not pull.
        let other = std::env::temp_dir().join(format!("kolux-rs-scm-other-{}", std::process::id()));
        let _ = fs::remove_dir_all(&other);
        run(&["clone", "-q", &bare_url, &other.to_string_lossy()], None).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&other)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&other)).unwrap();
        commit_file(&other, "main2.txt", "m\n");
        run(&["push", "-q"], Some(&other)).unwrap();
        assert!(remote(&dir, "rebase").unwrap().ok, "rebase from base");
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 2, 1, true));
        assert!(remote(&dir, "force").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

        // A genuinely new commit on the remote is not "rewritten": nothing offers to force over it.
        run(&["fetch", "-q"], Some(&other)).unwrap();
        run(&["checkout", "-q", "-b", "feat", "origin/feat"], Some(&other)).unwrap();
        commit_file(&other, "theirs.txt", "t\n");
        run(&["push", "-q"], Some(&other)).unwrap();
        commit_file(&dir, "mine.txt", "i\n");
        assert!(remote(&dir, "fetch").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 1, 1, false));

        // Status never goes to the network: with the remote gone it still answers, and only an
        // explicit fetch reports the trouble. FIX-1 (council, 2026-10-13): this used to be a 3 s
        // wall-clock bound on three reads, which failed on a loaded PC even when run alone (one
        // read is ~7 local git processes; 3.2-10.4 s measured, while git's own times summed to
        // ~2.3 s: the rest is process start-up on a busy PC). Git's own trace2 log of every
        // process each read starts showed only status, cherry, --version, symbolic-ref,
        // rev-parse and diff, no fetch, remote helper, credential helper or fsmonitor. So the
        // test now asserts on that log (no network-capable process ran, which load cannot
        // flake), and keeps a 20 s bound only as a backstop: a hung network call would sit on
        // the OS connect timeout (about 21 s on Windows) and still trip it.
        run(&["remote", "set-url", "origin", &format!("{bare_url}-missing")], Some(&dir)).unwrap();
        let trace = std::env::temp_dir().join(format!("kolux-rs-scm-trace2-{}.json", std::process::id()));
        let _ = fs::remove_file(&trace);
        crate::git::TRACE2.with(|t| *t.borrow_mut() = Some(trace.clone()));
        let t = std::time::Instant::now();
        for _ in 0..3 {
            status(&dir).unwrap();
        }
        let took = t.elapsed();
        crate::git::TRACE2.with(|t| *t.borrow_mut() = None);
        let log = fs::read_to_string(&trace).unwrap_or_default();
        let _ = fs::remove_file(&trace);
        let events: Vec<serde_json::Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        // Every process git started (top level and any child it spawned), with its arguments.
        let argvs: Vec<String> = events
            .iter()
            .filter(|e| matches!(e["event"].as_str(), Some("start" | "child_start")))
            .map(|e| e["argv"].as_array().map(|a| a.iter().skip(1).filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())
            .collect();
        // The time of each top-level git, from its own exit event, for the failure message.
        let times: Vec<String> = events
            .iter()
            .filter(|e| e["event"] == "exit" && !e["sid"].as_str().unwrap_or("/").contains('/'))
            .map(|e| format!("{:.0} ms", e["t_abs"].as_f64().unwrap_or(0.0) * 1000.0))
            .collect();
        let report = format!("3 reads took {took:?}; processes {argvs:?}; times {times:?}");
        eprintln!("{report}");
        assert!(argvs.iter().filter(|a| a.starts_with("status ")).count() >= 3, "trace2 log missing: {report}");
        let network = ["fetch", "ls-remote", "remote-", "upload-pack", "credential", "fsmonitor", "http"];
        assert!(!argvs.iter().any(|a| network.iter().any(|n| a.contains(n))), "a status read went to the network: {report}");
        assert!(took < std::time::Duration::from_secs(20), "{report}");
        let fetched = remote(&dir, "fetch").unwrap();
        assert!(!fetched.ok && !fetched.output.is_empty(), "{fetched:?}");
        assert_eq!(remote(&dir, "nope").unwrap_err(), "unknown remote action nope");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&other);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn the_upstream_remote_is_named_whole_when_its_name_holds_a_slash() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-slashremote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let bare_url = bare.to_string_lossy().replace('\\', "/");
        let dir = temp_repo("slashremote");
        run(&["remote", "add", "team/fork", &bare_url], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "team/fork", "main"], Some(&dir)).unwrap();
        let st = status(&dir).unwrap();
        assert_eq!((st.upstream.as_deref(), st.upstream_remote.as_deref()), (Some("team/fork/main"), Some("team/fork")));
        // A branch tracking a local branch has an upstream and no remote.
        run(&["branch", "side", "main"], Some(&dir)).unwrap();
        run(&["checkout", "-q", "side"], Some(&dir)).unwrap();
        run(&["branch", "-q", "--set-upstream-to=main"], Some(&dir)).unwrap();
        let st = status(&dir).unwrap();
        assert_eq!((st.upstream.as_deref(), st.upstream_remote.as_deref()), (Some("main"), None));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn porcelain_v2_is_sorted_into_sections_with_awkward_names_kept_whole() {
        let text = "# branch.oid e2b3\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
            1 .M N... 100644 100644 100644 7898 7898 keep.txt\0\
            2 R. N... 100644 100644 100644 6178 6178 R100 new.txt\0old.txt\0\
            1 MM N... 100644 100644 100644 f2ad b680 sub/with space.txt\0\
            1 D. N... 100644 000000 000000 f2ad 0000 gone.txt\0\
            u UU N... 100644 100644 100644 100644 1111 2222 3333 both.txt\0\
            ? a[1].txt\0? sub/ünï \"q\".txt\0";
        let st = parse_status(text);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(paths(&st.staged), ["new.txt", "sub/with space.txt", "gone.txt"]);
        assert_eq!(st.staged[0], Change { path: "new.txt".into(), status: "R".into(), from: Some("old.txt".into()) });
        assert_eq!(st.staged[2].status, "D");
        assert_eq!(paths(&st.changed), ["keep.txt", "sub/with space.txt"], "a file changed in both places is in both lists");
        assert_eq!(paths(&st.untracked), ["a[1].txt", "sub/ünï \"q\".txt"]);
        assert_eq!(paths(&st.conflicts), ["both.txt"]);
        let detached = parse_status("# branch.oid e2b3\0# branch.head (detached)\0");
        assert_eq!(detached, Status { head: Some("e2b3".into()), ..Status::default() });
        assert_eq!(parse_status("# branch.oid (initial)\0# branch.head main\0").head, None);
    }

    #[test]
    fn staging_covers_folders_takes_names_literally_and_stays_inside_the_worktree() {
        let repo = temp_repo("stage");
        fs::create_dir_all(repo.join("sub")).unwrap();
        for f in ["sub/a.txt", "sub/b.txt", "sub/c.txt", "a[1].txt", "a1.txt"] {
            fs::write(repo.join(f), "x\n").unwrap();
        }
        // GIT-002: a folder covers every file beneath it.
        stage(&repo, &["sub".into()], true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["sub/a.txt", "sub/b.txt", "sub/c.txt"]);
        assert_eq!(paths(&st.untracked), ["a1.txt", "a[1].txt"]);
        // A name with wildcard characters never drags in other files.
        stage(&repo, &["a[1].txt".into()], true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["a[1].txt", "sub/a.txt", "sub/b.txt", "sub/c.txt"]);
        assert_eq!(paths(&st.untracked), ["a1.txt"]);
        // Unstaging a folder takes its files back out of the index, nothing else.
        stage(&repo, &["sub".into()], false).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["a[1].txt"]);
        assert_eq!(st.untracked.len(), 4);
        // Paths that would leave the worktree are refused before git runs.
        for bad in ["../elsewhere", "C:\\Windows", "/etc", "sub/../../x", ""] {
            let err = stage(&repo, &[bad.to_string()], true).unwrap_err();
            assert!(err.contains("outside this workspace"), "{bad}: {err}");
        }
        assert!(stage(&repo, &[], true).unwrap_err().contains("nothing"));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn discarding_puts_each_section_back_and_deletes_only_untracked_or_staged_new_files() {
        let repo = temp_repo("discard");
        commit_file(&repo, "keep.txt", "one\n");
        commit_file(&repo, "gone.txt", "two\n");
        // Changes: an edit and a deletion go back to what is staged.
        fs::write(repo.join("README.md"), "edited\n").unwrap();
        fs::remove_file(repo.join("gone.txt")).unwrap();
        discard(&repo, "changed", &["README.md".into(), "gone.txt".into()]).unwrap();
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "hello\n");
        assert_eq!(fs::read_to_string(repo.join("gone.txt")).unwrap(), "two\n");
        // Staged: an edit goes back to the last commit on disk too; a staged new file is deleted.
        fs::write(repo.join("keep.txt"), "staged edit\n").unwrap();
        fs::write(repo.join("new.txt"), "new\n").unwrap();
        stage(&repo, &["keep.txt".into(), "new.txt".into()], true).unwrap();
        discard(&repo, "staged", &["keep.txt".into(), "new.txt".into()]).unwrap();
        assert_eq!(fs::read_to_string(repo.join("keep.txt")).unwrap(), "one\n");
        assert!(!repo.join("new.txt").exists());
        // Untracked: files and folders go, names are literal, and a tracked name sent as untracked stays.
        fs::create_dir_all(repo.join("scratch")).unwrap();
        fs::write(repo.join("scratch/a.txt"), "x").unwrap();
        fs::write(repo.join("b[1].txt"), "x").unwrap();
        fs::write(repo.join("b1.txt"), "x").unwrap();
        discard(&repo, "untracked", &["scratch/".into(), "b[1].txt".into(), "keep.txt".into()]).unwrap();
        assert!(!repo.join("scratch").exists());
        assert!(!repo.join("b[1].txt").exists());
        assert!(repo.join("keep.txt").exists());
        let st = status(&repo).unwrap();
        assert!(st.staged.is_empty() && st.changed.is_empty());
        assert_eq!(paths(&st.untracked), ["b1.txt"]);
        assert!(discard(&repo, "untracked", &["../x".into()]).unwrap_err().contains("outside"));
        assert!(discard(&repo, "conflicts", &["keep.txt".into()]).is_err());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn two_thousand_files_are_staged_in_one_call() {
        let repo = temp_repo("many");
        fs::create_dir_all(repo.join("many")).unwrap();
        let names: Vec<String> = (0..2000).map(|i| format!("many/file-{i:04}.txt")).collect();
        for n in &names {
            fs::write(repo.join(n), "x\n").unwrap();
        }
        stage(&repo, &names, true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(st.staged.len(), 2000);
        assert!(st.untracked.is_empty());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn commit_takes_the_staged_work_and_a_refusing_hook_shows_as_blocked() {
        let repo = temp_repo("commit");
        fs::write(repo.join("README.md"), "hello\nworld\n").unwrap();
        fs::write(repo.join("later.txt"), "not yet\n").unwrap();
        assert!(commit(&repo, "  ").unwrap_err().contains("message"));
        stage(&repo, &["README.md".into()], true).unwrap();
        let done = commit(&repo, "Say world\n\nTwo lines.").unwrap();
        assert!(done.id.is_some() && !done.blocked, "{done:?}");
        assert_eq!(run(&["log", "-1", "--format=%B"], Some(&repo)).unwrap(), "Say world\n\nTwo lines.");
        let st = status(&repo).unwrap();
        assert!(st.staged.is_empty() && st.changed.is_empty(), "the sections clear");
        assert_eq!(paths(&st.untracked), ["later.txt"], "the unstaged file was left alone");
        // GIT-004: a pre-commit hook that exits 1 blocks the commit and its words come back.
        let hook = repo.join(".git").join("hooks").join("pre-commit");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\necho 'nope, said the hook'\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        stage(&repo, &["later.txt".into()], true).unwrap();
        let refused = commit(&repo, "Blocked").unwrap();
        assert!(refused.id.is_none() && refused.blocked, "{refused:?}");
        assert!(refused.output.contains("nope, said the hook"), "{}", refused.output);
        assert_eq!(run(&["log", "--format=%s"], Some(&repo)).unwrap(), "Say world\nfirst", "nothing was committed");
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn the_branch_summary_counts_lines_against_the_base_split_into_source_tests_and_generated() {
        let repo = temp_repo("summary");
        run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
        // VIEW-068: commit 10 added lines and the total shows +10.
        fs::create_dir_all(repo.join("src")).unwrap();
        commit_file(&repo, "src/a.rs", &"line\n".repeat(10));
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.behind), ("main", 1, 0));
        assert_eq!((s.source, s.tests, s.generated), (Lines { added: 10, removed: 0 }, Lines::default(), Lines::default()));
        // Tests and generated files are their own rows, and the rows add up to the total.
        fs::create_dir_all(repo.join("tests")).unwrap();
        commit_file(&repo, "tests/it.rs", "a\nb\n");
        commit_file(&repo, "src/a.test.ts", "c\n");
        commit_file(&repo, "Cargo.lock", &"x\n".repeat(1500));
        fs::write(repo.join("src/a.rs"), "line\n".repeat(7)).unwrap();
        commit_file(&repo, "README.md", "hello\nworld\n");
        let s = summary(&repo, None, false).unwrap();
        assert_eq!(s.ahead, 5);
        assert_eq!(s.source, Lines { added: 8, removed: 0 }, "README +1, src/a.rs a new file of 7 lines against main");
        assert_eq!(s.tests, Lines { added: 3, removed: 0 });
        assert_eq!(s.generated, Lines { added: 1500, removed: 0 });
        // Main moving on shows as behind; the comparison is against the merge base, so main's
        // own new lines are not counted as this branch's.
        run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
        commit_file(&repo, "other.txt", "o\n");
        run(&["checkout", "-q", "feat"], Some(&repo)).unwrap();
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.ahead, s.behind, s.source.added), (5, 1, 8));
        // A pinned base wins, even with the upstream setting on; without an upstream the base is used.
        let first = run(&["rev-list", "--max-parents=0", "HEAD"], Some(&repo)).unwrap();
        run(&["branch", "pinned", first.trim()], Some(&repo)).unwrap();
        assert_eq!(summary(&repo, Some("pinned"), true).unwrap().against, "pinned");
        assert_eq!(summary(&repo, None, true).unwrap().against, "main");
        // With an upstream and the setting on, the summary measures against the upstream.
        run(&["remote", "add", "origin", &repo.display().to_string()], Some(&repo)).unwrap();
        run(&["update-ref", "refs/remotes/origin/feat", "HEAD~1"], Some(&repo)).unwrap();
        run(&["branch", "-q", "--set-upstream-to=origin/feat"], Some(&repo)).unwrap();
        let s = summary(&repo, None, true).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.behind, s.source), ("origin/feat", 1, 0, Lines { added: 1, removed: 3 }));
        assert_eq!(status(&repo).unwrap().head, Some(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap().trim().to_string()));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn git011_an_enormous_branch_gives_up_on_line_totals_but_still_counts_its_files() {
        let repo = temp_repo("summary-huge");
        run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
        for n in 0..3 {
            commit_file(&repo, &format!("f{n}.txt"), "a\nb\n");
        }
        let all = summary_capped(&repo, None, false, 3).unwrap();
        assert_eq!((all.files, all.lines_skipped, all.source.added), (3, false, 6));
        let big = summary_capped(&repo, None, false, 2).unwrap();
        assert_eq!((big.files, big.lines_skipped, big.source.added), (3, true, 0), "past the cap the files are counted and the lines are not");
        assert_eq!(big.committed.len(), 3);
    }

    #[test]
    fn git011_the_branch_row_counts_files_against_the_base_and_lists_the_committed_ones() {
        let repo = temp_repo("git011");
        run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
        // Three commits that touch five files read 3 ahead and 5 files changed.
        fs::write(repo.join("a.txt"), "a\n").unwrap();
        fs::write(repo.join("b.txt"), "b\n").unwrap();
        commit_file(&repo, "c.txt", "c\n");
        commit_file(&repo, "d.txt", "d\n");
        fs::write(repo.join("a.txt"), "a2\n").unwrap();
        commit_file(&repo, "README.md", "changed\n");
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.ahead, s.files), (3, 5));
        let mut names = paths(&s.committed);
        names.sort();
        assert_eq!(names, ["README.md", "a.txt", "b.txt", "c.txt", "d.txt"]);
        assert_eq!(s.committed.iter().find(|c| c.path == "README.md").unwrap().status, "M");
        assert_eq!(s.committed.iter().find(|c| c.path == "d.txt").unwrap().status, "A");
        // Pointing the base at another branch changes the counts and the committed files.
        run(&["branch", "mid", "HEAD~1"], Some(&repo)).unwrap();
        let s = summary(&repo, Some("mid"), false).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.files), ("mid", 1, 2));
        let mut names = paths(&s.committed);
        names.sort();
        assert_eq!(names, ["README.md", "a.txt"]);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn git017_d_conflicted_files_stay_out_of_the_message_diff_with_a_note() {
        let repo = temp_repo("git017d");
        run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "theirs
");
        run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "ours
");
        assert!(run(&["merge", "other"], Some(&repo)).is_err());
        assert_eq!(conflicted_files(&repo), ["README.md"]);
        // Only the conflicted file is staged: nothing to describe, and it says why.
        assert!(message_diff(&repo).unwrap_err().contains("unresolved conflicts"));
        fs::write(repo.join("fresh.txt"), "new work
").unwrap();
        run(&["add", "fresh.txt"], Some(&repo)).unwrap();
        let (note, diff) = message_diff(&repo).unwrap();
        assert!(note.starts_with("Note: 1 file with unresolved conflicts left out") && note.contains("README.md"));
        assert!(diff.contains("fresh.txt") && !diff.contains("README.md") && !diff.contains("<<<<<<<"));
        // Without a conflict there is no note.
        run(&["merge", "--abort"], Some(&repo)).unwrap();
        fs::write(repo.join("fresh.txt"), "new work
").unwrap();
        run(&["add", "fresh.txt"], Some(&repo)).unwrap();
        let (note, _) = message_diff(&repo).unwrap();
        assert_eq!(note, "");
        assert!(conflict_note(&(0..25).map(|n| format!("f{n}")).collect::<Vec<_>>()).contains("and 5 more"));
    }

    #[test]
    fn git017_d_a_command_line_writer_gets_a_prompt_that_fits_and_keeps_the_note() {
        let diff = format!("diff --git a/a b/a
{}", "+line of change
".repeat(3000));
        let note = conflict_note(&["x.txt".to_string()]);
        let fits = fit_prompt(&note, &diff, "use the imperative", Some(6_500));
        assert!(fits.len() <= 6_500 && fits.contains("x.txt") && fits.contains("use the imperative"));
        let roomy = fit_prompt(&note, &diff, "", None);
        assert!(roomy.len() > 20_000 && roomy.len() < 40_000);
    }

    #[test]
    fn git015_conflicts_name_their_clash_and_abort_puts_the_repository_back() {
        let repo = temp_repo("git015");
        run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "theirs\n");
        commit_file(&repo, "new.txt", "theirs\n");
        run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "ours\n");
        commit_file(&repo, "new.txt", "ours\n");
        let before = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        assert!(abort(&repo).unwrap_err().contains("Nothing"));
        assert!(run(&["merge", "other"], Some(&repo)).is_err());
        let st = status(&repo).unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        let mut clashes: Vec<(&str, &str)> = st.conflicts.iter().map(|c| (c.path.as_str(), c.status.as_str())).collect();
        clashes.sort();
        assert_eq!(clashes, [("README.md", "UU"), ("new.txt", "AA")]);
        assert!(st.resolved.is_empty());
        // A file fixed by hand reads as resolved here before it is staged.
        fs::write(repo.join("README.md"), "both\n").unwrap();
        assert_eq!(status(&repo).unwrap().resolved, ["README.md"]);
        // Abort puts the repository back where it was before the merge.
        abort(&repo).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!((st.operation.clone(), st.conflicts.len(), st.changed.len()), (None, 0, 0));
        assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), before);
        // A rebase is aborted as a rebase.
        run(&["checkout", "-q", "other"], Some(&repo)).unwrap();
        let other = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        assert!(run(&["rebase", "main"], Some(&repo)).is_err());
        assert_eq!(status(&repo).unwrap().operation.as_deref(), Some("rebase"));
        abort(&repo).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!((st.operation, st.branch.as_deref()), (None, Some("other")));
        assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), other);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn git026_a_pull_request_link_printed_in_a_terminal_attaches_once_even_split_across_chunks() {
        let mut scan = PrScan::default();
        assert!(scan.feed(b"Creating pull request for feat into main\r\n\r\nhttps://github.com/o/r/pu").is_empty());
        assert_eq!(scan.feed(b"ll/42\r\n"), ["https://github.com/o/r/pull/42"]);
        // The same link printed again is handled once.
        assert!(scan.feed(b"see https://github.com/o/r/pull/42 again\n").is_empty());
        // Colour codes around a link, an Enterprise host, and a path after the number.
        assert_eq!(scan.feed(b"\x1b[36mhttps://git.example.com/team/app/pull/7/files\x1b[0m\n"), ["https://git.example.com/team/app/pull/7"]);
        // Links that are not a pull request's.
        assert!(scan.feed(b"https://github.com/o/r/issues/3 https://github.com/o/r/pull/ https://github.com/o/pull/9 \n").is_empty());
        // A link split inside its scheme.
        assert!(scan.feed(b"htt").is_empty());
        assert_eq!(scan.feed(b"ps://github.com/o/r/pull/8 "), ["https://github.com/o/r/pull/8"]);
        // The link becomes the workspace's linked pull request, once, beside other settings.
        let dir = std::env::temp_dir().join(format!("kolux-rs-scm-git026-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        store.save_settings(&serde_json::json!({ "uiLook": "classic", "scmLinkedPrs": { "C:/other": "https://github.com/o/r/pull/1" } })).unwrap();
        assert!(link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
        assert!(!link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
        let s = store.settings();
        assert_eq!(s["scmLinkedPrs"]["C:/ws"], "https://github.com/o/r/pull/42");
        assert_eq!(s["scmLinkedPrs"]["C:/other"], "https://github.com/o/r/pull/1");
        assert_eq!(s["uiLook"], "classic");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git026_a_printed_link_survives_a_window_save_from_an_older_copy_of_the_settings() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-scm-git026-race-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        store.save_settings(&serde_json::json!({ "uiLook": "classic", "quietMinutes": 5 })).unwrap();
        // The window read its copy before the link was printed, then changes one setting.
        assert!(link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
        let set = serde_json::json!({ "uiLook": "new" });
        store.patch_settings(set.as_object().unwrap(), &["quietMinutes".to_string()]).unwrap();
        let s = store.settings();
        assert_eq!(s["scmLinkedPrs"]["C:/ws"], "https://github.com/o/r/pull/42");
        assert_eq!(s["uiLook"], "new");
        assert!(s.get("quietMinutes").is_none(), "{s}");
        // A link printed after the window's change keeps that change.
        assert!(link_printed(&store, "C:/ws2", "https://github.com/o/r/pull/43"));
        assert_eq!(store.settings()["uiLook"], "new");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    fn hit(repo: &str, n: u64) -> (Task, String) {
        let task = Task { kind: "issue".into(), number: n, title: format!("{repo} issue"), url: format!("https://github.com/{repo}/issues/{n}"), repo: repo.into(), state: "open".into(), draft: false, labels: vec![], assignees: vec![], updated: "2026-10-10T08:00:00Z".into(), checks: None };
        (task, String::new())
    }

    #[test]
    fn git045_one_refused_repository_does_not_blank_the_others() {
        let refuse = "github.com: gh: Validation Failed (HTTP 422): The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.";
        let asked = std::cell::RefCell::new(Vec::<String>::new());
        let mut one = |q: &str| -> Result<Hits, String> {
            asked.borrow_mut().push(q.to_string());
            if q.contains("repo:gone/x") && q.contains("repo:o/a") || q.contains("repo:gone/x") && q.contains("repo:o/b") {
                Err(refuse.into())
            } else if q.contains("repo:gone/x") {
                Err("github.com: gh: Not Found (HTTP 404)".into())
            } else if q.contains("repo:o/a") && !q.contains("repo:o/b") {
                Ok((3, vec![hit("o/a", 1)]))
            } else if q.contains("repo:o/b") && !q.contains("repo:o/a") {
                Ok((2, vec![hit("o/b", 2)]))
            } else {
                Err(refuse.into())
            }
        };
        let mut failed = Vec::new();
        let got = search_split("is:open repo:o/a repo:gone/x repo:o/b", &mut one, &mut failed).unwrap();
        assert_eq!(got.0, 5);
        assert_eq!(got.1.iter().map(|h| h.0.repo.as_str()).collect::<Vec<_>>(), vec!["o/a", "o/b"]);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].repo, "gone/x");
        assert!(failed[0].error.contains("404"), "{:?}", failed);
        // the whole query once, then each repository alone with the other words kept
        assert_eq!(*asked.borrow(), ["is:open repo:o/a repo:gone/x repo:o/b", "is:open repo:o/a", "is:open repo:gone/x", "is:open repo:o/b"]);
        // asked again for the other kind of item, the same repository is named once
        let _ = search_split("is:pr repo:o/a repo:gone/x", &mut one, &mut failed).unwrap();
        assert_eq!(failed.len(), 1);
    }

    #[test]
    fn git045_nothing_is_split_for_trouble_that_is_not_about_a_repository() {
        for said in ["github.com: API rate limit exceeded", "github.com: Sign in to GitHub first: run gh auth login", "gh did not answer within 30 seconds; try again in a moment"] {
            let mut calls = 0;
            let mut failed = Vec::new();
            let mut one = |_: &str| -> Result<Hits, String> {
                calls += 1;
                Err(said.into())
            };
            assert_eq!(search_split("is:open repo:o/a repo:o/b", &mut one, &mut failed).unwrap_err(), said);
            assert_eq!(calls, 1, "{said}");
            assert!(failed.is_empty());
        }
        // one repository alone has nothing to split
        let mut calls = 0;
        let mut one = |_: &str| -> Result<Hits, String> {
            calls += 1;
            Err("Validation Failed (HTTP 422)".into())
        };
        assert!(search_split("is:open repo:o/a", &mut one, &mut Vec::new()).is_err());
        assert_eq!(calls, 1);
        // every repository refused: the list fails as one, with the first reason
        let mut one = |_: &str| -> Result<Hits, String> { Err("Validation Failed (HTTP 422)".into()) };
        let mut failed = Vec::new();
        assert!(search_split("is:open repo:o/a repo:o/b", &mut one, &mut failed).is_err());
        assert_eq!(failed.len(), 2);
        // a very long list is not retried one by one
        let many = (0..=SPLIT_MAX).map(|i| format!("repo:o/r{i}")).collect::<Vec<_>>().join(" ");
        let mut calls = 0;
        let mut one = |_: &str| -> Result<Hits, String> {
            calls += 1;
            Err("Validation Failed (HTTP 422)".into())
        };
        assert!(search_split(&many, &mut one, &mut Vec::new()).is_err());
        assert_eq!(calls, 1);
    }

    #[test]
    fn t085d_the_poll_reads_each_open_pull_requests_checks_word_with_one_list_and_one_graphql_call() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-t085d-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let repo = tools.join("repo");
        fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["remote", "add", "origin", "https://github.com/o/r.git"]] {
            assert!(quiet("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        fs::write(tools.join("list.json"), r#"[{"number":7,"id":"PR_7"},{"number":9,"id":"PR_9"}]"#).unwrap();
        fs::write(tools.join("checks.json"), r#"{"data":{"nodes":[{"id":"PR_7","commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE"}}}]}}]}}"#).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"graphql\" (type \"%~dp0checks.json\") else (type \"%~dp0list.json\")\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$2\" = graphql ]; then cat \"$(dirname \"$0\")/checks.json\"; else cat \"$(dirname \"$0\")/list.json\"; fi\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let path = repo.to_string_lossy().to_string();
        let pr = |n: u64, state: &str| Some(Pr { number: n, url: format!("https://github.com/o/r/pull/{n}"), state: state.into(), title: None, head: None, draft: false });
        let row = |path: &str, pr: Option<Pr>, error: Option<&str>| PolledPr { path: path.into(), linked: false, pr, error: error.map(String::from) };
        let polled = [row(&path, pr(7, "OPEN"), None), row("C:/closed", pr(8, "CLOSED"), None), row("C:/broken", pr(9, "OPEN"), Some("rate limited")), row("C:/none", None, None)];
        let got = polled_checks(&gh, &polled);
        // Only the open pull request with a readable project is asked about; the rest are left out.
        assert_eq!(got.get(&path).map(String::as_str), Some("failing"));
        assert_eq!(got.len(), 1, "{got:?}");
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        assert_eq!(calls.lines().count(), 2, "{calls}");
        assert!(calls.contains("pr list --state open") && calls.contains("api graphql --hostname github.com") && calls.contains("PR_7") && !calls.contains("PR_9"), "{calls}");
        // Nothing open to ask about asks nothing.
        let before = calls.lines().count();
        assert!(polled_checks(&gh, &polled[1..]).is_empty());
        assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
        assert_eq!(open_ids("not json"), std::collections::HashMap::new());
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git043_tasks_search_pages_through_github_search_with_labels_assignees_and_checks() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git043-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let search = r#"{"total_count":1234,"incomplete_results":false,"items":[
            {"number":3,"title":"Crash on start","html_url":"https://github.com/o/r/issues/3","repository_url":"https://api.github.com/repos/o/r","state":"open","node_id":"I_3","updated_at":"2026-10-10T08:00:00Z","labels":[{"name":"bug","color":"d73a4a"},{"name":"odd","color":"red;x"}],"assignees":[{"login":"txais"}]},
            {"number":9,"title":"Fix crash","html_url":"https://github.com/o/r/pull/9","repository_url":"https://api.github.com/repos/o/r","state":"open","draft":true,"node_id":"PR_9","updated_at":"2026-10-11T08:00:00Z","labels":[],"assignees":[],"pull_request":{"merged_at":null}},
            {"number":8,"title":"Old fix","html_url":"https://github.com/o/r/pull/8","repository_url":"https://api.github.com/repos/o/r","state":"closed","node_id":"PR_8","updated_at":"2026-10-01T08:00:00Z","labels":[],"assignees":[],"pull_request":{"merged_at":"2026-10-01T08:00:00Z"}}]}"#;
        fs::write(tools.join("search.json"), search).unwrap();
        fs::write(tools.join("checks.json"), r#"{"data":{"nodes":[{"id":"PR_9","commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE"}}}]}},{"id":"PR_8","commits":{"nodes":[{"commit":{"statusCheckRollup":null}}]}}]}}"#).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"graphql\" (type \"%~dp0checks.json\") else (type \"%~dp0search.json\")\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$2\" = graphql ]; then cat \"$(dirname \"$0\")/checks.json\"; else cat \"$(dirname \"$0\")/search.json\"; fi\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let qs = ["is:issue is:open repo:o/r".to_string(), "is:pr is:open repo:o/r".to_string()];
        let got = tasks_search(&gh, "github.com", &qs, 3).unwrap();
        // Two searches of the same answer: summed for the count, the deeper one sets the pages, each item once.
        assert_eq!((got.total, got.deepest), (2468, 1234));
        let seen: Vec<(&str, u64, &str, bool, Option<&str>)> = got.items.iter().map(|t| (t.kind.as_str(), t.number, t.state.as_str(), t.draft, t.checks.as_deref())).collect();
        assert_eq!(seen, vec![("pr", 9, "open", true, Some("failing")), ("issue", 3, "open", false, None), ("pr", 8, "merged", false, Some("unresolved"))]);
        let issue = &got.items[1];
        assert_eq!((issue.repo.as_str(), issue.assignees.clone()), ("o/r", vec!["txais".to_string()]));
        // A colour that is not six hex digits is dropped, never handed to the page's style.
        assert_eq!(issue.labels, vec![TaskLabel { name: "bug".into(), color: "d73a4a".into() }, TaskLabel { name: "odd".into(), color: String::new() }]);
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        assert!(calls.contains("api search/issues --hostname github.com -X GET"), "{calls}");
        assert!(calls.contains("is:pr is:open repo:o/r") && calls.contains("page=3") && calls.contains("per_page=25"), "{calls}");
        assert!(calls.contains("api graphql --hostname github.com") && calls.contains("PR_9") && !calls.contains("I_3"), "{calls}");
        // Past GitHub's 1000-result window nothing is asked.
        let before = calls.lines().count();
        assert!(tasks_search(&gh, "github.com", &qs, 41).unwrap_err().contains("first 1000"));
        assert!(tasks_search(&gh, "bad host", &qs, 1).is_err());
        assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
        assert_eq!(checks_word(Some("SUCCESS")), "passing");
        assert_eq!(checks_word(Some("PENDING")), "running");
        assert_eq!(checks_word(Some("ERROR")), "failing");
        assert_eq!(checks_word(None), "unresolved");
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git050_preview_reads_body_and_timeline_and_edits_labels_and_body_through_gh() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git050-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        fs::write(tools.join("issue.json"), r#"{"number":3,"title":"Crash","state":"open","body":"It crashes.","updated_at":"2026-10-10T08:00:00Z","labels":[{"name":"bug","color":"d73a4a"}],"assignees":[{"login":"txais"}]}"#).unwrap();
        fs::write(tools.join("timeline.json"), r#"[
            {"event":"labeled","actor":{"login":"txais"},"created_at":"2026-10-09T08:00:00Z","label":{"name":"bug"}},
            {"event":"subscribed","actor":{"login":"txais"},"created_at":"2026-10-09T08:01:00Z"},
            {"event":"assigned","actor":{"login":"txais"},"created_at":"2026-10-09T08:02:00Z","assignee":{"login":"mo"}},
            {"event":"commented","user":{"login":"mo"},"created_at":"2026-10-09T09:00:00Z","body":"Same here."},
            {"event":"renamed","actor":{"login":"mo"},"created_at":"2026-10-09T10:00:00Z","rename":{"from":"Crsh","to":"Crash"}},
            {"event":"closed","actor":{"login":"mo"},"created_at":"2026-10-09T11:00:00Z"}]"#).unwrap();
        fs::write(tools.join("labels.json"), r#"[{"name":"bug","color":"d73a4a"},{"name":"needs info","color":"zzzzzz"}]"#).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            let script = "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho %* | findstr /c:\"/timeline\" >nul && (type \"%~dp0timeline.json\" & exit /b 0)\r\necho %* | findstr /c:\"/labels\" >nul && (type \"%~dp0labels.json\" & exit /b 0)\r\nif \"%3\"==\"PATCH\" (more >>\"%~dp0input.txt\")\r\ntype \"%~dp0issue.json\"\r\n";
            fs::write(&f, script).unwrap();
            f
        } else {
            let f = tools.join("gh");
            let script = "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncase \"$*\" in *'/timeline'*) cat \"$d/timeline.json\"; exit 0;; *'/labels'*) cat \"$d/labels.json\"; exit 0;; esac\n[ \"$3\" = PATCH ] && cat >> \"$d/input.txt\"\ncat \"$d/issue.json\"\n";
            fs::write(&f, script).unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let d = task_detail(&gh, "github.com", "o/r", 3).unwrap();
        assert_eq!((d.body.as_str(), d.state.as_str(), d.assignees.clone()), ("It crashes.", "open", vec!["txais".to_string()]));
        assert_eq!(d.labels, vec![TaskLabel { name: "bug".into(), color: "d73a4a".into() }]);
        // Subscriptions are noise and are left out; the rest keep who, when and what.
        let seen: Vec<(&str, &str, &str)> = d.events.iter().map(|e| (e.kind.as_str(), e.actor.as_str(), e.detail.as_str())).collect();
        assert_eq!(seen, vec![("labeled", "txais", "bug"), ("assigned", "txais", "mo"), ("commented", "mo", "Same here."), ("renamed", "mo", "Crsh \u{2192} Crash"), ("closed", "mo", "")]);
        assert_eq!(d.events[0].at, "2026-10-09T08:00:00Z");
        // Labels the repository offers, with a colour that is not hex dropped.
        assert_eq!(repo_labels(&gh, "github.com", "o/r").unwrap()[1], TaskLabel { name: "needs info".into(), color: String::new() });
        // Adding and removing a label answer with the labels the item has afterwards.
        assert_eq!(task_labels(&gh, "github.com", "o/r", 3, &["needs info".into()], &["good first/issue".into()]).unwrap().len(), 2);
        let body = task_body(&gh, "github.com", "o/r", 3, "New \"body\"").unwrap();
        assert_eq!(body.body, "It crashes.");
        // Windows quotes some arguments in the log; the words are what matter.
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap().replace('"', "");
        assert!(calls.contains("api repos/o/r/issues/3 --hostname github.com"), "{calls}");
        assert!(calls.contains("api repos/o/r/issues/3/timeline --hostname github.com -X GET -f per_page=100"), "{calls}");
        assert!(calls.contains("api -X POST repos/o/r/issues/3/labels --hostname github.com -f") && calls.contains("labels[]=needs info"), "{calls}");
        // A label name goes into the address encoded, so a slash cannot reach another path.
        assert!(calls.contains("api -X DELETE repos/o/r/issues/3/labels/good%20first%2Fissue --hostname github.com"), "{calls}");
        assert!(calls.contains("api -X PATCH repos/o/r/issues/3 --hostname github.com --input -"), "{calls}");
        assert!(fs::read_to_string(tools.join("input.txt")).unwrap().contains(r#"{"body":"New \"body\""}"#));
        // A repository or host that is not plain owner/name is refused before gh runs.
        let before = fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count();
        assert!(task_detail(&gh, "github.com", "o/r/../x", 3).is_err());
        assert!(task_detail(&gh, "github.com", "o", 3).is_err());
        assert!(task_detail(&gh, "bad host", "o/r", 3).is_err());
        assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git018_a_custom_writer_command_takes_the_prompt_in_place_or_on_standard_input() {
        // Quoted arguments stay together and backslashes stay as typed.
        assert_eq!(split_command(r#"node "C:\My Tools\w.js" --say {prompt}"#), vec!["node", r"C:\My Tools\w.js", "--say", "{prompt}"]);
        assert_eq!(split_command(r#"  tool  -m "a b"x  "#), vec!["tool", "-m", "a bx"]);
        // The placeholder takes the prompt; without one the prompt goes on standard input.
        let (args, input) = writer_args(&["--say".into(), "<{prompt}>".into()], "hi there");
        assert_eq!((args, input), (vec!["--say".to_string(), "<hi there>".to_string()], None));
        let (args, input) = writer_args(&["-q".into()], "hi");
        assert_eq!((args, input), (vec!["-q".to_string()], Some("hi".to_string())));
        // Custom instructions have their own capped part; blank ones add nothing.
        assert_eq!(message_prompt("D", "  \n "), message_prompt("D", ""));
        let p = message_prompt("D", "Use the imperative mood.");
        assert!(p.contains("Use the imperative mood.") && p.ends_with("\n\nD"), "{p}");
        let long = message_prompt("D", &"x".repeat(INSTRUCTIONS_MAX * 3));
        assert!(long.matches('x').count() <= INSTRUCTIONS_MAX, "{}", long.len());
        // A command run with the prompt in its arguments gets no standard input.
        let root = std::env::temp_dir().join(format!("kolux-rs-scm-git018-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let f = if cfg!(windows) {
            let f = root.join("say.cmd");
            fs::write(&f, "@echo off\r\necho %~1\r\n").unwrap();
            f
        } else {
            let f = root.join("say");
            fs::write(&f, "#!/bin/sh\necho \"$1\"\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let (args, input) = writer_args(&["{prompt}".into()], "Fix the poll");
        assert_eq!(write_message(&f, &args.iter().map(String::as_str).collect::<Vec<_>>(), &root, input.as_deref(), "k18", std::time::Duration::from_secs(20)), Ok("Fix the poll".to_string()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git017_commit_message_from_the_staged_diff_is_trimmed_cleaned_and_stoppable() {
        // A large diff is cut to the budget, shared fairly: the small file stays whole.
        let small = "diff --git a/s b/s\n+one\n+two\n";
        let big: String = format!("diff --git a/b b/b\n{}", (0..2000).map(|i| format!("+line {i}\n")).collect::<String>());
        let cut = trim_diff(&format!("{small}{big}"), 600);
        assert!(cut.len() <= 600 + 200, "{}", cut.len());
        assert!(cut.starts_with(small), "{cut}");
        assert!(cut.contains("+line 0\n") && !cut.contains("+line 1999"), "{cut}");
        assert!(cut.lines().all(|l| l.starts_with('+') || l.starts_with("diff ") || l.starts_with("[")), "cut mid-line: {cut}");
        assert_eq!(trim_diff(small, 600), small);
        // Fences, an announcing first line and bullets are stripped.
        assert_eq!(clean_message("Here is the commit message:\n```\n- Add the poll\n- Fix the row\n```\n"), "Add the poll\nFix the row");
        assert_eq!(clean_message("Add the poll\n\n* keeps state\n"), "Add the poll\n\nkeeps state");
        let root = std::env::temp_dir().join(format!("kolux-rs-scm-git017-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let script = |name: &str, win: &str, sh: &str| {
            if cfg!(windows) {
                let f = root.join(format!("{name}.cmd"));
                fs::write(&f, format!("@echo off\r\n{win}\r\n")).unwrap();
                f
            } else {
                let f = root.join(name);
                fs::write(&f, format!("#!/bin/sh\n{sh}\n")).unwrap();
                quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
                f
            }
        };
        let limit = std::time::Duration::from_secs(20);
        // The prompt arrives on standard input and the answer comes back cleaned.
        let echo = script("echo", "findstr /c:\"STAGED\" >nul && echo - Wrote the message", "grep -q STAGED && echo '- Wrote the message'");
        assert_eq!(write_message(&echo, &[], &root, Some("STAGED diff"), "k1", limit), Ok("Wrote the message".to_string()));
        // A clean exit with nothing printed is an empty result, with the error stream's excerpt.
        let empty = script("empty", "echo warming up 1>&2", "echo 'warming up' >&2");
        let e = write_message(&empty, &[], &root, Some("x"), "k2", limit).unwrap_err();
        assert!(e.contains("wrote nothing") && e.contains("warming up"), "{e}");
        // A failure favours the error stream and masks keys.
        let fail = script("fail", "echo partial\r\necho bad key sk-ant-abc123 1>&2\r\nexit /b 3", "echo partial; echo 'bad key sk-ant-abc123' >&2; exit 3");
        let e = write_message(&fail, &[], &root, Some("x"), "k3", limit).unwrap_err();
        assert!(e.contains("bad key sk-ant-[masked]") && !e.contains("abc123") && !e.contains("partial"), "{e}");
        // Stopping a run ends it at once and leaves no message.
        let slow = script("slow", "ping -n 30 127.0.0.1 >nul\r\necho late", "sleep 30; echo late");
        let started = std::time::Instant::now();
        let stopper = std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(800));
            stop_message("k4");
        });
        let e = write_message(&slow, &[], &root, Some("x"), "k4", limit).unwrap_err();
        stopper.join().unwrap();
        assert_eq!(e, "stopped");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        // The prompt names the job and carries the diff.
        let p = message_prompt("diff --git a/x b/x\n+y\n", "");
        assert!(p.contains("commit message") && p.ends_with("diff --git a/x b/x\n+y\n"), "{p}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git027_background_poll_asks_once_per_repository_and_stops_at_the_rate_limit() {
        let root = std::env::temp_dir().join(format!("kolux-rs-scm-git027-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let tools = root.join("tools");
        fs::create_dir_all(&tools).unwrap();
        let checkout = |name: &str, branch: &str, origin: Option<&str>| {
            let dir = temp_repo(&format!("git027-{name}"));
            if branch != "main" {
                run(&["checkout", "-q", "-b", branch], Some(&dir)).unwrap();
            }
            if let Some(o) = origin {
                run(&["remote", "add", "origin", o], Some(&dir)).unwrap();
            }
            dir.to_string_lossy().to_string()
        };
        // Two checkouts of one project under different remote forms, its main checkout, a second
        // project that hits the rate limit, a third never reached, and one with no GitHub remote.
        let a1 = checkout("a1", "feat", Some("https://github.com/o/r.git"));
        let a2 = checkout("a2", "fix", Some("git@github.com:O/R.git"));
        let a3 = checkout("a3", "main", Some("https://github.com/o/r"));
        let b = checkout("b", "work", Some("https://github.com/o/s.git"));
        let c = checkout("c", "work", Some("https://github.com/o/t.git"));
        let d = checkout("d", "work", None);
        fs::write(tools.join("list.json"), r#"[
            {"number":5,"url":"https://github.com/o/r/pull/5","state":"CLOSED","title":"Old feat","headRefName":"feat","isDraft":false},
            {"number":9,"url":"https://github.com/o/r/pull/9","state":"OPEN","title":"Feat","headRefName":"feat","isDraft":true},
            {"number":8,"url":"https://github.com/o/r/pull/8","state":"MERGED","title":"Fix","headRefName":"fix","isDraft":false},
            {"number":3,"url":"https://github.com/o/r/pull/3","state":"CLOSED","title":"From main","headRefName":"main","isDraft":false},
            {"number":2,"url":"https://github.com/o/r/pull/2","state":"OPEN","title":"Elsewhere","headRefName":"other","isDraft":false}]"#).unwrap();
        fs::write(tools.join("budget.json"), r#"{"resources":{"core":{"limit":5000,"remaining":0,"reset":1760000000}}}"#).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            let script = "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"rate_limit\" (type \"%~dp0budget.json\" & exit /b 0)\r\necho %* | findstr /c:\"o/s\" >nul && (echo API rate limit exceeded for user ID 1. 1>&2 & exit /b 1)\r\ntype \"%~dp0list.json\"\r\n";
            fs::write(&f, script).unwrap();
            f
        } else {
            let f = tools.join("gh");
            let script = "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\n[ \"$2\" = rate_limit ] && { cat \"$d/budget.json\"; exit 0; }\ncase \"$*\" in *o/s*) echo 'API rate limit exceeded for user ID 1.' >&2; exit 1;; esac\ncat \"$d/list.json\"\n";
            fs::write(&f, script).unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let item = |path: &str, linked: Option<&str>| PollItem { path: path.to_string(), linked: linked.map(String::from) };
        let items = vec![item(&a1, None), item(&d, None), item(&b, None), item(&a2, None), item(&a3, None), item(&c, None), item(&a1, Some("https://github.com/o/r/pull/2"))];
        let got = prs_poll(&gh, &items, std::time::Duration::from_millis(10));
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap().replace('"', "");
        // One list call per project in the order asked, then the budget read; o/t is never asked.
        let lists: Vec<&str> = calls.lines().filter(|l| l.starts_with("pr list")).collect();
        assert_eq!(lists.len(), 2, "{calls}");
        assert!(lists[0].contains("--repo github.com/o/r") && lists[1].contains("--repo github.com/o/s"), "{calls}");
        assert!(lists[0].contains("--state all --limit 100 --json number,url,state,title,headRefName,isDraft"), "{calls}");
        assert!(calls.contains("api rate_limit") && !calls.contains("o/t"), "{calls}");
        assert_eq!(got.limited_until, Some(1760000000));
        let of = |p: &str, linked: bool| got.prs.iter().find(|x| x.path == p && x.linked == linked).unwrap();
        // The branch's open pull request wins over an older closed one.
        assert_eq!(of(&a1, false).pr.as_ref().map(|p| (p.number, p.draft)), Some((9, true)));
        assert_eq!(of(&a2, false).pr.as_ref().map(|p| (p.number, p.state.as_str())), Some((8, "MERGED")));
        // A closed pull request from the default branch stays hidden.
        assert_eq!(of(&a3, false).pr, None);
        assert!(of(&a3, false).error.is_none());
        // A hand link is found in the same answer, wherever its branch is.
        assert_eq!(of(&a1, true).pr.as_ref().map(|p| p.number), Some(2));
        // The rate-limited project and the one behind it keep what they had (an error, no answer).
        assert!(of(&b, false).error.as_deref().unwrap().contains("rate limit"));
        assert!(of(&c, false).error.is_some() && of(&c, false).pr.is_none());
        // No GitHub remote: no pull request and nothing to retry.
        assert!(of(&d, false).pr.is_none() && of(&d, false).error.is_none());
        for p in [&a1, &a2, &a3, &b, &c, &d] {
            let _ = fs::remove_dir_all(p);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fix2_an_at_path_owner_is_refused_and_a_host_gh_is_not_signed_in_to_gets_no_request() {
        for bad in [
            "https://evil.example/@..\\..\\.ssh\\id_ed25519/x/pull/1",
            "https://evil.example/@id/x/pull/1",
            "https://evil.example/.ssh/x/pull/1",
            "https://evil.example/o/.git/pull/1",
            "https://evil.example/o/a\\b/pull/1",
            "https://evil.example:8443/o/r/pull/1",
            "https://u@evil.example/o/r/pull/1",
        ] {
            assert_eq!(pr_url_in(bad), None, "{bad}");
        }
        assert_eq!(pr_url_in("https://github.com/my-org/repo.name_2/pull/9#x").as_deref(), Some("https://github.com/my-org/repo.name_2/pull/9"));
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix2-host-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let url = "https://nobody.example/o/r/pull/3";
        for e in [merge_info(&gh, &tools, url).unwrap_err(), merge_act(&gh, &tools, url, "close", None).unwrap_err(), pr_link(&gh, &tools, url).unwrap_err()] {
            assert!(e.contains("is not one of them") && !e.contains("did not answer"), "{e}");
        }
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        assert!(calls.lines().all(|c| c.trim().starts_with("config get -h nobody.example")), "{calls}");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-BEFORE-1: the Checks panel's linked pull request (by hand or printed in a pane) goes to gh
    /// only as a well-formed link on a host gh is signed in to, in its cleaned form; a link to any
    /// other host asks gh nothing beyond its own config, and a malformed one reaches no gh at all.
    #[test]
    fn fixb1_the_checks_panel_asks_gh_only_about_a_clean_link_on_a_signed_in_host() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fixb1-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let calls = || fs::read_to_string(tools.join("calls.txt")).unwrap_or_default();
        for bad in ["https://evil.example/@id/x/pull/1", "https://evil.example/o/.git/pull/1", "https://u@github.com/o/r/pull/1", "https://github.com/o/r/pull/x", "github.com/o/r/pull/1"] {
            assert!(pr_checks_linked(&gh, &tools, bad).unwrap_err().contains("not a pull request link"), "{bad}");
        }
        assert_eq!(calls(), "", "a malformed link reaches no gh at all");
        let e = pr_checks_linked(&gh, &tools, "https://nobody.example/o/r/pull/3").unwrap_err();
        assert!(e.contains("is not one of them") && !e.contains("did not answer"), "{e}");
        assert!(calls().lines().all(|c| c.trim().starts_with("config get -h nobody.example")), "{}", calls());
        let got = pr_checks_linked(&gh, &tools, " https://github.com/o/r/pull/12/files#diff-1 ").unwrap();
        assert_eq!(got.pr.map(|p| p.number), Some(12));
        let view: Vec<String> = calls().lines().map(|c| c.trim().replace('"', "")).filter(|c| c.starts_with("pr view")).collect();
        assert_eq!(view.len(), 1, "{}", calls());
        assert!(view[0].starts_with("pr view https://github.com/o/r/pull/12 --json"), "{}", view[0]);
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-SOON 2: GitHub Enterprise Managed User logins read name_shortcode, so an owner may hold an
    /// underscore after its first character; a leading mark of any kind is still refused.
    #[test]
    fn fixsoon_an_enterprise_managed_user_owner_is_accepted_and_a_leading_mark_is_not() {
        assert_eq!(pr_url_in("https://github.com/octo_acme/r/pull/1").as_deref(), Some("https://github.com/octo_acme/r/pull/1"));
        assert_eq!(pr_url_in("https://github.com/a_b-c/r/pull/2#x").as_deref(), Some("https://github.com/a_b-c/r/pull/2"));
        for bad in ["https://github.com/_octo/r/pull/1", "https://github.com/-octo/r/pull/1", "https://github.com/.octo/r/pull/1", "https://github.com/@octo/r/pull/1"] {
            assert_eq!(pr_url_in(bad), None, "{bad}");
        }
        assert_eq!(pr_url_in(&format!("https://github.com/{}/r/pull/1", "a".repeat(40))), None);
    }

    /// FIX-SOON 3: the host gate on its own: a well-formed link (valid owner and name) on a host gh is
    /// not signed in to gets no pull request request from the merge box, its actions, the PR link
    /// or the Checks panel; gh is asked only for its own config about that host.
    #[test]
    fn fixsoon_a_valid_link_on_a_host_gh_is_not_signed_in_to_gets_no_request() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fixsoon-gate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let url = "https://nobody.example/octo/repo.name/pull/3";
        assert!(pr_url_in(url).is_some(), "the link itself is well formed");
        // Load flake fix: the gate gives each `gh config get` 5 s, and a loaded PC can take longer
        // to start one, which refuses the host with "gh did not answer" instead of gh's own
        // refusal. Such a round says nothing about the gate, so it is asked again (up to 5 times);
        // the round that is judged is one where gh answered every read, and it must hold in full.
        let mut round = 0;
        let calls = loop {
            round += 1;
            fs::remove_file(tools.join("calls.txt")).ok();
            let errs = [merge_info(&gh, &tools, url).unwrap_err(), merge_act(&gh, &tools, url, "close", None).unwrap_err(), pr_link(&gh, &tools, url).unwrap_err(), pr_checks_linked(&gh, &tools, url).unwrap_err()];
            if errs.iter().any(|e| e.contains("did not answer")) {
                assert!(round < 5, "gh never answered every config read in time in {round} rounds: {errs:?}");
                continue;
            }
            for e in &errs {
                assert!(e.contains("is not one of them"), "{e}");
            }
            break fs::read_to_string(tools.join("calls.txt")).unwrap();
        };
        assert_eq!(calls.lines().count(), 4, "{calls}");
        assert!(calls.lines().all(|c| c.trim().starts_with("config get -h nobody.example user")), "{calls}");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-3 (review FIX-SOON 1): gh answers `config get -h <host> user` with its top-level `user`
    /// when the host has none of its own, so that echo is no sign-in. A link to such a host gets no
    /// pull request request from the merge box, its actions, the PR link or the Checks panel; gh is
    /// asked only about its own config (the shared gate, github::host_allowed).
    #[test]
    fn fix3_a_host_that_only_echoes_the_top_level_user_gets_no_request() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix3-top-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" echo octo& exit /b 0\r\necho {}\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\n[ \"$1\" = config ] && echo octo && exit 0\necho '{}'\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let url = "https://ghe.example/o/r/pull/3";
        let refused = [
            merge_info(&gh, &tools, url).err(),
            merge_act(&gh, &tools, url, "close", None).err(),
            pr_link(&gh, &tools, url).err(),
            pr_checks_linked(&gh, &tools, url).err(),
        ];
        for e in refused {
            let e = e.expect("refused");
            assert!(e.contains("ghe.example is not one of them"), "{e}");
        }
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        assert!(calls.lines().all(|c| c.trim().starts_with("config get")), "only gh's own config is read: {calls}");
        assert!(calls.lines().any(|c| c.trim() == "config get user"), "the top-level user was compared: {calls}");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-3 (review AFTER 1-3): gh and the browser get the cleaned `https://host/owner/repo/pull/N`
    /// form of a link, never the raw text, and the host in it is lower case with a letter or digit first.
    #[test]
    fn fix3_gh_and_the_browser_get_only_the_cleaned_link() {
        assert_eq!(pr_url_in("https://GitHub.COM/o/r/pull/1").as_deref(), Some("https://github.com/o/r/pull/1"));
        for bad in ["https://-evil.example/o/r/pull/1", "https://.evil.example/o/r/pull/1", "https:///o/r/pull/1"] {
            assert_eq!(pr_url_in(bad), None, "{bad}");
        }
        assert_eq!(open_target(" https://github.com/o/r/pull/12/files#diff-1 ").as_deref(), Ok("https://github.com/o/r/pull/12"));
        assert!(open_target("https://u@github.com/o/r/pull/12").is_err());
        assert!(open_target("https://github.com/o/r/issues/12").is_err());
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix3-clean-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let url = " https://github.com/o/r/pull/12/files#diff-1 ";
        assert_eq!(pr_link(&gh, &tools, url).unwrap().number, 12);
        merge_act(&gh, &tools, url, "close", None).unwrap();
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        let pr: Vec<String> = calls.lines().map(|c| c.trim().replace('"', "")).filter(|c| c.starts_with("pr ")).collect();
        assert_eq!(pr.len(), 2, "{calls}");
        assert!(pr[0].starts_with("pr view https://github.com/o/r/pull/12 --json"), "{}", pr[0]);
        assert_eq!(pr[1], "pr close https://github.com/o/r/pull/12");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-3 (review FIX-SOON 3): a gh that runs past its time limit is stopped together with every
    /// program it started (a gh.cmd shim's real gh), so nothing it began keeps running afterwards.
    #[cfg(windows)]
    #[test]
    fn fix3_a_gh_that_times_out_is_stopped_with_everything_it_started() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix3-tree-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        // gh.cmd starts a second program that would leave a mark about five seconds later.
        fs::write(tools.join("late.cmd"), "@echo off\r\nping -n 6 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
        let gh = tools.join("gh.cmd");
        fs::write(&gh, "@echo off\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
        let started = std::time::Instant::now();
        let err = gh_run_for(&gh, &tools, &["pr", "view"], None, std::time::Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("did not answer within 1 second"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "took {:?}", started.elapsed());
        std::thread::sleep(std::time::Duration::from_secs(8));
        assert!(!tools.join("late.txt").exists(), "a program gh started outlived its time limit");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-8 (review FIX-SOON 3): the programs alive right now whose image or command line is under
    /// `dir` (Windows), as "name pid" lines. A fixture copy of ping (see `fix8_fixture`) is the only
    /// way a wait left behind by a half-done kill can be told from any other ping on the PC.
    #[cfg(windows)]
    fn processes_under(dir: &std::path::Path) -> Vec<String> {
        let script = "$d = $env:KOLUX_RS_TEST_DIR; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ( ($_.ExecutablePath -and $_.ExecutablePath.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.CommandLine -and $_.CommandLine.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0) ) } | ForEach-Object { $_.Name + ' ' + $_.ProcessId }";
        let out = quiet("powershell").args(["-NoProfile", "-NonInteractive", "-Command", script]).env("KOLUX_RS_TEST_DIR", dir).output().expect("powershell did not start");
        assert!(out.status.success(), "the process check failed, so it proves nothing: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
    }

    /// FIX-8: the fixture of the two timeout halves: gh.cmd starts late.cmd at once. late.cmd says it
    /// started, waits about five seconds with its OWN copy of ping (so a wait left alive is found by
    /// its path) and leaves a mark only if that wait ran to the end (`&&`: a tree kill ends the wait
    /// with exit code 1 a moment before the batch above it, and the batch must not read that as the
    /// wait being over). Returns gh.cmd.
    #[cfg(windows)]
    fn fix8_fixture(tools: &std::path::Path) -> PathBuf {
        fix8_fixture_waiting(tools, 6)
    }

    /// `fix8_fixture` with the wait of `pings` pings (about one second each), for a test whose limit
    /// has to be wide enough for a loaded PC to start the program first.
    #[cfg(windows)]
    fn fix8_fixture_waiting(tools: &std::path::Path, pings: u32) -> PathBuf {
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
        fs::write(tools.join("late.cmd"), format!("@echo off\r\necho started>\"%~dp0started.txt\"\r\n\"%~dp0ping.exe\" -n {pings} 127.0.0.1 >nul && echo late>\"%~dp0late.txt\"\r\n")).unwrap();
        let gh = tools.join("gh.cmd");
        fs::write(&gh, "@echo off\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
        gh
    }

    /// FIX-8: the process check is not blind: it sees a program started from a folder and sees none
    /// once that program has ended or in a folder where nothing ran.
    #[cfg(windows)]
    #[test]
    fn fix8_the_process_check_sees_a_program_under_a_folder_and_none_after_it_ends() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix8-probe-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        fix8_fixture(&tools);
        assert!(processes_under(&tools).is_empty(), "nothing ran yet: {:?}", processes_under(&tools));
        let mut waiter = quiet(tools.join("ping.exe")).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
        let seen = processes_under(&tools);
        assert!(seen.iter().any(|l| l.to_lowercase().starts_with("ping.exe ")), "the running copy was not found: {seen:?}");
        waiter.kill().unwrap();
        waiter.wait().unwrap();
        let end = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !processes_under(&tools).is_empty() && std::time::Instant::now() < end {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        assert!(processes_under(&tools).is_empty(), "the ended copy is still listed: {:?}", processes_under(&tools));
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-4 (review FIX-SOON 1): a timeout ends the tree through the job that holds gh; the tree
    /// kill (a parent-pid walk that can reach a program gh never started) is asked only when there
    /// is no job. FIX-8: neither half can pass having proved nothing: the job half checks that the
    /// program gh started really started (and tries again, up to three times, when a loaded PC made
    /// the limit run out first), and both halves check that nothing started from the test's own
    /// folder is still alive, so a half-done kill (the batch ended, its wait left running) fails.
    /// Load flake fix: the limits are wide (10 s, 6 s) so a loaded PC can start the fixture inside
    /// them, and the program gh starts waits about 60 s, so a kill that did not happen is still
    /// seen alive 20 s after the call returned (it would live 40 s or more longer).
    #[cfg(windows)]
    #[test]
    fn fix4_a_timeout_ends_the_tree_through_the_job_and_uses_the_tree_kill_only_without_one() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix4-job-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let gh = fix8_fixture_waiting(&tools, 61);
        // Polls (up to 20 s) until nothing started from the folder is alive; returns what is left.
        let settle = || {
            let end = std::time::Instant::now() + std::time::Duration::from_secs(20);
            loop {
                let alive = processes_under(&tools);
                if alive.is_empty() || std::time::Instant::now() >= end {
                    return alive;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
        };
        let limit = std::time::Duration::from_secs(10);
        let asked = std::sync::Mutex::new(Vec::new());
        let mut tried = 0;
        loop {
            tried += 1;
            for mark in ["started.txt", "late.txt"] {
                fs::remove_file(tools.join(mark)).ok();
            }
            asked.lock().unwrap().clear();
            let mut cmd = quiet(&gh);
            cmd.current_dir(&tools);
            let err = run_within_in(cmd, None, limit, true, &|p| asked.lock().unwrap().push(p), &|p| asked.lock().unwrap().push(p)).unwrap_err();
            assert!(err.contains("did not answer within 10 seconds"), "{err}");
            assert!(asked.lock().unwrap().is_empty(), "the tree kill ran although a job held gh: {:?}", asked.lock().unwrap());
            if tools.join("started.txt").exists() {
                assert!(!tools.join("late.txt").exists(), "a program gh started outlived its time limit");
                let left = settle();
                assert!(left.is_empty(), "the job left a program alive: {left:?}");
                break;
            }
            assert!(tried < 3, "fixture did not start: late.cmd never wrote started.txt in {tried} tries, so the job half proved nothing");
        }
        // Without a job the tree kill is the fallback and is asked for gh's pid. gh starts its
        // second program only after about nine seconds, past the limit of six, as a loaded PC
        // would, so the limit runs out before it exists; the tree kill waits (up to 30 s) for its
        // started.txt (FIX-7), so the walk finds it.
        let limit = std::time::Duration::from_secs(6);
        fs::remove_file(tools.join("started.txt")).ok();
        fs::write(&gh, "@echo off\r\nping -n 10 127.0.0.1 >nul\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
        let started = tools.join("started.txt");
        let saw_it = std::sync::atomic::AtomicBool::new(false);
        let mut cmd = quiet(&gh);
        cmd.current_dir(&tools);
        asked.lock().unwrap().clear();
        let err = run_within_in(cmd, None, limit, false, &|p| {
            asked.lock().unwrap().push(p);
            // The limit has run out, but the walk by parent pid only finds a program that exists.
            let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
            while !started.exists() && std::time::Instant::now() < end {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            saw_it.store(started.exists(), std::sync::atomic::Ordering::SeqCst);
            crate::procs::kill_tree(p);
        }, &|_| {})
        .unwrap_err();
        assert!(err.contains("did not answer within 6 seconds"), "{err}");
        assert_eq!(asked.lock().unwrap().len(), 1, "the fallback tree kill is asked once");
        assert!(saw_it.load(std::sync::atomic::Ordering::SeqCst), "fixture did not start: gh's second program never wrote started.txt within 30 s");
        assert!(!tools.join("late.txt").exists(), "the fallback left the program gh started running");
        let left = settle();
        assert!(left.is_empty(), "the fallback tree kill left a program alive: {left:?}");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-5 (review FIX-SOON 1 and 2): when no job holds gh, a finished gh that left a program
    /// holding its output is handed to the leftover kill once and NEVER to the tree kill (gh is
    /// reaped, so on Unix its pid may belong to another program by then), and the call still returns
    /// gh's answer inside its limit. (On Windows taskkill needs the root alive, so only a job reaches
    /// such a leftover; the leftover kill is best effort there and the group signal on Unix.) The
    /// test waits for the leftover to finish, so it leaves no program behind.
    #[cfg(windows)]
    #[test]
    fn fix5_without_a_job_a_finished_gh_with_a_holder_asks_only_the_leftover_kill_once_and_still_answers_in_time() {
        // Load flake fix: the holder outlives the limit by a wide margin (60 s against 8 s) and the
        // bound on the answer sits between them, so a PC where the kills themselves take seconds
        // (a taskkill took 6.8 s under two parallel builds) still tells "answered at the limit" from
        // "waited for the holder". The holder is a copy of ping in the folder, found and ended below.
        const LIMIT: std::time::Duration = std::time::Duration::from_secs(8);
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix4-nojob-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
        fs::write(tools.join("late.cmd"), "@echo off\r\n\"%~dp0ping.exe\" -n 61 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
        let gh = tools.join("gh.cmd");
        fs::write(&gh, "@echo off\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\necho octo\r\n").unwrap();
        let tree = std::sync::Mutex::new(Vec::new());
        let leftover = std::sync::Mutex::new(Vec::new());
        let mut cmd = quiet(&gh);
        cmd.current_dir(&tools);
        let started = std::time::Instant::now();
        let got = run_within_in(cmd, None, LIMIT, false, &|p| tree.lock().unwrap().push(p), &|p| {
            leftover.lock().unwrap().push(p);
            crate::procs::kill_tree(p);
        })
        .unwrap();
        let took = started.elapsed();
        assert_eq!(got.1.trim(), "octo");
        assert!(took < std::time::Duration::from_secs(45), "took {took:?} against a limit of {LIMIT:?}: the call waited for the holder");
        assert!(tree.lock().unwrap().is_empty(), "the tree kill was asked for a pid gh had already given up: {:?}", tree.lock().unwrap());
        assert_eq!(leftover.lock().unwrap().len(), 1, "the leftover kill runs once for the holder");
        // Windows cannot end the leftover without a job, so it is still running: end it here, and
        // wait (bounded) until nothing from the folder is alive before the folder goes.
        let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let alive = processes_under(&tools);
            if alive.is_empty() || std::time::Instant::now() >= end {
                break;
            }
            for pid in alive.iter().filter_map(|l| l.rsplit(' ').next()).filter_map(|p| p.parse::<u32>().ok()) {
                crate::procs::kill_tree(pid);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        assert!(processes_under(&tools).is_empty(), "the holder was left running: {:?}", processes_under(&tools));
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-5 (review FIX-SOON 1): the Unix leftover kill names the process group (`-pid`) and never
    /// the bare pid, which may already belong to another program once gh has been reaped.
    #[test]
    fn fix5_the_leftover_kill_names_the_group_and_never_the_bare_pid() {
        let args = group_kill_args(4242);
        assert_eq!(args, ["-9", "--", "-4242"]);
        assert!(!args.iter().any(|a| a == "4242"), "{args:?}");
    }

    /// FIX-6 (review AFTER 1): a negative process-group id is never read as an option: the `--`
    /// ends the options before it.
    #[test]
    fn fix6_the_group_id_comes_after_the_end_of_options_marker() {
        let args = group_kill_args(4242);
        let dashdash = args.iter().position(|a| a == "--").expect("no -- in the arguments");
        let group = args.iter().position(|a| a == "-4242").expect("no group id in the arguments");
        assert!(dashdash < group, "{args:?}");
        assert_eq!(group, args.len() - 1, "{args:?}");
    }

    /// FIX-6 (review AFTER 2): `kill_leftover` itself (through its runner seam) runs the program
    /// `kill` once with the group arguments, and never with the bare pid.
    #[test]
    fn fix6_the_leftover_kill_runs_kill_once_with_the_group_arguments() {
        let seen = std::cell::RefCell::new(Vec::<(String, Vec<String>)>::new());
        kill_leftover_with(4242, &|program, args| seen.borrow_mut().push((program.to_string(), args.to_vec())));
        let seen = seen.into_inner();
        assert_eq!(seen.len(), 1, "{seen:?}");
        assert_eq!(seen[0].0, "kill");
        assert_eq!(seen[0].1, ["-9", "--", "-4242"]);
        assert!(!seen[0].1.iter().any(|a| a == "4242"), "{seen:?}");
    }

    /// FIX-7 (review AFTER 1): the real runner starts the program with its arguments and waits for it
    /// to end, and a program that cannot start is not an error (the leftover kill is best effort).
    #[test]
    fn fix7_the_real_runner_runs_the_program_with_its_arguments_and_waits() {
        #[cfg(windows)]
        let (program, args) = ("cmd", vec!["/C".to_string(), "echo ran & exit 7".to_string()]);
        #[cfg(not(windows))]
        let (program, args) = ("sh", vec!["-c".to_string(), "echo ran; exit 7".to_string()]);
        // It started the program with those arguments and waited for the end: the exit code and the
        // whole output are in hand when it returns.
        let out = run_program_output(program, &args).unwrap();
        assert_eq!(out.status.code(), Some(7));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "ran");
        run_program(program, &args);
        // A program that cannot start is dropped without a panic.
        run_program("kolux-rs-no-such-program-fix7", &["-9".to_string()]);
    }

    /// FIX-8 (review FIX-SOON 1): reads `kill_leftover` out of `src` and says whether its Unix block
    /// hands the shared runner to the seam. The call must be live code, alone inside a block that
    /// follows the `cfg(unix)` attribute: a call in a comment, outside the block, under no attribute
    /// or replaced by an inline closure is an error.
    fn leftover_wiring(src: &str) -> Result<(), String> {
        let src = src.replace("\r\n", "\n");
        let head = ["fn kill_leftover", "(pid: u32) {"].concat();
        let from = src.find(&head).ok_or("kill_leftover not found")?;
        let body = &src[from..from + src[from..].find("\n}").ok_or("kill_leftover has no end")?];
        let live: Vec<&str> = body.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("//")).collect();
        let want = ["#[cfg(unix)]", "{", "kill_leftover_with(pid, &run_program);", "}"];
        if live.windows(4).any(|w| w.iter().zip(&want).all(|(a, b)| a == b)) {
            Ok(())
        } else {
            Err(format!("the Unix block does not hand run_program to kill_leftover_with: {live:?}"))
        }
    }

    /// FIX-8 (review FIX-SOON 1): the wiring check is not blind. Each wrong shape fails it (the old
    /// inline closure, a call only in a comment, a call outside the block, a block with no
    /// attribute) and the right one passes.
    #[test]
    fn fix8_the_wiring_check_fails_the_wrong_shapes_and_passes_the_right_one() {
        let head = ["fn kill_leftover", "(pid: u32) {"].concat();
        let call = ["kill_leftover_with(pid, &", "run_program);"].concat();
        let attr = ["#[cfg(", "unix)]"].concat();
        let tail = "    #[cfg(not(unix))]\n    crate::procs::kill_tree(pid);\n}\n";
        let make = |inner: &str| format!("fn other() {{}}\n{head}\n{inner}{tail}");
        let good = make(&format!("    {attr}\n    {{\n        {call}\n    }}\n"));
        assert_eq!(leftover_wiring(&good), Ok(()));
        assert_eq!(leftover_wiring(&good.replace('\n', "\r\n")), Ok(()), "CRLF must read the same");
        let old_closure = make(&format!("    {attr}\n    {{\n        kill_leftover_with(pid, &|program, args| {{\n            let _ = quiet(program).args(args).output();\n        }});\n    }}\n"));
        assert!(leftover_wiring(&old_closure).is_err(), "the old inline closure passed");
        let commented = make(&format!("    {attr}\n    {{\n        // {call}\n    }}\n"));
        assert!(leftover_wiring(&commented).is_err(), "a call in a comment passed");
        let outside = make(&format!("    {attr}\n    {{\n    }}\n    {call}\n"));
        assert!(leftover_wiring(&outside).is_err(), "a call outside the block passed");
        let no_attr = make(&format!("    {{\n        {call}\n    }}\n"));
        assert!(leftover_wiring(&no_attr).is_err(), "a block with no attribute passed");
        assert!(leftover_wiring("fn nothing() {}\n").is_err());
    }

    /// FIX-7 (review AFTER 1): `kill_leftover` hands the shared runner to the seam, so the code a
    /// Unix host runs is the code the runner test above runs (read from this file because Windows
    /// cannot compile the Unix body). FIX-8: the check is `leftover_wiring`, which the test above
    /// shows fails the wrong shapes.
    #[test]
    fn fix7_kill_leftover_uses_the_shared_runner() {
        assert_eq!(leftover_wiring(include_str!("scm.rs")), Ok(()));
    }

    /// FIX-4 (review AFTER 1): a gh that finishes just as the limit runs out still gets a short
    /// floor to close its output, so a `pr create` that worked is not cut off before its link.
    #[test]
    fn fix4_the_grace_has_a_floor_even_when_the_limit_has_run_out() {
        let now = std::time::Instant::now();
        assert!(grace_after(now, now) >= std::time::Duration::from_millis(200), "{:?}", grace_after(now, now));
        assert!(grace_after(now + std::time::Duration::from_secs(10), now) >= std::time::Duration::from_millis(200));
        assert_eq!(grace_after(now, now + std::time::Duration::from_secs(60)), std::time::Duration::from_millis(500));
    }

    /// FIX-3 (review FIX-SOON 3): gh has finished, but a program it started still holds its output;
    /// the answer comes back anyway, within the limit, and the leftover program is stopped (FIX-4:
    /// the answer comes back inside the limit and the leftover leaves no mark).
    /// Load flake fix: the limit is 20 s so a loaded PC can start gh inside it, the holder waits
    /// 60 s (its own copy of ping, so it is found by path), and the answer must come within 40 s:
    /// a call that waited for the holder takes 55 s or more, one that answered at the limit about 1 s
    /// after gh finished. The holder must be gone within 30 s of the answer (alive 40 s or more
    /// otherwise).
    #[cfg(windows)]
    #[test]
    fn fix3_a_gh_that_leaves_a_program_holding_its_output_still_answers_in_time() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix3-hold-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        // gh prints its answer and exits, leaving a program that holds its output and would leave a
        // mark about a minute later.
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
        fs::write(tools.join("late.cmd"), "@echo off\r\n\"%~dp0ping.exe\" -n 61 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
        let gh = tools.join("gh.cmd");
        fs::write(&gh, "@echo off\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\necho octo\r\n").unwrap();
        let limit = std::time::Duration::from_secs(20);
        let (tx, rx) = std::sync::mpsc::channel();
        let (g, t) = (gh.clone(), tools.clone());
        let started = std::time::Instant::now();
        std::thread::spawn(move || {
            let _ = tx.send(gh_run_for(&g, &t, &["pr", "view"], None, limit));
        });
        let got = rx.recv_timeout(std::time::Duration::from_secs(120)).expect("the call returns within its bound");
        let took = started.elapsed();
        assert_eq!(got.as_deref(), Ok("octo"));
        assert!(took < std::time::Duration::from_secs(40), "took {took:?} against a limit of {limit:?}: the call waited for the holder");
        let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut left = processes_under(&tools);
        while !left.is_empty() && std::time::Instant::now() < end {
            std::thread::sleep(std::time::Duration::from_millis(300));
            left = processes_under(&tools);
        }
        assert!(left.is_empty(), "the leftover program was not stopped: {left:?}");
        assert!(!tools.join("late.txt").exists(), "the leftover program was not stopped");
        let _ = fs::remove_dir_all(&tools);
    }

    /// FIX-3 (review FIX-SOON 3): a long pull request description goes to gh on its own thread, so a
    /// gh that never reads it cannot hold the call past its time limit.
    #[cfg(windows)]
    #[test]
    fn fix3_a_long_description_cannot_hang_a_gh_that_never_reads_it() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-fix3-stdin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let gh = tools.join("gh.cmd");
        fs::write(&gh, "@echo off\r\nping -n 8 127.0.0.1 >nul\r\n").unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let (g, t) = (gh.clone(), tools.clone());
        std::thread::spawn(move || {
            let body = "x".repeat(2 << 20);
            let _ = tx.send(gh_run_for(&g, &t, &["pr", "create"], Some(&body), std::time::Duration::from_secs(1)));
        });
        let got = rx.recv_timeout(std::time::Duration::from_secs(6)).expect("the call returns within its bound");
        assert!(got.as_ref().unwrap_err().contains("did not answer within 1 second"), "{got:?}");
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git033_merge_state_and_actions_go_through_gh_for_the_pull_requests_own_repository() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git033-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let answer = r#"{"data":{"repository":{"mergeCommitAllowed":false,"squashMergeAllowed":true,"rebaseMergeAllowed":false,"autoMergeAllowed":true,"pullRequest":{"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":null,"isInMergeQueue":false,"isMergeQueueEnabled":false,"autoMergeRequest":{"mergeMethod":"SQUASH"},"commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"PENDING"}}}]}}}}}"#;
        fs::write(tools.join("answer.json"), answer).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" if \"%3\"==\"-h\" if not \"%4\"==\"nobody.example\" echo octo\r\nif \"%1\"==\"api\" type \"%~dp0answer.json\"\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\n[ \"$1\" = config ] && [ \"$3\" = -h ] && [ \"$4\" != nobody.example ] && echo octo\n[ \"$1\" = api ] && cat \"$(dirname \"$0\")/answer.json\"\nexit 0\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let url = "https://git.example.com/o/r/pull/42";
        let m = merge_info(&gh, &tools, url).unwrap();
        assert_eq!((m.state.as_str(), m.draft, m.mergeable.as_str(), m.merge_state.as_str()), ("OPEN", false, "MERGEABLE", "BLOCKED"));
        assert_eq!((m.review.clone(), m.checks.as_deref(), m.in_queue, m.queue_enabled), (None, Some("PENDING"), false, false));
        assert_eq!((m.auto_merge.as_deref(), m.methods.clone(), m.auto_allowed), (Some("squash"), vec!["squash".to_string()], true));
        for (action, method) in [("auto", Some("squash")), ("merge", Some("rebase")), ("disable-auto", None), ("queue", None), ("ready", None), ("close", None), ("reopen", None)] {
            merge_act(&gh, &tools, url, action, method).unwrap();
        }
        assert!(merge_act(&gh, &tools, url, "merge", None).unwrap_err().contains("merge method"));
        assert!(merge_act(&gh, &tools, url, "delete", None).is_err());
        assert!(merge_act(&gh, &tools, "https://x/o/r/issues/1", "close", None).is_err());
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        // git.example.com stands in for a host gh is signed in to; each request asks gh first.
        let calls: Vec<&str> = calls.lines().map(str::trim).filter(|c| !c.starts_with("config get")).collect();
        assert!(calls[0].starts_with("api graphql --hostname git.example.com "), "{}", calls[0]);
        assert!(calls[0].contains("owner=o") && calls[0].contains("name=r") && calls[0].contains("number=42") && !calls[0].contains("--repo"), "{}", calls[0]);
        // FIX-2: owner and name go as raw strings, never as -F (which reads an @value from a file).
        let c0 = calls[0].replace('"', "");
        assert!(c0.contains("-f owner=o") && c0.contains("-f name=r") && c0.contains("-F number=42") && !c0.contains("-F owner=") && !c0.contains("-F name="), "{c0}");
        let rest: Vec<String> = calls[1..].iter().map(|c| c.to_string()).collect();
        assert_eq!(
            rest,
            [
                format!("pr merge {url} --auto --squash"),
                format!("pr merge {url} --rebase"),
                format!("pr merge {url} --disable-auto"),
                format!("pr merge {url}"),
                format!("pr ready {url}"),
                format!("pr close {url}"),
                format!("pr reopen {url}"),
            ]
        );
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git028_the_github_budget_reads_rest_search_and_graphql_from_gh() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git028-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let answer = r#"{"resources":{"core":{"limit":5000,"used":20,"remaining":4980,"reset":1760000000},"search":{"limit":30,"used":30,"remaining":0,"reset":1760000060},"graphql":{"limit":5000,"used":1,"remaining":4999,"reset":1760003600},"code_search":{"limit":10,"remaining":10,"reset":1}},"rate":{"limit":5000}}"#;
        fs::write(tools.join("answer.json"), answer).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\ntype \"%~dp0answer.json\"\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncat \"$(dirname \"$0\")/answer.json\"\n").unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let b = gh_budget(&gh).unwrap();
        let rows: Vec<(&str, u64, u64, u64)> = b.iter().map(|x| (x.name.as_str(), x.limit, x.remaining, x.reset)).collect();
        assert_eq!(rows, [("REST", 5000, 4980, 1760000000), ("Search", 30, 0, 1760000060), ("GraphQL", 5000, 4999, 1760003600)]);
        assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().trim(), "api rate_limit");
        // A budget gh leaves out is left out, not shown as zero.
        fs::write(tools.join("answer.json"), r#"{"resources":{"core":{"limit":60,"remaining":59,"reset":5}}}"#).unwrap();
        assert_eq!(gh_budget(&gh).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git003_discard_deletes_new_files_restores_deleted_ones_and_never_follows_a_link_out() {
        let dir = temp_repo("discard-paths");
        run(&["config", "core.symlinks", "true"], Some(&dir)).unwrap();
        let target = std::env::temp_dir().join(format!("kolux-rs-scm-target-{}", std::process::id()));
        fs::write(&target, "keep me\n").unwrap();
        let link = |name: &str, to: &Path| {
            #[cfg(unix)]
            std::os::unix::fs::symlink(to, dir.join(name)).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(to, dir.join(name)).unwrap();
        };
        commit_file(&dir, "gone.txt", "g\n");
        commit_file(&dir, "edit.txt", "e\n");
        commit_file(&dir, "old.txt", "o\n");
        link("tracked-link", Path::new("README.md"));
        run(&["add", "tracked-link"], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "link"], Some(&dir)).unwrap();

        fs::remove_file(dir.join("gone.txt")).unwrap();
        fs::write(dir.join("edit.txt"), "changed\n").unwrap();
        fs::write(dir.join("new.txt"), "n\n").unwrap();
        fs::write(dir.join("added.txt"), "a\n").unwrap();
        run(&["add", "added.txt"], Some(&dir)).unwrap();
        run(&["mv", "old.txt", "moved.txt"], Some(&dir)).unwrap();
        // The committed link re-aimed outside the repository, and an untracked link and an
        // untracked folder holding a link, all pointing at the outside file.
        fs::remove_file(dir.join("tracked-link")).unwrap();
        link("tracked-link", &target);
        link("loose-link", &target);
        fs::create_dir(dir.join("box")).unwrap();
        link("box/inner-link", &target);
        let st = status(&dir).unwrap();
        assert_eq!(paths(&st.untracked), ["box/inner-link", "loose-link", "new.txt"]);
        assert_eq!(paths(&st.staged), ["added.txt", "moved.txt"]);
        assert_eq!(paths(&st.changed), ["edit.txt", "gone.txt", "tracked-link"]);

        assert!(discard_paths(&dir, &["../outside.txt".to_string()]).unwrap_err().contains("outside"));
        let all: Vec<String> = ["gone.txt", "edit.txt", "new.txt", "added.txt", "moved.txt", "tracked-link", "loose-link", "box/inner-link"].iter().map(|s| s.to_string()).collect();
        discard_paths(&dir, &all).unwrap();
        assert_eq!(fs::read_to_string(dir.join("gone.txt")).unwrap(), "g\n", "a deleted file comes back from the last commit");
        assert_eq!(fs::read_to_string(dir.join("edit.txt")).unwrap(), "e\n", "a modified file loses its edits");
        assert_eq!(fs::read_to_string(dir.join("old.txt")).unwrap(), "o\n", "a rename is undone");
        for new in ["new.txt", "added.txt", "moved.txt", "loose-link", "box/inner-link"] {
            assert!(fs::symlink_metadata(dir.join(new)).is_err(), "{new} is removed for good");
        }
        assert_eq!(fs::read_link(dir.join("tracked-link")).unwrap(), Path::new("README.md"), "the link is rewritten as the commit had it");
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep me\n", "no link's target is ever touched");
        let st = status(&dir).unwrap();
        assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty(), "{st:?}");
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn paths_are_sorted_into_tests_generated_or_source() {
        for p in ["tests/a.rs", "src/__tests__/x.ts", "a/spec/b.rb", "src/x.test.tsx", "src/x.spec.js", "pkg/x_test.go", "py/test_x.py"] {
            assert_eq!(kind(p), Kind::Tests, "{p}");
        }
        for p in ["Cargo.lock", "web/pnpm-lock.yaml", "package-lock.json", "yarn.lock", "go.sum", "a/b.min.js", "x/__snapshots__/a.snap", "src/generated/api.ts"] {
            assert_eq!(kind(p), Kind::Generated, "{p}");
        }
        for p in ["src/main.rs", "README.md", "src/contest.ts", "testing.md", "latest/x.rs"] {
            assert_eq!(kind(p), Kind::Source, "{p}");
        }
    }
}
