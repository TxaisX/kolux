//! The start-up timeline, and the start-up checks done beside the window.
//!
//! On Windows the page's files and its calls are served from the window's thread, and that thread
//! is busy with the setup body until it returns, so how long the body holds it is part of how long
//! the window stays empty. Nobody can time that on the owner's PC except the app itself: `mark`
//! notes how long after the process started each step finished, and `startup_report` writes the
//! marks, with the page's own, as ONE line of the diagnostics log:
//!
//! `startup (ms since process start): claimed=2.1 moved=2.3 ... setup=640.3 report=1830.0 | page (ms since page start): shown=1250.5 sent=1290.0`
//!
//! Rust marks come in time order. The page's come in name order with its own clock (its
//! `performance.now()`); a page that sends `sent` (its clock when it called) lets the reader line
//! the two up: the page started at about `report - sent` on the Rust clock. When no page reports
//! within `FALLBACK`, the line is written with `| page: none`, so a start that never got a page
//! still leaves its timeline. Either way a start writes the line once; later calls are ignored.
//!
//! `beside` / `joined` run start-up work on a thread of its own while the window is built, and turn
//! a panic there into an error the setup body returns, so it takes the same start-up failure road
//! as any other setup error (a native message and a logged exit), never a hang or a silent start.
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

static START: OnceLock<Instant> = OnceLock::new();
/// (name, microseconds since START). A start sets about a dozen.
static MARKS: Mutex<Vec<(&'static str, u64)>> = Mutex::new(Vec::new());
static REPORTED: AtomicBool = AtomicBool::new(false);

/// How long a start waits for the page's report before writing the Rust marks alone (the
/// interface watch's own first-load allowance).
pub const FALLBACK: Duration = crate::resources::recovery::FIRST_LOAD;
/// The most page marks one line carries, and the longest name kept.
const PAGE_MAX: usize = 32;
const NAME_MAX: usize = 40;

/// The process's start: called first thing in `run()`. Later calls change nothing.
pub fn begin() {
    START.get_or_init(Instant::now);
}

fn since_start() -> u64 {
    START.get_or_init(Instant::now).elapsed().as_micros().min(u128::from(u64::MAX)) as u64
}

/// Notes that the step `name` finished now. Cheap; safe from any thread.
pub fn mark(name: &'static str) {
    let at = since_start();
    if let Ok(mut m) = MARKS.lock() {
        if m.capacity() == 0 {
            m.reserve(16);
        }
        m.push((name, at));
    }
}

fn ms(micros: u64) -> String {
    format!("{}.{}", micros / 1000, (micros % 1000) / 100)
}

/// Whether a page mark's name goes in the line as it is: short, and nothing that could break the
/// line or the `name=value` reading (letters, digits, `_`, `-`, `.`).
fn plain_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= NAME_MAX && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

/// The log line for `rust` marks (any order; written in time order) and the page's (`None`: no
/// page reported). Page marks with an odd name or a value that is not a finite number are left out
/// and counted.
pub fn line(rust: &[(&str, u64)], page: Option<&BTreeMap<String, f64>>) -> String {
    let mut rust: Vec<_> = rust.to_vec();
    rust.sort_by_key(|(_, at)| *at);
    let mut s = String::with_capacity(64 + 16 * rust.len());
    s.push_str("startup (ms since process start):");
    for (name, at) in &rust {
        s.push_str(&format!(" {name}={}", ms(*at)));
    }
    let Some(page) = page else {
        s.push_str(" | page: none");
        return s;
    };
    s.push_str(" | page (ms since page start):");
    let mut left_out = 0;
    let mut kept = 0;
    for (name, value) in page {
        if kept >= PAGE_MAX || !plain_name(name) || !value.is_finite() {
            left_out += 1;
            continue;
        }
        kept += 1;
        s.push_str(&format!(" {name}={value:.1}"));
    }
    if left_out > 0 {
        s.push_str(&format!(" (left out: {left_out})"));
    }
    s
}

/// Takes the one report a start writes: true for the first caller only.
fn first_report() -> bool {
    !REPORTED.swap(true, Ordering::SeqCst)
}

fn marks_now() -> Vec<(&'static str, u64)> {
    MARKS.lock().map(|m| m.clone()).unwrap_or_default()
}

/// The page hands over its start-up marks (ms on its own clock, by name); the line goes to the
/// diagnostics log once per start. True when this call wrote it, false when a line was already
/// written (a reload, or the fallback). Off the window's thread: it appends to a file.
#[tauri::command(async)]
pub fn startup_report(app: tauri::AppHandle, page: BTreeMap<String, f64>) -> bool {
    mark("report");
    if !first_report() {
        return false;
    }
    if let Ok(dir) = tauri::Manager::path(&app).app_data_dir() {
        crate::diag::write(&dir, &line(&marks_now(), Some(&page)));
    }
    true
}

/// The backstop for a start whose page never reports: after `FALLBACK`, the Rust marks alone.
pub fn report_later(dir: &Path) {
    let dir = dir.to_path_buf();
    let _ = std::thread::Builder::new().name("startup-report".into()).spawn(move || {
        std::thread::sleep(FALLBACK);
        if first_report() {
            crate::diag::write(&dir, &line(&marks_now(), None));
        }
    });
}

/// Starts `work` on a thread of its own named `name`. A thread that cannot be started is an error,
/// as it would be for the setup body itself.
pub fn beside<T: Send + 'static>(name: &str, work: impl FnOnce() -> T + Send + 'static) -> Result<JoinHandle<T>, String> {
    std::thread::Builder::new().name(name.to_string()).spawn(work).map_err(|e| format!("the start-up checks could not be started: {e}"))
}

/// Waits for work started by `beside`. A panic in it becomes an error naming what it said.
pub fn joined<T>(handle: JoinHandle<T>) -> Result<T, String> {
    handle.join().map_err(|p| {
        let said = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "no message".to_string());
        format!("the start-up checks stopped: {said}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_marks_come_in_time_order_and_the_page_ones_by_name() {
        let mut page = BTreeMap::new();
        page.insert("shown".to_string(), 1250.54);
        page.insert("sent".to_string(), 1290.0);
        let l = line(&[("setup", 640_300), ("claimed", 2_100), ("window", 512_000)], Some(&page));
        assert_eq!(l, "startup (ms since process start): claimed=2.1 window=512.0 setup=640.3 | page (ms since page start): sent=1290.0 shown=1250.5");
    }

    #[test]
    fn the_line_parses_back_into_its_marks() {
        let mut page = BTreeMap::new();
        page.insert("shown".to_string(), 99.0);
        let l = line(&[("window", 1_000), ("store", 2_500)], Some(&page));
        assert!(!l.contains('\n'));
        let (rust, page) = l.split_once(" | ").unwrap();
        let pairs = |s: &str| s.split(' ').filter_map(|w| w.split_once('=')).map(|(k, v)| (k.to_string(), v.parse::<f64>().unwrap())).collect::<Vec<_>>();
        assert_eq!(pairs(rust), vec![("window".to_string(), 1.0), ("store".to_string(), 2.5)]);
        assert_eq!(pairs(page), vec![("shown".to_string(), 99.0)]);
    }

    #[test]
    fn page_marks_that_could_break_the_line_are_left_out_and_counted() {
        let mut page = BTreeMap::new();
        page.insert("ok".to_string(), 1.0);
        page.insert("two\nlines".to_string(), 2.0);
        page.insert("a=b".to_string(), 3.0);
        page.insert("x".repeat(NAME_MAX + 1), 4.0);
        page.insert("nan".to_string(), f64::NAN);
        page.insert("inf".to_string(), f64::INFINITY);
        let l = line(&[], Some(&page));
        assert_eq!(l, "startup (ms since process start): | page (ms since page start): ok=1.0 (left out: 5)");
        let many: BTreeMap<String, f64> = (0..PAGE_MAX + 3).map(|i| (format!("m{i:02}"), i as f64)).collect();
        assert!(line(&[], Some(&many)).ends_with("(left out: 3)"));
    }

    #[test]
    fn a_start_without_a_page_report_says_so() {
        assert_eq!(line(&[("setup", 5_000)], None), "startup (ms since process start): setup=5.0 | page: none");
    }

    #[test]
    fn marks_are_ordered_and_the_report_is_written_once() {
        begin();
        mark("test-a");
        mark("test-b");
        let m = marks_now();
        let a = m.iter().position(|(n, _)| *n == "test-a").unwrap();
        let b = m.iter().position(|(n, _)| *n == "test-b").unwrap();
        assert!(a < b && m[a].1 <= m[b].1, "a later mark never reads earlier: {m:?}");
        // One line per start, whoever asks first (the page, a reload, the fallback).
        let _ = first_report();
        assert!(!first_report() && !first_report(), "later reports are ignored");
    }

    #[test]
    fn a_panic_beside_the_window_becomes_a_start_up_error_not_a_hang() {
        let ok = beside("test-ok", || 41 + 1).unwrap();
        assert_eq!(joined(ok), Ok(42));
        let text = beside("test-panic", || -> u8 { panic!("state.db could not be read") }).unwrap();
        assert_eq!(joined(text), Err("the start-up checks stopped: state.db could not be read".to_string()));
        let formatted = beside("test-panic-fmt", || -> u8 { panic!("step {} failed", 3) }).unwrap();
        assert_eq!(joined(formatted), Err("the start-up checks stopped: step 3 failed".to_string()));
    }

    #[test]
    fn an_error_from_the_work_comes_back_as_it_was() {
        let h = beside("test-err", || -> Result<u8, String> { Err("disk gone".into()) }).unwrap();
        assert_eq!(joined(h), Ok(Err("disk gone".to_string())));
    }
}
