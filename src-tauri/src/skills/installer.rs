//! SKILL-026 / SKILL-028 / SKILL-031: running the community skills installer. This file only knows
//! how to build the commands (through Node's package runner, no prompts, skill names sorted, the
//! yes flag and global scope), launch them without a window (the Windows command-script shim
//! rules), and stop the whole process tree. What to update and what happened afterwards is
//! `update.rs`; what the `kolux skills install` command accepts is added by T-198-b below.
#![allow(dead_code)] // reached from the commands that evidence/skills-T-196-b-lib.patch registers

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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

pub fn launch(cmd: &Cmd, windows: bool) -> Result<Launch, String> {
    if !windows {
        return Ok(Launch { program: cmd.program.clone(), args: cmd.args.clone(), raw: None });
    }
    if let Some(bad) = std::iter::once(&cmd.program).chain(&cmd.args).find(|a| a.contains(SHELL_SYNTAX)) {
        return Err(format!("{bad:?} holds characters the Windows command interpreter would read as syntax, so Kolux will not run it"));
    }
    // /d skips the interpreter's start-up scripts; /s keeps the outer quotes below from being read.
    let line = std::iter::once(format!("{}.cmd", cmd.program)).chain(cmd.args.iter().map(|a| quote(a))).collect::<Vec<_>>().join(" ");
    Ok(Launch { program: "cmd.exe".into(), args: vec!["/d".into(), "/s".into(), "/c".into()], raw: Some(format!("\"{line}\"")) })
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

impl Installer for Real {
    fn run(&self, cmd: &Cmd, cancel: &AtomicBool) -> Result<Outcome, String> {
        use std::io::Read;
        use std::process::{Command, Stdio};
        let l = launch(cmd, cfg!(windows))?;
        let mut c = Command::new(&l.program);
        c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            c.args(&l.args);
            if let Some(r) = &l.raw {
                c.raw_arg(r);
            }
        }
        #[cfg(not(windows))]
        c.args(&l.args);
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

    #[test]
    fn windows_goes_through_the_command_interpreter_as_one_line() {
        let c = update_cmd(&s(&["orchestration"])).unwrap();
        let l = launch(&c, true).unwrap();
        assert_eq!((l.program.as_str(), l.args), ("cmd.exe", s(&["/d", "/s", "/c"])));
        assert_eq!(l.raw.as_deref(), Some("\"npx.cmd --yes skills update orchestration -y -g\""));
        assert_eq!(launch(&c, false).unwrap(), Launch { program: "npx".into(), args: c.args.clone(), raw: None });
    }

    #[test]
    fn windows_refuses_an_argument_the_interpreter_would_read_as_syntax() {
        for bad in ["a&calc", "a|b", "100%", "x^y", "a\"b", "a>b", "a!b"] {
            let c = Cmd { program: "npx".into(), args: s(&["add", bad]) };
            assert!(launch(&c, true).is_err(), "{bad:?}");
            assert!(launch(&c, false).is_ok());
        }
        // Spaces and brackets in a folder path are fine: the argument is quoted.
        let c = Cmd { program: "npx".into(), args: s(&["add", r"C:\Program Files\Kolux [dev]\skills"]) };
        assert_eq!(launch(&c, true).unwrap().raw.as_deref(), Some(r#""npx.cmd add "C:\Program Files\Kolux [dev]\skills"""#));
    }
}
