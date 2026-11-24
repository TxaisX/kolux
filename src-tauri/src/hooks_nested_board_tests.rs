// START-05 board tests (locked): a hook event from an agent started INSIDE a pane is not the pane's own.
use super::nested::{ends_known, foreign_event, norm_path, same_or_ancestor};
use serde_json::json;

fn ev(cwd: Option<&str>, session: Option<&str>) -> serde_json::Value {
    let mut v = json!({ "hook_event_name": "PostToolUse", "tool_name": "Bash" });
    if let Some(c) = cwd {
        v["cwd"] = json!(c);
    }
    if let Some(s) = session {
        v["session_id"] = json!(s);
    }
    v
}

fn start(cwd: Option<&str>, session: Option<&str>) -> serde_json::Value {
    let mut v = ev(cwd, session);
    v["hook_event_name"] = json!("SessionStart");
    v["source"] = json!("startup");
    v
}

const PANE: &str = r"C:\work\app";
const SID: &str = "11111111-aaaa";
const OTHER: &str = "22222222-bbbb";

#[test]
fn a_nested_agent_in_another_folder_is_foreign() {
    assert!(foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"D:\elsewhere"), Some(OTHER))));
    assert!(foreign_event(Some(PANE), Some(SID), false, &ev(Some("/tmp/x"), Some(OTHER))));
}

#[test]
fn a_folder_below_the_panes_own_counts_as_inside() {
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"C:\work\app\.worktrees\lane"), Some(OTHER))));
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"C:\work\app\sub"), Some(OTHER))));
}

#[test]
fn a_sibling_folder_sharing_a_prefix_is_not_an_ancestor() {
    assert!(!same_or_ancestor(r"C:\work\ap", PANE));
    assert!(!same_or_ancestor(r"C:\work\app2", PANE));
    assert!(foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"C:\work\app2"), Some(OTHER))));
    assert!(foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"C:\work\ap"), Some(OTHER))));
}

#[test]
fn the_panes_own_new_session_in_its_folder_or_above_is_kept() {
    // /clear or /resume in the same folder, or back at the pane's root after a cd into a subfolder.
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(PANE), Some(OTHER))));
    assert!(!foreign_event(Some(r"C:\work\app\sub"), Some(SID), false, &ev(Some(PANE), Some(OTHER))));
    assert!(!foreign_event(Some(r"C:\work\app\sub"), Some(SID), false, &ev(Some(r"C:\"), Some(OTHER))));
}

#[test]
fn the_same_session_is_never_foreign_wherever_it_runs() {
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"D:\elsewhere"), Some(SID))));
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"D:\elsewhere"), Some(" 11111111-AAAA "))), "trimmed, letter case ignored");
}

#[test]
fn anything_unknown_keeps_the_event() {
    let far = Some(r"D:\elsewhere");
    assert!(!foreign_event(None, Some(SID), false, &ev(far, Some(OTHER))), "no known folder");
    assert!(!foreign_event(Some(""), Some(SID), false, &ev(far, Some(OTHER))), "blank known folder");
    assert!(!foreign_event(Some(PANE), None, false, &ev(far, Some(OTHER))), "no known session");
    assert!(!foreign_event(Some(PANE), Some("  "), false, &ev(far, Some(OTHER))), "blank known session");
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(None, Some(OTHER))), "event without cwd");
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some("   "), Some(OTHER))), "event with blank cwd");
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(far, None)), "event without session");
    assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(far, Some(""))), "event with blank session");
    assert!(!foreign_event(Some(PANE), Some(SID), false, &json!({ "cwd": 5, "session_id": OTHER })), "cwd not a string");
}

#[test]
fn windows_spellings_of_one_folder_compare_equal() {
    assert_eq!(norm_path(r"\\?\C:\Work\App\"), norm_path("c:/work/app"));
    assert_eq!(norm_path(r"C:\Work\App\\"), "c:/work/app");
    assert_eq!(norm_path("/home/u/app/"), "/home/u/app");
    for spelled in [r"\\?\C:\work\app", "c:/WORK/app/", r"C:\work\app\", "C:/work/app"] {
        assert!(same_or_ancestor(spelled, PANE), "{spelled}");
        assert!(!foreign_event(Some(PANE), Some(SID), false, &ev(Some(spelled), Some(OTHER))), "{spelled}");
    }
    assert!(same_or_ancestor(r"\\?\C:\work", r"c:/work/app/sub"));
}

#[test]
fn f1_a_restarted_agent_is_the_panes_own_and_an_ended_session_frees_the_pane() {
    // A claude started again in the pane (here in a sibling folder) replaces the dead session.
    assert!(!foreign_event(Some(PANE), Some(SID), false, &start(Some(r"C:\work\other"), Some(OTHER))));
    assert!(!foreign_event(Some(PANE), Some(SID), false, &start(Some(r"D:\elsewhere"), Some(OTHER))));
    // A nested agent's SessionStart is still the pane's own by that rule, but its working events are not.
    assert!(foreign_event(Some(PANE), Some(SID), false, &ev(Some(r"D:\elsewhere"), Some(OTHER))));
    // Once the known session ended, nothing is foreign.
    assert!(!foreign_event(Some(PANE), Some(SID), true, &ev(Some(r"D:\elsewhere"), Some(OTHER))));
    // A SessionEnd from the known session is that end; one from another session or a sub-agent is not.
    assert!(ends_known(Some(SID), &json!({ "hook_event_name": "SessionEnd", "session_id": SID })));
    assert!(ends_known(Some(SID), &json!({ "hook_event_name": "SessionEnd", "session_id": " 11111111-AAAA " })), "trimmed, letter case ignored");
    assert!(!ends_known(Some(SID), &json!({ "hook_event_name": "SessionEnd", "session_id": OTHER })));
    assert!(!ends_known(Some(SID), &json!({ "hook_event_name": "Stop", "session_id": SID })));
    assert!(!ends_known(Some(SID), &json!({ "hook_event_name": "SessionEnd", "session_id": SID, "agent_id": "a1" })), "a sub-agent's end says nothing about the lead");
    assert!(!ends_known(None, &json!({ "hook_event_name": "SessionEnd", "session_id": SID })));
}
