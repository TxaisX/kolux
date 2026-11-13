//! PROJ-001: choosing folders adds exactly those as projects; an already-registered folder adds no row.
//! Needs `git`, `projects` and `state` public in lib.rs.

use kolux_lib::git::Git;
use kolux_lib::projects::{add_project, create_workspace, list_workspaces, load_projects, place_from, resolve_base, Place, Project};
use kolux_lib::state::Store;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-cards01-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn repo_in(parent: &Path, name: &str) -> PathBuf {
    let dir = parent.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    for args in [vec!["init", "-q"], vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]] {
        let ok = Command::new("git").args(&args).current_dir(&dir).status().unwrap().success();
        assert!(ok, "git {args:?}");
    }
    dir
}

fn paths(store: &Store) -> Vec<String> {
    load_projects(store).into_iter().map(|p| p.path).collect()
}

fn same(a: &str, b: &Path) -> bool {
    a.replace('\\', "/").trim_end_matches('/').eq_ignore_ascii_case(b.to_string_lossy().replace('\\', "/").trim_end_matches('/'))
}

#[test]
fn two_chosen_sibling_repositories_become_exactly_two_projects_and_nothing_else() {
    let git = Git::detect().unwrap();
    let profile = scratch("profile1");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("siblings");
    let a = repo_in(&parent, "alpha");
    let b = repo_in(&parent, "beta");
    // Not chosen, and must stay out: a third repository beside them, and one inside a chosen folder.
    let _other = repo_in(&parent, "gamma");
    let _inner = repo_in(&a, "inner-repo");
    assert!(load_projects(&store).is_empty());
    for chosen in [&a, &b] {
        add_project(&git, &store, chosen).unwrap();
    }
    let got = paths(&store);
    assert_eq!(got.len(), 2, "exactly two projects: {got:?}");
    assert!(same(&got[0], &b) && same(&got[1], &a), "newest first, only the two chosen: {got:?}");
    assert!(!got.iter().any(|p| p.to_lowercase().contains("gamma") || p.to_lowercase().contains("inner-repo")));
    drop(store);
    for d in [profile, parent] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn choosing_a_folder_that_is_registered_already_adds_no_second_row() {
    let git = Git::detect().unwrap();
    let profile = scratch("profile2");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("dup");
    let a = repo_in(&parent, "alpha");
    let first = add_project(&git, &store, &a).unwrap();
    assert_eq!(paths(&store).len(), 1);
    let again = add_project(&git, &store, &a).unwrap();
    assert_eq!(again, first, "the same project comes back");
    assert_eq!(paths(&store).len(), 1, "no second row after choosing it again");
    // The same folder spelled another way (trailing separator) is the same project too.
    let spelled = PathBuf::from(format!("{}{}", a.display(), std::path::MAIN_SEPARATOR));
    assert_eq!(add_project(&git, &store, &spelled).unwrap(), first);
    // On Windows the comparison ignores letter case.
    #[cfg(windows)]
    {
        let shout = PathBuf::from(a.to_string_lossy().to_uppercase());
        assert_eq!(add_project(&git, &store, &shout).unwrap(), first);
    }
    assert_eq!(paths(&store).len(), 1);
    drop(store);
    for d in [profile, parent] {
        let _ = std::fs::remove_dir_all(d);
    }
}

/// PROJ-025: a repository folder named `name` under `parent`, added as a project.
fn project_in(git: &Git, store: &Store, parent: &Path, name: &str) -> Project {
    add_project(git, store, &repo_in(parent, name)).unwrap()
}

fn made_at(project: &Project, place_settings: &serde_json::Value, name: &str, git: &Git) -> String {
    let place = place_from(project, place_settings);
    create_workspace(git, &place, project, name, None).unwrap().worktree.path
}

#[test]
fn proj025_box1_a_folder_elsewhere_with_nesting_on_puts_a_inside_app_there() {
    let git = Git::detect().unwrap();
    let profile = scratch("p25a-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p25a-repos");
    let elsewhere = scratch("p25a-elsewhere");
    let app = project_in(&git, &store, &parent, "app");
    // The folder is absolute and outside the project, so it is used as it is, not joined to the project root.
    assert!(elsewhere.is_absolute() && !elsewhere.starts_with(&parent));
    let settings = serde_json::json!({ "workspacesDir": elsewhere.to_string_lossy(), "workspacesLayout": "nested" });
    let path = made_at(&app, &settings, "a", &git);
    assert!(same(&path, &elsewhere.join("app").join("a")), "{path}");
    assert!(Path::new(&path).join(".git").exists(), "a real checkout is there");
    assert!(!parent.join("app").join("a").exists(), "nothing was made beside the project");
    // A folder named on another drive replaces the project root outright (no drive of the project survives).
    #[cfg(windows)]
    {
        let far = Project { id: "far".into(), name: "app".into(), path: "C:\\repos\\app".into(), workspaces_dir: None, base: None, display_name: None };
        let place = place_from(&far, &serde_json::json!({ "workspacesDir": "D:\\ws", "workspacesLayout": "nested" }));
        assert_eq!(kolux_lib::projects::workspace_path(&place, &far, "a"), PathBuf::from("D:\\ws\\app\\a"));
    }
    remove_workspace(&git, &app, &path, false).unwrap();
    drop(store);
    for d in [profile, parent, elsewhere] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn proj025_box2_a_folder_set_for_one_project_leaves_the_others_on_the_global_folder() {
    let git = Git::detect().unwrap();
    let profile = scratch("p25b-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p25b-repos");
    let (global, own) = (scratch("p25b-global"), scratch("p25b-own"));
    let mut app = project_in(&git, &store, &parent, "app");
    let web = project_in(&git, &store, &parent, "web");
    app.workspaces_dir = Some(own.to_string_lossy().into_owned());
    let settings = serde_json::json!({ "workspacesDir": global.to_string_lossy() });
    let (in_app, in_web) = (made_at(&app, &settings, "a", &git), made_at(&web, &settings, "a", &git));
    assert!(same(&in_app, &own.join("app").join("a")), "app's own folder: {in_app}");
    assert!(same(&in_web, &global.join("web").join("a")), "web keeps the global folder: {in_web}");
    assert!(!global.join("app").exists() && !own.join("web").exists(), "neither crossed over");
    remove_workspace(&git, &app, &in_app, false).unwrap();
    remove_workspace(&git, &web, &in_web, false).unwrap();
    drop(store);
    for d in [profile, parent, global, own] {
        let _ = std::fs::remove_dir_all(d);
    }
}

fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t"]).args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A local "remote" (bare, no network) with `main` and `dev` pushed, and a clone of it that is the project.
fn cloned_project(git: &Git, store: &Store, parent: &Path) -> (PathBuf, PathBuf, Project) {
    let seed = repo_in(parent, "seed");
    git_out(&seed, &["branch", "-M", "main"]);
    git_out(&seed, &["branch", "dev"]);
    let remote = parent.join("origin.git");
    git_out(parent, &["init", "-q", "--bare", remote.to_str().unwrap()]);
    git_out(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    git_out(&seed, &["push", "-q", remote.to_str().unwrap(), "main", "dev"]);
    let work = parent.join("work");
    git_out(parent, &["clone", "-q", remote.to_str().unwrap(), work.to_str().unwrap()]);
    git_out(&work, &["remote", "set-head", "origin", "main"]);
    let project = add_project(git, store, &work).unwrap();
    (remote, work, project)
}

fn nested_at(root: &Path) -> Place {
    place_from(&Project { id: "x".into(), name: "work".into(), path: root.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None }, &serde_json::json!({ "workspacesDir": root.to_string_lossy() }))
}

#[test]
fn proj028_box1_a_saved_base_deleted_on_the_remote_falls_back_to_the_default_with_a_notice() {
    let git = Git::detect().unwrap();
    let profile = scratch("p28a-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p28a-repos");
    let root = scratch("p28a-root");
    let (remote, work, mut project) = cloned_project(&git, &store, &parent);
    project.base = Some("origin/dev".into());
    // Control: while the remote still has it, the saved base is used and there is no notice.
    assert_eq!(resolve_base(&git, &work, &project, None).unwrap(), ("origin/dev".to_string(), None));
    // The saved base branch is deleted on the remote.
    git_out(&remote, &["branch", "-D", "dev"]);
    let (base, note) = resolve_base(&git, &work, &project, None).unwrap();
    assert_eq!(base, "origin/main", "the default branch Kolux detects: origin's HEAD");
    let note = note.expect("a fallback notice");
    assert!(note.contains("origin/dev") && note.contains("no longer exists") && note.contains("started from origin/main"), "{note}");
    // And the created workspace really begins at the default branch, carrying the same notice.
    let made = create_workspace(&git, &nested_at(&root), &project, "after-delete", None).unwrap();
    assert_eq!((made.base.as_str(), made.note.as_deref()), ("origin/main", Some(note.as_str())));
    assert_eq!(git_out(Path::new(&made.worktree.path), &["rev-parse", "HEAD"]), git_out(&work, &["rev-parse", "origin/main"]));
    remove_workspace(&git, &project, &made.worktree.path, false).unwrap();
    drop(store);
    for d in [profile, parent, root] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn proj028_box2_a_full_commit_id_as_the_start_is_used_directly_with_no_fetch() {
    let git = Git::detect().unwrap();
    let profile = scratch("p28b-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p28b-repos");
    let root = scratch("p28b-root");
    let (remote, work, project) = cloned_project(&git, &store, &parent);
    let id = git_out(&work, &["rev-parse", "HEAD"]);
    assert_eq!(id.len(), 40);
    // The remote moves on; a fetch would bring origin/main forward and leave a FETCH_HEAD file.
    let pusher = parent.join("pusher");
    git_out(&parent, &["clone", "-q", remote.to_str().unwrap(), pusher.to_str().unwrap()]);
    git_out(&pusher, &["commit", "-q", "--allow-empty", "-m", "newer"]);
    git_out(&pusher, &["push", "-q", "origin", "main"]);
    let (fetch_head, origin_main) = (work.join(".git").join("FETCH_HEAD"), || git_out(&work, &["rev-parse", "origin/main"]));
    let before = origin_main();
    let _ = std::fs::remove_file(&fetch_head);
    let made = create_workspace(&git, &nested_at(&root), &project, "at-commit", Some(&id)).unwrap();
    assert_eq!((made.base.as_str(), made.note.as_deref()), (id.as_str(), None));
    assert_eq!(git_out(Path::new(&made.worktree.path), &["rev-parse", "HEAD"]), id, "the workspace starts at that commit");
    assert!(!fetch_head.exists(), "no fetch ran");
    assert_eq!(origin_main(), before, "origin/main did not move");
    // Control: a branch that tracks the remote is fetched first, so the same checks would have caught a fetch.
    resolve_base(&git, &work, &project, Some("origin/main")).unwrap();
    assert!(fetch_head.exists() && origin_main() != before, "the control fetch is visible");
    remove_workspace(&git, &project, &made.worktree.path, false).unwrap();
    drop(store);
    for d in [profile, parent, root] {
        let _ = std::fs::remove_dir_all(d);
    }
}

/// Test cleanup: the crate's own remove is test-only, so Git is asked directly.
fn remove_workspace(_git: &Git, project: &Project, path: &str, _force: bool) -> Result<(), String> {
    let out = Command::new("git").args(["worktree", "remove", "--force", path]).current_dir(&project.path).output().map_err(|e| e.to_string())?;
    out.status.success().then_some(()).ok_or_else(|| String::from_utf8_lossy(&out.stderr).into_owned())
}

#[test]
fn proj045_box2_the_group_by_choice_patched_into_the_settings_is_still_there_after_a_reopen() {
    use kolux_lib::state::patched;
    let profile = scratch("p45-profile");
    for choice in ["none", "project", "status", "pr"] {
        {
            let store = Store::open(&profile).unwrap();
            // settings_patch: the keys the window changed laid over what is on disk
            let set = serde_json::Map::from_iter([("workspaceGroupBy".to_string(), serde_json::json!(choice))]);
            store.save_settings(&patched(store.settings(), &set, &[])).unwrap();
        }
        let reopened = Store::open(&profile).unwrap();
        assert_eq!(reopened.settings()["workspaceGroupBy"], serde_json::json!(choice));
    }
    let _ = std::fs::remove_dir_all(profile);
}

// ---- PROJ-077: the command line, from the words typed to the answer printed.
use kolux_lib::cli::{dispatch, envelope, parse, Ctx, Request};
use kolux_lib::terminal::Terminals;
use serde_json::{json, Value};
use std::sync::Mutex;

/// A stand-in `claude` program on PATH so the agent counts as installed; nothing ever runs it.
fn fake_claude_on_path(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    let file = dir.join(if cfg!(windows) { "claude.cmd" } else { "claude" });
    std::fs::write(&file, "echo stand-in\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    let joined = std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&path))).unwrap();
    std::env::set_var("PATH", joined);
}

struct Cli {
    repo: PathBuf,
    store: Mutex<Store>,
    git: Git,
    events: Mutex<Vec<Value>>,
    claude_config: PathBuf,
}

impl Cli {
    /// Types `line` as the command line would: parse, send to the app, wrap the answer in the `--json` envelope.
    fn run(&self, line: &str) -> Value {
        let words: Vec<String> = line.split_whitespace().map(String::from).collect();
        let (json_flag, parsed) = parse(&words);
        let parsed = parsed.unwrap().unwrap();
        let req = Request { id: "r".into(), token: String::new(), command: parsed.command, cwd: self.repo.display().to_string(), args: Value::Object(parsed.args), pane: None, cli: String::new(), arrived: None };
        let notify = |v: Value| self.events.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: self.claude_config.clone(), git: &self.git, store: &self.store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        assert!(json_flag, "--json was typed: {line}");
        envelope("r", "cards", dispatch(&ctx, &req))
    }
}

fn cli_in(tag: &str) -> (Cli, PathBuf) {
    let dir = scratch(tag);
    let repo = repo_in(&dir, "repo");
    git_out(&repo, &["branch", "-M", "main"]);
    let git = Git::detect().unwrap();
    let store = Store::open(&dir.join("data")).unwrap();
    add_project(&git, &store, &repo).unwrap();
    let mut settings = store.settings();
    settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
    settings["branchPrefix"] = json!("none");
    store.save_settings(&settings).unwrap();
    (Cli { repo, store: Mutex::new(store), git, events: Mutex::new(Vec::new()), claude_config: dir.join(".claude.json") }, dir)
}

#[test]
fn proj077_box1_create_with_name_agent_prompt_and_json_answers_with_the_folder_and_rm_by_name_removes_it() {
    fake_claude_on_path(&scratch("p77a-bin"));
    let (cli, dir) = cli_in("p77a");
    let made = cli.run("worktree create --name zebra --agent claude --prompt hello --json");
    assert_eq!(made["success"], true, "{made}");
    let path = PathBuf::from(made["result"]["path"].as_str().expect("the JSON includes the new folder path"));
    assert!(path.join(".git").exists(), "{}", path.display());
    assert!(same(&path.to_string_lossy(), &dir.join("ws").join("repo").join("zebra")), "{}", path.display());
    assert_eq!((made["result"]["branch"].as_str(), made["result"]["agent"].as_str()), (Some("zebra"), Some("claude")));
    let told = cli.events.lock().unwrap().last().cloned().unwrap();
    assert_eq!((told["kind"].as_str(), told["agent"].as_str(), told["prompt"].as_str()), (Some("created"), Some("claude"), Some("hello")), "the window is told to start the agent on the prompt");
    let gone = cli.run("worktree rm --worktree name:zebra --json");
    assert_eq!(gone["success"], true, "{gone}");
    assert!(!path.exists(), "the folder is gone");
    assert!(!cli.run("worktree list --json")["result"].to_string().contains("zebra"), "and it no longer lists");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn proj077_box2_create_with_setup_skipped_tells_the_window_to_skip_while_run_and_default_do_not() {
    let (cli, dir) = cli_in("p77b");
    for (flag, want) in [("--setup skip", "skip"), ("--setup run", "run"), ("", "inherit")] {
        let name = format!("setup-{want}");
        let made = cli.run(&format!("worktree create --name {name} {flag} --json"));
        assert_eq!(made["success"], true, "{made}");
        assert_eq!(made["result"]["setup"], want);
        let told = cli.events.lock().unwrap().last().cloned().unwrap();
        assert_eq!((told["kind"].as_str(), told["setup"].as_str()), (Some("created"), Some(want)));
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn proj063_box2_backend_half_a_branch_switched_inside_the_workspace_folder_lists_under_the_new_branch() {
    let git = Git::detect().unwrap();
    let profile = scratch("p63-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p63-repos");
    let root = scratch("p63-root");
    let (_remote, _work, project) = cloned_project(&git, &store, &parent);
    let made = create_workspace(&git, &nested_at(&root), &project, "feature", None).unwrap();
    let folder = PathBuf::from(&made.worktree.path);
    let branch_of = |path: &str| list_workspaces(&git, &store, &project).unwrap().into_iter().find(|w| same(&w.path, Path::new(path))).and_then(|w| w.branch);
    assert!(branch_of(&made.worktree.path).is_some_and(|b| b.ends_with("feature")));
    git_out(&folder, &["switch", "-c", "elsewhere"]);
    assert_eq!(branch_of(&made.worktree.path).as_deref(), Some("elsewhere"), "the next listing reads the folder's branch afresh");
    drop(store);
    for d in [profile, parent, root] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn proj070_box1_a_workspace_with_an_unsaved_change_lists_it_and_a_delete_without_force_is_refused() {
    use kolux_lib::projects::{remove_check, removal_refused};
    let git = Git::detect().unwrap();
    let profile = scratch("p70-profile");
    let store = Store::open(&profile).unwrap();
    let parent = scratch("p70-repos");
    let root = scratch("p70-root");
    let (_remote, _work, project) = cloned_project(&git, &store, &parent);
    let ws = create_workspace(&git, &nested_at(&root), &project, "unsaved", None).unwrap().worktree.path;
    let clean = remove_check(&git, &project, &ws).unwrap();
    assert!(clean.changes.is_empty());
    std::fs::write(Path::new(&ws).join("scratch.txt"), "not committed").unwrap();
    let asked = remove_check(&git, &project, &ws).unwrap();
    assert_eq!(asked.changes, vec!["?? scratch.txt".to_string()], "the question has the change to warn about");
    let refusal = removal_refused(&asked, false, &asked.stamp).expect("confirming without force is refused");
    assert!(refusal.contains("1 uncommitted or untracked change would be lost"), "{refusal}");
    assert!(Path::new(&ws).join("scratch.txt").exists(), "nothing was deleted");
    assert_eq!(removal_refused(&asked, true, &asked.stamp), None, "only the force box lets it through");
    drop(store);
    for d in [profile, parent, root] {
        let _ = std::fs::remove_dir_all(d);
    }
}
