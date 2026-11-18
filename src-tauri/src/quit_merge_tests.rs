use super::*;
use crate::projects::set_origin;
use std::fs;
use std::process::Command;

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

fn tidy(store: &Mutex<Store>) -> Outcome {
    run(&Git::detect().unwrap(), store, &Terminals::default(), Clock::until(Instant::now() + Duration::from_secs(120)))
}

#[test]
fn a_clean_branch_is_fast_forwarded_into_main_and_its_workspace_goes() {
    let (base, repo, store) = repo("ff");
    let ws = workspace(&base, &repo, &store, "ff", true);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let out = tidy(&store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert_eq!(head(&repo, "main"), tip, "a fast-forward: main is at the branch's tip, no merge commit");
    assert!(!ws.exists(), "the workspace folder is gone");
    assert!(!branch_exists(&repo, "ff"), "its branch went with it: every commit is in main");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn uncommitted_work_is_committed_merged_and_removed_with_ignored_files_left_out() {
    let (base, repo, store) = repo("dirty-ws");
    let ws = workspace(&base, &repo, &store, "wip", true);
    fs::write(ws.join("a.txt"), "a changed\n").unwrap();
    fs::write(ws.join("new.txt"), "untracked\n").unwrap();
    fs::write(ws.join("noise.log"), "ignored\n").unwrap();
    let out = tidy(&store);
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
    let out = tidy(&store);
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
    let out = tidy(&store);
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
    let out = tidy(&store);
    assert_eq!(head(&repo, "HEAD"), before, "nothing merged");
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "edited in main\n", "main's own change is untouched");
    assert_eq!(out.left.len(), 1, "{:?}", out.left);
    assert!(out.left[0].why.contains("not committed"), "{:?}", out.left);
    assert!(ws.is_dir() && branch_exists(&repo, "work"));
    assert!(!empty.exists(), "a workspace with nothing new goes even so: nothing of it is lost");
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
    let out = tidy(&store);
    assert!(out.left.is_empty() && out.removed.is_empty() && out.merged.is_empty(), "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(head(&theirs, "HEAD"), tip, "no commit was made in it");
    assert!(theirs.join("loose.txt").is_file() && branch_exists(&repo, "theirs"));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn locked_detached_and_opened_on_a_branch_workspaces_stay() {
    let (base, repo, store) = repo("kept");
    let locked = workspace(&base, &repo, &store, "locked", true);
    commit(&locked, "b.txt", "b\n");
    git_in(&repo, &["worktree", "lock", &locked.to_string_lossy()]);
    let opened = workspace(&base, &repo, &store, "opened", false);
    commit(&opened, "c.txt", "c\n");
    set_origin(&store.lock().unwrap(), &opened.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "existingBranch": true }))).unwrap();
    let before = head(&repo, "main");
    let out = tidy(&store);
    assert_eq!(head(&repo, "main"), before);
    let why: Vec<&str> = out.left.iter().map(|l| l.why.as_str()).collect();
    assert!(why.contains(&LOCKED) && why.contains(&OWN_BRANCH), "{why:?}");
    assert!(locked.is_dir() && opened.is_dir());
    git_in(&repo, &["worktree", "unlock", &locked.to_string_lossy()]);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn out_of_time_starts_nothing() {
    let (base, repo, store) = repo("late");
    let ws = workspace(&base, &repo, &store, "late", true);
    fs::write(ws.join("x.txt"), "x\n").unwrap();
    let out = run(&Git::detect().unwrap(), &store, &Terminals::default(), Clock::until(Instant::now()));
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
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join("scratch.txt"), "unsaved\n").unwrap();
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "", "main never lists the .worktrees folder");
    let out = tidy(&store);
    assert!(out.left.is_empty(), "{:?}", out.left);
    assert_eq!((out.merged.len(), out.removed.len()), (1, 1));
    assert!(!ws.exists(), "the workspace folder is gone");
    assert!(repo.join("b.txt").is_file() && repo.join("scratch.txt").is_file(), "its commit and its unsaved file reached main");
    assert!(!branch_exists(&repo, &made.branch.clone().unwrap_or_default()), "its branch went with it");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(projects::load_origins(&store.lock().unwrap()).is_empty(), "its record is forgotten");
    let _ = fs::remove_dir_all(&base);
}
