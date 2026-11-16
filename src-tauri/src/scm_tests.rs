//! Tests for `scm.rs`, moved out unchanged (c2-agents audit: scm.rs split along its test seam). Lines inside
//! multi-line string literals keep their original indentation, so every test input is byte-for-byte the same.

use super::*;
use std::path::PathBuf;

fn temp_repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-scm-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
    run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&dir)).unwrap();
    run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
    fs::write(dir.join("README.md"), "hello\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
    dir
}

#[test]
fn git012_a_huge_change_set_is_cut_and_its_heavy_folder_offered_until_ignored() {
    let dir = temp_repo("git012-heavy");
    fs::create_dir_all(dir.join("node_modules")).unwrap();
    for i in 0..PANEL_CAP + 200 {
        fs::write(dir.join("node_modules").join(format!("m{i}.js")), "x").unwrap();
    }
    fs::create_dir_all(dir.join("target")).unwrap();
    fs::write(dir.join("target").join("out.bin"), "x").unwrap();
    fs::write(dir.join(".gitignore"), "/target/").unwrap();
    let st = capped(status(&dir).unwrap(), &dir);
    // node_modules' 1,200 files plus .gitignore: the list shows 1,000 and counts the rest.
    assert_eq!((st.untracked.len(), st.cut), (PANEL_CAP, 201));
    assert_eq!(st.heavy, ["node_modules"], "target is ignored already and the other heavy names are not there");
    ignore_heavy(&dir, &["node_modules".into()]).unwrap();
    assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), "/target/\n/node_modules/\n");
    let st = capped(status(&dir).unwrap(), &dir);
    assert_eq!((st.untracked.len(), st.cut, st.heavy.len()), (1, 0, 0), "the list shrinks and nothing is offered again");
    ignore_heavy(&dir, &["node_modules".into()]).unwrap();
    assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), "/target/\n/node_modules/\n", "never written twice");
    assert!(ignore_heavy(&dir, &["src".into()]).is_err(), "only known heavy folders");
    assert!(ignore_heavy(&dir, &[]).is_err());
    let fresh = temp_repo("git012-fresh");
    ignore_heavy(&fresh, &["dist".into()]).unwrap();
    assert_eq!(fs::read_to_string(fresh.join(".gitignore")).unwrap(), "/dist/\n", "made when there is none");
    // A small change set is left whole and nothing is looked for.
    let small = capped(status(&fresh).unwrap(), &fresh);
    assert_eq!((small.cut, small.heavy.len()), (0, 0));
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&fresh);
}

/// PROJ-062 (T-609, cycle 3): the card's count is each changed path once, across staged, changed,
/// untracked and conflicted files (the window's changedCount has the same rule), read from one git
/// status on a real worktree.
#[test]
fn proj062_the_card_count_is_each_changed_path_once_and_matches_the_panel() {
    let dir = temp_repo("card-count");
    fs::write(dir.join("README.md"), "hello again\n").unwrap();
    fs::write(dir.join("new.md"), "new\n").unwrap();
    fs::write(dir.join("staged.md"), "staged\n").unwrap();
    run(&["add", "staged.md"], Some(&dir)).unwrap();
    fs::write(dir.join("staged.md"), "staged and changed\n").unwrap();
    let panel = status(&dir).unwrap();
    assert_eq!(count(&dir).unwrap(), 3, "{:?} {:?} {:?}", panel.staged, panel.changed, panel.untracked);
    assert_eq!(count(&dir).unwrap(), count_paths(&panel), "the count is the panel's rule without the lists");
    let c = |path: &str| Change { path: path.into(), status: "M".into(), from: None };
    assert_eq!(count_paths(&Status { staged: vec![c("a")], changed: vec![c("a")], ..Status::default() }), 1, "a path listed twice counts once");
    let _ = fs::remove_dir_all(&dir);
}

/// PROJ-062: the count reads in the background lane. It never wraps its read in `git::foreground`, so a
/// waiting count goes behind the panel on screen and the editor's reads on the same worktree (GIT-070).
#[test]
fn proj062_the_card_count_reads_in_the_background_lane() {
    let dir = temp_repo("card-count-lane");
    assert!(!crate::git::foreground_lane(), "a plain thread is background work");
    assert_eq!(count(&dir).unwrap(), 0);
    assert!(!crate::git::foreground_lane(), "the count must not enter the foreground lane");
    crate::git::foreground(|| assert!(crate::git::foreground_lane(), "the lane hook works"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn git070_a_status_read_already_running_is_shared_not_started_again() {
    static R: Running = std::sync::Mutex::new(Vec::new());
    static READS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static SECOND_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let dir = Path::new("git070-shared-worktree");
    // Load flake fix: no sleep decides who is first. The first read holds until the second
    // caller has joined it (its share of the answer is counted) or has answered on its own (the
    // regression: a second git started), with a 60 s ceiling; the second starts only once the
    // first read is running.
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let first = std::thread::spawn(move || {
        shared(&R, dir, || {
            let mine = R.lock().unwrap().iter().find(|(p, _)| p == dir).map(|(_, s)| s.clone()).unwrap();
            let alone = std::sync::Arc::strong_count(&mine);
            started_tx.send(()).unwrap();
            let end = std::time::Instant::now() + std::time::Duration::from_secs(60);
            while std::sync::Arc::strong_count(&mine) <= alone && !SECOND_DONE.load(std::sync::atomic::Ordering::SeqCst) && std::time::Instant::now() < end {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            READS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(Status { ahead: 7, ..Status::default() })
        })
    });
    started_rx.recv_timeout(std::time::Duration::from_secs(60)).expect("the first read started");
    let second = shared(&R, dir, || Err("a second git was started".into()));
    SECOND_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(second.unwrap().ahead, 7);
    assert_eq!(first.join().unwrap().unwrap().ahead, 7);
    assert_eq!(READS.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(R.lock().unwrap().is_empty());
    let again = || {
        READS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Status { ahead: 7, ..Status::default() })
    };
    assert_eq!(shared(&R, dir, again).unwrap().ahead, 7, "a later read runs on its own");
    assert_eq!(READS.load(std::sync::atomic::Ordering::SeqCst), 2);
    // Another worktree is never handed this one's answer.
    assert!(shared(&R, Path::new("other"), || Err("own read".into())).is_err());
}

/// FIX-2 (b) / FIX-R2: no console window flashes up behind the app, so every program this file
/// builds a command for, its tests included, goes through `quiet`, the one place that hides the
/// console. (git runs go through git::command, which hides it the same way.)
/// FIX-3 (review AFTER 4): lines (1-based) of every program started with a bare `Command`
/// constructor call (any spacing around the path) in `src` that neither sits inside `fn quiet`
/// nor has a `creation_flags` call within the next thirty lines. A file whose commands all come
/// from `quiet` or `git::command` has none.
fn bare_spawns(src: &str) -> Vec<usize> {
    let quiet_at = src.find("fn quiet(");
    let quiet_end = quiet_at.map(|q| q + src[q..].find("\n}").unwrap_or(0));
    let lines: Vec<&str> = src.lines().collect();
    let mut found = Vec::new();
    let bytes = src.as_bytes();
    let mut from = 0;
    while let Some(i) = src[from..].find("Command") {
        let at = from + i;
        from = at + "Command".len();
        let rest: String = src[from..].chars().filter(|c| !c.is_whitespace()).take(6).collect();
        if !rest.starts_with("::new(") {
            continue;
        }
        if quiet_at.zip(quiet_end).is_some_and(|(q, e)| (q..e).contains(&at)) {
            continue;
        }
        let line = bytes[..at].iter().filter(|b| **b == b'\n').count();
        if lines[line].trim_start().starts_with("//") {
            continue;
        }
        let hidden = lines[line..lines.len().min(line + 30)].iter().any(|l| l.contains("creation_flags"));
        if !hidden {
            found.push(line + 1);
        }
    }
    found
}

#[test]
fn fix2_every_spawn_hides_its_console() {
    // The scanner itself: a bare spawn is seen, however it is spaced; one with its own flag is not.
    let new = ["Command", "::new("].concat();
    let spaced = ["Command", "\n        ::new("].concat();
    let bad = format!("fn a() {{\n    let c = std::process::{new}\"x\");\n}}\nfn b() {{\n    let c = {spaced}\"y\");\n}}\n// {new}\"z\") in a comment\n");
    assert_eq!(bare_spawns(&bad), vec![2, 5]);
    let good = format!("fn a() {{\n    let mut c = {new}\"x\");\n    c.creation_flags(crate::winproc::no_window());\n}}\n");
    assert!(bare_spawns(&good).is_empty());
    // The files that start programs for source control and gh: none opens a console window.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for name in ["scm.rs", "scm_watch.rs", "git.rs", "github.rs"] {
        let body = fs::read_to_string(dir.join(name)).unwrap();
        let bare = bare_spawns(&body);
        assert!(bare.is_empty(), "{name}: programs started without hiding their console, at lines {bare:?}");
    }
}

/// FIX-2 AFTER 1: Show in file manager only works on a worktree inside a registered project or
/// workspaces folder, so a forged call cannot open any folder on the machine.
#[test]
fn fix2_reveal_refuses_a_worktree_outside_every_project() {
    let dir = temp_repo("fix2-fence");
    let inside = vec![dir.to_string_lossy().into_owned()];
    assert_eq!(reveal_place(&inside, &dir.to_string_lossy(), "README.md").unwrap(), dir.join("README.md"));
    let elsewhere = vec![std::env::temp_dir().join("kolux-no-such-project").to_string_lossy().into_owned()];
    assert!(reveal_place(&elsewhere, &dir.to_string_lossy(), "README.md").unwrap_err().contains("outside"));
    let _ = fs::remove_dir_all(&dir);
}

/// FIX-2 AFTER 2: only a part that is not there ends the walk; any other lookup error refuses.
#[test]
fn fix2_reveal_refuses_when_a_part_cannot_be_read() {
    let dir = temp_repo("fix2-lookup");
    let long = "a".repeat(300);
    assert!(reveal_target(&dir, &format!("{long}/b.txt")).is_err(), "a name the file system cannot look up is refused, not walked past");
    assert_eq!(reveal_target(&dir, "gone/b.txt").unwrap(), dir);
    let _ = fs::remove_dir_all(&dir);
}

/// FIX-2 FS 1 (server side): a pull request link that names a user, a password or a port is
/// never opened, so `https://github.com@evil.example/...` cannot pass for github.com.
#[test]
fn fix2_a_pull_request_link_with_a_user_or_port_is_not_opened() {
    assert!(!safe_pr_url("https://github.com@evil.example/o/r/pull/1"));
    assert!(!safe_pr_url("https://user:tok@github.com/o/r/pull/1"));
    assert!(!safe_pr_url("https://github.com:8443/o/r/pull/1"));
    assert!(!safe_pr_url("https:///o/r/pull/1"));
    assert!(safe_pr_url("https://github.com/o/r/pull/1"));
}

#[test]
fn git008_a_pull_with_split_history_and_no_policy_is_named_and_the_picked_policy_finishes_it() {
    assert_eq!(failure_kind("hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches.", false), "no-policy");
    assert_eq!(failure_kind(" ! [rejected] main -> main (non-fast-forward)", false), "non-fast-forward");
    // Every git below reads only the repositories' own config: a pull.rebase in this PC's
    // global or system config (Git for Windows writes pull.rebase=false there) would decide
    // the split pull on its own and the no-policy path would never run.
    crate::git::ISOLATED.with(|i| i.set(true));
    let origin = std::env::temp_dir().join(format!("kolux-scm-git008-origin-{}", std::process::id()));
    let _ = fs::remove_dir_all(&origin);
    fs::create_dir_all(&origin).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&origin)).unwrap();
    let url = origin.to_string_lossy().replace('\\', "/");
    let a = temp_repo("git008-a");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&a);
    run(&["remote", "add", "origin", &url], Some(&a)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&a)).unwrap();
    let b = std::env::temp_dir().join(format!("kolux-scm-git008-b-{}", std::process::id()));
    let _ = fs::remove_dir_all(&b);
    run(&["clone", "-q", &url, &b.to_string_lossy()], None).unwrap();
    crate::git::trust_for_test(&b); // the second clone pushes too
    run(&["config", "user.email", "test@example.com"], Some(&b)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&b)).unwrap();
    fs::write(b.join("theirs.txt"), "theirs\n").unwrap();
    run(&["add", "."], Some(&b)).unwrap();
    run(&["commit", "-q", "-m", "theirs"], Some(&b)).unwrap();
    run(&["push", "-q"], Some(&b)).unwrap();
    fs::write(a.join("ours.txt"), "ours\n").unwrap();
    run(&["add", "."], Some(&a)).unwrap();
    run(&["commit", "-q", "-m", "ours"], Some(&a)).unwrap();
    // No pull policy anywhere: not in this repository, and the isolated global/system are empty.
    assert!(run(&["config", "--get", "pull.rebase"], Some(&a)).is_err() && run(&["config", "--get", "pull.ff"], Some(&a)).is_err());
    let config_before = fs::read_to_string(a.join(".git").join("config")).unwrap();
    // The real git's own words for the split are read as no-policy...
    let real = command_checked(&["pull"], Some(&a)).unwrap().output().unwrap();
    let said = format!("{}{}", String::from_utf8_lossy(&real.stdout), String::from_utf8_lossy(&real.stderr));
    assert!(!real.status.success(), "a split pull with no policy fails: {said}");
    assert_eq!(failure_kind(&said, false), "no-policy", "{said}");
    // ...and so is the app's own Pull.
    let out = remote(&a, "pull").unwrap();
    assert_eq!((out.ok, out.kind), (false, Some("no-policy")), "{}", out.output);
    // Picking rebase runs the pull again with it, and the repository's config is untouched.
    let again = remote(&a, "pullrebase").unwrap();
    assert!(again.ok, "{}", again.output);
    assert!(a.join("theirs.txt").is_file() && a.join("ours.txt").is_file());
    assert_eq!(status(&a).unwrap().behind, 0);
    assert_eq!(fs::read_to_string(a.join(".git").join("config")).unwrap(), config_before);
    // A second split, finished by picking merge: one merge commit joins both sides.
    fs::write(b.join("theirs2.txt"), "theirs 2\n").unwrap();
    run(&["add", "."], Some(&b)).unwrap();
    run(&["commit", "-q", "-m", "theirs 2"], Some(&b)).unwrap();
    run(&["push", "-q"], Some(&b)).unwrap();
    fs::write(a.join("ours2.txt"), "ours 2\n").unwrap();
    run(&["add", "."], Some(&a)).unwrap();
    run(&["commit", "-q", "-m", "ours 2"], Some(&a)).unwrap();
    let out = remote(&a, "pull").unwrap();
    assert_eq!((out.ok, out.kind), (false, Some("no-policy")), "{}", out.output);
    let merged = remote(&a, "pullmerge").unwrap();
    assert!(merged.ok, "{}", merged.output);
    assert!(a.join("theirs2.txt").is_file() && a.join("ours2.txt").is_file());
    let parents = run(&["rev-list", "--parents", "-n", "1", "HEAD"], Some(&a)).unwrap();
    assert_eq!(parents.split_whitespace().count(), 3, "HEAD is a merge commit with two parents: {parents}");
    assert_eq!(status(&a).unwrap().behind, 0);
    assert_eq!(fs::read_to_string(a.join(".git").join("config")).unwrap(), config_before);
    crate::git::ISOLATED.with(|i| i.set(false));
    for d in [&a, &b, &origin] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn git013_a_changed_submodule_is_one_row_with_its_state_and_rows_past_the_limit_are_counted() {
    assert_eq!(submodule_state("N..."), None);
    assert_eq!(submodule_state("SC.."), Some("new commits".into()));
    assert_eq!(submodule_state("S.MU"), Some("changed files, untracked files".into()));
    let line = |i: usize| format!("1 .M SC.. 160000 160000 160000 {h} {h} lib/sub{i}\0", h = "a".repeat(40));
    let mut text = String::from("# branch.head main\0");
    text.push_str(&format!("1 .M N... 100644 100644 100644 {h} {h} plain.txt\0", h = "b".repeat(40)));
    for i in 0..SUBMODULE_ROWS + 3 {
        text.push_str(&line(i));
    }
    let st = parse_status(&text);
    assert_eq!(st.submodules.len(), SUBMODULE_ROWS);
    assert_eq!(st.submodules_cut, 3);
    assert_eq!(st.submodules.get("lib/sub0").map(String::as_str), Some("new commits"));
    assert!(!st.submodules.contains_key("plain.txt"));
    assert_eq!(st.changed.len(), SUBMODULE_ROWS + 1, "the plain file and the listed submodules, each once");
    // A real submodule moved to another commit shows as one row under changes.
    let lib = temp_repo("git013-lib");
    let top = temp_repo("git013-top");
    let lib_url = lib.to_string_lossy().replace('\\', "/");
    run(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &lib_url, "vendor/lib"], Some(&top)).unwrap();
    run(&["commit", "-q", "-m", "add lib"], Some(&top)).unwrap();
    let inner = top.join("vendor").join("lib");
    run(&["config", "user.email", "test@example.com"], Some(&inner)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&inner)).unwrap();
    fs::write(inner.join("x.txt"), "x\n").unwrap();
    run(&["add", "."], Some(&inner)).unwrap();
    run(&["commit", "-q", "-m", "moved"], Some(&inner)).unwrap();
    fs::write(inner.join("y.txt"), "y\n").unwrap();
    let st = status(&top).unwrap();
    assert_eq!(st.changed.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), vec!["vendor/lib"]);
    assert!(st.untracked.is_empty(), "nothing inside the submodule is listed: {:?}", st.untracked);
    assert_eq!(st.submodules.get("vendor/lib").map(String::as_str), Some("new commits, untracked files"));
    for d in [&lib, &top] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn git014_reveal_stays_inside_the_worktree_through_links_too_and_falls_back_to_the_nearest_folder() {
    let dir = temp_repo("git014");
    fs::create_dir_all(dir.join("a")).unwrap();
    assert_eq!(reveal_target(&dir, "README.md").unwrap(), dir.join("README.md"));
    assert_eq!(reveal_target(&dir, "a/gone.txt").unwrap(), dir.join("a"));
    assert_eq!(reveal_target(&dir, "b/c/gone.txt").unwrap(), dir);
    assert!(reveal_target(&dir, "../outside.txt").is_err());
    assert!(reveal_target(&dir, "C:/Windows/notepad.exe").is_err());
    // A junction (or symlink) inside the worktree that leads out is refused, the file under it
    // and the link itself alike, even though the path text stays inside.
    let outside = std::env::temp_dir().join(format!("kolux-scm-git014-outside-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("b.txt"), "private\n").unwrap();
    #[cfg(windows)]
    let made = quiet("cmd").args(["/c", "mklink", "/J"]).arg(dir.join("j")).arg(&outside).output().unwrap().status.success();
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&outside, dir.join("j")).is_ok();
    assert!(made, "the junction was made");
    assert!(dir.join("j").join("b.txt").is_file(), "the file is reachable through it");
    assert!(reveal_target(&dir, "j/b.txt").unwrap_err().contains("link"));
    assert!(reveal_target(&dir, "j").is_err());
    assert!(reveal_target(&dir, "j/gone/deeper.txt").is_err());
    // A plain folder with a missing file still falls back as before.
    assert_eq!(reveal_target(&dir, "a/b/gone.txt").unwrap(), dir.join("a"));
    #[cfg(windows)]
    let _ = fs::remove_dir(dir.join("j"));
    #[cfg(unix)]
    let _ = fs::remove_file(dir.join("j"));
    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&dir);
}
#[test]
fn git038_base_changes_measure_against_the_snapshot_not_a_base_that_moved_on() {
    let dir = temp_repo("base-snapshot");
    run(&["checkout", "-q", "-b", "feature"], Some(&dir)).unwrap();
    fs::write(dir.join("f.txt"), "feature\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "feature"], Some(&dir)).unwrap();
    let snapshot = run(&["merge-base", "main", "HEAD"], Some(&dir)).unwrap().trim().to_string();
    // main moves on: that change is not the branch's and must not show up.
    run(&["checkout", "-q", "main"], Some(&dir)).unwrap();
    fs::write(dir.join("README.md"), "moved on\n").unwrap();
    run(&["commit", "-q", "-am", "main moves"], Some(&dir)).unwrap();
    run(&["checkout", "-q", "feature"], Some(&dir)).unwrap();
    fs::write(dir.join("f.txt"), "feature\nmore\n").unwrap();
    let got = base_changes(&dir, Some("main"), None).unwrap();
    assert_eq!((got.against.as_str(), got.since.as_str(), got.note.as_deref()), ("main", snapshot.as_str(), None));
    let rel = |e: &crate::git::Entry| Path::new(&e.path).strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
    assert_eq!(got.entries.iter().map(|e| (rel(e), e.code, e.lines)).collect::<Vec<_>>(), vec![("f.txt".to_string(), 'A', Some(2))]);
    // A pin that does not resolve falls back to the detected base; no base at all is an error.
    assert_eq!(base_changes(&dir, Some("no-such-branch"), None).map(|b| b.against).ok(), status(&dir).unwrap().base);
    let _ = fs::remove_dir_all(&dir);
}

/// Every git process (top level and children) `f` starts on this thread, as its arguments.
fn git_argvs(f: impl FnOnce()) -> Vec<String> {
    let trace = std::env::temp_dir().join(format!("kolux-scm-argvs-{}-{:?}.json", std::process::id(), std::thread::current().id()));
    let _ = fs::remove_file(&trace);
    crate::git::TRACE2.with(|t| *t.borrow_mut() = Some(trace.clone()));
    f();
    crate::git::TRACE2.with(|t| *t.borrow_mut() = None);
    let log = fs::read_to_string(&trace).unwrap_or_default();
    let _ = fs::remove_file(&trace);
    log.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|e| matches!(e["event"].as_str(), Some("start" | "child_start")))
        .map(|e| e["argv"].as_array().map(|a| a.iter().skip(1).filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())
        .collect()
}

#[test]
fn t033g_a_known_base_skips_the_second_status_and_no_shared_history_is_labelled_never_silent() {
    let dir = temp_repo("t033g");
    run(&["checkout", "-q", "-b", "feature"], Some(&dir)).unwrap();
    fs::write(dir.join("f.txt"), "feature\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "feature"], Some(&dir)).unwrap();
    let known = status(&dir).unwrap().base.expect("main is detected as the base");
    let snapshot = run(&["merge-base", "main", "HEAD"], Some(&dir)).unwrap().trim().to_string();
    // (b) The base the tab already has: the same answer, and not one `git status` behind it.
    let mut with = None;
    let argvs = git_argvs(|| with = Some(base_changes(&dir, None, Some(&known)).unwrap()));
    let with = with.unwrap();
    assert_eq!((with.against.as_str(), with.since.as_str(), with.note.as_deref()), (known.as_str(), snapshot.as_str(), None));
    assert!(!argvs.is_empty(), "trace2 log missing");
    assert_eq!(argvs.iter().filter(|a| a.starts_with("status")).count(), 0, "{argvs:?}");
    // Without it (first read before any status arrived) status finds the base, as before.
    let argvs = git_argvs(|| assert_eq!(base_changes(&dir, None, None).unwrap().since, snapshot));
    assert!(argvs.iter().any(|a| a.starts_with("status")), "{argvs:?}");
    // A pin still wins over the known base; option-looking text is never handed to git.
    assert_eq!(base_changes(&dir, Some("feature"), Some(&known)).unwrap().against, "feature");
    let argvs = git_argvs(|| assert_eq!(base_changes(&dir, Some("--output=x"), Some("-x")).map(|b| b.against).ok(), status(&dir).unwrap().base));
    assert!(argvs.iter().all(|a| !a.contains("--output=x") && !a.split(' ').any(|w| w == "-x")), "{argvs:?}");
    // (c) Unrelated histories: labelled, measured against the base tip.
    run(&["checkout", "-q", "--orphan", "other"], Some(&dir)).unwrap();
    run(&["rm", "-q", "-rf", "."], Some(&dir)).unwrap();
    fs::write(dir.join("o.txt"), "other\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "other root"], Some(&dir)).unwrap();
    let other_tip = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap().trim().to_string();
    run(&["checkout", "-q", "feature"], Some(&dir)).unwrap();
    let apart = base_changes(&dir, Some("other"), None).unwrap();
    assert_eq!((apart.since.as_str(), apart.note.as_deref()), (other_tip.as_str(), Some("vs other tip: no common ancestor found")));
    // A known base that has since been deleted is an error, not a silent compare.
    run(&["branch", "-q", "gone"], Some(&dir)).unwrap();
    run(&["branch", "-q", "-D", "gone"], Some(&dir)).unwrap();
    assert!(base_changes(&dir, None, Some("gone")).unwrap_err().contains("no longer exists"));
    // Unborn HEAD (a new orphan branch with nothing committed): an error that says so.
    run(&["checkout", "-q", "--orphan", "fresh"], Some(&dir)).unwrap();
    assert!(base_changes(&dir, Some("main"), None).unwrap_err().contains("no commits yet"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn git001_each_change_carries_its_added_and_removed_lines_and_a_binary_file_none() {
    let dir = temp_repo("lines");
    commit_file(&dir, "a.txt", "one\ntwo\nthree\n");
    commit_file(&dir, "old name.txt", "keep\nthis\n");
    fs::write(dir.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();
    fs::write(dir.join("b.txt"), "x\n").unwrap();
    run(&["add", "b.txt"], Some(&dir)).unwrap();
    run(&["mv", "old name.txt", "new ü.txt"], Some(&dir)).unwrap();
    fs::write(dir.join("new.txt"), "1\n2\n3").unwrap();
    fs::write(dir.join("pic.bin"), [0u8, 1, 2, 10, 0]).unwrap();
    let st = status(&dir).unwrap();
    assert_eq!(st.lines.changed.get("a.txt"), Some(&[2, 1]));
    assert_eq!(st.lines.staged.get("b.txt"), Some(&[1, 0]));
    assert_eq!(st.lines.staged.get("new ü.txt"), Some(&[0, 0]), "a rename counts at its new path");
    assert_eq!(st.lines.untracked.get("new.txt"), Some(&[3, 0]), "the last line counts without its newline");
    assert_eq!(st.lines.untracked.get("pic.bin"), None, "a binary file carries no counts");
    let _ = fs::remove_dir_all(&dir);
}

fn paths(list: &[Change]) -> Vec<&str> {
    list.iter().map(|c| c.path.as_str()).collect()
}

fn commit_file(dir: &Path, name: &str, text: &str) {
    fs::write(dir.join(name), text).unwrap();
    run(&["add", "."], Some(dir)).unwrap();
    run(&["commit", "-q", "-m", name], Some(dir)).unwrap();
}

fn counts(dir: &Path) -> (Option<String>, u32, u32, bool) {
    let st = status(dir).unwrap();
    (st.upstream, st.ahead, st.behind, st.rewritten)
}

/// A stand-in for gh: `pr view` finds nothing until `pr create` has run, every call is noted
/// in calls.txt and the description read from standard input lands in body.txt.
#[test]
fn a_gh_call_that_hangs_gives_up_after_its_time_limit() {
    let tools = std::env::temp_dir().join(format!("kolux-gh-hang-{}", std::process::id()));
    fs::create_dir_all(&tools).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\nping -n 30 127.0.0.1 >nul\r\necho late\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\nsleep 30\necho late\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let started = std::time::Instant::now();
    let err = gh_run_for(&gh, &tools, &["pr", "view"], None, std::time::Duration::from_secs(1)).unwrap_err();
    assert!(started.elapsed() < std::time::Duration::from_secs(10), "took {:?}", started.elapsed());
    assert!(err.contains("did not answer within 1 second"), "{err}");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-R2: asking gh which account it is signed in with has a time limit, so a gh that never
/// answers cannot hold up the Tasks page or onboarding; the caller gets a timeout error, and the
/// host gate passes that error on rather than calling the host signed out.
#[test]
fn fixr2_a_gh_that_never_answers_the_account_question_times_out_within_the_bound() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fixr2-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    // Never exits: the loop lives in the script's own process, so stopping it ends it.
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\n:again\r\nping -n 2 127.0.0.1 >nul\r\ngoto again\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\nwhile :; do sleep 1; done\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let ask = |limit: std::time::Duration| {
        let (tx, rx) = std::sync::mpsc::channel();
        let g = gh.clone();
        std::thread::spawn(move || {
            let _ = tx.send(gh_account_within(&g, "github.com", limit));
        });
        rx
    };
    let started = std::time::Instant::now();
    let got = ask(std::time::Duration::from_secs(1)).recv_timeout(std::time::Duration::from_secs(8)).expect("the account question returns within its bound");
    assert!(started.elapsed() < std::time::Duration::from_secs(8), "took {:?}", started.elapsed());
    assert!(got.as_ref().unwrap_err().contains("did not answer within 1 second"), "{got:?}");
    // The host gate (FIX-3: github::host_allowed, which asks gh only about a host other than
    // github.com) and the plain lookup use their own bounds and give up too; a gh that never
    // answers counts as not signed in there.
    let gate = crate::github::host_allowed(&gh, "ghe.example").unwrap_err();
    assert!(gate.contains("ghe.example is not one of them"), "{gate}");
    assert_eq!(gh_account(&gh, "github.com"), None);
    assert!(started.elapsed() < std::time::Duration::from_secs(1 + 2 * GH_ACCOUNT_LIMIT.as_secs() + 6), "took {:?}", started.elapsed());
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn checks_read_every_kind_and_a_finished_check_without_an_outcome_is_unresolved() {
    // VIEW-073: gh's statusCheckRollup mixes check runs (status + conclusion) and commit
    // statuses (state); each reads as one word, and COMPLETED with no conclusion is unresolved.
    let text = r#"{"number":12,"url":"https://github.com/o/r/pull/12","state":"OPEN","title":"Helper work","headRefName":"helper","isDraft":false,"mergeable":"CONFLICTING","statusCheckRollup":[
            {"__typename":"CheckRun","name":"build","workflowName":"CI","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://github.com/o/r/runs/1","startedAt":"2026-10-13T10:00:00Z","completedAt":"2026-10-13T10:04:00Z"},
            {"__typename":"CheckRun","name":"test","workflowName":"CI","status":"IN_PROGRESS","conclusion":"","detailsUrl":"https://github.com/o/r/runs/2","startedAt":"2026-10-13T10:00:00Z","completedAt":"0001-01-01T00:00:00Z"},
            {"__typename":"CheckRun","name":"lint","status":"COMPLETED","conclusion":"","startedAt":"2026-10-13T10:00:00Z","completedAt":"2026-10-13T10:01:00Z"},
            {"__typename":"CheckRun","name":"docs","status":"COMPLETED","conclusion":"SKIPPED"},
            {"__typename":"CheckRun","name":"deploy","status":"COMPLETED","conclusion":"CANCELLED"},
            {"__typename":"StatusContext","context":"ci/legacy","state":"FAILURE","targetUrl":"https://ci.example/9","description":"2 tests failed","startedAt":"2026-10-13T10:02:00Z"}
        ]}"#;
    let got = checks_from(text).unwrap();
    let pr = got.pr.as_ref().unwrap();
    assert_eq!((pr.number, pr.title.as_deref()), (12, Some("Helper work")));
    assert!(got.conflict, "CONFLICTING is a merge conflict notice");
    let words: Vec<(&str, &str)> = got.checks.iter().map(|c| (c.name.as_str(), c.outcome.as_str())).collect();
    assert_eq!(words, [("build", "passed"), ("test", "running"), ("lint", "unresolved"), ("docs", "skipped"), ("deploy", "cancelled"), ("ci/legacy", "failed")]);
    assert_eq!(got.checks[0].workflow.as_deref(), Some("CI"));
    assert_eq!(got.checks[0].link.as_deref(), Some("https://github.com/o/r/runs/1"));
    assert_eq!(got.checks[1].finished, None, "gh's zero time for a running check is no finish time");
    assert_eq!(got.checks[5].description.as_deref(), Some("2 tests failed"));
    assert_eq!(got.checks[5].link.as_deref(), Some("https://ci.example/9"));

    // A PR without checks, or mergeable, reads as none and no conflict.
    let bare = checks_from(r#"{"number":3,"url":"https://github.com/o/r/pull/3","state":"OPEN","mergeable":"MERGEABLE","statusCheckRollup":[]}"#).unwrap();
    assert!(!bare.conflict && bare.checks.is_empty());
}

#[test]
fn a_neutral_check_is_not_counted_as_passed_and_one_needing_action_is_failing() {
    // GIT-029
    let run = |c: &str| check_outcome(&serde_json::json!({"__typename":"CheckRun","status":"COMPLETED","conclusion":c}));
    assert_eq!(run("NEUTRAL"), "neutral");
    assert_eq!(run("ACTION_REQUIRED"), "failed");
    assert_eq!(run("SUCCESS"), "passed");
}

#[test]
fn a_branch_without_a_pull_request_has_no_checks_rather_than_an_error() {
    // VIEW-073: gh's "no pull requests found" is the plain no-review answer.
    let tools = std::env::temp_dir().join(format!("kolux-scm-checks-gh-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let got = pr_checks(&gh, &tools, "feat").unwrap();
    assert!(got.pr.is_none() && got.checks.is_empty() && !got.conflict);
    assert!(fs::read_to_string(tools.join("calls.txt")).unwrap().contains("statusCheckRollup"));
    let _ = fs::remove_dir_all(&tools);
}

fn stand_in_gh(dir: &Path) -> PathBuf {
    fs::create_dir_all(dir).unwrap();
    if cfg!(windows) {
        let file = dir.join("gh.cmd");
        let script = [
            "@echo off",
            "echo %*>>\"%~dp0calls.txt\"",
            "if \"%1\"==\"config\" goto config",
            "if \"%2\"==\"create\" goto create",
            "echo %3| findstr /b \"https\" >nul && goto linked",
            "if exist \"%~dp0made\" (",
            "  echo {\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}",
            "  exit /b 0",
            ")",
            "echo no pull requests found for branch \"feat\" 1>&2",
            "exit /b 1",
            ":linked",
            "echo {\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}",
            "exit /b 0",
            ":create",
            "more > \"%~dp0body.txt\"",
            "type nul > \"%~dp0made\"",
            "echo https://github.com/o/r/pull/7",
            "exit /b 0",
            ":config",
            "if \"%4\"==\"nobody.example\" (echo could not find key \"user\" 1>&2 & exit /b 1)",
            "if \"%3\"==\"-h\" echo octo",
        ];
        fs::write(&file, script.join("\r\n")).unwrap();
        file
    } else {
        let file = dir.join("gh");
        let script = "#!/bin/sh\nd=$(dirname \"$0\")\necho \"$*\" >> \"$d/calls.txt\"\nif [ \"$1\" = config ]; then [ \"$4\" = nobody.example ] && { echo 'could not find key \"user\"' >&2; exit 1; }; [ \"$3\" = -h ] && echo octo; exit 0; fi\ncase \"$3\" in https*) echo '{\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}'; exit 0;; esac\nif [ \"$2\" = create ]; then cat > \"$d/body.txt\"; touch \"$d/made\"; echo https://github.com/o/r/pull/7; exit 0; fi\nif [ -f \"$d/made\" ]; then echo '{\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}'; exit 0; fi\necho 'no pull requests found for branch \"feat\"' >&2\nexit 1\n";
        fs::write(&file, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        file
    }
}

#[test]
fn a_pull_request_is_made_once_after_the_branch_is_pushed_and_states_that_cannot_have_one_are_refused() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-pr-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("pr");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
    let tools = std::env::temp_dir().join(format!("kolux-scm-pr-gh-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let calls = || fs::read_to_string(tools.join("calls.txt")).unwrap_or_default();

    // GIT-023: on the default branch there is nothing to compare.
    let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
    assert!(err.contains("feature branch"), "{err}");

    run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
    let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
    assert!(err.contains("No commits"), "{err}");
    commit_file(&dir, "feat.txt", "f\n");

    // GIT-021: uncommitted tracked changes block it; a base only on this computer says what to do.
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    let err = pr_create(&gh, &dir, "Title", "", "main", false, true).unwrap_err();
    assert!(err.contains("Commit or stash"), "{err}");
    run(&["checkout", "--", "README.md"], Some(&dir)).unwrap();
    run(&["branch", "only-here", "main"], Some(&dir)).unwrap();
    let err = pr_create(&gh, &dir, "Title", "", "only-here", false, true).unwrap_err();
    assert!(err.contains("only on this computer"), "{err}");
    assert!(calls().is_empty(), "nothing reached gh while the branch could not have a PR");

    // None yet; creating pushes the unpublished branch first, then hands gh the title, base,
    // head and draft flag, with the description on standard input.
    assert_eq!(pr_find(&gh, &dir, "feat").unwrap(), None);
    let counted = crate::activity::activity_counts().prs_created;
    let pr = pr_create(&gh, &dir, "Add feat", "Why:\nbecause", "origin/main", true, true).unwrap();
    // USAGE-011: a pull request Kolux made counts once on the Stats & Usage page.
    assert_eq!(crate::activity::activity_counts().prs_created, counted + 1);
    assert_eq!((pr.number, pr.url.as_str(), pr.state.as_str()), (7, "https://github.com/o/r/pull/7", "OPEN"));
    assert!(run(&["rev-parse", "--verify", "refs/heads/feat"], Some(&bare)).is_ok(), "the branch was pushed first");
    let said = calls();
    assert!(said.contains("pr create") && said.contains("--draft") && said.contains("--base main") && said.contains("--head feat"), "{said}");
    assert!(fs::read_to_string(tools.join("body.txt")).unwrap().contains("because"));

    // A second create links the PR the branch already has instead of making another.
    assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", false, true).unwrap().number, 7);
    assert_eq!(calls().matches("pr create").count(), 1);
    assert_eq!(crate::activity::activity_counts().prs_created, counted + 1, "linking the PR a branch has is not a new one");

    // gh's own failures come back in plain words.
    assert!(gh_words("none of the git remotes configured for this repository point to a known GitHub host").contains("not supported"));
    assert!(gh_words("To get started with GitHub CLI, please run:  gh auth login").contains("Sign in"));
    // GIT-045: a sign-in that stopped working and an account without access are told apart; a
    // refused search and a gone repository keep gh's words (Tasks names the repository from them).
    assert!(gh_words("HTTP 401: Bad credentials (https://api.github.com/search/issues)").contains("no longer works"));
    assert!(gh_words("GraphQL: Resource not accessible by integration (repository.issues)").contains("cannot see this repository"));
    assert!(gh_words("HTTP 403: Must have admin rights to Repository.").contains("cannot see this repository"));
    assert!(gh_words("HTTP 403: API rate limit exceeded for user ID 1.").contains("rate limit"), "a spent limit stays a limit");
    assert!(gh_words("HTTP 422: Validation Failed: The listed users and repositories cannot be searched").contains("cannot be searched"));
    assert!(gh_words("GraphQL: Could not resolve to a Repository with the name 'a/b'.").contains("Could not resolve to a Repository"));
    let _ = fs::remove_dir_all(&tools);
    let _ = fs::remove_dir_all(&bare);
    let _ = fs::remove_dir_all(&dir);
}

// T-652: the automatic flow asks for no push at all; unpushed work is refused in words, and nothing reaches the remote.
#[test]
fn t652_pr_create_without_push_refuses_unpushed_commits_and_pushes_nothing() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-pr-nopush-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("pr-nopush");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
    let tools = std::env::temp_dir().join(format!("kolux-scm-pr-nopush-gh-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let want = "The branch has commits that are not pushed yet; push first";
    run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
    commit_file(&dir, "feat.txt", "f\n");
    // No upstream at all.
    assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
    assert!(run(&["rev-parse", "--verify", "-q", "refs/heads/feat"], Some(&bare)).is_err(), "nothing was pushed");
    // An upstream with another name (the branch still tracks origin/main).
    run(&["branch", "--set-upstream-to=origin/main"], Some(&dir)).unwrap();
    assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
    // Published, then one more commit: ahead of its own upstream.
    run(&["push", "-q", "origin", "feat:feat"], Some(&dir)).unwrap();
    run(&["branch", "--set-upstream-to=origin/feat"], Some(&dir)).unwrap();
    commit_file(&dir, "more.txt", "m\n");
    assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap_err(), want);
    assert_ne!(run(&["rev-parse", "refs/heads/feat"], Some(&bare)).unwrap(), run(&["rev-parse", "HEAD"], Some(&dir)).unwrap(), "the new commit stayed here");
    // Everything is on origin/feat: now the pull request is made, still without a push.
    run(&["push", "-q", "origin", "feat:feat"], Some(&dir)).unwrap();
    assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", true, false).unwrap().number, 7);
    // With push true (the old callers) the unpushed work is still pushed first.
    commit_file(&dir, "later.txt", "l\n");
    fs::remove_file(tools.join("made")).unwrap();
    assert!(pr_create(&gh, &dir, "Add feat", "", "main", true, true).is_ok());
    assert_eq!(run(&["rev-parse", "refs/heads/feat"], Some(&bare)).unwrap(), run(&["rev-parse", "HEAD"], Some(&dir)).unwrap());
    let _ = fs::remove_dir_all(&tools);
    let _ = fs::remove_dir_all(&bare);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_pull_request_linked_by_hand_is_read_through_its_link_with_its_branch() {
    let dir = temp_repo("prlink");
    let tools = std::env::temp_dir().join(format!("kolux-scm-prlink-gh-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let pr = pr_link(&gh, &dir, "https://github.com/o/r/pull/12").unwrap();
    assert_eq!((pr.number, pr.state.as_str(), pr.title.as_deref(), pr.head.as_deref(), pr.draft), (12, "MERGED", Some("Other work"), Some("other"), false));
    assert!(fs::read_to_string(tools.join("calls.txt")).unwrap().contains("headRefName"), "the branch is asked for, so a mismatch can be flagged");
    assert!(pr_link(&gh, &dir, "file:///C:/Windows/notepad.exe").unwrap_err().contains("pull request link"));
    let _ = fs::remove_dir_all(&tools);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn history_marks_outgoing_and_incoming_commits_and_keeps_its_labels_tidy() {
    let empty = std::env::temp_dir().join(format!("kolux-scm-hist-empty-{}", std::process::id()));
    let _ = fs::remove_dir_all(&empty);
    fs::create_dir_all(&empty).unwrap();
    run(&["init", "-q", "-b", "main"], Some(&empty)).unwrap();
    assert!(history(&empty, 50).unwrap().is_empty(), "a repository with no commits has no history");

    let bare = std::env::temp_dir().join(format!("kolux-scm-hist-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("hist");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
    run(&["tag", "v1"], Some(&dir)).unwrap();
    let names = |c: &Commit| {
        let mut n = c.labels.iter().map(|l| format!("{}:{}", l.kind, l.name)).collect::<Vec<_>>();
        n.sort();
        n
    };

    // main and origin/main on one commit: the remote label says nothing new and is left out.
    let h = history(&dir, 50).unwrap();
    assert_eq!(names(&h[0]), vec!["current:main", "tag:v1"]);

    // One commit only on the remote (incoming) and one only here (outgoing).
    commit_file(&dir, "two.txt", "2\n");
    run(&["push", "-q"], Some(&dir)).unwrap();
    run(&["reset", "-q", "--hard", "HEAD~1"], Some(&dir)).unwrap();
    fs::write(dir.join("three.txt"), "3\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "feat: three", "-m", "A longer body that explains the change."], Some(&dir)).unwrap();
    let h = history(&dir, 50).unwrap();
    let by = |s: &str| h.iter().find(|c| c.subject == s).unwrap_or_else(|| panic!("no {s}"));
    assert_eq!((by("feat: three").outgoing, by("feat: three").incoming), (true, false));
    assert_eq!((by("two.txt").outgoing, by("two.txt").incoming), (false, true));
    assert_eq!((by("first").outgoing, by("first").incoming), (false, false));
    assert!(by("feat: three").message.contains("A longer body"));
    assert_eq!(names(by("feat: three")), vec!["current:main"]);
    assert_eq!(names(by("two.txt")), vec!["upstream:origin/main"]);
    assert_eq!(names(by("first")), vec!["tag:v1"]);
    assert_eq!(h.last().unwrap().subject, "first", "the shared root comes last");
    assert_eq!(h.len(), 3);

    // On a feature branch the local copy of the base reads as the base.
    run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
    assert_eq!(names(&history(&dir, 50).unwrap()[0]), vec!["base:main", "current:feat"]);

    // The selected commit's files.
    let files = commit_files(&dir, &by("feat: three").hash).unwrap();
    assert_eq!(paths(&files), vec!["three.txt"]);
    assert_eq!(files[0].status, "A");
    assert!(commit_files(&dir, "HEAD; rm -rf").is_err(), "only a commit id is accepted");
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
    let _ = fs::remove_dir_all(&empty);
}

#[test]
fn github_repositories_are_read_from_every_remote_form() {
    let ssh = "# work account\nHost gh-work other-alias\n  HostName github.com\n  User git\n\nHost *\n  ServerAliveInterval 30\n";
    let r = |url: &str| github_repo(url, ssh).map(|g| (g.host, g.owner, g.name));
    let want = Some(("github.com".to_string(), "o".to_string(), "r".to_string()));
    for url in ["https://github.com/o/r", "https://github.com/o/r.git", "https://github.com/o/r/", "https://user@github.com/o/r.git", "http://github.com/o/r", "ssh://git@github.com/o/r.git", "ssh://git@github.com:22/o/r.git", "git@github.com:o/r.git", "github.com:o/r", "git://github.com/o/r.git", "git@gh-work:o/r.git", "ssh://git@other-alias/o/r"] {
        assert_eq!(r(url), want, "{url}");
    }
    // An HTTPS host is never an SSH alias.
    assert_eq!(r("https://gh-work/o/r").map(|x| x.0), Some("gh-work".to_string()));
    // GitHub Enterprise keeps its host and uses its own API address.
    let ghe = github_repo("git@ghe.corp.example:Team/App.git", ssh).unwrap();
    assert_eq!((ghe.host.as_str(), ghe.owner.as_str(), ghe.name.as_str()), ("ghe.corp.example", "Team", "App"));
    assert_eq!(ghe.api, "https://ghe.corp.example/api/v3");
    assert_eq!(github_repo("https://github.com/o/r", "").unwrap().api, "https://api.github.com");
    // Two checkouts of one project share a key, whatever form or case their remote uses.
    assert_eq!(github_repo("git@gh-work:O/R.git", ssh).unwrap().key, github_repo("https://github.com/o/r", "").unwrap().key);
    // Local paths and odd shapes are not GitHub repositories.
    for url in ["G:/Temp/x/remote.git", "C:\\repo\\r.git", "/srv/git/r.git", "file:///srv/o/r.git", "https://github.com/o", "https://github.com/o/r/pull/3", "", "git@github.com:o/r b.git"] {
        assert_eq!(r(url), None, "{url}");
    }

    // gh is pointed at the resolved repository, so an alias remote still finds its pull request.
    let dir = temp_repo("ghrepo");
    assert_eq!(gh_repo_arg(&dir, ssh), None, "no origin, no repository");
    run(&["remote", "add", "origin", "git@gh-work:o/r.git"], Some(&dir)).unwrap();
    assert_eq!(gh_repo_arg(&dir, ssh).as_deref(), Some("github.com/o/r"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn only_a_plain_https_pull_request_link_is_opened() {
    assert!(safe_pr_url("https://github.com/o/r/pull/7"));
    assert!(safe_pr_url("https://git.example.com/o/r/pull/12"));
    assert!(!safe_pr_url("file:///C:/Windows/System32/calc.exe"));
    assert!(!safe_pr_url("https://github.com/o/r/pull/7 --flag"));
    assert!(!safe_pr_url("https://github.com/o/r/issues/7"));
}

#[test]
fn push_failures_are_sorted_by_kind() {
    let kind = |text: &str| failure_kind(text, false);
    assert_eq!(kind("remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)"), "protected");
    assert_eq!(kind("fatal: Authentication failed for 'https://github.com/a/b.git/'"), "sign-in");
    assert_eq!(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "sign-in");
    assert_eq!(kind("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), "sign-in");
    assert_eq!(kind("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"), "network");
    assert_eq!(kind(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"), "non-fast-forward");
    assert_eq!(kind("The following submodule paths contain changes that can\nnot be found on any remote:\n  lib"), "submodule");
    assert_eq!(kind(" ! [remote rejected] main -> main (pre-receive hook declined)"), "hook");
    assert_eq!(failure_kind("lint: 2 problems\nerror: failed to push some refs to 'origin'", true), "hook");
    assert_eq!(kind("error: something odd"), "other");
}

#[test]
fn a_failing_pre_push_hook_hands_its_output_and_files_to_an_agent_and_commit_then_pull_and_push_works() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-hook-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("hook");
    // T-779 S4: the folder's own hook runs only in a trusted folder; this test is about what the hook does.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    commit_file(&dir, "login.ts", "x\n");
    let hook = dir.join(".git").join("hooks").join("pre-push");
    fs::write(&hook, "#!/bin/sh\nprintf '\\033[31mlint: 2 problems in login.ts\\033[0m\\n' >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join(".git").join("hooks").join("pre-push"), fs::Permissions::from_mode(0o755)).unwrap(); // Git for Windows runs it without
    }
    let out = remote(&dir, "push").unwrap();
    assert!(!out.ok);
    assert_eq!(out.kind, Some("hook"), "{}", out.output);
    let detail = out.detail.unwrap();
    assert!(detail.contains("lint: 2 problems in login.ts"), "{detail}");
    assert!(!detail.contains('\u{1b}'), "colour codes are removed: {detail:?}");
    assert!(!out.output.contains(char::from(27)), "and from the notice");
    assert!(detail.contains("Files in this push:\n- login.ts"), "{detail}");

    // Commit then pull (rebasing onto the remote) and push: the commit lands on the remote.
    fs::remove_file(&hook).unwrap();
    commit_file(&dir, "two.txt", "2\n");
    let done = remote(&dir, "pullpush").unwrap();
    assert!(done.ok, "{}", done.output);
    assert_eq!((done.kind, counts(&dir).1), (None, 0));
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn a_network_git_step_runs_with_prompts_off_and_a_stuck_one_is_stopped() {
    let dir = temp_repo("net-limit");
    // The prompt switches reach the step (an alias prints what git was given).
    let seen = git_network(&["-c", "alias.seen=!echo $GIT_TERMINAL_PROMPT $GCM_INTERACTIVE", "seen"], &dir, Some(std::time::Duration::from_secs(60))).unwrap();
    assert!(seen.success && !seen.timed_out, "{}", seen.stderr);
    assert_eq!(seen.stdout.trim(), "0 never");
    // A step that never ends is stopped at the limit and says so.
    let started = std::time::Instant::now();
    let stuck = git_network(&["-c", "alias.stuck=!sleep 60", "stuck"], &dir, Some(std::time::Duration::from_secs(1))).unwrap();
    assert!(stuck.timed_out && !stuck.success);
    assert!(started.elapsed() < std::time::Duration::from_secs(30), "stopped long after the limit: {:?}", started.elapsed());
    let note = timed_out_note(&["push"], std::time::Duration::from_secs(600));
    assert!(note.contains("timed out after 600 seconds") && note.contains("took too long"), "{note}");
    assert!(note.contains("slow") && note.contains("sign-in"), "{note}");
    assert!(!note.starts_with("The remote may be waiting for a sign-in"), "{note}");
    assert_eq!(REMOTE_LIMIT.as_secs(), 600);
    // No limit: a step that takes longer than a short wait is left to finish.
    let slow = git_network(&["-c", "alias.slow=!sleep 2; echo done", "slow"], &dir, None).unwrap();
    assert!(slow.success && !slow.timed_out && slow.stdout.trim() == "done", "{}", slow.stderr);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_program_holding_the_pipe_after_git_exits_costs_a_short_wait_and_keeps_the_output() {
    let dir = temp_repo("net-grace");
    // The alias prints, then leaves a background process holding stdout and stderr for 20 seconds.
    let started = std::time::Instant::now();
    let out = git_network(&["-c", "alias.held=!echo kept; (sleep 20 &) ; true", "held"], &dir, Some(std::time::Duration::from_secs(60))).unwrap();
    assert!(out.success && !out.timed_out);
    assert!(out.stdout.contains("kept"), "output lost: {:?}", out.stdout);
    assert!(started.elapsed() < std::time::Duration::from_secs(10), "waited on the held pipe: {:?}", started.elapsed());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn unstaging_works_on_the_whole_worktree_on_a_renamed_file_and_before_the_first_commit() {
    let dir = temp_repo("unstage-all");
    commit_file(&dir, "old.txt", "some content here
and more
");
    run(&["mv", "old.txt", "new.txt"], Some(&dir)).unwrap();
    // Only the new path leaves the old one's delete staged; both together put the rename back.
    stage(&dir, &["new.txt".into()], false).unwrap();
    let half = status(&dir).unwrap();
    assert_eq!(half.staged.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["old.txt"]);
    run(&["add", "-A"], Some(&dir)).unwrap();
    let renamed = status(&dir).unwrap();
    let r = renamed.staged.iter().find(|c| c.from.is_some()).expect("a staged rename");
    stage(&dir, &[r.from.clone().unwrap(), r.path.clone()], false).unwrap();
    assert!(status(&dir).unwrap().staged.is_empty());
    // "." takes the whole worktree, in both directions.
    stage(&dir, &[".".into()], true).unwrap();
    assert!(!status(&dir).unwrap().staged.is_empty());
    stage(&dir, &[".".into()], false).unwrap();
    assert!(status(&dir).unwrap().staged.is_empty());
    let _ = fs::remove_dir_all(&dir);
    // A repository with no commit yet: unstage all still works.
    let fresh = std::env::temp_dir().join(format!("kolux-scm-nohead-{}", std::process::id()));
    let _ = fs::remove_dir_all(&fresh);
    fs::create_dir_all(&fresh).unwrap();
    run(&["init", "-q", "-b", "main"], Some(&fresh)).unwrap();
    fs::write(fresh.join("a.txt"), "a\n").unwrap();
    stage(&fresh, &[".".into()], true).unwrap();
    assert_eq!(status(&fresh).unwrap().staged.len(), 1);
    // Edited again after staging: unstaging must still work and keep the file on disk.
    fs::write(fresh.join("a.txt"), "a\nb\n").unwrap();
    stage(&fresh, &[".".into()], false).unwrap();
    assert_eq!(fs::read_to_string(fresh.join("a.txt")).unwrap(), "a\nb\n");
    let st = status(&fresh).unwrap();
    assert!(st.staged.is_empty() && st.untracked.len() == 1, "{:?}", st.staged);
    let _ = fs::remove_dir_all(&fresh);
}

#[test]
fn a_push_that_hangs_comes_back_as_a_network_failure_that_says_it_timed_out() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-hang-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("hang");
    // T-779 S4: the folder's own hook runs only in a trusted folder; this test is about what the hook does.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    commit_file(&dir, "slow.txt", "x\n");
    fs::write(dir.join(".git").join("hooks").join("pre-push"), "#!/bin/sh\nsleep 60\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join(".git").join("hooks").join("pre-push"), fs::Permissions::from_mode(0o755)).unwrap(); // Git for Windows runs it without
    }
    let out = remote_within(&dir, "push", std::time::Duration::from_secs(1)).unwrap();
    assert!(!out.ok);
    assert_eq!(out.kind, Some("network"), "{}", out.output);
    assert!(out.output.contains("timed out after 1 second") && out.output.contains("took too long"), "{}", out.output);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn history_flags_the_last_commit_only_when_the_cap_cut_older_ones_off() {
    let dir = temp_repo("hist-cap");
    for i in 0..4 {
        commit_file(&dir, &format!("f{i}.txt"), "x\n");
    }
    // Five commits in all.
    let all = history(&dir, 10).unwrap();
    assert_eq!(all.len(), 5);
    assert!(all.iter().all(|c| !c.capped), "nothing was cut");
    let exact = history(&dir, 5).unwrap();
    assert_eq!(exact.len(), 5);
    assert!(exact.iter().all(|c| !c.capped), "a history that ends exactly at the cap is not cut");
    let cut = history(&dir, 3).unwrap();
    assert_eq!(cut.len(), 3);
    assert_eq!(cut.iter().map(|c| c.capped).collect::<Vec<_>>(), vec![false, false, true]);
    // The wire shape: the flag is absent unless set.
    assert!(!serde_json::to_string(&all[0]).unwrap().contains("capped"));
    assert!(serde_json::to_string(&cut[2]).unwrap().contains("\"capped\":true"));
    let _ = fs::remove_dir_all(&dir);
}

/// Speed: the one-run badge read answers exactly what the step-by-step read does in every state,
/// and the common case (an upstream, in sync or ahead) starts fewer git processes.
#[test]
fn the_sidebar_badge_read_in_one_run_matches_the_step_by_step_read() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-pushed1-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("pushed1");
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    let same = |d: &Path, what: &str| {
        let (quick, steps) = (pushed(d), pushed_by_steps(d));
        assert_eq!(quick, steps, "{what}");
        quick.map(|p| (p.state, p.count))
    };
    let spawned = |d: &Path, f: fn(&Path) -> Option<Pushed>| git_argvs(|| drop(f(d))).len();
    assert_eq!(same(&dir, "in sync"), Some(("synced", 0)));
    let (before, after) = (spawned(&dir, pushed_by_steps), spawned(&dir, pushed));
    println!("PUSHED in sync: {before} git processes before, {after} after");
    assert!(after < before, "{after} vs {before}");
    // Other branches at the same commit (one with no upstream) do not confuse the read.
    run(&["branch", "twin"], Some(&dir)).unwrap();
    commit_file(&dir, "one.txt", "1\n");
    commit_file(&dir, "two.txt", "2\n");
    run(&["branch", "twin2"], Some(&dir)).unwrap();
    assert_eq!(same(&dir, "ahead"), Some(("ahead", 2)));
    println!("PUSHED ahead: {} git processes before, {} after", spawned(&dir, pushed_by_steps), spawned(&dir, pushed));
    run(&["push", "-q"], Some(&dir)).unwrap();
    run(&["reset", "-q", "--hard", "HEAD~1"], Some(&dir)).unwrap();
    assert_eq!(same(&dir, "behind"), Some(("synced", 0)), "behind only is nothing to push");
    commit_file(&dir, "three.txt", "3\n");
    assert_eq!(same(&dir, "diverged"), Some(("ahead", 1)));
    // A linked worktree on its own branch with its own upstream state.
    let linked = std::env::temp_dir().join(format!("kolux-scm-pushed1-wt-{}", std::process::id()));
    let _ = fs::remove_dir_all(&linked);
    run(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy(), "origin/main"], Some(&dir)).unwrap();
    run(&["branch", "-q", "--set-upstream-to=origin/main", "side"], Some(&linked)).unwrap();
    commit_file(&linked, "side.txt", "s\n");
    assert_eq!(same(&linked, "linked worktree ahead"), Some(("ahead", 1)));
    assert_eq!(same(&dir, "the main checkout is unchanged by it"), Some(("ahead", 1)));
    // No upstream: unpublished, counted against the base.
    run(&["switch", "-q", "-c", "feature"], Some(&dir)).unwrap();
    commit_file(&dir, "four.txt", "4\n");
    assert_eq!(same(&dir, "no upstream").map(|s| s.0), Some("unpublished"));
    // An upstream whose ref is gone reads as unpublished, as before.
    run(&["branch", "-q", "--set-upstream-to=origin/main", "feature"], Some(&dir)).unwrap();
    run(&["update-ref", "-d", "refs/remotes/origin/main"], Some(&dir)).unwrap();
    same(&dir, "gone upstream");
    run(&["switch", "-q", "--detach"], Some(&dir)).unwrap();
    assert_eq!(same(&dir, "detached"), None);
    run(&["switch", "-q", "--orphan", "unborn"], Some(&dir)).unwrap();
    same(&dir, "unborn branch");
    let _ = fs::remove_dir_all(&linked);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn the_sidebar_badge_counts_unpushed_commits_and_never_calls_an_unreadable_count_synced() {
    let state = |dir: &Path| pushed(dir).map(|p| (p.state, p.count));
    let bare = std::env::temp_dir().join(format!("kolux-scm-pushed-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let dir = temp_repo("pushed");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    assert_eq!(state(&dir), Some(("synced", 0)));
    commit_file(&dir, "one.txt", "1\n");
    commit_file(&dir, "two.txt", "2\n");
    assert_eq!(state(&dir), Some(("ahead", 2)), "two commits not pushed");
    run(&["push", "-q"], Some(&dir)).unwrap();
    assert_eq!(state(&dir), Some(("synced", 0)), "pushing clears it");

    // A branch never published counts what it holds past the base.
    run(&["switch", "-q", "-c", "feature"], Some(&dir)).unwrap();
    commit_file(&dir, "three.txt", "3\n");
    assert_eq!(state(&dir), Some(("unpublished", 1)));
    // The base cannot be read: it cannot be checked, never synced.
    run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
    let origin_main = dir.join(".git").join("refs").join("remotes").join("origin").join("main");
    fs::write(&origin_main, "0123456789012345678901234567890123456789\n").unwrap();
    assert_eq!(state(&dir), Some(("unknown", 0)));

    run(&["switch", "-q", "--detach"], Some(&dir)).unwrap();
    assert_eq!(state(&dir), None, "a detached HEAD has no branch to push");
    // TERM-022: the header chip shows the commit a detached HEAD is on, and a branch by name.
    let head = head_of(&dir).unwrap();
    assert_eq!(head.branch, None);
    assert_eq!(head.head.as_deref().map(str::len), Some(40));
    run(&["switch", "-q", "feature"], Some(&dir)).unwrap();
    assert_eq!(head_of(&dir).unwrap().branch.as_deref(), Some("feature"));
    let plain = std::env::temp_dir().join(format!("kolux-scm-plain-{}", std::process::id()));
    fs::create_dir_all(&plain).unwrap();
    assert_eq!(head_of(&plain), None, "a plain folder has no chip");
    let _ = fs::remove_dir_all(&plain);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn remote_actions_move_commits_through_a_bare_remote_and_rebased_work_offers_a_lease() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let bare_url = bare.to_string_lossy().replace('\\', "/");
    let dir = temp_repo("remote");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "origin", &bare_url], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
    run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
    let st = status(&dir).unwrap();
    assert_eq!((st.upstream.as_deref(), st.ahead, st.behind, st.base.as_deref()), (Some("origin/main"), 0, 0, Some("origin/main")));

    // Two local commits: push moves them and the count falls to zero (GIT-007 acceptance).
    commit_file(&dir, "one.txt", "1\n");
    commit_file(&dir, "two.txt", "2\n");
    assert_eq!(counts(&dir), (Some("origin/main".into()), 2, 0, false));
    assert!(remote(&dir, "push").unwrap().ok);
    assert_eq!(counts(&dir), (Some("origin/main".into()), 0, 0, false));

    // A new branch has no upstream until publish sets origin as its upstream.
    run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
    commit_file(&dir, "feat.txt", "f\n");
    assert_eq!(counts(&dir), (None, 0, 0, false));
    assert!(remote(&dir, "publish").unwrap().ok);
    assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

    // Main moves on the remote; rebasing feat onto it leaves the upstream with only
    // already-held patches, so force push with lease is the next step, not pull.
    let other = std::env::temp_dir().join(format!("kolux-scm-other-{}", std::process::id()));
    let _ = fs::remove_dir_all(&other);
    run(&["clone", "-q", &bare_url, &other.to_string_lossy()], None).unwrap();
    crate::git::trust_for_test(&other); // the second clone pushes too
    run(&["config", "user.email", "test@example.com"], Some(&other)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&other)).unwrap();
    commit_file(&other, "main2.txt", "m\n");
    run(&["push", "-q"], Some(&other)).unwrap();
    assert!(remote(&dir, "rebase").unwrap().ok, "rebase from base");
    assert_eq!(counts(&dir), (Some("origin/feat".into()), 2, 1, true));
    assert!(remote(&dir, "force").unwrap().ok);
    assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

    // A genuinely new commit on the remote is not "rewritten": nothing offers to force over it.
    run(&["fetch", "-q"], Some(&other)).unwrap();
    run(&["checkout", "-q", "-b", "feat", "origin/feat"], Some(&other)).unwrap();
    commit_file(&other, "theirs.txt", "t\n");
    run(&["push", "-q"], Some(&other)).unwrap();
    commit_file(&dir, "mine.txt", "i\n");
    assert!(remote(&dir, "fetch").unwrap().ok);
    assert_eq!(counts(&dir), (Some("origin/feat".into()), 1, 1, false));

    // Status never goes to the network: with the remote gone it still answers, and only an
    // explicit fetch reports the trouble. FIX-1 (council, 2026-10-13): this used to be a 3 s
    // wall-clock bound on three reads, which failed on a loaded PC even when run alone (one
    // read is ~7 local git processes; 3.2-10.4 s measured, while git's own times summed to
    // ~2.3 s: the rest is process start-up on a busy PC). Git's own trace2 log of every
    // process each read starts showed only status, cherry, --version, symbolic-ref,
    // rev-parse and diff, no fetch, remote helper, credential helper or fsmonitor. So the
    // test now asserts on that log (no network-capable process ran, which load cannot
    // flake), and keeps a 20 s bound only as a backstop: a hung network call would sit on
    // the OS connect timeout (about 21 s on Windows) and still trip it.
    run(&["remote", "set-url", "origin", &format!("{bare_url}-missing")], Some(&dir)).unwrap();
    let trace = std::env::temp_dir().join(format!("kolux-scm-trace2-{}.json", std::process::id()));
    let _ = fs::remove_file(&trace);
    crate::git::TRACE2.with(|t| *t.borrow_mut() = Some(trace.clone()));
    let t = std::time::Instant::now();
    for _ in 0..3 {
        status(&dir).unwrap();
    }
    let took = t.elapsed();
    crate::git::TRACE2.with(|t| *t.borrow_mut() = None);
    let log = fs::read_to_string(&trace).unwrap_or_default();
    let _ = fs::remove_file(&trace);
    let events: Vec<serde_json::Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    // Every process git started (top level and any child it spawned), with its arguments.
    let argvs: Vec<String> = events
        .iter()
        .filter(|e| matches!(e["event"].as_str(), Some("start" | "child_start")))
        .map(|e| e["argv"].as_array().map(|a| a.iter().skip(1).filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default())
        .collect();
    // The time of each top-level git, from its own exit event, for the failure message.
    let times: Vec<String> = events
        .iter()
        .filter(|e| e["event"] == "exit" && !e["sid"].as_str().unwrap_or("/").contains('/'))
        .map(|e| format!("{:.0} ms", e["t_abs"].as_f64().unwrap_or(0.0) * 1000.0))
        .collect();
    let report = format!("3 reads took {took:?}; processes {argvs:?}; times {times:?}");
    eprintln!("{report}");
    assert!(argvs.iter().filter(|a| a.starts_with("status ")).count() >= 3, "trace2 log missing: {report}");
    let network = ["fetch", "ls-remote", "remote-", "upload-pack", "credential", "fsmonitor", "http"];
    // The program-key listing (`config ... --get-regexp`) names key patterns such as ^credential\.; it is a read.
    assert!(!argvs.iter().filter(|a| !a.starts_with("config ")).any(|a| network.iter().any(|n| a.contains(n))), "a status read went to the network: {report}");
    assert!(took < std::time::Duration::from_secs(20), "{report}");
    let fetched = remote(&dir, "fetch").unwrap();
    assert!(!fetched.ok && !fetched.output.is_empty(), "{fetched:?}");
    assert_eq!(remote(&dir, "nope").unwrap_err(), "unknown remote action nope");
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&other);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn the_upstream_remote_is_named_whole_when_its_name_holds_a_slash() {
    let bare = std::env::temp_dir().join(format!("kolux-scm-slashremote-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
    let bare_url = bare.to_string_lossy().replace('\\', "/");
    let dir = temp_repo("slashremote");
    // T-779 S4: a push to a repository on this computer needs a trusted folder; this is the user's own repo.
    crate::git::trust_for_test(&dir);
    run(&["remote", "add", "team/fork", &bare_url], Some(&dir)).unwrap();
    run(&["push", "-q", "-u", "team/fork", "main"], Some(&dir)).unwrap();
    let st = status(&dir).unwrap();
    assert_eq!((st.upstream.as_deref(), st.upstream_remote.as_deref()), (Some("team/fork/main"), Some("team/fork")));
    // A branch tracking a local branch has an upstream and no remote.
    run(&["branch", "side", "main"], Some(&dir)).unwrap();
    run(&["checkout", "-q", "side"], Some(&dir)).unwrap();
    run(&["branch", "-q", "--set-upstream-to=main"], Some(&dir)).unwrap();
    let st = status(&dir).unwrap();
    assert_eq!((st.upstream.as_deref(), st.upstream_remote.as_deref()), (Some("main"), None));
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn porcelain_v2_is_sorted_into_sections_with_awkward_names_kept_whole() {
    let text = "# branch.oid e2b3\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
            1 .M N... 100644 100644 100644 7898 7898 keep.txt\0\
            2 R. N... 100644 100644 100644 6178 6178 R100 new.txt\0old.txt\0\
            1 MM N... 100644 100644 100644 f2ad b680 sub/with space.txt\0\
            1 D. N... 100644 000000 000000 f2ad 0000 gone.txt\0\
            u UU N... 100644 100644 100644 100644 1111 2222 3333 both.txt\0\
            ? a[1].txt\0? sub/ünï \"q\".txt\0";
    let st = parse_status(text);
    assert_eq!(st.branch.as_deref(), Some("main"));
    assert_eq!(st.upstream.as_deref(), Some("origin/main"));
    assert_eq!((st.ahead, st.behind), (2, 1));
    assert_eq!(paths(&st.staged), ["new.txt", "sub/with space.txt", "gone.txt"]);
    assert_eq!(st.staged[0], Change { path: "new.txt".into(), status: "R".into(), from: Some("old.txt".into()) });
    assert_eq!(st.staged[2].status, "D");
    assert_eq!(paths(&st.changed), ["keep.txt", "sub/with space.txt"], "a file changed in both places is in both lists");
    assert_eq!(paths(&st.untracked), ["a[1].txt", "sub/ünï \"q\".txt"]);
    assert_eq!(paths(&st.conflicts), ["both.txt"]);
    let detached = parse_status("# branch.oid e2b3\0# branch.head (detached)\0");
    assert_eq!(detached, Status { head: Some("e2b3".into()), ..Status::default() });
    assert_eq!(parse_status("# branch.oid (initial)\0# branch.head main\0").head, None);
}

/// An untracked name that starts with a space is listed as it is; read trimmed, discarding it
/// ran git clean on the other, unspaced file and deleted that one for good.
#[test]
fn an_untracked_name_with_a_leading_space_is_kept_whole_and_discards_only_itself() {
    let repo = temp_repo("lead-space");
    fs::write(repo.join(" notes.txt"), "spaced\n").unwrap();
    fs::write(repo.join("notes.txt"), "keep me\n").unwrap();
    let st = status(&repo).unwrap();
    assert_eq!(paths(&st.untracked), [" notes.txt", "notes.txt"]);
    discard(&repo, "untracked", &[" notes.txt".to_string()]).unwrap();
    assert!(!repo.join(" notes.txt").exists(), "the discarded file is gone");
    assert_eq!(fs::read_to_string(repo.join("notes.txt")).unwrap(), "keep me\n", "the other file is untouched");
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn staging_covers_folders_takes_names_literally_and_stays_inside_the_worktree() {
    let repo = temp_repo("stage");
    fs::create_dir_all(repo.join("sub")).unwrap();
    for f in ["sub/a.txt", "sub/b.txt", "sub/c.txt", "a[1].txt", "a1.txt"] {
        fs::write(repo.join(f), "x\n").unwrap();
    }
    // GIT-002: a folder covers every file beneath it.
    stage(&repo, &["sub".into()], true).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!(paths(&st.staged), ["sub/a.txt", "sub/b.txt", "sub/c.txt"]);
    assert_eq!(paths(&st.untracked), ["a1.txt", "a[1].txt"]);
    // A name with wildcard characters never drags in other files.
    stage(&repo, &["a[1].txt".into()], true).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!(paths(&st.staged), ["a[1].txt", "sub/a.txt", "sub/b.txt", "sub/c.txt"]);
    assert_eq!(paths(&st.untracked), ["a1.txt"]);
    // Unstaging a folder takes its files back out of the index, nothing else.
    stage(&repo, &["sub".into()], false).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!(paths(&st.staged), ["a[1].txt"]);
    assert_eq!(st.untracked.len(), 4);
    // Paths that would leave the worktree are refused before git runs.
    for bad in ["../elsewhere", "C:\\Windows", "/etc", "sub/../../x", ""] {
        let err = stage(&repo, &[bad.to_string()], true).unwrap_err();
        assert!(err.contains("outside this workspace"), "{bad}: {err}");
    }
    assert!(stage(&repo, &[], true).unwrap_err().contains("nothing"));
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn discarding_puts_each_section_back_and_deletes_only_untracked_or_staged_new_files() {
    let repo = temp_repo("discard");
    commit_file(&repo, "keep.txt", "one\n");
    commit_file(&repo, "gone.txt", "two\n");
    // Changes: an edit and a deletion go back to what is staged.
    fs::write(repo.join("README.md"), "edited\n").unwrap();
    fs::remove_file(repo.join("gone.txt")).unwrap();
    discard(&repo, "changed", &["README.md".into(), "gone.txt".into()]).unwrap();
    assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "hello\n");
    assert_eq!(fs::read_to_string(repo.join("gone.txt")).unwrap(), "two\n");
    // Staged: an edit goes back to the last commit on disk too; a staged new file is deleted.
    fs::write(repo.join("keep.txt"), "staged edit\n").unwrap();
    fs::write(repo.join("new.txt"), "new\n").unwrap();
    stage(&repo, &["keep.txt".into(), "new.txt".into()], true).unwrap();
    discard(&repo, "staged", &["keep.txt".into(), "new.txt".into()]).unwrap();
    assert_eq!(fs::read_to_string(repo.join("keep.txt")).unwrap(), "one\n");
    assert!(!repo.join("new.txt").exists());
    // Untracked: files and folders go, names are literal, and a tracked name sent as untracked stays.
    fs::create_dir_all(repo.join("scratch")).unwrap();
    fs::write(repo.join("scratch/a.txt"), "x").unwrap();
    fs::write(repo.join("b[1].txt"), "x").unwrap();
    fs::write(repo.join("b1.txt"), "x").unwrap();
    discard(&repo, "untracked", &["scratch/".into(), "b[1].txt".into(), "keep.txt".into()]).unwrap();
    assert!(!repo.join("scratch").exists());
    assert!(!repo.join("b[1].txt").exists());
    assert!(repo.join("keep.txt").exists());
    let st = status(&repo).unwrap();
    assert!(st.staged.is_empty() && st.changed.is_empty());
    assert_eq!(paths(&st.untracked), ["b1.txt"]);
    assert!(discard(&repo, "untracked", &["../x".into()]).unwrap_err().contains("outside"));
    assert!(discard(&repo, "conflicts", &["keep.txt".into()]).is_err());
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn two_thousand_files_are_staged_in_one_call() {
    let repo = temp_repo("many");
    fs::create_dir_all(repo.join("many")).unwrap();
    let names: Vec<String> = (0..2000).map(|i| format!("many/file-{i:04}.txt")).collect();
    for n in &names {
        fs::write(repo.join(n), "x\n").unwrap();
    }
    stage(&repo, &names, true).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!(st.staged.len(), 2000);
    assert!(st.untracked.is_empty());
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn commit_takes_the_staged_work_and_a_refusing_hook_shows_as_blocked() {
    let repo = temp_repo("commit");
    // T-779 S4: the folder's own hook runs only in a trusted folder; this test is about what the hook does.
    crate::git::trust_for_test(&repo);
    fs::write(repo.join("README.md"), "hello\nworld\n").unwrap();
    fs::write(repo.join("later.txt"), "not yet\n").unwrap();
    assert!(commit(&repo, "  ").unwrap_err().contains("message"));
    stage(&repo, &["README.md".into()], true).unwrap();
    let done = commit(&repo, "Say world\n\nTwo lines.").unwrap();
    assert!(done.id.is_some() && !done.blocked, "{done:?}");
    assert_eq!(run(&["log", "-1", "--format=%B"], Some(&repo)).unwrap(), "Say world\n\nTwo lines.");
    let st = status(&repo).unwrap();
    assert!(st.staged.is_empty() && st.changed.is_empty(), "the sections clear");
    assert_eq!(paths(&st.untracked), ["later.txt"], "the unstaged file was left alone");
    // GIT-004: a pre-commit hook that exits 1 blocks the commit and its words come back.
    let hook = repo.join(".git").join("hooks").join("pre-commit");
    fs::create_dir_all(hook.parent().unwrap()).unwrap();
    fs::write(&hook, "#!/bin/sh\necho 'nope, said the hook'\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    stage(&repo, &["later.txt".into()], true).unwrap();
    let refused = commit(&repo, "Blocked").unwrap();
    assert!(refused.id.is_none() && refused.blocked, "{refused:?}");
    assert!(refused.output.contains("nope, said the hook"), "{}", refused.output);
    assert_eq!(run(&["log", "--format=%s"], Some(&repo)).unwrap(), "Say world\nfirst", "nothing was committed");
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn the_branch_summary_counts_lines_against_the_base_split_into_source_tests_and_generated() {
    let repo = temp_repo("summary");
    run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
    // VIEW-068: commit 10 added lines and the total shows +10.
    fs::create_dir_all(repo.join("src")).unwrap();
    commit_file(&repo, "src/a.rs", &"line\n".repeat(10));
    let s = summary(&repo, None, false).unwrap();
    assert_eq!((s.against.as_str(), s.ahead, s.behind), ("main", 1, 0));
    assert_eq!((s.source, s.tests, s.generated), (Lines { added: 10, removed: 0 }, Lines::default(), Lines::default()));
    // Tests and generated files are their own rows, and the rows add up to the total.
    fs::create_dir_all(repo.join("tests")).unwrap();
    commit_file(&repo, "tests/it.rs", "a\nb\n");
    commit_file(&repo, "src/a.test.ts", "c\n");
    commit_file(&repo, "Cargo.lock", &"x\n".repeat(1500));
    fs::write(repo.join("src/a.rs"), "line\n".repeat(7)).unwrap();
    commit_file(&repo, "README.md", "hello\nworld\n");
    let s = summary(&repo, None, false).unwrap();
    assert_eq!(s.ahead, 5);
    assert_eq!(s.source, Lines { added: 8, removed: 0 }, "README +1, src/a.rs a new file of 7 lines against main");
    assert_eq!(s.tests, Lines { added: 3, removed: 0 });
    assert_eq!(s.generated, Lines { added: 1500, removed: 0 });
    // Main moving on shows as behind; the comparison is against the merge base, so main's
    // own new lines are not counted as this branch's.
    run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
    commit_file(&repo, "other.txt", "o\n");
    run(&["checkout", "-q", "feat"], Some(&repo)).unwrap();
    let s = summary(&repo, None, false).unwrap();
    assert_eq!((s.ahead, s.behind, s.source.added), (5, 1, 8));
    // A pinned base wins, even with the upstream setting on; without an upstream the base is used.
    let first = run(&["rev-list", "--max-parents=0", "HEAD"], Some(&repo)).unwrap();
    run(&["branch", "pinned", first.trim()], Some(&repo)).unwrap();
    assert_eq!(summary(&repo, Some("pinned"), true).unwrap().against, "pinned");
    assert_eq!(summary(&repo, None, true).unwrap().against, "main");
    // With an upstream and the setting on, the summary measures against the upstream.
    run(&["remote", "add", "origin", &repo.display().to_string()], Some(&repo)).unwrap();
    run(&["update-ref", "refs/remotes/origin/feat", "HEAD~1"], Some(&repo)).unwrap();
    run(&["branch", "-q", "--set-upstream-to=origin/feat"], Some(&repo)).unwrap();
    let s = summary(&repo, None, true).unwrap();
    assert_eq!((s.against.as_str(), s.ahead, s.behind, s.source), ("origin/feat", 1, 0, Lines { added: 1, removed: 3 }));
    assert_eq!(status(&repo).unwrap().head, Some(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap().trim().to_string()));
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn git011_an_enormous_branch_gives_up_on_line_totals_but_still_counts_its_files() {
    let repo = temp_repo("summary-huge");
    run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
    for n in 0..3 {
        commit_file(&repo, &format!("f{n}.txt"), "a\nb\n");
    }
    let all = summary_capped(&repo, None, false, 3).unwrap();
    assert_eq!((all.files, all.lines_skipped, all.source.added), (3, false, 6));
    let big = summary_capped(&repo, None, false, 2).unwrap();
    assert_eq!((big.files, big.lines_skipped, big.source.added), (3, true, 0), "past the cap the files are counted and the lines are not");
    assert_eq!(big.committed.len(), 3);
}

#[test]
fn git011_the_branch_row_counts_files_against_the_base_and_lists_the_committed_ones() {
    let repo = temp_repo("git011");
    run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
    // Three commits that touch five files read 3 ahead and 5 files changed.
    fs::write(repo.join("a.txt"), "a\n").unwrap();
    fs::write(repo.join("b.txt"), "b\n").unwrap();
    commit_file(&repo, "c.txt", "c\n");
    commit_file(&repo, "d.txt", "d\n");
    fs::write(repo.join("a.txt"), "a2\n").unwrap();
    commit_file(&repo, "README.md", "changed\n");
    let s = summary(&repo, None, false).unwrap();
    assert_eq!((s.ahead, s.files), (3, 5));
    let mut names = paths(&s.committed);
    names.sort();
    assert_eq!(names, ["README.md", "a.txt", "b.txt", "c.txt", "d.txt"]);
    assert_eq!(s.committed.iter().find(|c| c.path == "README.md").unwrap().status, "M");
    assert_eq!(s.committed.iter().find(|c| c.path == "d.txt").unwrap().status, "A");
    // Pointing the base at another branch changes the counts and the committed files.
    run(&["branch", "mid", "HEAD~1"], Some(&repo)).unwrap();
    let s = summary(&repo, Some("mid"), false).unwrap();
    assert_eq!((s.against.as_str(), s.ahead, s.files), ("mid", 1, 2));
    let mut names = paths(&s.committed);
    names.sort();
    assert_eq!(names, ["README.md", "a.txt"]);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn git017_d_conflicted_files_stay_out_of_the_message_diff_with_a_note() {
    let repo = temp_repo("git017d");
    run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "theirs
");
    run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "ours
");
    assert!(run(&["merge", "other"], Some(&repo)).is_err());
    assert_eq!(conflicted_files(&repo), ["README.md"]);
    // Only the conflicted file is staged: nothing to describe, and it says why.
    assert!(message_diff(&repo).unwrap_err().contains("unresolved conflicts"));
    fs::write(repo.join("fresh.txt"), "new work
").unwrap();
    run(&["add", "fresh.txt"], Some(&repo)).unwrap();
    let (note, diff) = message_diff(&repo).unwrap();
    assert!(note.starts_with("Note: 1 file with unresolved conflicts left out") && note.contains("README.md"));
    assert!(diff.contains("fresh.txt") && !diff.contains("README.md") && !diff.contains("<<<<<<<"));
    // Without a conflict there is no note.
    run(&["merge", "--abort"], Some(&repo)).unwrap();
    fs::write(repo.join("fresh.txt"), "new work
").unwrap();
    run(&["add", "fresh.txt"], Some(&repo)).unwrap();
    let (note, _) = message_diff(&repo).unwrap();
    assert_eq!(note, "");
    assert!(conflict_note(&(0..25).map(|n| format!("f{n}")).collect::<Vec<_>>()).contains("and 5 more"));
}

#[test]
fn git017_d_a_command_line_writer_gets_a_prompt_that_fits_and_keeps_the_note() {
    let diff = format!("diff --git a/a b/a
{}", "+line of change
".repeat(3000));
    let note = conflict_note(&["x.txt".to_string()]);
    let fits = fit_prompt(&note, &diff, "use the imperative", Some(6_500));
    assert!(fits.len() <= 6_500 && fits.contains("x.txt") && fits.contains("use the imperative"));
    let roomy = fit_prompt(&note, &diff, "", None);
    assert!(roomy.len() > 20_000 && roomy.len() < 40_000);
}

#[test]
fn git015_conflicts_name_their_clash_and_abort_puts_the_repository_back() {
    let repo = temp_repo("git015");
    run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "theirs\n");
    commit_file(&repo, "new.txt", "theirs\n");
    run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "ours\n");
    commit_file(&repo, "new.txt", "ours\n");
    let before = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
    assert!(abort(&repo).unwrap_err().contains("Nothing"));
    assert!(run(&["merge", "other"], Some(&repo)).is_err());
    let st = status(&repo).unwrap();
    assert_eq!(st.operation.as_deref(), Some("merge"));
    let mut clashes: Vec<(&str, &str)> = st.conflicts.iter().map(|c| (c.path.as_str(), c.status.as_str())).collect();
    clashes.sort();
    assert_eq!(clashes, [("README.md", "UU"), ("new.txt", "AA")]);
    assert!(st.resolved.is_empty());
    // A file fixed by hand reads as resolved here before it is staged.
    fs::write(repo.join("README.md"), "both\n").unwrap();
    assert_eq!(status(&repo).unwrap().resolved, ["README.md"]);
    // Abort puts the repository back where it was before the merge.
    abort(&repo).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!((st.operation.clone(), st.conflicts.len(), st.changed.len()), (None, 0, 0));
    assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), before);
    // A rebase is aborted as a rebase.
    run(&["checkout", "-q", "other"], Some(&repo)).unwrap();
    let other = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
    assert!(run(&["rebase", "main"], Some(&repo)).is_err());
    assert_eq!(status(&repo).unwrap().operation.as_deref(), Some("rebase"));
    abort(&repo).unwrap();
    let st = status(&repo).unwrap();
    assert_eq!((st.operation, st.branch.as_deref()), (None, Some("other")));
    assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), other);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn t718_abort_checks_the_fence_before_git_like_stage_and_discard() {
    // The command: each destructive one asks the fence before it starts git.
    let src = include_str!("scm.rs");
    for name in ["scm_abort", "scm_stage", "scm_discard"] {
        let at = src.find(&format!("pub async fn {name}(")).unwrap();
        // Comment lines are left out, so a commented-out check does not count.
        let body: String = src[at..at + src[at..].find("\n}").unwrap()].lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let fenced = body.find("let root = fence.allow(&worktree, &store, &git, false)?;").unwrap_or_else(|| panic!("{name} has no fence check"));
        let work = body.find("spawn_blocking").unwrap();
        assert!(fenced < work, "{name} starts git before the fence check");
        // And git runs on the path the fence returned, not on the raw argument.
        assert!(body[work..].contains("(&root"), "{name} does not use the fenced path");
    }
    // The fence: a repository mid-merge outside every project is refused and left as it was.
    let repo = temp_repo("t718");
    run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "theirs\n");
    run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
    commit_file(&repo, "README.md", "ours\n");
    assert!(run(&["merge", "other"], Some(&repo)).is_err());
    let dir = std::env::temp_dir().join(format!("kolux-scm-t718-store-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let store = std::sync::Mutex::new(crate::state::Store::open(&dir).unwrap());
    let (fence, git) = (crate::fence::Fence::default(), Git::detect().unwrap());
    let path = repo.to_string_lossy().into_owned();
    assert!(fence.allow(&path, &store, &git, false).is_err());
    assert_eq!(status(&repo).unwrap().operation.as_deref(), Some("merge"));
    // Once it is a project, the same path passes and the abort runs.
    let entry = crate::projects::Project { id: "p1".into(), name: "p".into(), path: path.clone(), workspaces_dir: None, base: None, display_name: None };
    crate::projects::save_projects(&store.lock().unwrap(), &[entry]).unwrap();
    abort(&fence.allow(&path, &store, &git, false).unwrap()).unwrap();
    assert_eq!(status(&repo).unwrap().operation, None);
    drop(store);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn git026_a_pull_request_link_printed_in_a_terminal_attaches_once_even_split_across_chunks() {
    let mut scan = PrScan::default();
    assert!(scan.feed(b"Creating pull request for feat into main\r\n\r\nhttps://github.com/o/r/pu").is_empty());
    assert_eq!(scan.feed(b"ll/42\r\n"), ["https://github.com/o/r/pull/42"]);
    // The same link printed again is handled once.
    assert!(scan.feed(b"see https://github.com/o/r/pull/42 again\n").is_empty());
    // Colour codes around a link, an Enterprise host, and a path after the number.
    assert_eq!(scan.feed(b"\x1b[36mhttps://git.example.com/team/app/pull/7/files\x1b[0m\n"), ["https://git.example.com/team/app/pull/7"]);
    // Links that are not a pull request's.
    assert!(scan.feed(b"https://github.com/o/r/issues/3 https://github.com/o/r/pull/ https://github.com/o/pull/9 \n").is_empty());
    // A link split inside its scheme.
    assert!(scan.feed(b"htt").is_empty());
    assert_eq!(scan.feed(b"ps://github.com/o/r/pull/8 "), ["https://github.com/o/r/pull/8"]);
    // The link becomes the workspace's linked pull request, once, beside other settings.
    let dir = std::env::temp_dir().join(format!("kolux-scm-git026-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let store = crate::state::Store::open(&dir).unwrap();
    store.save_settings(&serde_json::json!({ "uiLook": "classic", "scmLinkedPrs": { "C:/other": "https://github.com/o/r/pull/1" } })).unwrap();
    assert!(link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
    assert!(!link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
    let s = store.settings();
    assert_eq!(s["scmLinkedPrs"]["C:/ws"], "https://github.com/o/r/pull/42");
    assert_eq!(s["scmLinkedPrs"]["C:/other"], "https://github.com/o/r/pull/1");
    assert_eq!(s["uiLook"], "classic");
    drop(store);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn git026_a_printed_link_survives_a_window_save_from_an_older_copy_of_the_settings() {
    let dir = std::env::temp_dir().join(format!("kolux-scm-git026-race-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let store = crate::state::Store::open(&dir).unwrap();
    store.save_settings(&serde_json::json!({ "uiLook": "classic", "quietMinutes": 5 })).unwrap();
    // The window read its copy before the link was printed, then changes one setting.
    assert!(link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
    let set = serde_json::json!({ "uiLook": "new" });
    store.patch_settings(set.as_object().unwrap(), &["quietMinutes".to_string()]).unwrap();
    let s = store.settings();
    assert_eq!(s["scmLinkedPrs"]["C:/ws"], "https://github.com/o/r/pull/42");
    assert_eq!(s["uiLook"], "new");
    assert!(s.get("quietMinutes").is_none(), "{s}");
    // A link printed after the window's change keeps that change.
    assert!(link_printed(&store, "C:/ws2", "https://github.com/o/r/pull/43"));
    assert_eq!(store.settings()["uiLook"], "new");
    drop(store);
    let _ = fs::remove_dir_all(&dir);
}

fn hit(repo: &str, n: u64) -> (Task, String) {
    let task = Task { kind: "issue".into(), number: n, title: format!("{repo} issue"), url: format!("https://github.com/{repo}/issues/{n}"), repo: repo.into(), state: "open".into(), draft: false, labels: vec![], assignees: vec![], updated: "2026-10-10T08:00:00Z".into(), checks: None };
    (task, String::new())
}

#[test]
fn git045_one_refused_repository_does_not_blank_the_others() {
    let refuse = "github.com: gh: Validation Failed (HTTP 422): The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.";
    let asked = std::cell::RefCell::new(Vec::<String>::new());
    let mut one = |q: &str| -> Result<Hits, String> {
        asked.borrow_mut().push(q.to_string());
        if q.contains("repo:gone/x") && q.contains("repo:o/a") || q.contains("repo:gone/x") && q.contains("repo:o/b") {
            Err(refuse.into())
        } else if q.contains("repo:gone/x") {
            Err("github.com: gh: Not Found (HTTP 404)".into())
        } else if q.contains("repo:o/a") && !q.contains("repo:o/b") {
            Ok((3, vec![hit("o/a", 1)]))
        } else if q.contains("repo:o/b") && !q.contains("repo:o/a") {
            Ok((2, vec![hit("o/b", 2)]))
        } else {
            Err(refuse.into())
        }
    };
    let mut failed = Vec::new();
    let got = search_split("is:open repo:o/a repo:gone/x repo:o/b", &mut one, &mut failed).unwrap();
    assert_eq!(got.0, 5);
    assert_eq!(got.1.iter().map(|h| h.0.repo.as_str()).collect::<Vec<_>>(), vec!["o/a", "o/b"]);
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].repo, "gone/x");
    assert!(failed[0].error.contains("404"), "{:?}", failed);
    // the whole query once, then each repository alone with the other words kept
    assert_eq!(*asked.borrow(), ["is:open repo:o/a repo:gone/x repo:o/b", "is:open repo:o/a", "is:open repo:gone/x", "is:open repo:o/b"]);
    // asked again for the other kind of item, the same repository is named once
    let _ = search_split("is:pr repo:o/a repo:gone/x", &mut one, &mut failed).unwrap();
    assert_eq!(failed.len(), 1);
}

#[test]
fn git045_nothing_is_split_for_trouble_that_is_not_about_a_repository() {
    for said in ["github.com: API rate limit exceeded", "github.com: Sign in to GitHub first: run gh auth login", "gh did not answer within 30 seconds; try again in a moment"] {
        let mut calls = 0;
        let mut failed = Vec::new();
        let mut one = |_: &str| -> Result<Hits, String> {
            calls += 1;
            Err(said.into())
        };
        assert_eq!(search_split("is:open repo:o/a repo:o/b", &mut one, &mut failed).unwrap_err(), said);
        assert_eq!(calls, 1, "{said}");
        assert!(failed.is_empty());
    }
    // one repository alone has nothing to split
    let mut calls = 0;
    let mut one = |_: &str| -> Result<Hits, String> {
        calls += 1;
        Err("Validation Failed (HTTP 422)".into())
    };
    assert!(search_split("is:open repo:o/a", &mut one, &mut Vec::new()).is_err());
    assert_eq!(calls, 1);
    // every repository refused: the list fails as one, with the first reason
    let mut one = |_: &str| -> Result<Hits, String> { Err("Validation Failed (HTTP 422)".into()) };
    let mut failed = Vec::new();
    assert!(search_split("is:open repo:o/a repo:o/b", &mut one, &mut failed).is_err());
    assert_eq!(failed.len(), 2);
    // a very long list is not retried one by one
    let many = (0..=SPLIT_MAX).map(|i| format!("repo:o/r{i}")).collect::<Vec<_>>().join(" ");
    let mut calls = 0;
    let mut one = |_: &str| -> Result<Hits, String> {
        calls += 1;
        Err("Validation Failed (HTTP 422)".into())
    };
    assert!(search_split(&many, &mut one, &mut Vec::new()).is_err());
    assert_eq!(calls, 1);
}

#[test]
fn t085d_the_poll_reads_each_open_pull_requests_checks_word_with_one_list_and_one_graphql_call() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-t085d-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let repo = tools.join("repo");
    fs::create_dir_all(&repo).unwrap();
    for args in [&["init", "-q", "-b", "main"][..], &["remote", "add", "origin", "https://github.com/o/r.git"]] {
        assert!(quiet("git").args(args).current_dir(&repo).status().unwrap().success());
    }
    fs::write(tools.join("list.json"), r#"[{"number":7,"id":"PR_7"},{"number":9,"id":"PR_9"}]"#).unwrap();
    fs::write(tools.join("checks.json"), r#"{"data":{"nodes":[{"id":"PR_7","commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE"}}}]}}]}}"#).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"graphql\" (type \"%~dp0checks.json\") else (type \"%~dp0list.json\")\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$2\" = graphql ]; then cat \"$(dirname \"$0\")/checks.json\"; else cat \"$(dirname \"$0\")/list.json\"; fi\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let path = repo.to_string_lossy().to_string();
    let pr = |n: u64, state: &str| Some(Pr { number: n, url: format!("https://github.com/o/r/pull/{n}"), state: state.into(), title: None, head: None, draft: false });
    let row = |path: &str, pr: Option<Pr>, error: Option<&str>| PolledPr { path: path.into(), linked: false, pr, error: error.map(String::from) };
    let polled = [row(&path, pr(7, "OPEN"), None), row("C:/closed", pr(8, "CLOSED"), None), row("C:/broken", pr(9, "OPEN"), Some("rate limited")), row("C:/none", None, None)];
    let got = polled_checks(&gh, &polled);
    // Only the open pull request with a readable project is asked about; the rest are left out.
    assert_eq!(got.get(&path).map(String::as_str), Some("failing"));
    assert_eq!(got.len(), 1, "{got:?}");
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    assert_eq!(calls.lines().count(), 2, "{calls}");
    assert!(calls.contains("pr list --state open") && calls.contains("api graphql --hostname github.com") && calls.contains("PR_7") && !calls.contains("PR_9"), "{calls}");
    // Nothing open to ask about asks nothing.
    let before = calls.lines().count();
    assert!(polled_checks(&gh, &polled[1..]).is_empty());
    assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
    assert_eq!(open_ids("not json"), std::collections::HashMap::new());
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git043_tasks_search_pages_through_github_search_with_labels_assignees_and_checks() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-git043-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let search = r#"{"total_count":1234,"incomplete_results":false,"items":[
            {"number":3,"title":"Crash on start","html_url":"https://github.com/o/r/issues/3","repository_url":"https://api.github.com/repos/o/r","state":"open","node_id":"I_3","updated_at":"2026-10-10T08:00:00Z","labels":[{"name":"bug","color":"d73a4a"},{"name":"odd","color":"red;x"}],"assignees":[{"login":"txais"}]},
            {"number":9,"title":"Fix crash","html_url":"https://github.com/o/r/pull/9","repository_url":"https://api.github.com/repos/o/r","state":"open","draft":true,"node_id":"PR_9","updated_at":"2026-10-11T08:00:00Z","labels":[],"assignees":[],"pull_request":{"merged_at":null}},
            {"number":8,"title":"Old fix","html_url":"https://github.com/o/r/pull/8","repository_url":"https://api.github.com/repos/o/r","state":"closed","node_id":"PR_8","updated_at":"2026-10-01T08:00:00Z","labels":[],"assignees":[],"pull_request":{"merged_at":"2026-10-01T08:00:00Z"}}]}"#;
    fs::write(tools.join("search.json"), search).unwrap();
    fs::write(tools.join("checks.json"), r#"{"data":{"nodes":[{"id":"PR_9","commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE"}}}]}},{"id":"PR_8","commits":{"nodes":[{"commit":{"statusCheckRollup":null}}]}}]}}"#).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"graphql\" (type \"%~dp0checks.json\") else (type \"%~dp0search.json\")\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\nif [ \"$2\" = graphql ]; then cat \"$(dirname \"$0\")/checks.json\"; else cat \"$(dirname \"$0\")/search.json\"; fi\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let qs = ["is:issue is:open repo:o/r".to_string(), "is:pr is:open repo:o/r".to_string()];
    let got = tasks_search(&gh, "github.com", &qs, 3).unwrap();
    // Two searches of the same answer: summed for the count, the deeper one sets the pages, each item once.
    assert_eq!((got.total, got.deepest), (2468, 1234));
    let seen: Vec<(&str, u64, &str, bool, Option<&str>)> = got.items.iter().map(|t| (t.kind.as_str(), t.number, t.state.as_str(), t.draft, t.checks.as_deref())).collect();
    assert_eq!(seen, vec![("pr", 9, "open", true, Some("failing")), ("issue", 3, "open", false, None), ("pr", 8, "merged", false, Some("unresolved"))]);
    let issue = &got.items[1];
    assert_eq!((issue.repo.as_str(), issue.assignees.clone()), ("o/r", vec!["txais".to_string()]));
    // A colour that is not six hex digits is dropped, never handed to the page's style.
    assert_eq!(issue.labels, vec![TaskLabel { name: "bug".into(), color: "d73a4a".into() }, TaskLabel { name: "odd".into(), color: String::new() }]);
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    assert!(calls.contains("api search/issues --hostname github.com -X GET"), "{calls}");
    assert!(calls.contains("is:pr is:open repo:o/r") && calls.contains("page=3") && calls.contains("per_page=25"), "{calls}");
    assert!(calls.contains("api graphql --hostname github.com") && calls.contains("PR_9") && !calls.contains("I_3"), "{calls}");
    // Past GitHub's 1000-result window nothing is asked.
    let before = calls.lines().count();
    assert!(tasks_search(&gh, "github.com", &qs, 41).unwrap_err().contains("first 1000"));
    assert!(tasks_search(&gh, "bad host", &qs, 1).is_err());
    assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
    assert_eq!(checks_word(Some("SUCCESS")), "passing");
    assert_eq!(checks_word(Some("PENDING")), "running");
    assert_eq!(checks_word(Some("ERROR")), "failing");
    assert_eq!(checks_word(None), "unresolved");
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git050_preview_reads_body_and_timeline_and_edits_labels_and_body_through_gh() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-git050-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    fs::write(tools.join("issue.json"), r#"{"number":3,"title":"Crash","state":"open","body":"It crashes.","updated_at":"2026-10-10T08:00:00Z","labels":[{"name":"bug","color":"d73a4a"}],"assignees":[{"login":"txais"}]}"#).unwrap();
    fs::write(tools.join("timeline.json"), r#"[
            {"event":"labeled","actor":{"login":"txais"},"created_at":"2026-10-09T08:00:00Z","label":{"name":"bug"}},
            {"event":"subscribed","actor":{"login":"txais"},"created_at":"2026-10-09T08:01:00Z"},
            {"event":"assigned","actor":{"login":"txais"},"created_at":"2026-10-09T08:02:00Z","assignee":{"login":"mo"}},
            {"event":"commented","user":{"login":"mo"},"created_at":"2026-10-09T09:00:00Z","body":"Same here."},
            {"event":"renamed","actor":{"login":"mo"},"created_at":"2026-10-09T10:00:00Z","rename":{"from":"Crsh","to":"Crash"}},
            {"event":"closed","actor":{"login":"mo"},"created_at":"2026-10-09T11:00:00Z"}]"#).unwrap();
    fs::write(tools.join("labels.json"), r#"[{"name":"bug","color":"d73a4a"},{"name":"needs info","color":"zzzzzz"}]"#).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        let script = "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho %* | findstr /c:\"/timeline\" >nul && (type \"%~dp0timeline.json\" & exit /b 0)\r\necho %* | findstr /c:\"/labels\" >nul && (type \"%~dp0labels.json\" & exit /b 0)\r\nif \"%3\"==\"PATCH\" (more >>\"%~dp0input.txt\")\r\ntype \"%~dp0issue.json\"\r\n";
        fs::write(&f, script).unwrap();
        f
    } else {
        let f = tools.join("gh");
        let script = "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncase \"$*\" in *'/timeline'*) cat \"$d/timeline.json\"; exit 0;; *'/labels'*) cat \"$d/labels.json\"; exit 0;; esac\n[ \"$3\" = PATCH ] && cat >> \"$d/input.txt\"\ncat \"$d/issue.json\"\n";
        fs::write(&f, script).unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let d = task_detail(&gh, "github.com", "o/r", 3).unwrap();
    assert_eq!((d.body.as_str(), d.state.as_str(), d.assignees.clone()), ("It crashes.", "open", vec!["txais".to_string()]));
    assert_eq!(d.labels, vec![TaskLabel { name: "bug".into(), color: "d73a4a".into() }]);
    // Subscriptions are noise and are left out; the rest keep who, when and what.
    let seen: Vec<(&str, &str, &str)> = d.events.iter().map(|e| (e.kind.as_str(), e.actor.as_str(), e.detail.as_str())).collect();
    assert_eq!(seen, vec![("labeled", "txais", "bug"), ("assigned", "txais", "mo"), ("commented", "mo", "Same here."), ("renamed", "mo", "Crsh \u{2192} Crash"), ("closed", "mo", "")]);
    assert_eq!(d.events[0].at, "2026-10-09T08:00:00Z");
    // Labels the repository offers, with a colour that is not hex dropped.
    assert_eq!(repo_labels(&gh, "github.com", "o/r").unwrap()[1], TaskLabel { name: "needs info".into(), color: String::new() });
    // Adding and removing a label answer with the labels the item has afterwards.
    assert_eq!(task_labels(&gh, "github.com", "o/r", 3, &["needs info".into()], &["good first/issue".into()]).unwrap().len(), 2);
    let body = task_body(&gh, "github.com", "o/r", 3, "New \"body\"").unwrap();
    assert_eq!(body.body, "It crashes.");
    // Windows quotes some arguments in the log; the words are what matter.
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap().replace('"', "");
    assert!(calls.contains("api repos/o/r/issues/3 --hostname github.com"), "{calls}");
    assert!(calls.contains("api repos/o/r/issues/3/timeline --hostname github.com -X GET -f per_page=100"), "{calls}");
    assert!(calls.contains("api -X POST repos/o/r/issues/3/labels --hostname github.com -f") && calls.contains("labels[]=needs info"), "{calls}");
    // A label name goes into the address encoded, so a slash cannot reach another path.
    assert!(calls.contains("api -X DELETE repos/o/r/issues/3/labels/good%20first%2Fissue --hostname github.com"), "{calls}");
    assert!(calls.contains("api -X PATCH repos/o/r/issues/3 --hostname github.com --input -"), "{calls}");
    assert!(fs::read_to_string(tools.join("input.txt")).unwrap().contains(r#"{"body":"New \"body\""}"#));
    // A repository or host that is not plain owner/name is refused before gh runs.
    let before = fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count();
    assert!(task_detail(&gh, "github.com", "o/r/../x", 3).is_err());
    assert!(task_detail(&gh, "github.com", "o", 3).is_err());
    assert!(task_detail(&gh, "bad host", "o/r", 3).is_err());
    assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().lines().count(), before);
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git018_a_custom_writer_command_takes_the_prompt_in_place_or_on_standard_input() {
    // Quoted arguments stay together and backslashes stay as typed.
    assert_eq!(split_command(r#"node "C:\My Tools\w.js" --say {prompt}"#), vec!["node", r"C:\My Tools\w.js", "--say", "{prompt}"]);
    assert_eq!(split_command(r#"  tool  -m "a b"x  "#), vec!["tool", "-m", "a bx"]);
    // The placeholder takes the prompt; without one the prompt goes on standard input.
    let (args, input) = writer_args(&["--say".into(), "<{prompt}>".into()], "hi there");
    assert_eq!((args, input), (vec!["--say".to_string(), "<hi there>".to_string()], None));
    let (args, input) = writer_args(&["-q".into()], "hi");
    assert_eq!((args, input), (vec!["-q".to_string()], Some("hi".to_string())));
    // Custom instructions have their own capped part; blank ones add nothing.
    assert_eq!(message_prompt("D", "  \n "), message_prompt("D", ""));
    let p = message_prompt("D", "Use the imperative mood.");
    assert!(p.contains("Use the imperative mood.") && p.ends_with("\n\nD"), "{p}");
    let long = message_prompt("D", &"x".repeat(INSTRUCTIONS_MAX * 3));
    assert!(long.matches('x').count() <= INSTRUCTIONS_MAX, "{}", long.len());
    // A command run with the prompt in its arguments gets no standard input.
    let root = std::env::temp_dir().join(format!("kolux-scm-git018-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let f = if cfg!(windows) {
        let f = root.join("say.cmd");
        fs::write(&f, "@echo off\r\necho %~1\r\n").unwrap();
        f
    } else {
        let f = root.join("say");
        fs::write(&f, "#!/bin/sh\necho \"$1\"\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let (args, input) = writer_args(&["{prompt}".into()], "Fix the poll");
    assert_eq!(write_message(&f, &args.iter().map(String::as_str).collect::<Vec<_>>(), &root, input.as_deref(), "k18", std::time::Duration::from_secs(20)), Ok("Fix the poll".to_string()));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn git017_commit_message_from_the_staged_diff_is_trimmed_cleaned_and_stoppable() {
    // A large diff is cut to the budget, shared fairly: the small file stays whole.
    let small = "diff --git a/s b/s\n+one\n+two\n";
    let big: String = format!("diff --git a/b b/b\n{}", (0..2000).map(|i| format!("+line {i}\n")).collect::<String>());
    let cut = trim_diff(&format!("{small}{big}"), 600);
    assert!(cut.len() <= 600 + 200, "{}", cut.len());
    assert!(cut.starts_with(small), "{cut}");
    assert!(cut.contains("+line 0\n") && !cut.contains("+line 1999"), "{cut}");
    assert!(cut.lines().all(|l| l.starts_with('+') || l.starts_with("diff ") || l.starts_with("[")), "cut mid-line: {cut}");
    assert_eq!(trim_diff(small, 600), small);
    // Fences, an announcing first line and bullets are stripped.
    assert_eq!(clean_message("Here is the commit message:\n```\n- Add the poll\n- Fix the row\n```\n"), "Add the poll\nFix the row");
    assert_eq!(clean_message("Add the poll\n\n* keeps state\n"), "Add the poll\n\nkeeps state");
    let root = std::env::temp_dir().join(format!("kolux-scm-git017-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let script = |name: &str, win: &str, sh: &str| {
        if cfg!(windows) {
            let f = root.join(format!("{name}.cmd"));
            fs::write(&f, format!("@echo off\r\n{win}\r\n")).unwrap();
            f
        } else {
            let f = root.join(name);
            fs::write(&f, format!("#!/bin/sh\n{sh}\n")).unwrap();
            quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        }
    };
    let limit = std::time::Duration::from_secs(20);
    // The prompt arrives on standard input and the answer comes back cleaned.
    let echo = script("echo", "findstr /c:\"STAGED\" >nul && echo - Wrote the message", "grep -q STAGED && echo '- Wrote the message'");
    assert_eq!(write_message(&echo, &[], &root, Some("STAGED diff"), "k1", limit), Ok("Wrote the message".to_string()));
    // A clean exit with nothing printed is an empty result, with the error stream's excerpt.
    let empty = script("empty", "echo warming up 1>&2", "echo 'warming up' >&2");
    let e = write_message(&empty, &[], &root, Some("x"), "k2", limit).unwrap_err();
    assert!(e.contains("wrote nothing") && e.contains("warming up"), "{e}");
    // A failure favours the error stream and masks keys.
    let fail = script("fail", "echo partial\r\necho bad key sk-ant-abc123 1>&2\r\nexit /b 3", "echo partial; echo 'bad key sk-ant-abc123' >&2; exit 3");
    let e = write_message(&fail, &[], &root, Some("x"), "k3", limit).unwrap_err();
    assert!(e.contains("bad key sk-ant-[masked]") && !e.contains("abc123") && !e.contains("partial"), "{e}");
    // Stopping a run ends it at once and leaves no message.
    let slow = script("slow", "ping -n 30 127.0.0.1 >nul\r\necho late", "sleep 30; echo late");
    let started = std::time::Instant::now();
    let stopper = std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(800));
        stop_message("k4");
    });
    let e = write_message(&slow, &[], &root, Some("x"), "k4", limit).unwrap_err();
    stopper.join().unwrap();
    assert_eq!(e, "stopped");
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    // The prompt names the job and carries the diff.
    let p = message_prompt("diff --git a/x b/x\n+y\n", "");
    assert!(p.contains("commit message") && p.ends_with("diff --git a/x b/x\n+y\n"), "{p}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn git027_background_poll_asks_once_per_repository_and_stops_at_the_rate_limit() {
    let root = std::env::temp_dir().join(format!("kolux-scm-git027-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let tools = root.join("tools");
    fs::create_dir_all(&tools).unwrap();
    let checkout = |name: &str, branch: &str, origin: Option<&str>| {
        let dir = temp_repo(&format!("git027-{name}"));
        if branch != "main" {
            run(&["checkout", "-q", "-b", branch], Some(&dir)).unwrap();
        }
        if let Some(o) = origin {
            run(&["remote", "add", "origin", o], Some(&dir)).unwrap();
        }
        dir.to_string_lossy().to_string()
    };
    // Two checkouts of one project under different remote forms, its main checkout, a second
    // project that hits the rate limit, a third never reached, and one with no GitHub remote.
    let a1 = checkout("a1", "feat", Some("https://github.com/o/r.git"));
    let a2 = checkout("a2", "fix", Some("git@github.com:O/R.git"));
    let a3 = checkout("a3", "main", Some("https://github.com/o/r"));
    let b = checkout("b", "work", Some("https://github.com/o/s.git"));
    let c = checkout("c", "work", Some("https://github.com/o/t.git"));
    let d = checkout("d", "work", None);
    fs::write(tools.join("list.json"), r#"[
            {"number":5,"url":"https://github.com/o/r/pull/5","state":"CLOSED","title":"Old feat","headRefName":"feat","isDraft":false},
            {"number":9,"url":"https://github.com/o/r/pull/9","state":"OPEN","title":"Feat","headRefName":"feat","isDraft":true},
            {"number":8,"url":"https://github.com/o/r/pull/8","state":"MERGED","title":"Fix","headRefName":"fix","isDraft":false},
            {"number":3,"url":"https://github.com/o/r/pull/3","state":"CLOSED","title":"From main","headRefName":"main","isDraft":false},
            {"number":2,"url":"https://github.com/o/r/pull/2","state":"OPEN","title":"Elsewhere","headRefName":"other","isDraft":false}]"#).unwrap();
    fs::write(tools.join("budget.json"), r#"{"resources":{"core":{"limit":5000,"remaining":0,"reset":1760000000}}}"#).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        let script = "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%2\"==\"rate_limit\" (type \"%~dp0budget.json\" & exit /b 0)\r\necho %* | findstr /c:\"o/s\" >nul && (echo API rate limit exceeded for user ID 1. 1>&2 & exit /b 1)\r\ntype \"%~dp0list.json\"\r\n";
        fs::write(&f, script).unwrap();
        f
    } else {
        let f = tools.join("gh");
        let script = "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\n[ \"$2\" = rate_limit ] && { cat \"$d/budget.json\"; exit 0; }\ncase \"$*\" in *o/s*) echo 'API rate limit exceeded for user ID 1.' >&2; exit 1;; esac\ncat \"$d/list.json\"\n";
        fs::write(&f, script).unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let item = |path: &str, linked: Option<&str>| PollItem { path: path.to_string(), linked: linked.map(String::from) };
    let items = vec![item(&a1, None), item(&d, None), item(&b, None), item(&a2, None), item(&a3, None), item(&c, None), item(&a1, Some("https://github.com/o/r/pull/2"))];
    let got = prs_poll(&gh, &items, std::time::Duration::from_millis(10));
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap().replace('"', "");
    // One list call per project in the order asked, then the budget read; o/t is never asked.
    let lists: Vec<&str> = calls.lines().filter(|l| l.starts_with("pr list")).collect();
    assert_eq!(lists.len(), 2, "{calls}");
    assert!(lists[0].contains("--repo github.com/o/r") && lists[1].contains("--repo github.com/o/s"), "{calls}");
    assert!(lists[0].contains("--state all --limit 100 --json number,url,state,title,headRefName,isDraft"), "{calls}");
    assert!(calls.contains("api rate_limit") && !calls.contains("o/t"), "{calls}");
    assert_eq!(got.limited_until, Some(1760000000));
    let of = |p: &str, linked: bool| got.prs.iter().find(|x| x.path == p && x.linked == linked).unwrap();
    // The branch's open pull request wins over an older closed one.
    assert_eq!(of(&a1, false).pr.as_ref().map(|p| (p.number, p.draft)), Some((9, true)));
    assert_eq!(of(&a2, false).pr.as_ref().map(|p| (p.number, p.state.as_str())), Some((8, "MERGED")));
    // A closed pull request from the default branch stays hidden.
    assert_eq!(of(&a3, false).pr, None);
    assert!(of(&a3, false).error.is_none());
    // A hand link is found in the same answer, wherever its branch is.
    assert_eq!(of(&a1, true).pr.as_ref().map(|p| p.number), Some(2));
    // The rate-limited project and the one behind it keep what they had (an error, no answer).
    assert!(of(&b, false).error.as_deref().unwrap().contains("rate limit"));
    assert!(of(&c, false).error.is_some() && of(&c, false).pr.is_none());
    // No GitHub remote: no pull request and nothing to retry.
    assert!(of(&d, false).pr.is_none() && of(&d, false).error.is_none());
    for p in [&a1, &a2, &a3, &b, &c, &d] {
        let _ = fs::remove_dir_all(p);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn fix2_an_at_path_owner_is_refused_and_a_host_gh_is_not_signed_in_to_gets_no_request() {
    for bad in [
        "https://evil.example/@..\\..\\.ssh\\id_ed25519/x/pull/1",
        "https://evil.example/@id/x/pull/1",
        "https://evil.example/.ssh/x/pull/1",
        "https://evil.example/o/.git/pull/1",
        "https://evil.example/o/a\\b/pull/1",
        "https://evil.example:8443/o/r/pull/1",
        "https://u@evil.example/o/r/pull/1",
    ] {
        assert_eq!(pr_url_in(bad), None, "{bad}");
    }
    assert_eq!(pr_url_in("https://github.com/my-org/repo.name_2/pull/9#x").as_deref(), Some("https://github.com/my-org/repo.name_2/pull/9"));
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix2-host-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let url = "https://nobody.example/o/r/pull/3";
    for e in [merge_info(&gh, &tools, url).unwrap_err(), merge_act(&gh, &tools, url, "close", None).unwrap_err(), pr_link(&gh, &tools, url).unwrap_err()] {
        assert!(e.contains("is not one of them") && !e.contains("did not answer"), "{e}");
    }
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    assert!(calls.lines().all(|c| c.trim().starts_with("config get -h nobody.example")), "{calls}");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-BEFORE-1: the Checks panel's linked pull request (by hand or printed in a pane) goes to gh
/// only as a well-formed link on a host gh is signed in to, in its cleaned form; a link to any
/// other host asks gh nothing beyond its own config, and a malformed one reaches no gh at all.
#[test]
fn fixb1_the_checks_panel_asks_gh_only_about_a_clean_link_on_a_signed_in_host() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fixb1-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let calls = || fs::read_to_string(tools.join("calls.txt")).unwrap_or_default();
    for bad in ["https://evil.example/@id/x/pull/1", "https://evil.example/o/.git/pull/1", "https://u@github.com/o/r/pull/1", "https://github.com/o/r/pull/x", "github.com/o/r/pull/1"] {
        assert!(pr_checks_linked(&gh, &tools, bad).unwrap_err().contains("not a pull request link"), "{bad}");
    }
    assert_eq!(calls(), "", "a malformed link reaches no gh at all");
    let e = pr_checks_linked(&gh, &tools, "https://nobody.example/o/r/pull/3").unwrap_err();
    assert!(e.contains("is not one of them") && !e.contains("did not answer"), "{e}");
    assert!(calls().lines().all(|c| c.trim().starts_with("config get -h nobody.example")), "{}", calls());
    let got = pr_checks_linked(&gh, &tools, " https://github.com/o/r/pull/12/files#diff-1 ").unwrap();
    assert_eq!(got.pr.map(|p| p.number), Some(12));
    let view: Vec<String> = calls().lines().map(|c| c.trim().replace('"', "")).filter(|c| c.starts_with("pr view")).collect();
    assert_eq!(view.len(), 1, "{}", calls());
    assert!(view[0].starts_with("pr view https://github.com/o/r/pull/12 --json"), "{}", view[0]);
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-SOON 2: GitHub Enterprise Managed User logins read name_shortcode, so an owner may hold an
/// underscore after its first character; a leading mark of any kind is still refused.
#[test]
fn fixsoon_an_enterprise_managed_user_owner_is_accepted_and_a_leading_mark_is_not() {
    assert_eq!(pr_url_in("https://github.com/octo_acme/r/pull/1").as_deref(), Some("https://github.com/octo_acme/r/pull/1"));
    assert_eq!(pr_url_in("https://github.com/a_b-c/r/pull/2#x").as_deref(), Some("https://github.com/a_b-c/r/pull/2"));
    for bad in ["https://github.com/_octo/r/pull/1", "https://github.com/-octo/r/pull/1", "https://github.com/.octo/r/pull/1", "https://github.com/@octo/r/pull/1"] {
        assert_eq!(pr_url_in(bad), None, "{bad}");
    }
    assert_eq!(pr_url_in(&format!("https://github.com/{}/r/pull/1", "a".repeat(40))), None);
}

/// FIX-SOON 3: the host gate on its own: a well-formed link (valid owner and name) on a host gh is
/// not signed in to gets no pull request request from the merge box, its actions, the PR link
/// or the Checks panel; gh is asked only for its own config about that host.
#[test]
fn fixsoon_a_valid_link_on_a_host_gh_is_not_signed_in_to_gets_no_request() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fixsoon-gate-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let url = "https://nobody.example/octo/repo.name/pull/3";
    assert!(pr_url_in(url).is_some(), "the link itself is well formed");
    // Load flake fix: the gate gives each `gh config get` 5 s, and a loaded PC can take longer
    // to start one, which refuses the host with "gh did not answer" instead of gh's own
    // refusal. Such a round says nothing about the gate, so it is asked again (up to 5 times);
    // the round that is judged is one where gh answered every read, and it must hold in full.
    let mut round = 0;
    let calls = loop {
        round += 1;
        fs::remove_file(tools.join("calls.txt")).ok();
        let errs = [merge_info(&gh, &tools, url).unwrap_err(), merge_act(&gh, &tools, url, "close", None).unwrap_err(), pr_link(&gh, &tools, url).unwrap_err(), pr_checks_linked(&gh, &tools, url).unwrap_err()];
        if errs.iter().any(|e| e.contains("did not answer")) {
            assert!(round < 5, "gh never answered every config read in time in {round} rounds: {errs:?}");
            continue;
        }
        for e in &errs {
            assert!(e.contains("is not one of them"), "{e}");
        }
        break fs::read_to_string(tools.join("calls.txt")).unwrap();
    };
    assert_eq!(calls.lines().count(), 4, "{calls}");
    assert!(calls.lines().all(|c| c.trim().starts_with("config get -h nobody.example user")), "{calls}");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-3 (review FIX-SOON 1): gh answers `config get -h <host> user` with its top-level `user`
/// when the host has none of its own, so that echo is no sign-in. A link to such a host gets no
/// pull request request from the merge box, its actions, the PR link or the Checks panel; gh is
/// asked only about its own config (the shared gate, github::host_allowed).
#[test]
fn fix3_a_host_that_only_echoes_the_top_level_user_gets_no_request() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix3-top-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" echo octo& exit /b 0\r\necho {}\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\n[ \"$1\" = config ] && echo octo && exit 0\necho '{}'\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let url = "https://ghe.example/o/r/pull/3";
    let refused = [
        merge_info(&gh, &tools, url).err(),
        merge_act(&gh, &tools, url, "close", None).err(),
        pr_link(&gh, &tools, url).err(),
        pr_checks_linked(&gh, &tools, url).err(),
    ];
    for e in refused {
        let e = e.expect("refused");
        assert!(e.contains("ghe.example is not one of them"), "{e}");
    }
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    assert!(calls.lines().all(|c| c.trim().starts_with("config get")), "only gh's own config is read: {calls}");
    assert!(calls.lines().any(|c| c.trim() == "config get user"), "the top-level user was compared: {calls}");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-3 (review AFTER 1-3): gh and the browser get the cleaned `https://host/owner/repo/pull/N`
/// form of a link, never the raw text, and the host in it is lower case with a letter or digit first.
#[test]
fn fix3_gh_and_the_browser_get_only_the_cleaned_link() {
    assert_eq!(pr_url_in("https://GitHub.COM/o/r/pull/1").as_deref(), Some("https://github.com/o/r/pull/1"));
    for bad in ["https://-evil.example/o/r/pull/1", "https://.evil.example/o/r/pull/1", "https:///o/r/pull/1"] {
        assert_eq!(pr_url_in(bad), None, "{bad}");
    }
    assert_eq!(open_target(" https://github.com/o/r/pull/12/files#diff-1 ").as_deref(), Ok("https://github.com/o/r/pull/12"));
    assert!(open_target("https://u@github.com/o/r/pull/12").is_err());
    assert!(open_target("https://github.com/o/r/issues/12").is_err());
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix3-clean-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    let gh = stand_in_gh(&tools);
    let url = " https://github.com/o/r/pull/12/files#diff-1 ";
    assert_eq!(pr_link(&gh, &tools, url).unwrap().number, 12);
    merge_act(&gh, &tools, url, "close", None).unwrap();
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    let pr: Vec<String> = calls.lines().map(|c| c.trim().replace('"', "")).filter(|c| c.starts_with("pr ")).collect();
    assert_eq!(pr.len(), 2, "{calls}");
    assert!(pr[0].starts_with("pr view https://github.com/o/r/pull/12 --json"), "{}", pr[0]);
    assert_eq!(pr[1], "pr close https://github.com/o/r/pull/12");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-3 (review FIX-SOON 3): a gh that runs past its time limit is stopped together with every
/// program it started (a gh.cmd shim's real gh), so nothing it began keeps running afterwards.
#[cfg(windows)]
#[test]
fn fix3_a_gh_that_times_out_is_stopped_with_everything_it_started() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix3-tree-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    // gh.cmd starts a second program that would leave a mark about five seconds later.
    fs::write(tools.join("late.cmd"), "@echo off\r\nping -n 6 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
    let gh = tools.join("gh.cmd");
    fs::write(&gh, "@echo off\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
    let started = std::time::Instant::now();
    let err = gh_run_for(&gh, &tools, &["pr", "view"], None, std::time::Duration::from_secs(1)).unwrap_err();
    assert!(err.contains("did not answer within 1 second"), "{err}");
    assert!(started.elapsed() < std::time::Duration::from_secs(5), "took {:?}", started.elapsed());
    std::thread::sleep(std::time::Duration::from_secs(8));
    assert!(!tools.join("late.txt").exists(), "a program gh started outlived its time limit");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-8 (review FIX-SOON 3): the programs alive right now whose image or command line is under
/// `dir` (Windows), as "name pid" lines. A fixture copy of ping (see `fix8_fixture`) is the only
/// way a wait left behind by a half-done kill can be told from any other ping on the PC.
#[cfg(windows)]
fn processes_under(dir: &std::path::Path) -> Vec<String> {
    let script = "$d = $env:KOLUX_TEST_DIR; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ( ($_.ExecutablePath -and $_.ExecutablePath.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.CommandLine -and $_.CommandLine.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0) ) } | ForEach-Object { $_.Name + ' ' + $_.ProcessId }";
    let out = quiet("powershell").args(["-NoProfile", "-NonInteractive", "-Command", script]).env("KOLUX_TEST_DIR", dir).output().expect("powershell did not start");
    assert!(out.status.success(), "the process check failed, so it proves nothing: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// FIX-8: the fixture of the two timeout halves: gh.cmd starts late.cmd at once. late.cmd says it
/// started, waits about five seconds with its OWN copy of ping (so a wait left alive is found by
/// its path) and leaves a mark only if that wait ran to the end (`&&`: a tree kill ends the wait
/// with exit code 1 a moment before the batch above it, and the batch must not read that as the
/// wait being over). Returns gh.cmd.
#[cfg(windows)]
fn fix8_fixture(tools: &std::path::Path) -> PathBuf {
    fix8_fixture_waiting(tools, 6)
}

/// `fix8_fixture` with the wait of `pings` pings (about one second each), for a test whose limit
/// has to be wide enough for a loaded PC to start the program first.
#[cfg(windows)]
fn fix8_fixture_waiting(tools: &std::path::Path, pings: u32) -> PathBuf {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
    fs::write(tools.join("late.cmd"), format!("@echo off\r\necho started>\"%~dp0started.txt\"\r\n\"%~dp0ping.exe\" -n {pings} 127.0.0.1 >nul && echo late>\"%~dp0late.txt\"\r\n")).unwrap();
    let gh = tools.join("gh.cmd");
    fs::write(&gh, "@echo off\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
    gh
}

/// FIX-8: the process check is not blind: it sees a program started from a folder and sees none
/// once that program has ended or in a folder where nothing ran.
#[cfg(windows)]
#[test]
fn fix8_the_process_check_sees_a_program_under_a_folder_and_none_after_it_ends() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix8-probe-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    fix8_fixture(&tools);
    assert!(processes_under(&tools).is_empty(), "nothing ran yet: {:?}", processes_under(&tools));
    let mut waiter = quiet(tools.join("ping.exe")).args(["-n", "30", "127.0.0.1"]).spawn().unwrap();
    let seen = processes_under(&tools);
    assert!(seen.iter().any(|l| l.to_lowercase().starts_with("ping.exe ")), "the running copy was not found: {seen:?}");
    waiter.kill().unwrap();
    waiter.wait().unwrap();
    let end = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !processes_under(&tools).is_empty() && std::time::Instant::now() < end {
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    assert!(processes_under(&tools).is_empty(), "the ended copy is still listed: {:?}", processes_under(&tools));
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-4 (review FIX-SOON 1): a timeout ends the tree through the job that holds gh; the tree
/// kill (a parent-pid walk that can reach a program gh never started) is asked only when there
/// is no job. FIX-8: neither half can pass having proved nothing: the job half checks that the
/// program gh started really started (and tries again, up to three times, when a loaded PC made
/// the limit run out first), and both halves check that nothing started from the test's own
/// folder is still alive, so a half-done kill (the batch ended, its wait left running) fails.
/// Load flake fix: the limits are wide (10 s, 6 s) so a loaded PC can start the fixture inside
/// them, and the program gh starts waits about 60 s, so a kill that did not happen is still
/// seen alive 20 s after the call returned (it would live 40 s or more longer).
#[cfg(windows)]
#[test]
fn fix4_a_timeout_ends_the_tree_through_the_job_and_uses_the_tree_kill_only_without_one() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix4-job-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let gh = fix8_fixture_waiting(&tools, 61);
    // Polls (up to 20 s) until nothing started from the folder is alive; returns what is left.
    let settle = || {
        let end = std::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            let alive = processes_under(&tools);
            if alive.is_empty() || std::time::Instant::now() >= end {
                return alive;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    };
    let limit = std::time::Duration::from_secs(10);
    let asked = std::sync::Mutex::new(Vec::new());
    let mut tried = 0;
    loop {
        tried += 1;
        for mark in ["started.txt", "late.txt"] {
            fs::remove_file(tools.join(mark)).ok();
        }
        asked.lock().unwrap().clear();
        let mut cmd = quiet(&gh);
        cmd.current_dir(&tools);
        let err = run_within_in(cmd, None, limit, true, &|p| asked.lock().unwrap().push(p), &|p| asked.lock().unwrap().push(p)).unwrap_err();
        assert!(err.contains("did not answer within 10 seconds"), "{err}");
        assert!(asked.lock().unwrap().is_empty(), "the tree kill ran although a job held gh: {:?}", asked.lock().unwrap());
        if tools.join("started.txt").exists() {
            assert!(!tools.join("late.txt").exists(), "a program gh started outlived its time limit");
            let left = settle();
            assert!(left.is_empty(), "the job left a program alive: {left:?}");
            break;
        }
        assert!(tried < 3, "fixture did not start: late.cmd never wrote started.txt in {tried} tries, so the job half proved nothing");
    }
    // Without a job the tree kill is the fallback and is asked for gh's pid. gh starts its
    // second program only after about nine seconds, past the limit of six, as a loaded PC
    // would, so the limit runs out before it exists; the tree kill waits (up to 30 s) for its
    // started.txt (FIX-7), so the walk finds it.
    let limit = std::time::Duration::from_secs(6);
    fs::remove_file(tools.join("started.txt")).ok();
    fs::write(&gh, "@echo off\r\nping -n 10 127.0.0.1 >nul\r\ncmd /c \"%~dp0late.cmd\"\r\n").unwrap();
    let started = tools.join("started.txt");
    let saw_it = std::sync::atomic::AtomicBool::new(false);
    let mut cmd = quiet(&gh);
    cmd.current_dir(&tools);
    asked.lock().unwrap().clear();
    let err = run_within_in(cmd, None, limit, false, &|p| {
        asked.lock().unwrap().push(p);
        // The limit has run out, but the walk by parent pid only finds a program that exists.
        let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !started.exists() && std::time::Instant::now() < end {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        saw_it.store(started.exists(), std::sync::atomic::Ordering::SeqCst);
        crate::procs::kill_tree(p);
    }, &|_| {})
    .unwrap_err();
    assert!(err.contains("did not answer within 6 seconds"), "{err}");
    assert_eq!(asked.lock().unwrap().len(), 1, "the fallback tree kill is asked once");
    assert!(saw_it.load(std::sync::atomic::Ordering::SeqCst), "fixture did not start: gh's second program never wrote started.txt within 30 s");
    assert!(!tools.join("late.txt").exists(), "the fallback left the program gh started running");
    let left = settle();
    assert!(left.is_empty(), "the fallback tree kill left a program alive: {left:?}");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-5 (review FIX-SOON 1 and 2): when no job holds gh, a finished gh that left a program
/// holding its output is handed to the leftover kill once and NEVER to the tree kill (gh is
/// reaped, so on Unix its pid may belong to another program by then), and the call still returns
/// gh's answer inside its limit. (On Windows taskkill needs the root alive, so only a job reaches
/// such a leftover; the leftover kill is best effort there and the group signal on Unix.) The
/// test waits for the leftover to finish, so it leaves no program behind.
#[cfg(windows)]
#[test]
fn fix5_without_a_job_a_finished_gh_with_a_holder_asks_only_the_leftover_kill_once_and_still_answers_in_time() {
    // Load flake fix: the holder outlives the limit by a wide margin (60 s against 8 s) and the
    // bound on the answer sits between them, so a PC where the kills themselves take seconds
    // (a taskkill took 6.8 s under two parallel builds) still tells "answered at the limit" from
    // "waited for the holder". The holder is a copy of ping in the folder, found and ended below.
    const LIMIT: std::time::Duration = std::time::Duration::from_secs(8);
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix4-nojob-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
    fs::write(tools.join("late.cmd"), "@echo off\r\n\"%~dp0ping.exe\" -n 61 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
    let gh = tools.join("gh.cmd");
    fs::write(&gh, "@echo off\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\necho octo\r\n").unwrap();
    let tree = std::sync::Mutex::new(Vec::new());
    let leftover = std::sync::Mutex::new(Vec::new());
    let mut cmd = quiet(&gh);
    cmd.current_dir(&tools);
    let started = std::time::Instant::now();
    let got = run_within_in(cmd, None, LIMIT, false, &|p| tree.lock().unwrap().push(p), &|p| {
        leftover.lock().unwrap().push(p);
        crate::procs::kill_tree(p);
    })
    .unwrap();
    let took = started.elapsed();
    assert_eq!(got.1.trim(), "octo");
    assert!(took < std::time::Duration::from_secs(45), "took {took:?} against a limit of {LIMIT:?}: the call waited for the holder");
    assert!(tree.lock().unwrap().is_empty(), "the tree kill was asked for a pid gh had already given up: {:?}", tree.lock().unwrap());
    assert_eq!(leftover.lock().unwrap().len(), 1, "the leftover kill runs once for the holder");
    // Windows cannot end the leftover without a job, so it is still running: end it here, and
    // wait (bounded) until nothing from the folder is alive before the folder goes.
    let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let alive = processes_under(&tools);
        if alive.is_empty() || std::time::Instant::now() >= end {
            break;
        }
        for pid in alive.iter().filter_map(|l| l.rsplit(' ').next()).filter_map(|p| p.parse::<u32>().ok()) {
            crate::procs::kill_tree(pid);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    assert!(processes_under(&tools).is_empty(), "the holder was left running: {:?}", processes_under(&tools));
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-5 (review FIX-SOON 1): the Unix leftover kill names the process group (`-pid`) and never
/// the bare pid, which may already belong to another program once gh has been reaped.
#[test]
fn fix5_the_leftover_kill_names_the_group_and_never_the_bare_pid() {
    let args = group_kill_args(4242);
    assert_eq!(args, ["-9", "--", "-4242"]);
    assert!(!args.iter().any(|a| a == "4242"), "{args:?}");
}

/// FIX-6 (review AFTER 1): a negative process-group id is never read as an option: the `--`
/// ends the options before it.
#[test]
fn fix6_the_group_id_comes_after_the_end_of_options_marker() {
    let args = group_kill_args(4242);
    let dashdash = args.iter().position(|a| a == "--").expect("no -- in the arguments");
    let group = args.iter().position(|a| a == "-4242").expect("no group id in the arguments");
    assert!(dashdash < group, "{args:?}");
    assert_eq!(group, args.len() - 1, "{args:?}");
}

/// FIX-6 (review AFTER 2): `kill_leftover` itself (through its runner seam) runs the program
/// `kill` once with the group arguments, and never with the bare pid.
#[test]
fn fix6_the_leftover_kill_runs_kill_once_with_the_group_arguments() {
    let seen = std::cell::RefCell::new(Vec::<(String, Vec<String>)>::new());
    kill_leftover_with(4242, &|program, args| seen.borrow_mut().push((program.to_string(), args.to_vec())));
    let seen = seen.into_inner();
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert_eq!(seen[0].0, "kill");
    assert_eq!(seen[0].1, ["-9", "--", "-4242"]);
    assert!(!seen[0].1.iter().any(|a| a == "4242"), "{seen:?}");
}

/// FIX-7 (review AFTER 1): the real runner starts the program with its arguments and waits for it
/// to end, and a program that cannot start is not an error (the leftover kill is best effort).
#[test]
fn fix7_the_real_runner_runs_the_program_with_its_arguments_and_waits() {
    #[cfg(windows)]
    let (program, args) = ("cmd", vec!["/C".to_string(), "echo ran & exit 7".to_string()]);
    #[cfg(not(windows))]
    let (program, args) = ("sh", vec!["-c".to_string(), "echo ran; exit 7".to_string()]);
    // It started the program with those arguments and waited for the end: the exit code and the
    // whole output are in hand when it returns.
    let out = run_program_output(program, &args).unwrap();
    assert_eq!(out.status.code(), Some(7));
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "ran");
    run_program(program, &args);
    // A program that cannot start is dropped without a panic.
    run_program("kolux-no-such-program-fix7", &["-9".to_string()]);
}

/// FIX-8 (review FIX-SOON 1): reads `kill_leftover` out of `src` and says whether its Unix block
/// hands the shared runner to the seam. The call must be live code, alone inside a block that
/// follows the `cfg(unix)` attribute: a call in a comment, outside the block, under no attribute
/// or replaced by an inline closure is an error.
fn leftover_wiring(src: &str) -> Result<(), String> {
    let src = src.replace("\r\n", "\n");
    let head = ["fn kill_leftover", "(pid: u32) {"].concat();
    let from = src.find(&head).ok_or("kill_leftover not found")?;
    let body = &src[from..from + src[from..].find("\n}").ok_or("kill_leftover has no end")?];
    let live: Vec<&str> = body.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("//")).collect();
    let want = ["#[cfg(unix)]", "{", "kill_leftover_with(pid, &run_program);", "}"];
    if live.windows(4).any(|w| w.iter().zip(&want).all(|(a, b)| a == b)) {
        Ok(())
    } else {
        Err(format!("the Unix block does not hand run_program to kill_leftover_with: {live:?}"))
    }
}

/// FIX-8 (review FIX-SOON 1): the wiring check is not blind. Each wrong shape fails it (the old
/// inline closure, a call only in a comment, a call outside the block, a block with no
/// attribute) and the right one passes.
#[test]
fn fix8_the_wiring_check_fails_the_wrong_shapes_and_passes_the_right_one() {
    let head = ["fn kill_leftover", "(pid: u32) {"].concat();
    let call = ["kill_leftover_with(pid, &", "run_program);"].concat();
    let attr = ["#[cfg(", "unix)]"].concat();
    let tail = "    #[cfg(not(unix))]\n    crate::procs::kill_tree(pid);\n}\n";
    let make = |inner: &str| format!("fn other() {{}}\n{head}\n{inner}{tail}");
    let good = make(&format!("    {attr}\n    {{\n        {call}\n    }}\n"));
    assert_eq!(leftover_wiring(&good), Ok(()));
    assert_eq!(leftover_wiring(&good.replace('\n', "\r\n")), Ok(()), "CRLF must read the same");
    let old_closure = make(&format!("    {attr}\n    {{\n        kill_leftover_with(pid, &|program, args| {{\n            let _ = quiet(program).args(args).output();\n        }});\n    }}\n"));
    assert!(leftover_wiring(&old_closure).is_err(), "the old inline closure passed");
    let commented = make(&format!("    {attr}\n    {{\n        // {call}\n    }}\n"));
    assert!(leftover_wiring(&commented).is_err(), "a call in a comment passed");
    let outside = make(&format!("    {attr}\n    {{\n    }}\n    {call}\n"));
    assert!(leftover_wiring(&outside).is_err(), "a call outside the block passed");
    let no_attr = make(&format!("    {{\n        {call}\n    }}\n"));
    assert!(leftover_wiring(&no_attr).is_err(), "a block with no attribute passed");
    assert!(leftover_wiring("fn nothing() {}\n").is_err());
}

/// FIX-7 (review AFTER 1): `kill_leftover` hands the shared runner to the seam, so the code a
/// Unix host runs is the code the runner test above runs (read from this file because Windows
/// cannot compile the Unix body). FIX-8: the check is `leftover_wiring`, which the test above
/// shows fails the wrong shapes.
#[test]
fn fix7_kill_leftover_uses_the_shared_runner() {
    assert_eq!(leftover_wiring(include_str!("scm.rs")), Ok(()));
}

/// FIX-4 (review AFTER 1): a gh that finishes just as the limit runs out still gets a short
/// floor to close its output, so a `pr create` that worked is not cut off before its link.
#[test]
fn fix4_the_grace_has_a_floor_even_when_the_limit_has_run_out() {
    let now = std::time::Instant::now();
    assert!(grace_after(now, now) >= std::time::Duration::from_millis(200), "{:?}", grace_after(now, now));
    assert!(grace_after(now + std::time::Duration::from_secs(10), now) >= std::time::Duration::from_millis(200));
    assert_eq!(grace_after(now, now + std::time::Duration::from_secs(60)), std::time::Duration::from_millis(500));
}

/// FIX-3 (review FIX-SOON 3): gh has finished, but a program it started still holds its output;
/// the answer comes back anyway, within the limit, and the leftover program is stopped (FIX-4:
/// the answer comes back inside the limit and the leftover leaves no mark).
/// Load flake fix: the limit is 20 s so a loaded PC can start gh inside it, the holder waits
/// 60 s (its own copy of ping, so it is found by path), and the answer must come within 40 s:
/// a call that waited for the holder takes 55 s or more, one that answered at the limit about 1 s
/// after gh finished. The holder must be gone within 30 s of the answer (alive 40 s or more
/// otherwise).
#[cfg(windows)]
#[test]
fn fix3_a_gh_that_leaves_a_program_holding_its_output_still_answers_in_time() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix3-hold-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    // gh prints its answer and exits, leaving a program that holds its output and would leave a
    // mark about a minute later.
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    fs::copy(system.join("System32").join("PING.EXE"), tools.join("ping.exe")).unwrap();
    fs::write(tools.join("late.cmd"), "@echo off\r\n\"%~dp0ping.exe\" -n 61 127.0.0.1 >nul\r\necho late>\"%~dp0late.txt\"\r\n").unwrap();
    let gh = tools.join("gh.cmd");
    fs::write(&gh, "@echo off\r\nstart \"\" /b cmd /c \"%~dp0late.cmd\"\r\necho octo\r\n").unwrap();
    let limit = std::time::Duration::from_secs(20);
    let (tx, rx) = std::sync::mpsc::channel();
    let (g, t) = (gh.clone(), tools.clone());
    let started = std::time::Instant::now();
    std::thread::spawn(move || {
        let _ = tx.send(gh_run_for(&g, &t, &["pr", "view"], None, limit));
    });
    let got = rx.recv_timeout(std::time::Duration::from_secs(120)).expect("the call returns within its bound");
    let took = started.elapsed();
    assert_eq!(got.as_deref(), Ok("octo"));
    assert!(took < std::time::Duration::from_secs(40), "took {took:?} against a limit of {limit:?}: the call waited for the holder");
    let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let mut left = processes_under(&tools);
    while !left.is_empty() && std::time::Instant::now() < end {
        std::thread::sleep(std::time::Duration::from_millis(300));
        left = processes_under(&tools);
    }
    assert!(left.is_empty(), "the leftover program was not stopped: {left:?}");
    assert!(!tools.join("late.txt").exists(), "the leftover program was not stopped");
    let _ = fs::remove_dir_all(&tools);
}

/// FIX-3 (review FIX-SOON 3): a long pull request description goes to gh on its own thread, so a
/// gh that never reads it cannot hold the call past its time limit.
#[cfg(windows)]
#[test]
fn fix3_a_long_description_cannot_hang_a_gh_that_never_reads_it() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-fix3-stdin-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let gh = tools.join("gh.cmd");
    fs::write(&gh, "@echo off\r\nping -n 8 127.0.0.1 >nul\r\n").unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let (g, t) = (gh.clone(), tools.clone());
    std::thread::spawn(move || {
        let body = "x".repeat(2 << 20);
        let _ = tx.send(gh_run_for(&g, &t, &["pr", "create"], Some(&body), std::time::Duration::from_secs(1)));
    });
    let got = rx.recv_timeout(std::time::Duration::from_secs(6)).expect("the call returns within its bound");
    assert!(got.as_ref().unwrap_err().contains("did not answer within 1 second"), "{got:?}");
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git033_merge_state_and_actions_go_through_gh_for_the_pull_requests_own_repository() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-git033-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let answer = r#"{"data":{"repository":{"mergeCommitAllowed":false,"squashMergeAllowed":true,"rebaseMergeAllowed":false,"autoMergeAllowed":true,"pullRequest":{"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":null,"isInMergeQueue":false,"isMergeQueueEnabled":false,"autoMergeRequest":{"mergeMethod":"SQUASH"},"commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"PENDING"}}}]}}}}}"#;
    fs::write(tools.join("answer.json"), answer).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"config\" if \"%3\"==\"-h\" if not \"%4\"==\"nobody.example\" echo octo\r\nif \"%1\"==\"api\" type \"%~dp0answer.json\"\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\n[ \"$1\" = config ] && [ \"$3\" = -h ] && [ \"$4\" != nobody.example ] && echo octo\n[ \"$1\" = api ] && cat \"$(dirname \"$0\")/answer.json\"\nexit 0\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let url = "https://git.example.com/o/r/pull/42";
    let m = merge_info(&gh, &tools, url).unwrap();
    assert_eq!((m.state.as_str(), m.draft, m.mergeable.as_str(), m.merge_state.as_str()), ("OPEN", false, "MERGEABLE", "BLOCKED"));
    assert_eq!((m.review.clone(), m.checks.as_deref(), m.in_queue, m.queue_enabled), (None, Some("PENDING"), false, false));
    assert_eq!((m.auto_merge.as_deref(), m.methods.clone(), m.auto_allowed), (Some("squash"), vec!["squash".to_string()], true));
    for (action, method) in [("auto", Some("squash")), ("merge", Some("rebase")), ("disable-auto", None), ("queue", None), ("ready", None), ("close", None), ("reopen", None)] {
        merge_act(&gh, &tools, url, action, method).unwrap();
    }
    assert!(merge_act(&gh, &tools, url, "merge", None).unwrap_err().contains("merge method"));
    assert!(merge_act(&gh, &tools, url, "delete", None).is_err());
    assert!(merge_act(&gh, &tools, "https://x/o/r/issues/1", "close", None).is_err());
    let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
    // git.example.com stands in for a host gh is signed in to; each request asks gh first.
    let calls: Vec<&str> = calls.lines().map(str::trim).filter(|c| !c.starts_with("config get")).collect();
    assert!(calls[0].starts_with("api graphql --hostname git.example.com "), "{}", calls[0]);
    assert!(calls[0].contains("owner=o") && calls[0].contains("name=r") && calls[0].contains("number=42") && !calls[0].contains("--repo"), "{}", calls[0]);
    // FIX-2: owner and name go as raw strings, never as -F (which reads an @value from a file).
    let c0 = calls[0].replace('"', "");
    assert!(c0.contains("-f owner=o") && c0.contains("-f name=r") && c0.contains("-F number=42") && !c0.contains("-F owner=") && !c0.contains("-F name="), "{c0}");
    let rest: Vec<String> = calls[1..].iter().map(|c| c.to_string()).collect();
    assert_eq!(
        rest,
        [
            format!("pr merge {url} --auto --squash"),
            format!("pr merge {url} --rebase"),
            format!("pr merge {url} --disable-auto"),
            format!("pr merge {url}"),
            format!("pr ready {url}"),
            format!("pr close {url}"),
            format!("pr reopen {url}"),
        ]
    );
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git028_the_github_budget_reads_rest_search_and_graphql_from_gh() {
    let tools = std::env::temp_dir().join(format!("kolux-scm-git028-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tools);
    fs::create_dir_all(&tools).unwrap();
    let answer = r#"{"resources":{"core":{"limit":5000,"used":20,"remaining":4980,"reset":1760000000},"search":{"limit":30,"used":30,"remaining":0,"reset":1760000060},"graphql":{"limit":5000,"used":1,"remaining":4999,"reset":1760003600},"code_search":{"limit":10,"remaining":10,"reset":1}},"rate":{"limit":5000}}"#;
    fs::write(tools.join("answer.json"), answer).unwrap();
    let gh = if cfg!(windows) {
        let f = tools.join("gh.cmd");
        fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\ntype \"%~dp0answer.json\"\r\n").unwrap();
        f
    } else {
        let f = tools.join("gh");
        fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncat \"$(dirname \"$0\")/answer.json\"\n").unwrap();
        quiet("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
        f
    };
    let b = gh_budget(&gh).unwrap();
    let rows: Vec<(&str, u64, u64, u64)> = b.iter().map(|x| (x.name.as_str(), x.limit, x.remaining, x.reset)).collect();
    assert_eq!(rows, [("REST", 5000, 4980, 1760000000), ("Search", 30, 0, 1760000060), ("GraphQL", 5000, 4999, 1760003600)]);
    assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().trim(), "api rate_limit");
    // A budget gh leaves out is left out, not shown as zero.
    fs::write(tools.join("answer.json"), r#"{"resources":{"core":{"limit":60,"remaining":59,"reset":5}}}"#).unwrap();
    assert_eq!(gh_budget(&gh).unwrap().len(), 1);
    let _ = fs::remove_dir_all(&tools);
}

#[test]
fn git003_discard_deletes_new_files_restores_deleted_ones_and_never_follows_a_link_out() {
    let dir = temp_repo("discard-paths");
    run(&["config", "core.symlinks", "true"], Some(&dir)).unwrap();
    let target = std::env::temp_dir().join(format!("kolux-scm-target-{}", std::process::id()));
    fs::write(&target, "keep me\n").unwrap();
    let link = |name: &str, to: &Path| {
        #[cfg(unix)]
        std::os::unix::fs::symlink(to, dir.join(name)).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(to, dir.join(name)).unwrap();
    };
    commit_file(&dir, "gone.txt", "g\n");
    commit_file(&dir, "edit.txt", "e\n");
    commit_file(&dir, "old.txt", "o\n");
    link("tracked-link", Path::new("README.md"));
    run(&["add", "tracked-link"], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "link"], Some(&dir)).unwrap();

    fs::remove_file(dir.join("gone.txt")).unwrap();
    fs::write(dir.join("edit.txt"), "changed\n").unwrap();
    fs::write(dir.join("new.txt"), "n\n").unwrap();
    fs::write(dir.join("added.txt"), "a\n").unwrap();
    run(&["add", "added.txt"], Some(&dir)).unwrap();
    run(&["mv", "old.txt", "moved.txt"], Some(&dir)).unwrap();
    // The committed link re-aimed outside the repository, and an untracked link and an
    // untracked folder holding a link, all pointing at the outside file.
    fs::remove_file(dir.join("tracked-link")).unwrap();
    link("tracked-link", &target);
    link("loose-link", &target);
    fs::create_dir(dir.join("box")).unwrap();
    link("box/inner-link", &target);
    let st = status(&dir).unwrap();
    assert_eq!(paths(&st.untracked), ["box/inner-link", "loose-link", "new.txt"]);
    assert_eq!(paths(&st.staged), ["added.txt", "moved.txt"]);
    assert_eq!(paths(&st.changed), ["edit.txt", "gone.txt", "tracked-link"]);

    assert!(discard_paths(&dir, &["../outside.txt".to_string()]).unwrap_err().contains("outside"));
    let all: Vec<String> = ["gone.txt", "edit.txt", "new.txt", "added.txt", "moved.txt", "tracked-link", "loose-link", "box/inner-link"].iter().map(|s| s.to_string()).collect();
    discard_paths(&dir, &all).unwrap();
    assert_eq!(fs::read_to_string(dir.join("gone.txt")).unwrap(), "g\n", "a deleted file comes back from the last commit");
    assert_eq!(fs::read_to_string(dir.join("edit.txt")).unwrap(), "e\n", "a modified file loses its edits");
    assert_eq!(fs::read_to_string(dir.join("old.txt")).unwrap(), "o\n", "a rename is undone");
    for new in ["new.txt", "added.txt", "moved.txt", "loose-link", "box/inner-link"] {
        assert!(fs::symlink_metadata(dir.join(new)).is_err(), "{new} is removed for good");
    }
    assert_eq!(fs::read_link(dir.join("tracked-link")).unwrap(), Path::new("README.md"), "the link is rewritten as the commit had it");
    assert_eq!(fs::read_to_string(&target).unwrap(), "keep me\n", "no link's target is ever touched");
    let st = status(&dir).unwrap();
    assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty(), "{st:?}");
    let _ = fs::remove_file(&target);
    let _ = fs::remove_dir_all(&dir);
}

/// B-09 (wave 2026-11-15): the section-free discard sends an untracked row through the same
/// `git clean -f -d` as the untracked section, so a nested repository (with its history) and an
/// ignored file in an untracked folder survive; a plain untracked file still goes.
#[test]
fn b09_discard_without_a_section_leaves_a_nested_repo_and_ignored_files_alone() {
    let dir = temp_repo("b09-nested");
    fs::write(dir.join(".gitignore"), "*.env\n").unwrap();
    run(&["add", ".gitignore"], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "ignore"], Some(&dir)).unwrap();
    let inner = dir.join("box").join("inner");
    fs::create_dir_all(&inner).unwrap();
    run(&["init", "-q", "-b", "main"], Some(&inner)).unwrap();
    fs::write(inner.join("work.txt"), "unpushed\n").unwrap();
    run(&["add", "work.txt"], Some(&inner)).unwrap();
    run(&["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "inner"], Some(&inner)).unwrap();
    fs::write(dir.join("box").join("secret.env"), "KEY=1\n").unwrap();
    fs::write(dir.join("box").join("plain.txt"), "p\n").unwrap();
    let st = status(&dir).unwrap();
    let rows: Vec<String> = st.untracked.iter().map(|c| c.path.clone()).collect();
    assert_eq!(rows, ["box/inner/", "box/plain.txt"], "the nested repo is one row; the ignored file is not listed");
    let said = discard_paths(&dir, &rows).expect_err("R-06: the kept repository is named");
    assert_eq!(said, "box/inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.");
    assert!(inner.join(".git").is_dir(), "the nested repository keeps its history");
    assert_eq!(fs::read_to_string(inner.join("work.txt")).unwrap(), "unpushed\n");
    assert_eq!(fs::read_to_string(dir.join("box").join("secret.env")).unwrap(), "KEY=1\n", "an ignored file is never touched");
    assert!(!dir.join("box").join("plain.txt").exists(), "a plain untracked file is removed");
    // R-06: the live route (the untracked section) says the same and still cleans the other rows.
    fs::write(dir.join("box").join("again.txt"), "a").unwrap();
    let said = discard(&dir, "untracked", &["box/inner/".to_string(), "box/again.txt".to_string()]).expect_err("named");
    assert!(said.starts_with("box/inner is its own Git repository"), "{said}");
    assert!(inner.join(".git").is_dir() && !dir.join("box").join("again.txt").exists());
    let _ = fs::remove_dir_all(&dir);
}

/// An outer repository with a nested one (one commit) staged in it by `git add inner`.
fn staged_inner_repo(name: &str) -> (PathBuf, PathBuf) {
    let dir = temp_repo(name);
    let inner = dir.join("inner");
    fs::create_dir_all(&inner).unwrap();
    plain(&["init", "-q", "-b", "main"], &inner);
    fs::write(inner.join("work.txt"), "unpushed\n").unwrap();
    plain(&["add", "work.txt"], &inner);
    plain(&["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "inner"], &inner);
    plain(&["add", "inner"], &dir);
    assert_eq!(paths(&status(&dir).unwrap().staged), ["inner"], "the nested repository is staged");
    (dir, inner)
}

/// N-01: a staged nested repository is unstaged and kept by the section-free discard, never
/// deleted with its history.
#[test]
fn n01_discard_paths_keeps_a_staged_nested_repo() {
    let (dir, inner) = staged_inner_repo("n01-staged-inner");
    let said = discard_paths(&dir, &["inner".to_string()]).expect_err("the kept repository is named");
    assert_eq!(said, "inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.");
    assert!(inner.join(".git").is_dir(), "the nested repository keeps its history");
    assert_eq!(fs::read_to_string(inner.join("work.txt")).unwrap(), "unpushed\n");
    assert!(status(&dir).unwrap().staged.is_empty(), "inner is no longer staged");
    let _ = fs::remove_dir_all(&dir);
}

/// N-01, the live route: the Changes tab's staged-section discard leaves the nested repository too.
#[test]
fn n01_staged_section_discard_keeps_a_nested_repo() {
    let (dir, inner) = staged_inner_repo("n01-staged-section");
    let _ = discard(&dir, "staged", &["inner".to_string()]);
    assert!(inner.join(".git").is_dir(), "the nested repository keeps its history");
    assert_eq!(fs::read_to_string(inner.join("work.txt")).unwrap(), "unpushed\n");
    let _ = fs::remove_dir_all(&dir);
}

/// N-02: one nested repository in the pick does not stop a staged new file from being removed.
#[test]
fn n02_a_nested_repo_in_the_pick_does_not_stop_the_other_rows() {
    let dir = temp_repo("n02-mixed");
    let inner = dir.join("inner");
    fs::create_dir_all(&inner).unwrap();
    plain(&["init", "-q", "-b", "main"], &inner);
    fs::write(inner.join("work.txt"), "unpushed\n").unwrap();
    fs::write(dir.join("added.txt"), "a\n").unwrap();
    plain(&["add", "added.txt"], &dir);
    let said = discard_paths(&dir, &["inner/".to_string(), "added.txt".to_string()]).expect_err("the kept repository is named");
    assert_eq!(said, "inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.");
    assert!(!dir.join("added.txt").exists(), "the staged new file is removed");
    assert!(inner.join(".git").is_dir() && inner.join("work.txt").exists(), "the nested repository is whole");
    let _ = fs::remove_dir_all(&dir);
}

/// F-02 set-up: committed `foo` and `bar.txt`; `foo` deleted (with `git rm` when `staged`) and a
/// folder with one file put in its place, its own repository when `nested`; `bar.txt` changed
/// (and staged when `staged`), the second row of the pick.
fn folder_in_a_files_place(name: &str, nested: bool, staged: bool) -> PathBuf {
    let dir = temp_repo(name);
    commit_file(&dir, "foo", "f\n");
    commit_file(&dir, "bar.txt", "b\n");
    if staged {
        plain(&["rm", "-q", "foo"], &dir);
    } else {
        fs::remove_file(dir.join("foo")).unwrap();
    }
    fs::create_dir(dir.join("foo")).unwrap();
    if nested {
        plain(&["init", "-q", "-b", "main"], &dir.join("foo"));
    }
    fs::write(dir.join("foo").join("work.txt"), "unpushed\n").unwrap();
    fs::write(dir.join("bar.txt"), "changed\n").unwrap();
    if staged {
        plain(&["add", "bar.txt"], &dir);
    }
    dir
}

/// F-02: a folder that took a tracked file's place is never removed by Discard, on any route:
/// the changed and staged sections and the section-free discard. The row is left as it was and
/// named; the other row of the same pick is still put back.
#[test]
fn f02_discard_never_removes_a_folder_that_took_a_tracked_files_place() {
    let said_foo = "foo is now a folder, so Kolux leaves it. Remove or move the folder by hand, then discard again.";
    for nested in [true, false] {
        for route in ["changed", "staged", "paths-changed", "paths-staged"] {
            let staged = route.ends_with("staged");
            let dir = folder_in_a_files_place(&format!("f02-{route}-{nested}"), nested, staged);
            let rows = vec!["foo".to_string(), "bar.txt".to_string()];
            let result = match route {
                "changed" | "staged" => discard(&dir, route, &rows),
                _ => discard_paths(&dir, &rows),
            };
            let what = format!("{route}, nested {nested}");
            assert_eq!(result.expect_err(&what), said_foo, "{what}");
            assert_eq!(fs::read_to_string(dir.join("foo").join("work.txt")).unwrap(), "unpushed\n", "{what}: the folder's file is kept");
            assert_eq!(dir.join("foo").join(".git").is_dir(), nested, "{what}: a nested repository keeps its history");
            assert_eq!(fs::read_to_string(dir.join("bar.txt")).unwrap(), "b\n", "{what}: the other row is put back");
            if staged {
                let st = status(&dir).unwrap();
                assert!(st.staged.iter().any(|c| c.path == "foo" && c.status == "D"), "{what}: foo is still a staged deletion: {st:?}");
            }
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

/// F-02: an empty folder in a tracked file's place is left to Git, which removes it and writes
/// the file back: nothing is lost with it.
#[test]
fn f02_an_empty_folder_in_a_tracked_files_place_gives_the_file_back() {
    for route in ["changed", "paths"] {
        let dir = temp_repo(&format!("f02-empty-{route}"));
        commit_file(&dir, "foo", "f\n");
        fs::remove_file(dir.join("foo")).unwrap();
        fs::create_dir(dir.join("foo")).unwrap();
        let rows = vec!["foo".to_string()];
        let result = if route == "changed" { discard(&dir, "changed", &rows) } else { discard_paths(&dir, &rows) };
        result.unwrap_or_else(|e| panic!("{route}: {e}"));
        assert_eq!(fs::read_to_string(dir.join("foo")).unwrap(), "f\n", "{route}: the file is back");
        let _ = fs::remove_dir_all(&dir);
    }
}

/// F-01: one removal that fails (a file held open by another program) does not stop the rest,
/// and every line already collected comes back with it.
#[cfg(windows)]
#[test]
fn f01_one_failed_removal_does_not_stop_the_rest_or_drop_what_was_said() {
    use std::os::windows::fs::OpenOptionsExt;
    let (dir, inner) = staged_inner_repo("f01-held");
    let older = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
    for name in ["a.txt", "b.txt", "c.txt"] {
        fs::write(dir.join(name), "new\n").unwrap();
        // Older than the index, so git never has to open the held file to compare it.
        fs::File::options().write(true).open(dir.join(name)).unwrap().set_modified(older).unwrap();
    }
    plain(&["add", "a.txt", "b.txt", "c.txt"], &dir);
    let held = fs::File::options().read(true).share_mode(0).open(dir.join("b.txt")).unwrap();
    let rows: Vec<String> = ["a.txt", "b.txt", "inner", "c.txt"].iter().map(|s| s.to_string()).collect();
    let result = discard_paths(&dir, &rows);
    drop(held);
    let said = result.expect_err("the held file and the kept repository are named");
    let lines: Vec<&str> = said.lines().collect();
    assert_eq!(lines.len(), 2, "{said}");
    assert!(lines.iter().any(|l| l.starts_with("b.txt: ")), "{said}");
    assert!(lines.contains(&"inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to."), "{said}");
    assert!(!dir.join("a.txt").exists() && !dir.join("c.txt").exists(), "the other two files are gone");
    assert!(inner.join(".git").is_dir(), "the nested repository keeps its history");
    let _ = fs::remove_dir_all(&dir);
}

/// F-03: a `submodule.recurse=true` setting does not make Discard write inside a submodule; work
/// in it that was not committed stays. The setting is the test repository's own, never global.
#[test]
fn f03_discard_never_writes_inside_a_submodule_even_when_git_is_set_to_recurse() {
    let lib = temp_repo("f03-lib");
    let top = temp_repo("f03-top");
    let lib_url = lib.to_string_lossy().replace('\\', "/");
    plain(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &lib_url, "sub"], &top);
    plain(&["commit", "-q", "-m", "add sub"], &top);
    let inner = top.join("sub");
    run(&["config", "user.email", "test@example.com"], Some(&inner)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&inner)).unwrap();
    commit_file(&inner, "x.txt", "x\n");
    plain(&["add", "sub"], &top);
    fs::write(inner.join("README.md"), "uncommitted\n").unwrap();
    plain(&["config", "submodule.recurse", "true"], &top);
    let result = discard(&top, "staged", &["sub".to_string()]);
    assert_eq!(fs::read_to_string(inner.join("README.md")).unwrap(), "uncommitted\n", "the work inside the submodule is kept");
    assert!(inner.join("x.txt").exists(), "the submodule's new commit is still checked out");
    // The row still reaches git (a submodule's folder is not kept as a file's place): it is unstaged.
    result.unwrap();
    assert!(status(&top).unwrap().staged.is_empty(), "the submodule's new commit is no longer staged");
    for d in [&lib, &top] {
        let _ = fs::remove_dir_all(d);
    }
}

/// F-04: a staged new link to a repository folder is removed as a link, not kept as "its own Git
/// repository"; the folder it points at and its `.git` are never touched.
#[test]
fn f04_a_staged_link_to_a_repository_folder_is_removed_as_a_link() {
    let dir = temp_repo("f04-link");
    run(&["config", "core.symlinks", "true"], Some(&dir)).unwrap();
    let target = temp_repo("f04-target");
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&target, dir.join("ln"));
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&target, dir.join("ln"));
    if let Err(e) = made {
        eprintln!("f04: skipped, a link could not be made here ({e})");
        for d in [&dir, &target] {
            let _ = fs::remove_dir_all(d);
        }
        return;
    }
    plain(&["add", "ln"], &dir);
    assert_eq!(paths(&status(&dir).unwrap().staged), ["ln"], "the link is staged");
    discard_paths(&dir, &["ln".to_string()]).unwrap();
    assert!(fs::symlink_metadata(dir.join("ln")).is_err(), "the link is removed");
    assert!(target.join(".git").is_dir() && target.join("README.md").exists(), "the folder it pointed at is whole");
    for d in [&dir, &target] {
        let _ = fs::remove_dir_all(d);
    }
}

/// R59-01: removes the test's junctions (the links only, never what they point at) and then its
/// folders, also when an assert fails.
#[cfg(windows)]
struct LinksThenFolders(Vec<PathBuf>, Vec<PathBuf>);

#[cfg(windows)]
impl Drop for LinksThenFolders {
    fn drop(&mut self) {
        for link in &self.0 {
            if fs::symlink_metadata(link).is_ok_and(|m| m.is_symlink()) {
                let _ = fs::remove_dir(link);
            }
        }
        for dir in &self.1 {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

/// A junction (a Windows folder link, needs no special right) at `link` pointing at `target`.
#[cfg(windows)]
fn junction(link: &Path, target: &Path) {
    let out = quiet("cmd").args(["/c", "mklink", "/J"]).arg(link).arg(target).output().unwrap();
    assert!(out.status.success(), "mklink /J: {}", String::from_utf8_lossy(&out.stderr));
    assert!(fs::symlink_metadata(link).unwrap().is_symlink(), "Rust sees the junction as a link");
}

/// A folder of the test's own, beside its repository, for a junction to point at.
fn outside_folder(name: &str) -> PathBuf {
    let out = std::env::temp_dir().join(format!("kolux-scm-{name}-out-{}", std::process::id()));
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).unwrap();
    out
}

fn by_route(dir: &Path, route: &str, rows: &[&str]) -> Result<(), String> {
    let rows: Vec<String> = rows.iter().map(|s| s.to_string()).collect();
    match route {
        "paths" => discard_paths(dir, &rows),
        _ => discard(dir, route, &rows),
    }
}

/// R59-01: a junction where a tracked file was is removed as a link before Git writes the file
/// back; the folder it points at keeps its files, on every route. F94-02: on the staged route the
/// row is a staged deletion (the index no longer holds it), so the junction is left (rule D).
/// R70-07: the "paths" route pins behaviour (it passed before R59 too); it is not a regression test.
#[cfg(windows)]
#[test]
fn r59_a_junction_in_a_tracked_files_place_is_removed_as_a_link_and_its_target_kept() {
    for route in ["changed", "staged", "paths"] {
        let dir = temp_repo(&format!("r59a-{route}"));
        let out = outside_folder(&format!("r59a-{route}"));
        let _clean = LinksThenFolders(vec![dir.join("foo")], vec![dir.clone(), out.clone()]);
        fs::write(out.join("p.txt"), "keep\n").unwrap();
        commit_file(&dir, "foo", "f\n");
        if route == "staged" {
            plain(&["rm", "--cached", "-q", "foo"], &dir);
        }
        fs::remove_file(dir.join("foo")).unwrap();
        junction(&dir.join("foo"), &out);
        let result = by_route(&dir, route, &["foo"]);
        assert_eq!(fs::read_to_string(out.join("p.txt")).ok().as_deref(), Some("keep\n"), "{route}: the junction's target keeps its file");
        if route == "staged" {
            // F94-02 (rule D): the index no longer holds foo, so the junction is not the row's.
            assert_eq!(result, Err("A link stands where foo would come back, so Kolux leaves foo as it is. Remove the link by hand, then discard again.".to_string()));
            assert!(fs::symlink_metadata(dir.join("foo")).is_ok_and(|m| m.is_symlink()), "staged: the junction stays");
            continue;
        }
        result.unwrap_or_else(|e| panic!("{route}: {e}"));
        assert_eq!(fs::read_to_string(dir.join("foo")).unwrap(), "f\n", "{route}: foo is the committed file again");
    }
}

/// R59-01: a junction where a tracked folder was: nothing is written or deleted through it, on
/// every route, and the row is named.
#[cfg(windows)]
#[test]
fn r59_nothing_is_written_or_deleted_through_a_junction_at_a_parent_folder() {
    for route in ["changed", "staged", "paths", "untracked", "paths-untracked"] {
        let dir = temp_repo(&format!("r59b-{route}"));
        let out = outside_folder(&format!("r59b-{route}"));
        let _clean = LinksThenFolders(vec![dir.join("d")], vec![dir.clone(), out.clone()]);
        fs::create_dir(dir.join("d")).unwrap();
        commit_file(&dir, "d/f.txt", "f\n");
        if route == "staged" {
            plain(&["rm", "--cached", "-q", "d/f.txt"], &dir);
        }
        fs::remove_dir_all(dir.join("d")).unwrap();
        fs::write(out.join("f.txt"), "mine\n").unwrap();
        fs::write(out.join("p.txt"), "keep\n").unwrap();
        junction(&dir.join("d"), &out);
        let row = if route.ends_with("untracked") { "d/p.txt" } else { "d/f.txt" };
        let result = by_route(&dir, route.trim_end_matches("-untracked"), &[row]);
        assert_eq!(fs::read_to_string(out.join("f.txt")).ok().as_deref(), Some("mine\n"), "{route}: the target's f.txt is not written");
        assert_eq!(fs::read_to_string(out.join("p.txt")).ok().as_deref(), Some("keep\n"), "{route}: the target's p.txt is not deleted");
        assert_eq!(result.expect_err(route), format!("d is a link, so Kolux leaves {row}. Remove the link by hand, then discard again."), "{route}");
    }
}

/// R59-02: a plain file where a tracked folder was is never deleted to make room for the folder.
#[test]
fn r59_a_file_where_a_tracked_folder_was_is_never_deleted() {
    for route in ["changed", "staged", "paths"] {
        let dir = temp_repo(&format!("r59c-{route}"));
        fs::create_dir(dir.join("d")).unwrap();
        commit_file(&dir, "d/f.txt", "f\n");
        if route == "staged" {
            plain(&["rm", "--cached", "-q", "d/f.txt"], &dir);
        }
        fs::remove_dir_all(dir.join("d")).unwrap();
        fs::write(dir.join("d"), "my notes\n").unwrap();
        let result = by_route(&dir, route, &["d/f.txt"]);
        let notes = fs::read_to_string(dir.join("d")).ok();
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(notes.as_deref(), Some("my notes\n"), "{route}: the file d is kept");
        assert_eq!(result.expect_err(route), "d is now a file, so Kolux leaves d/f.txt. Remove or move that file by hand, then discard again.", "{route}");
    }
}

/// R59-01: a worktree reached through a junction works as before: only folders below the
/// worktree's own root are looked at.
#[cfg(windows)]
#[test]
fn r59_a_worktree_reached_through_a_junction_is_discarded_as_before() {
    let outer = outside_folder("r59d");
    let repo = temp_repo("r59d");
    fs::create_dir(outer.join("real")).unwrap();
    fs::rename(&repo, outer.join("real").join("repo")).unwrap();
    let _clean = LinksThenFolders(vec![outer.join("via")], vec![outer.clone()]);
    junction(&outer.join("via"), &outer.join("real"));
    let worktree = outer.join("via").join("repo");
    fs::write(worktree.join("README.md"), "changed\n").unwrap();
    for route in ["changed", "paths"] {
        fs::write(worktree.join("README.md"), "changed\n").unwrap();
        by_route(&worktree, route, &["README.md"]).unwrap_or_else(|e| panic!("{route}: {e}"));
        assert_eq!(fs::read_to_string(worktree.join("README.md")).unwrap(), "hello\n", "{route}");
    }
}

/// R59-01/R59-02, pinned: a row under real folders is discarded, and a row whose whole folder
/// tree was deleted comes back; one row left among others leaves only its own sentence.
#[test]
fn r59_rows_under_real_or_missing_folders_still_go_and_a_left_row_does_not_stop_the_rest() {
    for route in ["changed", "paths"] {
        let dir = temp_repo(&format!("r59e-{route}"));
        fs::create_dir_all(dir.join("a").join("b")).unwrap();
        fs::create_dir_all(dir.join("x").join("y")).unwrap();
        fs::create_dir(dir.join("d")).unwrap();
        commit_file(&dir, "a/b/c.txt", "c\n");
        commit_file(&dir, "x/y/z.txt", "z\n");
        commit_file(&dir, "d/f.txt", "f\n");
        fs::write(dir.join("a").join("b").join("c.txt"), "changed\n").unwrap();
        fs::remove_dir_all(dir.join("x")).unwrap();
        fs::remove_dir_all(dir.join("d")).unwrap();
        fs::write(dir.join("d"), "my notes\n").unwrap();
        let ok = by_route(&dir, route, &["a/b/c.txt", "x/y/z.txt"]);
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let mixed = by_route(&dir, route, &["d/f.txt", "README.md"]);
        let read = |p: &str| fs::read_to_string(dir.join(p)).ok();
        let (c, z, d, readme) = (read("a/b/c.txt"), read("x/y/z.txt"), read("d"), read("README.md"));
        let _ = fs::remove_dir_all(&dir);
        ok.unwrap_or_else(|e| panic!("{route}: {e}"));
        assert_eq!((c.as_deref(), z.as_deref()), (Some("c\n"), Some("z\n")), "{route}: both rows are put back");
        assert_eq!(mixed.expect_err(route), "d is now a file, so Kolux leaves d/f.txt. Remove or move that file by hand, then discard again.", "{route}");
        assert_eq!((d.as_deref(), readme.as_deref()), (Some("my notes\n"), Some("hello\n")), "{route}: d is kept, the other row is put back");
    }
}

/// R59-04: an untracked junction is removed as a link, also one that points at a repository
/// (git clean keeps that one without a word); the folder it points at is whole.
/// R70-07: ("untracked", false) pins behaviour (git clean removed only the junction before R59 too).
#[cfg(windows)]
#[test]
fn r59_an_untracked_junction_is_removed_and_its_target_kept() {
    // A junction to a plain folder is listed by its files (`ln/p.txt`), so through `discard_paths`
    // its rows are left by the link check (see the parent-folder test); only the repository kind
    // is listed as `ln/`.
    for (route, repo) in [("untracked", true), ("untracked", false), ("paths", true)] {
        let name = format!("r59g-{route}-{repo}");
        let dir = temp_repo(&name);
        let out = outside_folder(&name);
        let _clean = LinksThenFolders(vec![dir.join("ln")], vec![dir.clone(), out.clone()]);
        fs::write(out.join("p.txt"), "keep\n").unwrap();
        if repo {
            plain(&["init", "-q"], &out);
        }
        junction(&dir.join("ln"), &out);
        let row = if route == "paths" { "ln" } else { "ln/" };
        let result = by_route(&dir, route, &[row]);
        assert!(out.join("p.txt").is_file() && out.join(".git").is_dir() == repo, "{route} {repo}: the target is whole");
        result.unwrap_or_else(|e| panic!("{route} {repo}: {e}"));
        assert!(fs::symlink_metadata(dir.join("ln")).is_err(), "{route} {repo}: the junction is gone");
    }
}

/// R59-05: in the untracked section, one chunk of git clean that fails (a file held open by
/// another program) does not stop the later chunks, and the nested-repository line still comes.
#[cfg(windows)]
#[test]
fn r59_one_failed_clean_chunk_does_not_stop_the_rest_or_drop_the_nested_line() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = temp_repo("r59h");
    let mut rows: Vec<String> = (0..120).map(|i| format!("u{i:03}.txt")).collect();
    for row in &rows {
        fs::write(dir.join(row), "new\n").unwrap();
    }
    fs::create_dir(dir.join("inner")).unwrap();
    plain(&["init", "-q"], &dir.join("inner"));
    rows.push("inner/".to_string());
    let held = fs::File::options().read(true).share_mode(0).open(dir.join("u005.txt")).unwrap();
    let result = discard(&dir, "untracked", &rows);
    drop(held);
    let (late_gone, inner_kept) = (!dir.join("u110.txt").exists(), dir.join("inner").join(".git").is_dir());
    let _ = fs::remove_dir_all(&dir);
    let said = result.expect_err("the held file and the nested repository are named");
    assert!(late_gone, "a row from the second chunk is cleaned: {said}");
    assert!(inner_kept, "the nested repository keeps its history");
    assert!(said.lines().any(|l| l.contains("u005.txt")), "git's line about the held file: {said}");
    assert!(said.lines().any(|l| l == "inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to."), "{said}");
}

/// R59-07: when the last commit cannot be read, a folder in a tracked file's place is kept; a
/// repository with no commit yet is not such a failure, so a nested repository there is still
/// named as one (not as "now a folder").
#[test]
fn r59_a_failed_read_of_the_last_commit_keeps_the_folder_but_no_commit_yet_does_not() {
    let dir = temp_repo("r59i");
    commit_file(&dir, "foo", "f\n");
    plain(&["rm", "--cached", "-q", "foo"], &dir);
    fs::remove_file(dir.join("foo")).unwrap();
    fs::create_dir(dir.join("foo")).unwrap();
    fs::write(dir.join("foo").join("work.txt"), "unpushed\n").unwrap();
    // The last commit's tree object is taken away, so `ls-tree HEAD` fails while HEAD still names a commit.
    let tree = run(&["rev-parse", "HEAD^{tree}"], Some(&dir)).unwrap();
    let object = dir.join(".git").join("objects").join(&tree[..2]).join(&tree[2..]);
    let mut perms = fs::metadata(&object).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    fs::set_permissions(&object, perms).unwrap();
    fs::remove_file(&object).unwrap();
    let kept = folder_in_place(&dir, "foo");
    let _ = fs::remove_dir_all(&dir);
    assert!(kept, "a failed read of the last commit keeps the folder");

    let fresh = std::env::temp_dir().join(format!("kolux-scm-r59i-fresh-{}", std::process::id()));
    let _ = fs::remove_dir_all(&fresh);
    fs::create_dir_all(fresh.join("inner")).unwrap();
    plain(&["init", "-q"], &fresh);
    plain(&["init", "-q"], &fresh.join("inner"));
    fs::write(fresh.join("inner").join("a.txt"), "a\n").unwrap();
    let result = discard_paths(&fresh, &["inner/".to_string()]);
    let _ = fs::remove_dir_all(&fresh);
    assert_eq!(result.expect_err("named"), "inner is its own Git repository, so Kolux leaves it. Delete it by hand if you mean to.");
}

/// R59-06: when one half of a staged rename is left, the other half is left too. R70-03: and
/// gets its own line saying why.
#[test]
fn r59_a_staged_rename_is_left_whole_when_one_half_is_left() {
    let dir = temp_repo("r59j");
    commit_file(&dir, "a.txt", "a\n");
    plain(&["mv", "a.txt", "b.txt"], &dir);
    fs::create_dir(dir.join("a.txt")).unwrap();
    fs::write(dir.join("a.txt").join("x.txt"), "x\n").unwrap();
    let result = discard(&dir, "staged", &["a.txt".to_string(), "b.txt".to_string()]);
    let b = fs::read_to_string(dir.join("b.txt")).ok();
    let st = status(&dir).unwrap();
    let _ = fs::remove_dir_all(&dir);
    assert_eq!(result.expect_err("named"), "a.txt is now a folder, so Kolux leaves it. Remove or move the folder by hand, then discard again.\nb.txt is the other half of a rename, so Kolux leaves it too.");
    assert_eq!(b.as_deref(), Some("a\n"), "the new half is kept on disk");
    assert!(st.staged.iter().any(|c| c.path == "b.txt" && c.from.as_deref() == Some("a.txt")), "the rename is still staged: {st:?}");
}

/// R70-02: a last commit that cannot be read for a reason other than "no commit yet" (here a
/// broken list of branch names, so `rev-parse` fails with code 128) keeps the folder.
#[test]
fn r70_a_broken_branch_list_is_not_read_as_no_commit_yet() {
    let dir = temp_repo("r70f");
    commit_file(&dir, "foo", "f\n");
    plain(&["rm", "--cached", "-q", "foo"], &dir);
    fs::remove_file(dir.join("foo")).unwrap();
    fs::create_dir(dir.join("foo")).unwrap();
    fs::write(dir.join("foo").join("work.txt"), "unpushed\n").unwrap();
    plain(&["pack-refs", "--all"], &dir);
    let refs = dir.join(".git").join("packed-refs");
    fs::write(&refs, fs::read_to_string(&refs).unwrap() + "garbage line\n").unwrap();
    let kept = folder_in_place(&dir, "foo");
    let _ = fs::remove_dir_all(&dir);
    assert!(kept, "a broken branch list is not \"no commit yet\": the folder is kept");
}

/// R70-07: a link two levels up (a real folder `a` holding a junction `b`) is found like one
/// right above the row, on every route. Coverage: the walk already went this far before job 77.
#[cfg(windows)]
#[test]
fn r70_a_junction_two_levels_up_is_never_written_through() {
    for route in ["changed", "untracked", "paths", "paths-untracked"] {
        let name = format!("r70b-{route}");
        let dir = temp_repo(&name);
        let out = outside_folder(&name);
        let _clean = LinksThenFolders(vec![dir.join("a").join("b")], vec![dir.clone(), out.clone()]);
        fs::create_dir_all(dir.join("a").join("b")).unwrap();
        commit_file(&dir, "a/b/f.txt", "f\n");
        fs::remove_dir_all(dir.join("a").join("b")).unwrap();
        fs::write(out.join("f.txt"), "mine\n").unwrap();
        fs::write(out.join("p.txt"), "keep\n").unwrap();
        junction(&dir.join("a").join("b"), &out);
        let row = if route.ends_with("untracked") { "a/b/p.txt" } else { "a/b/f.txt" };
        let result = by_route(&dir, route.trim_end_matches("-untracked"), &[row]);
        assert_eq!(fs::read_to_string(out.join("f.txt")).ok().as_deref(), Some("mine\n"), "{route}: the target's f.txt is not written");
        assert_eq!(fs::read_to_string(out.join("p.txt")).ok().as_deref(), Some("keep\n"), "{route}: the target's p.txt is not deleted");
        assert_eq!(result.expect_err(route), format!("a/b is a link, so Kolux leaves {row}. Remove the link by hand, then discard again."), "{route}");
    }
}

/// R70-05: a row whose kind cannot be read (here a name Windows refuses to look up) is left and
/// named, never handed to Git as "not a link".
#[cfg(windows)]
#[test]
fn r70_a_row_that_cannot_be_read_is_left_not_handed_to_git() {
    for route in ["changed", "staged", "untracked", "paths"] {
        let dir = temp_repo(&format!("r70e-{route}"));
        let result = by_route(&dir, route, &["x?y.txt"]);
        let _ = fs::remove_dir_all(&dir);
        // R86-04: a failure, so it does not hold the words of a row left on purpose.
        assert_eq!(result.expect_err(route), "x?y.txt could not be read. Kolux did not change it.", "{route}");
    }
}

/// R70-01: on Windows a row spelled with `\` is checked like the same row spelled with `/`:
/// nothing is written or deleted through a junction above it, and it is left with the same line.
#[cfg(windows)]
#[test]
fn r70_a_row_spelled_with_backslashes_is_checked_like_one_with_slashes() {
    for route in ["changed", "staged", "paths", "untracked", "paths-untracked"] {
        let name = format!("r70a-{route}");
        let dir = temp_repo(&name);
        let out = outside_folder(&name);
        let _clean = LinksThenFolders(vec![dir.join("d")], vec![dir.clone(), out.clone()]);
        fs::create_dir(dir.join("d")).unwrap();
        commit_file(&dir, "d/f.txt", "f\n");
        if route == "staged" {
            plain(&["rm", "--cached", "-q", "d/f.txt"], &dir);
        }
        fs::remove_dir_all(dir.join("d")).unwrap();
        fs::write(out.join("f.txt"), "mine\n").unwrap();
        fs::write(out.join("p.txt"), "keep\n").unwrap();
        junction(&dir.join("d"), &out);
        let file = if route.ends_with("untracked") { "p.txt" } else { "f.txt" };
        let route = route.trim_end_matches("-untracked");
        let back = by_route(&dir, route, &[&format!("d\\{file}")]);
        assert_eq!(fs::read_to_string(out.join("f.txt")).ok().as_deref(), Some("mine\n"), "{route} {file}: the target's f.txt is not written");
        assert_eq!(fs::read_to_string(out.join("p.txt")).ok().as_deref(), Some("keep\n"), "{route} {file}: the target's p.txt is not deleted");
        let slash = by_route(&dir, route, &[&format!("d/{file}")]);
        assert_eq!(back.expect_err(route), slash.expect_err(route), "{route} {file}: the same line as the / spelling");
    }
}

#[test]
fn paths_are_sorted_into_tests_generated_or_source() {
    for p in ["tests/a.rs", "src/__tests__/x.ts", "a/spec/b.rb", "src/x.test.tsx", "src/x.spec.js", "pkg/x_test.go", "py/test_x.py"] {
        assert_eq!(kind(p), Kind::Tests, "{p}");
    }
    for p in ["Cargo.lock", "web/pnpm-lock.yaml", "package-lock.json", "yarn.lock", "go.sum", "a/b.min.js", "x/__snapshots__/a.snap", "src/generated/api.ts"] {
        assert_eq!(kind(p), Kind::Generated, "{p}");
    }
    for p in ["src/main.rs", "README.md", "src/contest.ts", "testing.md", "latest/x.rs"] {
        assert_eq!(kind(p), Kind::Source, "{p}");
    }
}

/// Plain git for test setup (Kolux's `run` refuses write verbs in an untrusted filter repo).
fn plain(args: &[&str], dir: &Path) {
    let mut c = std::process::Command::new("git");
    c.args(args).current_dir(dir).env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(crate::winproc::no_window());
    }
    let out = c.output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// A repository with one staged file, one modified tracked file, and then (setup done) a
/// `filter.evil.clean` in its own config applied to every file; the marker shows a filter run.
fn filter_repo(name: &str) -> (PathBuf, PathBuf) {
    let dir = temp_repo(name);
    fs::write(dir.join("changed.txt"), "one\n").unwrap();
    plain(&["add", "changed.txt"], &dir);
    plain(&["commit", "-q", "-m", "second"], &dir);
    fs::write(dir.join("changed.txt"), "two\n").unwrap();
    fs::write(dir.join("staged.txt"), "new\n").unwrap();
    plain(&["add", "staged.txt"], &dir);
    fs::write(dir.join("loose.txt"), "loose\n").unwrap();
    let marker = dir.join("filter-ran.txt");
    let line = marker.to_string_lossy().replace('\\', "/");
    let program = if cfg!(windows) { format!("cmd.exe /c echo ran >> \"{line}\" && cat") } else { format!("echo ran >> \"{line}\" && cat") };
    let mut text = fs::read_to_string(dir.join(".git").join("config")).unwrap();
    text.push_str(&format!("[filter \"evil\"]\n\tclean = {program}\n"));
    fs::write(dir.join(".git").join("config"), text).unwrap();
    fs::create_dir_all(dir.join(".git").join("info")).unwrap();
    fs::write(dir.join(".git").join("info").join("attributes"), "* filter=evil\n").unwrap();
    (dir, marker)
}

fn index_list(dir: &Path) -> String {
    let mut ls = std::process::Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        ls.creation_flags(crate::winproc::no_window()); // no console window
    }
    let out = ls.args(["ls-files", "-s"]).current_dir(dir).output().unwrap();
    String::from_utf8_lossy(&out.stdout).to_string()
}

/// Review fix 3, B1: Stage, Unstage, Discard, Commit and Pull in an untrusted folder that
/// names a clean filter each come back with the plain refusal, run nothing and change nothing.
#[test]
fn t779c_source_control_writes_in_an_untrusted_filter_repo_are_refused() {
    let (dir, marker) = filter_repo("t779c-refuse");
    let index = index_list(&dir);
    let head = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap();
    let said = |r: Result<(), String>, what: &str| {
        let why = r.expect_err(what);
        assert!(why.contains("did not run") && why.contains("Trust the folder"), "{what}: {why}");
    };
    said(stage(&dir, &["loose.txt".to_string()], true), "stage");
    said(stage(&dir, &["staged.txt".to_string()], false), "unstage");
    said(discard(&dir, "changed", &["changed.txt".to_string()]), "discard changed");
    said(discard(&dir, "staged", &["staged.txt".to_string()]), "discard staged");
    let why = commit(&dir, "x").expect_err("commit");
    assert!(why.contains("did not run") && why.contains("Trust the folder"), "commit: {why}");
    let why = remote(&dir, "pull").expect_err("pull");
    assert!(why.contains("did not run") && why.contains("Trust the folder"), "pull: {why}");
    assert!(!marker.exists(), "a clean filter ran");
    assert_eq!(index_list(&dir), index, "the index is unchanged");
    assert_eq!(run(&["rev-parse", "HEAD"], Some(&dir)).unwrap(), head, "no commit was made");
    assert_eq!(fs::read_to_string(dir.join("changed.txt")).unwrap(), "two\n", "the edit was not discarded");
    // The control: the same Stage in a trusted folder runs.
    crate::git::trust_for_test(&dir);
    stage(&dir, &["loose.txt".to_string()], true).unwrap();
    assert!(index_list(&dir).contains("loose.txt"));
    let _ = fs::remove_dir_all(&dir);
}

/// R82-01: a row spelled `./foo`, `sub//foo` or `sub/./foo` is checked as `foo` or `sub/foo`:
/// the folder with a file in it that took the tracked file's place is kept on every route, and
/// the line names the clean spelling.
#[test]
fn r82_a_dot_or_doubled_spelling_keeps_the_folder() {
    let mut wrong = Vec::new();
    for route in ["changed", "staged", "paths"] {
        let dir = temp_repo(&format!("r82a-{route}"));
        fs::create_dir(dir.join("sub")).unwrap();
        commit_file(&dir, "foo", "f\n");
        commit_file(&dir, "sub/foo", "s\n");
        if route == "staged" {
            plain(&["rm", "--cached", "-q", "foo", "sub/foo"], &dir);
        }
        for at in ["foo", "sub/foo"] {
            fs::remove_file(dir.join(at)).unwrap();
            fs::create_dir(dir.join(at)).unwrap();
            fs::write(dir.join(at).join("keep.txt"), "mine\n").unwrap();
        }
        for (row, clean) in [("./foo", "foo"), ("sub//foo", "sub/foo"), ("sub/./foo", "sub/foo")] {
            let said = by_route(&dir, route, &[row]);
            if fs::read_to_string(dir.join(clean).join("keep.txt")).ok().as_deref() != Some("mine\n") {
                wrong.push(format!("{route} {row}: {clean}/keep.txt is gone, said {said:?}"));
                let _ = fs::remove_file(dir.join(clean));
                let _ = fs::create_dir_all(dir.join(clean));
                fs::write(dir.join(clean).join("keep.txt"), "mine\n").unwrap();
            } else if said != Err(now_folder(clean)) {
                wrong.push(format!("{route} {row}: said {said:?}"));
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R82-01: what the clean-up makes of a rooted, climbing or prefixed row, and that each is still
/// refused on every Discard route with nothing changed.
#[test]
fn r82_a_rooted_or_climbing_row_is_still_refused() {
    let dir = temp_repo("r82b");
    fs::create_dir(dir.join("d")).unwrap();
    commit_file(&dir, "d/f", "f\n");
    fs::write(dir.join("d").join("f"), "changed\n").unwrap();
    fs::write(dir.join("u.txt"), "u\n").unwrap();
    let mut bad = vec![("/x", "/x"), ("d/../d/f", "d/../d/f"), ("./../x", "../x")];
    if cfg!(windows) {
        bad.extend([("C:d\\f", "C:d/f"), ("d:stream", "d:stream"), ("\\\\?\\x", "//?/x"), ("\\\\.\\x", "//./x"), (".\\..\\x", "../x")]);
    }
    let mut wrong = Vec::new();
    for (row, clean) in bad {
        let turned = one_spelling(&[row.to_string()]);
        if turned != [clean.to_string()] {
            wrong.push(format!("{row}: turned into {turned:?}"));
        }
        for route in ["changed", "staged", "untracked", "paths"] {
            let said = by_route(&dir, route, &[row]);
            if said != Err(format!("{clean} is outside this workspace")) {
                wrong.push(format!("{route} {row}: said {said:?}"));
            }
        }
    }
    let (f, u) = (fs::read_to_string(dir.join("d").join("f")).ok(), dir.join("u.txt").exists());
    let _ = fs::remove_dir_all(&dir);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    assert_eq!(f.as_deref(), Some("changed\n"), "the change to d/f is kept");
    assert!(u, "the untracked u.txt is kept");
}

/// R82-02: a row of `.`, `./` or `.\` names the whole repository: every route refuses the whole
/// call before Git runs, and nothing changes.
#[test]
fn r82_a_dot_row_is_refused_whole() {
    let dir = temp_repo("r82c");
    commit_file(&dir, "s.txt", "s\n");
    fs::write(dir.join("s.txt"), "staged\n").unwrap();
    plain(&["add", "s.txt"], &dir);
    fs::write(dir.join("u.txt"), "u\n").unwrap();
    let mut rows = vec![".", "./"];
    if cfg!(windows) {
        rows.push(".\\");
    }
    let mut wrong = Vec::new();
    for row in rows {
        for route in ["changed", "staged", "untracked", "paths"] {
            let said = by_route(&dir, route, &[row, "s.txt"]);
            if said != Err("Kolux does not discard a whole folder at once. Pick the files instead.".to_string()) {
                wrong.push(format!("{route} {row:?}: said {said:?}"));
            }
        }
    }
    let staged = run(&["diff", "--cached", "--name-only"], Some(&dir));
    let (s, u) = (fs::read_to_string(dir.join("s.txt")).ok(), dir.join("u.txt").exists());
    let _ = fs::remove_dir_all(&dir);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    assert_eq!(staged.as_deref(), Ok("s.txt"), "the staged change is still staged");
    assert_eq!(s.as_deref(), Some("staged\n"));
    assert!(u, "the untracked u.txt is kept");
}

/// R82-02: a row that names a folder of tracked files (a folder in the last commit, or files staged
/// below it) is left on the changed, staged and paths routes with one line, and nothing is written
/// there: an untracked file now in the folder's place stays, a deleted folder is not brought back.
/// The other rows in the call still go.
#[test]
fn r82_a_folder_row_is_never_written_through() {
    let line = |p: &str| format!("{p} is a folder, so Kolux leaves it. Discard the files inside it instead.");
    let mut wrong = Vec::new();
    for route in ["changed", "staged", "paths", "untracked"] {
        let dir = temp_repo(&format!("r82d-{route}"));
        commit_file(&dir, "plain.txt", "p\n");
        for f in ["kept", "gone"] {
            fs::create_dir(dir.join(f)).unwrap();
            fs::write(dir.join(f).join("a.txt"), "a\n").unwrap();
        }
        plain(&["add", "."], &dir);
        plain(&["commit", "-q", "-m", "folders"], &dir);
        fs::write(dir.join("plain.txt"), "changed\n").unwrap();
        if route == "staged" {
            plain(&["add", "plain.txt"], &dir);
        }
        fs::remove_dir_all(dir.join("kept")).unwrap();
        fs::write(dir.join("kept"), "mine\n").unwrap();
        fs::remove_dir_all(dir.join("gone")).unwrap();
        // R86-02: on the paths and untracked routes `kept` is listed as an untracked FILE, so it is
        // deleted as the file it is, with no line; on the changed and staged routes it is left.
        let as_file = route == "paths" || route == "untracked";
        let rows: &[&str] = if route == "untracked" { &["kept"] } else { &["kept", "gone", "plain.txt"] };
        let said = by_route(&dir, route, rows);
        let want: Vec<String> = rows.iter().filter(|r| **r != "plain.txt" && !(as_file && **r == "kept")).map(|r| line(r)).collect();
        if said != if want.is_empty() { Ok(()) } else { Err(want.join("\n")) } {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if !as_file && fs::read_to_string(dir.join("kept")).ok().as_deref() != Some("mine\n") {
            wrong.push(format!("{route}: the untracked file kept is gone (a folder there now: {})", dir.join("kept").is_dir()));
        }
        if as_file && dir.join("kept").exists() {
            wrong.push(format!("{route}: the untracked file kept is still there"));
        }
        if dir.join("gone").exists() {
            wrong.push(format!("{route}: gone was brought back"));
        }
        if route != "untracked" && fs::read_to_string(dir.join("plain.txt")).ok().as_deref() != Some("p\n") {
            wrong.push(format!("{route}: plain.txt was not discarded"));
        }
        let _ = fs::remove_dir_all(&dir);
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R82-02: a folder row whose tracked folder below was replaced by a junction to a folder outside
/// the repository: Git is never asked to write there, on any route; nor through a `.` row.
#[cfg(windows)]
#[test]
fn r82_a_folder_row_through_a_junction_is_never_written_through() {
    let mut wrong = Vec::new();
    for route in ["changed", "staged", "paths"] {
        let dir = temp_repo(&format!("r82e-{route}"));
        let out = outside_folder(&format!("r82e-{route}"));
        let _clean = LinksThenFolders(vec![dir.join("sub").join("d")], vec![dir.clone(), out.clone()]);
        fs::create_dir_all(dir.join("sub").join("d")).unwrap();
        commit_file(&dir, "sub/d/f.txt", "orig\n");
        fs::remove_dir_all(dir.join("sub").join("d")).unwrap();
        fs::write(out.join("f.txt"), "mine\n").unwrap();
        junction(&dir.join("sub").join("d"), &out);
        for (row, want) in [("sub", "sub is a folder, so Kolux leaves it. Discard the files inside it instead."), (".", "Kolux does not discard a whole folder at once. Pick the files instead.")] {
            let said = by_route(&dir, route, &[row]);
            if said != Err(want.to_string()) {
                wrong.push(format!("{route} {row}: said {said:?}"));
            }
            let now = fs::read_to_string(out.join("f.txt")).ok();
            if now.as_deref() != Some("mine\n") {
                wrong.push(format!("{route} {row}: the outside f.txt is now {now:?}"));
                fs::write(out.join("f.txt"), "mine\n").unwrap();
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R82-02: in the untracked section, a folder row with tracked files below it is left with the
/// folder line; its untracked file stays.
#[test]
fn r82_an_untracked_folder_row_with_tracked_files_is_left() {
    let dir = temp_repo("r82k");
    fs::create_dir(dir.join("t")).unwrap();
    commit_file(&dir, "t/a.txt", "a\n");
    fs::write(dir.join("t").join("new.txt"), "mine\n").unwrap();
    fs::write(dir.join("loose.txt"), "u\n").unwrap();
    let said = discard(&dir, "untracked", &["t/".to_string(), "loose.txt".to_string()]);
    let (kept, loose) = (dir.join("t").join("new.txt").exists(), dir.join("loose.txt").exists());
    let _ = fs::remove_dir_all(&dir);
    assert_eq!(said, Err("t is a folder, so Kolux leaves it. Discard the files inside it instead.".to_string()));
    assert!(kept, "t/new.txt stays");
    assert!(!loose, "loose.txt still goes");
}

/// R82-03: a row holding a NUL would reach Git as two names; it is refused whole on every route
/// and by Stage, and nothing changes.
#[test]
fn r82_a_row_with_a_nul_is_refused() {
    let dir = temp_repo("r82f");
    commit_file(&dir, "b.txt", "b\n");
    fs::write(dir.join("b.txt"), "changed\n").unwrap();
    let mut wrong = Vec::new();
    for route in ["paths", "changed", "staged", "stage"] {
        let said = if route == "stage" { stage(&dir, &["b.txt\0x".to_string()], true) } else { by_route(&dir, route, &["b.txt\0x"]) };
        if said != Err("A file name here holds a character Kolux cannot pass to Git. Nothing was changed.".to_string()) {
            wrong.push(format!("{route}: said {said:?}"));
        }
    }
    let b = fs::read_to_string(dir.join("b.txt")).ok();
    let staged = run(&["diff", "--cached", "--name-only"], Some(&dir));
    let _ = fs::remove_dir_all(&dir);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    assert_eq!(b.as_deref(), Some("changed\n"), "the change to b.txt is kept");
    assert_eq!(staged.as_deref(), Ok(""), "nothing was staged");
}

/// R82-04: a link at one half of a staged rename stays when the other half is left: a link is
/// removed only after every check, the rename look-up included, has passed.
#[cfg(windows)]
#[test]
fn r82_a_link_in_a_rename_left_whole_is_not_removed() {
    let dir = temp_repo("r82g");
    let out = outside_folder("r82g");
    let _clean = LinksThenFolders(vec![dir.join("a.txt")], vec![dir.clone(), out.clone()]);
    commit_file(&dir, "a.txt", "a\n");
    plain(&["mv", "a.txt", "b.txt"], &dir);
    fs::remove_file(dir.join("b.txt")).unwrap();
    fs::create_dir(dir.join("b.txt")).unwrap();
    fs::write(dir.join("b.txt").join("x.txt"), "mine\n").unwrap();
    fs::write(out.join("o.txt"), "o\n").unwrap();
    junction(&dir.join("a.txt"), &out);
    let said = by_route(&dir, "staged", &["a.txt", "b.txt"]);
    let link = fs::symlink_metadata(dir.join("a.txt")).is_ok_and(|m| m.is_symlink());
    // F94-02 (rule D): a.txt, the rename's old half, is left by its own check now.
    assert_eq!(said, Err(format!("A link stands where a.txt would come back, so Kolux leaves a.txt as it is. Remove the link by hand, then discard again.\n{}", now_folder("b.txt"))));
    assert!(link, "the link at a.txt is still there");
    assert_eq!(fs::read_to_string(out.join("o.txt")).unwrap(), "o\n");
    assert_eq!(fs::read_to_string(dir.join("b.txt").join("x.txt")).unwrap(), "mine\n");
}

/// R82-05: unstaging when the branch list cannot be read is not taken as "no commit yet": Git's
/// words come back and the index is unchanged (that reading took the file out of the index).
#[test]
fn r82_a_broken_branch_list_does_not_unstage_by_removal() {
    let dir = temp_repo("r82h");
    commit_file(&dir, "foo", "f\n");
    fs::write(dir.join("foo"), "staged\n").unwrap();
    plain(&["add", "foo"], &dir);
    plain(&["pack-refs", "--all"], &dir);
    let refs = dir.join(".git").join("packed-refs");
    fs::write(&refs, fs::read_to_string(&refs).unwrap() + "garbage line\n").unwrap();
    let said = stage(&dir, &["foo".to_string()], false);
    let listed = run(&["ls-files"], Some(&dir));
    let _ = fs::remove_dir_all(&dir);
    assert!(said.is_err(), "Git's words come back: {said:?}");
    assert!(listed.as_ref().is_ok_and(|l| l.lines().any(|l| l == "foo")), "foo is still in the index: {listed:?}");
}

/// R82-08: a link that cannot be removed (held open by another program) leaves its row with
/// Windows' words; the link and what it points at stay, and the other rows still go.
#[cfg(windows)]
#[test]
fn r82_a_link_that_cannot_be_removed_leaves_its_row() {
    use std::os::windows::fs::OpenOptionsExt;
    let mut wrong = Vec::new();
    // R86-03: "paths-staged" is the paths route with `j` staged-modified before the link is made.
    for case in ["changed", "staged", "paths", "paths-staged"] {
        let route = case.trim_end_matches("-staged");
        let dir = temp_repo(&format!("r82i-{case}"));
        let out = outside_folder(&format!("r82i-{case}"));
        let _clean = LinksThenFolders(vec![dir.join("j")], vec![dir.clone(), out.clone()]);
        commit_file(&dir, "j", "j\n");
        commit_file(&dir, "plain.txt", "p\n");
        fs::write(dir.join("plain.txt"), "changed\n").unwrap();
        if route == "staged" {
            plain(&["add", "plain.txt"], &dir);
        }
        if case == "paths-staged" {
            fs::write(dir.join("j"), "staged\n").unwrap();
            plain(&["add", "j"], &dir);
        }
        fs::remove_file(dir.join("j")).unwrap();
        fs::write(out.join("o.txt"), "o\n").unwrap();
        junction(&dir.join("j"), &out);
        // FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS: the junction itself is held.
        let held = fs::File::options().read(true).share_mode(0).custom_flags(0x0020_0000 | 0x0200_0000).open(dir.join("j")).unwrap();
        let said = by_route(&dir, route, &["j", "plain.txt"]);
        drop(held);
        if case == "paths-staged" && !run(&["diff", "--cached", "--name-only"], Some(&dir)).is_ok_and(|o| o.lines().any(|l| l == "j")) {
            wrong.push(format!("{case}: the staged change to j was unstaged"));
        }
        if !matches!(&said, Err(e) if e.lines().count() == 1 && e.starts_with("j: ")) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if !fs::symlink_metadata(dir.join("j")).is_ok_and(|m| m.is_symlink()) {
            wrong.push(format!("{route}: the link j is gone"));
        }
        if fs::read_to_string(out.join("o.txt")).ok().as_deref() != Some("o\n") {
            wrong.push(format!("{route}: the outside o.txt changed"));
        }
        if fs::read_to_string(dir.join("plain.txt")).ok().as_deref() != Some("p\n") {
            wrong.push(format!("{route}: plain.txt was not discarded"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R82-08: off Windows `\` is a character of the file name, never a folder break: `d\f.txt` is
/// discarded as itself and `d/f.txt` is untouched.
#[cfg(not(windows))]
#[test]
fn r82_a_backslash_is_part_of_the_name_off_windows() {
    for route in ["changed", "paths"] {
        let dir = temp_repo(&format!("r82j-{route}"));
        fs::create_dir(dir.join("d")).unwrap();
        commit_file(&dir, "d\\f.txt", "f\n");
        commit_file(&dir, "d/f.txt", "g\n");
        fs::write(dir.join("d\\f.txt"), "changed\n").unwrap();
        fs::write(dir.join("d").join("f.txt"), "changed\n").unwrap();
        let said = by_route(&dir, route, &["d\\f.txt"]);
        let (a, b) = (fs::read_to_string(dir.join("d\\f.txt")).ok(), fs::read_to_string(dir.join("d").join("f.txt")).ok());
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(said, Ok(()), "{route}");
        assert_eq!(a.as_deref(), Some("f\n"), "{route}: d\\f.txt is discarded");
        assert_eq!(b.as_deref(), Some("changed\n"), "{route}: d/f.txt is untouched");
    }
}

/// R86-01: on Windows a second spelling of a tracked folder (`sub./`, `SUB/`) opens the folder
/// `sub`, and `git clean` would delete it whole; such a row is left, on the untracked and paths
/// routes. The plain row still goes.
#[cfg(windows)]
#[test]
fn r86_an_alias_spelling_of_a_tracked_folder_is_never_cleaned() {
    let mut wrong = Vec::new();
    // F90-06: every row runs with `core.ignorecase` false and true (true is the Windows default).
    for case in ["false", "true"] {
    for (i, (route, row)) in [("untracked", "sub./"), ("untracked", "SUB/"), ("untracked", "SUB/d/f.txt"), ("untracked", "sub./new.txt"), ("paths", "sub./"), ("untracked", "sub::$INDEX_ALLOCATION/")].into_iter().enumerate() {
        let dir = temp_repo(&format!("r86a-{case}-{i}"));
        plain(&["config", "core.ignorecase", case], &dir);
        fs::create_dir_all(dir.join("sub").join("d")).unwrap();
        commit_file(&dir, "sub/d/f.txt", "orig\n");
        fs::write(dir.join("sub").join("d").join("f.txt"), "changed\n").unwrap();
        fs::write(dir.join("sub").join("new.txt"), "mine\n").unwrap();
        fs::write(dir.join("sub").join("gone.txt"), "x\n").unwrap();
        let said = by_route(&dir, route, &[row]);
        if !matches!(&said, Err(e) if e.lines().count() == 1 && e.contains("so Kolux leaves")) {
            wrong.push(format!("ignorecase {case} {route} {row}: said {said:?}"));
        }
        // F90-06: the walker stops this row: the disk opens it as the folder `sub`, but no entry
        // of the listing is spelled so (`git clean` would remove the whole folder).
        if i == 5 && said != Err("sub::$INDEX_ALLOCATION is not spelled the way it is on disk, so Kolux leaves it. Wait for the list to update, then discard again.".to_string()) {
            wrong.push(format!("ignorecase {case} {route} {row}: not the spelling line: {said:?}"));
        }
        if fs::read_to_string(dir.join("sub").join("d").join("f.txt")).ok().as_deref() != Some("changed\n") {
            wrong.push(format!("ignorecase {case} {route} {row}: the change in sub/d/f.txt is gone"));
        }
        if !dir.join("sub").join("new.txt").exists() {
            wrong.push(format!("ignorecase {case} {route} {row}: sub/new.txt is gone"));
        }
        if i == 4 {
            let said = by_route(&dir, "untracked", &["sub/gone.txt"]);
            if said != Ok(()) || dir.join("sub").join("gone.txt").exists() {
                wrong.push(format!("ignorecase {case} control sub/gone.txt: said {said:?}, still there: {}", dir.join("sub").join("gone.txt").exists()));
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R86-01: a link is removed only under the spelling the disk holds: `lnk.` and `LNK` leave the
/// junction `lnk` standing on the untracked and changed routes; the row `lnk` removes it (only it).
#[cfg(windows)]
#[test]
fn r86_a_link_is_removed_only_under_its_own_name() {
    let dir = temp_repo("r86b");
    let out = outside_folder("r86b");
    let _clean = LinksThenFolders(vec![dir.join("lnk")], vec![dir.clone(), out.clone()]);
    fs::write(out.join("o.txt"), "o\n").unwrap();
    junction(&dir.join("lnk"), &out);
    let mut wrong = Vec::new();
    for route in ["untracked", "changed"] {
        for row in ["lnk.", "LNK"] {
            let said = by_route(&dir, route, &[row]);
            if !matches!(&said, Err(e) if e.contains("so Kolux leaves")) {
                wrong.push(format!("{route} {row}: said {said:?}"));
            }
            if !fs::symlink_metadata(dir.join("lnk")).is_ok_and(|m| m.is_symlink()) {
                wrong.push(format!("{route} {row}: the link lnk is gone"));
                junction(&dir.join("lnk"), &out);
            }
            if fs::read_to_string(out.join("o.txt")).ok().as_deref() != Some("o\n") {
                wrong.push(format!("{route} {row}: the outside o.txt changed"));
            }
        }
    }
    let said = by_route(&dir, "untracked", &["lnk"]);
    if said != Ok(()) || fs::symlink_metadata(dir.join("lnk")).is_ok() {
        wrong.push(format!("control lnk: said {said:?}, link still there: {}", fs::symlink_metadata(dir.join("lnk")).is_ok()));
    }
    if fs::read_to_string(out.join("o.txt")).ok().as_deref() != Some("o\n") {
        wrong.push("control lnk: the outside o.txt changed".into());
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// R86-03: on the paths route a link at a staged rename's old half leaves the rename whole:
/// nothing is unstaged and the new file stays. F94-02: the check leaves it (rule D) before any
/// removal; the lock below would make a removal fail, so the exact line shows none was tried.
#[cfg(windows)]
#[test]
fn r86_a_held_link_at_a_renames_old_half_leaves_the_rename_whole() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = temp_repo("r86c");
    let out = outside_folder("r86c");
    let _clean = LinksThenFolders(vec![dir.join("a")], vec![dir.clone(), out.clone()]);
    commit_file(&dir, "a", "a\n");
    plain(&["mv", "a", "b"], &dir);
    fs::write(out.join("o.txt"), "o\n").unwrap();
    junction(&dir.join("a"), &out);
    let held = fs::File::options().read(true).share_mode(0).custom_flags(0x0020_0000 | 0x0200_0000).open(dir.join("a")).unwrap();
    let said = by_route(&dir, "paths", &["b"]);
    drop(held);
    let renamed = status(&dir).is_ok_and(|st| st.staged.iter().any(|c| c.path == "b" && c.from.as_deref() == Some("a")));
    // F94-02 (rule D): the link at the old half is left by the check; no removal is tried.
    assert_eq!(said, Err("A link stands where a would come back, so Kolux leaves a as it is. Remove the link by hand, then discard again.".to_string()));
    assert!(dir.join("b").exists(), "b still stands");
    assert!(renamed, "the rename is still staged");
    assert!(fs::symlink_metadata(dir.join("a")).is_ok_and(|m| m.is_symlink()), "the link a stays");
    assert_eq!(fs::read_to_string(out.join("o.txt")).unwrap(), "o\n");
}

/// R86-05: an empty Discard list answers in Discard's words on every route; Stage keeps its own.
#[test]
fn r86_an_empty_discard_says_discard_words() {
    let dir = temp_repo("r86d");
    let mut wrong = Vec::new();
    for route in ["changed", "staged", "untracked", "paths"] {
        let said = by_route(&dir, route, &[]);
        if said != Err("Nothing to discard.".to_string()) {
            wrong.push(format!("{route}: said {said:?}"));
        }
    }
    let staged = stage(&dir, &[], true);
    let _ = fs::remove_dir_all(&dir);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    assert_eq!(staged, Err("nothing to stage".to_string()));
}

/// F90-01: with `core.ignorecase` true Git can hold `Sub/a.txt` while the disk spells the folder
/// `sub`, and Git prints the row as it holds it. A link at that row is the row's own link: it is
/// removed (only it) and the file comes back, on the changed and paths routes.
#[cfg(windows)]
#[test]
fn r93_a_link_at_a_row_git_holds_is_discarded_whatever_the_folder_case() {
    let mut wrong = Vec::new();
    for route in ["changed", "paths"] {
        let dir = temp_repo(&format!("r93a-{route}"));
        let out = outside_folder(&format!("r93a-{route}"));
        let _clean = LinksThenFolders(vec![dir.join("sub").join("a.txt")], vec![dir.clone(), out.clone()]);
        plain(&["config", "core.ignorecase", "true"], &dir);
        fs::create_dir_all(dir.join("Sub")).unwrap();
        commit_file(&dir, "Sub/a.txt", "committed\n");
        fs::rename(dir.join("Sub"), dir.join("sub-step")).unwrap();
        fs::rename(dir.join("sub-step"), dir.join("sub")).unwrap();
        assert!(fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name() == "sub"), "the listing holds sub");
        fs::remove_file(dir.join("sub").join("a.txt")).unwrap();
        fs::write(out.join("o.txt"), "o\n").unwrap();
        junction(&dir.join("sub").join("a.txt"), &out);
        let said = by_route(&dir, route, &["Sub/a.txt"]);
        if said != Ok(()) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        let at = fs::symlink_metadata(dir.join("sub").join("a.txt"));
        if !at.as_ref().is_ok_and(|m| m.is_file() && !m.is_symlink()) {
            wrong.push(format!("{route}: sub/a.txt is not a plain file: {at:?}"));
        } else if fs::read_to_string(dir.join("sub").join("a.txt")).ok().as_deref() != Some("committed\n") {
            wrong.push(format!("{route}: sub/a.txt does not hold the committed text"));
        }
        if fs::read_to_string(out.join("o.txt")).ok().as_deref() != Some("o\n") {
            wrong.push(format!("{route}: the outside o.txt changed"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F90-06: on Windows the untracked name `foo.` opens the tracked file `foo`, and `git clean --
/// foo.` would delete it. The row is left on the untracked and paths routes: `foo` keeps its
/// uncommitted text and `foo.` stands. `foo.` is made and removed through a `\\?\` path built from
/// the test's own repository, before any assert, so the folder clean-up never meets it.
#[cfg(windows)]
#[test]
fn r93_an_untracked_name_ending_in_a_dot_beside_a_tracked_file_is_left() {
    let mut wrong = Vec::new();
    for route in ["untracked", "paths"] {
        let dir = temp_repo(&format!("r93b-{route}"));
        assert!(dir.is_absolute(), "the repository path is absolute: {}", dir.display());
        commit_file(&dir, "foo", "orig\n");
        fs::write(dir.join("foo"), "mine\n").unwrap();
        let dotted = PathBuf::from(format!(r"\\?\{}", dir.join("foo.").display()));
        fs::write(&dotted, "dot\n").unwrap();
        let said = by_route(&dir, route, &["foo."]);
        let foo = fs::read_to_string(dir.join("foo")).ok();
        let dot_stood = fs::symlink_metadata(&dotted).is_ok();
        let removed = fs::remove_file(&dotted);
        assert!(removed.is_ok() || !dot_stood, "{route}: the test could not remove foo. itself ({removed:?}); {} is left for a hand clean-up", dir.display());
        assert!(fs::symlink_metadata(&dotted).is_err(), "{route}: foo. still stands; {} is left for a hand clean-up", dir.display());
        let _ = fs::remove_dir_all(&dir);
        if !matches!(&said, Err(e) if e.lines().count() == 1 && e.contains("ends in a dot or a space") && e.contains("so Kolux leaves")) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        // F90-03: the line says what to do next.
        if said != Err("foo. has a name that ends in a dot or a space. Windows reads that as another name, so Kolux leaves it. Rename or delete it with the tool that made it (WSL, for example), not in Explorer.".to_string()) {
            wrong.push(format!("{route}: not the dot line: {said:?}"));
        }
        if foo.as_deref() != Some("mine\n") {
            wrong.push(format!("{route}: foo holds {foo:?}, not its uncommitted text"));
        }
        if !dot_stood {
            wrong.push(format!("{route}: foo. is gone"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F94-01 / F94-02: the two lines Discard gives a row only the last commit holds when something
/// stands at its place.
fn r95_file(row: &str) -> String {
    format!("A file stands where {row} would come back, so Kolux leaves {row} as it is. Use Unstage to keep that file, or move it away and discard again.")
}

#[cfg(windows)]
fn r95_link(row: &str) -> String {
    format!("A link stands where {row} would come back, so Kolux leaves {row} as it is. Remove the link by hand, then discard again.")
}

#[cfg(windows)]
fn r95_listed(dir: &Path, name: &str) -> bool {
    fs::read_dir(dir).unwrap().any(|e| e.unwrap().file_name() == name)
}

/// F94-01 (rule D): a staged deletion whose place holds a new file of the same name is left on
/// the staged and paths routes: the new text stays and the deletion stays staged.
#[test]
fn r95_a_staged_deletion_never_writes_over_a_new_file_of_its_name() {
    let mut wrong = Vec::new();
    for route in ["staged", "paths"] {
        let dir = temp_repo(&format!("r95a-{route}"));
        commit_file(&dir, "notes", "old\n");
        plain(&["rm", "-q", "notes"], &dir);
        fs::write(dir.join("notes"), "mine\n").unwrap();
        let said = by_route(&dir, route, &["notes"]);
        let text = fs::read_to_string(dir.join("notes")).ok();
        let deleted = status(&dir).is_ok_and(|st| st.staged.iter().any(|c| c.path == "notes" && c.status == "D"));
        let _ = fs::remove_dir_all(&dir);
        if said != Err(r95_file("notes")) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if text.as_deref() != Some("mine\n") {
            wrong.push(format!("{route}: notes holds {text:?}, not the new text"));
        }
        if !deleted {
            wrong.push(format!("{route}: the deletion of notes is no longer staged"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F94-01 (rule D): on Windows `notes` opens a new untracked `NOTES`. Discarding the staged
/// deletion of `notes` leaves it: `NOTES` keeps its name and its text, on both routes.
#[cfg(windows)]
#[test]
fn r95_a_staged_deletion_never_writes_over_a_file_in_other_letter_case() {
    let mut wrong = Vec::new();
    for route in ["staged", "paths"] {
        let dir = temp_repo(&format!("r95b-{route}"));
        commit_file(&dir, "notes", "old\n");
        plain(&["rm", "-q", "notes"], &dir);
        fs::write(dir.join("NOTES"), "mine\n").unwrap();
        let said = by_route(&dir, route, &["notes"]);
        let text = fs::read_to_string(dir.join("NOTES")).ok();
        let (upper, lower) = (r95_listed(&dir, "NOTES"), r95_listed(&dir, "notes"));
        let deleted = status(&dir).is_ok_and(|st| st.staged.iter().any(|c| c.path == "notes" && c.status == "D"));
        let _ = fs::remove_dir_all(&dir);
        if said != Err(r95_file("notes")) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if text.as_deref() != Some("mine\n") {
            wrong.push(format!("{route}: NOTES holds {text:?}, not the new text"));
        }
        if !upper || lower {
            wrong.push(format!("{route}: the listing holds NOTES {upper}, notes {lower}"));
        }
        if !deleted {
            wrong.push(format!("{route}: the deletion of notes is no longer staged"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F94-02 (rule D): a junction standing where a staged deletion would come back, spelled `LNK`
/// or `lnk`, is not the row's: it is left with the link line, on both routes, and what it points
/// at is untouched.
#[cfg(windows)]
#[test]
fn r95_a_link_where_a_staged_deletion_would_come_back_is_left() {
    let mut wrong = Vec::new();
    for (spelled, tag) in [("LNK", "upper"), ("lnk", "lower")] {
        for route in ["staged", "paths"] {
            let name = format!("r95c-{tag}-{route}");
            let dir = temp_repo(&name);
            let out = outside_folder(&name);
            let _clean = LinksThenFolders(vec![dir.join(spelled)], vec![dir.clone(), out.clone()]);
            commit_file(&dir, "lnk", "old\n");
            plain(&["rm", "-q", "lnk"], &dir);
            fs::write(out.join("o.txt"), "o\n").unwrap();
            junction(&dir.join(spelled), &out);
            let said = by_route(&dir, route, &["lnk"]);
            if said != Err(r95_link("lnk")) {
                wrong.push(format!("{spelled} {route}: said {said:?}"));
            }
            if !fs::symlink_metadata(dir.join(spelled)).is_ok_and(|m| m.is_symlink()) {
                wrong.push(format!("{spelled} {route}: the junction is gone"));
            }
            if fs::read_to_string(out.join("o.txt")).ok().as_deref() != Some("o\n") {
                wrong.push(format!("{spelled} {route}: the outside o.txt changed"));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F94-01 (rule D): a new file standing at a staged rename's old half leaves the rename whole: on
/// the paths route (row `b`) and on the staged route (rows `b` and `a`) `a` keeps its new text, `b`
/// stands and the rename stays staged.
#[test]
fn r95_a_new_file_at_a_renames_old_half_leaves_the_rename_whole() {
    let mut wrong = Vec::new();
    for (route, rows) in [("paths", &["b"][..]), ("staged", &["b", "a"][..])] {
        let dir = temp_repo(&format!("r95d-{route}"));
        commit_file(&dir, "a", "old\n");
        plain(&["mv", "a", "b"], &dir);
        fs::write(dir.join("a"), "mine\n").unwrap();
        let said = by_route(&dir, route, rows);
        let text = fs::read_to_string(dir.join("a")).ok();
        let b = dir.join("b").exists();
        let renamed = status(&dir).is_ok_and(|st| st.staged.iter().any(|c| c.path == "b" && c.from.as_deref() == Some("a")));
        let _ = fs::remove_dir_all(&dir);
        let want = if route == "paths" { r95_file("a") } else { format!("{}\nb is the other half of a rename, so Kolux leaves it too.", r95_file("a")) };
        if said != Err(want) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if text.as_deref() != Some("mine\n") {
            wrong.push(format!("{route}: a holds {text:?}, not the new text"));
        }
        if !b {
            wrong.push(format!("{route}: b is gone"));
        }
        if !renamed {
            wrong.push(format!("{route}: the rename is no longer staged"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// F94-01 (rule D's exception): a rename that only changes letter case has its old half standing
/// on disk as the new half itself. Discarded with both rows on the staged route, it comes back
/// whole under its old name. (`guide.md`, since the test repository already holds `README.md`.)
#[cfg(windows)]
#[test]
fn r95_a_letter_case_rename_discarded_whole_on_the_staged_route_comes_back() {
    let dir = temp_repo("r95e");
    commit_file(&dir, "guide.md", "old\n");
    plain(&["mv", "guide.md", "GUIDE.md"], &dir);
    let said = by_route(&dir, "staged", &["GUIDE.md", "guide.md"]);
    let (lower, upper) = (r95_listed(&dir, "guide.md"), r95_listed(&dir, "GUIDE.md"));
    let text = fs::read_to_string(dir.join("guide.md")).ok();
    let st = status(&dir).unwrap();
    let _ = fs::remove_dir_all(&dir);
    assert_eq!(said, Ok(()));
    assert!(lower && !upper, "the listing holds guide.md {lower}, GUIDE.md {upper}");
    assert_eq!(text.as_deref(), Some("old\n"));
    assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty(), "status lists {st:?}");
}

/// F94-03: the same rename discarded by the paths route (row `GUIDE.md` alone) gives the one disk
/// entry its old name back instead of deleting it.
#[cfg(windows)]
#[test]
fn r95_a_letter_case_rename_discarded_by_paths_keeps_its_file() {
    let dir = temp_repo("r95g");
    commit_file(&dir, "guide.md", "old\n");
    plain(&["mv", "guide.md", "GUIDE.md"], &dir);
    let said = by_route(&dir, "paths", &["GUIDE.md"]);
    let (lower, upper) = (r95_listed(&dir, "guide.md"), r95_listed(&dir, "GUIDE.md"));
    let text = fs::read_to_string(dir.join("guide.md")).ok();
    let st = status(&dir).unwrap();
    let _ = fs::remove_dir_all(&dir);
    assert_eq!(said, Ok(()));
    assert!(lower && !upper, "the listing holds guide.md {lower}, GUIDE.md {upper}");
    assert_eq!(text.as_deref(), Some("old\n"));
    assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty(), "status lists {st:?}");
}

/// F94-01 control: a staged deletion with nothing at its place still comes back on both routes.
#[test]
fn r95_a_staged_deletion_with_an_empty_place_comes_back() {
    let mut wrong = Vec::new();
    for route in ["staged", "paths"] {
        let dir = temp_repo(&format!("r95f-{route}"));
        commit_file(&dir, "notes", "old\n");
        plain(&["rm", "-q", "notes"], &dir);
        let said = by_route(&dir, route, &["notes"]);
        let text = fs::read_to_string(dir.join("notes")).ok();
        let st = status(&dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
        if said != Ok(()) {
            wrong.push(format!("{route}: said {said:?}"));
        }
        if text.as_deref() != Some("old\n") {
            wrong.push(format!("{route}: notes holds {text:?}"));
        }
        if !st.staged.is_empty() {
            wrong.push(format!("{route}: still staged {:?}", st.staged));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
