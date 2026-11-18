use super::*;
use crate::projects::set_origin;
use std::fs;
use std::process::Command;
use std::sync::atomic::AtomicUsize;

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-quitmerge-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn git_in(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A git command that may fail (a conflict is the point): whether it succeeded.
fn git_try(dir: &Path, args: &[&str]) -> bool {
    Command::new("git").args(args).current_dir(dir).output().unwrap().status.success()
}

fn head(dir: &Path, rev: &str) -> String {
    git_in(dir, &["rev-parse", rev])
}

fn branch_exists(repo: &Path, b: &str) -> bool {
    Command::new("git").args(["rev-parse", "-q", "--verify", &format!("refs/heads/{b}")]).current_dir(repo).output().unwrap().status.success()
}

/// A repository on `main` with one commit (a.txt, and a .gitignore that ignores *.log), and a store.
fn repo(name: &str) -> (PathBuf, PathBuf, Mutex<Store>) {
    let base = temp(name);
    let repo = base.join("r");
    fs::create_dir_all(&repo).unwrap();
    git_in(&repo, &["init", "-q", "-b", "main"]);
    git_in(&repo, &["config", "user.email", "t@example.com"]);
    git_in(&repo, &["config", "user.name", "t"]);
    fs::write(repo.join("a.txt"), "a\n").unwrap();
    fs::write(repo.join(".gitignore"), "*.log\n").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "first"]);
    let store = Store::open(&base.join("db")).unwrap();
    (base, repo, Mutex::new(store))
}

/// A worktree `name` on a new branch of the same name, made by Kolux (an origin record) or not.
fn workspace(base: &Path, repo: &Path, store: &Mutex<Store>, name: &str, kolux: bool) -> PathBuf {
    let at = base.join(name);
    git_in(repo, &["worktree", "add", "-q", &at.to_string_lossy(), "-b", name]);
    if kolux {
        set_origin(&store.lock().unwrap(), &at.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    }
    at
}

fn commit(dir: &Path, file: &str, text: &str) {
    fs::write(dir.join(file), text).unwrap();
    git_in(dir, &["add", file]);
    git_in(dir, &["commit", "-q", "-m", file]);
}

fn data(base: &Path) -> PathBuf {
    base.join("data")
}

fn marker_file(base: &Path) -> PathBuf {
    data(base).join(MARKER_FILE)
}

fn tidy(base: &Path, store: &Mutex<Store>) -> Outcome {
    run(&Git::detect().unwrap(), store, &Terminals::default(), Clock::until(Instant::now() + Duration::from_secs(120)), &data(base))
}

fn clock() -> Clock {
    Clock::until(Instant::now() + Duration::from_secs(120))
}

fn reasons(out: &Outcome) -> Vec<String> {
    out.left.iter().map(|l| l.why.clone()).collect()
}

// ------------------------------------------------------------------ the merge itself

#[test]
fn a_clean_branch_is_fast_forwarded_into_main_and_its_workspace_goes() {
    let (base, repo, store) = repo("ff");
    let ws = workspace(&base, &repo, &store, "ff", true);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert_eq!(head(&repo, "main"), tip, "a fast-forward: main is at the branch's tip, no merge commit");
    assert!(!ws.exists(), "the workspace folder is gone");
    assert!(!branch_exists(&repo, "ff"), "its branch went with it: every commit is in main");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(!marker_file(&base).exists(), "the marker is cleared once main is whole again");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn uncommitted_work_is_committed_merged_and_removed_with_ignored_files_left_out() {
    let (base, repo, store) = repo("dirty-ws");
    let ws = workspace(&base, &repo, &store, "wip", true);
    fs::write(ws.join("a.txt"), "a changed\n").unwrap();
    fs::write(ws.join("new.txt"), "untracked\n").unwrap();
    fs::write(ws.join("noise.log"), "ignored\n").unwrap();
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(git_in(&repo, &["log", "-1", "--format=%s", "main"]), SAVE_MESSAGE);
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap().trim(), "a changed");
    assert!(repo.join("new.txt").is_file(), "the untracked file was saved and merged");
    assert_eq!(git_in(&repo, &["ls-tree", "--name-only", "main", "noise.log"]), "", "an ignored file is never committed");
    assert!(!ws.exists() && !branch_exists(&repo, "wip"));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_branch_behind_main_gets_a_merge_commit_when_nothing_clashes() {
    let (base, repo, store) = repo("merge-commit");
    let ws = workspace(&base, &repo, &store, "side", true);
    commit(&ws, "c.txt", "c\n");
    commit(&repo, "d.txt", "d\n");
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(git_in(&repo, &["log", "-1", "--format=%s", "main"]), "Kolux: merge side on quit");
    assert!(git_in(&repo, &["merge-base", "--is-ancestor", &tip, "main"]).is_empty());
    assert!(!ws.exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_clash_leaves_main_exactly_as_it_was_and_keeps_the_workspace() {
    let (base, repo, store) = repo("clash");
    let ws = workspace(&base, &repo, &store, "clash", true);
    commit(&ws, "a.txt", "theirs\n");
    commit(&repo, "a.txt", "ours\n");
    let before = head(&repo, "HEAD");
    let out = tidy(&base, &store);
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("clash"), "{:?}", out.left);
    assert_eq!(head(&repo, "HEAD"), before, "main did not move");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "", "main is clean: no merge was left open");
    assert!(!repo.join(".git").join("MERGE_HEAD").exists());
    assert!(ws.is_dir() && branch_exists(&repo, "clash"), "the workspace and its branch stay");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_dirty_main_checkout_gets_nothing_merged_and_the_workspace_stays() {
    let (base, repo, store) = repo("dirty-main");
    let ws = workspace(&base, &repo, &store, "work", true);
    commit(&ws, "b.txt", "b\n");
    let empty = workspace(&base, &repo, &store, "empty", true);
    fs::write(repo.join("a.txt"), "edited in main\n").unwrap();
    let before = head(&repo, "HEAD");
    let out = tidy(&base, &store);
    assert_eq!(head(&repo, "HEAD"), before, "nothing merged");
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "edited in main\n", "main's own change is untouched");
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("not committed"), "{:?}", out.left);
    assert!(ws.is_dir() && branch_exists(&repo, "work"));
    assert!(!empty.exists(), "a workspace with nothing new goes even so: nothing of it is lost");
    let _ = fs::remove_dir_all(&base);
}

/// m2: a main that cannot take the merge costs the workspace no "saved on quit" commit: nothing is
/// added or committed until the merge is certain to be tried.
#[test]
fn a_main_that_cannot_take_the_merge_costs_the_workspace_no_saved_commit() {
    let (base, repo, store) = repo("m2");
    let ws = workspace(&base, &repo, &store, "wip", true);
    fs::write(ws.join("new.txt"), "unsaved\n").unwrap();
    fs::write(ws.join("a.txt"), "changed\n").unwrap();
    fs::write(repo.join("a.txt"), "main is mid-edit\n").unwrap();
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("not committed"), "{:?}", out.left);
    assert_eq!(head(&ws, "HEAD"), tip, "no commit was made in the workspace");
    let status = git_in(&ws, &["status", "--porcelain"]);
    assert!(status.contains("new.txt") && status.contains("a.txt"), "its work is exactly as it was: {status}");
    assert_eq!(git_in(&ws, &["diff", "--cached", "--name-only"]), "", "nothing was staged either");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_worktree_kolux_did_not_make_is_never_touched() {
    let (base, repo, store) = repo("foreign");
    let theirs = workspace(&base, &repo, &store, "theirs", false);
    commit(&theirs, "b.txt", "b\n");
    fs::write(theirs.join("loose.txt"), "uncommitted\n").unwrap();
    let before = head(&repo, "main");
    let tip = head(&theirs, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty() && out.removed.is_empty() && out.merged.is_empty(), "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(head(&theirs, "HEAD"), tip, "no commit was made in it");
    assert!(theirs.join("loose.txt").is_file() && branch_exists(&repo, "theirs"));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn locked_and_detached_workspaces_stay() {
    let (base, repo, store) = repo("kept");
    let locked = workspace(&base, &repo, &store, "locked", true);
    commit(&locked, "b.txt", "b\n");
    git_in(&repo, &["worktree", "lock", &locked.to_string_lossy()]);
    let detached = base.join("loose-end");
    git_in(&repo, &["worktree", "add", "-q", "--detach", &detached.to_string_lossy()]);
    set_origin(&store.lock().unwrap(), &detached.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    let before = head(&repo, "main");
    let out = tidy(&base, &store);
    assert_eq!(head(&repo, "main"), before);
    let why = reasons(&out);
    assert!(why.iter().any(|w| w == LOCKED) && why.iter().any(|w| w == DETACHED), "{why:?}");
    assert!(locked.is_dir() && detached.is_dir());
    git_in(&repo, &["worktree", "unlock", &locked.to_string_lossy()]);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn out_of_time_starts_nothing() {
    let (base, repo, store) = repo("late");
    let ws = workspace(&base, &repo, &store, "late", true);
    fs::write(ws.join("x.txt"), "x\n").unwrap();
    let out = run(&Git::detect().unwrap(), &store, &Terminals::default(), Clock::until(Instant::now()), &data(&base));
    assert!(out.removed.is_empty() && out.merged.is_empty());
    assert!(ws.join("x.txt").is_file() && git_in(&ws, &["status", "--porcelain"]).contains("x.txt"), "nothing was committed");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn the_next_start_tells_what_was_kept_once() {
    let (base, _repo, store) = repo("notes");
    let s = store.lock().unwrap();
    let left = vec![Left { project: "app".into(), path: "C:/w/fix".into(), branch: Some("fix".into()), why: "its changes clash with main".into() }];
    save_outcome(&s, &Outcome { left, repos: vec!["C:/p".into()], ..Outcome::default() }).unwrap();
    let notes = take_notes(&s);
    assert_eq!(notes, vec!["When Kolux last closed, it kept 1 workspace instead of merging it into main:".to_string(), "fix in app: its changes clash with main.".to_string(), "Kolux tries again the next time it closes.".to_string()]);
    assert!(take_notes(&s).is_empty(), "told once");
    assert_eq!(swept_folders(&s), vec![Path::new("C:/p").join(".worktrees")], "the projects stay for the trash sweep");
    drop(s);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn more_than_five_kept_are_counted_not_listed() {
    let left: Vec<Left> = (0..7).map(|i| Left { project: "p".into(), path: format!("C:/w/{i}"), branch: None, why: "it is locked".into() }).collect();
    let n = notes(&left);
    assert_eq!(n.len(), 7, "heading, five, and the count: {n:?}");
    assert_eq!(n[1], "0 in p: it is locked.");
    assert_eq!(n[6], "And 2 more. Kolux tries again the next time it closes.");
}

#[test]
fn only_a_real_quit_with_the_setting_on_merges() {
    let on = serde_json::json!({});
    assert_eq!(skip_reason(&on, false, false, false), None, "on by default");
    assert!(skip_reason(&serde_json::json!({ MERGE_ON_QUIT_SETTING: false }), false, false, false).is_some());
    assert!(skip_reason(&serde_json::json!({ MERGE_ON_QUIT_SETTING: true }), false, false, false).is_none());
    assert!(skip_reason(&on, true, false, false).is_some(), "a restart");
    assert!(skip_reason(&on, false, true, false).is_some(), "Windows ending the session");
    assert!(skip_reason(&on, false, false, true).is_some(), "terminals that outlive the window");
}

#[test]
fn a_workspace_folder_names_its_main_checkout() {
    let (base, repo, store) = repo("repo-of");
    let ws = workspace(&base, &repo, &store, "w", false);
    assert!(projects::same_folder(&repo_of(&ws).unwrap(), &repo));
    assert_eq!(repo_of(&repo), None, "the main checkout has a .git folder, not a file");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_workspace_made_in_dot_worktrees_is_merged_and_removed_and_main_never_lists_it() {
    if std::env::var(projects::WORKSPACES_DIR_ENV).is_ok() {
        return; // the variable would choose a folder
    }
    let (base, repo, store) = repo("local");
    let git = Git::detect().unwrap();
    let project = projects::add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let place = projects::place_for(&store.lock().unwrap(), &project);
    let created = projects::create_workspace(&git, &place, &project, "amber-otter", None).unwrap();
    projects::record_made(&store.lock().unwrap(), &project, &created, serde_json::json!({ "madeBy": "app" })).unwrap();
    let made = created.worktree;
    let ws = PathBuf::from(&made.path);
    assert!(projects::same_folder(&ws, &repo.join(".worktrees").join("amber-otter")), "{}", made.path);
    // Kept for diagnostics, and for the quit's branch decision: what it started from and the branch Kolux made.
    let record = projects::origin(&store.lock().unwrap(), &made.path).unwrap();
    assert_eq!(record[projects::BASE_REF_KEY].as_str(), Some(created.base.as_str()), "{record}");
    assert_eq!(record[projects::MADE_BRANCH_KEY].as_str(), made.branch.as_deref(), "{record}");
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join("scratch.txt"), "unsaved\n").unwrap();
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "", "main never lists the .worktrees folder");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert!(!ws.exists(), "the workspace folder is gone");
    assert!(repo.join("b.txt").is_file() && repo.join("scratch.txt").is_file(), "its commit and its unsaved file reached main");
    assert!(!branch_exists(&repo, &made.branch.clone().unwrap_or_default()), "its branch went with it");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(projects::load_origins(&store.lock().unwrap()).is_empty(), "its record is forgotten");
    let _ = fs::remove_dir_all(&base);
}

/// A later rewrite of a workspace's record that does not name the base and the made branch keeps them.
#[test]
fn a_rewritten_record_keeps_the_base_and_the_branch_kolux_made() {
    let (base, _repo, store) = repo("record");
    let s = store.lock().unwrap();
    set_origin(&s, "C:/w/a", Some(&serde_json::json!({ "madeBy": "app", "baseRef": "develop", "madeBranch": "kolux/a" }))).unwrap();
    set_origin(&s, "C:/w/a", Some(&serde_json::json!({ "madeBy": "app", "issue": 4 }))).unwrap();
    let kept = projects::origin(&s, "C:/w/a").unwrap();
    assert_eq!((kept["baseRef"].as_str(), kept["madeBranch"].as_str(), kept["issue"].as_u64()), (Some("develop"), Some("kolux/a"), Some(4)), "{kept}");
    set_origin(&s, "C:/w/a", Some(&serde_json::json!({ "madeBranch": "renamed" }))).unwrap();
    assert_eq!(projects::origin(&s, "C:/w/a").unwrap()["madeBranch"].as_str(), Some("renamed"), "a value that is named wins");
    drop(s);
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ owner decision (2026-11-17): branch and pull request sessions merge too

#[test]
fn a_pull_request_workspace_is_merged_and_removed_like_any_other() {
    let (base, repo, store) = repo("pr");
    let ws = workspace(&base, &repo, &store, "pr-7", false);
    set_origin(&store.lock().unwrap(), &ws.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/7", "prEver": true }))).unwrap();
    commit(&ws, "b.txt", "b\n");
    let fork = workspace(&base, &repo, &store, "fork-pr-8", false);
    set_origin(&store.lock().unwrap(), &fork.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/someone/r/pull/8", "prEver": true }))).unwrap();
    commit(&fork, "c.txt", "c\n");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (2, 2));
    assert!(repo.join("b.txt").is_file() && repo.join("c.txt").is_file());
    assert!(!ws.exists() && !fork.exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_workspace_opened_on_an_existing_branch_is_merged_and_removed_and_that_branch_stays() {
    let (base, repo, store) = repo("existing");
    let at = base.join("opened");
    git_in(&repo, &["worktree", "add", "-q", &at.to_string_lossy(), "-b", "feat-login"]);
    set_origin(&store.lock().unwrap(), &at.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "existingBranch": true }))).unwrap();
    commit(&at, "b.txt", "b\n");
    let tip = head(&at, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert_eq!(head(&repo, "main"), tip);
    assert!(!at.exists(), "the folder goes");
    assert!(branch_exists(&repo, "feat-login"), "a branch the user chose keeps its name when the workspace goes (PROJ-030)");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_pushed_branch_is_merged_locally_without_pushing_and_the_remote_branch_stays() {
    let (base, repo, store) = repo("pushed");
    git_in(&base, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
    let remote = base.join("remote.git");
    git_in(&repo, &["remote", "add", "origin", &remote.to_string_lossy()]);
    git_in(&repo, &["push", "-q", "-u", "origin", "main"]);
    git_in(&repo, &["remote", "set-head", "origin", "main"]);
    let ws = workspace(&base, &repo, &store, "pushed", true);
    commit(&ws, "b.txt", "b\n");
    git_in(&ws, &["push", "-q", "-u", "origin", "pushed"]);
    commit(&ws, "c.txt", "c\n");
    let (remote_pushed, remote_main) = (head(&remote, "refs/heads/pushed"), head(&remote, "refs/heads/main"));
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert_eq!(head(&repo, "main"), tip, "merged into the local main");
    assert!(!ws.exists());
    assert!(!branch_exists(&repo, "pushed"), "the local branch goes once it is merged");
    assert_eq!(head(&remote, "refs/heads/pushed"), remote_pushed, "the remote branch is neither pushed to nor deleted");
    assert_eq!(head(&remote, "refs/heads/main"), remote_main, "nothing was pushed to the remote main");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_workspace_started_from_another_base_is_merged_too() {
    let (base, repo, store) = repo("other-base");
    git_in(&repo, &["checkout", "-q", "-b", "develop"]);
    commit(&repo, "dev.txt", "dev\n");
    git_in(&repo, &["checkout", "-q", "main"]);
    let at = base.join("based");
    git_in(&repo, &["worktree", "add", "-q", &at.to_string_lossy(), "-b", "based", "develop"]);
    set_origin(&store.lock().unwrap(), &at.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "baseRef": "develop", "madeBranch": "based" }))).unwrap();
    commit(&at, "b.txt", "b\n");
    let tip = head(&at, "HEAD");
    let develop = head(&repo, "develop");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(head(&repo, "main"), tip, "main took the branch, develop's commit with it");
    assert_eq!(head(&repo, "develop"), develop, "develop itself is untouched");
    assert!(!at.exists() && !branch_exists(&repo, "based"));
    let _ = fs::remove_dir_all(&base);
}

/// M3 (as softened): a workspace moved onto another branch still has that branch merged into main,
/// but the branch is not deleted: Kolux did not make it.
#[test]
fn a_workspace_moved_onto_another_branch_has_it_merged_but_keeps_that_branch() {
    let (base, repo, store) = repo("switched");
    let ws = workspace(&base, &repo, &store, "sw", true);
    git_in(&ws, &["checkout", "-q", "-b", "somebody-elses-work"]);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(head(&repo, "main"), tip);
    assert!(!ws.exists(), "the folder is removed: it was clean and merged");
    assert!(branch_exists(&repo, "somebody-elses-work"), "the branch Kolux did not make is not deleted");
    let _ = fs::remove_dir_all(&base);
}

/// The branch Kolux made is found when it was renamed: by the record, and by the reflog when the record is stale or missing.
#[test]
fn a_branch_kolux_renamed_still_goes_with_its_workspace() {
    let (base, repo, store) = repo("renamed");
    let recorded = workspace(&base, &repo, &store, "amber", true);
    git_in(&recorded, &["branch", "-m", "amber", "fix-login"]);
    set_origin(&store.lock().unwrap(), &recorded.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "madeBranch": "fix-login" }))).unwrap();
    commit(&recorded, "b.txt", "b\n");
    let stale = workspace(&base, &repo, &store, "otter", true);
    git_in(&stale, &["branch", "-m", "otter", "fix-poll"]);
    set_origin(&store.lock().unwrap(), &stale.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "madeBranch": "otter" }))).unwrap();
    commit(&stale, "c.txt", "c\n");
    let none = workspace(&base, &repo, &store, "heron", true);
    git_in(&none, &["branch", "-m", "heron", "fix-sort"]);
    commit(&none, "d.txt", "d\n");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(out.removed.len(), 3, "{out:?}");
    for b in ["fix-login", "fix-poll", "fix-sort"] {
        assert!(!branch_exists(&repo, b), "{b} was Kolux's own branch and went with its workspace");
    }
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ B1: never save over an unfinished merge, cherry-pick, rebase

#[test]
fn a_workspace_in_the_middle_of_a_merge_cherry_pick_rebase_or_stash_is_kept_and_nothing_is_committed() {
    for mode in ["merge", "cherry-pick", "rebase", "stash-pop"] {
        let (base, repo, store) = repo(&format!("b1-{mode}"));
        git_in(&repo, &["checkout", "-q", "-b", "x"]);
        commit(&repo, "a.txt", "x\n");
        git_in(&repo, &["checkout", "-q", "main"]);
        let ws = workspace(&base, &repo, &store, "mid", true);
        if mode == "stash-pop" {
            fs::write(ws.join("a.txt"), "stashed\n").unwrap();
            git_in(&ws, &["stash", "push", "-q"]);
            commit(&ws, "a.txt", "committed\n");
            assert!(!git_try(&ws, &["stash", "pop"]), "the pop conflicts");
        } else {
            commit(&ws, "a.txt", "mid\n");
            let cmd: &[&str] = match mode {
                "merge" => &["merge", "x"],
                "cherry-pick" => &["cherry-pick", "x"],
                _ => &["rebase", "x"],
            };
            assert!(!git_try(&ws, cmd), "{mode} conflicts");
        }
        let tip = head(&ws, "HEAD");
        let before_main = head(&repo, "main");
        let log_before = git_in(&ws, &["reflog", "-1", "--format=%H"]);
        let out = tidy(&base, &store);
        assert_eq!(out.left.len(), 1, "{mode}: {:?}", out.left);
        let why = &out.left[0].why;
        assert!(why == UNFINISHED || why == CONFLICTED, "{mode}: {why}");
        assert_eq!(head(&ws, "HEAD"), tip, "{mode}: no commit was made over the unfinished work");
        assert_eq!(git_in(&ws, &["reflog", "-1", "--format=%H"]), log_before, "{mode}: nothing moved in its history");
        assert!(fs::read_to_string(ws.join("a.txt")).unwrap().contains("<<<<<<<"), "{mode}: the conflict markers are still where the user left them");
        assert!(!git_in(&ws, &["ls-files", "-u"]).is_empty(), "{mode}: still unmerged, nothing was staged over it");
        assert_eq!(head(&repo, "main"), before_main);
        assert!(ws.is_dir(), "{mode}: the workspace stays");
        let _ = fs::remove_dir_all(&base);
    }
}

// ------------------------------------------------------------------ B2: a nested clone is never staged as a link

#[test]
fn a_workspace_holding_a_separate_git_project_is_kept_and_no_link_is_staged() {
    let (base, repo, store) = repo("b2");
    let ws = workspace(&base, &repo, &store, "vend", true);
    let inner = ws.join("vendor").join("lib");
    fs::create_dir_all(&inner).unwrap();
    git_in(&inner, &["init", "-q", "-b", "main"]);
    git_in(&inner, &["config", "user.email", "t@example.com"]);
    git_in(&inner, &["config", "user.name", "t"]);
    commit(&inner, "inner.txt", "the only copy of this commit\n");
    let inner_tip = head(&inner, "HEAD");
    fs::write(ws.join("note.txt"), "also unsaved\n").unwrap();
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("separate Git project") && out.left[0].why.contains("vendor/lib"), "{:?}", out.left);
    assert_eq!(head(&ws, "HEAD"), tip, "nothing was committed");
    assert!(git_in(&ws, &["ls-files", "-s"]).lines().all(|l| !l.starts_with("160000")), "no link to the nested repository was staged");
    assert_eq!(git_in(&ws, &["diff", "--cached", "--name-only"]), "", "nothing at all was staged");
    assert!(ws.join("vendor").join("lib").join(".git").exists(), "the nested repository's own folder is intact");
    assert_eq!(head(&inner, "HEAD"), inner_tip, "and so is its history");
    assert!(ws.is_dir());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_new_link_to_another_repository_is_told_apart_from_an_edit_to_one() {
    assert_eq!(new_gitlink(":000000 160000 0000000000000000000000000000000000000000 1234567890123456789012345678901234567890 A\tvendor/lib"), Some("vendor/lib".to_string()));
    assert_eq!(new_gitlink(":160000 160000 1234567890123456789012345678901234567890 abcdefabcdefabcdefabcdefabcdefabcdefabcd M\tsub"), None, "a change inside a submodule already in the repository");
    assert_eq!(new_gitlink(":000000 100644 0000000000000000000000000000000000000000 1234567890123456789012345678901234567890 A\tnew.txt"), None);
    assert_eq!(new_gitlink("not a raw line"), None);
}

// ------------------------------------------------------------------ B3: hooks, signing, undo, marker, time

fn write_hook(repo: &Path, name: &str, mark: &Path) {
    let hooks = repo.join(".git").join("hooks");
    fs::create_dir_all(&hooks).unwrap();
    let file = hooks.join(name);
    fs::write(&file, format!("#!/bin/sh\necho {name} >> \"{}\"\nsleep 20\nexit 1\n", mark.to_string_lossy().replace('\\', "/"))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn a_hook_that_fails_or_hangs_is_skipped_for_the_quits_own_commits_and_merge() {
    let (base, repo, store) = repo("b3-hooks");
    crate::git::trust_for_test(&repo);
    let ws = workspace(&base, &repo, &store, "hook", true);
    commit(&repo, "d.txt", "main moved on\n"); // a merge commit is needed, so merge hooks matter too
    let mark = base.join("hook-ran.txt");
    for name in ["pre-commit", "commit-msg", "post-commit", "pre-merge-commit", "post-merge"] {
        write_hook(&repo, name, &mark);
    }
    // The control: the same hooks, run by an ordinary commit, do stop it (so the test can fail).
    let control = Instant::now();
    assert!(!git_try(&ws, &["commit", "-q", "--allow-empty", "-m", "control"]), "the failing hook stops an ordinary commit");
    assert!(mark.is_file(), "and it did run");
    let _ = fs::remove_file(&mark);
    assert!(control.elapsed() < Duration::from_secs(60));
    fs::write(ws.join("new.txt"), "unsaved\n").unwrap();
    let started = Instant::now();
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert!(!mark.exists(), "no hook ran: {}", fs::read_to_string(&mark).unwrap_or_default());
    assert!(started.elapsed() < Duration::from_secs(20), "a hook that sleeps was never waited for: {:?}", started.elapsed());
    assert!(repo.join("new.txt").is_file(), "the work reached main");
    assert_eq!(git_in(&repo, &["log", "-1", "--format=%s", "main"]), "Kolux: merge hook on quit");
    let saved = git_in(&repo, &["log", "-1", "--format=%B", "main^2"]);
    assert!(saved.starts_with(SAVE_MESSAGE) && saved.contains("hooks and commit signing are skipped"), "the commit says so: {saved}");
    assert!(git_in(&repo, &["log", "-1", "--format=%B", "main"]).contains("skipped"));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_repository_that_signs_commits_does_not_stop_the_quit() {
    let (base, repo, store) = repo("b3-gpg");
    crate::git::trust_for_test(&repo);
    git_in(&repo, &["config", "commit.gpgsign", "true"]);
    git_in(&repo, &["config", "tag.gpgsign", "true"]);
    git_in(&repo, &["config", "gpg.program", "kolux-no-such-signing-program"]);
    let ws = workspace(&base, &repo, &store, "signed", true);
    commit_unsigned(&ws, "b.txt");
    fs::write(ws.join("new.txt"), "unsaved\n").unwrap();
    assert!(!git_try(&ws, &["commit", "-q", "--allow-empty", "-m", "control"]), "the control: signing is on and cannot work");
    let started = Instant::now();
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert!(repo.join("b.txt").is_file() && repo.join("new.txt").is_file());
    assert!(!ws.exists());
    assert!(started.elapsed() < Duration::from_secs(60));
    let _ = fs::remove_dir_all(&base);
}

fn commit_unsigned(dir: &Path, file: &str) {
    fs::write(dir.join(file), "x\n").unwrap();
    git_in(dir, &["add", file]);
    git_in(dir, &["-c", "commit.gpgsign=false", "commit", "-q", "-m", file]);
}

#[test]
fn the_quits_git_writes_never_sign_never_prompt_and_look_for_hooks_in_an_empty_folder() {
    let (base, repo, _store) = repo("b3-write");
    let hooks = no_hooks(&data(&base)).unwrap();
    let c = clock();
    assert_eq!(write(&["config", "--get", "commit.gpgsign"], &repo, &c, &hooks).unwrap(), "false");
    assert_eq!(write(&["config", "--get", "tag.gpgsign"], &repo, &c, &hooks).unwrap(), "false");
    assert_eq!(write(&["config", "--get", "core.hooksPath"], &repo, &c, &hooks).unwrap(), hooks.to_string_lossy().replace('\\', "/"));
    assert_eq!(fs::read_dir(&hooks).unwrap().count(), 0, "the hooks folder is empty");
    assert_eq!(write(&["var", "GIT_EDITOR"], &repo, &c, &hooks).unwrap(), ":", "an editor that opens nothing and succeeds");
    let _ = fs::remove_dir_all(&base);
}

/// undo_merge on a real conflict: main is mid-merge with conflict markers, and goes back to how it was.
#[test]
fn undo_merge_puts_main_back_after_a_real_conflict_and_after_a_half_made_merge() {
    let (base, repo, store) = repo("b3-undo");
    let side = workspace(&base, &repo, &store, "side", true);
    commit(&side, "a.txt", "theirs\n");
    commit(&side, "c.txt", "c\n");
    commit(&repo, "a.txt", "ours\n");
    let before = head(&repo, "HEAD");
    let hooks = no_hooks(&data(&base)).unwrap();
    assert!(!git_try(&repo, &["merge", "--no-edit", "side"]), "the merge clashes and stops half way");
    assert!(repo.join(".git").join("MERGE_HEAD").exists() && !git_in(&repo, &["status", "--porcelain"]).is_empty());
    assert!(undo_merge(&repo, &before, &clock(), &hooks), "reported whole");
    assert_eq!(head(&repo, "HEAD"), before);
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(!repo.join(".git").join("MERGE_HEAD").exists());
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap().trim(), "ours");
    // A merge cut after its changes were staged but before it committed (HEAD still at `before`).
    git_in(&side, &["checkout", "-q", "HEAD~2", "--", "a.txt"]);
    git_in(&side, &["commit", "-q", "-m", "undo the clash"]);
    assert!(git_try(&repo, &["merge", "--no-commit", "--no-ff", "side"]), "a clean merge, held before its commit");
    assert!(repo.join(".git").join("MERGE_HEAD").exists() && repo.join("c.txt").exists());
    assert!(undo_merge(&repo, &before, &clock(), &hooks));
    assert_eq!((head(&repo, "HEAD"), git_in(&repo, &["status", "--porcelain"])), (before, String::new()));
    assert!(!repo.join("c.txt").exists(), "what the merge brought in went away again");
    let _ = fs::remove_dir_all(&base);
}

/// The same, through the real path: an old Git (no merge prediction) tries the merge, it clashes, and the undo runs.
#[test]
fn a_merge_that_clashes_for_real_is_undone_and_the_marker_cleared() {
    let (base, repo, store) = repo("b3-real-clash");
    let ws = workspace(&base, &repo, &store, "clash", true);
    commit(&ws, "a.txt", "theirs\n");
    commit(&repo, "a.txt", "ours\n");
    let before = head(&repo, "HEAD");
    let old = Git { version: "git version 2.30.0".into() };
    let out = run(&old, &store, &Terminals::default(), clock(), &data(&base));
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("could not be merged"), "{:?}", out.left);
    assert!(!out.left[0].why.contains("look at it"), "main was put back whole: {:?}", out.left);
    assert_eq!(head(&repo, "HEAD"), before);
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(!repo.join(".git").join("MERGE_HEAD").exists());
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap().trim(), "ours");
    assert!(!marker_file(&base).exists(), "an undone merge leaves no marker");
    assert!(ws.is_dir() && branch_exists(&repo, "clash"));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_merge_git_refuses_to_start_leaves_main_and_its_untracked_files_alone() {
    let (base, repo, store) = repo("b3-untracked");
    let ws = workspace(&base, &repo, &store, "over", true);
    commit(&ws, "c.txt", "from the workspace\n");
    commit(&repo, "d.txt", "d\n");
    fs::write(repo.join("c.txt"), "mine, never committed\n").unwrap();
    let before = head(&repo, "HEAD");
    let out = tidy(&base, &store);
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("could not be merged"), "{:?}", out.left);
    assert_eq!(head(&repo, "HEAD"), before);
    assert_eq!(fs::read_to_string(repo.join("c.txt")).unwrap(), "mine, never committed\n", "the untracked file in main is untouched");
    assert!(!marker_file(&base).exists());
    assert!(ws.is_dir());
    let _ = fs::remove_dir_all(&base);
}

fn half_merged_main(base: &Path, repo: &Path, store: &Mutex<Store>) -> String {
    let side = workspace(base, repo, store, "side", true);
    commit(&side, "c.txt", "c\n");
    commit(repo, "d.txt", "d\n");
    let before = head(repo, "HEAD");
    assert!(git_try(repo, &["merge", "--no-commit", "--no-ff", "side"]), "a merge held before its commit: what a cut leaves");
    assert!(repo.join(".git").join("MERGE_HEAD").exists());
    before
}

fn marker_for(repo: &Path, before: &str, time: u64) -> Marker {
    let theirs_sha = Command::new("git").args(["rev-parse", "-q", "--verify", "refs/heads/side"]).current_dir(repo).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    Marker { main_dir: repo.display().to_string(), before_sha: before.to_string(), branch: "side".into(), theirs_sha, time }
}

#[test]
fn a_marker_left_by_a_cut_merge_puts_main_back_at_the_next_start() {
    let (base, repo, store) = repo("b3-recover");
    let before = half_merged_main(&base, &repo, &store);
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("put the folder back the way it was"), "{notes:?}");
    assert_eq!(head(&repo, "HEAD"), before);
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "", "main is clean again");
    assert!(!repo.join(".git").join("MERGE_HEAD").exists() && !repo.join("c.txt").exists());
    assert!(!marker_file(&base).exists(), "the marker is cleared");
    assert!(recover_at_start(&data(&base)).is_empty(), "and told once");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_leftover_index_lock_from_the_cut_run_is_removed_during_recovery() {
    let (base, repo, store) = repo("b3-lock");
    let before = half_merged_main(&base, &repo, &store);
    let lock = repo.join(".git").join("index.lock");
    fs::write(&lock, "").unwrap();
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("put the folder back"), "{notes:?}");
    assert!(!lock.exists(), "the dead run's lock is gone");
    assert_eq!((head(&repo, "HEAD"), git_in(&repo, &["status", "--porcelain"])), (before, String::new()));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_lock_newer_than_the_merge_could_have_made_is_left_for_the_user() {
    let (base, repo, store) = repo("b3-new-lock");
    let before = half_merged_main(&base, &repo, &store);
    let lock = repo.join(".git").join("index.lock");
    fs::write(&lock, "").unwrap();
    // The merge began long ago: a lock made now is somebody else's.
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs() - 3600)).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("look at it"), "{notes:?}");
    assert!(lock.exists(), "another program's lock is not removed");
    assert!(repo.join(".git").join("MERGE_HEAD").exists(), "and nothing else was touched");
    assert!(!marker_file(&base).exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_marker_whose_merge_finished_or_never_began_changes_nothing() {
    let (base, repo, _store) = repo("b3-finished");
    let before = head(&repo, "HEAD");
    // Never began: HEAD is at the marker's sha, clean, no lock.
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    assert!(recover_at_start(&data(&base)).is_empty());
    assert!(!marker_file(&base).exists());
    // Finished: main moved on, and has uncommitted work of the user's own.
    commit(&repo, "d.txt", "d\n");
    fs::write(repo.join("a.txt"), "the user's edit\n").unwrap();
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    assert!(recover_at_start(&data(&base)).is_empty());
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "the user's edit\n", "nothing was reset");
    assert!(!marker_file(&base).exists());
    // A marker nobody can read is dropped.
    fs::create_dir_all(data(&base)).unwrap();
    fs::write(marker_file(&base), "{ not json").unwrap();
    assert!(recover_at_start(&data(&base)).is_empty());
    assert!(!marker_file(&base).exists());
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ F1: recovery never costs the user's own work

/// Main with a `side` branch that is one commit ahead (c.txt), HEAD untouched: what a merge killed before it touched main leaves.
fn untouched_main(base: &Path, repo: &Path, store: &Mutex<Store>) -> String {
    let side = workspace(base, repo, store, "side", true);
    commit(&side, "c.txt", "c\n");
    head(repo, "HEAD")
}

/// The user stages an edit of a tracked file and a brand new file in main.
fn stage_users_work(repo: &Path) {
    fs::write(repo.join("a.txt"), "the user's staged edit\n").unwrap();
    fs::write(repo.join("mine.txt"), "the user's new file\n").unwrap();
    git_in(repo, &["add", "a.txt", "mine.txt"]);
}

fn users_work_is_intact(repo: &Path) {
    assert_eq!(git_in(repo, &["status", "--porcelain"]), "M  a.txt\nA  mine.txt", "still staged, as the user left it");
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "the user's staged edit\n");
    assert_eq!(fs::read_to_string(repo.join("mine.txt")).unwrap(), "the user's new file\n");
}

#[test]
fn a_leftover_marker_with_main_untouched_never_wipes_what_the_user_staged_since() {
    let (base, repo, store) = repo("f1-leftover");
    let before = untouched_main(&base, &repo, &store);
    // The marker outlived its merge (killed before main was touched, or before the marker was cleared).
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    stage_users_work(&repo);
    let notes = recover_at_start(&data(&base));
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("look at the main folder"), "{notes:?}");
    users_work_is_intact(&repo);
    assert_eq!(head(&repo, "HEAD"), before);
    assert!(!marker_file(&base).exists(), "the marker is cleared all the same");
    // Clean main: nothing to say.
    git_in(&repo, &["reset", "-q", "--hard"]);
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    assert!(recover_at_start(&data(&base)).is_empty());
    let _ = fs::remove_dir_all(&base);
}

/// Opens the `side` merge in main again (after a reset undid it).
fn half_merge_again(repo: &Path) -> String {
    let before = head(repo, "HEAD");
    assert!(git_try(repo, &["merge", "--no-commit", "--no-ff", "side"]));
    before
}

#[test]
fn an_open_merge_is_reset_only_for_the_marked_tip_and_never_over_work_it_did_not_make() {
    let (base, repo, store) = repo("f1-unrelated");
    let before = half_merged_main(&base, &repo, &store);
    // The user's own staged file sits beside the merge's changes.
    fs::write(repo.join("mine.txt"), "the user's new file\n").unwrap();
    git_in(&repo, &["add", "mine.txt"]);
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("look at the main folder"), "{notes:?}");
    assert!(repo.join(".git").join("MERGE_HEAD").exists(), "nothing was reset");
    assert!(git_in(&repo, &["status", "--porcelain"]).contains("A  mine.txt") && repo.join("c.txt").exists());
    assert_eq!(fs::read_to_string(repo.join("mine.txt")).unwrap(), "the user's new file\n");
    assert!(!marker_file(&base).exists());
    // Without the user's file the same half-merge is put back, as in the real-recovery test.
    git_in(&repo, &["rm", "-q", "-f", "mine.txt"]);
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("put the folder back"), "{notes:?}");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    // An open merge of some other commit than the marked one is not touched either.
    let before2 = half_merge_again(&repo);
    let mut other = marker_for(&repo, &before2, now_secs());
    other.theirs_sha = Some(before2.clone());
    note_merge(&data(&base), &other).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("not the one Kolux began"), "{notes:?}");
    assert!(repo.join(".git").join("MERGE_HEAD").exists(), "still open: it is not this marker's merge");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_marker_without_the_branch_tip_never_resets_anything() {
    let (base, repo, store) = repo("f1-old-marker");
    let before = half_merged_main(&base, &repo, &store);
    // The marker as an older Kolux wrote it: no tip.
    let old = serde_json::json!({ "mainDir": repo.display().to_string(), "beforeSha": before, "branch": "side", "time": now_secs() }).to_string();
    fs::create_dir_all(data(&base)).unwrap();
    fs::write(marker_file(&base), &old).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("look at the main folder"), "{notes:?}");
    assert!(repo.join(".git").join("MERGE_HEAD").exists() && repo.join("c.txt").exists(), "the half merge is left as it is");
    assert!(!marker_file(&base).exists());
    // Nor with no merge open and the user's staged work.
    git_in(&repo, &["merge", "--abort"]);
    stage_users_work(&repo);
    fs::write(marker_file(&base), &old).unwrap();
    assert_eq!(recover_at_start(&data(&base)).len(), 1);
    users_work_is_intact(&repo);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn the_dead_runs_own_lock_is_cleared_only_where_every_changed_path_is_the_merges() {
    let (base, repo, store) = repo("f1-lock");
    let before = untouched_main(&base, &repo, &store);
    // A fast-forward killed with its files written and the index not yet moved: c.txt staged from side, lock left.
    git_in(&repo, &["checkout", "-q", "side", "--", "c.txt"]);
    let lock = repo.join(".git").join("index.lock");
    fs::write(&lock, "").unwrap();
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("put the folder back"), "{notes:?}");
    assert!(!lock.exists() && !repo.join("c.txt").exists(), "lock gone, the merge's file put back");
    assert_eq!((head(&repo, "HEAD"), git_in(&repo, &["status", "--porcelain"])), (before.clone(), String::new()));
    // The same lock with the user's own staged work in the folder: nothing is touched, not even the lock.
    git_in(&repo, &["checkout", "-q", "side", "--", "c.txt"]);
    stage_users_work(&repo);
    fs::write(&lock, "").unwrap();
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    let notes = recover_at_start(&data(&base));
    assert!(notes.len() == 1 && notes[0].contains("look at the main folder"), "{notes:?}");
    assert!(lock.exists() && repo.join("c.txt").exists());
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "the user's staged edit\n");
    assert_eq!(fs::read_to_string(repo.join("mine.txt")).unwrap(), "the user's new file\n");
    // Only the lock left (nothing changed): it goes quietly.
    fs::remove_file(&lock).unwrap();
    git_in(&repo, &["reset", "-q", "--hard"]);
    fs::write(&lock, "").unwrap();
    note_merge(&data(&base), &marker_for(&repo, &before, now_secs())).unwrap();
    assert!(recover_at_start(&data(&base)).is_empty());
    assert!(!lock.exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn the_marker_names_the_main_folder_the_sha_before_and_the_branch() {
    let base = temp("b3-marker-shape");
    note_merge(&data(&base), &Marker { main_dir: "C:/p".into(), before_sha: "abc".into(), branch: "fix".into(), theirs_sha: Some("def".into()), time: 7 }).unwrap();
    let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(marker_file(&base)).unwrap()).unwrap();
    assert_eq!(json, serde_json::json!({ "mainDir": "C:/p", "beforeSha": "abc", "branch": "fix", "theirsSha": "def", "time": 7 }));
    // A marker written before the tip was noted still reads, with no tip.
    fs::write(marker_file(&base), r#"{"mainDir":"C:/p","beforeSha":"abc","branch":"fix","time":7}"#).unwrap();
    assert_eq!(read_marker(&data(&base)).unwrap().theirs_sha, None);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_merge_is_not_started_without_room_before_the_hard_cap_and_nothing_is_saved_for_it() {
    let (base, repo, store) = repo("b3-hard");
    let ws = workspace(&base, &repo, &store, "late", true);
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join("x.txt"), "unsaved\n").unwrap();
    let before = head(&repo, "main");
    let tip = head(&ws, "HEAD");
    let soon = Clock::with_hard(Instant::now() + Duration::from_secs(120), Instant::now() + MERGE_MIN - Duration::from_secs(2));
    assert!(soon.may_start() && !soon.may_merge());
    let out = run(&Git::detect().unwrap(), &store, &Terminals::default(), soon, &data(&base));
    assert_eq!(reasons(&out), vec![OUT_OF_TIME.to_string()], "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(head(&ws, "HEAD"), tip, "no saved-on-quit commit either");
    assert!(git_in(&ws, &["status", "--porcelain"]).contains("x.txt"));
    assert!(!marker_file(&base).exists());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn the_write_limit_follows_the_hard_cap_and_never_runs_out() {
    let now = Instant::now();
    let c = Clock::with_hard(now + Duration::from_secs(5), now + Duration::from_secs(20));
    assert!(c.write_limit() > Duration::from_secs(15) && c.write_limit() <= Duration::from_secs(19), "{:?}", c.write_limit());
    let spent = Clock::with_hard(now, now);
    assert_eq!(spent.write_limit(), Duration::from_secs(2), "a floor, so a started step gets a fair try");
    assert!(!spent.may_merge() && !spent.may_start());
}

// ------------------------------------------------------------------ m3: the busy flag and the quit's wait

#[test]
fn a_panic_during_a_merge_still_clears_the_busy_flag() {
    let counter = AtomicUsize::new(0);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _busy = Busy::on(&counter);
        assert_eq!(counter.load(Ordering::SeqCst), 1);
        panic!("the merge blew up");
    }));
    assert!(result.is_err());
    assert_eq!(counter.load(Ordering::SeqCst), 0, "the quit is not held for a merge that is gone");
}

#[test]
fn the_quits_wait_ends_at_once_when_the_merge_thread_is_done_or_gone() {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    drop(tx); // a thread that panicked drops its sender
    let started = Instant::now();
    assert!(wait_for_merge(&rx, Duration::from_secs(5), Instant::now() + Duration::from_secs(30), || true), "a closed channel is the end");
    assert!(started.elapsed() < Duration::from_secs(2), "no spinning, no waiting: {:?}", started.elapsed());
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    tx.send(()).unwrap();
    assert!(wait_for_merge(&rx, Duration::from_secs(5), Instant::now() + Duration::from_secs(30), || true));
}

#[test]
fn the_quits_wait_goes_past_its_budget_only_while_a_merge_runs_and_never_past_the_hard_cap() {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let started = Instant::now();
    assert!(!wait_for_merge(&rx, Duration::from_millis(100), started + Duration::from_millis(700), || true), "a merge that never ends is given up on at the cap");
    let took = started.elapsed();
    assert!(took >= Duration::from_millis(700) && took < Duration::from_secs(5), "{took:?}");
    let started = Instant::now();
    assert!(!wait_for_merge(&rx, Duration::from_millis(100), started + Duration::from_secs(30), || false), "nothing under way: the budget is the whole wait");
    assert!(started.elapsed() < Duration::from_secs(5));
    let sender = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let _ = tx.send(());
    });
    assert!(wait_for_merge(&rx, Duration::from_millis(50), Instant::now() + Duration::from_secs(30), || true), "a merge that ends inside the cap is waited for");
    sender.join().unwrap();
}

// ------------------------------------------------------------------ m1: what is known is saved as the quit goes

#[test]
fn what_the_quit_knows_is_saved_before_each_workspace_so_a_cut_quit_still_leaves_the_notice() {
    let (base, repo, store) = repo("m1");
    let a = workspace(&base, &repo, &store, "aa", true);
    commit(&a, "b.txt", "b\n");
    let b = workspace(&base, &repo, &store, "bb", true);
    commit(&b, "c.txt", "c\n");
    let mut seen: Vec<(usize, usize)> = Vec::new();
    let mut first_notes: Vec<String> = Vec::new();
    let out = {
        let mut progress = |out: &Outcome| {
            seen.push((out.left.len(), out.removed.len()));
            if seen.len() == 1 {
                save_outcome(&store.lock().unwrap(), out).unwrap();
                first_notes = take_notes(&store.lock().unwrap());
            }
        };
        run_with(&Git::detect().unwrap(), &store, &Terminals::default(), clock(), &data(&base), &mut progress)
    };
    assert_eq!(seen, vec![(1, 0), (0, 1), (1, 1), (0, 2)], "before and after each workspace");
    assert!(first_notes.iter().any(|n| n.contains(WAS_CUT)), "a quit cut during the first workspace names it at the next start: {first_notes:?}");
    assert!(out.left.is_empty(), "{:?}", out.left);
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ M5: secrets and very large new files

#[test]
fn a_workspace_with_a_new_secret_looking_or_very_large_file_is_kept_and_nothing_is_committed() {
    let (base, repo, store) = repo("m5");
    let names = [".env", ".env.production", "server.pem", "deploy.key", "id_rsa", "id_ed25519.pub", "aws-credentials.json", "my-secrets.txt"];
    let mut spaces = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let ws = workspace(&base, &repo, &store, &format!("s{i}"), true);
        fs::write(ws.join("fine.txt"), "fine\n").unwrap();
        fs::write(ws.join(name), "TOKEN=abc\n").unwrap();
        spaces.push((ws, *name));
    }
    let big = workspace(&base, &repo, &store, "big", true);
    fs::write(big.join("dump.bin"), vec![0u8; 21 * 1024 * 1024]).unwrap();
    let before = head(&repo, "main");
    let out = tidy(&base, &store);
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(out.left.len(), names.len() + 1, "{:?}", out.left);
    for (ws, name) in &spaces {
        let left = out.left.iter().find(|l| Path::new(&l.path) == ws.as_path()).unwrap_or_else(|| panic!("{name} was not kept"));
        assert!(left.why.contains("password or key") && left.why.contains(name), "{name}: {}", left.why);
        assert!(ws.join(name).is_file() && ws.join("fine.txt").is_file());
        assert_eq!(git_in(ws, &["log", "--oneline", "-1", "--format=%s"]), "first", "{name}: nothing was committed");
        assert_eq!(git_in(ws, &["diff", "--cached", "--name-only"]), "", "{name}: nothing was staged");
    }
    let left = out.left.iter().find(|l| Path::new(&l.path) == big.as_path()).unwrap();
    assert!(left.why.contains("very large new file") && left.why.contains("dump.bin") && left.why.contains("21 MB"), "{}", left.why);
    assert_eq!(git_in(&big, &["diff", "--cached", "--name-only"]), "");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_tracked_file_that_was_edited_and_ordinary_new_files_are_saved_as_before() {
    let (base, repo, store) = repo("m5-ok");
    let ws = workspace(&base, &repo, &store, "fine", true);
    fs::write(ws.join("src.rs"), "fn main() {}\n").unwrap();
    fs::write(ws.join("keyboard.txt"), "not a secret: the word is key only in the middle\n").unwrap();
    fs::write(ws.join("monkey-notes.txt"), "no\n").unwrap();
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert!(repo.join("src.rs").is_file() && repo.join("keyboard.txt").is_file() && repo.join("monkey-notes.txt").is_file());
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ M6: which branch the merge goes into

#[test]
fn the_merge_goes_into_origins_head_branch_and_nothing_else() {
    let (base, repo, store) = repo("m6-origin-head");
    git_in(&repo, &["branch", "develop"]);
    git_in(&repo, &["checkout", "-q", "develop"]);
    git_in(&repo, &["update-ref", "refs/remotes/origin/develop", "develop"]);
    git_in(&repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"]);
    let ws = workspace(&base, &repo, &store, "feat", true);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let main_before = head(&repo, "main");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(head(&repo, "develop"), tip, "origin's HEAD names develop");
    assert_eq!(head(&repo, "main"), main_before, "and main is not what it merged into");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_main_checkout_that_is_on_some_other_branch_is_never_merged_into() {
    let (base, repo, store) = repo("m6-elsewhere");
    git_in(&repo, &["checkout", "-q", "-b", "feature"]);
    let ws = workspace(&base, &repo, &store, "feat", true);
    commit(&ws, "b.txt", "b\n");
    let (feature, main) = (head(&repo, "feature"), head(&repo, "main"));
    let out = tidy(&base, &store);
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("on feature, not main"), "{:?}", out.left);
    assert_eq!((head(&repo, "feature"), head(&repo, "main")), (feature, main), "neither branch moved");
    assert!(ws.is_dir());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_project_with_no_main_master_or_origin_head_keeps_its_workspaces() {
    let (base, repo, store) = repo("m6-none");
    git_in(&repo, &["branch", "-m", "main", "trunk"]);
    let ws = workspace(&base, &repo, &store, "feat", true);
    commit(&ws, "b.txt", "b\n");
    let trunk = head(&repo, "trunk");
    let out = tidy(&base, &store);
    assert_eq!(reasons(&out), vec![NO_MAIN.to_string()], "{out:?}");
    assert_eq!(head(&repo, "trunk"), trunk);
    assert!(ws.is_dir());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn master_is_the_target_when_there_is_no_main() {
    let (base, repo, store) = repo("m6-master");
    git_in(&repo, &["branch", "-m", "main", "master"]);
    let ws = workspace(&base, &repo, &store, "feat", true);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!(head(&repo, "master"), tip);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn a_project_base_that_names_a_local_branch_is_the_target_and_one_that_does_not_is_ignored() {
    let (base, repo, _store) = repo("m6-base");
    git_in(&repo, &["branch", "develop"]);
    let project = |b: Option<&str>| Project { id: "p".into(), name: "r".into(), path: repo.display().to_string(), workspaces_dir: None, base: b.map(String::from), display_name: None };
    let c = clock();
    assert_eq!(target_branch(&repo, &project(None), &c).as_deref(), Some("main"));
    assert_eq!(target_branch(&repo, &project(Some("develop")), &c).as_deref(), Some("develop"));
    assert_eq!(target_branch(&repo, &project(Some("origin/develop")), &c).as_deref(), Some("develop"), "a remote spelling names the local branch");
    assert_eq!(target_branch(&repo, &project(Some("no-such-branch")), &c).as_deref(), Some("main"));
    assert_eq!(target_branch(&repo, &project(Some("  ")), &c).as_deref(), Some("main"));
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ M7: ignored local files that removal would delete

/// A workspace whose own commit makes the usual local files ignored.
fn ignoring(base: &Path, repo: &Path, store: &Mutex<Store>, name: &str) -> PathBuf {
    let ws = workspace(base, repo, store, name, true);
    commit(&ws, ".gitignore", "*.log\n.env*\n*.db\n*.sqlite\n*.local.*\nCLAUDE.local.md\ndata/\nnode_modules/\ntarget/\ndist/\n");
    ws
}

#[test]
fn ignored_local_settings_secrets_and_data_keep_the_workspace_and_build_output_does_not() {
    let (base, repo, store) = repo("m7");
    let env = ignoring(&base, &repo, &store, "has-env");
    fs::write(env.join(".env"), "TOKEN=1\n").unwrap();
    let data_dir = ignoring(&base, &repo, &store, "has-data");
    fs::create_dir_all(data_dir.join("data").join("nested")).unwrap();
    fs::write(data_dir.join("data").join("nested").join("app.sqlite"), "db").unwrap();
    let claude = ignoring(&base, &repo, &store, "has-claude");
    fs::write(claude.join("CLAUDE.local.md"), "mine\n").unwrap();
    let nested = ignoring(&base, &repo, &store, "has-nested");
    fs::create_dir_all(nested.join("pkg")).unwrap();
    fs::write(nested.join("pkg").join("settings.local.json"), "{}").unwrap();
    let builds = ignoring(&base, &repo, &store, "only-builds");
    for (dir, file) in [("node_modules/pkg", ".env"), ("target/debug", "app.db"), ("dist", "x.local.json"), ("packages/a/node_modules/b", ".env.local")] {
        let d = builds.join(dir);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(file), "x").unwrap();
    }
    fs::write(builds.join("noise.log"), "ignored\n").unwrap();
    let main_before = head(&repo, "main");
    let out = tidy(&base, &store);
    for (ws, file) in [(&env, ".env"), (&data_dir, "app.sqlite"), (&claude, "CLAUDE.local.md"), (&nested, "settings.local.json")] {
        let left = out.left.iter().find(|l| Path::new(&l.path) == ws.as_path()).unwrap_or_else(|| panic!("{file}: not kept: {out:?}"));
        assert!(left.why.contains("ignored file") && left.why.contains(file) && left.why.contains("would delete"), "{file}: {}", left.why);
        assert!(ws.is_dir(), "{file}: the workspace and the file stay");
    }
    assert!(env.join(".env").is_file() && claude.join("CLAUDE.local.md").is_file());
    assert_eq!(out.left.len(), 4, "{:?}", out.left);
    assert_eq!(out.removed.len(), 1, "{out:?}");
    assert!(!builds.exists(), "ignored build output and dependencies are deleted with a merged workspace");
    assert_ne!(head(&repo, "main"), main_before, "the one that went was merged");
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ F2: a separate Git project inside an ignored folder

/// A Git project of its own, with one commit that exists nowhere else.
fn nested_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    git_in(dir, &["init", "-q", "-b", "main"]);
    git_in(dir, &["config", "user.email", "t@example.com"]);
    git_in(dir, &["config", "user.name", "t"]);
    fs::write(dir.join("lib.txt"), "the only copy\n").unwrap();
    git_in(dir, &["add", "."]);
    git_in(dir, &["commit", "-q", "-m", "only copy"]);
}

/// A workspace whose own commit sets its .gitignore.
fn ignoring_text(base: &Path, repo: &Path, store: &Mutex<Store>, name: &str, gitignore: &str) -> PathBuf {
    let ws = workspace(base, repo, store, name, true);
    commit(&ws, ".gitignore", gitignore);
    ws
}

#[test]
fn an_ignored_folder_holding_a_separate_git_project_keeps_the_workspace_and_its_commits() {
    let (base, repo, store) = repo("f2");
    let vendor = ignoring_text(&base, &repo, &store, "has-vendor", "vendor/\n");
    nested_repo(&vendor.join("vendor").join("lib"));
    let deep = ignoring_text(&base, &repo, &store, "has-deep", "data/\n");
    nested_repo(&deep.join("data").join("a").join("b").join("proj"));
    let dep = ignoring_text(&base, &repo, &store, "has-dep", "node_modules/\n");
    nested_repo(&dep.join("node_modules").join("dep"));
    let scoped = ignoring_text(&base, &repo, &store, "has-scoped", "node_modules/\n");
    nested_repo(&scoped.join("node_modules").join("@org").join("pkg"));
    let gitfile = ignoring_text(&base, &repo, &store, "has-gitfile", "vendor/\n");
    fs::create_dir_all(gitfile.join("vendor").join("sub")).unwrap();
    fs::write(gitfile.join("vendor").join("sub").join(".git"), "gitdir: ../../elsewhere\n").unwrap();
    // Ignored folders without a Git project in them are deleted as before.
    let plain = ignoring_text(&base, &repo, &store, "plain", "vendor/\nnode_modules/\n");
    fs::create_dir_all(plain.join("vendor").join("lib")).unwrap();
    fs::write(plain.join("vendor").join("lib").join("x.go"), "package x\n").unwrap();
    fs::create_dir_all(plain.join("node_modules").join("x")).unwrap();
    fs::write(plain.join("node_modules").join("x").join("index.js"), "1\n").unwrap();
    let out = tidy(&base, &store);
    for (ws, at) in [(&vendor, "vendor/lib"), (&deep, "data/a/b/proj"), (&dep, "node_modules/dep"), (&scoped, "node_modules/@org/pkg"), (&gitfile, "vendor/sub")] {
        let left = out.left.iter().find(|l| Path::new(&l.path) == ws.as_path()).unwrap_or_else(|| panic!("{at}: not kept: {out:?}"));
        assert!(left.why.contains("separate Git project") && left.why.contains(&format!("({at})")) && left.why.contains("would delete"), "{at}: {}", left.why);
        assert!(ws.is_dir() && branch_exists(&repo, ws.file_name().unwrap().to_str().unwrap()), "{at}: workspace and branch stay");
    }
    let log = git_in(&vendor.join("vendor").join("lib"), &["log", "--oneline"]);
    assert!(log.contains("only copy"), "the nested project's commit is still there: {log}");
    assert_eq!(out.left.len(), 5, "{:?}", out.left);
    assert_eq!(out.removed.len(), 1, "{out:?}");
    assert!(!plain.exists());
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ F3: files the include file copied from main are no loss

#[test]
fn files_the_include_file_copied_from_main_keep_the_workspace_only_when_they_changed() {
    let (base, repo, store) = repo("f3");
    fs::write(repo.join(".gitignore"), "*.log\n.env\n*.local.json\n").unwrap();
    fs::write(repo.join(".worktreeinclude"), ".env\nconfig/app.local.json\n").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "ignore and include the local files"]);
    fs::create_dir_all(repo.join("config")).unwrap();
    fs::write(repo.join(".env"), "TOKEN=1\n").unwrap();
    fs::write(repo.join("config").join("app.local.json"), "{\"a\":1}\n").unwrap();
    let made = |name: &str| {
        let ws = workspace(&base, &repo, &store, name, true);
        let warnings = crate::include::bring_along(&repo, &ws);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(ws.join(".env").is_file() && ws.join("config").join("app.local.json").is_file(), "the include file copied both");
        commit(&ws, &format!("{name}.txt"), "new\n");
        ws
    };
    let same = made("same");
    let env = made("env-edited");
    fs::write(env.join(".env"), "TOKEN=2\n").unwrap();
    let nested = made("nested-edited");
    fs::write(nested.join("config").join("app.local.json"), "{\"a\":2}\n").unwrap();
    let longer = made("longer");
    fs::write(longer.join(".env"), "TOKEN=1\nMORE=1\n").unwrap();
    // A local file main does not have is the workspace's own, whatever its name is.
    let own = made("own");
    fs::write(own.join("other.local.json"), "{}\n").unwrap();
    let out = tidy(&base, &store);
    assert_eq!(out.removed.iter().filter(|p| Path::new(p.as_str()) == same.as_path()).count(), 1, "unchanged copies: merged and removed: {out:?}");
    assert!(!same.exists() && out.merged.iter().any(|p| Path::new(p.as_str()) == same.as_path()));
    for (ws, file) in [(&env, ".env"), (&nested, "app.local.json"), (&longer, ".env"), (&own, "other.local.json")] {
        let left = out.left.iter().find(|l| Path::new(&l.path) == ws.as_path()).unwrap_or_else(|| panic!("{file}: not kept: {out:?}"));
        assert!(left.why.contains("ignored file") && left.why.contains(file), "{file}: {}", left.why);
        assert!(ws.is_dir());
    }
    let _ = fs::remove_dir_all(&base);
}

/// The same workspace once main's copy has changed since the workspace was made: kept.
#[test]
fn a_copy_of_a_file_main_has_since_changed_keeps_the_workspace() {
    let (base, repo, store) = repo("f3-main-changed");
    fs::write(repo.join(".gitignore"), ".env\n").unwrap();
    fs::write(repo.join(".worktreeinclude"), ".env\n").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "include"]);
    fs::write(repo.join(".env"), "TOKEN=1\n").unwrap();
    let ws = workspace(&base, &repo, &store, "stale", true);
    assert!(crate::include::bring_along(&repo, &ws).is_empty());
    commit(&ws, "s.txt", "s\n");
    fs::write(repo.join(".env"), "TOKEN=changed in main\n").unwrap();
    let out = tidy(&base, &store);
    assert!(out.left.len() == 1 && out.left[0].why.contains(".env"), "{out:?}");
    assert!(ws.is_dir());
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ m4: a folder that is itself a project is not a workspace

#[test]
fn a_workspace_folder_the_user_also_opened_as_a_project_is_left_alone() {
    let (base, repo, store) = repo("m4");
    let ws = workspace(&base, &repo, &store, "opened", true);
    commit(&ws, "b.txt", "b\n");
    let project = |id: &str, path: &Path| Project { id: id.into(), name: id.into(), path: path.display().to_string(), workspaces_dir: None, base: None, display_name: None };
    projects::save_projects(&store.lock().unwrap(), &[project("main", &repo), project("opened", &ws)]).unwrap();
    let before = head(&repo, "main");
    let out = tidy(&base, &store);
    assert!(out.left.is_empty() && out.removed.is_empty() && out.merged.is_empty(), "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert!(ws.is_dir() && branch_exists(&repo, "opened"));
    let _ = fs::remove_dir_all(&base);
}

// ------------------------------------------------------------------ m6: .worktrees is excluded once

#[test]
fn the_worktrees_exclude_line_is_written_once_even_from_several_threads() {
    let (base, repo, _store) = repo("m6-exclude");
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let repo = repo.clone();
            std::thread::spawn(move || projects::ensure_excluded(&repo).unwrap())
        })
        .collect();
    let added = threads.into_iter().map(|t| t.join().unwrap()).filter(|a| *a).count();
    assert_eq!(added, 1, "one caller wrote the line");
    assert!(!projects::ensure_excluded(&repo).unwrap());
    let text = fs::read_to_string(repo.join(".git").join("info").join("exclude")).unwrap();
    assert_eq!(text.lines().filter(|l| l.trim() == "/.worktrees/").count(), 1, "{text}");
    // A line already there in another spelling is respected.
    let (base2, repo2, _s2) = repo_with_exclude("m6-exclude-had", ".worktrees\n");
    assert!(!projects::ensure_excluded(&repo2).unwrap());
    assert_eq!(fs::read_to_string(repo2.join(".git").join("info").join("exclude")).unwrap(), ".worktrees\n");
    let _ = fs::remove_dir_all(&base);
    let _ = fs::remove_dir_all(&base2);
}

fn repo_with_exclude(name: &str, text: &str) -> (PathBuf, PathBuf, Mutex<Store>) {
    let (base, repo, store) = repo(name);
    fs::create_dir_all(repo.join(".git").join("info")).unwrap();
    fs::write(repo.join(".git").join("info").join("exclude"), text).unwrap();
    (base, repo, store)
}
