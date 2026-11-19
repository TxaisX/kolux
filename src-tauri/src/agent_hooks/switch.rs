//! STAT-002 / STAT-003 (T-120-a): the one switch for the agents' status hooks, and the install
//! check that reads a hooks file. Off, `sync` takes Kolux's entries out of Claude Code and Codex and
//! nothing puts them back at launch; on, they return. Off is the default (T-152-gate): no saved or an
//! unreadable value installs nothing, and turning it on is the user's recorded approval.

use super::{names_mine, read_opt};
use serde_json::{Map, Value};
use std::path::Path;

/// The Settings key; only a saved `true` turns the hooks on.
pub const SWITCH_KEY: &str = "agentStatusHooks";

pub fn on(settings: &Value) -> bool {
    settings.get(SWITCH_KEY) == Some(&Value::Bool(true))
}

/// A group (or a bare entry) that runs one of Kolux's scripts.
fn ours(group: &Value) -> bool {
    names_mine(group) || group.get("hooks").and_then(Value::as_array).is_some_and(|hs| hs.iter().any(names_mine))
}

/// One agent's install state from its hooks file: installed (every event Kolux manages has its
/// entry), partial (some are missing, or an old Kolux entry sits under an event it no longer uses),
/// not installed, or error. A file that cannot be read or parsed is reported, never rewritten.
pub fn inspect(file: &Path, events: &[&str]) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(Some(t)) => t,
        Ok(None) => return ("not installed", None),
        Err(e) => return ("error", Some(e)),
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return ("error", Some(format!("{} is not JSON ({e}); left alone", file.display()))),
    };
    let empty = Map::new();
    let hooks = v.get("hooks").and_then(Value::as_object).unwrap_or(&empty);
    let has = |event: &str| hooks.get(event).and_then(Value::as_array).is_some_and(|gs| gs.iter().any(ours));
    let missing: Vec<&str> = events.iter().copied().filter(|e| !has(e)).collect();
    let stale: Vec<&str> = hooks.keys().map(String::as_str).filter(|e| !events.contains(e) && has(e)).collect();
    match (missing.len(), stale.is_empty()) {
        (0, true) => ("installed", None),
        (n, true) if n == events.len() => ("not installed", None),
        _ => {
            let mut why = Vec::new();
            if !missing.is_empty() {
                why.push(format!("no Kolux entry for {}", missing.join(", ")));
            }
            if !stale.is_empty() {
                why.push(format!("an old Kolux entry under {}", stale.join(", ")));
            }
            ("partial", Some(why.join("; ")))
        }
    }
}
