// LAND-03 board tests (locked: the board overwrites this file at verify time).
// Wired from terminal.rs: #[cfg(test)] #[path = "terminal_land_board_tests.rs"] mod land_board_tests;
use super::land_env;
use crate::agents::{add_team_with, lead_note, StartLine, LAND_NOTE};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// A made-up home under the temp folder (never the real home, never touched on disk).
fn fake_home(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("kolux-land03-{name}-{}", std::process::id()))
}

fn script_in(home: &Path) -> PathBuf {
    home.join(".kolux").join("bin").join("kolux-land.cmd")
}

fn joined(parts: &[&Path]) -> OsString {
    std::env::join_paths(parts.iter().copied()).unwrap()
}

fn parts(path: &OsStr) -> Vec<PathBuf> {
    std::env::split_paths(path).collect()
}

fn value<'a>(env: &'a [(&'static str, OsString)], name: &str) -> Option<&'a OsString> {
    env.iter().find(|(k, _)| *k == name).map(|(_, v)| v)
}

fn line() -> StartLine {
    StartLine { args: vec!["--model".into(), "opus".into()], typed: None, program: None, env: Vec::new(), resumed: false }
}

fn note_after_flag(l: &StartLine) -> Option<String> {
    let at = l.args.iter().position(|a| a == "--append-system-prompt")?;
    l.args.get(at + 1).cloned()
}

#[test]
fn land03_the_bin_folder_is_appended_last_and_the_script_is_named() {
    let home = fake_home("append");
    let script = script_in(&home);
    let (a, b) = (home.join("tools-a"), home.join("tools-b"));
    let env = land_env(Some(&joined(&[&a, &b])), &script);
    assert_eq!(env.len(), 2, "PATH and KOLUX_LAND: {env:?}");
    assert_eq!(env[0].0, "PATH", "PATH first, then KOLUX_LAND: {env:?}");
    assert_eq!(env[1].0, "KOLUX_LAND", "{env:?}");
    let path = value(&env, "PATH").unwrap();
    assert_eq!(parts(path), vec![a, b, script.parent().unwrap().to_path_buf()], "appended, never prepended");
    assert_eq!(value(&env, "KOLUX_LAND").unwrap(), script.as_os_str(), "the script's full path, as given");
}

#[test]
fn land03_existing_entries_keep_their_order_and_come_first() {
    let home = fake_home("order");
    let script = script_in(&home);
    let list: Vec<PathBuf> = (0..6).map(|i| home.join(format!("p{i}"))).collect();
    let refs: Vec<&Path> = list.iter().map(PathBuf::as_path).collect();
    let env = land_env(Some(&joined(&refs)), &script);
    let got = parts(value(&env, "PATH").unwrap());
    assert_eq!(got.len(), list.len() + 1, "{got:?}");
    assert_eq!(&got[..list.len()], &list[..], "every entry kept, same order, before the bin folder");
    assert_eq!(got.last().unwrap(), &script.parent().unwrap().to_path_buf());
}

#[test]
fn land03_a_bin_folder_already_on_path_is_not_added_again_or_moved() {
    let home = fake_home("dup");
    let script = script_in(&home);
    let bin = script.parent().unwrap().to_path_buf();
    let other = home.join("other");
    let env = land_env(Some(&joined(&[&bin, &other])), &script);
    assert_eq!(parts(value(&env, "PATH").unwrap()), vec![bin.clone(), other.clone()], "already there: unchanged");
    assert_eq!(value(&env, "KOLUX_LAND").unwrap(), script.as_os_str(), "the script is still named");
    // The same folder written with a trailing separator counts as the same folder.
    let mut slashed = bin.clone().into_os_string();
    slashed.push(std::path::MAIN_SEPARATOR_STR);
    let env = land_env(Some(&joined(&[&other, Path::new(&slashed)])), &script);
    assert_eq!(parts(value(&env, "PATH").unwrap()).len(), 2, "a trailing separator is the same folder");
    if cfg!(windows) {
        // Windows folders ignore case.
        let upper = PathBuf::from(bin.to_string_lossy().to_uppercase());
        let env = land_env(Some(&joined(&[&upper, &other])), &script);
        assert_eq!(parts(value(&env, "PATH").unwrap()), vec![upper, other], "another case is the same folder on Windows");
    }
}

#[test]
fn land03_no_path_or_an_empty_one_becomes_just_the_bin_folder() {
    let home = fake_home("empty");
    let script = script_in(&home);
    let bin = script.parent().unwrap().to_path_buf();
    for start in [None, Some(OsString::new())] {
        let env = land_env(start.as_deref(), &script);
        assert_eq!(parts(value(&env, "PATH").expect("PATH is set")), vec![bin.clone()], "start {start:?}");
        assert_eq!(value(&env, "KOLUX_LAND").unwrap(), script.as_os_str());
    }
}

#[test]
fn land03_the_agent_hooks_folder_or_a_relative_script_sets_nothing() {
    let home = fake_home("hooks");
    let a = home.join("tools-a");
    let start = joined(&[&a]);
    let hooks = home.join(".kolux").join("agent-hooks").join("kolux-land.cmd");
    assert!(land_env(Some(&start), &hooks).is_empty(), "the agent-hooks folder (claude.cmd, codex.cmd shims) never goes on PATH");
    let hooks_upper = home.join(".kolux").join("Agent-Hooks").join("kolux-land.cmd");
    if cfg!(windows) {
        assert!(land_env(Some(&start), &hooks_upper).is_empty(), "nor in another case on Windows");
    }
    assert!(land_env(Some(&start), Path::new("kolux-land.cmd")).is_empty(), "a bare name is not a full path");
    assert!(land_env(Some(&start), Path::new("bin/kolux-land.cmd")).is_empty(), "a relative path is not a full path");
}

#[test]
fn land03_the_land_note_is_plain_text_cmd_cannot_misread() {
    for c in ['%', '&', '|', '<', '>', '^', '"', '\n', '\r', '`'] {
        assert!(!LAND_NOTE.contains(c), "LAND_NOTE holds {c:?}: {LAND_NOTE}");
    }
    assert!(LAND_NOTE.len() >= 80 && LAND_NOTE.len() <= 900, "a real note, not an essay: {} chars", LAND_NOTE.len());
    for word in ["kolux-land", "KOLUX_LAND", "commit", "main"] {
        assert!(LAND_NOTE.contains(word), "LAND_NOTE names {word}: {LAND_NOTE}");
    }
}

#[test]
fn land03_lead_note_adds_the_land_note_only_when_asked() {
    let plain = lead_note(false);
    assert!(plain.contains("BLOCKED"), "the lead note is kept: {plain}");
    assert!(!plain.contains("kolux-land") && !plain.contains("KOLUX_LAND"), "no land text without the script: {plain}");
    let with = lead_note(true);
    assert!(with.starts_with(&plain), "the lead note first: {with}");
    assert!(with.ends_with(LAND_NOTE), "then the land note: {with}");
    assert!(with.len() > plain.len() + LAND_NOTE.len() - 1, "both, separated: {with}");
    assert_eq!(with.matches(LAND_NOTE).count(), 1);
}

#[test]
fn land03_a_claude_seat_gets_the_land_note_in_its_one_system_prompt_argument() {
    let none = serde_json::json!({});
    let mut l = line();
    add_team_with(&none, "claude", &mut l, false, true);
    assert_eq!(l.args.iter().filter(|a| a.as_str() == "--append-system-prompt").count(), 1, "one system prompt argument: {:?}", l.args);
    assert_eq!(note_after_flag(&l).as_deref(), Some(lead_note(true).as_str()), "{:?}", l.args);
    assert_eq!(&l.args[l.args.len() - 2..], &["--model".to_string(), "opus".to_string()], "the seat's own arguments stay after the team's");
    let mut l = line();
    add_team_with(&none, "claude", &mut l, false, false);
    assert_eq!(note_after_flag(&l).as_deref(), Some(lead_note(false).as_str()), "no script: the lead note alone");
}

#[test]
fn land03_no_land_note_where_the_lead_note_does_not_go() {
    let none = serde_json::json!({});
    // Through cmd.exe: nothing on the line.
    let mut l = line();
    add_team_with(&none, "claude", &mut l, true, true);
    assert!(l.args.iter().all(|a| !a.contains("kolux-land") && a != "--append-system-prompt"), "{:?}", l.args);
    // Another agent: no Claude flags at all.
    for id in ["codex", "gemini", "opencode"] {
        let mut l = line();
        add_team_with(&none, id, &mut l, false, true);
        assert_eq!(l, line(), "{id} is untouched");
    }
    // The user's own Claude arguments: their line is theirs.
    let own = serde_json::json!({ "agentOptions": { "claude": { "args": "--model opus" } } });
    let mut l = line();
    add_team_with(&own, "claude", &mut l, false, true);
    assert!(l.args.iter().all(|a| !a.contains("kolux-land") && a != "--append-system-prompt"), "{:?}", l.args);
    // A line that already has a system prompt keeps it and gets no second one.
    let mut l = StartLine { args: vec!["--append-system-prompt".into(), "mine".into()], ..line() };
    add_team_with(&none, "claude", &mut l, false, true);
    assert_eq!(l.args.iter().filter(|a| a.as_str() == "--append-system-prompt").count(), 1, "{:?}", l.args);
    assert!(l.args.iter().all(|a| !a.contains("kolux-land")), "{:?}", l.args);
}
