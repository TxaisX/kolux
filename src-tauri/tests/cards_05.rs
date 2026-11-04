//! spec/05 views and navigation: the status a Board card is built from (VIEW-016, VIEW-023, VIEW-025).
//! Needs `status` and `hooks` public in lib.rs. Hook events are crafted by hand from the public hook
//! documentation; everything is in memory. The card's wording is proven on the TypeScript side
//! (src/board/__cards__), fed the same payload shapes these tests assert.

use kolux_rs_lib::status::{answer_keys, report, Agent, Session};
use serde_json::{json, Value};

fn ev(j: &str) -> Value {
    serde_json::from_str(j).unwrap()
}

fn status(pane: u32, agent: Agent, j: &str) -> Option<Value> {
    report(pane, None, agent, &ev(j)).map(|s| serde_json::to_value(s).unwrap())
}

const PROMPT: &str = r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix the build"}"#;

#[test]
fn view016_a_file_edit_approval_names_the_tool_and_the_file_it_asks_for() {
    let pane = 9_105_161;
    assert_eq!(status(pane, Agent::Claude, PROMPT).unwrap()["state"], "working");
    let asked = status(pane, Agent::Claude, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"C:/x/hello.txt","content":"hi"}}"#).unwrap();
    assert_eq!((asked["state"].as_str(), asked["tool"].as_str(), asked["detail"].as_str()), (Some("permission"), Some("Write"), Some("C:/x/hello.txt")));
}

#[test]
fn view023_box1_a_usage_limit_stop_is_blocked_with_cause_limit_never_done() {
    let pane = 9_105_231;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let stopped = status(pane, Agent::Claude, r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"5-hour limit"}"#).unwrap();
    assert_eq!(stopped["state"], "blocked");
    assert_eq!(stopped["stop"]["cause"], "limit");
    assert_eq!(stopped["stop"]["detail"], "5-hour limit");
}

#[test]
fn view023_box2_a_finish_carries_the_agents_last_message() {
    let pane = 9_105_232;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let done = status(pane, Agent::Claude, r#"{"hook_event_name":"Stop","last_assistant_message":"All 14 tests pass.\n\nShipped the fix."}"#).unwrap();
    assert_eq!(done["state"], "done");
    assert!(done["reply"].as_str().is_some_and(|r| r.starts_with("All 14 tests pass.") && r.contains("Shipped the fix.")));
}

#[test]
fn view023_box3_each_write_reports_its_own_file_and_the_finish_names_none() {
    let pane = 9_105_233;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let a = status(pane, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"C:/w/a.ts"}}"#).unwrap();
    // A write is the only tool step that names a file: a command carrying a path in its input does not.
    let b = status(pane, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"C:/w/b.ts","old_string":"x"}}"#).unwrap();
    let done = status(pane, Agent::Claude, r#"{"hook_event_name":"Stop","last_assistant_message":"Done."}"#).unwrap();
    assert_eq!((a["wrote"].as_str(), b["wrote"].as_str()), (Some("C:/w/a.ts"), Some("C:/w/b.ts")));
    assert!(done.get("wrote").is_none(), "the finish carries no file; the window keeps the newest one it was told");
}

#[test]
fn view025_a_card_answer_types_the_agents_own_keys_and_the_pane_leaves_needs_you() {
    let mut s = Session::default();
    s.apply(Agent::Claude, &ev(PROMPT)).unwrap();
    let (asked, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"cargo build"}}"#)).unwrap();
    assert_eq!((asked.state, asked.tool.as_deref()), ("permission", Some("Bash")));
    assert!(s.answerable(), "a hook permission naming its tool is what Approve and Deny answer");
    assert_eq!(s.answer_state(), "working", "the card leaves needs-you once answered");
    assert!(!s.answerable());
    // Approve is the first option (Yes), Deny is Esc for Claude Code; y / n for Codex.
    assert_eq!((answer_keys(Agent::Claude, true), answer_keys(Agent::Claude, false)), (Some("\r"), Some("\x1b")));
    assert_eq!((answer_keys(Agent::Codex, true), answer_keys(Agent::Codex, false)), (Some("y"), Some("n")));
    // The payload shape the TypeScript side is fed.
    assert_eq!(json!({"state": asked.state, "tool": asked.tool}), json!({"state": "permission", "tool": "Bash"}));
}

// ---- VIEW-005 / VIEW-107: the real settings Store and the saved window state ----
use kolux_rs_lib::state::Store;

fn store_dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-cards05-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

#[test]
fn view005_box1_the_open_page_and_the_screen_left_survive_a_restart_of_the_store() {
    let dir = store_dir("restart");
    let s = Store::open(&dir).unwrap();
    let set = serde_json::Map::from_iter([("openPage".to_string(), json!("tasks")), ("lastScreen".to_string(), json!("terminals"))]);
    s.patch_settings(&set, &[]).unwrap();
    drop(s);
    // the next start reads the same file: both keys come back as written (neither is a retired setting)
    let again = Store::open(&dir).unwrap();
    let read = again.settings();
    assert_eq!((read["openPage"].as_str(), read["lastScreen"].as_str()), (Some("tasks"), Some("terminals")));
    drop(again);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn view005_box2_a_corrupt_settings_file_reads_as_defaults_and_raises_the_repair_notice() {
    let dir = store_dir("corrupt");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("settings.json"), b"{ \"lastScreen\": \"tas").unwrap();
    let s = Store::open(&dir).unwrap();
    // no good copy to fall back to: the read does not fail, it gives defaults (no openPage, no lastScreen),
    // and C22-R2-01 announces it once so the user can repair instead of seeing a silently reset app.
    let read = s.settings();
    assert_eq!(read, json!({}));
    assert!(s.take_fallback_notice().is_some(), "a corrupt file with no good copy is announced once");
    assert_eq!(s.take_fallback_notice(), None, "the notice is one-shot");
    drop(s);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn view005_box2_with_a_good_copy_a_corrupt_file_reads_from_that_copy_not_from_defaults() {
    let dir = store_dir("corrupt-bak");
    let s = Store::open(&dir).unwrap();
    s.save_settings(&json!({ "lastScreen": "artifacts" })).unwrap();
    s.save_settings(&json!({ "lastScreen": "inbox" })).unwrap();
    std::fs::write(dir.join("settings.json"), b"{ half").unwrap();
    // T-075 / APP-048: the previous good copy wins, so the screen is the one before the last save
    assert_eq!(s.settings()["lastScreen"], "artifacts");
    assert!(s.take_fallback_notice().is_some());
    drop(s);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn view107_box1_three_saved_tabs_are_read_back_whole_after_the_store_is_reopened() {
    let dir = store_dir("three-tabs");
    let pane = |k: u32, agent: &str| json!({ "key": k, "cwd": "C:/w/app", "branch": "main", "agent": agent, "program": null, "args": [] });
    let layout = json!({ "panes": [pane(1, "claude"), pane(2, "codex"), pane(3, "shell")], "activeTab": { "0": 2 }, "focused": 2, "activeDir": "C:/w/app", "stacked": {} });
    let s = Store::open(&dir).unwrap();
    s.patch_settings(&serde_json::Map::from_iter([("savedLayout".to_string(), layout.clone())]), &[]).unwrap();
    drop(s);
    let read = Store::open(&dir).unwrap().settings();
    assert_eq!(read["savedLayout"], layout, "the three tabs, their order and the active tab come back byte for byte");
    assert_eq!(read["savedLayout"]["panes"].as_array().unwrap().len(), 3);
    std::fs::remove_dir_all(&dir).unwrap();
}

// ---- VIEW-012: the Artifacts library behind the page ----
use kolux_rs_lib::artifacts::{Library, Origin};

#[test]
fn view012_box1_add_two_files_and_the_newest_is_listed_first() {
    let root = store_dir("artifacts");
    let site = root.join("site");
    std::fs::create_dir_all(&site).unwrap();
    std::fs::write(site.join("first.html"), "<title>First page</title><p>one</p>").unwrap();
    std::fs::write(site.join("second.html"), "<title>Second page</title><p>two</p>").unwrap();
    let lib = Library::new(root.join("lib"));
    lib.add(&site.join("first.html"), Origin::hand(&site.join("first.html")), &|_| None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    lib.add(&site.join("second.html"), Origin::hand(&site.join("second.html")), &|_| None).unwrap();
    let titles: Vec<String> = lib.list().unwrap().into_iter().map(|l| serde_json::to_value(l).unwrap()["title"].as_str().unwrap().to_string()).collect();
    assert_eq!(titles, ["Second page", "First page"]);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn view012_box3_removing_an_entry_takes_it_out_of_the_list_and_deletes_its_stored_folder() {
    let root = store_dir("artifacts-rm");
    let site = root.join("site");
    std::fs::create_dir_all(&site).unwrap();
    std::fs::write(site.join("a.html"), "<title>A</title>").unwrap();
    std::fs::write(site.join("b.html"), "<title>B</title>").unwrap();
    let lib = Library::new(root.join("lib"));
    let a = lib.add(&site.join("a.html"), Origin::hand(&site.join("a.html")), &|_| None).unwrap();
    lib.add(&site.join("b.html"), Origin::hand(&site.join("b.html")), &|_| None).unwrap();
    lib.remove(&a.id).unwrap();
    let titles: Vec<String> = lib.list().unwrap().into_iter().map(|l| serde_json::to_value(l).unwrap()["title"].as_str().unwrap().to_string()).collect();
    assert_eq!(titles, ["B"]);
    assert!(!root.join("lib").join(&a.id).exists());
    std::fs::remove_dir_all(&root).unwrap();
}

