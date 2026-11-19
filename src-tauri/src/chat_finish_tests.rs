use super::*;
use crate::test_dir::{temp, TempDir};
use std::fs;
use std::process::Command;

pub(crate) fn git_in(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn git_try(dir: &Path, args: &[&str]) -> bool {
    Command::new("git").args(args).current_dir(dir).output().unwrap().status.success()
}

fn branch_exists(repo: &Path, b: &str) -> bool {
    git_try(repo, &["rev-parse", "-q", "--verify", &format!("refs/heads/{b}")])
}

pub(crate) fn real_git() -> Git {
    Git { version: git_in(Path::new("."), &["--version"]) }
}

/// A stand-in gh: logs every call to calls.txt next to itself and answers from files in its folder.
///   signedout        -> `config get` fails
///   fail_create      -> `repo create` fails
///   repo_view.json   -> what `repo view` prints (else it fails)
///   pr.json          -> what `pr view` prints (else "no pull requests found")
///   pr_new.json      -> copied to pr.json by `pr create`
pub(crate) fn stand_in_gh(dir: &Path) -> PathBuf {
    fs::create_dir_all(dir).unwrap();
    if cfg!(windows) {
        let file = dir.join("gh.cmd");
        let script = [
            "@echo off",
            "echo %*>>\"%~dp0calls.txt\"",
            "if \"%1\"==\"config\" goto config",
            "if \"%1\"==\"repo\" goto repo",
            "if \"%1\"==\"pr\" goto pr",
            "if \"%1\"==\"api\" goto api",
            "exit /b 0",
            ":config",
            "if exist \"%~dp0signedout\" (echo could not find key \"user\" 1>&2 & exit /b 1)",
            "echo octo",
            "exit /b 0",
            ":repo",
            "if \"%2\"==\"create\" goto create",
            "if exist \"%~dp0repo_view.json\" (type \"%~dp0repo_view.json\" & exit /b 0)",
            "echo could not resolve to a repository 1>&2",
            "exit /b 1",
            ":create",
            "if exist \"%~dp0fail_create\" (echo name already exists on this account 1>&2 & exit /b 1)",
            "echo https://github.com/octo/%3",
            "exit /b 0",
            ":pr",
            "if \"%2\"==\"create\" goto prcreate",
            "if \"%2\"==\"merge\" exit /b 0",
            "if exist \"%~dp0pr.json\" (type \"%~dp0pr.json\" & exit /b 0)",
            "echo no pull requests found for branch 1>&2",
            "exit /b 1",
            ":prcreate",
            "more >nul",
            "copy /y \"%~dp0pr_new.json\" \"%~dp0pr.json\" >nul",
            "echo https://github.com/octo/proj/pull/7",
            "exit /b 0",
            ":api",
            "more >nul",
            "echo {\"merged\":true,\"sha\":\"abc\"}",
            "exit /b 0",
        ];
        fs::write(&file, script.join("\r\n")).unwrap();
        file
    } else {
        let file = dir.join("gh");
        let script = r#"#!/bin/sh
d=$(dirname "$0")
echo "$*" >> "$d/calls.txt"
case "$1" in
config) [ -f "$d/signedout" ] && { echo 'could not find key "user"' >&2; exit 1; }; echo octo; exit 0;;
repo) if [ "$2" = create ]; then [ -f "$d/fail_create" ] && { echo 'name already exists on this account' >&2; exit 1; }; echo "https://github.com/octo/$3"; exit 0; fi
  [ -f "$d/repo_view.json" ] && { cat "$d/repo_view.json"; exit 0; }; echo 'could not resolve to a repository' >&2; exit 1;;
pr) case "$2" in create) cat > /dev/null; cp "$d/pr_new.json" "$d/pr.json"; echo https://github.com/octo/proj/pull/7; exit 0;; merge) exit 0;; esac
  [ -f "$d/pr.json" ] && { cat "$d/pr.json"; exit 0; }; echo 'no pull requests found for branch' >&2; exit 1;;
api) cat > /dev/null; echo '{"merged":true,"sha":"abc"}'; exit 0;;
esac
exit 0
"#;
        fs::write(&file, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        file
    }
}

pub(crate) fn calls(gh: &Path) -> String {
    fs::read_to_string(gh.parent().unwrap().join("calls.txt")).unwrap_or_default()
}

const PR_URL: &str = "https://github.com/octo/proj/pull/7";

/// What `pr view` says for a pull request whose one check is in `state`: green, red or pending.
fn pr_json(state: &str) -> String {
    let (status, conclusion) = match state {
        "green" => ("COMPLETED", "SUCCESS"),
        "red" => ("COMPLETED", "FAILURE"),
        _ => ("IN_PROGRESS", ""),
    };
    format!("{{\"number\":7,\"url\":\"{PR_URL}\",\"state\":\"OPEN\",\"title\":\"t\",\"headRefName\":\"chat-1\",\"isDraft\":false,\"mergeable\":\"MERGEABLE\",\"statusCheckRollup\":[{{\"__typename\":\"CheckRun\",\"name\":\"build\",\"status\":\"{status}\",\"conclusion\":\"{conclusion}\"}}]}}")
}

struct World {
    base: TempDir,
    project: PathBuf,
    bare: Option<PathBuf>,
    gh: PathBuf,
    git: Git,
}

impl World {
    fn kept(&self) -> PathBuf {
        self.base.join("kept")
    }
    fn data(&self) -> PathBuf {
        self.base.join("data")
    }
    /// A new chat folder on a new branch `chat-1`, trusted like the user's own.
    fn chat(&self) -> PathBuf {
        let wt = self.base.join("chat-1-folder");
        git_in(&self.project, &["worktree", "add", "-q", &wt.to_string_lossy(), "-b", "chat-1"]);
        crate::git::trust_for_test(&wt);
        wt
    }
    fn finish(&self, wt: &Path, auto_merge: bool, with_gh: bool) -> Vec<Announcement> {
        fs::create_dir_all(self.data()).unwrap();
        let tools = Tools { git: &self.git, data_dir: &self.data(), gh: with_gh.then_some(self.gh.as_path()), remote_is_github: true };
        chat_finish_with(&tools, &self.project, wt, "chat-1", auto_merge, &self.kept())
    }
    fn set_checks(&self, state: &str) {
        fs::write(self.gh.parent().unwrap().join("pr_new.json"), pr_json(state)).unwrap();
    }
}

/// A project on `main` (ignoring node_modules, target and .env), optionally with a bare folder as its origin.
fn world(tag: &str, remote: bool) -> World {
    let base = temp(tag);
    let project = base.join("proj");
    fs::create_dir_all(&project).unwrap();
    git_in(&project, &["init", "-q", "-b", "main"]);
    git_in(&project, &["config", "user.email", "t@example.com"]);
    git_in(&project, &["config", "user.name", "t"]);
    fs::write(project.join("README.md"), "hello\n").unwrap();
    fs::write(project.join(".gitignore"), "node_modules/\ntarget/\n.env\n.worktrees/\n").unwrap();
    git_in(&project, &["add", "."]);
    git_in(&project, &["commit", "-q", "-m", "first"]);
    crate::git::trust_for_test(&project);
    let bare = remote.then(|| {
        let bare = base.join("origin.git");
        fs::create_dir_all(&bare).unwrap();
        git_in(&bare, &["init", "-q", "--bare", "-b", "main"]);
        git_in(&project, &["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")]);
        git_in(&project, &["push", "-q", "-u", "origin", "main"]);
        git_in(&project, &["remote", "set-head", "origin", "main"]);
        bare
    });
    let gh = stand_in_gh(&base.join("tools"));
    World { base, project, bare, gh, git: real_git() }
}

fn write_in(wt: &Path, file: &str, text: &str) {
    let at = wt.join(file);
    fs::create_dir_all(at.parent().unwrap()).unwrap();
    fs::write(at, text).unwrap();
}

#[test]
fn green_checks_merge_the_pull_request_and_catch_main_up() {
    let w = world("cf-green", true);
    // GitHub's main moves on while the chat works (someone else's change).
    let other = w.base.join("other");
    git_in(&w.base, &["clone", "-q", &w.bare.as_ref().unwrap().to_string_lossy(), &other.to_string_lossy()]);
    git_in(&other, &["config", "user.email", "o@example.com"]);
    git_in(&other, &["config", "user.name", "o"]);
    fs::write(other.join("theirs.txt"), "t\n").unwrap();
    git_in(&other, &["add", "."]);
    git_in(&other, &["commit", "-q", "-m", "theirs"]);
    git_in(&other, &["push", "-q", "origin", "main"]);

    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("green");
    let out = w.finish(&wt, true, true);
    assert_eq!(out, vec![Announcement::Merged], "{out:?}");
    let log = calls(&w.gh);
    assert!(log.contains("api -X PUT repos/octo/proj/pulls/7/merge"), "{log}");
    assert!(log.contains("pr create"), "{log}");
    assert!(!wt.exists(), "the chat's folder is gone");
    assert!(!branch_exists(&w.project, "chat-1"), "the merged branch is gone");
    assert!(w.project.join("theirs.txt").exists(), "main was fast-forwarded to what GitHub has");
}

#[test]
fn main_checked_out_nowhere_is_caught_up_by_a_fetch() {
    let w = world("cf-nowhere", true);
    let other = w.base.join("other");
    git_in(&w.base, &["clone", "-q", &w.bare.as_ref().unwrap().to_string_lossy(), &other.to_string_lossy()]);
    git_in(&other, &["config", "user.email", "o@example.com"]);
    git_in(&other, &["config", "user.name", "o"]);
    fs::write(other.join("theirs.txt"), "t\n").unwrap();
    git_in(&other, &["add", "."]);
    git_in(&other, &["commit", "-q", "-m", "theirs"]);
    git_in(&other, &["push", "-q", "origin", "main"]);
    git_in(&w.project, &["checkout", "-q", "-b", "side"]); // main is open nowhere now

    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("green");
    let out = w.finish(&wt, true, true);
    assert_eq!(out, vec![Announcement::Merged], "{out:?}");
    let theirs = git_in(&other, &["rev-parse", "HEAD"]);
    assert_eq!(git_in(&w.project, &["rev-parse", "refs/heads/main"]), theirs, "the local main branch now matches GitHub's");
    assert_eq!(git_in(&w.project, &["rev-parse", "--abbrev-ref", "HEAD"]), "side", "the checkout was not moved");
}

#[test]
fn a_main_folder_with_the_users_edits_is_left_alone_after_a_github_merge() {
    let w = world("cf-edits-remote", true);
    fs::write(w.project.join("README.md"), "my own edit\n").unwrap();
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("green");
    let out = w.finish(&wt, true, true);
    assert_eq!(out[0], Announcement::Merged, "{out:?}");
    assert!(matches!(&out[1], Announcement::Blocked { reason } if reason.contains("not brought up to date")), "{out:?}");
    assert_eq!(fs::read_to_string(w.project.join("README.md")).unwrap(), "my own edit\n");
}

#[test]
fn red_checks_leave_the_pull_request_open() {
    let w = world("cf-red", true);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("red");
    let out = w.finish(&wt, true, true);
    assert_eq!(out, vec![Announcement::ChecksFailed { url: PR_URL.into() }], "{out:?}");
    assert!(!calls(&w.gh).contains("api -X PUT"), "nothing was merged");
    assert!(branch_exists(&w.project, "chat-1"), "the branch stays for the open pull request");
    assert!(!wt.exists());
}

#[test]
fn pending_checks_ask_github_to_merge_when_they_pass() {
    let w = world("cf-pending", true);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("pending");
    let out = w.finish(&wt, true, true);
    assert_eq!(out, vec![Announcement::PrOpened { url: PR_URL.into() }], "{out:?}");
    let log = calls(&w.gh);
    assert!(log.contains(&format!("pr merge {PR_URL} --auto --merge")), "{log}");
    assert!(!log.contains("api -X PUT"), "{log}");
}

#[test]
fn with_auto_merge_off_only_the_link_is_reported() {
    let w = world("cf-off", true);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    w.set_checks("green");
    let out = w.finish(&wt, false, true);
    assert_eq!(out, vec![Announcement::PrOpened { url: PR_URL.into() }], "{out:?}");
    let log = calls(&w.gh);
    assert!(!log.contains("api -X PUT") && !log.contains("pr merge"), "{log}");
    assert!(!wt.exists());
}

#[test]
fn without_gh_the_branch_is_just_sent() {
    let w = world("cf-nogh", true);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    let out = w.finish(&wt, true, false);
    assert_eq!(out, vec![Announcement::SentToGitHub], "{out:?}");
    assert!(git_try(w.bare.as_ref().unwrap(), &["rev-parse", "-q", "--verify", "refs/heads/chat-1"]), "the branch reached the remote");
}

#[test]
fn without_a_remote_the_work_merges_into_local_main() {
    let w = world("cf-local", false);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    let out = w.finish(&wt, true, false);
    assert_eq!(out, vec![Announcement::MergedLocal], "{out:?}");
    assert_eq!(fs::read_to_string(w.project.join("mine.txt")).unwrap().replace("\r\n", "\n"), "m\n"); // git may have turned line ends into CRLF on checkout
    assert!(!wt.exists());
    assert!(!branch_exists(&w.project, "chat-1"));
}

#[test]
fn without_a_remote_a_main_folder_with_edits_is_left_alone() {
    let w = world("cf-local-edits", false);
    fs::write(w.project.join("README.md"), "my own edit\n").unwrap();
    let before = git_in(&w.project, &["rev-parse", "HEAD"]);
    let wt = w.chat();
    write_in(&wt, "mine.txt", "m\n");
    let out = w.finish(&wt, true, false);
    assert_eq!(out[0], Announcement::SavedLocal, "{out:?}");
    assert!(matches!(&out[1], Announcement::Blocked { .. }), "{out:?}");
    assert_eq!(fs::read_to_string(w.project.join("README.md")).unwrap(), "my own edit\n");
    assert_eq!(git_in(&w.project, &["rev-parse", "HEAD"]), before, "main did not move");
    assert!(branch_exists(&w.project, "chat-1"), "the work is on its branch");
    assert!(!wt.exists());
}

#[test]
fn an_unchanged_chat_leaves_no_branch_and_no_announcement() {
    for remote in [false, true] {
        let w = world(if remote { "cf-same-r" } else { "cf-same" }, remote);
        let wt = w.chat();
        let out = w.finish(&wt, true, true);
        assert!(out.is_empty(), "{out:?}");
        assert!(!wt.exists());
        assert!(!branch_exists(&w.project, "chat-1"), "remote {remote}");
    }
}

#[test]
fn an_ignored_env_file_is_kept_as_one_file_and_node_modules_is_not_copied() {
    let w = world("cf-kept", false);
    let wt = w.chat();
    write_in(&wt, ".env", "TOKEN=fake\n");
    write_in(&wt, "node_modules/pkg/index.js", "x\n");
    write_in(&wt, "target/debug/app", "x\n");
    write_in(&wt, "mine.txt", "m\n");
    let out = w.finish(&wt, true, false);
    let kept: Vec<&Announcement> = out.iter().filter(|a| matches!(a, Announcement::KeptFile { .. })).collect();
    assert_eq!(kept.len(), 1, "{out:?}");
    assert!(matches!(kept[0], Announcement::KeptFile { path } if path.ends_with(".env")), "{out:?}");
    assert_eq!(fs::read_to_string(w.kept().join(".env")).unwrap(), "TOKEN=fake\n");
    assert!(!w.kept().join("node_modules").exists() && !w.kept().join("target").exists());
    assert!(out.contains(&Announcement::MergedLocal), "{out:?}");
    assert!(!w.project.join(".env").exists(), ".env was never committed");
}

#[test]
fn a_chat_with_only_an_ignored_file_keeps_it_and_leaves_no_branch() {
    let w = world("cf-kept-only", false);
    let wt = w.chat();
    write_in(&wt, ".env", "TOKEN=fake\n");
    let out = w.finish(&wt, true, false);
    assert!(matches!(out.as_slice(), [Announcement::KeptFile { .. }]), "{out:?}");
    assert!(!wt.exists());
    assert!(!branch_exists(&w.project, "chat-1"));
}

#[test]
fn a_rebase_left_half_done_is_aborted_and_reported() {
    let w = world("cf-rebase", false);
    let wt = w.chat();
    write_in(&wt, "README.md", "chat version\n");
    git_in(&wt, &["add", "."]);
    git_in(&wt, &["commit", "-q", "-m", "chat change"]);
    fs::write(w.project.join("README.md"), "main version\n").unwrap();
    git_in(&w.project, &["commit", "-q", "-am", "main change"]);
    assert!(!git_try(&wt, &["rebase", "main"]), "the rebase must stop on a conflict");
    let out = w.finish(&wt, true, false);
    assert!(matches!(&out[0], Announcement::Blocked { reason } if reason.contains("rebase")), "{out:?}");
    assert!(!wt.exists(), "the folder is removed all the same");
    assert!(branch_exists(&w.project, "chat-1"), "the chat's own commit is on its branch");
    assert_eq!(git_in(&w.project, &["log", "-1", "--format=%s", "chat-1"]), "chat change");
    assert!(!out.contains(&Announcement::MergedLocal));
}

#[test]
fn a_repository_inside_the_chat_folder_is_copied_out_and_reported() {
    let w = world("cf-nested", false);
    let wt = w.chat();
    let inner = wt.join("inner");
    fs::create_dir_all(&inner).unwrap();
    git_in(&inner, &["init", "-q", "-b", "main"]);
    fs::write(inner.join("note.txt"), "n\n").unwrap();
    write_in(&wt, "mine.txt", "m\n");
    let out = w.finish(&wt, true, false);
    assert!(matches!(&out[0], Announcement::Blocked { reason } if reason.contains("another repository")), "{out:?}");
    assert_eq!(fs::read_to_string(w.kept().join("inner").join("note.txt")).unwrap(), "n\n");
    assert_eq!(fs::read_to_string(w.kept().join("mine.txt")).unwrap(), "m\n", "what could not go into git was kept as a file");
    assert!(!wt.exists());
}
