//! LAG-04B: every command the window calls that takes 100 ms or more leaves one line in `kolux.log`,
//! so the next freeze names the command that held the main thread instead of leaving a 20 second gap
//! with nothing recorded in it.
//!
//! A command without `async` runs inside `handler(invoke)` on the app's main thread, so the time
//! measured around it is how long it held the thread the window's answers (and its heartbeat) come
//! from. An `async` command only starts its work there and returns at once, so it is measured as
//! quick: that is accepted, because it never holds the main thread.
//!
//! A storm of slow commands cannot flood the log or add lag: at most [`SLOW_CMD_BUDGET`] lines are
//! written per [`SLOW_CMD_WINDOW`], and a fast command never touches the limiter at all.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A command that took at least this many milliseconds counts as slow.
pub const SLOW_CMD_MS: u64 = 100;
/// Lines allowed per window.
pub const SLOW_CMD_BUDGET: u32 = 20;
/// The window the budget is counted over: one minute.
pub const SLOW_CMD_WINDOW: Duration = Duration::from_secs(60);
/// The longest command name a line keeps. A normal one (`workspace_branches`) is far shorter.
const NAME_MAX: usize = 64;
/// What a name with nothing log-safe left in it becomes.
const UNKNOWN: &str = "unknown";

/// The line to log for a command that took `elapsed`, or `None` when it was under [`SLOW_CMD_MS`].
///
/// The name comes from the page, so only the characters a log line can hold survive: a newline would
/// write two lines, and an escape sequence would colour (or move the cursor over) the log. What is
/// left is cut to [`NAME_MAX`] chars; nothing left means `unknown`, so a line always names something.
pub fn slow_line(command: &str, elapsed: Duration) -> Option<String> {
    if elapsed < Duration::from_millis(SLOW_CMD_MS) {
        return None;
    }
    let mut name: String = command.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '|')).take(NAME_MAX).collect();
    if name.is_empty() {
        name = UNKNOWN.to_string();
    }
    Some(format!("slow command {name} took {} ms", elapsed.as_millis()))
}

/// How many lines one window has let through, when that window opened, and how many were refused.
///
/// A fixed window, not a sliding one: it opens at the first slow command and closes one
/// [`SLOW_CMD_WINDOW`] later, so a storm is capped without keeping a timestamp per line.
pub struct SlowLimiter {
    /// When the window opened; `None` until the first slow command asks.
    window_start: Option<Instant>,
    /// Lines let through in the window, its first one included.
    used: u32,
    /// Lines refused since [`SlowLimiter::new`]; never reset.
    dropped: u64,
}

impl SlowLimiter {
    /// A limiter that has not opened a window yet (`const`, so a `static` can hold one).
    pub const fn new() -> SlowLimiter {
        SlowLimiter { window_start: None, used: 0, dropped: 0 }
    }

    /// Whether one more line may be written at `now`.
    ///
    /// The first call opens a window at `now` and is let through. While `now - window_start` is under
    /// [`SLOW_CMD_WINDOW`], the first [`SLOW_CMD_BUDGET`] calls are let through and later ones are
    /// refused and counted in [`SlowLimiter::dropped`]. A call a window or more after the window
    /// opened opens a new one at `now` and counts as its first line.
    pub fn allow(&mut self, now: Instant) -> bool {
        let opened = match self.window_start {
            Some(start) => now.saturating_duration_since(start) >= SLOW_CMD_WINDOW,
            None => true,
        };
        if opened {
            self.window_start = Some(now);
            self.used = 1;
            return true;
        }
        if self.used < SLOW_CMD_BUDGET {
            self.used += 1;
            return true;
        }
        self.dropped += 1;
        false
    }

    /// Lines refused since [`SlowLimiter::new`].
    #[cfg(test)]
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

/// The whole app's one limiter: every window's commands share the same budget.
pub static LIMITER: Mutex<SlowLimiter> = Mutex::new(SlowLimiter::new());

/// Runs one command under the clock and writes at most one line when it was slow; returns what the
/// command returned.
///
/// The clock is read exactly twice: before the command and after it. A fast command never touches
/// the limiter (so it cannot use the budget up), and the limiter is locked only after the command
/// returned and released before the line is written, so a slow command never waits on the log and
/// the log never runs under the lock. A limiter poisoned by a panicking holder still times and logs:
/// the inner value is used.
pub fn timed<T>(limiter: &Mutex<SlowLimiter>, command: &str, clock: &dyn Fn() -> Instant, run: impl FnOnce() -> T, log: &mut dyn FnMut(&str)) -> T {
    let start = clock();
    let out = run();
    let end = clock();
    if let Some(line) = slow_line(command, end.saturating_duration_since(start)) {
        let allowed = {
            let mut guard = limiter.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.allow(end)
        };
        if allowed {
            log(&line);
        }
    }
    out
}

#[cfg(test)] #[path = "slow_cmd_board_tests.rs"] mod slow_cmd_board_tests;
