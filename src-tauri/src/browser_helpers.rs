//! T-283 (BROW-043): leftover browser helper processes are cleaned up.
//!
//! The helpers are the engine's own browser processes behind the app's pages. Each one is recorded
//! when a page opens, with the moment the system says it started, its program file and the app
//! run that owns it (the app's own process id and start moment), in a small file in the profile
//! folder. Nothing is ever chosen by program name alone:
//! - at start, a record from an earlier run is closed only when that run is gone (its owner no
//!   longer runs, or its id now belongs to a later process) AND the recorded process still runs
//!   with the same start moment and program file; records this run owns are left alone;
//! - at quit, the helpers this run recorded are stopped, again only while their start moment
//!   still matches (a reused process id is never touched).
//!
//! The start-up sweep runs on its own thread, so a listing that hangs or fails never holds up
//! start-up, and one failed close does not stop the rest. Setting the environment variable named
//! in `SWEEP_OFF_VAR` to an explicit on-value (1, true, yes, on) switches the sweep off; any other
//! value still sweeps. No helper here has an idle time-out of its own (the engine's processes live
//! as long as their pages), so none can cut a command short.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, OnceLock};

pub const SWEEP_OFF_VAR: &str = "KOLUX_NO_HELPER_SWEEP";
const FILE: &str = "browser-helpers.json";

/// One recorded helper: its process id, the system's start moment for it, its program file, and
/// the owning app run's process id and start moment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Helper {
    pub pid: u32,
    pub started: u64,
    pub image: String,
    pub owner: u32,
    pub owner_started: u64,
}

/// A running process as the system shows it now.
#[derive(Clone, Debug, PartialEq)]
pub struct Seen {
    pub started: u64,
    pub image: String,
}

/// Whether `value` (the sweep switch's value) is an explicit on-value that switches the sweep off.
pub fn sweep_off(value: Option<&str>) -> bool {
    value.is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

/// Whether a record still names the very process it recorded (same start moment, same program
/// file name), not a later process that got its id.
fn same_process(r_started: u64, r_image: &str, seen: &Seen) -> bool {
    let name = |p: &str| p.rsplit(['\\', '/']).next().unwrap_or(p).to_ascii_lowercase();
    seen.started == r_started && name(&seen.image) == name(r_image)
}

/// The run a record belongs to is still going: its owner process runs with the recorded start.
fn owner_alive(r: &Helper, look: &impl Fn(u32) -> Option<Seen>) -> bool {
    look(r.owner).is_some_and(|s| s.started == r.owner_started)
}

/// The process ids to close at start: records of an earlier, finished run whose process still runs
/// as recorded. `me` is this run (process id, start moment); `look` reads one process (None when it
/// does not run or cannot be read, which closes nothing).
pub fn to_close(records: &[Helper], me: (u32, u64), look: impl Fn(u32) -> Option<Seen>) -> Vec<u32> {
    records
        .iter()
        .filter(|r| (r.owner, r.owner_started) != me)
        .filter(|r| !owner_alive(r, &look))
        .filter(|r| look(r.pid).is_some_and(|s| same_process(r.started, &r.image, &s)))
        .map(|r| r.pid)
        .collect()
}

/// The records to keep after the sweep: another run that still goes keeps its own.
pub fn kept(records: &[Helper], me: (u32, u64), look: impl Fn(u32) -> Option<Seen>) -> Vec<Helper> {
    records.iter().filter(|r| (r.owner, r.owner_started) != me && owner_alive(r, &look)).cloned().collect()
}

/// The process ids to stop at quit: this run's helpers that still run as recorded.
pub fn to_stop(mine: &[Helper], look: impl Fn(u32) -> Option<Seen>) -> Vec<u32> {
    mine.iter().filter(|h| look(h.pid).is_some_and(|s| same_process(h.started, &h.image, &s))).map(|h| h.pid).collect()
}

static DIR: OnceLock<PathBuf> = OnceLock::new();
static SWEPT: OnceLock<()> = OnceLock::new();
/// This run's helpers, and other live runs' records kept through the sweep.
static MINE: LazyLock<Mutex<Vec<Helper>>> = LazyLock::new(Mutex::default);
static OTHERS: LazyLock<Mutex<Vec<Helper>>> = LazyLock::new(Mutex::default);

fn me() -> (u32, u64) {
    let pid = std::process::id();
    (pid, look(pid).map(|s| s.started).unwrap_or(0))
}

fn read(dir: &Path) -> Vec<Helper> {
    std::fs::read(dir.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn persist() {
    let Some(dir) = DIR.get() else { return };
    let mut all = OTHERS.lock().map(|o| o.clone()).unwrap_or_default();
    all.extend(MINE.lock().map(|m| m.clone()).unwrap_or_default());
    if let Ok(text) = serde_json::to_vec(&all) {
        let tmp = dir.join(format!("{FILE}.tmp"));
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, dir.join(FILE));
        }
    }
}

/// Once per run: remembers the profile folder and, unless switched off, closes an earlier run's
/// leftover helpers on a thread of its own. Later calls do nothing.
pub fn sweep_at_start(dir: &Path) {
    let dir = dir.to_path_buf();
    SWEPT.get_or_init(move || {
        let _ = DIR.set(dir.clone());
        let off = sweep_off(crate::env_name::var(SWEEP_OFF_VAR).as_deref());
        let _ = std::thread::Builder::new().name("browser-helper-sweep".into()).spawn(move || {
            let records = read(&dir);
            let me = me();
            let keep = if off {
                records.into_iter().filter(|r| (r.owner, r.owner_started) != me).collect()
            } else {
                // A helper this run already took over (the engine reuses a live one) is never closed.
                let ours: Vec<u32> = MINE.lock().map(|m| m.iter().map(|h| h.pid).collect()).unwrap_or_default();
                for pid in to_close(&records, me, look).into_iter().filter(|p| !ours.contains(p)) {
                    crate::procs::kill_tree(pid); // one failed close does not stop the rest
                }
                kept(&records, me, look)
            };
            if let Ok(mut o) = OTHERS.lock() {
                *o = keep;
            }
            persist();
        });
    });
}

/// A page's engine runs in helper `pid`: recorded for this run (once per process).
pub fn record(pid: u32) {
    std::thread::spawn(move || {
        let Some(seen) = look(pid) else { return };
        let (owner, owner_started) = me();
        if let Ok(mut m) = MINE.lock() {
            if m.iter().any(|h| h.pid == pid && h.started == seen.started) {
                return;
            }
            m.push(Helper { pid, started: seen.started, image: seen.image, owner, owner_started });
        }
        persist();
    });
}

/// At quit: stops this run's helpers that still run as recorded, and clears the record.
pub fn stop_all() {
    super::crash::quitting(); // T-286-b: engine exits from here on are the app's own shutdown
    let mine = MINE.lock().map(|mut m| std::mem::take(&mut *m)).unwrap_or_default();
    for pid in to_stop(&mine, look) {
        crate::procs::kill_tree(pid);
    }
    persist();
}

/// One process as the system shows it: its start moment and program file.
#[cfg(windows)]
fn look(pid: u32) -> Option<Seen> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is checked before use and closed once; the buffers are sized as passed.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
        let timed = GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let named = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(h);
        // A process that has ended but whose handle lingers has an exit time; it does not run.
        let ended = exited.dwLowDateTime != 0 || exited.dwHighDateTime != 0;
        (timed && named && !ended).then(|| Seen {
            started: ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
            image: String::from_utf16_lossy(&buf[..len as usize]),
        })
    }
}

#[cfg(not(windows))]
fn look(_pid: u32) -> Option<Seen> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const ME: (u32, u64) = (10, 1000);
    const WV: &str = "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\msedgewebview2.exe";

    fn h(pid: u32, started: u64, owner: u32, owner_started: u64) -> Helper {
        Helper { pid, started, image: WV.into(), owner, owner_started }
    }

    fn system(procs: &[(u32, u64, &str)]) -> impl Fn(u32) -> Option<Seen> {
        let m: HashMap<u32, Seen> = procs.iter().map(|(p, s, i)| (*p, Seen { started: *s, image: i.to_string() })).collect();
        move |pid| m.get(&pid).cloned()
    }

    // Kill Kolux while a tab is open, relaunch: the crashed run's helper still runs as recorded and
    // its owner is gone, so it is closed.
    #[test]
    fn brow043_a_crashed_runs_helper_is_closed_at_start() {
        let records = [h(500, 77, 9, 900)];
        let look = system(&[(10, 1000, "kolux.exe"), (500, 77, "msedgewebview2.exe")]);
        assert_eq!(to_close(&records, ME, look), vec![500]);
    }

    // Only the recorded process: a reused id (another start moment or another program) is never
    // touched, and a helper that already ended is left alone.
    #[test]
    fn brow043_a_reused_or_ended_id_is_never_closed() {
        let records = [h(500, 77, 9, 900), h(501, 78, 9, 900), h(502, 79, 9, 900)];
        let look = system(&[(500, 99, "msedgewebview2.exe"), (501, 78, "notepad.exe")]);
        assert!(to_close(&records, ME, look).is_empty());
    }

    // This run's own helpers, and those of another Kolux run that still goes, are left alone.
    #[test]
    fn brow043_this_runs_and_a_live_runs_helpers_are_left_alone() {
        let records = [h(500, 77, ME.0, ME.1), h(600, 88, 20, 2000)];
        let look = system(&[(500, 77, WV), (600, 88, WV), (20, 2000, "kolux.exe")]);
        assert!(to_close(&records, ME, &look).is_empty());
        assert_eq!(kept(&records, ME, &look), vec![h(600, 88, 20, 2000)], "the live run keeps its record");
        // The other run's id now belongs to a later process: that run is gone, its helper closes.
        let look = system(&[(600, 88, WV), (20, 5555, "something.exe")]);
        assert_eq!(to_close(&records, ME, &look), vec![600]);
        assert!(kept(&records, ME, &look).is_empty());
    }

    // A listing that cannot read a process closes nothing for it; the rest still close.
    #[test]
    fn brow043_an_unreadable_process_does_not_stop_the_rest() {
        let records = [h(500, 77, 9, 900), h(501, 78, 9, 900)];
        let look = system(&[(501, 78, WV)]);
        assert_eq!(to_close(&records, ME, look), vec![501]);
    }

    #[test]
    fn brow043_quit_stops_this_runs_helpers_that_still_run_as_recorded() {
        let mine = [h(500, 77, ME.0, ME.1), h(501, 78, ME.0, ME.1), h(502, 79, ME.0, ME.1)];
        let look = system(&[(500, 77, WV), (501, 12, WV)]);
        assert_eq!(to_stop(&mine, look), vec![500]);
    }

    #[test]
    fn brow043_only_an_explicit_on_value_switches_the_sweep_off() {
        for v in ["1", "true", "TRUE", " yes ", "on"] {
            assert!(sweep_off(Some(v)), "{v}");
        }
        for v in ["", "0", "false", "off", "no", "2", "enabled"] {
            assert!(!sweep_off(Some(v)), "{v}");
        }
        assert!(!sweep_off(None));
    }

    #[test]
    fn brow043_records_survive_the_file() {
        let dir = std::env::temp_dir().join(format!("kolux-helpers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = vec![h(500, 77, 9, 900)];
        std::fs::write(dir.join(FILE), serde_json::to_vec(&rows).unwrap()).unwrap();
        assert_eq!(read(&dir), rows);
        std::fs::write(dir.join(FILE), b"not json").unwrap();
        assert!(read(&dir).is_empty(), "a damaged file reads as no records");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The real system call reads this test process and refuses a process id nobody has.
    #[cfg(windows)]
    #[test]
    fn brow043_the_system_reads_a_running_process() {
        let me = look(std::process::id()).expect("this process runs");
        assert!(me.started > 0 && me.image.to_ascii_lowercase().ends_with(".exe"));
        assert_eq!(look(0xFFFF_FFF0), None);
    }
}
