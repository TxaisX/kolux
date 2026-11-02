//! APP-054: the Resource Manager's figures. Memory and CPU for the app itself and for every
//! terminal session (its whole process tree), and how much memory the computer has free.

/// T-183: the recovery module (damaged state file, folder permissions, interface watch, safe
/// graphics, crash reports) lives beside the Resource Manager so this lane's own file declares it.
pub mod crashdump;
pub mod recovery;
pub mod renderer_heap;
pub mod app_proxy;
/// T-323-b: the saved proxy and the HTTP/1 switch applied to the app's own HTTP clients.
pub mod app_http;
/// T-293 (APP-030): the Windows publisher check on a downloaded update.
pub mod update_guard;
/// T-199 (APP-028, APP-029, APP-031): install records, the restart watchdog, download problems.
pub mod update_care;
/// T-547 (OD-01): the Kimi balance and MiniMax usage checks, with keys kept sealed.
pub mod provider_usage;
/// T-547: the one network client behind those checks (own address check, no redirects, 10 s, 64 KB).
pub mod provider_net;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// One process as the OS lists it: its id, its parent's id, resident memory in bytes and the CPU
/// time it has used so far, in 100 ns units. Figures stay 0 until `imp::fill` reads them.
#[derive(Clone, Copy, Debug, Default)]
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    pub bytes: u64,
    pub cpu: u64,
    /// CLI-041: committed memory in bytes (the pagefile-backed private bytes Windows charges the
    /// process); None where the OS does not report it or the process could not be opened.
    pub committed: Option<u64>,
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub bytes: u64,
    /// Percent of the whole machine (every core), 0 to 100.
    pub cpu: f64,
    pub processes: usize,
    /// CLI-041: committed bytes of the processes counted here; None when any of them could not be
    /// read (T-287-c: a partial sum would pass for the whole), or when there are none.
    pub committed: Option<u64>,
    /// T-287-c: how many of `processes` reported no committed figure (not opened, or no such figure).
    pub unreadable: usize,
}

#[derive(Serialize)]
pub struct SessionUsage {
    pub id: u32,
    /// USAGE-028: the shell's process id, so a terminal still running after a window reload is
    /// listed with its pid like any other local terminal (None once it has no process).
    pub pid: Option<u32>,
    pub dir: Option<String>,
    #[serde(flatten)]
    pub usage: Usage,
}

#[derive(Serialize)]
pub struct Resources {
    pub app: Usage,
    pub sessions: Vec<SessionUsage>,
    /// The computer's free memory by its own measure (available memory on Windows and Linux).
    pub free: Option<u64>,
    pub total: Option<u64>,
    /// T-287-c: committed bytes of the app and every session together; None when any process in
    /// them could not be read, so the total is never a partial sum shown as the whole.
    pub committed_total: Option<u64>,
    /// T-287-c: how many processes, across the app and every session, could not be read.
    pub unreadable: usize,
}

impl Resources {
    /// The rows plus their honest committed total (T-287-c).
    pub fn new(app: Usage, sessions: Vec<SessionUsage>, free: Option<u64>, total: Option<u64>) -> Resources {
        let rows = || std::iter::once(&app).chain(sessions.iter().map(|s| &s.usage));
        let unreadable = rows().map(|u| u.unreadable).sum();
        let committed_total = (unreadable == 0).then(|| rows().filter_map(|u| u.committed).sum());
        Resources { app, sessions, free, total, committed_total, unreadable }
    }
}

/// Who each process is counted under: the first session whose tree reaches it, else the app (any
/// other process under the app's own). A process, and so a subtree, is never counted twice.
pub fn owners(procs: &[Proc], roots: &[(u32, u32)], app_pid: u32) -> HashMap<u32, Option<u32>> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs.iter().filter(|p| p.pid != p.parent) {
        kids.entry(p.parent).or_default().push(p.pid);
    }
    let mut owner = HashMap::new();
    let starts = roots.iter().map(|&(id, pid)| (pid, Some(id))).chain([(app_pid, None)]);
    for (start, who) in starts {
        let mut stack = vec![start];
        while let Some(pid) = stack.pop() {
            if owner.contains_key(&pid) {
                continue;
            }
            owner.insert(pid, who);
            stack.extend(kids.get(&pid).into_iter().flatten());
        }
    }
    owner
}

/// CPU time used between two samples as a percent of the machine: clamped to its total core
/// capacity, so a bad sample never shows more than 100.
pub fn percent(used: u64, secs: f64, cores: usize) -> f64 {
    if secs <= 0.0 {
        return 0.0;
    }
    (used as f64 / 1e7 / secs / cores.max(1) as f64 * 100.0).clamp(0.0, 100.0)
}

/// The previous sample's CPU times, so the next one can say how much was used in between.
#[derive(Default)]
pub struct Sampler {
    last: Mutex<Option<(Instant, HashMap<u32, u64>)>>,
}

/// Adds the figures up per owner. `before` holds the CPU times of the last sample; a process
/// seen for the first time counts no CPU yet. `app_ws` stands in when the app's own row is missing.
pub fn total(procs: &[Proc], owner: &HashMap<u32, Option<u32>>, before: &HashMap<u32, u64>, secs: f64, cores: usize, app_pid: u32, app_ws: Option<u64>) -> (Usage, HashMap<u32, Usage>) {
    // bytes, CPU used, processes, committed of those that reported it, processes that did not.
    let mut sums: HashMap<Option<u32>, (u64, u64, usize, u64, usize)> = HashMap::new();
    for p in procs {
        if let Some(who) = owner.get(&p.pid) {
            let used = before.get(&p.pid).map_or(0, |b| p.cpu.saturating_sub(*b));
            let s = sums.entry(*who).or_default();
            *s = (s.0 + p.bytes, s.1 + used, s.2 + 1, s.3 + p.committed.unwrap_or(0), s.4 + usize::from(p.committed.is_none()));
        }
    }
    let usage = |(bytes, used, processes, committed, unreadable): (u64, u64, usize, u64, usize)| Usage {
        bytes,
        cpu: percent(used, secs, cores),
        processes,
        committed: (processes > 0 && unreadable == 0).then_some(committed),
        unreadable,
    };
    let mut app = usage(sums.remove(&None).unwrap_or_default());
    if !procs.iter().any(|p| p.pid == app_pid) {
        app.bytes += app_ws.unwrap_or(0);
    }
    (app, sums.into_iter().filter_map(|(k, v)| Some((k?, usage(v)))).collect())
}

#[tauri::command]
pub async fn resources(terminals: tauri::State<'_, crate::terminal::Terminals>, sampler: tauri::State<'_, Sampler>) -> Result<Resources, String> {
    let sessions = terminals.list();
    let app_pid = std::process::id();
    let (procs, owner) = snapshot(&sessions, app_pid);
    let now = Instant::now();
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let mut last = sampler.last.lock().unwrap_or_else(|e| e.into_inner());
    let (secs, before) = match last.take() {
        Some((at, times)) => (now.duration_since(at).as_secs_f64(), times),
        None => (0.0, HashMap::new()),
    };
    let (app, each) = total(&procs, &owner, &before, secs, cores, app_pid, crate::sysmem::working_set_bytes());
    *last = Some((now, procs.iter().filter(|p| owner.contains_key(&p.pid)).map(|p| (p.pid, p.cpu)).collect()));
    let (free, total) = imp::memory();
    Ok(Resources::new(app, rows(sessions, each), free, total))
}

/// Every process on the computer, the app's and each session's filled in, with who owns each.
fn snapshot(sessions: &[(u32, Option<u32>, Option<String>)], app_pid: u32) -> (Vec<Proc>, HashMap<u32, Option<u32>>) {
    let roots: Vec<(u32, u32)> = sessions.iter().filter_map(|(id, pid, _)| Some((*id, (*pid)?))).collect();
    let mut procs = imp::processes().unwrap_or_default();
    let owner = owners(&procs, &roots, app_pid);
    for p in procs.iter_mut().filter(|p| owner.contains_key(&p.pid)) {
        imp::fill(p);
    }
    (procs, owner)
}

/// CLI-041: the Resource Manager's memory figures as they stand now, for `kolux diagnostics
/// memory`: the same measure as the popover's, with committed beside resident. CPU stays 0 and
/// the popover's sampler is left alone, so asking from the CLI never shortens its next CPU figure.
pub fn memory_now(terminals: &crate::terminal::Terminals) -> Resources {
    let sessions = terminals.list();
    let app_pid = std::process::id();
    let (procs, owner) = snapshot(&sessions, app_pid);
    let (app, each) = total(&procs, &owner, &HashMap::new(), 0.0, 1, app_pid, crate::sysmem::working_set_bytes());
    let (free, total) = imp::memory();
    Resources::new(app, rows(sessions, each), free, total)
}

/// One row per session `Terminals::list` reports, in its order, with its pid and measured usage.
/// Every session the backend holds is listed, whether a pane shows it or it outlived a reload.
pub fn rows(sessions: Vec<(u32, Option<u32>, Option<String>)>, mut each: HashMap<u32, Usage>) -> Vec<SessionUsage> {
    sessions.into_iter().map(|(id, pid, dir)| SessionUsage { id, pid, dir, usage: each.remove(&id).unwrap_or_default() }).collect()
}

#[cfg(windows)]
mod imp {
    use super::Proc;
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    // ponytail: parent ids only, as in procs.rs; a reused pid could pull a stranger into a tree.
    // Compare creation times if a figure ever looks too big.
    pub fn processes() -> Option<Vec<Proc>> {
        // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed
        // with its size set, as Process32FirstW/NextW require, and only read after a success.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut out = Vec::new();
            let mut ok = Process32FirstW(snap, &mut entry) != 0;
            while ok {
                out.push(Proc { pid: entry.th32ProcessID, parent: entry.th32ParentProcessID, ..Proc::default() });
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            Some(out)
        }
    }

    fn ticks(t: FILETIME) -> u64 {
        (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
    }

    /// Working set and CPU time; a process that cannot be opened keeps zeros.
    pub fn fill(p: &mut Proc) {
        // SAFETY: the handle is checked before use and closed once; both out-structs are zeroed
        // and sized as the calls require, and only read after a success.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p.pid);
            if h.is_null() {
                return;
            }
            let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if K32GetProcessMemoryInfo(h, &mut c, c.cb) != 0 {
                p.bytes = c.WorkingSetSize as u64;
                p.committed = Some(c.PagefileUsage as u64);
            }
            let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
            let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
            if GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) != 0 {
                p.cpu = ticks(kernel) + ticks(user);
            }
            CloseHandle(h);
        }
    }

    /// Available and total physical memory.
    pub fn memory() -> (Option<u64>, Option<u64>) {
        // SAFETY: the struct is zeroed with dwLength set, as GlobalMemoryStatusEx requires.
        unsafe {
            let mut m: MEMORYSTATUSEX = std::mem::zeroed();
            m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut m) == 0 {
                return (None, None);
            }
            (Some(m.ullAvailPhys), Some(m.ullTotalPhys))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Proc;

    /// `ps` on Linux and macOS: pid, parent, resident KiB and cumulative CPU time.
    pub fn processes() -> Option<Vec<Proc>> {
        let out = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,rss=,time="]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        Some(
            text.lines()
                .filter_map(|l| {
                    let mut f = l.split_whitespace();
                    Some(Proc { pid: f.next()?.parse().ok()?, parent: f.next()?.parse().ok()?, bytes: f.next()?.parse::<u64>().ok()? * 1024, cpu: (seconds(f.next()?)? * 1e7) as u64, committed: None })
                })
                .collect(),
        )
    }

    /// `[[dd-]hh:]mm:ss[.ff]` as seconds.
    fn seconds(t: &str) -> Option<f64> {
        let (days, rest) = match t.split_once('-') {
            Some((d, r)) => (d.parse::<f64>().ok()?, r),
            None => (0.0, t),
        };
        rest.split(':').try_fold(0.0, |acc, part| part.parse::<f64>().ok().map(|v| acc * 60.0 + v)).map(|s| s + days * 86400.0)
    }

    pub fn fill(_: &mut Proc) {}

    /// Linux: MemAvailable and MemTotal from /proc/meminfo.
    /// ponytail: macOS reports none; its memory-pressure figure waits with T-285.
    pub fn memory() -> (Option<u64>, Option<u64>) {
        let Ok(text) = std::fs::read_to_string("/proc/meminfo") else { return (None, None) };
        let field = |name: &str| text.lines().find_map(|l| l.strip_prefix(name)).and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok()).map(|kb| kb * 1024);
        (field("MemAvailable:"), field("MemTotal:"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, bytes: u64, cpu: u64) -> Proc {
        Proc { pid, parent, bytes, cpu, committed: None }
    }

    #[test]
    fn cli041_committed_adds_up_per_tree_and_stays_unknown_where_nothing_reported_it() {
        // app 1 with its WebView 2; session 5's shell 10 runs 11; session 6's shell 20 could not be opened.
        let c = |pid, parent, bytes, committed| Proc { committed, ..p(pid, parent, bytes, 0) };
        let procs = [c(1, 0, 100, Some(300)), c(2, 1, 50, Some(70)), c(10, 1, 10, Some(4)), c(11, 10, 30, None), c(20, 1, 7, None)];
        let owner = owners(&procs, &[(5, 10), (6, 20)], 1);
        let (app, each) = total(&procs, &owner, &HashMap::new(), 0.0, 1, 1, None);
        assert_eq!((app.bytes, app.committed), (150, Some(370)));
        assert_eq!((each[&5].bytes, each[&5].committed, each[&5].unreadable), (40, None, 1), "T-287-c: one unreadable process makes its tree's figure unknown, not a partial sum");
        assert_eq!((each[&6].bytes, each[&6].committed, each[&6].unreadable), (7, None, 1), "no figure at all is unknown, not 0");
        let json = serde_json::to_value(app).unwrap();
        assert_eq!((json["bytes"].as_u64(), json["committed"].as_u64(), json["unreadable"].as_u64()), (Some(150), Some(370), Some(0)));
    }

    /// T-287-c: the committed total is the sum only when every process was read; one unreadable
    /// row makes it null and says how many could not be read. A session with no process adds nothing.
    #[test]
    fn t287c_committed_total_is_null_when_any_process_could_not_be_read() {
        let u = |committed, processes, unreadable| Usage { bytes: 1, cpu: 0.0, processes, committed, unreadable };
        let s = |id, usage| SessionUsage { id, pid: Some(id), dir: None, usage };
        let read = Resources::new(u(Some(300), 3, 0), vec![s(1, u(Some(20), 2, 0)), s(2, u(None, 0, 0))], None, None);
        assert_eq!((read.committed_total, read.unreadable), (Some(320), 0));
        // A stubbed unreadable row: session 2's tree has 2 processes, 1 of them could not be opened.
        let procs = [Proc { pid: 1, parent: 0, bytes: 100, cpu: 0, committed: Some(300) }, Proc { pid: 20, parent: 1, bytes: 9, cpu: 0, committed: Some(5) }, Proc { pid: 21, parent: 20, bytes: 3, cpu: 0, committed: None }];
        let owner = owners(&procs, &[(2, 20)], 1);
        let (app, each) = total(&procs, &owner, &HashMap::new(), 0.0, 1, 1, None);
        let r = Resources::new(app, rows(vec![(2, Some(20), None)], each), Some(10), Some(20));
        assert_eq!((r.sessions[0].usage.committed, r.sessions[0].usage.unreadable, r.sessions[0].usage.processes), (None, 1, 2));
        assert_eq!((r.app.committed, r.committed_total, r.unreadable), (Some(300), None, 1));
        let json = serde_json::to_value(&r).unwrap();
        assert!(json["committed_total"].is_null() && json["unreadable"] == 1, "{json}");
    }

    #[test]
    fn app054_each_tree_is_counted_once_and_the_rest_goes_to_the_app() {
        // app 1 runs the WebView (2) and two shells (10, 20); shell 10 runs a dev server (11) that
        // runs a child (12); session 7's root is 11, already inside session 5's tree.
        let procs = [p(1, 0, 100, 0), p(2, 1, 50, 0), p(10, 1, 10, 0), p(11, 10, 30, 0), p(12, 11, 5, 0), p(20, 1, 7, 0), p(99, 0, 1000, 0)];
        let owner = owners(&procs, &[(5, 10), (6, 20), (7, 11)], 1);
        assert_eq!(owner.get(&12), Some(&Some(5)));
        assert_eq!(owner.get(&99), None, "a stranger is nobody's");
        let (app, each) = total(&procs, &owner, &HashMap::new(), 2.0, 4, 1, Some(1));
        assert_eq!((app.bytes, app.processes), (150, 2));
        assert_eq!((each[&5].bytes, each[&5].processes), (45, 3));
        assert_eq!(each[&6].bytes, 7);
        assert!(!each.contains_key(&7), "a subtree already counted is never added twice");
        // the app's own row missing: its working set stands in
        let (app, _) = total(&procs[1..], &owner, &HashMap::new(), 2.0, 4, 1, Some(64));
        assert_eq!(app.bytes, 50 + 64);
    }

    #[test]
    fn usage028_every_session_is_listed_with_its_pid_whether_or_not_a_pane_shows_it() {
        // Session 1 outlived a window reload (no pane), session 2 was opened after it, 3 has exited.
        let procs = [p(10, 0, 100, 0), p(41, 10, 1000, 0), p(42, 10, 2000, 0)];
        let owner = owners(&procs, &[(1, 41), (2, 42)], 10);
        let (_, each) = total(&procs, &owner, &HashMap::new(), 0.0, 1, 10, None);
        let list = rows(vec![(1, Some(41), Some("C:/w".into())), (2, Some(42), None), (3, None, None)], each);
        let seen: Vec<_> = list.iter().map(|s| (s.id, s.pid, s.usage.bytes)).collect();
        assert_eq!(seen, [(1, Some(41), 1000), (2, Some(42), 2000), (3, None, 0)]);
        let json = serde_json::to_value(&list[0]).unwrap();
        assert_eq!((json["pid"].as_u64(), json["bytes"].as_u64(), json.get("remote")), (Some(41), Some(1000), None));
    }

    #[test]
    fn app054_cpu_is_a_share_of_every_core_and_never_above_it() {
        // 1 s of CPU in 2 s on 4 cores is 12.5 %
        let before = HashMap::from([(10, 0), (11, 5_000_000)]);
        let procs = [p(10, 1, 0, 5_000_000), p(11, 10, 0, 10_000_000)];
        let owner = owners(&procs, &[(5, 10)], 1);
        let (_, each) = total(&procs, &owner, &before, 2.0, 4, 1, None);
        assert_eq!(each[&5].cpu, 12.5);
        assert_eq!(percent(u64::MAX, 0.5, 8), 100.0);
        assert_eq!(percent(10, 0.0, 8), 0.0);
    }
}
