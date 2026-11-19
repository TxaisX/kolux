#![allow(dead_code)] // wired in the chat-app screens stage
//! Finishing a chat: the work its folder holds is saved, sent where it belongs, merged when the user
//! asked for that, and the chat's working folder is put away. The result is a list of plain
//! announcements for the chat to show, never a log.
//!
//! The order is fixed: commit (through the automatic flow's secret check), push, pull request and its
//! checks (or a local merge when there is no remote), catch the project's own main folder up, keep the
//! files git ignores, and only then remove the working folder. The folder goes only after the work is
//! on its branch or merged, and a user's own edits in the main folder are never touched.

use crate::auto_pr;
use crate::git::{self, Git};
use crate::quit_merge::{self, Clock, MergeEnv};
use crate::github::pull_requests;
use crate::scm;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A file bigger than this is not copied out of a removed folder (it is named in the announcement instead).
const KEEP_LIMIT: u64 = 25 * 1024 * 1024;
/// How long a local merge may take in all.
const MERGE_TIME: Duration = Duration::from_secs(120);
/// What a pull request opened here says it is.
const PR_BODY: &str = "Opened by Kolux after an agent turn.";

/// One thing the chat tells the user about how it ended.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Announcement {
    /// The work is saved on its branch; nothing more was asked of it.
    Saved,
    /// The branch is on GitHub (no pull request could be opened or looked up).
    SentToGitHub,
    /// A pull request is open and waiting.
    PrOpened { url: String },
    /// The pull request's checks failed; it is left open.
    ChecksFailed { url: String },
    /// The pull request was merged on GitHub.
    Merged,
    /// Saved on this computer only (there is no remote and the merge into main did not happen).
    SavedLocal,
    /// Merged into the project's main folder on this computer (there is no remote).
    MergedLocal,
    /// A file git ignores (a `.env`, say) was copied out before its folder went.
    KeptFile { path: String },
    /// Something stopped; the reason is a plain sentence. The work that could be saved was.
    Blocked { reason: String },
}

/// The programs a finish needs besides the folders; `gh` is None when it is not installed.
pub(crate) struct Tools<'a> {
    pub git: &'a Git,
    pub data_dir: &'a Path,
    pub gh: Option<&'a Path>,
}

/// Ends a chat whose work lives in `worktree_dir` on `branch` (see the module note).
pub fn chat_finish(git: &Git, data_dir: &Path, project_dir: &Path, worktree_dir: &Path, branch: &str, auto_merge: bool, kept_files_dir: &Path) -> Vec<Announcement> {
    let gh = scm::gh_program().ok();
    chat_finish_with(&Tools { git, data_dir, gh: gh.as_deref() }, project_dir, worktree_dir, branch, auto_merge, kept_files_dir)
}

/// `chat_finish` with the programs handed in, so a test can stand a gh in.
pub(crate) fn chat_finish_with(tools: &Tools, project_dir: &Path, worktree_dir: &Path, branch: &str, auto_merge: bool, kept_files_dir: &Path) -> Vec<Announcement> {
    let wt = worktree_dir;
    if let Some(blocker) = find_blocker(wt) {
        return finish_blocked(project_dir, wt, branch, kept_files_dir, blocker);
    }
    // a. Save what the chat changed, through the same secret-checked commit the automatic flow makes.
    let committed = match auto_pr::commit_step(wt) {
        Ok(s) => s,
        Err(e) => return vec![Announcement::Blocked { reason: format!("The chat's work could not be saved: {e}") }],
    };
    if !matches!(committed.kind.as_str(), "done" | "clean") {
        // Nothing was saved, so the folder stays: it still holds the only copy.
        let why = if committed.files.is_empty() { committed.message.clone() } else { format!("{} Files: {}.", committed.message, committed.files.join(", ")) };
        return vec![Announcement::Blocked { reason: why }];
    }
    let kind = auto_pr::remote_kind(wt);
    let has_remote = kind != "none";
    let target = target_branch(project_dir, has_remote);
    let ahead = target.as_deref().map(|t| ahead_of(wt, branch, t, has_remote)).unwrap_or(1);
    // An unchanged chat leaves nothing behind: no commit, no branch.
    if committed.kind == "clean" && ahead == 0 {
        let mut out = wrap_up(project_dir, wt, branch, kept_files_dir, false);
        if !out.iter().any(|a| matches!(a, Announcement::Blocked { .. })) {
            let _ = git::run(&["branch", "-D", branch], Some(project_dir)); // nothing on it that is not already on the target
        }
        out.retain(|a| !matches!(a, Announcement::Saved));
        return out;
    }
    let Some(target) = target else {
        let mut out = vec![Announcement::SavedLocal, Announcement::Blocked { reason: "The project has no main branch to bring the work into, so it stays on its own branch.".into() }];
        out.extend(wrap_up(project_dir, wt, branch, kept_files_dir, false));
        return out;
    };
    let mut out = Vec::new();
    let mut delete_branch = false;
    if has_remote {
        remote_path(tools, project_dir, wt, branch, &target, kind, auto_merge, &mut out, &mut delete_branch);
    } else {
        local_path(tools, project_dir, branch, &target, &mut out, &mut delete_branch);
    }
    out.extend(wrap_up(project_dir, wt, branch, kept_files_dir, delete_branch));
    out
}

// ---------------------------------------------------------------------------------------------
// With a remote.
// ---------------------------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn remote_path(tools: &Tools, project_dir: &Path, wt: &Path, branch: &str, target: &str, kind: &str, auto_merge: bool, out: &mut Vec<Announcement>, delete_branch: &mut bool) {
    let pushed = match auto_pr::push_step(wt) {
        Ok(s) => s,
        Err(e) => {
            out.push(Announcement::Blocked { reason: format!("Saved on its branch ({branch}), but not sent to GitHub: {e}") });
            return;
        }
    };
    match pushed.kind.as_str() {
        "done" | "clean" => {}
        "skipped" => {
            out.push(Announcement::Saved);
            return;
        }
        _ => {
            out.push(Announcement::Blocked { reason: format!("Saved on its branch ({branch}), but not sent to GitHub: {}", pushed.message) });
            return;
        }
    }
    let Some(gh) = tools.gh.filter(|_| kind == "github") else {
        out.push(if kind == "github" { Announcement::SentToGitHub } else { Announcement::Saved });
        return;
    };
    let open = match scm::pr_find(gh, wt, branch) {
        Ok(found) => found.filter(|p| p.state.eq_ignore_ascii_case("OPEN")),
        Err(_) => {
            out.push(Announcement::SentToGitHub);
            return;
        }
    };
    let pr = match open {
        Some(p) => p,
        None => {
            let title = git::run(&["log", "-1", "--format=%s"], Some(wt)).ok().filter(|t| !t.is_empty()).unwrap_or_else(|| branch.to_string());
            match scm::pr_create(gh, wt, &title, PR_BODY, target, false, false) {
                Ok(p) => p,
                Err(e) => {
                    out.push(Announcement::Blocked { reason: format!("Sent to GitHub, but the pull request could not be opened: {e}") });
                    return;
                }
            }
        }
    };
    let url = pr.url.clone();
    let checks = match scm::pr_checks(gh, wt, branch) {
        Ok(c) => c,
        Err(_) => {
            out.push(Announcement::PrOpened { url });
            return;
        }
    };
    let red = checks.conflict || checks.checks.iter().any(|c| matches!(c.outcome.as_str(), "failed" | "cancelled"));
    let pending = checks.checks.iter().any(|c| matches!(c.outcome.as_str(), "running" | "unresolved"));
    if red {
        out.push(Announcement::ChecksFailed { url });
        return;
    }
    if !auto_merge {
        out.push(Announcement::PrOpened { url });
        return;
    }
    if pending {
        match scm::gh_run(gh, wt, &["pr", "merge", &url, "--auto", "--merge"], None) {
            Ok(_) => out.push(Announcement::PrOpened { url }),
            Err(e) => out.push(Announcement::Blocked { reason: format!("The pull request is open ({url}), but it could not be set to merge once its checks pass: {}", first_line(&e)) }),
        }
        return;
    }
    // Green: merge it now, on the very commit that was checked.
    let merged = scm::pr_parts(&url)
        .ok_or_else(|| "its address is not one Kolux can read".to_string())
        .and_then(|(host, owner, name, number)| {
            let sha = git::run(&["rev-parse", "HEAD"], Some(wt))?;
            pull_requests::merge(gh, &host, &format!("{owner}/{name}"), number, "merge", true, &sha)
        });
    match merged {
        Ok(_) => {
            out.push(Announcement::Merged);
            if let Some(why) = catch_up(tools, project_dir, target) {
                out.push(Announcement::Blocked { reason: format!("Merged on GitHub. The project's {target} folder was not brought up to date: {why}") });
            }
            *delete_branch = true;
        }
        Err(e) => out.push(Announcement::Blocked { reason: format!("The pull request is open ({url}), but it was not merged: {}", first_line(&e)) }),
    }
}

/// Brings the local target branch up to what GitHub now has. None when done; Some(why) when it was left alone.
fn catch_up(tools: &Tools, project_dir: &Path, target: &str) -> Option<String> {
    let holder = tools.git.worktrees(project_dir).ok()?.into_iter().find(|w| w.branch.as_deref() == Some(target));
    match holder {
        None => git::run(&["fetch", "origin", &format!("{target}:{target}")], Some(project_dir)).err().map(|e| first_line(&e)),
        Some(w) => {
            let dir = PathBuf::from(&w.path);
            let dirty = git::run(&["status", "--porcelain", "--untracked-files=no"], Some(&dir)).map(|s| !s.trim().is_empty()).unwrap_or(true);
            if dirty {
                return Some("it has changes of your own that are not committed, so it was left as it is".into());
            }
            if git::run(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], Some(&dir)).is_ok() {
                return Some("a merge is unfinished there, so it was left as it is".into());
            }
            git::run(&["fetch", "origin"], Some(&dir)).and_then(|_| git::run(&["merge", "--ff-only", &format!("origin/{target}")], Some(&dir))).err().map(|e| first_line(&e))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Without a remote.
// ---------------------------------------------------------------------------------------------

fn local_path(tools: &Tools, project_dir: &Path, branch: &str, target: &str, out: &mut Vec<Announcement>, delete_branch: &mut bool) {
    let saved_only = |out: &mut Vec<Announcement>, why: String| {
        out.push(Announcement::SavedLocal);
        out.push(Announcement::Blocked { reason: format!("The work is saved on its own branch ({branch}) but was not merged into {target}: {why}") });
    };
    let holder = match tools.git.worktrees(project_dir) {
        Ok(list) => list.into_iter().find(|w| w.branch.as_deref() == Some(target)),
        Err(e) => return saved_only(out, first_line(&e)),
    };
    let clock = Clock::until(Instant::now() + MERGE_TIME);
    match holder {
        Some(w) => match quit_merge::main_ready(Some(&w), Some(target), &clock) {
            Ok(main_dir) => {
                let hooks = match quit_merge::no_hooks(tools.data_dir) {
                    Ok(h) => h,
                    Err(e) => return saved_only(out, first_line(&e)),
                };
                let env = MergeEnv { git: tools.git, clock, data_dir: tools.data_dir, hooks: &hooks };
                match quit_merge::merge_branch(&env, project_dir, &main_dir, target, branch) {
                    Ok(()) => {
                        out.push(Announcement::MergedLocal);
                        *delete_branch = true;
                    }
                    Err(e) => saved_only(out, first_line(&e)),
                }
            }
            Err(why) => saved_only(out, why),
        },
        None => {
            // main is checked out nowhere: it can only move forward onto the branch.
            let forward = git::run(&["merge-base", "--is-ancestor", &format!("refs/heads/{target}"), &format!("refs/heads/{branch}")], Some(project_dir)).is_ok();
            let moved = forward
                && match (git::run(&["rev-parse", &format!("refs/heads/{branch}")], Some(project_dir)), git::run(&["rev-parse", &format!("refs/heads/{target}")], Some(project_dir))) {
                    (Ok(new), Ok(old)) => git::run(&["update-ref", &format!("refs/heads/{target}"), &new, &old], Some(project_dir)).is_ok(),
                    _ => false,
                };
            if moved {
                out.push(Announcement::MergedLocal);
                *delete_branch = true;
            } else {
                saved_only(out, format!("{target} has moved on and is not open anywhere to merge into"));
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Blockers: a half-done operation, a repository inside the folder.
// ---------------------------------------------------------------------------------------------

struct Blocker {
    reason: String,
    /// The command that undoes the half-done operation, when there is one.
    abort: Option<&'static [&'static str]>,
    /// Folders inside the worktree that are repositories of their own.
    nested: Vec<String>,
}

fn find_blocker(wt: &Path) -> Option<Blocker> {
    let state = |name: &str| git::run(&["rev-parse", "--git-path", name], Some(wt)).ok().map(|p| wt.join(p.trim())).is_some_and(|p| p.exists());
    let (reason, abort): (&str, Option<&'static [&'static str]>) = if state("rebase-merge") || state("rebase-apply") {
        ("A rebase was half done in the chat's folder; it was cancelled.", Some(&["rebase", "--abort"]))
    } else if state("MERGE_HEAD") {
        ("A merge was half done in the chat's folder; it was cancelled.", Some(&["merge", "--abort"]))
    } else if state("CHERRY_PICK_HEAD") {
        ("A cherry-pick was half done in the chat's folder; it was cancelled.", Some(&["cherry-pick", "--abort"]))
    } else if state("REVERT_HEAD") {
        ("A revert was half done in the chat's folder; it was cancelled.", Some(&["revert", "--abort"]))
    } else {
        ("", None)
    };
    let nested: Vec<String> = status_entries(wt, false)
        .into_iter()
        .filter(|(x, rel)| *x == '?' && rel.ends_with('/') && wt.join(rel.trim_end_matches('/')).join(".git").exists())
        .map(|(_, rel)| rel.trim_end_matches('/').to_string())
        .collect();
    if !reason.is_empty() {
        return Some(Blocker { reason: reason.into(), abort, nested });
    }
    if !nested.is_empty() {
        return Some(Blocker { reason: format!("The chat's folder holds another repository ({}), which cannot be saved as part of this one; it was copied out whole.", nested.join(", ")), abort: None, nested });
    }
    let unmerged = git::run(&["ls-files", "-u"], Some(wt)).map(|s| !s.trim().is_empty()).unwrap_or(false);
    unmerged.then(|| Blocker { reason: "The chat's folder has files with unresolved conflicts.".into(), abort: None, nested })
}

/// Cancels the half-done operation, saves what can be saved, and still puts the folder away.
fn finish_blocked(project_dir: &Path, wt: &Path, branch: &str, kept: &Path, b: Blocker) -> Vec<Announcement> {
    let mut out = vec![Announcement::Blocked { reason: b.reason.clone() }];
    if let Some(cmd) = b.abort {
        let _ = git::run(cmd, Some(wt));
    }
    let mut saved_in_git = false;
    if b.nested.is_empty() {
        saved_in_git = auto_pr::commit_step(wt).map(|s| matches!(s.kind.as_str(), "done" | "clean")).unwrap_or(false);
    }
    // What could not go into git goes out as plain files: changed files, and any repository inside.
    if !saved_in_git {
        for (x, rel) in status_entries(wt, false) {
            if x == '!' || rel.ends_with('/') {
                continue;
            }
            if let Some(a) = keep_file(wt, &rel, kept) {
                out.push(a);
            }
        }
        for dir in &b.nested {
            if let Some(a) = keep_folder(wt, dir, kept) {
                out.push(a);
            }
        }
    }
    out.extend(wrap_up(project_dir, wt, branch, kept, false).into_iter().filter(|a| !matches!(a, Announcement::Saved)));
    out
}

// ---------------------------------------------------------------------------------------------
// Keeping files and removing the folder.
// ---------------------------------------------------------------------------------------------

/// Copies the ignored files out, removes the working folder, and (when asked) deletes the branch.
/// A removal that fails is reported; the work is on the branch either way.
fn wrap_up(project_dir: &Path, wt: &Path, branch: &str, kept: &Path, delete_branch: bool) -> Vec<Announcement> {
    let mut out = Vec::new();
    for (x, rel) in status_entries(wt, true) {
        if x != '!' || rel.ends_with('/') {
            continue; // directories (node_modules, target, .venv) are never copied
        }
        if let Some(a) = keep_file(wt, &rel, kept) {
            out.push(a);
        }
    }
    let target = wt.to_string_lossy().to_string();
    if let Err(e) = git::run(&["worktree", "remove", "--force", &target], Some(project_dir)) {
        out.push(Announcement::Blocked { reason: format!("The chat's folder could not be removed: {}", first_line(&e)) });
        return out;
    }
    if delete_branch {
        let _ = git::run(&["branch", "-d", branch], Some(project_dir));
    }
    out
}

/// One file, copied to `kept/<its path>`; None when it cannot or should not be copied.
fn keep_file(wt: &Path, rel: &str, kept: &Path) -> Option<Announcement> {
    let from = wt.join(rel);
    let safe = Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)));
    let meta = std::fs::metadata(&from).ok().filter(|m| m.is_file())?;
    if !safe || meta.len() > KEEP_LIMIT {
        return None;
    }
    let to = kept.join(rel);
    std::fs::create_dir_all(to.parent()?).ok()?;
    std::fs::copy(&from, &to).ok()?;
    Some(Announcement::KeptFile { path: to.to_string_lossy().to_string() })
}

/// A whole folder (a repository inside the worktree), copied file by file; the `.git` inside is copied too.
fn keep_folder(wt: &Path, rel: &str, kept: &Path) -> Option<Announcement> {
    fn walk(from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            let t = e.file_type()?;
            if t.is_dir() {
                walk(&e.path(), &to.join(e.file_name()))?;
            } else if t.is_file() {
                std::fs::copy(e.path(), to.join(e.file_name()))?;
            }
        }
        Ok(())
    }
    let to = kept.join(rel);
    walk(&wt.join(rel), &to).ok()?;
    Some(Announcement::KeptFile { path: to.to_string_lossy().to_string() })
}

/// `git status --porcelain -z`: each entry as (the first status letter, the path). With `ignored`
/// the ignored entries come back as ('!', path); untracked ones as ('?', path).
fn status_entries(wt: &Path, ignored: bool) -> Vec<(char, String)> {
    let mut args = vec!["status", "--porcelain", "-z", "--untracked-files=normal"];
    if ignored {
        args.push("--ignored");
    }
    let Ok(text) = git::run_untrimmed(&args, Some(wt)) else { return Vec::new() };
    let mut parts = text.split('\0');
    let mut out = Vec::new();
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let mut chars = entry.chars();
        let (x, y) = (chars.next().unwrap_or(' '), chars.next().unwrap_or(' '));
        let path = entry.get(3..).unwrap_or("").to_string();
        if x == 'R' || x == 'C' {
            parts.next(); // the old name of a rename
        }
        if y == 'D' && x == ' ' {
            continue; // deleted: nothing to keep
        }
        out.push((x, path));
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Small reads.
// ---------------------------------------------------------------------------------------------

/// The branch work is brought into: origin's HEAD, else `main`, else `master`. With a remote it
/// counts when origin has it; without one, when it exists here.
fn target_branch(repo: &Path, has_remote: bool) -> Option<String> {
    let exists = |r: String| git::run(&["rev-parse", "-q", "--verify", &r], Some(repo)).is_ok();
    let origin_head = git::run(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], Some(repo)).ok().map(|b| b.trim().trim_start_matches("origin/").to_string()).filter(|b| !b.is_empty());
    origin_head.into_iter().chain(["main", "master"].map(String::from)).find(|b| {
        if has_remote {
            exists(format!("refs/remotes/origin/{b}")) || exists(format!("refs/heads/{b}"))
        } else {
            exists(format!("refs/heads/{b}"))
        }
    })
}

/// How many commits `branch` has that the base does not (origin's copy of the target when there is a remote).
fn ahead_of(wt: &Path, branch: &str, target: &str, has_remote: bool) -> u64 {
    let remote = format!("refs/remotes/origin/{target}");
    let base = if has_remote && git::run(&["rev-parse", "-q", "--verify", &remote], Some(wt)).is_ok() { remote } else { format!("refs/heads/{target}") };
    git::run(&["rev-list", "--count", &format!("{base}..refs/heads/{branch}")], Some(wt)).ok().and_then(|n| n.trim().parse().ok()).unwrap_or(1)
}

fn first_line(e: &str) -> String {
    let line = e.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("no reason was given");
    line.chars().take(240).collect()
}

#[cfg(test)]
#[path = "chat_finish_tests.rs"]
mod tests;
