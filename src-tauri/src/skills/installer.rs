//! SKILL-026 / SKILL-028 / SKILL-031: running the community skills installer. This file only knows
//! how to build the commands (through Node's package runner, no prompts, skill names sorted, the
//! yes flag and global scope), launch them without a window (the Windows command-script shim
//! rules), and stop the whole process tree. What to update and what happened afterwards is
//! `update.rs`; what the `kolux skills install` command accepts is added by T-198-b below.
#![allow(dead_code)] // reached from the commands that evidence/skills-T-196-b-lib.patch registers

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Node's package runner, which fetches and runs the installer.
pub const RUNNER: &str = "npx";
/// The installer's package; user-facing text only ever says "the community skills installer" (DT-23).
pub const PACKAGE: &str = "skills";
/// The Kolux skills repository, under Txais's own GitHub account (DT-C72). A placeholder until the
/// repository is published (DT-C43); until then an install fails rather than fetching anything. Every
/// flow takes the repository as a value, and tests pass a local stand-in folder.
pub const OFFICIAL_REPO: &str = "TxaisX/kolux-skills";
/// The installer's name for the shared cross-agent folder.
pub const SHARED_AGENT: &str = "universal";
/// The installer's output is kept up to this many bytes for Show log.
const LOG_LIMIT: usize = 1024 * 1024;

/// One command: a program and its arguments, as the user would type them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cmd {
    pub program: String,
    pub args: Vec<String>,
}

fn quote(a: &str) -> String {
    if a.is_empty() || a.contains(' ') {
        format!("\"{a}\"")
    } else {
        a.to_string()
    }
}

impl Cmd {
    /// The command as one line, ready to paste into a terminal.
    pub fn line(&self) -> String {
        std::iter::once(self.program.as_str()).chain(self.args.iter().map(String::as_str)).map(quote).collect::<Vec<_>>().join(" ")
    }
}

/// A skill name is letters, digits, dot, dash and underscore, starting with a letter or digit:
/// anything holding shell syntax is refused before a command line is ever built.
pub fn safe_name(n: &str) -> bool {
    let mut c = n.chars();
    c.next().is_some_and(|f| f.is_ascii_alphanumeric()) && n.len() <= 64 && c.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// The names of an update or install: none blank, none holding shell syntax, sorted and unique.
pub fn clean_names(names: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = vec![];
    for n in names {
        let t = n.trim();
        if t.is_empty() {
            return Err("A skill name is blank".into());
        }
        if !safe_name(t) {
            return Err(format!("{t:?} is not a skill name: names hold letters, digits, dots, dashes and underscores only"));
        }
        out.push(t.to_string());
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// SKILL-026: the update, with no prompts, for these skills in sorted order, global scope.
pub fn update_cmd(names: &[String]) -> Result<Cmd, String> {
    let names = clean_names(names)?;
    if names.is_empty() {
        return Err("No skill was named to update".into());
    }
    let mut args = vec!["--yes".to_string(), PACKAGE.into(), "update".into()];
    args.extend(names);
    args.extend(["-y".into(), "-g".into()]);
    Ok(Cmd { program: RUNNER.into(), args })
}

/// SKILL-028 / SKILL-031: installs skills from a repository (a `owner/name` value or a folder).
/// The command the panel copies stays interactive (`unattended` false: no agent list, no yes flag);
/// an unattended run names its agents, with the shared folder, and answers every question itself.
pub fn add_cmd(repo: &str, names: &[String], agents: &[String], global: bool, unattended: bool) -> Result<Cmd, String> {
    let names = clean_names(names)?;
    if names.is_empty() {
        return Err("No skill was named to install".into());
    }
    if repo.trim().is_empty() || repo.starts_with('-') || repo.contains(|c: char| c.is_control()) {
        return Err("The skills repository is not valid".into());
    }
    let mut args = vec!["--yes".to_string(), PACKAGE.into(), "add".into(), repo.into()];
    for n in &names {
        args.extend(["--skill".into(), n.clone()]);
    }
    if unattended {
        let mut a: Vec<String> = agents.to_vec();
        if !a.iter().any(|x| x == SHARED_AGENT) {
            a.push(SHARED_AGENT.into());
        }
        if let Some(bad) = a.iter().find(|x| !safe_name(x)) {
            return Err(format!("{bad:?} is not an agent name"));
        }
        args.push("--agent".into());
        args.extend(a);
        args.push("-y".into());
    }
    if global {
        args.push("-g".into());
    }
    Ok(Cmd { program: RUNNER.into(), args })
}

/// SKILL-028: the interactive command the Install panel copies or types into a terminal without
/// running it: no agent list and no yes flag, so the installer asks its own questions.
#[tauri::command]
pub fn skills_install_command(names: Vec<String>) -> Result<String, String> {
    add_cmd(OFFICIAL_REPO, &names, &[], true, false).map(|c| c.line())
}

/// How a command is started. On Windows the package runner is a command script (`npx.cmd`), which
/// only the command interpreter runs, so the line goes through it as one string; every argument
/// must then be free of the characters that interpreter reads as syntax, or the command is refused
/// (a skill name or repository value is never allowed to run something else).
#[derive(Debug, PartialEq, Eq)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    /// Windows only: the rest of the interpreter's line, passed as it is.
    pub raw: Option<String>,
}

const SHELL_SYNTAX: &[char] = &['&', '|', '<', '>', '^', '%', '!', '"', '\'', '`', ';', '$', '\n', '\r', '\0'];
/// The runner's path sits inside quotes, where only these still mean something to the interpreter.
const QUOTED_SYNTAX: &[char] = &['%', '!', '"', '\n', '\r', '\0'];

/// `resolved` is where the runner was found (`agents::find_program`). R10-skills.2 (T-633): it must be
/// a full path, because the interpreter looks a bare name up in the current folder first, where a
/// cloned project could have planted its own `npx.cmd`.
pub fn launch(cmd: &Cmd, resolved: &Path, windows: bool) -> Result<Launch, String> {
    let mut program = resolved.to_string_lossy().into_owned();
    if !windows {
        if !resolved.has_root() {
            return Err(format!("{program:?} is not a full path, so Kolux will not run it"));
        }
        return Ok(Launch { program, args: cmd.args.clone(), raw: None });
    }
    // Judged by Windows' rules on any system, so a test checks the Windows line anywhere. A drive
    // path or a share; the \\?\ and \\.\ forms are refused, the interpreter does not run scripts there.
    program = program.replace('/', "\\");
    let drive = program.starts_with(|c: char| c.is_ascii_alphabetic()) && program.get(1..3) == Some(":\\");
    let share = program.starts_with(r"\\") && !program.starts_with(r"\\?\") && !program.starts_with(r"\\.\");
    if !(drive || share) {
        return Err(format!("{program:?} is not a full path, so Kolux will not run it"));
    }
    let bad = Some(&program).filter(|p| p.contains(QUOTED_SYNTAX)).or_else(|| cmd.args.iter().find(|a| a.contains(SHELL_SYNTAX)));
    if let Some(bad) = bad {
        return Err(format!("{bad:?} holds characters the Windows command interpreter would read as syntax, so Kolux will not run it"));
    }
    // /d skips the interpreter's start-up scripts; /s keeps the outer quotes below from being read.
    let line = std::iter::once(format!("\"{program}\"")).chain(cmd.args.iter().map(|a| quote(a))).collect::<Vec<_>>().join(" ");
    // T-660: the interpreter itself by its full path in Windows' system folder, never by bare name.
    let interpreter = crate::pty::system_program("cmd.exe").to_string_lossy().into_owned();
    Ok(Launch { program: interpreter, args: vec!["/d".into(), "/s".into(), "/c".into()], raw: Some(format!("\"{line}\"")) })
}

/// R10-skills.2 (T-633): where a run starts. A computer-wide one (`-g`) starts in the app's own
/// folder (`pty::service::start_dir`, as `kolux open` does), so the folder the command was typed in
/// has no say; a project one stays in that project, which is where it installs.
pub fn run_dir(cmd: &Cmd, exe: &Path) -> Option<PathBuf> {
    cmd.args.iter().any(|a| a == "-g").then(|| crate::pty::service::start_dir(exe).map(Path::to_path_buf)).flatten()
}

/// T-635 (R10-skills.2, DT-C82): why a run must not start, if it must not. `dir` is `run_dir`'s
/// answer, `cwd` the folder a project run starts in, `home` the user's folder, `old_node` whether
/// the found Node ignores the guard variable `command` sets (older than libuv 1.48, Node 22).
pub fn refusal(cmd: &Cmd, dir: Option<&Path>, cwd: &Path, home: Option<&Path>, old_node: bool) -> Option<String> {
    if cmd.args.iter().any(|a| a == "-g") {
        return dir.is_none().then(|| "Kolux could not find its own folder, so it will not run a computer-wide skills install from the folder it was started in".into());
    }
    if old_node {
        return Some("Installing skills into a project needs Node.js 22 or later, and Kolux could not confirm one, so the installer could start programs out of the project folder. Update Node.js, or install for the whole computer instead".into());
    }
    // npm finds the project root from a subfolder, so the parents count too, up to the user's own
    // folder, whose settings file is the user's and not the project's. npx puts every
    // node_modules/.bin on the way at the front of the search path for everything the installer
    // starts (Node, git), so any program there counts, not only one called skills.
    let has_bin = |d: &Path| std::fs::read_dir(d.join("node_modules").join(".bin")).into_iter().flatten().flatten().next().is_some();
    // The walk stops only where the path is spelled as the user's folder. A link or short name that
    // leads there is skipped, not a stop, so a link inside a project cannot hide the folders above it.
    let own = cwd.ancestors()
        .take_while(|d| home.is_none_or(|h| !same_spelling(d, h)))
        .filter(|d| home.is_none_or(|h| !same_dir(d, h)))
        .find(|d| d.join(".npmrc").is_file() || has_bin(d))?;
    Some(format!("{} carries its own npm settings or its own programs in node_modules, which would decide what the installer runs. Kolux will not install into this project; install for the whole computer instead, or run the installer yourself if you trust this project", own.display()))
}

/// Whether two paths are spelled as the same folder; Windows folder names ignore case.
fn same_spelling(a: &Path, b: &Path) -> bool {
    let trim = |p: &Path| p.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
    if cfg!(windows) { trim(a).eq_ignore_ascii_case(&trim(b)) } else { trim(a) == trim(b) }
}

/// Whether two paths name the same folder, also through a short (8.3) or linked spelling.
fn same_dir(a: &Path, b: &Path) -> bool {
    same_spelling(a, b) || matches!((std::fs::canonicalize(a), std::fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// "1.48.0" (what `node -p process.versions.uv` prints) as (1, 48).
fn node_version(out: &str) -> Option<(u32, u32)> {
    let mut v = out.trim().split('.').map(|n| n.parse().ok());
    Some((v.next()??, v.next()??))
}

/// Whether the Node that would run ignores the guard variable. Asked from the app's folder; an
/// answer that cannot be read, or an app folder that cannot be found, counts as old, so a project
/// run is refused rather than unguarded.
fn old_node(app: Option<&Path>) -> bool {
    let (Some(app), Some(node)) = (app, crate::agents::find_program("node")) else { return true };
    let mut c = std::process::Command::new(node);
    c.args(["-p", "process.versions.uv"]).stdin(std::process::Stdio::null()).current_dir(app);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut c, 0x0800_0000); // CREATE_NO_WINDOW
    c.output().ok().and_then(|o| node_version(&String::from_utf8_lossy(&o.stdout))).is_none_or(|v| v < (1, 48))
}

/// What a run left behind.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// The installer's exit code; None when it was ended by a signal or by Stop.
    pub code: Option<i32>,
    /// Everything it printed, colour codes stripped.
    pub log: String,
    pub stopped: bool,
}

/// Runs a command to its end. Err means it could not start, and says why.
pub trait Installer: Send + Sync {
    fn run(&self, cmd: &Cmd, cancel: &AtomicBool) -> Result<Outcome, String>;
}

const NO_NODE: &str = "Node.js was not found, so the community skills installer cannot run. Install Node.js and try again";

/// The real thing: no window, output kept, the whole process tree ended when `cancel` is set.
pub struct Real;

/// The process for a launch, started in `dir` when given (`run_dir`).
fn command(l: &Launch, dir: Option<&Path>) -> std::process::Command {
    let mut c = std::process::Command::new(&l.program);
    if let Some(dir) = dir {
        c.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // R10-skills.2 (T-633): the interpreter's own lookups (npx.cmd starting node) skip the
        // current folder, which for a project install is the project. Node's launcher (libuv 1.48+,
        // Node 22 and later) honours the same variable, so its children skip it too while they
        // keep this environment.
        c.env("NoDefaultCurrentDirectoryInExePath", "1");
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c.args(&l.args);
        if let Some(r) = &l.raw {
            c.raw_arg(r);
        }
    }
    #[cfg(not(windows))]
    c.args(&l.args);
    c
}

impl Installer for Real {
    fn run(&self, cmd: &Cmd, cancel: &AtomicBool) -> Result<Outcome, String> {
        use std::io::Read;
        use std::process::Stdio;
        let resolved = crate::agents::find_program(&cmd.program).ok_or_else(|| NO_NODE.to_string())?;
        let l = launch(cmd, &resolved, cfg!(windows))?;
        let exe = std::env::current_exe().ok();
        let dir = exe.as_deref().and_then(|exe| run_dir(cmd, exe));
        let global = cmd.args.iter().any(|a| a == "-g");
        // The variable is Windows' own; elsewhere a lookup never starts in the current folder.
        let old = !global && cfg!(windows) && old_node(exe.as_deref().and_then(crate::pty::service::start_dir));
        let cwd = std::env::current_dir().map_err(|e| format!("The community skills installer could not start: {e}"))?;
        let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
        if let Some(why) = refusal(cmd, dir.as_deref(), &cwd, home.as_deref(), old) {
            return Err(why);
        }
        let mut c = command(&l, dir.as_deref());
        c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = c.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { NO_NODE.to_string() } else { format!("The community skills installer could not start: {e}") })?;
        let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
        let mut readers = vec![];
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)].into_iter().flatten() {
            let buf = buf.clone();
            readers.push(std::thread::spawn(move || {
                let mut s = stream;
                let mut chunk = [0u8; 4096];
                while let Ok(n) = s.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    let mut b = buf.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    if b.len() < LOG_LIMIT {
                        b.extend_from_slice(&chunk[..n]);
                    }
                }
            }));
        }
        let pid = child.id();
        let mut stopped = false;
        let status = loop {
            if cancel.load(Ordering::Relaxed) && !stopped {
                stopped = true;
                crate::procs::kill_tree(pid);
                let _ = child.kill();
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                Err(e) => return Err(format!("The community skills installer could not be watched: {e}")),
            }
        };
        for r in readers {
            let _ = r.join();
        }
        let log = crate::terminal::strip_ansi(&String::from_utf8_lossy(&buf.lock().unwrap_or_else(std::sync::PoisonError::into_inner)));
        let code = if stopped { None } else { status.code() };
        // The interpreter answers 9009 (or says so) when the runner is not on the path.
        if !stopped && l.raw.is_some() && (code == Some(9009) || (code != Some(0) && log.contains("is not recognized as an internal or external command"))) {
            return Err(NO_NODE.into());
        }
        Ok(Outcome { code, log, stopped })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn update_command_has_sorted_names_the_yes_flag_and_global_scope() {
        let c = update_cmd(&s(&["orchestration", "kolux-cli", "orchestration"])).unwrap();
        assert_eq!(c.program, "npx");
        assert_eq!(c.args, s(&["--yes", "skills", "update", "kolux-cli", "orchestration", "-y", "-g"]));
        assert_eq!(c.line(), "npx --yes skills update kolux-cli orchestration -y -g");
    }

    #[test]
    fn add_command_repeats_the_skill_flag_and_an_unattended_run_names_its_agents() {
        let n = s(&["orchestration", "kolux-cli"]);
        let panel = add_cmd("TxaisX/kolux-skills", &n, &s(&["claude-code"]), true, false).unwrap();
        assert_eq!(panel.line(), "npx --yes skills add TxaisX/kolux-skills --skill kolux-cli --skill orchestration -g");
        let run = add_cmd("TxaisX/kolux-skills", &n[..1], &s(&["claude-code", "codex"]), false, true).unwrap();
        assert_eq!(run.line(), "npx --yes skills add TxaisX/kolux-skills --skill orchestration --agent claude-code codex universal -y");
        assert!(add_cmd("-x", &n, &[], true, false).is_err() && add_cmd("r", &[], &[], true, false).is_err());
        assert!(add_cmd("r", &n, &s(&["a;b"]), true, true).is_err());
    }

    #[test]
    fn the_install_panel_command_is_interactive_and_refuses_bad_names() {
        assert_eq!(skills_install_command(s(&["koluxward", "kolux-cli"])).unwrap(), "npx --yes skills add TxaisX/kolux-skills --skill kolux-cli --skill koluxward -g");
        assert!(skills_install_command(s(&["x y"])).is_err() && skills_install_command(vec![]).is_err());
    }

    #[test]
    fn blank_names_and_shell_syntax_are_refused() {
        for bad in ["", "  ", "a b", "a;b", "a&b", "$(x)", "a|b", "`x`", "../x", "a\"b", "-rf", ".hidden"] {
            assert!(update_cmd(&s(&[bad])).is_err(), "{bad:?}");
        }
        assert!(update_cmd(&[]).is_err());
        assert!(update_cmd(&s(&["ok", " "])).is_err());
        assert!(safe_name("koluxward") && safe_name("a.b_c-d"));
    }

    /// Where Node's runner was found on a test PC (any absolute path will do).
    const NPX: &str = r"C:\Program Files\nodejs\npx.cmd";

    #[test]
    fn windows_goes_through_the_command_interpreter_as_one_line() {
        let c = update_cmd(&s(&["orchestration"])).unwrap();
        let l = launch(&c, Path::new(NPX), true).unwrap();
        let interpreter = crate::pty::system_program("cmd.exe");
        assert_eq!((l.program.as_str(), l.args), (interpreter.to_string_lossy().as_ref(), s(&["/d", "/s", "/c"])));
        // T-660: a full path in Windows' system folder, so a cmd.exe in the install folder is never run.
        #[cfg(windows)]
        assert!(Path::new(&l.program).is_absolute() && interpreter.parent() == crate::resources::update_guard::system_dir().as_deref());
        assert_eq!(l.raw.as_deref(), Some(r#"""C:\Program Files\nodejs\npx.cmd" --yes skills update orchestration -y -g""#));
        assert_eq!(launch(&c, Path::new("/usr/bin/npx"), false).unwrap(), Launch { program: "/usr/bin/npx".into(), args: c.args.clone(), raw: None });
    }

    #[test]
    fn windows_refuses_an_argument_the_interpreter_would_read_as_syntax() {
        for bad in ["a&calc", "a|b", "100%", "x^y", "a\"b", "a>b", "a!b"] {
            let c = Cmd { program: "npx".into(), args: s(&["add", bad]) };
            assert!(launch(&c, Path::new(NPX), true).is_err(), "{bad:?}");
            assert!(launch(&c, Path::new("/usr/bin/npx"), false).is_ok());
        }
        // Spaces and brackets in a folder path are fine: the argument is quoted.
        let c = Cmd { program: "npx".into(), args: s(&["add", r"C:\Program Files\Kolux [dev]\skills"]) };
        assert_eq!(launch(&c, Path::new(NPX), true).unwrap().raw.as_deref(), Some(r#"""C:\Program Files\nodejs\npx.cmd" add "C:\Program Files\Kolux [dev]\skills"""#));
    }

    /// R10-skills.2 (T-633): the runner is started by the full path it was found at, never a bare
    /// name the interpreter would look up in the current folder first; a found path the interpreter
    /// would read as syntax, or a relative one, is refused.
    #[test]
    fn t633_the_runner_starts_by_its_full_path_only() {
        let c = update_cmd(&s(&["orchestration"])).unwrap();
        let raw = launch(&c, Path::new(NPX), true).unwrap().raw.unwrap();
        assert!(raw.starts_with(r#"""C:\"#), "{raw}");
        assert!(!raw.contains(" npx.cmd") && !raw.starts_with("\"npx"), "{raw}");
        for bad in [r"C:\100%\npx.cmd", r"C:\a!b\npx.cmd", r#"C:\a"b\npx.cmd"#, r"\\?\C:\nodejs\npx.cmd", r"\\.\C:\nodejs\npx.cmd", r"1:\npx.cmd"] {
            assert!(launch(&c, Path::new(bad), true).is_err(), "{bad}");
        }
        // Inside the quotes these mean nothing to the interpreter, so a profile like O'Brien works.
        for ok in [r"C:\Users\O'Brien\scoop\npx.cmd", r"C:\Users\a&b\npx.cmd", r"C:\x^y (dev)\npx.cmd", r"\\server\share\npx.cmd"] {
            assert!(launch(&c, Path::new(ok), true).is_ok(), "{ok}");
        }
        let slash = launch(&c, Path::new("C:/nodejs/npx.cmd"), true).unwrap().raw.unwrap();
        assert!(slash.starts_with(r#"""C:\nodejs\npx.cmd""#), "{slash}");
        for rel in ["npx.cmd", r".\npx.cmd", r"tools\npx.cmd"] {
            assert!(launch(&c, Path::new(rel), true).is_err(), "{rel}");
            assert!(launch(&c, Path::new(rel), false).is_err(), "{rel}");
        }
    }

    /// R10-skills.2 (T-633): a computer-wide install runs in the app's own folder, so the folder the
    /// command was typed in (a cloned project, say) has no say in it; a project install (--local)
    /// runs in that project, which is where it installs.
    #[test]
    fn t633_a_computer_wide_run_starts_in_the_apps_folder() {
        let exe = std::env::current_exe().unwrap();
        let global = update_cmd(&s(&["orchestration"])).unwrap();
        assert_eq!(run_dir(&global, &exe), exe.parent().map(Path::to_path_buf));
        let mut local = global.clone();
        local.args.retain(|a| a != "-g");
        assert_eq!(run_dir(&local, &exe), None);
        assert_eq!(run_dir(&global, Path::new("kolux.exe")), None, "a relative exe names no folder");
    }

    /// R10-skills.2 (T-633): a project install runs in the project, so a project carrying its own
    /// npx.cmd and node.cmd is the case to beat. The runner (a stand-in that starts node by bare
    /// name, the worst case) is started as a real run is, and neither planted file runs. Without
    /// the guard variable the planted node does run, which shows the check can see it.
    #[cfg(windows)]
    #[test]
    fn t633_launchers_planted_in_the_project_never_run() {
        let project = crate::test_dir::temp("t633-project");
        let runner = crate::test_dir::temp("t633-runner");
        for name in ["npx", "node"] {
            let mark = project.join(format!("ran-{name}.txt"));
            std::fs::write(project.join(format!("{name}.cmd")), format!("@echo off
echo planted> \"{}\"
", mark.display())).unwrap();
        }
        std::fs::write(runner.join("npx.cmd"), "@echo off
call node --version >nul 2>&1
exit /b 0
").unwrap();
        let c = Cmd { program: "npx".into(), args: s(&["--version"]) };
        let l = launch(&c, &runner.join("npx.cmd"), true).unwrap();
        command(&l, Some(&project)).output().unwrap();
        assert!(!project.join("ran-npx.txt").exists(), "the planted npx.cmd ran");
        assert!(!project.join("ran-node.txt").exists(), "the planted node.cmd ran");
        let mut bare = command(&l, Some(&project));
        bare.env_remove("NoDefaultCurrentDirectoryInExePath").output().unwrap();
        assert!(project.join("ran-node.txt").exists(), "control: without the variable the planted node is found");
    }

    /// R10-skills.2 (T-633): one level further down. Real Node, started by the runner in the
    /// project, launches a program by bare name that exists only as a planted .exe in the project;
    /// it is not found. Without the guard variable it is, so the check can see it. Skipped when
    /// this computer has no Node, or one older than libuv 1.48 (Node 22), which ignores the variable.
    #[cfg(windows)]
    #[test]
    fn t633_what_node_starts_is_not_found_in_the_project_either() {
        let Some(node) = crate::agents::find_program("node") else { return eprintln!("no Node here, skipped") };
        let uv = std::process::Command::new(&node).args(["-p", "process.versions.uv"]).output().unwrap();
        let uv: Vec<u32> = String::from_utf8_lossy(&uv.stdout).trim().split('.').map(|n| n.parse().unwrap_or(0)).collect();
        if uv.len() < 2 || (uv[0], uv[1]) < (1, 48) {
            return eprintln!("Node's libuv {uv:?} predates the variable, skipped");
        }
        let project = crate::test_dir::temp("t633-node-project");
        let runner = crate::test_dir::temp("t633-node-runner");
        let system = std::env::var("SystemRoot").unwrap();
        std::fs::copy(Path::new(&system).join(r"System32\hostname.exe"), project.join("t633probe.exe")).unwrap();
        let js = "process.stdout.write(require('child_process').spawnSync('t633probe').error?'none':'ran')";
        std::fs::write(runner.join("npx.cmd"), format!("@echo off\r\n\"{}\" -e \"{js}\"\r\n", node.display())).unwrap();
        let l = launch(&Cmd { program: "npx".into(), args: vec![] }, &runner.join("npx.cmd"), true).unwrap();
        let out = |guard: bool| {
            let mut c = command(&l, Some(&project));
            if !guard {
                c.env_remove("NoDefaultCurrentDirectoryInExePath");
            }
            String::from_utf8_lossy(&c.output().unwrap().stdout).trim().to_string()
        };
        assert_eq!(out(true), "none", "Node found the program planted in the project");
        assert_eq!(out(false), "ran", "control: without the variable Node finds the planted program");
    }

    /// T-635 (R10-skills.2, DT-C82): a computer-wide run with no app folder to start in is refused
    /// rather than run from wherever the app was started.
    #[test]
    fn t635_a_computer_wide_run_without_the_apps_folder_is_refused() {
        let t = crate::test_dir::temp("t635-global");
        let g = update_cmd(&s(&["orchestration"])).unwrap();
        assert!(refusal(&g, None, &t, None, false).unwrap().contains("own folder"));
        assert_eq!(refusal(&g, Some(&t), &t, None, true), None, "the Node version only matters for a project run");
    }

    /// T-635: a project run needs a Node that honours the guard variable (Node 22, libuv 1.48).
    #[test]
    fn t635_a_project_run_on_an_older_node_is_refused() {
        let t = crate::test_dir::temp("t635-old-node");
        let mut l = update_cmd(&s(&["orchestration"])).unwrap();
        l.args.retain(|a| a != "-g");
        assert!(refusal(&l, None, &t, Some(&t), true).unwrap().contains("Node.js 22"));
        assert_eq!(refusal(&l, None, &t, Some(&t), false), None);
        assert_eq!(node_version("1.48.0"), Some((1, 48)));
        assert_eq!(node_version("1.46.0\n"), Some((1, 46)));
        assert_eq!(node_version("not a version"), None);
    }

    /// T-635: a project that carries its own npm settings or its own `skills` program, in its
    /// folder or a parent below the user's folder, is refused; the user's own settings file is not
    /// the project's and does not count.
    #[test]
    fn t635_a_project_with_its_own_npm_setup_is_refused() {
        let home = crate::test_dir::temp("t635-home");
        let project = home.join("code").join("app");
        std::fs::create_dir_all(project.join("src")).unwrap();
        let mut l = update_cmd(&s(&["orchestration"])).unwrap();
        l.args.retain(|a| a != "-g");
        let check = |cwd: &Path| refusal(&l, None, cwd, Some(&home), false);
        std::fs::write(home.join(".npmrc"), "").unwrap();
        assert_eq!(check(&project), None, "the user's own .npmrc is not the project's");
        std::fs::write(project.join(".npmrc"), "").unwrap();
        assert!(check(&project).unwrap().contains("npm settings"));
        assert!(check(&project.join("src")).is_some(), "found from a subfolder too, as npm would");
        std::fs::remove_file(project.join(".npmrc")).unwrap();
        let bin = project.join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        assert_eq!(check(&project), None, "an empty .bin steers nothing");
        std::fs::write(bin.join("node.cmd"), "").unwrap();
        assert!(check(&project).unwrap().contains("node_modules"), "any program there is found before Node or git");
        std::fs::remove_dir_all(project.join("node_modules")).unwrap();
        // The user's folder is recognised however its name is spelled.
        let shouted = PathBuf::from(home.to_string_lossy().to_uppercase());
        if cfg!(windows) {
            assert_eq!(refusal(&l, None, &project, Some(&shouted), false), None);
        }
        // A path that only leads to the user's folder (here through "..") is skipped, not a stop:
        // the user's own .npmrc is still ignored, but a project folder above the alias still counts.
        std::fs::create_dir_all(home.join("x")).unwrap();
        let alias = home.join("x").join("..").join("code").join("app");
        assert_eq!(check(&alias), None, "the alias of the user's folder is skipped");
        std::fs::write(home.join("x").join(".npmrc"), "").unwrap();
        assert!(check(&alias).is_some(), "the walk goes on past the alias to the folder above it");
        std::fs::remove_file(home.join("x").join(".npmrc")).unwrap();
        // Outside the user's folder, every parent counts.
        let outside = crate::test_dir::temp("t635-outside");
        let deep = outside.join("a").join("b");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(outside.join(".npmrc"), "").unwrap();
        assert!(refusal(&l, None, &deep, Some(&home), false).is_some());
    }

    /// T-635: the same folder however it is spelled.
    #[test]
    fn t635_same_dir_ignores_spelling() {
        let t = crate::test_dir::temp("t635-same");
        assert!(same_dir(&t, &t.join("")));
        assert!(!same_dir(&t, &t.join("sub")));
        if cfg!(windows) {
            assert!(same_dir(&t, Path::new(&t.to_string_lossy().to_lowercase())));
        }
    }
}
