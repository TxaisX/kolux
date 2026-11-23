use super::*;
use crate::projects::{name_key, same_folder, set_origin};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-land-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn git_in(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn git_ok(dir: &Path, args: &[&str]) -> bool {
    Command::new("git").args(args).current_dir(dir).output().unwrap().status.success()
}

fn head(dir: &Path, rev: &str) -> String {
    git_in(dir, &["rev-parse", rev])
}

fn branch_exists(repo: &Path, b: &str) -> bool {
    git_ok(repo, &["rev-parse", "-q", "--verify", &format!("refs/heads/{b}")])
}

fn in_main(repo: &Path, file: &str) -> bool {
    !git_in(repo, &["ls-tree", "--name-only", "main", file]).is_empty()
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

fn never(_: &Path) -> bool {
    false
}

fn land_with(base: &Path, store: &Mutex<Store>, folder: &Path, trigger: Trigger, busy: &dyn Fn(&Path) -> bool) -> LandOutcome {
    let git = Git::detect().unwrap();
    let data = base.join("data");
    land(&Deps { git: &git, store, data_dir: &data, busy, closing: &|| false }, folder, trigger)
}

fn land_as(base: &Path, store: &Mutex<Store>, folder: &Path, trigger: Trigger) -> LandOutcome {
    land_with(base, store, folder, trigger, &never)
}

fn agent() -> Trigger {
    Trigger::Agent { pane_key: 7 }
}

fn recorded(store: &Mutex<Store>, folder: &Path) -> Option<String> {
    states(&store.lock().unwrap()).get(&name_key(&folder.to_string_lossy())).map(|r| r.state.clone())
}

fn sibling<'a>(out: &'a LandOutcome, folder: &Path) -> &'a Sibling {
    out.siblings.iter().find(|s| same_folder(Path::new(&s.path), folder)).unwrap_or_else(|| panic!("{} not among {:?}", folder.display(), out.siblings))
}

// 1
#[test]
fn a_user_land_merges_the_branch_into_main_and_keeps_the_folder() {
    let (base, repo, store) = repo("keeps");
    let ws = workspace(&base, &repo, &store, "keeps", true);
    commit(&ws, "b.txt", "b\n");
    let tip = head(&ws, "HEAD");
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(out.branch.as_deref(), Some("keeps"));
    assert!(git_ok(&repo, &["merge-base", "--is-ancestor", &tip, "main"]), "the branch's tip is in main");
    assert!(ws.is_dir() && branch_exists(&repo, "keeps"), "the folder and its branch stay");
    assert_eq!(recorded(&store, &ws).as_deref(), Some("landed"));
    let _ = fs::remove_dir_all(&base);
}

// 2
#[test]
fn an_agent_land_refuses_uncommitted_work_and_names_up_to_five_files() {
    let (base, repo, store) = repo("agent-dirty");
    let ws = workspace(&base, &repo, &store, "dirty", true);
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join("a.txt"), "changed\n").unwrap();
    for i in 0..6 {
        fs::write(ws.join(format!("new{i}.txt")), "n\n").unwrap();
    }
    let before = head(&repo, "main");
    let out = land_as(&base, &store, &ws, agent());
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert_eq!(out.files.len(), 5, "at most five files are named: {:?}", out.files);
    assert!(out.files.iter().any(|f| f == "a.txt"), "{:?}", out.files);
    assert!(out.message.contains("a.txt") && out.message.contains("2 more"), "{}", out.message);
    assert_eq!(head(&repo, "main"), before, "main is untouched");
    assert!(!git_in(&ws, &["status", "--porcelain"]).is_empty(), "nothing was saved for the agent");
    let _ = fs::remove_dir_all(&base);
}

// 3
#[test]
fn a_user_land_saves_uncommitted_work_first_then_merges() {
    let (base, repo, store) = repo("user-saves");
    let ws = workspace(&base, &repo, &store, "saves", true);
    fs::write(ws.join("a.txt"), "changed\n").unwrap();
    fs::write(ws.join("new.txt"), "n\n").unwrap();
    fs::write(ws.join("noise.log"), "ignored\n").unwrap();
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert!(git_in(&repo, &["log", "--format=%s", "main"]).lines().any(|l| l == SAVED_MESSAGE), "the save commit is in main");
    assert!(in_main(&repo, "new.txt") && !in_main(&repo, "noise.log"), "untracked saved, ignored left out");
    assert_eq!(git_in(&ws, &["status", "--porcelain", "--untracked-files=no"]), "");
    let _ = fs::remove_dir_all(&base);
}

// 4
#[test]
fn a_user_land_refuses_a_new_file_that_looks_like_a_secret() {
    let (base, repo, store) = repo("secret");
    let ws = workspace(&base, &repo, &store, "secret", true);
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join(".env"), "KEY=1\n").unwrap();
    let (main_before, ws_before) = (head(&repo, "main"), head(&ws, "HEAD"));
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains(".env"), "{}", out.message);
    assert_eq!((head(&repo, "main"), head(&ws, "HEAD")), (main_before, ws_before), "nothing saved, nothing merged");
    let _ = fs::remove_dir_all(&base);
}

// 5
#[test]
fn a_clash_leaves_main_and_the_workspace_untouched_and_names_the_files() {
    let (base, repo, store) = repo("clash");
    let ws = workspace(&base, &repo, &store, "clash", true);
    commit(&ws, "a.txt", "workspace side\n");
    commit(&repo, "a.txt", "main side\n");
    let (main_before, ws_before) = (head(&repo, "main"), head(&ws, "HEAD"));
    let out = land_as(&base, &store, &ws, agent());
    assert_eq!(out.state, LandState::Clashed, "{out:?}");
    assert_eq!(out.files, vec!["a.txt".to_string()]);
    assert!(out.message.contains("git merge main"), "the agent is told how to fix it: {}", out.message);
    assert_eq!((head(&repo, "main"), head(&ws, "HEAD")), (main_before, ws_before));
    assert!(!git_ok(&repo, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]), "no merge left open in main");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    assert!(!base.join("data").join("quit-merge-marker.json").exists(), "no marker");
    assert_eq!(recorded(&store, &ws).as_deref(), Some("clashed"));
    let _ = fs::remove_dir_all(&base);
}

// 6
#[test]
fn a_main_folder_with_uncommitted_changes_refuses_the_land_before_anything_is_saved() {
    let (base, repo, store) = repo("dirty-main");
    let ws = workspace(&base, &repo, &store, "dm", true);
    commit(&ws, "b.txt", "b\n");
    fs::write(ws.join("c.txt"), "unsaved\n").unwrap();
    fs::write(repo.join("a.txt"), "edited in main\n").unwrap();
    let (main_before, ws_before) = (head(&repo, "main"), head(&ws, "HEAD"));
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains("main folder has changes"), "{}", out.message);
    assert_eq!((head(&repo, "main"), head(&ws, "HEAD")), (main_before, ws_before), "no save commit, no merge");
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "edited in main\n");
    let _ = fs::remove_dir_all(&base);
}

// 7
#[test]
fn a_workspace_with_nothing_new_lands_as_nothing_new() {
    let (base, repo, store) = repo("nothing");
    let ws = workspace(&base, &repo, &store, "nothing", true);
    let sib = workspace(&base, &repo, &store, "nsib", true);
    commit(&repo, "d.txt", "d\n");
    let before = head(&repo, "main");
    let out = land_as(&base, &store, &ws, agent());
    assert_eq!(out.state, LandState::NothingNew, "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(recorded(&store, &ws).as_deref(), Some("nothingNew"), "the land is recorded");
    assert_eq!(sibling(&out, &ws).state, SiblingState::Updated, "the workspace itself is brought up: {out:?}");
    assert_eq!(sibling(&out, &sib).state, SiblingState::Updated, "{out:?}");
    assert_eq!(head(&sib, "HEAD"), before, "the sibling took in main");
    assert_eq!(recorded(&store, &sib).as_deref(), Some("updated"));
    let _ = fs::remove_dir_all(&base);
}

// 8
#[test]
fn a_worktree_kolux_did_not_make_is_refused() {
    let (base, repo, store) = repo("foreign");
    let ws = workspace(&base, &repo, &store, "foreign", false);
    commit(&ws, "b.txt", "b\n");
    let before = head(&repo, "main");
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains("Kolux did not make"), "{}", out.message);
    assert_eq!(head(&repo, "main"), before);
    let _ = fs::remove_dir_all(&base);
}

// 9
#[test]
fn the_main_checkout_itself_is_refused() {
    let (base, repo, store) = repo("main-itself");
    let out = land_as(&base, &store, &repo, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains("main folder"), "{}", out.message);
    let _ = fs::remove_dir_all(&base);
}

// 10
#[test]
fn a_folder_project_is_refused() {
    let base = temp("folder-project");
    let plain = base.join("plain");
    fs::create_dir_all(&plain).unwrap();
    let store = Mutex::new(Store::open(&base.join("db")).unwrap());
    crate::folder_projects::add_folder(&store.lock().unwrap(), &plain).unwrap();
    let out = land_as(&base, &store, &plain, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains("without Git"), "{}", out.message);
    let _ = fs::remove_dir_all(&base);
}

// 11
#[test]
fn an_idle_clean_sibling_takes_in_the_new_main() {
    let (base, repo, store) = repo("sibling");
    let a = workspace(&base, &repo, &store, "sa", true);
    let b = workspace(&base, &repo, &store, "sb", true);
    commit(&a, "b.txt", "b\n");
    commit(&b, "c.txt", "c\n");
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(sibling(&out, &b).state, SiblingState::Updated, "{out:?}");
    assert_eq!(git_in(&b, &["log", "-1", "--format=%s"]), TAKE_IN_MESSAGE);
    assert!(b.join("b.txt").is_file() && b.join("c.txt").is_file());
    assert_eq!(recorded(&store, &b).as_deref(), Some("updated"));
    let _ = fs::remove_dir_all(&base);
}

// 12
#[test]
fn a_sibling_with_uncommitted_changes_is_left_untouched_and_marked_behind() {
    let (base, repo, store) = repo("dirty-sibling");
    let a = workspace(&base, &repo, &store, "da", true);
    let b = workspace(&base, &repo, &store, "dsb", true);
    commit(&a, "b.txt", "b\n");
    fs::write(b.join("a.txt"), "half done\n").unwrap();
    let b_before = head(&b, "HEAD");
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(sibling(&out, &b).state, SiblingState::Behind, "{out:?}");
    assert_eq!(head(&b, "HEAD"), b_before);
    assert_eq!(fs::read_to_string(b.join("a.txt")).unwrap(), "half done\n");
    assert!(!b.join("b.txt").exists());
    assert_eq!(recorded(&store, &b).as_deref(), Some("behind"));
    let _ = fs::remove_dir_all(&base);
}

// 13
#[test]
fn a_sibling_whose_agent_is_working_is_skipped() {
    let (base, repo, store) = repo("busy-sibling");
    let a = workspace(&base, &repo, &store, "ba", true);
    let b = workspace(&base, &repo, &store, "bb", true);
    commit(&a, "b.txt", "b\n");
    let b_before = head(&b, "HEAD");
    let b2 = b.clone();
    let busy = move |p: &Path| same_folder(p, &b2);
    let out = land_with(&base, &store, &a, Trigger::User, &busy);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    let s = sibling(&out, &b);
    assert_eq!(s.state, SiblingState::Behind, "{out:?}");
    assert!(s.why.as_deref().is_some_and(|w| w.contains("working")), "{s:?}");
    assert_eq!(head(&b, "HEAD"), b_before);
    let _ = fs::remove_dir_all(&base);
}

// 14
#[test]
fn a_sibling_that_would_clash_is_skipped_with_no_merge_left_open() {
    let (base, repo, store) = repo("clash-sibling");
    let a = workspace(&base, &repo, &store, "ca", true);
    let b = workspace(&base, &repo, &store, "cb", true);
    commit(&a, "a.txt", "from a\n");
    commit(&b, "a.txt", "from b\n");
    commit(&repo, "d.txt", "d\n");
    let b_before = head(&b, "HEAD");
    TAKE_IN_WRITES.with(|w| w.borrow_mut().clear());
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(sibling(&out, &b).state, SiblingState::Behind, "{out:?}");
    let wrote = TAKE_IN_WRITES.with(|w| w.borrow().clone());
    assert!(wrote.iter().any(|p| same_folder(Path::new(p), &a)), "the landed workspace's take-in is counted: {wrote:?}");
    assert!(!wrote.iter().any(|p| same_folder(Path::new(p), &b)), "no merge was even tried in the clashing sibling: {wrote:?}");
    assert_eq!(head(&b, "HEAD"), b_before);
    assert!(!git_ok(&b, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]), "no merge left open");
    assert_eq!(git_in(&b, &["status", "--porcelain"]), "");
    let _ = fs::remove_dir_all(&base);
}

// 15
#[test]
fn the_landed_workspace_is_fast_forwarded_to_the_new_main() {
    let (base, repo, store) = repo("ff-landed");
    let a = workspace(&base, &repo, &store, "fa", true);
    commit(&repo, "d.txt", "d\n");
    commit(&a, "b.txt", "b\n");
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(git_in(&repo, &["log", "-1", "--format=%s", "main"]), "Kolux: send fa to main", "a merge commit, since main moved");
    assert_eq!(head(&a, "HEAD"), head(&repo, "main"), "the landed workspace is at main's tip");
    assert_eq!(sibling(&out, &a).state, SiblingState::Updated);
    assert_eq!(recorded(&store, &a).as_deref(), Some("landed"), "the landed workspace keeps its own state");
    let _ = fs::remove_dir_all(&base);
}

// 16
#[test]
fn with_auto_land_off_an_agent_land_only_records_ready() {
    let (base, repo, store) = repo("auto-off");
    store.lock().unwrap().save_settings(&serde_json::json!({ crate::quit_merge::AUTO_LAND_SETTING: false })).unwrap();
    let ws = workspace(&base, &repo, &store, "off", true);
    commit(&ws, "b.txt", "b\n");
    let before = head(&repo, "main");
    let out = land_as(&base, &store, &ws, agent());
    assert_eq!(out.state, LandState::Ready, "{out:?}");
    assert_eq!(head(&repo, "main"), before, "nothing merged");
    assert_eq!(recorded(&store, &ws).as_deref(), Some("ready"));
    let out = land_as(&base, &store, &ws, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "the user's own send still works: {out:?}");
    let _ = fs::remove_dir_all(&base);
}

// 17
#[test]
fn two_lands_in_one_project_take_turns() {
    let (base, repo, store) = repo("serialize");
    let a = workspace(&base, &repo, &store, "ta", true);
    let b = workspace(&base, &repo, &store, "tb", true);
    commit(&a, "b.txt", "b\n");
    commit(&b, "c.txt", "c\n");
    let git = Git::detect().unwrap();
    let turn = crate::projects::repo_turn(&quit_merge::repo_of(&git.toplevel(&a).unwrap()).unwrap());
    let main_before = head(&repo, "main");
    let held = turn.lock().unwrap();
    let (oa, ob) = std::thread::scope(|s| {
        let ha = s.spawn(|| land_as(&base, &store, &a, Trigger::User));
        let hb = s.spawn(|| land_as(&base, &store, &b, Trigger::User));
        std::thread::sleep(Duration::from_millis(700));
        assert!(!ha.is_finished() && !hb.is_finished(), "both lands wait while the project's turn is held");
        assert_eq!(head(&repo, "main"), main_before, "nothing reached main without the turn");
        drop(held);
        (ha.join().unwrap(), hb.join().unwrap())
    });
    assert_eq!((oa.state, ob.state), (LandState::Landed, LandState::Landed), "{oa:?} {ob:?}");
    assert!(in_main(&repo, "b.txt") && in_main(&repo, "c.txt"), "both are in main");
    assert_eq!(git_in(&repo, &["status", "--porcelain"]), "");
    let _ = fs::remove_dir_all(&base);
}

// 18
#[test]
fn a_behind_sibling_takes_in_main_on_retry_once_it_is_clean() {
    let (base, repo, store) = repo("retry");
    let a = workspace(&base, &repo, &store, "ra", true);
    let b = workspace(&base, &repo, &store, "rb", true);
    commit(&a, "b.txt", "b\n");
    fs::write(b.join("a.txt"), "half done\n").unwrap();
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(sibling(&out, &b).state, SiblingState::Behind, "{out:?}");
    git_in(&b, &["commit", "-q", "-am", "finish"]);
    let git = Git::detect().unwrap();
    let data = base.join("data");
    let got = retry_behind(&Deps { git: &git, store: &store, data_dir: &data, busy: &never, closing: &|| false }, &b);
    assert_eq!(got.map(|s| s.state), Some(SiblingState::Updated));
    assert!(b.join("b.txt").is_file());
    assert_eq!(recorded(&store, &b).as_deref(), Some("updated"));
    let _ = fs::remove_dir_all(&base);
}

// 20
#[test]
fn the_quit_no_longer_starts_a_merge_and_the_land_commands_are_registered() {
    let lib = include_str!("lib.rs");
    assert!(!lib.contains("quit_merge::start("), "the quit no longer merges every workspace");
    assert!(!lib.contains("quit_merge::finish("));
    assert!(lib.contains("lifecycle::quit_began().unwrap_or_else(std::time::Instant::now)") && lib.contains("quit_merge::HARD_CAP.saturating_sub("), "the quit's wait for a land ends before the watchdog's hard cap");
    assert!(!lib.contains("waited.elapsed() < quit_merge::WAIT"), "no longer a wait counted from the end of the quit");
    assert!(lib.contains("quit_merge::recover_at_start(") && lib.contains("quit_merge::take_notes("), "a cut merge is still put right at start");
    for c in ["land::workspace_land,", "land::workspace_land_preview,", "land::workspace_land_states,"] {
        assert!(lib.contains(c), "{c} is registered");
    }
}

#[test]
fn the_outcome_reaches_the_window_in_camel_case() {
    let out = LandOutcome { path: "C:/w".into(), branch: Some("b".into()), state: LandState::NothingNew, message: "m".into(), files: vec![], siblings: vec![Sibling { path: "C:/s".into(), state: SiblingState::Behind, why: Some("w".into()) }] };
    let v = serde_json::to_value(&out).unwrap();
    assert_eq!(v["state"], "nothingNew");
    assert_eq!(v["siblings"][0]["state"], "behind");
    assert_eq!(v["branch"], "b");
}

fn deps_for<'a>(git: &'a Git, store: &'a Mutex<Store>, data: &'a Path, busy: &'a dyn Fn(&Path) -> bool, closing: &'a dyn Fn() -> bool) -> Deps<'a> {
    Deps { git, store, data_dir: data, busy, closing }
}

fn worktree_of(repo: &Path, folder: &Path) -> Worktree {
    Git::detect().unwrap().worktrees(repo).unwrap().into_iter().find(|w| same_folder(Path::new(&w.path), folder)).unwrap()
}

/// Review P2-4: with auto-land off, an agent's land of a workspace with nothing new moves nothing.
#[test]
fn with_auto_land_off_a_nothing_new_agent_land_leaves_the_siblings_alone() {
    let (base, repo, store) = repo("auto-off-nn");
    store.lock().unwrap().save_settings(&serde_json::json!({ crate::quit_merge::AUTO_LAND_SETTING: false })).unwrap();
    let ws = workspace(&base, &repo, &store, "aon", true);
    let sib = workspace(&base, &repo, &store, "aos", true);
    commit(&repo, "d.txt", "d\n");
    let (ws_before, sib_before) = (head(&ws, "HEAD"), head(&sib, "HEAD"));
    let out = land_as(&base, &store, &ws, agent());
    assert_eq!(out.state, LandState::NothingNew, "re-review P3-3: nothing to send is said as such: {out:?}");
    assert!(out.siblings.is_empty(), "{out:?}");
    assert_eq!((head(&ws, "HEAD"), head(&sib, "HEAD")), (ws_before, sib_before), "no workspace moved");
    let _ = fs::remove_dir_all(&base);
}

/// Review P2-3: a take-in with less than the merge's room left on the clock is skipped, untouched.
#[test]
fn a_take_in_with_the_clock_nearly_out_is_skipped_as_out_of_time() {
    let (base, repo, store) = repo("no-time");
    let b = workspace(&base, &repo, &store, "nt", true);
    commit(&repo, "d.txt", "d\n");
    let before = head(&b, "HEAD");
    let (git, data) = (Git::detect().unwrap(), base.join("data"));
    let hooks = quit_merge::no_hooks(&data).unwrap();
    let deps = deps_for(&git, &store, &data, &never, &|| false);
    let clock = Clock::with_hard(Instant::now() + Duration::from_secs(120), Instant::now() + Duration::from_secs(3));
    let s = take_in_main(&deps, &worktree_of(&repo, &b), "main", false, &clock, &hooks);
    assert_eq!((s.state, s.why.as_deref()), (SiblingState::Behind, Some(NO_TIME)), "{s:?}");
    assert_eq!(head(&b, "HEAD"), before);
    let _ = fs::remove_dir_all(&base);
}

/// Review P2-2: once the quit has begun no land merges into main and no sibling takes in main.
#[test]
fn nothing_merges_once_the_quit_has_begun() {
    let (base, repo, store) = repo("closing");
    let a = workspace(&base, &repo, &store, "cla", true);
    let b = workspace(&base, &repo, &store, "clb", true);
    commit(&a, "b.txt", "b\n");
    commit(&repo, "d.txt", "d\n");
    let (main_before, b_before) = (head(&repo, "main"), head(&b, "HEAD"));
    let (git, data) = (Git::detect().unwrap(), base.join("data"));
    let out = land(&deps_for(&git, &store, &data, &never, &|| true), &a, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert!(out.message.contains(CLOSING), "{out:?}");
    assert_eq!(head(&repo, "main"), main_before);
    let hooks = quit_merge::no_hooks(&data).unwrap();
    let s = take_in_main(&deps_for(&git, &store, &data, &never, &|| true), &worktree_of(&repo, &b), "main", false, &Clock::until(Instant::now() + Duration::from_secs(120)), &hooks);
    assert_eq!((s.state, s.why.as_deref()), (SiblingState::Behind, Some(CLOSING)), "{s:?}");
    assert_eq!(head(&b, "HEAD"), b_before);
    let _ = fs::remove_dir_all(&base);
}

/// Review P2-2: the land counts as a merge in progress (the quit waits for it) through the sibling steps too.
#[test]
fn the_land_counts_as_merging_while_its_siblings_are_brought_up() {
    let (base, repo, store) = repo("busy-whole");
    let a = workspace(&base, &repo, &store, "bwa", true);
    let b = workspace(&base, &repo, &store, "bwb", true);
    commit(&a, "b.txt", "b\n");
    // Re-review P3-4: this thread's own Busy count, which another test's merge cannot raise.
    let seen = std::cell::Cell::new(None);
    let busy = |p: &Path| {
        if same_folder(p, &b) {
            seen.set(Some(quit_merge::busy_on_this_thread()));
        }
        false
    };
    let out = land_with(&base, &store, &a, Trigger::User, &busy);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(seen.get(), Some(true), "merging() held while the sibling was looked at");
    let _ = fs::remove_dir_all(&base);
}

/// Review P2-5: a pane may land only its own workspace, named by a full path; anything unknown is refused.
#[test]
fn a_pane_may_land_only_its_own_workspace() {
    let (base, repo, store) = repo("pane");
    let a = workspace(&base, &repo, &store, "pa", true);
    let b = workspace(&base, &repo, &store, "pb", true);
    let plain = base.join("plain");
    fs::create_dir_all(a.join("sub")).unwrap();
    fs::create_dir_all(&plain).unwrap();
    let git = Git::detect().unwrap();
    assert!(own_workspace(&git, &a.join("sub"), &a));
    assert!(!own_workspace(&git, &a, &b), "another workspace");
    assert!(!own_workspace(&git, &a, &plain), "a folder in no Git project fails closed");
    assert!(!own_workspace(&git, &plain, &a), "a pane in no Git project");
    let body = a.to_string_lossy().into_owned();
    assert_eq!(pane_may_land(&git, Some(&a), &format!(" {body}\n")).unwrap(), a);
    assert_eq!(pane_may_land(&git, None, &body).unwrap_err(), UNKNOWN_PANE, "no terminal, or a pane folder Kolux does not know");
    assert_eq!(pane_may_land(&git, Some(&a), "pa").unwrap_err(), NOT_ABSOLUTE);
    assert_eq!(pane_may_land(&git, Some(&a), "").unwrap_err(), NOT_ABSOLUTE);
    assert_eq!(pane_may_land(&git, Some(&a), &b.to_string_lossy()).unwrap_err(), OTHER_WORKSPACE);
    let _ = fs::remove_dir_all(&base);
}

fn commit_ignored(dir: &Path, file: &str, text: &str) {
    fs::write(dir.join(file), text).unwrap();
    git_in(dir, &["add", "-f", file]);
    git_in(dir, &["commit", "-q", "-m", file]);
}

/// Review P3-2: an ignored file in main is never overwritten by a land.
#[test]
fn a_land_never_overwrites_an_ignored_file_in_main() {
    let (base, repo, store) = repo("ignored-main");
    let a = workspace(&base, &repo, &store, "ima", true);
    commit_ignored(&a, "x.log", "from the workspace\n");
    fs::write(repo.join("x.log"), "mine\n").unwrap();
    let before = head(&repo, "main");
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Refused, "{out:?}");
    assert_eq!(head(&repo, "main"), before);
    assert_eq!(fs::read_to_string(repo.join("x.log")).unwrap(), "mine\n");
    let _ = fs::remove_dir_all(&base);
}

/// Review P3-2: nor one in a sibling taking in main.
#[test]
fn a_take_in_never_overwrites_an_ignored_file_in_a_sibling() {
    let (base, repo, store) = repo("ignored-sib");
    let a = workspace(&base, &repo, &store, "isa", true);
    let b = workspace(&base, &repo, &store, "isb", true);
    commit_ignored(&a, "x.log", "from a\n");
    fs::write(b.join("x.log"), "kept by b\n").unwrap();
    let b_before = head(&b, "HEAD");
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Landed, "{out:?}");
    assert_eq!(sibling(&out, &b).state, SiblingState::Behind, "{out:?}");
    assert_eq!(head(&b, "HEAD"), b_before);
    assert_eq!(fs::read_to_string(b.join("x.log")).unwrap(), "kept by b\n");
    let _ = fs::remove_dir_all(&base);
}

/// Review P3-4: a user's land that saved the work and then clashed says the work was saved.
#[test]
fn a_user_land_that_saved_then_clashed_says_the_changes_were_saved() {
    let (base, repo, store) = repo("saved-clash");
    let a = workspace(&base, &repo, &store, "sca", true);
    commit(&repo, "a.txt", "main version\n");
    fs::write(a.join("a.txt"), "workspace version\n").unwrap();
    let out = land_as(&base, &store, &a, Trigger::User);
    assert_eq!(out.state, LandState::Clashed, "{out:?}");
    assert!(out.message.contains("Your changes were saved in the workspace."), "{out:?}");
    assert_eq!(git_in(&a, &["log", "-1", "--format=%s"]), SAVED_MESSAGE, "and they were");
    let _ = fs::remove_dir_all(&base);
}

/// Review P2-7: siblings are brought up after the land lets go of the project's turn, each taking it
/// for its own step: while someone else holds the turn, a sibling waits, then is left behind.
#[test]
fn each_sibling_takes_the_projects_turn_for_its_own_step() {
    let (base, repo, store) = repo("turn-per-sibling");
    let b = workspace(&base, &repo, &store, "tps", true);
    commit(&repo, "d.txt", "d\n");
    let before = head(&b, "HEAD");
    let (git, data) = (Git::detect().unwrap(), base.join("data"));
    let main_repo = quit_merge::repo_of(&git.toplevel(&b).unwrap()).unwrap();
    let turn = crate::projects::repo_turn(&main_repo);
    let deps = deps_for(&git, &store, &data, &never, &|| false);
    let clock = Clock::until(Instant::now() + Duration::from_secs(120));
    let held = turn.lock().unwrap();
    let got = propagate(&deps, &main_repo, "main", None, &clock);
    drop(held);
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!((got[0].state, got[0].why.as_deref()), (SiblingState::Behind, Some(BUSY_PROJECT)), "{got:?}");
    assert_eq!(head(&b, "HEAD"), before);
    let got = propagate(&deps, &main_repo, "main", None, &clock);
    assert_eq!(got[0].state, SiblingState::Updated, "with the turn free it goes ahead: {got:?}");
    let _ = fs::remove_dir_all(&base);
}

/// Re-review P3-1: once the quit has begun, a sibling is left behind as "closing" without taking the
/// project's turn (here someone else holds it, so a sibling that tried would wait and say "busy").
#[test]
fn once_closing_the_siblings_are_left_behind_without_taking_the_turn() {
    let (base, repo, store) = repo("closing-siblings");
    let b = workspace(&base, &repo, &store, "csb", true);
    commit(&repo, "d.txt", "d\n");
    let before = head(&b, "HEAD");
    let (git, data) = (Git::detect().unwrap(), base.join("data"));
    let main_repo = quit_merge::repo_of(&git.toplevel(&b).unwrap()).unwrap();
    let turn = crate::projects::repo_turn(&main_repo);
    let deps = deps_for(&git, &store, &data, &never, &|| true);
    let clock = Clock::until(Instant::now() + Duration::from_secs(120));
    let held = turn.lock().unwrap();
    let got = propagate(&deps, &main_repo, "main", None, &clock);
    drop(held);
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!((got[0].state, got[0].why.as_deref()), (SiblingState::Behind, Some(CLOSING)), "{got:?}");
    assert_eq!(head(&b, "HEAD"), before);
    let _ = fs::remove_dir_all(&base);
}

/// Re-review P3-6: one folder written two ways (case, slashes, a trailing slash) is one turn.
#[test]
fn the_projects_turn_is_the_same_however_its_folder_is_written() {
    let one = crate::projects::repo_turn(Path::new("C:/Kolux-Turn-Test/Repo/"));
    let two = crate::projects::repo_turn(Path::new("c:\\kolux-turn-test\\repo"));
    assert!(std::sync::Arc::ptr_eq(&one, &two));
}
