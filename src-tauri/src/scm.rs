//! GIT-002 / GIT-003 / GIT-004 / GIT-006 / GIT-007: the Source Control panel's back end: what one
//! worktree has changed, staging and unstaging by path, discarding work, committing, and the remote actions (push, pull,
//! sync, fetch, fast-forward, force push with lease, publish, rebase from base). Every call names
//! the worktree it acts on, so one workspace's index is never touched from another's panel.
//! Reading status never touches the network: the ahead / behind counts come from the refs git
//! already has, so an unpublished branch is not checked against the remote over and over.

use crate::git::{command, command_checked, native, output, run, Git};

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
    // ponytail: the first 2 000 untracked files are counted; a folder of thousands shows the rest
    // bare. The reads share one byte budget, so a status poll never walks gigabytes of new files.
    const UNTRACKED_BUDGET: u64 = 8 * 1024 * 1024;
    let mut budget = UNTRACKED_BUDGET;
    st.lines.untracked = st.untracked.iter().take(2_000).filter_map(|c| {
        let path = worktree.join(&c.path);
        let len = std::fs::metadata(&path).ok()?.len();
        if len > budget {
            return None;
        }
        budget -= len;
        Some((c.path.clone(), [file_lines(&path)?, 0]))
    }).collect();
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
/// Speed: one `for-each-ref` answers the common case (a branch with an upstream, in sync or ahead)
/// that took three git runs; `--points-at HEAD` keeps the ahead count to the branches at HEAD, so a
/// repository with thousands of branches costs the same. No starred row (a detached or unborn HEAD,
/// or a failed read) and the unpublished case take the step-by-step reading, which gives the answer.
pub fn pushed(worktree: &Path) -> Option<Pushed> {
    let listed = run(&["for-each-ref", "--points-at=HEAD", "--format=%(HEAD)%09%(upstream)%09%(upstream:track)", "refs/heads/"], Some(worktree)).ok();
    let Some(row) = listed.as_deref().and_then(|t| t.lines().find(|l| l.starts_with('*'))) else { return pushed_by_steps(worktree) };
    let mut f = row.splitn(3, '\t').skip(1);
    let (upstream, track) = (f.next().unwrap_or(""), f.next().unwrap_or("").trim());
    // No upstream, or one whose ref is gone (`@{upstream}` does not resolve either): unpublished.
    if upstream.is_empty() || track == "[gone]" {
        return pushed_by_steps(worktree);
    }
    // `[ahead 2]`, `[behind 1]`, `[ahead 2, behind 1]` or nothing (in sync): the ahead count is `@{upstream}..HEAD`.
    let ahead = track.trim_matches(['[', ']']).split(", ").find_map(|p| p.strip_prefix("ahead ")).map_or(Some(0), |n| n.parse::<u32>().ok());
    let path = worktree.display().to_string();
    Some(match ahead {
        Some(0) => Pushed { path, state: "synced", count: 0 },
        Some(count) => Pushed { path, state: "ahead", count },
        None => Pushed { path, state: "unknown", count: 0 },
    })
}

/// GIT-065: `pushed` one question at a time (HEAD's branch, its upstream, the count).
fn pushed_by_steps(worktree: &Path) -> Option<Pushed> {
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
    let mut child = command_checked(args, Some(worktree))?.envs(crate::git::NO_PROMPT).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
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
    // Runs git and reads the ssh config: off the async workers, like its neighbours.
    tauri::async_runtime::spawn_blocking(move || {
        let url = run(&["remote", "get-url", "origin"], Some(Path::new(&worktree))).ok()?;
        github_repo(&url, &ssh_config())
    })
    .await
    .ok()
    .flatten()
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
        cmd.creation_flags(crate::winproc::no_window());
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
    // Development builds only: KOLUX_DEV_GH (or the worktrees lane's KOLUX_GH) names a stand-in
    // gh for live proofs, since the registry's search path (which finds the real gh) comes before
    // the process PATH.
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("KOLUX_DEV_GH").or_else(|| crate::env_name::var_os("KOLUX_GH")) {
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
            // T-663: by full path, or refused; never a copy in the worktree the writer runs from.
            let program = crate::scm_recipe::program_by_full_path(&words[0])?;
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
        // Exactly the one separating space: an untracked name may itself start with spaces, and a
        // trimmed one would stage or (git clean) delete another file.
        let rest = rest.strip_prefix(' ').unwrap_or(rest);
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
        // R82-03: a NUL would reach Git as a break between two names.
        if p.contains('\0') {
            return Err("A file name here holds a character Kolux cannot pass to Git. Nothing was changed.".into());
        }
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
    // taking the paths out of the index. R82-05: any other failure to read the last commit comes
    // back as Git's words, and nothing is changed.
    let no_commits = !on && no_commit(worktree)?;
    let args: &[&str] = if on {
        &["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else if no_commits {
        &["--literal-pathspecs", "rm", "--cached", "-f", "-r", "-q", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else {
        &["--literal-pathspecs", "restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
    };
    piped(worktree, args, paths)
}

/// Runs git with the paths on its standard input, NUL separated; git's own words when it fails.
fn piped(worktree: &Path, args: &[&str], paths: &[String]) -> Result<(), String> {
    let mut child = command_checked(args, Some(worktree))?.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
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
/// repository is touched. B-09: an untracked row goes exactly as the untracked section's discard
/// sends it (`git clean -f -d`), so a nested repository and ignored files are left alone.
pub fn discard_paths(worktree: &Path, paths: &[String]) -> Result<(), String> {
    // R86-05: an empty list is answered in Discard's words, before the shared row checks.
    if paths.is_empty() {
        return Err("Nothing to discard.".into());
    }
    let paths: &[String] = &one_spelling(paths);
    not_whole(paths)?;
    check_paths(paths)?;
    let st = status(worktree)?;
    let k = kinds(worktree, &paths.iter().map(|p| p.trim_end_matches('/')).collect::<Vec<_>>(), true)?;
    let held = |r: &str| k.at.contains(r) || k.head_file.contains(r);
    let (mut staged, mut tracked, mut untracked, mut remove) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut kept = Vec::new();
    let mut renames: Vec<(String, String)> = Vec::new();
    let mut real = std::collections::HashSet::new();
    for p in paths {
        let p = p.trim_end_matches('/');
        let index = st.staged.iter().find(|c| c.path == p);
        // F-02: a row whose file (or a rename's old file) Git would write over a folder with
        // something in it is left exactly as it is: not unstaged, not written, not cleaned.
        // R59-01/R59-02: so is a row under a link or a file where a folder was.
        // F90-01: Git holds the row itself when `k` says so, and a staged rename's old half always.
        if let Some(why) = std::iter::once((p, held(p))).chain(index.and_then(|c| c.from.as_deref()).map(|f| (f, true))).find_map(|(at, h)| left_why(worktree, at, &mut real).or_else(|| folder_in_place(worktree, at).then(|| now_folder(at))).or_else(|| is_link(worktree, at, h).err())) {
            kept.push(why);
            continue;
        }
        // R82-02: a row naming a folder of tracked files is left whole (a row listed as untracked
        // goes as one, below).
        let listed_untracked = st.untracked.iter().any(|c| c.path.trim_end_matches('/') == p);
        if !listed_untracked && k.folder(p) {
            kept.push(folder_line(p));
            continue;
        }
        if let Some(c) = index {
            staged.push(c.path.clone());
            if let Some(from) = &c.from {
                staged.push(from.clone());
                tracked.push(from.clone());
                renames.push((from.clone(), c.path.clone()));
            }
        }
        if listed_untracked {
            untracked.push(p.to_string());
        } else if index.is_some_and(|c| c.status == "A" || c.from.is_some()) {
            remove.push(p.to_string());
        } else {
            tracked.push(p.to_string());
        }
    }
    // A link is removed before git rewrites it, so git never writes through it. R82-03: a row
    // whose kind cannot be read, or whose link cannot be removed, is named and left; the rest go.
    // R86-03: this runs before anything is unstaged, so a left row (and a staged rename's other
    // half with it) keeps its staged change.
    let (mut removed, mut failed) = (Vec::new(), Vec::new());
    for p in &tracked {
        // F90-01: the same answer the check above gave this row.
        match remove_link(worktree, p, held(p) || renames.iter().any(|(from, _)| from == p)) {
            Ok(true) => removed.push(p.clone()),
            Ok(false) => {}
            Err(e) => {
                kept.push(e);
                failed.push(p.clone());
            }
        }
    }
    for (from, to) in &renames {
        if failed.contains(from) && !failed.contains(to) {
            kept.push(format!("{to} is the other half of a rename, so Kolux leaves it too."));
            failed.push(to.clone());
        }
    }
    staged.retain(|p| !failed.contains(p));
    tracked.retain(|p| !failed.contains(p));
    remove.retain(|p| !failed.contains(p));
    let already = |kept: &mut Vec<String>| kept.extend(removed.iter().map(|p| format!("The link at {p} was already removed. What it pointed to is untouched.")));
    if !staged.is_empty() {
        if let Err(e) = with_paths(worktree, &["reset", "-q"], &staged) {
            kept.push(e);
            already(&mut kept);
            return Err(kept.join("\n"));
        }
    }
    if !tracked.is_empty() {
        if let Err(e) = with_paths(worktree, &["-c", "submodule.recurse=false", "checkout", "-q", "HEAD"], &tracked) {
            kept.push(e);
            already(&mut kept);
            return Err(kept.join("\n"));
        }
    }
    // N-02: a nested repository is taken out before git clean runs and named at the end, so the
    // other rows still go. F-01: an error from the untracked discard, or from removing one staged
    // new file, is a real failure: it is named at the end with the rest, and the other rows still go.
    let (nested, untracked): (Vec<String>, Vec<String>) = untracked.into_iter().partition(|p| own_repo_at(worktree, p));
    kept.extend(nested.iter().map(|p| own_repo(p)));
    if !untracked.is_empty() {
        if let Err(e) = discard(worktree, "untracked", &untracked) {
            kept.push(e);
        }
    }
    // A staged new file, unstaged above. N-01: an index entry is a file or a gitlink, never a
    // plain folder, so a folder here is a nested repository or a file that became a folder. A
    // folder holding `.git` is kept, and so is any folder that is not empty; only an empty one goes.
    for p in &remove {
        let full = worktree.join(native(p));
        let Ok(meta) = fs::symlink_metadata(&full) else { continue };
        if own_repo_at(worktree, p) {
            kept.push(own_repo(p));
            continue;
        }
        let done = if meta.is_dir() {
            if fs::read_dir(&full).is_ok_and(|mut d| d.next().is_some()) {
                kept.push(format!("{p} is a folder with files in it, so Kolux leaves it. Delete it by hand if you mean to."));
                continue;
            }
            fs::remove_dir(&full)
        } else {
            fs::remove_file(&full).or_else(|_| fs::remove_dir(&full))
        };
        if let Err(e) = done {
            kept.push(format!("{p}: {e}"));
        }
    }
    if kept.is_empty() {
        Ok(())
    } else {
        Err(kept.join("\n"))
    }
}

/// R70-01: Git for Windows reads `\` in a row as a folder break, so on Windows Discard turns every
/// row to Git's own `/` spelling before any check: every check and every Git call sees one
/// spelling. Elsewhere `\` is a legal character in a file name, and the row stays as it is.
/// R82-01: empty and `.` parts are dropped (`./foo`, `sub//foo` and `sub/./foo` are checked as the
/// file Git reads them as), a trailing `/` is kept once, and `..` stays so the check refuses it. A
/// rooted or prefixed row (`/x`, `C:d/f`, `d:stream`, `//?/x`) stays as sent, refused the same way.
fn one_spelling(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .map(|p| {
            let p = if cfg!(windows) { p.replace('\\', "/") } else { p.clone() };
            let path = Path::new(&p);
            if path.has_root() || matches!(path.components().next(), Some(Component::Prefix(_))) {
                return p;
            }
            let clean = p.split('/').filter(|s| !s.is_empty() && *s != ".").collect::<Vec<_>>().join("/");
            if p.ends_with('/') && !clean.is_empty() {
                clean + "/"
            } else {
                clean
            }
        })
        .collect()
}

/// R-06: true when the row's folder holds `.git` (a file or a folder), a nested repository.
/// F-04: a row that is itself a link is never one, even when it points at a repository: it is
/// removed as a link, and what it points at is never touched.
fn own_repo_at(worktree: &Path, p: &str) -> bool {
    let full = worktree.join(native(p.trim_end_matches('/')));
    fs::symlink_metadata(&full).is_ok_and(|m| !m.is_symlink()) && fs::symlink_metadata(full.join(".git")).is_ok()
}

/// F-02: true when Git's checkout or restore would write a file or a link at `p` while a real
/// folder (not a link) with anything in it, or one that cannot be read, sits there: Git would
/// remove that folder whole, a nested repository's history included. An empty folder is left to
/// Git (nothing is lost with it), and so is a submodule's folder (its entry is a gitlink, which
/// Git never writes as a file) or a tracked folder's.
fn folder_in_place(worktree: &Path, p: &str) -> bool {
    let p = p.trim_end_matches('/');
    let full = worktree.join(native(p));
    let real_folder = fs::symlink_metadata(&full).is_ok_and(|m| m.is_dir() && !m.is_symlink());
    if !real_folder || fs::read_dir(&full).is_ok_and(|mut d| d.next().is_none()) {
        return false;
    }
    // The modes the index and the last commit hold at exactly `p`; a failed read keeps the folder.
    let modes = |args: &[&str]| run(args, Some(worktree)).map(|out| out.split('\0').filter_map(|e| e.split_once('\t')).filter(|(_, at)| *at == p).map(|(m, _)| m.split(' ').next().unwrap_or_default().to_string()).collect::<Vec<_>>());
    let Ok(index) = modes(&["--literal-pathspecs", "ls-files", "-s", "-z", "--", p]) else { return true };
    // R59-07: so does a failed read of the last commit, unless there is no commit yet.
    let head = match modes(&["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", p]) {
        Ok(head) => head,
        Err(_) if matches!(no_commit(worktree), Ok(true)) => Vec::new(),
        Err(_) => return true,
    };
    index.iter().chain(&head).any(|m| m != "160000" && m != "040000")
}

/// R70-02: true when the repository has no commit yet. Only `rev-parse` ending with code 1 and
/// printing nothing means that; any other failure is Git's words, never "no commit yet".
/// R82-05: read through the same turn and time limit as every other short read.
fn no_commit(worktree: &Path) -> Result<bool, String> {
    let o = crate::git::read_exit(&["rev-parse", "--verify", "-q", "HEAD"], Some(worktree))?;
    match o.status.code() {
        Some(0) => Ok(false),
        Some(1) if o.stdout.is_empty() && o.stderr.is_empty() => Ok(true),
        _ => {
            let e = String::from_utf8_lossy(&o.stderr).trim().to_string();
            Err(if e.is_empty() { format!("git rev-parse --verify -q HEAD failed ({})", o.status) } else { e })
        }
    }
}

/// R82-02: the line Discard said in place of a whole call with a row that names the repository.
const WHOLE: &str = "Kolux does not discard a whole folder at once. Pick the files instead.";

/// R82-02: a row that is empty after `one_spelling` (`.`, `./`, `.\`) names the whole repository;
/// the whole call is refused before any Git command or removal.
fn not_whole(paths: &[String]) -> Result<(), String> {
    if paths.iter().any(|p| p.is_empty()) {
        Err(WHOLE.into())
    } else {
        Ok(())
    }
}

/// R82-02: what Discard says about a row it leaves because it names a folder of tracked files.
fn folder_line(p: &str) -> String {
    format!("{} is a folder, so Kolux leaves it. Discard the files inside it instead.", p.trim_end_matches('/'))
}

/// R82-02: what the index and the last commit hold at and below each row (rows without a trailing
/// `/`), read with one `ls-files` and (when `with_head`) one `ls-tree` per call, in chunks that stay
/// well under the Windows command-line limit.
#[derive(Default)]
struct Kinds {
    at: std::collections::HashSet<String>,
    below: std::collections::HashSet<String>,
    head_dir: std::collections::HashSet<String>,
    head_file: std::collections::HashSet<String>,
}

impl Kinds {
    /// A folder of tracked files: no file or gitlink at the row in the index or the last commit,
    /// and a folder there in the last commit or files below it in the index.
    fn folder(&self, p: &str) -> bool {
        let p = p.trim_end_matches('/');
        !self.at.contains(p) && !self.head_file.contains(p) && (self.head_dir.contains(p) || self.below.contains(p))
    }
}

fn kinds(worktree: &Path, rows: &[&str], with_head: bool) -> Result<Kinds, String> {
    let stop = |e: String| format!("Kolux could not ask Git what these rows are, so it stopped before changing them: {e}");
    let wanted: std::collections::HashSet<&str> = rows.iter().copied().collect();
    let mut k = Kinds::default();
    let (mut chunks, mut chunk, mut size) = (Vec::new(), Vec::new(), 0);
    for r in rows {
        if size + r.len() > 8000 && !chunk.is_empty() {
            chunks.push(std::mem::take(&mut chunk));
            size = 0;
        }
        size += r.len() + 3;
        chunk.push(*r);
    }
    chunks.push(chunk);
    let entries = |out: Vec<u8>| String::from_utf8_lossy(&out).split('\0').filter_map(|e| e.split_once('\t').map(|(m, at)| (m.split(' ').next().unwrap_or_default().to_string(), at.to_string()))).collect::<Vec<_>>();
    for chunk in &chunks {
        let mut args = vec!["--literal-pathspecs", "ls-files", "-s", "-z", "--"];
        args.extend(chunk);
        for (_, at) in entries(output(&args, Some(worktree)).map_err(stop)?) {
            for (i, _) in at.match_indices('/') {
                if wanted.contains(&at[..i]) {
                    k.below.insert(at[..i].to_string());
                }
            }
            if wanted.contains(at.as_str()) {
                k.at.insert(at);
            }
        }
        if !with_head {
            continue;
        }
        let mut args = vec!["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--"];
        args.extend(chunk);
        let head = match output(&args, Some(worktree)) {
            Ok(out) => entries(out),
            Err(_) if matches!(no_commit(worktree), Ok(true)) => Vec::new(),
            Err(e) => return Err(stop(e)),
        };
        for (mode, at) in head {
            if wanted.contains(at.as_str()) {
                if mode == "040000" {
                    k.head_dir.insert(at);
                } else {
                    k.head_file.insert(at);
                }
            }
        }
    }
    Ok(k)
}

/// R59-01 / R59-02: why Discard must leave row `p`, or nothing. A folder above it (below the
/// worktree's root, never the root or above) that is a link would have Git write or delete in the
/// folder it points at; one that is now a file would be deleted to make room.
/// One `symlink_metadata` per folder not yet seen as real in this discard (`real`), no process; a
/// missing folder ends the look (Git makes it again).
// R70-06, accepted: a link made between this check and Git's write is not seen. Closing that needs
// Git itself to refuse writing through a link (or a lock on the folders), which it does not offer.
fn left_why(worktree: &Path, p: &str, real: &mut std::collections::HashSet<String>) -> Option<String> {
    let row = p.trim_end_matches('/');
    let parts: Vec<&str> = row.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    // R86-01: Windows drops a trailing dot or space, so `sub.` opens `sub`: Git and the disk would
    // read two names. Any part of the row (its own name included) ending so is left.
    if cfg!(windows) && parts.iter().any(|s| s.ends_with('.') || s.ends_with(' ')) {
        return Some(format!("{row} has a name that ends in a dot or a space. Windows reads that as another name, so Kolux leaves it. Rename or delete it with the tool that made it (WSL, for example), not in Explorer."));
    }
    let mut at = String::new();
    for part in &parts[..parts.len().saturating_sub(1)] {
        at = if at.is_empty() { part.to_string() } else { format!("{at}/{part}") };
        if real.contains(&at) {
            continue;
        }
        match fs::symlink_metadata(worktree.join(native(&at))) {
            Ok(m) if m.is_symlink() => return Some(format!("{at} is a link, so Kolux leaves {row}. Remove the link by hand, then discard again.")),
            Ok(m) if m.is_dir() => drop(real.insert(at.clone())),
            Ok(_) => return Some(format!("{at} is now a file, so Kolux leaves {row}. Remove or move that file by hand, then discard again.")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Some(unread(&at, row)),
        }
    }
    None
}

/// What Discard says about a part `at` of row `row` that could not be read. R86-04: a failure, so
/// it never holds the words of a row left on purpose.
fn unread(at: &str, row: &str) -> String {
    if at == row {
        format!("{row} could not be read. Kolux did not change it.")
    } else {
        format!("{at} could not be read. Kolux did not change {row}.")
    }
}

/// R86-01: on Windows one file or folder answers to more than one spelling (`SUB`, `sub.`, a
/// short name such as `SUB~1`), and Git does not know that. Ok when every part of row `p` is
/// spelled exactly as its folder's listing holds it, or when nothing stands there; otherwise the
/// row is left. Each folder is listed once per call (`lists`). Off Windows Git may print another
/// Unicode form of a name than the disk holds, so the rule is Windows only.
fn on_disk_as_sent(worktree: &Path, p: &str, lists: &mut std::collections::HashMap<String, Option<std::collections::HashSet<std::ffi::OsString>>>) -> Result<(), String> {
    if !cfg!(windows) {
        return Ok(());
    }
    let row = p.trim_end_matches('/');
    let mut at = String::new();
    for part in row.split('/') {
        let names = lists.entry(at.clone()).or_insert_with(|| fs::read_dir(worktree.join(native(&at))).ok().and_then(|d| d.map(|e| e.map(|e| e.file_name())).collect::<Result<_, _>>().ok()));
        let Some(names) = names else {
            let shown = if at.is_empty() { worktree.display().to_string() } else { at.clone() };
            return Err(unread(&shown, row));
        };
        let next = if at.is_empty() { part.to_string() } else { format!("{at}/{part}") };
        if !names.contains(std::ffi::OsStr::new(part)) {
            return match fs::symlink_metadata(worktree.join(native(&next))) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(unread(&next, row)),
                Ok(_) => Err(format!("{row} is not spelled the way it is on disk, so Kolux leaves it. Refresh the list, then discard again.")),
            };
        }
        at = next;
    }
    Ok(())
}

/// R59-01 / R59-04: removes a link (a junction, a folder or file symlink) at row `p` itself,
/// never what it points at. True when there was one; a failure names the row. R70-05: a row whose
/// kind cannot be read (for a reason other than "missing") is left, never taken as "not a link".
fn remove_link(worktree: &Path, p: &str, held: bool) -> Result<bool, String> {
    if !is_link(worktree, p, held)? {
        return Ok(false);
    }
    let p = p.trim_end_matches('/');
    let full = worktree.join(native(p));
    fs::remove_file(&full).or_else(|_| fs::remove_dir(&full)).map(|_| true).map_err(|e| format!("{p}: {e}"))
}

/// R70-05 / R82-03: whether row `p` itself is a link, read only. A row whose kind cannot be read
/// (for a reason other than "missing") is left, never taken as "not a link".
/// F90-01: `held` is true when Git holds a file, link or submodule at exactly this row (index or
/// last commit); Git then writes the same object Kolux removes, so the spelling walk is skipped.
fn is_link(worktree: &Path, p: &str, held: bool) -> Result<bool, String> {
    let p = p.trim_end_matches('/');
    match fs::symlink_metadata(worktree.join(native(p))) {
        // R86-01: a link counts only under the spelling the disk holds; `LNK` or `lnk.` is left.
        Ok(m) if m.is_symlink() && held => Ok(true),
        Ok(m) if m.is_symlink() => on_disk_as_sent(worktree, p, &mut Default::default()).map(|_| true),
        Ok(_) => Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(unread(p, p)),
    }
}

/// F-02: what Discard says about a row it leaves because a folder now sits in its file's place.
fn now_folder(p: &str) -> String {
    format!("{} is now a folder, so Kolux leaves it. Remove or move the folder by hand, then discard again.", p.trim_end_matches('/'))
}

/// R-06 / N-01: what Discard says about a nested repository it leaves.
fn own_repo(p: &str) -> String {
    format!("{} is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.", p.trim_end_matches('/'))
}

/// Runs `git <args>` over `paths` handed on stdin, NUL-separated and literal, so no name is
/// read as a pattern.
fn with_paths(worktree: &Path, args: &[&str], paths: &[String]) -> Result<(), String> {
    let mut all = vec!["--literal-pathspecs"];
    all.extend_from_slice(args);
    all.extend_from_slice(&["--pathspec-from-file=-", "--pathspec-file-nul"]);
    let mut child = command_checked(&all, Some(worktree))?.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
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
    if paths.is_empty() {
        return Err("Nothing to discard.".into());
    }
    let paths: &[String] = &one_spelling(paths);
    not_whole(paths)?;
    check_paths(paths)?;
    let rows: Vec<&str> = paths.iter().map(|p| p.trim_end_matches('/')).collect();
    match section {
        "staged" | "changed" => {
            let k = kinds(worktree, &rows, true)?;
            // F90-01: one answer per row, for the check and the link step alike.
            let held = |r: &str| k.at.contains(r) || k.head_file.contains(r);
            // F-02: a row whose file Git would write over a folder with something in it is left as
            // it is and named; the other rows still go. R59-01/R59-02: so is a row under a link or a
            // file where a folder was; a link at the row itself is removed (only the link) first.
            let (mut said, mut rest, mut left, mut links) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let mut real = std::collections::HashSet::new();
            // R82-04: this loop only looks (a row whose kind cannot be read is left); no link is
            // removed until every check, the rename look-up included, is done.
            for p in paths {
                let row = p.trim_end_matches('/').to_string();
                let why = left_why(worktree, p, &mut real).or_else(|| k.folder(p).then(|| folder_line(p))).or_else(|| folder_in_place(worktree, p).then(|| now_folder(p)));
                match why.map_or_else(|| is_link(worktree, p, held(&row)), Err) {
                    Err(why) => {
                        said.push(why);
                        left.push(row);
                    }
                    Ok(link) => {
                        if link {
                            links.push(row);
                        }
                        rest.push(p.clone());
                    }
                }
            }
            // R59-06: a staged rename goes whole or not at all; looked up only when a row is left
            // or a link is to be removed. R70-03: a status that cannot be read leaves every row; a
            // picked partner gets its own line.
            let mut halves: Vec<(String, String)> = Vec::new();
            if section == "staged" && (!left.is_empty() || !links.is_empty()) {
                match status(worktree) {
                    Ok(st) => {
                        for c in st.staged {
                            let Some(from) = c.from else { continue };
                            halves.push((from.clone(), c.path.clone()));
                            halves.push((c.path, from));
                        }
                        for (half, other) in &halves {
                            if left.contains(other) && !left.contains(half) {
                                if rest.iter().any(|p| p.trim_end_matches('/') == half) {
                                    said.push(format!("{half} is the other half of a rename, so Kolux leaves it too."));
                                }
                                left.push(half.clone());
                            }
                        }
                        rest.retain(|p| !left.iter().any(|l| l == p.trim_end_matches('/')));
                    }
                    Err(e) => {
                        said.push(format!("Kolux could not check for renamed files, so it stopped before changing them: {e}"));
                        rest.clear();
                    }
                }
            }
            // R82-04: only now are links removed, and only for rows still going. A link that cannot
            // be removed leaves its row and, in a staged rename, its other half.
            let mut removed: Vec<String> = Vec::new();
            for p in &links {
                if left.contains(p) || !rest.iter().any(|r| r.trim_end_matches('/') == p) {
                    continue;
                }
                match remove_link(worktree, p, held(p)) {
                    Ok(_) => removed.push(p.clone()),
                    Err(e) => {
                        said.push(e);
                        left.push(p.clone());
                        for (half, _) in halves.iter().filter(|(_, other)| other == p) {
                            if !left.contains(half) && rest.iter().any(|r| r.trim_end_matches('/') == half) {
                                said.push(if removed.contains(half) {
                                    format!("{half} is the other half of a rename, so Kolux leaves it too. Its link was already removed; what it pointed to is untouched.")
                                } else {
                                    format!("{half} is the other half of a rename, so Kolux leaves it too.")
                                });
                                left.push(half.clone());
                            }
                        }
                    }
                }
            }
            rest.retain(|p| !left.iter().any(|l| l == p.trim_end_matches('/')));
            let args: &[&str] = if section == "staged" {
                &["-c", "submodule.recurse=false", "--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"]
            } else {
                &["-c", "submodule.recurse=false", "--literal-pathspecs", "restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"]
            };
            if !rest.is_empty() || said.is_empty() {
                if let Err(e) = piped(worktree, args, &rest) {
                    said.push(e);
                }
            }
            if said.is_empty() {
                Ok(())
            } else {
                Err(said.join("\n"))
            }
        }
        "untracked" => {
            // R59-01: a row under a link or a file where a folder was is left and named. R59-04: a
            // row that is itself a link is removed by Kolux (the link only): git clean keeps a link
            // to a repository without a word.
            // R82-02: a folder row with tracked files below it is left whole (R86-02: only when a
            // real folder stands there).
            let k = kinds(worktree, &rows, false)?;
            let (mut said, mut rows) = (Vec::new(), Vec::new());
            let mut real = std::collections::HashSet::new();
            let mut lists = std::collections::HashMap::new();
            for p in paths {
                if let Some(why) = left_why(worktree, p, &mut real) {
                    said.push(why);
                } else if let Err(why) = on_disk_as_sent(worktree, p, &mut lists) {
                    // R86-01: `git clean` is given a row only under the spelling the disk holds.
                    said.push(why);
                } else if k.below.contains(p.trim_end_matches('/')) && fs::symlink_metadata(worktree.join(native(p.trim_end_matches('/')))).is_ok_and(|m| m.is_dir() && !m.is_symlink()) {
                    // R86-02: only a real folder gets the folder line; a file or a link standing
                    // where a tracked folder was goes on, as the file or link it is.
                    said.push(folder_line(p));
                } else {
                    match remove_link(worktree, p, false) {
                        Ok(true) => {}
                        Ok(false) => rows.push(p),
                        Err(e) => said.push(e),
                    }
                }
            }
            // R-06: git clean -f leaves a nested repository without a word; say so, and clean the rest.
            let (nested, rest): (Vec<&String>, Vec<&String>) = rows.into_iter().partition(|p| own_repo_at(worktree, p));
            // ponytail: git clean reads no list from its input, so the names go on the command line
            // in chunks that stay well under the Windows command-line limit. R59-05: a chunk that
            // fails is named and the later chunks still go.
            for chunk in rest.chunks(100) {
                let mut args = vec!["--literal-pathspecs", "clean", "-f", "-d", "-q", "--"];
                args.extend(chunk.iter().map(|p| p.as_str()));
                if let Err(e) = run(&args, Some(worktree)) {
                    said.push(e);
                }
            }
            said.extend(nested.iter().map(|p| own_repo(p)));
            if said.is_empty() {
                return Ok(());
            }
            Err(said.join("\n"))
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
    let mut child = command_checked(&["commit", "--quiet", "-F", "-"], Some(worktree))?.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
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
    let dir = fence.allow(&worktree, &store, &git, false)?;
    // Writes .git/info/exclude and probes folders: off the async workers.
    tauri::async_runtime::spawn_blocking(move || ignore_heavy(&dir, &folders)).await.map_err(|e| e.to_string())?
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
    // Walks the folder's ancestors and runs git rev-parse, which stalls on network or WSL paths.
    tauri::async_runtime::spawn_blocking(move || watch::watch_with(Path::new(&path), sink, ended, log)).await.map_err(|e| e.to_string())?
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
/// ACCT-055: abort only in a project or worktree (fence.rs), like stage and discard (T-718).
pub async fn scm_abort(worktree: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let root = fence.allow(&worktree, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || abort(&root)).await.map_err(|e| e.to_string())?
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
#[path = "scm_tests.rs"]
mod tests;
