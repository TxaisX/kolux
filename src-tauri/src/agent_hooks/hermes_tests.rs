//! T-121 (STAT-016): Hermes's marked YAML blocks and its events; its allowlist is only ever read
//! (Hermes consent = let Hermes ask, Txais 2026-10-20).

use super::*;

const CANNED: &str = "# my Hermes settings\nmodel:\n  default: hermes-4 # keep\nhooks:\n  # my own guard\n  pre_tool_call:\n    - matcher: \"terminal\"\n      command: \"~/.hermes/agent-hooks/block.sh\"\n      timeout: 5\n  post_tool_call:\nhooks_auto_accept: false\n";
const ALLOW: &str = "{\n  \"approvals\": [\n    {\n      \"event\": \"post_llm_call\",\n      \"command\": \"/home/me/hook.py\"\n    }\n  ]\n}\n";

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-t121-hermes-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join(".hermes")).unwrap();
    d
}

fn read(p: &Path) -> String {
    fs::read_to_string(p).unwrap()
}

fn approvals(p: &Path) -> Vec<Value> {
    serde_json::from_str::<Value>(&read(p)).unwrap()["approvals"].as_array().unwrap().clone()
}

#[test]
fn stat_016_install_keeps_the_users_yaml_and_removal_gives_it_back_byte_for_byte() {
    let home = scratch("keep");
    let (file, allow) = (file(&home), allow_file(&home));
    assert_eq!(file, home.join(".hermes").join("config.yaml"), "a scratch home keeps Hermes's home inside it");
    fs::write(&file, CANNED).unwrap();
    fs::write(&allow, ALLOW).unwrap();
    assert!(install(&home, &file).unwrap());
    let after = read(&file);
    let cmd = command(&script_path(&home));
    assert!(after.starts_with("# my Hermes settings\nmodel:\n  default: hermes-4 # keep\nhooks:\n"), "{after}");
    assert!(after.contains("  pre_tool_call:\n    # >>> kolux status hooks ("), "Kolux's entry opens the user's own list");
    assert!(after.contains("    - matcher: \"terminal\"\n      command: \"~/.hermes/agent-hooks/block.sh\"\n      timeout: 5\n"), "the user's own hook stays");
    assert!(after.contains("  post_tool_call:\n    # >>> kolux status hooks ("), "an empty event key gets a list");
    assert!(after.contains(&format!("- command: '{cmd}'\n")), "the command is quoted for Hermes's shell-style split");
    assert!(after.ends_with("hooks_auto_accept: false\n"));
    for e in EVENTS {
        assert_eq!(after.matches(&format!("\n  {e}:\n")).count(), 1, "{e}: one key, under the user's hooks map");
    }
    assert_eq!(read(&allow), ALLOW, "Kolux never writes Hermes's allowlist");
    assert_eq!(inspect(&home, &file, &allow), ("partial", Some(CONSENT.into())), "Hermes still has to ask");
    // The user answers Hermes's prompt: Hermes writes the pairs, and the row reads installed.
    let answered = json!({ "approvals": EVENTS.iter().map(|e| json!({ "event": e, "command": cmd })).collect::<Vec<_>>() });
    fs::write(&allow, answered.to_string()).unwrap();
    assert_eq!(inspect(&home, &file, &allow), ("installed", None));
    assert!(!install(&home, &file).unwrap(), "installing again changes nothing");
    assert!(backup_of(&file).exists(), "a copy is kept before the first write");
    assert!(!backup_of(&allow).exists(), "nothing of the allowlist is copied either");
    assert!(remove(&home, &file).unwrap());
    assert_eq!(read(&file), CANNED, "byte for byte the user's file again");
    assert_eq!(approvals(&allow).len(), EVENTS.len(), "the user's answers stay, Kolux's command included");
    assert!(!remove(&home, &file).unwrap(), "a second removal changes nothing");
    assert_eq!(inspect(&home, &file, &allow), ("not installed", None));
    // List items at their key's own indent, and a stale Kolux approval from another path.
    let same = "hooks:\n  pre_tool_call:\n  - command: mine.sh\n";
    fs::write(&file, same).unwrap();
    let stale = "{\"approvals\": [{\"event\": \"pre_tool_call\", \"command\": \"\\\"C:/old/.kolux/agent-hooks/hermes.cmd\\\"\"}]}";
    fs::write(&allow, stale).unwrap();
    assert!(install(&home, &file).unwrap());
    assert!(read(&file).contains("  pre_tool_call:\n  # >>> kolux status hooks ("), "{}", read(&file));
    assert_eq!(read(&allow), stale, "an older Kolux pair is left alone: no record says Kolux wrote it");
    assert_eq!(inspect(&home, &file, &allow).0, "partial");
    assert!(remove(&home, &file).unwrap());
    assert_eq!(read(&file), same);
    assert_eq!(read(&allow), stale, "removal leaves the allowlist byte for byte");
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_016_a_block_edited_by_hand_is_refused_not_overwritten() {
    let home = scratch("hand");
    let (file, allow) = (file(&home), allow_file(&home));
    fs::write(&file, "model: x\n").unwrap();
    assert!(install(&home, &file).unwrap());
    let after = read(&file);
    let edited = after.replacen("timeout: 10", "timeout: 99", 1);
    fs::write(&file, &edited).unwrap();
    assert!(install(&home, &file).unwrap_err().contains("edited by hand"));
    assert_eq!(read(&file), edited, "install leaves it alone");
    assert!(remove(&home, &file).is_err());
    assert_eq!(read(&file), edited, "removal leaves it alone");
    assert_eq!(inspect(&home, &file, &allow).0, "partial");
    let lost = after.replacen("# <<< kolux status hooks <<<\n", "", 1);
    fs::write(&file, &lost).unwrap();
    assert!(install(&home, &file).unwrap_err().contains("lost its end line"));
    assert_eq!(read(&file), lost);
    // Put right by hand: the block is Kolux's again.
    fs::write(&file, &after).unwrap();
    assert!(remove(&home, &file).unwrap());
    assert_eq!(read(&file), "model: x\n");
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_016_crlf_missing_and_emptied_files() {
    let home = scratch("crlf");
    let (file, allow) = (file(&home), allow_file(&home));
    for text in ["# c\r\nmodel: x", "model: x\r\nhooks:", "model: x\r\nhooks:\r\n  pre_llm_call:"] {
        fs::write(&file, text).unwrap();
        assert!(install(&home, &file).unwrap());
        let after = read(&file);
        assert!(!after.replace("\r\n", "").contains('\n'), "the file's own line breaks are used: {after:?}");
        assert_eq!(inspect(&home, &file, &allow), ("partial", Some(CONSENT.into())), "{text:?}");
        assert!(!allow.exists(), "no allowlist is created");
        assert!(remove(&home, &file).unwrap());
        assert_eq!(read(&file), text, "byte for byte, the missing last line break too");
    }
    // An emptied file: Kolux's block goes in, and taking it out leaves the empty file.
    fs::write(&file, "").unwrap();
    assert!(install(&home, &file).unwrap());
    assert!(read(&file).contains("\nhooks:\n  on_session_start:\n"));
    assert!(remove(&home, &file).unwrap());
    assert_eq!(read(&file), "");
    // Emptied by the user after the install: nothing of Kolux's left to take out of it.
    assert!(install(&home, &file).unwrap());
    fs::write(&file, "").unwrap();
    assert_eq!(inspect(&home, &file, &allow), ("not installed", None));
    assert!(!remove(&home, &file).unwrap(), "nothing of Kolux's left, and the allowlist is not Kolux's to touch");
    assert_eq!(read(&file), "");
    let _ = fs::remove_dir_all(&home);
    // Absent: Kolux creates it, and taking its hooks out deletes it again.
    let home = scratch("absent");
    let (file, allow) = (super::file(&home), allow_file(&home));
    assert!(install(&home, &file).unwrap());
    assert!(read(&file).starts_with(BEGIN));
    assert!(remove(&home, &file).unwrap());
    assert!(!file.exists(), "a file Kolux created goes with its hooks");
    assert!(!allow.exists());
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_016_shapes_a_line_editor_cannot_join_are_left_alone() {
    let home = scratch("shapes");
    let (file, allow) = (file(&home), allow_file(&home));
    for bad in ["hooks: {}\n", "hooks:\n  - command: x\n", "hooks:\n  pre_tool_call: []\n", "hooks:\n  pre_tool_call:\n    matcher: x\n", "hooks:\na: 1\nhooks:\n", "{model: x}\n", "x: 1\n# >>> kolux status hooks (sum 00) >>>\n", "# <<< kolux status hooks <<<\n"] {
        fs::write(&file, bad).unwrap();
        assert!(install(&home, &file).is_err(), "{bad:?}");
        assert_eq!(read(&file), bad);
    }
    assert!(!allow.exists(), "no install writes an allowlist");
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_016_hermes_events_drive_the_dot() {
    use super::super::{agent_of, change, normalize_with, Memory};
    assert_eq!(agent_of("/hermes"), Some("hermes"));
    let mut m = Memory::default();
    let mut state = |name: &str, extra: Value| {
        let p = json!({ "hook_event_name": name, "session_id": "s1", "tool_name": "terminal", "tool_input": { "command": "ls" }, "extra": extra });
        let n = normalize_with(&mut m, "hermes", &p)?;
        assert_eq!(n["session_id"], "s1");
        change(&n).flatten().map(|c| c.state)
    };
    assert_eq!(state("on_session_start", json!({})), None, "session start fires while idle");
    assert_eq!(state("pre_llm_call", json!({ "user_message": "go" })), Some("working"));
    assert_eq!(state("pre_tool_call", json!({})), Some("working"));
    assert_eq!(state("post_tool_call", json!({})), Some("working"));
    assert_eq!(state("pre_approval_request", json!({})), Some("permission"), "an approval request needs you");
    assert_eq!(state("post_approval_response", json!({})), Some("working"), "once answered, working again");
    assert_eq!(state("on_human_input_request", json!({ "question": "Which one?" })), Some("waiting"));
    assert_eq!(state("on_human_input_resolved", json!({})), Some("working"));
    for done in ["post_llm_call", "on_session_end", "on_session_finalize", "on_session_reset", "agent_loop_stopped"] {
        assert_eq!(state(done, json!({})), Some("done"), "{done}");
    }
}

#[test]
fn rename_an_old_kolux_rs_block_is_replaced_not_duplicated() {
    let home = scratch("legacy");
    let (file, allow) = (file(&home), allow_file(&home));
    fs::write(&file, CANNED).unwrap();
    fs::write(&allow, ALLOW).unwrap();
    assert!(install(&home, &file).unwrap());
    let new = read(&file);
    // The same blocks as the build before the rename wrote them (the sum covers the body only).
    let old = new.replace(BEGIN, LEGACY_BEGIN).replace(END, LEGACY_END);
    assert!(old.contains(LEGACY_BEGIN) && !old.contains(BEGIN));
    fs::write(&file, &old).unwrap();
    assert!(install(&home, &file).unwrap(), "the old blocks are rewritten");
    let after = read(&file);
    assert_eq!(after, new, "exactly the new blocks, once each");
    assert!(!after.contains(LEGACY_BEGIN) && !after.contains(LEGACY_END), "{after}");
    // Removal takes old blocks out too.
    fs::write(&file, &old).unwrap();
    assert!(remove(&home, &file).unwrap());
    assert_eq!(read(&file), CANNED);
    let _ = fs::remove_dir_all(&home);
}
