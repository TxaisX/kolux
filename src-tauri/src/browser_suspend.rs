//! DT-C237 (BROW-002, BROW-021): a tab's page that has been hidden for `SUSPEND_AFTER` is suspended
//! (ICoreWebView2_3::TrySuspend). Every web view runs with the background-timer exemption Kolux needs
//! for its own page (recovery.rs UNTHROTTLED), so a hidden tab otherwise keeps full-speed timers and
//! script for ever. Suspending stops them and gives memory back while the page keeps its state: typed
//! form text, scroll, history (BROW-002 still holds, nothing reloads). The page is resumed before it
//! is shown again and before an agent's call reaches it (`drive`), and it is never suspended while it
//! is under agent control, has a download running or plays audio (BROW-021's exemptions). The engine
//! itself refuses while the view is visible or DevTools is open.
//!
//! A page served from this machine (localhost, 127.0.0.1, ::1) is never suspended either: a dev
//! server's live-reload socket would drop while the page sleeps, and the page would reload when it
//! woke, losing exactly the state BROW-002 keeps.
//!
//! `Hides` is the pure part: a tab's first hide takes a generation and starts its one timer thread,
//! the repeated hidden `browser_bounds` calls of a resize or a theme change add nothing, a show or
//! close ends the hide, and a timer from an older hide does nothing. While an exemption spares the
//! page, the timer checks again every `SUSPEND_AFTER` for as long as the hide is current.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Webview};

/// How long a tab stays hidden before its page is suspended (and how often a spared page is checked again).
pub const SUSPEND_AFTER: Duration = Duration::from_secs(60);

/// Which hides are still current: tab id to the generation of its latest hide.
#[derive(Debug, Default)]
pub struct Hides {
    current: HashMap<u32, u64>,
    next: u64,
}

impl Hides {
    /// The tab went away: the generation its suspend timer must present, or None when the tab is
    /// already hidden (its timer is running; a repeated hide starts no second one).
    pub fn hide(&mut self, id: u32) -> Option<u64> {
        if self.current.contains_key(&id) {
            return None;
        }
        self.next += 1;
        self.current.insert(id, self.next);
        Some(self.next)
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
/// download running, not a page served from this machine. (Audio is checked on the engine itself,
/// where the flag lives.)
pub fn may_suspend(still_hidden: bool, driven: bool, downloading: bool, local: bool) -> bool {
    still_hidden && !driven && !downloading && !local
}

/// Is this page served from this machine? `localhost` and its subdomains, any 127.x.x.x address,
/// and ::1 (as the URL crate prints it, in brackets).
pub fn loopback(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    bare.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

static HIDES: LazyLock<Mutex<Hides>> = LazyLock::new(Mutex::default);

/// `browser_bounds` hid the tab: after `SUSPEND_AFTER`, if the tab is still away and nothing spares
/// it, its page is suspended. A tab already hidden keeps the timer it has (one thread per tab).
pub fn hidden(app: AppHandle, id: u32) {
    let Some(generation) = HIDES.lock().ok().and_then(|mut h| h.hide(id)) else { return };
    std::thread::spawn(move || loop {
        std::thread::sleep(SUSPEND_AFTER);
        if !HIDES.lock().is_ok_and(|h| h.due(id, generation)) {
            return;
        }
        let Ok(v) = super::view(&app, id) else { return };
        let local = v.url().ok().is_some_and(|u| loopback(u.host_str()));
        if may_suspend(!super::is_shown(id), super::session::driven(id), super::downloads::downloading(id), local) {
            super::engine::try_suspend(&v);
            return;
        }
        // Spared this time (agent, download, local page): checked again after another SUSPEND_AFTER,
        // for as long as this hide is current.
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
        let g1 = h.hide(7).expect("first hide");
        assert!(h.due(7, g1));
        assert!(!h.due(8, g1), "another tab");
        h.end(7);
        assert!(!h.due(7, g1), "shown: nothing is due");
        let g2 = h.hide(7).expect("hidden again");
        assert!(!h.due(7, g1), "the older hide's timer is stale");
        assert!(h.due(7, g2));
        h.hide(9);
        h.end(9);
        assert!(h.due(7, g2) && !h.due(9, g2 + 1));
    }

    #[test]
    fn t_perf_webview_a_repeated_hide_keeps_the_timer_it_has() {
        // A resize or a theme change calls browser_bounds for every hidden tab again: no new thread,
        // no new generation, the first timer stays due.
        let mut h = Hides::default();
        let g = h.hide(3).expect("first hide");
        for _ in 0..5 {
            assert_eq!(h.hide(3), None, "already hidden: nothing to start");
        }
        assert!(h.due(3, g), "the first timer is still the current one");
        assert_eq!(h.hide(4), Some(g + 1), "another tab takes the next generation, not g + 6");
    }

    #[test]
    fn t_perf_webview_brow021_exemptions_keep_a_page_awake() {
        assert!(may_suspend(true, false, false, false));
        assert!(!may_suspend(false, false, false, false), "shown again meanwhile");
        assert!(!may_suspend(true, true, false, false), "under agent control");
        assert!(!may_suspend(true, false, true, false), "downloading");
        assert!(!may_suspend(true, false, false, true), "served from this machine");
    }

    #[test]
    fn t_perf_webview_a_page_from_this_machine_is_never_suspended() {
        for local in ["localhost", "LocalHost", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1", "localhost."] {
            assert!(loopback(Some(local)), "{local} is this machine");
        }
        for remote in ["example.com", "localhost.example.com", "10.0.0.5", "192.168.1.20", "[::2]", "[fe80::1]", ""] {
            assert!(!loopback(Some(remote)), "{remote} is not this machine");
        }
        assert!(!loopback(None), "no host (about:blank)");
    }
}
