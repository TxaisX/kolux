//! START-05: a hook event from an agent started INSIDE a pane is not the pane's own.
//!
//! Every pane's environment carries `KOLUX_HOOK_IDENTITY`, and a Claude Code (or Codex) started
//! inside the pane inherits it, so its hook events look like the pane's own: the pane's status
//! jumps about and its saved session id is replaced. There is no process id in the event to tell
//! the two apart, so this module compares folders and sessions, conservatively:
//! an event is foreign only when the pane's own agent has already reported, the event is from a
//! different session, and it runs in a folder that is neither the pane's folder nor one above it.
//!
//! The latch (`saved::ended`) says the pane's agent has left its shell (the foreground poll saw the
//! shell again): nothing in the pane can then be nested inside a live agent, so no event is foreign
//! and a new `SessionStart` in the pane is heard.
//!
//! Known limit: a nested agent that runs in the pane's own folder, or in a parent of it, is not
//! caught (its event looks exactly like the pane's own agent changing folder). A restart quicker
//! than one foreground poll (~2 s) is not seen either: the shell never shows, so the latch stays
//! unset and the new session's first event is dropped as foreign. Known residual.

use serde_json::Value;

/// One folder spelling for comparison: trimmed, no `\\?\` prefix, `/` separators, no trailing
/// `/`, ASCII lower case. So `C:\` becomes `c:`, and `\\?\C:\Work\App\` and `c:/work/app` both
/// become `c:/work/app`.
pub fn norm_path(p: &str) -> String {
    let p = p.trim();
    let p = p.strip_prefix("\\\\?\\").or_else(|| p.strip_prefix("//?/")).unwrap_or(p);
    p.replace('\\', "/").trim_end_matches('/').to_ascii_lowercase()
}

/// Whether the known folder is the event's folder or one above it, compared on whole path parts:
/// `c:/work/ap` is not an ancestor of `c:/work/app`.
pub fn same_or_ancestor(event_cwd: &str, known_cwd: &str) -> bool {
    let (event, known) = (norm_path(event_cwd), norm_path(known_cwd));
    known == event || known.starts_with(&format!("{event}/"))
}

/// Whether a hook event comes from an agent other than the pane's own: the pane's last reported
/// folder and session are both known and not blank, the pane's agent has not left its shell, the
/// event carries both folder and session as non-blank strings, the sessions differ (trimmed, ASCII
/// case ignored), and the event runs outside the pane's folder (not in it and not in a folder above
/// it). Anything missing, blank or not a string keeps the event: a genuine event is never dropped.
pub fn foreign_event(known_cwd: Option<&str>, known_session: Option<&str>, known_ended: bool, event: &Value) -> bool {
    if known_ended {
        return false;
    }
    let (Some(known_cwd), Some(known_session)) = (non_blank(known_cwd), non_blank(known_session)) else { return false };
    let (Some(event_cwd), Some(event_session)) = (
        non_blank(event.get("cwd").and_then(Value::as_str)),
        non_blank(event.get("session_id").and_then(Value::as_str)),
    ) else {
        return false;
    };
    !known_session.eq_ignore_ascii_case(event_session) && !same_or_ancestor(event_cwd, known_cwd)
}

/// The text, trimmed; none when it is absent or blank.
fn non_blank(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}
