//! SESS-001: which agents count as installed. Needs `agents` public in lib.rs.
//! The scenarios change the process environment, so they run one at a time. The shell search path
//! Kolux reads from the registry (Windows) is the real one; every scenario therefore compares
//! against a baseline taken under the same environment before it adds anything.

use kolux_lib::agents::{catalogue, AgentInfo};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static ENV: Mutex<()> = Mutex::new(());

const VARS: [&str; 7] = ["PATH", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "NVM_SYMLINK", "NVM_HOME"];

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-cards02-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Runs `body` with PATH and the home folders pointed into scratch folders, then puts them back.
fn with_env(path_dir: &Path, home: &Path, body: impl FnOnce()) {
    let _lock = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let saved: Vec<_> = VARS.iter().map(|v| (*v, std::env::var_os(v))).collect();
    std::env::set_var("PATH", path_dir);
    for v in ["USERPROFILE", "HOME"] {
        std::env::set_var(v, home);
    }
    std::env::set_var("APPDATA", home.join("AppData").join("Roaming"));
    std::env::set_var("LOCALAPPDATA", home.join("AppData").join("Local"));
    std::env::remove_var("NVM_SYMLINK");
    std::env::remove_var("NVM_HOME");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
    for (v, old) in saved {
        match old {
            Some(o) => std::env::set_var(v, o),
            None => std::env::remove_var(v),
        }
    }
    if let Err(p) = outcome {
        std::panic::resume_unwind(p);
    }
}

fn homes(tag: &str) -> (PathBuf, PathBuf) {
    let home = scratch(&format!("{tag}-home"));
    std::fs::create_dir_all(home.join("AppData").join("Roaming")).unwrap();
    std::fs::create_dir_all(home.join("AppData").join("Local")).unwrap();
    (scratch(&format!("{tag}-empty")), home)
}

/// A runnable file for `program` in `dir`: `.exe` on Windows, an executable file elsewhere.
fn put_program(dir: &Path, program: &str) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let file = dir.join(if cfg!(windows) { format!("{program}.exe") } else { program.to_string() });
    std::fs::write(&file, b"stand-in").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    file
}

/// `n` agents that are missing in `base`, the preferred ids first; programs without a dot, all different.
fn missing(base: &[AgentInfo], prefer: &[&str], n: usize) -> Vec<AgentInfo> {
    let mut pool: Vec<&AgentInfo> = base.iter().filter(|a| !a.installed && !a.program.contains('.')).collect();
    pool.sort_by_key(|a| prefer.iter().position(|p| *p == a.id).unwrap_or(usize::MAX));
    let mut out: Vec<AgentInfo> = Vec::new();
    for a in pool {
        if out.len() < n && out.iter().all(|o| o.program != a.program) {
            out.push(a.clone());
        }
    }
    assert_eq!(out.len(), n, "not enough agents missing on this machine");
    out
}

fn installed_ids(list: &[AgentInfo]) -> Vec<String> {
    list.iter().filter(|a| a.installed).map(|a| a.id.clone()).collect()
}

#[test]
fn sess001_box1_putting_two_agents_on_the_path_makes_exactly_those_two_installed() {
    let (empty, home) = homes("b1");
    let bin = scratch("b1-bin");
    with_env(&empty, &home, || {
        let base = catalogue();
        assert_eq!(base.len(), 35, "the catalogue lists 35 agents (the 34 of SESS-001 and OpenCode, T-572)");
        let two = missing(&base, &["claude", "codex"], 2);
        for a in &two {
            put_program(&bin, &a.program);
        }
        std::env::set_var("PATH", &bin);
        let after = catalogue();
        let mut added: Vec<String> = installed_ids(&after).into_iter().filter(|id| !installed_ids(&base).contains(id)).collect();
        added.sort();
        let mut wanted: Vec<String> = two.iter().map(|a| a.id.clone()).collect();
        wanted.sort();
        assert_eq!(added, wanted, "exactly the two agents that were put there became installed");
        for a in &two {
            let got = after.iter().find(|x| x.id == a.id).unwrap();
            assert!(got.installed && got.path.as_deref().is_some_and(|p| Path::new(p).starts_with(&bin)), "{got:?}");
        }
        assert_eq!(after.iter().filter(|x| x.installed).count(), installed_ids(&base).len() + 2);
    });
    for d in [empty, home, bin] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn sess001_box2_an_agent_only_in_the_default_install_folder_is_found_with_a_path_that_lacks_it() {
    let (empty, home) = homes("b2");
    with_env(&empty, &home, || {
        let base = catalogue();
        let one = missing(&base, &["claude"], 1).remove(0);
        let usual = home.join(".local").join("bin");
        put_program(&usual, &one.program);
        let after = catalogue();
        let got = after.iter().find(|x| x.id == one.id).unwrap();
        assert!(got.installed, "{got:?}");
        assert!(got.path.as_deref().is_some_and(|p| Path::new(p).starts_with(&usual)), "found in the default folder: {got:?}");
        assert_eq!(installed_ids(&after).len(), installed_ids(&base).len() + 1, "only that one agent appeared");
    });
    for d in [empty, home] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn sess001_box3_a_file_that_cannot_run_or_a_folder_named_after_an_agent_is_not_offered() {
    let (empty, home) = homes("b3");
    let bin = scratch("b3-bin");
    with_env(&empty, &home, || {
        let base = catalogue();
        let three = missing(&base, &["claude", "codex", "gemini"], 3);
        // A: an ordinary file named after the agent, no run ending (Windows) / no execute bit (elsewhere).
        std::fs::write(bin.join(&three[0].program), b"not a program").unwrap();
        // B: a folder bearing the name (with the ending a program would have on Windows).
        std::fs::create_dir(bin.join(if cfg!(windows) { format!("{}.exe", three[1].program) } else { three[1].program.clone() })).unwrap();
        // C: control, a real program in the same folder.
        put_program(&bin, &three[2].program);
        std::env::set_var("PATH", &bin);
        let after = catalogue();
        let state = |id: &str| after.iter().find(|x| x.id == id).unwrap().installed;
        assert!(!state(&three[0].id), "{}: a plain file is not a program", three[0].id);
        assert!(!state(&three[1].id), "{}: a folder is not a program", three[1].id);
        assert!(state(&three[2].id), "{}: the same folder is searched, so a real program shows", three[2].id);
    });
    for d in [empty, home, bin] {
        let _ = std::fs::remove_dir_all(d);
    }
}

// ---- SESS-023: every agent seat gets its own creature-named worktree ----

use kolux_lib::git::Git;
use kolux_lib::projects::{add_project, create_fresh_workspace, forget_workspace, load_projects, remove_worktree, Place, Project};
use kolux_lib::state::Store;
use std::process::Command;

fn repo_for_launches(tag: &str) -> PathBuf {
    let dir = scratch(tag);
    for args in [vec!["init", "-q"], vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]] {
        assert!(Command::new("git").args(&args).current_dir(&dir).status().unwrap().success(), "git {args:?}");
    }
    dir
}

fn launch_seats(git: &Git, store: &Store, place: &Place, project: &Project, seats: usize) -> Vec<(String, String)> {
    (0..seats)
        .map(|_| {
            let projects = load_projects(store);
            let made = create_fresh_workspace(git, || Ok(store), place, &projects, project, None).unwrap();
            assert!(Path::new(&made.path).join(".git").exists(), "a real checkout: {}", made.path);
            let name = Path::new(&made.path).file_name().unwrap().to_string_lossy().to_string();
            (name, made.path)
        })
        .collect()
}

#[test]
fn sess023_three_separate_copy_seats_get_three_distinct_creature_worktrees_and_a_second_launch_never_repeats_them() {
    let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let git = Git::detect().unwrap();
    let profile = scratch("s23-profile");
    let store = Store::open(&profile).unwrap();
    let repo = repo_for_launches("s23-repo");
    let root = scratch("s23-root");
    let place = Place { root: root.clone(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
    let project = add_project(&git, &store, &repo).unwrap();

    // Box 1: three seats -> three new worktrees, three different adjective-creature names.
    let first = launch_seats(&git, &store, &place, &project, 3);
    let names: std::collections::HashSet<_> = first.iter().map(|(n, _)| n.clone()).collect();
    assert_eq!(names.len(), 3, "different names: {first:?}");
    let paths: std::collections::HashSet<_> = first.iter().map(|(_, p)| p.clone()).collect();
    assert_eq!(paths.len(), 3, "one folder per seat");
    for (name, _) in &first {
        assert_eq!(name.split('-').count(), 2, "adjective-creature: {name}");
    }

    // Box 2: launch again (3 more while the first still stand): none repeats.
    let second = launch_seats(&git, &store, &place, &project, 3);
    for (n, _) in &second {
        assert!(!names.contains(n), "{n} repeats an earlier name");
    }
    // Retired names stay off the table: remove the first three, launch again.
    for (_, p) in &first {
        remove_worktree(&git, &project, p, true, false).unwrap();
        forget_workspace(&store, p).unwrap();
    }
    let all_earlier: std::collections::HashSet<_> = first.iter().chain(second.iter()).map(|(n, _)| n.clone()).collect();
    let third = launch_seats(&git, &store, &place, &project, 3);
    for (n, _) in &third {
        assert!(!all_earlier.contains(n), "{n} repeats a current or retired name");
    }

    drop(store);
    for d in [profile, repo, root] {
        let _ = std::fs::remove_dir_all(d);
    }
}

// ---- SESS-027: no-prompt approval modes by default; the user's own arguments replace them ----

use kolux_lib::agents::{start_line_as, Start, StartLine};

fn start_line(s: &serde_json::Value, id: &str, extra: &[String], prompt: &str, picked: bool) -> Result<StartLine, String> {
    start_line_as(s, id, extra, prompt, picked, Start::Fresh)
}

fn strs(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

#[test]
fn sess027_box1_a_plain_claude_start_carries_permission_mode_auto() {
    let none = serde_json::json!({});
    // the plus menu / a fresh tab asks with no extra arguments and no lineup pick
    let args = start_line(&none, "claude", &[], "", false).unwrap().args;
    let at = args.iter().position(|a| a == "--permission-mode").expect("--permission-mode present");
    assert_eq!(args[at + 1], "auto");
    assert!(!args.iter().any(|a| a.contains("bypass") || a == "--dangerously-skip-permissions"), "{args:?}");
}

#[test]
fn sess027_box2_codex_custom_default_arguments_replace_the_built_in_ones() {
    let none = serde_json::json!({});
    assert_eq!(start_line(&none, "codex", &[], "", false).unwrap().args, strs(&["--sandbox", "workspace-write", "--ask-for-approval", "never"]));
    for perms in [None, Some("manual")] {
        let mut set = serde_json::json!({ "agentOptions": { "codex": { "args": "--model gpt-x --full-auto" } } });
        if let Some(p) = perms {
            set["agentPermissions"] = serde_json::json!(p);
        }
        let args = start_line(&set, "codex", &[], "", false).unwrap().args;
        assert_eq!(args, strs(&["--model", "gpt-x", "--full-auto"]), "perms {perms:?}");
        assert!(!args.iter().any(|a| a == "--sandbox" || a == "--ask-for-approval" || a == "never"), "built-ins must be gone: {args:?}");
    }
}

// ---- SESS-030: a restored Claude Code tab starts through the real pty layer when the project path has spaces ----

#[cfg(windows)]
#[test]
fn sess030_box3_resume_starts_in_a_project_folder_whose_path_contains_spaces() {
    use kolux_lib::pty::{program_command, PtySession};
    use std::sync::Arc;
    let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("s30-root");
    let project = root.join("my project folder");
    let shim_dir = root.join("agent bin");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&shim_dir).unwrap();
    // Stands in for the agent: a command-script shim (how npm installs claude on Windows) that prints what it received.
    let shim = shim_dir.join("claude.cmd");
    std::fs::write(&shim, "@echo off\r\necho RESUME-ARGS[%*]\r\necho RESUME-CWD[%CD%]\r\n").unwrap();

    let none = serde_json::json!({});
    let line = start_line_as(&none, "claude", &[], "", true, Start::Restore(Some("0b6c7e3a-4f2d-4b8e-9a51-2d3c4e5f6a7b"))).unwrap();
    assert!(line.resumed);
    let cmd = program_command(&shim.to_string_lossy(), &line.args, Some(&project.to_string_lossy()));

    let out = Arc::new(Mutex::new(Vec::<u8>::new()));
    let sink = Arc::clone(&out);
    let mut session = PtySession::spawn(cmd, 200, 24, move |c| sink.lock().unwrap().extend_from_slice(c), |_| {}).expect("the resumed agent starts");
    // The console layer keeps the session open after the shim ends; wait for its last line, then stop.
    let start = std::time::Instant::now();
    let mut answered = 0;
    while !String::from_utf8_lossy(&out.lock().unwrap()).contains("RESUME-CWD[") && start.elapsed() < std::time::Duration::from_secs(30) {
        // The console layer asks where the cursor is and waits; the terminal view answers, so does this.
        let asked = String::from_utf8_lossy(&out.lock().unwrap()).matches("[6n").count();
        for _ in answered..asked {
            session.write(b"[1;1R").unwrap();
        }
        answered = asked;
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    session.kill();
    let text = String::from_utf8_lossy(&out.lock().unwrap()).to_string();
    assert!(text.contains("--permission-mode auto --resume 0b6c7e3a-4f2d-4b8e-9a51-2d3c4e5f6a7b]"), "{text}");
    assert!(text.to_lowercase().contains("my project folder]"), "started in the spaced folder: {text}");
    let _ = std::fs::remove_dir_all(root);
}

// ---- SESS-051: each catalogue agent's program, start line and opening-prompt route ----

use kolux_lib::agents::credited_agent;

fn line_of(id: &str, prompt: &str) -> StartLine {
    start_line(&serde_json::json!({}), id, &[], prompt, true).unwrap()
}

#[test]
fn sess051_box1_agy_cn_and_cursor_agent_are_offered_and_a_program_called_plain_kiro_is_not_kiro() {
    let (empty, home) = homes("s51b1");
    let bin = scratch("s51b1-bin");
    with_env(&empty, &home, || {
        let base = catalogue();
        let program_of = |id: &str| base.iter().find(|a| a.id == id).unwrap().program.clone();
        assert_eq!((program_of("antigravity").as_str(), program_of("continue").as_str(), program_of("cursor").as_str()), ("agy", "cn", "cursor-agent"));
        assert_eq!(program_of("kiro"), "kiro-cli");
        for p in ["agy", "cn", "cursor-agent", "kiro"] {
            put_program(&bin, p);
        }
        std::env::set_var("PATH", &bin);
        let after = catalogue();
        let on = |id: &str| after.iter().find(|a| a.id == id).unwrap().installed;
        assert!(on("antigravity") && on("continue") && on("cursor"), "all three are offered");
        let kiro_before = base.iter().find(|a| a.id == "kiro").unwrap().installed;
        assert_eq!(on("kiro"), kiro_before, "a program called plain kiro does not make Kiro count");
    });
    for d in [empty, home, bin] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn sess051_box2_grok_takes_a_prompt_that_begins_with_a_double_dash_after_an_end_of_options_marker() {
    assert_eq!(line_of("grok", "--fix the build").args, strs(&["--", "--fix the build"]));
    let args = line_of("grok", "--help").args;
    let marker = args.iter().position(|a| a == "--").unwrap();
    assert_eq!(args.iter().position(|a| a == "--help").unwrap(), marker + 1, "the prompt follows the marker");
}

#[test]
fn sess051_box3_copilot_gets_the_prompt_behind_its_interactive_switch_not_its_quitting_prompt_option() {
    let l = line_of("copilot", "Tidy up");
    assert_eq!(l.args, strs(&["-i", "Tidy up"]));
    assert!(l.typed.is_none() && !l.args.iter().any(|a| a == "-p" || a == "--prompt"));
}

#[test]
fn sess051_box4_gemini_gets_the_prompt_behind_prompt_interactive() {
    let l = line_of("gemini", "Tidy up");
    assert_eq!(l.args, strs(&["--yolo", "--prompt-interactive", "Tidy up"]));
    assert!(l.typed.is_none() && !l.args.iter().any(|a| a == "-p" || a == "--prompt"));
}

#[test]
fn sess051_box5_aider_starts_bare_and_the_prompt_is_handed_over_to_be_typed_once() {
    let l = line_of("aider", "Add tests");
    assert_eq!(l.args, strs(&["--yes-always"]), "bare program plus its standing switch, no prompt on the line");
    assert_eq!(l.typed.as_deref(), Some("Add tests"));
}

#[test]
fn sess051_box6_kiro_starts_on_its_chat_screen() {
    for prompt in ["", "Hi"] {
        assert_eq!(line_of("kiro", prompt).args, strs(&["chat", "--tui"]));
    }
}

#[test]
fn sess051_box7_hermes_opens_its_full_screen_interface_with_or_without_a_prompt_and_queries_once() {
    let without = line_of("hermes", "").args;
    assert_eq!(without, strs(&["--tui"]));
    let with = line_of("hermes", "Explain").args;
    assert_eq!(with, strs(&["chat", "--query", "Explain", "--tui"]));
    for args in [&without, &with] {
        assert_eq!(args.iter().filter(|a| a.as_str() == "--tui").count(), 1);
    }
    assert_eq!(with.iter().filter(|a| a.as_str() == "--query").count(), 1);
    assert_eq!(line_of("hermes", "Explain").typed, None, "the prompt is not typed in a second time");
}

#[test]
fn sess051_box8_a_process_shown_as_kimi_code_is_credited_to_kimi() {
    for cmd in ["kimi-code", "kimi-code.exe", r"C:\tools\kimi-code.cmd --x", "KIMI-CODE"] {
        assert_eq!(credited_agent(cmd), Some("kimi"), "{cmd}");
    }
    assert_eq!(credited_agent("kimi"), Some("kimi"));
}
