//! spec/17 P0 boxes SET-032 and SET-030 (Rust halves): the real projects/Store/Git code on real folders under
//! the scratch root (folder set17), and the real claude_accounts reader run against a fake `claude` program in scratch.
//! The TS halves are src/projects/__cards__/SET-032.test.ts and src/settings/__cards__/SET-030.test.ts.
//! Batch 3 adds SET-037 (the look and first screen, as a profile on disk) and SET-028 (a tier's saved model reaching the worker's start line).

mod scratch_root;

use kolux_lib::agents::{start_line_as, Start};
use kolux_lib::claude_accounts::{auth_status, own_sign_in};
use kolux_lib::cli::{dispatch, parse, Ctx, Request};
use kolux_lib::git::Git;
use kolux_lib::projects::{add_project, create_workspace, place_from, resolve_workspaces_dir, workspace_path, workspaces_dir, Project};
use kolux_lib::state::Store;
use kolux_lib::terminal::Terminals;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// KOLUX_WORKSPACES_DIR is process-wide: every test that makes a worktree holds this.
static ENV: Mutex<()> = Mutex::new(());

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("set17").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-scratch"), "").unwrap();
    d
}

fn repo_in(parent: &Path, name: &str) -> PathBuf {
    let dir = parent.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    for args in [vec!["init", "-q"], vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]] {
        assert!(Command::new("git").args(&args).current_dir(&dir).status().unwrap().success(), "git {args:?}");
    }
    dir
}

fn same(a: &str, b: &Path) -> bool {
    a.replace('\\', "/").trim_end_matches('/').eq_ignore_ascii_case(b.to_string_lossy().replace('\\', "/").trim_end_matches('/'))
}

fn make(git: &Git, project: &Project, settings: &Value, name: &str) -> String {
    let place = place_from(project, settings);
    create_workspace(git, &place, project, name, None).unwrap().worktree.path
}

#[test]
fn set032_box1_a_folder_browsed_to_gets_the_next_worktree_at_folder_repo_name() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    std::env::remove_var("KOLUX_WORKSPACES_DIR");
    let git = Git::detect().unwrap();
    let d = scratch("s32b1");
    let profile = d.join("profile");
    let folder = d.join("wt");
    let store = Store::open(&profile).unwrap();
    let app = add_project(&git, &store, &repo_in(&d.join("repos"), "app")).unwrap();
    // MIRROR src/projects.rs set_place (2359-2375): the two settings the page's workspaces_place_set {dir, flat:false} writes.
    let mut saved = store.settings();
    saved["workspacesDir"] = json!(folder.to_string_lossy());
    saved["workspacesLayout"] = json!("nested");
    store.save_settings(&saved).unwrap();
    drop(store);
    // The next worktree: read back from disk, as after a restart.
    let settings = Store::open(&profile).unwrap().settings();
    assert!(same(&workspaces_dir(&Store::open(&profile).unwrap()).to_string_lossy(), &folder));
    let path = make(&git, &app, &settings, "next");
    assert!(same(&path, &folder.join("app").join("next")), "{path}");
    assert!(Path::new(&path).join(".git").exists(), "a real checkout is there");
    // A second one lands beside it, in the same repo sub-folder.
    let second = make(&git, &app, &settings, "after");
    assert!(same(&second, &folder.join("app").join("after")), "{second}");
    // The very folder of the box: D:/wt, typed with a forward slash, names a path without touching the drive.
    #[cfg(windows)]
    {
        let far = Project { id: "far".into(), name: "app".into(), path: "C:\\repos\\app".into(), workspaces_dir: None, base: None, display_name: None };
        let place = place_from(&far, &json!({ "workspacesDir": "D:/wt", "workspacesLayout": "nested" }));
        assert!(same(&workspace_path(&place, &far, "next").to_string_lossy(), Path::new("D:/wt/app/next")));
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn set032_box2_kolux_workspaces_dir_sets_the_folder_when_nothing_is_saved_and_a_saved_folder_still_wins() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let git = Git::detect().unwrap();
    let d = scratch("s32b2");
    let from_env = d.join("from-env");
    let saved_dir = d.join("saved");
    let store = Store::open(&d.join("profile")).unwrap();
    let app = add_project(&git, &store, &repo_in(&d.join("repos"), "app")).unwrap();
    // "Launch with the variable": it is read when the worktree is made, with no Settings page involved.
    std::env::set_var("KOLUX_WORKSPACES_DIR", &from_env);
    let nothing_saved = store.settings();
    assert!(nothing_saved["workspacesDir"].is_null());
    assert!(same(&workspaces_dir(&store).to_string_lossy(), &from_env));
    let path = make(&git, &app, &nothing_saved, "n1");
    assert!(same(&path, &from_env.join("app").join("n1")), "{path}");
    assert!(Path::new(&path).join(".git").exists());
    // A blank value is not a folder.
    assert_ne!(resolve_workspaces_dir(Some("   "), None), PathBuf::from("   "));
    // The variable only moves the default: a folder the user saved is used instead.
    let saved = json!({ "workspacesDir": saved_dir.to_string_lossy() });
    let other = make(&git, &app, &saved, "n2");
    assert!(same(&other, &saved_dir.join("app").join("n2")), "{other}");
    std::env::remove_var("KOLUX_WORKSPACES_DIR");
    let _ = std::fs::remove_dir_all(&d);
}

fn fake_claude(dir: &Path, status_json: &str) -> PathBuf {
    #[cfg(windows)]
    let (name, body) = ("claude.cmd", format!("@echo off\r\necho {status_json}\r\n"));
    #[cfg(not(windows))]
    let (name, body) = ("claude", format!("#!/bin/sh\necho '{status_json}'\n"));
    let p = dir.join(name);
    std::fs::write(&p, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    p
}

#[test]
fn set030_box1_a_claude_that_reports_signed_out_is_read_as_signed_out_by_the_real_status_reader() {
    let d = scratch("s30b1");
    let program = fake_claude(&d, r#"{"loggedIn":true,"email":"sam@example.com"}"#);
    let before = own_sign_in(auth_status(&program, None).as_deref());
    assert_eq!(serde_json::to_value(&before).unwrap(), json!({ "state": "signed-in", "email": "sam@example.com" }));
    // Signed out from its own CLI: the same program now answers the way a signed-out `claude auth status --json` does.
    fake_claude(&d, r#"{"loggedIn":false,"authMethod":"none"}"#);
    let after = own_sign_in(auth_status(&program, None).as_deref());
    assert_eq!(serde_json::to_value(&after).unwrap(), json!({ "state": "signed-out", "email": null }));
    save_replay("SET-030-replay.json", "signedIn", serde_json::to_value(&before).unwrap());
    save_replay("SET-030-replay.json", "signedOut", serde_json::to_value(&after).unwrap());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn set030_box2_the_auto_resume_switch_is_off_by_default_and_on_after_a_restart() {
    let d = scratch("s30b2");
    let profile = d.join("profile");
    let first = Store::open(&profile).unwrap();
    assert_ne!(first.settings()["claudeResumeAfterLimit"], json!(true), "off unless the user turns it on");
    // What the page sends when the switch is turned on (src/settings/__cards__/SET-030.test.ts asserts this exact patch).
    let set = serde_json::Map::from_iter([("claudeResumeAfterLimit".to_string(), json!(true))]);
    first.patch_settings(&set, &[]).unwrap();
    drop(first);
    // Restart: a new Store on the same folder.
    let restarted = Store::open(&profile).unwrap().settings();
    assert_eq!(restarted["claudeResumeAfterLimit"], json!(true));
    save_replay("SET-030-replay.json", "restarted", restarted);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn set037_a_profile_that_had_settings_starts_classic_and_the_new_look_with_a_first_screen_survives_a_restart() {
    let d = scratch("s37");
    // A profile from before the redesign: it has settings, but no uiLook.
    let old = d.join("old");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("settings.json"), r#"{"defaultAgent":"claude"}"#).unwrap();
    let store = Store::open(&old).unwrap();
    store.stamp_look();
    let legacy = store.settings();
    assert_eq!(legacy["uiLook"], json!("classic"), "an existing profile stays Classic until the user picks New");
    // A fresh profile (no file) starts New.
    let fresh = Store::open(&d.join("fresh")).unwrap();
    fresh.stamp_look();
    assert_eq!(fresh.settings()["uiLook"], json!("new"));
    // What the General page sends: the look, then the first screen (the page writes lastScreen with it).
    let set = |pairs: &[(&str, &str)]| serde_json::Map::from_iter(pairs.iter().map(|(k, v)| (k.to_string(), json!(v))));
    store.patch_settings(&set(&[("uiLook", "new")]), &[]).unwrap();
    store.patch_settings(&set(&[("firstScreen", "board"), ("lastScreen", "board")]), &[]).unwrap();
    drop(store);
    let reopened = Store::open(&old).unwrap().settings();
    assert_eq!((reopened["uiLook"].as_str(), reopened["firstScreen"].as_str(), reopened["defaultAgent"].as_str()), (Some("new"), Some("board"), Some("claude")), "{reopened}");
    save_replay("SET-037-replay.json", "legacy", legacy);
    save_replay("SET-037-replay.json", "reopened", reopened);
    let _ = std::fs::remove_dir_all(&d);
}

/// The `--flag value` words of a typed command line as the arguments the app receives.
fn typed(line: &str) -> (String, Value) {
    let words: Vec<String> = line.split_whitespace().map(String::from).collect();
    let p = parse(&words).1.unwrap().unwrap();
    (p.command, Value::Object(p.args))
}

#[test]
fn set028_box1_a_tier_given_a_small_model_starts_the_worker_on_it_and_its_start_line_names_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let d = scratch("s28");
    let repo = repo_in(&d, "repo");
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&d.join("data")).unwrap());
    add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let save = |light: Value| {
        let s = store.lock().unwrap();
        let mut settings = s.settings();
        settings["workspacesDir"] = json!(d.join("ws").display().to_string());
        settings["branchPrefix"] = json!("none");
        settings["modelRouting"] = json!({ "claude": { "light": light } });
        s.save_settings(&settings).unwrap();
        settings
    };
    let events = Mutex::new(Vec::<Value>::new());
    let notify = |v: Value| {
        if let Some(r) = v["setupRequest"].as_str() {
            kolux_lib::orchestration::setup_gate::settle(r, json!({ "result": "none" }));
        }
        events.lock().unwrap().push(v)
    };
    let terminals = Terminals::default();
    let ctx = Ctx { claude_config: d.join(".claude.json"), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
    // A worker started on the light tier; no window opens its terminal, so the wait runs out, the start notice is what the window gets.
    let start_on_light = || {
        let (command, mut args) = typed("orchestration worker-start --spec x --tier light");
        args["timeoutMs"] = json!("1");
        let req = Request { id: "r".into(), token: String::new(), command, cwd: repo.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let out = dispatch(&ctx, &req).unwrap_err();
        assert_eq!(out.code, "timeout", "{}", out.message);
        let ev = events.lock().unwrap();
        let start = ev.iter().rev().find(|e| e["kind"] == "start").expect("the window is told to start the agent").clone();
        assert_eq!((start["agent"].as_str(), out.data["tier"].as_str()), (Some("claude"), Some("light")));
        start["extra"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect::<Vec<_>>()
    };
    let claude_installed = kolux_lib::agents::agent_list().iter().any(|a| a.id == "claude" && a.installed);
    if !claude_installed {
        eprintln!("Claude Code is not installed here, so a tier worker cannot start");
        return;
    }
    // The fast (light) tier is given the small model, Haiku (a model with no effort levels).
    let settings = save(json!({ "model": "haiku", "effort": "" }));
    let extra = start_on_light();
    assert_eq!(extra, vec!["--model", "haiku"], "the worker's launch line carries the tier's model");
    // The tier's pick is what decides it: moved to Sonnet at low, the next worker starts on that.
    save(json!({ "model": "sonnet", "effort": "low" }));
    assert_eq!(start_on_light(), vec!["--model", "sonnet", "--effort", "low"]);
    // The window turns that notice into the pane's start line (agent_start_line -> start_line_as); the pane header reads --model from it.
    let line = start_line_as(&settings, "claude", &extra, "x", false, Start::Fresh).unwrap();
    let at = line.args.iter().position(|a| a == "--model").expect("--model in the start line");
    assert_eq!(line.args[at + 1], "haiku");
    save_replay("SET-028-replay.json", "extra", json!(extra));
    save_replay("SET-028-replay.json", "args", json!(line.args));
    let _ = std::fs::remove_dir_all(&d);
}

static REPLAY: Mutex<()> = Mutex::new(());

/// Checks a produced value against evidence/cards-<file> (parsed JSON) for the TS half; CARDS_REGEN=1 rewrites it, in LF.
fn save_replay(file: &str, key: &str, value: Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("evidence").join(format!("cards-{file}"));
    let _guard = REPLAY.lock().unwrap_or_else(|e| e.into_inner());
    let mut doc: Value = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    if std::env::var_os("CARDS_REGEN").is_none() {
        assert_eq!(doc.get(key), Some(&value), "fixture stale: rerun with CARDS_REGEN=1 ({key})");
        return;
    }
    doc[key] = value;
    std::fs::write(&path, serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
}
