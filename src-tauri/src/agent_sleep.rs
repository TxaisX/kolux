//! TERM-123 / HID-028 (T-817; Txais 2026-11-09: "Build it, off by default"): agent sleep. An agent
//! pane left idle past the chosen delay is put to sleep to free memory: its session is recorded the
//! way workspace sleep records it (saved::at_pane_sleep), the window then ends that pane's terminal
//! and shows a placeholder, and Wake starts the same agent in the same folder resuming the recorded
//! session through the restored-tab path. The switch (`agentSleep`) is off on a fresh profile and
//! when the key is missing; the delay (`agentSleepIdleMinutes`, 30 unless changed, held between 5 and
//! 240 minutes here as well as in the window) and the never-sleep rules the window alone can see (a
//! draft, a drawn pane, a question or permission in its status records) are the window's
//! (src/sleep/agentSleep.ts). HID-028 Compat: an old profile's sleep switch had another key, so it is
//! never read. This side re-checks everything it knows itself, since the window's decision may be a
//! minute old or blind to the terminal: the switch is really on, the pane's terminal exists with the
//! agent and nothing else in front of it, the terminal has neither printed nor been typed into for the
//! delay (text typed straight into the agent, or an editor the agent opened, is invisible to the
//! window's message box), and the live status row is a finished turn, at least the delay old, with no
//! background tasks going (saved::sleep_record), and nobody typed into the terminal after that turn
//! finished (a draft typed into the agent's own prompt, or into an editor the agent opened, makes no
//! output; a typed-then-deleted draft keeps the pane awake until the next turn, the safe direction).
//! Any refusal means nothing is recorded and nothing ends. When the window then does not end the pane
//! after all (its state changed in between), `agent_pane_unsleep` puts the live row back.

use crate::foreground::Front;
use serde_json::Value;
use std::time::Duration;

pub const ON_KEY: &str = "agentSleep";
/// Development builds only (the window reads the same key only under import.meta.env.DEV): a 20 second
/// delay so the sleep can be watched. A release build never reads it.
pub const TEST_FAST_KEY: &str = "agentSleepTestFast";
pub const IDLE_MIN_MINUTES: u32 = 5;
pub const IDLE_MAX_MINUTES: u32 = 240;
const FAST_DELAY: Duration = Duration::from_secs(20);

/// The switch: only a saved `true` turns it on; a missing key, another type or an old profile's own
/// sleep key reads as off.
pub fn sleep_on(settings: &Value) -> bool {
    settings.get(ON_KEY) == Some(&Value::Bool(true))
}

/// The delay the window asked for, held between 5 and 240 minutes whatever it sent; in a development
/// build (`dev`) with the test-only fast key saved, 20 seconds.
pub fn idle_delay(minutes: u32, settings: &Value, dev: bool) -> Duration {
    if dev && settings.get(TEST_FAST_KEY) == Some(&Value::Bool(true)) {
        return FAST_DELAY;
    }
    Duration::from_secs(60 * u64::from(minutes.clamp(IDLE_MIN_MINUTES, IDLE_MAX_MINUTES)))
}

/// The pane's terminal when the agent, and nothing else, is in front of it, else why the pane may not
/// sleep: no running terminal, a terminal that is gone, a plain shell or another program in front (the
/// agent exited, or the user typed something else), another agent in front, or a foreground that cannot
/// be told. `program` is what the terminal runs (the launch record first); `front` is the foreground
/// poll's last answer for it, none when it has not answered.
pub fn front_agent(attached: Option<u32>, program: impl Fn(u32) -> Option<Option<&'static str>>, front: impl Fn(u32) -> Option<Front>) -> Result<u32, String> {
    let Some(id) = attached else { return Err("the pane has no running terminal".into()) };
    let agent = match program(id) {
        None => return Err("the pane's terminal is gone".into()),
        Some(None) => return Err("no agent is in front of the pane's terminal".into()),
        Some(Some(a)) => a,
    };
    match front(id) {
        None => Ok(id),
        Some(Front::Agent(a)) if a == agent => Ok(id),
        Some(Front::Agent(other)) => Err(format!("another agent ({other}) is in front of the pane's terminal")),
        Some(Front::Shell) => Err("the agent is no longer in front of the pane's terminal".into()),
        Some(Front::Unknown) => Err("what is in front of the pane's terminal cannot be told".into()),
    }
}

/// The terminal must have neither printed nor been typed into for the delay (`quiet` is
/// `Terminals::still_for`); a gone terminal has no quiet time and may not sleep.
pub fn quiet_enough(quiet: Option<Duration>, idle: Duration) -> Result<(), String> {
    match quiet {
        None => Err("the pane's terminal is gone".into()),
        Some(q) if q < idle => Err(format!("the terminal printed or was typed in {} s ago, less than the delay", q.as_secs())),
        Some(_) => Ok(()),
    }
}

/// Typing after the turn finished is an unsent draft the window cannot see: `input` is how long ago the
/// terminal was last typed into (`Terminals::input_for`, none when never), `finished` how long ago the
/// live row entered its state. Kolux's own writes (a delivered prompt, an answered permission) come
/// before the next state change, so they never count as typing after it.
pub fn untouched_since_finish(input: Option<Duration>, finished: Duration) -> Result<(), String> {
    match input {
        Some(i) if i < finished => Err("the pane was typed into after the agent finished".into()),
        _ => Ok(()),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// What a sleep answers: the terminal the window ends, and the session id recorded for Wake.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Slept {
    pub terminal: u32,
    pub session: String,
}

/// The save step of agent sleep for pane `pane_key`, asked with the window's idle minutes: every check
/// above, then the session is recorded (saved::at_pane_sleep re-checks the live row), and the terminal
/// id and the recorded session come back so the window can end that terminal and later wake that
/// session. Any error means nothing was recorded and nothing may be ended.
#[tauri::command]
pub fn agent_pane_sleep(terminals: tauri::State<'_, crate::terminal::Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, pane_key: u32, idle_minutes: u32) -> Result<Slept, String> {
    let id = front_agent(terminals.attached(pane_key), |id| terminals.program(id), crate::foreground::found_front)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    let settings = store.settings();
    if !sleep_on(&settings) {
        return Err("agent sleep is off".into());
    }
    let idle = idle_delay(idle_minutes, &settings, cfg!(debug_assertions));
    quiet_enough(terminals.still_for(id), idle)?;
    let Some(live) = crate::hooks::agent_hooks::saved::live_row(pane_key) else { return Err("no status is known for this pane yet".into()) };
    untouched_since_finish(terminals.input_for(id), Duration::from_millis(now_ms().saturating_sub(live.at)))?;
    let row = crate::hooks::agent_hooks::saved::at_pane_sleep(&store, pane_key, idle)?;
    Ok(Slept { terminal: id, session: row.session_id.unwrap_or_default() })
}

/// The window checked again after `agent_pane_sleep` answered and found the pane changed (another state,
/// another terminal), so it ended nothing: the recorded row goes back among the live ones.
#[tauri::command]
pub fn agent_pane_unsleep(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, pane_key: u32, session: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let row = crate::hooks::agent_hooks::saved::record(&store).into_iter().find(|r| r.pane_key == pane_key && r.session_id.as_deref() == Some(session.as_str()));
    let Some(row) = row else { return Err("no recorded sleep for this pane".into()) };
    crate::hooks::agent_hooks::saved::unsleep(&store, row);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::agent_hooks::saved::{sleep_record, Row};
    use serde_json::json;

    const MIN: Duration = Duration::from_secs(60);
    const NOW: u64 = 100 * 60 * 1000;

    fn row(pane: u32, state: &str, session: Option<&str>) -> Row {
        Row { pane_key: pane, agent: "claude".into(), state: state.into(), at: 1, session_id: session.map(str::to_owned), cwd: Some("T:/t817".into()), stop: None, hook_version: None, pid: None, pid_started: None, children: Vec::new() }
    }
    /// A finished row, idle for an hour by NOW.
    fn finished(pane: u32, session: Option<&str>) -> Row {
        Row { at: NOW - 60 * 60 * 1000, ..row(pane, "done", session) }
    }
    fn ok_write(_: &[Row]) -> Result<(), String> {
        Ok(())
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
    fn t817_review_f3_the_delay_is_held_between_5_and_240_minutes_here_too_and_the_fast_key_is_development_only() {
        assert_eq!(idle_delay(30, &json!({}), false), 30 * MIN);
        assert_eq!(idle_delay(4, &json!({}), false), 5 * MIN, "a window asking for less than 5 gets 5");
        assert_eq!(idle_delay(0, &json!({}), false), 5 * MIN);
        assert_eq!(idle_delay(300, &json!({}), false), 240 * MIN);
        assert_eq!(idle_delay(30, &json!({ TEST_FAST_KEY: true }), false), 30 * MIN, "a release build never reads the fast key");
        assert_eq!(idle_delay(30, &json!({ TEST_FAST_KEY: true }), true), Duration::from_secs(20), "a development build does");
        assert_eq!(idle_delay(30, &json!({ TEST_FAST_KEY: "true" }), true), 30 * MIN, "only a real true");
    }

    #[test]
    fn t817_term123_the_pane_must_have_a_running_terminal_with_the_agent_and_nothing_else_in_front() {
        let claude = |_| Some(Some("claude"));
        assert_eq!(front_agent(None, claude, |_| None), Err("the pane has no running terminal".to_string()));
        assert_eq!(front_agent(Some(7), |_| None, |_| None), Err("the pane's terminal is gone".to_string()));
        assert_eq!(front_agent(Some(7), |_| Some(None), |_| None), Err("no agent is in front of the pane's terminal".to_string()), "a plain shell or another foreground command: never");
        assert_eq!(front_agent(Some(7), claude, |_| None), Ok(7), "the poll has not answered: the launch record decides");
        assert_eq!(front_agent(Some(7), claude, |_| Some(Front::Agent("claude"))), Ok(7));
        // Review F3: `program` prefers the launch record, so the poll's own answer is checked as well.
        assert_eq!(front_agent(Some(7), claude, |_| Some(Front::Agent("codex"))), Err("another agent (codex) is in front of the pane's terminal".to_string()));
        assert_eq!(front_agent(Some(7), claude, |_| Some(Front::Shell)), Err("the agent is no longer in front of the pane's terminal".to_string()));
        assert_eq!(front_agent(Some(7), claude, |_| Some(Front::Unknown)), Err("what is in front of the pane's terminal cannot be told".to_string()), "in doubt: awake");
    }

    #[test]
    fn t817_review_f3_the_terminal_must_be_quiet_for_the_delay_output_or_typing() {
        assert_eq!(quiet_enough(None, 30 * MIN), Err("the pane's terminal is gone".to_string()));
        assert_eq!(quiet_enough(Some(29 * MIN), 30 * MIN), Err("the terminal printed or was typed in 1740 s ago, less than the delay".to_string()));
        assert!(quiet_enough(Some(Duration::from_secs(3)), 30 * MIN).is_err(), "text typed straight into the agent's own box counts as activity");
        assert_eq!(quiet_enough(Some(30 * MIN), 30 * MIN), Ok(()), "exactly the delay counts");
        assert_eq!(quiet_enough(Some(31 * MIN), 30 * MIN), Ok(()));
    }

    #[test]
    fn t817_review_n1_typing_into_the_terminal_after_the_turn_finished_is_an_unsent_draft() {
        let finished = 40 * MIN;
        assert_eq!(untouched_since_finish(Some(10 * MIN), finished), Err("the pane was typed into after the agent finished".to_string()), "a draft typed into the agent's own prompt, or into an editor it opened, makes no output");
        assert!(untouched_since_finish(Some(Duration::from_secs(1)), finished).is_err());
        assert_eq!(untouched_since_finish(Some(45 * MIN), finished), Ok(()), "typed before the turn finished: the prompt that started it");
        assert_eq!(untouched_since_finish(Some(finished), finished), Ok(()), "Kolux's own write lands before the state change it causes");
        assert_eq!(untouched_since_finish(None, finished), Ok(()), "never typed");
    }

    #[test]
    fn t817_term123_sleep_records_the_panes_session_finished_and_replaces_the_same_session() {
        let mut written: Vec<Row> = Vec::new();
        let earlier = vec![row(1, "working", Some("t817-a")), row(2, "waiting", Some("t817-b"))];
        let out = sleep_record(Some(finished(9, Some("t817-b"))), false, NOW, 30 * MIN, earlier, |rows| {
            written = rows.to_vec();
            Ok(())
        });
        assert_eq!(out.as_ref().map(|r| (r.pane_key, r.session_id.as_deref())), Ok((9, Some("t817-b"))), "the recorded session comes back for Wake");
        let ids: Vec<(u32, &str)> = written.iter().map(|r| (r.pane_key, r.session_id.as_deref().unwrap())).collect();
        assert_eq!(ids, [(1, "t817-a"), (9, "t817-b")], "keyed by session as workspace sleep keys it; the finished row stays, since the pane itself wakes it");
        assert_eq!(written[1].state, "done");
        assert!(sleep_record(Some(Row { state: "idle".into(), ..finished(9, Some("t817-b")) }), false, NOW, 30 * MIN, Vec::new(), ok_write).is_ok(), "idle is finished too");
    }

    #[test]
    fn t817_review_f4_the_live_row_is_checked_again_here_finished_no_background_tasks_and_idle_for_the_delay() {
        let mut writes = 0;
        let mut count = |_: &[Row]| {
            writes += 1;
            Ok(())
        };
        for state in ["working", "queued", "blocked", "interrupted", "permission", "waiting"] {
            assert_eq!(sleep_record(Some(Row { state: state.into(), ..finished(3, Some("t817-d")) }), false, NOW, 30 * MIN, Vec::new(), &mut count), Err(format!("the agent's turn is not finished ({state})")));
        }
        assert_eq!(sleep_record(Some(finished(3, Some("t817-d"))), true, NOW, 30 * MIN, Vec::new(), &mut count), Err("background tasks are still going".to_string()), "STAT-024: done with background tasks is not finished");
        assert_eq!(sleep_record(Some(Row { at: NOW - 29 * 60 * 1000, ..finished(3, Some("t817-d")) }), false, NOW, 30 * MIN, Vec::new(), &mut count), Err("the agent changed state 1740 s ago, less than the delay".to_string()), "the window's minute-old decision is not trusted");
        assert!(sleep_record(Some(Row { at: NOW + 1000, ..finished(3, Some("t817-d")) }), false, NOW, 30 * MIN, Vec::new(), &mut count).is_err(), "a clock set back: in doubt, awake");
        assert_eq!(writes, 0, "nothing is written on a refusal");
        assert!(sleep_record(Some(Row { at: NOW - 30 * 60 * 1000, ..finished(3, Some("t817-d")) }), false, NOW, 30 * MIN, Vec::new(), ok_write).is_ok(), "exactly the delay counts");
    }

    #[test]
    fn t817_term123_no_session_means_nothing_is_recorded_and_nothing_may_end() {
        let mut writes = 0;
        let out = sleep_record(None, false, NOW, 30 * MIN, Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert_eq!(out, Err("no status is known for this pane yet".to_string()));
        let out = sleep_record(Some(finished(3, None)), false, NOW, 30 * MIN, Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert_eq!(out, Err("the agent has not reported a session that can be resumed".to_string()));
        let out = sleep_record(Some(finished(3, Some("  "))), false, NOW, 30 * MIN, Vec::new(), |_| {
            writes += 1;
            Ok(())
        });
        assert!(out.is_err(), "a blank id is no id");
        assert_eq!(writes, 0, "the record is never written for a pane with no session");
    }

    #[test]
    fn t817_term123_a_failed_save_skips_the_sleep() {
        let out = sleep_record(Some(finished(4, Some("t817-c"))), false, NOW, 30 * MIN, Vec::new(), |_| Err("disk full".into()));
        assert_eq!(out, Err("the session could not be recorded: disk full".to_string()), "the caller ends nothing on an error");
    }
}
