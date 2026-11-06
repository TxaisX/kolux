//! T-183: Kolux keeps running when its own ground gives way.
//!
//! - APP-049: a damaged state file never wipes the setup. The damaged file is set aside first, the
//!   last good copy (`state.db.bak`, refreshed at every healthy start) takes its place, and when the
//!   damaged file can neither be set aside nor read the session runs on a scratch store so nothing
//!   overwrites it. A zero-byte file is missing, not damaged.
//! - APP-021: broken folder permissions are found at startup (a write probe in the profile folder,
//!   every install file opened for reading) and repaired with icacls, on the user's own per-user
//!   install only; what stays broken is named as a permissions problem by the recovery prompt, and a
//!   graphics failure with unreadable install files counts as that problem, not as a GPU crash.
//! - APP-042: the page sends a heartbeat; one that stops gets one automatic reload, one retry, then a
//!   native prompt (Retry reloads, Cancel quits) naming the likely cause with commands to copy. A
//!   breaker stops reload loops, the budget starts over after the computer slept, prompts never stack
//!   and none shows for a window that is gone. An error page sends no heartbeat, so it never counts.
//! - APP-043: three graphics-context losses inside a minute offer safe graphics once; the flag is
//!   saved before the answer, Keep Running removes it, the recovered launch asks whether to stay
//!   (preselected) and remembers, the flag dies with the app version and is ignored off Windows.
//! - APP-039: a run that logged no clean end leaves a crash record; the newest pending one prompts
//!   once at startup, Help > Report Crash reopens the newest even after that, and the GitHub issue is
//!   pre-filled and opened in the user's browser (the app sends nothing; details are scrubbed).
//!
//! Everything here lives beside the Resource Manager so the lane's own module declares it; lib.rs
//! only registers the commands and calls `prepare_state`, `backup_state`, `startup_check`,
//! `startup_scan`, `watch_start` and `safe_graphics_on` (evidence/reliability-T-183-lib.rs.patch).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------------------------------------
// APP-049: the state file
// ---------------------------------------------------------------------------------------------

pub const STATE_FILE: &str = "state.db";
pub const STATE_BAK: &str = "state.db.bak";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateOutcome {
    /// The file reads (or could not be checked, which is not damage); nothing was done.
    Fine,
    /// No file, or a zero-byte one that was removed: the store starts empty.
    Missing,
    /// The damaged file was set aside at `aside` and the last good copy took its place.
    Restored { aside: PathBuf },
    /// The damaged file was set aside at `aside`; there was no good copy, so the store starts empty.
    Fresh { aside: PathBuf },
    /// The damaged file could not be set aside: the session runs on a scratch store and never
    /// writes the damaged file.
    Frozen { reason: String },
}

pub struct StatePrep {
    /// The folder the store opens in: the profile, or the scratch folder when frozen.
    pub open_dir: PathBuf,
    pub outcome: StateOutcome,
    /// What happened, one line each, for the log.
    pub notes: Vec<String>,
}

impl StatePrep {
    /// Whether a fresh backup of the file is worth taking: only when what opens is the user's own
    /// good state (a fresh or frozen store would overwrite the last good copy with nothing).
    pub fn backup_worthwhile(&self) -> bool {
        matches!(self.outcome, StateOutcome::Fine | StateOutcome::Restored { .. })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Health {
    Ok,
    /// Not a database, corrupt, or a failed quick_check: the reason.
    Damaged(String),
    /// Anything else (locked by another instance, access denied): not damage.
    Unknown(String),
}

fn damaged_error(e: &rusqlite::Error) -> bool {
    use rusqlite::ErrorCode::{DatabaseCorrupt, NotADatabase};
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if matches!(f.code, DatabaseCorrupt | NotADatabase))
}

/// Whether `db` is a readable SQLite file.
pub fn health(db: &Path) -> Health {
    let conn = match Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE) {
        Ok(c) => c,
        Err(e) if damaged_error(&e) => return Health::Damaged(e.to_string()),
        Err(e) => return Health::Unknown(e.to_string()),
    };
    match conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)) {
        Ok(s) if s == "ok" => Health::Ok,
        Ok(s) => Health::Damaged(s),
        Err(e) if damaged_error(&e) => Health::Damaged(e.to_string()),
        Err(e) => Health::Unknown(e.to_string()),
    }
}

/// `state.db-wal`, `state.db-shm` and the like, beside `db`.
fn companion(db: &Path, suffix: &str) -> PathBuf {
    let name = format!("{}{suffix}", db.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    db.with_file_name(name)
}

/// Moves `db` and its -wal/-shm companions aside under one time stamp; the main file's new path.
/// A rename that fails is tried as copy + remove; a file that stays in place is a failure, since
/// anything else would write over it.
pub fn set_aside(db: &Path) -> Result<PathBuf, String> {
    let stamp = now_secs();
    let name = db.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let aside = db.with_file_name(format!("{name}.damaged-{stamp}"));
    move_file(db, &aside)?;
    for suffix in ["-wal", "-shm"] {
        let c = companion(db, suffix);
        if c.exists() {
            let _ = move_file(&c, &db.with_file_name(format!("{name}.damaged-{stamp}{suffix}")));
        }
    }
    Ok(aside)
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(|e| format!("{}: {e}", from.display()))?;
    fs::remove_file(from).map_err(|e| format!("{} was copied aside but stays in place: {e}", from.display()))
}

/// APP-049, before the store opens: checks `dir/state.db` and decides where the store opens.
/// `scratch` is used only when the damaged file cannot be set aside.
pub fn prepare_state(dir: &Path, scratch: &Path) -> StatePrep {
    prepare_state_with(dir, scratch, set_aside)
}

fn prepare_state_with(dir: &Path, scratch: &Path, aside: impl Fn(&Path) -> Result<PathBuf, String>) -> StatePrep {
    let db = dir.join(STATE_FILE);
    let mut notes = Vec::new();
    let here = |outcome, notes| StatePrep { open_dir: dir.to_path_buf(), outcome, notes };
    match fs::metadata(&db) {
        Err(_) => return here(StateOutcome::Missing, notes),
        Ok(m) if m.len() == 0 => {
            let _ = fs::remove_file(&db);
            for suffix in ["-wal", "-shm"] {
                let _ = fs::remove_file(companion(&db, suffix));
            }
            notes.push("state.db was empty (zero bytes): treated as missing, not damaged (APP-049)".to_string());
            return here(StateOutcome::Missing, notes);
        }
        Ok(_) => {}
    }
    let why = match health(&db) {
        Health::Ok => return here(StateOutcome::Fine, notes),
        Health::Unknown(e) => {
            notes.push(format!("state.db could not be checked ({e}); left as it is (APP-049)"));
            return here(StateOutcome::Fine, notes);
        }
        Health::Damaged(why) => why,
    };
    notes.push(format!("state.db is damaged: {why} (APP-049)"));
    match aside(&db) {
        Err(e) => {
            notes.push(format!("the damaged state.db could not be set aside ({e}); saving is frozen for this session and the file is not touched (APP-049)"));
            let _ = fs::create_dir_all(scratch);
            // The user's settings still read in the frozen session: copies of settings.json and its last
            // good copy go with the scratch store. Saves land in the scratch folder, nowhere else.
            for name in ["settings.json", "settings.json.bak"] {
                let _ = fs::copy(dir.join(name), scratch.join(name));
            }
            StatePrep { open_dir: scratch.to_path_buf(), outcome: StateOutcome::Frozen { reason: e }, notes }
        }
        Ok(aside) => {
            let bak = dir.join(STATE_BAK);
            if bak.exists() && health(&bak) == Health::Ok && fs::copy(&bak, &db).is_ok() {
                notes.push(format!("state restored from the last good copy; the damaged file is kept at {} (APP-049)", aside.display()));
                here(StateOutcome::Restored { aside }, notes)
            } else {
                notes.push(format!("no readable last good copy; the store starts empty and the damaged file is kept at {} (APP-049)", aside.display()));
                here(StateOutcome::Fresh { aside }, notes)
            }
        }
    }
}

/// APP-049, after a healthy open: refreshes the last good copy from the live file (VACUUM INTO
/// gives a consistent copy even while the store is open in WAL mode), replacing the old copy only
/// once the new one is complete.
pub fn backup_state(dir: &Path) -> Result<(), String> {
    let db = dir.join(STATE_FILE);
    let tmp = dir.join("state.db.bak.tmp");
    let _ = fs::remove_file(&tmp);
    let conn = Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
    let target = tmp.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{target}'")).map_err(|e| e.to_string())?;
    drop(conn);
    fs::rename(&tmp, dir.join(STATE_BAK)).map_err(|e| e.to_string())
}

/// The scratch folder a frozen session runs on.
pub fn frozen_dir() -> PathBuf {
    std::env::temp_dir().join(format!("kolux-rs-frozen-{}", std::process::id()))
}

// ---------------------------------------------------------------------------------------------
// APP-021: folder permissions
// ---------------------------------------------------------------------------------------------

/// What the startup check found and did.
#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct PermReport {
    pub profile_writable: bool,
    /// Whether the install is the user's own (per-user), the only kind Kolux changes.
    pub own_install: bool,
    /// Install files the user still cannot read after any repair.
    pub unreadable: Vec<PathBuf>,
    /// What a repair fixed.
    pub repaired: Vec<PathBuf>,
}

impl PermReport {
    /// The sentence the recovery prompt names, when something is still wrong.
    pub fn problem(&self) -> Option<String> {
        let mut parts = Vec::new();
        if !self.profile_writable {
            parts.push("the profile folder cannot be written".to_string());
        }
        if !self.unreadable.is_empty() {
            let note = if self.own_install { "" } else { " (not a per-user install, so Kolux left its permissions alone)" };
            parts.push(format!("{} file(s) in the install folder cannot be read{note}", self.unreadable.len()));
        }
        (!parts.is_empty()).then(|| format!("a permissions problem: {}", parts.join("; ")))
    }
}

/// Whether the user can create a file in `dir` (created when missing).
pub fn writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(format!(".kolux-write-probe-{}", std::process::id()));
    let ok = fs::write(&probe, b"probe").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// The files directly in `dir` and in its `resources` folder the user cannot open for reading.
/// The entry's own type is used (not a metadata call, which a denied file refuses too).
pub fn unreadable_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for folder in [dir.to_path_buf(), dir.join("resources")] {
        let Ok(rd) = fs::read_dir(&folder) else { continue };
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let p = e.path();
            if let Err(err) = fs::File::open(&p) {
                if err.kind() == std::io::ErrorKind::PermissionDenied {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

/// Whether the install belongs to the user alone: under their local app data or profile folder.
pub fn own_install(exe_dir: &Path, local_app_data: Option<&Path>, user_profile: Option<&Path>) -> bool {
    [local_app_data, user_profile].into_iter().flatten().any(|root| exe_dir.starts_with(root))
}

/// The icacls argument lists that repair `path` for `user`, mildest first: back to the inherited
/// defaults, then the user's deny entries removed, then an explicit full grant.
pub fn repair_steps(path: &Path, user: &str) -> Vec<Vec<String>> {
    let p = path.display().to_string();
    vec![
        vec![p.clone(), "/reset".into(), "/C".into(), "/Q".into()],
        vec![p.clone(), "/remove:d".into(), user.to_string(), "/C".into(), "/Q".into()],
        vec![p, "/grant".into(), format!("{user}:(F)"), "/C".into(), "/Q".into()],
    ]
}

/// Runs the repair steps for `path` until `reads` says it is fine; `run` executes one icacls call.
pub fn repair(path: &Path, user: &str, run: &mut dyn FnMut(&[String]) -> bool, reads: &dyn Fn(&Path) -> bool) -> bool {
    if reads(path) {
        return true;
    }
    for step in repair_steps(path, user) {
        let _ = run(&step);
        if reads(path) {
            return true;
        }
    }
    false
}

/// One icacls call, no console window; whether it exited 0.
#[cfg(windows)]
pub fn icacls(args: &[String]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("icacls").args(args).creation_flags(CREATE_NO_WINDOW).output().map(|o| o.status.success()).unwrap_or(false)
}

#[cfg(not(windows))]
pub fn icacls(_args: &[String]) -> bool {
    false
}

/// APP-021, at startup: the profile folder must take a write and every install file must read.
/// The profile folder is always the user's own and is repaired; install files are repaired only on
/// a per-user install (`own`). `run` executes icacls.
pub fn startup_check(install: &Path, profile: &Path, user: &str, own: bool, run: &mut dyn FnMut(&[String]) -> bool) -> PermReport {
    let mut r = PermReport { own_install: own, profile_writable: writable(profile), ..Default::default() };
    if !r.profile_writable && repair(profile, user, run, &writable) {
        r.profile_writable = true;
        r.repaired.push(profile.to_path_buf());
    }
    for f in unreadable_files(install) {
        if own && repair(&f, user, run, &|p| fs::File::open(p).is_ok()) {
            r.repaired.push(f);
        } else {
            r.unreadable.push(f);
        }
    }
    r
}

/// The folder the running exe lives in.
pub fn install_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf))
}

/// Managed: what startup recovery did, as sentences for the user, handed to the page once.
pub struct StartupNotes(pub Mutex<Vec<String>>);

/// APP-049 / APP-021 (after-list row 789): the sentences the page shows for what startup repaired or
/// set aside, naming each file and where it went. Quiet when nothing was damaged.
pub fn startup_notes(prep: &StatePrep, perms: &PermReport) -> Vec<String> {
    let mut out = Vec::new();
    match &prep.outcome {
        StateOutcome::Restored { aside } => out.push(format!("Your saved data file ({STATE_FILE}) was damaged. Kolux restored the last good copy and kept the damaged file at {}.", aside.display())),
        StateOutcome::Fresh { aside } => out.push(format!("Your saved data file ({STATE_FILE}) was damaged and there was no good copy, so Kolux started with fresh data. The damaged file is kept at {}.", aside.display())),
        StateOutcome::Frozen { reason } => out.push(format!("Your saved data file ({STATE_FILE}) is damaged and could not be set aside ({reason}), so Kolux left it alone and will not save changes this session.")),
        StateOutcome::Fine | StateOutcome::Missing => {}
    }
    if !perms.repaired.is_empty() {
        let paths: Vec<String> = perms.repaired.iter().map(|p| p.display().to_string()).collect();
        out.push(format!("Kolux repaired its access to {}.", paths.join(", ")));
    }
    if let Some(problem) = perms.problem() {
        out.push(format!("Kolux found {problem}."));
    }
    out
}

/// What the page tells the user once at start: the settings file read from its last good copy (the
/// damaged file stays in place until the next save sets it aside) and the startup recovery above.
pub fn take_recovery_notes(store: &crate::state::Store, notes: &StartupNotes) -> Vec<String> {
    let _ = store.try_settings(); // the read is what notices a damaged file
    let mut out: Vec<String> = store.take_fallback_notice().into_iter().collect();
    if let Ok(mut held) = notes.0.lock() {
        out.append(&mut held);
    }
    out
}

#[tauri::command]
pub fn startup_recovery_notes(store: tauri::State<'_, Mutex<crate::state::Store>>, notes: tauri::State<'_, StartupNotes>) -> Vec<String> {
    store.lock().map(|s| take_recovery_notes(&s, &notes)).unwrap_or_default()
}

/// Managed: what the startup check found, for the recovery prompt and the graphics rule.
pub struct Perms(pub PermReport);

/// APP-021: the whole startup check against this process's install, with the real icacls.
pub fn startup_check_here(profile: &Path) -> PermReport {
    let install = install_dir().unwrap_or_default();
    let user = std::env::var("USERNAME").unwrap_or_default();
    let own = own_install(&install, std::env::var_os("LOCALAPPDATA").map(PathBuf::from).as_deref(), std::env::var_os("USERPROFILE").map(PathBuf::from).as_deref());
    startup_check(&install, profile, &user, own && !user.is_empty(), &mut icacls)
}

// ---------------------------------------------------------------------------------------------
// APP-042: the interface watch
// ---------------------------------------------------------------------------------------------

/// How long the page may go without a heartbeat once it has sent one.
pub const STALL: Duration = Duration::from_secs(20);

/// How often a running app says so in its own log. Without it, `kolux.log` only changes when
/// something happens, so a healthy app and a stopped one look the same from the file.
pub const ALIVE_EVERY: Duration = Duration::from_secs(300);
/// How long the first load may take before it counts as stalled (a loaded PC takes a while).
pub const FIRST_LOAD: Duration = Duration::from_secs(90);
/// Recoveries inside this window ...
pub const BREAKER_WINDOW: Duration = Duration::from_secs(600);
/// ... up to this many; the next one is a prompt, not a reload.
pub const BREAKER_MAX: usize = 3;
/// A gap between ticks this long means the computer slept: the budget starts over.
pub const WAKE_GAP: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// The reload and its retry never yielded a page.
    Stalled,
    /// Too many recoveries in a short time: the breaker stopped reloading.
    Loop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Nothing,
    Reload { attempt: u8 },
    Prompt(Reason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Live,
    Reloading { attempt: u8, since: Instant },
    Prompting,
    Done,
}

pub struct Interface {
    stall: Duration,
    since_beat: Instant,
    beaten: bool,
    last_tick: Option<Instant>,
    phase: Phase,
    recoveries: VecDeque<Instant>,
}

impl Interface {
    pub fn new(now: Instant, stall: Duration) -> Self {
        Interface { stall, since_beat: now, beaten: false, last_tick: None, phase: Phase::Live, recoveries: VecDeque::new() }
    }

    /// The page is alive: a reload in progress is over.
    pub fn beat(&mut self, now: Instant) {
        self.since_beat = now;
        self.beaten = true;
        if matches!(self.phase, Phase::Reloading { .. }) {
            self.phase = Phase::Live;
        }
    }

    fn budget(&self) -> Duration {
        if self.beaten { self.stall } else { FIRST_LOAD }
    }

    /// Once a second: what to do now.
    pub fn tick(&mut self, now: Instant) -> Action {
        let gap = self.last_tick.map(|t| now.saturating_duration_since(t));
        self.last_tick = Some(now);
        if matches!(self.phase, Phase::Prompting | Phase::Done) {
            return Action::Nothing;
        }
        if gap.is_some_and(|g| g >= WAKE_GAP) {
            self.since_beat = now;
            if let Phase::Reloading { attempt, .. } = self.phase {
                self.phase = Phase::Reloading { attempt, since: now };
            }
            return Action::Nothing;
        }
        match self.phase {
            Phase::Live => {
                if now.saturating_duration_since(self.since_beat) < self.budget() {
                    return Action::Nothing;
                }
                self.recoveries.retain(|t| now.saturating_duration_since(*t) < BREAKER_WINDOW);
                if self.recoveries.len() >= BREAKER_MAX {
                    self.phase = Phase::Prompting;
                    return Action::Prompt(Reason::Loop);
                }
                self.recoveries.push_back(now);
                self.phase = Phase::Reloading { attempt: 1, since: now };
                Action::Reload { attempt: 1 }
            }
            Phase::Reloading { attempt, since } => {
                if now.saturating_duration_since(since) < self.stall {
                    return Action::Nothing;
                }
                if attempt == 1 {
                    self.phase = Phase::Reloading { attempt: 2, since: now };
                    Action::Reload { attempt: 2 }
                } else {
                    self.phase = Phase::Prompting;
                    Action::Prompt(Reason::Stalled)
                }
            }
            Phase::Prompting | Phase::Done => Action::Nothing,
        }
    }

    /// The user's answer: Reload gives the page one more stall budget before the next prompt;
    /// Quit ends the watch.
    pub fn answered(&mut self, reload: bool, now: Instant) {
        self.since_beat = now;
        self.phase = if reload { Phase::Reloading { attempt: 2, since: now } } else { Phase::Done };
    }

    /// How many automatic recoveries happened inside the breaker window.
    #[cfg(test)]
    pub fn recoveries(&self) -> usize {
        self.recoveries.len()
    }
}

/// The prompt's text: what happened, the likely cause, and commands the user can copy.
pub fn cause_text(reason: Reason, perm: Option<&str>, install: &Path, gpu_hint: bool) -> String {
    let mut lines = vec!["The Kolux interface is not responding.".to_string()];
    lines.push(match reason {
        Reason::Stalled => "A reload and one retry never brought the page back.".to_string(),
        Reason::Loop => format!("It was recovered {BREAKER_MAX} times in the last {} minutes, so reloading has stopped.", BREAKER_WINDOW.as_secs() / 60),
    });
    lines.push(String::new());
    lines.push("Likely cause:".to_string());
    if let Some(p) = perm {
        lines.push(format!("  - {p}"));
    }
    if gpu_hint {
        lines.push("  - a graphics driver problem; safe graphics (no hardware acceleration) usually helps".to_string());
    }
    if perm.is_none() && !gpu_hint {
        lines.push("  - the page stalled while loading (an update, a slow disk, or a damaged install)".to_string());
    }
    lines.push(String::new());
    lines.push("Commands you can copy:".to_string());
    lines.push(format!("  icacls \"{}\" /reset /T /C /Q", install.display()));
    lines.push("  set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu   (then start Kolux from the same window)".to_string());
    lines.push(String::new());
    lines.push("Retry reloads the interface. Cancel quits Kolux.".to_string());
    lines.join("\n")
}

/// Managed: the watch the heartbeat command feeds.
pub struct Watch(pub Mutex<Interface>);

/// The page's heartbeat (RecoveryMount sends one every two seconds).
#[tauri::command]
pub fn ui_heartbeat(w: tauri::State<Watch>) {
    if let Ok(mut i) = w.0.lock() {
        i.beat(Instant::now());
    }
}

/// Retry = true, Cancel = false. Blocks the calling thread.
#[cfg(windows)]
fn ask_reload_or_quit(title: &str, text: &str) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDRETRY, MB_ICONERROR, MB_RETRYCANCEL, MB_SETFOREGROUND};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (text, title) = (wide(text), wide(title));
    // SAFETY: both strings are NUL-terminated UTF-16 buffers that outlive the call; no owner window.
    let answer = unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_RETRYCANCEL | MB_ICONERROR | MB_SETFOREGROUND) };
    answer == IDRETRY
}

#[cfg(not(windows))]
fn ask_reload_or_quit(_title: &str, text: &str) -> bool {
    eprintln!("{text}");
    false
}

/// APP-042: starts the watch thread. `perm` is the startup permissions problem, if any, for the
/// prompt's cause line.
pub fn watch_start(app: tauri::AppHandle, perm: Option<String>) {
    app.manage(Watch(Mutex::new(Interface::new(Instant::now(), STALL))));
    let install = install_dir().unwrap_or_default();
    let mut wake = Wake::new(std::time::SystemTime::now());
    let mut sampled: Option<Instant> = None;
    let mut beat = Instant::now();
    let spawned = std::thread::Builder::new().name("interface-watch".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        // APP-069: a line every five minutes, so the log shows a gap when the app stops instead of
        // going quiet while it is still running.
        if beat.elapsed() >= ALIVE_EVERY {
            beat = Instant::now();
            if let Ok(d) = app.path().app_data_dir() {
                crate::diag::write(&d, "alive: the app, its window and the interface watch are running");
            }
        }
        // T-286-b (APP-040): a memory reading for the next crash report, and new crash dumps.
        if sampled.is_none_or(|t| t.elapsed() >= SAMPLE_EVERY) {
            sampled = Some(Instant::now());
            if let Ok(d) = app.path().app_data_dir() {
                sample_step(&d);
            }
        }
        // T-286-b (APP-017): after sleep every window repaints.
        if wake.tick(std::time::SystemTime::now()) {
            if let Ok(d) = app.path().app_data_dir() {
                crate::diag::write(&d, "the computer woke: every window repaints (APP-017)");
            }
            for (_, w) in app.webview_windows() {
                repaint(&w);
            }
        }
        let Some(win) = app.get_webview_window("main") else {
            // The window is gone: closing, or not up yet. Nothing is reloaded or asked.
            continue;
        };
        let action = app.state::<Watch>().0.lock().map(|mut i| i.tick(Instant::now())).unwrap_or(Action::Nothing);
        let dir = app.path().app_data_dir().ok();
        match action {
            Action::Nothing => {}
            Action::Reload { attempt } => {
                if let Some(d) = &dir {
                    crate::diag::write(d, &format!("interface recovery: no heartbeat, reload {attempt} of 2 (APP-042)"));
                }
                // row 199: unsaved editor text first; no ack means the draft write failed or the window is stuck
                if !crate::editor_drafts::flush_before_reload(&app) {
                    if let Some(d) = &dir {
                        crate::diag::write(d, "interface recovery: flush not acked, reloading anyway (row 199)");
                    }
                }
                let _ = win.reload();
            }
            Action::Prompt(reason) => {
                let text = cause_text(reason, perm.as_deref(), &install, false);
                if let Some(d) = &dir {
                    crate::diag::write(d, &format!("interface recovery: asking the user ({reason:?}) (APP-042)"));
                    note_crash(d, &format!("the interface stopped responding ({reason:?}) and was not recovered by reloading"));
                }
                let reload = ask_reload_or_quit("Kolux", &text);
                if let Ok(mut i) = app.state::<Watch>().0.lock() {
                    i.answered(reload, Instant::now());
                }
                if reload {
                    if !crate::editor_drafts::flush_before_reload(&app) {
                        if let Some(d) = &dir {
                            crate::diag::write(d, "interface recovery: flush not acked, reloading anyway (row 199)");
                        }
                    }
                    let _ = win.reload();
                } else {
                    app.exit(0);
                }
            }
        }
    });
    if spawned.is_err() {
        eprintln!("kolux-rs: the interface watch could not start (APP-042)");
    }
}

// ---------------------------------------------------------------------------------------------
// T-286-b (APP-017): repaint after sleep, and no background throttling
// ---------------------------------------------------------------------------------------------

/// The page's cue to repaint (src/recovery/hidden.ts) after the computer woke.
pub const WOKE_EVENT: &str = "app-woke";

/// Notices the computer slept: the wall clock jumped past WAKE_GAP between two one-second ticks
/// (the wall clock, unlike the monotonic one, keeps counting while the computer sleeps).
pub struct Wake {
    last: std::time::SystemTime,
}

impl Wake {
    pub fn new(now: std::time::SystemTime) -> Self {
        Wake { last: now }
    }

    pub fn tick(&mut self, now: std::time::SystemTime) -> bool {
        let gap = now.duration_since(self.last).unwrap_or_default();
        self.last = now;
        gap >= WAKE_GAP
    }
}

/// Whether a window may take the one-pixel nudge: shown, and neither minimised, maximised nor full
/// screen (a size change there would undo the user's choice).
pub fn nudge_ok(visible: bool, minimized: bool, maximized: bool, fullscreen: bool) -> bool {
    visible && !minimized && !maximized && !fullscreen
}

/// One window repaints: the page is told (it redraws itself and replays held updates), and a plain
/// window grows by one pixel and back, which makes the engine lay out and draw the whole surface again.
pub fn repaint(win: &tauri::WebviewWindow) {
    use tauri::Emitter;
    let _ = win.emit(WOKE_EVENT, ());
    let ok = nudge_ok(win.is_visible().unwrap_or(false), win.is_minimized().unwrap_or(true), win.is_maximized().unwrap_or(true), win.is_fullscreen().unwrap_or(true));
    if !ok {
        return;
    }
    if let Ok(s) = win.inner_size() {
        let _ = win.set_size(tauri::PhysicalSize::new(s.width, s.height + 1));
        let _ = win.set_size(s);
    }
}

/// APP-017: hidden windows are excused from the engine's background throttling, so status keeps
/// arriving while minimised. WebView2 has no per-view switch (Tauri's backgroundThrottling covers
/// macOS only), so these are Chromium switches passed as browser arguments.
pub const UNTHROTTLED: [&str; 3] = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];

/// The browser arguments every window gets: the config's own (or wry's defaults), the throttling
/// exemption, and safe graphics when it is on; each switch once. T-319-b (BROW-026): the engine's
/// identity prompt (FedCM) is switched off in the same string, so sign-in falls back to a popup.
pub fn browser_args(current: Option<&str>, safe: bool) -> String {
    let mut s = if safe { safe_args(current) } else { current.filter(|c| !c.trim().is_empty()).unwrap_or(BASE_ARGS).to_string() };
    for a in UNTHROTTLED {
        if !s.split_whitespace().any(|x| x == a) {
            s.push(' ');
            s.push_str(a);
        }
    }
    crate::browser::popup::fedcm_off(&s)
}

/// The arguments the windows were given at launch: every webview Kolux opens later on the same data
/// folder must pass the same string, or the engine refuses to create it.
static LAUNCH_ARGS: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// In `run`, once per window config before the builder starts: the window's arguments, remembered
/// for later webviews. Row 939: they carry the proxy saved in this profile, so the window and the
/// tabs on its data folder agree on `--proxy-server` (the engine refuses two sets on one folder).
/// Read from the profile folder because the store is not open yet when the windows are built.
pub fn launch_browser_args_for(current: Option<&str>, safe: bool, identifier: &str) -> String {
    launch_with_proxy(current, safe, profile_dir(identifier).and_then(|d| saved_proxy_in(&d)).as_ref())
}

fn launch_with_proxy(current: Option<&str>, safe: bool, proxy: Option<&tauri::Url>) -> String {
    let s = launch_string(current, safe, proxy);
    let _ = LAUNCH_ARGS.set(s.clone());
    s
}

fn launch_string(current: Option<&str>, safe: bool, proxy: Option<&tauri::Url>) -> String {
    // T-324-b (APP-022): the interface's memory ceiling rides in the same string.
    let s = super::renderer_heap::apply_here(&browser_args(current, safe));
    // A proxy the switch cannot carry (credentials, a bad shape) is left out here: the main window then
    // runs without it, and every tab refuses it.
    crate::browser::proxy::tab_browser_args(&s, proxy).unwrap_or(s)
}

/// The usable `httpProxy` in a profile's settings file (or its last good copy), as `proxy_of`
/// takes it; none when unset, unreadable or unusable (the tab then refuses by itself).
fn saved_proxy_in(dir: &Path) -> Option<tauri::Url> {
    let read = |name: &str| fs::read(dir.join(name)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
    // Same rule as the settings load (state.rs read_file): the copy stands in for a missing or corrupt file.
    let settings = read("settings.json").or_else(|| read("settings.json.bak"))?;
    let plain = crate::secrets::unseal(settings.get("httpProxy")?.as_str()?).ok()?;
    crate::browser::proxy_of(Some(&plain)).ok().flatten()
}

/// What a webview opened later (a browser tab on the default profile) passes.
pub fn browser_args_now() -> String {
    args_for_later_window(LAUNCH_ARGS.get().map(String::as_str))
}

fn args_for_later_window(launch: Option<&str>) -> String {
    launch.map(str::to_string).unwrap_or_else(|| browser_args(None, false))
}

// ---------------------------------------------------------------------------------------------
// APP-043: graphics crashes and safe graphics
// ---------------------------------------------------------------------------------------------

pub const BURST_WINDOW: Duration = Duration::from_secs(60);
pub const BURST_COUNT: usize = 3;
pub const SAFE_FLAG: &str = "safe-graphics.json";
pub const SAFE_ARG: &str = "--disable-gpu";
/// What wry passes to WebView2 when a window names no arguments (the row-955 test checks the launch string never equals it).
#[cfg(test)]
pub const WRY_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// R07-browser.2 (T-634, DT-C79): wry's defaults minus `msSmartScreenProtection`, so SmartScreen keeps
/// checking the pages and downloads of the browser pane, as it does in Edge. Every webview builds on this.
pub const BASE_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI";

/// Graphics-context losses in a short window; fires once.
#[derive(Default)]
pub struct Burst {
    hits: VecDeque<Instant>,
    fired: bool,
}

impl Burst {
    pub fn hit(&mut self, now: Instant) -> bool {
        if self.fired {
            return false;
        }
        self.hits.push_back(now);
        self.hits.retain(|t| now.saturating_duration_since(*t) < BURST_WINDOW);
        if self.hits.len() >= BURST_COUNT {
            self.fired = true;
            return true;
        }
        false
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SafeFlag {
    /// The app version that saved it; another version drops it.
    pub version: String,
    /// Whether the user chose to stay in safe graphics (no more asking).
    pub chosen: bool,
}

pub fn flag_read(dir: &Path) -> Option<SafeFlag> {
    serde_json::from_slice(&fs::read(dir.join(SAFE_FLAG)).ok()?).ok()
}

pub fn flag_write(dir: &Path, flag: &SafeFlag) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(SAFE_FLAG), serde_json::to_vec_pretty(flag).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// T-724: a flag that is already gone counts as cleared; one that cannot be removed is an error the prompt tells.
pub fn flag_clear(dir: &Path) -> Result<(), String> {
    match fs::remove_file(dir.join(SAFE_FLAG)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// The flag this launch runs under: none off Windows; one from another version is cleared.
pub fn launch_flag(dir: &Path, version: &str, windows: bool) -> Option<SafeFlag> {
    let f = flag_read(dir)?;
    if !windows {
        return None;
    }
    if f.version != version {
        let _ = flag_clear(dir); // ignored here as before: the launch goes on with hardware graphics either way
        return None;
    }
    Some(f)
}

/// The browser arguments with safe graphics added once; `current` is the config's own value.
pub fn safe_args(current: Option<&str>) -> String {
    let base = current.filter(|c| !c.trim().is_empty()).unwrap_or(BASE_ARGS);
    if base.split_whitespace().any(|a| a == SAFE_ARG) { base.to_string() } else { format!("{base} {SAFE_ARG}") }
}

/// The profile folder before the app exists: the roaming app data folder plus the identifier, the
/// way Tauri resolves it on Windows.
pub fn profile_dir(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(identifier))
}

/// APP-043, in `run` before any window is built: whether this launch runs in safe graphics (every
/// window then gets `safe_args` of its own browser arguments).
pub fn safe_graphics_on(identifier: &str, version: &str) -> bool {
    profile_dir(identifier).and_then(|d| launch_flag(&d, version, cfg!(windows))).is_some()
}

/// Managed: the burst detector.
pub struct Graphics(pub Mutex<Burst>);

fn version_of(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The page lost a graphics context (RecoveryMount, on `webglcontextlost`). True when the burst
/// fires: the safe-graphics flag is saved right away, before the user answers. With unreadable
/// install files the loss is a permissions problem (APP-021), not a graphics crash, and nothing fires.
#[tauri::command]
pub fn graphics_crash_noted(app: tauri::AppHandle, g: tauri::State<Graphics>, perms: tauri::State<Perms>) -> Result<bool, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !perms.0.unreadable.is_empty() {
        crate::diag::write(&dir, "graphics context lost with unreadable install files: counted as a permissions problem, not a GPU crash (APP-021)");
        return Ok(false);
    }
    let fired = g.0.lock().map(|mut b| b.hit(Instant::now())).unwrap_or(false);
    if fired {
        flag_write(&dir, &SafeFlag { version: version_of(&app), chosen: false })?;
        crate::diag::write(&dir, &format!("{BURST_COUNT} graphics context losses inside {} s: offering safe graphics; flag saved (APP-043)", BURST_WINDOW.as_secs()));
    }
    Ok(fired)
}

/// Keep Running: the saved flag goes away.
#[tauri::command]
pub fn graphics_keep_running(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    flag_clear(&dir)?;
    crate::diag::write(&dir, "safe graphics declined: flag removed (APP-043)");
    Ok(())
}

/// Restart in safe graphics: the flag is there (saved again if not), then the app restarts.
#[tauri::command]
pub fn graphics_restart_safe(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if flag_read(&dir).is_none() {
        flag_write(&dir, &SafeFlag { version: version_of(&app), chosen: false })?;
    }
    crate::diag::write(&dir, "restarting in safe graphics (APP-043)");
    note_self_end(&app, "restart in safe graphics (APP-043)");
    crate::procs::hand_off(true);
    app.restart()
}

/// The flag this launch runs under (None when hardware acceleration is on).
#[tauri::command]
pub fn graphics_launch_choice(app: tauri::AppHandle) -> Result<Option<SafeFlag>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(launch_flag(&dir, &version_of(&app), cfg!(windows)))
}

/// The recovered launch's answer: stay in safe graphics (remembered) or try hardware again (the
/// flag goes and the app restarts).
#[tauri::command]
pub fn graphics_choose(app: tauri::AppHandle, stay: bool) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if stay {
        flag_write(&dir, &SafeFlag { version: version_of(&app), chosen: true })?;
        crate::diag::write(&dir, "staying in safe graphics (APP-043)");
        return Ok(());
    }
    flag_clear(&dir)?;
    crate::diag::write(&dir, "trying hardware acceleration again: flag removed, restarting (APP-043)");
    note_self_end(&app, "restart with hardware graphics (APP-043)");
    crate::procs::hand_off(true);
    app.restart()
}

// ---------------------------------------------------------------------------------------------
// APP-039: crash records and the report
// ---------------------------------------------------------------------------------------------

pub const CRASHES: &str = "crashes.json";
/// The line every start writes (lib.rs setup), which splits the log into runs.
pub const START_MARK: &str = "kolux-rs: config:";
/// T-286-b (APP-040): written just before Kolux ends or restarts itself (a restart, an update
/// install), so the next start never mistakes that for a crash.
pub const SELF_END: &str = "kolux ended itself:";
/// The final save's report line (lib.rs): the quit was under way.
pub const QUIT_BEGAN: &str = "final save:";
/// T-324-b-rest: written first thing when Windows ends the session (sign-out, shutdown, restart),
/// before the final save that the system may cut short.
pub const SESSION_END: &str = "windows session ended:";
/// A run that logged one of these ended on purpose: a clean exit, a start that gave up, a quit
/// that was under way, Kolux ending itself, or Windows ending the session.
const CLEAN_ENDS: [&str; 5] = ["app exit", "could not start:", SELF_END, QUIT_BEGAN, SESSION_END];
/// APP-040: only the newest five reports are kept.
pub const KEEP: usize = 5;
/// Reports this close together (seconds) come from one crash: they merge into one report.
pub const SAME_CRASH: u64 = 30;
/// A crash dump written up to this long (seconds) after a report still joins it.
pub const LATE_DUMP: u64 = 600;
/// A quit's final save may take this long (seconds) before its report line is written.
const QUIT_LEAD: u64 = 15;
/// Engine processes may go on exiting this long (seconds) after the quit's last line.
const QUIT_TAIL: u64 = 30;
pub const NO_CLEAN_EXIT: &str = "Kolux ended without a clean exit (no shutdown record in the log)";
pub const INTERFACE_CRASHED: &str = "a Kolux interface process crashed";

/// What crashed: Kolux itself, an interface (browser engine) process, its graphics, or another child.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    App,
    Interface,
    Graphics,
    Child,
}

fn one() -> u32 {
    1
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Crash {
    pub id: String,
    pub when: u64,
    pub summary: String,
    pub dismissed: bool,
    /// T-286-b: the fields below were added after T-183; older files read with their defaults.
    #[serde(default)]
    pub kind: Kind,
    /// How many processes' reports this one crash merged.
    #[serde(default = "one")]
    pub count: u32,
    /// The last host memory reading before the crash, in words.
    #[serde(default)]
    pub memory: Option<String>,
    /// The module that faulted, when a crash dump named one.
    #[serde(default)]
    pub module: Option<String>,
    /// The merged siblings' own summaries (at most five).
    #[serde(default)]
    pub siblings: Vec<String>,
    /// The crash dump files already merged in, so a dump is never counted twice.
    #[serde(default)]
    pub dumps: Vec<String>,
}

impl Crash {
    /// A new, pending report of one process.
    pub fn new(kind: Kind, when: u64, summary: &str) -> Self {
        Crash { id: String::new(), when, summary: scrub_report(summary), dismissed: false, kind, count: 1, memory: None, module: None, siblings: Vec::new(), dumps: Vec::new() }
    }
}

/// How a process ended, as far as Kolux can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ending {
    pub kind: Kind,
    /// It reported a clean end.
    pub clean: bool,
    /// Kolux was quitting at the time (graphics and engine processes exit then too).
    pub during_quit: bool,
    /// Kolux ended it itself (a restart, an update install, an ended session).
    pub ours: bool,
}

/// APP-040: exits during an expected shutdown, graphics exits at quit time and kills Kolux issued
/// itself are not crashes; interface process crashes and unknown child crashes still are.
pub fn is_crash(e: &Ending) -> bool {
    !(e.clean || e.ours || e.during_quit)
}

/// APP-040: merges `inc` into the store and returns the id of the report it landed in. A dump
/// already merged changes nothing; a dump arriving late joins the report it belongs to (the
/// nearest one within LATE_DUMP that has no module yet); a report within SAME_CRASH of the newest
/// one is its sibling and merges into it (one prompt, the sibling's own summary kept); anything
/// else is a new report, and only the newest KEEP stay.
pub fn add(all: &mut Vec<Crash>, mut inc: Crash) -> String {
    if let Some(d) = inc.dumps.first() {
        if let Some(c) = all.iter().find(|c| c.dumps.contains(d)) {
            return c.id.clone();
        }
        let late = all.iter_mut().filter(|c| c.module.is_none() && inc.when.abs_diff(c.when) <= LATE_DUMP).min_by_key(|c| inc.when.abs_diff(c.when));
        if let Some(c) = late {
            c.dumps.push(d.clone());
            c.module = inc.module.take();
            if c.memory.is_none() {
                c.memory = inc.memory.take();
            }
            return c.id.clone();
        }
    }
    if let Some(c) = all.last_mut().filter(|c| inc.when.abs_diff(c.when) <= SAME_CRASH) {
        c.count += 1;
        if c.siblings.len() < 5 {
            c.siblings.push(inc.summary.clone());
        }
        if c.module.is_none() {
            c.module = inc.module.take();
        }
        if c.memory.is_none() {
            c.memory = inc.memory.take();
        }
        c.dumps.append(&mut inc.dumps);
        // an interface process makes a more useful headline than a sibling's "no clean exit"
        if c.kind == Kind::App && inc.kind != Kind::App && c.summary == NO_CLEAN_EXIT {
            c.kind = inc.kind;
            c.summary = inc.summary;
        }
        return c.id.clone();
    }
    let n = all.iter().filter_map(|c| c.id.rsplit_once('-').and_then(|(_, n)| n.parse::<u64>().ok())).max().map(|n| n + 1).unwrap_or(0);
    inc.id = format!("{}-{n}", inc.when);
    let id = inc.id.clone();
    all.push(inc);
    if all.len() > KEEP {
        let extra = all.len() - KEEP;
        all.drain(..extra);
    }
    id
}

/// Reads the store, merges `inc` and saves it (retrying a briefly locked file); the report it landed in.
pub fn record(dir: &Path, inc: Crash) -> Crash {
    // Row 589: a file held by a scanner is read again, a damaged one is kept aside, and one that
    // still cannot be read is left alone (this report is not saved) rather than saved over.
    let Ok(mut all) = crashes_load(dir) else { return inc };
    let fallback = inc.clone();
    let id = add(&mut all, inc);
    let _ = crashes_write(dir, &all);
    all.into_iter().find(|c| c.id == id).unwrap_or(fallback)
}

// ---- APP-040: the last host memory reading ----

pub const MEMORY_FILE: &str = "memory-last.json";
/// How often the watch thread takes a memory reading and looks for new crash dumps.
pub const SAMPLE_EVERY: Duration = Duration::from_secs(30);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemReading {
    pub when: u64,
    pub free: Option<u64>,
    pub total: Option<u64>,
    /// Kolux's own working set.
    pub app: Option<u64>,
}

pub fn memory_sample() -> MemReading {
    let (free, total) = super::imp::memory();
    MemReading { when: now_secs(), free, total, app: crate::sysmem::working_set_bytes() }
}

pub fn memory_save(dir: &Path, r: &MemReading) {
    if let Ok(b) = serde_json::to_vec(r) {
        let _ = write_retry(&dir.join(MEMORY_FILE), &b, &mut |p, b| fs::write(p, b));
    }
}

pub fn memory_last(dir: &Path) -> Option<MemReading> {
    serde_json::from_slice(&fs::read(dir.join(MEMORY_FILE)).ok()?).ok()
}

fn gb(b: u64) -> String {
    format!("{:.1} GB", b as f64 / 1_073_741_824.0)
}

/// The reading in words for the report. Only memory: free disk space is never offered as proof
/// that swap could have grown.
pub fn memory_text(r: &MemReading, crash_when: u64) -> Option<String> {
    let (Some(free), Some(total)) = (r.free, r.total) else { return None };
    if total == 0 {
        return None;
    }
    let used = 100 - (free.min(total) * 100 / total);
    let mut s = format!("{} free of {} ({used}% in use)", gb(free), gb(total));
    if let Some(app) = r.app {
        s.push_str(&format!(", Kolux itself {} MB", app / 1_048_576));
    }
    let age = crash_when.saturating_sub(r.when);
    s.push_str(&format!("; read {age} s before the crash"));
    Some(s)
}

/// The previous run, read out of the log as the text between the last two start lines: one that
/// never logged a clean end crashed. The summary is its fatal-error line without the time stamp,
/// or a plain sentence when nothing was captured.
pub fn previous_run_crash(log: &str) -> Option<String> {
    let starts: Vec<usize> = log.match_indices(START_MARK).map(|(i, _)| i).collect();
    if starts.len() < 2 {
        return None;
    }
    let run = &log[starts[starts.len() - 2]..starts[starts.len() - 1]];
    if run.lines().any(|l| CLEAN_ENDS.iter().any(|e| l.contains(e))) {
        return None;
    }
    let fatal = run.lines().find(|l| l.contains("fatal error"));
    Some(match fatal {
        Some(l) => l.trim().split_once(' ').map(|(_, rest)| rest.trim().to_string()).unwrap_or_else(|| l.trim().to_string()),
        None => NO_CLEAN_EXIT.to_string(),
    })
}

pub fn crashes_read(dir: &Path) -> Vec<Crash> {
    fs::read(dir.join(CRASHES)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Row 589: the crash list for a save. A briefly held file is read again (as `write_retry` writes
/// again); a damaged one is copied to `crashes.json.corrupt-<ms>` and the list starts empty; a
/// file that still cannot be read is an error, so the caller does not save over it.
fn crashes_load(dir: &Path) -> Result<Vec<Crash>, String> {
    let path = dir.join(CRASHES);
    let mut last = String::new();
    for attempt in 0..SAVE_TRIES {
        match fs::read(&path) {
            Ok(b) => {
                if let Ok(all) = serde_json::from_slice(&b) {
                    return Ok(all);
                }
                let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
                fs::write(dir.join(format!("{CRASHES}.corrupt-{ms}")), &b).map_err(|e| e.to_string())?;
                return Ok(Vec::new());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => {
                let locked = e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33);
                last = e.to_string();
                if !locked {
                    break;
                }
                if attempt + 1 < SAVE_TRIES {
                    std::thread::sleep(SAVE_PAUSE);
                }
            }
        }
    }
    Err(last)
}

/// APP-040: the store survives damaged files (crashes_read starts empty) and a save retries when
/// Windows briefly locks the file (a scanner or a backup tool holding it).
pub fn crashes_write(dir: &Path, all: &[Crash]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?;
    write_retry(&dir.join(CRASHES), &bytes, &mut |p, b| fs::write(p, b))
}

/// How many times a locked file is tried, and the pause between tries.
pub const SAVE_TRIES: usize = 5;
pub const SAVE_PAUSE: Duration = Duration::from_millis(100);

/// Writes with retries on errors a briefly held file gives (access denied, sharing violation).
pub fn write_retry(path: &Path, bytes: &[u8], write: &mut dyn FnMut(&Path, &[u8]) -> std::io::Result<()>) -> Result<(), String> {
    let mut last = String::new();
    for attempt in 0..SAVE_TRIES {
        match write(path, bytes) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let locked = e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33);
                last = e.to_string();
                if !locked {
                    break;
                }
                if attempt + 1 < SAVE_TRIES {
                    std::thread::sleep(SAVE_PAUSE);
                }
            }
        }
    }
    Err(last)
}

/// Secrets masked (diag::scrub) and the user's folder name taken out of paths: `C:\Users\name`,
/// `/home/name` and `/Users/name` become `<home>`.
pub fn scrub_report(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = crate::diag::scrub(text);
    loop {
        let hit = ["Users\\", "Users/", "home/"].iter().filter_map(|m| rest.find(m).map(|i| (i, m.len()))).min();
        let Some((at, len)) = hit else {
            out.push_str(&rest);
            return out;
        };
        // the folder prefix before the marker (C:\ or /) goes too; the name ends at the next separator
        let prefix_start = rest[..at].rfind(char::is_whitespace).map(|i| i + 1).unwrap_or(0);
        let name_start = at + len;
        let name_end = rest[name_start..].find(['\\', '/', ' ', ':', '"', '\'']).map(|i| name_start + i).unwrap_or(rest.len());
        out.push_str(&rest[..prefix_start]);
        out.push_str("<home>");
        rest = rest[name_end..].to_string();
    }
}

/// Adds one report of Kolux itself, now, with a fresh memory reading (summary scrubbed of paths
/// and secrets); it merges like any other (`add`).
pub fn note_crash(dir: &Path, summary: &str) -> Crash {
    let when = now_secs();
    let mut c = Crash::new(Kind::App, when, summary);
    c.memory = memory_text(&memory_sample(), when);
    record(dir, c)
}

/// APP-040: written to the log just before Kolux ends or restarts itself, so the next start does
/// not record a crash.
pub fn note_self_end(app: &tauri::AppHandle, why: &str) {
    if let Ok(dir) = app.path().app_data_dir() {
        crate::diag::write(&dir, &format!("{SELF_END} {why}"));
    }
}

/// The time stamp a log line starts with.
fn stamp(line: &str) -> Option<u64> {
    line.split_whitespace().next()?.parse().ok()
}

/// The last time stamp of the run before the current start (when the previous run was last heard of).
pub fn previous_run_end(log: &str) -> Option<u64> {
    let starts: Vec<usize> = log.match_indices(START_MARK).map(|(i, _)| i).collect();
    if starts.len() < 2 {
        return None;
    }
    let run = &log[starts[starts.len() - 2]..starts[starts.len() - 1]];
    // the slice ends inside the next start's line (its time stamp): that fragment is not this run's
    let run = &run[..run.rfind('\n').unwrap_or(0)];
    run.lines().rev().find_map(stamp)
}

/// The spans (seconds) when Kolux was quitting or ending itself: from shortly before the final
/// save's line or the self-end line to the next start (or shortly after, when none followed). A
/// crash dump written inside one is a quit-time exit, not a crash.
pub fn quit_spans(log: &str) -> Vec<(u64, u64)> {
    let mut spans = Vec::new();
    // (when the quit began, its last line so far)
    let mut open: Option<(u64, u64)> = None;
    for line in log.lines() {
        let Some(t) = stamp(line) else { continue };
        if line.contains(START_MARK) {
            if let Some((s, _)) = open.take() {
                spans.push((s.saturating_sub(QUIT_LEAD), t));
            }
            continue;
        }
        if let Some(o) = open.as_mut() {
            o.1 = t;
        } else if line.contains(QUIT_BEGAN) || line.contains(SELF_END) || line.contains(SESSION_END) || line.contains("app exit") {
            open = Some((t, t));
        }
    }
    // a quit with no start after it (the current run's own, or the newest) ends QUIT_TAIL after its last line
    if let Some((s, last)) = open {
        spans.push((s.saturating_sub(QUIT_LEAD), last + QUIT_TAIL));
    }
    spans
}

/// Whether `when` falls inside a quit span.
pub fn in_quit(spans: &[(u64, u64)], when: u64) -> bool {
    spans.iter().any(|&(a, b)| when >= a && when <= b)
}

pub const DUMPS_SEEN: &str = "crash-dumps-seen.json";

/// APP-040: every crash dump not seen before becomes an interface crash report naming its
/// faulting module, unless it was written while Kolux was quitting; a dump of a crash already
/// reported merges into that report. Returns the reports touched.
pub fn scan_dumps(dir: &Path, dumps_root: &Path, log: &str, mem: Option<MemReading>) -> Vec<Crash> {
    // the first look ever takes the dumps already there as seen: they predate this store
    let first = !dir.join(DUMPS_SEEN).exists();
    let mut seen: Vec<String> = fs::read(dir.join(DUMPS_SEEN)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let spans = quit_spans(log);
    let mut touched = Vec::new();
    for d in super::crashdump::dumps(dumps_root) {
        if seen.contains(&d.name) {
            continue;
        }
        seen.push(d.name.clone());
        if first {
            continue;
        }
        let ending = Ending { kind: Kind::Interface, clean: false, during_quit: in_quit(&spans, d.when), ours: false };
        if !is_crash(&ending) {
            crate::diag::write(dir, &format!("crash dump {} was written while Kolux was quitting: not a crash (APP-040)", d.name));
            continue;
        }
        let fault = super::crashdump::fault_of(&d.path);
        let summary = match &fault {
            Some(f) => format!("{INTERFACE_CRASHED}: {}", super::crashdump::code_text(f.code)),
            None => INTERFACE_CRASHED.to_string(),
        };
        let mut c = Crash::new(Kind::Interface, d.when, &summary);
        c.module = fault.and_then(|f| f.module);
        c.memory = mem.and_then(|m| memory_text(&m, d.when));
        c.dumps.push(d.name.clone());
        touched.push(record(dir, c));
    }
    if seen.len() > 200 {
        let extra = seen.len() - 200;
        seen.drain(..extra);
    }
    if let Ok(b) = serde_json::to_vec(&seen) {
        let _ = write_retry(&dir.join(DUMPS_SEEN), &b, &mut |p, b| fs::write(p, b));
    }
    touched
}

/// Where the browser engine writes its crash dumps: its data folder is the local app data folder
/// plus the identifier on Windows (the profile folder's own name). None elsewhere.
pub fn dumps_root(dir: &Path) -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(local).join(dir.file_name()?).join(super::crashdump::DUMP_FOLDER))
}

/// The newest record that has not prompted yet.
pub fn pending(all: &[Crash]) -> Option<&Crash> {
    all.iter().rev().find(|c| !c.dismissed)
}

/// The newest record, prompted or not (Help > Report Crash).
pub fn latest(all: &[Crash]) -> Option<&Crash> {
    all.last()
}

/// Marks `id` dismissed, and everything older with it: only the newest pending report prompts.
pub fn dismiss(all: &mut [Crash], id: &str) -> bool {
    let Some(at) = all.iter().position(|c| c.id == id) else { return false };
    for c in &mut all[..=at] {
        c.dismissed = true;
    }
    true
}

/// The plain-text details for the clipboard and the issue body.
pub fn details(c: &Crash, version: &str, os: &str) -> String {
    let mut s = format!("Kolux crash report\nVersion: {version}\nSystem: {os}\nRecorded: {} (seconds since the epoch)\nWhat was recorded: {}\n", c.when, c.summary);
    if let Some(m) = &c.module {
        s.push_str(&format!("Faulting module: {m}\n"));
    }
    if let Some(m) = &c.memory {
        s.push_str(&format!("Memory before the crash: {m}\n"));
    }
    if c.count > 1 {
        s.push_str(&format!("Processes in this crash: {}\n", c.count));
        for sib in &c.siblings {
            s.push_str(&format!("  also: {sib}\n"));
        }
    }
    s
}

/// Where the newest rotated log file is, if any (its name carries the time).
fn rotated_newest(logs: &Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(logs)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            n.starts_with("kolux.") && n.ends_with(".log") && n != "kolux.log"
        })
        .collect();
    v.sort();
    v.pop()
}

/// APP-039, at startup after this run's start line is in the log: records the previous run's crash.
pub fn startup_scan(dir: &Path) -> Option<Crash> {
    let logs = dir.join("logs");
    let mut text = String::new();
    if let Some(older) = rotated_newest(&logs) {
        text.push_str(&fs::read_to_string(older).unwrap_or_default());
    }
    text.push_str(&fs::read_to_string(logs.join("kolux.log")).unwrap_or_default());
    // T-286-b (APP-040): the previous run's last memory reading, read before this run takes its own.
    let mem = memory_last(dir);
    let run = previous_run_crash(&text).map(|summary| {
        let when = previous_run_end(&text).unwrap_or_else(now_secs);
        let mut c = Crash::new(Kind::App, when, &summary);
        c.memory = mem.and_then(|m| memory_text(&m, when));
        let c = record(dir, c);
        crate::diag::write(dir, &format!("crash record {} added: the previous run left no clean exit (APP-039)", c.id));
        c
    });
    // dumps the engine wrote since the last look join their report or make their own
    let dumps = dumps_root(dir).map(|root| scan_dumps(dir, &root, &text, mem)).unwrap_or_default();
    run.or_else(|| dumps.into_iter().last())
}

/// T-286-b (APP-040): the watch thread's periodic step: a fresh memory reading is saved for the
/// next crash report, and dumps written while Kolux runs become reports straight away (none while
/// it quits).
pub fn sample_step(dir: &Path) {
    memory_save(dir, &memory_sample());
    if crate::final_save::quitting() {
        return;
    }
    if let Some(root) = dumps_root(dir) {
        let log = fs::read_to_string(dir.join("logs").join("kolux.log")).unwrap_or_default();
        for c in scan_dumps(dir, &root, &log, memory_last(dir)) {
            crate::diag::write(dir, &format!("crash record {} now covers an interface crash dump (APP-040)", c.id));
        }
    }
}

fn os_line() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

#[tauri::command]
pub fn crash_pending(app: tauri::AppHandle) -> Result<Option<Crash>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(pending(&crashes_read(&dir)).cloned())
}

#[tauri::command]
pub fn crash_latest(app: tauri::AppHandle) -> Result<Option<Crash>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(latest(&crashes_read(&dir)).cloned())
}

#[tauri::command]
pub fn crash_dismiss(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut all = crashes_read(&dir);
    if dismiss(&mut all, &id) {
        crashes_write(&dir, &all)?;
    }
    Ok(())
}

#[tauri::command]
pub fn crash_details(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let all = crashes_read(&dir);
    let c = all.iter().find(|c| c.id == id).ok_or_else(|| "no such crash record".to_string())?;
    Ok(scrub_report(&details(c, &version_of(&app), &os_line())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-recovery-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn seeded(dir: &Path) {
        let s = crate::state::Store::open(dir).unwrap();
        s.set("layout", "two panes").unwrap();
    }

    fn read_layout(dir: &Path) -> Option<String> {
        crate::state::Store::open(dir).unwrap().get("layout").unwrap()
    }

    // APP-049

    #[test]
    fn t183_a_damaged_state_file_is_set_aside_and_the_last_good_copy_returns() {
        let dir = temp("restore");
        seeded(&dir);
        backup_state(&dir).unwrap();
        assert!(dir.join(STATE_BAK).exists(), "the backup is written");
        let healthy = prepare_state(&dir, &dir.join("scratch"));
        assert_eq!(healthy.outcome, StateOutcome::Fine);
        assert!(healthy.backup_worthwhile());
        // the crash mid-write: garbage where the database was, its journal gone
        let garbage = b"this is not a database at all, it is what a torn write leaves behind, padded out to look real........";
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(companion(&dir.join(STATE_FILE), suffix));
        }
        fs::write(dir.join(STATE_FILE), garbage).unwrap();
        let prep = prepare_state(&dir, &dir.join("scratch"));
        let StateOutcome::Restored { aside } = &prep.outcome else { panic!("{:?} {:?}", prep.outcome, prep.notes) };
        assert_eq!(fs::read(aside).unwrap(), garbage, "the damaged bytes are kept aside, not deleted");
        assert_eq!(prep.open_dir, dir, "the store opens in the profile");
        assert!(prep.backup_worthwhile());
        assert_eq!(read_layout(&dir).as_deref(), Some("two panes"), "the earlier setup is back");
        let _ = fs::remove_dir_all(&dir);
    }

    // After-list row 789: startup recovery reaches the page as sentences naming the file and where it went.
    #[test]
    fn row789_a_restored_or_fresh_state_file_is_named_for_the_user_with_where_it_went() {
        let dir = temp("notes789");
        seeded(&dir);
        backup_state(&dir).unwrap();
        let none = PermReport { profile_writable: true, own_install: true, unreadable: vec![], repaired: vec![] };
        assert!(startup_notes(&prepare_state(&dir, &dir.join("scratch")), &none).is_empty(), "a healthy start says nothing");
        fs::write(dir.join(STATE_FILE), b"this is not a database at all, it is what a torn write leaves behind, padded out to look real........").unwrap();
        let prep = prepare_state(&dir, &dir.join("scratch"));
        let StateOutcome::Restored { aside } = &prep.outcome else { panic!("{:?}", prep.outcome) };
        let said = startup_notes(&prep, &none);
        assert_eq!(said.len(), 1);
        assert!(said[0].contains("state.db") && said[0].contains("damaged") && said[0].contains("restored the last good copy"), "{said:?}");
        assert!(said[0].contains(&aside.display().to_string()), "names where the bad copy is kept: {said:?}");
        let fresh = StatePrep { open_dir: dir.clone(), outcome: StateOutcome::Fresh { aside: dir.join("state.db.damaged-1") }, notes: vec![] };
        assert!(startup_notes(&fresh, &none)[0].contains("started with fresh data"));
        let frozen = StatePrep { open_dir: dir.clone(), outcome: StateOutcome::Frozen { reason: "locked".into() }, notes: vec![] };
        assert!(startup_notes(&frozen, &none)[0].contains("will not save changes this session"));
        let perms = PermReport { profile_writable: false, own_install: true, unreadable: vec![], repaired: vec![dir.join("profile")] };
        let said = startup_notes(&prep, &perms);
        assert!(said.iter().any(|n| n.starts_with("Kolux repaired its access to") && n.contains("profile")), "{said:?}");
        assert!(said.iter().any(|n| n.contains("the profile folder cannot be written")), "{said:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn row789_a_truncated_settings_file_and_the_startup_notes_both_reach_the_page_once() {
        let dir = temp("page789");
        let store = crate::state::Store::open(&dir).unwrap();
        store.save_settings(&serde_json::json!({ "stressMarker": 1 })).unwrap();
        store.save_settings(&serde_json::json!({ "stressMarker": 2 })).unwrap(); // the second save makes settings.json.bak
        let whole = fs::read(dir.join("settings.json")).unwrap();
        fs::write(dir.join("settings.json"), &whole[..whole.len() / 2]).unwrap();
        let notes = StartupNotes(Mutex::new(vec!["state note".to_string()]));
        let got = take_recovery_notes(&store, &notes);
        assert_eq!(got.len(), 2, "{got:?}");
        assert!(got[0].contains("could not read your settings file") && got[0].contains("settings.json.bak"), "{got:?}");
        assert_eq!(got[1], "state note");
        assert!(take_recovery_notes(&store, &notes).is_empty(), "said once");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t183_a_damaged_state_file_without_a_good_copy_starts_fresh_and_keeps_the_bytes() {
        let dir = temp("fresh");
        fs::write(dir.join(STATE_FILE), b"SQLite format 3 but the rest is rubbish ...............................................").unwrap();
        let prep = prepare_state(&dir, &dir.join("scratch"));
        let StateOutcome::Fresh { aside } = &prep.outcome else { panic!("{:?}", prep.outcome) };
        assert!(aside.exists() && !dir.join(STATE_FILE).exists());
        assert!(!prep.backup_worthwhile(), "an empty store never replaces an old backup");
        assert_eq!(read_layout(&dir), None, "the store opens empty");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t183_a_zero_byte_state_file_is_missing_not_damaged_and_a_healthy_one_is_left_alone() {
        let dir = temp("zero");
        fs::write(dir.join(STATE_FILE), b"").unwrap();
        fs::write(companion(&dir.join(STATE_FILE), "-wal"), b"").unwrap();
        let prep = prepare_state(&dir, &dir.join("scratch"));
        assert_eq!(prep.outcome, StateOutcome::Missing);
        assert!(!dir.join(STATE_FILE).exists() && !companion(&dir.join(STATE_FILE), "-wal").exists(), "the empty files are gone");
        assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().contains("damaged")), "nothing was set aside");
        assert_eq!(prepare_state(&dir.join("nothing-here"), &dir).outcome, StateOutcome::Missing);
        seeded(&dir);
        let before = fs::read(dir.join(STATE_FILE)).unwrap();
        assert_eq!(prepare_state(&dir, &dir.join("scratch")).outcome, StateOutcome::Fine);
        assert_eq!(fs::read(dir.join(STATE_FILE)).unwrap(), before, "a healthy file is not touched");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t183_a_damaged_state_file_that_cannot_be_set_aside_freezes_saving_and_keeps_the_settings() {
        let dir = temp("frozen");
        let garbage = b"not a database; and this time it cannot be moved ............................................";
        fs::write(dir.join(STATE_FILE), garbage).unwrap();
        fs::write(dir.join("settings.json"), br#"{"theme":"dark"}"#).unwrap();
        let scratch = dir.join("scratch");
        let prep = prepare_state_with(&dir, &scratch, |p| Err(format!("{}: the file is locked", p.display())));
        assert!(matches!(&prep.outcome, StateOutcome::Frozen { reason } if reason.contains("locked")), "{:?}", prep.outcome);
        assert_eq!(prep.open_dir, scratch, "the session runs on a scratch store");
        assert!(!prep.backup_worthwhile());
        assert_eq!(fs::read(dir.join(STATE_FILE)).unwrap(), garbage, "the damaged file is not written");
        assert_eq!(fs::read(scratch.join("settings.json")).unwrap(), br#"{"theme":"dark"}"#, "the user's settings still read");
        let s = crate::state::Store::open(&prep.open_dir).unwrap();
        s.set("layout", "new").unwrap();
        assert_eq!(fs::read(dir.join(STATE_FILE)).unwrap(), garbage, "saving touches only the scratch store");
        let _ = fs::remove_dir_all(&dir);
    }

    // APP-021

    #[test]
    fn t183_only_a_per_user_install_is_repaired_and_the_steps_go_mildest_first() {
        let local = Path::new("C:/Users/u/AppData/Local");
        let profile = Path::new("C:/Users/u");
        assert!(own_install(Path::new("C:/Users/u/AppData/Local/Kolux RS"), Some(local), Some(profile)));
        assert!(own_install(Path::new("C:/Users/u/Apps/Kolux"), None, Some(profile)));
        assert!(!own_install(Path::new("C:/Program Files/Kolux"), Some(local), Some(profile)));
        assert!(!own_install(Path::new("C:/Program Files/Kolux"), None, None));
        let steps = repair_steps(Path::new("C:/x/a.dll"), "someone");
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0][1], "/reset", "inherited defaults first");
        assert_eq!(&steps[1][1..3], &["/remove:d".to_string(), "someone".to_string()], "then the deny entries");
        assert_eq!(steps[2][2], "someone:(F)", "then an explicit grant");
        assert!(steps.iter().all(|s| s[0] == "C:/x/a.dll" && s.contains(&"/C".to_string()) && s.contains(&"/Q".to_string())));
    }

    #[test]
    fn t183_the_startup_check_names_what_stays_broken_and_runs_nothing_when_all_is_well() {
        let dir = temp("perm-ok");
        let install = dir.join("install");
        fs::create_dir_all(install.join("resources")).unwrap();
        fs::write(install.join("kolux.exe"), b"x").unwrap();
        fs::write(install.join("resources").join("a.txt"), b"x").unwrap();
        let mut ran = Vec::new();
        let report = startup_check(&install, &dir.join("profile"), "u", true, &mut |a: &[String]| {
            ran.push(a.to_vec());
            true
        });
        assert_eq!(report, PermReport { profile_writable: true, own_install: true, unreadable: vec![], repaired: vec![] });
        assert!(ran.is_empty(), "nothing to repair, icacls never runs");
        assert_eq!(report.problem(), None);
        // what the prompt says when things stay broken
        let broken = PermReport { profile_writable: false, own_install: false, unreadable: vec![install.join("kolux.exe")], repaired: vec![] };
        let p = broken.problem().unwrap();
        assert!(p.starts_with("a permissions problem: the profile folder cannot be written; 1 file(s) in the install folder cannot be read"), "{p}");
        assert!(p.contains("not a per-user install"), "{p}");
        // a repair runner that fixes nothing on a per-user install: every step is tried, the file is listed
        let mut tries = 0;
        let lost = repair(&install.join("missing.dll"), "u", &mut |_: &[String]| {
            tries += 1;
            false
        }, &|_| false);
        assert!(!lost);
        assert_eq!(tries, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The real edge on Windows: a file the user is denied reading is found, and the icacls repair
    /// makes it readable again. Skipped quietly where icacls cannot deny (not Windows, no user name).
    #[test]
    #[cfg(windows)]
    fn t183_a_denied_install_file_is_found_and_repaired_with_icacls() {
        let user = std::env::var("USERNAME").unwrap_or_default();
        if user.is_empty() {
            return;
        }
        let dir = temp("perm-deny");
        let install = dir.join("install");
        fs::create_dir_all(&install).unwrap();
        let file = install.join("kolux.dll");
        fs::write(&file, b"bytes").unwrap();
        if !icacls(&[file.display().to_string(), "/deny".into(), format!("{user}:(R)"), "/Q".into()]) {
            let _ = fs::remove_dir_all(&dir);
            return;
        }
        assert!(fs::File::open(&file).is_err(), "the deny took");
        assert_eq!(unreadable_files(&install), vec![file.clone()], "the denied file is found");
        let report = startup_check(&install, &dir.join("profile"), &user, true, &mut icacls);
        assert_eq!(report.unreadable, Vec::<PathBuf>::new(), "{report:?}");
        assert_eq!(report.repaired, vec![file.clone()]);
        assert_eq!(fs::read(&file).unwrap(), b"bytes", "access is restored");
        let _ = icacls(&[file.display().to_string(), "/reset".into(), "/Q".into()]);
        let _ = fs::remove_dir_all(&dir);
    }

    // APP-042

    fn t0() -> Instant {
        Instant::now()
    }

    /// Ticks once a second for `secs` seconds, the way the watch thread does; what happened, with the
    /// second it happened at.
    fn run(i: &mut Interface, t: &mut Instant, secs: u64) -> Vec<(u64, Action)> {
        let mut out = Vec::new();
        for s in 1..=secs {
            *t += Duration::from_secs(1);
            let a = i.tick(*t);
            if a != Action::Nothing {
                out.push((s, a));
            }
        }
        out
    }

    #[test]
    fn t183_a_stalled_page_is_reloaded_once_retried_once_then_the_user_is_asked() {
        let mut t = t0();
        let mut i = Interface::new(t, STALL);
        i.beat(t);
        assert_eq!(run(&mut i, &mut t, 19), vec![], "inside the budget");
        assert_eq!(run(&mut i, &mut t, 1), vec![(1, Action::Reload { attempt: 1 })]);
        assert_eq!(run(&mut i, &mut t, 19), vec![], "the reload gets its own budget");
        assert_eq!(run(&mut i, &mut t, 1), vec![(1, Action::Reload { attempt: 2 })], "one retry");
        assert_eq!(run(&mut i, &mut t, 20), vec![(20, Action::Prompt(Reason::Stalled))]);
        assert_eq!(run(&mut i, &mut t, 120), vec![], "prompts never stack: nothing while the user is asked");
        // the user chose Reload: a page that comes back is live again
        i.answered(true, t);
        t += Duration::from_secs(2);
        i.beat(t);
        assert_eq!(run(&mut i, &mut t, 19), vec![]);
        assert_eq!(i.recoveries(), 1);
        // the user chose Quit: the watch is over
        let mut q = Interface::new(t, STALL);
        q.answered(false, t);
        assert_eq!(run(&mut q, &mut t, 200), vec![]);
    }

    #[test]
    fn t183_a_heartbeat_ends_the_reload_the_breaker_stops_loops_and_sleep_restarts_the_budget() {
        let mut t = t0();
        let mut i = Interface::new(t, STALL);
        i.beat(t);
        // three stalls, each recovered by the first reload: live again each time
        for n in 1..=3 {
            // the first stall is 20 s after the beat at t; later ones 20 s after the beat below (19 + 1)
            let at = if n == 1 { 20 } else { 19 };
            assert_eq!(run(&mut i, &mut t, at), vec![(at, Action::Reload { attempt: 1 })], "stall {n}");
            t += Duration::from_secs(3);
            i.beat(t);
            assert_eq!(run(&mut i, &mut t, 1), vec![]);
            assert_eq!(i.recoveries(), n);
        }
        // the fourth inside ten minutes: the breaker asks instead of reloading
        assert_eq!(run(&mut i, &mut t, 19), vec![(19, Action::Prompt(Reason::Loop))]);
        // sleep: a tick gap past WAKE_GAP starts the budget over instead of counting the gap as a stall
        let mut t = t0();
        let mut j = Interface::new(t, STALL);
        j.beat(t);
        assert_eq!(run(&mut j, &mut t, 1), vec![]);
        t += WAKE_GAP + Duration::from_secs(600);
        assert_eq!(j.tick(t), Action::Nothing, "the gap itself is not a stall");
        assert_eq!(run(&mut j, &mut t, 19), vec![], "a fresh budget after waking");
        assert_eq!(run(&mut j, &mut t, 1), vec![(1, Action::Reload { attempt: 1 })]);
        // closing: the watch thread finds no window and skips the tick (watch_start), so nothing is asked
        // the first load gets the long budget, and a page that never beats is still recovered after it
        let mut t = t0();
        let mut f = Interface::new(t, STALL);
        assert_eq!(run(&mut f, &mut t, 89), vec![], "the first load may be slow");
        assert_eq!(run(&mut f, &mut t, 1), vec![(1, Action::Reload { attempt: 1 })]);
    }

    #[test]
    fn t183_the_prompt_names_the_cause_and_gives_commands_to_copy() {
        let install = Path::new("C:/Users/u/AppData/Local/Kolux RS");
        let t = cause_text(Reason::Stalled, Some("a permissions problem: 2 file(s) in the install folder cannot be read"), install, false);
        assert!(t.starts_with("The Kolux interface is not responding.\nA reload and one retry never brought the page back."), "{t}");
        assert!(t.contains("  - a permissions problem: 2 file(s)"), "{t}");
        assert!(t.contains("icacls \"C:/Users/u/AppData/Local/Kolux RS\" /reset /T /C /Q"), "{t}");
        assert!(t.contains("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu"), "{t}");
        assert!(t.ends_with("Retry reloads the interface. Cancel quits Kolux."), "{t}");
        let l = cause_text(Reason::Loop, None, install, true);
        assert!(l.contains("recovered 3 times in the last 10 minutes"), "{l}");
        assert!(l.contains("graphics driver"), "{l}");
        assert!(!l.contains("the page stalled while loading"), "a named cause replaces the plain one");
        assert!(cause_text(Reason::Stalled, None, install, false).contains("the page stalled while loading"));
    }

    // APP-043

    #[test]
    fn t183_three_graphics_losses_inside_a_minute_fire_once_and_never_again() {
        let now = t0();
        let mut b = Burst::default();
        assert!(!b.hit(now));
        assert!(!b.hit(now + Duration::from_secs(20)));
        assert!(b.hit(now + Duration::from_secs(40)), "the third inside a minute");
        assert!(!b.hit(now + Duration::from_secs(41)), "at most once");
        let mut slow = Burst::default();
        assert!(!slow.hit(now));
        assert!(!slow.hit(now + Duration::from_secs(30)));
        assert!(!slow.hit(now + Duration::from_secs(61)), "the first one fell out of the window");
        assert!(slow.hit(now + Duration::from_secs(62)), "three inside the window again");
    }

    #[test]
    fn t183_the_safe_graphics_flag_dies_with_the_version_is_ignored_off_windows_and_adds_one_argument() {
        let dir = temp("safe-flag");
        assert_eq!(launch_flag(&dir, "0.1.0", true), None, "no flag, no safe graphics");
        flag_write(&dir, &SafeFlag { version: "0.1.0".into(), chosen: false }).unwrap();
        assert_eq!(launch_flag(&dir, "0.1.0", false), None, "ignored off Windows, but kept");
        assert!(dir.join(SAFE_FLAG).exists());
        assert_eq!(launch_flag(&dir, "0.1.0", true), Some(SafeFlag { version: "0.1.0".into(), chosen: false }));
        assert_eq!(launch_flag(&dir, "0.2.0", true), None, "a new version tries hardware acceleration again");
        assert!(!dir.join(SAFE_FLAG).exists(), "and the flag is gone");
        flag_write(&dir, &SafeFlag { version: "0.2.0".into(), chosen: true }).unwrap();
        assert_eq!(launch_flag(&dir, "0.2.0", true).map(|f| f.chosen), Some(true), "the choice is remembered");
        flag_clear(&dir).unwrap();
        assert_eq!(flag_read(&dir), None);
        assert_eq!(flag_clear(&dir), Ok(()), "T-724: a flag already gone counts as cleared");
        fs::create_dir_all(dir.join(SAFE_FLAG)).unwrap(); // a path that cannot be removed as a file
        assert!(flag_clear(&dir).is_err(), "T-724: a flag that cannot be removed is told, not swallowed");
        fs::remove_dir(dir.join(SAFE_FLAG)).unwrap();
        assert_eq!(safe_args(None), format!("{BASE_ARGS} --disable-gpu"), "the base string stays");
        assert_eq!(safe_args(Some("--foo")), "--foo --disable-gpu");
        assert_eq!(safe_args(Some("--foo --disable-gpu")), "--foo --disable-gpu", "never twice");
        assert_eq!(safe_args(Some("  ")), format!("{BASE_ARGS} --disable-gpu"));
        let _ = fs::remove_dir_all(&dir);
    }

    // APP-039

    #[test]
    fn t183_a_run_without_a_clean_exit_is_a_crash_and_its_fatal_line_is_the_summary() {
        let clean = "1 kolux-rs: config: CLAUDE_CONFIG_DIR=x\n2 terminal 1 started\n3 app exit\n4 kolux-rs: config: CLAUDE_CONFIG_DIR=x\n";
        assert_eq!(previous_run_crash(clean), None);
        let failed_start = "1 kolux-rs: config: a\n2 could not start: no app data folder\n3 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(failed_start), None, "a start that gave up on purpose is not a crash");
        let crashed = "1 kolux-rs: config: a\n2 terminal 1 started\n3 fatal error: panicked at src/x.rs:1: boom\n4 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(crashed).as_deref(), Some("fatal error: panicked at src/x.rs:1: boom"));
        let killed = "1 kolux-rs: config: a\n2 terminal 1 started\n5 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(killed).as_deref(), Some(NO_CLEAN_EXIT));
        let background = "1 kolux-rs: config: a\n2 error in background work, the app keeps going: x\n3 app exit\n4 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(background), None, "a background error that was survived is not a crash");
        assert_eq!(previous_run_crash("1 kolux-rs: config: a\n2 terminal\n"), None, "the first run ever has no previous run");
        // only the run before the current start counts, not an older crash
        let older = "1 kolux-rs: config: a\n2 fatal error: old\n3 kolux-rs: config: a\n4 app exit\n5 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(older), None);
        // the report never carries the user's folder name
        assert_eq!(scrub_report("panicked at C:\\Users\\someone\\src\\x.rs:1 boom"), "panicked at <home>\\src\\x.rs:1 boom");
        assert_eq!(scrub_report("in /home/someone/dev and /Users/someone/dev"), "in <home>/dev and <home>/dev");
        assert_eq!(scrub_report("token=abcdefghijklmnop plain words"), crate::diag::scrub("token=abcdefghijklmnop plain words"), "secrets still masked");
        assert_eq!(scrub_report("nothing to hide"), "nothing to hide");
    }

    #[test]
    fn t183_the_newest_pending_report_prompts_once_and_help_reopens_it_after() {
        let dir = temp("crashes");
        assert_eq!(startup_scan(&dir), None, "no log, no record");
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("logs").join("kolux.log"), "1 kolux-rs: config: a\n2 fatal error: panicked at C:\\Users\\someone\\src\\x.rs: boom\n3 kolux-rs: config: a\n").unwrap();
        let c = startup_scan(&dir).expect("a record");
        assert!(!c.summary.contains("someone"), "paths are scrubbed: {}", c.summary);
        let all = crashes_read(&dir);
        assert_eq!(pending(&all), Some(&c), "it prompts");
        let mut all = all;
        assert!(dismiss(&mut all, &c.id));
        crashes_write(&dir, &all).unwrap();
        let all = crashes_read(&dir);
        assert_eq!(pending(&all), None, "only once");
        assert_eq!(latest(&all), Some(&all[0]), "Help > Report Crash still finds it");
        assert!(latest(&all).unwrap().dismissed);
        // an older pending record never prompts once a newer one was dismissed
        // (T-286-b: two crashes, far enough apart not to merge)
        let older = record(&dir, Crash::new(Kind::App, 1_000_000, "older, left pending"));
        let newer = record(&dir, Crash::new(Kind::App, 1_000_100, "newer"));
        let mut all = crashes_read(&dir);
        assert_eq!(pending(&all).map(|c| c.id.clone()), Some(newer.id.clone()), "the newest pending one");
        assert!(dismiss(&mut all, &newer.id));
        assert!(all.iter().find(|c| c.id == older.id).unwrap().dismissed, "the older one went with it");
        assert_eq!(pending(&all), None);
        assert!(!dismiss(&mut all, "no-such-id"));
        let d = details(&newer, "0.1.0", "windows x86_64");
        assert!(d.starts_with("Kolux crash report\nVersion: 0.1.0\nSystem: windows x86_64\n"), "{d}");
        assert!(d.contains("What was recorded: newer"));
        // the file keeps the newest KEEP (five since T-286-b)
        for n in 0..25 {
            record(&dir, Crash::new(Kind::App, 2_000_000 + n * 100, &format!("flood {n}")));
        }
        let all = crashes_read(&dir);
        assert_eq!(all.len(), KEEP);
        assert_eq!(all.last().unwrap().summary, "flood 24");
        let _ = fs::remove_dir_all(&dir);
    }

    // T-286-b (APP-040)

    #[test]
    fn t286b_only_real_crashes_count() {
        let e = |kind, clean, during_quit, ours| Ending { kind, clean, during_quit, ours };
        assert!(!is_crash(&e(Kind::App, true, false, false)), "a clean end");
        assert!(!is_crash(&e(Kind::App, false, true, false)), "an exit during an expected shutdown");
        assert!(!is_crash(&e(Kind::Graphics, false, true, false)), "a graphics exit at quit time");
        assert!(!is_crash(&e(Kind::Interface, false, false, true)), "a kill Kolux issued itself");
        assert!(is_crash(&e(Kind::Interface, false, false, false)), "an interface process crash");
        assert!(is_crash(&e(Kind::Child, false, false, false)), "an unknown child crash");
        assert!(is_crash(&e(Kind::App, false, false, false)), "Kolux itself ending badly");
        // in the log: a quit under way, or Kolux ending itself, is no crash ten times over
        for n in 0..10 {
            let quit = format!("{n}0 kolux-rs: config: a\n{n}1 final save: 5 finished in 20 ms\n{n}2 kolux-rs: config: a\n");
            assert_eq!(previous_run_crash(&quit), None);
        }
        let restart = format!("1 kolux-rs: config: a\n2 {SELF_END} restart to update\n3 kolux-rs: config: a\n");
        assert_eq!(previous_run_crash(&restart), None);
        let gone = "1 kolux-rs: config: a\n7 terminal 1 started\n9 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(gone).as_deref(), Some(NO_CLEAN_EXIT));
        assert_eq!(previous_run_end(gone), Some(7), "the last line the run wrote");
    }

    #[test]
    fn t286b_seven_interface_crashes_leave_five_reports_and_siblings_merge() {
        let mut all = Vec::new();
        for n in 0..7u64 {
            add(&mut all, Crash::new(Kind::Interface, 10_000 + n * 1000, INTERFACE_CRASHED));
        }
        assert_eq!(all.len(), 5, "only the newest five");
        assert_eq!(all[0].when, 12_000);
        assert_eq!(all.iter().map(|c| c.id.clone()).collect::<std::collections::HashSet<_>>().len(), 5, "ids stay unique");
        // the same crash seen from three processes is one report
        let mut all = Vec::new();
        let id = add(&mut all, Crash::new(Kind::App, 500, NO_CLEAN_EXIT));
        assert_eq!(add(&mut all, Crash::new(Kind::Interface, 510, INTERFACE_CRASHED)), id);
        assert_eq!(add(&mut all, Crash::new(Kind::Graphics, 520, "graphics process gone")), id);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].count, 3);
        assert_eq!(all[0].kind, Kind::Interface, "the interface headline replaces the bare no-clean-exit line");
        assert_eq!(all[0].summary, INTERFACE_CRASHED);
        assert_eq!(all[0].siblings.len(), 2);
        assert!(!all[0].dismissed, "one pending prompt for the lot");
        // a later crash is its own report
        assert_ne!(add(&mut all, Crash::new(Kind::Interface, 900, INTERFACE_CRASHED)), id);
    }

    #[test]
    fn t286b_a_late_dump_merges_and_names_the_module_once() {
        let mut all = Vec::new();
        let id = add(&mut all, Crash::new(Kind::App, 1_000, NO_CLEAN_EXIT));
        let mut dump = Crash::new(Kind::Interface, 1_400, INTERFACE_CRASHED);
        dump.module = Some("libGLESv2.dll".into());
        dump.dumps.push("abc.dmp".into());
        assert_eq!(add(&mut all, dump.clone()), id, "arrived late, still the same report");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].module.as_deref(), Some("libGLESv2.dll"));
        assert_eq!(add(&mut all, dump), id, "the same dump again changes nothing");
        assert_eq!(all[0].dumps, vec!["abc.dmp".to_string()]);
        assert_eq!(all[0].count, 1);
        let d = details(&all[0], "0.1.0", "windows x86_64");
        assert!(d.contains("Faulting module: libGLESv2.dll"), "{d}");
    }

    #[test]
    fn t286b_the_store_survives_damage_and_retries_a_locked_file() {
        let dir = temp("store");
        fs::write(dir.join(CRASHES), b"{ not json").unwrap();
        assert!(crashes_read(&dir).is_empty(), "a damaged file starts empty");
        let c = record(&dir, Crash::new(Kind::App, 5, "boom"));
        assert_eq!(crashes_read(&dir), vec![c], "and takes new reports");
        // Row 589: the damaged file was kept aside byte for byte, not saved over.
        let kept: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(&format!("{CRASHES}.corrupt-"))).collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(fs::read(kept[0].path()).unwrap(), b"{ not json");
        // Row 589: a crash list that cannot be read (here a folder where the file goes) is not saved over.
        let held = temp("store-held");
        fs::create_dir_all(held.join(CRASHES)).unwrap();
        let _ = record(&held, Crash::new(Kind::App, 6, "unsaved"));
        assert!(held.join(CRASHES).is_dir(), "left alone");
        // two sharing violations, then the save goes through
        let mut calls = 0;
        let r = write_retry(&dir.join("x.json"), b"1", &mut |p, b| {
            calls += 1;
            if calls < 3 { Err(std::io::Error::from_raw_os_error(32)) } else { fs::write(p, b) }
        });
        assert_eq!(r, Ok(()));
        assert_eq!(calls, 3);
        // an error that is not a lock is not retried
        let mut calls = 0;
        let r = write_retry(&dir.join("y.json"), b"1", &mut |_, _| {
            calls += 1;
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "gone"))
        });
        assert!(r.is_err());
        assert_eq!(calls, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t286b_the_report_carries_the_last_memory_reading_and_never_disk_space() {
        let r = MemReading { when: 100, free: Some(2 * 1_073_741_824), total: Some(16 * 1_073_741_824), app: Some(400 * 1_048_576) };
        let t = memory_text(&r, 130).unwrap();
        assert_eq!(t, "2.0 GB free of 16.0 GB (88% in use), Kolux itself 400 MB; read 30 s before the crash");
        assert!(!t.to_lowercase().contains("disk") && !t.to_lowercase().contains("swap"));
        assert_eq!(memory_text(&MemReading { when: 1, free: None, total: None, app: None }, 2), None);
        // the previous run's reading goes into the report the next start writes
        let dir = temp("memory");
        memory_save(&dir, &r);
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("logs").join("kolux.log"), "90 kolux-rs: config: a\n130 terminal 1 started\n200 kolux-rs: config: a\n").unwrap();
        let c = startup_scan(&dir).expect("a report");
        assert_eq!(c.memory.as_deref(), Some("2.0 GB free of 16.0 GB (88% in use), Kolux itself 400 MB; read 30 s before the crash"));
        assert!(details(&c, "0.1.0", "x").contains("Memory before the crash: 2.0 GB free"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t286b_dumps_become_interface_reports_unless_written_while_quitting() {
        use super::super::crashdump::tests::minidump;
        let dir = temp("dumps");
        let root = dir.join("Crashpad");
        fs::create_dir_all(root.join("reports")).unwrap();
        fs::write(root.join("reports").join("old.dmp"), minidump(5, 0x1008, &[(0x1000, 0x100, "C:\\x\\old.dll")])).unwrap();
        // the first look takes what is already there as seen
        assert!(scan_dumps(&dir, &root, "", None).is_empty());
        fs::write(root.join("reports").join("new.dmp"), minidump(0xC000_0005, 0x2010, &[(0x2000, 0x100, "C:\\Users\\me\\nvwgf2umx.dll")])).unwrap();
        let got = scan_dumps(&dir, &root, "", None);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].kind, Kind::Interface);
        assert_eq!(got[0].module.as_deref(), Some("nvwgf2umx.dll"));
        assert_eq!(got[0].summary, format!("{INTERFACE_CRASHED}: 0xC0000005 (access violation)"));
        assert!(scan_dumps(&dir, &root, "", None).is_empty(), "a dump is looked at once");
        // a dump written inside a quit span is no crash
        let now = now_secs();
        let log = format!("{} kolux-rs: config: a\n{} final save: 4 finished in 10 ms\n{} app exit\n", now - 100, now - 2, now - 1);
        assert!(in_quit(&quit_spans(&log), now));
        fs::write(root.join("reports").join("quit.dmp"), minidump(5, 0x1008, &[])).unwrap();
        assert!(scan_dumps(&dir, &root, &log, None).is_empty(), "graphics exit at quit time");
        assert_eq!(crashes_read(&dir).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t286b_quit_spans_cover_the_quit_and_end_at_the_next_start() {
        let log = "100 kolux-rs: config: a\n150 final save: 4 finished in 10 ms\n151 app exit\n400 kolux-rs: config: a\n500 terminal\n";
        let spans = quit_spans(log);
        assert_eq!(spans, vec![(135, 400)]);
        assert!(in_quit(&spans, 140) && !in_quit(&spans, 120) && !in_quit(&spans, 450));
        let open = "100 kolux-rs: config: a\n150 kolux ended itself: restart to update\n";
        assert_eq!(quit_spans(open), vec![(135, 180)]);
    }

    // T-324-b-rest: a Windows sign-out, shutdown or restart is a clean end

    #[test]
    fn t324b_a_windows_session_end_is_no_crash_but_a_run_that_just_stops_still_is() {
        let session = "1 kolux-rs: config: a\n2 terminal 1 started\n3 windows session ended: sign-out, shutdown or restart\n4 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(session), None, "the session end the user chose is not a crash");
        let clean = "1 kolux-rs: config: a\n2 app exit\n3 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(clean), None, "a normal quit stays clean");
        let killed = "1 kolux-rs: config: a\n2 terminal 1 started\n3 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(killed).as_deref(), Some(NO_CLEAN_EXIT), "a real crash is still reported");
        let first_run = "1 kolux-rs: config: a\n2 terminal 1 started\n";
        assert_eq!(previous_run_crash(first_run), None, "the first run has no previous run");
        // only the run just before this start counts: a session end two runs ago excuses nothing
        let crash_after = "1 kolux-rs: config: a\n2 windows session ended: x\n3 kolux-rs: config: a\n4 terminal 1 started\n5 kolux-rs: config: a\n";
        assert_eq!(previous_run_crash(crash_after).as_deref(), Some(NO_CLEAN_EXIT));
        // a crash dump written in the shutdown minutes is a quit-time exit too
        let spans = quit_spans("100 kolux-rs: config: a\n150 windows session ended: x\n400 kolux-rs: config: a\n");
        assert_eq!(spans, vec![(135, 400)]);
    }

    // T-286-b (APP-017)

    #[test]
    fn t286b_a_jump_in_the_wall_clock_is_a_wake_and_only_plain_windows_are_nudged() {
        let t0 = std::time::UNIX_EPOCH + Duration::from_secs(1_000);
        let mut w = Wake::new(t0);
        assert!(!w.tick(t0 + Duration::from_secs(1)));
        assert!(!w.tick(t0 + Duration::from_secs(3)), "a slow tick is not sleep");
        assert!(w.tick(t0 + Duration::from_secs(3 + 3600)), "an hour asleep");
        assert!(!w.tick(t0 + Duration::from_secs(3602)), "the clock going back is not a wake");
        assert!(nudge_ok(true, false, false, false));
        assert!(!nudge_ok(false, false, false, false), "hidden");
        assert!(!nudge_ok(true, true, false, false), "minimised");
        assert!(!nudge_ok(true, false, true, false), "maximised keeps its size");
        assert!(!nudge_ok(true, false, false, true), "full screen keeps its size");
    }

    #[test]
    fn t286b_every_window_is_excused_from_background_throttling_once() {
        let a = browser_args(None, false);
        assert!(a.starts_with(BASE_ARGS), "the base string stays: {a}");
        for s in UNTHROTTLED {
            assert_eq!(a.split_whitespace().filter(|x| *x == s).count(), 1, "{s} once");
        }
        let safe = browser_args(None, true);
        assert!(safe.contains(SAFE_ARG) && safe.contains(UNTHROTTLED[0]));
        assert_eq!(browser_args(Some(&a), false), a, "applying twice adds nothing");
        assert_eq!(browser_args(Some("--x"), false), format!("--x {} --disable-features=FedCm", UNTHROTTLED.join(" ")));
        assert!(a.split_whitespace().any(|x| x == "--disable-features=msWebOOUI,msPdfOOUI,FedCm"), "BROW-026 FedCM off in the one list: {a}");
        assert_eq!(browser_args_now(), LAUNCH_ARGS.get().cloned().unwrap_or_else(|| browser_args(None, false)));
    }

    /// R07-browser.2 (T-634): wry's default list switches SmartScreen off, and every window and tab
    /// shares one string, so browser tabs and their downloads got no phishing or malware check. The
    /// one string keeps wry's other two switches and leaves SmartScreen on, in every mode.
    #[test]
    fn t634_smartscreen_stays_on_in_the_one_string() {
        let url = tauri::Url::parse("http://127.0.0.1:8080").unwrap();
        for (safe, proxy) in [(false, None), (true, None), (false, Some(&url)), (true, Some(&url))] {
            let s = launch_string(None, safe, proxy);
            assert!(!s.contains("SmartScreen"), "{s}");
            assert!(s.split_whitespace().any(|x| x == "--disable-features=msWebOOUI,msPdfOOUI,FedCm"), "{s}");
        }
        assert!(!safe_args(None).contains("SmartScreen"));
    }

    fn profile_with(name: &str, settings: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-row939-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("settings.json"), settings).unwrap();
        d
    }

    #[test]
    fn row939_the_window_carries_the_proxy_saved_in_its_profile() {
        let sealed = crate::secrets::seal("socks5://proxy.test:1080").unwrap();
        for (name, settings, flag) in [
            ("clear", r#"{"httpProxy":"http://127.0.0.1:8080"}"#.to_string(), Some("--proxy-server=http://127.0.0.1:8080")),
            ("sealed", format!(r#"{{"httpProxy":"{sealed}"}}"#), Some("--proxy-server=socks5://proxy.test:1080")),
            ("empty", r#"{"httpProxy":""}"#.to_string(), None),
            ("unset", r#"{"theme":"dark"}"#.to_string(), None),
            ("credentialed", r#"{"httpProxy":"http://me:pw@127.0.0.1:8080"}"#.to_string(), None),
            ("equals-host", r#"{"httpProxy":"http://http=proxy.corp:3128"}"#.to_string(), None),
            ("unusable", r#"{"httpProxy":"ftp://p:1"}"#.to_string(), None),
        ] {
            let d = profile_with(name, &settings);
            let proxy = saved_proxy_in(&d);
            let args = launch_string(None, false, proxy.as_ref());
            let base = browser_args(None, false);
            match flag {
                Some(f) => assert_eq!(args, format!("{} {f}", super::super::renderer_heap::apply_here(&base)), "{name}"),
                None => assert!(!args.contains("--proxy-server"), "{name}: {args}"),
            }
            let _ = fs::remove_dir_all(d);
        }
        assert!(saved_proxy_in(&std::env::temp_dir().join("kolux-rs-row939-missing")).is_none());
    }

    #[test]
    fn row939_the_last_good_copy_of_the_settings_names_the_proxy_when_the_file_is_corrupt() {
        let d = profile_with("bak", "{ half written");
        fs::write(d.join("settings.json.bak"), r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(saved_proxy_in(&d).map(|u| u.to_string()), Some("http://127.0.0.1:3128/".to_string()));
        let _ = fs::remove_dir_all(d);
    }

    // Row 944: the main settings load now reads a missing settings.json from the .bak (state.rs read_file), so the window does too.
    #[test]
    fn row944_a_missing_settings_file_gives_the_window_the_proxy_of_the_last_good_copy() {
        let d = profile_with("missing", "{}");
        fs::remove_file(d.join("settings.json")).unwrap();
        fs::write(d.join("settings.json.bak"), r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(saved_proxy_in(&d).map(|u| u.to_string()), Some("http://127.0.0.1:3128/".to_string()), "the window runs on what the settings load says");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn row939_a_tab_on_the_windows_folder_matches_its_string_exactly_when_the_proxy_is_unchanged() {
        use crate::browser::proxy;
        let url = tauri::Url::parse("http://127.0.0.1:8080").unwrap();
        let launch = launch_string(Some("--x"), false, Some(&url));
        let tab = proxy::tab_browser_args(&proxy::without_proxy(&launch), Some(&url)).unwrap();
        assert!(proxy::same_args(&launch, &tab), "{launch} vs {tab}");
        assert_eq!(launch.split_whitespace().filter(|a| a.starts_with("--proxy-server=")).count(), 1);
        let cleared = proxy::tab_browser_args(&proxy::without_proxy(&launch), None).unwrap();
        assert!(!proxy::same_args(&launch, &cleared), "a cleared setting is a different string from the window's, so the tab is refused");
    }

    // Rows 955 / 959: a window that passes no browser arguments gets wry's defaults, and the engine
    // refuses a second set on the default data folder (0x8007139F). The window's own string always
    // carries the throttling exemption, so the mismatch needs no proxy and no safe graphics.
    #[test]
    fn row955_the_window_string_never_equals_what_an_argless_window_passes() {
        let url = tauri::Url::parse("http://127.0.0.1:8080").unwrap();
        for (label, safe, proxy) in [("neither", false, None), ("proxy", false, Some(&url)), ("safe graphics", true, None), ("both", true, Some(&url))] {
            let main = launch_string(None, safe, proxy);
            assert_ne!(main, WRY_DEFAULT_ARGS, "{label}: an argless second window would be refused");
            assert_eq!(args_for_later_window(Some(&main)), main, "{label}: a later window passes the window's string as it is");
        }
        assert_eq!(args_for_later_window(None), browser_args(None, false), "before the launch string exists the plain string stands in");
    }

    /// Every call that makes a webview, as the scan below knows them.
    const WEBVIEW_BUILDERS: [&str; 5] = ["WebviewWindowBuilder::new(", "WebviewBuilder::new(", "WebviewWindow::builder(", "Webview::builder(", "WebviewWindowBuilder::from_config("];
    /// What a builder chain must itself contain: the one source's string, a data folder, or the
    /// opener's engine. A hardcoded string, or a neighbour's call, does not count.
    const WEBVIEW_ARG_CALLS: [&str; 4] = [".additional_browser_args(&browser_args_now())", ".additional_browser_args(&crate::resources::recovery::browser_args_now())", ".data_directory(", ".window_features("];

    /// The three links by which the tab's builder reaches the one browser-argument source, through
    /// variables: launch string -> proxy setup -> the window's `args`.
    const TAB_LINKS: [&str; 3] = ["let launch = crate::resources::recovery::browser_args_now();", "proxy::tab_setup(&launch,", ".additional_browser_args(&args)"];

    /// Whether the tab builder at `line` (1-based) sits inside `browser_open` and its links appear
    /// there in order with nothing rebinding `args` after the setup hands it over.
    fn tab_builder_vouched(code: &str, line: usize) -> bool {
        let Some(start) = code.find("pub async fn browser_open(") else { return false };
        let end = code[start..].find("\n}").map_or(code.len(), |i| start + i);
        let body = &code[start..end];
        let at = code.split('\n').take(line - 1).map(|l| l.len() + 1).sum::<usize>();
        if at < start || at > end {
            return false;
        }
        let Some(p1) = body.find(TAB_LINKS[0]) else { return false };
        let Some(p2) = body[p1..].find(TAB_LINKS[1]).map(|i| p1 + i) else { return false };
        let Some(p3) = body[p2..].find("let (args,").map(|i| p2 + i) else { return false };
        let Some(p4) = body[p3..].find(TAB_LINKS[2]).map(|i| p3 + i) else { return false };
        let between = &body[p3 + "let (args,".len()..p4];
        let word = |t: &str| t.match_indices("args").any(|(i, _)| !t[..i].ends_with(|c: char| c.is_alphanumeric() || c == '_') && !t[i + 4..].starts_with(|c: char| c.is_alphanumeric() || c == '_'));
        let rebinds = between.split(';').any(|stmt| {
            let stmt = stmt.trim_start();
            let target = stmt.strip_prefix("let ").map_or(stmt, |p| p.split('=').next().unwrap_or(""));
            let assigns = stmt.match_indices("args").any(|(i, _)| word(&stmt[i..i + 4]) && !stmt[..i].ends_with(|c: char| c.is_alphanumeric() || c == '_' || c == '.') && { let t = stmt[i + 4..].trim_start(); (t.starts_with('=') && !t.starts_with("==")) || t.starts_with("+=") });
            (stmt.starts_with("let ") && word(target)) || assigns
        });
        !rebinds
    }

    /// Where the statement that holds the builder at `from` ends: its own `;` (so `?;` too) outside
    /// any bracket, or the bracket that closes it when it is the tail expression.
    fn statement_end(code: &str, from: usize) -> usize {
        let (mut depth, mut chars) = (0i32, code[from..].char_indices());
        while let Some((i, c)) = chars.next() {
            match c {
                '"' => {
                    while let Some((_, s)) = chars.next() {
                        if s == '\\' {
                            chars.next();
                        } else if s == '"' {
                            break;
                        }
                    }
                }
                '(' | '[' | '{' => depth += 1,
                ')' | ']' | '}' => {
                    depth -= 1;
                    if depth < 0 {
                        return from + i;
                    }
                }
                ';' if depth == 0 => return from + i,
                _ => {}
            }
        }
        code.len()
    }

    /// The builder at `at`: its own statement, plus, when it is held in a variable, the later
    /// statements of that block that name the variable (a neighbour's statements are not its own).
    fn builder_chain(code: &str, at: usize) -> String {
        let end = statement_end(code, at);
        let mut chain = code[at..end].to_string();
        let start = code[..at].rfind([';', '{', '}']).map_or(0, |i| i + 1);
        let Some(rest) = code[start..at].trim().strip_prefix("let ") else { return chain };
        let name: String = rest.trim_start_matches("mut ").chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        // A pattern (`let (a, b) = ...`) binds no one name; an empty name would match every later statement.
        if name.is_empty() {
            return chain;
        }
        let names = |s: &str| s.match_indices(&name).any(|(i, _)| !s[..i].ends_with(|c: char| c.is_alphanumeric() || c == '_') && !s[i + name.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_'));
        let mut pos = end + 1;
        while pos < code.len() {
            let stop = statement_end(code, pos);
            if names(&code[pos..stop]) {
                chain.push_str(&code[pos..stop]);
            }
            if code[stop..].starts_with([')', ']', '}']) {
                break;
            }
            pos = stop + 1;
        }
        chain
    }

    /// The builder calls in `code` (line numbers, 1-based) whose own statement sets none of
    /// `WEBVIEW_ARG_CALLS`: each one is paired on its own, not once per file and not by a neighbour.
    fn builders_without_args(code: &str) -> Vec<(usize, &'static str)> {
        let mut bad = Vec::new();
        for ctor in WEBVIEW_BUILDERS {
            for (at, _) in code.match_indices(ctor) {
                let chain = builder_chain(code, at);
                if !WEBVIEW_ARG_CALLS.iter().any(|c| chain.contains(c)) {
                    bad.push((code[..at].matches('\n').count() + 1, ctor));
                }
            }
        }
        bad.sort();
        bad
    }

    // Rows 955 / 959: every webview built on the default data folder takes its string from
    // browser_args_now, so no window can drift from the main one again. Popups reuse the opener's
    // engine (window_features) and the main window is built from the config whose string lib.rs sets.
    #[test]
    fn row955_every_top_level_webview_gets_its_browser_args_from_the_one_source() {
        let exempt = ["tools.rs"]; // built from a window config; lib.rs puts the string in the config
        let (mut seen, mut stack) = (0, vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")]);
        while let Some(dir) = stack.pop() {
            for e in fs::read_dir(&dir).unwrap().flatten() {
                let path = e.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if !name.ends_with(".rs") || name == "recovery.rs" {
                    continue;
                }
                let src = fs::read_to_string(&path).unwrap();
                let end = ["\nmod tests {", "\nmod agent_tests {"].iter().filter_map(|m| src.find(m)).min().unwrap_or(src.len());
                let code = &src[..end];
                let found = WEBVIEW_BUILDERS.iter().map(|c| code.matches(c).count()).sum::<usize>();
                seen += found;
                if !exempt.contains(&name.as_str()) {
                    let mut bad = builders_without_args(code);
                    // The tab's builder reaches its string through variables (launch -> tab_setup -> args), so
                    // this one builder is vouched for by those links in order inside browser_open, not by the file containing them.
                    bad.retain(|(line, ctor)| !(name == "browser.rs" && *ctor == "WebviewBuilder::new(" && code.lines().nth(line - 1).is_some_and(|l| l.contains("with_profile(")) && tab_builder_vouched(code, *line)));
                    assert!(bad.is_empty(), "{name} builds a webview without browser arguments, a data folder or window features: {bad:?}");
                }
            }
        }
        assert!(seen >= 4, "the scan found the window builders: {seen}");
    }

    // Row 955 LOW: the scan pairs each builder with its own browser-argument call, so a second,
    // argless builder in a file whose first builder is fine is still found.
    #[test]
    fn row955_the_scan_pairs_each_builder_not_each_file() {
        let fixture = r#"
fn a(app: &App) { WebviewWindowBuilder::new(app, "a", url).additional_browser_args(&browser_args_now()).title("a").build().unwrap(); }
fn b(app: &App) {
    WebviewWindowBuilder::new(app, "b", url).title("b").build().unwrap();
}
fn c(w: &Window) { let c = WebviewBuilder::new("c", url).zoom_hotkeys_enabled(false); w.add_child(c, pos, size); }
fn d(app: &App) { let d = WebviewBuilder::new("d", url).data_directory(dir); w.add_child(d, pos, size); }
fn e(app: &App) { WebviewWindow::builder(app, "e", url).build(); Webview::builder("f", url).window_features(f); WebviewWindowBuilder::from_config(app, cfg).unwrap().build(); }
"#;
        let bad = builders_without_args(fixture);
        assert_eq!(
            bad,
            vec![(4, "WebviewWindowBuilder::new("), (6, "WebviewBuilder::new("), (8, "WebviewWindow::builder("), (8, "WebviewWindowBuilder::from_config(")],
            "the argless builders are found one by one, the paired ones are not"
        );
    }

    // Row 954c: a builder held in a variable ends at its own statement, so a neighbour's arguments
    // after it cannot pay for it; and a hardcoded string is not the one source.
    #[test]
    fn row954c_a_builder_is_judged_by_its_own_statement() {
        let fixture = r#"
fn a(app: &App) {
    let w = WebviewWindowBuilder::new(app, "a", url).title("a");
    let ok = WebviewWindowBuilder::new(app, "b", url).additional_browser_args(&browser_args_now()).build()?;
    w.build()?;
}
fn b(app: &App) { WebviewWindowBuilder::new(app, "c", url).additional_browser_args("--disable-web-security").build()?; }
fn c(app: &App) { WebviewWindowBuilder::new(app, "d; e", url).additional_browser_args(&browser_args_now()).on_page_load(|w, _| { w.eval("x;"); }).build()?; }
fn d(app: &App) -> R { WebviewWindowBuilder::new(app, "f", url) }
"#;
        let bad = builders_without_args(fixture);
        assert_eq!(bad.iter().map(|b| b.0).collect::<Vec<_>>(), vec![3, 7, 9], "the argless variable, the hardcoded string and the tail builder are found; the quoted and closure semicolons are not statement ends");
    }

    // Row 954d (N3): a destructuring `let (a, b) = ...` binds no single name, so the builder is
    // judged by its own statement; an empty name used to match every later statement.
    #[test]
    fn row954d_a_destructured_builder_is_judged_by_its_own_statement() {
        let fixture = r#"
fn a(app: &App) {
    let (w, n) = (WebviewWindowBuilder::new(app, "a", url).title("a"), 1);
    other.additional_browser_args(&browser_args_now());
    w.build()?;
}
fn b(app: &App) {
    let [w] = [WebviewBuilder::new("b", url)];
    w.data_directory(dir);
}
fn c(app: &App) {
    let w = WebviewWindowBuilder::new(app, "c", url);
    w.additional_browser_args(&browser_args_now()).build()?;
}
"#;
        let bad = builders_without_args(fixture);
        assert_eq!(bad.iter().map(|b| b.0).collect::<Vec<_>>(), vec![3, 8], "both destructured builders are found; the named one is still paid for by its own later call");
    }

    const BROWSER_FIXTURE: &str = r#"
pub async fn browser_open(app: AppHandle) -> Result<(), String> {
    let (builder, spoof, folder) = with_profile(WebviewBuilder::new(label(id), url), id, profile, true, &key);
    let launch = crate::resources::recovery::browser_args_now();
    let setup = proxy::tab_setup(&launch, &folder, saved.as_ref());
    let (args, url_proxy) = setup?;
    let builder = builder
        .additional_browser_args(&args)
        .focused(false);
    Ok(())
}

fn elsewhere() {
    let launch = crate::resources::recovery::browser_args_now();
    let setup = proxy::tab_setup(&launch, &f, None);
    let (args, p) = setup?;
    b.additional_browser_args(&args);
}
"#;

    // Row 954d: the tab builder's three links must sit in order inside browser_open itself.
    #[test]
    fn row954d_the_tab_builders_links_must_be_in_order_inside_browser_open() {
        assert!(tab_builder_vouched(BROWSER_FIXTURE, 3), "the good shape passes");
        let before_builder = |extra: &str| BROWSER_FIXTURE.replace("    let builder = builder", &format!("    {extra}
    let builder = builder"));
        assert!(!tab_builder_vouched(&before_builder("let args = \"--x\".to_string();"), 3), "a later hardcoded args string fails");
        assert!(!tab_builder_vouched(&before_builder("args = \"--x\".to_string();"), 3), "reassigning args fails");
        assert!(!tab_builder_vouched(&before_builder("let (args, _) = (String::new(), 1);"), 3), "shadowing args in a pattern fails");
        assert!(tab_builder_vouched(&before_builder("let shown = format!(\"{args}\");"), 3), "reading args is not rebinding it");
        let (l, s) = ("    let launch = crate::resources::recovery::browser_args_now();", "    let setup = proxy::tab_setup(&launch, &folder, saved.as_ref());");
        let swapped = BROWSER_FIXTURE.replace(&format!("{l}
{s}"), &format!("{s}
{l}"));
        assert!(!tab_builder_vouched(&swapped, 3), "links out of order fail");
        assert!(!tab_builder_vouched(BROWSER_FIXTURE, 14), "links in another function do not vouch for a builder there");
        let gone = BROWSER_FIXTURE.replace("pub async fn browser_open(", "pub async fn browser_open_two(");
        assert!(!tab_builder_vouched(&gone, 3), "no browser_open, no vouch");
    }
}
