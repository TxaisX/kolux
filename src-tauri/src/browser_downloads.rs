// T-238-b (BROW-013): a download from a page lands in the system Downloads folder under a safe
// name that never overwrites: an existing file, or one another download is still writing, gets a
// numbered suffix the way ordinary browsers add it ("report (2).pdf"), clashes ignore letter case
// on Windows and Mac, Windows device names are rewritten on Windows only, and after a bounded
// number of clashes the download fails instead of looping. The engine says only that a download
// was requested and that it finished (tauri's on_download), so progress is read from the file
// growing on disk and the total from a HEAD request when the server tells it; the pane shows both
// through the `browser-download` event. Closing the tab tears down its web view, which cancels
// its downloads; the registry marks them so and tells the pane.
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub const EVENT: &str = "browser-download";
/// A name the file takes when the page gives none or an unusable one.
pub const FALLBACK: &str = "download";
/// How many numbered names are tried before the download fails (BROW-013: bounded).
pub const MAX_CLASHES: u32 = 100;
/// How many downloads the registry keeps; past it, the oldest ended ones go (T-734: Show in folder
/// finds a row the strip still shows).
pub const KEEP: usize = 64;
/// How often the pane hears the bytes written so far.
pub const POLL: Duration = Duration::from_millis(300);
/// The engine writes a running download next to its final name under this ending.
const PARTIAL: &str = ".crdownload";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Download {
    /// The tab the download belongs to.
    pub id: u32,
    /// This download's own number, so two with one name stay apart in the pane.
    pub key: u64,
    pub url: String,
    pub name: String,
    pub path: String,
    pub received: u64,
    pub total: Option<u64>,
    pub state: State,
}

/// Windows device names; a file called "con" or "aux.txt" cannot be written there.
pub fn reserved_windows(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit() && stem.as_bytes()[3] != b'0')
}

/// A file name the page suggested, made safe: no folder parts, no control or reserved characters,
/// no trailing dots or spaces; empty or dot-only names fall back to FALLBACK; on Windows a device
/// name gets an underscore in front.
pub fn safe_name(raw: &str) -> String {
    safe_name_for(raw, cfg!(windows))
}

pub fn safe_name_for(raw: &str, windows: bool) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut name: String = last.chars().filter(|c| !c.is_control()).map(|c| if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') { '_' } else { c }).collect();
    name = name.trim().trim_end_matches(['.', ' ']).trim().to_string();
    if name.is_empty() || name.chars().all(|c| c == '.') {
        return FALLBACK.to_string();
    }
    if name.len() > 200 {
        let cut: String = name.chars().take(200).collect();
        name = cut.trim_end_matches(['.', ' ']).to_string();
    }
    if windows && reserved_windows(&name) {
        name.insert(0, '_');
    }
    name
}

/// "report.pdf" numbered 2 is "report (2).pdf"; a name without an extension gets the suffix at
/// its end.
pub fn numbered(name: &str, n: u32) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({n}).{}", &name[..dot], &name[dot + 1..]),
        _ => format!("{name} ({n})"),
    }
}

/// The key two names clash under: letter case is ignored on Windows and Mac.
pub fn clash_key(name: &str) -> String {
    clash_key_for(name, cfg!(any(windows, target_os = "macos")))
}

pub fn clash_key_for(name: &str, case_blind: bool) -> String {
    if case_blind {
        name.to_lowercase()
    } else {
        name.to_string()
    }
}

/// The first of `name`, `name (2)`, `name (3)`, ... that `taken` does not claim; an error after
/// MAX_CLASHES tries.
pub fn unique_name(name: &str, taken: impl Fn(&str) -> bool) -> Result<String, String> {
    if !taken(name) {
        return Ok(name.to_string());
    }
    for n in 2..=MAX_CLASHES + 1 {
        let candidate = numbered(name, n);
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    Err(format!("{name}: {MAX_CLASHES} files with this name are already in the Downloads folder"))
}

/// The names already in the folder, under their clash keys (a partial file claims its final name).
pub fn names_in(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .map(|n| n.strip_suffix(PARTIAL).map(str::to_string).unwrap_or(n))
        .map(|n| clash_key(&n))
        .collect()
}

/// Picks the final name for a download into `dir`: safe, then unique against the folder and the
/// names other downloads are still writing (`busy`).
pub fn place(dir: &Path, suggested: &str, busy: &[String]) -> Result<PathBuf, String> {
    let name = safe_name(suggested);
    let on_disk = names_in(dir);
    let taken = |n: &str| {
        let k = clash_key(n);
        on_disk.contains(&k) || busy.contains(&k)
    };
    Ok(dir.join(unique_name(&name, taken)?))
}

/// The bytes a running download has written: the final file, or the engine's partial file next
/// to it.
pub fn written(path: &Path) -> u64 {
    let partial = PathBuf::from(format!("{}{PARTIAL}", path.display()));
    std::fs::metadata(path).or_else(|_| std::fs::metadata(partial)).map(|m| m.len()).unwrap_or(0)
}

// ---- the live registry ----

static DOWNLOADS: Mutex<Vec<Download>> = Mutex::new(Vec::new());
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static POLLER: std::sync::OnceLock<()> = std::sync::OnceLock::new();

/// Whether a tab is still writing a download (BROW-013: such a page is never unloaded; the memory
/// budget's check, T-179 BROW-021).
pub fn downloading(id: u32) -> bool {
    DOWNLOADS.lock().map(|d| d.iter().any(|x| x.id == id && x.state == State::Running)).unwrap_or(false)
}

/// The names running downloads are writing, as clash keys.
fn busy_names() -> Vec<String> {
    DOWNLOADS.lock().map(|d| d.iter().filter(|x| x.state == State::Running).map(|x| clash_key(&x.name)).collect()).unwrap_or_default()
}

/// T-251 (CLI-047): how long `kolux download` waits for its click to start a download.
pub const ARM_FOR: Duration = Duration::from_secs(10);

type Arm = (u32, PathBuf, Instant);
static ARMED: Mutex<Vec<Arm>> = Mutex::new(Vec::new());

/// `kolux download`: the tab's next download goes to `path` (already placed: safe, unique, inside
/// the worktree) instead of the Downloads folder, if it starts within ARM_FOR.
pub fn arm(id: u32, path: PathBuf) {
    if let Ok(mut a) = ARMED.lock() {
        a.retain(|x| x.0 != id);
        a.push((id, path, Instant::now() + ARM_FOR));
    }
}

/// The click failed or started nothing: the tab's next download goes to the Downloads folder again.
pub fn disarm(id: u32) {
    if let Ok(mut a) = ARMED.lock() {
        a.retain(|x| x.0 != id);
    }
}

/// The tab's armed path, once: stale arms are dropped first. Pure, so it is tested.
pub fn take_armed(arms: &mut Vec<Arm>, id: u32, now: Instant) -> Option<PathBuf> {
    arms.retain(|x| x.2 > now);
    let i = arms.iter().position(|x| x.0 == id)?;
    Some(arms.remove(i).1)
}

/// Where a download written to `path` stands, and the bytes it has written.
pub fn state_of(path: &Path) -> Option<(State, u64)> {
    let p = path.display().to_string();
    DOWNLOADS.lock().ok()?.iter().rev().find(|x| x.path == p).map(|x| (x.state, x.received.max(written(path))))
}

/// A page asked to download: the registry takes the download under its final path and the pane
/// hears about it; `Err` when no safe name is free. A path `kolux download` armed wins.
pub fn requested(app: &AppHandle, id: u32, url: &str, dir: &Path, suggested: &str) -> Result<PathBuf, String> {
    let armed = ARMED.lock().ok().and_then(|mut a| take_armed(&mut a, id, Instant::now()));
    let path = match armed {
        Some(p) => p,
        None => place(dir, suggested, &busy_names())?,
    };
    let key = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let d = Download { id, key, url: url.to_string(), name, path: path.display().to_string(), received: 0, total: None, state: State::Running };
    if let Ok(mut all) = DOWNLOADS.lock() {
        make_room(&mut all);
        all.push(d.clone());
    }
    tell(app, &d);
    ask_total(app.clone(), key, url.to_string());
    start_poller(app.clone());
    Ok(path)
}

/// Past KEEP, the oldest ended downloads make way, so the registry never grows without bound.
pub fn make_room(all: &mut Vec<Download>) {
    while all.len() >= KEEP {
        match all.iter().position(|x| x.state != State::Running) {
            Some(i) => drop(all.remove(i)),
            None => break,
        }
    }
}

/// T-734 (DT-C170): the strip's Cancel. The engine stops the download and removes its partial
/// file; the row says cancelled. A download that already ended is left as it is.
#[tauri::command]
pub async fn browser_download_cancel(app: AppHandle, key: u64) -> Result<(), String> {
    let (id, path) = DOWNLOADS.lock().map_err(|e| e.to_string())?.iter().find(|x| x.key == key && x.state == State::Running).map(|x| (x.id, x.path.clone())).ok_or("the download is not running")?;
    let view = super::view(&app, id)?;
    let found = tauri::async_runtime::spawn_blocking(move || super::engine::cancel_download(&view, id, path, Duration::from_secs(5))).await.map_err(|e| e.to_string())??;
    if !found {
        return Err("the download already ended".into());
    }
    // the engine may have said "failed" for the cancel already; the row says what the user did
    let d = DOWNLOADS.lock().ok().and_then(|mut all| {
        let d = all.iter_mut().find(|x| x.key == key && matches!(x.state, State::Running | State::Failed))?;
        d.state = State::Cancelled;
        Some(d.clone())
    });
    if let Some(d) = d {
        tell(&app, &d);
    }
    Ok(())
}

/// T-734 (DT-C170): the strip's Show in folder. The file manager opens on a finished download,
/// chosen by its key, so the pane reaches no other path.
#[tauri::command]
pub fn browser_download_reveal(key: u64) -> Result<(), String> {
    let path = DOWNLOADS.lock().map_err(|e| e.to_string())?.iter().find(|x| x.key == key && x.state == State::Done).map(|x| x.path.clone()).ok_or("that download is no longer known; open the Downloads folder")?;
    crate::links::reveal(Path::new(&path))
}

/// A tab's download changed: told to its pane, or held for it while the pane is being built (after-list 719).
fn tell(app: &AppHandle, d: &Download) {
    if let Ok(v) = serde_json::to_value(d) {
        crate::browser::notices::send(app, d.id, EVENT, v, Some(format!("d{}", d.key)));
    }
}

/// A download the registry could not place (no free name, no Downloads folder): the pane shows
/// it failed, with the reason as its name line.
pub fn refused(app: &AppHandle, id: u32, url: &str, suggested: &str, why: &str) {
    let key = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = Download { id, key, url: url.to_string(), name: safe_name(suggested), path: why.to_string(), received: 0, total: None, state: State::Failed };
    if let Ok(mut all) = DOWNLOADS.lock() {
        all.push(d.clone());
    }
    tell(app, &d);
}

/// The size a HEAD answer gives a download: a success's non-zero Content-Length only (a redirect
/// the near client stopped at, or an error page, says nothing about the file).
pub fn total_of(a: &super::Answer) -> Option<u64> {
    (200..300).contains(&a.status).then_some(a.length).flatten().filter(|t| *t > 0)
}

/// The server's Content-Length from a HEAD request, when it answers one; nothing else is read. The
/// request goes through the approved clients (APP-070): the near one for an address on this
/// machine or the local network, the public-only one otherwise.
fn ask_total(app: AppHandle, key: u64, url: String) {
    tauri::async_runtime::spawn(async move {
        let Ok(at) = super::parse(&url) else { return };
        let Ok(answer) = super::head(&app, &at, super::local_host(&at), Duration::from_secs(8)).await else { return };
        if let Some(total) = total_of(&answer) {
            let changed = DOWNLOADS.lock().ok().and_then(|mut all| {
                let d = all.iter_mut().find(|x| x.key == key)?;
                d.total = Some(total);
                Some(d.clone())
            });
            if let Some(d) = changed {
                tell(&app, &d);
            }
        }
    });
}

/// One thread for all downloads: every POLL it reads what each running one has written and tells
/// the pane when the number moved. It ends itself when nothing runs.
fn start_poller(app: AppHandle) {
    if POLLER.get().is_some() {
        return;
    }
    if POLLER.set(()).is_err() {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let changed: Vec<Download> = DOWNLOADS
            .lock()
            .map(|mut all| {
                all.iter_mut()
                    .filter(|x| x.state == State::Running)
                    .filter_map(|x| {
                        let now = written(Path::new(&x.path));
                        (now != x.received).then(|| {
                            x.received = now;
                            x.clone()
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        for d in changed {
            tell(&app, &d);
        }
    });
}

/// The engine says a download ended (BROW-013: the notice that it has finished).
pub fn finished(app: &AppHandle, id: u32, url: &str, path: Option<&Path>, success: bool) {
    let done = DOWNLOADS.lock().ok().and_then(|mut all| {
        let d = all.iter_mut().rev().find(|x| x.id == id && x.state == State::Running && (path.is_none_or(|p| p.display().to_string() == x.path) || x.url == url))?;
        d.state = if success { State::Done } else { State::Failed };
        if success {
            d.received = written(Path::new(&d.path)).max(d.received);
            if d.total.is_none() {
                d.total = Some(d.received);
            }
        }
        Some(d.clone())
    });
    if let Some(d) = done {
        tell(app, &d);
    }
}

/// The tab closed: its running downloads are cancelled with its web view.
pub fn cancel_tab(app: &AppHandle, id: u32) {
    let cancelled: Vec<Download> = DOWNLOADS
        .lock()
        .map(|mut all| {
            all.iter_mut()
                .filter(|x| x.id == id && x.state == State::Running)
                .map(|x| {
                    x.state = State::Cancelled;
                    x.clone()
                })
                .collect()
        })
        .unwrap_or_default();
    for d in cancelled {
        tell(app, &d);
    }
    if let Ok(mut all) = DOWNLOADS.lock() {
        all.retain(|x| x.id != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe_and_empty_ones_fall_back() {
        assert_eq!(safe_name_for("report.pdf", true), "report.pdf");
        assert_eq!(safe_name_for("../../etc/passwd", true), "passwd");
        assert_eq!(safe_name_for("C:\\x\\y\\z.txt", true), "z.txt");
        assert_eq!(safe_name_for("a<b>c:d\"e|f?g*h.txt", true), "a_b_c_d_e_f_g_h.txt");
        assert_eq!(safe_name_for("  trailing.  ", true), "trailing");
        assert_eq!(safe_name_for("", true), FALLBACK);
        assert_eq!(safe_name_for("...", true), FALLBACK);
        assert_eq!(safe_name_for("ctl\u{7}\u{1}.bin", true), "ctl.bin");
        assert_eq!(safe_name_for(&"x".repeat(300), true).len(), 200);
    }

    #[test]
    fn windows_device_names_are_rewritten_on_windows_only() {
        assert!(reserved_windows("CON"));
        assert!(reserved_windows("aux.txt"));
        assert!(reserved_windows("com1"));
        assert!(reserved_windows("LPT9.log"));
        assert!(!reserved_windows("COM0"));
        assert!(!reserved_windows("console"));
        assert!(!reserved_windows("com10"));
        assert_eq!(safe_name_for("CON", true), "_CON");
        assert_eq!(safe_name_for("aux.txt", true), "_aux.txt");
        assert_eq!(safe_name_for("aux.txt", false), "aux.txt");
    }

    #[test]
    fn numbered_names_follow_the_browser_convention() {
        assert_eq!(numbered("report.pdf", 2), "report (2).pdf");
        assert_eq!(numbered("archive.tar.gz", 3), "archive.tar (3).gz");
        assert_eq!(numbered("README", 2), "README (2)");
        assert_eq!(numbered(".bashrc", 2), ".bashrc (2)");
    }

    #[test]
    fn second_copy_gets_a_suffix_and_the_first_is_intact() {
        // BROW-013 acceptance: download the same file twice.
        let dir = std::env::temp_dir().join(format!("kolux-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = place(&dir, "report.pdf", &[]).unwrap();
        assert_eq!(first, dir.join("report.pdf"));
        std::fs::write(&first, b"first").unwrap();
        let second = place(&dir, "report.pdf", &[]).unwrap();
        assert_eq!(second, dir.join("report (2).pdf"));
        std::fs::write(&second, b"second").unwrap();
        let third = place(&dir, "report.pdf", &[]).unwrap();
        assert_eq!(third, dir.join("report (3).pdf"));
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        // a partial file the engine is still writing claims its final name
        std::fs::write(dir.join("big.zip.crdownload"), b"").unwrap();
        assert_eq!(place(&dir, "big.zip", &[]).unwrap(), dir.join("big (2).zip"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_downloads_starting_together_under_one_name_stay_apart() {
        let dir = std::env::temp_dir().join(format!("kolux-dl2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = place(&dir, "data.csv", &[]).unwrap();
        let busy = vec![clash_key("data.csv")]; // the first is running, nothing on disk yet
        let b = place(&dir, "data.csv", &busy).unwrap();
        assert_ne!(a, b);
        assert_eq!(b, dir.join("data (2).csv"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clashes_ignore_case_where_the_file_system_does_and_stop_after_a_bound() {
        assert_eq!(clash_key_for("Report.PDF", true), "report.pdf");
        assert_eq!(clash_key_for("Report.PDF", false), "Report.PDF");
        let taken = |n: &str| clash_key_for(n, true) == "report.pdf";
        assert_eq!(unique_name("Report.PDF", taken).unwrap(), "Report (2).PDF");
        let all = |_: &str| true;
        let e = unique_name("x.bin", all).unwrap_err();
        assert!(e.contains("100"), "{e}");
        assert_eq!(unique_name("free.txt", |_| false).unwrap(), "free.txt");
    }

    #[test]
    fn written_reads_the_partial_file_until_the_final_one_exists() {
        let dir = std::env::temp_dir().join(format!("kolux-dl3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f.bin");
        assert_eq!(written(&p), 0);
        std::fs::write(dir.join("f.bin.crdownload"), [0u8; 10]).unwrap();
        assert_eq!(written(&p), 10);
        std::fs::write(&p, [0u8; 25]).unwrap();
        assert_eq!(written(&p), 25);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t734_the_registry_keeps_recent_ended_downloads_and_never_drops_a_running_one() {
        let row = |key: u64, state: State| Download { id: 1, key, url: "u".into(), name: "n".into(), path: "p".into(), received: 0, total: None, state };
        let mut all: Vec<Download> = (0..KEEP as u64).map(|k| row(k, if k == 0 { State::Running } else { State::Done })).collect();
        make_room(&mut all);
        assert_eq!(all.len(), KEEP - 1, "one ended row made way");
        assert_eq!(all[0].key, 0, "the running one stays");
        assert_eq!(all[1].key, 2, "the oldest ended one went");
        let mut busy: Vec<Download> = (0..KEEP as u64).map(|k| row(k, State::Running)).collect();
        make_room(&mut busy);
        assert_eq!(busy.len(), KEEP, "running downloads are never dropped");
        let mut few = vec![row(1, State::Done), row(2, State::Done)];
        make_room(&mut few);
        assert_eq!(few.len(), 2, "a finished row stays while there is room, so Show in folder finds it");
    }

    #[test]
    fn registry_tracks_running_downloads_per_tab() {
        let d = Download { id: 7, key: 1, url: "https://x/f".into(), name: "f".into(), path: "p".into(), received: 0, total: None, state: State::Running };
        DOWNLOADS.lock().unwrap().push(d);
        assert!(downloading(7));
        assert!(!downloading(8));
        assert_eq!(busy_names(), vec![clash_key("f")]);
        DOWNLOADS.lock().unwrap().retain(|x| x.id != 7);
        assert!(!downloading(7));
    }

    #[test]
    fn cli047_an_armed_path_is_taken_once_by_its_own_tab_and_goes_stale() {
        let now = Instant::now();
        let mut arms = vec![(1, PathBuf::from("w/a.zip"), now + ARM_FOR), (2, PathBuf::from("w/b.zip"), now + ARM_FOR), (3, PathBuf::from("w/c.zip"), now)];
        assert_eq!(take_armed(&mut arms, 9, now), None);
        assert_eq!(take_armed(&mut arms, 1, now), Some(PathBuf::from("w/a.zip")));
        assert_eq!(take_armed(&mut arms, 1, now), None, "one download per arm");
        assert_eq!(take_armed(&mut arms, 3, now), None, "a stale arm is dropped");
        assert_eq!(take_armed(&mut arms, 2, now + ARM_FOR), None, "too late");
        assert!(arms.is_empty());
    }

    #[test]
    fn app070_only_a_successful_answer_gives_the_download_a_size() {
        use super::super::Answer;
        assert_eq!(total_of(&Answer { status: 200, length: Some(5000) }), Some(5000));
        assert_eq!(total_of(&Answer { status: 206, length: Some(10) }), Some(10));
        assert_eq!(total_of(&Answer { status: 200, length: Some(0) }), None);
        assert_eq!(total_of(&Answer { status: 200, length: None }), None);
        // A redirect the near client stopped at, or an error page, says nothing about the file.
        assert_eq!(total_of(&Answer { status: 302, length: Some(150) }), None);
        assert_eq!(total_of(&Answer { status: 404, length: Some(900) }), None);
    }
}
