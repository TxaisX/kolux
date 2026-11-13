//! USAGE-007: Claude carries on by itself once a usage limit resets (opt-in). A Claude pane that
//! stops on a limit with a known reset time waits here; a minute after the reset, if the switch
//! is still on and Claude is still the pane's program, Kolux types a short continue prompt.

use crate::hooks::Limit;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Settings field: the switch on the Claude card, on only when `true`.
pub const FIELD: &str = "claudeResumeAfterLimit";
/// Store key: the waits that survive a restart (JSON `Waiting` list).
pub const KEY: &str = "claudeResumeWaiting";
/// What Kolux types, with the Enter that sends it.
pub const PROMPT: &str = "The usage limit has reset. Please continue where you left off.\r";
/// How long after the reset the prompt goes in.
pub const DELAY_MS: i64 = 60_000;
/// How long past the due time an unreachable pane is waited for.
pub const GIVE_UP_MS: i64 = 30 * 60_000;
/// How long a restored wait settles after a restart before it may fire.
pub const SETTLE_MS: i64 = 120_000;
/// Reset times this close together count as one.
pub const SAME_RESET_MS: i64 = 60_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Waiting {
    pub pane_key: u32,
    /// The reset time, ms since 1970.
    pub resets_at: i64,
    /// Not before this time, ms since 1970 (a restored wait settles first).
    #[serde(default)]
    pub not_before: i64,
    /// Fields a newer version saved, carried through untouched.
    #[serde(flatten)]
    pub rest: serde_json::Map<String, serde_json::Value>,
}

/// What runs in a pane's foreground when the prompt is due.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Foreground {
    Claude,
    /// A shell or another agent: the wait expires.
    Other,
    /// Cannot be told (no program known for the pane): keep waiting.
    Unknown,
    /// The pane's terminal is gone.
    Gone,
}

#[derive(Default)]
pub struct Resumes {
    waiting: Vec<Waiting>,
    /// The reset time each pane last fired for, so one reset fires once.
    fired: HashMap<u32, i64>,
}

/// The reset time a stopped pane waits for: the stop event's own, else the account's used-up
/// weekly window, else its used-up 5-hour window. Past or not used-up windows are ignored; a
/// used-up weekly window without a reset time is never swapped for the 5-hour one.
pub fn pick_reset(event: Option<i64>, limits: &[Limit], now: i64) -> Option<i64> {
    if event.is_some() {
        return event;
    }
    let used_up = |kind: &str| limits.iter().find(|l| l.kind == kind && l.used_percent >= 100.0);
    match used_up("seven_day") {
        Some(Limit { resets_at: None, .. }) => None,
        Some(Limit { resets_at: Some(at), .. }) if *at > now => Some(*at),
        _ => used_up("five_hour").and_then(|l| l.resets_at).filter(|at| *at > now),
    }
}

impl Resumes {
    /// Puts `pane_key` down to resume at `resets_at`; false when that reset already fired.
    pub fn schedule(&mut self, pane_key: u32, resets_at: i64) -> bool {
        if self.fired.get(&pane_key).is_some_and(|at| (at - resets_at).abs() <= SAME_RESET_MS) {
            return false;
        }
        self.cancel(pane_key);
        self.waiting.push(Waiting { pane_key, resets_at, not_before: 0, rest: Default::default() });
        true
    }

    pub fn cancel(&mut self, pane_key: u32) {
        self.waiting.retain(|w| w.pane_key != pane_key);
    }

    pub fn clear(&mut self) {
        self.waiting.clear();
    }

    pub fn waiting(&self) -> &[Waiting] {
        &self.waiting
    }

    /// Takes over the waits of the previous run: those whose reset went by are dropped, the rest
    /// settle first.
    pub fn restore(&mut self, list: Vec<Waiting>, now: i64) {
        for w in list.into_iter().filter(|w| w.resets_at > now) {
            self.cancel(w.pane_key);
            self.waiting.push(Waiting { not_before: now + SETTLE_MS, ..w });
        }
    }

    /// The panes to type into now. A due pane fires when Claude is in front, expires when the
    /// program is gone or another, and keeps waiting while unknown, up to the give-up time.
    pub fn check(&mut self, now: i64, foreground: impl Fn(u32) -> Foreground) -> Vec<u32> {
        let mut fire = Vec::new();
        let fired = &mut self.fired;
        self.waiting.retain(|w| {
            let due = w.resets_at + DELAY_MS;
            if now <= due || now < w.not_before {
                return true;
            }
            match foreground(w.pane_key) {
                Foreground::Claude => {
                    fired.insert(w.pane_key, w.resets_at);
                    fire.push(w.pane_key);
                    false
                }
                Foreground::Unknown => now <= due + GIVE_UP_MS,
                Foreground::Other | Foreground::Gone => false,
            }
        });
        fire
    }
}

/// The waits of the running Kolux, managed by the app.
pub type Registry = std::sync::Mutex<Resumes>;

fn with<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut Resumes) -> T) -> Option<T> {
    use tauri::Manager;
    let reg = app.try_state::<Registry>()?;
    let mut r = reg.lock().ok()?;
    let out = f(&mut r);
    if let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() {
        if let Ok(store) = store.lock() {
            if let Err(e) = save_waits(&store, &r) {
                eprintln!("kolux: resume waits not saved: {e}");
            }
        }
    }
    Some(out)
}

fn save_waits(store: &crate::state::Store, r: &Resumes) -> rusqlite::Result<()> {
    store.set(KEY, &serde_json::to_string(r.waiting()).unwrap_or_default())
}

/// The switch, read again right before anything is typed.
pub fn on(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<std::sync::Mutex<crate::state::Store>>()
        .and_then(|s| s.lock().ok().map(|s| s.settings()))
        .is_some_and(|s| s.get(FIELD) == Some(&serde_json::Value::Bool(true)))
}

/// A pane reported a stop: a limit with a reset time waits, anything else is left alone.
pub fn on_stop(app: &tauri::AppHandle, pane_key: u32, stop: Option<&crate::status::Stop>) {
    use tauri::Manager;
    let Some(stop) = stop.filter(|s| s.cause == "limit") else { return };
    let limits: Vec<Limit> = app
        .try_state::<std::sync::Mutex<crate::state::Store>>()
        .and_then(|s| s.lock().ok().and_then(|s| s.get(crate::hooks::LIMITS_KEY).ok().flatten()))
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if let Some(at) = pick_reset(stop.resets_at.map(|t| t as i64), &limits, crate::claude_key::now_ms()) {
        with(app, |r| r.schedule(pane_key, at));
    }
}

/// The user typed into `terminal` after the stop: that pane's wait is cancelled.
pub fn user_typed(app: &tauri::AppHandle, terminal: u32) {
    for pane_key in crate::status::panes_of(terminal) {
        with(app, |r| r.cancel(pane_key));
    }
}

/// The switch was saved: off discards every wait, on picks up the panes already stopped on a limit.
pub fn switched(app: &tauri::AppHandle, on: bool) {
    if !on {
        with(app, Resumes::clear);
        return;
    }
    for (pane_key, stop) in crate::status::limit_stops() {
        on_stop(app, pane_key, Some(&stop));
    }
}

/// The saved waits; an unreadable list is not saved over (row 881).
fn held_waits(store: &crate::state::Store) -> Vec<Waiting> {
    crate::orchestration::kept::or_default_held(store, KEY)
}

/// Loads the previous run's waits.
pub fn restore_from(app: &tauri::AppHandle, store: &crate::state::Store) {
    let list = held_waits(store);
    if !list.is_empty() {
        with(app, |r| r.restore(list, crate::claude_key::now_ms()));
    }
}

/// One timer tick: types the prompt into every due pane while the switch is on. A refusal by the
/// terminal is noted in the log once and never retried.
pub fn tick(app: &tauri::AppHandle, log_dir: &std::path::Path) {
    use tauri::Manager;
    let waiting = with(app, |r| !r.waiting().is_empty()).unwrap_or(false);
    if !waiting {
        return;
    }
    if !on(app) {
        with(app, Resumes::clear);
        return;
    }
    let terminals = app.state::<crate::terminal::Terminals>();
    let fg = |pane_key: u32| match crate::status::terminal_of(pane_key) {
        None => Foreground::Unknown,
        Some(id) => match terminals.program(id) {
            None => Foreground::Gone,
            Some(None) => Foreground::Unknown,
            Some(Some("claude")) => Foreground::Claude,
            Some(Some(_)) => Foreground::Other,
        },
    };
    let due = with(app, |r| r.check(crate::claude_key::now_ms(), fg)).unwrap_or_default();
    for pane_key in due {
        let Some(id) = crate::status::terminal_of(pane_key) else { continue };
        if let Err(e) = terminals.write(id, PROMPT) {
            crate::secrets::log(log_dir, &format!("resume after limit: pane {pane_key} refused the prompt ({e}); not retried"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(kind: &str, used: f64, resets_at: Option<i64>) -> Limit {
        Limit { kind: kind.into(), used_percent: used, resets_at }
    }

    #[test]
    fn card16c_waits_that_could_not_be_read_or_kept_aside_are_never_saved_over() {
        let dir = std::env::temp_dir().join(format!("krs-resume-held-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        let broken = "[{\"pane_key\": 3, tru";
        store.set(KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        assert!(held_waits(&store).is_empty(), "the caller still starts with nothing waiting");
        assert!(save_waits(&store, &Resumes::default()).is_err(), "the blind save after the failed read is refused");
        assert_eq!(store.get(KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row919_a_wait_keeps_the_fields_this_version_does_not_know_when_the_list_is_saved_again() {
        let dir = std::env::temp_dir().join(format!("krs-resume-rest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        store.set(KEY, r#"[{"pane_key":3,"resets_at":900,"not_before":0,"note":"keep me"}]"#).unwrap();
        let mut r = Resumes::default();
        r.restore(held_waits(&store), 1);
        save_waits(&store, &r).unwrap();
        let back: serde_json::Value = serde_json::from_str(&store.get(KEY).unwrap().unwrap()).unwrap();
        assert_eq!(back[0]["pane_key"], 3);
        assert_eq!(back[0]["note"], "keep me", "the unknown field survived the save");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_reset_time_comes_from_the_event_else_the_weekly_else_the_five_hour_window() {
        let now = 1_000_000;
        let weekly = limit("seven_day", 100.0, Some(now + 5_000));
        let five = limit("five_hour", 100.0, Some(now + 2_000));
        assert_eq!(pick_reset(Some(now + 9), &[weekly.clone(), five.clone()], now), Some(now + 9), "the event's own time wins");
        assert_eq!(pick_reset(None, &[five.clone(), weekly.clone()], now), Some(now + 5_000), "the weekly window comes before the 5-hour one");
        assert_eq!(pick_reset(None, &[limit("seven_day", 100.0, None), five.clone()], now), None, "a used-up weekly window without a time is never swapped for the 5-hour one");
        assert_eq!(pick_reset(None, &[limit("seven_day", 100.0, Some(now - 1)), five.clone()], now), Some(now + 2_000), "a past weekly window is ignored");
        assert_eq!(pick_reset(None, &[limit("seven_day", 40.0, Some(now + 5_000)), five.clone()], now), Some(now + 2_000), "a weekly window not used up is ignored");
        assert_eq!(pick_reset(None, &[limit("seven_day", 40.0, Some(now + 5_000)), limit("five_hour", 99.0, Some(now + 2_000))], now), None, "nothing used up: nothing scheduled");
        assert_eq!(pick_reset(None, &[limit("five_hour", 100.0, Some(now - 5))], now), None, "a past 5-hour window is ignored");
        assert_eq!(pick_reset(None, &[], now), None);
    }

    #[test]
    fn a_due_pane_fires_once_per_reset_only_with_claude_in_front() {
        let r0 = 10_000_000;
        let mut r = Resumes::default();
        assert!(r.schedule(1, r0));
        assert_eq!(r.check(r0 + DELAY_MS - 1, |_| Foreground::Claude), Vec::<u32>::new(), "not before a minute past the reset");
        assert_eq!(r.check(r0 + DELAY_MS, |_| Foreground::Unknown), Vec::<u32>::new(), "unknown foreground keeps waiting");
        assert_eq!(r.waiting().len(), 1);
        assert_eq!(r.check(r0 + DELAY_MS + 1, |_| Foreground::Claude), vec![1]);
        assert!(r.waiting().is_empty(), "fired: nothing waits");
        assert!(!r.schedule(1, r0 + 5_000), "a reset seconds away from the one that fired counts as the same");
        assert!(r.waiting().is_empty());
        assert!(r.schedule(1, r0 + 7_200_000), "a truly new reset time fires again");
        assert_eq!(r.check(r0 + 7_200_000 + DELAY_MS + 1, |_| Foreground::Claude), vec![1]);
        // Expiry: a shell or another agent in front, or a gone terminal, ends the wait at once.
        assert!(r.schedule(2, r0 + 9_000_000));
        assert_eq!(r.check(r0 + 9_000_000 + DELAY_MS + 1, |_| Foreground::Other), Vec::<u32>::new());
        assert!(r.waiting().is_empty(), "only a shell left: the wait expires");
        assert!(r.schedule(2, r0 + 9_000_000), "it did not fire, so the same reset may be scheduled again");
        assert_eq!(r.check(r0 + 9_000_000 + DELAY_MS + 1, |_| Foreground::Gone), Vec::<u32>::new());
        assert!(r.waiting().is_empty(), "closing the pane cancels it");
        // Give-up: an unreachable pane is dropped half an hour after the due time.
        assert!(r.schedule(3, r0));
        assert_eq!(r.check(r0 + DELAY_MS + GIVE_UP_MS, |_| Foreground::Unknown), Vec::<u32>::new());
        assert_eq!(r.waiting().len(), 1);
        assert_eq!(r.check(r0 + DELAY_MS + GIVE_UP_MS + 1, |_| Foreground::Unknown), Vec::<u32>::new());
        assert!(r.waiting().is_empty(), "given up");
        // Sleeping through the due time: Claude in front still fires on the first check after waking.
        assert!(r.schedule(4, r0));
        assert_eq!(r.check(r0 + DELAY_MS + GIVE_UP_MS * 3, |_| Foreground::Claude), vec![4]);
    }

    #[test]
    fn panes_never_affect_each_other_and_a_cancel_or_clear_drops_the_wait() {
        let mut r = Resumes::default();
        assert!(r.schedule(1, 5_000));
        assert!(r.schedule(2, 5_000));
        assert!(r.schedule(1, 6_000), "a pane's wait is replaced by its newer reset");
        assert_eq!(r.waiting().iter().map(|w| (w.pane_key, w.resets_at)).collect::<Vec<_>>(), vec![(2, 5_000), (1, 6_000)]);
        r.cancel(1);
        assert_eq!(r.waiting().len(), 1);
        assert_eq!(r.waiting()[0].pane_key, 2);
        assert!(r.schedule(1, 6_000), "cancelled, not fired: the same reset may wait again");
        r.clear();
        assert!(r.waiting().is_empty());
    }

    #[test]
    fn restored_waits_skip_past_resets_and_settle_first() {
        let now = 50_000_000;
        let mut r = Resumes::default();
        r.restore(vec![Waiting { pane_key: 1, resets_at: now - 1, not_before: 0, rest: Default::default() }, Waiting { pane_key: 2, resets_at: now + 1_000, not_before: 0, rest: Default::default() }], now);
        assert_eq!(r.waiting().len(), 1, "a reset that went by while Kolux was closed is skipped");
        assert_eq!(r.waiting()[0].pane_key, 2);
        assert_eq!(r.waiting()[0].not_before, now + SETTLE_MS);
        let due = now + 1_000 + DELAY_MS + 1;
        assert!(due < now + SETTLE_MS - 1, "the test's due time is inside the settling time");
        assert_eq!(r.check(due, |_| Foreground::Claude), Vec::<u32>::new(), "a restored pane first waits through the settling time");
        assert_eq!(r.check(now + SETTLE_MS, |_| Foreground::Claude), vec![2]);
        assert!(!r.schedule(2, now + 1_000), "never typed into twice for one reset");
        let text = serde_json::to_string(&vec![Waiting { pane_key: 3, resets_at: 7, not_before: 0, rest: Default::default() }]).unwrap();
        let back: Vec<Waiting> = serde_json::from_str(&text).unwrap();
        assert_eq!(back[0].pane_key, 3);
    }
}
