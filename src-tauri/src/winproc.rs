//! T-816: the one place that keeps a background program from opening a console window.
//!
//! On Windows a program without a window of its own (Kolux's release build has none) that starts a
//! console program gets a black console window for it unless the start asks for none. Every child
//! Kolux starts that is not a terminal pane goes through [`command`] (or [`quiet`] for a command
//! built elsewhere), which sets CREATE_NO_WINDOW. Terminal panes are different: they run in a
//! pseudo console (the PTY path in `pty.rs`), which never opens a window, and they are not started
//! through `std::process::Command` at all.
//!
//! `quiet` sets the creation flags outright. A caller that needs another flag as well (a detached
//! background service) passes `quiet`'s value or'd with its own to `creation_flags` instead.
use std::ffi::OsStr;
use std::process::Command;

/// CREATE_NO_WINDOW: the child gets no console window (its output pipes still work).
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Makes `cmd` start without a console window; nothing on other systems.
pub fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `Command::new(program)` that never opens a console window.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    quiet(&mut cmd);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// A spawn counts as hidden when one of the next `WINDOW` lines sets the creation flags or goes
    /// through this module.
    const WINDOW: usize = 30;

    /// Spawns that are meant to share the user's own console: the `kolux` command line is a console
    /// program the user runs in a terminal, and these two hand that terminal to the program.
    const ALLOWED: [(&str, &str); 2] = [
        ("cli/mod.rs", "Command::new(\"claude\")"), // `kolux claude`: the agent runs in the user's own terminal
        ("cli_accounts.rs", "Command::new(program)"), // `kolux accounts login`: the agent's sign-in in the user's own terminal
    ];

    /// `line` without its `//` comment; a `//` inside a string literal (a URL) is not a comment.
    fn code_of(line: &str) -> &str {
        let (mut in_str, mut prev) = (false, '\0');
        for (i, c) in line.char_indices() {
            match c {
                '"' if prev != '\\' => in_str = !in_str,
                '/' if !in_str && prev == '/' => return &line[..i - 1],
                _ => {}
            }
            prev = c;
        }
        line
    }

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    fn is_test_file(rel: &str) -> bool {
        let name = rel.rsplit('/').next().unwrap_or(rel);
        name == "tests.rs" || name.ends_with("_tests.rs") || name.starts_with("tests_") || rel.contains("/tests/")
    }

    /// Lines (1-based) of production `Command::new` calls in `src` whose start is neither hidden nor
    /// allowed. Test code (a `#[cfg(test)]` block at the start of a line, or a test file) is out of
    /// scope: a test binary runs under the builder's own console.
    fn unhidden_spawns(rel: &str, src: &str) -> Vec<usize> {
        let lines: Vec<&str> = src.lines().collect();
        let mut found = Vec::new();
        let mut in_test = false;
        for (i, line) in lines.iter().enumerate() {
            if !in_test && line.starts_with("#[cfg(test)]") {
                let next = lines[i + 1..].iter().find(|l| !l.trim_start().starts_with("#[")).copied().unwrap_or("");
                // `mod x;` (a body in another file) opens no block here: the lines after it are production code.
                in_test = ["mod ", "pub mod ", "fn ", "pub fn ", "impl"].iter().any(|p| next.starts_with(p)) && !next.trim_end().ends_with(';');
                continue;
            }
            if in_test {
                in_test = *line != "}";
                continue;
            }
            let code = code_of(line);
            // Every `Command` on the line counts (`let c: Command = Command::new(..)` names the type first).
            let spawn = code.match_indices("Command").any(|(at, _)| {
                let after: String = code[at + "Command".len()..].chars().filter(|c| !c.is_whitespace()).take(6).collect();
                // A `Command` at the end of the line may be spaced onto the next one: `Command\n    ::new(`.
                after.starts_with("::new(") || (after.is_empty() && lines.get(i + 1).is_some_and(|n| n.trim_start().starts_with("::new(")))
            });
            if !spawn {
                continue;
            }
            if ALLOWED.iter().any(|(f, text)| *f == rel && code.contains(text)) {
                continue;
            }
            // Only code counts: a comment that merely names winproc or creation_flags hides nothing.
            let hidden = lines[i..lines.len().min(i + WINDOW)].iter().map(|l| code_of(l)).any(|c| c.contains("creation_flags") || c.contains("winproc::"));
            if !hidden {
                found.push(i + 1);
            }
        }
        found
    }

    #[test]
    fn t816_the_scanner_sees_a_bare_spawn_and_accepts_a_hidden_one() {
        let new = ["Command", "::new("].concat();
        let bad = format!("fn a() {{\n    let c = std::process::{new}\"x\");\n}}\n// {new}\"z\") in a comment\n#[cfg(test)]\nmod tests {{\n    fn t() {{ {new}\"y\"); }}\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &bad), vec![2], "a test module and a comment are not production spawns");
        let spaced = "fn a() {\n    let c = Command\n        ::new(\"x\");\n}\n";
        assert_eq!(unhidden_spawns("x.rs", spaced), vec![2], "a constructor spaced onto the next line is seen");
        let flagged = format!("fn a() {{\n    let mut c = {new}\"x\");\n    c.creation_flags(0x0800_0000);\n}}\n");
        assert!(unhidden_spawns("x.rs", &flagged).is_empty());
        let helper = format!("fn a() {{\n    let mut c = {new}\"x\");\n    crate::winproc::quiet(&mut c);\n}}\n");
        assert!(unhidden_spawns("x.rs", &helper).is_empty());
        let after_cfg_use = format!("#[cfg(test)]\nuse std::fs;\nfn a() {{\n    let c = {new}\"x\");\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &after_cfg_use), vec![4], "a single cfg(test) item does not hide the code after it");
        // Review (T-816): four ways the scanner was fooled before.
        let after_cfg_mod = format!("#[cfg(test)]\nmod t;\nfn a() {{\n    let c = {new}\"x\");\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &after_cfg_mod), vec![4], "a cfg(test) `mod t;` (body elsewhere) hides nothing after it");
        let typed = format!("fn a() {{\n    let c: Command = {new}\"x\");\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &typed), vec![2], "the type named before the constructor does not hide it");
        let commented = format!("fn a() {{\n    let c = {new}\"x\");\n    // see winproc:: and creation_flags\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &commented), vec![2], "a comment naming the helper does not hide the spawn");
        let url = format!("fn a() {{\n    let u = \"https://x\"; let c = {new}\"x\");\n}}\n");
        assert_eq!(unhidden_spawns("x.rs", &url), vec![2], "a URL's // is not a comment");
    }

    #[test]
    fn t816_command_hides_its_console_on_windows() {
        let c = command("kolux-no-such-program");
        assert_eq!(c.get_program(), "kolux-no-such-program");
        #[cfg(windows)]
        {
            let out = command("cmd.exe").args(["/c", "echo", "hidden"]).output().unwrap();
            assert!(out.status.success());
            assert!(String::from_utf8_lossy(&out.stdout).contains("hidden"), "output pipes still work");
        }
    }

    /// T-816: no new program starts without hiding its console. Every production `Command::new` in
    /// `src-tauri/src` either sets CREATE_NO_WINDOW itself or goes through `winproc`.
    #[test]
    fn t816_every_production_spawn_hides_its_console() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&root, &mut files);
        assert!(files.len() > 100, "the scan found the source tree");
        let mut bad = Vec::new();
        for file in files {
            let rel = file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
            if rel == "winproc.rs" || is_test_file(&rel) {
                continue;
            }
            let text = std::fs::read_to_string(&file).unwrap();
            for line in unhidden_spawns(&rel, &text) {
                bad.push(format!("{rel}:{line}"));
            }
        }
        assert!(bad.is_empty(), "programs started without hiding their console (use crate::winproc::command or ::quiet): {bad:?}");
    }
}
