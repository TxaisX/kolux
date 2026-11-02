//! T-226 (VIEW-078): the ports the active workspace is listening on, for the status bar. A scan
//! reads the system's listening TCP table (`netstat -ano`), then ties each port to a workspace by
//! its process: a port belongs to the terminal whose shell started the process, and that terminal
//! belongs to the deepest workspace folder that contains the folder it started in. Everything else
//! is external and can never be stopped from here. The tying rules are pure, so tests prove them;
//! the commands at the end are thin.
//!
//! ponytail: Windows does not hand out another process's working folder without reading its
//! memory, so "the process's working folder" is the folder of the terminal that started it
//! (T-226-b in kolux-rs-after.md for a real cwd read once a Win32 feature is allowed in Cargo.toml).
//!
//! A Stop ends a program, so it is licensed strictly (ports-stop, from PR #42): the row the user
//! saw must still be the same program (its pid and start time agree three times: on the row, in a
//! fresh scan and right before the kill), the chain from the program up to the pane's shell must
//! be real (no link older than its parent: Windows keeps a dead parent's id on its orphans and
//! reuses ids, so a stranger can read as a pane's child), every holder of the port must be the
//! workspace's own, Kolux itself and system processes are never ended, and the workspace folder
//! must be at least two folders deep, no home folder or a parent of one, a real Git worktree on
//! disk and one the project store (or Git, for that project) knows. The cheap checks run first;
//! Git runs only when the store alone cannot say. The kill holds the program open (Windows never
//! reuses a pid while a handle is open), reads the parent table only then (the scan's is stale by
//! the time the guards are through), holds each child as it is read, ends only the children it
//! really started by the same start-time rule, never a process a stale parent-id field hangs
//! under it, and never one whose pid changed hands after the table was read (a second table, read
//! while the children are held, must agree), and waits on the program's own object. Residual: a
//! child the program starts after that table is read is left running (it was never read); the
//! next scan shows it. A Stop that ends nothing says so: a program already gone is a success, one
//! that still runs but left the port is reported as not stopped.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// One listening socket as the system table shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    pub addr: String,
    pub pid: u32,
}

/// One row of the Ports popover.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PortRow {
    pub port: u16,
    pub addr: String,
    pub pid: u32,
    /// True for a port held by a process outside the active workspace: listed, never stoppable.
    pub external: bool,
    /// When the holder started, as the system counts it, as text (the count does not fit a
    /// JavaScript number). A Stop sends it back, and a pid that now belongs to a newer program is
    /// refused. Empty for an external port and where the system keeps no start times.
    pub started: String,
    /// The Kolux terminal whose shell started the holder, so a printed address binds only to a
    /// port under the terminal that printed it. None for an external port.
    pub terminal: Option<u32>,
}

/// The listening TCP sockets in `netstat -ano` text (IPv4 and IPv6 lines alike).
pub fn parse_netstat(text: &str) -> Vec<Listener> {
    text.lines()
        .filter_map(|line| {
            let w: Vec<&str> = line.split_whitespace().collect();
            if w.len() < 5 || !w[0].eq_ignore_ascii_case("TCP") || !w[3].eq_ignore_ascii_case("LISTENING") {
                return None;
            }
            let (addr, port) = w[1].rsplit_once(':')?;
            Some(Listener { port: port.parse().ok()?, addr: addr.trim_matches(['[', ']']).to_string(), pid: w[4].parse().ok()? })
        })
        .collect()
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// The deepest of `workspaces` that is `dir` or holds it: nested worktrees keep their own ports.
pub fn deepest_workspace<'a>(dir: &str, workspaces: &'a [String]) -> Option<&'a str> {
    let d = norm(dir);
    workspaces
        .iter()
        .filter(|w| {
            let w = norm(w);
            d == w || d.starts_with(&format!("{w}/"))
        })
        .max_by_key(|w| norm(w).len())
        .map(String::as_str)
}

/// The terminal whose shell started `pid` (its id and folder), found by walking up the parent table.
fn session_of<'a>(pid: u32, parents: &HashMap<u32, u32>, sessions: &'a [(u32, u32, String)]) -> Option<(u32, &'a str)> {
    let mut at = pid;
    for _ in 0..64 {
        if let Some((id, _, dir)) = sessions.iter().find(|(_, root, _)| *root == at) {
            return Some((*id, dir));
        }
        at = *parents.get(&at)?;
    }
    None
}

/// VIEW-078: the rows for `active`: its own ports first, then the external ones, each port once
/// (an IPv4 and an IPv6 socket of one process are one port). Sorted by port. `sessions` are the
/// terminals as (id, shell pid, folder); `started` reads a process's start time, asked once per
/// own holder and never for an external one (an external port tells nothing about its holder).
pub fn rows_for(listeners: &[Listener], parents: &HashMap<u32, u32>, sessions: &[(u32, u32, String)], workspaces: &[String], active: &str, started: &dyn Fn(u32) -> String) -> Vec<PortRow> {
    let mut rows: Vec<PortRow> = Vec::new();
    let mut starts: HashMap<u32, String> = HashMap::new();
    for l in listeners {
        if rows.iter().any(|r| r.port == l.port && r.pid == l.pid) {
            continue;
        }
        let session = session_of(l.pid, parents, sessions);
        let owner = session.and_then(|(_, d)| deepest_workspace(d, workspaces));
        let own = owner.is_some_and(|w| norm(w) == norm(active));
        let (started, terminal) = if own {
            (starts.entry(l.pid).or_insert_with(|| started(l.pid)).clone(), session.map(|(id, _)| id))
        } else {
            (String::new(), None)
        };
        rows.push(PortRow { port: l.port, addr: l.addr.clone(), pid: l.pid, external: !own, started, terminal });
    }
    rows.sort_by_key(|r| (r.external, r.port));
    rows
}

/// How many external ports the popover lists; a machine can hold hundreds, and the popover has no room for them.
pub const MAX_EXTERNAL_ROWS: usize = 12;

/// Keeps every port of the workspace and the first `MAX_EXTERNAL_ROWS` external ones (`rows_for` order: own first, then by port).
/// Only the list shown is cut: a stop still looks the port up in the whole scan.
pub fn cap_external(rows: Vec<PortRow>) -> Vec<PortRow> {
    let mut external = 0;
    rows.into_iter()
        .filter(|r| {
            external += usize::from(r.external);
            !r.external || external <= MAX_EXTERNAL_ROWS
        })
        .collect()
}

// ---- the Stop guards ---------------------------------------------------------------------------

/// What a Stop found for its port, before anything is ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Target<'a> {
    /// Nothing holds the port, or the program the user saw has already ended and another now holds
    /// it: success, nothing to end (a newcomer is never ended on the strength of an old row).
    Gone,
    /// The program the user saw still runs (same pid and start time, on another port) but no longer
    /// holds this one: nothing to end, and the note must not read as if something was stopped.
    Moved,
    /// The row to end.
    Row(&'a PortRow),
}

/// What a Stop did, for the note under the popover's title; sent to the front end as text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The program was ended.
    Stopped,
    /// The program had already ended (another may now hold the port): success, nothing was ended.
    Gone,
    /// The program still runs but no longer holds the port: nothing was ended.
    Moved,
}

fn stale(port: u16, pid: u32) -> String {
    format!("Port {port}: process {pid} now belongs to another program; nothing was stopped")
}

/// The guards a fresh scan answers. Every holder of the port is checked before any kill: a port
/// also held outside the workspace, by Kolux itself or by a system process is refused whole, and a
/// row whose pid now names a newer program (its start time changed) is refused as stale. A port
/// the row's program no longer holds ends nothing: `Moved` when the scan still lists that program
/// (same pid and start time) on another port, `Gone` otherwise.
pub fn stop_target<'a>(rows: &'a [PortRow], port: u16, pid: u32, started: &str, self_pid: u32) -> Result<Target<'a>, String> {
    let holders: Vec<&PortRow> = rows.iter().filter(|r| r.port == port).collect();
    let Some(target) = holders.iter().copied().find(|r| r.pid == pid) else {
        let moved = rows.iter().any(|r| !r.external && r.pid == pid && same_start(&[started, &r.started]));
        return Ok(if moved { Target::Moved } else { Target::Gone });
    };
    if let Some(h) = holders.iter().find(|r| r.external) {
        return Err(format!("Port {port} is held by a process outside this workspace (pid {}); it can only be stopped where it runs", h.pid));
    }
    if let Some(h) = holders.iter().find(|r| r.pid <= 4 || r.pid == self_pid) {
        let who = if h.pid == self_pid { "Kolux itself" } else { "a system process" };
        return Err(format!("Port {port} is held by {who}; Kolux never stops it"));
    }
    if !same_start(&[started, &target.started]) {
        return Err(stale(port, pid));
    }
    Ok(Target::Row(target))
}

/// True when every reading of a process's start time agrees, so the pid still names the program
/// the user saw. A reading the system withheld never agrees, on every platform: a Stop must know
/// what it ends, so a scan that lands without start times refuses every Stop instead of guessing.
pub fn same_start(readings: &[&str]) -> bool {
    let first = readings.first().copied().unwrap_or("");
    !first.is_empty() && readings.iter().all(|r| *r == first)
}

/// A start time as the system's count, when it was read at all.
fn tick(start: &dyn Fn(u32) -> String, pid: u32) -> Option<u64> {
    start(pid).parse().ok()
}

/// Whether the chain the scan tied from `pid` up to the pane's `shell` is real: every link's parent
/// must have started no later than its child, and every start time must be present. Windows keeps a
/// dead parent's id on its orphans and reuses ids, so an orphan can read as a child of a pane; it
/// is always older than the pane's process that got the id, so this refuses it.
pub fn lineage_ok(pid: u32, shell: u32, parents: &HashMap<u32, u32>, start: &dyn Fn(u32) -> String) -> bool {
    let mut at = pid;
    let Some(mut at_start) = tick(start, at) else { return false };
    for _ in 0..64 {
        if at == shell {
            return true;
        }
        let Some(&parent) = parents.get(&at) else { return false };
        let Some(parent_start) = tick(start, parent) else { return false };
        if parent_start > at_start {
            return false;
        }
        (at, at_start) = (parent, parent_start);
    }
    false
}

/// The processes `pid` really started, deepest first, so a Stop ends children before their parent.
/// A child's parent-id field can be stale too (its real parent died and `pid` got the id), so only a
/// child that started no earlier than its parent counts, and one whose start time is withheld is
/// left alone with everything under it. Without a start time for `pid` itself nothing counts.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn descendants(pid: u32, parents: &HashMap<u32, u32>, start: &dyn Fn(u32) -> String) -> Vec<u32> {
    let mut order: Vec<u32> = Vec::new();
    let Some(root_start) = tick(start, pid) else { return order };
    let mut queue = vec![(pid, root_start)];
    let mut seen = std::collections::HashSet::from([pid]);
    while let Some((parent, parent_start)) = queue.pop() {
        let mut kids: Vec<u32> = parents.iter().filter(|(c, p)| **p == parent && seen.insert(**c)).map(|(c, _)| *c).collect();
        kids.sort_unstable();
        for kid in kids {
            if let Some(kid_start) = tick(start, kid).filter(|s| *s >= parent_start) {
                order.push(kid);
                queue.push((kid, kid_start));
            }
        }
    }
    order.reverse();
    order
}

/// The children of `order` (deepest first, as `descendants` gives them) that a second reading of
/// the parent table confirms: `before` is the table the tree was walked with, `after` one read
/// while every child was held open, so a pid in it names the process held. A child whose entry
/// differs (it ended and a newcomer got its id in between: by construction newer than the
/// program, so the start-time rule alone cannot tell) is left out with everything under it.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn confirmed(pid: u32, order: Vec<u32>, before: &HashMap<u32, u32>, after: &HashMap<u32, u32>) -> Vec<u32> {
    let mut ok = std::collections::HashSet::from([pid]);
    let mut keep: Vec<u32> = Vec::new();
    for kid in order.into_iter().rev() {
        let parent = before.get(&kid);
        if parent == after.get(&kid) && parent.is_some_and(|p| ok.contains(p)) {
            ok.insert(kid);
            keep.push(kid);
        }
    }
    keep.reverse();
    keep
}

/// How many folders deep `p` is below its root (a drive or `/`): `C:/work/app` is 2, `/srv` is 1.
pub fn depth(p: &str) -> usize {
    norm(p).split('/').filter(|s| !s.is_empty() && !(s.len() == 2 && s.ends_with(':'))).count()
}

/// Whether the folder a Stop names may license one: at least two folders deep, no home folder or
/// a parent of one, a Git worktree on disk (`has_git`) and a workspace Kolux knows (`known`).
pub fn folder_check(active: &str, homes: &[String], has_git: &dyn Fn(&str) -> bool, known: &dyn Fn(&str) -> bool) -> Result<(), String> {
    if depth(active) < 2 {
        return Err(format!("{active} is too close to the root of the drive; Kolux only stops programs inside a workspace folder"));
    }
    let a = norm(active);
    if homes.iter().map(|h| norm(h)).any(|h| h == a || h.starts_with(&format!("{a}/"))) {
        return Err(format!("{active} is a home folder or holds one; Kolux never stops programs there"));
    }
    if !has_git(active) {
        return Err(format!("{active} is not a Git worktree; Kolux only stops programs inside one"));
    }
    if !known(active) {
        return Err(format!("{active} is not a workspace of a project Kolux knows; nothing was stopped"));
    }
    Ok(())
}

/// Whether `active` is a workspace Kolux knows: one the project store lists (`store_paths`: project
/// folders and the worktrees Kolux has seen), or else one Git lists for the project whose folder
/// holds it (`worktrees_of`, asked for that one project only; never when the store already says).
pub fn known_workspace(active: &str, store_paths: &[String], roots: &[String], worktrees_of: &dyn Fn(&str) -> Vec<String>) -> bool {
    let a = norm(active);
    if store_paths.iter().any(|p| norm(p) == a) {
        return true;
    }
    deepest_workspace(active, roots).is_some_and(|root| worktrees_of(root).iter().any(|w| norm(w) == a))
}

/// The home folders a Stop refuses, from `vars` (USERPROFILE, HOMEDRIVE+HOMEPATH, HOME) and the
/// home the terminals use; each once, unset ones left out.
pub fn homes_from(vars: &[(&str, Option<&str>)], pty_home: Option<&str>) -> Vec<String> {
    let get = |k: &str| vars.iter().find(|(n, _)| *n == k).and_then(|(_, v)| *v).filter(|v| !v.is_empty());
    let joined = get("HOMEDRIVE").zip(get("HOMEPATH")).map(|(d, p)| format!("{d}{p}"));
    let mut out: Vec<String> = Vec::new();
    for h in [get("USERPROFILE").map(String::from), joined, get("HOME").map(String::from), pty_home.map(String::from)].into_iter().flatten() {
        if !out.iter().any(|o| norm(o) == norm(&h)) {
            out.push(h);
        }
    }
    out
}

fn candidate_homes() -> Vec<String> {
    let env: Vec<(&str, Option<String>)> = ["USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME"].into_iter().map(|k| (k, std::env::var(k).ok())).collect();
    let vars: Vec<(&str, Option<&str>)> = env.iter().map(|(k, v)| (*k, v.as_deref())).collect();
    let pty = crate::pty::home_dir().map(|p| p.to_string_lossy().into_owned());
    homes_from(&vars, pty.as_deref())
}

/// The workspaces the project store licenses: every Git project's folder (`roots`) and, with them,
/// the worktrees Kolux has seen for it (`all`). Folder projects are not Git workspaces.
fn store_workspaces(store: &crate::state::Store) -> (Vec<String>, Vec<String>) {
    let mut roots = Vec::new();
    let mut all = Vec::new();
    for p in crate::projects::load_projects(store).into_iter().filter(|p| !crate::folder_projects::is_folder(store, &p.id)) {
        all.extend(crate::projects::seen_of(store, &p).unwrap_or_default());
        all.push(p.path.clone());
        roots.push(p.path);
    }
    (roots, all)
}

// ---- the system side ---------------------------------------------------------------------------

#[cfg(windows)]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("netstat").args(["-ano"]).creation_flags(0x0800_0000).output().map_err(|e| format!("The port scan could not start: {e}"))?;
    if !out.status.success() {
        return Err("The port scan failed: netstat did not finish".into());
    }
    Ok(parse_netstat(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(not(windows))]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    // ponytail: macOS and Linux read `lsof -iTCP -sTCP:LISTEN` with T-285; until then the popover shows no ports, not an error banner.
    Ok(Vec::new())
}

/// Every running process's parent, from the process table.
#[cfg(windows)]
fn parent_table() -> HashMap<u32, u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut map = HashMap::new();
    // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed with
    // its size set, as Process32FirstW/NextW require, and only read after a success.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return map;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
    }
    map
}

#[cfg(not(windows))]
fn parent_table() -> HashMap<u32, u32> {
    HashMap::new()
}

/// A process handle held open across a Stop. Windows never reuses a pid while a handle to the
/// process object is open, so the program the handle names is the one that is read, ended and
/// waited for, with no window for a newcomer in between. Opened with the rights the caller
/// needs: a scan's reading asks for the limited query right alone, a Stop adds terminate and
/// wait; never a memory read.
#[cfg(windows)]
struct Held(windows_sys::Win32::Foundation::HANDLE);

/// The right a start-time reading needs.
#[cfg(windows)]
const READ: u32 = windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION;

/// The rights a Stop needs: read the start time, end the process, wait on its object.
#[cfg(windows)]
const STOP: u32 = READ | windows_sys::Win32::System::Threading::PROCESS_TERMINATE | windows_sys::Win32::System::Threading::PROCESS_SYNCHRONIZE;

#[cfg(windows)]
impl Held {
    fn open(pid: u32, access: u32) -> Option<Held> {
        // SAFETY: a null handle is never kept; the one returned is closed once, in Drop.
        let p = unsafe { windows_sys::Win32::System::Threading::OpenProcess(access, 0, pid) };
        (!p.is_null()).then_some(Held(p))
    }

    /// When the process started, as the system's own count (100 ns ticks since 1601), as text;
    /// empty when the system will not say.
    fn started(&self) -> String {
        use windows_sys::Win32::Foundation::FILETIME;
        use windows_sys::Win32::System::Threading::GetProcessTimes;
        // SAFETY: the handle is open for as long as self lives; the four FILETIMEs are zeroed
        // out-parameters GetProcessTimes fills, read only after it reports success.
        unsafe {
            let mut times: [FILETIME; 4] = std::mem::zeroed();
            let [c, e, k, u] = &mut times;
            if GetProcessTimes(self.0, c, e, k, u) == 0 {
                return String::new();
            }
            ((u64::from(c.dwHighDateTime) << 32) | u64::from(c.dwLowDateTime)).to_string()
        }
    }

    /// Ends the process (what `taskkill /F` does), with no console window.
    fn end(&self) {
        // SAFETY: the handle is open and was opened with the terminate right.
        unsafe { windows_sys::Win32::System::Threading::TerminateProcess(self.0, 1) };
    }

    /// Whether the process is gone within `wait`: the process object itself is waited on, so a
    /// reused pid can never read as "still running".
    fn gone_within(&self, wait: Duration) -> bool {
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;
        // SAFETY: the handle is open and was opened with the synchronize right.
        unsafe { WaitForSingleObject(self.0, wait.as_millis().min(u128::from(u32::MAX)) as u32) == WAIT_OBJECT_0 }
    }
}

#[cfg(windows)]
impl Drop for Held {
    fn drop(&mut self) {
        // SAFETY: the handle was opened by `open` and is closed exactly here.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// When process `pid` started, as the system's own count, as text; empty when the system will
/// not say. The limited query right alone (a program the user may read but not end still gets
/// its start time), no memory read; the handle is closed again at once.
#[cfg(windows)]
fn start_time(pid: u32) -> String {
    Held::open(pid, READ).map(|h| h.started()).unwrap_or_default()
}

/// Linux: field 22 of `/proc/<pid>/stat`, the start in clock ticks since boot (a count that moves
/// only with a reboot, like the Windows one), so the same three-reading rule holds here once a
/// scan does (T-285). The command name, field 2, is in parentheses and may hold spaces and
/// parentheses of its own, so the fields are counted from its closing one.
#[cfg(target_os = "linux")]
fn stat_start(stat: &str) -> Option<&str> {
    let (_, rest) = stat.rsplit_once(')')?;
    rest.split_whitespace().nth(19)
}

#[cfg(target_os = "linux")]
fn start_time(pid: u32) -> String {
    std::fs::read_to_string(format!("/proc/{pid}/stat")).ok().and_then(|s| stat_start(&s).map(String::from)).unwrap_or_default()
}

// ponytail: macOS keeps start times too (`ps -o lstart= -p <pid>`); until T-285 brings its scan
// there is no row to stop, and the strict `same_start` refuses every Stop the day a scan lands
// without them.
#[cfg(not(any(windows, target_os = "linux")))]
fn start_time(_pid: u32) -> String {
    String::new()
}

/// What one scan read: the rows, the parent table they were tied with and the terminals as
/// (id, shell pid, folder), so a Stop checks the lineage against the very table the scan used.
struct Scan {
    rows: Vec<PortRow>,
    parents: HashMap<u32, u32>,
    sessions: Vec<(u32, u32, String)>,
}

fn scan(terminals: &crate::terminal::Terminals, workspaces: &[String], active: &str) -> Result<Scan, String> {
    let listeners = scan_listeners()?;
    let sessions: Vec<(u32, u32, String)> = terminals.list().into_iter().filter_map(|(id, pid, dir)| Some((id, pid?, dir?))).collect();
    let parents = parent_table();
    let rows = rows_for(&listeners, &parents, &sessions, workspaces, active, &start_time);
    Ok(Scan { rows, parents, sessions })
}

/// VIEW-078: the listening ports for the active workspace (own first, then external). A failed
/// scan is an error with its reason; the panel keeps its last good list.
#[tauri::command]
pub async fn ports_list(terminals: tauri::State<'_, crate::terminal::Terminals>, workspaces: Vec<String>, active: String) -> Result<Vec<PortRow>, String> {
    let t = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || scan(&t, &workspaces, &active).map(|s| cap_external(s.rows))).await.map_err(|e| e.to_string())?
}

fn stranger(port: u16, pid: u32) -> String {
    format!("Port {port}: process {pid} was not started from a terminal of this workspace; nothing was stopped")
}

fn still_running(port: u16, pid: u32) -> String {
    format!("Port {port}: process {pid} is still running after the stop")
}

#[cfg(windows)]
fn unopened(port: u16, pid: u32) -> String {
    format!("Port {port}: process {pid} could not be opened; nothing was stopped")
}

/// Ends `pid` with the children it really started, once a last start-time reading agrees with the
/// row's and the one sent back. Windows: the program is held open first, so no pid can pass to a
/// newcomer in between; only then is the parent table read (the scan's is stale by now), each
/// child is held as its start time is read, the children are chosen by `descendants` (never by a
/// stale parent-id field, as `taskkill /T` would) and a second table read while they are all held
/// confirms each one (`confirmed`: a pid that changed hands between the two readings is left
/// out). They are ended deepest first, then the program, and its own object is waited on. A
/// program that cannot be opened is a refusal unless it is already gone, which counts as success.
#[cfg(windows)]
fn end_program(port: u16, pid: u32, sent: &str, row: &str) -> Result<Outcome, String> {
    use std::cell::RefCell;
    let Some(holder) = Held::open(pid, STOP) else {
        return if crate::procs::alive(pid) == Some(false) { Ok(Outcome::Gone) } else { Err(unopened(port, pid)) };
    };
    let third = holder.started();
    if !same_start(&[sent, row, &third]) {
        return Err(stale(port, pid));
    }
    let kids: RefCell<HashMap<u32, Held>> = RefCell::new(HashMap::new());
    let start = |p: u32| -> String {
        if p == pid {
            return third.clone();
        }
        let Some(h) = Held::open(p, STOP) else { return String::new() };
        let s = h.started();
        kids.borrow_mut().insert(p, h);
        s
    };
    let fresh = parent_table();
    let order = descendants(pid, &fresh, &start);
    let kids = kids.into_inner();
    let order = confirmed(pid, order, &fresh, &parent_table());
    for kid in order {
        if let Some(h) = kids.get(&kid) {
            h.end();
        }
    }
    holder.end();
    if !holder.gone_within(Duration::from_secs(2)) {
        return Err(still_running(port, pid));
    }
    Ok(Outcome::Stopped)
}

/// Off Windows the pane's child leads its own process group, which the group signal ends whole;
/// there is no scan yet (T-285), so no row reaches here.
#[cfg(not(windows))]
fn end_program(port: u16, pid: u32, sent: &str, row: &str) -> Result<Outcome, String> {
    if !same_start(&[sent, row, &start_time(pid)]) {
        return Err(stale(port, pid));
    }
    crate::procs::kill_tree(pid);
    if !crate::procs::wait_gone(&[pid], Duration::from_secs(2)).is_empty() {
        return Err(still_running(port, pid));
    }
    Ok(Outcome::Stopped)
}

/// VIEW-078: stops the process behind a port with everything it started, once every guard above
/// passes (`stop_target`, then `lineage_ok` against the scan's own parent table, then
/// `folder_check`, then a last start-time reading on a held handle), and says what it did. A port
/// that is already gone counts as success (`Gone`); one the program left while it still runs ends
/// nothing (`Moved`); a program still running after the kill is an error.
#[tauri::command]
pub async fn ports_stop(app: tauri::AppHandle, workspaces: Vec<String>, active: String, port: u16, pid: u32, started: String) -> Result<Outcome, String> {
    use tauri::Manager;
    let t = app.state::<crate::terminal::Terminals>().inner().clone();
    let git = app.state::<crate::git::Git>().inner().clone();
    // The store is read here, so its lock is never held across the scan or a Git run.
    let (roots, store_paths) = {
        let store = app.state::<std::sync::Mutex<crate::state::Store>>();
        let s = store.lock().map_err(|e| e.to_string())?;
        store_workspaces(&s)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let Scan { rows, parents, sessions } = scan(&t, &workspaces, &active)?;
        let target = match stop_target(&rows, port, pid, &started, std::process::id())? {
            // The program may run on without any port: the same pid with the same start time is it.
            Target::Gone => return Ok(if same_start(&[&started, &start_time(pid)]) { Outcome::Moved } else { Outcome::Gone }),
            Target::Moved => return Ok(Outcome::Moved),
            Target::Row(r) => r.clone(),
        };
        // The chain from the program up to the pane's shell must be real, link by link.
        let shell = target.terminal.and_then(|id| sessions.iter().find(|(i, _, _)| *i == id).map(|(_, shell, _)| *shell));
        if !shell.is_some_and(|shell| lineage_ok(pid, shell, &parents, &start_time)) {
            return Err(stranger(port, pid));
        }
        let worktrees_of = |root: &str| git.worktrees(Path::new(root)).map(|v| v.into_iter().map(|w| w.path).collect()).unwrap_or_default();
        folder_check(&active, &candidate_homes(), &|p| Path::new(p).join(".git").exists(), &|p| known_workspace(p, &store_paths, &roots, &worktrees_of))?;
        end_program(port, pid, &started, &target.started)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETSTAT: &str = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1004\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242\n  TCP    [::1]:5173             [::]:0                 LISTENING       4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242\n  UDP    0.0.0.0:5353           *:*                                    900\n";

    fn no_start(_: u32) -> String {
        String::new()
    }

    fn ws() -> Vec<String> {
        vec!["C:\\work\\app".into(), "C:\\work\\app\\wt\\feat".into()]
    }

    #[test]
    fn view078_parse_keeps_only_listening_tcp_with_both_address_families() {
        let l = parse_netstat(NETSTAT);
        assert_eq!(l.len(), 3);
        assert_eq!(l[1], Listener { port: 5173, addr: "127.0.0.1".into(), pid: 4242 });
        assert_eq!(l[2].addr, "::1");
    }

    #[test]
    fn view078_a_dev_server_is_the_workspaces_own_and_a_service_is_external_without_a_stop() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let sessions = vec![(1, 3000, "C:\\work\\app".to_string())];
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions, &ws(), "C:\\work\\app", &no_start);
        assert_eq!(rows.len(), 2, "5173 once even with an IPv4 and an IPv6 socket");
        assert_eq!((rows[0].port, rows[0].external), (5173, false));
        assert_eq!((rows[1].port, rows[1].external), (135, true));
    }

    #[test]
    fn view078_nested_worktrees_keep_their_own_ports() {
        let parents = HashMap::from([(4242, 3000)]);
        let sessions = vec![(1, 3000, "C:\\work\\app\\wt\\feat\\web".to_string())];
        let ls = parse_netstat(NETSTAT);
        let outer = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app", &no_start);
        let inner = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app\\wt\\feat", &no_start);
        assert!(outer.iter().find(|r| r.port == 5173).unwrap().external, "the nested worktree's port is not the outer one's");
        assert!(!inner.iter().find(|r| r.port == 5173).unwrap().external);
    }

    #[test]
    fn view078_deepest_workspace_and_prefix_edges() {
        assert_eq!(deepest_workspace("C:/work/app/wt/feat/x", &ws()), Some("C:\\work\\app\\wt\\feat"));
        assert_eq!(deepest_workspace("C:\\work\\apple", &ws()), None, "a sibling that shares a name prefix is not inside");
        assert_eq!(deepest_workspace("c:\\WORK\\app", &ws()), Some("C:\\work\\app"));
    }

    #[test]
    fn view078_a_parent_loop_ends_and_an_unknown_process_is_external() {
        let parents = HashMap::from([(4242, 4243), (4243, 4242)]);
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &[(1, 3000, "C:\\work\\app".into())], &ws(), "C:\\work\\app", &no_start);
        assert!(rows.iter().all(|r| r.external));
    }

    fn row(port: u16, external: bool) -> PortRow {
        PortRow { port, addr: "0.0.0.0".into(), pid: u32::from(port), external, started: String::new(), terminal: None }
    }

    #[test]
    fn row75_external_rows_are_capped_and_the_workspaces_own_are_all_kept() {
        let mut rows: Vec<PortRow> = (1..=3).map(|p| row(8000 + p, false)).collect();
        rows.extend((1..=MAX_EXTERNAL_ROWS as u16 + 10).map(|p| row(p, true)));
        let got = cap_external(rows);
        assert_eq!(got.iter().filter(|r| !r.external).count(), 3, "own ports are never dropped");
        assert_eq!(got.iter().filter(|r| r.external).count(), MAX_EXTERNAL_ROWS);
        assert_eq!(got[3].port, 1, "own first, then the external ones in port order");
        assert_eq!(got.last().map(|r| r.port), Some(MAX_EXTERNAL_ROWS as u16));
    }

    #[test]
    fn row75_a_short_list_is_left_alone() {
        let rows = vec![row(80, true), row(443, true)];
        assert_eq!(cap_external(rows.clone()), rows);
        assert!(cap_external(Vec::new()).is_empty());
    }

    // ---- the Stop guards (ports-stop, from PR #42) -------------------------------------------------

    fn sessions() -> Vec<(u32, u32, String)> {
        vec![(7, 3000, "C:\\work\\app".to_string())]
    }

    fn held(port: u16, pid: u32, external: bool, started: &str) -> PortRow {
        PortRow { port, addr: "127.0.0.1".into(), pid, external, started: started.into(), terminal: (!external).then_some(7) }
    }

    #[test]
    fn view078_stop_a_row_names_the_terminal_that_started_it_and_when_it_started() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions(), &ws(), "C:\\work\\app", &|pid| format!("t{pid}"));
        assert_eq!((rows[0].pid, rows[0].terminal, rows[0].started.as_str()), (4242, Some(7), "t4242"));
        assert_eq!((rows[1].external, rows[1].terminal, rows[1].started.as_str()), (true, None, ""), "an external port tells nothing about its holder");
    }

    #[test]
    fn view078_stop_a_port_nothing_holds_or_that_another_program_now_holds_is_gone() {
        assert_eq!(stop_target(&[], 5173, 4242, "1", 9), Ok(Target::Gone));
        let rows = [held(5173, 5000, false, "2")];
        assert_eq!(stop_target(&rows, 5173, 4242, "1", 9), Ok(Target::Gone), "the program the user saw has ended; the newcomer is left alone");
    }

    #[test]
    fn view078_stop_every_holder_is_checked_so_a_second_holder_outside_the_workspace_refuses() {
        let rows = [held(5173, 4242, false, "1"), held(5173, 6000, true, "")];
        let err = stop_target(&rows, 5173, 4242, "1", 9).unwrap_err();
        assert!(err.contains("outside this workspace") && err.contains("6000"), "{err}");
    }

    #[test]
    fn view078_stop_kolux_itself_and_system_processes_are_refused() {
        assert!(stop_target(&[held(80, 9, false, "1")], 80, 9, "1", 9).unwrap_err().contains("Kolux itself"));
        assert!(stop_target(&[held(135, 4, false, "1")], 135, 4, "1", 9).unwrap_err().contains("system process"));
        assert!(stop_target(&[held(80, 4242, false, "1"), held(80, 9, false, "1")], 80, 4242, "1", 9).is_err(), "a port Kolux shares is never stopped");
    }

    #[test]
    fn view078_stop_a_reused_process_id_is_refused_as_stale() {
        let rows = [held(5173, 4242, false, "200")];
        let err = stop_target(&rows, 5173, 4242, "100", 9).unwrap_err();
        assert!(err.contains("another program"), "{err}");
        assert!(matches!(stop_target(&rows, 5173, 4242, "200", 9), Ok(Target::Row(r)) if r.pid == 4242));
        assert!(same_start(&["5", "5", "5"]));
        assert!(!same_start(&["5", "5", "6"]));
        assert!(!same_start(&["", "", ""]), "a start time the system withheld never confirms a pid, on every platform: a scan without start times refuses every Stop");
    }

    fn starts<'a>(table: &'a [(u32, &'a str)]) -> impl Fn(u32) -> String + 'a {
        move |pid| table.iter().find(|(p, _)| *p == pid).map(|(_, s)| (*s).to_string()).unwrap_or_default()
    }

    #[test]
    fn view078_stop_a_holder_older_than_its_parent_is_a_stranger_on_a_reused_parent_pid() {
        // The chain the scan tied: 4242 -> 4000 -> 3000 (the pane's shell). Windows keeps a dead
        // parent's id on its orphans and reuses ids, so the chain is real only when no link is older
        // than its parent.
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (3000, 1)]);
        assert!(lineage_ok(4242, 3000, &parents, &starts(&[(3000, "900"), (4000, "950"), (4242, "1000")])));
        assert!(!lineage_ok(4242, 3000, &parents, &starts(&[(3000, "900"), (4000, "950"), (4242, "100")])), "an orphan left by an editor closed long ago, tied by a reused parent id: not ours");
        assert!(!lineage_ok(4242, 3000, &parents, &starts(&[(3000, "900"), (4000, "100"), (4242, "1000")])), "a stale link anywhere in the chain breaks it");
        assert!(!lineage_ok(4242, 3000, &parents, &starts(&[(3000, "900"), (4242, "1000")])), "a start time the system withholds never confirms a link");
        assert!(lineage_ok(3000, 3000, &parents, &starts(&[(3000, "900")])), "the shell itself holding a port has nothing to prove but its own start time");
        assert!(!lineage_ok(4242, 7777, &parents, &starts(&[(3000, "900"), (4000, "950"), (4242, "1000")])), "a chain that never reaches the shell");
        assert!(!lineage_ok(4242, 3000, &HashMap::from([(4242, 4000), (4000, 4242)]), &starts(&[(4000, "950"), (4242, "1000")])), "a parent loop ends");
    }

    #[test]
    fn view078_stop_ends_only_the_children_the_program_really_started_deepest_first() {
        // 4242 started 5000 (which started 6000) and 5001 is an orphan whose dead parent had id 4242.
        let parents = HashMap::from([(5000, 4242), (6000, 5000), (5001, 4242), (5002, 5001), (7000, 4242), (4242, 3000)]);
        let table = [(4242, "150"), (5000, "200"), (6000, "300"), (5001, "50"), (5002, "60"), (7000, "")];
        assert_eq!(descendants(4242, &parents, &starts(&table)), vec![6000, 5000], "the orphan, its child and a child whose start time is withheld are left alone; children end before their parent");
        assert_eq!(descendants(4242, &parents, &starts(&[(5000, "200")])), Vec::<u32>::new(), "no start time for the program itself: nothing of its tree is ended");
        assert_eq!(descendants(4242, &HashMap::from([(5000, 4242), (4242, 5000)]), &starts(&[(4242, "1"), (5000, "2")])), vec![5000], "a parent loop ends");
    }

    #[test]
    fn view078_stop_a_child_whose_id_changed_hands_between_the_two_table_readings_is_left_alone() {
        // The tree was walked with `before`; `after` was read while every child was held open, so
        // an entry that differs describes a newcomer that got the id in between (its start time is
        // newer than the program's by construction, so the start-time rule alone cannot catch it).
        let before = HashMap::from([(5000, 4242), (6000, 5000), (5001, 4242), (4242, 3000)]);
        let order = vec![6000, 5000, 5001];
        assert_eq!(confirmed(4242, order.clone(), &before, &before), vec![6000, 5000, 5001], "the same table twice confirms every child, deepest first");
        let mut reused = before.clone();
        reused.insert(5001, 8000);
        assert_eq!(confirmed(4242, order.clone(), &before, &reused), vec![6000, 5000], "5001 ended and a process 8000 started got its id: not ours");
        let mut ended = before.clone();
        ended.remove(&5000);
        assert_eq!(confirmed(4242, order.clone(), &before, &ended), vec![5001], "5000 is gone from the table, and 6000 under it goes with it even though its own entry still agrees");
        assert_eq!(confirmed(4242, order, &before, &HashMap::new()), Vec::<u32>::new(), "an empty second reading confirms nothing");
    }

    #[test]
    fn view078_stop_a_program_that_still_runs_but_left_the_port_is_reported_not_stopped() {
        // The dev server the row showed on 5173 (pid 4242, started "1") restarted on 3000.
        let rows = [held(3000, 4242, false, "1")];
        assert_eq!(stop_target(&rows, 5173, 4242, "1", 9), Ok(Target::Moved), "nothing is ended, and the note must not say the port was stopped");
        assert_eq!(stop_target(&[held(3000, 4242, false, "2")], 5173, 4242, "1", 9), Ok(Target::Gone), "a newer program with the old pid on another port: the one the user saw is gone");
        assert_eq!(stop_target(&[held(3000, 4242, true, "")], 5173, 4242, "1", 9), Ok(Target::Gone), "an external row tells nothing about its holder");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn view078_stop_linux_reads_a_start_time_from_proc_so_the_same_rule_holds_there() {
        let stat = "14410 (my (cat) tool) R 14404 14410 14404 0 -1 4194304 84 0 0 0 0 0 0 0 20 0 1 0 1524164 2928640 364 0";
        assert_eq!(stat_start(stat), Some("1524164"), "field 22, after a command name that may hold spaces and parentheses");
        assert_eq!(stat_start("1 (init) S 0"), None);
        let own = start_time(std::process::id());
        assert!(own.parse::<u64>().is_ok(), "this process's own start time: {own:?}");
        assert_eq!(start_time(u32::MAX), "", "a process that does not exist has no start time");
    }

    #[test]
    fn view078_stop_a_home_folder_its_parents_a_shallow_folder_and_a_folder_without_git_are_refused() {
        let homes = vec!["C:\\Users\\txais".to_string(), "/home/txais".to_string(), "D:\\people\\home\\txais".to_string()];
        let yes = |_: &str| true;
        assert!(folder_check("C:\\Users\\txais", &homes, &yes, &yes).unwrap_err().contains("home folder"));
        assert!(folder_check("D:\\people\\home", &homes, &yes, &yes).unwrap_err().contains("home folder"), "a parent of a home, deep enough to pass the depth rule");
        assert!(folder_check("C:\\Users", &homes, &yes, &yes).is_err(), "a parent of a home at the root is refused too (by depth)");
        assert!(folder_check("c:/users/TXAIS/", &homes, &yes, &yes).unwrap_err().contains("home folder"), "spelling does not matter");
        assert_eq!(folder_check("D:\\people\\homely", &homes, &yes, &yes), Ok(()), "a sibling that shares a name prefix is not a parent");
        assert!(folder_check("C:\\work", &homes, &yes, &yes).unwrap_err().contains("too close to the root"));
        assert!(folder_check("C:\\Users\\txais\\code\\app", &homes, &|_| false, &yes).unwrap_err().contains("not a Git worktree"));
        assert!(folder_check("C:\\Users\\txais\\code\\app", &homes, &yes, &|_| false).unwrap_err().contains("not a workspace"));
        assert_eq!(folder_check("C:\\Users\\txais\\code\\app", &homes, &yes, &yes), Ok(()));
        assert_eq!(depth("C:\\"), 0);
        assert_eq!(depth("/srv"), 1);
        assert_eq!(depth("//nas/share/app"), 3);
    }

    #[test]
    fn view078_stop_the_store_licenses_a_workspace_and_git_is_asked_only_for_the_project_holding_it() {
        use std::cell::RefCell;
        let asked = RefCell::new(Vec::new());
        let git = |root: &str| {
            asked.borrow_mut().push(root.to_string());
            vec![format!("{root}\\wt\\feat")]
        };
        let roots = vec!["C:\\work\\app".to_string(), "C:\\other".to_string()];
        let store = vec!["C:\\work\\app".to_string(), "C:\\work\\app\\wt\\seen".to_string()];
        assert!(known_workspace("c:/work/app/wt/seen", &store, &roots, &git));
        assert!(asked.borrow().is_empty(), "a workspace the store lists never spawns git");
        assert!(known_workspace("C:\\work\\app\\wt\\feat", &store, &roots, &git));
        assert_eq!(*asked.borrow(), vec!["C:\\work\\app".to_string()]);
        assert!(!known_workspace("C:\\work\\app\\wt\\stranger", &store, &roots, &git));
        assert!(!known_workspace("D:\\elsewhere\\x", &store, &roots, &git), "a folder under no project asks nothing");
        assert_eq!(asked.borrow().len(), 2);
    }

    #[test]
    fn view078_stop_the_homes_a_stop_refuses_come_from_every_home_variable() {
        let vars = [("USERPROFILE", Some("C:\\Users\\a")), ("HOMEDRIVE", Some("D:")), ("HOMEPATH", Some("\\Users\\b")), ("HOME", Some("/home/c"))];
        assert_eq!(homes_from(&vars, Some("/home/pty")), vec!["C:\\Users\\a", "D:\\Users\\b", "/home/c", "/home/pty"]);
        assert_eq!(homes_from(&[("HOME", None)], None), Vec::<String>::new());
    }

    #[cfg(not(windows))]
    #[test]
    fn row75_a_system_without_a_scan_shows_no_ports_not_an_error() {
        assert_eq!(scan_listeners(), Ok(Vec::new()));
    }
}
