//! One shell session behind a pseudo-terminal (PTY).
//!
//! A `PtySession` owns the PTY master, the child's writer and a way to kill the child. Output is
//! pumped on a reader thread to a callback; a second thread waits for the child and reports its
//! exit. Dropping the session (or calling `kill`) ends the program, by force if it does not leave.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

/// T-075-b: the background terminal service that owns terminals so they outlive the window.
#[path = "pty_service.rs"]
pub mod service;

/// Fix-term 801: the output watcher that restores the pty size after a text-area request.
#[path = "pty_window_ops.rs"]
mod window_ops;

/// Fix-term 787: the PTY reader's output, batched.
#[path = "pty_pump.rs"]
mod pump;

/// T-184-b: the window's side of the service (panes routed through it, taken back after a restart).
#[path = "pty_link.rs"]
pub mod link;

/// TERM-098 (Windows): a terminal's reply to a program's colour question (OSC 4/10/11/12 with
/// `rgb:`) or light/dark question (CSI ? 997 ; 1|2 n) reaches the console layer as plain bytes,
/// and it drops them, since it parses input only for the sequences it knows. Written as
/// win32-input-mode key events (one per character, the console's own keyboard encoding, which it
/// asks for with CSI ? 9001 h) they reach the program untouched.
pub fn is_reply(data: &[u8]) -> bool {
    data.starts_with(b"\x1b]") || data.starts_with(b"\x1b[?997;")
}

/// `data` as win32-input-mode key events: `CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` per character, a
/// key-down then a key-up with the character and no virtual key. The key-up matters: a run of
/// identical key-downs is coalesced by the console into one repeated key, and a reader then sees
/// one character too many (measured: `dddd` read back as `ddddd`).
pub fn as_key_events(data: &[u8]) -> Vec<u8> {
    String::from_utf8_lossy(data).chars().map(|c| format!("\x1b[0;0;{0};1;0;1_\x1b[0;0;{0};0;0;1_", c as u32)).collect::<String>().into_bytes()
}

/// ACCT-046: the shells an automatic pick tries, best first. On Windows: PowerShell 7 (passed over
/// when the copy found is a Microsoft Store alias), then Windows PowerShell, then the command
/// prompt, which is always last, found through the system's ComSpec setting when that is set, and
/// started in UTF-8. Elsewhere the login shell, else sh.
// ponytail: PowerShell gets no prompt markers yet; nothing in Kolux reads them (DT-R36).
pub fn auto_shells(find: impl Fn(&str) -> Option<PathBuf>, comspec: Option<PathBuf>) -> Vec<(PathBuf, Vec<&'static str>)> {
    if !cfg!(windows) {
        return vec![(std::env::var_os("SHELL").map(PathBuf::from).unwrap_or_else(|| "/bin/sh".into()), Vec::new())];
    }
    let mut out = Vec::new();
    out.extend(find("pwsh.exe").filter(|p| !store_alias(p)).map(|p| (p, vec!["-NoLogo"])));
    out.extend(find("powershell.exe").map(|p| (p, vec!["-NoLogo"])));
    // T-660: the command prompt from Windows' own folder, never a lookup that could reach the current one.
    let cmd = comspec.filter(|p| p.is_absolute() && p.is_file()).unwrap_or_else(|| system_program("cmd.exe"));
    out.push((cmd, CMD_ARGS.to_vec()));
    out
}

/// The command prompt, switched to UTF-8 before its first prompt.
// T-660: chcp by its full path too, or cmd.exe looks for it in the pane's folder first. Built once.
static CMD_ARGS: std::sync::LazyLock<[&'static str; 4]> =
    std::sync::LazyLock::new(|| ["/k", Box::leak(system_program("chcp.com").to_string_lossy().into_owned().into_boxed_str()), "65001", ">nul"]);

/// A Microsoft Store app alias: a stand-in under WindowsApps rather than the program itself.
fn store_alias(p: &Path) -> bool {
    p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("WindowsApps"))
}

/// ACCT-046 with SET-026: the chosen default shell (when there is one) is tried first and the
/// automatic shells stay behind it as fallbacks, without the chosen one twice.
pub fn chosen_then_auto(chosen: Option<(String, Vec<String>)>, auto: Vec<(PathBuf, Vec<&'static str>)>) -> Vec<(PathBuf, Vec<String>)> {
    let same = |a: &Path, b: &Path| a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy());
    let first = chosen.map(|(p, a)| (PathBuf::from(p), a));
    let rest = auto.into_iter().filter(|(p, _)| !first.as_ref().is_some_and(|(f, _)| same(f, p))).map(|(p, a)| (p, a.into_iter().map(String::from).collect()));
    first.clone().into_iter().chain(rest).collect()
}

/// The shells a new pane tries in turn (ACCT-046): `chosen`, the default shell from settings
/// (SET-026), first, then the automatic ones; each starts in `cwd`, or in the home folder when
/// there is none. ACCT-049: on Windows the home folder is the home drive plus the home path
/// when that folder exists, else the user profile.
pub fn shell_commands(cwd: Option<&str>, chosen: Option<(String, Vec<String>)>) -> Vec<CommandBuilder> {
    let dir = cwd.map(PathBuf::from).or_else(home_dir);
    let chain = if cfg!(windows) {
        chosen_then_auto(chosen, auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)))
    } else {
        // ACCT-065: a bare name is passed through alone; a missing full path falls back to zsh, bash, sh.
        let login = std::env::var("SHELL").ok();
        crate::shell_marks::unix_shell_chain(chosen.as_ref().map(|(c, a)| (c.as_str(), a.as_slice())), login.as_deref(), |p| p.is_file())
    };
    chain
        .into_iter()
        .map(|(program, args)| {
            let mut c = CommandBuilder::new(program);
            c.args(args);
            if let Some(d) = &dir {
                c.cwd(d);
            }
            c
        })
        .collect()
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    if !cfg!(windows) {
        return std::env::var_os("HOME").map(PathBuf::from);
    }
    let joined = std::env::var_os("HOMEDRIVE").zip(std::env::var_os("HOMEPATH")).map(|(mut d, p)| {
        d.push(p);
        PathBuf::from(d)
    });
    joined.filter(|p| p.is_dir()).or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// TERM-120: the PATH a new terminal gets, built the way Windows builds one for a program started
/// from the desktop: the machine Path, then the user Path, as the registry holds them now with
/// `%VAR%`s expanded (RegGetValueW does that for a REG_EXPAND_SZ asked for as RRF_RT_REG_SZ). It is
/// read again for every terminal, so a folder added in Windows settings reaches the next pane
/// without restarting Kolux. When neither value can be read, the last good read is kept, and before
/// any good read the PATH Kolux itself inherited stands. Empty entries are dropped; the order and
/// duplicates are left as the user set them, the way the system does.
pub fn terminal_path(machine: Option<&str>, user: Option<&str>, last_good: &Mutex<Option<std::ffi::OsString>>, inherited: Option<std::ffi::OsString>) -> std::ffi::OsString {
    if machine.is_none() && user.is_none() {
        return last_good.lock().ok().and_then(|g| g.clone()).or(inherited).unwrap_or_default();
    }
    let dirs: Vec<PathBuf> = machine.into_iter().chain(user).flat_map(|p| std::env::split_paths(p).collect::<Vec<_>>()).filter(|d| !d.as_os_str().is_empty()).collect();
    let joined = std::env::join_paths(&dirs).unwrap_or_else(|_| dirs.iter().map(|d| d.as_os_str().to_string_lossy()).collect::<Vec<_>>().join(";").into());
    if let Ok(mut g) = last_good.lock() {
        *g = Some(joined.clone());
    }
    joined
}

/// TERM-120: the fresh PATH for a terminal started now (see `terminal_path`); elsewhere than
/// Windows the inherited PATH is it, the login shell reads its own files.
#[cfg(windows)]
pub fn fresh_terminal_path(inherited: Option<std::ffi::OsString>) -> std::ffi::OsString {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    static LAST_GOOD: Mutex<Option<std::ffi::OsString>> = Mutex::new(None);
    let machine = crate::agents::registry_string(HKEY_LOCAL_MACHINE, crate::agents::MACHINE_ENVIRONMENT, "Path");
    let user = crate::agents::registry_string(HKEY_CURRENT_USER, "Environment", "Path");
    terminal_path(machine.as_deref(), user.as_deref(), &LAST_GOOD, inherited)
}

#[cfg(not(windows))]
pub fn fresh_terminal_path(inherited: Option<std::ffi::OsString>) -> std::ffi::OsString {
    inherited.unwrap_or_default()
}

/// ACCT-049: whether a pane may start in `dir`. A folder that is gone, or on a drive that is not
/// connected, gets a message instead of a silent start somewhere else, and an `agent` never
/// starts by itself in the root of a drive. The check stops waiting after two seconds, so a
/// network drive that does not answer cannot hold the app.
// ponytail: each pane waits on its own, so many panes on a dead drive wait two seconds each; share
// one answer per drive if that ever bites.
pub fn check_start_dir(dir: &str, agent: bool) -> Result<(), String> {
    let path = PathBuf::from(dir);
    let (tx, rx) = std::sync::mpsc::channel();
    let probe = path.clone();
    thread::spawn(move || {
        let root: PathBuf = probe.components().take_while(|c| matches!(c, Component::Prefix(_) | Component::RootDir)).collect();
        let _ = tx.send((probe.is_dir(), root.as_os_str().is_empty() || root.exists(), root));
    });
    let Ok((is_dir, mounted, root)) = rx.recv_timeout(Duration::from_secs(2)) else {
        return Err(format!("The folder {dir} is not answering. If it is on a network or external drive, check that the drive is connected, then open the pane again."));
    };
    if !mounted {
        return Err(format!("The drive {} is not connected, so {dir} cannot be opened. Plug the drive in or reconnect it, then open the pane again.", root.display()));
    }
    if !is_dir {
        return Err(format!("The folder {dir} no longer exists. It may have been moved or deleted; open the project from where it is now."));
    }
    if agent && path.parent().is_none() {
        return Err(format!("Kolux does not start an agent by itself in {dir}, the root of a drive. Open a project folder and start it there."));
    }
    Ok(())
}

/// Whether a pane's program is one of the shells rather than an agent (ACCT-049).
pub fn is_shell_program(program: &str) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    ["pwsh", "powershell", "cmd", "bash", "wsl", "zsh", "fish", "sh"].contains(&stem.as_str())
}

/// ACCT-048: an inherited variable a pane should not see: Kolux's own runtime and build ones
/// (Tauri, WebView2, a cargo or npm script run) or a conda activation that came along only in part.
/// CLI-010: also another copy's data-folder override (KOLUX_USER_DATA_PATH), which a Kolux started
/// from that copy's terminal inherits and which would send this pane's commands to the other app.
// ponytail: the folders a dev run puts on PATH stay; strip them if a dev build's panes ever mislead.
pub fn inherited_noise(name: &str) -> bool {
    const PREFIXES: [&str; 9] = ["TAURI_", "__TAURI", "WEBVIEW2_", "CARGO_PKG_", "CARGO_MANIFEST_", "CARGO_BIN_", "npm_", "PNPM_SCRIPT_", "CONDA_PREFIX"];
    const NAMES: [&str; 7] = ["CARGO_CRATE_NAME", "CARGO_PRIMARY_PACKAGE", "INIT_CWD", "CONDA_DEFAULT_ENV", "CONDA_SHLVL", "CONDA_PROMPT_MODIFIER", "KOLUX_USER_DATA_PATH"];
    PREFIXES.iter().any(|p| name.starts_with(p)) || NAMES.contains(&name)
}

/// SESS-006: a shell the create menu offers, one item each. The first is the one Ctrl+T opens.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ShellInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub program: String,
    pub args: Vec<String>,
}

/// The installed shells: on Windows, Windows PowerShell (always there), PowerShell 7, Command
/// Prompt, Git Bash and WSL when found, PowerShell 7 first when it is installed; elsewhere the login shell, then bash, zsh and fish.
pub fn shells(find: impl Fn(&str) -> Option<std::path::PathBuf>) -> Vec<ShellInfo> {
    let mut out: Vec<ShellInfo> = Vec::new();
    let mut add = |id, name, program: Option<std::path::PathBuf>, args: &[&str]| {
        if let Some(p) = program {
            let program = p.to_string_lossy().into_owned();
            if !out.iter().any(|s| s.program.eq_ignore_ascii_case(&program)) {
                out.push(ShellInfo { id, name, program, args: args.iter().map(|a| a.to_string()).collect() });
            }
        }
    };
    if cfg!(windows) {
        // ACCT-046: the automatic pick's order, so the first item (the one Ctrl+T opens) names it.
        let pwsh = find("pwsh.exe");
        add("pwsh", "PowerShell 7", pwsh.clone().filter(|p| !store_alias(p)), &["-NoLogo"]);
        add("powershell", "Windows PowerShell", Some(find("powershell.exe").unwrap_or_else(|| system_program(WINDOWS_POWERSHELL))), &["-NoLogo"]);
        add("pwsh", "PowerShell 7", pwsh, &["-NoLogo"]);
        add("cmd", "Command Prompt", Some(system_program("cmd.exe")), &*CMD_ARGS);
        // Git for Windows' own bash, never the WSL launcher that System32 calls bash.exe.
        let git = std::env::var_os("ProgramFiles").map(|p| std::path::PathBuf::from(p).join("Git").join("bin").join("bash.exe")).filter(|p| p.is_file());
        add("gitbash", "Git Bash", git, &["--login", "-i"]);
        // wsl.exe ships with Windows even with no Linux installed; it counts once a distribution is.
        add("wsl", "WSL", find("wsl.exe").filter(|_| wsl_has_distro()), &[]);
    } else {
        add("login", "Login shell", std::env::var_os("SHELL").map(std::path::PathBuf::from), &[]);
        add("bash", "bash", find("bash"), &[]);
        add("zsh", "zsh", find("zsh"), &[]);
        add("fish", "fish", find("fish"), &[]);
    }
    out
}

/// WSL keeps its default distribution under the user's Lxss key once one is installed.
#[cfg(windows)]
fn wsl_has_distro() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_ANY};
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (key, name) = (wide(r"Software\Microsoft\Windows\CurrentVersion\Lxss"), wide("DefaultDistribution"));
    let mut len = 0u32;
    // SAFETY: both strings are NUL-terminated and live across the call; only the size is asked for.
    unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_ANY, std::ptr::null_mut(), std::ptr::null_mut(), &mut len) == 0 }
}
#[cfg(not(windows))]
fn wsl_has_distro() -> bool {
    false
}

/// SET-026: the settings field naming the shell new terminals open in ("auto" or a shell id).
pub const DEFAULT_SHELL_FIELD: &str = "defaultShell";

/// SET-026: the list with the chosen default shell first, so the item Ctrl+T opens names it. A
/// choice that is not installed (or "auto") leaves the automatic order.
pub fn chosen_first(mut list: Vec<ShellInfo>, settings: &serde_json::Value) -> Vec<ShellInfo> {
    let choice = shell_choice(settings);
    if let Some(i) = list.iter().position(|s| Some(s.id) == choice) {
        let chosen = list.remove(i);
        list.insert(0, chosen);
    }
    list
}

/// SET-026: the program and arguments a plain new terminal starts with, when a default is chosen.
pub fn default_shell(settings: &serde_json::Value) -> Option<(String, Vec<String>)> {
    let choice = shell_choice(settings)?;
    let first = chosen_first(shells(crate::agents::find_program), settings).into_iter().next()?;
    (first.id == choice).then_some((first.program, first.args))
}

/// SET-025/026 (after-list #180): the settings field of the PowerShell version card ("auto", "7" or "5").
pub const POWERSHELL_VERSION_FIELD: &str = "powershellVersion";

/// SET-026: the shell id new terminals open in, or None for the automatic order. A default shell that is not a
/// PowerShell wins; otherwise the PowerShell version card ("7" = pwsh, "5" = Windows PowerShell) picks which
/// PowerShell, the same rule as the settings page's pickPowerShell; "auto" keeps a chosen PowerShell as it is.
pub fn shell_choice(settings: &serde_json::Value) -> Option<&str> {
    let shell = settings.get(DEFAULT_SHELL_FIELD).and_then(serde_json::Value::as_str).filter(|c| *c != "auto");
    if shell.is_some_and(|s| s != "pwsh" && s != "powershell") {
        return shell;
    }
    match settings.get(POWERSHELL_VERSION_FIELD).and_then(serde_json::Value::as_str) {
        Some("7") => Some("pwsh"),
        Some("5") => Some("powershell"),
        _ => shell,
    }
}

pub fn shell_list_on(store: &Mutex<crate::state::Store>) -> Vec<ShellInfo> {
    let settings = store.lock().map(|s| s.settings()).unwrap_or_default();
    chosen_first(shells(crate::agents::find_program), &settings)
}

/// Async so the PATH probe (up to 240 ms) runs off the UI thread, which a sync command would hold.
#[tauri::command]
pub async fn shell_list(app: tauri::AppHandle) -> Vec<ShellInfo> {
    tauri::async_runtime::spawn_blocking(move || shell_list_on(&tauri::Manager::state::<Mutex<crate::state::Store>>(&app))).await.unwrap_or_default()
}

/// TERM-040: where a new terminal starts. A requested folder may be relative to the workspace or
/// an absolute folder outside it; a missing one falls back to the workspace folder.
pub fn start_dir(workspace: &str, requested: Option<&str>) -> String {
    let Some(req) = requested.map(str::trim).filter(|r| !r.is_empty()) else { return workspace.to_string() };
    let path = std::path::Path::new(workspace).join(req);
    if path.is_dir() { path.to_string_lossy().into_owned() } else { workspace.to_string() }
}

/// A pane that runs one program (an agent such as `claude`) instead of a shell. `program` is
/// resolved the way a shell would (`claude` becomes `...\claude.exe`) so the process starts
/// without a shell in between; a name that does not resolve to a full path is passed through
/// unchanged, never wrapped in cmd.exe (which would look it up in `cwd`), and the spawn looks it
/// up in full-path folders only or refuses it by name (T-660). A Windows command-script shim is
/// started the way `start_line` says. Starts in `cwd` when that folder exists.
pub fn program_command(program: &str, args: &[String], cwd: Option<&str>) -> CommandBuilder {
    match full_path_program(program) {
        Some(resolved) => command_for(&resolved, args, cwd, cfg!(windows)),
        None => command_for(Path::new(program), args, cwd, false),
    }
}

/// T-663: `name` by a full path, for a program Kolux starts itself: a bare name is looked up in
/// full-path folders only (as for finding agents), and a name with a folder in it must already be a
/// full path to a runnable file. None otherwise, so no start resolves through the current folder.
pub(crate) fn full_path_program(name: &str) -> Option<PathBuf> {
    crate::agents::find_program(name).filter(|p| p.is_absolute())
}

/// T-663: Windows PowerShell under the system folder (`system_program`).
pub(crate) const WINDOWS_POWERSHELL: &str = r"WindowsPowerShell\v1.0\powershell.exe";

/// T-660: a program that ships with Windows, by its full path in the system folder Windows reports
/// (else %SystemRoot%\System32), so no lookup by bare name can reach a copy planted in the current
/// folder.
pub(crate) fn system_program(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(dir) = crate::resources::update_guard::system_dir() {
            return dir.join(name);
        }
    }
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).filter(|r| r.is_absolute());
    root.unwrap_or_else(|| r"C:\Windows".into()).join("System32").join(name)
}

/// `program_command` once the program is found, under Windows' start rules or not (`windows`), so
/// a test builds the Windows start line on any system.
fn command_for(resolved: &Path, args: &[String], cwd: Option<&str>, windows: bool) -> CommandBuilder {
    let (exe, head) = start_line_on(resolved, windows);
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(head);
    cmd.args(args);
    if let Some(dir) = cwd.filter(|d| std::path::Path::new(d).is_dir()) {
        cmd.cwd(dir);
    }
    cmd
}

/// What is started for `resolved`: the file itself; for npm's shim of an agent (`gemini.cmd`, made
/// by `npm install -g`) the program the shim would run, node on the package's script, so no command
/// shell reads the arguments (T-605: cmd.exe honours no quoting of them, so a GitHub title with `"`
/// and `&` in an opening prompt could run a command, and it cuts a prompt at its first line break);
/// for any other `.cmd` / `.bat`, `cmd.exe` with `/d /c <shim>` in front of the program's own
/// arguments, and then the opening prompt is typed in after start instead (`agents::launch_line`).
// ponytail: only npm's own shim is read (cmd-shim 7, npm 7 and later); pnpm's (it sets NODE_PATH),
// yarn's or a hand-written launcher still go through cmd.exe with no prompt on their line; read
// their shapes too if their typed-in prompt is ever too slow.
pub fn start_line(resolved: &std::path::Path) -> (std::ffi::OsString, Vec<std::ffi::OsString>) {
    start_line_on(resolved, cfg!(windows))
}

/// Whether `resolved` starts through cmd.exe (T-605).
pub fn through_cmd(resolved: &Path) -> bool {
    start_line(resolved).0 == system_program("cmd.exe").as_os_str()
}

/// `start_line` under Windows' rules or not (`windows`), so a test builds the Windows line anywhere.
pub(crate) fn start_line_on(resolved: &Path, windows: bool) -> (std::ffi::OsString, Vec<std::ffi::OsString>) {
    let shim = windows
        && resolved
            .extension()
            .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
            .unwrap_or(false);
    if !shim {
        return (resolved.as_os_str().to_owned(), Vec::new());
    }
    npm_target(resolved).unwrap_or_else(|| (system_program("cmd.exe").into_os_string(), vec!["/d".into(), "/c".into(), resolved.as_os_str().to_owned()]))
}

/// T-605: what npm's shim at `shim` runs, read from the shim as npm writes it: `"%_prog%"
/// "%dp0%\<script>" %*` with `_prog` set to node (the node.exe beside the shim, else the one on the
/// PATH, as the shim itself picks), or `"%dp0%\<file>.exe" %*` for a package whose program is its
/// own `.exe`. None for anything else, or when the file it names is not there.
fn npm_target(shim: &Path) -> Option<(std::ffi::OsString, Vec<std::ffi::OsString>)> {
    if std::fs::metadata(shim).ok()?.len() > 4096 {
        return None;
    }
    let text = std::fs::read_to_string(shim).ok()?;
    if !text.contains("SET dp0=%~dp0") || text.contains("NODE_PATH") {
        return None;
    }
    let dir = shim.parent()?;
    let run = text.lines().map(str::trim).find(|l| l.ends_with("%*"))?;
    let (before, target) = run.strip_suffix("%*")?.trim_end().strip_suffix('"')?.rsplit_once('"')?;
    let file = dir.join(target.strip_prefix("%dp0%\\")?.replace('\\', std::path::MAIN_SEPARATOR_STR));
    if !file.is_file() {
        return None;
    }
    let before = before.trim_end();
    if before.ends_with("\"%_prog%\"") && text.contains("SET \"_prog=%dp0%\\node.exe\"") {
        let beside = dir.join("node.exe");
        let node = if beside.is_file() { beside } else { crate::agents::find_program("node.exe")? };
        return Some((node.into_os_string(), vec![file.into_os_string()]));
    }
    (before.is_empty() && file.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe"))).then(|| (file.into_os_string(), Vec::new()))
}

/// The program's input, behind its own lock (council D2 MERGE 31 item 1): a caller clones it out of
/// the session registry and writes without holding the registry, so one pane's slow paste (ConPTY
/// takes input at ~12 KB/s) never stalls another pane's bookkeeping. One lock per session keeps
/// that session's writes in order.
pub type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Writes `data` to a session's input: the reply-to-query conversion on Windows, then the write
/// and flush under the writer's own lock. A poisoned lock (a writer panicked mid-write) is used
/// anyway: the pipe is still the pipe.
pub fn write_shared(writer: &SharedWriter, data: &[u8]) -> Result<(), String> {
    let keyed;
    let data = if cfg!(windows) && is_reply(data) {
        keyed = as_key_events(data);
        &keyed[..]
    } else {
        data
    };
    let mut w = writer.lock().unwrap_or_else(PoisonError::into_inner);
    w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
}

pub struct PtySession {
    master: Option<window_ops::SharedMaster>,
    /// Row 801: the page's latest size, which the output watcher re-applies.
    size: Option<Arc<window_ops::SizeKeeper>>,
    writer: Option<SharedWriter>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    /// The program that started (ACCT-046: an automatic shell may be a fallback).
    program: String,
    /// APP-053 / ACCT-051: the job that holds the program and everything it starts; closed last,
    /// after the PTY, so the pane's whole tree ends with it and no other pane's.
    job: Option<crate::procs::Job>,
}

/// A shell by the name the create menu gives it (FIX-2, council AFTER 4); anything else by its
/// file name.
fn menu_name(p: &str) -> String {
    let file = p.rsplit(['/', '\\']).next().filter(|f| !f.is_empty()).unwrap_or(p);
    let low = file.to_ascii_lowercase();
    let stem = low.strip_suffix(".exe").unwrap_or(&low);
    let git = p.to_ascii_lowercase().replace('/', "\\").contains("\\git\\");
    match stem {
        "pwsh" => "PowerShell 7".to_string(),
        "powershell" => "Windows PowerShell".to_string(),
        "cmd" => "Command Prompt".to_string(),
        "wsl" => "WSL".to_string(),
        "bash" if git => "Git Bash".to_string(),
        _ => file.to_string(),
    }
}

/// Council FS 2 on ACCT-046: when a shell earlier in the list did not start, the pane opens with
/// one dim line naming it and the shell that opened instead, so a fallback is never silent.
fn fallback_note(failed: &[(String, String)], opened: &str) -> Option<String> {
    let (first, _) = failed.first()?;
    Some(format!("\x1b[2m{} did not start; opened {}\x1b[0m\r\n", menu_name(first), menu_name(opened)))
}

/// T-660: where a program named without a full path is found for `cmd`: in the full-path folders
/// of the PATH the pane is given, then the app's own search folders. A name with a separator or a
/// drive in it (`./x`, `bin\x`, `C:x`, `x/`) is never looked up.
fn resolve_bare(cmd: &CommandBuilder, name: &str) -> Option<PathBuf> {
    if name.contains(['/', '\\', ':']) {
        return None;
    }
    let mut dirs: Vec<PathBuf> = cmd.get_env("PATH").map(|p| std::env::split_paths(p).filter(|d| d.is_absolute() && d.is_dir()).collect()).unwrap_or_default();
    dirs.extend(crate::agents::search_dirs());
    crate::agents::find_in(&dirs, name).filter(|p| p.is_absolute())
}

/// T-663: what a start that failed says. On Windows the terminal library's message quotes the whole
/// command line (an opening prompt included); only the program's name and the system's reason are kept.
fn spawn_error(name: &str, text: &str) -> String {
    text.rsplit_once(" failed: ").map_or_else(|| text.to_string(), |(_, why)| format!("{name} could not be started: {why}"))
}

impl PtySession {
    /// Spawns `cmd` in a fresh PTY of `cols` x `rows`. `on_output` receives every chunk the program
    /// prints; `on_exit` runs once with the exit code when the program ends.
    pub fn spawn(
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        Self::spawn_first(vec![cmd], cols, rows, on_output, on_exit)
    }

    /// ACCT-046: tries each of `cmds` in turn and keeps the first that starts, so a shell that is
    /// refused (access denied, say) gives way to the next one; the error names each that failed.
    pub fn spawn_first(
        cmds: Vec<CommandBuilder>,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut failed = Vec::new();
        let mut started = None;
        for mut cmd in cmds {
            let name = cmd.get_argv().first().map(|a| a.to_string_lossy().into_owned()).unwrap_or_default();
            // T-660: a program named without a full path is looked up only in full-path folders (the
            // pane's own PATH, then the app's search folders), never in the pane's folder or the
            // app's own (Windows and this library both would); one not found there is refused.
            if !name.is_empty() && !Path::new(&name).is_absolute() {
                match resolve_bare(&cmd, &name) {
                    // A command script found this way starts the way every other one does (T-605).
                    Some(p) => {
                        let (exe, head) = start_line_on(&p, cfg!(windows));
                        cmd.get_argv_mut().splice(0..1, std::iter::once(exe).chain(head));
                    }
                    None => {
                        failed.push((name.clone(), format!("{name} was not found on this PC, so Kolux did not start it")));
                        continue;
                    }
                }
            }
            match pair.slave.spawn_command(cmd) {
                Ok(c) => {
                    started = Some((c, name));
                    break;
                }
                Err(e) => failed.push((name.clone(), spawn_error(&name, &e.to_string()))),
            }
        }
        let Some((mut child, program)) = started else {
            return Err(match failed.len() {
                1 => failed.remove(0).1,
                _ => format!("No shell would start. Kolux tried {}.", failed.iter().map(|(n, e)| format!("{n} ({e})")).collect::<Vec<_>>().join(", ")),
            });
        };
        drop(pair.slave);
        let note = fallback_note(&failed, &program);
        let killer = child.clone_killer();
        let pid = child.process_id();
        let job = crate::procs::pane_job(&*child);
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let master: window_ops::SharedMaster = Arc::new(Mutex::new(pair.master));
        let size = window_ops::SizeKeeper::new(&master, cols, rows);

        pump::start(reader, note, window_ops::guarded(size.clone(), on_output))?;
        thread::Builder::new()
            .name("pty-waiter".into())
            .spawn(move || {
                let code = child.wait().ok().map(|s| s.exit_code());
                on_exit(code);
            })
            .map_err(|e| e.to_string())?;

        Ok(Self { master: Some(master), size: Some(size), writer: Some(Arc::new(Mutex::new(writer))), killer, pid, program, job })
    }

    /// A session over a fake writer, for tests of the write path with no PTY behind it.
    #[cfg(any(test, feature = "test-fakes"))]
    pub fn fake(writer: Box<dyn Write + Send>) -> Self {
        #[derive(Debug)]
        struct NoChild;
        impl ChildKiller for NoChild {
            fn kill(&mut self) -> std::io::Result<()> {
                Ok(())
            }
            fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
                Box::new(NoChild)
            }
        }
        Self { master: None, size: None, writer: Some(Arc::new(Mutex::new(writer))), killer: Box::new(NoChild), pid: None, program: "fake".into(), job: None }
    }

    /// Sends keystrokes (already encoded as the terminal would) to the program.
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        write_shared(&self.writer()?, data)
    }

    /// The program's input, to write to without holding whatever holds the session.
    pub fn writer(&self) -> Result<SharedWriter, String> {
        self.writer.clone().ok_or_else(|| "session already closed".to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let m = self.master.as_ref().ok_or("session already closed")?;
        let m = m.lock().map_err(|_| "pty lock poisoned".to_string())?;
        if let Some(size) = &self.size {
            size.set(cols, rows);
        }
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
    }

    /// The program that started.
    pub fn program(&self) -> &str {
        &self.program
    }

    /// The started program's process id, when the platform reports one.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// ACCT-050: the terminal's foreground process group (not on Windows, which has none).
    pub fn foreground_group(&self) -> Option<i32> {
        #[cfg(unix)]
        {
            self.master.as_ref().and_then(|m| m.lock().ok()?.process_group_leader())
        }
        #[cfg(not(unix))]
        {
            None
        }
    }

    /// Ends the program: closes its input, forces it to stop, releases the PTY so the reader
    /// thread can finish, then closes the pane's job so everything the program started goes too.
    pub fn kill(&mut self) {
        self.writer.take();
        let _ = self.killer.kill();
        self.master.take();
        self.job.take();
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
#[path = "pty_resize_tests.rs"]
mod resize_tests;

/// Test shells start PowerShell without a profile. A profile is the user's, not the test's: a CI
/// runner's profile can keep a fresh shell busy past a test's wait (as TERM-045 found, PR #48).
/// cmd and Unix shells are left as they are. Test-only: users' shells still load their profile.
#[cfg(test)]
pub(crate) fn without_profile(cmds: &mut [CommandBuilder]) {
    for c in cmds {
        let first = c.get_argv().first().map(|a| a.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let name = first.rsplit(['/', '\\']).next().unwrap_or_default();
        if matches!(name.strip_suffix(".exe").unwrap_or(name), "pwsh" | "powershell") {
            c.arg("-NoProfile");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn test_shells_start_powershell_without_a_profile_and_leave_other_shells_alone() {
        let mut cmds: Vec<CommandBuilder> = ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "C:/Windows/System32/WindowsPowerShell/v1.0/PowerShell.EXE", "pwsh", "C:\\Windows\\system32\\cmd.exe", "/bin/bash"]
            .into_iter()
            .map(CommandBuilder::new)
            .collect();
        without_profile(&mut cmds);
        let argv: Vec<Vec<String>> = cmds.iter().map(|c| c.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()).collect();
        assert_eq!(argv[0][1..], ["-NoProfile"]);
        assert_eq!(argv[1][1..], ["-NoProfile"]);
        assert_eq!(argv[2][1..], ["-NoProfile"]);
        assert_eq!(argv[3].len(), 1, "cmd is unchanged");
        assert_eq!(argv[4].len(), 1, "a Unix shell is unchanged");
    }

    #[test]
    fn a_cmd_shim_runs_through_the_command_shell_and_an_exe_runs_itself() {
        let exe = std::path::Path::new("C:/Users/me/.local/bin/claude.exe");
        assert_eq!(start_line(exe), (exe.as_os_str().to_owned(), vec![]));
        let shim = std::path::Path::new("C:/Users/me/AppData/Roaming/npm/codex.CMD");
        let (program, head) = start_line(shim);
        if cfg!(windows) {
            assert_eq!(program, system_program("cmd.exe").into_os_string());
            assert_eq!(head, vec!["/d", "/c", "C:/Users/me/AppData/Roaming/npm/codex.CMD"]);
        } else {
            assert_eq!(program, shim.as_os_str());
            assert!(head.is_empty());
        }
    }

    /// What `npm install -g` writes on Windows (cmd-shim 7.0.0 inside npm 10.9.4, output taken on
    /// 2026-10-30 from `require("cmd-shim")(target, name)`): node on a package's script ...
    fn npm_node_shim(script: &str) -> String {
        format!("@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\{script}\" %*\r\n")
    }

    /// ... and a package's own `.exe`.
    fn npm_exe_shim(exe: &str) -> String {
        format!("@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\{exe}\"   %*\r\n")
    }

    /// The Windows command line portable-pty hands CreateProcess for `argv`: each word as the C
    /// runtime reads it (Microsoft's "Parsing C command-line arguments"), quoted when it holds a
    /// space, tab, line break or quote, with its quotes and the backslashes before them escaped.
    fn crt_line(argv: &[String]) -> String {
        let quote = |a: &String| {
            if !a.is_empty() && !a.contains([' ', '\t', '\n', '\x0b', '"']) {
                return a.clone();
            }
            let (mut q, mut slashes) = (String::from("\""), 0);
            for c in a.chars() {
                if c == '\\' {
                    slashes += 1;
                    continue;
                }
                q.push_str(&"\\".repeat(if c == '"' { slashes * 2 + 1 } else { slashes }));
                q.push(c);
                slashes = 0;
            }
            q.push_str(&"\\".repeat(slashes * 2));
            q.push('"');
            q
        };
        argv.iter().map(quote).collect::<Vec<_>>().join(" ")
    }

    /// The words a C-runtime program such as node.exe reads back from `line`.
    fn crt_words(line: &str) -> Vec<String> {
        let c: Vec<char> = line.chars().collect();
        let (mut out, mut cur, mut quoted, mut any, mut i) = (Vec::new(), String::new(), false, false, 0);
        while i < c.len() {
            let slashes = c[i..].iter().take_while(|x| **x == '\\').count();
            if slashes > 0 {
                let before_quote = c.get(i + slashes) == Some(&'"');
                cur.push_str(&"\\".repeat(if before_quote { slashes / 2 } else { slashes }));
                i += slashes;
                if before_quote && slashes % 2 == 1 {
                    cur.push('"');
                    i += 1;
                }
                any = true;
                continue;
            }
            match c[i] {
                '"' => quoted = !quoted,
                ' ' | '\t' if !quoted => {
                    if any {
                        out.push(std::mem::take(&mut cur));
                    }
                    any = false;
                    i += 1;
                    continue;
                }
                x => cur.push(x),
            }
            any = true;
            i += 1;
        }
        if any {
            out.push(cur);
        }
        out
    }

    fn argv_of(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    /// T-605 (X-sec.1, L2-rust-crates.1, R08-orch-auto-chat.2): the exact command line an
    /// npm-installed agent starts with on Windows, its shim in a folder whose path has a space,
    /// given an opening prompt with quotes, `&`, `|`, `<`, `>`, `%` and a line break. Node runs the
    /// package's script itself, so cmd.exe never reads the prompt, and node reads each word back whole.
    #[test]
    fn t605_an_npm_agent_starts_node_on_its_script_and_no_prompt_reaches_cmd_exe() {
        let root = crate::test_dir::temp("t605 npm shims");
        let npm = root.join("Program Files").join("nodejs");
        let script = npm.join("node_modules").join("@google").join("gemini-cli").join("bundle").join("gemini.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "#!/usr/bin/env node\n").unwrap();
        std::fs::write(npm.join("node.exe"), "").unwrap();
        let shim = npm.join("gemini.cmd");
        std::fs::write(&shim, npm_node_shim("node_modules\\@google\\gemini-cli\\bundle\\gemini.js")).unwrap();
        let prompt = "Fix issue #12: \"Crash\" & echo pwned | more < in > out %PATH%\nThen run the tests.";
        let args = vec!["--prompt-interactive".to_string(), prompt.to_string()];
        let argv = argv_of(&command_for(&shim, &args, None, true));
        let path = |p: &Path| p.to_string_lossy().into_owned();
        assert_eq!(argv, [path(&npm.join("node.exe")), path(&script), args[0].clone(), args[1].clone()]);
        let line = crt_line(&argv);
        assert!(!line.to_ascii_lowercase().contains("cmd.exe") && !line.contains(" /c "), "{line}");
        assert_eq!(crt_words(&line), argv, "node reads each word back whole, the line break too: {line}");
        // A package whose program is its own .exe starts that .exe.
        let tool = npm.join("node_modules").join("tool").join("bin").join("tool.exe");
        std::fs::create_dir_all(tool.parent().unwrap()).unwrap();
        std::fs::write(&tool, "MZ").unwrap();
        std::fs::write(npm.join("tool.cmd"), npm_exe_shim("node_modules\\tool\\bin\\tool.exe")).unwrap();
        assert_eq!(argv_of(&command_for(&npm.join("tool.cmd"), &args, None, true)), [path(&tool), args[0].clone(), args[1].clone()]);
    }

    /// T-605: a `.cmd` or `.bat` that is not npm's shim (one written by hand, pnpm's with its
    /// NODE_PATH, an npm shim whose script is gone) still starts through cmd.exe, and such a start
    /// is never given the opening prompt (`agents::launch_line` types it in after start).
    #[test]
    fn t605_any_other_launcher_still_starts_through_cmd_exe() {
        let root = crate::test_dir::temp("t605 other launchers");
        let own = root.join("claude.bat");
        std::fs::write(&own, "@echo off\r\nnode \"%~dp0\\cli.js\" %*\r\n").unwrap();
        let pnpm = root.join("codex.cmd");
        std::fs::write(&pnpm, "@SETLOCAL\r\n@IF NOT DEFINED NODE_PATH (\r\n  @SET \"NODE_PATH=C:\\pnpm\\node_modules\"\r\n)\r\n@IF EXIST \"%~dp0\\node.exe\" (\r\n  \"%~dp0\\node.exe\"  \"%~dp0\\..\\codex\\bin\\codex.js\" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  \"%~dp0\\..\\codex\\bin\\codex.js\" %*\r\n)\r\n").unwrap();
        let gone = root.join("gemini.cmd");
        std::fs::write(&gone, npm_node_shim("node_modules\\missing\\cli.js")).unwrap();
        for p in [&own, &pnpm, &gone] {
            let (program, head) = start_line_on(p, true);
            assert_eq!(program, system_program("cmd.exe").into_os_string(), "{p:?}");
            assert_eq!(head, [std::ffi::OsString::from("/d"), "/c".into(), p.as_os_str().to_owned()]);
        }
        // Outside Windows a .cmd file is a plain file and runs itself.
        assert_eq!(start_line_on(&gone, false), (gone.as_os_str().to_owned(), Vec::new()));
    }

    #[cfg(windows)]
    #[test]
    fn the_create_menu_lists_each_installed_shell_once_best_first() {
        let found = |name: &str| match name {
            "pwsh.exe" => Some(std::path::PathBuf::from("C:/pf/pwsh.exe")),
            "cmd.exe" => Some(std::path::PathBuf::from("C:/Windows/System32/cmd.exe")),
            _ => None,
        };
        let list = shells(found);
        let ids: Vec<_> = list.iter().map(|s| s.id).collect();
        assert_eq!(&ids[..3], &["pwsh", "powershell", "cmd"]);
        assert_eq!(list[1].program, system_program(r"WindowsPowerShell\v1.0\powershell.exe").to_string_lossy());
        assert_eq!(list[2].program, system_program("cmd.exe").to_string_lossy(), "the command prompt is Windows' own, whatever a lookup finds");
        assert_eq!(list[2].args, CMD_ARGS.to_vec());
        assert!(!ids.contains(&"wsl"));
        // Nothing found but the built-in one: still one item.
        assert_eq!(shells(|_| None).first().map(|s| s.id), Some("powershell"));
    }

    #[test]
    fn the_chosen_default_shell_comes_first_and_a_missing_one_changes_nothing() {
        let info = |id: &'static str| ShellInfo { id, name: id, program: format!("{id}.exe"), args: vec![] };
        let list = || vec![info("pwsh"), info("powershell"), info("cmd")];
        let ids = |l: Vec<ShellInfo>| l.into_iter().map(|s| s.id).collect::<Vec<_>>();
        assert_eq!(ids(chosen_first(list(), &serde_json::json!({ "defaultShell": "cmd" }))), ["cmd", "pwsh", "powershell"]);
        assert_eq!(ids(chosen_first(list(), &serde_json::json!({ "defaultShell": "gitbash" }))), ["pwsh", "powershell", "cmd"]);
        assert_eq!(ids(chosen_first(list(), &serde_json::json!({}))), ["pwsh", "powershell", "cmd"]);
        assert_eq!(default_shell(&serde_json::json!({ "defaultShell": "auto" })), None);
    }

    /// after-list #180 (SET-026): the PowerShell version card picks which PowerShell a new terminal opens in when the
    /// default shell is automatic or a PowerShell; a non-PowerShell default shell still wins.
    #[test]
    fn the_powershell_version_choice_picks_the_powershell_new_terminals_open_in() {
        let info = |id: &'static str| ShellInfo { id, name: id, program: format!("{id}.exe"), args: vec![] };
        let list = || vec![info("pwsh"), info("powershell"), info("cmd")];
        let first = |s: serde_json::Value| chosen_first(list(), &s).first().map(|s| s.id);
        assert_eq!(first(serde_json::json!({ "powershellVersion": "5" })), Some("powershell"));
        assert_eq!(first(serde_json::json!({ "defaultShell": "auto", "powershellVersion": "5" })), Some("powershell"));
        assert_eq!(first(serde_json::json!({ "defaultShell": "pwsh", "powershellVersion": "5" })), Some("powershell"));
        assert_eq!(first(serde_json::json!({ "defaultShell": "powershell", "powershellVersion": "7" })), Some("pwsh"));
        assert_eq!(first(serde_json::json!({ "defaultShell": "cmd", "powershellVersion": "5" })), Some("cmd"));
        assert_eq!(first(serde_json::json!({ "defaultShell": "powershell", "powershellVersion": "auto" })), Some("powershell"));
        assert_eq!(shell_choice(&serde_json::json!({ "powershellVersion": "7" })), Some("pwsh"));
        assert_eq!(shell_choice(&serde_json::json!({ "powershellVersion": "auto" })), None);
        assert_eq!(shell_choice(&serde_json::json!({ "defaultShell": "auto" })), None);
    }

    /// FIX-2 (council AFTER 4): the fallback note names shells as the create menu does, not by file.
    #[test]
    fn the_fallback_note_uses_the_menu_names_of_known_shells() {
        let failed = |p: &str| vec![(p.to_string(), "not found".to_string())];
        let ps = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        let note = fallback_note(&failed(r"C:\Program Files\PowerShell\7\pwsh.exe"), ps).unwrap();
        assert_eq!(note, "\x1b[2mPowerShell 7 did not start; opened Windows PowerShell\x1b[0m\r\n");
        let note = fallback_note(&failed(r"C:\Program Files\Git\bin\bash.exe"), r"C:\Windows\system32\CMD.EXE").unwrap();
        assert!(note.contains("Git Bash did not start; opened Command Prompt"), "{note:?}");
        assert!(fallback_note(&failed("wsl.exe"), "fish").unwrap().contains("WSL did not start; opened fish"));
        // an unknown program keeps its file name; nothing failed, no note
        assert!(fallback_note(&failed(r"D:\tools\nu.exe"), ps).unwrap().contains("nu.exe did not start"));
        assert_eq!(fallback_note(&[], ps), None);
    }

    /// ACCT-046 with SET-026: a chosen default shell is tried first and the automatic shells stay
    /// behind it as fallbacks (council: a chosen shell used to be the only one tried).
    #[test]
    fn acct046_a_chosen_default_shell_keeps_the_fallbacks_behind_it() {
        let auto = || vec![(PathBuf::from("C:/PS7/pwsh.exe"), vec!["-NoLogo"]), (PathBuf::from("C:/Windows/cmd.exe"), CMD_ARGS.to_vec())];
        let line = |l: Vec<(PathBuf, Vec<String>)>| l.into_iter().map(|(p, a)| format!("{} {}", p.display(), a.join(" ")).trim().to_string()).collect::<Vec<_>>();
        let bash = Some(("C:/Git/bin/bash.exe".to_string(), vec!["--login".to_string(), "-i".to_string()]));
        assert_eq!(line(chosen_then_auto(bash, auto())), ["C:/Git/bin/bash.exe --login -i".to_string(), "C:/PS7/pwsh.exe -NoLogo".into(), format!("C:/Windows/cmd.exe /k {} 65001 >nul", CMD_ARGS[1])]);
        // The chosen shell is one of the automatic ones: it moves to the front, not in twice.
        let cmd = Some(("c:/windows/CMD.EXE".to_string(), CMD_ARGS.iter().map(|s| s.to_string()).collect()));
        assert_eq!(line(chosen_then_auto(cmd, auto())), [format!("c:/windows/CMD.EXE /k {} 65001 >nul", CMD_ARGS[1]), "C:/PS7/pwsh.exe -NoLogo".into()]);
        assert_eq!(line(chosen_then_auto(None, auto())), ["C:/PS7/pwsh.exe -NoLogo".to_string(), format!("C:/Windows/cmd.exe /k {} 65001 >nul", CMD_ARGS[1])]);
        // And the real list: a chosen shell that will not start gives way to the automatic ones.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let gone = Some(("kolux-rs-no-such-default-shell-9c1d".to_string(), vec![]));
        let mut session = PtySession::spawn_first(shell_commands(None, gone), 80, 24, move |c| {
            let _ = tx.send(c.to_vec());
        }, |_| {})
        .expect("a missing default shell falls back to an automatic one");
        // Council FS 2: the pane says, in one dim line, which shell did not start and which opened.
        let first = rx.recv_timeout(Duration::from_secs(30)).expect("the fallback shell prints");
        let note = String::from_utf8_lossy(&first).to_string();
        assert!(note.starts_with("\x1b[2mkolux-rs-no-such-default-shell-9c1d did not start; opened "), "{note:?}");
        assert!(note.ends_with("\x1b[0m\r\n") && note.matches('\n').count() == 1, "{note:?}");
        let opened = menu_name(session.program());
        assert!(note.contains(&format!("opened {opened}")), "{note:?} names {opened}");
        session.kill();
    }

    /// The round trip every pane depends on: a real shell, a typed command, its output read back.
    #[test]
    fn shell_echoes_a_marker_back_through_the_pty() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(
            shell_commands(None, None).remove(0),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn shell in a pty");

        session.write(b"echo kolux-rs-ok\r\n").expect("write to pty");

        let mut seen = String::new();
        let mut answered = 0;
        // Load flake fix: the shell may take over 30 s to start on a loaded box, so the deadline restarts
        // on every chunk and only 60 s of silence fails (an idle shell is silent only when it is broken).
        let mut deadline = Instant::now() + Duration::from_secs(60);
        // The typed line is echoed once and its output printed once: wait for the second copy.
        while seen.matches("kolux-rs-ok").count() < 2 {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "marker not read back; no output for 60s; saw:\n{seen}");
            if let Ok(chunk) = rx.recv_timeout(left) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
                deadline = Instant::now() + Duration::from_secs(60);
            }
            // The console host asks where the cursor is (ESC[6n) before it draws anything and
            // waits for the answer; a real terminal replies by itself, the test stands in for it.
            let asks = seen.matches("\x1b[6n").count();
            while answered < asks {
                session.write(b"\x1b[1;1R").expect("answer cursor query");
                answered += 1;
            }
        }

        session.resize(80, 24).expect("resize");
        session.write(b"exit\r\n").expect("write exit");
        let code = exit_rx.recv_timeout(Duration::from_secs(60)).expect("shell exits after `exit`");
        assert_eq!(code, Some(0), "clean exit code");
        session.kill();
    }

    /// An agent pane runs a program directly, with its own arguments, in a chosen folder: the
    /// path every agent launch takes. PowerShell stands in for the agent so the test needs
    /// nothing installed beyond Windows.
    #[test]
    fn a_program_with_arguments_runs_through_the_pty_and_prints() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let (program, args, cwd) = if cfg!(windows) {
            ("powershell", vec!["-NoLogo".to_string(), "-Command".to_string(), "echo kolux-rs-program-marker; (Get-Location).Path".to_string()], std::env::temp_dir())
        } else {
            ("sh", vec!["-c".to_string(), "echo kolux-rs-program-marker; pwd".to_string()], std::env::temp_dir())
        };
        let cwd_text = cwd.display().to_string();
        let mut session = PtySession::spawn(
            program_command(program, &args, Some(&cwd_text)),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn a program in a pty");
        // Drain output while waiting for the exit: the console host asks where the cursor is
        // (ESC[6n) before it draws anything and blocks until answered, as in the shell test.
        let mut seen = String::new();
        let mut answered = 0;
        let deadline = Instant::now() + Duration::from_secs(30);
        let code = loop {
            if let Ok(code) = exit_rx.try_recv() {
                break code;
            }
            assert!(Instant::now() < deadline, "the program did not end within 30s; saw:\n{seen}");
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            let asks = seen.matches("\x1b[6n").count();
            while answered < asks {
                session.write(b"\x1b[1;1R").expect("answer cursor query");
                answered += 1;
            }
        };
        while let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) {
            seen.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert_eq!(code, Some(0), "clean exit; output:\n{seen}");
        assert!(seen.contains("kolux-rs-program-marker"), "the program's output reached the pane:\n{seen}");
        let folder = cwd_text.trim_end_matches(['\\', '/']).to_lowercase();
        assert!(seen.to_lowercase().contains(&folder), "it started in the chosen folder {folder}:\n{seen}");
        session.kill();
    }

    /// TERM-098: a program's colour and light/dark questions reach the pane through the console
    /// layer and the pane's answers reach the program. PowerShell asks, the test answers as the
    /// pane would, and the program prints what it received.
    #[test]
    #[cfg(windows)]
    fn term098_colour_and_mode_queries_pass_through_the_console_layer() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let script = concat!(
            "$e=[char]27; $q = \"$e]11;?$e\\\" + \"$e]10;?$e\\\" + \"$e]4;1;?$e\\\" + \"$e[?996n\" + \"$e[?2031h\"; ",
            // Reads until the light/dark answer (the last reply) is in plus half a second for a stray
            // cursor report; the 20 s cap is only for a reply that never comes (a loaded PC read
            // 13 characters of the palette reply in the old fixed 2.5 s and cut it short).
            "[Console]::Out.Write($q); [Console]::Out.Flush(); $t=(Get-Date).AddSeconds(20); $s=''; $z=$null; ",
            "while((Get-Date) -lt $t){ if([Console]::KeyAvailable){ $s += [Console]::ReadKey($true).KeyChar } else { Start-Sleep -Milliseconds 20 }; ",
            "if(-not $z -and $s.Contains(\"$e[?997;1n\")){ $z=(Get-Date).AddMilliseconds(500) }; ",
            "if($z -and (Get-Date) -gt $z -and -not [Console]::KeyAvailable){ break } }; ",
            "'GOT:' + (($s.ToCharArray() | % { [int]$_ }) -join ',') + ':END'"
        );
        let args = vec!["-NoLogo".to_string(), "-NoProfile".to_string(), "-Command".to_string(), script.to_string()];
        let mut session = PtySession::spawn(
            program_command("powershell", &args, None),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn powershell in a pty");
        // What the pane would answer to each question, once per question seen.
        let answers: [(&str, &[u8]); 5] = [
            ("\x1b[6n", b"\x1b[1;1R"),
            ("\x1b]11;?", b"\x1b]11;rgb:1111/2222/3333\x1b\\"),
            ("\x1b]10;?", b"\x1b]10;rgb:aaaa/bbbb/cccc\x1b\\"),
            ("\x1b]4;1;?", b"\x1b]4;1;rgb:dddd/eeee/ffff\x1b\\"),
            ("\x1b[?996n", b"\x1b[?997;1n"),
        ];
        let mut answered = [0usize; 5];
        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(60);
        let code = loop {
            if let Ok(code) = exit_rx.try_recv() {
                break code;
            }
            assert!(Instant::now() < deadline, "the program did not end within 60s; saw:\n{seen:?}");
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            for (i, (ask, reply)) in answers.iter().enumerate() {
                let asks = seen.matches(ask).count();
                while answered[i] < asks {
                    session.write(reply).expect("answer a query");
                    answered[i] += 1;
                }
            }
        };
        while let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) {
            seen.push_str(&String::from_utf8_lossy(&chunk));
        }
        session.kill();
        assert_eq!(code, Some(0), "clean exit; output:\n{seen:?}");
        let got: String = seen
            .split_once("GOT:")
            .and_then(|(_, r)| r.split_once(":END"))
            .map(|(codes, _)| codes.split(',').filter_map(|c| c.trim().parse::<u32>().ok()).filter_map(char::from_u32).collect())
            .unwrap_or_default();
        eprintln!("PANE SAW: {seen:?}\nPROGRAM GOT: {got:?}\nANSWERED: {answered:?}");
        // The console layer keeps OSC 10 and 11 questions to itself (measured on Windows 11 26200,
        // DT-C20); the palette question and the light/dark question and subscription get through.
        for ask in ["\x1b]4;1;?", "\x1b[?996n", "\x1b[?2031h"] {
            assert!(seen.contains(ask), "the pane saw the question {ask:?}; pane saw:\n{seen:?}");
        }
        assert!(got.contains("\x1b]4;1;rgb:dddd/eeee/ffff"), "the program got the palette colour; it got {got:?}");
        assert!(got.contains("\x1b[?997;1n"), "the program got the light/dark answer; it got {got:?}");
        assert!(!got.contains("\x1b[1;1R"), "the cursor report stays the console's own; it got {got:?}");
    }

    #[test]
    fn term098_a_reply_is_sent_as_key_events_and_keys_are_not() {
        assert!(is_reply(b"\x1b]11;rgb:1111/2222/3333\x1b\\"));
        assert!(is_reply(b"\x1b[?997;2n"));
        assert!(!is_reply(b"\x1b[1;1R"));
        assert!(!is_reply(b"\x1b[?1;2c"));
        assert!(!is_reply(b"\x1b[200~\x1b]0;x\x07\x1b[201~"));
        assert!(!is_reply(b"ls\r"));
        let keyed = as_key_events(b"\x1b[?997;1n");
        assert!(keyed.starts_with(b"\x1b[0;0;27;1;0;1_\x1b[0;0;27;0;0;1_\x1b[0;0;91;1;0;1_\x1b[0;0;91;0;0;1_"), "{}", String::from_utf8_lossy(&keyed));
        assert_eq!(keyed.iter().filter(|b| **b == b'_').count(), 18, "a down and an up per character");
    }

    /// A program that is not installed fails at spawn with a message, not a silent empty pane.
    #[test]
    fn term040_a_start_folder_is_relative_or_absolute_and_a_missing_one_falls_back() {
        let ws = std::env::temp_dir();
        let ws_s = ws.to_string_lossy().into_owned();
        let sub = ws.join("kolux-rs-t010");
        std::fs::create_dir_all(&sub).unwrap();
        let sub_s = sub.to_string_lossy().into_owned();
        assert_eq!(start_dir(&ws_s, Some("kolux-rs-t010")), sub_s);
        assert_eq!(start_dir(&ws_s, Some(&sub_s)), sub_s);
        assert_eq!(start_dir(&ws_s, Some("no-such-folder-t010")), ws_s);
        assert_eq!(start_dir(&ws_s, None), ws_s);
        assert_eq!(start_dir(&ws_s, Some("  ")), ws_s);
        let _ = std::fs::remove_dir(&sub);
    }

    /// ACCT-046: PowerShell 7, then Windows PowerShell, then the command prompt in UTF-8, taken
    /// from ComSpec when that is set; a Store alias of PowerShell 7 is passed over.
    #[cfg(windows)]
    #[test]
    fn acct046_the_automatic_shell_order_ends_with_a_utf8_command_prompt() {
        let comspec = std::env::temp_dir().join("kolux-rs-acct046-cmd.exe");
        std::fs::write(&comspec, b"").unwrap();
        let line = |v: Vec<(PathBuf, Vec<&str>)>| v.into_iter().map(|(p, a)| format!("{} {}", p.to_string_lossy(), a.join(" "))).collect::<Vec<_>>();
        let all = |n: &str| Some(PathBuf::from(format!("C:/pf/{n}")));
        let cmd = format!("{} /k {} 65001 >nul", comspec.to_string_lossy(), CMD_ARGS[1]);
        assert_eq!(line(auto_shells(all, Some(comspec.clone()))), ["C:/pf/pwsh.exe -NoLogo".to_string(), "C:/pf/powershell.exe -NoLogo".into(), cmd]);
        let store = |n: &str| (n == "pwsh.exe").then(|| PathBuf::from("C:/Users/u/AppData/Local/Microsoft/WindowsApps/pwsh.exe"));
        assert_eq!(line(auto_shells(store, None)), [format!("{} /k {} 65001 >nul", system_program("cmd.exe").to_string_lossy(), CMD_ARGS[1])]);
        assert_eq!(line(auto_shells(store, Some("cmd.exe".into()))), line(auto_shells(store, None)), "a ComSpec that is not a full path is not used");
        let _ = std::fs::remove_file(&comspec);
    }

    /// ACCT-046: a shell that will not start gives way to the next one; when none starts, the
    /// error names each one tried.
    #[test]
    fn acct046_a_shell_that_will_not_start_gives_way_to_the_next() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let mut cmds = vec![program_command("kolux-rs-no-such-shell-7f3a", &[], None)];
        cmds.extend(shell_commands(None, None));
        let mut session = PtySession::spawn_first(cmds, 80, 24, move |c| {
            let _ = tx.send(c.to_vec());
        }, |_| {})
        .expect("falls back to a shell that starts");
        assert!(rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the fallback shell prints");
        session.kill();
        let none = PtySession::spawn_first(vec![program_command("kolux-rs-no-such-a", &[], None), program_command("kolux-rs-no-such-b", &[], None)], 80, 24, |_| {}, |_| {});
        let err = none.err().expect("nothing starts");
        assert!(err.contains("kolux-rs-no-such-a") && err.contains("kolux-rs-no-such-b"), "{err}");
    }

    /// ACCT-049: a folder that is gone or on a drive that is not there gets a message, and an
    /// agent is kept out of a drive root while a shell may open there.
    #[test]
    fn acct049_start_folders_that_are_gone_unplugged_or_a_drive_root_are_refused() {
        let tmp = std::env::temp_dir();
        assert!(check_start_dir(&tmp.to_string_lossy(), true).is_ok());
        let gone = tmp.join("kolux-rs-acct049-gone");
        assert!(check_start_dir(&gone.to_string_lossy(), false).unwrap_err().contains("no longer exists"));
        let root: PathBuf = tmp.components().take(if cfg!(windows) { 2 } else { 1 }).collect();
        assert!(check_start_dir(&root.to_string_lossy(), false).is_ok(), "a shell may open at a drive root");
        assert!(check_start_dir(&root.to_string_lossy(), true).unwrap_err().contains("root of a drive"));
        if cfg!(windows) {
            if let Some(d) = (b'D'..=b'Z').rev().map(|b| format!("{}:/", b as char)).find(|d| !Path::new(d).exists()) {
                assert!(check_start_dir(&format!("{d}repo"), false).unwrap_err().contains("is not connected"));
            }
        }
        assert!(is_shell_program("C:/Program Files/PowerShell/7/pwsh.exe") && is_shell_program("cmd.exe") && !is_shell_program("claude"));
    }

    /// ACCT-048: Kolux's own runtime and build variables and a partial conda activation are
    /// dropped; the user's own settings stay.
    #[test]
    fn acct048_runtime_build_and_partial_conda_variables_are_not_passed_down() {
        for n in ["TAURI_ENV_DEBUG", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "CARGO_PKG_NAME", "CARGO_MANIFEST_DIR", "npm_lifecycle_event", "npm_config_user_agent", "INIT_CWD", "CONDA_PREFIX", "CONDA_PREFIX_1", "CONDA_SHLVL", "CONDA_DEFAULT_ENV", "KOLUX_USER_DATA_PATH"] {
            assert!(inherited_noise(n), "{n}");
        }
        for n in ["PATH", "CARGO_HOME", "NPM_CONFIG_PREFIX", "CONDA_EXE", "HOME", "KOLUX_TERMINAL_HANDLE"] {
            assert!(!inherited_noise(n), "{n}");
        }
    }

    /// TERM-120: a new terminal's PATH is the machine Path then the user Path as the registry holds
    /// them now, so a folder added in Windows settings reaches the next pane; the folders a dev run
    /// put on Kolux's own PATH are not carried over.
    #[test]
    fn term120_a_new_terminals_path_is_the_machine_then_user_path_read_now() {
        let last = Mutex::new(None);
        let sep = if cfg!(windows) { ";" } else { ":" };
        let machine = ["C:\\Windows\\system32", "C:\\Windows", ""].join(sep);
        let user = ["C:\\Users\\me\\AppData\\Local\\Programs\\newtool", "C:\\Users\\me\\.cargo\\bin"].join(sep);
        let inherited: std::ffi::OsString = ["D:\\devtool\\node_modules\\.bin","C:\\Windows\\system32"].join(sep).into();
        let got = terminal_path(Some(&machine), Some(&user), &last, Some(inherited));
        let dirs: Vec<PathBuf> = std::env::split_paths(&got).collect();
        assert_eq!(dirs, [PathBuf::from("C:\\Windows\\system32"), "C:\\Windows".into(), "C:\\Users\\me\\AppData\\Local\\Programs\\newtool".into(), "C:\\Users\\me\\.cargo\\bin".into()]);
        // the next pane sees the folder added to the user Path in between (nothing is cached while the registry reads)
        let user2 = format!("{user}{sep}D:\\tools\\just-installed");
        let again: Vec<PathBuf> = std::env::split_paths(&terminal_path(Some(&machine), Some(&user2), &last, None)).collect();
        assert_eq!(again.last(), Some(&PathBuf::from("D:\\tools\\just-installed")));
        // a user with no user Path value still gets the machine Path, and that counts as a good read
        let only: Vec<PathBuf> = std::env::split_paths(&terminal_path(Some(&machine), None, &last, None)).collect();
        assert_eq!(only, [PathBuf::from("C:\\Windows\\system32"), "C:\\Windows".into()]);
    }

    /// TERM-120: when the registry cannot be read, the last known good PATH is kept, and before any good
    /// read the PATH Kolux inherited stands.
    #[test]
    fn term120_an_unreadable_registry_keeps_the_last_known_good_path() {
        let last = Mutex::new(None);
        let inherited: std::ffi::OsString = "C:\\inherited".into();
        assert_eq!(terminal_path(None, None, &last, Some(inherited.clone())), inherited, "no good read yet: the inherited PATH");
        assert_eq!(terminal_path(None, None, &last, None), std::ffi::OsString::new());
        let good = terminal_path(Some("C:\\Windows\\system32"), Some("C:\\Users\\me\\bin"), &last, Some(inherited.clone()));
        assert_eq!(terminal_path(None, None, &last, Some(inherited)), good, "a failed read keeps the last good PATH, not the inherited one");
        assert_eq!(*last.lock().unwrap(), Some(good));
    }

    /// TERM-120 (this machine): the fresh PATH comes expanded from the registry and holds system32.
    #[cfg(windows)]
    #[test]
    fn term120_the_fresh_path_on_this_machine_comes_from_the_registry_expanded() {
        let got = fresh_terminal_path(Some("C:\\only-inherited".into()));
        let s = got.to_string_lossy().to_lowercase();
        assert!(!s.contains('%'), "not expanded: {s}");
        assert!(s.contains("system32"), "{s}");
        assert!(!s.contains("only-inherited"), "the registry read replaces the inherited PATH: {s}");
    }

    #[test]
    fn a_missing_program_is_refused_at_spawn() {
        let r = PtySession::spawn(program_command("kolux-rs-no-such-program-7f3a", &[], None), 80, 24, |_| {}, |_| {});
        assert!(r.is_err());
    }

    /// T-663: no program Kolux starts itself resolves through the current folder. A relative name
    /// (even one naming a real file), a drive-relative one and a name only an off-PATH folder has
    /// get no full path; Windows PowerShell is absolute; a failed start no longer quotes its command
    /// line; and the swept files' own code names no program by a bare literal.
    #[test]
    fn t663_programs_kolux_starts_are_full_paths_or_refused() {
        #[cfg(windows)]
        assert!(crate::agents::find_program("./Cargo.toml").is_some(), "the lookup alone would take a relative file");
        let dir = crate::test_dir::temp("t663 off path");
        std::fs::write(dir.join("kolux-rs-t663-only-here.exe"), b"MZ").unwrap();
        for name in ["./Cargo.toml", r"src\pty.rs", "src/pty.rs", "C:Cargo.toml", "kolux-rs-t663-only-here"] {
            assert_eq!(full_path_program(name), None, "{name}");
        }
        assert!(system_program(WINDOWS_POWERSHELL).is_absolute() || !cfg!(windows));
        let os = "CreateProcessW `x --prompt secret` in cwd `None` failed: The system cannot find the file specified. (os error 2)";
        let said = spawn_error("x", os);
        assert_eq!(said, "x could not be started: The system cannot find the file specified. (os error 2)");
        assert_eq!(spawn_error("x", "some other error"), "some other error");
        // Bare `Command::new("name")` literals left in production code: only editor_search's rg and git (out of T-663's list).
        let allowed = [("editor_search.rs", "rg"), ("editor_search.rs", "git")];
        for file in ["automations.rs", "codex_usage.rs", "editor_search.rs", "fonts.rs", "include.rs", "session_scan.rs", "scm.rs", "scm_recipe.rs", "pty.rs"] {
            let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file)).unwrap();
            let prod = text.split("\nmod tests {").next().unwrap();
            for part in prod.split("Command::new(\"").skip(1) {
                let name = part.split('"').next().unwrap();
                assert!(Path::new(name).is_absolute() || name.starts_with('/') || allowed.contains(&(file, name)), "{file}: bare {name}");
            }
        }
    }

    /// T-660: the command prompt is started by its full path in Windows' system folder, and a
    /// program named without a full path is never found in the pane's folder: a cmd.exe and a
    /// tool planted there are not started.
    #[test]
    fn t660_a_program_planted_in_the_pane_folder_is_never_started() {
        let cmd = system_program("cmd.exe");
        assert!(cmd.is_absolute() || !cfg!(windows), "{cmd:?}");
        #[cfg(windows)]
        assert_eq!(Some(cmd.parent().unwrap().to_path_buf()), crate::resources::update_guard::system_dir());
        let dir = crate::test_dir::temp("t660 planted");
        std::fs::write(dir.join("cmd.exe"), b"MZ").unwrap();
        std::fs::write(dir.join("kolux-rs-t660-planted.exe"), b"MZ").unwrap();
        std::fs::write(dir.join("kolux-rs-t660-planted.cmd"), b"@echo planted\r\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        // A shim start goes through the system cmd.exe, never the planted one.
        let (exe, _) = start_line_on(&dir.join("x.cmd"), true);
        assert_eq!(exe, cmd.as_os_str());
        assert!(!std::path::Path::new(&exe).starts_with(&*dir));
        // A name only the pane's folder has is passed bare, unwrapped, and refused at spawn by name.
        let planted = program_command("kolux-rs-t660-planted", &[], Some(&cwd));
        assert_eq!(planted.get_argv()[0], "kolux-rs-t660-planted");
        let err = PtySession::spawn(planted, 80, 24, |_| {}, |_| {}).err().expect("a name found only in the pane's folder is refused");
        assert!(err.contains("kolux-rs-t660-planted") && err.contains("not found"), "{err}");
        // The command prompt's UTF-8 switch is Windows' own chcp, not one planted beside the project.
        assert_eq!(Path::new(CMD_ARGS[1]), system_program("chcp.com"));
        // A pane whose PATH reaches its own folder (a relative entry) still never runs a tool planted there.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let marker = dir.join("ran");
            let tool = dir.join("kolux-rs-t660-tool");
            std::fs::write(&tool, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
            std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
            let mut c = program_command("kolux-rs-t660-tool", &[], Some(&cwd));
            c.env("PATH", ".");
            assert!(PtySession::spawn(c, 80, 24, |_| {}, |_| {}).is_err(), "a tool reached only through a relative PATH entry is refused");
            std::thread::sleep(Duration::from_millis(300));
            assert!(!marker.exists(), "the planted tool never ran");
        }
        // A Command Prompt started in a folder holding a planted chcp never runs it. The control
        // (the bare name, as before T-660) does, which shows the plant is one Windows would reach.
        #[cfg(windows)]
        {
            let marker = dir.join("ran");
            std::fs::write(dir.join("chcp.bat"), format!("@echo x>\"{}\"\r\n", marker.display())).unwrap();
            let prompt = |chcp: &str| {
                let mut c = CommandBuilder::new(system_program("cmd.exe"));
                c.args(["/k", chcp, "65001", ">nul"]);
                c.cwd(&*dir);
                // A PC (or this test's parent) may have switched off the current-folder search; the
                // plant is tested where it is on, as on most PCs.
                c.env_remove("NoDefaultCurrentDirectoryInExePath");
                let (tx, rx) = mpsc::channel::<Vec<u8>>();
                let mut s = PtySession::spawn(c, 200, 24, move |b| { let _ = tx.send(b.to_vec()); }, |_| {}).expect("the prompt starts");
                // The prompt (the folder, then >) shows once chcp has run; the console host asks
                // where the cursor is first and waits for the answer, as in the shell test.
                let shown = format!("planted-{}>", std::process::id());
                let (deadline, mut seen, mut answered) = (Instant::now() + Duration::from_secs(30), String::new(), 0);
                while Instant::now() < deadline && !seen.contains(&shown) {
                    if let Ok(b) = rx.recv_timeout(Duration::from_millis(200)) { seen.push_str(&String::from_utf8_lossy(&b)); }
                    let asks = seen.matches("\x1b[6n").count();
                    while answered < asks {
                        s.write(b"\x1b[1;1R").expect("answer cursor query");
                        answered += 1;
                    }
                }
                assert!(seen.contains(&shown), "the prompt showed: {seen:?}");
                s.kill();
            };
            prompt(CMD_ARGS[1]);
            assert!(!marker.exists(), "the Command Prompt ran Windows' chcp, not the planted one");
            prompt("chcp");
            assert!(marker.exists(), "control: a bare chcp would have run the planted one");
        }
        // The pane's own PATH is searched (its full-path folders): a tool only there is found.
        let own = crate::test_dir::temp("t660 pane path");
        #[cfg(windows)]
        std::fs::copy(system_program("whoami.exe"), own.join("kolux-rs-t660-own.exe")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/bin/true", own.join("kolux-rs-t660-own")).unwrap();
        let mut c = program_command("kolux-rs-t660-own", &[], None);
        c.env("PATH", own.as_os_str());
        assert!(resolve_bare(&c, "kolux-rs-t660-own").is_some_and(|p| p.starts_with(&*own)), "found through the pane's PATH");
        for named in ["./kolux-rs-t660-own", "C:kolux-rs-t660-own", "C:", "kolux-rs-t660-own/", "bin\\kolux-rs-t660-own"] {
            assert!(resolve_bare(&c, named).is_none(), "{named} is never looked up");
        }
        // The automatic shells and the menu never name the planted cmd.exe.
        if cfg!(windows) {
            let found = |_: &str| None;
            assert!(auto_shells(found, Some("cmd.exe".into())).iter().all(|(p, _)| p.is_absolute() && !p.starts_with(&*dir)));
            assert!(shells(found).iter().all(|s| std::path::Path::new(&s.program).is_absolute()));
        }
    }

    /// Closing a pane ends its program even when the program is still waiting for input.
    #[test]
    fn kill_ends_a_running_shell() {
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(shell_commands(None, None).remove(0), 80, 24, |_| {}, move |code| {
            let _ = exit_tx.send(code);
        })
        .expect("spawn shell in a pty");
        session.kill();
        exit_rx.recv_timeout(Duration::from_secs(30)).expect("shell ends after kill");
    }
}

#[cfg(test)]
mod shell_list_async_tests {
    use super::*;

    fn is_async<F: std::future::Future>(_: fn(tauri::AppHandle) -> F) {}

    #[test]
    fn shell_list_is_an_async_command_that_matches_the_sync_one() {
        is_async(shell_list);
        let store = Mutex::new(crate::state::Store::open(&crate::test_dir::temp("shell-list-async")).unwrap());
        let settings = store.lock().unwrap().settings();
        assert_eq!(shell_list_on(&store), chosen_first(shells(crate::agents::find_program), &settings));
    }
}
