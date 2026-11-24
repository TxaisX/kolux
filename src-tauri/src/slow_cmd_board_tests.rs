//! LAG-04B (board test, hash-locked): every backend command that takes 100 ms or more leaves one line
//! in the app log naming the command and how long it took, and a storm of slow commands is capped so the
//! logging itself cannot add lag. A fake clock only: nothing here waits.

use super::*;
use std::cell::{Cell, RefCell};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A clock that returns `base`, then `base + step`, then `base + 2 * step`, ... and counts its calls.
struct FakeClock {
    base: Instant,
    at: Cell<Duration>,
    step: Cell<Duration>,
    calls: Cell<u32>,
}

impl FakeClock {
    fn new(step_ms: u64) -> Self {
        FakeClock { base: Instant::now(), at: Cell::new(Duration::ZERO), step: Cell::new(Duration::from_millis(step_ms)), calls: Cell::new(0) }
    }
    fn now(&self) -> Instant {
        self.calls.set(self.calls.get() + 1);
        let t = self.base + self.at.get();
        self.at.set(self.at.get() + self.step.get());
        t
    }
    fn jump(&self, d: Duration) {
        self.at.set(self.at.get() + d);
    }
}

/// Runs one command through `timed` with a fake clock whose two readings are `ms` apart.
fn one(lim: &Mutex<SlowLimiter>, name: &str, ms: u64) -> Vec<String> {
    let clock = FakeClock::new(ms);
    let mut lines = Vec::new();
    timed(lim, name, &|| clock.now(), || (), &mut |l: &str| lines.push(l.to_string()));
    lines
}

#[test]
fn the_limits_are_the_ones_the_card_names() {
    assert_eq!(SLOW_CMD_MS, 100);
    assert_eq!(SLOW_CMD_BUDGET, 20);
    assert_eq!(SLOW_CMD_WINDOW, Duration::from_secs(60));
}

#[test]
fn a_command_counts_as_slow_from_100_ms() {
    assert_eq!(slow_line("path_kind", Duration::from_millis(99)), None);
    assert_eq!(slow_line("path_kind", Duration::from_micros(99_999)), None);
    assert_eq!(slow_line("path_kind", Duration::ZERO), None);
    assert_eq!(slow_line("path_kind", Duration::from_millis(100)).as_deref(), Some("slow command path_kind took 100 ms"));
    assert_eq!(slow_line("path_kind", Duration::from_millis(101)).as_deref(), Some("slow command path_kind took 101 ms"));
}

#[test]
fn the_line_keeps_only_log_safe_characters_in_the_name() {
    assert_eq!(slow_line("plugin:event|listen", Duration::from_millis(150)).as_deref(), Some("slow command plugin:event|listen took 150 ms"));
    assert_eq!(slow_line("a b\nc\u{1b}[2J", Duration::from_millis(150)).as_deref(), Some("slow command abc2J took 150 ms"));
    assert_eq!(slow_line("", Duration::from_millis(150)).as_deref(), Some("slow command unknown took 150 ms"));
    let long = slow_line(&"x".repeat(500), Duration::from_millis(150)).unwrap();
    assert_eq!(long, format!("slow command {} took 150 ms", "x".repeat(64)));
}

#[test]
fn a_99_ms_command_leaves_nothing() {
    let lim = Mutex::new(SlowLimiter::new());
    assert!(one(&lim, "path_kind", 99).is_empty());
    assert!(one(&lim, "path_kind", 0).is_empty());
}

#[test]
fn a_100_ms_command_leaves_one_line() {
    let lim = Mutex::new(SlowLimiter::new());
    assert_eq!(one(&lim, "path_kind", 100), vec!["slow command path_kind took 100 ms".to_string()]);
}

#[test]
fn a_20_s_command_leaves_exactly_one_line_with_its_name_and_duration() {
    let lim = Mutex::new(SlowLimiter::new());
    assert_eq!(one(&lim, "workspace_branches", 20_000), vec!["slow command workspace_branches took 20000 ms".to_string()]);
}

#[test]
fn timed_runs_the_command_once_returns_its_result_and_reads_the_clock_twice() {
    let lim = Mutex::new(SlowLimiter::new());
    let clock = FakeClock::new(250);
    let runs = Cell::new(0);
    let lines = RefCell::new(Vec::<String>::new());
    let out = timed(&lim, "settings_save", &|| clock.now(), || {
        runs.set(runs.get() + 1);
        assert!(lines.borrow().is_empty(), "the line is written after the command, never before");
        42u32
    }, &mut |l: &str| lines.borrow_mut().push(l.to_string()));
    assert_eq!(out, 42);
    assert_eq!(runs.get(), 1);
    assert_eq!(clock.calls.get(), 2);
    assert_eq!(*lines.borrow(), vec!["slow command settings_save took 250 ms".to_string()]);
}

#[test]
fn the_limiter_lets_20_lines_through_per_minute_and_counts_the_rest() {
    let base = Instant::now();
    let mut lim = SlowLimiter::new();
    let allowed = (0..1000).filter(|_| lim.allow(base)).count();
    assert_eq!(allowed, 20);
    assert_eq!(lim.dropped(), 980);
    assert!(!lim.allow(base + Duration::from_millis(59_999)));
    assert_eq!(lim.dropped(), 981);
    assert!(lim.allow(base + Duration::from_secs(60)), "60 s after the window opened, a new window opens");
    assert_eq!(lim.dropped(), 981);
}

#[test]
fn a_storm_of_slow_commands_is_capped_and_opens_again_after_a_minute() {
    let lim = Mutex::new(SlowLimiter::new());
    let clock = FakeClock::new(150); // every command takes 150 ms (each reading moves the clock 150 ms)
    let mut lines = Vec::new();
    for _ in 0..200 {
        timed(&lim, "terminal_busy", &|| clock.now(), || (), &mut |l: &str| lines.push(l.to_string()));
    }
    // 200 commands end within 59.85 s of the first one: one window, 20 lines, 180 dropped.
    assert_eq!(lines.len(), 20, "{lines:?}");
    assert!(lines.iter().all(|l| l == "slow command terminal_busy took 150 ms"));
    assert_eq!(lim.lock().unwrap().dropped(), 180);
    clock.jump(Duration::from_secs(120));
    timed(&lim, "terminal_busy", &|| clock.now(), || (), &mut |l: &str| lines.push(l.to_string()));
    assert_eq!(lines.len(), 21);
}

#[test]
fn fast_commands_do_not_use_up_the_budget() {
    let lim = Mutex::new(SlowLimiter::new());
    for _ in 0..500 {
        assert!(one(&lim, "ui_heartbeat", 3).is_empty());
    }
    assert_eq!(one(&lim, "workspace_branches", 20_000).len(), 1);
    assert_eq!(lim.lock().unwrap().dropped(), 0);
}

#[test]
fn a_poisoned_limiter_still_times_and_logs() {
    let lim = Mutex::new(SlowLimiter::new());
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _g = lim.lock().unwrap();
        panic!("poison the lock");
    }));
    assert!(lim.is_poisoned());
    assert_eq!(one(&lim, "path_kind", 300), vec!["slow command path_kind took 300 ms".to_string()]);
}
