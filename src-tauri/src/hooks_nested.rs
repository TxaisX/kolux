//! START-05: a hook event from an agent started INSIDE a pane is not the pane's own.
//!
//! Every pane's environment carries `KOLUX_HOOK_IDENTITY`, and a Claude Code (or Codex) started
//! inside the pane inherits it, so its hook events look like the pane's own: the pane's status
//! jumps about and its saved session id is replaced. There is no process id in the event to tell
//! the two apart, so this module compares folders and sessions, conservatively:
//! an event is foreign only when the pane's own agent is still the one that reported, the event is
//! from a different session, and it runs in a folder that is neither the pane's folder, one above
//! it, nor one below it.
//!
//! A `SessionStart` from a different session is never foreign: the person started an agent again in
//! the pane (after quitting one), and that new session replaces the known one. Once the known session
//! has ended (`SessionEnd`, or its process gone from the pane's foreground), no event is foreign
//! either: nothing can be nested inside an agent that is no longer running.
//!
//! Known limit: a nested agent that runs in the pane's own folder, or in a parent of it, is not
//! caught (its event looks exactly like the pane's own agent changing folder).

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

/// Whether the event's folder counts as inside the pane's: the same folder, one above it, or one
/// below it (a subfolder or worktree under the folder the agent last reported).
fn inside(event_cwd: &str, known_cwd: &str) -> bool {
    same_or_ancestor(event_cwd, known_cwd) || same_or_ancestor(known_cwd, event_cwd)
}

/// Whether a hook event comes from an agent other than the pane's own: the pane's last reported
/// folder and session are both known and not blank, the pane's known session has not ended, the
/// event is not a `SessionStart` (a person starting the agent again in the pane), the event carries
/// both folder and session as non-blank strings, the sessions differ (trimmed, ASCII case ignored),
/// and the event runs outside the pane's folder (not in it, not in a folder below it, and not in a
/// folder above it). Anything missing, blank or not a string keeps the event: a genuine event is
/// never dropped.
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
    if known_session.eq_ignore_ascii_case(event_session) {
        return false;
    }
    event.get("hook_event_name").and_then(Value::as_str) != Some("SessionStart") && !inside(event_cwd, known_cwd)
}

/// Whether `event` is the pane's own known session ending (`SessionEnd`, no sub-agent id): the agent
/// it ran as has exited, so no later event in the pane is foreign.
pub fn ends_known(known_session: Option<&str>, event: &Value) -> bool {
    let Some(known) = non_blank(known_session) else { return false };
    !sub_agent(event)
        && event.get("hook_event_name").and_then(Value::as_str) == Some("SessionEnd")
        && non_blank(event.get("session_id").and_then(Value::as_str)).is_some_and(|s| s.eq_ignore_ascii_case(known))
}

/// Whether the event belongs to a sub-agent rather than the pane's lead (`agent_id` present).
fn sub_agent(event: &Value) -> bool {
    event.get("agent_id").and_then(Value::as_str).is_some_and(|a| !a.trim().is_empty())
}

/// The text, trimmed; none when it is absent or blank.
fn non_blank(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}
