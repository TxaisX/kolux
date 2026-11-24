//! START-04: how a pane ended, told apart from a pane Kolux itself closed, for the log and the exit
//! event. A close of Kolux's own (a closed tab, a quit, a replaced pane) takes the session out of the
//! registry before the program is stopped, so it ends with code 1 exactly like a crash; the registry is
//! what tells the two apart. Pure text in, text out: no file, no lock, no clock (the caller reads the
//! seconds off the mark). Secrets are masked with the repo's own `crate::mask`.
use crate::mask::mask;

/// The end was Kolux's own: its session was already out of the registry when the program stopped.
pub const CLOSED_BY_KOLUX: &str = "closed-by-kolux";
/// The end was the program's own: it was still registered when it stopped (a crash, a normal exit,
/// or a lost link to the background terminal service, which ends the session with no code).
pub const EXITED: &str = "exited";
/// How many of the pane's last output lines the log keeps.
pub const EXIT_TAIL_LINES: usize = 3;
/// The longest one tail line may be in the log, in characters, ellipsis included.
pub const LINE_MAX: usize = 200;

/// `EXITED` for a session that was still registered when it stopped, `CLOSED_BY_KOLUX` for one Kolux
/// had already taken out (its close path removes the session before it ends the program).
pub fn exit_reason(still_registered: bool) -> &'static str {
    if still_registered {
        EXITED
    } else {
        CLOSED_BY_KOLUX
    }
}

/// The last `max` lines of `text` that hold something, oldest first, each trimmed at its end, masked,
/// and cut to `LINE_MAX` characters. Empty lines (blank, or only spaces and tabs) are skipped, so a
/// progress bar's last repaint does not take the place of the error under it. `max == 0` gives none.
pub fn tail_lines(text: &str, max: usize) -> Vec<String> {
    let lines: Vec<&str> = text.lines().map(str::trim_end).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(max)..].iter().map(|l| cut(&mask(l))).collect()
}

/// One tail line cut to `LINE_MAX` characters, never a byte. The mask runs first (in `tail_lines`), so
/// a key that starts just under the limit cannot leave its prefix showing. A line that is exactly
/// `LINE_MAX` characters is kept whole.
fn cut(line: &str) -> String {
    if line.chars().count() <= LINE_MAX {
        return line.to_string();
    }
    let mut out: String = line.chars().take(LINE_MAX - 1).collect();
    out.push('…');
    out
}

/// The one log line that says how terminal `id` ended. A pane Kolux closed says only that; a real
/// exit says its code, how long it ran, the agent, the folder and the last output lines. `tail` is
/// already masked and cut (`tail_lines`), and any line break left in an entry becomes a space, so the
/// result is always one line.
pub fn exit_line(id: u32, reason: &str, code: Option<u32>, secs: Option<u64>, agent: Option<&str>, cwd: Option<&str>, tail: &[String]) -> String {
    if reason == CLOSED_BY_KOLUX {
        return format!("terminal {id} closed by Kolux");
    }
    let code = code.map_or_else(|| "unknown".to_string(), |c| c.to_string());
    let secs = secs.map_or_else(|| "?".to_string(), |s| s.to_string());
    let mut line = format!(
        "terminal {id} exited (code {code}) after {secs}s, agent {}, folder {}",
        agent.unwrap_or("none"),
        cwd.unwrap_or("unknown")
    );
    if !tail.is_empty() {
        let one_line = |l: &String| l.chars().map(|c| if matches!(c, '\r' | '\n') { ' ' } else { c }).collect::<String>();
        line.push_str(", last output: ");
        line.push_str(&tail.iter().map(one_line).collect::<Vec<_>>().join(" | "));
    }
    line
}
