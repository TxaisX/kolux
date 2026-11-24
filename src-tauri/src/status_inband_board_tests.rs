//! LAG-05 (board card LAG-05-SCAN): an in-band status (the prompt scan every 1.5 s, or an OSC 9999
//! line a program prints) is sent to the window only when the pane's status actually changed.
//! Counts, not clocks: every test drives `inband_emit` with a counting emitter, no app handle.
//! Each test uses its own pane keys (0x4C05_00xx), so the shared session map is never contended.

use super::*;
use std::cell::RefCell;

const BASE: u32 = 0x4C05_0000;

/// One in-band report for `pane`; the emitter records the state it was handed and says "sent".
fn tell(pane: u32, data: &str, sent: &RefCell<Vec<&'static str>>) -> bool {
    inband_emit(pane, None, data, |s: &Status| {
        sent.borrow_mut().push(s.change.state);
        true
    })
}

fn forget(pane: u32) {
    with_sessions(|s| s.remove(&pane));
}

#[test]
fn a_prompt_that_stays_open_is_sent_once() {
    let pane = BASE + 1;
    let sent = RefCell::new(Vec::new());
    let first = tell(pane, r#"{"state":"permission"}"#, &sent);
    let rest: Vec<bool> = (0..9).map(|_| tell(pane, r#"{"state":"permission"}"#, &sent)).collect();
    forget(pane);
    assert_eq!(*sent.borrow(), vec!["permission"], "ten scans that see the same open prompt send one agent-status event");
    assert!(first, "the first report moved the status and was sent");
    assert_eq!(rest, vec![false; 9], "a report that moved nothing returns false");
}

#[test]
fn a_real_change_is_sent_exactly_once_more() {
    let pane = BASE + 2;
    let sent = RefCell::new(Vec::new());
    for _ in 0..5 {
        tell(pane, r#"{"state":"permission"}"#, &sent);
    }
    for _ in 0..5 {
        tell(pane, r#"{"state":"working"}"#, &sent);
    }
    for _ in 0..3 {
        tell(pane, r#"{"state":"waiting"}"#, &sent);
    }
    let back = tell(pane, r#"{"state":"permission"}"#, &sent);
    forget(pane);
    assert_eq!(*sent.borrow(), vec!["permission", "working", "waiting", "permission"], "each real change is sent once, repeats are not");
    assert!(back, "a change back to an earlier state is a change");
}

#[test]
fn a_new_pane_is_sent_even_when_it_reads_working() {
    // A pane with no session reads "working" already; its first in-band report still makes the
    // session, so the window must hear of it once.
    let pane = BASE + 3;
    let sent = RefCell::new(Vec::new());
    let first = tell(pane, r#"{"state":"working"}"#, &sent);
    for _ in 0..4 {
        tell(pane, r#"{"state":"working"}"#, &sent);
    }
    forget(pane);
    assert!(first);
    assert_eq!(*sent.borrow(), vec!["working"]);
}

#[test]
fn a_bad_payload_is_never_sent_and_makes_no_session() {
    let pane = BASE + 4;
    let sent = RefCell::new(Vec::new());
    assert!(!tell(pane, "not json", &sent));
    assert!(!tell(pane, r#"{"state":"dancing"}"#, &sent));
    assert!(sent.borrow().is_empty(), "nothing parsed, nothing sent");
    assert!(with_sessions(|s| !s.contains_key(&pane)), "a bad payload makes no session");
    assert!(tell(pane, r#"{"state":"working"}"#, &sent), "the first good report is still news");
    forget(pane);
    assert_eq!(*sent.borrow(), vec!["working"]);
}

#[test]
fn the_call_returns_what_the_emitter_returns() {
    let pane = BASE + 5;
    let calls = RefCell::new(0u32);
    let failed = inband_emit(pane, None, r#"{"state":"waiting"}"#, |_s: &Status| {
        *calls.borrow_mut() += 1;
        false
    });
    let again = inband_emit(pane, None, r#"{"state":"waiting"}"#, |_s: &Status| {
        *calls.borrow_mut() += 1;
        true
    });
    forget(pane);
    assert!(!failed, "the emitter said the send failed");
    assert!(!again, "nothing moved, nothing sent");
    assert_eq!(*calls.borrow(), 1, "the emitter is asked once per change");
}

#[test]
fn a_hook_report_in_between_is_noticed() {
    // The decision follows the pane's session, which hooks move too, not a private copy of what the
    // in-band path sent last.
    let pane = BASE + 6;
    let sent = RefCell::new(Vec::new());
    tell(pane, r#"{"state":"permission"}"#, &sent);
    tell(pane, r#"{"state":"permission"}"#, &sent);
    let hook: Value = serde_json::from_str(r#"{"hook_event_name":"UserPromptSubmit","prompt":"next"}"#).unwrap();
    let moved = report(pane, None, Agent::Claude, &hook).map(|s| s.change.state);
    let again = tell(pane, r#"{"state":"permission"}"#, &sent);
    forget(pane);
    assert_eq!(moved, Some("working"), "the hook moved the pane to working");
    assert!(again, "an in-band permission after the hook's working is a change");
    assert_eq!(*sent.borrow(), vec!["permission", "permission"]);
}
