// START-01 board tests (locked): a restored Claude pane resumes only a conversation that was saved.
use super::*;
use crate::sessions::list::Roots;
use std::fs;
use std::path::PathBuf;

const USER: &str = "{\"type\":\"user\",\"cwd\":\"/w\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n";

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-start01-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("projects").join("C--w")).unwrap();
    d
}

fn claude_roots(root: &std::path::Path) -> Roots {
    Roots { claude: vec![root.to_path_buf()], codex: vec![] }
}

fn has_resume(args: &[String], sid: &str) -> bool {
    args.windows(2).any(|w| w[0] == "--resume" && w[1] == sid)
}

#[test]
fn a_saved_claude_conversation_resumes() {
    let root = tmp("saved");
    fs::write(root.join("projects").join("C--w").join("abc-123.jsonl"), USER).unwrap();
    let roots = claude_roots(&root);
    let (start, log) = restorable(&roots, "claude", Start::Restore(Some("abc-123")));
    assert_eq!(start, Start::Restore(Some("abc-123")));
    assert!(log.is_none(), "a resume that goes ahead logs nothing: {log:?}");
    let line = start_line_as(&serde_json::json!({}), "claude", &[], "", true, start).unwrap();
    assert!(has_resume(&line.args, "abc-123"), "{:?}", line.args);
    assert!(line.resumed);
    // A second root that holds it is found too (managed accounts are extra roots).
    let empty = tmp("saved-empty");
    let two = Roots { claude: vec![empty.clone(), root.clone()], codex: vec![] };
    assert_eq!(restorable(&two, "claude", Start::Restore(Some("abc-123"))).0, Start::Restore(Some("abc-123")));
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&empty);
}

#[test]
fn a_claude_id_with_no_transcript_starts_fresh_and_says_so() {
    let root = tmp("absent");
    fs::write(root.join("projects").join("C--w").join("other-id.jsonl"), USER).unwrap();
    let roots = claude_roots(&root);
    let (start, log) = restorable(&roots, "claude", Start::Restore(Some("abc-123")));
    assert_eq!(start, Start::Restore(None), "no saved conversation: restored without resume");
    let log = log.expect("a skipped resume writes one log line");
    assert!(log.starts_with("resume skipped: agent claude"), "{log}");
    assert!(log.contains("abc-123") && log.contains("starting fresh"), "{log}");
    assert!(!log.contains('\n'), "one line: {log}");
    let line = start_line_as(&serde_json::json!({}), "claude", &[], "", true, start).unwrap();
    assert!(line.args.iter().all(|a| a != "--resume" && a != "abc-123"), "{:?}", line.args);
    assert!(!line.resumed);
    // No Claude folder known at all: still fresh.
    let (start, log) = restorable(&Roots::default(), "claude", Start::Restore(Some("abc-123")));
    assert_eq!(start, Start::Restore(None));
    assert!(log.is_some());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_folder_named_like_the_transcript_is_not_a_saved_conversation() {
    let root = tmp("dir");
    fs::create_dir_all(root.join("projects").join("C--w").join("abc-123.jsonl")).unwrap();
    fs::create_dir_all(root.join("projects").join("C--w").join("abc-123")).unwrap();
    let (start, log) = restorable(&claude_roots(&root), "claude", Start::Restore(Some("abc-123")));
    assert_eq!(start, Start::Restore(None));
    assert!(log.is_some());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_blank_or_missing_id_is_no_id_and_logs_nothing() {
    let root = tmp("blank");
    // A file literally named ".jsonl" must not make an empty id look saved.
    fs::write(root.join("projects").join("C--w").join(".jsonl"), USER).unwrap();
    let roots = claude_roots(&root);
    for given in [Some(""), Some("   "), None] {
        assert_eq!(restorable(&roots, "claude", Start::Restore(given)), (Start::Restore(None), None), "{given:?}");
    }
    assert_eq!(restorable(&roots, "claude", Start::Fresh), (Start::Fresh, None));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn an_unsafe_id_never_resumes_even_when_a_file_would_match() {
    let root = tmp("unsafe");
    // `../escape` joined under a project folder lands on projects/escape.jsonl.
    fs::write(root.join("projects").join("escape.jsonl"), USER).unwrap();
    let roots = claude_roots(&root);
    for bad in ["../escape", "-escape", "a b"] {
        let (start, log) = restorable(&roots, "claude", Start::Restore(Some(bad)));
        assert_eq!(start, Start::Restore(None), "{bad}");
        assert!(log.is_some(), "{bad}");
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn other_agents_keep_their_restore_unchanged() {
    // No transcript anywhere: only Claude is checked; every other agent keeps today's behaviour.
    for id in ["codex", "gemini", "copilot", "kiro", "aider", "opencode", "hermes", "crush"] {
        assert_eq!(restorable(&Roots::default(), id, Start::Restore(Some("sid"))), (Start::Restore(Some("sid")), None), "{id}");
        assert_eq!(restorable(&Roots::default(), id, Start::Restore(None)), (Start::Restore(None), None), "{id}");
        assert_eq!(restorable(&Roots::default(), id, Start::Fresh), (Start::Fresh, None), "{id}");
    }
}
