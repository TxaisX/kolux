//! APP-023: the landing screen's tool checks. Git, GitHub's `gh` (installed, signed in) and
//! GitLab's `glab` are probed on the search path with a time limit; the results are kept until a
//! manual refresh. Which projects GitHub or GitLab hosts is read fresh on every call, so adding one
//! brings a dismissed notice back. A dismissal is stored with the GitHub project set it was made under.
//! SESS-039: which outside editors (VS Code, Cursor, Zed, Sublime Text, NeoVim, the JetBrains IDEs)
//! are installed, for opening a worktree in one; the open itself is `links::editor_open`.
//! T-552: the main window waits out a quitting Kolux that still holds the WebView2 profile folder,
//! a start that fails shows a plain native message, and a quit waits briefly for its WebView2 processes.
use crate::state::Store;
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

/// A probe that runs past this is ended and its tool reported as unknown (no notice).
const PROBE_LIMIT: Duration = Duration::from_secs(6);
/// After a probe's child exits, how long a quiet stdout is waited on (a grandchild may hold it open).
const DRAIN_IDLE: Duration = Duration::from_millis(500);
const KEY_DISMISSED: &str = "tool_notices_dismissed";

/// One tool's state: ok, missing (or, for gh's sign-in, signed out) or unknown (the probe hung).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Check {
    Ok,
    Missing,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probes {
    pub git: Check,
    pub gh: Check,
    pub gh_signed_in: Check,
    pub glab: Check,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    #[serde(flatten)]
    pub probes: Probes,
    /// Ids of the registered projects with a GitHub (or GitLab) remote, sorted.
    pub github_projects: Vec<String>,
    pub gitlab_projects: Vec<String>,
    /// Notice id → the GitHub project set (ids joined by commas) it was dismissed under.
    pub dismissed: serde_json::Map<String, serde_json::Value>,
}

#[derive(Default)]
pub struct Cache(Mutex<Option<Probes>>);

/// How one probe went.
#[derive(Debug, PartialEq, Eq)]
pub enum Ran {
    /// It ended by itself: whether it exited 0, and its output.
    Exited(bool, String),
    /// Nothing by that name could be started from the search path.
    NotFound,
    /// It ran past its limit and was ended.
    Hung,
}

/// Runs `program args` found on the search path, ending it once it runs past `limit`.
/// Stdout is drained on a thread while the child runs; after exit a pipe a grandchild still holds is waited on only briefly.
/// ponytail: stderr is null (nothing to fill), so only stdout can stall a child.
pub fn probe(program: &str, args: &[&str], limit: Duration) -> Ran {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0); // own group, so a hang takes the whole tree
    let Ok(mut child) = cmd.spawn() else { return Ran::NotFound };
    // ponytail: a grandchild started before the assignment escapes the job (std cannot spawn suspended).
    #[cfg(windows)]
    let job = crate::procs::Job::new().ok().filter(|j| j.assign_pid(child.id()).is_ok());
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    if let Some(mut s) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n @ 1..) = s.read(&mut buf) {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
    }
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let deadline = (start + limit).max(Instant::now() + DRAIN_IDLE);
                let bytes = drain_after_exit(&rx, deadline);
                return Ran::Exited(status.success(), String::from_utf8_lossy(&bytes).into_owned());
            }
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                #[cfg(windows)]
                drop(job); // kill-on-close ends every member
                #[cfg(unix)]
                crate::procs::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                return Ran::Hung;
            }
        }
    }
}

/// What a probe's stdout holds once its child has exited. Ends at EOF, once the pipe has been quiet for
/// DRAIN_IDLE, or at `deadline`. A cut (not EOF) drops the partial last line, so a listing never ends mid-id;
/// a clean EOF keeps everything, since a listing may lack its final newline.
fn drain_after_exit(rx: &mpsc::Receiver<Vec<u8>>, deadline: Instant) -> Vec<u8> {
    let mut bytes = Vec::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(DRAIN_IDLE.min(deadline.saturating_duration_since(Instant::now()))) {
            Ok(chunk) => bytes.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Disconnected) => return bytes,
            Err(mpsc::RecvTimeoutError::Timeout) => break,
        }
    }
    bytes.truncate(bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1));
    bytes
}

/// A version check that fails or cannot start means missing; one that hung means unknown.
fn installed(program: &str, limit: Duration) -> Check {
    match probe(program, &["--version"], limit) {
        Ran::Exited(true, _) => Check::Ok,
        Ran::Exited(false, _) | Ran::NotFound => Check::Missing,
        Ran::Hung => Check::Unknown,
    }
}

/// Probes the three tools at once. `gh auth status` only reads the stored sign-in.
pub fn probe_all(limit: Duration) -> Probes {
    std::thread::scope(|s| {
        let git = s.spawn(|| installed("git", limit));
        let glab = s.spawn(|| installed("glab", limit));
        let gh = installed("gh", limit);
        let gh_signed_in = match (gh, probe("gh", &["auth", "status"], limit)) {
            (Check::Ok, Ran::Exited(true, _)) => Check::Ok,
            (Check::Ok, Ran::Exited(false, _)) => Check::Missing,
            _ => Check::Unknown,
        };
        Probes { git: git.join().unwrap_or(Check::Unknown), gh, gh_signed_in, glab: glab.join().unwrap_or(Check::Missing) }
    })
}

/// The host a `git remote -v` listing points at: "github", "gitlab" or none.
pub fn host_of(remotes: &str) -> Option<&'static str> {
    let text = remotes.to_ascii_lowercase();
    if text.contains("github.com") {
        Some("github")
    } else if text.contains("gitlab") {
        Some("gitlab")
    } else {
        None
    }
}

fn hosted(store: &Store) -> (Vec<String>, Vec<String>) {
    let (mut hub, mut lab) = (Vec::new(), Vec::new());
    for p in crate::projects::load_projects(store) {
        let Ran::Exited(true, text) = probe("git", &["-C", &p.path, "remote", "-v"], PROBE_LIMIT) else { continue };
        match host_of(&text) {
            Some("github") => hub.push(p.id),
            Some(_) => lab.push(p.id),
            None => {}
        }
    }
    hub.sort();
    lab.sort();
    (hub, lab)
}

fn dismissed(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    crate::orchestration::kept::or_default(store, KEY_DISMISSED)
}

#[tauri::command]
pub async fn tools_check(app: tauri::AppHandle, refresh: bool) -> Result<Tools, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.state::<Cache>();
        let cached = cache.0.lock().map_err(|e| e.to_string())?.clone().filter(|_| !refresh);
        let probes = match cached {
            Some(p) => p,
            None => {
                let p = probe_all(PROBE_LIMIT);
                *cache.0.lock().map_err(|e| e.to_string())? = Some(p.clone());
                p
            }
        };
        let store = app.state::<Mutex<Store>>();
        let s = store.lock().map_err(|e| e.to_string())?;
        let (github_projects, gitlab_projects) = hosted(&s);
        Ok(Tools { probes, github_projects, gitlab_projects, dismissed: dismissed(&s) })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hides one notice until the GitHub project set differs from `under`.
#[tauri::command]
pub fn tools_dismiss(store: tauri::State<'_, Mutex<Store>>, id: String, under: String) -> Result<(), String> {
    dismiss(&*store.lock().map_err(|e| e.to_string())?, id, under)
}

fn dismiss(s: &Store, id: String, under: String) -> Result<(), String> {
    let mut all: serde_json::Map<String, serde_json::Value> = crate::orchestration::kept::load(s, KEY_DISMISSED)?;
    all.insert(id, serde_json::Value::String(under));
    s.set(KEY_DISMISSED, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// SESS-039: an outside editor a worktree can be opened in. `console` editors (NeoVim) run in a
/// console window of their own; the rest are windowed apps or their command-line launchers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editor {
    pub id: String,
    pub name: String,
    pub path: String,
    pub console: bool,
}

/// id, name, the command-line names on the search path, the install-relative files to try
/// under each program folder, and whether it runs in a console.
type Known = (&'static str, &'static str, &'static [&'static str], &'static [&'static str], bool);

const EDITORS: &[Known] = &[
    ("vscode", "VS Code", &["code"], &["Microsoft VS Code/bin/code.cmd"], false),
    ("cursor", "Cursor", &["cursor"], &["cursor/resources/app/bin/cursor.cmd"], false),
    ("zed", "Zed", &["zed"], &["Zed/bin/zed.exe"], false),
    ("sublime", "Sublime Text", &["subl"], &["Sublime Text/subl.exe", "Sublime Text 3/subl.exe"], false),
    ("nvim", "NeoVim", &["nvim"], &["Neovim/bin/nvim.exe"], true),
];

/// JetBrains IDEs: id, name, the Toolbox's command-line script name, the launcher in the
/// install's own `bin` folder (SESS-039: located beside the install, not on the search path).
const JETBRAINS: &[(&str, &str, &str, &str)] = &[
    ("idea", "IntelliJ IDEA", "idea", "idea64.exe"),
    ("pycharm", "PyCharm", "pycharm", "pycharm64.exe"),
    ("webstorm", "WebStorm", "webstorm", "webstorm64.exe"),
    ("rider", "Rider", "rider", "rider64.exe"),
    ("goland", "GoLand", "goland", "goland64.exe"),
    ("clion", "CLion", "clion", "clion64.exe"),
    ("phpstorm", "PhpStorm", "phpstorm", "phpstorm64.exe"),
    ("rustrover", "RustRover", "rustrover", "rustrover64.exe"),
];

/// The launcher `exe` inside `<root>/JetBrains/<install>/bin` or `<root>/<install>/bin` (the
/// Toolbox's per-user installs), the install folder that sorts last (the newest version) winning.
pub fn jetbrains_launcher(roots: &[PathBuf], exe: &str) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    for root in roots {
        for parent in [root.join("JetBrains"), root.clone()] {
            let Ok(rd) = std::fs::read_dir(&parent) else { continue };
            found.extend(rd.flatten().map(|e| e.path().join("bin").join(exe)).filter(|p| p.is_file()));
        }
    }
    found.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    found.pop()
}

/// SESS-039: the editors found, in a fixed order: each by its command-line name on `dirs`,
/// then at its usual place under one of `roots` (the program folders).
pub fn editors_in(dirs: &[PathBuf], roots: &[PathBuf]) -> Vec<Editor> {
    let at = |rels: &[&str]| roots.iter().flat_map(|r| rels.iter().map(move |rel| r.join(rel))).find(|p| p.is_file());
    let mut out = Vec::new();
    for (id, name, programs, rels, console) in EDITORS {
        if let Some(p) = programs.iter().find_map(|p| crate::agents::find_in(dirs, p)).or_else(|| at(rels)) {
            out.push(Editor { id: id.to_string(), name: name.to_string(), path: p.display().to_string(), console: *console });
        }
    }
    for (id, name, script, exe) in JETBRAINS {
        if let Some(p) = crate::agents::find_in(dirs, script).or_else(|| jetbrains_launcher(roots, exe)) {
            out.push(Editor { id: id.to_string(), name: name.to_string(), path: p.display().to_string(), console: false });
        }
    }
    out
}

/// The program folders an editor installs under on this machine.
fn program_roots() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect();
    v.extend(std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Programs")));
    v
}

/// The editors installed here.
pub fn editors() -> Vec<Editor> {
    editors_in(&crate::agents::search_dirs(), &program_roots())
}

/// SESS-039: the outside editors this machine has, for the "Open in" rows.
// T-304: registered by the coordinator's lib.rs hunk; unused until then.
#[tauri::command]
pub async fn editors_list() -> Result<Vec<Editor>, String> {
    tauri::async_runtime::spawn_blocking(editors).await.map_err(|e| e.to_string())
}

/// The facts the Agent Teams picker entry depends on (T-191-b): native Windows and WSL never offer
/// it, and it starts through the Kolux command line found on the system search path.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct TeamsHost {
    pub windows: bool,
    pub wsl: bool,
    pub cli: Option<String>,
}

/// The host facts from the platform, the WSL markers and the found command line.
pub fn teams_host_from(windows: bool, distro: Option<&str>, osrelease: &str, cli: Option<PathBuf>) -> TeamsHost {
    let wsl = !windows && (distro.is_some_and(|d| !d.is_empty()) || osrelease.to_lowercase().contains("microsoft"));
    let cli = if windows || wsl { None } else { cli.map(|p| p.to_string_lossy().into_owned()) };
    TeamsHost { windows, wsl, cli }
}

/// T-191-b: whether this machine may offer Claude Agent Teams, for the picker.
// T-191-b: registered by the coordinator's lib.rs hunk; unused until then.
#[tauri::command]
pub async fn teams_host() -> Result<TeamsHost, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let distro = std::env::var("WSL_DISTRO_NAME").ok();
        let osrelease = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
        // CLI-007: run by its bare name, which a Kolux pane finds first on its own search path.
        let cli = if cfg!(windows) { None } else { crate::agents::find_program(crate::orchestration::CLI).map(|_| PathBuf::from(crate::orchestration::CLI)) };
        teams_host_from(cfg!(windows), distro.as_deref(), &osrelease, cli)
    })
    .await
    .map_err(|e| e.to_string())
}

// T-552: a relaunch right after a quit can find the quitting Kolux's WebView2 processes still
// holding the profile's user-data folder, and WebView2 then refuses the new window with
// ERROR_BUSY. The window is retried through a bounded wait, and a start that still fails ends
// with a plain native message instead of a panic.

/// What the user reads when the window still cannot open after the whole wait.
pub const STILL_CLOSING: &str = "Kolux is still closing. Try again in a few seconds.";
/// The waits between tries while the profile folder is busy: 250 ms doubling up to 2 s, 9.75 s in all.
pub const BUSY_WAITS_MS: [u64; 7] = [250, 500, 1000, 2000, 2000, 2000, 2000];
/// How long a quit waits for its WebView2 processes to let go of the profile folder.
pub const WEBVIEW_EXIT_WAIT: Duration = Duration::from_secs(3);
const WEBVIEW_EXE: &str = "msedgewebview2.exe";

/// Whether a webview creation error is WebView2's ERROR_BUSY (HRESULT 0x800700AA, "The requested
/// resource is in use"), however the error text spells the number.
pub fn webview_busy(error: &str) -> bool {
    let e = error.to_ascii_lowercase();
    e.contains("0x800700aa") || e.contains("-2147024726")
}

/// Runs `create` until it works, calling `wait` with each of BUSY_WAITS_MS while it fails busy.
/// A busy that outlasts the waits gives STILL_CLOSING; any other error comes back at once, not retried.
pub fn open_retrying<E: std::fmt::Display>(mut create: impl FnMut() -> Result<(), E>, mut wait: impl FnMut(Duration)) -> Result<(), String> {
    let mut waits = BUSY_WAITS_MS.iter();
    loop {
        let e = match create() {
            Ok(()) => return Ok(()),
            Err(e) => e.to_string(),
        };
        if !webview_busy(&e) {
            return Err(e);
        }
        match waits.next() {
            Some(ms) => wait(Duration::from_millis(*ms)),
            None => return Err(STILL_CLOSING.to_string()),
        }
    }
}

/// The native message for a start that failed: the busy case word for word, anything else with its reason.
pub fn startup_message(reason: &str) -> String {
    if reason == STILL_CLOSING || webview_busy(reason) {
        STILL_CLOSING.to_string()
    } else {
        format!("Kolux could not start: {reason}")
    }
}

/// T-552 (1): a start that failed shows a plain native message, is logged (APP-003), and ends the
/// process; it never panics.
pub fn startup_failed(reason: &str) -> ! {
    native_message("Kolux", &startup_message(reason));
    crate::diag::fatal(reason)
}

#[cfg(windows)]
fn native_message(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (text, title) = (wide(text), wide(title));
    // SAFETY: both strings are NUL-terminated UTF-16 buffers that outlive the call; no owner window.
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONWARNING | MB_SETFOREGROUND) };
}

#[cfg(not(windows))]
fn native_message(_title: &str, text: &str) {
    eprintln!("{text}");
}

/// One window from its config, with the page's navigation guards (APP-015): an outside web address
/// opens in the default browser instead, and anything else is dropped (menu::navigation decides). A
/// new-window request (target=_blank, window.open) takes the same road: web and mail addresses go
/// to the browser, the rest is denied (menu::new_window).
fn build_window<R: tauri::Runtime>(handle: &tauri::AppHandle<R>, config: &tauri::utils::config::WindowConfig) -> Result<(), String> {
    let dev = if cfg!(debug_assertions) { handle.config().build.dev_url.clone() } else { None };
    let own = crate::menu::Own::for_platform(crate::menu::Os::current(), config.use_https_scheme);
    let (dev_nav, dev_win) = (dev.clone(), dev);
    tauri::WebviewWindowBuilder::from_config(handle, config)
        .map(|b| {
            b.on_navigation(move |url| match crate::menu::navigation(url, own, dev_nav.as_ref()) {
                crate::menu::Nav::Allow => true,
                crate::menu::Nav::External => {
                    let _ = crate::artifacts::system_open(url.as_str());
                    false
                }
                crate::menu::Nav::Block => false,
            })
            .on_new_window(move |url, _features| {
                if crate::menu::new_window(&url, own, dev_win.as_ref()) == crate::menu::Nav::External {
                    let _ = crate::artifacts::system_open(url.as_str());
                }
                tauri::webview::NewWindowResponse::Deny
            })
        })
        .and_then(|b| b.build())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// APP-006 on macOS: the Dock icon of an app with no window builds the main window again.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn reopen_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if app.webview_windows().is_empty() {
        if let Some(config) = app.config().app.windows.first() {
            if let Err(e) = build_window(app, config) {
                eprintln!("reopen: the window could not be made again: {e}");
            }
        }
    }
}

/// T-552: the app's setup, with the config's windows (`labels`, the ones it marks to open) opened
/// first through the busy wait, then `body`. Any failure ends in startup_failed, so Tauri never
/// sees an error to panic on.
pub fn guarded_setup<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
    labels: &[String],
    body: impl FnOnce(&mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>>,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(dir) = app.path().app_data_dir() {
        crate::diag::set_dir(&dir);
    }
    let configs: Vec<_> = app.config().app.windows.iter().filter(|w| labels.contains(&w.label)).cloned().collect();
    for config in &configs {
        let handle = app.handle().clone();
        if let Err(e) = open_retrying(|| build_window(&handle, config), std::thread::sleep) {
            startup_failed(&e);
        }
    }
    if let Err(e) = body(app) {
        startup_failed(&e.to_string());
    }
    Ok(())
}

/// The WebView2 processes `root` started: its msedgewebview2.exe children and everything under
/// them. `table` is (pid, parent pid, exe name).
pub fn webview_tree(table: &[(u32, u32, String)], root: u32) -> Vec<u32> {
    let mut found: Vec<u32> = table.iter().filter(|(pid, ppid, name)| *ppid == root && *pid != root && name.eq_ignore_ascii_case(WEBVIEW_EXE)).map(|(pid, _, _)| *pid).collect();
    let mut i = 0;
    while i < found.len() {
        let parent = found[i];
        for (pid, ppid, _) in table {
            if *ppid == parent && *pid != root && !found.contains(pid) {
                found.push(*pid);
            }
        }
        i += 1;
    }
    found
}

/// Asks `left` how many processes remain until none do or `budget` has been waited in `step`s;
/// returns the last count.
pub fn wait_gone(mut left: impl FnMut() -> usize, budget: Duration, step: Duration, mut sleep: impl FnMut(Duration)) -> usize {
    let mut waited = Duration::ZERO;
    loop {
        let n = left();
        if n == 0 || waited >= budget {
            return n;
        }
        sleep(step);
        waited += step;
    }
}

/// T-552 (3): at quit, after the windows closed, waits up to WEBVIEW_EXIT_WAIT for this app's WebView2
/// processes to end, so the next start finds the profile folder free. Returns how many were still
/// running (0 off Windows, or when the process table cannot be read).
pub fn wait_webviews_closed() -> usize {
    let me = std::process::id();
    wait_gone(|| webview_tree(&process_table(), me).len(), WEBVIEW_EXIT_WAIT, Duration::from_millis(100), std::thread::sleep)
}

#[cfg(windows)]
fn process_table() -> Vec<(u32, u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut table = Vec::new();
    // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed with
    // its size set, as Process32FirstW/NextW require, and only read after a success.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return table;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            table.push((entry.th32ProcessID, entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len])));
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
    }
    table
}

#[cfg(not(windows))]
fn process_table() -> Vec<(u32, u32, String)> {
    Vec::new()
}

/// FIX-4: the ONE way to credit the program Kolux starts in a pane to a catalogue agent. The program
/// is a single path to run (`program_command` takes the whole text). A line is read as a command line
/// only when it is quoted or its first word is a bare name (`claude --x`, `node <entry script>`);
/// otherwise it is a path and is read whole, quoted, which keeps a path with spaces together
/// (`C:\Program Files\Claude\claude.exe`) and never credits it by a folder name (`C:\Users\Grok Fan\...`).
/// An unquoted path followed by arguments is ambiguous and is credited to nobody. The window's `creditedProgram`
/// (src/launch/paneMark.ts) is this function, pinned by the asserts below, so the mark a pane draws
/// and the account or key it is handed cannot disagree. Callers: every place that credits a spawn
/// program (terminal start, the Claude and Codex account variables, the key variables, the peers
/// list, the inventory, the context cap), which all call it instead of `agents::credited_agent`.
// ponytail: the better end state is Rust returning the credited agent in Spawned/StartLine so the
// window keeps no copy of the rule; that needs terminal.rs and App.tsx state, outside this lane.
pub fn credited_program(program: &str) -> Option<&'static str> {
    let p = program.trim();
    if p.is_empty() {
        return None;
    }
    // A quoted program, or a bare name with arguments (`claude --x`, `node <script>`), is a command line.
    // Anything else is a path to run whole: its folder names (`C:\Users\Grok Fan\...`) are not the program.
    let bare_first = p.split_whitespace().next().is_some_and(|w| !w.contains(['\\', '/']));
    if p.starts_with('"') || bare_first {
        crate::agents::credited_agent(p)
    } else {
        crate::agents::credited_agent(&format!("\"{p}\""))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // FIX-4: src/launch/paneMark.test.ts parses these asserts and replays every one through
    // creditedProgram, and fails if a credited_program( call here is not a literal assert_eq! it can read.
    #[test]
    fn fix4_credited_program_reads_a_spawn_program_quoted_first_then_as_a_line() {
        assert_eq!(credited_program("claude"), Some("claude"));
        assert_eq!(credited_program("  codex  "), Some("codex"), "trimmed");
        assert_eq!(credited_program("claude --permission-mode auto"), Some("claude"), "a line with arguments");
        assert_eq!(credited_program("\"claude\""), Some("claude"));
        assert_eq!(credited_program(r#""C:\Program Files\Claude\claude.exe" --x"#), Some("claude"), "quoted path, arguments");
        assert_eq!(credited_program(r"C:\Program Files\Claude\claude.exe"), Some("claude"), "a bare path with a space");
        assert_eq!(credited_program(r"C:\Program Files\nodejs\codex.cmd"), Some("codex"));
        assert_eq!(credited_program(r"node C:\Users\t\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"), Some("claude"));
        assert_eq!(credited_program("node /usr/lib/node_modules/@openai/codex/bin/codex.js"), Some("codex"));
        assert_eq!(credited_program(r"C:\Program Files\Claude\claude.exe --x"), None, "unquoted path plus arguments: the cut is ambiguous");
        assert_eq!(credited_program(r"C:\Users\Grok Fan\bin\tool.exe"), None, "a folder name with a space is not the program");
        assert_eq!(credited_program(r"C:\Users\Codex Fan\tools\x.exe"), None);
        assert_eq!(credited_program(r"D:\Apps\Claude Code\launcher.exe"), None);
        assert_eq!(credited_program(r"codex --cd C:\work\claude"), Some("codex"), "a bare name plus arguments: the first word is the program");
        assert_eq!(credited_program(r"claude C:\tools\codex.cmd"), Some("claude"));
        assert_eq!(credited_program("/opt/Grok Tools/grok"), Some("grok"), "a path with a space, read whole");
        assert_eq!(credited_program(r"C:\Program Files\Tools\notclaude.exe"), None);
        assert_eq!(credited_program(r"C:\Program Files\Kiro\kiro.exe"), None, "plain kiro is not Kiro");
        assert_eq!(credited_program("claude-teams"), None);
        assert_eq!(credited_program("pwsh"), None);
        assert_eq!(credited_program("   "), None);
        assert_eq!(credited_program(""), None);
    }

    /// The text of a Rust source with whole-line comments dropped.
    fn code_only(src: &str) -> String {
        src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
    }

    /// Whether `name` appears in `text` as a whole word (a call, a path segment or a function pointer).
    fn uses_word(text: &str, name: &str) -> bool {
        let word = |c: char| c.is_alphanumeric() || c == '_';
        text.match_indices(name).any(|(at, _)| {
            !text[..at].chars().next_back().is_some_and(word) && !text[at + name.len()..].chars().next().is_some_and(word)
        })
    }

    #[test]
    fn fix5_only_agents_tools_and_foreground_name_credited_agent() {
        // A spawn program is credited through credited_program; credited_agent stays for the three files that read a command line.
        assert!(uses_word("a(credited_agent(x)) b", "credited_agent") && uses_word(".map(credited_agent)", "credited_agent"));
        assert!(!uses_word("fix4_credited_agent_x credited_agent2", "credited_agent"));
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![dir.clone()];
        let (mut seen, mut users) = (0, Vec::new());
        while let Some(d) = stack.pop() {
            for entry in std::fs::read_dir(&d).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    seen += 1;
                    let text = code_only(&std::fs::read_to_string(&path).unwrap());
                    if uses_word(&text, "credited_agent") {
                        users.push(path.strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
        users.sort();
        assert!(seen > 20, "read {seen} source files");
        assert_eq!(users, ["agents.rs", "foreground.rs", "tools.rs"], "a spawn program is credited through the tools reader, not the agents one");
    }

    #[test]
    fn t191b_agent_teams_is_offered_only_off_windows_and_wsl_with_the_command_line_found() {
        let cli = || Some(PathBuf::from("/usr/local/bin/kolux"));
        let linux = teams_host_from(false, None, "6.8.0-generic", cli());
        assert_eq!(linux, TeamsHost { windows: false, wsl: false, cli: Some("/usr/local/bin/kolux".into()) });
        assert!(teams_host_from(false, Some("Ubuntu"), "", cli()).wsl);
        let wsl = teams_host_from(false, None, "5.15.153.1-microsoft-standard-WSL2", cli());
        assert!(wsl.wsl && wsl.cli.is_none());
        let win = teams_host_from(true, None, "", cli());
        assert!(win.windows && !win.wsl && win.cli.is_none());
        assert_eq!(teams_host_from(false, Some(""), "6.8.0", None).cli, None);
    }

    #[test]
    fn a_missing_program_reports_missing() {
        assert_eq!(probe("kolux-no-such-tool-xyz", &["--version"], PROBE_LIMIT), Ran::NotFound);
        assert_eq!(installed("kolux-no-such-tool-xyz", PROBE_LIMIT), Check::Missing);
    }

    #[test]
    fn a_hanging_probe_is_ended_within_its_limit() {
        let start = Instant::now();
        let (prog, args): (&str, &[&str]) = if cfg!(windows) { ("ping", &["-n", "30", "127.0.0.1"]) } else { ("sleep", &["30"]) };
        assert_eq!(probe(prog, args, Duration::from_millis(500)), Ran::Hung);
        assert!(start.elapsed() < Duration::from_secs(5), "took {:?}", start.elapsed());
    }

    #[test]
    fn a_failed_version_check_counts_as_not_installed() {
        // git with an unknown option exits non-zero: the same outcome as a broken glab.
        let r = probe("git", &["--no-such-option-kolux"], PROBE_LIMIT);
        assert!(matches!(r, Ran::Exited(false, _)));
        assert_eq!(installed("git", PROBE_LIMIT), Check::Ok);
    }

    /// Runs a throwaway script (a .cmd on Windows, `sh` elsewhere) through `probe`.
    fn probe_script(tag: &str, win: &str, unix: &str, limit: Duration) -> Ran {
        let dir = std::env::temp_dir().join(format!("kolux-row961-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let got = if cfg!(windows) {
            let script = dir.join("out.cmd");
            std::fs::write(&script, win.replace('\n', "\r\n")).unwrap();
            probe(script.to_str().unwrap(), &[], limit)
        } else {
            let script = dir.join("out.sh");
            std::fs::write(&script, unix).unwrap();
            probe("sh", &[script.to_str().unwrap()], limit)
        };
        let _ = std::fs::remove_dir_all(&dir);
        got
    }

    // Row 961: output bigger than the pipe buffer is read while the child runs, not after it exits.
    #[test]
    fn row961_a_probe_with_more_output_than_the_pipe_holds_is_not_reported_hung() {
        let line = "0123456789012345678901234567890123456789";
        let win = format!("@echo off\nfor /L %%i in (1,1,3000) do @echo {line}\n");
        let unix = format!("i=0\nwhile [ $i -lt 3000 ]; do echo {line}; i=$((i+1)); done\n");
        match probe_script("big", &win, &unix, Duration::from_secs(8)) {
            Ran::Exited(true, out) => assert!(out.len() > 64_000, "kept {} bytes", out.len()),
            other => panic!("expected Exited(true, ..), got {other:?}"),
        }
    }

    // Row 961: a grandchild that keeps stdout open past the child's exit cannot stall the probe.
    #[test]
    fn row961_a_grandchild_holding_stdout_open_does_not_stall_the_probe() {
        let start = Instant::now();
        let limit = Duration::from_secs(3);
        // ping -n 6 / sleep 5 outlast limit + 1 s (so a stalled drain still fails) yet end soon after.
        let got = probe_script("held", "@echo off\nstart /b ping -n 6 127.0.0.1\necho finished\n", "sleep 5 &\necho finished\n", limit);
        assert!(start.elapsed() < limit + Duration::from_secs(1), "took {:?}", start.elapsed());
        match got {
            Ran::Exited(true, out) => assert!(out.contains("finished"), "got {out:?}"),
            other => panic!("expected Exited(true, ..), got {other:?}"),
        }
    }

    // Card 39: a hung probe ends the whole tree, not just the direct child (a .cmd shim's grandchild).
    #[test]
    fn row965_a_hung_probe_ends_the_grandchild_it_started() {
        let dir = std::env::temp_dir().join(format!("kolux-row965-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("grandchild.pid");
        let (win, unix) = (
            format!("@echo off\nstart /b powershell -NoProfile -Command \"$PID | Out-File -Encoding ascii -FilePath '{}'; Start-Sleep -Seconds 20\"\nping -n 30 127.0.0.1 >nul\n", pidfile.display()),
            format!("sleep 30 &\necho $! > '{}'\nsleep 30\n", pidfile.display()),
        );
        // The limit leaves a slow machine time to start the grandchild before the hang.
        let got = probe_script("tree", &win, &unix, Duration::from_secs(4));
        let pid = std::fs::read_to_string(&pidfile).ok().and_then(|t| t.trim().parse::<u32>().ok());
        let gone = pid.is_some_and(|p| {
            let end = Instant::now() + Duration::from_secs(2);
            while crate::procs::alive(p) != Some(false) && Instant::now() < end {
                std::thread::sleep(Duration::from_millis(50));
            }
            crate::procs::alive(p) == Some(false)
        });
        if let Some(p) = pid.filter(|_| !gone) {
            crate::procs::kill_tree(p);
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(got, Ran::Hung);
        assert!(pid.is_some(), "the grandchild never reported its pid");
        assert!(gone, "grandchild {pid:?} outlived the hung probe");
    }

    // Card 39: a listing cut by the idle window or the deadline never ends mid-line; a clean EOF is kept whole.
    #[test]
    fn row965_a_cut_drain_drops_the_partial_last_line_but_an_eof_keeps_it() {
        let far = || Instant::now() + Duration::from_secs(5);
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        tx.send(b"a\nb\npar".to_vec()).unwrap();
        tx.send(b"t".to_vec()).unwrap();
        assert_eq!(drain_after_exit(&rx, far()), b"a\nb\n", "idle cut (tx still open)");
        tx.send(b"no newline at all".to_vec()).unwrap();
        assert!(drain_after_exit(&rx, far()).is_empty(), "idle cut with no newline");
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        tx.send(b"a\nb\nlast".to_vec()).unwrap();
        drop(tx);
        assert_eq!(drain_after_exit(&rx, far()), b"a\nb\nlast", "EOF keeps the last line");
    }

    // Card 39: a grandchild writing non-stop cannot keep the drain past its deadline.
    #[test]
    fn row965_the_drain_stops_at_its_deadline_while_output_keeps_coming() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let writer = std::thread::spawn(move || {
            for _ in 0..150 {
                if tx.send(b"x\n".to_vec()).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let start = Instant::now();
        let got = drain_after_exit(&rx, start + Duration::from_millis(300));
        assert!(start.elapsed() < Duration::from_secs(1), "took {:?}", start.elapsed());
        assert!(!got.is_empty() && got.ends_with(b"\n"));
        drop(rx);
        writer.join().unwrap();
    }

    #[test]
    fn remotes_name_their_host() {
        assert_eq!(host_of("origin\thttps://github.com/owner/app.git (fetch)\n"), Some("github"));
        assert_eq!(host_of("origin\tgit@GitHub.com:owner/app.git (push)"), Some("github"));
        assert_eq!(host_of("up\thttps://gitlab.example.org/team/app.git (fetch)"), Some("gitlab"));
        assert_eq!(host_of("origin\thttps://example.org/app.git (fetch)"), None);
        assert_eq!(host_of(""), None);
    }

    fn touch(p: &std::path::Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn sess039_editors_are_found_on_the_path_and_jetbrains_launchers_beside_their_install() {
        let base = std::env::temp_dir().join(format!("krs-editors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (bin, pf, local) = (base.join("bin"), base.join("pf"), base.join("local"));
        touch(&bin.join("code.cmd"));
        touch(&pf.join("Neovim/bin/nvim.exe"));
        touch(&pf.join("JetBrains/IntelliJ IDEA 2024.1/bin/idea64.exe"));
        touch(&pf.join("JetBrains/IntelliJ IDEA 2025.2/bin/idea64.exe"));
        touch(&local.join("PyCharm Community/bin/pycharm64.exe"));
        // a launcher not in its install's bin folder does not count
        touch(&pf.join("JetBrains/WebStorm 2025.1/webstorm64.exe"));
        let found = editors_in(std::slice::from_ref(&bin), &[pf.clone(), local.clone()]);
        let ids: Vec<&str> = found.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["vscode", "nvim", "idea", "pycharm"]);
        assert!(found[0].path.ends_with("code.cmd") && !found[0].console);
        assert!(found[1].console, "NeoVim runs in a console window");
        assert!(found[2].path.contains("2025.2"), "the newest install wins: {}", found[2].path);
        assert!(found[3].path.contains("PyCharm Community"));
        // nothing installed: nothing offered
        assert!(editors_in(&[], &[base.join("empty")]).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    const BUSY: &str = "failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x800700AA), message: \"The requested resource is in use.\" })";

    /// An injected window creation that is busy `busy` times, then works; records every try and wait.
    fn busy_then_ok(busy: usize) -> (Result<(), String>, usize, Vec<Duration>) {
        let mut tries = 0;
        let mut waits = Vec::new();
        let got = open_retrying(
            || {
                tries += 1;
                if tries <= busy {
                    Err(BUSY)
                } else {
                    Ok(())
                }
            },
            |d| waits.push(d),
        );
        (got, tries, waits)
    }

    #[test]
    fn t552_a_busy_profile_folder_is_waited_out_and_the_window_opens() {
        let (got, tries, waits) = busy_then_ok(2);
        assert_eq!(got, Ok(()));
        assert_eq!(tries, 3, "two busy tries, then the one that worked");
        assert_eq!(waits, vec![Duration::from_millis(250), Duration::from_millis(500)]);
        // free at once: no wait at all
        assert_eq!(busy_then_ok(0), (Ok(()), 1, vec![]));
    }

    #[test]
    fn t552_a_folder_still_busy_after_about_ten_seconds_gives_the_still_closing_message() {
        let (got, tries, waits) = busy_then_ok(usize::MAX);
        assert_eq!(got, Err("Kolux is still closing. Try again in a few seconds.".to_string()));
        assert_eq!(tries, BUSY_WAITS_MS.len() + 1, "one try, then one after each wait");
        let total: Duration = waits.iter().sum();
        assert!(total >= Duration::from_millis(9_000) && total <= Duration::from_millis(11_000), "about 10 s in all, got {total:?}");
        assert_eq!(&waits[..2], &[Duration::from_millis(250), Duration::from_millis(500)], "backoff starts 250 ms, 500 ms");
        assert!(waits.windows(2).all(|w| w[0] <= w[1]), "the waits never shrink: {waits:?}");
        // busy once per wait, then free on the very last try: still opens
        let (edge, _, _) = busy_then_ok(BUSY_WAITS_MS.len());
        assert_eq!(edge, Ok(()));
    }

    #[test]
    fn t552_an_error_that_is_not_busy_is_not_retried() {
        const OTHER: &str = "failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x80070002) })";
        let mut tries = 0;
        let mut waits = Vec::new();
        let got = open_retrying(
            || {
                tries += 1;
                Err(OTHER)
            },
            |d| waits.push(d),
        );
        assert_eq!(got, Err(OTHER.to_string()));
        assert_eq!((tries, waits.len()), (1, 0));
    }

    /// T-552 (reliability, 2026-10-19): a profile folder that is busy and then fails for another
    /// reason (the folder vanished, access denied) ends the wait right there with that reason, so
    /// the user reads the real cause and never sits out the whole 10 s for a folder that is not busy.
    #[test]
    fn t552_a_busy_folder_that_then_fails_for_another_reason_stops_waiting_and_says_why() {
        const DENIED: &str = "failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x80070005), message: \"Access is denied.\" })";
        let mut tries = 0;
        let mut waits = Vec::new();
        let got = open_retrying(
            || {
                tries += 1;
                if tries < 3 {
                    Err(BUSY)
                } else {
                    Err(DENIED)
                }
            },
            |d| waits.push(d),
        );
        assert_eq!(got, Err(DENIED.to_string()), "the later, non-busy reason comes back as is");
        assert_eq!(tries, 3, "two busy tries were retried, the third was not");
        assert_eq!(waits, vec![Duration::from_millis(250), Duration::from_millis(500)], "no wait after the non-busy error");
        assert_eq!(startup_message(DENIED), format!("Kolux could not start: {DENIED}"), "and the message names it, not 'still closing'");
    }

    #[test]
    fn t552_busy_is_read_from_the_error_text_and_the_message_is_plain() {
        assert!(webview_busy(BUSY));
        assert!(webview_busy("HRESULT(0x800700aa)"), "lower case hex");
        assert!(webview_busy("WebView2 error -2147024726"), "the signed decimal form");
        assert!(!webview_busy("HRESULT(0x80070005) Access is denied."));
        assert_eq!(startup_message(STILL_CLOSING), STILL_CLOSING);
        assert_eq!(startup_message(BUSY), STILL_CLOSING);
        assert_eq!(startup_message("no app data folder"), "Kolux could not start: no app data folder");
    }

    #[test]
    fn t552_a_quit_waits_only_for_its_own_webview2_tree_and_only_so_long() {
        let row = |pid: u32, ppid: u32, name: &str| (pid, ppid, name.to_string());
        let me = 100;
        let table = vec![
            row(me, 1, "kolux.exe"),
            row(200, me, "msedgewebview2.exe"), // the browser process
            row(201, 200, "msedgewebview2.exe"), // its renderer and helpers
            row(202, 200, "msedgewebview2.exe"),
            row(203, 201, "msedgewebview2.exe"),
            row(300, me, "powershell.exe"),      // a pane's shell: not a webview, not waited for
            row(301, 300, "msedgewebview2.exe"), // a webview another program in a pane started
            row(400, 1, "msedgewebview2.exe"),   // another app's WebView2
            row(500, 500, "msedgewebview2.exe"), // a self-parented entry never loops
        ];
        let mut tree = webview_tree(&table, me);
        tree.sort();
        assert_eq!(tree, vec![200, 201, 202, 203]);
        assert!(webview_tree(&table, 999).is_empty());
        // gone after two looks: two waits of the step
        let mut left = vec![4, 1, 0].into_iter();
        let mut slept = Vec::new();
        let step = Duration::from_millis(100);
        assert_eq!(wait_gone(|| left.next().unwrap_or(0), WEBVIEW_EXIT_WAIT, step, |d| slept.push(d)), 0);
        assert_eq!(slept.len(), 2);
        // never gone: gives up after the 3 s budget with the count left
        let mut slept = Vec::new();
        assert_eq!(wait_gone(|| 6, WEBVIEW_EXIT_WAIT, step, |d| slept.push(d)), 6);
        assert_eq!(slept.iter().sum::<Duration>(), WEBVIEW_EXIT_WAIT);
        // this test process started no WebView2, so the real wait returns at once
        let t0 = Instant::now();
        assert_eq!(wait_webviews_closed(), 0);
        assert!(t0.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn card13_dismissed_notices_that_could_not_be_kept_aside_are_never_saved_over() {
        let dir = std::env::temp_dir().join(format!("kolux-tools-c13-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        let broken = "{\"gh\": \"abc";
        store.set(KEY_DISMISSED, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        assert!(dismiss(&store, "gh".into(), "x".into()).unwrap_err().contains(KEY_DISMISSED));
        assert_eq!(store.get(KEY_DISMISSED).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
