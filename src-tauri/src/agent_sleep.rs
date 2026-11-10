//! TERM-123 / HID-028 (T-817; Txais 2026-11-09: "Build it, off by default"): agent sleep. An agent
//! pane left idle past the chosen delay is put to sleep to free memory: its session is recorded the
//! way workspace sleep records it (saved::at_pane_sleep), the window then ends that pane's terminal
//! and shows a placeholder, and Wake starts the same agent in the same folder resuming the same
//! session through the restored-tab path. The switch (`agentSleep`) is off on a fresh profile and
//! when the key is missing; the delay (`agentSleepIdleMinutes`, held between 5 and 240 minutes by the
//! window before it is saved, 30 unless changed) and the never-sleep rules (working, waiting, a
//! draft, the focused pane, a foreground command, no session) are the window's
//! (src/sleep/agentSleep.ts). HID-028 Compat: an old profile's sleep switch had another key, so it is
//! never read. This side re-checks what it alone knows: the switch is really on, the pane's terminal
//! exists with an agent in front of it, and the agent has reported a session that can be resumed.

use serde_json::Value;

pub const ON_KEY: &str = "agentSleep";

/// The switch: only a saved `true` turns it on; a missing key, another type or an old profile's own
/// sleep key reads as off.
pub fn sleep_on(settings: &Value) -> bool {
    settings.get(ON_KEY) == Some(&Value::Bool(true))
}

/// The pane's terminal when an agent is in front of it, else why the pane may not sleep: no running
/// terminal, a terminal that is gone, or a terminal with a plain shell or another program in front
/// (the agent exited, or the user typed something else).
pub fn front_agent(attached: Option<u32>, program: impl Fn(u32) -> Option<Option<&'static str>>) -> Result<u32, String> {
    let Some(id) = attached else { return Err("the pane has no running terminal".into()) };
    match program(id) {
        None => Err("the pane's terminal is gone".into()),
        Some(None) => Err("no agent is in front of the pane's terminal".into()),
        Some(Some(_)) => Ok(id),
    }
}

/// The save step of agent sleep for pane `pane_key`: the switch is checked again, the agent in front
/// is checked, its session is recorded, and the pane's terminal id is returned so the window can end
/// that terminal. Any error means nothing was recorded and nothing may be ended.
#[tauri::command]
pub fn agent_pane_sleep(terminals: tauri::State<'_, crate::terminal::Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, pane_key: u32) -> Result<u32, String> {
    let id = front_agent(terminals.attached(pane_key), |id| terminals.program(id))?;
    let store = store.lock().map_err(|e| e.to_string())?;
    if !sleep_on(&store.settings()) {
        return Err("agent sleep is off".into());
    }
    crate::hooks::agent_hooks::saved::at_pane_sleep(&store, pane_key)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::agent_hooks::saved::{sleep_record, Row};
    use serde_json::json;

    fn row(pane: u32, state: &str, session: Option<&str>) -> Row {
        Row { pane_key: pane, agent: "claude".into(), state: state.into(), at: 1, session_id: session.map(str::to_owned), cwd: Some("T:/t817".into()), stop: None, hook_version: None, pid: None, pid_started: None, children: Vec::new() }
    }

    #[test]
    fn t817_hid028_the_switch_is_off_on_a_fresh_profile_and_an_old_profiles_switch_is_ignored() {
        assert!(!sleep_on(&json!({})), "fresh profile: off");
        assert!(!sleep_on(&json!({ ON_KEY: "true" })), "only a real true counts");
        assert!(!sleep_on(&json!({ ON_KEY: 1 })));
        assert!(!sleep_on(&json!({ "hibernation": true, "agentHibernation": true, "sleepAgents": true, "experimental": { "hibernation": true } })), "HID-028 Compat: an old profile's own sleep switch, whatever its key, is never read");
        assert!(sleep_on(&json!({ ON_KEY: true })));
    }

    #[test]
    fn t817_term123_the_pane_must_have_a_running_terminal_with_an_agent_in_front() {
        assert_eq!(front_agent(None, |_| Some(Some("claude"))), Err("the pane has no running terminal".to_string()));
        assert_eq!(front_agent(Some(7), |_| None), Err("the pane's terminal is gone".to_string()));
        assert_eq!(front_agent(Some(7), |_| Some(None)), Err("no agent is in front of the pane's terminal".to_string()), "a plain shell or another foreground command: never");
        assert_eq!(front_agent(Some(7), |_| Some(Some("claude"))), Ok(7));
    }

    #[test]
    fn t817_term123_sleep_records_the_panes_session_finished_or_not_and_replaces_the_same_session() {
        let mut written: Vec<Row> = Vec::new();
        let earlier = vec![row(1, "working", Some("t817-a")), row(2, "waiting", Some("t817-b"))];
        let out = sleep_record(Some(row(9, "done", Some("t817-b"))), earlier, |rows| {
            written = rows.to_vec();
            Ok(())
        });
        assert_eq!(out.map(|r| r.pane_key), Ok(9));
        let ids: Vec<(u32, &str)> = written.iter().map(|r| (r.pane_key, r.session_id.as_deref().unwrap())).collect();
        assert_eq!(ids, [(1, "t817-a"), (9, "t817-b")], "keyed by session as workspace sleep keys it; the finished row stays, since the pane itself wakes it");
        assert_eq!(written[1].state, "done");
    }

    #[test]
    fn t817_term123_no_session_means_nothing_is_recorded_and_nothing_may_end() {
        let mut writes = 0;
        let out = sleep_record(None, Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert_eq!(out, Err("no status is known for this pane yet".to_string()));
        let out = sleep_record(Some(row(3, "done", None)), Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert_eq!(out, Err("the agent has not reported a session that can be resumed".to_string()));
        let out = sleep_record(Some(row(3, "done", Some("  "))), Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert!(out.is_err(), "a blank id is no id");
        assert_eq!(writes, 0, "the record is never written for a pane with no session");
    }

    #[test]
    fn t817_term123_a_failed_save_skips_the_sleep() {
        let out = sleep_record(Some(row(4, "done", Some("t817-c"))), Vec::new(), |_| Err("disk full".into()));
        assert_eq!(out, Err("the session could not be recorded: disk full".to_string()), "the caller ends nothing on an error");
    }
}
