//! Txais (2026-11-20): a session hands off and clears itself where models start getting worse, not at
//! the window's edge.
//!
//! Measured context is a quality curve, not a capacity one. Past roughly 150-200k the model loses the
//! thread of a long task: earlier instructions get crowded out and tool use gets sloppier, so a session
//! that runs to a 1M window has spent most of its life degraded and everything it did after ~200k was
//! done by a worse version of the model. The worktree's handoff note (`.kolux/handoffs/<name>.md`,
//! SESS-025) carries the work forward, which is what makes clearing early cheap: the next turn starts
//! sharp with the state on paper.
//!
//! The clear is one command typed into the pane each time the context crosses the point, so a session
//! relays over and over: it fills, hands off, clears, and fills again on a fresh conversation. The
//! command is the agent's own (`clear_for`), and an agent whose command Kolux cannot prove is never
//! sent one.

use serde_json::Value;

/// The setting: the context tokens at which a session clears itself. `0` turns the clear off.
pub const FIELD: &str = "handoffAtTokens";

/// The point a session clears at unless the setting says otherwise: just under the 200k cap
/// (`cap.rs`, USAGE-006) and inside the zone where the model is still sharp.
pub const AT: u64 = 170_000;

/// The command that starts a new conversation in `agent`, or `None` when Kolux has no proof the agent
/// takes one. Only what each CLI documents: Claude's `/clear`, and `/new` for Codex, OpenCode and Grok
/// (both of the last two list `/clear` as an alias). Every other agent is left alone rather than sent a
/// command it may read as a chat message.
pub fn clear_for(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" => Some("/clear"),
        "codex" | "opencode" | "grok" => Some("/new"),
        _ => None,
    }
}

/// A clear as a terminal takes it: the input line is emptied (Ctrl+U), the command typed as text, then
/// Enter. The same bytes `chat/composer.ts` sends for a slash command.
fn keys(command: &str) -> String {
    format!("\u{15}{command}\r")
}

/// The point a session clears at. A saved `0` is a real answer and turns the clear off.
pub fn at(settings: &Value) -> u64 {
    settings.get(FIELD).and_then(Value::as_u64).unwrap_or(AT)
}

/// Whether a reading has reached the point. A point of `0` never fires, and a session that reports no
/// reading is never guessed at.
pub fn due(tokens: Option<u64>, at: u64) -> bool {
    match (at, tokens) {
        (0, _) | (_, None) => false,
        (at, Some(tokens)) => tokens >= at,
    }
}

/// What has already been cleared: the panes currently above the line. A pane fires once per crossing
/// and rearms only when a reading comes back below the line, which is what a clear leaves behind. So a
/// burst of reports never clears twice, and a session that fills up again clears again — every time.
#[derive(Default)]
pub struct Above(std::collections::HashSet<u32>);

impl Above {
    /// True when this reading is the one to clear on: the first report at or above the point since the
    /// last clear. False for every later report in the same crossing, and for a report below it (which
    /// rearms the pane for the next time it fills).
    pub fn crossing(&mut self, pane_key: u32, tokens: u64, at: u64) -> bool {
        if due(Some(tokens), at) {
            self.0.insert(pane_key)
        } else {
            self.0.remove(&pane_key);
            false
        }
    }
}

pub type Registry = std::sync::Mutex<Above>;

/// Called with every usage report. Types the agent's own new-conversation command into the pane each
/// time its context crosses the point. `agent` may be given by the caller (the status line is Claude's,
/// the meter knows each pane's); otherwise it is the pane's own. An agent with no command Kolux can
/// prove is left alone. A terminal that refuses is logged and never retried: the pane keeps its session
/// rather than the app fighting a terminal that is gone.
pub fn check(app: &tauri::AppHandle, pane_key: u32, tokens: Option<u64>, agent: Option<&str>) {
    use tauri::Manager;
    let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() else { return };
    let at = store.lock().ok().map(|s| at(&s.settings())).unwrap_or(AT);
    let Some(tokens) = tokens else { return };
    // A pane with no agent yet has nothing to clear: it is not a crossing, so it stays armed. A shell
    // pane where the user starts an agent by hand comes back through here once it has one.
    let terminals = app.state::<crate::terminal::Terminals>();
    let Some(agent) = agent.or_else(|| terminals.of_pane(pane_key).and_then(|r| r.agent)) else { return };
    let Some(reg) = app.try_state::<Registry>() else { return };
    if !reg.lock().map(|mut r| r.crossing(pane_key, tokens, at)).unwrap_or(false) {
        return;
    }
    let log = |line: &str| {
        if let Ok(dir) = app.path().app_data_dir() {
            crate::secrets::log(&dir, line);
        }
    };
    let Some(command) = clear_for(agent) else {
        // No crossing was cleared, so the pane is rearmed: if its agent changes, it can still clear.
        if let Ok(mut r) = reg.lock() {
            r.0.remove(&pane_key);
        }
        log(&format!("handoff: pane {pane_key} reached {tokens} tokens (line {at}) but runs {agent}, which has no clear Kolux knows; left alone"));
        return;
    };
    let Some(id) = crate::status::terminal_of(pane_key) else { return };
    match terminals.write(id, &keys(command)) {
        Ok(()) => log(&format!("handoff: pane {pane_key} ({agent}) reached {tokens} tokens (line {at}) and was cleared with {command}")),
        Err(e) => log(&format!("handoff: pane {pane_key} refused the clear ({e}); not retried")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_point_is_170k_unless_the_setting_says_otherwise_and_zero_turns_it_off() {
        assert_eq!(at(&json!({})), AT);
        assert_eq!(at(&json!({ "handoffAtTokens": 1_000_000 })), 1_000_000);
        assert_eq!(at(&json!({ "handoffAtTokens": 0 })), 0);
        // Not a whole number of tokens: the default, never a clear nobody asked for.
        assert_eq!(at(&json!({ "handoffAtTokens": -5 })), AT);
        assert_eq!(at(&json!({ "handoffAtTokens": "soon" })), AT);
    }

    #[test]
    fn a_reading_reaches_the_point_at_and_above_it() {
        assert!(!due(Some(169_999), AT));
        assert!(due(Some(170_000), AT));
        assert!(due(Some(900_000), AT));
    }

    #[test]
    fn no_reading_and_a_point_of_zero_never_fire() {
        assert!(!due(None, AT));
        assert!(!due(Some(u64::MAX), 0));
    }

    #[test]
    fn a_pane_clears_once_per_crossing_and_again_the_next_time_it_fills() {
        let mut c = Above::default();
        assert!(!c.crossing(4, 100_000, AT), "below the line: nothing");
        assert!(c.crossing(4, 170_000, AT), "the first reading at the line clears");
        assert!(!c.crossing(4, 171_000, AT), "the reports that follow in the same burst do not");
        assert!(!c.crossing(4, 200_000, AT));
        assert!(!c.crossing(4, 20_000, AT), "the clear drops the reading: the pane rearms");
        assert!(c.crossing(4, 170_000, AT), "the next time it fills it clears again");
        assert!(c.crossing(9, 170_000, AT), "another pane is another crossing");
    }

    #[test]
    fn each_agent_gets_the_clear_its_own_cli_documents_and_no_other() {
        assert_eq!(clear_for("claude"), Some("/clear"));

        assert_eq!(clear_for("codex"), Some("/new"));
        assert_eq!(clear_for("opencode"), Some("/new"));
        assert_eq!(clear_for("grok"), Some("/new"));
        for other in ["gemini", "copilot", "aider", "hermes", "cursor", "droid", ""] {
            assert_eq!(clear_for(other), None, "{other} takes no clear Kolux can prove");
        }
        assert_eq!(keys("/new"), "\u{15}/new\r", "the input line emptied, the command typed, Enter");
    }

    #[test]
    fn a_point_of_zero_never_clears() {
        let mut c = Above::default();
        assert!(!c.crossing(4, u64::MAX, 0));
        assert!(!c.crossing(4, u64::MAX, 0));
    }
}
