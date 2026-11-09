//! DT-C230 (BROW-002, BROW-021): a tab's page that has been hidden for `SUSPEND_AFTER` is suspended
//! (ICoreWebView2_3::TrySuspend). Every web view runs with the background-timer exemption Kolux needs
//! for its own page (recovery.rs UNTHROTTLED), so a hidden tab otherwise keeps full-speed timers and
//! script for ever. Suspending stops them and gives memory back while the page keeps its state: typed
//! form text, scroll, history (BROW-002 still holds, nothing reloads). The page is resumed before it
//! is shown again and before an agent's call reaches it (`drive`), and it is never suspended while it
//! is under agent control, has a download running or plays audio (BROW-021's exemptions). The engine
//! itself refuses while the view is visible or DevTools is open.
//!
//! `Hides` is the pure part: each hide takes a generation, a show or close ends it, and a timer from
//! an older hide does nothing.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Webview};

/// How long a tab stays hidden before its page is suspended.
pub const SUSPEND_AFTER: Duration = Duration::from_secs(60);

/// Which hides are still current: tab id to the generation of its latest hide.
#[derive(Debug, Default)]
pub struct Hides {
    current: HashMap<u32, u64>,
    next: u64,
}

impl Hides {
    /// The tab went away; the generation its suspend timer must present.
    pub fn hide(&mut self, id: u32) -> u64 {
        self.next += 1;
        self.current.insert(id, self.next);
        self.next
    }

    /// The tab is back (or closed): any timer still running for it is stale.
    pub fn end(&mut self, id: u32) {
        self.current.remove(&id);
    }

    /// Is this the timer of the tab's latest, still current hide?
    pub fn due(&self, id: u32, generation: u64) -> bool {
        self.current.get(&id) == Some(&generation)
    }
}

/// BROW-021's exemptions, applied when the timer fires: still hidden, not under agent control, no
/// download running. (Audio is checked on the engine itself, where the flag lives.)
pub fn may_suspend(still_hidden: bool, driven: bool, downloading: bool) -> bool {
    still_hidden && !driven && !downloading
}

static HIDES: LazyLock<Mutex<Hides>> = LazyLock::new(Mutex::default);

/// `browser_bounds` hid the tab: after `SUSPEND_AFTER`, if the tab is still away and nothing spares
/// it, its page is suspended.
pub fn hidden(app: AppHandle, id: u32) {
    let Ok(generation) = HIDES.lock().map(|mut h| h.hide(id)) else { return };
    std::thread::spawn(move || {
        std::thread::sleep(SUSPEND_AFTER);
        if !HIDES.lock().is_ok_and(|h| h.due(id, generation)) {
            return;
        }
        if !may_suspend(!super::is_shown(id), super::session::driven(id), super::downloads::downloading(id)) {
            return;
        }
        if let Ok(v) = super::view(&app, id) {
            super::engine::try_suspend(&v);
        }
    });
}

/// `browser_bounds` shows the tab: its timer is stale and its page is resumed first.
pub fn shown(v: &Webview, id: u32) {
    if let Ok(mut h) = HIDES.lock() {
        h.end(id);
    }
    super::engine::resume(v);
}

/// An agent's call is about to reach the tab: a suspended page is resumed first (the hide stays
/// current, so the page is suspended again later if the agent leaves it alone; `drove` spares it
/// for DRIVEN_FOR meanwhile).
pub fn driven(app: &AppHandle, id: u32) {
    if let Ok(v) = super::view(app, id) {
        super::engine::resume(&v);
    }
}

/// The tab closed.
pub fn forget(id: u32) {
    if let Ok(mut h) = HIDES.lock() {
        h.end(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_perf_webview_a_hide_is_due_until_the_tab_is_shown_or_hidden_again() {
        let mut h = Hides::default();
        let g1 = h.hide(7);
        assert!(h.due(7, g1));
        assert!(!h.due(8, g1), "another tab");
        let g2 = h.hide(7);
        assert!(!h.due(7, g1), "the older hide's timer is stale");
        assert!(h.due(7, g2));
        h.end(7);
        assert!(!h.due(7, g2), "shown: nothing is due");
        let g3 = h.hide(7);
        h.hide(9);
        h.end(9);
        assert!(h.due(7, g3) && !h.due(9, g3 + 1));
    }

    #[test]
    fn t_perf_webview_brow021_exemptions_keep_a_page_awake() {
        assert!(may_suspend(true, false, false));
        assert!(!may_suspend(false, false, false), "shown again meanwhile");
        assert!(!may_suspend(true, true, false), "under agent control");
        assert!(!may_suspend(true, false, true), "downloading");
    }
}
