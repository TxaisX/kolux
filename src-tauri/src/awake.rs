//! TERM-122 / APP-018: keep the computer awake while agents run. Off by default; On holds always;
//! Agent (Auto) holds only while an agent pane is believably working. The choice sits on Settings >
//! Agents under the `keepAwake` key ("off", "agent", "on"); an older plain `true` reads as Agent.
//! Windows asks the system through SetThreadExecutionState on the watcher's own thread (the request
//! belongs to the thread that made it); macOS runs `caffeinate`, Linux `systemd-inhibit` (which also
//! blocks sleep on lid close). A missing tool or a refused hold quietly does nothing, is logged
//! once and is asked for again once a minute.
// T-223: lib.rs starts the watcher and registers the command, and status.rs gains working_now and
// terminal_ended; both are coordinator patches (evidence/launch-FIX-2-status.patch, then
// evidence/launch-FIX-2-wiring.patch). Until they land this module is not compiled at all.

use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const KEY: &str = "keepAwake";
static HELD: AtomicBool = AtomicBool::new(false);
/// How long a started sleep blocker must keep running before it counts as a hold.
#[cfg_attr(windows, allow(dead_code))]
const BLOCKER_SETTLE: Duration = Duration::from_millis(200);
/// After a refused hold, the watcher waits this many 5 s ticks (one minute) before asking again,
/// so a refused systemd-inhibit is not started anew every tick.
const RETRY_TICKS: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Off,
    Agent,
    On,
}

/// The saved choice; anything unknown is Off, an older `true` is Agent.
pub fn mode(settings: &serde_json::Value) -> Mode {
    match settings.get(KEY) {
        Some(serde_json::Value::Bool(true)) => Mode::Agent,
        Some(serde_json::Value::String(s)) if s == "agent" || s == "auto" => Mode::Agent,
        Some(serde_json::Value::String(s)) if s == "on" => Mode::On,
        _ => Mode::Off,
    }
}

/// Whether to hold the computer awake: On always, Agent only while `working` panes (believably
/// working ones: waiting, blocked, done, stale, never-heard and ended agents are not counted, see
/// status::working_now) are above zero.
pub fn want(mode: Mode, working: usize) -> bool {
    match mode {
        Mode::Off => false,
        Mode::On => true,
        Mode::Agent => working > 0,
    }
}

/// The Linux and macOS sleep blocker for Kolux's process `pid`: both end on their own when Kolux
/// does, even if it dies without cleaning up (a panic=abort build never runs Drop).
#[cfg_attr(windows, allow(dead_code))]
fn blocker(pid: u32, mac: bool) -> (&'static str, Vec<String>) {
    let pid = pid.to_string();
    if mac {
        return ("caffeinate", vec!["-i".into(), "-w".into(), pid]);
    }
    let args = ["--what=sleep:handle-lid-switch", "--who=Kolux", "--why=Agents are working", "--mode=block", "tail", &format!("--pid={pid}"), "-f", "/dev/null"];
    ("systemd-inhibit", args.iter().map(|a| a.to_string()).collect())
}

/// A blocker that exits at once (refused, or no system bus) is no hold: the child counts only if it
/// is still running after `settle`; otherwise it is reaped and None comes back.
#[cfg_attr(windows, allow(dead_code))]
fn running_after(mut child: Child, settle: Duration) -> Option<Child> {
    std::thread::sleep(settle);
    if let Ok(None) = child.try_wait() {
        return Some(child);
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

#[cfg(windows)]
mod sys {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    /// Asks Windows to stay awake (or lets it sleep again); false when the call was refused.
    pub fn set(hold: bool) -> bool {
        let flags = if hold { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
        // SAFETY: a plain kernel32 call with flag bits only; no pointers cross.
        unsafe { SetThreadExecutionState(flags) != 0 }
    }
    pub struct Hold;
    pub fn hold() -> Option<Hold> {
        set(true).then_some(Hold)
    }
    impl super::Renew for Hold {
        /// Asks again (the call is idempotent), so a request Windows dropped, as after a sleep and
        /// resume, is back within a tick; false when refused.
        fn renew(&mut self) -> bool {
            set(true)
        }
    }
    impl Drop for Hold {
        fn drop(&mut self) {
            set(false);
        }
    }
}

#[cfg(not(windows))]
mod sys {
    use std::process::{Child, Stdio};
    pub struct Hold(Child);
    /// The system's own sleep blocker, held for as long as the child runs.
    pub fn hold() -> Option<Hold> {
        let (program, args) = super::blocker(std::process::id(), cfg!(target_os = "macos"));
        let child = crate::winproc::command(program).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().ok()?;
        super::running_after(child, super::BLOCKER_SETTLE).map(Hold)
    }
    impl super::Renew for Hold {
        /// Still held while the blocker runs; a blocker that died is taken again on this tick.
        fn renew(&mut self) -> bool {
            matches!(self.0.try_wait(), Ok(None))
        }
    }
    impl Drop for Hold {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

/// A hold that is asked again every tick; false when it is gone.
pub trait Renew {
    fn renew(&mut self) -> bool;
}

/// What the watcher remembers between ticks about asking for a hold.
#[derive(Default)]
struct Tries {
    /// The once-only "refused or missing" log was written.
    missing: bool,
    /// Ticks left before a refused hold is asked for again.
    wait: u32,
}

/// One tick: take, renew or let go of the hold to match `wanted`, taking a new one with `take`.
/// While wanted the hold is renewed every tick, never trusted from the last one.
fn step<H: Renew>(slot: &mut Option<H>, wanted: bool, tries: &mut Tries, take: impl FnOnce() -> Option<H>) {
    if !wanted {
        *slot = None;
        tries.wait = 0;
    } else {
        if slot.as_mut().is_some_and(|h| !h.renew()) {
            *slot = None;
        }
        if slot.is_none() && tries.wait > 0 {
            tries.wait -= 1;
        } else if slot.is_none() {
            *slot = take();
            if slot.is_none() {
                tries.wait = RETRY_TICKS - 1;
                if !tries.missing {
                    tries.missing = true;
                    eprintln!("kolux: keep-awake is on but the system refused or its sleep blocker is missing; the computer may sleep");
                }
            }
        }
    }
    HELD.store(slot.is_some(), Ordering::Relaxed);
}

/// Starts the watcher: every 5 s it re-reads the choice and the working panes and renews the hold,
/// so a change, an agent finishing or ending and a resume from sleep are all picked up within a tick.
/// `live` says whether a terminal is still running: a pane only counts while its terminal does.
pub fn start(settings: impl Fn() -> serde_json::Value + Send + 'static, live: impl Fn(u32) -> bool + Send + 'static) {
    std::thread::spawn(move || {
        let (mut slot, mut tries) = (None, Tries::default());
        loop {
            step(&mut slot, want(mode(&settings()), crate::status::working_now(&live)), &mut tries, sys::hold);
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

/// TERM-122: whether the computer is being kept awake now, for the status bar item.
#[tauri::command]
pub fn keep_awake_state() -> bool {
    HELD.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn term122_off_by_default_and_an_older_on_reads_as_agent() {
        assert_eq!(mode(&json!({})), Mode::Off);
        assert_eq!(mode(&json!({ "keepAwake": false })), Mode::Off);
        assert_eq!(mode(&json!({ "keepAwake": true })), Mode::Agent);
        assert_eq!(mode(&json!({ "keepAwake": "agent" })), Mode::Agent);
        assert_eq!(mode(&json!({ "keepAwake": "on" })), Mode::On);
        assert_eq!(mode(&json!({ "keepAwake": "sometimes" })), Mode::Off);
    }

    #[test]
    fn term122_agent_holds_only_while_an_agent_works_and_on_holds_always() {
        assert!(!want(Mode::Off, 3));
        assert!(want(Mode::On, 0));
        assert!(want(Mode::Agent, 1));
        assert!(!want(Mode::Agent, 0), "no believable working pane: the computer may sleep");
    }

    /// TERM-122 FIX-SOON: the Linux blocker waits on Kolux's own pid, so it ends with Kolux even
    /// when Kolux dies without cleaning up; nothing is left running forever.
    #[test]
    fn term122_the_sleep_blocker_ends_when_kolux_does() {
        let (program, args) = blocker(4242, false);
        assert_eq!(program, "systemd-inhibit");
        assert_eq!(args[args.len() - 4..], ["tail", "--pid=4242", "-f", "/dev/null"]);
        assert!(!args.iter().any(|a| a == "sleep" || a == "infinity"), "no blocker that outlives Kolux: {args:?}");
        assert!(args.iter().any(|a| a == "--mode=block"));
        assert_eq!(blocker(4242, true), ("caffeinate", vec!["-i".to_string(), "-w".into(), "4242".into()]));
    }

    /// TERM-122 FIX-SOON: a blocker that exits at once is no hold; one still running after the
    /// settle time is kept. Real child processes on both sides.
    #[test]
    fn term122_a_blocker_that_exits_at_once_is_not_counted_as_a_hold() {
        use std::process::{Command, Stdio};
        let quiet = |program: &str, args: &[&str]| Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        // Load flake fix: the quick child gets 3 s (not 0.6 s) to start and exit, and the slow one lives
        // 30 s, so a starved machine can neither keep the quick one "running" nor end the slow one early.
        let (quick, slow) = if cfg!(windows) { (quiet("cmd", &["/C", "exit 0"]), quiet("ping", &["-n", "31", "127.0.0.1"])) } else { (quiet("true", &[]), quiet("sleep", &["30"])) };
        assert!(running_after(quick, Duration::from_secs(3)).is_none(), "an exited blocker holds nothing");
        let mut kept = running_after(slow, BLOCKER_SETTLE).expect("a running blocker is a hold");
        let _ = kept.kill();
        let _ = kept.wait();
    }

    /// HELD is one flag for the whole app; the tests that move it take turns.
    static TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[cfg(windows)]
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    /// TERM-122 "re-checked after resume": the system can drop the request (a user-initiated sleep
    /// ends power requests), and the next tick while still wanted must ask again, not trust the slot.
    #[cfg(windows)]
    #[test]
    fn term122_every_tick_while_wanted_asks_windows_again() {
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let (mut slot, mut tries) = (None, Tries::default());
        step(&mut slot, true, &mut tries, sys::hold);
        assert!(slot.is_some());
        // The request is gone behind Kolux's back, as after a sleep and resume.
        // SAFETY: flag bits only, on this test's own thread.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        step(&mut slot, true, &mut tries, sys::hold);
        // SetThreadExecutionState answers with the state before the call: the tick must have re-taken it.
        // SAFETY: as above.
        let before = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        assert_ne!(before & ES_SYSTEM_REQUIRED, 0, "the tick while wanted asked Windows again (state was {before:#x})");
        step(&mut slot, false, &mut tries, sys::hold);
    }

    /// A stand-in hold for the tests that must not start a real sleep blocker (Linux, macOS).
    struct Fake;
    impl Renew for Fake {
        fn renew(&mut self) -> bool {
            true
        }
    }

    /// On Windows the real hold (a flag on this thread); elsewhere a stand-in, so the test never
    /// starts a real systemd-inhibit or caffeinate.
    #[test]
    fn term122_the_hold_is_taken_and_given_back_with_the_wanted_state() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let mut tries = Tries::default();
        #[cfg(windows)]
        {
            let mut slot = None;
            step(&mut slot, true, &mut tries, sys::hold);
            assert!(slot.is_some() && keep_awake_state(), "Windows granted the hold through SetThreadExecutionState");
            step(&mut slot, false, &mut tries, sys::hold);
            assert!(slot.is_none() && !keep_awake_state());
        }
        let mut slot = None;
        step(&mut slot, true, &mut tries, || Some(Fake));
        assert!(slot.is_some() && keep_awake_state());
        step(&mut slot, false, &mut tries, || Some(Fake));
        assert!(slot.is_none() && !keep_awake_state());
    }

    /// TERM-122 AFTER: a refused hold (systemd-inhibit with no system bus, say) is not asked for
    /// again on every 5 s tick; the watcher waits RETRY_TICKS ticks, and asks at once when the
    /// computer is wanted awake anew.
    #[test]
    fn term122_a_refused_hold_is_asked_for_again_only_after_a_pause() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let asked = std::cell::Cell::new(0u32);
        let refuse = || {
            asked.set(asked.get() + 1);
            None::<Fake>
        };
        let (mut slot, mut tries) = (None, Tries::default());
        for _ in 0..RETRY_TICKS {
            step(&mut slot, true, &mut tries, refuse);
        }
        assert_eq!(asked.get(), 1, "one refusal, then a pause, not a new blocker every tick");
        step(&mut slot, true, &mut tries, refuse);
        assert_eq!(asked.get(), 2, "after the pause it asks again");
        step(&mut slot, false, &mut tries, refuse);
        step(&mut slot, true, &mut tries, refuse);
        assert_eq!(asked.get(), 3, "wanted anew: asks at once");
        assert!(tries.missing && slot.is_none() && !keep_awake_state());
    }
}
