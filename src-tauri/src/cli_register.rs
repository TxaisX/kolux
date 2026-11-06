//! CLI-008: make the `kolux` command (`kolux-dev` in a development build) available in terminals
//! outside Kolux, or take it away again. Windows adds the CLI folder to the user's PATH in the
//! registry; Linux writes a launcher script in the per-user programs folder (steady for an
//! AppImage); macOS links into /usr/local/bin, asking for administrator rights when it must. Nothing that is not Kolux's own is ever overwritten or deleted.
//! The state is read again after a change, and a change that did not take never shows success.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// What Settings shows: whether the command is registered, where, and why when it is not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    /// `registered`, `not-registered`, `unknown` (PATH unreadable: no change is offered) or `conflict`.
    pub state: &'static str,
    pub command: String,
    /// The folder on PATH, or the launcher file.
    pub place: String,
    pub note: Option<String>,
    /// Whether register / remove should be offered.
    pub can_change: bool,
}

fn view(state: &'static str, place: &str, note: Option<String>) -> Registration {
    Registration { state, command: crate::orchestration::CLI.to_string(), place: place.to_string(), note, can_change: state != "unknown" }
}

// ------------------------------------------------------------------------ Windows: user PATH

/// A folder as PATH compares it: `%VAR%` expanded, slashes alike, no trailing slash, any case.
pub fn same_entry(entry: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> bool {
    let norm = |s: &str| expand(s.trim().trim_matches('"'), env).replace('/', "\\").trim_end_matches('\\').to_lowercase();
    !entry.trim().is_empty() && norm(entry) == norm(dir)
}

fn expand(s: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        match rest[a + 1..].find('%') {
            Some(b) => match env(&rest[a + 1..a + 1 + b]) {
                Some(v) => {
                    out.push_str(&v);
                    rest = &rest[a + b + 2..];
                }
                None => {
                    out.push('%');
                    rest = &rest[a + 1..];
                }
            },
            None => {
                out.push_str(&rest[a..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn path_has(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> bool {
    path.split(';').any(|e| same_entry(e, dir, env))
}

/// PATH with `dir` added at the end; unchanged when it is already there.
pub fn path_with(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    if path_has(path, dir, env) {
        return path.to_string();
    }
    let kept = path.trim_end_matches(';');
    if kept.trim().is_empty() {
        dir.to_string()
    } else {
        format!("{kept};{dir}")
    }
}

/// PATH without any entry that is `dir`; None when it holds none (so nothing is written).
pub fn path_without(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if !path_has(path, dir, env) {
        return None;
    }
    Some(path.split(';').filter(|e| !same_entry(e, dir, env)).collect::<Vec<_>>().join(";"))
}

/// The user's PATH variable as a registry (or a test) holds it.
pub trait UserPath {
    /// None when the user has no PATH variable at all; Err when it cannot be read.
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
}

fn real_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn windows_state(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Registration {
    match store.read() {
        Err(why) => view("unknown", dir, Some(format!("Kolux cannot read your PATH ({why}), so it offers no change"))),
        Ok(p) if path_has(p.as_deref().unwrap_or_default(), dir, env) => view("registered", dir, None),
        Ok(_) => view("not-registered", dir, None),
    }
}

/// Adds `dir` to the user's PATH and reads it back; success is shown only when it is there.
pub fn windows_register(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Result<Registration, String> {
    let now = store.read().map_err(|e| format!("Kolux cannot read your PATH ({e}); nothing was changed"))?.unwrap_or_default();
    if !path_has(&now, dir, env) {
        store.write(&path_with(&now, dir, env)).map_err(|e| format!("Windows refused the change to your PATH: {e}"))?;
    }
    let again = store.read().map_err(|e| format!("the change could not be checked afterwards: {e}"))?.unwrap_or_default();
    if !path_has(&again, dir, env) {
        return Err(format!("{dir} is still not on your PATH after the change; something else holds that setting"));
    }
    Ok(view("registered", dir, None))
}

/// Takes `dir` off the user's PATH; an entry that is not there changes nothing.
pub fn windows_remove(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Result<Registration, String> {
    let now = store.read().map_err(|e| format!("Kolux cannot read your PATH ({e}); nothing was changed"))?.unwrap_or_default();
    if let Some(next) = path_without(&now, dir, env) {
        store.write(&next).map_err(|e| format!("Windows refused the change to your PATH: {e}"))?;
        let again = store.read().map_err(|e| format!("the change could not be checked afterwards: {e}"))?.unwrap_or_default();
        if path_has(&again, dir, env) {
            return Err(format!("{dir} is still on your PATH after the change"));
        }
    }
    Ok(view("not-registered", dir, None))
}

// ------------------------------------------------------------------------ T-594: the installer's long-PATH hand-off

/// The file the installer leaves in the install folder when the user PATH was too long for it to change
/// (NSIS strings hold 1024 characters). Kolux adds the bin folder on its next start and deletes the file.
pub const PATH_PENDING: &str = "kolux-path-pending.txt";

/// The flag the uninstaller runs the app with: take the bin folder off the user PATH, never open a window.
pub const UNINSTALL_PATH_FLAG: &str = "--uninstall-path";

/// What the start-up step did.
#[derive(Debug, PartialEq, Eq)]
pub enum StartPath {
    /// No hand-off file: the installer changed PATH itself, or this install was already handled.
    NotAsked,
    Added,
    AlreadyThere,
    /// Nothing was changed, and why.
    Skipped(String),
}

/// T-594: once per install, the step the installer could not take. The hand-off file is deleted before
/// anything else, so whatever happens next the step never runs again for this install: an entry the user
/// later takes off stays off. An update reinstalls and leaves a new file, so it adds the folder back, as
/// the installer itself does for a shorter PATH (open question for Txais: should a removal last?).
/// The PATH is read and written as text, %VARIABLES% unexpanded; the one change is `;<dir>` at the end
/// (no separator is trimmed, so `path_at_uninstall` gives back exactly what was there).
pub fn path_at_start(marker: &Path, dir: &str, store: &dyn UserPath, env: &dyn Fn(&str) -> Option<String>) -> StartPath {
    if !marker.exists() {
        return StartPath::NotAsked;
    }
    // A crash between this delete and the write below skips the add: safe (nothing changed) and recoverable with Settings > CLI > Register.
    if std::fs::remove_file(marker).is_err() || marker.exists() {
        return StartPath::Skipped(format!("{} could not be deleted, so the PATH was left as it is (it would be added again on every start)", marker.display()));
    }
    let now = match store.read() {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => return StartPath::Skipped(format!("Kolux cannot read your PATH ({e}); nothing was changed")),
    };
    // Any spelling of the folder counts, %LOCALAPPDATA%\... included (cli_register's own rule).
    if path_has(&now, dir, env) {
        return StartPath::AlreadyThere;
    }
    let next = if now.is_empty() { dir.to_string() } else { format!("{now};{dir}") };
    if let Err(e) = store.write(&next) {
        return StartPath::Skipped(format!("Windows refused the change to your PATH: {e}"));
    }
    match store.read() {
        Ok(Some(v)) if path_has(&v, dir, env) => StartPath::Added,
        _ => StartPath::Skipped(format!("{dir} is still not on your PATH after the change; something else holds that setting")),
    }
}

pub fn wants_uninstall_path(args: &[String]) -> bool {
    args.first().map(String::as_str) == Some(UNINSTALL_PATH_FLAG)
}

/// An entry that is the folder exactly as Kolux writes it: any letter case, with or without a trailing `\`.
/// The installer's NSIS rule (KOLUX_PATH_CUT). A %VARIABLE%, quoted or slash-spelled entry is the user's own.
fn ours_literally(entry: &str, dir: &str) -> bool {
    let e = entry.strip_suffix('\\').unwrap_or(entry);
    !e.is_empty() && e.eq_ignore_ascii_case(dir)
}

/// T-594, the uninstaller's step at any PATH length: takes off exactly the entries that are `dir` as Kolux
/// wrote it, keeps every other entry (empty ones too) where it was, and reads the value back.
/// `Ok(true)` when something was taken off, `Ok(false)` when there was nothing of ours (nothing is written).
pub fn path_at_uninstall(marker: &Path, dir: &str, store: &dyn UserPath) -> Result<bool, String> {
    let _ = std::fs::remove_file(marker);
    let now = store.read().map_err(|e| format!("Kolux cannot read your PATH ({e}); nothing was changed"))?.unwrap_or_default();
    if !now.split(';').any(|e| ours_literally(e, dir)) {
        return Ok(false);
    }
    let next = now.split(';').filter(|e| !ours_literally(e, dir)).collect::<Vec<_>>().join(";");
    store.write(&next).map_err(|e| format!("Windows refused the change to your PATH: {e}"))?;
    let again = store.read().map_err(|e| format!("the change could not be checked afterwards: {e}"))?.unwrap_or_default();
    if again.split(';').any(|e| ours_literally(e, dir)) {
        return Err(format!("{dir} is still on your PATH after the change"));
    }
    Ok(true)
}

/// The install folder's hand-off file and bin folder, for the running program; None in a development
/// build (no bin\kolux.exe beside it), which never touches the PATH this way.
fn install_bin() -> Option<(PathBuf, String)> {
    let app = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let bin = app.join("bin");
    bin.join("kolux.exe").is_file().then(|| (app.join(PATH_PENDING), bin.display().to_string()))
}

/// Start-up (lib.rs setup): the installer's hand-off, on a thread of its own (the broadcast after a
/// change can wait up to 2 s); the outcome goes to the log.
pub fn path_at_start_now(log_dir: &Path) {
    let log = log_dir.to_path_buf();
    std::thread::spawn(move || {
        let Some((marker, dir)) = install_bin() else { return };
        #[cfg(windows)]
        let done = path_at_start(&marker, &dir, &Registry, &real_env);
        #[cfg(not(windows))]
        let done = {
            let _ = (&marker, &dir);
            StartPath::NotAsked
        };
        let line = match done {
            StartPath::NotAsked => return,
            StartPath::Added => format!("kolux-rs: added {dir} to the user PATH, which was too long for the installer (T-594)"),
            StartPath::AlreadyThere => format!("kolux-rs: {dir} is already on the user PATH (T-594)"),
            StartPath::Skipped(why) => format!("kolux-rs: the user PATH was not changed: {why} (T-594)"),
        };
        crate::diag::write(&log, &line);
    });
}

/// The binary's hook for the uninstaller (`<app>.exe --uninstall-path`): never opens the window.
/// Exit 0: taken off; 2: there was nothing of ours; 1: it could not be taken off.
pub fn uninstall_main(args: &[String]) -> Option<i32> {
    if !wants_uninstall_path(args) {
        return None;
    }
    let Some((marker, dir)) = install_bin() else { return Some(2) };
    #[cfg(windows)]
    let done = path_at_uninstall(&marker, &dir, &Registry);
    #[cfg(not(windows))]
    let done: Result<bool, String> = {
        let _ = (&marker, &dir);
        Ok(false)
    };
    Some(match done {
        Ok(true) => 0,
        Ok(false) => 2,
        Err(_) => 1,
    })
}

#[cfg(windows)]
pub struct Registry;

#[cfg(windows)]
impl Registry {
    /// The name the value goes by in HKCU\Environment, whatever its letter case (Path, PATH, path).
    fn name() -> Result<Option<(Vec<u16>, u32)>, String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_READ, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let mut found = None;
        let mut i = 0u32;
        loop {
            let mut name = vec![0u16; 16384];
            let mut len = name.len() as u32;
            let mut kind = 0u32;
            // SAFETY: `name` holds `len` UTF-16 units.
            let rc = unsafe { RegEnumValueW(h, i, name.as_mut_ptr(), &mut len, std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), std::ptr::null_mut()) };
            if rc != 0 {
                break;
            }
            name.truncate(len as usize);
            if String::from_utf16_lossy(&name).eq_ignore_ascii_case("path") {
                name.push(0);
                found = Some((name, kind));
                break;
            }
            i += 1;
        }
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        Ok(found)
    }
}

#[cfg(windows)]
impl UserPath for Registry {
    fn read(&self) -> Result<Option<String>, String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
        let Some((name, _)) = Registry::name()? else { return Ok(None) };
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_READ, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let mut bytes = 0u32;
        // SAFETY: a null buffer asks only for the size.
        let mut rc = unsafe { RegQueryValueExW(h, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes) };
        let mut buf = vec![0u16; bytes as usize / 2 + 2];
        if rc == 0 {
            let mut len = (buf.len() * 2) as u32;
            // SAFETY: `buf` holds `len` bytes.
            rc = unsafe { RegQueryValueExW(h, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        }
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Ok(Some(String::from_utf16_lossy(&buf[..end])))
    }

    fn write(&self, value: &str) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_EXPAND_SZ};
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        // The existing name keeps its spelling; a missing PATH is made as `Path`. A PATH that holds %VARS% stays expandable.
        let name = match Registry::name()? {
            Some((n, _)) => n,
            None => "Path\0".encode_utf16().collect(),
        };
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_SET_VALUE, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let data: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        // SAFETY: `data` is a null-terminated UTF-16 string of `data.len() * 2` bytes.
        let rc = unsafe { RegSetValueExW(h, name.as_ptr(), 0, REG_EXPAND_SZ, data.as_ptr().cast(), (data.len() * 2) as u32) };
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        // Tell running programs (Explorer, new terminals) the environment changed.
        let env: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut out = 0usize;
        // SAFETY: the broadcast carries a null-terminated string that outlives the call.
        unsafe { SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, env.as_ptr() as isize, SMTO_ABORTIFHUNG, 2000, &mut out) };
        Ok(())
    }
}

// ------------------------------------------------------------------------ Linux / macOS: launcher

const MARK: &str = "# written by Kolux: kolux command launcher";

/// The launcher script: it runs the installed program with the arguments it was given. An AppImage
/// gets the steady kind (`appimage_script`).
pub fn launcher_script(exe: &Path) -> String {
    if is_appimage(exe) {
        return appimage_script(exe);
    }
    format!("#!/bin/sh\n{MARK}\nexec \"{}\" \"$@\"\n", exe.display().to_string().replace('"', "\\\""))
}

/// Whether the program is an AppImage file (it runs from a temporary mount, so its own path is no
/// place to point a launcher at).
pub fn is_appimage(exe: &Path) -> bool {
    exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("appimage"))
}

/// The program a launcher or link should run: the AppImage file itself when Kolux runs from one
/// (`APPIMAGE` names it), otherwise the running program.
pub fn launch_exe(appimage_env: Option<String>, current: PathBuf) -> PathBuf {
    match appimage_env.filter(|v| !v.trim().is_empty()) {
        Some(v) => PathBuf::from(v),
        None => current,
    }
}

/// A word safe inside a POSIX shell command: single-quoted, with its own quotes closed and reopened.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// CLI-008, AppImage: the launcher stays put while the image moves or is replaced. It runs the image it
/// was written for; while that file is missing (a newer version is being put in place, or the old name is
/// gone) it runs the newest sibling whose name starts the same way, so it moves to the new version once
/// that exists. Kolux rewrites it for the new image on its next start (`launcher_follow`).
pub fn appimage_script(image: &Path) -> String {
    format!(
        "#!/bin/sh\n{MARK}\nimg={}\nif [ ! -x \"$img\" ]; then\n  dir=$(dirname \"$img\"); name=$(basename \"$img\"); prefix=${{name%%[-_0-9]*}}\n  for c in \"$dir/$prefix\"*.AppImage; do [ -x \"$c\" ] && img=$c; done\nfi\nexec \"$img\" \"$@\"\n",
        sh_quote(&image.display().to_string())
    )
}

/// Kolux started from an AppImage that is not where its launcher points: the launcher Kolux wrote moves
/// to this image. Nothing else is touched (a foreign file, or no launcher at all, stays as it is).
pub fn launcher_follow(target: &Path, exe: &Path, on_path: bool) -> Option<Registration> {
    if !is_appimage(exe) {
        return None;
    }
    match inspect(target, &launcher_script(exe)) {
        Target::Ours { current: false } => launcher_register(target, exe, on_path).ok(),
        _ => None,
    }
}

// ------------------------------------------------------------------------ macOS: a link in /usr/local/bin

/// The system-wide folder for locally installed programs.
pub const MAC_LINK_DIR: &str = "/usr/local/bin";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkKind {
    Missing,
    /// A symbolic link, and where it points.
    Link(PathBuf),
    /// A file, folder or anything else that is not a link.
    Other,
}

/// The file operations the macOS link needs, so the logic can be tested without a Mac or admin rights.
pub trait Links {
    fn kind(&self, at: &Path) -> LinkKind;
    fn link(&self, exe: &Path, at: &Path) -> std::io::Result<()>;
    fn unlink(&self, at: &Path) -> std::io::Result<()>;
    /// Run a shell command with administrator rights (the system asks the person); an error says why not.
    fn elevated(&self, shell: &str) -> Result<(), String>;
}

/// Kolux's own link: it points at a program named like this one (an older install path counts as ours,
/// an outdated link to replace); anything else is somebody else's.
fn link_is_ours(to: &Path, exe: &Path) -> bool {
    to.file_name().is_some() && to.file_name() == exe.file_name()
}

pub fn mac_state(links: &dyn Links, at: &Path, exe: &Path, on_path: bool) -> Registration {
    let place = at.display().to_string();
    match links.kind(at) {
        LinkKind::Missing => view("not-registered", &place, None),
        LinkKind::Link(to) if link_is_ours(&to, exe) && to == exe => view("registered", &place, (!on_path).then(|| format!("{} is not on your PATH yet; add it to your shell profile", at.parent().map(|p| p.display().to_string()).unwrap_or_default()))),
        LinkKind::Link(to) if link_is_ours(&to, exe) => view("not-registered", &place, None),
        _ => view("conflict", &place, Some(conflict(at))),
    }
}

/// The shell text of an administrator step: make the folder, then the link (replacing only a link of ours).
pub fn mac_link_shell(exe: &Path, at: &Path, replace: bool) -> String {
    let dir = at.parent().map(|d| d.display().to_string()).unwrap_or_default();
    format!("mkdir -p {} && ln -s{} {} {}", sh_quote(&dir), if replace { "fn" } else { "" }, sh_quote(&exe.display().to_string()), sh_quote(&at.display().to_string()))
}

/// The arguments for osascript that run `shell` with an administrator prompt.
pub fn osascript_args(shell: &str) -> Vec<String> {
    let quoted = shell.replace('\\', "\\\\").replace('"', "\\\"");
    vec!["-e".to_string(), format!("do shell script \"{quoted}\" with administrator privileges")]
}

fn mac_check(links: &dyn Links, at: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    let now = mac_state(links, at, exe, on_path);
    if now.state == "conflict" {
        return Err(conflict(at));
    }
    Ok(now)
}

/// Register: link directly when the folder lets us, otherwise ask for administrator rights. The link
/// is looked at again afterwards; a file somebody put there meanwhile is reported and left alone.
pub fn mac_register(links: &dyn Links, at: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    let before = mac_state(links, at, exe, on_path);
    match before.state {
        "conflict" => return Err(conflict(at)),
        "registered" => return Ok(before),
        _ => {}
    }
    let replace = links.kind(at) != LinkKind::Missing;
    let direct = (if replace { links.unlink(at) } else { Ok(()) }).and_then(|()| links.link(exe, at));
    if direct.is_err() {
        // The folder cannot be written (or the old link cannot go): the system asks for rights.
        links.elevated(&mac_link_shell(exe, at, replace)).map_err(|e| format!("the administrator step did not finish: {e}"))?;
    }
    let after = mac_check(links, at, exe, on_path)?;
    if after.state != "registered" {
        return Err(format!("{} does not hold the link after creating it", at.display()));
    }
    Ok(after)
}

pub fn mac_remove(links: &dyn Links, at: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    let before = mac_state(links, at, exe, on_path);
    match before.state {
        "conflict" => return Err(conflict(at)),
        "not-registered" if links.kind(at) == LinkKind::Missing => return Ok(before),
        _ => {}
    }
    if links.unlink(at).is_err() {
        links.elevated(&format!("rm {}", sh_quote(&at.display().to_string()))).map_err(|e| format!("the administrator step did not finish: {e}"))?;
    }
    // The link may have been put back by someone else between the steps: that is a conflict, not a success.
    let after = mac_check(links, at, exe, on_path)?;
    if links.kind(at) != LinkKind::Missing {
        return Err(format!("{} is still there after removing it", at.display()));
    }
    Ok(after)
}

/// The real thing: symbolic links on disk, and osascript for the administrator prompt (ten minutes at most).
pub struct RealLinks;

impl Links for RealLinks {
    fn kind(&self, at: &Path) -> LinkKind {
        match std::fs::symlink_metadata(at) {
            Err(_) => LinkKind::Missing,
            Ok(m) if m.file_type().is_symlink() => std::fs::read_link(at).map(LinkKind::Link).unwrap_or(LinkKind::Other),
            Ok(_) => LinkKind::Other,
        }
    }
    fn link(&self, exe: &Path, at: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            if let Some(dir) = at.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::os::unix::fs::symlink(exe, at)
        }
        #[cfg(not(unix))]
        {
            let _ = (exe, at);
            Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "links are made on macOS only"))
        }
    }
    fn unlink(&self, at: &Path) -> std::io::Result<()> {
        std::fs::remove_file(at)
    }
    fn elevated(&self, shell: &str) -> Result<(), String> {
        let mut child = std::process::Command::new("osascript").args(osascript_args(shell)).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("cannot start osascript: {e}"))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => return Ok(()),
                Ok(Some(_)) => return Err("it was cancelled or refused".to_string()),
                Ok(None) if std::time::Instant::now() >= deadline => {
                    let _ = child.kill();
                    return Err("timed out waiting for the administrator prompt".to_string());
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(200)),
                Err(e) => return Err(e.to_string()),
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    Missing,
    /// A launcher Kolux wrote; `current` says whether it points at this build.
    Ours { current: bool },
    /// Something else is there: a file or link of unknown origin.
    Foreign,
}

pub fn inspect(target: &Path, wanted: &str) -> Target {
    let Ok(meta) = std::fs::symlink_metadata(target) else { return Target::Missing };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Target::Foreign;
    }
    match std::fs::read_to_string(target) {
        Ok(text) if text.contains(MARK) => Target::Ours { current: text == wanted },
        _ => Target::Foreign,
    }
}

fn conflict(target: &Path) -> String {
    format!("{} already exists and was not written by Kolux; it was left as it is. Move or delete it, then register again", target.display())
}

pub fn launcher_state(target: &Path, exe: &Path, on_path: bool) -> Registration {
    let place = target.display().to_string();
    match inspect(target, &launcher_script(exe)) {
        Target::Foreign => view("conflict", &place, Some(conflict(target))),
        Target::Ours { current: true } => view("registered", &place, (!on_path).then(|| format!("{} is not on your PATH yet; add it to your shell profile", target.parent().map(|p| p.display().to_string()).unwrap_or_default()))),
        Target::Ours { current: false } | Target::Missing => view("not-registered", &place, None),
    }
}

pub fn launcher_register(target: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    let want = launcher_script(exe);
    if inspect(target, &want) == Target::Foreign {
        return Err(conflict(target));
    }
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(target, &want).map_err(|e| format!("cannot write {}: {e}", target.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755)).map_err(|e| format!("cannot make {} runnable: {e}", target.display()))?;
    }
    // Look at the target again: it must be our launcher now, or the registration did not work.
    match inspect(target, &want) {
        Target::Ours { current: true } => Ok(launcher_state(target, exe, on_path)),
        _ => Err(format!("{} does not hold the launcher after writing it", target.display())),
    }
}

pub fn launcher_remove(target: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    match inspect(target, &launcher_script(exe)) {
        Target::Foreign => Err(conflict(target)),
        Target::Missing => Ok(launcher_state(target, exe, on_path)),
        Target::Ours { .. } => {
            std::fs::remove_file(target).map_err(|e| format!("cannot remove {}: {e}", target.display()))?;
            if target.exists() {
                return Err(format!("{} is still there after removing it", target.display()));
            }
            Ok(launcher_state(target, exe, on_path))
        }
    }
}

// ------------------------------------------------------------------------ the app's three commands

/// T-593 (CLI-006, DT-R27): the folder the command lives in. An installed copy keeps kolux.exe and
/// kolux.cmd in a bin folder beside the app; a development build runs its CLI from its own folder.
/// Registration, Settings, the setup guide (ONB-027) and new panes (CLI-007) all use this one rule.
pub fn cli_dir(app_dir: &Path) -> PathBuf {
    let bin = app_dir.join("bin");
    if bin.join(if cfg!(windows) { "kolux.exe" } else { "kolux" }).is_file() {
        bin
    } else {
        app_dir.to_path_buf()
    }
}

fn folder_and_exe() -> Result<(PathBuf, PathBuf), String> {
    let current = std::env::current_exe().map_err(|e| format!("Kolux cannot find its own program: {e}"))?;
    folder_and_exe_of(current, std::env::var("APPIMAGE").ok())
}

/// The CLI folder and the program a launcher runs, for the running program `current`.
fn folder_and_exe_of(current: PathBuf, appimage: Option<String>) -> Result<(PathBuf, PathBuf), String> {
    let exe = launch_exe(appimage, current);
    let dir = cli_dir(exe.parent().ok_or("Kolux cannot find its own folder")?);
    Ok((dir, exe))
}

/// The command's own file in the CLI folder; naming it when it is missing says what is in the way.
fn command_file(dir: &Path) -> Result<(), String> {
    let name = crate::orchestration::CLI;
    if ["exe", "cmd"].iter().any(|e| dir.join(format!("{name}.{e}")).is_file()) || cfg!(not(windows)) {
        Ok(())
    } else {
        Err(format!("{} holds no {name}.exe or {name}.cmd, so there is nothing to register", dir.display()))
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn launcher_target() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("HOME is not set")?;
    Ok(home.join(".local").join("bin").join(crate::orchestration::CLI))
}

#[cfg(not(windows))]
fn target_on_path(target: &Path) -> bool {
    let dir = target.parent().map(|d| d.to_path_buf());
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| Some(d) == dir))
}

#[cfg(target_os = "macos")]
fn mac_target() -> PathBuf {
    Path::new(MAC_LINK_DIR).join(crate::orchestration::CLI)
}

pub fn state_now() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    #[cfg(windows)]
    {
        let _ = exe;
        Ok(windows_state(&Registry, &dir.display().to_string(), &real_env))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = dir;
        let t = mac_target();
        Ok(mac_state(&RealLinks, &t, &exe, target_on_path(&t)))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = dir;
        let t = launcher_target()?;
        let on_path = target_on_path(&t);
        // An AppImage that was moved or updated: the launcher Kolux wrote follows it.
        if let Some(moved) = launcher_follow(&t, &exe, on_path) {
            return Ok(moved);
        }
        Ok(launcher_state(&t, &exe, on_path))
    }
}

/// Settings > CLI: where the command is, and whether it is registered right now.
#[tauri::command]
pub fn cli_register_state() -> Result<Registration, String> {
    state_now()
}

/// Settings > CLI: register the command for the whole system.
#[tauri::command]
pub fn cli_register() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    command_file(&dir)?;
    #[cfg(windows)]
    {
        let _ = exe;
        windows_register(&Registry, &dir.display().to_string(), &real_env)
    }
    #[cfg(target_os = "macos")]
    {
        let t = mac_target();
        mac_register(&RealLinks, &t, &exe, target_on_path(&t))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let t = launcher_target()?;
        launcher_register(&t, &exe, target_on_path(&t))
    }
}

/// Settings > CLI: take the command away again.
#[tauri::command]
pub fn cli_unregister() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    #[cfg(windows)]
    {
        let _ = exe;
        windows_remove(&Registry, &dir.display().to_string(), &real_env)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = dir;
        let t = mac_target();
        mac_remove(&RealLinks, &t, &exe, target_on_path(&t))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = dir;
        let t = launcher_target()?;
        launcher_remove(&t, &exe, target_on_path(&t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        value: RefCell<Option<String>>,
        unreadable: bool,
        refuses: bool,
        writes: RefCell<u32>,
    }
    impl Fake {
        fn new(v: Option<&str>) -> Fake {
            Fake { value: RefCell::new(v.map(String::from)), unreadable: false, refuses: false, writes: RefCell::new(0) }
        }
    }
    impl UserPath for Fake {
        fn read(&self) -> Result<Option<String>, String> {
            if self.unreadable {
                return Err("access denied".into());
            }
            Ok(self.value.borrow().clone())
        }
        fn write(&self, v: &str) -> Result<(), String> {
            *self.writes.borrow_mut() += 1;
            if !self.refuses {
                *self.value.borrow_mut() = Some(v.to_string());
            }
            Ok(())
        }
    }
    fn env(n: &str) -> Option<String> {
        (n.eq_ignore_ascii_case("localappdata")).then(|| r"C:\Users\me\AppData\Local".to_string())
    }
    const DIR: &str = r"C:\Users\me\AppData\Local\Programs\Kolux RS";

    #[test]
    fn cli008_a_folder_matches_whatever_its_case_slashes_trailing_slash_or_variables() {
        assert!(path_has(r"C:\a;c:/users/me/appdata/local/programs/kolux rs/;C:\b", DIR, &env));
        assert!(path_has(r"%LOCALAPPDATA%\Programs\Kolux RS", DIR, &env));
        assert!(!path_has(r"C:\a;C:\Users\me\AppData\Local\Programs\Kolux RS2", DIR, &env));
        assert!(!path_has("", DIR, &env));
        assert_eq!(path_with(r"C:\a;", DIR, &env), format!(r"C:\a;{DIR}"));
        assert_eq!(path_with("", DIR, &env), DIR);
        assert_eq!(path_with(&format!(r"C:\a;{DIR}"), DIR, &env), format!(r"C:\a;{DIR}"));
    }

    #[test]
    fn cli008_removing_an_entry_the_path_does_not_hold_changes_nothing() {
        assert_eq!(path_without(r"C:\a;C:\b", DIR, &env), None);
        assert_eq!(path_without(&format!(r"C:\a;{DIR};C:\b"), DIR, &env).unwrap(), r"C:\a;C:\b");
        let f = Fake::new(Some(r"C:\a"));
        let r = windows_remove(&f, DIR, &env).unwrap();
        assert_eq!((r.state, *f.writes.borrow()), ("not-registered", 0));
    }

    #[test]
    fn cli008_register_adds_the_folder_reads_it_back_and_remove_takes_it_away() {
        let f = Fake::new(Some(r"C:\a"));
        assert_eq!(windows_state(&f, DIR, &env).state, "not-registered");
        let r = windows_register(&f, DIR, &env).unwrap();
        assert_eq!(r.state, "registered");
        assert_eq!(f.value.borrow().clone().unwrap(), format!(r"C:\a;{DIR}"));
        assert_eq!(windows_state(&f, DIR, &env).state, "registered");
        // Registering twice writes nothing the second time.
        let before = *f.writes.borrow();
        windows_register(&f, DIR, &env).unwrap();
        assert_eq!(*f.writes.borrow(), before);
        assert_eq!(windows_remove(&f, DIR, &env).unwrap().state, "not-registered");
        assert_eq!(f.value.borrow().clone().unwrap(), r"C:\a");
    }

    /// T-593 (CLI-007, R01-cli.1): the installed layout (scripts/release.mjs, DT-R27) keeps kolux.exe and
    /// kolux.cmd in a bin folder beside the app; state, register and remove all work on that folder.
    #[test]
    fn cli007_an_installed_copy_registers_the_bin_folder_beside_the_app() {
        let d = scratch("installed");
        let app = d.join(if cfg!(windows) { "kolux-rs.exe" } else { "kolux-rs" });
        std::fs::write(&app, "").unwrap();
        // A development build: no bin folder, so the CLI is the program's own folder.
        assert_eq!(folder_and_exe_of(app.clone(), None).unwrap(), (d.to_path_buf(), app.clone()));
        let bin = d.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        // cli_dir keys on kolux.exe; command_file wants this build's own command, kolux-dev in a test build.
        let own = format!("{}.cmd", crate::orchestration::CLI);
        for f in [if cfg!(windows) { "kolux.exe" } else { "kolux" }, "kolux.cmd", own.as_str()] {
            std::fs::write(bin.join(f), "").unwrap();
        }
        let (dir, exe) = folder_and_exe_of(app.clone(), None).unwrap();
        assert_eq!((&dir, &exe), (&bin, &app));
        command_file(&dir).unwrap();
        let f = Fake::new(Some(r"C:\a"));
        let place = dir.display().to_string();
        assert_eq!(windows_state(&f, &place, &env).state, "not-registered");
        assert_eq!(windows_register(&f, &place, &env).unwrap().state, "registered");
        assert_eq!(f.value.borrow().clone().unwrap(), format!(r"C:\a;{place}"));
        assert_eq!(windows_state(&f, &place, &env).state, "registered");
        assert_eq!(windows_remove(&f, &place, &env).unwrap().state, "not-registered");
        assert_eq!(f.value.borrow().clone().unwrap(), r"C:\a");
    }

    #[test]
    fn cli008_an_unreadable_path_shows_unknown_and_offers_no_change_and_a_change_that_did_not_take_is_an_error() {
        let mut f = Fake::new(Some(r"C:\a"));
        f.unreadable = true;
        let s = windows_state(&f, DIR, &env);
        assert_eq!((s.state, s.can_change), ("unknown", false));
        assert!(windows_register(&f, DIR, &env).unwrap_err().contains("nothing was changed"));
        assert_eq!(*f.writes.borrow(), 0);
        let mut g = Fake::new(Some(r"C:\a"));
        g.refuses = true;
        let e = windows_register(&g, DIR, &env).unwrap_err();
        assert!(e.contains("still not on your PATH"), "{e}");
    }

    fn scratch(tag: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(&format!("cli008-{tag}"))
    }

    #[test]
    fn cli008_a_launcher_of_unknown_origin_is_a_conflict_left_where_it_is_and_our_old_one_is_replaced() {
        let d = scratch("launcher");
        let exe = d.join("app").join("kolux-rs");
        let target = d.join("bin").join("kolux");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        // Something else is at the target: reported with its path, untouched.
        std::fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
        let e = launcher_register(&target, &exe, true).unwrap_err();
        assert!(e.contains(&target.display().to_string()) && e.contains("not written by Kolux"), "{e}");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "#!/bin/sh\necho mine\n");
        assert_eq!(launcher_state(&target, &exe, true).state, "conflict");
        assert!(launcher_remove(&target, &exe, true).is_err());
        assert!(target.exists());
        // Free again: register writes ours; an outdated one of ours is replaced; remove deletes ours only.
        std::fs::remove_file(&target).unwrap();
        assert_eq!(launcher_register(&target, &exe, true).unwrap().state, "registered");
        let old = d.join("old").join("kolux-rs");
        std::fs::write(&target, launcher_script(&old)).unwrap();
        assert_eq!(launcher_state(&target, &exe, true).state, "not-registered");
        assert_eq!(launcher_register(&target, &exe, true).unwrap().state, "registered");
        assert!(std::fs::read_to_string(&target).unwrap().contains(&exe.display().to_string()));
        assert_eq!(launcher_remove(&target, &exe, true).unwrap().state, "not-registered");
        assert!(!target.exists());
        // Removing what is not there changes nothing.
        assert_eq!(launcher_remove(&target, &exe, true).unwrap().state, "not-registered");
        // A folder that is not on PATH is a warning on a registered launcher, not a failure.
        let r = launcher_register(&target, &exe, false).unwrap();
        assert!(r.note.unwrap().contains("not on your PATH"));
    }

    /// An in-memory folder: one path, what is at it, whether writing needs rights, what the admin step does.
    struct Mac {
        at: RefCell<LinkKind>,
        needs_rights: bool,
        admin: RefCell<Vec<String>>,
        admin_fails: bool,
        /// Someone else's file appears while the admin step runs.
        race: bool,
        at_path: PathBuf,
        exe: PathBuf,
    }
    impl Mac {
        fn new(at: LinkKind, needs_rights: bool) -> Mac {
            Mac { at: RefCell::new(at), needs_rights, admin: RefCell::new(Vec::new()), admin_fails: false, race: false, at_path: PathBuf::from("/usr/local/bin/kolux"), exe: PathBuf::from("/Applications/Kolux.app/Contents/MacOS/Kolux") }
        }
    }
    impl Links for Mac {
        fn kind(&self, _: &Path) -> LinkKind {
            self.at.borrow().clone()
        }
        fn link(&self, exe: &Path, _: &Path) -> std::io::Result<()> {
            if self.needs_rights {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            *self.at.borrow_mut() = LinkKind::Link(exe.to_path_buf());
            Ok(())
        }
        fn unlink(&self, _: &Path) -> std::io::Result<()> {
            if self.needs_rights {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            *self.at.borrow_mut() = LinkKind::Missing;
            Ok(())
        }
        fn elevated(&self, shell: &str) -> Result<(), String> {
            self.admin.borrow_mut().push(shell.to_string());
            if self.admin_fails {
                return Err("timed out waiting for the administrator prompt".into());
            }
            *self.at.borrow_mut() = if self.race {
                LinkKind::Other
            } else if shell.starts_with("rm ") {
                LinkKind::Missing
            } else {
                LinkKind::Link(self.exe.clone())
            };
            Ok(())
        }
    }

    #[test]
    fn cli008_macos_links_directly_asks_for_rights_only_when_the_folder_cannot_be_written() {
        let m = Mac::new(LinkKind::Missing, false);
        assert_eq!(mac_state(&m, &m.at_path, &m.exe, true).state, "not-registered");
        assert_eq!(mac_register(&m, &m.at_path, &m.exe, true).unwrap().state, "registered");
        assert!(m.admin.borrow().is_empty(), "a writable folder never prompts");
        assert_eq!(mac_remove(&m, &m.at_path, &m.exe, true).unwrap().state, "not-registered");
        // A folder that needs rights: one admin step, quoted, and the link is looked at again.
        let m = Mac::new(LinkKind::Missing, true);
        assert_eq!(mac_register(&m, &m.at_path, &m.exe, true).unwrap().state, "registered");
        assert_eq!(m.admin.borrow().as_slice(), ["mkdir -p '/usr/local/bin' && ln -s '/Applications/Kolux.app/Contents/MacOS/Kolux' '/usr/local/bin/kolux'"]);
        assert_eq!(mac_remove(&m, &m.at_path, &m.exe, true).unwrap().state, "not-registered");
        assert_eq!(m.admin.borrow().last().unwrap(), "rm '/usr/local/bin/kolux'");
        // Removing what is not there changes nothing and asks nothing.
        let n = m.admin.borrow().len();
        assert_eq!(mac_remove(&m, &m.at_path, &m.exe, true).unwrap().state, "not-registered");
        assert_eq!(m.admin.borrow().len(), n);
    }

    #[test]
    fn cli008_macos_a_file_or_link_of_unknown_origin_is_a_conflict_and_an_old_link_of_ours_is_replaced() {
        let other = Mac::new(LinkKind::Other, false);
        let e = mac_register(&other, &other.at_path, &other.exe, true).unwrap_err();
        assert!(e.contains("/usr/local/bin/kolux") && e.contains("not written by Kolux"), "{e}");
        assert!(mac_remove(&other, &other.at_path, &other.exe, true).is_err());
        assert_eq!(*other.at.borrow(), LinkKind::Other, "left as it was");
        assert!(other.admin.borrow().is_empty());
        let foreign = Mac::new(LinkKind::Link(PathBuf::from("/opt/homebrew/bin/kolux-cli")), false);
        assert_eq!(mac_state(&foreign, &foreign.at_path, &foreign.exe, true).state, "conflict");
        // A link to this program under an older place counts as ours and is replaced (with an admin step if need be).
        let old = Mac::new(LinkKind::Link(PathBuf::from("/Users/me/Downloads/Kolux")), true);
        assert_eq!(mac_state(&old, &old.at_path, &old.exe, true).state, "not-registered");
        assert_eq!(mac_register(&old, &old.at_path, &old.exe, true).unwrap().state, "registered");
        assert!(old.admin.borrow()[0].contains("ln -sfn"));
    }

    #[test]
    fn cli008_macos_a_failed_or_raced_admin_step_never_shows_success_and_deletes_nothing() {
        let mut m = Mac::new(LinkKind::Missing, true);
        m.admin_fails = true;
        let e = mac_register(&m, &m.at_path, &m.exe, true).unwrap_err();
        assert!(e.contains("timed out"), "{e}");
        assert_eq!(*m.at.borrow(), LinkKind::Missing);
        // Somebody else's file arrives while the prompt is open: reported, not deleted.
        let mut r = Mac::new(LinkKind::Missing, true);
        r.race = true;
        assert!(mac_register(&r, &r.at_path, &r.exe, true).unwrap_err().contains("not written by Kolux"));
        assert_eq!(*r.at.borrow(), LinkKind::Other);
        let mut g = Mac::new(LinkKind::Link(PathBuf::from("/Applications/Kolux.app/Contents/MacOS/Kolux")), true);
        g.race = true;
        assert!(mac_remove(&g, &g.at_path, &g.exe, true).is_err());
        assert_eq!(*g.at.borrow(), LinkKind::Other);
    }

    #[test]
    fn cli008_macos_shell_and_prompt_text_are_quoted() {
        assert_eq!(sh_quote("it's here"), "'it'\\''s here'");
        let a = osascript_args("rm '/a \"b\"'");
        assert_eq!(a[0], "-e");
        assert_eq!(a[1], "do shell script \"rm '/a \\\"b\\\"'\" with administrator privileges");
        assert!(mac_link_shell(Path::new("/x y/Kolux"), Path::new("/usr/local/bin/kolux"), false).contains("'/x y/Kolux'"));
    }

    #[test]
    fn cli008_an_appimage_launcher_names_the_image_falls_back_to_a_newer_sibling_and_follows_a_move() {
        let img = Path::new("/home/me/Apps/Kolux-0.15.0.AppImage");
        assert!(is_appimage(img) && !is_appimage(Path::new("/opt/kolux/kolux")));
        let s = launcher_script(img);
        assert!(s.contains("img='/home/me/Apps/Kolux-0.15.0.AppImage'") && s.contains("prefix=${name%%[-_0-9]*}") && s.contains("*.AppImage; do"), "{s}");
        // APPIMAGE wins over the temporary mount path the program runs from.
        assert_eq!(launch_exe(Some("/home/me/Apps/K.AppImage".into()), PathBuf::from("/tmp/.mount_x/kolux")), PathBuf::from("/home/me/Apps/K.AppImage"));
        assert_eq!(launch_exe(Some(" ".into()), PathBuf::from("/opt/kolux")), PathBuf::from("/opt/kolux"));
        // Moved: the launcher Kolux wrote follows to the new image; a foreign file and a missing launcher are left alone.
        let d = scratch("appimage");
        let target = d.join("bin").join("kolux");
        let old = d.join("old").join("Kolux-0.15.0.AppImage");
        let new = d.join("new").join("Kolux-0.16.0.AppImage");
        assert!(launcher_follow(&target, &new, true).is_none());
        launcher_register(&target, &old, true).unwrap();
        assert!(launcher_follow(&target, &old, true).is_none(), "already current");
        assert_eq!(launcher_follow(&target, &new, true).unwrap().state, "registered");
        assert!(std::fs::read_to_string(&target).unwrap().contains("Kolux-0.16.0.AppImage"));
        std::fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
        assert!(launcher_follow(&target, &old, true).is_none());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "#!/bin/sh\necho mine\n");
        assert!(launcher_follow(&target, Path::new("/opt/kolux/kolux"), true).is_none(), "only an AppImage follows");
    }

    /// T-594: Txais's user PATH is 1,815 characters; NSIS can change at most 1,023, so the installer
    /// leaves the hand-off file and Kolux adds the bin folder when it starts.
    const BIN: &str = r"C:\Users\me\AppData\Local\Kolux RS\bin";

    fn long_path() -> String {
        let mut p = String::from(r"%SystemRoot%\system32;%SystemRoot%;%USERPROFILE%\.cargo\bin;;%LOCALAPPDATA%\Microsoft\WindowsApps;C:\Program Files\Git\cmd");
        let mut i = 0;
        while p.len() < 1801 {
            p.push_str(&format!(r";C:\Tools\some-long-tool-folder-{i:03}\bin"));
            i += 1;
        }
        p.truncate(1801);
        p.push_str(r";%APPDATA%\npm");
        assert_eq!(p.chars().count(), 1815);
        p
    }

    fn pending(tag: &str) -> (crate::test_dir::TempDir, PathBuf) {
        let d = scratch(tag);
        let m = d.join(PATH_PENDING);
        std::fs::write(&m, "x").unwrap();
        (d, m)
    }

    #[test]
    fn t594_a_path_over_1024_characters_gains_the_bin_folder_once_and_is_otherwise_unchanged() {
        let before = long_path();
        assert!(before.len() > 1024 && before.contains("%SystemRoot%"), "{}", before.len());
        let f = Fake::new(Some(&before));
        let (_d, m) = pending("t594-add");
        assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::Added);
        let after = f.value.borrow().clone().unwrap();
        // Everything the user had is there byte for byte, %VARIABLES% unexpanded; ours is the one new entry.
        assert_eq!(after, format!("{before};{BIN}"));
        assert_eq!(after.split(';').filter(|e| *e == BIN).count(), 1);
        assert_eq!(*f.writes.borrow(), 1);
        assert!(!m.exists(), "the hand-off file is used up");
    }

    #[test]
    fn t594_a_second_start_adds_nothing() {
        let f = Fake::new(Some(&long_path()));
        let (_d, m) = pending("t594-twice");
        assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::Added);
        let once = f.value.borrow().clone();
        assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::NotAsked);
        // Even a hand-off file left by a second install over it adds no second entry.
        std::fs::write(&m, "x").unwrap();
        assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::AlreadyThere);
        assert_eq!((f.value.borrow().clone(), *f.writes.borrow()), (once, 1));
    }

    #[test]
    fn t594_an_entry_the_user_removed_stays_removed() {
        let before = long_path();
        let f = Fake::new(Some(&before));
        let (_d, m) = pending("t594-removed");
        assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::Added);
        // The user takes it off (Settings > CLI > Remove, or Windows settings).
        windows_remove(&f, BIN, &env).unwrap();
        assert_eq!(f.value.borrow().clone().unwrap(), before);
        let writes = *f.writes.borrow();
        for _ in 0..3 {
            assert_eq!(path_at_start(&m, BIN, &f, &env), StartPath::NotAsked);
        }
        assert_eq!((f.value.borrow().clone().unwrap(), *f.writes.borrow()), (before, writes));
    }

    #[test]
    fn t594_the_hand_off_is_used_up_even_when_the_path_cannot_be_read_and_a_variable_spelling_counts_as_there() {
        let mut f = Fake::new(Some(&long_path()));
        f.unreadable = true;
        let (_d, m) = pending("t594-unreadable");
        assert!(matches!(path_at_start(&m, BIN, &f, &env), StartPath::Skipped(_)));
        assert!(!m.exists());
        assert_eq!(*f.writes.borrow(), 0);
        // The user already has it as %LOCALAPPDATA%\Kolux RS\bin: nothing is added.
        let mine = format!(r"{};%LOCALAPPDATA%\Kolux RS\bin", long_path());
        let g = Fake::new(Some(&mine));
        std::fs::write(&m, "x").unwrap();
        assert_eq!(path_at_start(&m, BIN, &g, &env), StartPath::AlreadyThere);
        assert_eq!((g.value.borrow().clone().unwrap(), *g.writes.borrow()), (mine, 0));
    }

    #[test]
    fn t594_uninstall_takes_off_only_our_entry_and_the_path_is_back_exactly() {
        let before = long_path();
        let f = Fake::new(Some(&before));
        let (_d, m) = pending("t594-uninstall");
        path_at_start(&m, BIN, &f, &env);
        assert_eq!(path_at_uninstall(&m, BIN, &f), Ok(true));
        assert_eq!(f.value.borrow().clone().unwrap(), before, "back exactly, %VARIABLES% and the empty entry kept");
        // Our entry in the middle, a trailing-slash copy, look-alikes and the user's %VARIABLE% spelling:
        // only the two plain spellings of our folder go.
        let mixed = format!(r"C:\a;{BIN};{BIN}2;%LOCALAPPDATA%\Kolux RS\bin;;C:\Users\me\AppData\Local\Kolux RS\BIN\;{}", long_path());
        let g = Fake::new(Some(&mixed));
        std::fs::write(&m, "x").unwrap();
        assert_eq!(path_at_uninstall(&m, BIN, &g), Ok(true));
        assert_eq!(g.value.borrow().clone().unwrap(), format!(r"C:\a;{BIN}2;%LOCALAPPDATA%\Kolux RS\bin;;{}", long_path()));
        assert!(!m.exists(), "the hand-off file goes with the install");
        // Nothing of ours: nothing is written.
        let w = *g.writes.borrow();
        assert_eq!(path_at_uninstall(&m, BIN, &g), Ok(false));
        assert_eq!(*g.writes.borrow(), w);
        // A change that did not take is an error, never a success.
        let mut h = Fake::new(Some(&format!("C:\\a;{BIN}")));
        h.refuses = true;
        assert!(path_at_uninstall(&m, BIN, &h).is_err());
    }

    #[test]
    fn t594_the_uninstall_flag_is_its_own_and_no_other_run_takes_it() {
        assert!(wants_uninstall_path(&[UNINSTALL_PATH_FLAG.to_string()]));
        assert!(!wants_uninstall_path(&[]));
        assert!(!wants_uninstall_path(&["--install-agents".to_string()]));
        assert!(!crate::agents::agent_install::wants_install(&[UNINSTALL_PATH_FLAG.to_string()]));
    }

    #[cfg(windows)]
    #[test]
    fn cli008_the_real_user_environment_key_can_be_read_without_changing_it() {
        // Read-only: this never writes the registry.
        assert!(Registry.read().is_ok());
    }
}
