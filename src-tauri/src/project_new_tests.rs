use super::*;
use crate::chat_finish::tests::{calls, git_in, real_git, stand_in_gh};
use crate::test_dir::{temp, TempDir};
use std::fs;
use std::path::PathBuf;

struct Setup {
    base: TempDir,
    parent: PathBuf,
    store: Store,
    gh: PathBuf,
    git: Git,
}

fn setup(tag: &str) -> Setup {
    let base = temp(tag);
    let parent = base.join("work");
    fs::create_dir_all(&parent).unwrap();
    let store = Store::open(&base.join("db")).unwrap();
    let gh = stand_in_gh(&base.join("tools"));
    Setup { base, parent, store, gh, git: real_git() }
}

impl Setup {
    fn flag(&self, name: &str) {
        fs::write(self.gh.parent().unwrap().join(name), "x").unwrap();
    }
    fn make(&self, name: &str, github: bool, with_gh: bool) -> Result<NewProject, String> {
        project_new_with(&self.git, &self.store, with_gh.then_some(self.gh.as_path()), &self.parent, name, github)
    }
}

#[test]
fn a_new_project_without_github_is_a_ready_git_folder() {
    let s = setup("pn-local");
    let made = s.make("alpha", false, true).unwrap();
    assert_eq!(made.github_url, None);
    assert_eq!(made.note, None);
    let folder = s.parent.join("alpha");
    assert_eq!(git_in(&folder, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    assert_eq!(git_in(&folder, &["log", "--format=%s"]), FIRST_COMMIT);
    assert_eq!(fs::read_to_string(folder.join(".gitignore")).unwrap(), ".worktrees/\n");
    assert_eq!(git_in(&folder, &["status", "--porcelain"]), "", "the folder starts clean");
    assert!(made.project.path.ends_with("alpha"), "{}", made.project.path);
    assert!(projects::load_projects(&s.store).iter().any(|p| p.id == made.project.id), "the project is registered");
    assert_eq!(calls(&s.gh), "", "gh is not touched when GitHub was not asked for");
}

#[test]
fn a_new_project_with_github_makes_a_private_copy() {
    let s = setup("pn-github");
    let made = s.make("beta", true, true).unwrap();
    assert_eq!(made.github_url.as_deref(), Some("https://github.com/octo/beta"));
    assert_eq!(made.note, None);
    let log = calls(&s.gh);
    assert!(log.contains("repo create beta --private --source . --push"), "{log}");
    assert!(s.parent.join("beta").join(".git").exists());
}

#[test]
fn signed_out_of_github_still_gives_a_working_local_project() {
    let s = setup("pn-signedout");
    s.flag("signedout");
    let made = s.make("gamma", true, true).unwrap();
    assert_eq!(made.github_url, None);
    assert!(made.note.as_deref().is_some_and(|n| n.contains("not signed in")), "{:?}", made.note);
    assert!(!calls(&s.gh).contains("repo create"), "no create was tried");
    assert_eq!(git_in(&s.parent.join("gamma"), &["log", "--format=%s"]), FIRST_COMMIT);
    assert!(projects::load_projects(&s.store).iter().any(|p| p.id == made.project.id));
}

#[test]
fn a_github_failure_leaves_the_local_folder_and_says_why() {
    let s = setup("pn-failcreate");
    s.flag("fail_create");
    let made = s.make("delta", true, true).unwrap();
    assert_eq!(made.github_url, None);
    assert!(made.note.as_deref().is_some_and(|n| n.contains("already exists")), "{:?}", made.note);
    assert!(s.parent.join("delta").join(".git").exists());
}

#[test]
fn without_gh_installed_the_note_says_so() {
    let s = setup("pn-nogh");
    let made = s.make("epsilon", true, false).unwrap();
    assert_eq!(made.github_url, None);
    assert!(made.note.as_deref().is_some_and(|n| n.contains("not installed")), "{:?}", made.note);
    assert!(s.parent.join("epsilon").join(".git").exists());
}

#[test]
fn bad_names_and_places_are_refused_before_anything_is_made() {
    let s = setup("pn-names");
    for bad in ["", "   ", "a/b", "a\\b", "..", ".hidden", "-dash", "con", "NUL.txt", "star*", "dot.", "q?"] {
        assert!(s.make(bad, false, false).is_err(), "{bad:?} was accepted");
    }
    assert_eq!(fs::read_dir(&s.parent).unwrap().count(), 0, "nothing was made");
    fs::create_dir(s.parent.join("taken")).unwrap();
    let e = s.make("taken", false, false).unwrap_err();
    assert!(e.contains("already something"), "{e}");
    assert!(s.make("ok", false, false).is_ok());
    let e = project_new_with(&s.git, &s.store, None, &s.base.join("no-such-parent"), "x", false).unwrap_err();
    assert!(e.contains("not a folder"), "{e}");
}

#[test]
fn an_existing_folder_is_added_exactly_as_it_is() {
    let s = setup("pn-existing");
    let folder = s.parent.join("old");
    fs::create_dir_all(&folder).unwrap();
    git_in(&folder, &["init", "-q", "-b", "main"]);
    git_in(&folder, &["config", "user.email", "t@example.com"]);
    git_in(&folder, &["config", "user.name", "t"]);
    fs::write(folder.join("a.txt"), "a\n").unwrap();
    git_in(&folder, &["add", "."]);
    git_in(&folder, &["commit", "-q", "-m", "mine"]);
    fs::write(folder.join("loose.txt"), "l\n").unwrap();
    let project = project_add_existing(&s.git, &s.store, &folder).unwrap();
    assert!(project.path.ends_with("old"), "{}", project.path);
    assert!(projects::load_projects(&s.store).iter().any(|p| p.id == project.id));
    assert_eq!(git_in(&folder, &["rev-list", "--count", "HEAD"]), "1", "no commit was made");
    assert!(!folder.join(".gitignore").exists(), "nothing was written");
    assert_eq!(git_in(&folder, &["status", "--porcelain"]), "?? loose.txt", "the user's loose file is untouched");
    // Adding it again gives the same project.
    assert_eq!(project_add_existing(&s.git, &s.store, &folder).unwrap().id, project.id);
}

#[test]
fn adding_something_that_is_not_a_git_folder_is_refused() {
    let s = setup("pn-notgit");
    let plain = s.parent.join("plain");
    fs::create_dir_all(&plain).unwrap();
    assert!(project_add_existing(&s.git, &s.store, &plain).is_err());
    assert!(project_add_existing(&s.git, &s.store, &s.parent.join("missing")).is_err());
    assert!(!plain.join(".git").exists(), "no git was started in it");
}

// ---------------------------------------------------------------------------------------------
// The badge.
// ---------------------------------------------------------------------------------------------

const VIEW_PRIVATE: &str = r#"{"visibility":"PRIVATE","url":"https://github.com/octo/proj"}"#;

fn repo_with_origin(s: &Setup, origin: Option<&str>) -> PathBuf {
    let folder = s.parent.join("proj");
    fs::create_dir_all(&folder).unwrap();
    git_in(&folder, &["init", "-q", "-b", "main"]);
    if let Some(o) = origin {
        git_in(&folder, &["remote", "add", "origin", o]);
    }
    folder
}

fn view(s: &Setup, json: &str) {
    fs::write(s.gh.parent().unwrap().join("repo_view.json"), json).unwrap();
}

const ORIGIN: &str = "https://github.com/octo/proj.git";

#[test]
fn badge_private_and_public() {
    let s = setup("bd-vis");
    let folder = repo_with_origin(&s, Some(ORIGIN));
    view(&s, VIEW_PRIVATE);
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::Private { url: "https://github.com/octo/proj".into() });
    view(&s, r#"{"visibility":"PUBLIC","url":"https://github.com/octo/proj"}"#);
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::Public { url: "https://github.com/octo/proj".into() });
    view(&s, r#"{"visibility":"INTERNAL","url":"https://github.com/octo/proj"}"#);
    assert!(matches!(badge_with(Some(&s.gh), &folder), Badge::Private { .. }), "internal counts as private");
    let log = calls(&s.gh);
    assert!(log.contains("repo view https://github.com/octo/proj --json"), "{log}");
}

#[test]
fn badge_local_only() {
    let s = setup("bd-local");
    let none = repo_with_origin(&s, None);
    assert_eq!(badge_with(Some(&s.gh), &none), Badge::LocalOnly, "no origin");
    let other = s.parent.join("elsewhere");
    fs::create_dir_all(&other).unwrap();
    git_in(&other, &["init", "-q", "-b", "main"]);
    git_in(&other, &["remote", "add", "origin", &s.base.join("somewhere.git").to_string_lossy().replace('\\', "/")]);
    assert_eq!(badge_with(Some(&s.gh), &other), Badge::LocalOnly, "an origin that is not GitHub");
    assert_eq!(calls(&s.gh), "", "gh was never asked about a project with no GitHub address");
}

#[test]
fn badge_local_only_when_github_does_not_know_the_address() {
    let s = setup("bd-gone");
    let folder = repo_with_origin(&s, Some(ORIGIN)); // no repo_view.json: gh says it cannot resolve the repository
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::LocalOnly);
}

#[test]
fn badge_not_git() {
    let s = setup("bd-notgit");
    let plain = s.parent.join("plain");
    fs::create_dir_all(&plain).unwrap();
    assert_eq!(badge_with(Some(&s.gh), &plain), Badge::NotGit);
    assert_eq!(badge_with(Some(&s.gh), &s.parent.join("missing")), Badge::NotGit);
}

#[test]
fn badge_sign_in_needed() {
    let s = setup("bd-signin");
    let folder = repo_with_origin(&s, Some(ORIGIN));
    view(&s, VIEW_PRIVATE);
    assert_eq!(badge_with(None, &folder), Badge::SignInNeeded, "gh is not installed");
    view(&s, "this is not json");
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::SignInNeeded, "an answer that cannot be read");
    view(&s, r#"{"url":"https://github.com/octo/proj"}"#);
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::SignInNeeded, "no visibility in the answer");
    view(&s, VIEW_PRIVATE);
    s.flag("signedout");
    assert_eq!(badge_with(Some(&s.gh), &folder), Badge::SignInNeeded, "gh is signed out");
}

#[test]
fn badge_serializes_with_its_kind_for_the_screens() {
    let v = serde_json::to_value(Badge::Private { url: "https://github.com/o/p".into() }).unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "private", "url": "https://github.com/o/p" }));
    assert_eq!(serde_json::to_value(Badge::LocalOnly).unwrap(), serde_json::json!({ "kind": "localOnly" }));
    assert_eq!(serde_json::to_value(Badge::NotGit).unwrap(), serde_json::json!({ "kind": "notGit" }));
    assert_eq!(serde_json::to_value(Badge::SignInNeeded).unwrap(), serde_json::json!({ "kind": "signInNeeded" }));
}
