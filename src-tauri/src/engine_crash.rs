//! T-286-b (APP-040): crash records from the web engine's own process-failed event.
//!
//! The engine (WebView2) tells each view when one of its processes ends: the browser process, a
//! page's renderer, the graphics process or another helper, with a reason and an exit code where
//! the runtime gives them, and the faulting module where it names one. Only real crashes become
//! records in the app's crash store (resources::recovery, the one the startup prompt and Help >
//! Report Crash read):
//! - an exit during the app's own shutdown (including the helpers the app stops itself), a hang, a
//!   kill, a deleted profile and a process that never started are not crashes (each still leaves
//!   one diagnostics line);
//! - the app's own view's renderer ending (its interface process) is;
//! - the browser process, the graphics process outside shutdown, and any other helper ending on a
//!   crash, out of memory or for an unknown reason are crashes.
//!
//! One engine crash reaches every view that shares that process, so the same failure arriving
//! again within half a minute is merged into the first record (its view count goes up) instead of
//! adding siblings. The store keeps the newest five. Each record carries the computer's memory
//! reading taken as the engine reported the failure (physical and commit; free disk space is never
//! shown, since it proves nothing about swap) and the faulting module when the engine names one.
//!
//! Pure functions here, tested; the event glue is in webview_engine.rs.

use crate::resources::recovery::{self, Crash};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// The newest reports kept (APP-040).
pub const KEEP_REPORTS: usize = 5;
/// The same failure arriving again within this is the same crash seen from another view.
pub const SIBLING_WINDOW: Duration = Duration::from_secs(30);

// The engine's process-failed kinds and reasons (WebView2's public enum values).
pub const KIND_BROWSER: i32 = 0;
pub const KIND_RENDER: i32 = 1;
pub const KIND_RENDER_UNRESPONSIVE: i32 = 2;
pub const KIND_FRAME_RENDER: i32 = 3;
pub const KIND_UTILITY: i32 = 4;
pub const KIND_SANDBOX_HELPER: i32 = 5;
pub const KIND_GPU: i32 = 6;
pub const KIND_PPAPI_PLUGIN: i32 = 7;
pub const KIND_PPAPI_BROKER: i32 = 8;
pub const KIND_UNKNOWN: i32 = 9;
pub const REASON_UNEXPECTED: i32 = 0;
pub const REASON_UNRESPONSIVE: i32 = 1;
pub const REASON_TERMINATED: i32 = 2;
pub const REASON_CRASHED: i32 = 3;
pub const REASON_LAUNCH_FAILED: i32 = 4;
pub const REASON_OUT_OF_MEMORY: i32 = 5;
pub const REASON_PROFILE_DELETED: i32 = 6;

/// What the engine said about one process failure.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Failure {
    pub kind: i32,
    /// `None` on an engine too old to give a reason.
    pub reason: Option<i32>,
    pub exit_code: Option<i32>,
    /// The engine's own description of the process, when it gives one.
    pub process: String,
    /// The module the engine names as the failure's source, when it names one.
    pub module: String,
}

/// The computer's memory as read when the failure arrived (bytes).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Memory {
    pub phys_free: u64,
    pub phys_total: u64,
    pub commit_free: u64,
    pub commit_limit: u64,
}

/// Whether a failure is a real crash: `Ok(())` to record it, or why it is not one.
pub fn classify(f: &Failure, quitting: bool) -> Result<(), &'static str> {
    if quitting {
        return Err("an exit during the app's own shutdown");
    }
    if f.kind == KIND_RENDER_UNRESPONSIVE {
        return Err("a page stopped responding (a hang, not an exit)");
    }
    match f.reason {
        Some(REASON_TERMINATED) => return Err("the process was ended by a kill"),
        Some(REASON_UNRESPONSIVE) => return Err("the process was ended for not responding (a hang)"),
        Some(REASON_LAUNCH_FAILED) => return Err("the process never started"),
        Some(REASON_PROFILE_DELETED) => return Err("the profile folder was deleted"),
        _ => {}
    }
    Ok(())
}

pub fn process_name(kind: i32) -> &'static str {
    match kind {
        KIND_BROWSER => "browser process",
        KIND_RENDER => "interface renderer",
        KIND_FRAME_RENDER => "interface frame renderer",
        KIND_UTILITY => "utility process",
        KIND_SANDBOX_HELPER => "sandbox helper",
        KIND_GPU => "graphics process",
        KIND_PPAPI_PLUGIN => "plugin process",
        KIND_PPAPI_BROKER => "plugin broker",
        KIND_UNKNOWN => "unknown helper process",
        _ => "unlisted helper process",
    }
}

pub fn reason_name(reason: Option<i32>) -> &'static str {
    match reason {
        Some(REASON_CRASHED) => "crashed",
        Some(REASON_OUT_OF_MEMORY) => "ran out of memory",
        Some(REASON_UNEXPECTED) => "ended unexpectedly",
        Some(REASON_UNRESPONSIVE) => "stopped responding",
        Some(REASON_TERMINATED) => "was ended",
        Some(REASON_LAUNCH_FAILED) => "failed to start",
        Some(REASON_PROFILE_DELETED) => "lost its profile folder",
        _ => "ended (no reason given)",
    }
}

/// Bytes as gigabytes with one decimal.
fn gb(b: u64) -> String {
    format!("{:.1} GB", b as f64 / (1u64 << 30) as f64)
}

/// The memory part of a record; physical and commit only (free disk space is never shown).
pub fn memory_line(m: &Memory) -> String {
    let mut parts = Vec::new();
    if m.phys_total > 0 {
        parts.push(format!("{} free of {} physical", gb(m.phys_free), gb(m.phys_total)));
    }
    if m.commit_limit > 0 {
        parts.push(format!("{} free of {} commit", gb(m.commit_free), gb(m.commit_limit)));
    }
    if parts.is_empty() {
        "memory: no reading".into()
    } else {
        format!("memory when it failed: {}", parts.join(", "))
    }
}

/// The computer's memory now, as the system reports it (physical and commit).
#[cfg(windows)]
pub fn memory_now() -> Option<Memory> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    // SAFETY: `m` is a MEMORYSTATUSEX with dwLength set, as the call requires; it only fills it in.
    if unsafe { GlobalMemoryStatusEx(&mut m) } == 0 {
        return None;
    }
    Some(Memory { phys_free: m.ullAvailPhys, phys_total: m.ullTotalPhys, commit_free: m.ullAvailPageFile, commit_limit: m.ullTotalPageFile })
}

#[cfg(not(windows))]
pub fn memory_now() -> Option<Memory> {
    None
}

/// What makes two failures the same crash seen from different views.
pub fn signature(f: &Failure) -> (i32, Option<i32>, Option<i32>) {
    (f.kind, f.reason, f.exit_code)
}

/// One record's summary (scrubbed by the store before it is saved).
pub fn summary(f: &Failure, views: u32, memory: Option<&Memory>) -> String {
    let mut s = format!("The web engine's {} {}", process_name(f.kind), reason_name(f.reason));
    if let Some(code) = f.exit_code {
        s.push_str(&format!(" (exit code 0x{:08X})", code as u32));
    }
    if !f.process.is_empty() {
        s.push_str(&format!(" · process: {}", f.process));
    }
    if views > 1 {
        s.push_str(&format!(" · seen by {views} views"));
    }
    if !f.module.is_empty() {
        s.push_str(&format!(" · faulting module: {}", f.module));
    }
    s.push_str(" · ");
    s.push_str(&memory.map(memory_line).unwrap_or_else(|| "memory: no reading".into()));
    s
}

/// Adds `record` to the store's list, or (when `merge_into` names a record still there) replaces
/// that record's summary and time instead; then keeps the newest `keep`. Returns the record's id.
pub fn add_or_merge(all: &mut Vec<Crash>, record: Crash, merge_into: Option<&str>, keep: usize) -> String {
    if let Some(c) = merge_into.and_then(|id| all.iter_mut().find(|c| c.id == id)) {
        c.summary = record.summary;
        c.when = record.when;
        return c.id.clone();
    }
    let id = record.id.clone();
    all.push(record);
    if all.len() > keep {
        let extra = all.len() - keep;
        all.drain(..extra);
    }
    id
}

/// The last crash recorded, for merging its siblings: its signature, record id, when, and views.
#[derive(Debug, Clone, PartialEq)]
pub struct Last {
    pub sig: (i32, Option<i32>, Option<i32>),
    pub id: String,
    pub at: Instant,
    pub views: u32,
}

/// Whether failure `f` at `now` is a sibling of the last record: the same crash from another view.
pub fn sibling_of<'a>(last: Option<&'a Last>, f: &Failure, now: Instant) -> Option<&'a Last> {
    last.filter(|l| l.sig == signature(f) && now.saturating_duration_since(l.at) <= SIBLING_WINDOW)
}

static QUITTING: AtomicBool = AtomicBool::new(false);
static LAST: LazyLock<Mutex<Option<Last>>> = LazyLock::new(Mutex::default);

/// The app is shutting down: engine exits from here on are expected (called as the app stops its
/// browser helpers, and by the app's own quit).
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
}

pub fn is_quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// Writes the store, retrying briefly when the file is locked for a moment (Windows).
fn write_retry(dir: &Path, all: &[Crash]) -> Result<(), String> {
    let mut last = Ok(());
    for wait in [0u64, 50, 150, 400] {
        std::thread::sleep(Duration::from_millis(wait));
        last = recovery::crashes_write(dir, all);
        if last.is_ok() {
            break;
        }
    }
    last
}

/// One failure the engine reported: a diagnostics line always, and a crash record (new or merged)
/// when it is a real crash. Returns the record's id when one was written.
pub fn report(dir: &Path, f: &Failure, memory: Option<Memory>, when: u64) -> Option<String> {
    let who = "the app's view";
    if let Err(why) = classify(f, is_quitting()) {
        crate::diag::write(dir, &format!("engine {} {} in {who}: not a crash ({why}) (APP-040)", process_name(f.kind), reason_name(f.reason)));
        return None;
    }
    let now = Instant::now();
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let sib = sibling_of(last.as_ref(), f, now).cloned();
    let views = sib.as_ref().map_or(1, |l| l.views + 1);
    let text = recovery::scrub_report(&summary(f, views, memory.as_ref()));
    let mut all = recovery::crashes_read(dir);
    let record = record_of(format!("{when}-engine-{}", all.len()), when, text, f.kind);
    let id = add_or_merge(&mut all, record, sib.as_ref().map(|l| l.id.as_str()), KEEP_REPORTS);
    let saved = write_retry(dir, &all);
    *last = Some(Last { sig: signature(f), id: id.clone(), at: now, views });
    let verb = if sib.is_some() { "merged into" } else { "added as" };
    crate::diag::write(dir, &format!("engine {} {} in {who}: crash record {verb} {id}{} (APP-040)", process_name(f.kind), reason_name(f.reason), if saved.is_ok() { "" } else { " (could not be saved)" }));
    saved.ok().map(|_| id)
}

/// A new record in the store's shape (the reliability lane's fields: one process, no dump yet;
/// the memory reading and the module are already in the summary).
fn record_of(id: String, when: u64, summary: String, kind: i32) -> Crash {
    let kind = match kind {
        KIND_GPU => recovery::Kind::Graphics,
        KIND_BROWSER | KIND_RENDER | KIND_FRAME_RENDER => recovery::Kind::Interface,
        _ => recovery::Kind::Child,
    };
    Crash { id, when, summary, dismissed: false, kind, count: 1, memory: None, module: None, siblings: Vec::new(), dumps: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fail(kind: i32, reason: Option<i32>) -> Failure {
        Failure { kind, reason, exit_code: Some(-1073741819), ..Default::default() }
    }

    fn crash(id: &str) -> Crash {
        record_of(id.into(), 1, id.into(), KIND_RENDER)
    }

    // "Exits during an expected shutdown, graphics exits at quit time, and kills the app issued
    // itself are not crashes."
    #[test]
    fn t286b_shutdown_exits_and_kills_are_not_crashes() {
        for kind in [KIND_BROWSER, KIND_GPU, KIND_UTILITY, KIND_RENDER] {
            assert!(classify(&fail(kind, Some(REASON_CRASHED)), true).is_err(), "kind {kind} at quit");
        }
        assert!(classify(&fail(KIND_BROWSER, Some(REASON_TERMINATED)), false).is_err(), "a kill");
        assert!(classify(&fail(KIND_RENDER_UNRESPONSIVE, None), false).is_err(), "a hang");
        assert!(classify(&fail(KIND_RENDER, Some(REASON_UNRESPONSIVE)), false).is_err());
        assert!(classify(&fail(KIND_BROWSER, Some(REASON_LAUNCH_FAILED)), false).is_err());
        assert!(classify(&fail(KIND_BROWSER, Some(REASON_PROFILE_DELETED)), false).is_err());
    }

    // "Interface process crashes and unknown child crashes still are."
    #[test]
    fn t286b_interface_and_unknown_child_crashes_are_crashes() {
        assert_eq!(classify(&fail(KIND_RENDER, Some(REASON_CRASHED)), false), Ok(()), "the app's own interface");
        assert_eq!(classify(&fail(KIND_FRAME_RENDER, Some(REASON_OUT_OF_MEMORY)), false), Ok(()));
        for kind in [KIND_BROWSER, KIND_GPU, KIND_UTILITY, KIND_SANDBOX_HELPER, KIND_PPAPI_PLUGIN, KIND_PPAPI_BROKER, KIND_UNKNOWN] {
            for reason in [Some(REASON_CRASHED), Some(REASON_UNEXPECTED), Some(REASON_OUT_OF_MEMORY), None] {
                assert_eq!(classify(&fail(kind, reason), false), Ok(()), "kind {kind} reason {reason:?}");
            }
        }
    }

    // "Only the newest five reports are kept": the seventh crash leaves five, the newest ones.
    #[test]
    fn t286b_only_the_newest_five_are_kept() {
        let mut all = Vec::new();
        for i in 1..=7 {
            add_or_merge(&mut all, crash(&format!("c{i}")), None, KEEP_REPORTS);
        }
        let ids: Vec<&str> = all.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["c3", "c4", "c5", "c6", "c7"]);
    }

    // "Reports from the same crash are merged": one engine crash seen by three views is one record.
    #[test]
    fn t286b_the_same_crash_from_other_views_merges_into_one_record() {
        let t = Instant::now();
        let f = fail(KIND_BROWSER, Some(REASON_CRASHED));
        let last = Last { sig: signature(&f), id: "c1".into(), at: t, views: 1 };
        assert!(sibling_of(Some(&last), &f, t + Duration::from_secs(2)).is_some());
        assert!(sibling_of(Some(&last), &f, t + SIBLING_WINDOW).is_some(), "at the window's edge");
        assert!(sibling_of(Some(&last), &f, t + SIBLING_WINDOW + Duration::from_millis(1)).is_none(), "later: a new crash");
        assert!(sibling_of(Some(&last), &fail(KIND_GPU, Some(REASON_CRASHED)), t).is_none(), "another process");
        let mut other_code = f.clone();
        other_code.exit_code = Some(1);
        assert!(sibling_of(Some(&last), &other_code, t).is_none(), "another exit code");
        assert!(sibling_of(None, &f, t).is_none());

        let mut all = vec![crash("c0"), crash("c1")];
        let mut merged = crash("c9");
        merged.summary = "seen by 2 views".into();
        merged.when = 5;
        assert_eq!(add_or_merge(&mut all, merged, Some("c1"), KEEP_REPORTS), "c1");
        assert_eq!(all.len(), 2, "no sibling record");
        assert_eq!((all[1].summary.as_str(), all[1].when), ("seen by 2 views", 5));
        // The record it would merge into fell out of the store: a new record instead.
        assert_eq!(add_or_merge(&mut all, crash("c2"), Some("gone"), KEEP_REPORTS), "c2");
        assert_eq!(all.len(), 3);
    }

    // "The last host memory reading before the crash is attached, and free disk space is never
    // presented as proof that swap could have grown"; "the report names the module that faulted".
    #[test]
    fn t286b_the_record_carries_memory_and_the_faulting_module() {
        let m = Memory { phys_free: 1 << 30, phys_total: 16 << 30, commit_free: 3 << 29, commit_limit: 24 << 30 };
        assert_eq!(memory_line(&m), "memory when it failed: 1.0 GB free of 16.0 GB physical, 1.5 GB free of 24.0 GB commit");
        assert_eq!(memory_line(&Memory::default()), "memory: no reading");
        let mut f = fail(KIND_BROWSER, Some(REASON_CRASHED));
        f.module = "C:\\Windows\\System32\\bad.dll".into();
        f.process = "Browser".into();
        let s = summary(&f, 3, Some(&m));
        assert!(s.starts_with("The web engine's browser process crashed (exit code 0xC0000005)"), "{s}");
        assert!(s.contains("· process: Browser · seen by 3 views · faulting module: C:\\Windows\\System32\\bad.dll · memory when it failed: 1.0 GB"), "{s}");
        for word in ["disk", "swap could"] {
            assert!(!s.contains(word), "{word}");
        }
        let plain = summary(&Failure { kind: KIND_GPU, ..Default::default() }, 1, None);
        assert_eq!(plain, "The web engine's graphics process ended (no reason given) · memory: no reading");
    }

    // The system's own reading is there on Windows (physical and commit, never disk).
    #[cfg(windows)]
    #[test]
    fn t286b_the_memory_reading_comes_from_the_system() {
        let m = memory_now().expect("a reading");
        assert!(m.phys_total > 0 && m.phys_free <= m.phys_total, "{m:?}");
        assert!(m.commit_limit > 0 && m.commit_free <= m.commit_limit, "{m:?}");
    }

    // The store survives a damaged file (starts empty) and the record lands, scrubbed of the
    // user's folder; the same crash again merges.
    #[test]
    fn t286b_report_writes_a_scrubbed_record_and_merges_the_next_view() {
        let dir = std::env::temp_dir().join(format!("kolux-t286b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(recovery::CRASHES), b"{ damaged").unwrap();
        let mut f = fail(KIND_UTILITY, Some(REASON_CRASHED));
        f.exit_code = Some(0x7272_0286);
        f.module = "C:\\Users\\someone\\AppData\\x.dll".into();
        let id = report(&dir, &f, None, 100).expect("recorded");
        let again = report(&dir, &f, None, 101).expect("merged");
        assert_eq!(again, id);
        let all = recovery::crashes_read(&dir);
        assert_eq!(all.len(), 1, "{all:?}");
        assert!(all[0].summary.contains("seen by 2 views"), "{}", all[0].summary);
        assert!(all[0].summary.contains("<home>") && !all[0].summary.contains("someone"), "{}", all[0].summary);
        assert!(report(&dir, &fail(KIND_RENDER, Some(REASON_TERMINATED)), None, 102).is_none(), "a kill");
        assert_eq!(recovery::crashes_read(&dir).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
