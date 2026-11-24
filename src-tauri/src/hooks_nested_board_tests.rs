// START-05 board tests (locked): a hook event from an agent started INSIDE a pane is not the pane's own.
use super::nested::{foreign_event, norm_path, same_or_ancestor};
use serde_json::json;

fn ev(cwd: Option<&str>, session: Option<&str>) -> serde_json::Value {
    let mut v = json!({ "hook_event_name": "SessionStart", "source": "startup" });
    if let Some(c) = cwd {
        v["cwd"] = json!(c);
    }
    if let Some(s) = session {
        v["session_id"] = json!(s);
    }
    v
}

const PANE: &str = r"C:\work\app";
const SID: &str = "11111111-aaaa";
const OTHER: &str = "22222222-bbbb";

#[test]
fn a_nested_agent_in_another_folder_is_foreign() {
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some(r"D:\elsewhere"), Some(OTHER))));
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some("/tmp/x"), Some(OTHER))));
}

#[test]
fn a_nested_agent_in_a_subfolder_or_worktree_is_foreign() {
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some(r"C:\work\app\.worktrees\lane"), Some(OTHER))));
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some(r"C:\work\app\sub"), Some(OTHER))));
}

#[test]
fn a_sibling_folder_sharing_a_prefix_is_not_an_ancestor() {
    assert!(!same_or_ancestor(r"C:\work\ap", PANE));
    assert!(!same_or_ancestor(r"C:\work\app2", PANE));
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some(r"C:\work\app2"), Some(OTHER))));
    assert!(foreign_event(Some(PANE), Some(SID), &ev(Some(r"C:\work\ap"), Some(OTHER))));
}

#[test]
fn the_panes_own_new_session_in_its_folder_or_above_is_kept() {
    // /clear or /resume in the same folder, or back at the pane's root after a cd into a subfolder.
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(Some(PANE), Some(OTHER))));
    assert!(!foreign_event(Some(r"C:\work\app\sub"), Some(SID), &ev(Some(PANE), Some(OTHER))));
    assert!(!foreign_event(Some(r"C:\work\app\sub"), Some(SID), &ev(Some(r"C:\"), Some(OTHER))));
}

#[test]
fn the_same_session_is_never_foreign_wherever_it_runs() {
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(Some(r"D:\elsewhere"), Some(SID))));
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(Some(r"D:\elsewhere"), Some(" 11111111-AAAA "))), "trimmed, letter case ignored");
}

#[test]
fn anything_unknown_keeps_the_event() {
    let far = Some(r"D:\elsewhere");
    assert!(!foreign_event(None, Some(SID), &ev(far, Some(OTHER))), "no known folder");
    assert!(!foreign_event(Some(""), Some(SID), &ev(far, Some(OTHER))), "blank known folder");
    assert!(!foreign_event(Some(PANE), None, &ev(far, Some(OTHER))), "no known session");
    assert!(!foreign_event(Some(PANE), Some("  "), &ev(far, Some(OTHER))), "blank known session");
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(None, Some(OTHER))), "event without cwd");
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(Some("   "), Some(OTHER))), "event with blank cwd");
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(far, None)), "event without session");
    assert!(!foreign_event(Some(PANE), Some(SID), &ev(far, Some(""))), "event with blank session");
    assert!(!foreign_event(Some(PANE), Some(SID), &json!({ "cwd": 5, "session_id": OTHER })), "cwd not a string");
}

#[test]
fn windows_spellings_of_one_folder_compare_equal() {
    assert_eq!(norm_path(r"\\?\C:\Work\App\"), norm_path("c:/work/app"));
    assert_eq!(norm_path(r"C:\Work\App\\"), "c:/work/app");
    assert_eq!(norm_path("/home/u/app/"), "/home/u/app");
    for spelled in [r"\\?\C:\work\app", "c:/WORK/app/", r"C:\work\app\", "C:/work/app"] {
        assert!(same_or_ancestor(spelled, PANE), "{spelled}");
        assert!(!foreign_event(Some(PANE), Some(SID), &ev(Some(spelled), Some(OTHER))), "{spelled}");
    }
    assert!(same_or_ancestor(r"\\?\C:\work", r"c:/work/app/sub"));
}
