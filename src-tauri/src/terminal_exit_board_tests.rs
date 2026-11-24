// START-04 board tests (locked): the log and the exit event tell a pane Kolux closed from a pane that ended.
use super::exit_note::{exit_line, exit_reason, tail_lines, CLOSED_BY_KOLUX, EXITED, EXIT_TAIL_LINES, LINE_MAX};
use super::exit_payload;

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn a_session_kolux_already_took_out_is_closed_by_kolux() {
    assert_eq!(CLOSED_BY_KOLUX, "closed-by-kolux");
    assert_eq!(EXITED, "exited");
    assert_eq!(exit_reason(false), CLOSED_BY_KOLUX);
    assert_eq!(exit_reason(true), EXITED);
}

#[test]
fn the_closed_line_says_closed_by_kolux_and_nothing_else() {
    let tail = s(&["some output"]);
    for code in [Some(1), Some(0), None] {
        let line = exit_line(7, CLOSED_BY_KOLUX, code, Some(12), Some("claude"), Some("C:/w"), &tail);
        assert_eq!(line, "terminal 7 closed by Kolux", "{code:?}");
    }
}

#[test]
fn a_real_exit_line_has_code_time_agent_folder_and_tail() {
    let line = exit_line(7, EXITED, Some(1), Some(12), Some("claude"), Some("C:/w"), &s(&["Error: boom", "bye"]));
    assert_eq!(line, "terminal 7 exited (code 1) after 12s, agent claude, folder C:/w, last output: Error: boom | bye");
    let bare = exit_line(3, EXITED, None, None, None, None, &[]);
    assert_eq!(bare, "terminal 3 exited (code unknown) after ?s, agent none, folder unknown");
    assert!(!bare.contains("last output"));
    let zero = exit_line(4, EXITED, Some(0), Some(0), Some("codex"), Some("/tmp/x"), &s(&["done"]));
    assert_eq!(zero, "terminal 4 exited (code 0) after 0s, agent codex, folder /tmp/x, last output: done");
}

#[test]
fn the_exit_line_is_always_one_line() {
    let line = exit_line(9, EXITED, Some(2), Some(5), Some("claude"), Some("C:/w"), &s(&["a\r\nb", "c\nd"]));
    assert!(!line.contains('\n') && !line.contains('\r'), "{line:?}");
}

#[test]
fn the_tail_keeps_the_last_lines_skipping_blanks() {
    let text = "one\ntwo\n\nthree\n   \nfour\n\n\n";
    assert_eq!(EXIT_TAIL_LINES, 3);
    assert_eq!(tail_lines(text, EXIT_TAIL_LINES), s(&["two", "three", "four"]));
    assert_eq!(tail_lines("only\n", 3), s(&["only"]));
    assert_eq!(tail_lines("a\nb\nc", 1), s(&["c"]));
    assert_eq!(tail_lines("trailing spaces   \n", 3), s(&["trailing spaces"]));
}

#[test]
fn an_empty_tail_is_empty() {
    assert!(tail_lines("", 3).is_empty());
    assert!(tail_lines("\n\n  \n\t\n", 3).is_empty());
    assert!(tail_lines("text", 0).is_empty());
}

#[test]
fn secrets_in_the_tail_are_masked() {
    let key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    let got = tail_lines(&format!("first\nexport TOKEN {key}\nlast"), 3);
    assert_eq!(got.len(), 3);
    assert!(got.iter().all(|l| !l.contains(key) && !l.contains("ghp_")), "{got:?}");
    assert!(got[1].contains(crate::mask::HIDDEN), "{got:?}");
    // Masked before it is cut: a key that starts just under the limit must not leave its prefix showing.
    let near = format!("{} {key}", "x".repeat(LINE_MAX - 10));
    let got = tail_lines(&near, 1);
    assert!(!got[0].contains("ghp_"), "{got:?}");
}

#[test]
fn a_long_line_is_cut_on_a_character_boundary() {
    assert_eq!(LINE_MAX, 200);
    let long = "é".repeat(1000);
    let got = tail_lines(&long, 1);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].chars().count(), LINE_MAX);
    assert!(got[0].ends_with('…'), "{:?}", got[0].chars().rev().take(4).collect::<String>());
    let exact = "y".repeat(LINE_MAX);
    assert_eq!(tail_lines(&exact, 1), vec![exact.clone()], "a line of exactly LINE_MAX is kept whole");
    let emoji = "🙂".repeat(LINE_MAX + 1);
    assert_eq!(tail_lines(&emoji, 1)[0].chars().count(), LINE_MAX);
}

#[test]
fn text_that_was_not_utf8_does_not_break_the_tail() {
    let lossy = String::from_utf8_lossy(&[0xff, 0xfe, b'o', b'k', b'\n', 0xc3, b'x']).into_owned();
    let got = tail_lines(&lossy, 3);
    assert_eq!(got.len(), 2);
    assert!(got[0].ends_with("ok"), "{got:?}");
    let line = exit_line(1, EXITED, Some(1), Some(1), None, None, &got);
    assert!(line.contains("ok"));
}

#[test]
fn the_exit_event_carries_what_a_banner_needs() {
    let tail = s(&["Error: boom", "No conversation found with session ID: x"]);
    let v = serde_json::to_value(exit_payload(5, Some(1), None, EXITED, &tail, Some(3))).unwrap();
    assert_eq!(v["id"], 5);
    assert_eq!(v["code"], 1);
    assert_eq!(v["outcome"], "exited");
    assert_eq!(v["reason"], "exited");
    assert_eq!(v["lastLine"], "No conversation found with session ID: x");
    assert_eq!(v["secs"], 3);
    assert!(v.get("session").is_none());

    let closed = serde_json::to_value(exit_payload(6, Some(1), Some("sid".into()), CLOSED_BY_KOLUX, &tail, Some(3))).unwrap();
    assert_eq!(closed["reason"], "closed-by-kolux");
    assert_eq!(closed["outcome"], "exited", "outcome keeps its ORCH-057 meaning");
    assert_eq!(closed["session"], "sid");
    assert!(closed.get("lastLine").is_none(), "no banner text for a pane Kolux closed: {closed}");

    let unknown = serde_json::to_value(exit_payload(8, None, None, EXITED, &[], None)).unwrap();
    assert_eq!(unknown["outcome"], "unverifiable");
    assert!(unknown["code"].is_null());
    assert!(unknown.get("lastLine").is_none() && unknown.get("secs").is_none(), "{unknown}");
}
