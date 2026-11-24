// LAND-06 board tests (locked: the board overwrites this file at verify time).
// Wired from land_clear.rs: #[cfg(test)] #[path = "land_clear_board_tests.rs"] mod board_tests;
use super::{after_land, build_output, clear_workspace, ClearDeps};
use crate::git::Git;
use crate::land::{LandOutcome, LandState, Sibling, SiblingState};
use crate::projects::{same_folder, set_origin};
use crate::state::Store;
use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

const TAG: &str = "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n";

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-clear-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn git_in(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// A repository on `main`: a.txt, a .gitignore that ignores build output, a Cargo.toml at the top
/// and in src-tauri (both tracked), and a store.
fn repo(name: &str) -> (PathBuf, PathBuf, Mutex<Store>) {
    let base = temp(name);
    let repo = base.join("r");
    fs::create_dir_all(&repo).unwrap();
    git_in(&repo, &["init", "-q", "-b", "main"]);
    git_in(&repo, &["config", "user.email", "t@example.com"]);
    git_in(&repo, &["config", "user.name", "t"]);
    write(&repo.join("a.txt"), "a\n");
    write(&repo.join(".gitignore"), "target\nnode_modules\ndist\n*.log\n");
    write(&repo.join("Cargo.toml"), "[workspace]\n");
    write(&repo.join("src-tauri").join("Cargo.toml"), "[package]\nname = \"x\"\n");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "first"]);
    let store = Store::open(&base.join("db")).unwrap();
    (base, repo, Mutex::new(store))
}

fn workspace(base: &Path, repo: &Path, store: &Mutex<Store>, name: &str, kolux: bool) -> PathBuf {
    let at = base.join(name);
    git_in(repo, &["worktree", "add", "-q", &at.to_string_lossy(), "-b", name]);
    if kolux {
        set_origin(&store.lock().unwrap(), &at.to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    }
    at
}

fn commit(dir: &Path, file: &str, text: &str) {
    write(&dir.join(file), text);
    git_in(dir, &["add", "-f", file]);
    git_in(dir, &["commit", "-q", "-m", file]);
}

/// Fast-forwards main (checked out in the main folder) to `branch`: the workspace's work is in main.
fn into_main(repo: &Path, branch: &str) {
    git_in(repo, &["merge", "-q", "--ff-only", branch]);
}

/// Cargo build output in `crate_dir/target`: the cache tag and a build file.
fn cargo_output(crate_dir: &Path) -> PathBuf {
    let t = crate_dir.join("target");
    write(&t.join("CACHEDIR.TAG"), TAG);
    write(&t.join("debug").join("deps").join("big.rlib"), "built\n");
    t
}

fn status(dir: &Path) -> String {
    git_in(dir, &["status", "--porcelain", "--untracked-files=all"])
}

fn closed(_: &Path) -> bool {
    false
}

fn clear(store: &Mutex<Store>, folder: &Path, pane_open: &dyn Fn(&Path) -> bool) -> Result<Vec<PathBuf>, String> {
    let git = Git::detect().unwrap();
    clear_workspace(&ClearDeps { git: &git, store, pane_open }, folder)
}

/// Whether `list` names `want` (a folder that may already be gone: compared by its last two names).
fn has(list: &[PathBuf], want: &Path) -> bool {
    let tail: PathBuf = want.components().rev().take(2).collect::<Vec<_>>().into_iter().rev().collect();
    list.iter().any(|p| p.ends_with(&tail))
}

#[cfg(windows)]
fn link_dir(link: &Path, to: &Path) {
    let out = Command::new("cmd").args(["/C", "mklink", "/J", &link.to_string_lossy(), &to.to_string_lossy()]).output().unwrap();
    assert!(out.status.success(), "mklink /J: {}", String::from_utf8_lossy(&out.stdout));
}

#[cfg(not(windows))]
fn link_dir(link: &Path, to: &Path) {
    std::os::unix::fs::symlink(to, link).unwrap();
}

#[test]
fn land06_clears_cargo_build_output_of_a_landed_idle_kolux_workspace() {
    let (base, repo, store) = repo("clears");
    let ws = workspace(&base, &repo, &store, "clears", true);
    commit(&ws, "b.txt", "b\n");
    into_main(&repo, "clears");
    let (inner, top) = (cargo_output(&ws.join("src-tauri")), cargo_output(&ws));
    let asked = RefCell::new(Vec::<PathBuf>::new());
    let pane_open = |p: &Path| {
        asked.borrow_mut().push(p.to_path_buf());
        false
    };
    let removed = clear(&store, &ws, &pane_open).expect("a landed idle workspace is cleared");
    assert_eq!(removed.len(), 2, "both cargo target folders: {removed:?}");
    assert!(!inner.exists() && !top.exists(), "the build output is gone");
    assert!(ws.join("src-tauri").join("Cargo.toml").is_file() && ws.join("b.txt").is_file() && ws.join("Cargo.toml").is_file(), "nothing else is touched");
    assert!(status(&ws).is_empty(), "no tracked file was removed: {}", status(&ws));
    assert!(asked.borrow().iter().any(|p| same_folder(p, &ws)), "the pane check was asked about the workspace folder: {:?}", asked.borrow());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_keeps_build_output_while_a_pane_is_open_in_the_workspace() {
    let (base, repo, store) = repo("pane");
    let ws = workspace(&base, &repo, &store, "pane", true);
    commit(&ws, "b.txt", "b\n");
    into_main(&repo, "pane");
    let out = cargo_output(&ws.join("src-tauri"));
    let open = |p: &Path| same_folder(p, &ws);
    assert!(clear(&store, &ws, &open).is_err(), "a pane is open in it");
    assert!(out.join("debug").join("deps").join("big.rlib").is_file(), "the build output stays");
    // Asked from a folder inside the workspace, the answer is the same.
    assert!(clear(&store, &ws.join("src-tauri"), &open).is_err(), "a pane is open in it");
    assert!(out.join("CACHEDIR.TAG").is_file());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_keeps_build_output_when_the_branch_is_not_in_main() {
    let (base, repo, store) = repo("notmain");
    let ws = workspace(&base, &repo, &store, "notmain", true);
    commit(&ws, "b.txt", "b\n");
    let out = cargo_output(&ws.join("src-tauri"));
    let why = clear(&store, &ws, &closed).expect_err("its work is not in main");
    assert!(!why.is_empty());
    assert!(out.join("debug").join("deps").join("big.rlib").is_file(), "the build output stays");
    // Main moved on and the branch has its own commit too: still not in main.
    commit(&repo, "m.txt", "m\n");
    assert!(clear(&store, &ws, &closed).is_err());
    assert!(out.join("CACHEDIR.TAG").is_file());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_never_deletes_a_tracked_folder_named_target() {
    let (base, repo, store) = repo("tracked");
    let ws = workspace(&base, &repo, &store, "tracked", true);
    commit(&ws, "tools/Cargo.toml", "[package]\nname = \"t\"\n");
    commit(&ws, "tools/target/CACHEDIR.TAG", TAG);
    commit(&ws, "tools/target/keep.txt", "tracked\n");
    into_main(&repo, "tracked");
    let real = cargo_output(&ws.join("src-tauri"));
    assert!(!build_output(&ws).iter().any(|p| p.ends_with(Path::new("tools").join("target"))), "a tracked target folder is never build output: {:?}", build_output(&ws));
    let removed = clear(&store, &ws, &closed).expect("cleared");
    assert!(!real.exists(), "the real build output is gone");
    assert!(ws.join("tools").join("target").join("keep.txt").is_file(), "the tracked folder stays");
    assert!(!removed.iter().any(|p| p.ends_with(Path::new("tools").join("target"))), "{removed:?}");
    assert!(status(&ws).is_empty(), "no tracked file was removed: {}", status(&ws));
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_keeps_build_output_while_work_is_uncommitted_but_ignored_files_do_not_count() {
    let (base, repo, store) = repo("dirty");
    let ws = workspace(&base, &repo, &store, "dirty", true);
    commit(&ws, "b.txt", "b\n");
    into_main(&repo, "dirty");
    let out = cargo_output(&ws.join("src-tauri"));
    write(&ws.join("new.txt"), "untracked\n");
    assert!(clear(&store, &ws, &closed).is_err(), "an untracked file is work");
    assert!(out.is_dir());
    fs::remove_file(ws.join("new.txt")).unwrap();
    write(&ws.join("a.txt"), "changed\n");
    assert!(clear(&store, &ws, &closed).is_err(), "a changed tracked file is work");
    assert!(out.is_dir());
    git_in(&ws, &["checkout", "--", "a.txt"]);
    write(&ws.join("run.log"), "ignored\n");
    assert!(clear(&store, &ws, &closed).is_ok(), "an ignored file is not work");
    assert!(!out.exists(), "cleared once only ignored files are left");
    assert!(ws.join("run.log").is_file(), "an ignored file outside the build output stays");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_never_clears_the_main_folder_or_a_workspace_kolux_did_not_make() {
    let (base, repo, store) = repo("notours");
    let main_out = cargo_output(&repo.join("src-tauri"));
    assert!(clear(&store, &repo, &closed).is_err(), "the main folder is never cleared");
    assert!(main_out.join("CACHEDIR.TAG").is_file());
    let theirs = workspace(&base, &repo, &store, "theirs", false);
    commit(&theirs, "b.txt", "b\n");
    into_main(&repo, "theirs");
    let out = cargo_output(&theirs.join("src-tauri"));
    assert!(clear(&store, &theirs, &closed).is_err(), "a worktree Kolux did not make");
    assert!(out.join("CACHEDIR.TAG").is_file());
    assert!(clear(&store, &base.join("plain"), &closed).is_err(), "a folder that does not exist / is not in Git");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_only_cargo_target_folders_next_to_a_cargo_toml_are_build_output() {
    let (base, repo, store) = repo("allow");
    let ws = workspace(&base, &repo, &store, "allow", true);
    commit(&ws, "deep/inner/Cargo.toml", "[package]\nname = \"d\"\n");
    into_main(&repo, "allow");
    // target without the cache tag (next to a Cargo.toml): kept.
    write(&ws.join("src-tauri").join("target").join("debug").join("x"), "x\n");
    // target with the tag but no Cargo.toml beside it: kept.
    write(&ws.join("docs").join("target").join("CACHEDIR.TAG"), TAG);
    // Two levels down: outside the places looked at: kept.
    let deep = cargo_output(&ws.join("deep").join("inner"));
    // Other ignored folders: kept.
    write(&ws.join("node_modules").join("m").join("index.js"), "x\n");
    write(&ws.join("dist").join("app.js"), "x\n");
    assert!(build_output(&ws).is_empty(), "{:?}", build_output(&ws));
    let removed = clear(&store, &ws, &closed).expect("the workspace may be cleared, there is just nothing to clear");
    assert!(removed.is_empty(), "{removed:?}");
    for kept in [ws.join("src-tauri").join("target").join("debug").join("x"), ws.join("docs").join("target").join("CACHEDIR.TAG"), deep.join("CACHEDIR.TAG"), ws.join("node_modules").join("m").join("index.js"), ws.join("dist").join("app.js")] {
        assert!(kept.is_file(), "{} stays", kept.display());
    }
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn land06_never_follows_a_link_out_of_the_workspace() {
    let (base, repo, store) = repo("links");
    let ws = workspace(&base, &repo, &store, "links", true);
    commit(&ws, "crate2/Cargo.toml", "[package]\nname = \"c\"\n");
    into_main(&repo, "links");
    let outside = base.join("outside");
    write(&outside.join("precious.txt"), "keep\n");
    let outside2 = base.join("outside2");
    write(&outside2.join("CACHEDIR.TAG"), TAG);
    write(&outside2.join("precious2.txt"), "keep\n");
    let real = cargo_output(&ws.join("src-tauri"));
    link_dir(&real.join("escape"), &outside);
    link_dir(&ws.join("crate2").join("target"), &outside2);
    assert!(status(&ws).is_empty(), "the setup is clean: {}", status(&ws));
    let found = build_output(&ws);
    assert!(!found.iter().any(|p| p.ends_with(Path::new("crate2").join("target"))), "a linked target is not build output: {found:?}");
    let removed = clear(&store, &ws, &closed).expect("cleared");
    assert!(has(&removed, &real), "{removed:?}");
    assert!(!real.exists(), "the real build output is gone");
    assert!(outside.join("precious.txt").is_file(), "a link inside the build output is removed, not followed");
    assert!(outside2.join("precious2.txt").is_file() && outside2.join("CACHEDIR.TAG").is_file(), "a linked target folder is left alone");
    let _ = fs::remove_dir_all(&base);
}

fn outcome(path: &Path, state: LandState, siblings: Vec<Sibling>) -> LandOutcome {
    LandOutcome { path: path.to_string_lossy().into_owned(), branch: Some("x".into()), state, message: String::new(), files: Vec::new(), siblings }
}

#[test]
fn land06_after_a_land_every_finished_idle_kolux_workspace_of_the_project_is_cleared() {
    let (base, repo, store) = repo("after");
    let a = workspace(&base, &repo, &store, "wa", true);
    let b = workspace(&base, &repo, &store, "wb", true);
    let c = workspace(&base, &repo, &store, "wc", true);
    let d = workspace(&base, &repo, &store, "wd", true);
    commit(&a, "a2.txt", "a\n");
    into_main(&repo, "wa");
    commit(&c, "c2.txt", "c\n"); // c's own work is not in main
    let (oa, ob, oc, od, om) = (cargo_output(&a.join("src-tauri")), cargo_output(&b.join("src-tauri")), cargo_output(&c.join("src-tauri")), cargo_output(&d.join("src-tauri")), cargo_output(&repo.join("src-tauri")));
    let git = Git::detect().unwrap();
    let open_in_d = |p: &Path| same_folder(p, &d);
    let deps = ClearDeps { git: &git, store: &store, pane_open: &open_in_d };
    // A refused land clears nothing, anywhere.
    for state in [LandState::Refused, LandState::Clashed, LandState::Ready] {
        assert!(after_land(&deps, &outcome(&a, state, Vec::new())).iter().all(|(_, r)| !matches!(r, Ok(v) if !v.is_empty())), "{state:?}");
        assert!(oa.is_dir() && ob.is_dir(), "nothing cleared after {state:?}");
    }
    let sib = |p: &Path, state: SiblingState| Sibling { path: p.to_string_lossy().into_owned(), state, why: None };
    let results = after_land(&deps, &outcome(&a, LandState::Landed, vec![sib(&a, SiblingState::Current), sib(&b, SiblingState::Current), sib(&c, SiblingState::Behind)]));
    assert!(!oa.exists(), "the landed workspace is cleared");
    assert!(!ob.exists(), "an idle sibling whose work is in main is cleared");
    assert!(oc.join("CACHEDIR.TAG").is_file(), "a sibling with work not in main keeps its output");
    assert!(od.join("CACHEDIR.TAG").is_file(), "a sibling with an open pane keeps its output");
    assert!(om.join("CACHEDIR.TAG").is_file(), "the main folder keeps its output");
    let ok_for = |w: &Path| results.iter().any(|(p, r)| same_folder(Path::new(p), w) && r.is_ok());
    assert!(ok_for(&a) && ok_for(&b), "{results:?}");
    assert!(!ok_for(&c) && !ok_for(&d), "{results:?}");
    // Main already had everything: the same sweep runs.
    let oa2 = cargo_output(&a.join("src-tauri"));
    after_land(&deps, &outcome(&a, LandState::NothingNew, Vec::new()));
    assert!(!oa2.exists(), "cleared after nothing new too");
    let _ = fs::remove_dir_all(&base);
}
