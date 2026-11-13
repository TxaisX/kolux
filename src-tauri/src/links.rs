//! SAFE-021 / SAFE-022: paths the interface hands to the system. A path on another machine is
//! refused as text, before any filesystem call, so Windows never offers the user's credentials to
//! that host; a file link aimed at a program, script, installer or shortcut is revealed in its
//! folder instead of run. EDIT-045: `fence` guards every command that takes a path from the
//! interface: inside a registered root (or granted exactly, through `file_grant`), never out
//! through a link; `open_path` is the one door for handing a file to the system. SESS-039:
//! `editor_open` opens a worktree folder (fenced the same way) in an outside editor.
//!
//! ponytail: there are no terminal or note links yet; when they land they call `open_path` and
//! need nothing of their own. On Linux a reveal opens the folder without selecting the file; the
//! FileManager1 D-Bus call would select it.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// File types that run when opened: programs, scripts, installers, shortcuts, macro documents and
/// the odd Office and web-query types that start a program. Lowercase, without the dot.
const PROGRAMS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "btm", "nt", "ps1", "psm1", "psd1", "ps1xml", "psc1", "pssc", "cdxml",
    "ps2", "ps2xml", "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml", "vbs", "vbe", "vb", "js", "jse", "wsf",
    "wsh", "wsc", "ws", "sct", "hta", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appinstaller",
    "application", "manifest", "xbap", "gadget", "cpl", "msc", "inf", "reg", "lnk", "url", "scf", "website",
    "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms", "theme", "themepack", "diagcab", "diagcfg",
    "diagpkg", "chm", "hlp", "jar", "jnlp", "py", "pyw", "pyc", "pyz", "pyzw", "rb", "pl", "pm", "php", "phar", "sh",
    "bash", "zsh", "ksh", "csh", "fish", "command", "tool", "app", "pkg", "mpkg", "dmg", "action", "workflow", "scpt",
    "scptd", "applescript", "terminal", "webloc", "desktop", "run", "bin", "elf", "appimage", "deb", "rpm", "snap",
    "appref-ms", "iso", "img", "vhd", "vhdx", "flatpak", "flatpakref", "apk", "ipa", "ocx", "dll", "sys", "drv", "vxd", "grp", "ins", "isp", "its", "mad",
    "maf", "mag", "mam", "maq", "mar", "mas", "mat", "mau", "mav", "maw", "mcf", "mda", "mdb", "mde", "mdt", "mdw",
    "mdz", "ade", "adp", "accdb", "accde", "accdr", "accdt", "docm", "dotm", "xlsm", "xltm", "xlam", "xla", "xll",
    "pptm", "potm", "ppam", "ppsm", "sldm", "one", "onepkg", "onetoc2", "iqy", "oqy", "rqy", "dqy", "slk", "sylk",
    "crt", "cer", "der", "p7b", "p7c", "pfx", "p12", "xnk", "shb", "shs", "prf", "prg", "pcd", "vsmacros", "vsw",
    "rdp", "appref-ms", "wsb", "msu", "iso", "img", "vhd", "vhdx", "ppkg",
];

/// What time it is, so the open limit can be tested with a clock that is moved by hand.
pub trait Clock {
    fn now(&self) -> Duration;
}

/// Time since the first reading in this run (monotonic).
pub struct RunClock;

impl Clock for RunClock {
    fn now(&self) -> Duration {
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed()
    }
}

/// APP-015 (T-248-c): at most max opens in any window, so a runaway page or script cannot flood the
/// default browser with tabs. An open that is refused is not counted and does not push the window on.
pub struct OpenLimit {
    max: usize,
    window: Duration,
    stamps: VecDeque<Duration>,
}

impl OpenLimit {
    pub const fn new(max: usize, window: Duration) -> Self {
        Self { max, window, stamps: VecDeque::new() }
    }

    /// Counts one open now, or says how long to wait until the oldest one in the window expires.
    pub fn admit(&mut self, clock: &dyn Clock) -> Result<(), Duration> {
        let now = clock.now();
        while let Some(&t) = self.stamps.front() {
            if now.saturating_sub(t) >= self.window {
                self.stamps.pop_front();
            } else {
                break;
            }
        }
        if self.stamps.len() >= self.max {
            let oldest = self.stamps.front().copied().unwrap_or(now);
            return Err(self.window.saturating_sub(now.saturating_sub(oldest)));
        }
        self.stamps.push_back(now);
        Ok(())
    }
}

/// Ten browser opens per ten seconds is far more than a person clicks and far less than a loop does.
static BROWSER_OPENS: Mutex<OpenLimit> = Mutex::new(OpenLimit::new(10, Duration::from_secs(10)));

fn admit_browser_open_at(limit: &Mutex<OpenLimit>, clock: &dyn Clock) -> Result<(), String> {
    let mut l = limit.lock().unwrap_or_else(|e| e.into_inner());
    l.admit(clock).map_err(|wait| format!("Too many links were opened in a row. Try again in {} seconds.", wait.as_secs() + u64::from(wait.subsec_nanos() > 0)))
}

/// The one gate every open in the default browser passes (artifacts::open_external).
pub fn admit_browser_open() -> Result<(), String> {
    admit_browser_open_at(&BROWSER_OPENS, &RunClock)
}

/// Every registered root: the projects, a project's own workspaces folder, and the shared one.
pub fn roots(store: &Mutex<crate::state::Store>) -> Vec<String> {
    let s = store.lock().unwrap_or_else(|e| e.into_inner());
    let mut v = Vec::new();
    for p in crate::projects::load_projects(&s) {
        if let Some(own) = p.workspaces_dir.as_deref().map(str::trim).filter(|o| !o.is_empty()) {
            v.push(Path::new(&p.path).join(own).to_string_lossy().into_owned());
        }
        v.push(p.path);
    }
    v.push(crate::projects::workspaces_dir(&s).to_string_lossy().into_owned());
    v
}

/// Err when `path` points at another machine (SAFE-021); judged as text only. A path holding a
/// NUL or another control character is refused too: Windows stops reading at a NUL, so
/// "run.bat\0.txt" passes the program check as a .txt and then runs run.bat.
pub fn refuse_host(path: &str, roots: &[String]) -> Result<(), String> {
    if path.chars().any(|c| c.is_control()) {
        Err("That path holds a control character; Kolux never opens it".to_string())
    } else if host_path(path, roots) {
        Err(format!("{path} is on another computer; Kolux never opens or checks paths on other machines"))
    } else {
        Ok(())
    }
}

/// A share written with two leading slashes or backslashes, a file URL naming a host, the
/// long-path or device form of one (`\\?\UNC\`, `\\.\pipe\`), or any such path that climbs with
/// `..`. The NT object form (`\??\UNC\`, `\??\GLOBALROOT\`) is read like the long-path form, since
/// Windows passes it straight through to the object manager. WSL roots and long-path local drives
/// are local; a share under a registered root is allowed.
pub fn host_path(text: &str, roots: &[String]) -> bool {
    let low = text.trim().to_ascii_lowercase();
    let path = match low.strip_prefix("file:") {
        None => low,
        Some(rest) => match rest.strip_prefix("//") {
            None => decode(rest),
            Some(rest) => {
                let (host, tail) = rest.split_once('/').unwrap_or((rest, ""));
                match host {
                    "" | "localhost" => decode(&format!("/{tail}")),
                    "wsl$" | "wsl.localhost" => return false,
                    _ => return true,
                }
            }
        },
    };
    let s = windows_form(&path);
    if !s.starts_with("\\\\") {
        return false;
    }
    if s.split('\\').any(|seg| seg == "..") {
        return true;
    }
    let s = short_unc(s);
    if s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") {
        return false;
    }
    if let Some(rest) = s.strip_prefix("\\\\?\\").or_else(|| s.strip_prefix("\\\\.\\")) {
        // the long-path and device namespaces: a drive is local; pipes and the rest are not ours
        return !(rest.len() >= 2 && rest.as_bytes()[0].is_ascii_alphabetic() && rest.as_bytes()[1] == b':');
    }
    !roots.iter().any(|r| {
        let k = short_unc(crate::projects::name_key(r));
        k.starts_with("\\\\") && (s == k || s.strip_prefix(&k).is_some_and(|t| t.starts_with('\\')))
    })
}

/// Backslashes throughout, the NT object prefix `\??\` written as `\\?\` (council FS1, FIX-2), and
/// the `/c:/x` a file URL yields turned into `c:\x`.
fn windows_form(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    if s.starts_with("\\??\\") {
        s.replace_range(..4, "\\\\?\\");
    }
    let b = s.as_bytes();
    if b.len() >= 3 && b[0] == b'\\' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        s.remove(0);
    }
    s
}

/// `\\?\UNC\host\x` and `\\.\UNC\host\x` as `\\host\x`.
fn short_unc(s: String) -> String {
    match s.strip_prefix("\\\\?\\unc\\").or_else(|| s.strip_prefix("\\\\.\\unc\\")) {
        Some(rest) => format!("\\\\{rest}"),
        None => s,
    }
}

/// Percent escapes turned back into bytes; anything else is left as it is.
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = (b[i] == b'%' && i + 2 < b.len())
            .then(|| std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()))
            .flatten();
        match hex {
            Some(v) => {
                out.push(v);
                i += 3;
            }
            None => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// EDIT-045: paths allowed one at a time for this run, each exactly as granted, nothing beneath it.
#[derive(Default)]
pub struct Grants(pub Mutex<HashSet<String>>);

impl Grants {
    pub fn snapshot(&self) -> HashSet<String> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// One spelling for comparing paths: Windows folds slashes and case, POSIX keeps both.
pub fn fence_key(path: &str) -> String {
    if cfg!(windows) {
        crate::projects::name_key(path)
    } else {
        path.trim_end_matches('/').to_string()
    }
}

/// Is `key` one of `roots` or beneath one? A sibling whose name merely starts the same is not.
fn under(key: &str, roots: &[String]) -> bool {
    let sep = if cfg!(windows) { '\\' } else { '/' };
    roots.iter().map(|r| fence_key(r)).any(|r| key == r || key.strip_prefix(r.as_str()).is_some_and(|rest| rest.starts_with(sep)))
}

/// Where `path` really leads: its deepest existing ancestor with every link resolved, and the
/// rest of the name appended (a file about to be written does not exist yet).
fn real(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        if let Ok(c) = std::fs::canonicalize(&cur) {
            let mut out = c;
            for part in rest.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (cur.file_name(), cur.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name.to_os_string());
                cur = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// A canonical path as text without Windows' long-path prefix, so it compares with what the user typed.
fn plain(p: PathBuf) -> String {
    let s = p.to_string_lossy().into_owned();
    if let Some(r) = s.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{r}")
    } else if let Some(r) = s.strip_prefix("\\\\?\\") {
        r.to_string()
    } else {
        s
    }
}

/// EDIT-045: the file fence. `path` must be a full path on this machine inside one of `roots`
/// (the projects, their workspaces folders and the shared one), or granted exactly; a `..` step is
/// refused as text. With `follow`, the place the path really leads to (every link resolved) must
/// still be inside a root, so a link out of a project is refused for reading, writing and listing;
/// without it the entry itself is acted on (rename, trash, move), so only its folder must be inside.
pub fn fence(path: &str, roots: &[String], grants: &HashSet<String>, follow: bool) -> Result<PathBuf, String> {
    refuse_host(path, roots)?;
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("{path} climbs out with ..; Kolux reads and writes only inside your projects"));
    }
    let key = fence_key(path);
    if grants.contains(&key) {
        return Ok(p.to_path_buf());
    }
    if !under(&key, roots) {
        return Err(format!("{path} is outside your projects; Kolux reads and writes only inside them"));
    }
    let probe = if follow { p } else { p.parent().unwrap_or(p) };
    let real_roots: Vec<String> = roots.iter().map(|r| plain(real(Path::new(r)))).collect();
    if !under(&fence_key(&plain(real(probe))), &real_roots) {
        return Err(format!("{path} leads outside your projects through a link"));
    }
    Ok(p.to_path_buf())
}

/// EDIT-045: allows `path` for this run, that exact path and nothing beneath it.
#[tauri::command]
pub fn file_grant(store: tauri::State<'_, Mutex<crate::state::Store>>, grants: tauri::State<'_, Grants>, fence: tauri::State<'_, crate::fence::Fence>, path: String) -> Result<(), String> {
    refuse_host(&path, &roots(&store))?;
    if !Path::new(&path).is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    grants.0.lock().unwrap_or_else(|e| e.into_inner()).insert(fence_key(&path));
    // The editor reads and saves through ACCT-055's fence, so a file is granted there too; a
    // folder or a missing file is not (that fence grants only existing files).
    let _ = fence.grant(Path::new(&path), &store.lock().unwrap_or_else(|e| e.into_inner()));
    Ok(())
}

/// SAFE-022: a file name of a type that runs when opened. On Windows an alternate-data-stream
/// suffix, trailing dots or spaces and an 8.3 short name cannot hide the type (a short name's
/// three-letter extension may be a cut-down program type, so the shape alone counts); on POSIX
/// colons and tildes are ordinary characters.
pub fn program_like(path: &str, windows: bool) -> bool {
    let seps: &[char] = if windows { &['\\', '/'] } else { &['/'] };
    let mut name = path.rsplit(seps).next().unwrap_or(path).to_ascii_lowercase();
    if windows {
        if let Some(i) = name.find(':') {
            name.truncate(i);
        }
        name = name.trim_end_matches(['.', ' ']).to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i + 1..]),
        _ => (name.as_str(), ""),
    };
    PROGRAMS.contains(&ext)
        || (windows && stem.len() <= 8 && ext.len() <= 3 && stem.as_bytes().windows(2).any(|w| w[0] == b'~' && w[1].is_ascii_digit()))
}

/// `program_like` for this platform, plus the execute bit on POSIX.
pub fn launchable(path: &Path) -> bool {
    program_like(&path.to_string_lossy(), cfg!(windows)) || executable_bit(path)
}

#[cfg(unix)]
fn executable_bit(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(not(unix))]
fn executable_bit(_path: &Path) -> bool {
    false
}

/// The file manager's own "show this file" call.
fn reveal_command(path: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = crate::winproc::command("explorer.exe");
        c.raw_arg(format!("/select,\"{}\"", path.display()));
        c
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = crate::winproc::command("open");
        c.arg("-R").arg(path);
        c
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut c = crate::winproc::command("xdg-open");
        c.arg(path.parent().unwrap_or(path));
        c
    }
}

/// Opens the file manager with `path` selected.
pub fn reveal(path: &Path) -> Result<(), String> {
    reveal_command(path).spawn().map(|_| ()).map_err(|e| format!("could not reveal {}: {e}", path.display()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenChoice {
    Reveal,
    Open,
}

/// The pure part of `open_path`: only a full path to an existing file is handed over.
pub fn open_choice(path: &str) -> Result<OpenChoice, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    if !p.is_file() {
        return Err(format!("{path} is not a file"));
    }
    Ok(if launchable(p) { OpenChoice::Reveal } else { OpenChoice::Open })
}

/// SAFE-022: hands a file to the system. A program-like file is revealed in its folder, anything
/// else is opened in its own app; a path on another machine or a relative one is refused.
/// Answers "revealed" or "opened".
#[tauri::command]
pub async fn open_path(store: tauri::State<'_, Mutex<crate::state::Store>>, path: String) -> Result<&'static str, String> {
    refuse_host(&path, &roots(&store))?;
    // A slow file association never freezes the window; only an existing file is handed over.
    tauri::async_runtime::spawn_blocking(move || match open_choice(&path)? {
        OpenChoice::Reveal => reveal(Path::new(&path)).map(|_| "revealed"),
        OpenChoice::Open => crate::artifacts::system_open(&path).map(|_| "opened"),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// SESS-039: how an editor is started on a folder.
#[derive(Debug, PartialEq, Eq)]
pub struct EditorPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Windows: a console window of its own (NeoVim); otherwise no console at all.
    pub console: bool,
}

/// Text safe inside POSIX single quotes, then inside an AppleScript string.
fn mac_script(dir: &Path, program: &str) -> String {
    let sq = |s: &str| format!("'{}'", s.replace('\'', r"'\''"));
    let shell = format!("cd {} && {} .", sq(&dir.to_string_lossy()), sq(program));
    format!("tell application \"Terminal\" to do script \"{}\"", shell.replace('\\', r"\\").replace('"', r#"\""#))
}

/// SESS-039: a windowed editor (or its command-line launcher) gets the folder as its argument; a
/// console editor opens `.` in the folder, in a console window: its own on Windows, the
/// desktop's terminal on Linux, Terminal on macOS. A `.cmd` launcher on Windows goes through the
/// shell with its arguments quoted for it (the standard library does that for batch files).
pub fn editor_plan(editor: &crate::tools::Editor, dir: &Path) -> EditorPlan {
    let path = PathBuf::from(&editor.path);
    let (program, args) = if !editor.console {
        (path, vec![dir.to_string_lossy().into_owned()])
    } else if cfg!(windows) {
        (path, vec![".".to_string()])
    } else if cfg!(target_os = "macos") {
        (PathBuf::from("osascript"), vec!["-e".to_string(), mac_script(dir, &editor.path)])
    } else {
        (PathBuf::from("x-terminal-emulator"), vec!["-e".to_string(), editor.path.clone(), ".".to_string()])
    };
    EditorPlan { program, args, cwd: dir.to_path_buf(), console: editor.console }
}

/// Starts the plan and lets it run on its own.
pub fn spawn_editor(plan: &EditorPlan) -> Result<std::process::Child, String> {
    use std::process::Stdio;
    let mut c = std::process::Command::new(&plan.program);
    c.args(&plan.args).current_dir(&plan.cwd);
    // A console editor talks to its own new console; only a windowed one gets empty handles.
    if !plan.console {
        c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_CONSOLE for NeoVim; CREATE_NO_WINDOW keeps a .cmd launcher's shell out of sight.
        c.creation_flags(if plan.console { 0x0000_0010 } else { crate::winproc::no_window() });
    }
    c.spawn().map_err(|e| format!("could not start {}: {e}", plan.program.display()))
}

/// SESS-039: opens the folder `dir` (a worktree inside a registered root) in the editor `editor`.
/// Answers the editor's name.
// T-304: registered by the coordinator's lib.rs hunk; unused until then.
#[tauri::command]
pub async fn editor_open(store: tauri::State<'_, Mutex<crate::state::Store>>, grants: tauri::State<'_, Grants>, editor: String, dir: String) -> Result<String, String> {
    let folder = fence(&dir, &roots(&store), &grants.snapshot(), true)?;
    if !folder.is_dir() {
        return Err(format!("{dir} is not a folder"));
    }
    // The editor search walks the search path and the install folders: off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let found = crate::tools::editors().into_iter().find(|e| e.id == editor).ok_or_else(|| format!("{editor} is not installed"))?;
        spawn_editor(&editor_plan(&found, &folder))?;
        Ok(found.name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeClock(std::cell::Cell<Duration>);
    impl FakeClock {
        fn at(ms: u64) -> Self {
            Self(std::cell::Cell::new(Duration::from_millis(ms)))
        }
        fn set(&self, ms: u64) {
            self.0.set(Duration::from_millis(ms));
        }
    }
    impl Clock for FakeClock {
        fn now(&self) -> Duration {
            self.0.get()
        }
    }

    fn limit() -> OpenLimit {
        OpenLimit::new(3, Duration::from_secs(10))
    }

    #[test]
    fn app015_a_burst_up_to_the_limit_opens_and_the_next_one_waits() {
        let (mut l, c) = (limit(), FakeClock::at(1_000));
        for _ in 0..3 {
            assert_eq!(l.admit(&c), Ok(()));
        }
        assert_eq!(l.admit(&c), Err(Duration::from_secs(10)));
        assert_eq!(l.admit(&c), Err(Duration::from_secs(10)), "a refusal does not use up or push on the window");
    }

    #[test]
    fn app015_the_wait_shrinks_as_the_oldest_open_ages() {
        let (mut l, c) = (limit(), FakeClock::at(0));
        for _ in 0..3 {
            l.admit(&c).unwrap();
        }
        c.set(4_000);
        assert_eq!(l.admit(&c), Err(Duration::from_secs(6)));
    }

    #[test]
    fn app015_the_window_resets_at_exactly_its_length() {
        let (mut l, c) = (limit(), FakeClock::at(5_000));
        for _ in 0..3 {
            l.admit(&c).unwrap();
        }
        c.set(14_999);
        assert!(l.admit(&c).is_err(), "one millisecond before the window ends");
        c.set(15_000);
        assert_eq!(l.admit(&c), Ok(()), "the oldest opens have aged out exactly at the window");
        assert_eq!(l.admit(&c), Ok(()));
        assert_eq!(l.admit(&c), Ok(()));
        assert!(l.admit(&c).is_err(), "and the limit is back after three more");
    }

    #[test]
    fn app015_opens_spread_out_never_hit_the_limit_and_the_window_slides() {
        let (mut l, c) = (limit(), FakeClock::at(0));
        for i in 0..20 {
            c.set(i * 4_000); // 2.5 opens per window
            assert_eq!(l.admit(&c), Ok(()), "open {i}");
        }
        assert!(l.admit(&c).is_err(), "three opens (68s, 72s, 76s) already fill the window at 76s");
        c.set(80_000);
        assert_eq!(l.admit(&c), Ok(()), "the 68s open has aged out by 80s");
    }

    #[test]
    fn app015_a_clock_that_steps_back_does_not_panic_or_free_the_window() {
        let (mut l, c) = (limit(), FakeClock::at(20_000));
        for _ in 0..3 {
            l.admit(&c).unwrap();
        }
        c.set(1_000);
        assert!(l.admit(&c).is_err());
    }

    #[test]
    fn app015_the_gate_says_how_long_to_wait_and_is_shared_by_every_caller() {
        let (shared, c) = (Mutex::new(OpenLimit::new(2, Duration::from_millis(2_500))), FakeClock::at(0));
        assert!(admit_browser_open_at(&shared, &c).is_ok());
        assert!(admit_browser_open_at(&shared, &c).is_ok());
        let e = admit_browser_open_at(&shared, &c).unwrap_err();
        assert!(e.contains("Try again in 3 seconds"), "{e}");
        c.set(2_500);
        assert!(admit_browser_open_at(&shared, &c).is_ok());
    }

    #[test]
    fn app015_the_real_clock_only_moves_forward() {
        let (a, b) = (RunClock.now(), RunClock.now());
        assert!(b >= a);
    }

    fn ed(path: &str, console: bool) -> crate::tools::Editor {
        crate::tools::Editor { id: "x".into(), name: "X".into(), path: path.into(), console }
    }

    #[test]
    fn sess039_a_windowed_editor_gets_the_folder_and_a_console_editor_opens_dot_in_a_console() {
        let dir = Path::new("C:/work/my repo");
        let p = editor_plan(&ed("C:/x/code.cmd", false), dir);
        assert_eq!((p.program, p.args, p.cwd.as_path(), p.console), (PathBuf::from("C:/x/code.cmd"), vec!["C:/work/my repo".to_string()], dir, false));
        let n = editor_plan(&ed("C:/x/nvim.exe", true), dir);
        assert!(n.console);
        assert_eq!(n.cwd, dir);
        if cfg!(windows) {
            assert_eq!((n.program, n.args), (PathBuf::from("C:/x/nvim.exe"), vec![".".to_string()]));
        } else {
            assert!(n.args.iter().any(|a| a.contains("nvim")));
        }
        // the macOS Terminal script survives quotes in the folder name
        let s = mac_script(Path::new("/tmp/it's \"here\""), "/usr/bin/nvim");
        assert_eq!(s, r#"tell application "Terminal" to do script "cd '/tmp/it'\\''s \"here\"' && '/usr/bin/nvim' .""#);
    }

    /// A stand-in `code.cmd` records the arguments it was handed, forwarding them with `%*` the
    /// way real launchers do: the shell quoting holds for a folder with a space and an ampersand.
    #[cfg(windows)]
    #[test]
    fn sess039_a_cmd_launcher_is_started_through_the_shell_with_the_folder_intact() {
        let base = std::env::temp_dir().join(format!("krs-edopen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("my repo & co");
        std::fs::create_dir_all(&dir).unwrap();
        let cmd = base.join("code.cmd");
        std::fs::write(&cmd, "@echo off\r\n>\"%~dp0seen.txt\" echo(%*\r\n").unwrap();
        let plan = editor_plan(&ed(&cmd.to_string_lossy(), false), &dir);
        let status = spawn_editor(&plan).unwrap().wait().unwrap();
        assert!(status.success());
        let seen = std::fs::read_to_string(base.join("seen.txt")).unwrap();
        assert_eq!(seen.trim_end(), format!("\"{}\"", dir.display()), "one argument, quoted whole");
        let _ = std::fs::remove_dir_all(&base);
    }

    fn host(s: &str) -> bool {
        host_path(s, &[])
    }

    #[test]
    fn safe021_paths_on_other_machines_are_refused_as_text_and_local_wsl_and_registered_shares_pass() {
        for p in [
            r"\\server\share\a.txt",
            "//server/share/a.txt",
            "file://server/share/a.txt",
            "FILE://nas/x",
            "file:////server/share",
            "file:///%5C%5Cserver%5Cshare%5Ca.txt",
            r"\\?\UNC\server\share\a",
            r"\\.\UNC\server\share\a",
            r"\\.\pipe\kolux",
            r"\\?\Volume{1234}\a",
            r"\\?\C:\..\..\UNC\server\share",
            r"\\?\C:\a\..\b",
            r"\\wsl$\Ubuntu\..\..\server\share",
            r"  \\server\share  ",
            // FIX-2 (council FS1): the NT object form `\??\` is read like `\\?\`
            r"\??\UNC\server\share\a",
            r"\??\unc\x.invalid\s",
            "/??/UNC/server/share",
            r"\??\GLOBALROOT\Device\Mup\server\share",
            r"\??\pipe\kolux",
            r"\??\C:\..\..\UNC\server\share",
        ] {
            assert!(host(p), "{p}");
        }
        for p in [
            r"C:\Users\me\a.txt",
            "/home/me/a.txt",
            "relative/a.txt",
            r"\\wsl$\Ubuntu\home\me",
            r"\\wsl.localhost\Ubuntu\home",
            r"\\?\UNC\wsl$\Ubuntu\home",
            r"\\?\C:\very\long\path",
            r"\\?\c:",
            r"\??\C:\very\long\path",
            r"\??\UNC\wsl$\Ubuntu\home",
            "file:///C:/Users/me/a.txt",
            "file://localhost/C:/a.txt",
            "file://wsl$/Ubuntu/home",
            "file://wsl.localhost/Ubuntu/home",
            "file:/C:/x",
            "file:///home/me/a",
            "",
        ] {
            assert!(!host(p), "{p}");
        }
        let roots = [r"\\nas\Projects\repo".to_string(), r"C:\code".to_string()];
        assert!(!host_path(r"\\NAS\projects\repo\src\a.rs", &roots));
        assert!(!host_path(r"\\nas\projects\repo", &roots));
        assert!(!host_path(r"\\?\UNC\nas\projects\repo\a", &roots));
        assert!(!host_path(r"\??\UNC\nas\projects\repo\a", &roots));
        assert!(host_path(r"\??\UNC\nas\projects\other", &roots));
        assert!(!host_path("//nas/projects/repo/a", &roots));
        assert!(host_path(r"\\nas\projects\repo2\a", &roots));
        assert!(host_path(r"\\nas\projects\other", &roots));
        assert!(host_path(r"\\nas\projects\repo\..\other", &roots));
        assert!(host_path(r"\\code\x", &roots));
        let long = [r"\\?\UNC\nas\projects\repo".to_string()];
        assert!(!host_path(r"\\nas\projects\repo\a", &long));
        // the refusal is text only: a host that cannot exist answers at once
        let t = std::time::Instant::now();
        let err = refuse_host(r"\\no-such-host-kolux-rs.invalid\share\a.txt", &[]).unwrap_err();
        assert!(t.elapsed() < std::time::Duration::from_millis(500));
        assert!(err.contains("another computer"), "{err}");
        assert_eq!(refuse_host(r"C:\a.txt", &[]), Ok(()));
        // a NUL (or any control character) is refused before anything reads the name
        for p in ["G:\\repo\\tools\\run.bat\0.txt", "C:\\a\n.txt", "C:\\a\u{7f}.txt"] {
            assert!(refuse_host(p, &[]).unwrap_err().contains("control character"), "{p:?}");
        }
    }

    #[test]
    fn edit045_file_access_stays_inside_the_roots_and_a_link_out_is_refused_unless_granted_exactly() {
        let base = std::env::temp_dir().join(format!("krs-fence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("project");
        let outside = base.join("outside");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(outside.join("deep")).unwrap();
        std::fs::write(root.join("src/a.rs"), "a").unwrap();
        std::fs::write(outside.join("secret.txt"), "s").unwrap();
        std::fs::write(outside.join("deep/inner.txt"), "i").unwrap();
        let link = |name: &str, to: &Path| {
            #[cfg(unix)]
            std::os::unix::fs::symlink(to, root.join(name)).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(to, root.join(name)).unwrap();
        };
        link("escape", &outside.join("secret.txt"));
        link("inner", &root.join("src/a.rs"));
        let roots = vec![root.to_string_lossy().into_owned()];
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let none = std::collections::HashSet::new();
        // Inside: an existing file, a file not yet written, a link that stays inside.
        assert!(fence(&s(&root.join("src/a.rs")), &roots, &none, true).is_ok());
        assert!(fence(&s(&root.join("src/new.rs")), &roots, &none, true).is_ok());
        assert!(fence(&s(&root.join("inner")), &roots, &none, true).is_ok());
        assert!(fence(&s(&root), &roots, &none, true).is_ok(), "the root itself");
        // Outside: refused before the disk is touched, and a climb out of the root too.
        let err = fence(&s(&outside.join("secret.txt")), &roots, &none, true).unwrap_err();
        assert!(err.contains("outside your projects"), "{err}");
        assert!(fence(&s(&root.join("..").join("outside").join("secret.txt")), &roots, &none, true).is_err(), "a .. step out");
        assert!(fence(&s(&base.join("project-two")), &roots, &none, true).is_err(), "a sibling that merely starts with the root's name");
        assert!(fence("src/a.rs", &roots, &none, true).unwrap_err().contains("not a full path"));
        // A link that leads out: refused when followed, fine when the entry itself is acted on.
        let err = fence(&s(&root.join("escape")), &roots, &none, true).unwrap_err();
        assert!(err.contains("through a link"), "{err}");
        assert!(fence(&s(&root.join("escape")), &roots, &none, false).is_ok(), "renaming or trashing the link itself");
        // A grant covers that exact path and nothing beneath it.
        let mut granted = std::collections::HashSet::new();
        granted.insert(fence_key(&s(&outside.join("deep"))));
        granted.insert(fence_key(&s(&root.join("escape"))));
        assert!(fence(&s(&outside.join("deep")), &roots, &granted, true).is_ok());
        assert!(fence(&s(&outside.join("deep/inner.txt")), &roots, &granted, true).is_err(), "nothing beneath a granted path");
        assert!(fence(&s(&root.join("escape")), &roots, &granted, true).is_ok(), "the link itself granted");
        // Hosts stay refused as text, grant or not.
        granted.insert(fence_key("\\\\kolux-no-such-host\\share\\x.txt"));
        assert!(fence("\\\\kolux-no-such-host\\share\\x.txt", &roots, &granted, true).unwrap_err().contains("another computer"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn safe022_programs_scripts_installers_and_shortcuts_are_told_from_documents_under_any_disguise() {
        for p in [
            "setup.bat",
            r"C:\x\run.CMD",
            "/home/me/a.js",
            "tool.exe",
            "link.lnk",
            "install.msi",
            "site.url",
            "notes.one",
            "query.iqy",
            "data.slk",
            "x.ps1",
            "a.sh",
            "a.py",
            "a.jar",
            "a.hta",
            "a.scr",
            "app.AppImage",
            "a.desktop",
            "x.docm",
            "a.cpl",
            "a.msix",
            "a.pkg",
            "a.dll",
            "a.appref-ms",
            "disk.iso",
            "disk.img",
            "disk.vhd",
            "disk.VHDX",
        ] {
            assert!(program_like(p, true), "{p}");
            assert!(program_like(p, false), "{p}");
        }
        for p in [r"C:\x\tool.exe:Zone.Identifier", r"C:\x\tool.exe:stream:$DATA", "tool.exe.", "tool.exe ", "tool.exe. . ", "PROGRA~1.EXE", "NOTES~1.TXT", "notes~1.txt", "backup~1.txt"] {
            assert!(program_like(p, true), "{p}");
        }
        for p in ["readme.txt", "notes.md", "photo.png", "a.json", "report.docx", "Makefile", "a.exe.txt", ".bashrc", "my-long-report~1.txt", "notes~1.markdown"] {
            assert!(!program_like(p, true), "{p}");
            assert!(!program_like(p, false), "{p}");
        }
        // POSIX: colons and tildes are ordinary characters, and a backslash is part of the name
        assert!(!program_like("/home/me/a:b.txt", false));
        assert!(!program_like("/home/me/notes~1.txt", false));
        assert!(!program_like("/home/me/report.txt:exe", false));
        assert!(program_like("/home/me/a.txt:x.exe", false));
        assert!(program_like(r"/home/me/weird\name.sh", false));
        assert!(launchable(Path::new("C:/x/run.bat")));
        assert!(!launchable(Path::new("C:/x/readme.txt")));
    }

    #[cfg(unix)]
    #[test]
    fn safe022_the_execute_bit_counts_on_posix() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("krs-links-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("tool");
        std::fs::write(&f, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!launchable(&f));
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(launchable(&f));
        let _ = std::fs::remove_dir_all(&d);
    }
}
