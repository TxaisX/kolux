//! Workspaces that sit unopened too long are swept away, and nothing else removes one by itself.
//!
//! Txais (2026-11-20): "keep the worktrees open unless we purposefully close them". A quit merges a
//! workspace into main and leaves its folder standing (`quit_merge`); the one automatic removal left
//! is idleness. A workspace nobody has opened for `workspaceKeepDays` days is removed, measured from
//! the last time the sidebar opened it (`projects::note_opened`), never from when it was made, so a
//! workspace visited weekly never expires.
//!
//! The sweep never forces and never loses work. `quit_merge::prepare_retire` refuses a folder that
//! holds the user's own local files and commits everything else first; the branch is always kept, so
//! the workspace can be opened again from it. A workspace with a lock, an unfinished merge, a
//! running terminal or a folder that is already gone is left, with its reason in the diagnostics log.
//!
//! A workspace Kolux has no "opened" record for (one made before this was kept) has its clock started
//! on the first pass, so nothing is ever deleted on the day the sweep first runs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::git::Git;
use crate::projects;
use crate::quit_merge;
use crate::state::Store;
use crate::terminal::Terminals;

/// The setting that says how many days a workspace may sit unopened; 0 turns the sweep off.
pub const KEEP_DAYS_SETTING: &str = "workspaceKeepDays";

/// The days when the setting says nothing: two weeks.
pub const KEEP_DAYS: u64 = 14;

/// How long the first pass waits after launch, so the window and the sidebar are up first.
pub const FIRST: Duration = Duration::from_secs(180);

/// How often the sweep looks again. Cheap: one `git worktree list` per project, and no writes at all
/// unless something is due.
pub const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The days a workspace may sit unopened. A setting that is not a whole number of days falls back to
/// the default; 0 is a real answer and turns the sweep off.
pub fn keep_days(settings: &serde_json::Value) -> u64 {
    settings[KEEP_DAYS_SETTING].as_u64().unwrap_or(KEEP_DAYS)
}

/// Whether a workspace last opened at `last` (seconds since the Unix epoch) has sat longer than
/// `days` by `now`. A workspace Kolux never saw opened (`None`) never expires: the sweep removes only
/// what it can prove is idle, so a workspace from before this was kept is never guessed at.
pub fn due(now: u64, last: Option<u64>, days: u64) -> bool {
    match (days, last) {
        (0, _) | (_, None) => false,
        (days, Some(last)) => now.saturating_sub(last) >= days.saturating_mul(24 * 60 * 60),
    }
}

/// What one pass did, for the diagnostics log and the tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Swept {
    pub removed: Vec<String>,
    /// The workspaces left in place, each with the reason it was not its turn.
    pub left: Vec<(String, String)>,
}

impl Swept {
    /// The one line the diagnostics log gets, or None when there was nothing to say.
    pub fn line(&self) -> Option<String> {
        if self.removed.is_empty() && self.left.is_empty() {
            return None;
        }
        let left: Vec<String> = self.left.iter().map(|(path, why)| format!("{path} ({why})")).collect();
        Some(format!("retire: {} removed, {} left{}{}", self.removed.len(), self.left.len(), if left.is_empty() { "" } else { ": " }, left.join("; ")))
    }
}

/// One sweep over every listed project. Only workspaces Kolux made are ever considered: one the user
/// brought in from elsewhere is theirs.
pub fn pass(git: &Git, store: &Mutex<Store>, terminals: &Terminals, data_dir: &Path, now: u64) -> Swept {
    let (listed, origins, days) = match store.lock() {
        Ok(s) => (projects::load_projects(&s), projects::load_origins(&s), keep_days(&s.settings())),
        Err(_) => return Swept::default(),
    };
    if days == 0 {
        return Swept::default();
    }
    let busy: Vec<String> = terminals.list().into_iter().filter_map(|(_, _, dir)| dir).collect();
    let mut swept = Swept::default();
    for project in &listed {
        let Ok(all) = git.worktrees(Path::new(&project.path)) else { continue };
        let main: Option<PathBuf> = all.iter().find(|w| w.is_main).map(|w| PathBuf::from(&w.path));
        for w in projects::kolux_made(&origins, all) {
            // A folder that is already gone is `forget_gone`'s job (APP-051), not the sweep's.
            if w.is_main || !Path::new(&w.path).is_dir() {
                continue;
            }
            // A workspace something is still running in is not idle, whatever its timestamp says.
            if busy.iter().any(|d| projects::same_folder(Path::new(d), Path::new(&w.path))) {
                continue;
            }
            let last = match store.lock() {
                Ok(s) => projects::opened_at(&s, &w.path),
                Err(_) => None,
            };
            let Some(last) = last else {
                // A workspace from before this was kept has no history. Its clock starts now, so
                // nothing is deleted on the day the sweep first runs; from here it expires like any
                // other if it is never opened.
                if let Ok(s) = store.lock() {
                    let _ = projects::note_opened(&s, &w.path);
                }
                continue;
            };
            if !due(now, Some(last), days) {
                continue;
            }
            match retire_one(git, store, terminals, data_dir, project, &w.path, main.as_deref()) {
                Ok(()) => swept.removed.push(w.path.clone()),
                Err(why) => swept.left.push((w.path.clone(), why)),
            }
        }
    }
    swept
}

/// One idle workspace: its work saved, then the folder removed the same way the sidebar removes one.
fn retire_one(git: &Git, store: &Mutex<Store>, terminals: &Terminals, data_dir: &Path, project: &projects::Project, path: &str, main: Option<&Path>) -> Result<(), String> {
    quit_merge::prepare_retire(git, store, terminals, data_dir, Path::new(path), main)?;
    let check = projects::remove_check(git, project, path)?;
    // The stamp just read is the one asked for: this is not a user confirming a delete, so there is
    // nothing that could have changed under them.
    if let Some(why) = projects::removal_refused(&check, false, &check.stamp) {
        return Err(why);
    }
    // The branch always stays: its commits are the one thing a swept workspace leaves behind that can
    // bring it back, and the sidebar can delete it once the user is sure.
    projects::remove_with(git, store, terminals, project, path, false, &check.stamp, Some(true), false)?;
    Ok(())
}

/// The sweep in the background: once a little after launch, then every `EVERY`. It never blocks a
/// window and never fails the app; what it did goes to the diagnostics log.
pub fn start(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        std::thread::sleep(FIRST);
        loop {
            let git = app.state::<Git>();
            let store = app.state::<Mutex<Store>>();
            let terminals = app.state::<Terminals>();
            let Ok(data_dir) = app.path().app_data_dir() else { return };
            let swept = pass(&git, &store, &terminals, &data_dir, projects::now_secs());
            if let Some(line) = swept.line() {
                crate::diag::write(&data_dir, &line);
            }
            std::thread::sleep(EVERY);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60;

    #[test]
    fn a_workspace_opened_within_the_days_is_kept() {
        let now = 100 * DAY;
        assert!(!due(now, Some(now - 13 * DAY), 14));
        assert!(!due(now, Some(now), 14));
    }

    #[test]
    fn a_workspace_idle_for_the_days_is_due() {
        let now = 100 * DAY;
        assert!(due(now, Some(now - 14 * DAY), 14));
        assert!(due(now, Some(now - 40 * DAY), 14));
    }

    #[test]
    fn a_workspace_never_seen_opened_never_expires() {
        assert!(!due(100 * DAY, None, 14));
    }

    #[test]
    fn zero_days_turns_the_sweep_off() {
        assert!(!due(100 * DAY, Some(0), 0));
    }

    #[test]
    fn a_future_timestamp_never_expires() {
        // A clock that went backwards (a machine restored from a backup) must not make everything due.
        assert!(!due(100 * DAY, Some(200 * DAY), 14));
    }

    #[test]
    fn the_setting_says_the_days_and_a_silent_one_says_two_weeks() {
        assert_eq!(keep_days(&serde_json::json!({})), KEEP_DAYS);
        assert_eq!(keep_days(&serde_json::json!({ KEEP_DAYS_SETTING: 30 })), 30);
        assert_eq!(keep_days(&serde_json::json!({ KEEP_DAYS_SETTING: 0 })), 0);
        // Not a whole number of days: the default, never a delete nobody asked for.
        assert_eq!(keep_days(&serde_json::json!({ KEEP_DAYS_SETTING: -3 })), KEEP_DAYS);
        assert_eq!(keep_days(&serde_json::json!({ KEEP_DAYS_SETTING: "soon" })), KEEP_DAYS);
    }

    #[test]
    fn nothing_to_say_is_no_line() {
        assert_eq!(Swept::default().line(), None);
    }
}
