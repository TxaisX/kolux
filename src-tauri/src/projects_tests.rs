//! Tests for `projects.rs`, moved out unchanged (c2-agents audit: projects.rs split along its test seam).

#[test]
fn row931_b_a_writer_naming_no_agent_and_no_command_never_asks_and_the_task_names_the_branch() {
    use crate::scm::writers::WriterArg;
    let calls = std::cell::Cell::new(0);
    let asker = |_: &WriterArg, _: &str| -> Result<String, String> {
        calls.set(calls.get() + 1);
        Ok("never-used".into())
    };
    assert_eq!(writer_reply(Some(&WriterArg::default()), "Fix the login bug", &asker), "Fix the login bug");
    let blank = WriterArg { command: Some("  ".into()), ..Default::default() };
    assert_eq!(writer_reply(Some(&blank), "Fix the login bug", &asker), "Fix the login bug");
    assert_eq!(writer_reply(None, "Fix the login bug", &asker), "Fix the login bug");
    assert_eq!(calls.get(), 0, "no agent or command named: nothing may be asked");
    let agent = WriterArg { agent: Some("claude".into()), ..Default::default() };
    assert_eq!(writer_reply(Some(&agent), "task", &asker), "never-used");
    assert_eq!(calls.get(), 1);
}
use super::*;
use std::fs;

#[test]
fn app051_only_gone_unused_worktrees_on_reachable_storage_are_forgotten() {
    let base = temp("app051");
    let repo = base.join("r");
    init_repo(&repo);
    for w in ["gone", "used", "here"] {
        git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
    }
    fs::remove_dir_all(base.join("gone")).unwrap();
    fs::remove_dir_all(base.join("used")).unwrap();
    let git = Git::detect().unwrap();
    let mut all = git.worktrees(&repo).unwrap();
    let busy = vec![base.join("used").join("src").to_string_lossy().into_owned()];
    #[cfg(windows)]
    if let Some(letter) = (b'D'..=b'Z').map(char::from).find(|c| !Path::new(&format!("{c}:/")).exists()) {
        let mut away = all[1].clone();
        away.path = format!("{letter}:/unplugged/wt");
        all.push(away);
    }
    let forgot = forget_gone(&repo, &all, &busy, |_| {});
    assert_eq!(forgot.len(), 1, "{forgot:?}");
    assert!(name_key(&forgot[0]).ends_with("gone"));
    let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
    assert!(left.iter().any(|p| p.ends_with("used")) && left.iter().any(|p| p.ends_with("here")), "{left:?}");
    assert!(!left.iter().any(|p| p.ends_with("gone")), "{left:?}");
    assert!(base.join("here").join("a.txt").exists());
    git_in(&repo, &["rev-parse", "--verify", "refs/heads/gone"]);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn t441c_the_launch_sweep_forgets_only_worktrees_kolux_made() {
    let base = temp("t441c-sweep");
    let repo = base.join("r");
    init_repo(&repo);
    for w in ["ours", "theirs"] {
        git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
    }
    let store = Store::open(&base.join("db")).unwrap();
    set_origin(&store, &base.join("ours").to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    fs::remove_dir_all(base.join("ours")).unwrap();
    fs::remove_dir_all(base.join("theirs")).unwrap();
    let git = Git::detect().unwrap();
    let all = git.worktrees(&repo).unwrap();
    let forgot = forget_gone(&repo, &kolux_made(&load_origins(&store), all), &[], |_| {});
    assert_eq!(forgot.len(), 1, "{forgot:?}");
    assert!(name_key(&forgot[0]).ends_with("ours"));
    let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
    assert!(left.iter().any(|p| p.ends_with("theirs")), "the record another tool made is untouched: {left:?}");
    assert!(!left.iter().any(|p| p.ends_with("ours")), "{left:?}");
    drop(store);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn app051_a_locked_worktree_record_survives_forget_gone_at_start() {
    // forget_gone is the sweep forget_gone_at_start runs for every project at launch.
    let base = temp("app051-locked");
    let repo = base.join("r");
    init_repo(&repo);
    let wt = base.join("locked");
    git_in(&repo, &["worktree", "add", "-q", &wt.to_string_lossy(), "-b", "locked"]);
    git_in(&repo, &["worktree", "lock", &wt.to_string_lossy()]);
    fs::remove_dir_all(&wt).unwrap();
    let git = Git::detect().unwrap();
    let all = git.worktrees(&repo).unwrap();
    assert_eq!(forget_gone(&repo, &all, &[], |_| {}), Vec::<String>::new());
    let admin = repo.join(".git").join("worktrees");
    let kept: Vec<_> = fs::read_dir(&admin).unwrap().flatten().filter(|e| e.path().join("locked").exists()).collect();
    assert_eq!(kept.len(), 1, "the locked record under {} is still there", admin.display());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn set033_a_display_name_is_one_clean_line_or_nothing() {
    assert_eq!(clean_display_name("  My   shop 	 app "), Some("My shop app".into()));
    assert_eq!(clean_display_name("a[31mb
c"), Some("a[31mb c".into()), "control characters drop, a line break is a space");
    assert_eq!(clean_display_name("   
	 "), None);
    assert_eq!(clean_display_name(""), None);
    let long = "x".repeat(200);
    assert_eq!(clean_display_name(&long).unwrap().chars().count(), DISPLAY_NAME_MAX);
    assert_eq!(clean_display_name("한글 이름"), Some("한글 이름".into()));
}

#[test]
fn set033_a_display_name_is_kept_beside_the_other_fields_and_survives_edits_and_a_re_add() {
    let git = Git::detect().unwrap();
    let profile = temp("setdn-profile");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("setdn-repo");
    let p = add_project(&git, &store, &repo).unwrap();
    assert_eq!(p.display_name, None);
    let named = set_display_name(&store, &p.id, " Shop  front ").unwrap();
    assert_eq!(named.display_name.as_deref(), Some("Shop front"));
    assert_eq!((&named.name, &named.path), (&p.name, &p.path), "the folder name and path never change");
    // the per-repository folder and base edits (project_set) keep it
    let mut projects = load_projects(&store);
    projects[0].base = Some("develop".into());
    save_projects(&store, &projects).unwrap();
    assert_eq!(load_projects(&store)[0].display_name.as_deref(), Some("Shop front"));
    // adding the same repository again returns the saved record, name included
    assert_eq!(add_project(&git, &store, &repo).unwrap().display_name.as_deref(), Some("Shop front"));
    // an old record without the field still loads, and blank clears it
    assert!(!serde_json::to_string(&p).unwrap().contains("displayName"));
    let old: Project = serde_json::from_str(r#"{"id":"a","name":"a","path":"C:/a"}"#).unwrap();
    assert_eq!(old.display_name, None);
    assert_eq!(set_display_name(&store, &p.id, "  ").unwrap().display_name, None);
    assert!(set_display_name(&store, "nope", "x").is_err());
    drop(store);
    let _ = fs::remove_dir_all(&profile);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn view038_a_workspace_carries_the_number_of_the_issue_or_pull_request_it_is_linked_to() {
    assert_eq!(item_number(&serde_json::json!({ "madeBy": "app", "issue": 34, "issueUrl": "https://github.com/o/r/issues/34" })), Some(34));
    assert_eq!(item_number(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/12" })), Some(12));
    assert_eq!(item_number(&serde_json::json!({ "madeBy": "cli", "issue": null })), None);
    assert_eq!(item_number(&serde_json::json!({ "madeBy": "app" })), None);
}

#[test]
fn sess025_handoff_note_is_made_once_and_never_overwritten() {
    let repo = temp("handoff");
    let path = prepare_handoff(&repo, "gentle-squid").unwrap();
    assert_eq!(path, repo.join(".kolux").join("handoffs").join("gentle-squid.md"));
    let text = fs::read_to_string(&path).unwrap();
    for heading in ["## Files added", "## Files updated", "## Files removed", "## Left to do"] {
        assert!(text.contains(heading), "{heading} in {text}");
    }
    fs::write(&path, "kept").unwrap();
    assert_eq!(prepare_handoff(&repo, "gentle-squid").unwrap(), path);
    assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
    let odd = prepare_handoff(&repo, "../escape").unwrap();
    assert_eq!(odd.parent().unwrap(), repo.join(".kolux").join("handoffs"));
    assert!(prepare_handoff(&repo, "///").is_err());
}

/// P10: the notes are Kolux's scratch: they never show as untracked, while the rest of `.kolux/`
/// and the user's own ignore files are left as they were.
#[test]
fn sess025_handoff_notes_never_show_in_git_status() {
    let repo = temp_repo("handoff-ignored");
    fs::write(repo.join(".gitignore"), "target/\n").unwrap();
    git_in(&repo, &["add", ".gitignore"]);
    git_in(&repo, &["commit", "-q", "-m", "ignore"]);
    fs::create_dir_all(repo.join(".kolux")).unwrap();
    fs::write(repo.join(".kolux").join("issue-command"), "echo x\n").unwrap();
    prepare_handoff(&repo, "gentle-squid").unwrap();
    prepare_handoff(&repo, "calm-otter").unwrap();
    let status = String::from_utf8(Command::new("git").args(["status", "--porcelain", "--untracked-files=all"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    assert!(!status.contains("handoffs"), "{status}");
    assert!(status.contains(".kolux/issue-command"), "the rest of .kolux/ is the user's to commit: {status}");
    assert_eq!(fs::read_to_string(repo.join(".gitignore")).unwrap(), "target/\n", "the user's ignore file is untouched");
    // A .gitignore the user put there is never replaced.
    fs::write(repo.join(".kolux").join("handoffs").join(".gitignore"), "mine\n").unwrap();
    prepare_handoff(&repo, "third").unwrap();
    assert_eq!(fs::read_to_string(repo.join(".kolux").join("handoffs").join(".gitignore")).unwrap(), "mine\n");
    let _ = fs::remove_dir_all(&repo);
}
use std::process::Command;

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-proj-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn work_item(host: &str, owner: &str, repo: &str) -> WorkItem {
    WorkItem { host: host.into(), owner: owner.into(), repo: repo.into(), kind: "issue".into(), number: 3 }
}
fn project_at(id: &str, dir: &Path) -> Project {
    Project { id: id.into(), name: id.into(), path: dir.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None }
}
const ALIAS: &str = "Host work-gh
  HostName github.com
";

#[test]
fn proj037_workspace_item_accepts_a_remote_through_an_ssh_alias_only_when_the_config_names_it() {
    let base = temp("proj037-item-alias");
    let repo = base.join("r");
    init_repo(&repo);
    git_in(&repo, &["remote", "add", "origin", "git@work-gh:acme/app.git"]);
    let project = project_at("p", &repo);
    let link = work_item("github.com", "acme", "app");
    assert_eq!(item_is_remote_of(&project, &link, ALIAS), Ok(()));
    let refused = item_is_remote_of(&project, &link, "").unwrap_err();
    assert!(refused.contains("not a remote of p"), "{refused}");
    assert!(item_is_remote_of(&project, &work_item("github.com", "acme", "other"), ALIAS).is_err());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn proj037_workspace_from_item_finds_the_project_whose_remote_is_an_ssh_alias() {
    let base = temp("proj037-from-alias");
    let (plain, aliased) = (base.join("plain"), base.join("aliased"));
    for (dir, url) in [(&plain, "https://github.com/Corp/Lib.git"), (&aliased, "git@work-gh:acme/app.git")] {
        init_repo(dir);
        git_in(dir, &["remote", "add", "origin", url]);
    }
    let all = || vec![project_at("plain", &plain), project_at("aliased", &aliased)];
    let link = work_item("github.com", "acme", "app");
    assert_eq!(project_with_remote(all(), &link, ALIAS).unwrap().id, "aliased");
    assert!(project_with_remote(all(), &link, "").unwrap_err().contains("No project here has github.com/acme/app"));
    assert_eq!(project_with_remote(all(), &work_item("github.com", "corp", "lib"), "").unwrap().id, "plain");
    let _ = fs::remove_dir_all(&base);
}

fn git_in(dir: &Path, args: &[&str]) {
    let ok = Command::new("git").args(args).current_dir(dir).output().unwrap().status.success();
    assert!(ok, "git {args:?} in {}", dir.display());
}

fn temp_repo(name: &str) -> PathBuf {
    let dir = temp(name);
    init_repo(&dir);
    dir
}

fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    git_in(dir, &["init", "-q", "-b", "main"]);
    git_in(dir, &["config", "user.email", "t@example.com"]);
    git_in(dir, &["config", "user.name", "t"]);
    fs::write(dir.join("a.txt"), "a").unwrap();
    git_in(dir, &["add", "."]);
    git_in(dir, &["commit", "-q", "-m", "first"]);
}

fn rev(dir: &Path, r: &str) -> String {
    String::from_utf8(Command::new("git").args(["rev-parse", r]).current_dir(dir).output().unwrap().stdout).unwrap().trim().to_string()
}

fn nested(root: &Path) -> Place {
    Place { root: root.to_path_buf(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false }
}

#[test]
fn a_new_workspace_can_start_from_a_refreshed_base() {
    let git = Git::detect().unwrap();
    let profile = temp("refresh");
    let store = Store::open(&profile).unwrap();
    let remote = temp("refresh-remote");
    git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
    let repo = temp_repo("refresh-r");
    let remote_url = remote.to_string_lossy().to_string();
    git_in(&repo, &["remote", "add", "origin", &remote_url]);
    git_in(&repo, &["push", "-q", "-u", "origin", "main"]);
    // Someone else moves origin/main on.
    let other = temp("refresh-other");
    git_in(&other, &["clone", "-q", &remote_url, "."]);
    let push_one = |file: &str| {
        git_in(&other, &["-c", "user.name=o", "-c", "user.email=o@o", "commit", "-q", "--allow-empty", "-m", file]);
        git_in(&other, &["push", "-q"]);
        rev(&other, "HEAD")
    };
    let ahead = push_one("b");
    let root = temp("refresh-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let head = |c: &Created| rev(Path::new(&c.worktree.path), "HEAD");
    let on = Place { refresh: true, ..nested(&root) };

    // Off: the workspace starts from the local base, and Kolux says it is behind.
    let made = create_workspace(&git, &nested(&root), &project, "off", None).unwrap();
    assert_ne!(head(&made), ahead);
    assert!(made.warnings.iter().any(|w| w.contains("main is 1 commit behind origin/main")), "{:?}", made.warnings);

    // On, but main's own worktree has uncommitted changes: left alone, with a note.
    fs::write(repo.join("a.txt"), "dirty").unwrap();
    let made = create_workspace(&git, &on, &project, "dirty", None).unwrap();
    assert_ne!(head(&made), ahead);
    assert!(made.warnings.iter().any(|w| w.contains("uncommitted changes")), "{:?}", made.warnings);
    // Off with that worktree dirty: no suggestion to update it.
    assert!(create_workspace(&git, &nested(&root), &project, "quiet", None).unwrap().warnings.is_empty());

    // On and clean: main fast-forwards and the workspace starts from it.
    git_in(&repo, &["checkout", "--", "a.txt"]);
    let made = create_workspace(&git, &on, &project, "on", None).unwrap();
    assert_eq!((head(&made), rev(&repo, "main")), (ahead.clone(), ahead.clone()));
    assert!(made.warnings.is_empty(), "{:?}", made.warnings);

    // Not checked out anywhere: the branch itself is moved on.
    git_in(&repo, &["checkout", "-q", "-b", "side"]);
    let ahead = push_one("c");
    let made = create_workspace(&git, &on, &project, "moved", Some("main")).unwrap();
    assert_eq!((head(&made), rev(&repo, "main")), (ahead.clone(), ahead.clone()));

    // A base with commits of its own is never rewound or merged.
    git_in(&repo, &["checkout", "-q", "main"]);
    git_in(&repo, &["commit", "-q", "--allow-empty", "-m", "mine"]);
    let mine = rev(&repo, "main");
    push_one("d");
    let made = create_workspace(&git, &on, &project, "kept", None).unwrap();
    assert_eq!((head(&made), rev(&repo, "main")), (mine.clone(), mine));
    assert!(made.warnings.iter().any(|w| w.contains("commits of its own")), "{:?}", made.warnings);

    drop(store);
    for d in [profile, remote, repo, other, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn secret_looking_names_are_spotted_and_templates_are_not() {
    for s in [".env", ".env.local", "config/.env.production", "prod.env", "id_rsa", "server.key", "cert.PEM", "store.p12", ".npmrc", "credentials.json", "api-token.txt", "secrets.yaml", ".git-credentials"] {
        assert!(looks_secret(s), "{s}");
    }
    for s in [".env.example", ".env.sample", "README.md", "src/tokens.ts", "id_rsa.pub", "package.json", "secret-santa.md"] {
        assert!(!looks_secret(s), "{s}");
    }
}

#[test]
fn a_plain_folder_gets_git_and_a_first_commit_without_its_secrets() {
    let git = Git::detect().unwrap();
    let profile = temp("first-profile");
    let store = Store::open(&profile).unwrap();
    let dir = temp("first");
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("README.md"), "hi").unwrap();
    fs::write(dir.join("src").join("main.rs"), "fn main() {}").unwrap();
    fs::write(dir.join(".env"), "API_KEY=not-real").unwrap();
    fs::write(dir.join(".gitignore"), "build/\n").unwrap();
    fs::create_dir_all(dir.join("build")).unwrap();
    fs::write(dir.join("build").join("out.bin"), "x").unwrap();
    let preview = first_commit_preview(&dir).unwrap();
    let shown: Vec<(&str, bool)> = preview.iter().map(|f| (f.path.as_str(), f.secret)).collect();
    assert_eq!(shown, [(".env", true), (".gitignore", false), ("README.md", false), ("src/main.rs", false)]);
    assert!(!dir.join(".git").exists(), "the preview leaves the folder as it is");
    let chosen: Vec<String> = preview.iter().filter(|f| !f.secret).map(|f| f.path.clone()).collect();
    start_git(&dir, &chosen, &["-c", "user.name=t", "-c", "user.email=t@t"]).unwrap();
    let count = crate::git::run(&["rev-list", "--count", "HEAD"], Some(&dir)).unwrap();
    assert_eq!(count, "1");
    let tracked = crate::git::run(&["ls-files"], Some(&dir)).unwrap();
    assert_eq!(tracked.lines().collect::<Vec<_>>(), [".gitignore", "README.md", "src/main.rs"]);
    let p = add_project(&git, &store, &dir).unwrap();
    assert_eq!(load_projects(&store), [p]);
    // Once Git is there, neither step runs again.
    assert!(first_commit_preview(&dir).unwrap_err().contains("already a Git repository"));
    assert!(start_git(&dir, &chosen, &[]).unwrap_err().contains("already a Git repository"));
    drop(store);
    for d in [profile, dir] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn starting_git_refuses_a_relative_or_missing_path_and_a_failed_commit_leaves_no_git() {
    assert!(first_commit_preview(Path::new("some/where")).unwrap_err().contains("not a full path"));
    let gone = std::env::temp_dir().join("kolux-proj-no-such-folder-61");
    assert!(start_git(&gone, &[], &[]).unwrap_err().contains("not an existing folder"));
    let dir = temp("first-fail");
    fs::write(dir.join("a.txt"), "a").unwrap();
    assert!(start_git(&dir, &["missing.txt".into()], &["-c", "user.name=t", "-c", "user.email=t@t"]).is_err());
    assert!(!dir.join(".git").exists(), "a failed first commit removes the Git it started");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn add_project_dedupes_and_rejects_non_repos() {
    let git = Git::detect().unwrap();
    let profile = temp("profile");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo");
    let p1 = add_project(&git, &store, &repo).unwrap();
    fs::create_dir_all(repo.join("deep").join("er")).unwrap();
    let p2 = add_project(&git, &store, &repo.join("deep").join("er")).unwrap();
    assert_eq!(p1, p2, "same repository registers once");
    assert_eq!(load_projects(&store).len(), 1);
    let plain = temp("plain");
    assert!(add_project(&git, &store, &plain).unwrap_err().contains("not inside a Git repository"));
    drop(store);
    for d in [profile, repo, plain] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn a_linked_worktree_selects_its_repository_or_is_added_itself() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("link-a");
    let linked = temp("link-wt").join("w");
    git_in(&repo, &["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy()]);
    // PROJ-006: A is a project already → picking A's linked worktree gives A, no duplicate.
    let profile = temp("link-p1");
    let store = Store::open(&profile).unwrap();
    let a = add_project(&git, &store, &repo).unwrap();
    assert_eq!(add_project(&git, &store, &linked).unwrap(), a);
    assert_eq!(load_projects(&store).len(), 1);
    drop(store);
    // A not added → the linked worktree folder itself becomes the project.
    let profile2 = temp("link-p2");
    let store = Store::open(&profile2).unwrap();
    let w = add_project(&git, &store, &linked).unwrap();
    assert!(same_folder(Path::new(&w.path), &linked), "{} is the folder picked", w.path);
    drop(store);
    git_in(&repo, &["worktree", "remove", "--force", &linked.to_string_lossy()]);
    for d in [profile, profile2, repo] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn the_branch_prefix_is_the_user_name_custom_text_or_nothing() {
    let ok = |p: &str| crate::git::run(&["check-ref-format", "--branch", &format!("{p}x")], None).is_ok();
    let user = || Some("Txais Xiong".to_string());
    assert_eq!(branch_prefix(None, None, user, &ok), ("txais-xiong/".into(), None), "the user name by default");
    assert_eq!(branch_prefix(Some("user"), None, || None, &ok), (String::new(), None), "no user name: the bare name");
    assert_eq!(branch_prefix(Some("custom"), Some(" tx// "), user, &ok).0, "tx/");
    assert_eq!(branch_prefix(Some("custom"), Some("tx"), user, &ok).0, "tx/");
    assert_eq!(branch_prefix(Some("custom"), Some("///"), user, &ok), (String::new(), None), "only slashes: none");
    assert_eq!(branch_prefix(Some("none"), Some("tx"), user, &ok), (String::new(), None));
    // GIT-066: an overly long user name gives no prefix, with a warning.
    let long = || Some("a".repeat(MAX_USER_PREFIX + 1));
    let (p, warn) = branch_prefix(None, None, long, &ok);
    assert!(p.is_empty() && warn.unwrap().contains("too long"), "a long user name is refused");
    assert_eq!(branch_prefix(None, None, || Some("a".repeat(MAX_USER_PREFIX)), &ok).0.len(), MAX_USER_PREFIX + 1);
    // The git user name first, then the gh login.
    assert_eq!(prefix_user(|| Some("Git Name".into()), || Some("ghlogin".into())).as_deref(), Some("Git Name"));
    assert_eq!(prefix_user(|| None, || Some("ghlogin".into())).as_deref(), Some("ghlogin"));
    assert_eq!(prefix_user(|| Some(" ".into()), || None), None);
    let (p, warn) = branch_prefix(Some("custom"), Some("a b"), user, &ok);
    assert!(p.is_empty() && warn.unwrap().contains("not a name Git accepts"), "Git refuses spaces");
    // The prefix goes on the branch only; the folder keeps the bare name.
    let git = Git::detect().unwrap();
    let profile = temp("prefix");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("prefix-r");
    let root = temp("prefix-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = Place { prefix: "tx/".into(), ..nested(&root) };
    let made = create_workspace(&git, &place, &project, "Fix login", None).unwrap();
    assert_eq!(made.worktree.branch.as_deref(), Some("tx/fix-login"));
    assert!(same_folder(Path::new(&made.worktree.path), &workspace_path(&place, &project, "fix-login")));
    let bad = Place { prefix_warning: Some("w".into()), ..nested(&root) };
    assert_eq!(create_workspace(&git, &bad, &project, "two", None).unwrap().warnings, vec!["w".to_string()]);
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn sess038_a_create_git_finds_locked_is_retried_and_a_failed_one_leaves_nothing() {
    use std::time::{Duration, Instant};
    assert!(lock_held("fatal: cannot lock ref 'refs/heads/x': Unable to create 'C:/r/.git/refs/heads/x.lock': File exists."));
    assert!(lock_held("Another git process seems to be running in this repository"));
    assert!(!lock_held("fatal: invalid reference: nope"));
    let git = Git::detect().unwrap();
    let profile = temp("locked");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("locked-r");
    let root = temp("locked-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);
    // Another Git process holds the new branch's lock the whole time: three tries, then the
    // error, and nothing half-made is left.
    let lock = repo.join(".git").join("refs").join("heads").join("held.lock");
    fs::write(&lock, "").unwrap();
    let started = Instant::now();
    let err = create_workspace_until(&git, &place, &project, "held", None, &|| false).unwrap_err();
    assert!(lock_held(&err), "{err}");
    assert!(started.elapsed() >= Duration::from_millis(900), "it waited between three tries");
    assert!(!workspace_path(&place, &project, "held").exists(), "no half-made folder");
    assert!(!git.branch_taken(&repo, "held"), "no half-made branch");
    assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "only the main checkout");
    // The lock goes while Kolux waits: a later try makes the workspace.
    let gone = lock.clone();
    let other = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        fs::remove_file(gone).unwrap();
    });
    let made = create_workspace_until(&git, &place, &project, "held", None, &|| false).unwrap();
    other.join().unwrap();
    assert_eq!(made.worktree.branch.as_deref(), Some("held"));
    // Cancelled while it waits: no further try.
    fs::write(repo.join(".git").join("refs").join("heads").join("again.lock"), "").unwrap();
    let tries = std::cell::Cell::new(0);
    let cancel_after_first = || {
        tries.set(tries.get() + 1);
        tries.get() > 1
    };
    assert_eq!(create_workspace_until(&git, &place, &project, "again", None, &cancel_after_first).unwrap_err(), OVERTAKEN);
    assert!(!workspace_path(&place, &project, "again").exists());
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Wave 2026-11-15 (P3): a failed add clears only a folder it made itself: one that was not there
/// before and is empty or Git's own (its `.git` file). A folder that was there already, or one
/// another program filled while Git ran, is left as it is.
#[test]
fn p3_a_failed_add_removes_only_a_folder_it_made_itself() {
    let repo = temp_repo("p3-clear");
    let root = temp("p3-clear-root");
    let fail = || Err::<(), String>("fatal: invalid reference: nope".to_string());
    // There before the add: kept with what it holds.
    let before = root.join("before");
    fs::create_dir_all(&before).unwrap();
    fs::write(before.join("mine.txt"), "x").unwrap();
    assert!(add_retrying(&repo, &before, None, &|| false, fail).is_err());
    assert_eq!(fs::read_to_string(before.join("mine.txt")).unwrap(), "x", "a folder that was there is left alone");
    // Made by the add and holding only Git's `.git` file: removed.
    let gits = root.join("gits");
    assert!(add_retrying(&repo, &gits, None, &|| false, || {
        fs::create_dir_all(&gits).unwrap();
        fs::write(gits.join(".git"), "gitdir: C:/r/.git/worktrees/gits
").unwrap();
        fail()
    })
    .is_err());
    assert!(!gits.exists(), "Git's half-made folder is cleared");
    // Made empty by the add: removed.
    let empty = root.join("empty");
    assert!(add_retrying(&repo, &empty, None, &|| false, || {
        fs::create_dir_all(&empty).unwrap();
        fail()
    })
    .is_err());
    assert!(!empty.exists(), "an empty folder the add made is cleared");
    // Made while Git ran and filled by someone else (no `.git` file): kept.
    let theirs = root.join("theirs");
    assert!(add_retrying(&repo, &theirs, None, &|| false, || {
        fs::create_dir_all(&theirs).unwrap();
        fs::write(theirs.join("report.txt"), "y").unwrap();
        fail()
    })
    .is_err());
    assert_eq!(fs::read_to_string(theirs.join("report.txt")).unwrap(), "y", "another program's files are never removed");
    for d in [repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

/// A project with two made workspaces ("one", "two") for the PROJ-068 / PROJ-072 tests.
fn project_with_workspaces(tag: &str) -> (Git, Store, Project, PathBuf, Vec<PathBuf>, Place) {
    let git = Git::detect().unwrap();
    let profile = temp(tag);
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo(&format!("{tag}-r"));
    let root = temp(&format!("{tag}-root"));
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);
    for n in ["one", "two"] {
        let made = create_workspace(&git, &place, &project, n, None).unwrap();
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    }
    (git, store, project, repo, vec![profile, root], place)
}

#[test]
fn proj072_a_folder_deleted_by_hand_is_cleaned_up_without_an_error() {
    let (git, _store, project, repo, junk, place) = project_with_workspaces("gone072");
    let dest = workspace_path(&place, &project, "one");
    fs::remove_dir_all(&dest).unwrap();
    assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&dest.to_string_lossy())), "Git still tracks it");
    let check = remove_check(&git, &project, &dest.to_string_lossy()).unwrap();
    assert!(check.missing && check.changes.is_empty(), "{check:?}");
    assert_eq!(removal_refused(&check, false, &check.stamp), None);
    remove_worktree(&git, &project, &dest.to_string_lossy(), false, false).unwrap();
    let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
    assert!(!left.iter().any(|p| p.ends_with("one")) && left.iter().any(|p| p.ends_with("two")), "{left:?}");
    assert!(!git.branch_taken(&repo, "one"), "its branch went with it");
    for d in junk.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj072_a_registration_git_still_reports_is_never_removed_underneath_it() {
    let (git, _store, project, repo, junk, place) = project_with_workspaces("locked072");
    let dest = workspace_path(&place, &project, "two");
    git_in(&repo, &["worktree", "lock", "--reason", "on a stick", &dest.to_string_lossy()]);
    fs::remove_dir_all(&dest).unwrap();
    let err = remove_worktree(&git, &project, &dest.to_string_lossy(), true, false).unwrap_err();
    assert!(err.contains("still lists"), "{err}");
    assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&dest.to_string_lossy())), "the record is untouched");
    for d in junk.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj072_a_too_long_path_failure_is_recognised_and_gits_other_failures_are_not() {
    for e in ["error: unable to delete 'x': Filename too long", "fatal: cannot remove: Path too long", "File name too long"] {
        assert!(crate::git::path_too_long(e), "{e}");
    }
    assert!(!crate::git::path_too_long("fatal: validation failed, cannot remove working tree: contains modified files"));
    assert_eq!(crate::git::long_path(Path::new("relative/x")), PathBuf::from("relative/x"));
    #[cfg(windows)]
    assert!(crate::git::long_path(Path::new("C:/a/b")).to_string_lossy().starts_with(r"\\?\C:"));
}

#[test]
fn proj072_a_leftover_folder_after_git_let_go_is_cleaned_up() {
    let (git, _store, project, repo, junk, place) = project_with_workspaces("left072");
    let dest = workspace_path(&place, &project, "one");
    // Locked files cannot be faked portably; a read-only-free stand-in: an ignored deep tree Git itself removes.
    fs::create_dir_all(dest.join("a/b/c")).unwrap();
    fs::write(dest.join("a/b/c/f.txt"), "x").unwrap();
    fs::write(dest.join("stray.log"), "x").unwrap();
    remove_worktree(&git, &project, &dest.to_string_lossy(), true, false).unwrap();
    assert!(!dest.exists());
    for d in junk.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj068_refreshing_twice_changes_no_row_and_names_and_parents_stay_with_their_workspace() {
    let (git, store, project, repo, junk, place) = project_with_workspaces("rows068");
    let (one, two) = (workspace_path(&place, &project, "one").to_string_lossy().into_owned(), workspace_path(&place, &project, "two").to_string_lossy().into_owned());
    set_name(&store, &one, Some("Alpha")).unwrap();
    set_parent(&store, &two, Some(&one)).unwrap();
    let first = list_workspaces(&git, &store, &project).unwrap();
    let second = list_workspaces(&git, &store, &project).unwrap();
    assert_eq!(first, second, "nothing changed, so nothing moved");
    let find = |all: &[Worktree], p: &str| all.iter().find(|w| name_key(&w.path) == name_key(p)).cloned().unwrap();
    assert_eq!(find(&second, &one).name.as_deref(), Some("Alpha"));
    assert_eq!(find(&second, &two).parent.as_deref().map(name_key), Some(name_key(&one)));
    // A name change on one workspace leaves the other's record and the order alone.
    set_name(&store, &one, Some("Beta")).unwrap();
    let third = list_workspaces(&git, &store, &project).unwrap();
    let order = |all: &[Worktree]| all.iter().map(|w| name_key(&w.path)).collect::<Vec<_>>();
    assert_eq!(order(&second), order(&third));
    assert_eq!(find(&third, &two).parent.as_deref().map(name_key), Some(name_key(&one)));
    for d in junk.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj031_a_failed_create_says_what_kind_of_problem_it_was_and_keeps_gits_words() {
    let said = |raw: &str| explain_create_error(raw.to_string());
    for (raw, kind, word) in [
        ("fatal: invalid reference: origin/gone", CreateKind::MissingBase, "missing"),
        ("fatal: not a valid object name: 'x'", CreateKind::MissingBase, "missing"),
        ("fatal: a branch named 'x' already exists", CreateKind::NameInUse, "already in use"),
        ("fatal: 'x' is already checked out at 'C:/r'", CreateKind::NameInUse, "already in use"),
        ("error: unable to create file: Permission denied", CreateKind::Permissions, "refused access"),
        ("fatal: something odd", CreateKind::GitFailure, "Git could not"),
    ] {
        assert_eq!(create_kind(raw), kind, "{raw}");
        let out = said(raw);
        assert!(out.contains(word), "{out}");
        assert!(out.ends_with(&format!("{GIT_SAID}{raw}")), "Git's full output rides along: {out}");
    }
    assert_eq!(said(OVERTAKEN), OVERTAKEN, "a cancel is not rewritten");
    let stalled = "Git did not finish in 180 seconds, so Kolux stopped waiting.";
    assert_eq!(said(stalled), stalled);
}

#[test]
fn proj031_opening_a_branch_that_is_already_checked_out_names_the_problem() {
    let git = Git::detect().unwrap();
    let profile = temp("explain");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("explain-r");
    let root = temp("explain-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);
    git_in(&repo, &["branch", "kept"]);
    open_branch_workspace_until(&git, &place, &project, "kept", None, &|| false).unwrap();
    let err = open_branch_workspace_until(&git, &place, &project, "kept", Some("again"), &|| false).unwrap_err();
    assert!(err.starts_with("The workspace could not be made: that name or branch is already in use."), "{err}");
    assert!(err.contains(GIT_SAID), "{err}");
    let err = create_workspace_until(&git, &place, &project, "x", Some("no-such-ref"), &|| false).unwrap_err();
    assert!(err.starts_with("The workspace could not start: no-such-ref is not a branch"), "{err}");
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj020_an_overtaken_create_is_cancelled_and_its_half_made_checkout_removed() {
    let git = Git::detect().unwrap();
    let profile = temp("overtaken");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("overtaken-r");
    let root = temp("overtaken-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);
    // Overtaken while Git was making the worktree: the folder and the new branch both go.
    let asked = std::cell::Cell::new(0);
    let late = || {
        asked.set(asked.get() + 1);
        asked.get() > 1
    };
    let err = create_workspace_until(&git, &place, &project, "first", None, &late).unwrap_err();
    assert_eq!(err, OVERTAKEN);
    assert!(!workspace_path(&place, &project, "first").exists(), "the half-made folder is removed");
    assert!(!git.branch_taken(&repo, "first"), "the half-made branch is removed");
    assert_eq!(git.worktrees(&repo).unwrap().len(), 1, "only the main checkout is left");
    // Overtaken before it began: nothing is made at all.
    assert_eq!(create_workspace_until(&git, &place, &project, "second", None, &|| true).unwrap_err(), OVERTAKEN);
    assert!(!workspace_path(&place, &project, "second").exists());
    // An existing branch opened as a workspace keeps its branch when overtaken.
    git_in(&repo, &["branch", "kept"]);
    asked.set(0);
    assert_eq!(open_branch_workspace_until(&git, &place, &project, "kept", None, &late).unwrap_err(), OVERTAKEN);
    assert!(!workspace_path(&place, &project, "kept").exists());
    assert!(git.branch_taken(&repo, "kept"), "a branch that existed before stays");
    // A create nobody overtook is untouched by the tickets of others.
    drop_create(41);
    assert!(dropped(Some(41)) && !dropped(Some(42)) && !dropped(None));
    assert!(create_workspace_until(&git, &place, &project, "third", None, &|| dropped(Some(42))).is_ok());
    settle_create(41);
    assert!(!dropped(Some(41)));
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn a_workspace_opens_on_an_existing_branch_and_keeps_it() {
    let git = Git::detect().unwrap();
    let profile = temp("open-b");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("open-r");
    let root = temp("open-root");
    git_in(&repo, &["checkout", "-q", "-b", "feat/x"]);
    fs::write(repo.join("b.txt"), "b").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "earlier work"]);
    git_in(&repo, &["checkout", "-q", "main"]);
    let tip = rev(&repo, "feat/x");
    let project = add_project(&git, &store, &repo).unwrap();
    assert!(branches(&repo).unwrap().contains(&"feat/x".to_string()));
    assert!(open_branch_workspace(&git, &nested(&root), &project, "nope", None).unwrap_err().contains("no branch nope"));
    // PROJ-030: a different folder name still checks out feat/x itself, with its commits.
    let made = open_branch_workspace(&git, &nested(&root), &project, "feat/x", Some("Review X")).unwrap();
    assert_eq!(made.worktree.branch.as_deref(), Some("feat/x"));
    assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), tip);
    assert!(made.worktree.path.replace(std::path::MAIN_SEPARATOR, "/").ends_with("/review-x"), "{}", made.worktree.path);
    set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "existingBranch": true }))).unwrap();
    assert!(keeps_branch(&store, &made.worktree.path));
    remove_worktree(&git, &project, &made.worktree.path, false, keeps_branch(&store, &made.worktree.path)).unwrap();
    assert_eq!(rev(&repo, "feat/x"), tip, "the branch stays when the workspace goes");
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn row116_one_kept_type_goes_out_and_comes_back_in_the_shape_the_page_sends() {
    let k = Kept { branch: "feat/x".into(), commit: "abc1234".into() };
    let json = serde_json::to_value(&k).unwrap();
    assert_eq!(json, serde_json::json!({ "branch": "feat/x", "commit": "abc1234" }));
    assert_eq!(serde_json::from_value::<Kept>(json).unwrap(), k);
}

#[test]
fn a_branch_kept_at_removal_is_reported_and_deleted_later_only_while_it_has_not_moved() {
    let git = Git::detect().unwrap();
    let profile = temp("kept");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("kept-r");
    let root = temp("kept-root");
    let project = add_project(&git, &store, &repo).unwrap();
    let a = create_workspace(&git, &nested(&root), &project, "keep-me", None).unwrap();
    let branch = a.worktree.branch.clone().unwrap();
    let tip = rev(&repo, &branch);
    // Keep chosen in the remove form: the folder goes, the branch stays, and we are told where it was.
    let kept = remove_worktree(&git, &project, &a.worktree.path, false, true).unwrap().unwrap();
    assert_eq!(kept, Kept { branch: branch.clone(), commit: tip.clone() });
    assert!(git.delete_branch_if_at(Path::new(&project.path), &kept.branch, &kept.commit).unwrap(), "unmoved: deleted");
    assert!(!branches(&repo).unwrap().contains(&branch));
    // Without the choice the branch goes with the workspace and nothing is kept.
    let b = create_workspace(&git, &nested(&root), &project, "drop-me", None).unwrap();
    assert_eq!(remove_worktree(&git, &project, &b.worktree.path, false, false).unwrap(), None);
    // A kept branch that moved on since is left alone.
    let c = create_workspace(&git, &nested(&root), &project, "moved-on", None).unwrap();
    let cb = c.worktree.branch.clone().unwrap();
    let kept = remove_worktree(&git, &project, &c.worktree.path, false, true).unwrap().unwrap();
    git_in(&repo, &["checkout", "-q", &cb]);
    fs::write(repo.join("n.txt"), "n").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "more"]);
    git_in(&repo, &["checkout", "-q", "main"]);
    assert!(!git.delete_branch_if_at(Path::new(&project.path), &kept.branch, &kept.commit).unwrap(), "moved: left alone");
    assert!(branches(&repo).unwrap().contains(&cb));
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn own_worktrees_are_managed_and_outside_ones_follow_the_visibility_choice() {
    use crate::visibility as vis;
    let git = Git::detect().unwrap();
    let profile = temp("vis");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("vis-r");
    let root = temp("vis-root");
    let side = temp("vis-side");
    let p = |d: &Path| d.to_string_lossy().to_string();
    store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
    // A fresh profile: a project added now starts with worktrees made elsewhere hidden.
    let project = add_project(&git, &store, &repo).unwrap();
    let made = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &load_projects(&store), &project, None).unwrap();
    let hand = root.join("by-hand");
    let claude = repo.join(".claude").join("worktrees").join("agent-1");
    let scratch = repo.join(".tool").join("x");
    let away = side.join("away");
    for (b, d) in [("hand", &hand), ("cc", &claude), ("scr", &scratch), ("away", &away)] {
        git_in(&repo, &["worktree", "add", "-q", "-b", b, &p(d)]);
    }
    let look = |store: &Store, project: &Project| -> Vec<(String, String, Option<String>, bool)> {
        list_workspaces(&git, store, project).unwrap().into_iter().map(|w| (w.branch.clone().unwrap_or_default(), w.kind.clone(), w.source.clone(), w.hidden)).collect()
    };
    let row = |rows: &[(String, String, Option<String>, bool)], b: &str| rows.iter().find(|r| r.0 == b).cloned();
    let rows = look(&store, &project);
    assert_eq!(row(&rows, "main").unwrap().1, "main");
    let mine = row(&rows, made.branch.as_deref().unwrap()).unwrap();
    assert_eq!((mine.1.as_str(), mine.3), ("managed", false), "Kolux's own is managed and shown");
    assert_eq!(row(&rows, "hand"), Some(("hand".into(), "external".into(), Some("other".into()), true)), "by hand inside the workspaces folder is external");
    assert_eq!(row(&rows, "cc"), Some(("cc".into(), "external".into(), Some("claude".into()), true)));
    assert_eq!(row(&rows, "away"), Some(("away".into(), "external".into(), Some("other".into()), true)));
    assert!(row(&rows, "scr").is_none(), "another tool's scratch folder is never listed");
    // Moved workspaces folder: Kolux's own record still makes it managed.
    store.save_settings(&serde_json::json!({ "workspacesDir": p(&side.join("elsewhere")) })).unwrap();
    assert_eq!(row(&look(&store, &project), made.branch.as_deref().unwrap()).unwrap().1, "managed");
    // A base folder set on purpose beats the scratch rule.
    store.save_settings(&serde_json::json!({ "workspacesDir": p(&repo.join(".tool")) })).unwrap();
    assert_eq!(row(&look(&store, &project), "scr").map(|r| r.2), Some(Some("other".into())));
    store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
    // Global and per-project choices; the global never overwrites the project's own.
    vis::set_choice(&store, None, "other", Some(true)).unwrap();
    assert!(!row(&look(&store, &project), "hand").unwrap().3);
    vis::set_choice(&store, Some(&project.id), "other", Some(false)).unwrap();
    vis::set_choice(&store, None, "other", Some(false)).unwrap();
    vis::set_choice(&store, None, "other", Some(true)).unwrap();
    assert!(row(&look(&store, &project), "hand").unwrap().3, "the project's own choice stays");
    let src = vis::sources(&store, Some(&project));
    let other = src.iter().find(|s| s.key == "other").unwrap();
    assert_eq!((other.global, other.own), (true, Some(false)), "the override shows the global value it replaces");
    vis::set_choice(&store, Some(&project.id), "other", None).unwrap();
    assert!(!row(&look(&store, &project), "hand").unwrap().3, "reset: back to the global choice");
    // Extra root folders start hidden, at most 32, each mistake its own error.
    vis::add_root(&store, &p(&side)).unwrap();
    let r = row(&look(&store, &project), "away").unwrap();
    assert!(r.2.as_deref().unwrap().starts_with("root:") && r.3, "{r:?}");
    assert!(vis::add_root(&store, "relative\\folder").unwrap_err().contains("not a folder"));
    assert!(vis::add_root(&store, &p(&side)).unwrap_err().contains("already"));
    for i in 1..32 {
        let d = side.join(format!("r{i}"));
        fs::create_dir_all(&d).unwrap();
        vis::add_root(&store, &p(&d)).unwrap();
    }
    let d = side.join("r32");
    fs::create_dir_all(&d).unwrap();
    assert!(vis::add_root(&store, &p(&d)).unwrap_err().contains("at most 32"));
    // One worktree shown by hand wins over its source's choice.
    set_hidden(&store, &p(&claude), false).unwrap();
    assert!(!row(&look(&store, &project), "cc").unwrap().3);
    // A profile that had projects before this choice existed keeps showing them.
    let profile2 = temp("vis-old");
    let old = Store::open(&profile2).unwrap();
    let project2 = add_project(&git, &old, &repo).unwrap();
    old.set("worktreeVisibility", "null").unwrap();
    assert!(!row(&look(&old, &project2), "hand").unwrap().3, "an earlier project keeps its earlier behaviour");
    assert!(row(&look(&old, &project2), "cc").unwrap().3, "Claude Code's scratch stayed hidden before, and still does");
    drop(store);
    drop(old);
    for d in [&hand, &claude, &scratch, &away] {
        let _ = git.worktree_remove(&repo, d, None);
    }
    for d in [profile, profile2, repo, root, side] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj044_a_worktree_gsd_marked_counts_as_made_by_gsd() {
    let git = Git::detect().unwrap();
    let profile = temp("gsd");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("gsd-r");
    let p = |d: &Path| d.to_string_lossy().to_string();
    let project = add_project(&git, &store, &repo).unwrap();
    let cc = repo.join(".claude").join("worktrees");
    let (gsd, plain) = (cc.join("agent-a1"), cc.join("agent-b2"));
    git_in(&repo, &["worktree", "add", "-q", "-b", "worktree-agent-a1", &p(&gsd)]);
    git_in(&repo, &["worktree", "add", "-q", "-b", "worktree-agent-b2", &p(&plain)]);
    // GSD's executor leaves `gsd-spawn-toplevel` in the worktree's own Git folder.
    let link = fs::read_to_string(gsd.join(".git")).unwrap();
    let admin = PathBuf::from(link.trim().strip_prefix("gitdir:").unwrap().trim());
    fs::write(admin.join("gsd-spawn-toplevel"), p(&gsd)).unwrap();
    let rows: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().map(|w| (w.branch.unwrap_or_default(), w.source, w.hidden)).collect();
    assert!(rows.contains(&("worktree-agent-a1".into(), Some("gsd".into()), true)), "{rows:?}");
    assert!(rows.contains(&("worktree-agent-b2".into(), Some("claude".into()), true)), "{rows:?}");
    let src = crate::visibility::sources(&store, Some(&project));
    assert_eq!(src.iter().map(|s| s.label.as_str()).take(3).collect::<Vec<_>>(), ["Made by Claude Code", "Made by GSD", "Elsewhere on disk"]);
    crate::visibility::set_choice(&store, None, "gsd", Some(true)).unwrap();
    let shown = list_workspaces(&git, &store, &project).unwrap();
    assert!(!shown.iter().find(|w| w.branch.as_deref() == Some("worktree-agent-a1")).unwrap().hidden, "its own choice shows it");
    assert!(shown.iter().find(|w| w.branch.as_deref() == Some("worktree-agent-b2")).unwrap().hidden, "Claude Code's stay hidden");
    drop(store);
    for d in [&gsd, &plain] {
        let _ = git.worktree_remove(&repo, d, None);
    }
    for d in [profile, repo] {
        let _ = fs::remove_dir_all(d);
    }
}

// T-442-c: the sidebar's one call gives what workspace_list and workspace_unseen gave in two.
#[test]
fn one_scan_gives_the_list_and_the_unseen_alike() {
    let git = Git::detect().unwrap();
    let profile = temp("scanned");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("scanned-r");
    let side = temp("scanned-side");
    let project = add_project(&git, &store, &repo).unwrap();
    let first = scanned_of(&store, &project, git.worktrees(Path::new(&project.path)).unwrap()).unwrap();
    assert!(first.unseen.is_empty(), "the first scan takes what is there as seen");
    assert_eq!(first.list.len(), 1);
    git_in(&repo, &["worktree", "add", "-q", "-b", "outside", &side.join("outside").to_string_lossy()]);
    crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
    let all = git.worktrees(Path::new(&project.path)).unwrap();
    let both = scanned_of(&store, &project, all.clone()).unwrap();
    assert_eq!(both.list, decorate(&store, &project, all).unwrap());
    let fresh: Vec<_> = both.unseen.iter().map(|w| w.branch.clone().unwrap()).collect();
    assert_eq!(fresh, ["outside"]);
    assert_eq!(both.list.len(), 2);
    for d in [profile, repo, side] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn worktrees_made_outside_kolux_are_noticed_once_and_can_be_hidden() {
    let git = Git::detect().unwrap();
    let profile = temp("unseen");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("unseen-r");
    let side = temp("unseen-side");
    let root = temp("unseen-root");
    git_in(&repo, &["worktree", "add", "-q", "-b", "before", &side.join("before").to_string_lossy()]);
    let project = add_project(&git, &store, &repo).unwrap();
    assert!(unseen(&git, &store, &project).unwrap().is_empty(), "the first scan takes what is there as seen");
    // Three made at once with plain Git: one list, so one notice.
    for n in ["a", "b", "c"] {
        git_in(&repo, &["worktree", "add", "-q", "-b", n, &side.join(n).to_string_lossy()]);
    }
    // One Kolux makes itself is not offered.
    create_fresh_workspace(&git, || Ok(&store), &nested(&root), &load_projects(&store), &project, None).unwrap();
    let fresh: Vec<_> = unseen(&git, &store, &project).unwrap().into_iter().map(|w| w.branch.unwrap()).collect();
    assert_eq!(fresh.len(), 3, "{fresh:?}");
    assert!(fresh.iter().all(|b| ["a", "b", "c"].contains(&b.as_str())));
    mark_all_seen(&git, &store, &project).unwrap();
    assert!(unseen(&git, &store, &project).unwrap().is_empty());
    // Gone and made again: new again.
    git_in(&repo, &["worktree", "remove", &side.join("a").to_string_lossy()]);
    assert!(unseen(&git, &store, &project).unwrap().is_empty());
    git_in(&repo, &["worktree", "add", "-q", &side.join("a").to_string_lossy(), "a"]);
    assert_eq!(unseen(&git, &store, &project).unwrap().len(), 1);
    // PROJ-042: hide one, show it again; the main checkout is never hidden. (Worktrees made
    // elsewhere start hidden in a new project, so show them first.)
    crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
    let b = side.join("b").to_string_lossy().to_string();
    let hidden = |store: &Store| list_workspaces(&git, store, &project).unwrap().into_iter().filter(|w| w.hidden).map(|w| w.branch.unwrap()).collect::<Vec<_>>();
    set_hidden(&store, &b, true).unwrap();
    set_hidden(&store, &project.path, true).unwrap();
    assert_eq!(hidden(&store), vec!["b".to_string()]);
    set_hidden(&store, &b, false).unwrap();
    assert!(hidden(&store).is_empty());
    drop(store);
    for d in [profile, repo, side, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn sess037_the_advanced_branch_name_wins_and_the_typed_name_stays_the_label() {
    let git = Git::detect().unwrap();
    let profile = temp("profile-sess037");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo-sess037");
    let root = temp("root-sess037");
    let mut settings = store.settings();
    settings["branchPrefix"] = serde_json::json!("none");
    settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
    store.save_settings(&settings).unwrap();
    let project = add_project(&git, &store, &repo).unwrap();
    let store = Mutex::new(store);
    let made = create_named(&git, &store, &project.id, "Fix login", None, Some("feat/x"), None).unwrap().worktree;
    assert_eq!(made.branch.as_deref(), Some("feat-x"));
    assert_eq!(made.name.as_deref(), Some("Fix login"));
    let plain = create_named(&git, &store, &project.id, "Fix login", None, None, None).unwrap().worktree;
    assert_eq!(plain.branch.as_deref(), Some("fix-login"));
    assert_eq!(plain.name.as_deref(), Some("Fix login"));
}

#[test]
fn create_and_remove_workspace_through_the_project() {
    let git = Git::detect().unwrap();
    let profile = temp("profile2");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo2");
    let root = temp("root2");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);

    // SESS-036: a name that cleans up to nothing becomes "workspace".
    let blank = create_workspace(&git, &place, &project, "???", None).unwrap().worktree;
    assert_eq!(blank.branch.as_deref(), Some("workspace"));
    let wt = create_workspace(&git, &place, &project, "Fix login \u{1F525}", None).unwrap().worktree;
    assert_eq!(wt.branch.as_deref(), Some("fix-login-fire"));
    let expected = workspace_path(&place, &project, "fix-login-fire");
    assert!(expected.join("a.txt").is_file());
    let again = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
    assert_eq!(again.branch.as_deref(), Some("fix-login-fire-2"), "a taken name gets a number");
    git_in(&repo, &["update-ref", "refs/remotes/origin/fix-login-fire-3", "HEAD"]);
    let third = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
    assert_eq!(third.branch.as_deref(), Some("fix-login-fire-4"), "a name on a remote counts as taken");
    set_name(&store, &wt.path, Some("Fix login \u{1F525}")).unwrap();
    let listed = list_workspaces(&git, &store, &project).unwrap();
    assert_eq!(listed.iter().find(|w| w.path == wt.path).unwrap().name.as_deref(), Some("Fix login \u{1F525}"), "the typed name is shown");
    assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().name, None);
    // PROJ-047: a workspace made from another one is listed with that parent, and removing it
    // forgets the link so a later workspace in the same folder starts at the top level.
    set_parent(&store, &third.path, Some(&wt.path)).unwrap();
    let listed = list_workspaces(&git, &store, &project).unwrap();
    assert_eq!(listed.iter().find(|w| w.path == third.path).unwrap().parent.as_deref(), Some(wt.path.as_str()));
    assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().parent, None);
    for w in [&again, &third] {
        remove_workspace(&git, &project, &w.path, false).unwrap();
        forget_workspace(&store, &w.path).unwrap();
    }
    assert!(store.get("workspaceParents").unwrap().unwrap() == "{}");

    assert!(remove_workspace(&git, &project, &project.path, false).unwrap_err().contains("main checkout"));
    remove_workspace(&git, &project, &wt.path, false).unwrap();
    assert!(!expected.exists());
    assert!(!git.branch_taken(&repo, "fix-login-fire"));
    drop(store);
    for d in [profile, repo, root] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn proj040_proj048_a_parent_must_still_be_there_and_never_makes_a_loop() {
    let git = Git::detect().unwrap();
    let profile = temp("profile-proj048");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo-proj048");
    let root = temp("root-proj048");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&root);
    let make = |n: &str| create_workspace(&git, &place, &project, n, None).unwrap();
    let (a, kid, b) = (make("a").worktree, make("kid").worktree, make("b").worktree);
    set_parent(&store, &kid.path, Some(&a.path)).unwrap();
    // PROJ-048: never itself, never under its own descendant, never under the main checkout.
    assert!(reparent(&git, &store, &project, &a.path, Some(&a.path)).unwrap_err().contains("its own parent"));
    assert!(reparent(&git, &store, &project, &a.path, Some(&kid.path)).unwrap_err().contains("loop"));
    assert!(reparent(&git, &store, &project, &a.path, Some(&project.path)).unwrap_err().contains("main checkout"));
    assert!(reparent(&git, &store, &project, &project.path, Some(&a.path)).unwrap_err().contains("main checkout"));
    assert!(reparent(&git, &store, &project, &a.path, Some("C:/nowhere")).unwrap_err().contains("no longer"));
    reparent(&git, &store, &project, &a.path, Some(&b.path)).unwrap();
    let parent_of = |p: &str| list_workspaces(&git, &store, &project).unwrap().into_iter().find(|w| w.path == p).unwrap().parent;
    assert_eq!(parent_of(&a.path).as_deref(), Some(b.path.as_str()));
    reparent(&git, &store, &project, &a.path, None).unwrap();
    assert_eq!(parent_of(&a.path), None);
    // PROJ-040: a parent removed while the composer was open is dropped with a warning.
    let store = Mutex::new(store);
    let parent_of = |p: &str| list_workspaces(&git, &store.lock().unwrap(), &project).unwrap().into_iter().find(|w| w.path == p).unwrap().parent;
    let mut made = make("late");
    remove_workspace(&git, &project, &b.path, false).unwrap();
    nest_under(&git, &store, &project, &mut made, Some(&b.path), None).unwrap();
    assert_eq!(made.worktree.parent, None);
    assert!(made.warnings.iter().any(|w| w.contains("top level")), "{:?}", made.warnings);
    assert_eq!(parent_of(&made.worktree.path), None);
    let mut nested_ok = make("under-a");
    nest_under(&git, &store, &project, &mut nested_ok, Some(&a.path), None).unwrap();
    assert_eq!(parent_of(&nested_ok.worktree.path).as_deref(), Some(a.path.as_str()));
    assert!(nested_ok.warnings.is_empty());
    // PROJ-040: with a folder workspace active, the dropped parent's place is the folder workspace; any other workspace does not count.
    let plain = temp("root-proj040-plain");
    let folder = crate::folder_projects::add_folder(&store.lock().unwrap(), &plain).unwrap();
    let folder_ws = crate::folder_projects::folder_only(&store.lock().unwrap(), &folder).unwrap().path;
    let mut fell = make("fell");
    nest_under(&git, &store, &project, &mut fell, Some(&b.path), Some(&folder_ws)).unwrap();
    assert_eq!(fell.worktree.parent.as_deref(), Some(folder_ws.as_str()));
    assert_eq!(parent_of(&fell.worktree.path).as_deref(), Some(folder_ws.as_str()));
    assert!(fell.warnings.iter().any(|w| w.contains("active folder workspace")), "{:?}", fell.warnings);
    let mut not_folder = make("not-folder");
    nest_under(&git, &store, &project, &mut not_folder, Some(&b.path), Some(&a.path)).unwrap();
    assert_eq!(not_folder.worktree.parent, None);
    assert!(not_folder.warnings.iter().any(|w| w.contains("top level")), "{:?}", not_folder.warnings);
    // a parent that is still there wins over the active folder workspace
    let mut kept = make("kept");
    nest_under(&git, &store, &project, &mut kept, Some(&a.path), Some(&folder_ws)).unwrap();
    assert_eq!(parent_of(&kept.worktree.path).as_deref(), Some(a.path.as_str()));
    let _ = fs::remove_dir_all(plain);
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj023_a_suggestion_skips_every_name_in_use_in_any_project_whatever_its_case() {
    let git = Git::detect().unwrap();
    let profile = temp("suggest-profile");
    let store = Store::open(&profile).unwrap();
    let (repo_a, repo_b) = (temp_repo("suggest-a"), temp_repo("suggest-b"));
    let (root_a, root_b) = (temp("suggest-root-a"), temp("suggest-root-b"));
    let a = add_project(&git, &store, &repo_a).unwrap();
    let b = add_project(&git, &store, &repo_b).unwrap();
    let place_a = nested(&root_a);
    let ask = |seed: u64| suggest_name(&git, || Ok(&store), &place_a, &a, seed).unwrap();

    let first = ask(11);
    assert_eq!(first, first.to_lowercase(), "lowercase");
    assert_eq!(ask(11), first, "asking records nothing: the same name is offered again");
    assert!(retired_names(&store, &retired_scope(&place_a, &a)).is_empty(), "a suggestion nobody uses costs no name");

    // The name is in use by a workspace of the OTHER project: never offered to this one.
    create_workspace(&git, &nested(&root_b), &b, &first, None).unwrap();
    let second = ask(11);
    assert_ne!(second, first);

    // Under a branch prefix the folder differs, but the last part of the branch still counts.
    let third_dir = root_a.join("wt3");
    git_in(&repo_a, &["worktree", "add", "-q", "-b", &format!("kolux/{second}"), &third_dir.to_string_lossy()]);
    let third = ask(11);
    assert!(![&first, &second].contains(&&third), "{third}");

    // A shown name typed by hand counts too, whatever its case.
    let made = create_workspace(&git, &nested(&root_a), &a, "plain", None).unwrap().worktree;
    set_name(&store, &made.path, Some(&third.to_uppercase())).unwrap();
    let fourth = ask(11);
    assert!(![&first, &second, &third].contains(&&fourth), "{fourth}");

    drop(store);
    for d in [profile, repo_a, repo_b, root_a, root_b] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj024_only_suggested_names_are_retired_per_scope_ignoring_case_and_spaces() {
    let profile = temp("retire-profile");
    let store = Store::open(&profile).unwrap();
    let (flat_a, flat_b) = (Project { id: "a".into(), name: "alpha".into(), path: "C:/alpha".into(), workspaces_dir: None, base: None, display_name: None }, Project { id: "b".into(), name: "beta".into(), path: "C:/beta".into(), workspaces_dir: None, base: None, display_name: None });
    let flat = Place { root: PathBuf::from("C:/ws"), flat: true, prefix: String::new(), prefix_warning: None, refresh: false };
    let nest = Place { root: PathBuf::from("C:/ws"), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
    let (fa, fb) = (retired_scope(&flat, &flat_a), retired_scope(&flat, &flat_b));
    assert_eq!(fa, fb, "flat layout: projects sharing the workspaces folder share their retired names");
    let (na, nb) = (retired_scope(&nest, &flat_a), retired_scope(&nest, &flat_b));
    assert_ne!(na, nb, "nested layout: each project keeps its own");

    // Delete a suggested name, a numbered one, and a freely typed one.
    let first = creature_name(&[], 3);
    forget_workspace(&store, &format!("C:/ws/alpha/{first}")).unwrap();
    forget_workspace(&store, "C:/ws/alpha/login-fix").unwrap();
    let numbered = creature_name(&(0..676).map(|s| creature_name(&[], s)).collect::<Vec<_>>(), 3);
    assert!(numbered.ends_with("-2"));
    forget_workspace(&store, &format!("C:/ws/alpha/{numbered}")).unwrap();
    assert_eq!(retired_names(&store, &na), vec![first.clone(), numbered.clone()], "login-fix was typed freely: not kept");
    assert!(retired_names(&store, &nb).is_empty(), "another project's nested folder is untouched");

    // Retired names survive a restart and are skipped for any seed, case and spaces ignored.
    drop(store);
    let store = Store::open(&profile).unwrap();
    retire_name(&store, &na, &first.to_uppercase().replace('-', " - ")).unwrap();
    assert_eq!(retired_names(&store, &na).len(), 2, "same name once: spaces differ, hyphen is the name");
    for seed in 0..700u64 {
        let pick = pick_name(&store, &na, vec![], seed);
        assert_ne!(pick, first, "seed {seed}");
    }
    // The shown (typed) name of the deleted workspace counts too when it is a suggested one.
    let other = creature_name(std::slice::from_ref(&first), 3);
    set_name(&store, "C:/ws/alpha/folder-x", Some(&other.to_uppercase())).unwrap();
    forget_workspace(&store, "C:/ws/alpha/folder-x").unwrap();
    assert!(retired_names(&store, &na).contains(&other));

    // Flat layout: both projects see the one record.
    forget_workspace(&store, &format!("C:/ws/{first}")).unwrap();
    assert_eq!(retired_names(&store, &fa), vec![first.clone()]);
    assert_eq!(retired_names(&store, &fb), retired_names(&store, &fa));
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

#[test]
fn proj019_an_icon_is_an_emoji_a_built_in_icon_or_a_small_picture() {
    assert_eq!(clean_icon("  ").unwrap(), None, "empty resets");
    assert_eq!(clean_icon("emoji:\u{1F680}").unwrap().as_deref(), Some("emoji:\u{1F680}"));
    assert_eq!(clean_icon("emoji:\u{1F9D1}\u{200D}\u{1F4BB}").unwrap().as_deref(), Some("emoji:\u{1F9D1}\u{200D}\u{1F4BB}"), "a joined emoji is one emoji");
    let long = format!("emoji:{}", "\u{1F680}".repeat(9));
    for bad in ["emoji:", "emoji:rocket", "emoji:\u{e9}", "emoji:\u{1F680} \u{1F680}", long.as_str(), "rocket", "html:<b>", "icon:", "icon:Rock et", "icon:../x"] {
        assert!(clean_icon(bad).is_err(), "{bad}");
    }
    assert_eq!(clean_icon("icon:Rocket").unwrap().as_deref(), Some("icon:rocket"));
    assert_eq!(clean_icon("icon:no-such-icon-9").unwrap().as_deref(), Some("icon:no-such-icon-9"), "an unknown name is kept: the drawing side shows a folder");
    assert!(clean_icon("image:data:image/png;base64,iVBORw0KGgo=").unwrap().is_some());
    for bad in ["image:https://example.com/a.png", "image:data:text/html;base64,PGI+", "image:data:image/png;base64,", "image:data:image/png;base64,<script>", "image:data:image/bmp;base64,AAAA"] {
        assert!(clean_icon(bad).is_err(), "{bad}");
    }
    // The size limit is about the whole value, at its edge.
    let head = "image:data:image/png;base64,";
    let fits = format!("{head}{}", "A".repeat(ICON_IMAGE_MAX - head.len()));
    let over = format!("{fits}A");
    assert!(clean_icon(&fits).is_ok());
    assert!(clean_icon(&over).unwrap_err().contains("too large"));
}

#[test]
fn proj019_a_chosen_icon_stays_after_a_restart_and_reset_brings_the_automatic_one_back() {
    let git = Git::detect().unwrap();
    let profile = temp("icon-profile");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("icon-repo");
    let project = add_project(&git, &store, &repo).unwrap();
    assert!(project_icons(&store).is_empty(), "no choice yet: the automatic icon");
    assert_eq!(set_icon(&store, &project.id, "icon:rocket").unwrap().as_deref(), Some("icon:rocket"));
    assert!(set_icon(&store, &project.id, "emoji:abc").is_err());
    assert!(set_icon(&store, "no-such", "icon:rocket").is_err());
    drop(store);
    let store = Store::open(&profile).unwrap();
    assert_eq!(project_icons(&store).get(&project.id).map(String::as_str), Some("icon:rocket"), "still there after a restart");
    // A damaged record, or an entry that no longer passes, gives the automatic icon.
    store.set(ICONS_KEY, "[1,2").unwrap();
    assert!(project_icons(&store).is_empty());
    store.set(ICONS_KEY, &format!("{{\"{}\": \"emoji:x\", \"keep\": \"icon:bug\"}}", project.id)).unwrap();
    assert_eq!(project_icons(&store).len(), 1);
    set_icon(&store, &project.id, "icon:rocket").unwrap();
    assert_eq!(set_icon(&store, &project.id, "").unwrap(), None);
    assert!(!project_icons(&store).contains_key(&project.id), "reset removes the choice");
    set_icon(&store, &project.id, "emoji:\u{1F680}").unwrap();
    forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
    assert!(!project_icons(&store).contains_key(&project.id), "a forgotten project's choice goes with it");
    drop(store);
    for d in [profile, repo] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn fix1_a_worktree_deleted_outside_kolux_retires_its_name_when_the_sweep_forgets_it() {
    let base = temp("fix1-gone");
    let repo = base.join("r");
    init_repo(&repo);
    let name = creature_name(&[], 3);
    let folder = base.join("ws").join(&name);
    git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", &name]);
    fs::remove_dir_all(&folder).unwrap();
    let store = Store::open(&base.join("db")).unwrap();
    let git = Git::detect().unwrap();
    let all = git.worktrees(&repo).unwrap();
    let forgot = forget_gone(&repo, &all, &[], |p| retire_workspace_names(&store, p).unwrap());
    assert_eq!(forgot.len(), 1, "{forgot:?}");
    let scope = name_key(&base.join("ws").to_string_lossy());
    assert_eq!(retired_names(&store, &scope), vec![name_form(&name)], "the name is retired in the folder it lived in");
    assert_ne!(pick_name(&store, &scope, vec![], 3), name, "and is not suggested again");
    // a worktree a session still uses (busy) is left alone: nothing is forgotten or retired
    let busy = base.join("ws").join("kept");
    git_in(&repo, &["worktree", "add", "-q", &busy.to_string_lossy(), "-b", "kept"]);
    fs::remove_dir_all(&busy).unwrap();
    let all = git.worktrees(&repo).unwrap();
    let forgot = forget_gone(&repo, &all, &[busy.to_string_lossy().into_owned()], |p| retire_workspace_names(&store, p).unwrap());
    assert!(forgot.is_empty());
    assert_eq!(retired_names(&store, &scope).len(), 1);
    drop(store);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn fix2_the_sweep_clears_the_same_record_as_a_removal_by_the_user() {
    let base = temp("fix2-sweep");
    let repo = base.join("r");
    init_repo(&repo);
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&base.join("db")).unwrap());
    let creature = creature_name(&[], 3);
    let (gone, kept) = (base.join("ws").join(&creature), base.join("ws").join("kept-one"));
    for f in [&gone, &kept] {
        let branch = f.file_name().unwrap().to_string_lossy().to_string();
        git_in(&repo, &["worktree", "add", "-q", &f.to_string_lossy(), "-b", &branch]);
    }
    let (gone_p, kept_p) = (gone.to_string_lossy().to_string(), kept.to_string_lossy().to_string());
    {
        let s = store.lock().unwrap();
        for p in [&gone_p, &kept_p] {
            set_name(&s, p, Some("typed name")).unwrap();
            set_parent(&s, p, Some("C:/ws/parent")).unwrap();
            save_workspace_note(&s, p, "handoff text").unwrap();
            set_origin(&s, p, Some(&serde_json::json!({"issue": 7}))).unwrap();
        }
    }
    fs::remove_dir_all(&gone).unwrap();
    let all = git.worktrees(&repo).unwrap();
    assert_eq!(sweep_gone(&store, &repo, &all, &[], None), vec![gone_p.clone()]);
    let s = store.lock().unwrap();
    // the swept workspace leaves no record, so a new one made at the same path starts clean
    assert!(!load_names(&s).contains_key(&name_key(&gone_p)), "typed name");
    let parents: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&s.get(PARENTS_KEY).unwrap().unwrap()).unwrap();
    assert!(!parents.contains_key(&name_key(&gone_p)) && parents.contains_key(&name_key(&kept_p)), "parent: {parents:?}");
    assert_eq!(workspace_note(&s, &gone_p).text, "", "note");
    assert!(!load_origins(&s).contains_key(&name_key(&gone_p)), "origin");
    // its suggested folder name is still retired in the folder it lived in
    let scope = name_key(&base.join("ws").to_string_lossy());
    assert_eq!(retired_names(&s, &scope), vec![name_form(&creature)]);
    // the one that is still there keeps everything
    assert!(load_names(&s).contains_key(&name_key(&kept_p)));
    assert_eq!(workspace_note(&s, &kept_p).text, "handoff text");
    assert!(load_origins(&s).contains_key(&name_key(&kept_p)));
    drop(s);
    drop(store);
    let _ = fs::remove_dir_all(&base);
}

/// Every key a workspace record can live under, for one path, read back as text.
fn record_of(store: &Store, path: &str) -> Vec<(String, Option<String>)> {
    let note = format!("{NOTE_PREFIX}{}", name_key(path));
    [NAMES_KEY, PARENTS_KEY, ORIGINS_KEY, RETIRED_KEY, LEGACY_KEY, note.as_str()]
        .iter()
        .map(|k| (k.to_string(), store.get(k).unwrap()))
        .collect()
}

fn full_record(store: &Store, path: &str) {
    set_name(store, path, Some("typed name")).unwrap();
    set_parent(store, path, Some("C:/ws/parent")).unwrap();
    save_workspace_note(store, path, "handoff text").unwrap();
    set_origin(store, path, Some(&serde_json::json!({"issue": 7}))).unwrap();
}

#[test]
fn fix3_the_sweep_leaves_the_same_store_as_a_removal_by_the_user_on_a_twin_worktree() {
    let base = temp("fix3-twin");
    let repo = base.join("r");
    init_repo(&repo);
    let git = Git::detect().unwrap();
    let creature = creature_name(&[], 5);
    let folder = base.join("ws").join(&creature);
    git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", &creature]);
    let path = folder.to_string_lossy().to_string();
    // two stores hold the identical record for the same worktree; one is swept, one is removed by hand
    let swept = Mutex::new(Store::open(&base.join("db-swept")).unwrap());
    let removed = Store::open(&base.join("db-removed")).unwrap();
    full_record(&swept.lock().unwrap(), &path);
    full_record(&removed, &path);
    // (the note carries its save time, so the twins differ there until the record is cleared)
    let start = record_of(&swept.lock().unwrap(), &path);
    assert_eq!(start[..3], record_of(&removed, &path)[..3], "names, parents and origins start equal");
    assert!(start.iter().filter(|(k, _)| k != RETIRED_KEY && k != LEGACY_KEY).all(|(_, v)| v.is_some()), "{start:?}");
    fs::remove_dir_all(&folder).unwrap();
    let all = git.worktrees(&repo).unwrap();
    assert_eq!(sweep_gone(&swept, &repo, &all, &[], None), vec![path.clone()]);
    forget_workspace(&removed, &path).unwrap();
    let (a, b) = (record_of(&swept.lock().unwrap(), &path), record_of(&removed, &path));
    assert_eq!(a, b, "the sweep and a removal leave the same keys behind");
    assert!(a.iter().any(|(k, v)| k == RETIRED_KEY && v.is_some()), "and the comparison saw a retired name: {a:?}");
    drop(swept);
    drop(removed);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn fix3_a_busy_worktree_with_a_full_record_survives_the_sweep_though_its_folder_is_gone() {
    let base = temp("fix3-busy");
    let repo = base.join("r");
    init_repo(&repo);
    let git = Git::detect().unwrap();
    let folder = base.join("ws").join("in-use");
    git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", "in-use"]);
    let path = folder.to_string_lossy().to_string();
    let store = Mutex::new(Store::open(&base.join("db")).unwrap());
    full_record(&store.lock().unwrap(), &path);
    let before = record_of(&store.lock().unwrap(), &path);
    fs::remove_dir_all(&folder).unwrap();
    let all = git.worktrees(&repo).unwrap();
    // a session still runs in a folder inside it, so the sweep must leave Git's record and ours alone
    let busy = [folder.join("src").to_string_lossy().to_string()];
    assert!(sweep_gone(&store, &repo, &all, &busy, None).is_empty());
    assert_eq!(record_of(&store.lock().unwrap(), &path), before, "typed name, parent, note, origin and retired names untouched");
    assert_eq!(git.worktrees(&repo).unwrap().len(), 2, "Git still lists it");
    drop(store);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn fix3_a_record_that_cannot_be_cleared_is_written_to_the_diag_file() {
    let base = temp("fix3-diag");
    let repo = base.join("r");
    init_repo(&repo);
    let git = Git::detect().unwrap();
    let folder = base.join("ws").join("gone-one");
    git_in(&repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", "gone-one"]);
    let path = folder.to_string_lossy().to_string();
    let profile = base.join("profile");
    let store = std::sync::Arc::new(Mutex::new(Store::open(&base.join("db")).unwrap()));
    full_record(&store.lock().unwrap(), &path);
    // a task that panicked holding the store leaves it poisoned: the record cannot be cleared
    let held = store.clone();
    let _ = std::thread::spawn(move || {
        let _guard = held.lock().unwrap();
        panic!("a task that died holding the store");
    })
    .join();
    assert!(store.lock().is_err(), "the store is poisoned");
    fs::remove_dir_all(&folder).unwrap();
    let all = git.worktrees(&repo).unwrap();
    // Git's record still goes; the failure is not dropped
    assert_eq!(sweep_gone(&store, &repo, &all, &[], Some(&profile)), vec![path.clone()]);
    let log = fs::read_to_string(profile.join("logs").join("kolux.log")).unwrap();
    assert!(log.contains("could not clear what Kolux remembers") && log.contains("gone-one"), "{log}");
    // and a sweep with nothing wrong writes nothing of the kind
    let fine = Mutex::new(Store::open(&base.join("db2")).unwrap());
    let folder2 = base.join("ws").join("gone-two");
    git_in(&repo, &["worktree", "add", "-q", &folder2.to_string_lossy(), "-b", "gone-two"]);
    fs::remove_dir_all(&folder2).unwrap();
    let all = git.worktrees(&repo).unwrap();
    let profile2 = base.join("profile2");
    assert_eq!(sweep_gone(&fine, &repo, &all, &[], Some(&profile2)).len(), 1);
    assert!(!profile2.join("logs").join("kolux.log").exists());
    drop(fine);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn fix1_names_the_old_list_held_stay_retired_without_a_migration_step() {
    let profile = temp("fix1-legacy");
    let store = Store::open(&profile).unwrap();
    let (old_a, old_b) = (creature_name(&[], 1), creature_name(&[], 2));
    store.set("creatureNamesUsed", &serde_json::to_string(&[old_a.to_uppercase(), old_b.clone(), old_a.clone()]).unwrap()).unwrap();
    assert!(store.get(RETIRED_KEY).unwrap().is_none());
    for scope in ["any-scope", "another"] {
        let got = retired_names(&store, scope);
        assert!(got.contains(&name_form(&old_a)) && got.contains(&name_form(&old_b)), "{scope}: {got:?}");
        assert_eq!(got.len(), 2, "the same name once: {got:?}");
        assert_ne!(pick_name(&store, scope, vec![], 1), old_a, "{scope}: not suggested again");
    }
    // the first new retirement writes the record; the old names go with it into the new key
    let fresh = creature_name(&[old_a.clone(), old_b.clone()], 9);
    retire_name(&store, "any-scope", &fresh).unwrap();
    assert!(store.get(RETIRED_KEY).unwrap().is_some());
    let got = retired_names(&store, "any-scope");
    assert_eq!(got.len(), 3, "{got:?}");
    assert!(retired_names(&store, "another").contains(&name_form(&old_a)), "old names count in every scope");
    assert!(!retired_names(&store, "another").contains(&name_form(&fresh)), "a new one only in its own");
    // once the new key exists the old list is not read again
    store.set("creatureNamesUsed", "[\"zebra-moth\"]").unwrap();
    assert!(!retired_names(&store, "another").contains(&"zebra-moth".to_string()));
    // a damaged old list is no list
    let profile2 = temp("fix1-legacy2");
    let store2 = Store::open(&profile2).unwrap();
    store2.set("creatureNamesUsed", "{oops").unwrap();
    assert!(retired_names(&store2, "x").is_empty());
    // the scope cap never drops the old names
    for i in 0..(RETIRED_SCOPES + 5) {
        retire_name(&store, &format!("s{i}"), &creature_name(&[], 1)).unwrap();
    }
    assert!(retired_names(&store, "another").contains(&name_form(&old_a)), "the oldest scope goes, not the old names");
    drop((store, store2));
    for d in [profile, profile2] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn fix1_forgetting_a_project_also_forgets_its_setup_card_state() {
    let git = Git::detect().unwrap();
    let profile = temp("fix1-forget");
    let store = Store::open(&profile).unwrap();
    let (a, b) = (temp_repo("fix1-forget-a"), temp_repo("fix1-forget-b"));
    for r in [&a, &b] {
        fs::write(r.join("package.json"), r#"{"packageManager":"pnpm@9"}"#).unwrap();
    }
    let (pa, pb) = (add_project(&git, &store, &a).unwrap(), add_project(&git, &store, &b).unwrap());
    for p in [&pa, &pb] {
        crate::setup::dismiss_card(&store, &p.id).unwrap();
        crate::setup::save_suggestion(&store, Path::new(&p.path), "install", "pnpm install", None).unwrap();
    }
    forget_projects(&store, std::slice::from_ref(&pa.id)).unwrap();
    assert!(!crate::setup::card_dismissed(&store, &pa.id) && crate::setup::card_dismissed(&store, &pb.id));
    assert_eq!(crate::setup::local_setup(&store, Path::new(&pa.path)), None, "the forgotten project's saved setup goes");
    assert_eq!(crate::setup::local_setup(&store, Path::new(&pb.path)).as_deref(), Some("pnpm install"), "the other stays");
    drop(store);
    for d in [profile, a, b] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj024_the_record_is_bounded_and_a_damaged_one_retires_nothing() {
    let profile = temp("retire-bound");
    let store = Store::open(&profile).unwrap();
    // More numbered rounds than the record holds: it stops growing at its limit, newest kept.
    let mut used: Vec<String> = Vec::new();
    for _ in 0..(RETIRED_PER_SCOPE + 300) {
        let n = creature_name(&used, 0);
        retire_name(&store, "scope", &n).unwrap();
        used.push(n);
    }
    let kept = retired_names(&store, "scope");
    assert_eq!(kept.len(), RETIRED_PER_SCOPE);
    assert_eq!(kept.last(), used.last());
    // Many-scopes: the oldest go.
    for i in 0..(RETIRED_SCOPES + 20) {
        retire_name(&store, &format!("s{i}"), &creature_name(&[], 1)).unwrap();
    }
    assert!(retired_names(&store, "s0").is_empty() && !retired_names(&store, &format!("s{}", RETIRED_SCOPES + 19)).is_empty());
    assert!(retired_all(&store).len() <= RETIRED_SCOPES);

    // A damaged record: nothing counts as retired and suggestions carry on; the next retire repairs it.
    store.set(RETIRED_KEY, "{not json").unwrap();
    assert!(retired_names(&store, "scope").is_empty());
    let pick = pick_name(&store, "scope", vec![], 5);
    assert_eq!(pick, creature_name(&[], 5));
    store.set(RETIRED_KEY, "[{\"scope\": 4}]").unwrap();
    assert!(retired_names(&store, "scope").is_empty());
    retire_name(&store, "scope", &pick).unwrap();
    assert_eq!(retired_names(&store, "scope"), vec![pick]);
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

#[test]
fn a_fresh_workspace_gets_a_creature_name_that_is_not_in_use() {
    let git = Git::detect().unwrap();
    let profile = temp("profile4");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo4");
    let root = temp("root4");
    let project = add_project(&git, &store, &repo).unwrap();
    let projects = load_projects(&store);

    let first = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &projects, &project, None).unwrap();
    let second = create_fresh_workspace(&git, || Ok(&store), &nested(&root), &projects, &project, None).unwrap();
    let name_of = |w: &Worktree| Path::new(&w.path).file_name().unwrap().to_string_lossy().to_string();
    assert_ne!(name_of(&first), name_of(&second), "two launches never share a name");
    for w in [&first, &second] {
        let name = name_of(w);
        assert!(name.split('-').count() == 2, "adjective-creature: {name}");
        assert_eq!(w.branch.as_deref(), Some(name.as_str()), "the branch carries the same name");
        assert!(Path::new(&w.path).join("a.txt").is_file(), "a real checkout");
    }
    let in_use = names_in_use(&git, &projects);
    assert!(in_use.contains(&name_of(&first)) && in_use.contains(&name_of(&second)));
    // SESS-023 / PROJ-024: a deleted workspace's name never comes back, even from the same seed.
    let scope = retired_scope(&nested(&root), &project);
    remove_workspace(&git, &project, &first.path, false).unwrap();
    forget_workspace(&store, &first.path).unwrap();
    assert!(!names_in_use(&git, &projects).contains(&name_of(&first)));
    for seed in [0u64, 7, 4242] {
        assert_ne!(fresh_name(&git, &store, &projects, &scope, seed), name_of(&first), "seed {seed}");
    }
    let x = fresh_name(&git, &store, &projects, &scope, 0);
    retire_name(&store, &scope, &x).unwrap();
    assert_ne!(fresh_name(&git, &store, &projects, &scope, 0), x);

    drop(store);
    for d in [profile, repo, root] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn new_workspaces_bring_listed_files_along_and_removal_refuses_dirty_work_unless_forced() {
    let git = Git::detect().unwrap();
    let profile = temp("profile8");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo8");
    fs::write(repo.join(".gitignore"), ".env\nnode_modules/\n").unwrap();
    fs::write(repo.join("tracked.txt"), "committed\n").unwrap();
    fs::write(repo.join(".worktreeinclude"), "# bring these\n.env\n*.log\nmissing.txt\ntracked.txt\n").unwrap();
    fs::write(repo.join("kolux.yaml"), "worktree:\n  sharedDirectories:\n    - node_modules/\n    - src\n    - ../out\n").unwrap();
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(repo.join("src").join("a.txt"), "a").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "setup"]);
    fs::write(repo.join(".env"), "SECRET=1\n").unwrap();
    fs::write(repo.join("tracked.txt"), "edited in main\n").unwrap();
    let project = add_project(&git, &store, &repo).unwrap();
    let place = Place { root: temp("ws8"), flat: true, prefix: String::new(), prefix_warning: None, refresh: false };

    let made = create_workspace(&git, &place, &project, "feat", None).unwrap();
    let dest = PathBuf::from(&made.worktree.path);
    assert_eq!(fs::read_to_string(dest.join(".env")).unwrap(), "SECRET=1\n", "the ignored file came along");
    assert_eq!(fs::read_to_string(dest.join("tracked.txt")).unwrap().trim_end(), "committed", "a tracked file is never copied over (the checkout may add CR)");
    assert_eq!(made.warnings.len(), 3, "{:?}", made.warnings);
    assert!(made.warnings[0].contains("`*.log`") && made.warnings[1].contains("`missing.txt`") && made.warnings[2].contains("`src` is not git-ignored"), "{:?}", made.warnings);
    // the shared folder is one folder seen from both places
    fs::write(repo.join("node_modules").join("dep.js"), "1").unwrap();
    assert_eq!(fs::read_to_string(dest.join("node_modules").join("dep.js")).unwrap(), "1");
    assert!(!dest.join("out").exists());
    let status = Command::new("git").args(["status", "--porcelain"]).current_dir(&dest).output().unwrap().stdout;
    assert!(!git.dirty(&dest).unwrap(), "linked and copied files are ignored, so the worktree starts clean: {}", String::from_utf8_lossy(&status));

    fs::write(dest.join("work.txt"), "unsaved").unwrap();
    let err = remove_workspace(&git, &project, &made.worktree.path, false).unwrap_err();
    assert!(err.contains("feat has uncommitted changes"), "{err}");
    assert!(dest.join("work.txt").is_file(), "nothing was lost");
    remove_workspace(&git, &project, &made.worktree.path, true).unwrap();
    assert!(!dest.exists() && !git.branch_taken(&repo, "feat"));
    assert!(repo.join("node_modules").join("dep.js").is_file(), "removing the link left the shared folder alone");

    drop(store);
    for d in [profile, repo, place.root] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn a_picked_worktree_is_added_itself_and_scratch_worktrees_stay_hidden() {
    let git = Git::detect().unwrap();
    let profile = temp("profile5");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo5");
    let side = temp("side5");
    let zeta = side.join("zeta");
    git.worktree_add(&repo, &zeta, "zeta", "HEAD").unwrap();
    let scratch = repo.join(".claude").join("worktrees").join("scratch");
    git.worktree_add(&repo, &scratch, "scratch", "HEAD").unwrap();

    let project = add_project(&git, &store, &zeta).unwrap();
    assert!(same_folder(Path::new(&project.path), &zeta), "PROJ-006: A not added, so the picked worktree folder itself is the project: {}", project.path);
    crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
    let names: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().filter(|w| !w.hidden).map(|w| (w.branch.unwrap_or_default(), w.is_main)).collect();
    assert_eq!(names, vec![("main".to_string(), true), ("zeta".to_string(), false)], "Claude Code's scratch worktree stays hidden");

    drop(store);
    git.worktree_remove(&repo, &scratch, Some("scratch")).unwrap();
    git.worktree_remove(&repo, &zeta, Some("zeta")).unwrap();
    for d in [profile, repo, side] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn workspaces_live_where_the_project_or_the_layout_says() {
    let git = Git::detect().unwrap();
    let profile = temp("profile6");
    let store = Store::open(&profile).unwrap();
    let outer = temp("repo6");
    let repo = outer.join("app.git");
    init_repo(&repo);
    let mut project = add_project(&git, &store, &repo).unwrap();
    // the default: the global folder, nested under the project's name without its .git ending
    let place = place_for(&store, &project);
    assert!(!place.flat);
    assert_eq!(workspace_path(&place, &project, "x"), workspaces_dir(&store).join("app").join("x"));
    // a folder set for one project wins, a relative one resolved from the project root
    project.workspaces_dir = Some("ws".into());
    let place = place_for(&store, &project);
    assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("app").join("x"));
    // the flat layout puts every workspace side by side
    let mut settings = store.settings();
    settings[LAYOUT_SETTING] = "flat".into();
    store.save_settings(&settings).unwrap();
    let place = place_for(&store, &project);
    assert!(place.flat);
    assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("x"));
    let made = create_workspace(&git, &place, &project, "x", None).unwrap();
    assert!(same_folder(Path::new(&made.worktree.path), &repo.join("ws").join("x")), "{}", made.worktree.path);
    remove_workspace(&git, &project, &made.worktree.path, false).unwrap();
    // folders used before are remembered, newest first, once each
    remember_dir(&store, "D:\\one").unwrap();
    remember_dir(&store, "D:\\two").unwrap();
    remember_dir(&store, "D:\\one").unwrap();
    assert_eq!(used_dirs(&store), vec!["D:\\one".to_string(), "D:\\two".to_string()]);
    drop(store);
    for d in [profile, outer] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn a_workspace_starts_from_the_chosen_ref_then_the_saved_base_then_the_default() {
    let git = Git::detect().unwrap();
    let profile = temp("profile7");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo7");
    let root = temp("root7");
    let mut project = add_project(&git, &store, &repo).unwrap();
    let first = rev(&repo, "HEAD");
    git_in(&repo, &["checkout", "-q", "-b", "dev"]);
    fs::write(repo.join("b.txt"), "b").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "second"]);
    let second = rev(&repo, "HEAD");
    git_in(&repo, &["checkout", "-q", "main"]);
    let place = nested(&root);

    // nothing chosen, nothing saved: the default branch
    assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("main".to_string(), None));
    // chosen for this one workspace: a branch, or a full commit id used as is
    assert_eq!(resolve_base(&git, &repo, &project, Some("dev")).unwrap().0, "dev");
    assert_eq!(resolve_base(&git, &repo, &project, Some(&second)).unwrap().0, second);
    assert!(resolve_base(&git, &repo, &project, Some("nope")).unwrap_err().contains("not a branch, tag or commit"));
    // the project's saved base, then the fallback with a note once it is gone
    project.base = Some("dev".into());
    assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("dev".to_string(), None));
    project.base = Some("gone".into());
    let (base, note) = resolve_base(&git, &repo, &project, None).unwrap();
    assert_eq!(base, "main");
    assert!(note.as_deref().is_some_and(|n| n.contains("gone") && n.contains("main")), "{note:?}");
    // and the checkout really begins there
    let made = create_workspace(&git, &place, &project, "from dev", Some("dev")).unwrap();
    assert_eq!((made.base.as_str(), made.note.as_deref()), ("dev", None));
    assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), second);
    let fallen = create_workspace(&git, &place, &project, "from saved", None).unwrap();
    assert_eq!(rev(Path::new(&fallen.worktree.path), "HEAD"), first);
    assert!(fallen.note.is_some());
    for m in [&made, &fallen] {
        remove_workspace(&git, &project, &m.worktree.path, false).unwrap();
    }
    drop(store);
    for d in [profile, repo, root] {
        fs::remove_dir_all(d).unwrap();
    }
}

#[test]
fn workspaces_dir_setting_falls_back_to_default() {
    let profile = temp("profile3");
    let store = Store::open(&profile).unwrap();
    assert_eq!(workspaces_dir(&store), default_workspaces_dir());
    store.save_settings(&serde_json::json!({ "workspacesDir": "D:\\ws" })).unwrap();
    assert_eq!(workspaces_dir(&store), PathBuf::from("D:\\ws"));
    store.save_settings(&serde_json::json!({ "workspacesDir": "  " })).unwrap();
    assert_eq!(workspaces_dir(&store), default_workspaces_dir());
    drop(store);
    fs::remove_dir_all(profile).unwrap();
}

#[test]
fn env_var_moves_the_default_but_a_setting_still_wins() {
    // PROJ-026 / SET-032: KOLUX_WORKSPACES_DIR is trimmed, ignored when blank, and only
    // replaces the default, never a folder the user saved.
    assert_eq!(resolve_workspaces_dir(Some("  D:\\wt  "), None), PathBuf::from("D:\\wt"));
    assert_eq!(resolve_workspaces_dir(Some("   "), None), default_workspaces_dir());
    assert_eq!(resolve_workspaces_dir(None, None), default_workspaces_dir());
    assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some("E:\\mine")), PathBuf::from("E:\\mine"));
    assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some(" ")), PathBuf::from("D:\\wt"));
}

#[test]
fn saving_a_folder_that_cannot_be_made_fails_and_keeps_the_old_one() {
    let profile = temp("profile-place");
    let store = Store::open(&profile).unwrap();
    let bad = profile.join("file-not-folder");
    fs::write(&bad, "x").unwrap();
    let err = set_place(&store, &bad.join("ws").display().to_string(), false).unwrap_err();
    assert!(err.contains("cannot be made"), "{err}");
    assert_eq!(store.settings()[WORKSPACES_DIR_SETTING], serde_json::Value::Null, "the failed folder is not saved");
    assert!(used_dirs(&store).is_empty(), "nor remembered");
    let good = profile.join("ws").join("deep");
    let info = set_place(&store, &good.display().to_string(), true).unwrap();
    assert!(good.is_dir() && info.flat && info.dir == good.display().to_string() && info.used == vec![good.display().to_string()]);
    drop(store);
    let _ = fs::remove_dir_all(profile); // Windows may still hold the store file for a moment; the folder is throwaway
}

#[test]
fn proj068_records_follow_a_workspace_moved_outside_kolux_and_a_quiet_refresh_keeps_the_order() {
    let git = Git::detect().unwrap();
    let profile = temp("profile068");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo068");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&temp("ws068"));
    let a = create_workspace(&git, &place, &project, "alpha", None).unwrap().worktree.path;
    let made_b = create_workspace(&git, &place, &project, "beta", None).unwrap();
    let b = made_b.worktree.path.clone();
    let c = create_workspace(&git, &place, &project, "gamma", None).unwrap().worktree.path;
    set_name(&store, &b, Some("Beta work")).unwrap();
    reparent(&git, &store, &project, &b, Some(&a)).unwrap();
    reparent(&git, &store, &project, &c, Some(&b)).unwrap();
    save_workspace_note(&store, &b, "half done").unwrap();
    record_made(&store, &project, &made_b, serde_json::json!({ "madeBy": "app" })).unwrap(); // what the create commands record (T-780: one write, marker decided by record_made)
    assert!(unseen(&git, &store, &project).unwrap().is_empty());
    let key = |p: &Path| name_key(&p.to_string_lossy());
    let paths = |l: &[Worktree]| l.iter().map(|w| name_key(&w.path)).collect::<Vec<_>>();
    let find = |l: &[Worktree], p: &Path| l.iter().find(|w| name_key(&w.path) == key(p)).cloned();
    let parent_of = |l: &[Worktree], p: &Path| find(l, p).and_then(|w| w.parent).map(|x| name_key(&x));
    // refresh twice with nothing changed: the same rows in the same order
    let first = list_workspaces(&git, &store, &project).unwrap();
    assert_eq!(paths(&first), paths(&list_workspaces(&git, &store, &project).unwrap()));
    // moved from a terminal with git worktree move: name, parent, note, origin and children follow
    let moved = Path::new(&b).with_file_name("beta-moved");
    git.worktree_move(&repo, Path::new(&b), &moved).unwrap();
    let after = list_workspaces(&git, &store, &project).unwrap();
    let m = find(&after, &moved).expect("the moved workspace is listed");
    assert_eq!(m.name.as_deref(), Some("Beta work"));
    assert_eq!(m.kind, "managed");
    assert_eq!(parent_of(&after, &moved), Some(name_key(&a)));
    assert_eq!(parent_of(&after, Path::new(&c)), Some(key(&moved)));
    assert_eq!(workspace_note(&store, &m.path).text, "half done");
    assert!(unseen(&git, &store, &project).unwrap().is_empty(), "a moved workspace is not offered as new");
    // renamed by hand (Explorer, mv): Git is told where it went and the records follow again
    let by_hand = Path::new(&b).with_file_name("beta-by-hand");
    fs::rename(&moved, &by_hand).unwrap();
    let after = list_workspaces(&git, &store, &project).unwrap();
    assert!(find(&after, &moved).is_none());
    let h = find(&after, &by_hand).expect("the renamed workspace is listed");
    assert_eq!(h.name.as_deref(), Some("Beta work"));
    assert_eq!(parent_of(&after, &by_hand), Some(name_key(&a)));
    assert_eq!(parent_of(&after, Path::new(&c)), Some(key(&by_hand)));
    assert_eq!(workspace_note(&store, &h.path).text, "half done");
    // adding the project again hands back the same one, records intact
    assert_eq!(add_project(&git, &store, &repo).unwrap().id, project.id);
    assert_eq!(find(&list_workspaces(&git, &store, &project).unwrap(), &by_hand).unwrap().name.as_deref(), Some("Beta work"));
    // a removed workspace's Git folder is forgotten, so a later worktree reusing its id inherits nothing
    remove_workspace(&git, &project, &h.path, true).unwrap();
    forget_workspace(&store, &h.path).unwrap();
    assert!(!load_map(&store, ADMIN_KEY).values().any(|v| v.as_str() == Some(key(&by_hand).as_str())));
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn a_delete_is_refused_for_changes_a_lock_a_nested_workspace_or_a_changed_stamp() {
    let git = Git::detect().unwrap();
    let profile = temp("profile055");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("repo055");
    let project = add_project(&git, &store, &repo).unwrap();
    let place = nested(&temp("ws055"));
    let ws = create_workspace(&git, &place, &project, "dirty", None).unwrap().worktree.path;
    // clean: nothing refuses it
    let clean = remove_check(&git, &project, &ws).unwrap();
    assert!(clean.changes.is_empty() && clean.locked.is_none() && clean.nested.is_empty());
    assert_eq!(removal_refused(&clean, false, &clean.stamp), None);
    // an untracked file: warned, refused without force, allowed with it
    fs::write(Path::new(&ws).join("new.txt"), "n").unwrap();
    fs::write(Path::new(&ws).join("a.txt"), "changed").unwrap();
    let dirty = remove_check(&git, &project, &ws).unwrap();
    assert_eq!(dirty.changes, vec![" M a.txt".to_string(), "?? new.txt".to_string()]);
    assert!(removal_refused(&dirty, false, &dirty.stamp).unwrap().contains("2 uncommitted"));
    assert_eq!(removal_refused(&dirty, true, &dirty.stamp), None);
    // the question showed the clean state: the stamp no longer matches
    assert!(removal_refused(&dirty, true, &clean.stamp).unwrap().contains("changed after"));
    // locked: refused even when forced
    git_in(&repo, &["worktree", "lock", "--reason", "on a stick", &ws]);
    let locked = remove_check(&git, &project, &ws).unwrap();
    assert_eq!(locked.locked.as_deref(), Some("on a stick"));
    assert!(removal_refused(&locked, true, &locked.stamp).unwrap().contains("locked (on a stick)"));
    git_in(&repo, &["worktree", "unlock", &ws]);
    // a workspace folder inside this one: refused
    let inner = Path::new(&ws).join("inner");
    git_in(&repo, &["worktree", "add", "-q", "-b", "inner", &inner.to_string_lossy()]);
    let outer = remove_check(&git, &project, &ws).unwrap();
    assert_eq!(outer.nested.len(), 1);
    assert!(removal_refused(&outer, true, &outer.stamp).unwrap().contains("holds another workspace"));
    // the main checkout is never offered
    assert!(remove_check(&git, &project, &repo.to_string_lossy()).is_err());
    remove_workspace(&git, &project, &inner.to_string_lossy(), true).unwrap();
    remove_workspace(&git, &project, &ws, true).unwrap();
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t715_removing_a_workspace_runs_its_trusted_archive_script_first() {
    let git = Git::detect().unwrap();
    let profile = temp("profile715");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let repo = temp_repo("repo715");
    let ok = "cd .. && echo done>archived.txt";
    fs::write(repo.join("kolux.yaml"), format!("scripts:\n  archive: {ok}\n")).unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "archive script"]);
    let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let place = nested(&temp("ws715"));
    let terminals = crate::terminal::Terminals::default();
    let remove = |ws: &str, force: bool| {
        let check = remove_check(&git, &project, ws).unwrap();
        remove_one(&git, &store, &terminals, &project, ws, force, &check.stamp, Some(false))
    };
    // SAFE-025: not trusted (Don't run, or nobody asked): the delete goes on and the script does not run
    let first = create_workspace(&git, &place, &project, "untrusted", None).unwrap().worktree;
    let done = Path::new(&first.path).parent().unwrap().join("archived.txt");
    remove(&first.path, false).unwrap();
    assert!(!Path::new(&first.path).exists() && !done.exists(), "an untrusted archive script never runs");
    // trusted: it runs inside the workspace before the folder goes
    crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", ok, false).unwrap();
    let second = create_workspace(&git, &place, &project, "trusted", None).unwrap().worktree;
    let done = Path::new(&second.path).parent().unwrap().join("archived.txt");
    remove(&second.path, false).unwrap();
    assert_eq!(fs::read_to_string(&done).unwrap().trim(), "done", "the archive script ran");
    assert!(!Path::new(&second.path).exists(), "and the folder went");
    // a trusted script that fails stops the delete and says why; the force box deletes it anyway
    let third = create_workspace(&git, &place, &project, "failing", None).unwrap().worktree;
    let bad = "echo boom 1>&2 && exit 3";
    fs::write(Path::new(&third.path).join("kolux.yaml"), format!("scripts:\n  archive: {bad}\n")).unwrap();
    git_in(Path::new(&third.path), &["commit", "-q", "-am", "failing archive"]);
    crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", bad, false).unwrap();
    let err = remove(&third.path, false).unwrap_err();
    assert!(err.starts_with("The archive script failed with exit code 3: boom") && err.contains("It was not deleted"), "{err}");
    assert!(Path::new(&third.path).exists(), "the folder stays");
    remove(&third.path, true).unwrap();
    assert!(!Path::new(&third.path).exists(), "forced, it goes");
    // a trusted script that leaves a file in the workspace (a log) does not make it "dirty"
    let fourth = create_workspace(&git, &place, &project, "writer", None).unwrap().worktree;
    let writes = "echo log>left.txt && cd .. && echo in>wrote.txt";
    fs::write(Path::new(&fourth.path).join("kolux.yaml"), format!("scripts:\n  archive: {writes}\n")).unwrap();
    git_in(Path::new(&fourth.path), &["commit", "-q", "-am", "writing archive"]);
    crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", writes, false).unwrap();
    remove(&fourth.path, false).unwrap();
    assert!(Path::new(&fourth.path).parent().unwrap().join("wrote.txt").exists(), "it ran");
    assert!(!Path::new(&fourth.path).exists(), "and the folder went without the force box");
    // the CLI's rm (remove_with, archive false) never runs it, trusted or not (CLI-020)
    fs::remove_file(&done).unwrap();
    crate::setup::trust_grant(&store.lock().unwrap(), &repo, "archive", ok, false).unwrap();
    let fifth = create_workspace(&git, &place, &project, "cli", None).unwrap().worktree;
    let check = remove_check(&git, &project, &fifth.path).unwrap();
    remove_with(&git, &store, &terminals, &project, &fifth.path, false, &check.stamp, Some(false), false).unwrap();
    assert!(!Path::new(&fifth.path).exists() && !done.exists(), "the CLI's rm removes without the archive script");
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t613_commits_found_nowhere_else_are_named_and_keep_the_branch_unless_the_form_says_delete_it() {
    let git = Git::detect().unwrap();
    let profile = temp("profile613");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let repo = temp_repo("repo613");
    let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let place = nested(&temp("ws613"));
    let terminals = crate::terminal::Terminals::default();
    let made = |name: &str| create_workspace(&git, &place, &project, name, None).unwrap().worktree;
    let commit = |ws: &str, file: &str| {
        fs::write(Path::new(ws).join(file), file).unwrap();
        git_in(Path::new(ws), &["add", "."]);
        git_in(Path::new(ws), &["commit", "-q", "-m", file]);
    };
    let exists = |b: &str| crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")], Some(&repo)).is_ok();
    // nothing committed: nothing to lose, so the branch goes with the folder as before
    let fresh = made("fresh");
    let check = remove_check(&git, &project, &fresh.path).unwrap();
    assert!(check.commits.is_empty(), "{check:?}");
    assert_eq!(remove_one(&git, &store, &terminals, &project, &fresh.path, false, &check.stamp, None).unwrap(), None);
    assert!(!exists(fresh.branch.as_deref().unwrap()));
    // two commits on no other branch and never pushed: the check names them, newest first
    let work = made("fix-login");
    let branch = work.branch.clone().unwrap();
    commit(&work.path, "one.txt");
    commit(&work.path, "two.txt");
    let check = remove_check(&git, &project, &work.path).unwrap();
    assert_eq!(check.commits.len(), 2, "{check:?}");
    assert!(check.commits[0].ends_with(" two.txt") && check.commits[1].ends_with(" one.txt"), "{check:?}");
    // a commit another branch holds, or one already on a remote, is not lost
    git_in(&repo, &["branch", "copy-of-one", &format!("{branch}~1")]);
    assert_eq!(remove_check(&git, &project, &work.path).unwrap().commits.len(), 1);
    git_in(&repo, &["update-ref", &format!("refs/remotes/origin/{branch}"), &format!("refs/heads/{branch}")]);
    assert!(remove_check(&git, &project, &work.path).unwrap().commits.is_empty());
    git_in(&repo, &["update-ref", "-d", &format!("refs/remotes/origin/{branch}")]);
    git_in(&repo, &["branch", "-D", "copy-of-one"]);
    // no choice made (the record's default, as the batch and the multi-select send): the folder
    // goes, the branch stays with its commits and comes back for the kept-branch list
    let check = remove_check(&git, &project, &work.path).unwrap();
    let tip = crate::git::run(&["rev-parse", &format!("refs/heads/{branch}")], Some(&repo)).unwrap();
    let kept = remove_one(&git, &store, &terminals, &project, &work.path, false, &check.stamp, None).unwrap();
    assert_eq!(kept, Some(Kept { branch: branch.clone(), commit: tip }));
    assert!(!Path::new(&work.path).exists() && exists(&branch), "the folder went, the branch stayed");
    // the form's own choice to delete the branch still deletes it, commits and all
    let other = made("throwaway");
    commit(&other.path, "three.txt");
    let check = remove_check(&git, &project, &other.path).unwrap();
    assert_eq!(check.commits.len(), 1, "{check:?}");
    assert_eq!(remove_one(&git, &store, &terminals, &project, &other.path, false, &check.stamp, Some(false)).unwrap(), None);
    assert!(!exists(other.branch.as_deref().unwrap()));
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t613_a_parent_and_a_child_at_its_tip_deleted_side_by_side_keep_their_unpushed_commits() {
    let git = Git::detect().unwrap();
    let profile = temp("profile613b");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let repo = temp_repo("repo613b");
    let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let place = nested(&temp("ws613b"));
    let terminals = crate::terminal::Terminals::default();
    // the parent has three commits on no remote; the child starts at its tip with none of its own
    let parent = create_workspace(&git, &place, &project, "fix", None).unwrap().worktree;
    let parent_branch = parent.branch.clone().unwrap();
    for f in ["one.txt", "two.txt", "three.txt"] {
        fs::write(Path::new(&parent.path).join(f), f).unwrap();
        git_in(Path::new(&parent.path), &["add", "."]);
        git_in(Path::new(&parent.path), &["commit", "-q", "-m", f]);
    }
    let tip = crate::git::run(&["rev-parse", &format!("refs/heads/{parent_branch}")], Some(&repo)).unwrap();
    let child = create_workspace(&git, &place, &project, "fix-tests", Some(&parent_branch)).unwrap().worktree;
    // each sees the other's branch holding the commits
    let checks: Vec<RemoveCheck> = [&parent, &child].iter().map(|w| remove_check(&git, &project, &w.path).unwrap()).collect();
    assert!(checks.iter().all(|c| c.commits.is_empty()), "{checks:?}");
    // no branch choice, side by side, as the Space batch (workspace_remove_many) runs them
    let start = std::sync::Barrier::new(2);
    let kept: Vec<Option<Kept>> = std::thread::scope(|s| {
        let runs: Vec<_> = [(&parent, &checks[0]), (&child, &checks[1])]
            .into_iter()
            .map(|(w, c)| {
                let (git, store, terminals, project, start) = (&git, &store, &terminals, &project, &start);
                s.spawn(move || {
                    start.wait();
                    remove_one(git, store, terminals, project, &w.path, false, &c.stamp, None).unwrap()
                })
            })
            .collect();
        runs.into_iter().map(|r| r.join().unwrap()).collect()
    });
    assert!(!Path::new(&parent.path).exists() && !Path::new(&child.path).exists(), "both folders went");
    let holding = crate::git::run(&["for-each-ref", "--format=%(refname:short)", "--contains", &tip, "refs/heads"], Some(&repo)).unwrap();
    let holders: Vec<&str> = holding.lines().filter(|b| *b == parent_branch || Some(*b) == child.branch.as_deref()).collect();
    assert_eq!(holders.len(), 1, "exactly one of the two branches stays, holding the commits: {holding:?}");
    let kept: Vec<Kept> = kept.into_iter().flatten().collect();
    assert_eq!(kept, vec![Kept { branch: holders[0].to_string(), commit: tip }], "and it comes back as kept");
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-613b (review of PR #10): a detached-HEAD workspace whose commits no branch and no remote
/// holds gets a keep-branch at its HEAD (`kolux/kept-<short id>`) before its folder goes, with no
/// choice made (the batch, the CLI) and with Keep the branch ticked; it comes back as kept. With
/// nothing of its own, or with Keep the branch unticked, no branch is made.
#[test]
fn t613b_a_detached_workspace_with_commits_found_nowhere_else_keeps_them_on_a_new_branch() {
    let git = Git::detect().unwrap();
    let profile = temp("profile613d");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let repo = temp_repo("repo613d");
    let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let terminals = crate::terminal::Terminals::default();
    let ws_root = temp("ws613d");
    let detached = |name: &str, commit: bool| -> (String, String) {
        let path = ws_root.join(name);
        git_in(&repo, &["worktree", "add", "-q", "--detach", &path.to_string_lossy()]);
        if commit {
            fs::write(path.join(format!("{name}.txt")), name).unwrap();
            git_in(&path, &["add", "."]);
            git_in(&path, &["commit", "-q", "-m", name]);
        }
        let tip = crate::git::run(&["rev-parse", "HEAD"], Some(&path)).unwrap();
        (path.to_string_lossy().into_owned(), tip)
    };
    let on_a_branch = |tip: &str| crate::git::run(&["for-each-ref", "--format=%(refname:short)", "--contains", tip, "refs/heads"], Some(&repo)).unwrap();
    for (name, choice) in [("batch", None), ("ticked", Some(true))] {
        let (path, tip) = detached(name, true);
        let check = remove_check(&git, &project, &path).unwrap();
        assert_eq!(check.commits.len(), 1, "{check:?}");
        let kept = remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, choice).unwrap();
        assert!(!Path::new(&path).exists(), "the folder went");
        let want = format!("kolux/kept-{}", &tip[..7]);
        assert_eq!(kept, Some(Kept { branch: want.clone(), commit: tip.clone() }), "{name}: the new branch is named");
        assert_eq!(on_a_branch(&tip), want, "{name}: the commit survives on it");
    }
    // nothing of its own (its HEAD is on main): no branch is made
    let (path, tip) = detached("clean", false);
    let check = remove_check(&git, &project, &path).unwrap();
    let kept_now = || crate::git::run(&["for-each-ref", "--format=%(refname:short)", "refs/heads/kolux"], Some(&repo)).unwrap().lines().count();
    let before = kept_now();
    assert_eq!(remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, None).unwrap(), None);
    assert!(on_a_branch(&tip).lines().any(|b| b == "main") && kept_now() == before, "no new branch");
    // Keep the branch unticked, the commits listed in the question: the user let them go
    let (path, tip) = detached("letgo", true);
    let check = remove_check(&git, &project, &path).unwrap();
    assert_eq!(remove_one(&git, &store, &terminals, &project, &path, false, &check.stamp, Some(false)).unwrap(), None);
    assert_eq!(on_a_branch(&tip), "");
    drop(store);
    for d in [profile, repo, ws_root] {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-613b (review of PR #10): a branch whose commit cannot be read is not "nothing to lose": the
/// read fails, so the check refuses rather than letting the branch go.
#[test]
fn t613b_a_branch_that_cannot_be_read_is_not_taken_for_one_with_nothing_to_lose() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("repo613r");
    git_in(&repo, &["branch", "broken"]);
    fs::write(repo.join(".git/refs/heads/broken"), "0000000000000000000000000000000000000bad\n").unwrap();
    let read = only_here(&git, &repo, Some("broken"), "");
    assert_eq!(read, Err("Kolux could not read this branch, so it was left in place.".to_string()), "a failed read is not an empty list");
    // a branch that is not there at all (unborn) still has nothing to lose
    assert_eq!(only_here(&git, &repo, Some("never-made"), ""), Ok(Vec::new()));
    let _ = fs::remove_dir_all(repo);
}

/// T-613b (review of lane2): a detached worktree whose HEAD Git could not tell (an empty head)
/// is not taken for one with no commits: the check refuses with a plain message.
#[test]
fn t613b_a_detached_worktree_whose_head_cannot_be_read_is_refused() {
    let git = Git::detect().unwrap();
    let repo = temp_repo("repo613h");
    assert_eq!(only_here(&git, &repo, None, ""), Err("Kolux could not read this workspace's commit, so it was left in place.".to_string()));
    let _ = fs::remove_dir_all(repo);
}

/// T-613b (review of PR #10): a delete with Keep the branch unticked (Some(false)) deletes the
/// branch only in its turn, as the no-choice delete does, so it never races another delete's
/// decision about the same commits.
#[test]
fn t613b_an_explicit_branch_delete_takes_the_branch_turn() {
    use std::time::Duration;
    let git = Git::detect().unwrap();
    let profile = temp("profile613t");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let repo = temp_repo("repo613t");
    let project = add_project(&git, &store.lock().unwrap(), &repo).unwrap();
    let place = nested(&temp("ws613t"));
    let terminals = crate::terminal::Terminals::default();
    let work = create_workspace(&git, &place, &project, "gone", None).unwrap().worktree;
    let branch = work.branch.clone().unwrap();
    let exists = || crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")], Some(&repo)).is_ok();
    let check = remove_check(&git, &project, &work.path).unwrap();
    let turn = branch_turn(Path::new(&project.path));
    let held = turn.lock().unwrap();
    std::thread::scope(|s| {
        let run = s.spawn(|| remove_one(&git, &store, &terminals, &project, &work.path, false, &check.stamp, Some(false)));
        let start = std::time::Instant::now();
        while Path::new(&work.path).exists() && start.elapsed() < Duration::from_secs(20) {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(200));
        let during = exists();
        drop(held);
        assert_eq!(run.join().unwrap(), Ok(None));
        assert!(during, "the branch waits for the turn before it goes");
    });
    assert!(!exists(), "and goes once the turn is free");
    drop(store);
    for d in [profile, repo, place.root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj039_a_reply_becomes_a_short_slug_without_the_prefix() {
    assert_eq!(branch_slug("Fix the login bug", "").as_deref(), Some("fix-the-login-bug"));
    assert_eq!(branch_slug("`tx/Fix login`\nignored second line", "tx/").as_deref(), Some("fix-login"), "the prefix is removed");
    assert_eq!(branch_slug("TX/fix-login", "tx/").as_deref(), Some("fix-login"), "any letter case");
    assert_eq!(branch_slug("tx", "tx/"), None, "only the prefix is ignored");
    assert_eq!(branch_slug("tx/", "tx/"), None);
    assert_eq!(branch_slug("   \n  ", ""), None);
    assert_eq!(branch_slug("???", ""), None);
    let long = branch_slug("add support for importing every kind of saved layout from the old settings folder", "").unwrap();
    assert!(long.len() <= SLUG_MAX && !long.ends_with('-'), "{long}");
    assert_eq!(long, "add-support-for-importing-every-kind-of");
    assert_eq!(sentence_case("fix-login-bug"), "Fix login bug");
    assert_eq!(sentence_case("tx/fix-login"), "Fix login");
}

#[test]
fn cli009_a_wsl_path_on_a_mounted_drive_resolves_and_the_callers_distro_wins() {
    assert_eq!(wsl_path("/mnt/c/Users/x/repo", None), "C:\\Users\\x\\repo");
    assert_eq!(wsl_path("/mnt/d", Some("Ubuntu")), "D:\\");
    // Not a drive: /mnt/wsl is Linux's own folder, so it belongs to the caller's distro.
    assert_eq!(wsl_path("/mnt/wsl/x", Some("Debian")), "\\\\wsl.localhost\\Debian\\mnt\\wsl\\x");
    // The same Linux path written from two distros reaches each caller's own.
    assert_eq!(wsl_path("/home/u/app", Some("Ubuntu")), "\\\\wsl.localhost\\Ubuntu\\home\\u\\app");
    assert_eq!(wsl_path("/home/u/app", Some("Debian")), "\\\\wsl.localhost\\Debian\\home\\u\\app");
    assert_eq!(wsl_path("/home/u/app", None), "/home/u/app");
    assert_eq!(wsl_path("C:\\work\\a", Some("Ubuntu")), "C:\\work\\a");
    assert_eq!(wsl_distro_of("\\\\wsl.localhost\\Ubuntu\\home\\u"), Some("Ubuntu".into()));
    assert_eq!(wsl_distro_of("//wsl$/Debian/home"), Some("Debian".into()));
    assert_eq!(wsl_distro_of("C:\\work"), None);
}

#[test]
fn cli019_a_workspace_status_is_found_by_id_label_or_the_word_completed() {
    let store = Store::open(&temp("status-profile")).unwrap();
    assert_eq!(resolve_status(&store, "in-review").unwrap(), "in-review");
    assert_eq!(resolve_status(&store, "In progress").unwrap(), "in-progress");
    assert_eq!(resolve_status(&store, " TODO ").unwrap(), "todo");
    assert_eq!(resolve_status(&store, "completed").unwrap(), "done");
    let why = resolve_status(&store, "blocked").unwrap_err();
    assert!(why.contains("no status blocked") && why.contains("in-review"), "{why}");
}

#[test]
fn cli009_folder_names_the_folder_workspace_of_a_project_without_git_only() {
    let base = temp("folder-parent");
    let store = Store::open(&base.join("db")).unwrap();
    let plain = base.join("plain");
    fs::create_dir_all(&plain).unwrap();
    let project = crate::folder_projects::add_folder(&store, &plain).unwrap();
    let (found, ws) = folder_parent(&store, &project.id).unwrap();
    assert_eq!(found.id, project.id);
    assert!(same_folder(Path::new(&ws.path), &plain));
    assert!(folder_parent(&store, "nope").unwrap_err().contains("no project"));
    let repo = temp_repo("folder-parent-git");
    let git = Git::detect().unwrap();
    let git_project = add_project(&git, &store, &repo).unwrap();
    assert!(folder_parent(&store, &git_project.id).unwrap_err().contains("without Git"));
}

fn rename_fixture(name: &str, setting: Option<bool>) -> (Git, Mutex<Store>, Project, PathBuf, PathBuf, PathBuf) {
    let git = Git::detect().unwrap();
    let profile = temp(&format!("profile-{name}"));
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo(&format!("repo-{name}"));
    let root = temp(&format!("root-{name}"));
    let mut settings = store.settings();
    settings["branchPrefix"] = serde_json::json!("custom");
    settings["branchPrefixCustom"] = serde_json::json!("tx");
    settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
    if let Some(on) = setting {
        settings[RENAME_SETTING] = serde_json::json!(on);
    }
    store.save_settings(&settings).unwrap();
    let project = add_project(&git, &store, &repo).unwrap();
    (git, Mutex::new(store), project, profile, repo, root)
}

#[test]
fn proj039_the_first_work_renames_a_suggested_branch_once_and_keeps_its_commits() {
    let (git, store, project, profile, repo, root) = rename_fixture("rename-ok", None);
    let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let old = made.branch.clone().unwrap();
    assert!(old.starts_with("tx/"), "{old}");
    // work already committed on the branch must still be on it afterwards
    fs::write(Path::new(&made.path).join("b.txt"), "b").unwrap();
    git_in(Path::new(&made.path), &["add", "."]);
    git_in(Path::new(&made.path), &["commit", "-q", "-m", "work"]);
    let tip = rev(Path::new(&made.path), "HEAD");
    let answer = rename_after_work(&git, &store, &project, &made.path, "tx/Fix the login bug").unwrap();
    assert!(answer.renamed, "{answer:?}");
    assert_eq!(answer.branch.as_deref(), Some("tx/fix-the-login-bug"));
    assert_eq!(answer.old.as_deref(), Some(old.as_str()));
    assert_eq!(answer.name.as_deref(), Some("Fix the login bug"));
    assert_eq!(rev(&repo, "refs/heads/tx/fix-the-login-bug"), tip, "the commits moved with the branch");
    assert!(!git.branch_taken(&repo, &old), "the old name is gone");
    assert_eq!(git.worktrees(&repo).unwrap().iter().find(|w| name_key(&w.path) == name_key(&made.path)).and_then(|w| w.branch.clone()).as_deref(), Some("tx/fix-the-login-bug"));
    assert_eq!(load_names(&store.lock().unwrap()).get(&name_key(&made.path)).and_then(|v| v.as_str()), Some("Fix the login bug"));
    // a second reply changes nothing: only a name Kolux suggested is replaced
    let again = rename_after_work(&git, &store, &project, &made.path, "something else").unwrap();
    assert!(!again.renamed && again.reason.is_some(), "{again:?}");
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj039_a_branch_is_left_alone_when_the_setting_is_off_the_name_is_yours_or_it_is_the_main_checkout() {
    let (git, store, project, profile, repo, root) = rename_fixture("rename-off", Some(false));
    let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let old = made.branch.clone().unwrap();
    let off = rename_after_work(&git, &store, &project, &made.path, "fix login").unwrap();
    assert!(!off.renamed && off.reason.as_deref().is_some_and(|r| r.contains("off")), "{off:?}");
    assert!(git.branch_taken(&repo, &old));
    // on again, but named by hand
    let mut settings = store.lock().unwrap().settings();
    settings[RENAME_SETTING] = serde_json::json!(true);
    store.lock().unwrap().save_settings(&settings).unwrap();
    rename(&store.lock().unwrap(), &made.path, "My own name").unwrap();
    let named = rename_after_work(&git, &store, &project, &made.path, "fix login").unwrap();
    assert!(!named.renamed, "{named:?}");
    assert!(git.branch_taken(&repo, &old), "a hand-named workspace keeps its branch");
    // the main checkout is never renamed, even when marked
    mark_suggested(&store.lock().unwrap(), &project.path, true).unwrap();
    let main = rename_after_work(&git, &store, &project, &project.path, "fix login").unwrap();
    assert!(!main.renamed, "{main:?}");
    assert!(git.branch_taken(&repo, "main"));
    // a reply with nothing usable changes nothing
    let fresh = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let none = rename_after_work(&git, &store, &project, &fresh.path, "???").unwrap();
    assert!(!none.renamed, "{none:?}");
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj039_a_taken_branch_name_gets_a_number_and_a_rename_never_overwrites() {
    let (git, store, project, profile, repo, root) = rename_fixture("rename-taken", None);
    let first = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let second = create_fresh_from(&git, &store, &project.id, None).unwrap();
    // an unmerged branch that already holds the wanted name
    git_in(&repo, &["branch", "tx/fix-login"]);
    let tip = rev(&repo, "refs/heads/tx/fix-login");
    let a = rename_after_work(&git, &store, &project, &first.path, "fix login").unwrap();
    assert_eq!(a.branch.as_deref(), Some("tx/fix-login-2"), "{a:?}");
    let b = rename_after_work(&git, &store, &project, &second.path, "fix login").unwrap();
    assert_eq!(b.branch.as_deref(), Some("tx/fix-login-3"), "{b:?}");
    assert_eq!(rev(&repo, "refs/heads/tx/fix-login"), tip, "the branch that held the name is untouched");
    // the Git layer alone refuses to replace a branch and says why
    let err = git.rename_branch(&repo, "tx/fix-login-2", "tx/fix-login").unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert!(git.rename_branch(&repo, "tx/fix-login-2", "--evil").is_err());
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t107d_the_first_prompt_renames_a_suggested_branch_once_from_the_task_and_finds_the_project_by_path() {
    let (git, store, project, profile, repo, root) = rename_fixture("first-prompt", None);
    let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let old = made.branch.clone().unwrap();
    assert_eq!(project_for_path(&git, &store.lock().unwrap(), &made.path).map(|p| p.id), Some(project.id.clone()), "the project is found from the folder");
    assert!(project_for_path(&git, &store.lock().unwrap(), "C:/nowhere/at/all").is_none());
    // no writer: the task's own words name the branch; a work-item marker never does
    let a = rename_on_first_prompt(&git, &store, &made.path, "Fix the login bug (#123)\nmore detail", None).unwrap();
    assert!(a.renamed, "{a:?}");
    assert_eq!(a.branch.as_deref(), Some("tx/fix-the-login-bug"));
    assert_eq!(a.name.as_deref(), Some("Fix the login bug"));
    assert!(!git.branch_taken(&repo, &old));
    // once per workspace: the next prompt changes nothing
    let b = rename_on_first_prompt(&git, &store, &made.path, "now do something else", None).unwrap();
    assert!(!b.renamed && b.reason.is_some(), "{b:?}");
    assert!(git.branch_taken(&repo, "tx/fix-the-login-bug"));
    // an unknown folder and a prompt of only markers are left alone without touching Git
    assert!(!rename_on_first_prompt(&git, &store, "C:/nowhere/at/all", "fix it", None).unwrap().renamed);
    let fresh = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let m = rename_on_first_prompt(&git, &store, &fresh.path, "#12 KOL-7 [ABC-99]", None).unwrap();
    assert!(!m.renamed && m.reason.as_deref().is_some_and(|r| r.contains("nothing")), "{m:?}");
    assert!(git.branch_taken(&repo, fresh.branch.as_deref().unwrap()));
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t107d_a_pushed_branch_one_with_a_pull_request_or_one_renamed_by_hand_is_never_renamed() {
    let (git, store, project, profile, repo, root) = rename_fixture("first-prompt-guards", None);
    // pushed without tracking: a remote holds the name
    let pushed = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let pb = pushed.branch.clone().unwrap();
    git_in(&repo, &["update-ref", &format!("refs/remotes/origin/{pb}"), "HEAD"]);
    assert!(git.on_remote(&repo, &pb));
    let a = rename_on_first_prompt(&git, &store, &pushed.path, "fix login", None).unwrap();
    assert!(!a.renamed && a.reason.as_deref().is_some_and(|r| r.contains("pushed")), "{a:?}");
    assert!(git.branch_taken(&repo, &pb), "the pushed branch keeps its name");
    // tracking configured
    let tracked = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let tb = tracked.branch.clone().unwrap();
    git_in(&repo, &["config", &format!("branch.{tb}.remote"), "origin"]);
    git_in(&repo, &["config", &format!("branch.{tb}.merge"), &format!("refs/heads/{tb}")]);
    let b = rename_on_first_prompt(&git, &store, &tracked.path, "fix login", None).unwrap();
    assert!(!b.renamed && b.reason.as_deref().is_some_and(|r| r.contains("pushed")), "{b:?}");
    assert!(git.branch_taken(&repo, &tb));
    // linked to a pull request
    let pr = create_fresh_from(&git, &store, &project.id, None).unwrap();
    set_origin(&store.lock().unwrap(), &pr.path, Some(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/5" }))).unwrap();
    let c = rename_on_first_prompt(&git, &store, &pr.path, "fix login", None).unwrap();
    assert!(!c.renamed && c.reason.as_deref().is_some_and(|r| r.contains("pull request")), "{c:?}");
    assert!(git.branch_taken(&repo, pr.branch.as_deref().unwrap()));
    // renamed by hand in Git: the branch's last part no longer names the folder
    let hand = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let hb = hand.branch.clone().unwrap();
    git_in(Path::new(&hand.path), &["branch", "-m", &hb, "tx/mine"]);
    let d = rename_on_first_prompt(&git, &store, &hand.path, "fix login", None).unwrap();
    assert!(!d.renamed && d.reason.as_deref().is_some_and(|r| r.contains("name of its own")), "{d:?}");
    assert!(git.branch_taken(&repo, "tx/mine"));
    // a workspace made from the composer with the suggested name is marked; a typed branch is not
    let kept = create_workspace(&git, &place_from(&project, &store.lock().unwrap().settings()), &project, "amber-otter", None).unwrap().worktree;
    assert!(!suggested_map(&store.lock().unwrap()).contains_key(&name_key(&kept.path)), "create_workspace itself marks nothing");
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn stat039_task_words_drop_work_item_markers_and_keep_the_first_line() {
    assert_eq!(task_words("Fix the login bug (#123)\nsecond line"), "Fix the login bug");
    assert_eq!(task_words("KOL-12: fix login [ABC-7]"), "fix login");
    assert_eq!(task_words("  #12 KOL-7 [ABC-99] "), "");
    assert_eq!(task_words("add T-shirt sizes for x-ray"), "add T-shirt sizes for x-ray");
    assert_eq!(task_words("\n\n  "), "");
}

#[test]
fn t110b_a_renamed_branch_offers_the_folder_and_the_move_rekeys_what_kolux_remembers_without_deleting() {
    let (git, store, project, profile, repo, root) = rename_fixture("move-folder", None);
    let made = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let child = create_fresh_from(&git, &store, &project.id, None).unwrap();
    {
        let s = store.lock().unwrap();
        set_parent(&s, &child.path, Some(&made.path)).unwrap();
        set_hidden(&s, &made.path, true).unwrap();
        save_workspace_note(&s, &made.path, "handoff").unwrap();
        save_seen(&s, &project, &[name_key(&made.path), name_key(&child.path)]).unwrap(); // as the first scan would have
    }
    fs::write(Path::new(&made.path).join("work.txt"), "unsaved").unwrap(); // uncommitted work travels with the folder
    let a = rename_on_first_prompt(&git, &store, &made.path, "Fix the login bug", None).unwrap();
    assert!(a.renamed, "{a:?}");
    assert_eq!(a.folder.as_deref(), Some("fix-the-login-bug"), "the folder is offered, never moved here");
    assert!(Path::new(&made.path).is_dir(), "the question comes first");
    // a name that is not a folder name, and a taken place, refuse and move nothing
    assert!(move_folder(&git, &store, &made.path, "a/b").is_err());
    let taken = Path::new(&made.path).parent().unwrap().join("taken");
    fs::create_dir_all(&taken).unwrap();
    fs::write(taken.join("keep.txt"), "k").unwrap();
    let e = move_folder(&git, &store, &made.path, "taken").unwrap_err();
    assert!(e.contains("already exists"), "{e}");
    assert!(taken.join("keep.txt").is_file() && Path::new(&made.path).is_dir());
    // the main checkout is never moved
    assert!(move_folder(&git, &store, &repo.to_string_lossy(), "elsewhere").is_err());
    assert!(repo.is_dir());
    // the move itself
    let to = move_folder(&git, &store, &made.path, "fix-the-login-bug").unwrap();
    assert!(Path::new(&to).join("work.txt").is_file(), "the uncommitted file came along");
    assert!(!Path::new(&made.path).exists());
    assert!(git.worktrees(&repo).unwrap().iter().any(|w| name_key(&w.path) == name_key(&to) && w.branch.as_deref() == Some("tx/fix-the-login-bug")));
    let s = store.lock().unwrap();
    assert_eq!(load_names(&s).get(&name_key(&to)).and_then(|v| v.as_str()), Some("Fix the login bug"));
    assert!(!load_names(&s).contains_key(&name_key(&made.path)));
    assert_eq!(load_map(&s, PARENTS_KEY).get(&name_key(&child.path)).and_then(|v| v.as_str()).map(name_key), Some(name_key(&to)), "the child now names the moved folder as its parent");
    assert_eq!(load_map(&s, HIDDEN_KEY).get(&name_key(&to)), Some(&serde_json::Value::Bool(true)));
    let seen = seen_of(&s, &project).unwrap();
    assert!(seen.contains(&name_key(&to)) && !seen.contains(&name_key(&made.path)));
    assert!(load_origins(&s).contains_key(&name_key(&to)));
    assert!(s.get(&format!("{NOTE_PREFIX}{}", name_key(&to))).unwrap().unwrap().contains("handoff"));
    assert_eq!(s.get(&format!("{NOTE_PREFIX}{}", name_key(&made.path))).unwrap().as_deref(), Some(""));
    assert!(crate::activity::workspace_times(&s).contains_key(&crate::activity::key(&to)));
    // folder renaming off: the branch and the name still change, no folder is offered
    let mut settings = s.settings();
    settings[RENAME_FOLDERS_SETTING] = serde_json::json!(false);
    s.save_settings(&settings).unwrap();
    drop(s);
    let other = create_fresh_from(&git, &store, &project.id, None).unwrap();
    let b = rename_on_first_prompt(&git, &store, &other.path, "Write the docs", None).unwrap();
    assert!(b.renamed && b.folder.is_none(), "{b:?}");
    assert_eq!(b.name.as_deref(), Some("Write the docs"));
    assert!(Path::new(&other.path).is_dir());
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t110b_a_plain_folder_project_only_gets_a_title() {
    let profile = temp("profile-plain-title");
    let store = Store::open(&profile).unwrap();
    let plain = temp("plain-title");
    crate::folder_projects::add_folder(&store, &plain).unwrap();
    let git = Git::detect().unwrap();
    let store = Mutex::new(store);
    let a = rename_on_first_prompt(&git, &store, &plain.to_string_lossy(), "Sort the photos #4", None).unwrap();
    assert!(a.renamed && a.branch.is_none() && a.folder.is_none(), "{a:?}");
    assert_eq!(a.name.as_deref(), Some("Sort the photos"));
    assert!(plain.is_dir() && !plain.join(".git").exists(), "no Git was started, nothing moved");
    // once: the title it now has is its own
    let b = rename_on_first_prompt(&git, &store, &plain.to_string_lossy(), "do more", None).unwrap();
    assert!(!b.renamed, "{b:?}");
    // a project the user named is left alone
    let named = temp("plain-named");
    let p2 = crate::folder_projects::add_folder(&store.lock().unwrap(), &named).unwrap();
    set_display_name(&store.lock().unwrap(), &p2.id, "Mine").unwrap();
    let c = rename_on_first_prompt(&git, &store, &named.to_string_lossy(), "do things", None).unwrap();
    assert!(!c.renamed, "{c:?}");
    for d in [profile, plain, named] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn proj059_rename_trims_refuses_blank_and_lasts() {
    let dir = std::env::temp_dir().join(format!("kolux-rename-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let s = Store::open(&dir).unwrap();
    assert_eq!(rename(&s, "C:/r/wt", "  Login fix  ").unwrap(), "Login fix");
    assert!(rename(&s, "C:/r/wt", "   ").is_err(), "blank is refused");
    drop(s);
    let names = load_names(&Store::open(&dir).unwrap());
    assert_eq!(names.get(&name_key("C:/r/wt")).and_then(|v| v.as_str()), Some("Login fix"), "the old name survives the blank try and a restart");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn edit040_each_workspace_keeps_its_own_note_within_256_kb() {
    let profile = temp("note-profile");
    let store = Store::open(&profile).unwrap();
    assert_eq!(workspace_note(&store, "C:/ws/app/a"), Note::default(), "no note yet reads as empty");
    let at = save_workspace_note(&store, "C:/ws/app/a", "check the login flow").unwrap();
    let note = workspace_note(&store, "C:/ws/app/a");
    assert_eq!((note.text.as_str(), note.updated), ("check the login flow", Some(at)));
    assert_eq!(workspace_note(&store, "C:/ws/app/b"), Note::default(), "another worktree has its own, empty note");
    // A note over 256 KB is refused and the saved one is kept whole.
    assert!(save_workspace_note(&store, "C:/ws/app/a", &"x".repeat(NOTE_MAX + 1)).is_err());
    assert_eq!(workspace_note(&store, "C:/ws/app/a").text, "check the login flow");
    assert!(save_workspace_note(&store, "C:/ws/app/a", &"x".repeat(NOTE_MAX)).is_ok());
    // A damaged stored note reads as empty instead of failing.
    store.set(&format!("{NOTE_PREFIX}{}", name_key("C:/ws/app/c")), "{not json").unwrap();
    assert_eq!(workspace_note(&store, "C:/ws/app/c"), Note::default());
    // Forgetting a removed workspace forgets its note, so a new one in that folder starts empty.
    forget_workspace(&store, "C:/ws/app/a").unwrap();
    assert_eq!(workspace_note(&store, "C:/ws/app/a"), Note::default());
    drop(store);
    fs::remove_dir_all(profile).unwrap();
}
// ---- T-302 / PROJ-018: an icon from the repository

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-small-picture";

fn put(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, bytes).unwrap();
}

fn src_of(i: Option<AutoIcon>, kind: &str) -> String {
    let i = i.unwrap_or_else(|| panic!("an icon of kind {kind}"));
    assert_eq!(i.kind, kind, "{i:?}");
    i.src
}

#[test]
fn t302_a_small_favicon_in_the_repository_becomes_the_project_icon() {
    let repo = temp("t302-fav");
    put(&repo, "public/favicon.png", PNG);
    // a later place never beats an earlier one
    put(&repo, "icon.png", b"\x89PNG\r\n\x1a\nother");
    let src = src_of(auto_icon(&repo), "image");
    assert!(src.starts_with("data:image/png;base64,"), "{src}");
    use base64::Engine as _;
    let body = src.trim_start_matches("data:image/png;base64,");
    assert_eq!(base64::engine::general_purpose::STANDARD.decode(body).unwrap(), PNG);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn t302_places_are_tried_in_the_order_the_card_gives() {
    let repo = temp("t302-order");
    // 4th: a link in the page source; 3rd: a picture the manifest names; 2nd: an app bundle
    put(&repo, "index.html", b"<html><head><link rel=\"icon\" href=\"/img/page.png\"></head></html>");
    put(&repo, "img/page.png", PNG);
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"), "the page link is the last place before the avatar");
    put(&repo, "package.json", br#"{"homepage":"https://example.org/site/","icon":"img/manifest.png"}"#);
    put(&repo, "img/manifest.png", b"\x89PNG\r\n\x1a\nmanifest");
    let manifest = src_of(auto_icon(&repo), "image");
    assert!(manifest.starts_with("data:image/png"), "a picture the manifest names beats the page link");
    use base64::Engine as _;
    assert_eq!(base64::engine::general_purpose::STANDARD.decode(manifest.trim_start_matches("data:image/png;base64,")).unwrap(), b"\x89PNG\r\n\x1a\nmanifest");
    put(&repo, "src-tauri/icons/icon.png", PNG);
    let bundle = src_of(auto_icon(&repo), "image");
    assert_eq!(base64::engine::general_purpose::STANDARD.decode(bundle.trim_start_matches("data:image/png;base64,")).unwrap(), PNG, "an app bundle icon beats the manifest's picture");
    put(&repo, "favicon.ico", &[0, 0, 1, 0, 1, 0]);
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/x-icon"), "a favicon in the repository beats a bundle");
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn t302_icon_links_in_the_page_source_are_followed_inside_the_repository_only() {
    let repo = temp("t302-links");
    put(&repo, "public/index.html", b"<link rel='shortcut icon' href='logo.png'><link rel=\"stylesheet\" href=\"a.css\">");
    put(&repo, "public/logo.png", PNG);
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
    // a link that climbs out of the repository is not followed
    let repo2 = temp("t302-links2");
    // the picture sits where the link points: beside the repository, not in it
    let outside = repo2.parent().unwrap().join(format!("t302-secret-{}.png", std::process::id()));
    fs::write(&outside, PNG).unwrap();
    let climb = format!("../{}", outside.file_name().unwrap().to_string_lossy());
    put(&repo2, "index.html", format!("<link rel=\"icon\" href=\"{climb}\"><link rel=\"icon\" href=\"C:/x/secret.png\">").as_bytes());
    assert_eq!(auto_icon(&repo2), None);
    assert_eq!(repo_image(&repo2, &climb), None);
    assert_eq!(repo_image(&repo2, &climb.replace('/', "\\")), None);
    // a web address that is not plain https is not used
    put(&repo2, "index.html", b"<link rel=\"icon\" href=\"http://example.org/a.png\"><link rel=\"icon\" href=\"javascript:alert(1)\">");
    assert_eq!(auto_icon(&repo2), None);
    for d in [repo, repo2] {
        let _ = fs::remove_dir_all(d);
    }
    let _ = fs::remove_file(outside);
}

#[test]
fn t302_a_file_that_is_too_large_or_not_a_picture_is_passed_over() {
    let repo = temp("t302-big");
    let mut big = PNG.to_vec();
    big.resize(AUTO_ICON_FILE_MAX as usize + 1, 0);
    put(&repo, "favicon.png", &big);
    put(&repo, "public/favicon.ico", b"this is not a picture at all");
    assert_eq!(auto_icon(&repo), None, "both are passed over");
    // the next place is tried instead
    put(&repo, "icon.png", PNG);
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
    // exactly at the limit still counts
    let mut edge = PNG.to_vec();
    edge.resize(AUTO_ICON_FILE_MAX as usize, 0);
    let repo2 = temp("t302-edge");
    put(&repo2, "favicon.png", &edge);
    assert!(src_of(auto_icon(&repo2), "image").starts_with("data:image/png"));
    // an SVG is told by its text
    let repo3 = temp("t302-svg");
    put(&repo3, "favicon.svg", b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    assert!(src_of(auto_icon(&repo3), "image").starts_with("data:image/svg+xml"));
    for d in [repo, repo2, repo3] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn t302_no_icon_in_the_repository_shows_the_owners_avatar_or_the_folder_symbol() {
    let repo = temp_repo("t302-avatar");
    assert_eq!(auto_icon(&repo), None, "no remote: the folder symbol");
    git_in(&repo, &["remote", "add", "origin", "https://github.com/octo/widget.git"]);
    assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/octo.png");
    // a fork: the upstream owner's avatar wins
    git_in(&repo, &["remote", "add", "upstream", "git@github.com:original/widget.git"]);
    assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/original.png");
    // a fork that was renamed uses its own owner's avatar
    git_in(&repo, &["remote", "set-url", "origin", "https://github.com/octo/widget-fork.git"]);
    assert_eq!(src_of(auto_icon(&repo), "avatar"), "https://github.com/octo.png");
    // a host without a known avatar address gives the folder symbol
    git_in(&repo, &["remote", "remove", "upstream"]);
    git_in(&repo, &["remote", "set-url", "origin", "https://git.example.org/octo/widget.git"]);
    assert_eq!(auto_icon(&repo), None);
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn t302_remote_addresses_are_read_on_every_form_git_accepts_and_odd_ones_refused() {
    let want = Some(("github.com".to_string(), "o".to_string(), "r".to_string()));
    for url in ["https://github.com/o/r.git", "https://user@github.com/o/r", "git@github.com:o/r.git", "ssh://git@github.com/o/r.git", "https://GitHub.com/o/r/"] {
        assert_eq!(remote_parts(url), want, "{url}");
    }
    for url in ["", "https://github.com/o", "https://github.com/o/r/extra", "https://github.com/o%20x/r", "https://github.com/../r", "C:/some/folder"] {
        assert_eq!(remote_parts(url), None, "{url}");
    }
    assert_eq!(owner_avatar(Some("https://github.com/a b/r"), None), None);
}

// ---- FIX-4 (review of a771196e): what a repository may make the page load

#[test]
fn fix4_no_web_address_chosen_by_a_repository_file_is_ever_handed_to_the_page() {
    let repo = temp("fix4-nourl");
    put(&repo, "package.json", br#"{"homepage":"https://tracker.example.org/","icon":"https://tracker.example.org/logo.png"}"#);
    put(&repo, "index.html", b"<link rel=\"icon\" href=\"https://192.168.1.1/x.ico\"><link rel=\"icon\" href=\"https://localhost:8080/y.ico\">");
    assert_eq!(auto_icon(&repo), None, "package.json and the page source name web addresses; none may be handed over");
    // a local picture named beside them still works
    put(&repo, "icon.png", PNG);
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn fix4_only_the_hosting_sites_own_avatar_hosts_are_ever_returned() {
    let repo = temp_repo("fix4-hosts");
    git_in(&repo, &["remote", "add", "origin", "https://github.com/octo/widget.git"]);
    let src = src_of(auto_icon(&repo), "avatar");
    assert!(crate::github::avatar_ok(&src, "github.com"), "{src}");
    for host in ["evil.example", "github.com.evil.example", "127.0.0.1", "localhost"] {
        git_in(&repo, &["remote", "set-url", "origin", &format!("https://{host}/octo/widget.git")]);
        assert_eq!(auto_icon(&repo), None, "{host}");
    }
    assert_eq!(owner_avatar(Some("https://github.com/o/r"), None).as_deref(), Some("https://github.com/o.png"));
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn fix4_the_largest_accepted_file_still_fits_the_frontend_limit() {
    // the data URL a file makes is its base64 text plus the longest header (svg+xml)
    let url_len = |bytes: u64| (bytes.div_ceil(3) * 4) as usize + "data:image/svg+xml;base64,".len();
    assert!(url_len(AUTO_ICON_FILE_MAX) <= ICON_IMAGE_MAX, "a file of exactly AUTO_ICON_FILE_MAX bytes makes {} characters", url_len(AUTO_ICON_FILE_MAX));
    assert!(url_len(AUTO_ICON_FILE_MAX + 3) + 14 > ICON_IMAGE_MAX, "the limit keeps the frontend's 40-character header budget and no less");
    assert_eq!(AUTO_ICON_FILE_MAX, 49_122, "src/projects/projectIcon.ts AUTO_ICON_FILE_MAX is checked against this same figure");
    let mut edge = b"<svg ".to_vec();
    edge.resize(AUTO_ICON_FILE_MAX as usize, b' ');
    let repo = temp("fix4-edge");
    put(&repo, "favicon.svg", &edge);
    let src = src_of(auto_icon(&repo), "image");
    assert!(src.len() <= ICON_IMAGE_MAX, "{}", src.len());
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn fix4_the_launch_sweep_forgets_only_gone_worktrees_kolux_made_that_no_session_uses_in_every_project() {
    // forget_gone_at_start gathers the projects, origins and busy folders, then runs this
    let base = temp("fix4-launch");
    let (a, b) = (base.join("a"), base.join("b"));
    init_repo(&a);
    init_repo(&b);
    let git = Git::detect().unwrap();
    let store = Mutex::new(Store::open(&base.join("db")).unwrap());
    let add = |repo: &Path, name: &str| {
        let folder = base.join("ws").join(name);
        git_in(repo, &["worktree", "add", "-q", &folder.to_string_lossy(), "-b", name]);
        folder
    };
    let (a_made, a_mine, a_busy, b_made) = (add(&a, "a-made"), add(&a, "a-by-hand"), add(&a, "a-busy"), add(&b, "b-made"));
    let key = |p: &Path| p.to_string_lossy().to_string();
    {
        let s = store.lock().unwrap();
        for p in [&a_made, &a_busy, &b_made] {
            set_origin(&s, &key(p), Some(&serde_json::json!({"issue": 1}))).unwrap();
        }
    }
    for p in [&a_made, &a_mine, &a_busy, &b_made] {
        fs::remove_dir_all(p).unwrap();
    }
    let project = |id: &str, path: &Path| Project { id: id.into(), name: id.into(), path: key(path), workspaces_dir: None, base: None, display_name: None };
    let projects = [project("gone-folder", &base.join("nowhere")), project("a", &a), project("b", &b)];
    let origins = load_origins(&store.lock().unwrap());
    let mut forgotten = sweep_all_gone(&store, &git, &projects, &origins, &[key(&a_busy)], None);
    forgotten.sort();
    let mut want = vec![key(&a_made), key(&b_made)];
    want.sort();
    assert_eq!(forgotten, want, "both projects are swept; a folder Git cannot read is skipped; one made by hand or in use stays");
    let listed = |repo: &Path| git.worktrees(repo).unwrap().into_iter().map(|w| w.path).collect::<Vec<_>>();
    assert_eq!(listed(&a).len(), 3, "main, the one made by hand and the busy one: {:?}", listed(&a));
    assert_eq!(listed(&b).len(), 1);
    let _ = fs::remove_dir_all(&base);
}

/// A folder link from `link` to `target` (a junction on Windows, which needs no privilege).
fn link_dir(link: &Path, target: &Path) {
    #[cfg(windows)]
    let ok = Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
    #[cfg(not(windows))]
    let ok = std::os::unix::fs::symlink(target, link).is_ok();
    assert!(ok, "could not link {} to {}", link.display(), target.display());
}

#[test]
fn fix4_a_page_reached_through_a_link_out_of_the_repository_is_not_read() {
    let base = temp("fix4-link");
    let repo = base.join("repo");
    let outside = base.join("outside");
    put(&repo, "logo.png", PNG);
    put(&outside, "index.html", b"<link rel=\"icon\" href=\"/logo.png\">");
    put(&outside, "package.json", br#"{"icon":"logo.png"}"#);
    link_dir(&repo.join("public"), &outside);
    assert_eq!(repo_text(&repo, "public/index.html"), None, "read through a link that leaves the repository");
    assert_eq!(auto_icon(&repo), None, "the page outside the repository named logo.png; it must not be read at all");
    // the same page inside the repository is read
    put(&repo, "src/index.html", b"<link rel=\"icon\" href=\"/logo.png\">");
    assert!(src_of(auto_icon(&repo), "image").starts_with("data:image/png"));
    // a package.json that is itself outside through a link is not read either
    let repo2 = base.join("repo2");
    put(&repo2, "logo.png", PNG);
    link_dir(&repo2.join("sub"), &outside);
    assert_eq!(repo_text(&repo2, "sub/package.json"), None);
    assert!(repo_text(&outside, "package.json").is_some(), "the same file read in place is fine");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn fix4_the_avatar_of_a_parent_repository_is_not_this_projects_avatar() {
    let parent = temp_repo("fix4-parent");
    git_in(&parent, &["remote", "add", "origin", "https://github.com/octo/dotfiles.git"]);
    let inner = parent.join("notes").join("plain-folder");
    fs::create_dir_all(&inner).unwrap();
    assert_eq!(auto_icon(&inner), None, "a plain folder inside another repository has no owner of its own");
    // the repository's own top folder still shows the owner
    assert_eq!(src_of(auto_icon(&parent), "avatar"), "https://github.com/octo.png");
    // a repository nested inside it with its own remote shows its own owner
    let nested = parent.join("vendor").join("lib");
    init_repo(&nested);
    git_in(&nested, &["remote", "add", "origin", "https://github.com/other/lib.git"]);
    assert_eq!(src_of(auto_icon(&nested), "avatar"), "https://github.com/other.png");
    // a nested repository without a remote does not borrow the parent's
    let bare = parent.join("vendor").join("bare");
    init_repo(&bare);
    assert_eq!(auto_icon(&bare), None);
    let _ = fs::remove_dir_all(&parent);
}

#[test]
fn proj060_a_pasted_github_address_becomes_the_linked_item_and_a_bad_one_changes_nothing() {
    assert_eq!(parse_item("  ").unwrap(), None);
    assert_eq!(parse_item("#12").unwrap(), Some(ItemLink::Issue(12, None)));
    assert_eq!(parse_item("https://www.GitHub.com/acme/app/issues/34?x=1#top").unwrap(), Some(ItemLink::Issue(34, Some("https://github.com/acme/app/issues/34".into()))));
    assert_eq!(parse_item("https://git.corp.example/acme/app/pull/9/files").unwrap(), Some(ItemLink::Pr("https://git.corp.example/acme/app/pull/9".into())));
    assert!(parse_item("https://github.com/acme/app").is_err());
    assert!(parse_item("https://github.com/acme/app/pull/0").is_err());
    assert!(parse_item("not a link").is_err());
    assert!(parse_item("0").is_err());
    let profile = temp("proj060a");
    let store = Store::open(&profile).unwrap();
    let w = "C:\\ws\\one";
    let d = save_details(&store, w, "Login page", "https://github.com/acme/app/pull/12", "## Plan\nsee [spec](https://example.com)").unwrap();
    assert_eq!(d, Details { name: Some("Login page".into()), item: Some("https://github.com/acme/app/pull/12".into()), comment: "## Plan\nsee [spec](https://example.com)".into() });
    assert_eq!(item_number(&origin(&store, w).unwrap()), Some(12), "the sidebar's number reads the linked pull request");
    // a refused link writes nothing: the name and comment stay as saved
    assert!(save_details(&store, w, "Changed", "nonsense", "other").is_err());
    assert_eq!(details_of(&store, w), d);
    drop(store);
}

#[test]
fn proj060_blank_fields_clear_and_an_issue_replaces_a_pull_request() {
    let profile = temp("proj060b");
    let store = Store::open(&profile).unwrap();
    let w = "C:\\ws\\two";
    save_details(&store, w, "Named", "https://github.com/acme/app/pull/12", "note").unwrap();
    let d = save_details(&store, w, "  ", "https://github.com/acme/app/issues/5", "").unwrap();
    assert_eq!(d, Details { name: None, item: Some("https://github.com/acme/app/issues/5".into()), comment: String::new() });
    assert_eq!(item_number(&origin(&store, w).unwrap()), Some(5));
    let d = save_details(&store, w, "", "", "").unwrap();
    assert_eq!(d, Details::default());
    assert_eq!(item_number(&origin(&store, w).unwrap()), None);
    let long = "x".repeat(COMMENT_MAX + 1);
    assert!(save_details(&store, w, "n", "", &long).is_err());
    assert_eq!(details_of(&store, w).name, None, "an over-long comment writes nothing");
    drop(store);
}

/// T-780 (review, 2026-11-09): the details form keeps what it does not own: who made the
/// worktree (`madeBy`) and the sticky pull-request marker, whatever link it clears or sets,
/// and it never adds a `madeBy` to a record that has none.
#[test]
fn t780_save_details_keeps_made_by_and_the_sticky_pull_request_marker() {
    let profile = temp("t780-keep");
    let store = Store::open(&profile).unwrap();
    let w = "C:\\ws\\pr-made";
    // As open_pull_request records a worktree made from a pull request.
    set_origin(&store, w, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": false, "pr": "https://github.com/o/r/pull/12", PR_EVER_KEY: true }))).unwrap();
    save_details(&store, w, "Review", "", "unlinked").unwrap();
    let o = origin(&store, w).unwrap();
    assert_eq!((o["madeBy"].as_str(), o[PR_EVER_KEY].as_bool(), o["pr"].is_null(), o["existingBranch"].as_bool()), (Some("app"), Some(true), true, Some(false)), "{o}");
    save_details(&store, w, "Review", "#4", "").unwrap();
    let o = origin(&store, w).unwrap();
    assert_eq!((o["madeBy"].as_str(), o[PR_EVER_KEY].as_bool(), o["issue"].as_u64()), (Some("app"), Some(true), Some(4)), "{o}");
    // A record the details form starts itself has no maker and no marker.
    let u = "C:\\ws\\user-added";
    save_details(&store, u, "", "https://github.com/o/r/pull/3", "").unwrap();
    let o = origin(&store, u).unwrap();
    assert!(o.get("madeBy").is_none() && o.get(PR_EVER_KEY).is_none(), "{o}");
    drop(store);
}

/// T-780 (review P2-1): a record written before the sticky marker existed (`pr` set, no
/// marker) gets the marker when the details form clears or replaces its pull request, so the
/// unlink never restores the pre-trust.
#[test]
fn t780_unlinking_a_legacy_pull_request_record_marks_it_sticky() {
    let profile = temp("t780-legacy");
    let store = Mutex::new(Store::open(&profile).unwrap());
    let w = profile.join("legacy-pr").to_string_lossy().to_string();
    set_origin(&store.lock().unwrap(), &w, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": false, "pr": "https://github.com/o/r/pull/1" }))).unwrap();
    save_details(&store.lock().unwrap(), &w, "", "", "").unwrap();
    let o = origin(&store.lock().unwrap(), &w).unwrap();
    assert!(o["pr"].is_null() && o[PR_EVER_KEY] == true, "{o}");
    assert!(crate::trust::made_by_kolux(&store, &[PathBuf::from(&w)]).is_empty(), "a legacy pull request record stays out of the pre-trust after the unlink");
    // Replacing the pull request with an issue marks it too.
    let w2 = profile.join("legacy-pr-2").to_string_lossy().to_string();
    set_origin(&store.lock().unwrap(), &w2, Some(&serde_json::json!({ "madeBy": "app", "pr": "https://github.com/o/r/pull/2" }))).unwrap();
    save_details(&store.lock().unwrap(), &w2, "", "#9", "").unwrap();
    let o = origin(&store.lock().unwrap(), &w2).unwrap();
    assert!(o["pr"].is_null() && o["issue"] == 9 && o[PR_EVER_KEY] == true, "{o}");
    // A record that never held a pull request gets no marker from a details save.
    let w3 = profile.join("plain").to_string_lossy().to_string();
    set_origin(&store.lock().unwrap(), &w3, Some(&serde_json::json!({ "madeBy": "app", "pr": "" }))).unwrap();
    save_details(&store.lock().unwrap(), &w3, "", "", "").unwrap();
    assert!(origin(&store.lock().unwrap(), &w3).unwrap().get(PR_EVER_KEY).is_none(), "a blank pr is no pull request (round 4: the launch filter also wants a real checkout on origin, see trust::tests)");
    drop(store);
}

/// T-780 (round 3): a repo with an `origin` holding `main` and `ours`, and a `fork` remote
/// holding `theirs`, a commit found nowhere on origin. Returns (store, project, repo, root,
/// folders to remove).
fn t780_fixture(tag: &str) -> (Mutex<Store>, Project, PathBuf, PathBuf, Vec<PathBuf>) {
    let git = Git::detect().unwrap();
    let profile = temp(&format!("{tag}-profile"));
    let store = Store::open(&profile).unwrap();
    let origin_remote = temp(&format!("{tag}-origin"));
    git_in(&origin_remote, &["init", "-q", "--bare", "-b", "main"]);
    let fork = temp(&format!("{tag}-fork"));
    git_in(&fork, &["init", "-q", "--bare", "-b", "main"]);
    let repo = temp_repo(&format!("{tag}-repo"));
    git_in(&repo, &["remote", "add", "origin", &origin_remote.to_string_lossy()]);
    git_in(&repo, &["remote", "add", "fork", &fork.to_string_lossy()]);
    git_in(&repo, &["push", "-q", "origin", "main"]);
    git_in(&repo, &["branch", "ours"]);
    git_in(&repo, &["push", "-q", "origin", "ours"]);
    git_in(&repo, &["branch", "-D", "ours"]);
    // The stranger's branch carries a commit of its own, so its HEAD is on no origin branch.
    git_in(&repo, &["checkout", "-q", "-b", "theirs"]);
    fs::write(repo.join("theirs.txt"), "from a fork").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "a commit by a stranger"]);
    git_in(&repo, &["push", "-q", "fork", "theirs"]);
    git_in(&repo, &["checkout", "-q", "main"]);
    git_in(&repo, &["branch", "-D", "theirs"]);
    let root = temp(&format!("{tag}-root"));
    let mut settings = store.settings();
    settings["branchPrefix"] = serde_json::json!("none");
    settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
    store.save_settings(&settings).unwrap();
    let project = add_project(&git, &store, &repo).unwrap();
    (Mutex::new(store), project, repo, root.clone(), vec![profile, origin_remote, fork, root])
}

fn t780_record(store: &Mutex<Store>, path: &str) -> serde_json::Value {
    origin(&store.lock().unwrap(), path).expect("the worktree has a record")
}

fn t780_pre_trusted(store: &Mutex<Store>, path: &str) -> bool {
    crate::trust::made_by_kolux(store, &[PathBuf::from(path)]) == vec![PathBuf::from(path)]
}

/// T-780 (round 3, a): the composer's base is a local branch that tracks the fork (what a
/// `git checkout theirs` leaves behind). `workspace_create` comes through `create_named_until`;
/// `workspace_open_branch` through `open_named_until`. Both first records carry the marker.
#[test]
fn t780_a_base_that_is_a_local_branch_tracking_the_fork_is_never_pre_trusted() {
    let git = Git::detect().unwrap();
    let (store, project, repo, _root, cleanup) = t780_fixture("t780a");
    git_in(&repo, &["branch", "--track", "by-hand", "fork/theirs"]);
    assert_eq!(git.upstream_of(&repo, "by-hand").as_deref(), Some("fork/theirs"));
    let made = create_named(&git, &store, &project.id, "from by-hand", Some("by-hand"), None, None).unwrap();
    assert!(!made.own, "HEAD is the fork's commit, found on no origin branch");
    let rec = t780_record(&store, &made.worktree.path);
    assert_eq!((rec["madeBy"].as_str(), rec[PR_EVER_KEY].as_bool()), (Some("app"), Some(true)), "{rec}");
    assert!(!t780_pre_trusted(&store, &made.worktree.path), "a fork's code is never pre-trusted");
    // the branch opened as it is (Open branch in the composer)
    let (project2, place) = locked_place(&store, &project.id).unwrap();
    let opened = open_named_until(&git, &store, &project2, &place, "by-hand", Some("opened-by-hand"), &|| false).unwrap();
    assert!(!opened.own);
    assert_eq!(t780_record(&store, &opened.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &opened.worktree.path));
    // the fork's branch by its short name (Git makes the tracking branch itself)
    let short = open_named_until(&git, &store, &project2, &place, "theirs", None, &|| false).unwrap();
    assert_eq!(t780_record(&store, &short.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &short.worktree.path));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 3, b): the base names the fork's commit directly, by sha or as a rev expression
/// (`fork/theirs~0`), and so no ref name gives it away; the content check still marks it.
#[test]
fn t780_a_fork_commit_as_base_is_never_pre_trusted() {
    let git = Git::detect().unwrap();
    let (store, project, repo, _root, cleanup) = t780_fixture("t780b");
    let sha = rev(&repo, "fork/theirs");
    let by_sha = create_named(&git, &store, &project.id, "from sha", Some(&sha), None, None).unwrap();
    assert!(!by_sha.own);
    assert_eq!(t780_record(&store, &by_sha.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &by_sha.worktree.path));
    let by_rev = create_named(&git, &store, &project.id, "from rev", Some("fork/theirs~0"), None, None).unwrap();
    assert_eq!(t780_record(&store, &by_rev.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &by_rev.worktree.path));
    // the agent-first launch with a saved base (AUTO-005) goes the same way
    let fresh = create_fresh_from(&git, &store, &project.id, Some("fork/theirs")).unwrap();
    assert_eq!(t780_record(&store, &fresh.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &fresh.path));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 3, d): a checkout whose HEAD is on an origin branch is Kolux's own, however the
/// base was spelled: `origin/main`, the local `main`, no base at all (the agent-first launch),
/// an issue-linked record, or an existing origin branch opened as it is. No marker, pre-trusted.
#[test]
fn t780_a_checkout_on_origin_is_still_pre_trusted() {
    let git = Git::detect().unwrap();
    let (store, project, repo, _root, cleanup) = t780_fixture("t780d");
    let made = [
        create_named(&git, &store, &project.id, "from origin main", Some("origin/main"), None, None).unwrap().worktree.path,
        create_named(&git, &store, &project.id, "from local main", Some("main"), None, None).unwrap().worktree.path,
        create_named(&git, &store, &project.id, "linked", None, None, Some(serde_json::json!({ "madeBy": "app", "issue": 7, "issueUrl": "https://github.com/o/r/issues/7" }))).unwrap().worktree.path,
        create_fresh_from(&git, &store, &project.id, None).unwrap().path,
    ];
    for path in &made {
        let rec = t780_record(&store, path);
        assert_eq!(rec["madeBy"], "app", "{rec}");
        assert!(rec.get(PR_EVER_KEY).is_none(), "no marker on Kolux's own code: {rec}");
        assert!(t780_pre_trusted(&store, path), "{path}");
    }
    assert_eq!(t780_record(&store, &made[2])["issue"], 7, "the issue link rides in the first record");
    let (project2, place) = locked_place(&store, &project.id).unwrap();
    let ours = open_named_until(&git, &store, &project2, &place, "ours", None, &|| false).unwrap();
    assert!(ours.own);
    let rec = t780_record(&store, &ours.worktree.path);
    assert_eq!((rec["madeBy"].as_str(), rec["existingBranch"].as_bool(), rec.get(PR_EVER_KEY)), (Some("app"), Some(true), None), "{rec}");
    assert!(t780_pre_trusted(&store, &ours.worktree.path));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 3, e): without positive proof the worktree is marked: no `origin` remote at
/// all, a HEAD with a local commit no origin branch has yet, and `head_is_on_origin` itself on
/// a folder that is no git checkout (what a git error looks like).
#[test]
fn t780_without_proof_of_origin_the_worktree_is_marked() {
    let git = Git::detect().unwrap();
    // no origin remote
    let profile = temp("t780e-profile");
    let store = Store::open(&profile).unwrap();
    let repo = temp_repo("t780e-repo");
    let root = temp("t780e-root");
    let mut settings = store.settings();
    settings["branchPrefix"] = serde_json::json!("none");
    settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
    store.save_settings(&settings).unwrap();
    let project = add_project(&git, &store, &repo).unwrap();
    let store = Mutex::new(store);
    let made = create_named(&git, &store, &project.id, "no origin", None, None, None).unwrap();
    assert!(!made.own);
    let rec = t780_record(&store, &made.worktree.path);
    assert_eq!((rec["madeBy"].as_str(), rec[PR_EVER_KEY].as_bool()), (Some("app"), Some(true)), "{rec}");
    assert!(!t780_pre_trusted(&store, &made.worktree.path), "no origin: fail-safe");
    let fresh = create_fresh_from(&git, &store, &project.id, None).unwrap();
    assert_eq!(t780_record(&store, &fresh.path)[PR_EVER_KEY], true);
    assert!(!head_is_on_origin(&profile), "not a git folder: no proof");
    drop(store);
    for d in [profile, repo, root] {
        let _ = fs::remove_dir_all(d);
    }
    // an origin, but HEAD carries a commit origin does not have yet
    let (store, project, repo, _root, cleanup) = t780_fixture("t780e2");
    git_in(&repo, &["checkout", "-q", "-b", "ahead"]);
    fs::write(repo.join("local.txt"), "not pushed").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "local only"]);
    git_in(&repo, &["checkout", "-q", "main"]);
    assert!(head_is_on_origin(&repo), "main itself is on origin");
    let ahead = create_named(&git, &store, &project.id, "from ahead", Some("ahead"), None, None).unwrap();
    assert!(!ahead.own);
    assert!(!head_is_on_origin(Path::new(&ahead.worktree.path)));
    assert_eq!(t780_record(&store, &ahead.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &ahead.worktree.path), "accepted cost: unpushed work is not pre-trusted");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 3, f): the marker is in the first record written, never added by a second
/// write: `record_made` puts it into the one `set_origin` it makes; `note_seen` on its own
/// writes no record at all (so no `madeBy` ever exists without the marker); and `set_origin`
/// keeps the marker through every later rewrite of the record.
#[test]
fn t780_the_first_record_already_carries_the_marker() {
    let profile = temp("t780f");
    let store = Store::open(&profile).unwrap();
    let project = project_at("p780f", &profile);
    let wt = profile.join("wt").to_string_lossy().into_owned();
    let worktree = Worktree { name: None, branch: Some("x".into()), head: String::new(), is_main: false, path: wt.clone(), parent: None, locked: None, hidden: false, kind: String::new(), source: None, made_by: None, number: None, comment: None };
    // the seen mark alone leaves no record
    note_seen(&store, &project, &wt).unwrap();
    assert!(origin(&store, &wt).is_none(), "note_seen writes no madeBy");
    // the first and only write of a foreign worktree's record holds madeBy and the marker
    let foreign = Created { worktree: worktree.clone(), base: "x".into(), note: None, warnings: vec![], own: false };
    let before = store.get(ORIGINS_KEY).unwrap();
    record_made(&store, &project, &foreign, serde_json::json!({ "madeBy": "cli", "comment": "c" })).unwrap();
    let rec = origin(&store, &wt).unwrap();
    assert_eq!((rec["madeBy"].as_str(), rec["comment"].as_str(), rec[PR_EVER_KEY].as_bool()), (Some("cli"), Some("c"), Some(true)), "{rec}");
    assert_ne!(before, store.get(ORIGINS_KEY).unwrap());
    let store = Mutex::new(store);
    assert!(crate::trust::made_by_kolux(&store, &[PathBuf::from(&wt)]).is_empty());
    let store = store.into_inner().unwrap();
    // every rewrite keeps it: a bare madeBy, the details form
    set_origin(&store, &wt, Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
    assert_eq!(origin(&store, &wt).unwrap()[PR_EVER_KEY], true, "set_origin keeps the sticky marker");
    save_details(&store, &wt, "", "", "note").unwrap();
    assert_eq!(origin(&store, &wt).unwrap()[PR_EVER_KEY], true);
    // forgetting the workspace drops it; a new worktree at that path starts clean
    set_origin(&store, &wt, None).unwrap();
    let own = Created { worktree, base: "x".into(), note: None, warnings: vec![], own: true };
    record_made(&store, &project, &own, serde_json::json!({ "madeBy": "app" })).unwrap();
    let rec = origin(&store, &wt).unwrap();
    assert_eq!((rec["madeBy"].as_str(), rec.get(PR_EVER_KEY)), (Some("app"), None), "{rec}");
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

/// T-780 (round 4 review, P2): `remote.origin.fetch = +refs/pull/*/head:refs/remotes/origin/pr/*`
/// (a common setting) puts strangers' pull request heads under refs/remotes/origin/ too. Only a
/// ref written by a refspec that fetches origin's branches, and by no other refspec, is proof.
#[test]
fn t780_a_pull_request_head_fetched_under_origin_is_no_proof() {
    let git = Git::detect().unwrap();
    let (store, project, repo, _root, cleanup) = t780_fixture("t780pr");
    git_in(&repo, &["push", "-q", "origin", "fork/theirs:refs/pull/12/head"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/pull/*/head:refs/remotes/origin/pr/*"]);
    git_in(&repo, &["fetch", "-q", "origin"]);
    assert_eq!(rev(&repo, "origin/pr/12"), rev(&repo, "fork/theirs"));
    // what `git worktree add ../wt pr/12` leaves behind: a local pr/12 tracking origin/pr/12
    git_in(&repo, &["branch", "--track", "pr/12", "origin/pr/12"]);
    let (project2, place) = locked_place(&store, &project.id).unwrap();
    let opened = open_named_until(&git, &store, &project2, &place, "pr/12", Some("pr-12"), &|| false).unwrap();
    assert!(!opened.own, "a pull request head under refs/remotes/origin/pr/ is none of origin's branches");
    assert_eq!(t780_record(&store, &opened.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &opened.worktree.path));
    // `origin/pr/12` named as the base is refused before any checkout (`base_available` fetches
    // `origin pr/12`, a branch origin does not have); the head's commit id gets through, and is marked.
    let refused = create_named(&git, &store, &project.id, "from pr ref", Some("origin/pr/12"), None, None).unwrap_err();
    assert!(refused.contains("not a branch, tag or commit"), "{refused}");
    let based = create_named(&git, &store, &project.id, "from pr head", Some(&rev(&repo, "origin/pr/12")), None, None).unwrap();
    assert!(!based.own);
    assert_eq!(t780_record(&store, &based.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &based.worktree.path));
    // origin's own branch still proves itself beside the extra refspec
    let own = create_named(&git, &store, &project.id, "still own", Some("origin/main"), None, None).unwrap();
    assert!(own.own);
    assert!(t780_record(&store, &own.worktree.path).get(PR_EVER_KEY).is_none());
    assert!(t780_pre_trusted(&store, &own.worktree.path));
    // no refspec that fetches branches, or no refspec at all: no proof, whatever the refs say
    git_in(&repo, &["config", "--unset-all", "remote.origin.fetch"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/pull/*/head:refs/remotes/origin/pr/*"]);
    assert!(!head_is_on_origin(Path::new(&own.worktree.path)), "only a pull request refspec");
    git_in(&repo, &["config", "--unset-all", "remote.origin.fetch"]);
    assert!(!head_is_on_origin(Path::new(&own.worktree.path)), "no fetch refspec");
    // a refspec this code does not read (a destination outside refs/remotes/) is no proof either
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/heads/*:refs/mirror/origin/*"]);
    assert!(!head_is_on_origin(Path::new(&own.worktree.path)), "a destination outside refs/remotes/");
    // the usual refspec, plus a negative one and one without a destination: proof again
    git_in(&repo, &["config", "--unset-all", "remote.origin.fetch"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "^refs/heads/wip/*"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "refs/tags/v1"]);
    assert!(head_is_on_origin(Path::new(&own.worktree.path)));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 4 review, P3): a replacement ref (`git replace`) can make origin's tip read as
/// a descendant of a stranger's commit, which fools a plain `--contains`; the proof reads
/// objects as they are.
#[test]
fn t780_a_replaced_object_cannot_fake_the_proof() {
    let git = Git::detect().unwrap();
    let (store, project, repo, _root, cleanup) = t780_fixture("t780rp");
    let main_sha = rev(&repo, "origin/main");
    let theirs = rev(&repo, "fork/theirs");
    // a child of the stranger's commit, then origin/main's tip is told to read as that child
    git_in(&repo, &["checkout", "-q", "--detach", "fork/theirs"]);
    fs::write(repo.join("more.txt"), "more from the fork").unwrap();
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-q", "-m", "a second commit by a stranger"]);
    let child = rev(&repo, "HEAD");
    git_in(&repo, &["checkout", "-q", "main"]);
    git_in(&repo, &["replace", "-f", &main_sha, &child]);
    let fooled = String::from_utf8(Command::new("git").args(["for-each-ref", "--contains", &theirs, "--format=%(refname)", "refs/remotes/origin/"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    assert!(fooled.contains("refs/remotes/origin/main"), "the graft fools a plain --contains: {fooled:?}");
    let made = create_named(&git, &store, &project.id, "grafted", Some(&theirs), None, None).unwrap();
    assert!(!made.own, "the proof reads objects as they are, replacements aside");
    assert_eq!(t780_record(&store, &made.worktree.path)[PR_EVER_KEY], true);
    assert!(!t780_pre_trusted(&store, &made.worktree.path));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 4 review, P3): the carry-over keeps every marker shape `trust::holds_pull_request`
/// honours (present, not null, not false), not only the literal `true`.
#[test]
fn t780_set_origin_keeps_every_marker_shape_the_trust_check_honours() {
    let profile = temp("t780-shapes");
    let store = Store::open(&profile).unwrap();
    for (i, marker) in [serde_json::json!(true), serde_json::json!(1), serde_json::json!("yes"), serde_json::json!({})].into_iter().enumerate() {
        let w = format!("C:\\ws\\shape-{i}");
        set_origin(&store, &w, Some(&serde_json::json!({ "madeBy": "app", PR_EVER_KEY: marker }))).unwrap();
        set_origin(&store, &w, Some(&serde_json::json!({ "madeBy": "app", "comment": "rewritten" }))).unwrap();
        let rec = origin(&store, &w).unwrap();
        assert_eq!(rec[PR_EVER_KEY], true, "shape {i}: {rec}");
    }
    for (i, absent) in [serde_json::Value::Null, serde_json::json!(false)].into_iter().enumerate() {
        let w = format!("C:\\ws\\free-{i}");
        set_origin(&store, &w, Some(&serde_json::json!({ "madeBy": "app", PR_EVER_KEY: absent }))).unwrap();
        set_origin(&store, &w, Some(&serde_json::json!({ "madeBy": "app", "comment": "rewritten" }))).unwrap();
        let rec = origin(&store, &w).unwrap();
        assert!(rec.get(PR_EVER_KEY).is_none(), "shape {i}: {rec}");
    }
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

/// T-780 round 5 helper: a worktree detached at `at`, beside the fixture's repository.
fn t780_detached(repo: &Path, root: &Path, name: &str, at: &str) -> PathBuf {
    let wt = root.join(name);
    git_in(repo, &["worktree", "add", "-q", "--detach", &wt.to_string_lossy(), at]);
    wt
}

/// T-780 (round 5 review, P2): on NTFS a fetched pull request head lands in an existing folder of
/// another case: with origin's branch `PR/x` fetched first, `refs/remotes/origin/pr/12` is listed
/// as `refs/remotes/origin/PR/12`, which the branch destination covers and the pull destination
/// only covers ignoring case.
#[test]
fn t780_a_pull_request_head_in_a_folder_of_another_case_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780case");
    git_in(&repo, &["push", "-q", "origin", "main:PR/x"]);
    git_in(&repo, &["fetch", "-q", "origin"]);
    git_in(&repo, &["push", "-q", "origin", "fork/theirs:refs/pull/12/head"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/pull/*/head:refs/remotes/origin/pr/*"]);
    git_in(&repo, &["fetch", "-q", "origin"]);
    let theirs = rev(&repo, "fork/theirs");
    let listed = String::from_utf8(Command::new("git").args(["for-each-ref", "--contains", &theirs, "--format=%(refname)", "refs/remotes/origin/"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    #[cfg(windows)]
    assert!(listed.contains("refs/remotes/origin/PR/12"), "the pull head is listed in the branch folder's case: {listed:?}");
    let wt = t780_detached(&repo, &root, "case-wt", &theirs);
    assert!(!head_is_on_origin(&wt), "a pull request head is no proof in any case: {listed:?}");
    let own = t780_detached(&repo, &root, "case-own", "origin/main");
    assert!(head_is_on_origin(&own), "origin's branch still proves itself");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 5 review, P3): a symbolic ref is no proof of its own (`git remote set-head origin
/// pr/12` makes `refs/remotes/origin/HEAD` point at a pull request head); its target is listed itself.
#[test]
fn t780_a_symbolic_ref_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780sym");
    git_in(&repo, &["push", "-q", "origin", "fork/theirs:refs/pull/12/head"]);
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/pull/*/head:refs/remotes/origin/pr/*"]);
    git_in(&repo, &["fetch", "-q", "origin"]);
    git_in(&repo, &["remote", "set-head", "origin", "pr/12"]);
    let wt = t780_detached(&repo, &root, "sym-wt", &rev(&repo, "fork/theirs"));
    assert!(!head_is_on_origin(&wt), "refs/remotes/origin/HEAD -> pr/12 is no branch of origin's");
    git_in(&repo, &["remote", "set-head", "origin", "main"]);
    let own = t780_detached(&repo, &root, "sym-own", "origin/main");
    assert!(head_is_on_origin(&own), "origin/main itself still counts");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 5 review, P3): `info/grafts` rewrites parents even under `--no-replace-objects`;
/// while a graft file is in effect there is no proof at all.
#[test]
fn t780_a_graft_file_cannot_fake_the_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780gr");
    let (main_sha, theirs) = (rev(&repo, "origin/main"), rev(&repo, "fork/theirs"));
    let wt = t780_detached(&repo, &root, "graft-wt", &theirs);
    let own = t780_detached(&repo, &root, "graft-own", "origin/main");
    let grafts = repo.join(".git").join("info").join("grafts");
    fs::create_dir_all(grafts.parent().unwrap()).unwrap();
    fs::write(&grafts, format!("{main_sha} {theirs}\n")).unwrap();
    let fooled = String::from_utf8(Command::new("git").args(["--no-replace-objects", "for-each-ref", "--contains", &theirs, "--format=%(refname)", "refs/remotes/origin/"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    assert!(fooled.contains("refs/remotes/origin/main"), "the graft fools --no-replace-objects: {fooled:?}");
    assert!(!head_is_on_origin(&wt), "a graft makes no proof");
    assert!(!head_is_on_origin(&own), "accepted cost: no proof while a graft file is in effect");
    fs::remove_file(&grafts).unwrap();
    assert!(head_is_on_origin(&own));
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 (round 5 review, P3): HEAD on origin proves nothing while a merge, cherry-pick, revert or
/// rebase is under way: the working tree already holds the other side's files.
#[test]
fn t780_an_operation_in_progress_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780op");
    let wt = t780_detached(&repo, &root, "op-wt", "origin/main");
    assert!(head_is_on_origin(&wt));
    git_in(&wt, &["merge", "-q", "--no-commit", "--no-ff", "fork/theirs"]);
    assert!(wt.join("theirs.txt").exists(), "the fork's file is in the working tree");
    assert_eq!(rev(&wt, "HEAD"), rev(&repo, "origin/main"), "HEAD itself is still origin's");
    assert!(!head_is_on_origin(&wt), "a merge in progress is no proof");
    git_in(&wt, &["merge", "--abort"]);
    assert!(head_is_on_origin(&wt), "after the abort the proof holds again");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 gaps (A, 2026-11-09): on NTFS a second remote named `Origin` fetches into origin's own
/// folder (`refs/remotes/Origin/theirs` is read back as `refs/remotes/origin/theirs`). While a
/// remote named like origin in another case is configured there is no proof at all.
#[test]
fn t780_a_remote_named_origin_in_another_case_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780twin");
    git_in(&repo, &["remote", "add", "Origin", &cleanup[2].to_string_lossy()]);
    git_in(&repo, &["fetch", "-q", "Origin"]);
    let theirs = rev(&repo, "fork/theirs");
    let listed = String::from_utf8(Command::new("git").args(["for-each-ref", "--contains", &theirs, "--format=%(refname)", "refs/remotes/"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    #[cfg(windows)]
    assert!(listed.contains("refs/remotes/origin/theirs"), "the twin's ref lands in origin's folder: {listed:?}");
    let wt = t780_detached(&repo, &root, "twin-wt", &theirs);
    assert!(!head_is_on_origin(&wt), "a case twin of origin makes no proof: {listed:?}");
    let own = t780_detached(&repo, &root, "twin-own", "origin/main");
    assert!(!head_is_on_origin(&own), "accepted cost: no proof while the twin is configured");
    git_in(&repo, &["config", "--remove-section", "remote.Origin"]);
    assert!(head_is_on_origin(&own), "without the twin origin's branch proves itself again");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 gaps (A): another remote whose fetch refspec writes under `refs/remotes/origin/` (in any
/// case) is no proof; only that remote's destinations are left out, origin's branches still count.
#[test]
fn t780_another_remote_fetching_under_origin_is_no_proof() {
    for (tag, dst) in [("t780under", "refs/remotes/origin/fork/*"), ("t780under2", "refs/remotes/ORIGIN/up/*")] {
        let (store, _project, repo, root, cleanup) = t780_fixture(tag);
        git_in(&repo, &["config", "--replace-all", "remote.fork.fetch", &format!("+refs/heads/*:{dst}")]);
        git_in(&repo, &["fetch", "-q", "fork"]);
        let theirs = rev(&repo, "fork/theirs");
        assert_eq!(rev(&repo, &dst.replace('*', "theirs")), theirs, "{dst}");
        let wt = t780_detached(&repo, &root, "under-wt", &theirs);
        assert!(!head_is_on_origin(&wt), "{dst}: another remote's ref under origin is no proof");
        let own = t780_detached(&repo, &root, "under-own", "origin/main");
        assert!(head_is_on_origin(&own), "{dst}: origin/main itself still counts");
        drop(store);
        for d in cleanup.into_iter().chain([repo]) {
            let _ = fs::remove_dir_all(d);
        }
    }
}

/// T-780 gaps (B): `merge --squash` and `cherry-pick -n` put the fork's files in the working
/// tree with HEAD still on origin; their leftovers (`SQUASH_MSG`, `AUTO_MERGE`) refuse the proof.
/// `checkout <rev> -- .` leaves no marker and stays accepted (uncommitted content is not judged).
#[test]
fn t780_a_squash_or_a_picked_change_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780sq");
    for (name, args) in [("squash", ["merge", "-q", "--squash", "fork/theirs"]), ("pick", ["cherry-pick", "-n", "fork/theirs", ""])] {
        let args: Vec<&str> = args.into_iter().filter(|a| !a.is_empty()).collect();
        let wt = t780_detached(&repo, &root, &format!("{name}-wt"), "origin/main");
        assert!(head_is_on_origin(&wt), "{name}");
        git_in(&wt, &args);
        assert!(wt.join("theirs.txt").exists(), "{name}: the fork's file is in the working tree");
        assert_eq!(rev(&wt, "HEAD"), rev(&repo, "origin/main"), "{name}: HEAD itself is still origin's");
        assert!(!head_is_on_origin(&wt), "{name}: no proof");
        git_in(&wt, &["reset", "-q", "--hard"]);
        assert!(head_is_on_origin(&wt), "{name}: after a reset the proof holds again");
    }
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 gaps (C) helper: rewrites a SHA-1 commit-graph file so `child` claims `parent` as its
/// parent, with a generation above it. Git does not check the file's checksum on a normal read.
fn t780_forge_parent(graph: &Path, child: &str, parent: &str) {
    let b = fs::read(graph).unwrap();
    assert_eq!((&b[..4], b[5]), (&b"CGPH"[..], 1), "a SHA-1 commit-graph");
    let be32 = |at: usize| u32::from_be_bytes(b[at..at + 4].try_into().unwrap());
    let chunk = |id: &[u8]| (0..=b[6] as usize).map(|i| 8 + 12 * i).find(|&at| &b[at..at + 4] == id).map(|at| u64::from_be_bytes(b[at + 4..at + 12].try_into().unwrap()) as usize).expect("chunk");
    let (oidf, oidl, cdat) = (chunk(b"OIDF"), chunk(b"OIDL"), chunk(b"CDAT"));
    let count = be32(oidf + 255 * 4) as usize;
    let index = |sha: &str| (0..count).find(|i| b[oidl + 20 * i..oidl + 20 * i + 20].iter().map(|x| format!("{x:02x}")).collect::<String>() == sha).expect("in the graph");
    let (at, parent_index) = (cdat + 36 * index(child), index(parent) as u32);
    let level_and_date = (be32(at + 28) & 3) | (9 << 2);
    let mut forged = b.clone();
    forged[at + 20..at + 24].copy_from_slice(&parent_index.to_be_bytes());
    forged[at + 24..at + 28].copy_from_slice(&0x7000_0000u32.to_be_bytes());
    forged[at + 28..at + 32].copy_from_slice(&level_and_date.to_be_bytes());
    let mut perms = fs::metadata(graph).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    fs::set_permissions(graph, perms).unwrap();
    fs::write(graph, forged).unwrap();
}

/// T-780 gaps (legacy remotes, 2026-11-09): git still honours a remote defined by a file in the
/// common git dir's `remotes/` (or `branches/`) folder, outside the config, and its `Pull:` line
/// can write under `refs/remotes/origin/`. While either folder holds anything there is no proof.
#[test]
fn t780_a_legacy_remotes_file_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780legacy");
    let remotes = repo.join(".git").join("remotes");
    fs::create_dir_all(&remotes).unwrap();
    fs::write(remotes.join("legacy"), format!("URL: {}\nPull: refs/heads/*:refs/remotes/origin/*\n", cleanup[2].display())).unwrap();
    git_in(&repo, &["fetch", "-q", "legacy"]);
    let theirs = rev(&repo, "fork/theirs");
    assert_eq!(rev(&repo, "refs/remotes/origin/theirs"), theirs, "git honours the legacy remotes file");
    let wt = t780_detached(&repo, &root, "legacy-wt", &theirs);
    assert!(!head_is_on_origin(&wt), "a legacy remote's ref under origin is no proof");
    let own = t780_detached(&repo, &root, "legacy-own", "origin/main");
    assert!(!head_is_on_origin(&own), "accepted cost: no proof while a legacy remote file exists");
    fs::remove_file(remotes.join("legacy")).unwrap();
    assert!(head_is_on_origin(&own), "an empty remotes folder is no obstacle");
    let branches = repo.join(".git").join("branches");
    fs::create_dir_all(&branches).unwrap();
    fs::write(branches.join("legacy"), format!("{}#theirs\n", cleanup[2].display())).unwrap();
    assert!(!head_is_on_origin(&own), "a legacy branches file refuses the proof too");
    fs::remove_file(branches.join("legacy")).unwrap();
    assert!(head_is_on_origin(&own), "an empty branches folder is no obstacle");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 gaps (final round, P3-1b): with `extensions.worktreeConfig` on, a remote defined in the
/// main checkout's `config.worktree` is invisible to a linked worktree's config read, yet its
/// fetch writes the shared refs. Any `remote.*` key in any worktree's `config.worktree` refuses.
#[test]
fn t780_a_remote_in_another_worktrees_config_is_no_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780wtcfg");
    // The worktrees come first: `git worktree add` copies the current config.worktree.
    let theirs = rev(&repo, "fork/theirs");
    let wt = t780_detached(&repo, &root, "wtcfg-wt", &theirs);
    let own = t780_detached(&repo, &root, "wtcfg-own", "origin/main");
    git_in(&repo, &["config", "extensions.worktreeConfig", "true"]);
    git_in(&repo, &["config", "--worktree", "remote.wtfork.url", &cleanup[2].to_string_lossy()]);
    git_in(&repo, &["config", "--worktree", "remote.wtfork.fetch", "+refs/heads/*:refs/remotes/origin/wt/*"]);
    git_in(&repo, &["fetch", "-q", "wtfork"]);
    assert_eq!(rev(&repo, "refs/remotes/origin/wt/theirs"), theirs);
    let hidden = Command::new("git").args(["config", "--get-regexp", r"^remote\.wtfork\."]).current_dir(&wt).output().unwrap();
    assert!(!hidden.status.success(), "the linked worktree does not see the main checkout's remote");
    assert!(!head_is_on_origin(&wt), "a remote in another worktree's config makes no proof");
    assert!(!head_is_on_origin(&own), "accepted cost: no proof while any config.worktree holds a remote");
    git_in(&repo, &["config", "--worktree", "--remove-section", "remote.wtfork"]);
    assert!(head_is_on_origin(&own), "no remote left in a config.worktree");
    git_in(&wt, &["config", "--worktree", "remote.other.url", "https://example.invalid/x.git"]);
    assert!(!head_is_on_origin(&own), "a linked worktree's config.worktree counts too");
    git_in(&repo, &["config", "extensions.worktreeConfig", "false"]);
    assert!(head_is_on_origin(&own), "with the extension off git reads no config.worktree");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// T-780 gaps (final round, P3-3): a fetch destination that is not pure ASCII is refused, since
/// the case-folding comparison only folds ASCII; another remote's and origin's own alike.
#[test]
fn t780_a_destination_that_is_not_ascii_is_no_proof() {
    assert_eq!(foreign_destination("+refs/heads/*:refs/remotes/Fork/*"), Some(Some("refs/remotes/fork/*".to_string())));
    assert_eq!(foreign_destination("+refs/heads/*:refs/remotes/or\u{130}gin/*"), None);
    assert_eq!(foreign_destination("+refs/heads/*:refs/remotes/\u{212A}/*"), None);
    let repo = temp_repo("t780ascii");
    git_in(&repo, &["remote", "add", "origin", "https://example.invalid/o.git"]);
    assert!(origin_fetch_destinations(&repo).is_some());
    git_in(&repo, &["config", "--add", "remote.origin.fetch", "+refs/pull/*/head:refs/remotes/origin/pr\u{130}/*"]);
    assert!(origin_fetch_destinations(&repo).is_none(), "origin's own non-branch destination");
    git_in(&repo, &["config", "--unset", "remote.origin.fetch", "pull"]);
    assert!(origin_fetch_destinations(&repo).is_some());
    git_in(&repo, &["remote", "add", "fork", "https://example.invalid/f.git"]);
    git_in(&repo, &["config", "--replace-all", "remote.fork.fetch", "+refs/heads/*:refs/remotes/\u{130}/*"]);
    assert!(origin_fetch_destinations(&repo).is_none(), "another remote's destination");
    let _ = fs::remove_dir_all(repo);
}

/// T-780 gaps (C): a forged `objects/info/commit-graph` can make origin's tip claim a stranger's
/// commit as its parent for `--contains`; the proof reads commits with the graph switched off.
#[test]
fn t780_a_forged_commit_graph_cannot_fake_the_proof() {
    let (store, _project, repo, root, cleanup) = t780_fixture("t780cg");
    let (main_sha, theirs) = (rev(&repo, "origin/main"), rev(&repo, "fork/theirs"));
    let wt = t780_detached(&repo, &root, "cg-wt", &theirs);
    let own = t780_detached(&repo, &root, "cg-own", "origin/main");
    git_in(&repo, &["-c", "commitGraph.generationVersion=1", "commit-graph", "write", "--reachable"]);
    t780_forge_parent(&repo.join(".git").join("objects").join("info").join("commit-graph"), &main_sha, &theirs);
    let fooled = String::from_utf8(Command::new("git").args(["--no-replace-objects", "for-each-ref", "--contains", &theirs, "--format=%(refname)", "refs/remotes/origin/"]).current_dir(&repo).output().unwrap().stdout).unwrap();
    assert!(fooled.contains("refs/remotes/origin/main"), "the forged graph fools --contains: {fooled:?}");
    assert!(!head_is_on_origin(&wt), "a forged commit-graph makes no proof");
    assert!(head_is_on_origin(&own), "origin/main itself still counts");
    drop(store);
    for d in cleanup.into_iter().chain([repo]) {
        let _ = fs::remove_dir_all(d);
    }
}

/// after-list row 882: a refused read of the folder flags or the saved setup must not leave the
/// project removed with its flag and setup state orphaned; nothing changes and a retry finishes.
#[test]
fn row882_a_refused_flag_or_setup_read_leaves_the_project_listed() {
    let profile = temp("row882");
    let store = Store::open(&profile).unwrap();
    let project = project_at("p882", &profile);
    save_projects(&store, std::slice::from_ref(&project)).unwrap();
    store.set("folderProjects", "[1,2").unwrap(); // does not read, so it must be kept aside first
    crate::orchestration::kept::refuse_copies(&profile); // and the store refuses that copy
    assert!(forget_projects(&store, std::slice::from_ref(&project.id)).is_err());
    assert_eq!(load_projects(&store).len(), 1, "the project is still listed");
    assert_eq!(store.get("folderProjects").unwrap().as_deref(), Some("[1,2"), "the flags are untouched");
    let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
    conn.execute_batch("DROP TRIGGER no_copies;").unwrap();
    forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
    assert!(load_projects(&store).is_empty(), "a retry finishes the job");
    drop(conn);
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

/// Row 890: a write that fails after the project list's own save used to leave the list without
/// the project but its icon, folder flag or setup state behind. All of them land together or none.
#[test]
fn row890_a_failing_cleanup_write_leaves_the_project_listed_and_everything_else_untouched() {
    for (tag, key, value) in [("icon", "projectIcons", r#"{"p890":"icon:bug"}"#), ("folder", "folderProjects", r#"["p890"]"#), ("dismissed", "setupCardDismissed", r#"["p890","keep"]"#)] {
        let profile = temp(&format!("row890-{tag}"));
        let store = Store::open(&profile).unwrap();
        let project = project_at("p890", &profile);
        save_projects(&store, std::slice::from_ref(&project)).unwrap();
        store.set(key, value).unwrap();
        let before = store.get(PROJECTS_KEY).unwrap();
        let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
        conn.execute_batch(&format!("CREATE TRIGGER no_cleanup BEFORE UPDATE ON kv WHEN NEW.key = '{key}' BEGIN SELECT RAISE(ABORT, 'disk full'); END;")).unwrap();
        let err = forget_projects(&store, std::slice::from_ref(&project.id)).unwrap_err();
        assert!(err.contains("disk full"), "{tag}: {err}");
        assert_eq!(store.get(PROJECTS_KEY).unwrap(), before, "{tag}: the project is still listed, byte for byte");
        assert_eq!(store.get(key).unwrap().as_deref(), Some(value), "{tag}: the failing key is untouched");
        conn.execute_batch("DROP TRIGGER no_cleanup;").unwrap();
        forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
        assert!(load_projects(&store).is_empty(), "{tag}: a retry finishes the job");
        drop(conn);
        drop(store);
        let _ = fs::remove_dir_all(profile);
    }
}

/// The saved-setup half of row 882 (`prune_setup`): its key unreadable and the copy refused.
#[test]
fn row882_a_refused_setup_read_leaves_the_project_listed() {
    let profile = temp("row882-setup");
    let store = Store::open(&profile).unwrap();
    let project = project_at("p882s", &profile);
    save_projects(&store, std::slice::from_ref(&project)).unwrap();
    store.set("setupCardDismissed", r#"["keep"]"#).unwrap();
    store.set("localSetups", "{not json").unwrap();
    crate::orchestration::kept::refuse_copies(&profile);
    assert!(forget_projects(&store, std::slice::from_ref(&project.id)).is_err());
    assert_eq!(load_projects(&store).len(), 1, "the project is still listed");
    assert_eq!(store.get("localSetups").unwrap().as_deref(), Some("{not json"), "the saved setups are untouched");
    assert_eq!(store.get("setupCardDismissed").unwrap().as_deref(), Some(r#"["keep"]"#), "the dismissed list is untouched");
    let conn = rusqlite::Connection::open(profile.join("state.db")).unwrap();
    conn.execute_batch("DROP TRIGGER no_copies;").unwrap();
    forget_projects(&store, std::slice::from_ref(&project.id)).unwrap();
    assert!(load_projects(&store).is_empty(), "a retry finishes the job");
    assert_eq!(crate::orchestration::kept::asides(&store, "localSetups"), vec!["{not json".to_string()], "the unreadable blob was kept aside byte for byte on the retry");
    store.set("localSetups", "{}").unwrap();
    drop(conn);
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

/// after-list row 895: a project list that does not read must never be saved over by a
/// read-then-save (forget, add, edit); the blob stays byte for byte, or is kept aside first.
const BROKEN_LIST: &str = r#"[{"id":"keep-1","name":"keep","path":"C:/keep"},{"id":"keep-2","na"#;

fn broken_list_store(tag: &str, refuse_copy: bool) -> (Store, PathBuf) {
    let profile = temp(tag);
    let store = Store::open(&profile).unwrap();
    store.set("projects", BROKEN_LIST).unwrap();
    if refuse_copy {
        crate::orchestration::kept::refuse_copies(&profile);
    }
    (store, profile)
}

/// The wording kept::load returns when the copy cannot be made.
const NOT_KEPT_ASIDE: &str = "projects could not be kept aside";

#[test]
fn row895_forget_refuses_when_the_project_list_does_not_read_and_cannot_be_kept_aside() {
    let (store, profile) = broken_list_store("row895-forget", true);
    let err = forget_projects(&store, &["keep-1".to_string()]).unwrap_err();
    assert!(err.contains(NOT_KEPT_ASIDE) && err.contains("nothing was changed"), "{err}");
    assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST), "the list blob is byte for byte what it was");
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

#[test]
fn row895_forget_keeps_an_unreadable_list_aside_before_it_saves() {
    let (store, profile) = broken_list_store("row895-aside", false);
    forget_projects(&store, &["keep-1".to_string()]).unwrap();
    assert_eq!(crate::orchestration::kept::asides(&store, "projects"), vec![BROKEN_LIST.to_string()], "the unreadable list survives under a corrupt- name");
    assert_eq!(store.get("projects").unwrap().as_deref(), Some("[]"), "the key starts fresh once the copy is safe");
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

#[test]
fn row895_adding_a_project_refuses_rather_than_wiping_an_unreadable_list() {
    let (store, profile) = broken_list_store("row895-add", true);
    let repo = temp("row895-add-repo");
    let err = register_project(&store, (repo.clone(), repo.clone())).unwrap_err();
    assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
    assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST), "no one-project list replaced it");
    drop(store);
    let _ = fs::remove_dir_all(profile);
    let _ = fs::remove_dir_all(repo);
}

#[test]
fn row895_editing_a_project_refuses_rather_than_wiping_an_unreadable_list() {
    let (store, profile) = broken_list_store("row895-edit", true);
    let err = set_base(&store, "keep-1", Some("main")).unwrap_err();
    assert!(err.contains(NOT_KEPT_ASIDE), "an unreadable list is not 'no longer registered': {err}");
    let err = set_display_name(&store, "keep-1", "Shop").unwrap_err();
    assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
    assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST));
    drop(store);
    let _ = fs::remove_dir_all(profile);
}

#[test]
fn row895_setting_a_project_folder_and_base_refuses_rather_than_wiping_an_unreadable_list() {
    let (store, profile) = broken_list_store("row895-set", true);
    let err = set_project_options(&store, "keep-1", "D:/ws", "main").unwrap_err();
    assert!(err.contains(NOT_KEPT_ASIDE), "{err}");
    assert_eq!(store.get("projects").unwrap().as_deref(), Some(BROKEN_LIST));
    drop(store);
    let _ = fs::remove_dir_all(profile);
}
