//! SAFE-021 / SAFE-022: paths the interface hands to the system. A path on another machine is
//! refused as text, before any filesystem call, so Windows never offers the user's credentials to
//! that host; a file link is opened only when it is a known document type (`DOCUMENTS`), and
//! revealed in its folder otherwise, so a click never runs a program. EDIT-045: `fence` guards every command that takes a path from the
//! interface: inside a registered root, never out through a link; `open_path`
//! is the one door for handing a file to the system. SESS-039: `editor_open` opens a worktree
//! folder (fenced the same way) in an outside editor.
//! `open_external` hands a clean web or mail link to the system's own handler.
//!
//! ponytail: there are no terminal or note links yet; when they land they call `open_path` and
//! need nothing of their own. On Linux a reveal opens the folder without selecting the file; the
//! FileManager1 D-Bus call would select it.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Wave 2 (review A): the only file types a click opens in their own app. The rule is an allow list,
/// because a deny list of programs always misses one (`.pyo` runs in py.exe, `.sln` and Office types
/// start tooling or fetch remote templates). On the list: plain text and settings, source code an
/// editor opens (never a type Windows runs: no js, py, rb, pl, ps1, vbs, sh, bat, cmd), images and
/// pdf. Left off on purpose: html, htm, xml and svg (a browser runs their script), csv and tsv (Excel
/// opens them and a formula can call out to the network), and every Office type. Any other type,
/// and a name with no type at all, is revealed in its folder instead. Lowercase, without the dot.
const DOCUMENTS: &[&str] = &[
    "txt", "md", "markdown", "log", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "diff", "patch",
    "rs", "ts", "tsx", "go", "c", "h", "cc", "cpp", "hpp", "cs", "java", "kt", "swift", "css", "scss",
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "pdf",
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

/// The one gate every open in the default browser passes (open_external).
pub fn admit_browser_open() -> Result<(), String> {
    admit_browser_open_at(&BROWSER_OPENS, &RunClock)
}

/// Milliseconds since 1970 by the system clock; 0 when the clock is set before 1970.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The address `open_external` opens: a clean http, https or mailto link, in its parsed form. A control
/// character (the parser would quietly drop a tab or newline) or a double quote is refused before parsing.
fn external_url(url: &str) -> Result<String, String> {
    if url.chars().any(|c| c.is_control() || c == '"') {
        return Err("That link holds a character Kolux never opens".into());
    }
    let not_a_link = || format!("{url} is not a web or mail link");
    let parsed = tauri::Url::parse(url).map_err(|_| not_a_link())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => {}
        "mailto" => {}
        _ => return Err(not_a_link()),
    }
    let mut parsed = parsed;
    if parsed.scheme() == "mailto" {
        // The address list only: a ?body=, ?cc= or ?attach= is the page's text, not what the user was shown.
        parsed.set_query(None);
        parsed.set_fragment(None);
    }
    Ok(parsed.as_str().to_string())
}

/// Opens a web or mail link in the system's own handler; nothing else is let through, and no more than a
/// handful in a row (admit_browser_open). The command runs on a worker, never the window's thread.
#[tauri::command(async)]
pub fn open_external(url: String) -> Result<(), String> {
    let url = external_url(&url)?;
    admit_browser_open()?;
    system_open(&url)
}

/// Hands `url` (a link or a full file path) to the system's own handler. Callers check it first:
/// `open_external` lets only web and mail links through; `open_path` uses `open_file` instead.
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    if url.contains('\0') {
        return Err("That path holds a control character; Kolux never opens it".into());
    }
    #[cfg(windows)]
    {
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (verb, file) = (wide("open"), wide(url));
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        // FIX-5 (council P2 P12): ShellExecute may hand the link to shell extensions that use COM, so
        // the calling thread joins COM for the call (the documented way) and leaves it again after.
        // A negative result (the thread already joined another way) means nothing to undo.
        // SAFETY: NUL-terminated wide strings that live across the call; every successful
        // CoInitializeEx is matched by one CoUninitialize on this thread.
        let r = unsafe {
            let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
            let r = windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1);
            if com >= 0 {
                CoUninitialize();
            }
            r
        };
        if (r as isize) <= 32 {
            return Err(format!("Windows could not open {url}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        crate::winproc::command(opener).arg(url).spawn().map(|_| ()).map_err(|e| format!("could not open {url}: {e}"))
    }
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

/// A path on a WSL share (`\\wsl$\`, `\\wsl.localhost\`, or the long-path form of either), judged
/// from the spelling alone.
pub fn is_wsl(p: &Path) -> bool {
    let s = p.to_string_lossy().replace('/', "\\").to_lowercase();
    s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") || s.starts_with("\\\\?\\unc\\wsl$\\") || s.starts_with("\\\\?\\unc\\wsl.localhost\\")
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
/// (the projects, their workspaces folders and the shared one); a `..` step is refused as text. The
/// place the path really leads to (every link resolved) must still be inside a root, so a link out of
/// a project is refused.
pub fn fence(path: &str, roots: &[String]) -> Result<PathBuf, String> {
    refuse_host(path, roots)?;
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("{path} climbs out with ..; Kolux reads and writes only inside your projects"));
    }
    if !under(&fence_key(path), roots) {
        return Err(format!("{path} is outside your projects; Kolux reads and writes only inside them"));
    }
    // Wave 2 (review A3): every link on the way is read from its text first, so resolving the path
    // below never follows one to another machine.
    refuse_linked_host(p, roots)?;
    let real_roots: Vec<String> = roots.iter().map(|r| plain(real(Path::new(r)))).collect();
    if !under(&fence_key(&plain(real(p))), &real_roots) {
        return Err(format!("{path} leads outside your projects through a link"));
    }
    Ok(p.to_path_buf())
}

/// SAFE-022 (wave 2): a file a click may open in its own app: its full final name ends in a type on
/// `DOCUMENTS` (lowercased, never cut at a ':'), and on POSIX it has no execute bit. Callers pass
/// the file's real path, so the type judged is the type that opens.
pub fn document(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match name.rfind('.') {
        Some(i) if i > 0 => DOCUMENTS.contains(&&name[i + 1..]) && !execute_bit(path),
        _ => false,
    }
}

/// Windows: a ':' anywhere after the drive letter names a stream inside a file (`notes.txt:run.vbs`
/// opens as a .vbs), so such a path is never opened. The long-path and object prefixes are read
/// past first. On POSIX a colon is an ordinary character.
fn stream_colon(path: &str) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let s = path.replace('/', "\\");
    let s = ["\\\\?\\", "\\\\.\\", "\\??\\"].iter().find_map(|p| s.strip_prefix(p)).unwrap_or(&s);
    let b = s.as_bytes();
    let s = if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' { &s[2..] } else { s };
    s.contains(':')
}

/// Wave 2 (review A): every link on the way to `path` (the file itself or a folder above it) is read
/// from its own text, and one that leads to another machine is refused before anything follows it,
/// so resolving the path never reaches a share. The walk goes from the top down and starts again
/// from each link's target; at most 8 links (8 passes that each follow one, then a 9th that must
/// find none).
fn refuse_linked_host(path: &Path, roots: &[String]) -> Result<(), String> {
    let mut path = path.to_path_buf();
    for _ in 0..=8 {
        let comps: Vec<std::path::Component> = path.components().collect();
        let mut cur = PathBuf::new();
        let mut next = None;
        for (i, c) in comps.iter().enumerate() {
            cur.push(c);
            if !matches!(c, std::path::Component::Normal(_)) || !std::fs::symlink_metadata(&cur).is_ok_and(|m| m.file_type().is_symlink()) {
                continue;
            }
            let to = std::fs::read_link(&cur).map_err(|e| format!("could not read the link {}: {e}", cur.display()))?;
            // Wave 2 (review A3): Windows folds a `..` in a link's own target as text, while this
            // walk would follow a link inside that target first, so such a link is never followed.
            if to.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                return Err(format!("the link {} points through ..; Kolux never opens it", cur.display()));
            }
            let to = if to.is_absolute() { to } else { cur.parent().unwrap_or(Path::new("")).join(to) };
            refuse_host(&to.to_string_lossy(), roots)?;
            next = Some(comps[i + 1..].iter().fold(to, |p, c| p.join(c)));
            break;
        }
        match next {
            Some(n) => path = n,
            None => return Ok(()),
        }
    }
    Err(format!("{} passes through too many links; Kolux never opens it", path.display()))
}

/// Opens `file` (the real path of an existing document, or a folder, which opens in the file
/// manager) in its own app. On Windows the shell is handed the parsed item rather than the name
/// (SHParseDisplayName, then ShellExecuteEx with SEE_MASK_IDLIST), so it cannot swap in a program
/// beside it (`LICENSE.cmd` for `LICENSE`).
pub(crate) fn open_file(file: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_IDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
        // Declared here: windows-sys puts both behind a feature (Win32_UI_Shell_Common) this crate
        // does not turn on, and they need nothing from it but an opaque item pointer.
        #[link(name = "shell32")]
        extern "system" {
            fn SHParseDisplayName(name: *const u16, bind: *mut core::ffi::c_void, item: *mut *mut core::ffi::c_void, sfgao_in: u32, sfgao_out: *mut u32) -> i32;
            fn ILFree(item: *mut core::ffi::c_void);
        }
        let name: Vec<u16> = file.as_os_str().encode_wide().chain([0]).collect();
        if name[..name.len() - 1].contains(&0) {
            return Err("That path holds a control character; Kolux never opens it".into());
        }
        let verb: Vec<u16> = "open".encode_utf16().chain([0]).collect();
        // SAFETY: NUL-terminated wide strings that live across the calls; the item SHParseDisplayName
        // hands back is freed once with ILFree; every successful CoInitializeEx is matched by one
        // CoUninitialize on this thread (see system_open).
        let opened = unsafe {
            let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
            let mut item = std::ptr::null_mut();
            let mut opened = false;
            if SHParseDisplayName(name.as_ptr(), std::ptr::null_mut(), &mut item, 0, std::ptr::null_mut()) >= 0 && !item.is_null() {
                let mut info = SHELLEXECUTEINFOW {
                    cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                    fMask: SEE_MASK_IDLIST | SEE_MASK_NOASYNC,
                    lpVerb: verb.as_ptr(),
                    lpIDList: item,
                    nShow: 1,
                    ..Default::default()
                };
                opened = ShellExecuteExW(&mut info) != 0;
                ILFree(item);
            }
            if com >= 0 {
                CoUninitialize();
            }
            opened
        };
        if !opened {
            return Err(format!("Windows could not open {}", file.display()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        system_open(&file.to_string_lossy())
    }
}

/// A file with an execute bit set. Only POSIX has the bit, so elsewhere this is never true.
#[cfg(unix)]
fn execute_bit(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(not(unix))]
fn execute_bit(_path: &Path) -> bool {
    false
}

/// The file manager's own "show this file" call, on the file's real path (RS-5). A path holding a
/// double quote is refused: on Windows it would end the quoted `/select,` argument early.
fn reveal_command(path: &Path) -> Result<std::process::Command, String> {
    let quoted = |p: &Path| p.to_string_lossy().contains('"');
    if quoted(path) {
        return Err(format!("{} holds a double quote; Kolux never hands it to the file manager", path.display()));
    }
    let real = PathBuf::from(plain(path.canonicalize().map_err(|e| format!("could not reveal {}: {e}", path.display()))?));
    if quoted(&real) {
        return Err(format!("{} holds a double quote; Kolux never hands it to the file manager", real.display()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = crate::winproc::command("explorer.exe");
        c.raw_arg(format!("/select,\"{}\"", real.display()));
        Ok(c)
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = crate::winproc::command("open");
        c.arg("-R").arg(&real);
        Ok(c)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut c = crate::winproc::command("xdg-open");
        c.arg(real.parent().unwrap_or(&real));
        Ok(c)
    }
}

/// Opens the file manager with `path` selected.
pub fn reveal(path: &Path) -> Result<(), String> {
    reveal_command(path)?.spawn().map(|_| ()).map_err(|e| format!("could not reveal {}: {e}", path.display()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenChoice {
    Reveal,
    Open,
}

/// A final `.` or `..` step or a trailing separator. Windows drops or resolves them, so the name the
/// eye reads is not the file that opens (`run.cmd\.` is `run.cmd`); on Windows a final step of only
/// dots and spaces counts too, since Windows trims both.
fn odd_ending(path: &str) -> bool {
    let seps: &[char] = if cfg!(windows) { &['\\', '/'] } else { &['/'] };
    let last = path.rsplit(seps).next().unwrap_or(path);
    if cfg!(windows) {
        last.trim_end_matches(['.', ' ']).is_empty()
    } else {
        last.is_empty() || last == "." || last == ".."
    }
}

/// `open_target` with no registered roots (every share refused), answering the choice alone.
pub fn open_choice(path: &str) -> Result<OpenChoice, String> {
    open_target(path, &[]).map(|(choice, _)| choice)
}

/// The pure part of `open_path`: only a full path to an existing file is handed over, judged and
/// handed over by its real path (RS-1), so a spelling Windows rewrites (a final `\.`, an 8.3 short
/// name, a link) cannot make a program pass as a document. Wave 2: a stream name (`a.txt:b.vbs`)
/// is refused, a link on the way that leads to another machine is refused before it is followed,
/// and only a real file whose type is on `DOCUMENTS` is opened; everything else is revealed. A real
/// path on a share is let through when it lies under a root's own real path (a project on a mapped
/// drive), as `fence` does. Answers the choice and that real path.
pub fn open_target(path: &str, roots: &[String]) -> Result<(OpenChoice, PathBuf), String> {
    refuse_host(path, roots)?;
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    if odd_ending(path) {
        return Err(format!("{path} does not end in a file name; Kolux never opens it"));
    }
    if stream_colon(path) {
        return Err(format!("{path} names a stream inside a file; Kolux never opens it"));
    }
    // Wave 2 (review A2): Windows folds `a\..\b` as text while the link walk below follows `a`
    // first, so a `..` step could slip a link past it; refused as text, as `fence` does.
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("{path} climbs out with ..; Kolux never opens it"));
    }
    refuse_linked_host(p, roots)?;
    let at = PathBuf::from(plain(p.canonicalize().map_err(|_| format!("{path} is not a file"))?));
    let text = at.to_string_lossy().into_owned();
    if refuse_host(&text, roots).is_err() {
        let with_real: Vec<String> = roots.iter().cloned().chain(roots.iter().map(|r| plain(real(Path::new(r))))).collect();
        refuse_host(&text, &with_real)?;
    }
    if stream_colon(&text) {
        return Err(format!("{path} names a stream inside a file; Kolux never opens it"));
    }
    if !at.is_file() {
        return Err(format!("{path} is not a file"));
    }
    Ok((if document(&at) { OpenChoice::Open } else { OpenChoice::Reveal }, at))
}

/// SAFE-022: hands a file to the system. A known document type is opened in its own app, anything
/// else is revealed in its folder; a path on another machine or a relative one is refused.
/// Answers "revealed" or "opened".
#[tauri::command]
pub async fn open_path(store: tauri::State<'_, Mutex<crate::state::Store>>, path: String) -> Result<&'static str, String> {
    let roots = roots(&store);
    refuse_host(&path, &roots)?;
    // A slow file association never freezes the window; only an existing file is handed over.
    tauri::async_runtime::spawn_blocking(move || match open_target(&path, &roots)? {
        (OpenChoice::Reveal, real) => reveal(&real).map(|_| "revealed"),
        (OpenChoice::Open, real) => open_file(&real).map(|_| "opened"),
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
pub async fn editor_open(store: tauri::State<'_, Mutex<crate::state::Store>>, editor: String, dir: String) -> Result<String, String> {
    let folder = fence(&dir, &roots(&store))?;
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

    #[test]
    fn open_external_lets_through_only_clean_web_and_mail_links() {
        assert_eq!(external_url("https://example.com/a?b=1").unwrap(), "https://example.com/a?b=1");
        assert_eq!(external_url("HTTP://Example.com").unwrap(), "http://example.com/", "the parsed form is what is opened");
        assert_eq!(external_url("mailto:me@example.com").unwrap(), "mailto:me@example.com");
        for bad in ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-msdt:/id", "https://example.com/\"quoted", "https://exa\tmple.com/", "https://example.com/\nx", "https://example.com/\0", "not a url", "", "https://"] {
            assert!(external_url(bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn a_mail_link_loses_its_query_when_it_is_opened() {
        assert_eq!(external_url("mailto:a@example.com?body=hi&attach=C:/secrets.txt").unwrap(), "mailto:a@example.com");
        assert_eq!(external_url("mailto:a@example.com,b@example.com?cc=c@example.com#frag").unwrap(), "mailto:a@example.com,b@example.com");
        assert_eq!(external_url("https://example.com/a?b=1#c").unwrap(), "https://example.com/a?b=1#c", "web links keep their query");
    }

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
        let err = refuse_host(r"\\no-such-host-kolux.invalid\share\a.txt", &[]).unwrap_err();
        assert!(t.elapsed() < std::time::Duration::from_millis(500));
        assert!(err.contains("another computer"), "{err}");
        assert_eq!(refuse_host(r"C:\a.txt", &[]), Ok(()));
        // a NUL (or any control character) is refused before anything reads the name
        for p in ["G:\\repo\\tools\\run.bat\0.txt", "C:\\a\n.txt", "C:\\a\u{7f}.txt"] {
            assert!(refuse_host(p, &[]).unwrap_err().contains("control character"), "{p:?}");
        }
    }

    #[test]
    fn edit045_file_access_stays_inside_the_roots_and_a_link_out_is_refused() {
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
        // Inside: an existing file, a file not yet written, a link that stays inside.
        assert!(fence(&s(&root.join("src/a.rs")), &roots).is_ok());
        assert!(fence(&s(&root.join("src/new.rs")), &roots).is_ok());
        assert!(fence(&s(&root.join("inner")), &roots).is_ok());
        assert!(fence(&s(&root), &roots).is_ok(), "the root itself");
        // Outside: refused before the disk is touched, and a climb out of the root too.
        let err = fence(&s(&outside.join("secret.txt")), &roots).unwrap_err();
        assert!(err.contains("outside your projects"), "{err}");
        assert!(fence(&s(&outside.join("deep")), &roots).is_err());
        assert!(fence(&s(&root.join("..").join("outside").join("secret.txt")), &roots).is_err(), "a .. step out");
        assert!(fence(&s(&base.join("project-two")), &roots).is_err(), "a sibling that merely starts with the root's name");
        assert!(fence("src/a.rs", &roots).unwrap_err().contains("not a full path"));
        // A link that leads out is refused.
        let err = fence(&s(&root.join("escape")), &roots).unwrap_err();
        assert!(err.contains("through a link"), "{err}");
        // Hosts are refused as text.
        assert!(fence("\\\\kolux-no-such-host\\share\\x.txt", &roots).unwrap_err().contains("another computer"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn safe022_only_known_document_types_count_as_documents() {
        for p in [
            "setup.bat", "run.CMD", "a.js", "a.mjs", "tool.exe", "link.lnk", "install.msi", "site.url", "notes.one", "query.iqy", "data.slk",
            "x.ps1", "a.sh", "a.py", "a.pyo", "a.pyc", "a.rb", "a.pl", "a.vbs", "a.wsf", "a.jar", "a.hta", "a.scr", "x.docm", "report.docx",
            "sheet.xls", "deck.ppt", "a.rtf", "a.sln", "a.vsix", "a.msstyles", "a.html", "a.htm", "a.xml", "a.svg", "a.csv", "a.tsv",
            "Makefile", "LICENSE", ".bashrc", "a.txt.exe", "a.txt:x.vbs", "PROGRA~1.EXE",
        ] {
            assert!(!document(Path::new(p)), "{p} must not be opened");
        }
        for p in ["readme.txt", "NOTES.MD", "photo.png", "a.JPG", "a.json", "a.yaml", "a.toml", "main.rs", "app.tsx", "a.pdf", "a.exe.txt", "notes~1.txt"] {
            assert!(document(Path::new(p)), "{p} is a document");
        }
        // Windows: a stream name is caught before the type is judged; on POSIX a colon is a character
        assert_eq!(stream_colon(r"C:\x\notes.txt:run.vbs"), cfg!(windows));
        assert_eq!(stream_colon(r"\\?\C:\x\notes.txt:run.vbs"), cfg!(windows));
        assert_eq!(stream_colon(r"\??\C:\x\a.txt:s:$DATA"), cfg!(windows));
        assert!(!stream_colon(r"C:\x\notes.txt"));
        assert!(!stream_colon(r"\\?\C:\x\notes.txt"));
        assert!(!stream_colon("/home/me/notes.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn safe022_the_execute_bit_counts_on_posix() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("krs-links-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("tool.txt");
        std::fs::write(&f, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(document(&f));
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!document(&f));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// RS-1: Windows drops a final `\.`, so `probe.cmd\.` is the script itself; it must never be opened.
    #[cfg(windows)]
    #[test]
    fn rs1_a_script_spelled_with_a_final_dot_is_never_opened() {
        let d = std::env::temp_dir().join(format!("krs-rs1-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("probe.cmd");
        std::fs::write(&f, "@echo off\r\n").unwrap();
        let f = f.to_string_lossy().to_string();
        for p in [format!(r"{f}\."), format!("{f}/."), format!(r"{f}\"), format!(r"{f}\ ."), format!(r"{f}\.\"), format!(r"{f}\..")] {
            assert!(!matches!(open_target(&p, &[]), Ok((OpenChoice::Open, _))), "{p} must be revealed or refused, never opened");
        }
        let (choice, real) = open_target(&f, &[]).unwrap();
        assert_eq!(choice, OpenChoice::Reveal);
        assert!(!real.to_string_lossy().starts_with(r"\\?\"), "the plain real path is handed over");
        let note = d.join("note.txt");
        std::fs::write(&note, "hi").unwrap();
        let (choice, real) = open_target(&note.to_string_lossy(), &[]).unwrap();
        assert_eq!((choice, real), (OpenChoice::Open, PathBuf::from(plain(note.canonicalize().unwrap()))));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A, C): only a known document type is opened. A type the deny list missed
    /// (`.pyo` runs in py.exe, `.sln` starts Visual Studio's build tooling) is revealed instead, and
    /// a name with no type at all is revealed too: Windows may pick a `LICENSE.cmd` beside `LICENSE`
    /// (review A, B). Files are only created here, never opened.
    #[test]
    fn rv2_only_known_document_types_are_opened_and_everything_else_is_revealed() {
        let d = std::env::temp_dir().join(format!("krs-rv2-allow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for name in ["byte.pyo", "app.sln", "LICENSE", "LICENSE.cmd", "notes.txt", "shot.png"] {
            std::fs::write(d.join(name), "x").unwrap();
        }
        let choice = |name: &str| open_target(&d.join(name).to_string_lossy(), &[]).map(|(c, _)| c);
        assert_eq!(choice("byte.pyo"), Ok(OpenChoice::Reveal), ".pyo runs in py.exe");
        assert_eq!(choice("app.sln"), Ok(OpenChoice::Reveal), ".sln is not a plain document");
        assert_eq!(choice("LICENSE"), Ok(OpenChoice::Reveal), "a name with no type is revealed (a LICENSE.cmd sits beside it)");
        assert_eq!(choice("notes.txt"), Ok(OpenChoice::Open), "plain text still opens");
        assert_eq!(choice("shot.png"), Ok(OpenChoice::Open), "an image still opens");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A, A): `notes.txt:run.vbs` is a stream inside notes.txt; Windows opens it by
    /// its own type (.vbs runs in wscript), so a name with a stream part is refused outright.
    #[cfg(windows)]
    #[test]
    fn rv2_a_file_stream_is_refused() {
        let d = std::env::temp_dir().join(format!("krs-rv2-ads-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let note = d.join("notes.txt");
        std::fs::write(&note, "hi").unwrap();
        let stream = format!("{}:run.vbs", note.display());
        std::fs::write(&stream, "' never run").unwrap();
        let got = open_target(&stream, &[]);
        assert!(got.is_err(), "{stream} must be refused, got {got:?}");
        let long = format!(r"\\?\{stream}");
        assert!(open_target(&long, &[]).is_err(), "{long} must be refused");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A, P2): a link on the way to the file (the file itself or a folder above it) that
    /// leads to another machine is refused from its text, before anything resolves it. The
    /// object-namespace spelling of a real local file stands in for a share.
    #[cfg(windows)]
    #[test]
    fn rv2_a_link_to_another_machine_is_refused_before_it_is_followed() {
        let d = std::env::temp_dir().join(format!("krs-rv2-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("far")).unwrap();
        std::fs::write(d.join("far").join("real.txt"), "hi").unwrap();
        let far = |p: &Path| PathBuf::from(format!(r"\\?\GLOBALROOT\GLOBAL??\{}", p.display()));
        std::os::windows::fs::symlink_file(far(&d.join("far").join("real.txt")), d.join("doc.txt")).unwrap();
        std::os::windows::fs::symlink_dir(far(&d.join("far")), d.join("sub")).unwrap();
        for p in [d.join("doc.txt"), d.join("sub").join("real.txt")] {
            let got = open_target(&p.to_string_lossy(), &[]);
            assert!(got.as_ref().is_err_and(|e| e.contains("another computer")), "{} must be refused, got {got:?}", p.display());
        }
        let (choice, _) = open_target(&d.join("far").join("real.txt").to_string_lossy(), &[]).unwrap();
        assert_eq!(choice, OpenChoice::Open, "the file itself, reached directly, still opens");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A2, P2): Windows folds `a\..\b` as text, but the link walk followed the
    /// junction `a` first and then looked for `b` beside the junction's target, so the link `b` (to
    /// another machine) was never read and resolving the path reached it. A `..` step is refused
    /// before the walk, as `fence` does. The object-namespace spelling of a local folder stands in
    /// for a share; no real host is contacted.
    #[cfg(windows)]
    #[test]
    fn rv2_a2_a_dot_dot_step_past_a_junction_cannot_reach_a_remote_link() {
        let d = std::env::temp_dir().join(format!("krs-rv2-dotdot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("elsewhere").join("deep")).unwrap();
        std::fs::create_dir_all(d.join("far")).unwrap();
        std::fs::write(d.join("far").join("x.txt"), "hi").unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(d.join("a"))
            .arg(d.join("elsewhere").join("deep"))
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stdout));
        let far = PathBuf::from(format!(r"\\?\GLOBALROOT\GLOBAL??\{}", d.join("far").display()));
        std::os::windows::fs::symlink_dir(far, d.join("b")).unwrap();
        let sneaky = format!(r"{}\a\..\b\x.txt", d.display());
        let got = open_target(&sneaky, &[]);
        assert!(got.as_ref().is_err_and(|e| e.contains("..")), "{sneaky} must be refused, got {got:?}");
        let plain_dir = format!(r"{}\elsewhere\..\far\x.txt", d.display());
        assert!(open_target(&plain_dir, &[]).is_err(), "{plain_dir}: a .. step is refused as text, link or not");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A3, P2): a link whose own relative target holds a `..` step (`L` -> `a\..\b`)
    /// is folded as text by Windows, but the walk followed the junction `a` inside it first and so
    /// never read the link `b` (to another machine). A link target with a `..` step is refused. The
    /// object-namespace spelling of a local folder stands in for a share; no real host is contacted.
    #[cfg(windows)]
    #[test]
    fn rv2_a3_a_link_whose_target_climbs_with_dot_dot_is_refused() {
        let d = std::env::temp_dir().join(format!("krs-rv2-a3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("elsewhere").join("deep")).unwrap();
        std::fs::create_dir_all(d.join("far")).unwrap();
        std::fs::write(d.join("far").join("x.txt"), "hi").unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(d.join("a"))
            .arg(d.join("elsewhere").join("deep"))
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stdout));
        let far = PathBuf::from(format!(r"\\?\GLOBALROOT\GLOBAL??\{}", d.join("far").display()));
        std::os::windows::fs::symlink_dir(far, d.join("b")).unwrap();
        std::os::windows::fs::symlink_dir(r"a\..\b", d.join("L")).unwrap();
        let sneaky = d.join("L").join("x.txt");
        let got = open_target(&sneaky.to_string_lossy(), &[]);
        assert!(got.is_err(), "{} must be refused, got {got:?}", sneaky.display());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Wave 2 (review A3): the file fence reads every link on the way from its text before it
    /// resolves the path, so a link in a project that leads to another machine is refused before
    /// anything follows it (it used to be followed first and refused only for landing outside).
    #[cfg(windows)]
    #[test]
    fn rv2_a3_the_fence_refuses_a_link_to_another_machine_before_following_it() {
        let d = std::env::temp_dir().join(format!("krs-rv2-a3-fence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("proj")).unwrap();
        std::fs::create_dir_all(d.join("far")).unwrap();
        std::fs::write(d.join("far").join("x.txt"), "hi").unwrap();
        let far = PathBuf::from(format!(r"\\?\GLOBALROOT\GLOBAL??\{}", d.join("far").display()));
        std::os::windows::fs::symlink_dir(far, d.join("proj").join("share")).unwrap();
        let roots = vec![d.join("proj").to_string_lossy().into_owned()];
        let p = d.join("proj").join("share").join("x.txt");
        let got = fence(&p.to_string_lossy(), &roots);
        assert!(got.as_ref().is_err_and(|e| e.contains("another computer")), "{} must be refused from the link's text, got {got:?}", p.display());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// RS-5: the file manager is handed the real path, and never a path holding a double quote.
    #[test]
    fn rs5_reveal_uses_the_real_path_and_refuses_a_quote() {
        assert!(reveal_command(Path::new("/tmp/a\"b.txt")).unwrap_err().contains("double quote"));
        assert!(reveal_command(Path::new(r#"C:\x\a" /e,"C:\y.txt"#)).unwrap_err().contains("double quote"));
        let d = std::env::temp_dir().join(format!("krs-rs5-{}", std::process::id()));
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let f = d.join("seen.txt");
        std::fs::write(&f, "hi").unwrap();
        let c = reveal_command(&d.join("sub").join("..").join("seen.txt")).unwrap();
        let args: Vec<String> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        let real = plain(f.canonicalize().unwrap());
        #[cfg(windows)]
        assert_eq!(args, vec![format!("/select,\"{real}\"")]);
        #[cfg(target_os = "macos")]
        assert_eq!(args, vec!["-R".to_string(), real]);
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(args, vec![Path::new(&real).parent().unwrap().to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn wsl_shares_are_known() {
        assert!(is_wsl(Path::new(r"\\wsl$\Ubuntu\home\a")));
        assert!(is_wsl(Path::new(r"\\wsl.localhost\Ubuntu\x")));
        assert!(!is_wsl(Path::new(r"C:\wsl$\x")));
    }
}
