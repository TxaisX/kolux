//! Txais 2026-11-12 (c2-agents top bug 1): an agent pane runs the user's own shell, and the shell
//! starts the agent, as if the user had typed `claude` or `grok` at its prompt. Kolux never makes
//! claude.exe, grok.exe or an npm shim the pane's own process; the shell resolves the name through
//! its PATH, profile, aliases and functions, the same way it would for a typed command.
//!
//! Only the last step of a start changes: `via_shell` turns the start line (`claude` + arguments) into
//! the shell's command line. Everything keyed on the logical program (the account and key variables,
//! the context cap, the pane mark, hooks, resume) still sees `claude`, because the caller
//! (`terminal::Terminals::spawn`) keeps passing the agent's name around and only swaps the command
//! it hands the pty.
//!
//! Windows: PowerShell (the chosen PowerShell, else PowerShell 7 when installed, else Windows
//! PowerShell 5.1) with `-NoLogo -EncodedCommand <script>`, profile loaded, no `-NoExit`, so the pane
//! ends when the agent does, with its exit code. Arguments never pass through PowerShell's own native
//! argument binder, which in 5.1 splits any argument that holds both `"` and a space: the script runs
//! a native program as `& <path> --% %KOLUX_AGENT_ARGV%`, where the variable holds the finished
//! Windows command line (stop-parsing passes it verbatim and expands a variable once). A name that
//! resolves to a script, alias or function (an npm `.ps1` shim, a profile wrapper) gets the
//! arguments as PowerShell strings instead, decoded from `KOLUX_AGENT_ARGS`.
//!
//! Elsewhere: the chosen (or login) shell as a login, interactive shell: `zsh -l -i -c 'cd -- "$1";
//! shift; exec "$0" "$@"' claude <cwd> <args...>`. The arguments go as separate argv entries, so no
//! quoting is ever done.

use base64::Engine as _;
use std::path::{Path, PathBuf};

/// The finished Windows command line of the agent's arguments (the `--%` route).
pub const ARGV_ENV: &str = "KOLUX_AGENT_ARGV";
/// The same arguments, each as base64 of its UTF-8 bytes, comma separated (the script/alias route).
pub const ARGS_ENV: &str = "KOLUX_AGENT_ARGS";
/// One environment value may hold 32,767 characters; past this the start is not wrapped.
const MAX_ENV_VALUE: usize = 30_000;
/// The whole command line of powershell.exe may hold 32,767 characters.
const MAX_COMMAND_LINE: usize = 30_000;

/// What sort of shell a program is, for the shape of its start line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Windows PowerShell 5.1 or PowerShell 7 (`powershell`, `pwsh`).
    PowerShell,
    /// A POSIX-style shell that takes `-l -i -c <script> <$0> <$1...>`: bash, zsh, sh, dash, ksh.
    Posix,
    /// fish, whose `-c` script reads its arguments from `$argv`.
    Fish,
}

/// The shell kind of a program path or name; None for anything Kolux does not know how to wrap
/// (cmd.exe, Git Bash's MSYS argument conversion is never used on Windows, nu, xonsh...).
pub fn kind_of(shell: &Path) -> Option<Kind> {
    let stem = shell.file_stem()?.to_string_lossy().to_ascii_lowercase();
    match stem.as_str() {
        "pwsh" | "powershell" => Some(Kind::PowerShell),
        "bash" | "zsh" | "sh" | "dash" | "ksh" => Some(Kind::Posix),
        "fish" => Some(Kind::Fish),
        _ => None,
    }
}

/// Whether a pane program is an agent that starts through the shell: a known agent (by the same
/// rule as the account variables and the pane mark), never a shell itself and never blank.
pub fn wraps(program: &str) -> bool {
    let p = program.trim();
    !p.is_empty() && !crate::pty::is_shell_program(p) && crate::tools::credited_program(p).is_some()
}

/// The shell an agent starts in. Windows: the chosen default shell when it is a PowerShell, else
/// PowerShell 7 when installed, else Windows PowerShell from the system folder (T-663: by full path).
/// Elsewhere: the chosen default shell when Kolux knows its kind, else the login shell (`$SHELL`).
pub fn pick(settings: &serde_json::Value) -> Option<PathBuf> {
    let chosen = crate::pty::default_shell(settings).map(|(p, _)| PathBuf::from(p));
    pick_from(cfg!(windows), chosen, || crate::agents::find_program("pwsh.exe").filter(|p| !in_windows_apps(p)), std::env::var_os("SHELL").map(PathBuf::from), || crate::pty::system_program(crate::pty::WINDOWS_POWERSHELL))
}

/// `pick` with its inputs handed in, so a test covers every system.
pub fn pick_from(windows: bool, chosen: Option<PathBuf>, pwsh: impl Fn() -> Option<PathBuf>, login: Option<PathBuf>, system_powershell: impl Fn() -> PathBuf) -> Option<PathBuf> {
    if windows {
        if let Some(c) = chosen.filter(|c| kind_of(c) == Some(Kind::PowerShell)) {
            return Some(c);
        }
        return Some(pwsh().unwrap_or_else(system_powershell));
    }
    chosen.filter(|c| kind_of(c).is_some_and(|k| k != Kind::PowerShell)).or_else(|| login.filter(|l| l.has_root() && kind_of(l).is_some_and(|k| k != Kind::PowerShell)))
}

/// The Microsoft Store's execution alias folder (`...\WindowsApps\pwsh.exe`): skipped, as the shell list does.
fn in_windows_apps(p: &Path) -> bool {
    p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("WindowsApps"))
}

/// A wrapped start: the shell, its arguments and the variables the script reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wrapped {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// The shell's start line that runs `name` with `args` in `cwd`; None when `shell` is not a kind
/// Kolux wraps or the line would not fit Windows' limits (the caller then starts the program directly).
pub fn wrap(shell: &Path, name: &str, args: &[String], cwd: Option<&str>) -> Option<Wrapped> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let program = shell.to_path_buf();
    match kind_of(shell)? {
        Kind::PowerShell => {
            let mut env = Vec::new();
            if !args.is_empty() {
                let line = windows_command_line(args);
                let list = args.iter().map(|a| base64::engine::general_purpose::STANDARD.encode(a.as_bytes())).collect::<Vec<_>>().join(",");
                if line.len() > MAX_ENV_VALUE || list.len() > MAX_ENV_VALUE {
                    return None;
                }
                env.push((ARGV_ENV.to_string(), line));
                env.push((ARGS_ENV.to_string(), list));
            }
            let encoded = encode_command(&powershell_script(name, !args.is_empty(), cwd));
            if encoded.len() + program.as_os_str().len() + 32 > MAX_COMMAND_LINE {
                return None;
            }
            Some(Wrapped { program, args: vec!["-NoLogo".into(), "-EncodedCommand".into(), encoded], env })
        }
        Kind::Posix => {
            let mut a: Vec<String> = vec!["-l".into(), "-i".into(), "-c".into()];
            match cwd {
                Some(dir) => a.extend([POSIX_CD_EXEC.to_string(), name.to_string(), dir.to_string()]),
                None => a.extend([POSIX_EXEC.to_string(), name.to_string()]),
            }
            a.extend(args.iter().cloned());
            Some(Wrapped { program, args: a, env: Vec::new() })
        }
        Kind::Fish => {
            let mut a: Vec<String> = vec!["-l".into(), "-i".into(), "-c".into()];
            match cwd {
                Some(dir) => a.extend([FISH_CD_EXEC.to_string(), dir.to_string()]),
                None => a.push(FISH_EXEC.to_string()),
            }
            a.push(name.to_string());
            a.extend(args.iter().cloned());
            Some(Wrapped { program, args: a, env: Vec::new() })
        }
    }
}

/// The rc files may change folder; the pane's folder is restored before the agent starts. `$0` is the
/// agent's name, `$1` the folder, the rest its arguments, each its own argv entry (no quoting).
pub const POSIX_CD_EXEC: &str = r#"cd -- "$1" 2>/dev/null; shift; exec "$0" "$@""#;
pub const POSIX_EXEC: &str = r#"exec "$0" "$@""#;
pub const FISH_CD_EXEC: &str = "cd $argv[1] 2>/dev/null; exec $argv[2..-1]";
pub const FISH_EXEC: &str = "exec $argv";

/// The portable-pty command for an agent started through the user's shell, or None to start the
/// program directly (a shell pane, a blank or unknown program, no wrappable shell, an over-long line).
/// The hook for `terminal::Terminals::spawn` and the service's fallback (`pty_service::spawn`).
pub fn via_shell(program: &str, args: &[String], cwd: Option<&str>, settings: &serde_json::Value) -> Option<portable_pty::CommandBuilder> {
    if !wraps(program) {
        return None;
    }
    let w = wrap(&pick(settings)?, program, args, cwd)?;
    let mut c = portable_pty::CommandBuilder::new(w.program.as_os_str());
    c.args(&w.args);
    for (k, v) in &w.env {
        c.env(k, v);
    }
    if let Some(dir) = cwd.filter(|d| Path::new(d).is_dir()) {
        c.cwd(dir);
    }
    Some(c)
}

/// The PowerShell script: back to the pane's folder (a profile may move), find the name the way a
/// typed command is found, run it, and leave with its exit code. `--%` must end its own line.
pub fn powershell_script(name: &str, has_args: bool, cwd: Option<&str>) -> String {
    let n = ps_literal(name);
    let mut s = String::new();
    if let Some(dir) = cwd {
        s.push_str(&format!("Set-Location -LiteralPath {}\n", ps_literal(dir)));
    }
    s.push_str(&format!("$kx = Get-Command -Name {n} -ErrorAction SilentlyContinue | Select-Object -First 1\n"));
    s.push_str(&format!(
        "if ($null -eq $kx) {{ [Console]::Error.WriteLine({}); exit 9009 }}\n",
        ps_literal(&format!("Kolux: PowerShell could not find {name} (its PATH and profile were searched). Install it, or set its command in Settings > Agents."))
    ));
    if !has_args {
        s.push_str("& $kx\nexit $LASTEXITCODE\n");
        return s;
    }
    s.push_str(&format!("$kxa = @($env:{ARGS_ENV}.Split(',') | ForEach-Object {{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }})\n"));
    s.push_str(&format!("Remove-Item Env:{ARGS_ENV} -ErrorAction SilentlyContinue\n"));
    s.push_str("if ($kx.CommandType -eq 'Application') {\n");
    s.push_str(&format!("& $kx.Source --% %{ARGV_ENV}%\n"));
    s.push_str("} else {\n");
    s.push_str(&format!("Remove-Item Env:{ARGV_ENV} -ErrorAction SilentlyContinue\n"));
    s.push_str("& $kx @kxa\n");
    s.push_str("}\nexit $LASTEXITCODE\n");
    s
}

/// A PowerShell single-quoted literal: only `'` (and its typographic forms, which PowerShell also
/// reads as quotes) needs doubling.
pub fn ps_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            out.push(c);
        }
        out.push(c);
    }
    out.push('\'');
    out
}

/// `-EncodedCommand`'s form: base64 of the script's UTF-16LE bytes.
pub fn encode_command(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// One argument as the Microsoft C runtime reads it back: bare when it has no space, tab, newline
/// or `"` and is not empty; else in quotes, with backslashes doubled before a `"` and at the end.
pub fn windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\r', '\u{b}', '"']) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut slashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', slashes * 2));
    out.push('"');
    out
}

/// The arguments as one Windows command line tail.
pub fn windows_command_line(args: &[String]) -> String {
    args.iter().map(|a| windows_arg(a)).collect::<Vec<_>>().join(" ")
}

/// Whether an opening prompt reaches an agent that resolves to a script shim (`.cmd`, `.bat`, `.ps1`)
/// intact on its start line. Such a name runs through PowerShell's own argument binder or cmd.exe,
/// which split or rewrite `"`, `%`, `!`, `^`, `&`, `|`, `<`, `>`, a line break or a trailing
/// backslash; a prompt with any of them is typed in once the agent is ready instead (SESS-032).
pub fn shim_safe(prompt: &str) -> bool {
    !prompt.is_empty() && !prompt.contains(['"', '%', '!', '^', '&', '|', '<', '>', '\r', '\n']) && !prompt.ends_with('\\')
}

/// Whether `resolved` is a script shim rather than a program (`shim_safe`).
pub fn is_script_shim(resolved: &Path) -> bool {
    resolved.extension().is_some_and(|e| ["cmd", "bat", "ps1"].iter().any(|x| e.eq_ignore_ascii_case(x)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// The Microsoft C runtime's reading of a command line tail (2008+ rules), for round trips.
    fn crt_split(line: &str) -> Vec<String> {
        let mut out = Vec::new();
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            while i < chars.len() && (chars[i] == ' ' || chars[i] == '\t') {
                i += 1;
            }
            if i >= chars.len() {
                break;
            }
            let mut arg = String::new();
            let mut quoted = false;
            while i < chars.len() {
                let c = chars[i];
                if c == '\\' {
                    let mut n = 0;
                    while i < chars.len() && chars[i] == '\\' {
                        n += 1;
                        i += 1;
                    }
                    if i < chars.len() && chars[i] == '"' {
                        arg.extend(std::iter::repeat_n('\\', n / 2));
                        if n % 2 == 1 {
                            arg.push('"');
                            i += 1;
                        }
                    } else {
                        arg.extend(std::iter::repeat_n('\\', n));
                    }
                    continue;
                }
                if c == '"' {
                    if quoted && i + 1 < chars.len() && chars[i + 1] == '"' {
                        arg.push('"');
                        i += 2;
                        continue;
                    }
                    quoted = !quoted;
                    i += 1;
                    continue;
                }
                if !quoted && (c == ' ' || c == '\t') {
                    break;
                }
                arg.push(c);
                i += 1;
            }
            out.push(arg);
        }
        out
    }

    /// PowerShell's reading of a single-quoted literal.
    fn ps_unliteral(lit: &str) -> String {
        let inner: Vec<char> = lit.chars().collect();
        assert!(inner.len() >= 2 && inner[0] == '\'' && inner[inner.len() - 1] == '\'');
        let mut out = String::new();
        let mut i = 1;
        while i < inner.len() - 1 {
            let c = inner[i];
            out.push(c);
            if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
                assert_eq!(inner[i + 1], c, "a quote inside a literal is doubled");
                i += 1;
            }
            i += 1;
        }
        out
    }

    fn decode_script(b64: &str) -> String {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let units: Vec<u16> = bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16(&units).unwrap()
    }

    fn hard_args() -> Vec<String> {
        s(&[
            "it's",
            "say \"hi there\"",
            "\"hi there\"",
            "$HOME and `whoami`; rm -rf /",
            "line one\nline two",
            "C:\\dir with space\\",
            "trailing\\",
            "a\\\\\"b",
            "",
            "日本語 é ✓ 🚀",
            "%PATH% 50% !x! ^&|<>",
            "{\"fastMode\":true}",
            "-dash-first prompt",
        ])
    }

    #[test]
    fn plain_shells_and_unknown_programs_are_never_wrapped_and_agents_are() {
        for agent in ["claude", "grok", "codex", "opencode", "claude.exe", r"C:\Users\x\.local\bin\claude.exe"] {
            assert!(wraps(agent), "{agent}");
        }
        for not in ["", "  ", "powershell.exe", "pwsh", "cmd.exe", "bash", "/bin/zsh", "fish", "notepad", "node"] {
            assert!(!wraps(not), "{not:?}");
        }
        assert!(via_shell("powershell.exe", &[], None, &serde_json::json!({})).is_none());
        assert!(via_shell("", &s(&["x"]), None, &serde_json::json!({})).is_none());
    }

    #[test]
    fn shell_kinds() {
        assert_eq!(kind_of(Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")), Some(Kind::PowerShell));
        assert_eq!(kind_of(Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe")), Some(Kind::PowerShell));
        assert_eq!(kind_of(Path::new("/bin/zsh")), Some(Kind::Posix));
        assert_eq!(kind_of(Path::new("/usr/bin/bash")), Some(Kind::Posix));
        assert_eq!(kind_of(Path::new("/opt/homebrew/bin/fish")), Some(Kind::Fish));
        assert_eq!(kind_of(Path::new(r"C:\Windows\System32\cmd.exe")), None);
        assert_eq!(kind_of(Path::new("/usr/bin/nu")), None);
    }

    #[test]
    fn the_shell_is_the_users_powershell_on_windows_and_the_login_shell_elsewhere() {
        let ps5 = || PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        let pwsh = || Some(PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"));
        // Windows: chosen PowerShell wins; a chosen cmd or Git Bash still gets PowerShell; pwsh before 5.1.
        assert_eq!(pick_from(true, Some(ps5()), pwsh, None, ps5), Some(ps5()));
        assert_eq!(pick_from(true, Some(PathBuf::from(r"C:\Windows\System32\cmd.exe")), pwsh, None, ps5), pwsh());
        assert_eq!(pick_from(true, None, pwsh, None, ps5), pwsh());
        assert_eq!(pick_from(true, None, || None, None, ps5), Some(ps5()));
        // Elsewhere: chosen known shell, else an absolute $SHELL of a known kind, else none (direct start).
        assert_eq!(pick_from(false, Some(PathBuf::from("/opt/homebrew/bin/fish")), || None, Some("/bin/zsh".into()), ps5), Some("/opt/homebrew/bin/fish".into()));
        assert_eq!(pick_from(false, None, || None, Some("/bin/zsh".into()), ps5), Some("/bin/zsh".into()));
        assert_eq!(pick_from(false, None, || None, Some("/usr/bin/nu".into()), ps5), None);
        assert_eq!(pick_from(false, None, || None, Some("zsh".into()), ps5), None);
        assert_eq!(pick_from(false, None, || None, None, ps5), None);
        assert!(in_windows_apps(Path::new(r"C:\Users\x\AppData\Local\Microsoft\WindowsApps\pwsh.exe")));
    }

    #[test]
    fn windows_arguments_round_trip_through_the_c_runtime() {
        let args = hard_args();
        assert_eq!(crt_split(&windows_command_line(&args)), args);
        for a in &args {
            assert_eq!(crt_split(&windows_arg(a)), vec![a.clone()], "{a:?}");
        }
        assert_eq!(windows_arg("--model"), "--model", "a plain word stays bare");
        assert_eq!(windows_arg(""), "\"\"");
        assert_eq!(windows_arg("C:\\x y\\"), "\"C:\\x y\\\\\"");
    }

    #[test]
    fn powershell_literals_round_trip() {
        for t in ["claude", "it's", "a''b", "‘curly’ ‚low‛", "$env:X `n", "C:\\Users\\Grok Fan\\grok.exe", ""] {
            assert_eq!(ps_unliteral(&ps_literal(t)), t, "{t:?}");
        }
    }

    fn powershell_case(shell: &str) {
        let args = hard_args();
        let w = wrap(Path::new(shell), "claude", &args, Some(r"C:\work\it's here")).unwrap();
        assert_eq!(w.program, PathBuf::from(shell));
        assert_eq!(&w.args[..2], &s(&["-NoLogo", "-EncodedCommand"])[..]);
        assert!(!w.args.iter().any(|a| a == "-NoExit" || a == "-NoProfile"), "the profile loads and the pane ends with the agent");
        let script = decode_script(&w.args[2]);
        assert!(script.starts_with(&format!("Set-Location -LiteralPath {}\n", ps_literal(r"C:\work\it's here"))));
        assert!(script.contains("Get-Command -Name 'claude' -ErrorAction SilentlyContinue"));
        assert!(script.lines().any(|l| l == "& $kx.Source --% %KOLUX_AGENT_ARGV%"), "stop-parsing ends its own line:\n{script}");
        assert!(script.trim_end().ends_with("exit $LASTEXITCODE"));
        assert!(!script.contains("hi there"), "no argument is inside the script");
        let env: std::collections::HashMap<_, _> = w.env.iter().cloned().collect();
        assert_eq!(crt_split(&env[ARGV_ENV]), args, "the native route reads the arguments back exactly");
        let list: Vec<String> = env[ARGS_ENV].split(',').map(|p| String::from_utf8(base64::engine::general_purpose::STANDARD.decode(p).unwrap()).unwrap()).collect();
        assert_eq!(list, args, "the script route reads them back exactly");
        // No arguments: no variables and no stop-parsing (an unset %VAR% would be passed as text).
        let bare = wrap(Path::new(shell), "grok", &[], None).unwrap();
        assert!(bare.env.is_empty());
        let script = decode_script(&bare.args[2]);
        assert!(!script.contains("--%") && !script.contains("Set-Location") && script.contains("& $kx\n"));
    }

    #[test]
    fn windows_powershell_5_1_line() {
        powershell_case(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
    }

    #[test]
    fn powershell_7_line() {
        powershell_case(r"C:\Program Files\PowerShell\7\pwsh.exe");
    }

    #[test]
    fn zsh_and_bash_lines_pass_each_argument_as_its_own_argv_entry() {
        let args = hard_args();
        for shell in ["/bin/zsh", "/bin/bash"] {
            let w = wrap(Path::new(shell), "claude", &args, Some("/home/me/it's here")).unwrap();
            let mut want = s(&["-l", "-i", "-c", POSIX_CD_EXEC, "claude", "/home/me/it's here"]);
            want.extend(args.iter().cloned());
            assert_eq!(w.args, want);
            assert!(w.env.is_empty());
            let bare = wrap(Path::new(shell), "grok", &[], None).unwrap();
            assert_eq!(bare.args, s(&["-l", "-i", "-c", POSIX_EXEC, "grok"]));
        }
        let fish = wrap(Path::new("/usr/bin/fish"), "codex", &s(&["--model", "o"]), Some("/w")).unwrap();
        assert_eq!(fish.args, s(&["-l", "-i", "-c", FISH_CD_EXEC, "/w", "codex", "--model", "o"]));
        assert!(wrap(Path::new("/usr/bin/nu"), "claude", &[], None).is_none());
        assert!(wrap(Path::new("/bin/zsh"), " ", &[], None).is_none());
    }

    #[test]
    fn each_agents_line_survives_the_wrap() {
        let ps = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        let none = serde_json::json!({});
        for (id, prompt) in [("claude", "fix \"the\" bug; it's 50% done"), ("grok", "-rm everything"), ("codex", "go"), ("opencode", "say hi")] {
            let line = crate::agents::start_line(&none, id, &[], prompt, true).unwrap();
            let w = wrap(ps, id, &line.args, Some(r"C:\w")).unwrap();
            let env: std::collections::HashMap<_, _> = w.env.iter().cloned().collect();
            assert_eq!(crt_split(&env[ARGV_ENV]), line.args, "{id}");
            let z = wrap(Path::new("/bin/zsh"), id, &line.args, None).unwrap();
            assert_eq!(&z.args[5..], &line.args[..], "{id}");
        }
        let grok = crate::agents::start_line(&none, "grok", &[], "-rm everything", true).unwrap();
        let w = wrap(ps, "grok", &grok.args, None).unwrap();
        assert!(w.env[0].1.ends_with("-- \"-rm everything\""), "the end-of-options mark stays in front of a dash prompt: {}", w.env[0].1);
    }

    #[test]
    fn an_over_long_line_is_not_wrapped() {
        let ps = Path::new("powershell.exe");
        assert!(wrap(ps, "claude", &[ "x".repeat(MAX_ENV_VALUE + 1) ], None).is_none());
        assert!(wrap(ps, "claude", &[ "x".repeat(20_000) ], None).is_some());
    }

    #[test]
    fn prompts_for_script_shims() {
        assert!(shim_safe("fix the login bug"));
        for bad in ["say \"hi\"", "50%", "a & b", "x\ny", "dir\\", "", "wow!"] {
            assert!(!shim_safe(bad), "{bad:?}");
        }
        assert!(is_script_shim(Path::new(r"C:\npm\codex.CMD")) && is_script_shim(Path::new("x.ps1")));
        assert!(!is_script_shim(Path::new(r"C:\x\claude.exe")));
    }

    /// Manual proof on a real machine (cargo test agent_shell -- --ignored --nocapture): each installed
    /// agent started through the wrapper with a question that opens no session.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_agents_answer_through_windows_powershell() {
        let ps = crate::pty::system_program(crate::pty::WINDOWS_POWERSHELL);
        let cwd = std::env::temp_dir();
        for (name, args) in [("claude", vec!["--version"]), ("grok", vec!["--help"]), ("codex", vec!["--version"]), ("opencode", vec!["--version"])] {
            let args: Vec<String> = args.into_iter().map(String::from).collect();
            let w = wrap(&ps, name, &args, cwd.to_str()).unwrap();
            let out = std::process::Command::new(&w.program).args(&w.args).envs(w.env.iter().cloned()).current_dir(&cwd).output().unwrap();
            let text = String::from_utf8_lossy(&out.stdout);
            println!("{name}: exit {:?}; first line {:?}; stderr {:?}", out.status.code(), text.lines().find(|l| !l.trim().is_empty()), String::from_utf8_lossy(&out.stderr).lines().next());
        }
    }

    /// The real thing on this machine: Windows PowerShell runs the script with the user's profile and
    /// hands node every hard argument intact, by the native route and by the script route.
    #[cfg(windows)]
    #[test]
    fn windows_powershell_delivers_every_argument_intact() {
        let Some(node) = crate::agents::find_program("node.exe") else { return };
        let ps = crate::pty::system_program(crate::pty::WINDOWS_POWERSHELL);
        if !ps.is_file() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("kolux-agent-shell-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let echo = dir.join("echo.js");
        std::fs::write(&echo, "process.stdout.write('ARGS:' + Buffer.from(JSON.stringify(process.argv.slice(2))).toString('base64') + '\\n')").unwrap();
        let shim = dir.join("kxecho.ps1");
        std::fs::write(&shim, format!("& '{}' '{}' $args\n", node.display(), echo.display())).unwrap();
        let run = |name: &str, args: &[String]| -> Vec<String> {
            let w = wrap(&ps, name, args, Some(dir.to_str().unwrap())).unwrap();
            let mut c = std::process::Command::new(&w.program);
            c.args(&w.args).envs(w.env.iter().cloned()).current_dir(&dir);
            let out = c.output().unwrap();
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            let line = text.lines().rev().find_map(|l| l.strip_prefix("ARGS:")).unwrap_or_else(|| panic!("no answer: {text} {}", String::from_utf8_lossy(&out.stderr)));
            serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(line).unwrap()).unwrap()
        };
        // Native route: everything, quotes with spaces included.
        let mut args = vec![echo.display().to_string()];
        args.extend(hard_args());
        assert_eq!(run(node.to_str().unwrap(), &args)[..], hard_args()[..]);
        // Script route (an npm .ps1 shim): PowerShell's binder; Kolux keeps risky prompts off it.
        let safe = s(&["--model", "opus", "fix the login bug", "{\"fastMode\":true}", "日本語 é", "C:\\dir with space\\x"]);
        let got = run(shim.to_str().unwrap(), &safe);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(got[..2], safe[..2]);
        assert_eq!(got[2], safe[2]);
        assert_eq!(got[4..], safe[4..]);
    }
}
