//! spec/19 app lifecycle, Rust halves of the cards batch. APP-054 box 2: ending one of three real shell sessions
//! leaves the other two running. The window-side proofs are src/update/__cards__, src/status/__cards__/APP-054.test.ts
//! and src/settings/__cards__/APP-041-070.test.ts.

mod scratch_root;

use kolux_rs_lib::procs::{alive, wait_gone};
use kolux_rs_lib::pty::{shell_commands, PtySession};
use std::path::PathBuf;
use std::time::Duration;

fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("app19").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn shell(dir: &std::path::Path) -> PtySession {
    PtySession::spawn_first(shell_commands(Some(&dir.to_string_lossy()), None), 120, 30, |_| {}, |_| {}).expect("a shell starts")
}

/// APP-054 box 2: Terminals::kill(id) removes that one session and calls its kill(); this is the session-level
/// behaviour it rests on, with three real shells: the one ended is gone, the other two are still running.
#[test]
fn app054_box2_ending_one_of_three_sessions_stops_only_that_one() {
    let dir = scratch("app054");
    let mut three: Vec<PtySession> = (0..3).map(|_| shell(&dir)).collect();
    let pids: Vec<u32> = three.iter().map(|s| s.pid().expect("the platform reports a pid")).collect();
    assert_eq!(pids.iter().collect::<std::collections::HashSet<_>>().len(), 3, "three different processes: {pids:?}");
    for p in &pids {
        assert_eq!(alive(*p), Some(true), "{p} runs before the end");
    }
    three[1].kill();
    let stuck = wait_gone(&[pids[1]], Duration::from_secs(10));
    assert!(stuck.is_empty(), "the ended session's process is gone: {stuck:?}");
    assert_eq!(alive(pids[1]), Some(false));
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(alive(pids[0]), Some(true), "the first keeps running");
    assert_eq!(alive(pids[2]), Some(true), "the third keeps running");
    for s in three.iter_mut() {
        s.kill();
    }
    let left = wait_gone(&pids, Duration::from_secs(10));
    assert!(left.is_empty(), "cleanup: {left:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------- APP-048 box 1 / APP-050 box 1: the profile after a hard kill

fn fixture(part: &str) -> (serde_json::Map<String, serde_json::Value>, Vec<String>) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("evidence").join("cards-APP-048-050-patches.json");
    let all: serde_json::Value = serde_json::from_slice(&std::fs::read(path).expect("the patches fixture is there")).unwrap();
    let set = all[part]["set"].as_object().expect("set is an object").clone();
    let remove = all[part]["remove"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect();
    (set, remove)
}

/// The writer half, run as a child of `app048_box1_*` (a no-op in a normal run): applies the exact `settings_patch`
/// arguments the window sends (src/settings/__cards__/APP-048-050.test.ts), reports ready, then waits to be killed.
#[test]
fn app048_child_writer() {
    let Ok(dir) = std::env::var("CARDS19_WRITER_DIR") else { return };
    let dir = PathBuf::from(dir);
    let store = kolux_rs_lib::state::Store::open(&dir).expect("store opens");
    for part in ["setting", "layout"] {
        let (set, remove) = fixture(part);
        store.patch_settings(&set, &remove).expect("the patch is written");
    }
    std::fs::write(dir.join("ready"), "").unwrap();
    std::thread::sleep(Duration::from_secs(300));
}

/// APP-048 box 1 and APP-050 box 1, Rust half: a setting and a layout written the way `settings_patch` writes them are
/// still there when the process is killed (TerminateProcess, no clean exit) two seconds later, and the next open reads them.
#[test]
fn app048_box1_a_setting_and_the_layout_are_there_after_the_process_is_killed_two_seconds_later() {
    let dir = scratch("app048");
    {
        let s = kolux_rs_lib::state::Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "zoom": 1.25 })).unwrap();
    }
    let exe = std::env::current_exe().unwrap();
    let mut child = std::process::Command::new(exe)
        .args(["app048_child_writer", "--exact", "--nocapture", "--test-threads=1"])
        .env("CARDS19_WRITER_DIR", &dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("the writer starts");
    let until = std::time::Instant::now() + Duration::from_secs(60);
    while !dir.join("ready").exists() {
        assert!(std::time::Instant::now() < until, "the writer never reported ready");
        std::thread::sleep(Duration::from_millis(50));
    }
    std::thread::sleep(Duration::from_secs(2));
    child.kill().expect("hard kill");
    child.wait().unwrap();

    let s = kolux_rs_lib::state::Store::open(&dir).unwrap();
    let got = s.try_settings().expect("settings.json reads whole after the kill");
    assert_eq!(got["needsStrip"], serde_json::json!(false), "the changed setting is there");
    assert_eq!(got["savedLayout"], fixture("layout").0["savedLayout"], "the layout is there, identical");
    assert_eq!(got["theme"], "classic", "what was set before is kept");
    assert_eq!(got["zoom"], 1.25);
    assert!(s.take_fallback_notice().is_none(), "the main file was read, not the backup");
    assert!(!dir.join("settings.json.tmp").exists(), "no half-written temporary file is left");
    drop(s);
    let _ = std::fs::remove_dir_all(&dir);
}

/// APP-048 box 2 (upgrade regression): src-tauri/tests/fixtures/profile-v0.1.5 is a profile folder written by the
/// v0.1.5 release's own code (how it was made: scripts/profile-fixture.md). Today's code opens a copy of it and reads
/// back exactly what is in expected.json: settings (after the retired-key filter), the saved layout and every kv row,
/// with no fallback to the backup, no set-aside file and no leftover temporary file. Startup's `stamp_look()` runs
/// right after the open, as lib.rs does; this profile already has its look and mode, so it must write nothing.
/// What the window makes of the same settings.json is src/terminal/layout.app048.test.ts. The live tick is D-3.
#[test]
fn app048_box2_a_profile_written_by_the_previous_release_reads_back_identical() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("profile-v0.1.5");
    let expected: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("expected.json")).expect("expected.json is committed")).expect("expected.json is JSON");
    let dir = scratch("app048-upgrade");
    for name in ["settings.json", "settings.json.bak", "state.db"] {
        std::fs::copy(root.join(name), dir.join(name)).unwrap_or_else(|e| panic!("the v0.1.5 fixture file {name} is committed: {e}"));
    }
    let before: std::collections::BTreeSet<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();

    let s = kolux_rs_lib::state::Store::open(&dir).expect("today's code opens the old database");
    s.stamp_look(); // lib.rs does this right after Store::open (row 785)
    let settings = s.try_settings().expect("today's code reads the old settings.json");
    assert_eq!(settings["savedLayout"], expected["settings"]["savedLayout"], "the saved layout (panes, open editor tabs, group, colour, pinned, session) reads back identical");
    assert_eq!(settings, expected["settings"], "every setting reads back identical to expected.json (a retired fixture key must be a conscious decision: update expected.json)");
    assert!(s.take_fallback_notice().is_none(), "the main file was read, not a fallback to settings.json.bak");
    drop(s);

    let conn = rusqlite::Connection::open_with_flags(dir.join("state.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut q = conn.prepare("SELECT key, value FROM kv ORDER BY key").unwrap();
    let rows: serde_json::Map<String, serde_json::Value> = q.query_map([], |r| Ok((r.get::<_, String>(0)?, serde_json::Value::String(r.get::<_, String>(1)?)))).unwrap().map(Result::unwrap).collect();
    assert_eq!(serde_json::Value::Object(rows), expected["kv"], "every kv row (projects, start count) reads back identical");
    drop(q);
    drop(conn);

    let after: std::collections::BTreeSet<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    let extra: Vec<&String> = after.difference(&before).collect();
    assert!(extra.iter().all(|n| n.starts_with("state.db-")), "opening wrote nothing but the database's own journal files: {extra:?}");
    assert!(!dir.join("settings.json.tmp").exists() && !dir.join("settings.json.bak.tmp").exists(), "no temporary file");
    assert_eq!(std::fs::read(dir.join("settings.json.bak")).unwrap(), std::fs::read(root.join("settings.json.bak")).unwrap(), "the last good copy was not touched by a read");
    assert!(std::fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("corrupt")), "nothing was set aside as corrupt");
    assert_eq!(std::fs::read(dir.join("settings.json")).unwrap(), std::fs::read(root.join("settings.json")).unwrap(), "opening, stamp_look and reading did not rewrite settings.json");
    let _ = std::fs::remove_dir_all(&dir);
}
