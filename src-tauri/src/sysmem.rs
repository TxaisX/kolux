// How much memory Kolux itself holds right now, for the status bar. On Windows that is the private
// bytes of kolux.exe plus its whole msedgewebview2.exe tree (browser, GPU, renderer, utility,
// crashpad): the web view holds about seven eighths of it, so kolux.exe alone undercounted about 7x.
// The shells and agents in the panes are left out (the Resource Manager shows those per session).
// Elsewhere it is still this process's working set. Read straight from the OS: no crate on Windows
// or Linux; macOS reports unknown for now.

/// Bytes of the current process's working set, or `None` where it cannot be read.
pub fn working_set_bytes() -> Option<u64> {
    imp::working_set_bytes()
}

/// Bytes of physical memory the machine has, or `None` where it cannot be read (APP-022).
pub fn total_ram_bytes() -> Option<u64> {
    imp::total_ram_bytes()
}

/// `MemTotal` of /proc/meminfo, in bytes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn meminfo_total(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    kb.checked_mul(1024)
}

/// The pids of `me` and of every msedgewebview2.exe below it, from `(pid, parent pid, is web view)`
/// rows. A pane's shell is a child of `me` too but is not a web view, so it and its children (the
/// agents) are left out. A pid seen twice (a reused parent pid) is walked once.
#[cfg_attr(not(windows), allow(dead_code))]
fn host_pids(rows: &[(u32, u32, bool)], me: u32) -> Vec<u32> {
    let mut out = vec![me];
    let mut i = 0;
    while i < out.len() {
        let parent = out[i];
        for &(pid, ppid, webview) in rows {
            if webview && ppid == parent && pid != parent && !out.contains(&pid) {
                out.push(pid);
            }
        }
        i += 1;
    }
    out
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo as GetInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// Private bytes (commit) of kolux.exe plus its msedgewebview2.exe tree.
    pub fn host_private_bytes() -> Option<u64> {
        let mut rows = Vec::new();
        // SAFETY: a snapshot handle is checked before use and closed once; the entry struct carries its
        // own size, as Process32FirstW/NextW require.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut more = Process32FirstW(snap, &mut e) != 0;
            while more {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..len]);
                rows.push((e.th32ProcessID, e.th32ParentProcessID, name.eq_ignore_ascii_case("msedgewebview2.exe")));
                more = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        // SAFETY: no arguments; returns this process's id.
        let me = unsafe { GetCurrentProcessId() };
        let mut total = 0u64;
        for pid in super::host_pids(&rows, me) {
            // SAFETY: the handle is checked for null and closed; the counters struct carries its size.
            unsafe {
                let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if h.is_null() {
                    continue; // exited between the snapshot and now
                }
                let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                if GetInfo(h, &mut c, c.cb) != 0 {
                    total += c.PagefileUsage as u64;
                }
                CloseHandle(h);
            }
        }
        (total > 0).then_some(total)
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct ProcessMemoryCounters {
        cb: u32,
        PageFaultCount: u32,
        PeakWorkingSetSize: usize,
        WorkingSetSize: usize,
        QuotaPeakPagedPoolUsage: usize,
        QuotaPagedPoolUsage: usize,
        QuotaPeakNonPagedPoolUsage: usize,
        QuotaNonPagedPoolUsage: usize,
        PagefileUsage: usize,
        PeakPagefileUsage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(process: isize, counters: *mut ProcessMemoryCounters, cb: u32) -> i32;
    }

    pub fn working_set_bytes() -> Option<u64> {
        let mut c = ProcessMemoryCounters {
            cb: std::mem::size_of::<ProcessMemoryCounters>() as u32,
            PageFaultCount: 0,
            PeakWorkingSetSize: 0,
            WorkingSetSize: 0,
            QuotaPeakPagedPoolUsage: 0,
            QuotaPagedPoolUsage: 0,
            QuotaPeakNonPagedPoolUsage: 0,
            QuotaNonPagedPoolUsage: 0,
            PagefileUsage: 0,
            PeakPagefileUsage: 0,
        };
        // SAFETY: the pseudo-handle from GetCurrentProcess is always valid, the struct matches the
        // Win32 layout and `cb` carries its size, so the call writes only inside `c`.
        let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
        (ok != 0).then_some(c.WorkingSetSize as u64)
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct MemoryStatusEx {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
    }

    pub fn total_ram_bytes() -> Option<u64> {
        let mut m = MemoryStatusEx {
            dwLength: std::mem::size_of::<MemoryStatusEx>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        // SAFETY: the struct matches the Win32 layout and dwLength carries its size.
        let ok = unsafe { GlobalMemoryStatusEx(&mut m) };
        (ok != 0 && m.ullTotalPhys > 0).then_some(m.ullTotalPhys)
    }
}

#[cfg(target_os = "linux")]
mod imp {
    pub fn working_set_bytes() -> Option<u64> {
        // /proc/self/statm: size resident shared ... in pages.
        let text = std::fs::read_to_string("/proc/self/statm").ok()?;
        let resident: u64 = text.split_whitespace().nth(1)?.parse().ok()?;
        Some(resident * 4096)
    }

    pub fn total_ram_bytes() -> Option<u64> {
        super::meminfo_total(&std::fs::read_to_string("/proc/meminfo").ok()?)
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn working_set_bytes() -> Option<u64> {
        None
    }

    pub fn total_ram_bytes() -> Option<u64> {
        None
    }
}

/// The status bar's figure: on Windows the private bytes of kolux.exe and its web view processes,
/// elsewhere this process's working set. Async so the process snapshot, asked every two seconds,
/// runs off the main thread (Tauri runs plain commands on it).
#[tauri::command]
pub async fn process_memory() -> Option<u64> {
    host_memory()
}

fn host_memory() -> Option<u64> {
    #[cfg(windows)]
    {
        imp::host_private_bytes().or_else(working_set_bytes)
    }
    #[cfg(not(windows))]
    {
        working_set_bytes()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn app022_meminfo_total_is_read_in_bytes() {
        assert_eq!(super::meminfo_total("MemFree: 5 kB
MemTotal:       16384 kB
"), Some(16384 * 1024));
        assert_eq!(super::meminfo_total("MemFree: 5 kB
"), None);
        assert_eq!(super::meminfo_total("MemTotal: lots kB
"), None);
    }

    #[test]
    #[cfg(any(windows, target_os = "linux"))]
    fn app022_this_machine_reports_some_ram() {
        assert!(super::total_ram_bytes().expect("ram readable") >= 256 * 1024 * 1024);
    }

    #[test]
    fn host_pids_take_the_web_view_tree_and_leave_the_shells_out() {
        // 10 kolux; 11 web view browser -> 12 gpu, 13 renderer; 20 pwsh -> 21 claude, 22 node web view
        // under a shell; 30 an unrelated web view; a row naming 10 as its own parent must not loop.
        let rows = [(11, 10, true), (12, 11, true), (13, 11, true), (20, 10, false), (21, 20, false), (22, 20, true), (30, 1, true), (10, 10, true)];
        let mut got = super::host_pids(&rows, 10);
        got.sort();
        assert_eq!(got, vec![10, 11, 12, 13]);
    }

    #[test]
    #[cfg(windows)]
    fn the_host_figure_counts_at_least_this_process() {
        let bytes = super::host_memory().expect("host memory readable");
        assert!(bytes > 1024 * 1024, "{bytes} bytes");
    }

    #[test]
    #[cfg(any(windows, target_os = "linux"))]
    fn a_running_test_holds_at_least_a_megabyte() {
        let bytes = super::working_set_bytes().expect("working set readable");
        assert!(bytes > 1024 * 1024, "{bytes} bytes");
    }
}
