//! spec/04 agent status hooks: STAT-001, STAT-007, STAT-008, STAT-026, STAT-045 acceptance boxes.
//! Needs `hooks` and `status` public in lib.rs. Hook events are crafted by hand from the public
//! hook documentation; everything is in memory (no config file of any tool is read or written).

use base64::Engine;
use kolux_rs_lib::hooks::{answer, claude_change, codex_change, install_claude_hooks, reply_body, Request};
use kolux_rs_lib::status::{quiet_check, report, Agent, Session};
use serde_json::{json, Value};
use std::collections::HashMap;
use kolux_rs_lib::status::LIMIT_RESETS_AT;
use std::sync::atomic::Ordering;
use std::time::Duration;

fn ev(j: &str) -> Value {
    serde_json::from_str(j).unwrap()
}

/// The state the pane shows after the event, or "unchanged" when the event changes nothing.
fn feed(s: &mut Session, agent: Agent, j: &str) -> &'static str {
    s.apply(agent, &ev(j)).map(|(c, _)| c.state).unwrap_or("unchanged")
}

const PROMPT: &str = r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix the build"}"#;

fn ask(id: &str) -> String {
    format!(r#"{{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_use_id":"{id}","tool_input":{{"questions":[{{"question":"Which color should the button be?","options":[{{"label":"Red"}},{{"label":"Blue"}}]}}]}}}}"#)
}

// ---- STAT-007 ----

#[test]
fn stat007_box1_a_question_needs_you_and_the_next_tool_step_is_working_again() {
    let mut s = Session::default();
    assert_eq!(feed(&mut s, Agent::Claude, PROMPT), "working");
    let (c, _) = s.apply(Agent::Claude, &ev(&ask("t1"))).unwrap();
    assert_eq!(c.state, "waiting", "the question tool is waiting although no permission event follows");
    assert_eq!(c.ask.as_deref(), Some("Which color should the button be?"));
    assert_eq!(s.resolved(), "waiting");
    // the user answers; Claude carries on with its next tool step
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_use_id":"t2","tool_input":{"file_path":"button.css"}}"#), "working");
    assert_eq!(s.resolved(), "working");
    // the question tool's own finish also ends the wait
    let mut t = Session::default();
    feed(&mut t, Agent::Claude, PROMPT);
    feed(&mut t, Agent::Claude, &ask("t1"));
    assert_eq!(feed(&mut t, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"AskUserQuestion","tool_use_id":"t1"}"#), "working");
    // leaving plan mode waits too
    let mut p = Session::default();
    feed(&mut p, Agent::Claude, PROMPT);
    assert_eq!(feed(&mut p, Agent::Claude, r#"{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"1. edit"}}"#), "waiting");
}

#[test]
fn stat007_box2_a_manual_compact_settles_as_a_quiet_boundary_done() {
    let mut s = Session::default();
    feed(&mut s, Agent::Claude, PROMPT);
    let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PostCompact","trigger":"manual","compact_summary":"Fixed the build"}"#)).unwrap();
    assert_eq!((c.state, c.boundary), ("done", true), "a boundary, not a finished task");
    assert_eq!(s.resolved(), "done");
    // the status the window hears carries the boundary mark that silences notifications
    let status = report(9_104_071, Some(9_104_071), Agent::Claude, &ev(PROMPT)).unwrap();
    assert_eq!(status.change.state, "working");
    let status = report(9_104_071, Some(9_104_071), Agent::Claude, &ev(r#"{"hook_event_name":"PostCompact","trigger":"manual"}"#)).unwrap();
    let sent = serde_json::to_value(&status).unwrap();
    assert_eq!((sent["state"].as_str(), sent["boundary"].as_bool(), sent.get("child")), (Some("done"), Some(true), None));
    // an automatic compaction changes nothing
    let mut a = Session::default();
    feed(&mut a, Agent::Claude, PROMPT);
    assert_eq!(feed(&mut a, Agent::Claude, r#"{"hook_event_name":"PostCompact","trigger":"auto"}"#), "unchanged");
    assert_eq!(a.resolved(), "working");
    // the before-compact event is not registered, and is not read if it arrives
    assert!(claude_change(&ev(r#"{"hook_event_name":"PreCompact","trigger":"manual"}"#)).is_none());
    let mut settings = json!({});
    assert!(install_claude_hooks(&mut settings, "kolux-hook.cmd"));
    let mut events: Vec<&str> = settings["hooks"].as_object().unwrap().keys().map(String::as_str).collect();
    events.sort_unstable();
    let mut expected = vec!["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "TeammateIdle", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PostCompact"];
    expected.sort_unstable();
    assert_eq!(events, expected);
}

#[test]
fn stat007_box3_a_reply_that_ends_while_a_subagent_or_background_shell_runs_stays_working() {
    let mut s = Session::default();
    feed(&mut s, Agent::Claude, PROMPT);
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"SubagentStart","agent_id":"sub1","agent_type":"code-reviewer"}"#), "working");
    let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"Stop","last_assistant_message":"Handing this to the reviewer."}"#)).unwrap();
    assert_eq!(c.state, "working", "Stop while a child agent runs");
    assert_eq!(s.resolved(), "working");
    let (c, announced) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"sub1","last_assistant_message":"Two findings."}"#)).unwrap();
    assert_eq!((c.state, announced.as_deref()), ("done", Some("code-reviewer")), "the pane settles once the child finishes");
    // a background shell still running at Stop keeps the session working too
    let mut b = Session::default();
    feed(&mut b, Agent::Claude, PROMPT);
    assert_eq!(feed(&mut b, Agent::Claude, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"bg1","command":"npm run watch"}]}"#), "working");
    assert_eq!(feed(&mut b, Agent::Claude, r#"{"hook_event_name":"Stop","background_tasks":[]}"#), "done");
}

// ---- STAT-026 ----

#[test]
fn stat026_box1_the_lead_shows_working_until_the_child_finishes() {
    for agent in [Agent::Claude, Agent::Codex] {
        let mut s = Session::default();
        feed(&mut s, agent, PROMPT);
        feed(&mut s, agent, r#"{"hook_event_name":"SubagentStart","agent_id":"sub1","agent_type":"explorer","model":"opus"}"#);
        assert_eq!(feed(&mut s, agent, r#"{"hook_event_name":"Stop","last_assistant_message":"Waiting on the explorer."}"#), "working", "{agent:?}: the lead ended its turn, the child still works");
        assert_eq!(s.children.len(), 1);
        assert_eq!((s.children[0].kind.as_str(), s.children[0].model.as_deref()), ("explorer", Some("opus")), "children are listed with role and model");
        assert_eq!(feed(&mut s, agent, r#"{"hook_event_name":"SubagentStop","agent_id":"sub1","last_assistant_message":"Found it."}"#), "done", "{agent:?}: done when the child finishes");
        assert!(s.children.is_empty());
    }
}

#[test]
fn stat026_box2_a_teammates_permission_raises_needs_you_and_going_idle_clears_it() {
    let mut s = Session::default();
    feed(&mut s, Agent::Claude, PROMPT);
    feed(&mut s, Agent::Claude, r#"{"hook_event_name":"SubagentStart","agent_id":"mate1","agent_type":"researcher"}"#);
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"Stop"}"#), "working");
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"PermissionRequest","agent_id":"mate1","tool_name":"Bash","tool_input":{"command":"cargo test"}}"#), "permission", "the lead shows needs you");
    assert_eq!(s.resolved(), "permission");
    // unrelated progress by the lead never clears the child's permission
    feed(&mut s, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#);
    assert_eq!(s.resolved(), "permission");
    // the teammate goes idle: the wait clears; the lead is back on its own state (mid-turn, working)
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"TeammateIdle","teammate_name":"mate1"}"#), "working");
    assert_eq!(s.children[0].state, "idle");
    assert_eq!(feed(&mut s, Agent::Claude, r#"{"hook_event_name":"Stop"}"#), "done", "an idle teammate never keeps the lead working");
}

// ---- STAT-001 / STAT-008: the whole path from a hook's POST to the status the window hears ----

fn post(path: &str, pane: u32, terminal: u32, token: &str, body: &str) -> Request {
    let identity = base64::engine::general_purpose::STANDARD.encode(json!({ "paneKey": pane, "terminal": terminal }).to_string());
    let mut headers = HashMap::new();
    // T-793 (DT-C228): a pane's hook token is the run secret's HMAC for that pane, never the secret itself.
    headers.insert("x-kolux-token".to_string(), kolux_rs_lib::hooks::pane_token(token, pane, Some(terminal)));
    headers.insert("x-kolux-pane".to_string(), identity);
    Request { path: path.to_string(), headers, body: body.as_bytes().to_vec() }
}

#[test]
fn stat001_box2_a_permission_request_changes_the_pane_to_needs_you() {
    let (p1, p2) = (9_104_011, 9_104_012);
    let working = answer(&post("/claude", p1, p1, "secret", PROMPT), "secret");
    assert_eq!((working.0, working.1.as_ref().map(|s| s.change.state)), (200, Some("working")));
    let asked = answer(&post("/claude", p1, p1, "secret", r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}"#), "secret");
    let status = asked.1.unwrap();
    assert_eq!((asked.0, status.pane_key, status.change.state), (200, p1, "permission"));
    // the TypeScript header turns "permission" into the word "Needs you" (src/terminal/status.test.ts)
    // two agents never confused: another pane's prompt leaves this pane's state alone
    let other = answer(&post("/claude", p2, p2, "secret", PROMPT), "secret").1.unwrap();
    assert_eq!((other.pane_key, other.change.state), (p2, "working"));
    let again = answer(&post("/claude", p1, p1, "secret", r#"{"hook_event_name":"PostToolUse","tool_name":"Edit"}"#), "secret");
    assert!(again.1.is_none(), "a different tool carrying on changes nothing");
    let same = answer(&post("/claude", p1, p1, "secret", r#"{"hook_event_name":"PostToolUse","tool_name":"Bash"}"#), "secret").1.unwrap();
    assert_eq!((same.pane_key, same.change.state), (p1, "working"), "that same tool carrying on clears the wait");
    // a caller without the token is refused and changes nothing
    let refused = answer(&post("/claude", p1, p1, "wrong", PROMPT), "secret");
    assert!(refused.0 == 403 && refused.1.is_none());
}

#[test]
fn stat008_box2_a_codex_command_needs_you_and_kolux_never_answers_the_approval() {
    let pane = 9_104_081;
    let working = answer(&post("/codex", pane, pane, "secret", r#"{"hook_event_name":"UserPromptSubmit","prompt":"run the tests"}"#), "secret").1.unwrap();
    assert_eq!(working.change.state, "working");
    let body = r#"{"hook_event_name":"PermissionRequest","tool_name":"shell","tool_input":{"command":"cargo build --release"}}"#;
    let asked = answer(&post("/codex", pane, pane, "secret", body), "secret").1.unwrap();
    assert_eq!(asked.change.state, "permission");
    assert_eq!(asked.change.detail.as_deref(), Some("cargo build --release"), "shows what the tool wants to do");
    let change = codex_change(&ev(body)).unwrap();
    assert_eq!((change.state, change.tool.as_deref()), ("permission", Some("shell")));
    // the hook's reply is "no opinion": no allow, no deny, so Codex asks the user itself
    let reply: Value = serde_json::from_str(&reply_body("/codex", body.as_bytes(), &json!({}))).unwrap();
    assert_eq!(reply, json!({}));
}

// ---- STAT-045 ----

/// quiet_check visits every session in the process, so the two tests below take turns.
static QUIET_TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn silent_for(terminal: u32, d: Duration) -> impl Fn(u32) -> Option<Duration> {
    move |id| (id == terminal).then_some(d)
}

/// MIRROR src-tauri/src/lib.rs:446 `(minutes > 0).then(...)` (the setup thread's conversion of the saved minutes).
fn threshold(minutes: u64) -> Option<Duration> {
    (minutes > 0).then(|| Duration::from_secs(minutes * 60))
}

#[test]
fn stat045_box1_one_alert_per_silent_spell_after_the_threshold() {
    let _turn = QUIET_TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (pane, term) = (9_104_451, 9_104_451);
    report(pane, Some(term), Agent::Claude, &ev(PROMPT)).unwrap();
    let t = threshold(1);
    assert_eq!(t, Some(Duration::from_secs(60)));
    let fired = |d: u64| quiet_check(t, silent_for(term, Duration::from_secs(d))).contains(&pane);
    assert!(!fired(59), "59 seconds of silence is under a minute");
    assert!(fired(60), "one alert at a minute");
    assert!(!fired(90) && !fired(600), "no more while the silence goes on");
    assert!(!fired(2), "output resumed: the clock restarts");
    assert!(!fired(30));
    assert!(fired(61), "silent again for a minute: a second alert");
    assert!(!fired(120));
}

#[test]
fn stat045_box2_a_threshold_of_zero_raises_no_quiet_alert_and_leaving_working_cancels_it() {
    let _turn = QUIET_TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (pane, term) = (9_104_452, 9_104_452);
    report(pane, Some(term), Agent::Claude, &ev(PROMPT)).unwrap();
    assert_eq!(threshold(0), None);
    for hours in [1, 5, 48] {
        assert!(!quiet_check(threshold(0), silent_for(term, Duration::from_secs(hours * 3600))).contains(&pane), "0 switches the alert off");
    }
    // the same silence with the alert on does fire, so the zero above is what held it back
    assert!(quiet_check(threshold(10), silent_for(term, Duration::from_secs(3600))).contains(&pane));
    // a pane that stopped working is never reported
    let (done_pane, done_term) = (9_104_453, 9_104_453);
    report(done_pane, Some(done_term), Agent::Claude, &ev(PROMPT)).unwrap();
    report(done_pane, Some(done_term), Agent::Claude, &ev(r#"{"hook_event_name":"Stop"}"#)).unwrap();
    assert!(!quiet_check(threshold(1), silent_for(done_term, Duration::from_secs(7200))).contains(&done_pane));
}

#[test]
fn stat041_the_status_a_codex_stop_sends_carries_its_reply_and_no_boundary() {
    let pane = 9_104_411;
    report(pane, Some(pane), Agent::Codex, &ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix the parser"}"#)).unwrap();
    let done = report(pane, Some(pane), Agent::Codex, &ev(r#"{"hook_event_name":"Stop","last_assistant_message":"All 14 tests pass.\n\nShipped the fix to the parser."}"#)).unwrap();
    let sent = serde_json::to_value(&done).unwrap();
    assert_eq!((sent["state"].as_str(), sent["boundary"].as_bool(), sent["interrupted"].as_bool()), (Some("done"), Some(false), Some(false)));
    assert!(sent["reply"].as_str().is_some_and(|r| r.contains("All 14 tests pass.") && r.contains("Shipped the fix to the parser.")));
}

// ---- STAT-022 / STAT-023 ----

fn status(pane: u32, j: &str) -> Option<Value> {
    report(pane, None, Agent::Claude, &ev(j)).map(|s| serde_json::to_value(s).unwrap())
}

const STOP_LIMIT: &str = r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"5-hour limit"}"#;
const STOP_SIGNIN: &str = r#"{"hook_event_name":"StopFailure","error":"authentication_failed"}"#;
const FINISH: &str = r#"{"hook_event_name":"Stop"}"#;

#[test]
fn stat022_box1_a_rate_limit_failure_is_a_blocked_status_with_cause_limit_and_the_reset_time() {
    let ahead = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 + 3_600_000;
    LIMIT_RESETS_AT.store(ahead, Ordering::Relaxed);
    status(90221, PROMPT).unwrap();
    let blocked = status(90221, STOP_LIMIT).unwrap();
    LIMIT_RESETS_AT.store(0, Ordering::Relaxed);
    // The status the window gets: blocked (never done), the cause, the agent's words, the reset time.
    assert_eq!(blocked["state"], "blocked");
    assert_eq!(blocked["stop"], json!({"cause": "limit", "detail": "5-hour limit", "resetsAt": ahead}));
    // A sign-in or provider failure carries its own cause and no reset time.
    status(90222, PROMPT).unwrap();
    assert_eq!(status(90222, STOP_SIGNIN).unwrap()["stop"], json!({"cause": "signin"}));
    status(90223, PROMPT).unwrap();
    assert_eq!(status(90223, r#"{"hook_event_name":"StopFailure","error":"server_error"}"#).unwrap()["stop"], json!({"cause": "error"}));
    // A failure report with no error attached is not a stop at all.
    status(90224, PROMPT).unwrap();
    assert!(status(90224, r#"{"hook_event_name":"StopFailure"}"#).is_none());
}

#[test]
fn stat022_box2_a_later_prompt_that_completes_drops_the_stop() {
    status(90225, PROMPT).unwrap();
    assert_eq!(status(90225, STOP_SIGNIN).unwrap()["stop"]["cause"], "signin");
    let again = status(90225, r#"{"hook_event_name":"UserPromptSubmit","prompt":"try again"}"#).unwrap();
    assert_eq!(again["state"], "working");
    assert_eq!(again["stop"]["cause"], "signin", "still attached until the turn finishes");
    let done = status(90225, FINISH).unwrap();
    assert_eq!(done["state"], "done");
    assert!(done.get("stop").is_none(), "the stop reason is gone once the turn completes");
}

#[test]
fn stat023_box1_a_second_failure_in_the_episode_changes_nothing_so_no_second_stop_is_raised() {
    let mut s = Session::default();
    assert_eq!(feed(&mut s, Agent::Claude, PROMPT), "working");
    assert_eq!(feed(&mut s, Agent::Claude, STOP_SIGNIN), "blocked");
    let first = s.stop.clone();
    assert_eq!(first.as_ref().map(|t| t.cause), Some("signin"));
    // The second report leaves the state and the stop as they were; the window sees blocked -> blocked.
    assert_eq!(feed(&mut s, Agent::Claude, STOP_SIGNIN), "blocked");
    assert_eq!(s.stop, first);
    assert_eq!(s.history.iter().filter(|e| e.state == "blocked").count(), 1, "one episode, one history line");
}

#[test]
fn stat023_box2_a_normal_finish_is_done_with_no_stop_attached() {
    let mut s = Session::default();
    feed(&mut s, Agent::Claude, PROMPT);
    assert_eq!(feed(&mut s, Agent::Claude, FINISH), "done");
    assert!(s.stop.is_none());
    assert!(status(90226, PROMPT).is_some());
    assert!(status(90226, FINISH).unwrap().get("stop").is_none());
}
