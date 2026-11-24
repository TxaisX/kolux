//! Txais (2026-11-23): a workspace builds its own copy of the app, several gigabytes each. Once its
//! work is in main and no pane is open in it, the build output is deleted, and the disk space comes
//! back; the next build there makes it again.
//!
//! A land sweeps the landed project's Kolux workspaces on a background thread (`after_land`). A
//! workspace keeps its build output, and nothing is deleted at all, unless it is a linked worktree
//! Kolux made, on a branch, with nothing half done, with its HEAD already in the main branch, with no
//! change of its own (ignored files do not count), and with no pane open in it.
//!
//! Only cargo's own build folders are ever deleted (`build_output`): a folder named `target` right
//! next to a `Cargo.toml`, holding cargo's `CACHEDIR.TAG`, not a link, and with nothing in it that
//! Git tracks. Everything else, another tool's output included, is left alone.
//!
//! `std::fs::remove_dir_all` deletes the links inside a build folder without following them, so a
//! link out of the workspace loses its link and nothing else. A folder that will not go (a file in
//! use) is skipped: nothing panics and nothing is retried. Round 3 P3: the moved-aside copy's
//! children are deleted first, all but `CACHEDIR.TAG`, so the tag is the last thing to go and a copy
//! the delete could not finish is still recognised by the leftover sweep (`clear_leftovers`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::git::Git;
use crate::projects;
use crate::quit_merge::{self, Clock};
use crate::state::Store;

use super::{LandOutcome, LandState};

/// How long one read waits for Git.
const LIMIT: Duration = Duration::from_secs(30);
/// The folder cargo names its build output.
const TARGET: &str = "target";
/// The tag cargo writes into every build folder it makes.
const TAG: &str = "CACHEDIR.TAG";
/// The file that says a folder holds a Rust crate.
const MANIFEST: &str = "Cargo.toml";
/// Windows marks a junction (and every other reparse point) with this attribute.
#[cfg(windows)]
const REPARSE: u32 = 0x400;

/// What a clear needs from the app, so tests can give it their own.
pub(crate) struct ClearDeps<'a> {
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    /// Whether any pane is open in the workspace whose top folder is this one.
    pub pane_open: &'a dyn Fn(&Path) -> bool,
}

/// Whether `at` is a link of any kind (a symlink, a junction, another reparse point). A folder that
/// cannot be read counts as one: nothing is deleted through an unknown.
fn is_link(at: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(at) else { return true };
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & REPARSE != 0 {
            return true;
        }
    }
    false
}

/// What Git tracks under `folder` (run in the workspace), or why that could not be read. Nothing
/// when Git fails: a folder whose contents are unknown is never deleted.
fn tracked(top: &Path, folder: &Path) -> Result<String, String> {
    let rel = folder.strip_prefix(top).map_err(|_| "it is not inside the workspace".to_string())?;
    // Git reads a backslash in a pathspec as an escape, so a Windows path is given to it with slashes.
    let rel = rel.to_string_lossy().replace('\\', "/");
    crate::git::run_within(&["ls-files", "--", &rel], Some(top), LIMIT)
}

/// The folders a build output can sit in: `top` itself and each direct child folder of it (so a
/// Rust crate at the top and one in `src-tauri`, never deeper and never in `.git`).
fn crates(top: &Path) -> Vec<PathBuf> {
    let mut crates = vec![top.to_path_buf()];
    if let Ok(entries) = std::fs::read_dir(top) {
        for entry in entries.flatten() {
            if entry.file_name() == ".git" {
                continue;
            }
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                crates.push(entry.path());
            }
        }
    }
    crates
}

/// The build output of the workspace at `top`, read only: the folders a clear would delete.
///
/// A folder counts only when all hold: it is named `target` and sits in `top` itself or in a direct
/// child folder of it (so a Rust crate at the top and one in `src-tauri`, never deeper and never in
/// `.git`); neither it nor the child folder it sits in is a link; a `Cargo.toml` sits next to it; it
/// holds `CACHEDIR.TAG`; and Git tracks nothing under it.
pub(crate) fn build_output(top: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for (i, dir) in crates(top).iter().enumerate() {
        if i > 0 && is_link(dir) {
            continue;
        }
        let target = dir.join(TARGET);
        if is_link(&target) || !target.is_dir() {
            continue;
        }
        if !dir.join(MANIFEST).is_file() || !target.join(TAG).is_file() {
            continue;
        }
        if tracked(top, &target).is_ok_and(|files| files.trim().is_empty()) {
            found.push(target);
        }
    }
    found
}

/// P3-b: a clear that was cut short leaves its half-deleted copy (`target.deleting-1`) in the
/// workspace, where it shows as untracked and makes every later clear refuse with HAS_CHANGES. A
/// `target.deleting-N` beside a build folder is never anything but that copy, and only one holding
/// cargo's `CACHEDIR.TAG` is Kolux's own. Best effort: one that will not go is logged and left.
fn clear_leftovers(top: &Path) {
    let prefix = format!("{TARGET}.deleting-");
    for (i, dir) in crates(top).iter().enumerate() {
        if i > 0 && is_link(dir) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().starts_with(&prefix) {
                continue;
            }
            let at = entry.path();
            if is_link(&at) || !at.is_dir() || !at.join(TAG).is_file() {
                continue;
            }
            if let Err(e) = std::fs::remove_dir_all(&at) {
                eprintln!("kolux: {} could not be deleted, so it is left for the next clear ({e})", at.display());
            }
        }
    }
}

/// Deletes the build output of the workspace at `folder` (`folder` may be a folder inside it), or
/// says why nothing was deleted. Nothing is deleted unless every check holds: it is in Git, it is a
/// linked worktree (never a main folder), Kolux made it, it is on a branch, nothing is half done in
/// it, its HEAD is already in the main branch, it holds no change of its own, and no pane is open in
/// it. Ignored files, the build output included, do not count as a change.
pub(crate) fn clear_workspace(deps: &ClearDeps, folder: &Path) -> Result<Vec<PathBuf>, String> {
    let top = deps.git.toplevel(folder).map_err(|_| super::NO_GIT.to_string())?;
    let repo = quit_merge::repo_of(&top).ok_or(super::MAIN_FOLDER)?;
    let all = deps.git.worktrees(&repo).map_err(|e| format!("Kolux could not list the project's workspaces ({})", quit_merge::short(&e)))?;
    let w = all.into_iter().find(|w| projects::same_folder(Path::new(&w.path), &top)).ok_or(super::NOT_LISTED)?;
    if w.is_main {
        return Err(super::MAIN_FOLDER.into());
    }
    let ours = deps.store.lock().map(|s| projects::load_origins(&s).contains_key(&projects::name_key(&w.path))).unwrap_or(false);
    if !ours {
        return Err(super::NOT_OURS.into());
    }
    w.branch.clone().ok_or(quit_merge::DETACHED)?;
    let clock = Clock::until(Instant::now() + LIMIT);
    quit_merge::unfinished(&top, &clock)?;
    let project = super::project_of(deps.git, deps.store, &repo);
    let target = quit_merge::target_branch(&repo, &project, &clock).ok_or(quit_merge::NO_MAIN)?;
    if !deps.git.merged_into(&top, &format!("refs/heads/{target}")) {
        return Err(format!("its work is not in {target}"));
    }
    // P3-b: a half-deleted copy an earlier clear left behind would count as a change below and make
    // this clear refuse for good, so it goes first (only a `target.deleting-N` holding cargo's tag).
    clear_leftovers(&top);
    let status = quit_merge::read(&["status", "--porcelain", "--untracked-files=all"], &top, &clock)?;
    if !status.trim().is_empty() {
        return Err(super::HAS_CHANGES.into());
    }
    if (deps.pane_open)(&top) {
        return Err("a pane is open in it".into());
    }
    let mut removed = Vec::new();
    for at in build_output(&top) {
        // A folder a file in use keeps from going is left for the next land; nothing here is fatal.
        if move_aside_and_remove(&at, |from, to| std::fs::rename(from, to)) {
            removed.push(at);
        }
    }
    Ok(removed)
}

/// Round 3 P3: deletes every child of a moved-aside build copy but cargo's `CACHEDIR.TAG`, best
/// effort, and says whether the tag is now all that is left. `remove_dir_all` deletes top-level
/// files first on Windows, so a delete cut short by a file still open would take the tag with it and
/// leave a `target.deleting-N` that `clear_leftovers` no longer recognises as Kolux's own. With this
/// pass first the tag is the last thing to go, so a copy that keeps it is swept by the next clear.
fn clear_children_except_tag(at: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(at) else { return false };
    for entry in entries.flatten() {
        if entry.file_name() == TAG {
            continue;
        }
        let path = entry.path();
        // A link goes as the link; what it names is never followed. `remove_dir` takes a junction
        // or a directory symlink (a plain `remove_file` cannot on Windows), `remove_file` a file one.
        let _ = if is_link(&path) {
            std::fs::remove_dir(&path).or_else(|_| std::fs::remove_file(&path))
        } else if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
    }
    std::fs::read_dir(at).is_ok_and(|left| left.flatten().all(|e| e.file_name() == TAG))
}

/// Takes a build folder out of its name first, then deletes the copy: a folder with a file still
/// open cannot be renamed on Windows, so the folder is skipped whole instead of being half deleted
/// and left as a broken `target`. The copy is a sibling (`target.deleting-1`), so the delete never
/// crosses a drive, and the first free name is used so a copy an earlier clear could not delete is
/// not written over. `rename` is a parameter only so a test can make it fail.
///
/// Round 3 P3: the copy's children go first, all but `CACHEDIR.TAG`, so the tag is the last thing to
/// go, and a copy the delete could not finish keeps it for `clear_leftovers`. True when the copy is
/// gone whole.
fn move_aside_and_remove(at: &Path, rename: impl Fn(&Path, &Path) -> std::io::Result<()>) -> bool {
    let Some(parent) = at.parent() else { return false };
    let name = at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let aside = (1..=999).map(|n| parent.join(format!("{name}.deleting-{n}"))).find(|to| !to.exists());
    let Some(aside) = aside else { return false };
    if let Err(e) = rename(at, &aside) {
        eprintln!("kolux: {} could not be moved aside, so it was left alone ({e})", at.display());
        return false;
    }
    if !clear_children_except_tag(&aside) {
        return false;
    }
    let _ = std::fs::remove_dir_all(&aside);
    !aside.exists()
}

/// What a land should clear: after "Landed" or "Nothing new", every Kolux-made linked worktree of
/// the project the landed workspace is in, each with what `clear_workspace` made of it; nothing
/// after any other outcome. The whole sweep, not only the land's own siblings, is asked, so a
/// workspace whose pane was open at its own land and has closed since is cleared here too.
pub(crate) fn after_land(deps: &ClearDeps, out: &LandOutcome) -> Vec<(String, Result<Vec<PathBuf>, String>)> {
    if !matches!(out.state, LandState::Landed | LandState::NothingNew) {
        return Vec::new();
    }
    let Some(repo) = quit_merge::repo_of(Path::new(&out.path)) else { return Vec::new() };
    let Ok(all) = deps.git.worktrees(&repo) else { return Vec::new() };
    let origins = match deps.store.lock() {
        Ok(store) => projects::load_origins(&store),
        Err(_) => return Vec::new(),
    };
    projects::kolux_made(&origins, all)
        .into_iter()
        .filter(|w| !w.is_main)
        .map(|w| {
            let removed = clear_workspace(deps, Path::new(&w.path));
            (w.path, removed)
        })
        .collect()
}

#[cfg(test)]
#[path = "land_clear_board_tests.rs"]
mod board_tests;

#[cfg(test)]
mod tests {
    use super::{clear_children_except_tag, clear_leftovers, move_aside_and_remove};
    use std::fs;
    use std::io;
    use std::path::Path;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-land-clear-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // F4: a file still open in a build folder cannot be deleted on Windows, and deleting what could
    // be deleted first left a `target` that had lost part of its content, so the next build ran on a
    // half-cleared folder. The folder is moved aside whole first: a failed rename leaves it exactly
    // as it was, and only the copy (a free `target.deleting-N`, never one an earlier clear left
    // behind) is deleted.
    #[test]
    fn f4_a_build_folder_a_file_keeps_is_left_whole() {
        let base = temp("f4-aside");
        let target = base.join("target");
        fs::create_dir_all(target.join("debug")).unwrap();
        fs::write(target.join("debug").join("app.exe"), "in use").unwrap();
        let busy = |_: &Path, _: &Path| Err(io::Error::new(io::ErrorKind::PermissionDenied, "file in use"));
        assert!(!move_aside_and_remove(&target, busy), "a folder that cannot be moved aside is not deleted");
        assert_eq!(fs::read_to_string(target.join("debug").join("app.exe")).unwrap(), "in use", "the folder is whole");
        assert_eq!(fs::read_dir(&base).unwrap().count(), 1, "nothing was left beside it");
        // A copy an earlier clear could not delete keeps its name; the copy made now takes the next
        // free one and is the only one deleted.
        fs::create_dir_all(base.join("target.deleting-1")).unwrap();
        fs::write(base.join("target.deleting-1").join("old"), "kept").unwrap();
        assert!(move_aside_and_remove(&target, |from, to| fs::rename(from, to)));
        assert!(!target.exists(), "the build folder is gone");
        assert_eq!(fs::read_to_string(base.join("target.deleting-1").join("old")).unwrap(), "kept", "the earlier copy is not written over");
        assert!(!base.join("target.deleting-2").exists(), "the copy made now is deleted");
        let _ = fs::remove_dir_all(&base);
    }

    // P3-b: a clear cut short by a file in use leaves its copy as `target.deleting-N`, which shows
    // as untracked and makes every later clear refuse with HAS_CHANGES. Only a copy that holds
    // cargo's own tag is Kolux's; anything else with that name is left alone.
    #[test]
    fn p3_b_a_half_deleted_build_copy_holding_the_cache_tag_is_removed() {
        let base = temp("p3-b-leftovers");
        let tag = "Signature: 8a477f597d28d172789f06886806bc55\n";
        let leftover = base.join("target.deleting-1");
        fs::create_dir_all(leftover.join("debug")).unwrap();
        fs::write(leftover.join("CACHEDIR.TAG"), tag).unwrap();
        let stranger = base.join("target.deleting-2");
        fs::create_dir_all(stranger.join("debug")).unwrap();
        fs::write(stranger.join("debug").join("keep"), "not a build copy").unwrap();
        let in_crate = base.join("src-tauri").join("target.deleting-3");
        fs::create_dir_all(in_crate.join("debug")).unwrap();
        fs::write(in_crate.join("CACHEDIR.TAG"), tag).unwrap();
        clear_leftovers(&base);
        assert!(!leftover.exists(), "a copy holding the tag is removed");
        assert!(!in_crate.exists(), "a crate in a child folder is swept too");
        assert_eq!(fs::read_to_string(stranger.join("debug").join("keep")).unwrap(), "not a build copy", "one without the tag is left alone");
        let _ = fs::remove_dir_all(&base);
    }

    // Round 3 P3: the tag is the last child to go, so a delete cut short by a file in use leaves a
    // copy `clear_leftovers` can still recognise. The pass is its own function so stopping after it
    // can be checked on its own.
    #[test]
    fn p3_the_child_pass_leaves_the_cache_tag_for_last() {
        let base = temp("p3-tag-last");
        let copy = base.join("target.deleting-1");
        fs::create_dir_all(copy.join("debug").join("deps")).unwrap();
        fs::create_dir_all(copy.join("build")).unwrap();
        let tag = "Signature: 8a477f597d28d172789f06886806bc55\n";
        fs::write(copy.join("CACHEDIR.TAG"), tag).unwrap();
        fs::write(copy.join("debug").join("app.exe"), "in use").unwrap();
        fs::write(copy.join("build").join("out"), "x").unwrap();
        assert!(clear_children_except_tag(&copy), "nothing but the tag is left");
        assert!(copy.join("CACHEDIR.TAG").is_file(), "the tag is still there for the leftover sweep");
        assert_eq!(fs::read_dir(&copy).unwrap().count(), 1, "only the tag is left");
        assert!(!copy.join("debug").exists() && !copy.join("build").exists(), "the folders are gone");
        let _ = fs::remove_dir_all(&base);
    }

    // Round 3 P3: with its children gone first, the moved-aside copy goes whole, tag included, and
    // nothing of it is left beside the workspace.
    #[test]
    fn p3_a_moved_aside_copy_is_deleted_whole() {
        let base = temp("p3-deleted-whole");
        let target = base.join("target");
        fs::create_dir_all(target.join("debug")).unwrap();
        fs::write(target.join("CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55\n").unwrap();
        fs::write(target.join("debug").join("app.exe"), "built").unwrap();
        assert!(move_aside_and_remove(&target, |from, to| fs::rename(from, to)), "the copy is deleted whole");
        assert!(!target.exists(), "the build folder is gone");
        assert_eq!(fs::read_dir(&base).unwrap().count(), 0, "nothing remains, the tag included");
        let _ = fs::remove_dir_all(&base);
    }
}
