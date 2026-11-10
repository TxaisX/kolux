//! spec/06 usage and limits: Codex plan figures (USAGE-022). Needs `codex_usage` public in lib.rs.
//! The background Codex process is stood in for by a small batch file that prints hand-written
//! JSON-RPC replies (shapes from Codex's public app-server documentation); nothing real is started.
#![cfg(windows)]

use kolux_lib::codex_usage::{read_account, Window};
use std::path::{Path, PathBuf};

fn folder(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("cards06-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A fake `codex`: leaves a marker when launched, then prints the given reply lines and exits.
fn fake_codex(dir: &Path, replies: &[&str]) -> PathBuf {
    std::fs::write(dir.join("replies.jsonl"), replies.join("\r\n") + "\r\n").unwrap();
    let program = dir.join("codex.cmd");
    std::fs::write(&program, "@echo off\r\necho launched> \"%~dp0launched.txt\"\r\ntype \"%~dp0replies.jsonl\"\r\n").unwrap();
    program
}

/// A Codex home holding a ChatGPT-style sign-in (placeholder token, never a real one).
fn signed_in_home(dir: &Path) -> PathBuf {
    let home = dir.join("codex-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(home.join("auth.json"), r#"{"tokens":{"id_token":"placeholder"}}"#).unwrap();
    home
}

const INIT: &str = r#"{"id":1,"result":{}}"#;
const CHATGPT: &str = r#"{"id":2,"result":{"account":{"type":"chatgpt","planType":"plus"},"requiresOpenaiAuth":false}}"#;

#[test]
fn usage022_box1_a_weekly_only_plan_shows_only_the_weekly_figure_with_its_reset_time() {
    let dir = folder("weekly");
    let home = signed_in_home(&dir);
    let limits = r#"{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":35.0,"windowDurationMins":10080,"resetsAt":1790000000},"secondary":null,"planType":"plus"}}}"#;
    let program = fake_codex(&dir, &[INIT, CHATGPT, limits]);
    let usage = read_account(&home, Some(&program));
    assert_eq!(usage.state, "ok");
    assert_eq!(usage.five_hour, None, "a weekly-only plan never shows in the 5-hour place");
    assert_eq!(usage.weekly, Some(Window { used_percent: 35.0, resets_at: Some(1_790_000_000), window_mins: Some(10_080) }));
    // the same plan when Codex lists the weekly window as the second one
    let limits2 = r#"{"id":3,"result":{"rateLimits":{"primary":null,"secondary":{"usedPercent":12.0,"windowDurationMins":10080,"resetsAt":1790100000}}}}"#;
    let program2 = fake_codex(&dir, &[INIT, CHATGPT, limits2]);
    let usage2 = read_account(&home, Some(&program2));
    assert_eq!((usage2.five_hour, usage2.weekly.map(|w| w.resets_at)), (None, Some(Some(1_790_100_000))));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn usage022_box2_without_a_sign_in_the_figures_go_and_no_codex_process_is_started() {
    let dir = folder("revoked");
    let home = dir.join("codex-home");
    std::fs::create_dir_all(&home).unwrap();
    let program = fake_codex(&dir, &[INIT, CHATGPT]);
    // the sign-in file is gone (signed out / revoked locally)
    let usage = read_account(&home, Some(&program));
    assert_eq!((usage.state.as_str(), usage.five_hour, usage.weekly), ("signed-out", None, None));
    assert!(!dir.join("launched.txt").exists(), "no Codex process may be started without a sign-in");
    // a sign-in file with no token inside counts as no sign-in too
    std::fs::write(home.join("auth.json"), r#"{"tokens":null}"#).unwrap();
    assert_eq!(read_account(&home, Some(&program)).state, "signed-out");
    assert!(!dir.join("launched.txt").exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn usage022_box2_a_sign_in_the_service_has_revoked_ends_the_read_with_a_sign_in_again_warning_and_no_figures() {
    let dir = folder("refused");
    let home = signed_in_home(&dir);
    let refused = r#"{"id":2,"error":{"message":"Your refresh token was revoked. Please sign in again."}}"#;
    let program = fake_codex(&dir, &[INIT, refused, r#"{"id":3,"error":{"message":"unauthorized"}}"#]);
    let usage = read_account(&home, Some(&program));
    assert_eq!(usage.state, "sign-in-again");
    assert_eq!((usage.five_hour, usage.weekly, usage.reset_credits), (None, None, None));
    assert!(usage.message.is_some());
    // a dead refresh token reported by the usage read alone ends it the same way
    let limits_refused = r#"{"id":3,"error":{"message":"token expired, log in again"}}"#;
    let program2 = fake_codex(&dir, &[INIT, CHATGPT, limits_refused]);
    let again = read_account(&home, Some(&program2));
    assert_eq!((again.state.as_str(), again.five_hour, again.weekly), ("sign-in-again", None, None));
    let _ = std::fs::remove_dir_all(dir);
}
