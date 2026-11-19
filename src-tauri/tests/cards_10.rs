//! spec/10 P0 boxes SAFE-023, SAFE-024 (folder trust) and the status half of SAFE-001 (plan review button).
//! Every trust file lives under the scratch root (found from the home marker); nothing here touches a real agent home.

mod scratch_root;

use kolux_lib::status::{report, Agent};
use kolux_lib::trust::{claude_config_file, claude_key, trust_folders};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("safe10").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-scratch"), "").unwrap();
    d
}

/// Real git in a scratch folder; panics on failure.
fn git(dir: &Path, args: &[&str]) {
    assert!(norm(dir).starts_with(&norm(scratch_root::root())), "git would run outside the scratch root: {dir:?}");
    let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// T-780: a launch pre-trusts only worktrees of a main checkout the user already trusted in the
/// same agent file. A repository at `dir/main` with one commit, one linked worktree per name
/// (`dir/<name>`), and the user's own acceptance of `main` (Claude's trust answer, in the shape
/// Claude writes it) put into `file` with `extra` beside it. Returns the worktrees and the bytes
/// `file` holds before Kolux touches it.
fn trusted_main_with_worktrees(dir: &Path, file: &Path, names: &[&str], extra: Value) -> (Vec<PathBuf>, Vec<u8>) {
    let main = dir.join("main");
    std::fs::create_dir_all(&main).unwrap();
    git(&main, &["init", "-q", "-b", "main"]);
    std::fs::write(main.join("README.md"), "hello\n").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["-c", "user.email=card@example.invalid", "-c", "user.name=Card Tester", "commit", "-q", "-m", "first"]);
    let wts: Vec<PathBuf> = names
        .iter()
        .map(|n| {
            let wt = dir.join(n);
            git(&main, &["worktree", "add", "-q", "-b", &format!("kolux-{}", n.to_lowercase()), &wt.to_string_lossy()]);
            wt
        })
        .collect();
    let mut seed = extra;
    if !seed["projects"].is_object() {
        seed["projects"] = json!({});
    }
    seed["projects"][claude_key(&main).unwrap()] = json!({ "hasTrustDialogAccepted": true });
    let bytes = serde_json::to_vec_pretty(&seed).unwrap();
    std::fs::write(file, &bytes).unwrap();
    (wts, bytes)
}

fn doc(file: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
}

#[test]
fn safe023_box2_launching_again_in_the_same_folder_leaves_the_trust_file_byte_for_byte_alone() {
    let d = scratch("b2");
    // The path Kolux resolves for Claude's configuration is the redirected one.
    let resolved = claude_config_file();
    assert!(norm(&resolved).starts_with(&norm(scratch_root::root())), "{resolved:?} is not under the scratch root");
    assert!(resolved.ends_with(".claude.json"));
    let file = d.join(".claude.json");
    let seed = json!({ "userID": "u1", "projects": { "G:/Elsewhere": { "hasTrustDialogAccepted": true, "allowedTools": ["Bash"] } } });
    let (wt, _) = trusted_main_with_worktrees(&d, &file, &["Fresh-Worktree"], seed);

    assert_eq!(trust_folders(&file, "claude", &wt).unwrap(), 1, "first launch records the folder");
    let key = claude_key(&wt[0]).unwrap();
    assert!(key.ends_with("/Fresh-Worktree") && !key.contains('\\'), "{key}");
    assert_eq!(doc(&file)["projects"][&key]["hasTrustDialogAccepted"], true);

    let bytes = std::fs::read(&file).unwrap();
    let stamp = std::fs::metadata(&file).unwrap().modified().unwrap();
    let siblings = std::fs::read_dir(&d).unwrap().count();
    // Second launch, also spelled in lower case and with backslashes: still the same folder.
    let again = [wt[0].clone(), PathBuf::from(wt[0].to_string_lossy().to_lowercase().replace('/', "\\"))];
    assert_eq!(trust_folders(&file, "claude", &again).unwrap(), 0, "nothing new to record");
    assert_eq!(std::fs::read(&file).unwrap(), bytes, "the file's bytes did not change");
    assert_eq!(std::fs::metadata(&file).unwrap().modified().unwrap(), stamp, "the file was not even rewritten");
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), siblings, "no backup or temp file appeared");

    let after = doc(&file);
    assert_eq!(after["projects"].as_object().unwrap().len(), 3, "no duplicate entry: the other project, the trusted main checkout and the worktree");
    assert_eq!(after["projects"]["G:/Elsewhere"]["allowedTools"], json!(["Bash"]), "every other project and setting kept");
    assert_eq!(after["userID"], "u1");
    assert!(norm(&file).starts_with(&norm(scratch_root::root())), "the file written lies under the scratch root");
}

#[test]
fn safe024_box1_six_worktrees_are_covered_by_one_call_and_one_write() {
    let d = scratch("b1");
    let file = d.join(".claude.json");
    let (wts, seed) = trusted_main_with_worktrees(&d, &file, &["w1", "w2", "w3", "w4", "w5", "w6"], json!({}));
    assert_eq!(trust_folders(&file, "claude", &wts).unwrap(), 6, "one call records all six");
    let projects = doc(&file)["projects"].as_object().unwrap().clone();
    assert_eq!(projects.len(), 7, "the six worktrees beside the main checkout the user trusted");
    for w in &wts {
        assert_eq!(projects[&claude_key(w).unwrap()]["hasTrustDialogAccepted"], true);
    }
    // One write: every save keeps the bytes it replaced as the backup, so a backup that still holds
    // the user's own file, untouched by any earlier worktree entry, means the six went down together.
    let mut names: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    names.sort();
    assert_eq!(names.iter().filter(|n| n.ends_with(".bak-kolux")).count(), 1, "{names:?}");
    assert_eq!(std::fs::read(d.join(".claude.json.bak-kolux")).unwrap(), seed, "the one write replaced the user's own file");
    assert!(norm(&file).starts_with(&norm(scratch_root::root())), "the file written lies under the scratch root");
}

#[test]
fn safe024_box2_thirteen_folders_are_refused_before_any_path_is_worked_out() {
    let d = scratch("b2cap");
    let file = d.join(".claude.json");
    // None of these exist: working a path out would fail with that path's name in the error.
    let thirteen: Vec<PathBuf> = (0..13).map(|i| d.join(format!("never-made-{i}"))).collect();
    let err = trust_folders(&file, "claude", &thirteen).unwrap_err();
    assert!(err.contains("12") && err.contains("13"), "{err}");
    assert!(!err.contains("never-made"), "no folder path was looked at: {err}");
    assert!(!file.exists(), "a refused batch writes nothing");
    // Twelve is the most that goes through (worktrees of a main checkout the user trusted).
    let (twelve, _) = trusted_main_with_worktrees(&d, &file, &["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], json!({}));
    assert_eq!(trust_folders(&file, "claude", &twelve).unwrap(), 12);
    assert!(norm(&file).starts_with(&norm(scratch_root::root())), "the file written lies under the scratch root");
}

fn status(pane: u32, j: &str) -> Value {
    let event: Value = serde_json::from_str(j).unwrap();
    serde_json::to_value(report(pane, None, Agent::Claude, &event).expect("the event changes the pane's state")).unwrap()
}

const PROMPT: &str = r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan the refactor"}"#;

#[test]
fn safe001_box1_the_status_carries_the_plan_while_claude_waits_and_drops_it_once_it_is_approved() {
    let plan = "# Plan\n\n1. Read the code\n2. Fix it";
    let pre = |name: &str| json!({ "hook_event_name": name, "tool_name": "ExitPlanMode", "tool_input": { "plan": plan } }).to_string();
    // Either event on its own is enough: the PreToolUse path ...
    let first = 9_110_001;
    status(first, PROMPT);
    let w = status(first, &pre("PreToolUse"));
    assert_eq!((w["state"].as_str(), w["tool"].as_str(), w["plan"].as_str()), (Some("waiting"), Some("ExitPlanMode"), Some(plan)));
    // ... and the PermissionRequest path.
    let second = 9_110_002;
    status(second, PROMPT);
    let p = status(second, &pre("PermissionRequest"));
    assert_eq!((p["state"].as_str(), p["tool"].as_str(), p["plan"].as_str()), (Some("permission"), Some("ExitPlanMode"), Some(plan)));
    // Approved in the terminal instead: Claude finishes the exit-plan step, the pane is working and the plan is gone.
    let done = status(second, r#"{"hook_event_name":"PostToolUse","tool_name":"ExitPlanMode"}"#);
    assert_eq!(done["state"], "working");
    assert!(done.get("plan").is_none_or(|v| v.is_null()), "{done}");
}

#[test]
fn safe001_box2_a_shell_permission_carries_no_plan() {
    let pane = 9_110_003;
    status(pane, PROMPT);
    let s = status(pane, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build","plan":"smuggled"}}"#);
    assert_eq!((s["state"].as_str(), s["tool"].as_str()), (Some("permission"), Some("Bash")));
    assert!(s.get("plan").is_none_or(|v| v.is_null()), "{s}");
}

// ---- SAFE-021 / SAFE-022 (batch 4): only fake path strings; no opener, no explorer, no network is ever called ----
use kolux_lib::artifacts::open_external;
use kolux_lib::fence::{check, Fence};
use kolux_lib::links::{fence as file_fence, fence_key, host_path, launchable, program_like, refuse_host};
use kolux_lib::state::Store;
use std::collections::HashSet;

const OTHER_MACHINES: [&str; 9] = [
    r"\\kolux-cards.invalid\share\x.txt",
    "//kolux-cards.invalid/share/x.txt",
    "file://kolux-cards.invalid/share/x.txt",
    "FILE://kolux-cards.invalid/x",
    "file:////kolux-cards.invalid/share",
    r"\\?\UNC\kolux-cards.invalid\share\x",
    r"\\.\pipe\kolux-cards",
    r"\??\UNC\kolux-cards.invalid\share\x",
    r"\\.\UNC\kolux-cards.invalid\share\x",
];

#[test]
fn safe021_box1_double_slash_shares_and_file_urls_naming_a_host_are_refused_as_text_before_any_file_access() {
    let none = HashSet::new();
    let started = std::time::Instant::now();
    for p in OTHER_MACHINES {
        assert!(host_path(p, &[]), "{p}");
        let why = refuse_host(p, &[]).unwrap_err();
        assert!(why.contains("another computer"), "{p}: {why}");
        // the file fence gives the same refusal, even for a path that was granted by its exact name
        let mut granted = HashSet::new();
        granted.insert(fence_key(p));
        for grants in [&none, &granted] {
            let why = file_fence(p, &[], grants, true).unwrap_err();
            assert!(why.contains("another computer"), "{p}: {why}");
        }
        // the system-opener door for a clicked URL never takes a file or host link
        if p.to_ascii_lowercase().starts_with("file:") {
            assert!(open_external(p.to_string()).unwrap_err().contains("not a web or mail link"), "{p}");
        }
    }
    // other schemes that name a host are no web or mail link either
    for u in ["ssh://kolux-cards.invalid/x", "smb://kolux-cards.invalid/share", r"\\kolux-cards.invalid\share\x"] {
        assert!(open_external(u.to_string()).is_err(), "{u}");
    }
    // text only: names that cannot resolve are answered at once for the whole set (no connection is attempted)
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "refusals took {:?}", started.elapsed());
    // the terminal scan hands a double-slash path on as `/host/share/x` (links.ts drops the first slash): on Windows that is no full path
    #[cfg(windows)]
    assert!(file_fence("/kolux-cards.invalid/share/x.txt", &[], &none, true).unwrap_err().contains("not a full path"));
    // the second fence in the app (ACCT-055, used by the openers) reads the spelling too, before it resolves anything
    for p in [r"\\kolux-cards.invalid\share\x.txt", "//kolux-cards.invalid/share/x.txt", r"\\.\pipe\kolux-cards"] {
        assert!(check(Path::new(p), &[], &[], true).is_err(), "{p}");
    }
}

#[test]
fn safe021_box2_a_long_path_local_drive_form_that_climbs_into_a_unc_path_is_a_host_path() {
    for p in [
        r"\\?\C:\..\..\UNC\kolux-cards.invalid\share\x",
        r"\\?\c:\a\b\..\..\..\unc\kolux-cards.invalid\share",
        r"\??\C:\..\..\UNC\kolux-cards.invalid\share",
        r"\\?\C:\a\..\b",
        r"\\wsl$\Ubuntu\..\..\kolux-cards.invalid\share",
    ] {
        assert!(host_path(p, &[]), "{p}");
        assert!(refuse_host(p, &[]).unwrap_err().contains("another computer"), "{p}");
        assert!(file_fence(p, &[], &HashSet::new(), true).unwrap_err().contains("another computer"), "{p}");
    }
    // the refusal comes from the climb: the same long-path form without it is a local drive
    for p in [r"\\?\C:\very\long\path", r"\\?\c:", r"\??\C:\very\long\path"] {
        assert!(!host_path(p, &[]), "{p}");
        assert_eq!(refuse_host(p, &[]), Ok(()), "{p}");
    }
}

#[test]
fn safe021_box3_wsl_and_long_path_local_paths_pass_and_a_share_in_a_registered_root_is_not_refused_as_remote() {
    for p in [
        r"\\wsl$\Ubuntu\home\me\a.txt",
        r"\\wsl.localhost\Ubuntu\home\me",
        r"\\?\UNC\wsl$\Ubuntu\home",
        "file://wsl$/Ubuntu/home/me/a.txt",
        "file://wsl.localhost/Ubuntu/home/me/a.txt",
        r"\\?\C:\very\long\path\a.txt",
    ] {
        assert!(!host_path(p, &[]), "{p}");
        assert_eq!(refuse_host(p, &[]), Ok(()), "{p}");
    }
    let roots = [r"\\nas.invalid\Projects\repo".to_string(), r"C:\code".to_string()];
    for p in [r"\\NAS.invalid\projects\repo\src\a.rs", "//nas.invalid/projects/repo/a", r"\\nas.invalid\projects\repo", r"\\?\UNC\nas.invalid\projects\repo\a"] {
        assert_eq!(refuse_host(p, &roots), Ok(()), "inside the registered root: {p}");
    }
    // ...while the rest of that share, a name that merely starts the same, and a climb stay refused
    for p in [r"\\nas.invalid\projects\other", r"\\nas.invalid\projects\repo2\a", r"\\nas.invalid\projects\repo\..\other", r"\\code\x"] {
        assert!(refuse_host(p, &roots).unwrap_err().contains("another computer"), "{p}");
    }
}

#[test]
fn safe021_box4_a_grant_covers_the_exact_path_and_a_folder_grant_gives_no_file_beneath_it() {
    let d = scratch("grant-folder");
    let (repo, outside) = (d.join("repo"), d.join("outside"));
    std::fs::create_dir_all(repo.join("src")).unwrap();
    std::fs::create_dir_all(outside.join("sub")).unwrap();
    std::fs::write(outside.join("a.txt"), "a").unwrap();
    std::fs::write(outside.join("sub").join("b.txt"), "b").unwrap();
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let roots = vec![s(&repo)];
    // links.rs grants (what file_grant stores): the folder itself, nothing under it
    let mut granted = HashSet::new();
    granted.insert(fence_key(&s(&outside)));
    assert!(file_fence(&s(&outside), &roots, &granted, true).is_ok(), "the exact path");
    for beneath in [outside.join("a.txt"), outside.join("sub").join("b.txt"), outside.join("missing.txt")] {
        let why = file_fence(&s(&beneath), &roots, &granted, true).unwrap_err();
        assert!(why.contains("outside your projects"), "{beneath:?}: {why}");
    }
    // ACCT-055 fence (what the openers use): a folder is never granted, a file is granted alone
    let store = Store::open(&d.join("profile")).unwrap();
    let fence = Fence::default();
    assert!(fence.grant(&outside, &store).is_err(), "a folder");
    assert!(fence.grant(Path::new(r"G:\"), &store).is_err(), "a drive root");
    assert_eq!(store.get("file_grants").unwrap(), None, "nothing was recorded for a folder or a root");
    fence.grant(&outside.join("a.txt"), &store).unwrap();
    let saved = store.get("file_grants").unwrap().unwrap();
    assert!(saved.contains("a.txt") && !saved.contains("b.txt"), "{saved}");
    let picked = outside.join("a.txt").canonicalize().unwrap();
    let repo_roots = [repo.clone()];
    assert!(check(&outside.join("a.txt"), &repo_roots, std::slice::from_ref(&picked), true).is_ok());
    for other in [outside.join("sub").join("b.txt"), outside.join("sub")] {
        assert!(check(&other, &repo_roots, std::slice::from_ref(&picked), true).is_err(), "{other:?} is not covered by a grant on a.txt");
    }
    assert!(check(&outside.join("sub").join("b.txt"), &repo_roots, &[], true).is_err());
}

#[cfg(windows)]
fn dir_link(link: &Path, target: &Path) {
    if std::os::windows::fs::symlink_dir(target, link).is_err() {
        let ok = std::process::Command::new("cmd").arg("/c").arg("mklink").arg("/J").arg(link).arg(target).output().map(|o| o.status.success()).unwrap_or(false);
        assert!(ok, "could not create a directory link at {link:?}");
    }
}
#[cfg(unix)]
fn dir_link(link: &Path, target: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[test]
fn safe021_box5_a_repo_folder_linked_to_the_home_folder_never_exposes_what_is_beneath_it() {
    let d = scratch("home-link");
    let (repo, home) = (d.join("repo"), d.join("fakehome"));
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::create_dir_all(home.join(".ssh")).unwrap();
    std::fs::write(home.join(".ssh").join("id_key"), "not a real key").unwrap();
    let link = repo.join("homelink");
    dir_link(&link, &home);
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let roots = vec![s(&repo)];
    let key = link.join(".ssh").join("id_key");
    let none = HashSet::new();
    // reading through the link is refused, with or without a grant on the link itself
    assert!(file_fence(&s(&link), &roots, &none, true).unwrap_err().contains("through a link"));
    assert!(file_fence(&s(&key), &roots, &none, true).unwrap_err().contains("through a link"));
    let mut granted = HashSet::new();
    granted.insert(fence_key(&s(&link)));
    for beneath in [link.join(".ssh"), key.clone()] {
        assert!(file_fence(&s(&beneath), &roots, &granted, true).is_err(), "{beneath:?} stays refused after the link is granted");
    }
    // the opener fence: the link resolves to a folder, so it is never granted, and nothing beneath it is reachable
    let store = Store::open(&d.join("profile")).unwrap();
    let fence = Fence::default();
    assert!(fence.grant(&link, &store).is_err());
    assert_eq!(store.get("file_grants").unwrap(), None);
    let repo_roots = [repo.clone()];
    for beneath in [link.join(".ssh"), key] {
        assert!(check(&beneath, &repo_roots, &[], true).is_err(), "{beneath:?}");
    }
}

#[test]
fn safe022_box1_batch_js_exe_and_shortcut_files_are_launchable_so_they_are_revealed_not_opened() {
    let d = scratch("programs");
    for name in ["setup.bat", "run.cmd", "build.js", "tool.exe", "link.lnk", "app.com", "task.vbs", "x.ps1", "pkg.msi", "page.hta"] {
        let f = d.join(name);
        std::fs::write(&f, "").unwrap();
        assert!(launchable(&f), "{name}");
        assert!(program_like(&f.to_string_lossy(), true), "{name} on Windows");
        assert!(program_like(&f.to_string_lossy(), false), "{name} on POSIX");
    }
    // the unusual office / web-query types the card names
    for name in ["notes.one", "query.iqy", "data.slk"] {
        assert!(program_like(name, true) && program_like(name, false), "{name}");
    }
}

#[test]
fn safe022_box2_a_stream_suffix_a_trailing_dot_or_space_or_a_short_name_cannot_hide_a_program() {
    for p in [r"C:\w\run.bat::$DATA", r"C:\w\run.bat:Zone.Identifier", r"C:\w\run.bat.", r"C:\w\run.bat ", r"C:\w\run.bat. .", r"C:\w\tool.exe:x", r"C:\w\SETUP.CMD...", r"C:\w\PROGRA~1.EXE", r"C:\w\RUNME~1.BAT", "run.bat::$DATA"] {
        assert!(program_like(p, true), "{p}");
    }
    #[cfg(windows)]
    for p in [r"C:\w\run.bat::$DATA", r"C:\w\run.bat.", r"C:\w\run.bat ", r"C:\w\tool.exe:x"] {
        assert!(launchable(Path::new(p)), "launchable on this platform: {p}");
    }
    // the same names are not over-blocked when the program type is not what the suffix hides
    for p in [r"C:\w\notes.txt:stream", r"C:\w\notes.txt.", r"C:\w\readme.md "] {
        assert!(!program_like(p, true), "{p}");
    }
}

#[test]
fn safe022_box3_a_plain_text_file_is_not_launchable_so_it_opens_normally() {
    let d = scratch("plain-text");
    for name in ["notes.txt", "README.md", "data.json", "photo.png", "log.txt."] {
        let f = d.join(name.trim_end_matches('.'));
        std::fs::write(&f, "hello").unwrap();
        assert!(!launchable(&f), "{name}");
        assert!(!program_like(name, true) && !program_like(name, false), "{name}");
    }
}
