//! T-199: updates that fail are explained and can be fixed.
//!
//! - APP-028: every install attempt is written down before the installer starts (from, to, when,
//!   the notes). The next launch compares it with the running version: still on `from` means the
//!   install did not take (a notice with Try again and Download installer); on `to` means it worked
//!   (a one-time "updated" note with the notes). Records older than seven days are ignored, and a
//!   launch on any third version (a pinned or locally built copy) is a deliberate move, never a
//!   failure. The record is read once and removed, so each note shows on one launch only. Which
//!   program held the files is not known here, so the notice uses general wording.
//! - APP-029: Restart to update runs once (a second click while it is getting ready is ignored); a
//!   watchdog forces the old process out at its deadline so it never blocks the installer, arming it
//!   again never moves the deadline later, and an install that fails straight away stands it down
//!   and keeps the app open with the underlying cause in plain words (paths and secrets removed).
//!   The clean-up before quitting is the save point's own short deadline (T-182, APP-011).
//! - APP-031: a missing update manifest is "no update"; a manifest without this platform, or a
//!   release whose installer is not uploaded yet, is said nothing about on a background check and
//!   explained calmly on a requested one, and checked again on a short cycle; a network protocol
//!   error offers a compatibility mode (HTTP/1.1 only), which an environment variable can force on
//!   or off over the saved setting; late answers from an earlier check never overwrite the current
//!   check's result.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The store key of the last install attempt.
pub const KEY_ATTEMPT: &str = "update.lastAttempt";
/// The store key of the saved compatibility-mode choice ("1" on).
pub const KEY_COMPAT: &str = "update.compatMode";
/// Forces the compatibility mode on ("1", "on", "true") or off ("0", "off", "false").
pub const ENV_COMPAT: &str = "KOLUX_RS_UPDATE_COMPAT";
/// Attempt records older than this are ignored (APP-028).
pub const ATTEMPT_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// The old process is forced out this long after the installer is started (APP-029).
pub const WATCHDOG_AFTER: Duration = Duration::from_secs(20);
/// Markers the page reads on a check's error (APP-031).
pub const MARK_QUIET: &str = "update:quiet|";
pub const MARK_COMPAT: &str = "update:compat|";
pub const MARK_STALE: &str = "update:stale";
/// Where a user can always get the newest installer by hand.
pub const RELEASES_PAGE: &str = "https://github.com/TxaisX/kolux/releases/latest";

// ---------------------------------------------------------------- APP-028: install attempts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub from: String,
    pub to: String,
    pub at: u64,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LastAttempt {
    /// The install did not take: the app still runs `from`.
    #[serde(rename_all = "camelCase")]
    Failed { from: String, to: String, holder: Option<String>, releases_page: String },
    /// The install worked: shown once, with the notes.
    #[serde(rename_all = "camelCase")]
    Updated { version: String, notes: Vec<String> },
}

pub fn attempt_json(from: &str, to: &str, at: u64, notes: &[String]) -> String {
    serde_json::to_string(&Attempt { from: from.into(), to: to.into(), at, notes: notes.to_vec() }).unwrap_or_default()
}

/// What the next launch says about the last install attempt, if anything.
pub fn outcome(raw: Option<&str>, running: &str, now: u64) -> Option<LastAttempt> {
    let a: Attempt = serde_json::from_str(raw?).ok()?;
    if now.saturating_sub(a.at) > ATTEMPT_MAX_AGE_MS || a.from == a.to {
        return None;
    }
    if running == a.to {
        Some(LastAttempt::Updated { version: a.to, notes: a.notes })
    } else if running == a.from {
        // The program that held the files is not identified on this build: general wording.
        Some(LastAttempt::Failed { from: a.from, to: a.to, holder: None, releases_page: RELEASES_PAGE.into() })
    } else {
        // A pinned or locally built version: a deliberate move, never reported.
        None
    }
}

// ---------------------------------------------------------------- APP-029: restart to update

/// The deadline that forces the old process out. Arming again keeps the earlier deadline.
#[derive(Default)]
pub struct Watchdog {
    deadline: Mutex<Option<Instant>>,
    /// Bumped on every stand-down, so a watch thread from an earlier arming ends quietly.
    round: AtomicU64,
}

impl Watchdog {
    /// Arms for `at`, or keeps an earlier deadline already set. Returns the deadline in force.
    pub fn arm(&self, at: Instant) -> Instant {
        let mut d = self.deadline.lock().unwrap_or_else(|e| e.into_inner());
        let next = match *d {
            Some(cur) if cur <= at => cur,
            _ => at,
        };
        *d = Some(next);
        next
    }

    pub fn stand_down(&self) {
        *self.deadline.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.round.fetch_add(1, Ordering::SeqCst);
    }

    pub fn deadline(&self) -> Option<Instant> {
        *self.deadline.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Watches on its own thread; `on_due` runs once when the deadline passes while still armed.
    pub fn watch(self: &Arc<Self>, on_due: impl FnOnce() + Send + 'static) {
        let me = Arc::clone(self);
        let round = me.round.load(Ordering::SeqCst);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(50));
            if me.round.load(Ordering::SeqCst) != round {
                return;
            }
            match me.deadline() {
                None => return,
                Some(d) if Instant::now() >= d => {
                    on_due();
                    return;
                }
                Some(_) => {}
            }
        });
    }
}

/// Removes file paths from an error text: any word holding a drive or share path, or a long
/// forward-slash path, becomes "<path>".
pub fn scrub_paths(text: &str) -> String {
    text.split(' ')
        .map(|w| {
            let t = w.trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')' || c == ',' || c == ':');
            let drive = t.len() > 2 && t.as_bytes()[1] == b':' && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/') && t.as_bytes()[0].is_ascii_alphabetic();
            let share = t.starts_with("\\\\");
            let unix = t.starts_with('/') && t.matches('/').count() >= 2;
            if drive || share || unix {
                "<path>".to_string()
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The underlying reason an installer could not start, in plain words, with paths and secrets out.
pub fn install_cause(raw: &str) -> String {
    let l = raw.to_lowercase();
    let has = |s: &str| l.contains(s);
    let why = if has("os error 1223") || has("canceled by the user") || has("cancelled by the user") {
        "Windows asked for permission to run the installer and the request was refused, so Kolux stayed open. Press Restart to update again and allow the prompt.".to_string()
    } else if has("os error 740") || has("requires elevation") {
        "The installer needs administrator permission, which this account could not give. Ask an administrator, or download the installer and run it yourself.".to_string()
    } else if has("os error 5)") || has("access is denied") || has("permission denied") {
        "Windows refused permission to start the installer (access denied). Check that you can write to the Kolux RS folder and your temporary folder, then try again.".to_string()
    } else if has("os error 32") || has("being used by another process") {
        "A file the installer needs is in use by another program. Close other copies of Kolux and programs using its files, then try again.".to_string()
    } else if has("os error 112") || has("not enough space") || has("disk full") {
        "There is not enough free disk space to install the update. Free some space, then try again.".to_string()
    } else {
        format!("The installer could not start: {}", raw.trim())
    };
    crate::protected::mask(&scrub_paths(&why))
}

// ---------------------------------------------------------------- APP-031: download problems

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Problem {
    /// No manifest at the feed: there is no update, not an error.
    NoManifest,
    /// The manifest has no entry for this platform yet.
    NoPlatform,
    /// The manifest names an installer that is not uploaded yet.
    Incomplete,
    /// A network protocol error that the compatibility mode usually gets past.
    Protocol,
    Other,
}

/// Sorts an updater error (its display and debug text together) into what the card does with it.
pub fn classify(text: &str) -> Problem {
    let l = text.to_lowercase();
    let has = |s: &str| l.contains(s);
    if has("could not fetch a valid release json") || has("releasenotfound") {
        Problem::NoManifest
    } else if has("was not found in the response `platforms`") || has("none of the fallback platforms") || has("targetnotfound") || has("targetsnotfound") {
        Problem::NoPlatform
    } else if has("download request failed with status: 404") || has("installer is not uploaded yet") {
        Problem::Incomplete
    } else if has("http2") || has("protocol error") || has("protocol_error") || has("goaway") || has("frame with invalid size") || has("incomplete message") || has("unexpected eof") {
        Problem::Protocol
    } else {
        Problem::Other
    }
}

/// The compatibility mode in force: the variable, when set to a known word, wins over the setting.
pub fn compat_mode(saved: bool, env: Option<&str>) -> bool {
    match env.map(|v| v.trim().to_lowercase()) {
        Some(v) if ["1", "on", "true", "yes"].contains(&v.as_str()) => true,
        Some(v) if ["0", "off", "false", "no"].contains(&v.as_str()) => false,
        _ => saved,
    }
}

/// Numbers the checks; only the newest may store its answer.
#[derive(Default)]
pub struct CheckRounds(AtomicU64);

impl CheckRounds {
    pub fn begin(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn is_current(&self, round: u64) -> bool {
        self.0.load(Ordering::SeqCst) == round
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60 * 1000;

    #[test]
    fn the_next_launch_reports_a_failed_or_a_finished_install_once() {
        let raw = attempt_json("0.2.0", "0.3.0", 10 * DAY, &["Faster tabs".into()]);
        match outcome(Some(&raw), "0.2.0", 10 * DAY + 60_000) {
            Some(LastAttempt::Failed { from, to, holder, releases_page }) => {
                assert_eq!((from.as_str(), to.as_str()), ("0.2.0", "0.3.0"));
                assert_eq!(holder, None, "the holding program is not identified, so the wording is general");
                assert!(releases_page.starts_with("https://github.com/"));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(outcome(Some(&raw), "0.3.0", 10 * DAY + 1), Some(LastAttempt::Updated { version: "0.3.0".into(), notes: vec!["Faster tabs".into()] }));
    }

    #[test]
    fn old_records_and_deliberate_moves_are_never_reported() {
        let raw = attempt_json("0.2.0", "0.3.0", DAY, &[]);
        assert_eq!(outcome(Some(&raw), "0.2.0", DAY + 7 * DAY + 1), None, "older than seven days");
        assert!(outcome(Some(&raw), "0.2.0", DAY + 7 * DAY).is_some(), "exactly seven days still counts");
        assert_eq!(outcome(Some(&raw), "0.2.5-local", DAY + 1), None, "a pinned or local build");
        assert_eq!(outcome(Some(&attempt_json("0.2.0", "0.2.0", DAY, &[])), "0.2.0", DAY), None);
        assert_eq!(outcome(Some("not json"), "0.2.0", DAY), None);
        assert_eq!(outcome(None, "0.2.0", DAY), None);
        // A clock that went backwards does not drop the record.
        assert!(outcome(Some(&raw), "0.3.0", 0).is_some());
    }

    #[test]
    fn the_outcome_reaches_the_page_in_camel_case() {
        let v = serde_json::to_value(LastAttempt::Failed { from: "1".into(), to: "2".into(), holder: None, releases_page: "p".into() }).unwrap();
        assert_eq!(v["kind"], "failed");
        assert_eq!(v["releasesPage"], "p");
        let v = serde_json::to_value(LastAttempt::Updated { version: "2".into(), notes: vec![] }).unwrap();
        assert_eq!(v["kind"], "updated");
    }

    #[test]
    fn arming_again_never_moves_the_deadline_later() {
        let w = Watchdog::default();
        let t0 = Instant::now();
        assert_eq!(w.arm(t0 + Duration::from_secs(20)), t0 + Duration::from_secs(20));
        assert_eq!(w.arm(t0 + Duration::from_secs(60)), t0 + Duration::from_secs(20), "later arming keeps the earlier deadline");
        assert_eq!(w.arm(t0 + Duration::from_secs(5)), t0 + Duration::from_secs(5), "an earlier deadline wins");
        w.stand_down();
        assert_eq!(w.deadline(), None);
    }

    #[test]
    fn the_watchdog_fires_at_its_deadline_unless_stood_down() {
        let fired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let w = Arc::new(Watchdog::default());
        w.arm(Instant::now() + Duration::from_millis(100));
        let f = Arc::clone(&fired);
        w.watch(move || f.store(true, Ordering::SeqCst));
        let start = Instant::now();
        while !fired.load(Ordering::SeqCst) && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(fired.load(Ordering::SeqCst), "the deadline forces the process out");

        // An install that fails straight away stands it down: nothing fires.
        let quiet = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let w = Arc::new(Watchdog::default());
        w.arm(Instant::now() + Duration::from_millis(150));
        let q = Arc::clone(&quiet);
        w.watch(move || q.store(true, Ordering::SeqCst));
        w.stand_down();
        std::thread::sleep(Duration::from_millis(400));
        assert!(!quiet.load(Ordering::SeqCst));
    }

    #[test]
    fn install_causes_are_plain_and_carry_no_paths() {
        assert!(install_cause("The operation was canceled by the user. (os error 1223)").contains("permission"));
        assert!(install_cause("The requested operation requires elevation. (os error 740)").contains("administrator"));
        assert!(install_cause("Access is denied. (os error 5)").contains("access denied"));
        assert!(install_cause("The process cannot access the file because it is being used by another process. (os error 32)").contains("in use"));
        assert!(install_cause("There is not enough space on the disk. (os error 112)").contains("disk space"));
        let other = install_cause(r"failed to write C:\Users\someone\AppData\Local\Temp\kolux-setup.exe: odd failure");
        assert!(other.starts_with("The installer could not start:"), "{other}");
        assert!(!other.contains("someone") && other.contains("<path>"), "{other}");
        let share = install_cause(r"cannot open \\server\share\setup.exe now");
        assert!(!share.contains("server") && share.contains("<path>"), "{share}");
        assert_eq!(scrub_paths("open /home/user/x.exe failed"), "open <path> failed");
        assert_eq!(scrub_paths("a 1:2 ratio / is fine"), "a 1:2 ratio / is fine");
    }

    #[test]
    fn download_problems_are_sorted() {
        assert_eq!(classify("Could not fetch a valid release JSON from the remote"), Problem::NoManifest);
        assert_eq!(classify("the platform `windows-x86_64` was not found in the response `platforms` object"), Problem::NoPlatform);
        assert_eq!(classify("None of the fallback platforms `[\"windows-x86_64-nsis\"]` were found in the response `platforms` object"), Problem::NoPlatform);
        assert_eq!(classify("`Download request failed with status: 404 Not Found`"), Problem::Incomplete);
        assert_eq!(classify("error sending request | hyper::Error(Http2, Error { kind: GoAway(.., PROTOCOL_ERROR) })"), Problem::Protocol);
        assert_eq!(classify("connection error: unexpected EOF"), Problem::Protocol);
        assert_eq!(classify("dns error: no such host"), Problem::Other);
    }

    #[test]
    fn the_variable_overrides_the_saved_compatibility_choice() {
        assert!(!compat_mode(false, None));
        assert!(compat_mode(true, None));
        assert!(compat_mode(false, Some("1")) && compat_mode(false, Some(" ON ")));
        assert!(!compat_mode(true, Some("0")) && !compat_mode(true, Some("off")));
        assert!(compat_mode(true, Some("maybe")), "an unknown word leaves the setting");
    }

    #[test]
    fn only_the_newest_check_may_store_its_answer() {
        let r = CheckRounds::default();
        let first = r.begin();
        let second = r.begin();
        assert!(!r.is_current(first) && r.is_current(second));
    }
}
