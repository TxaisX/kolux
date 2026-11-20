//! T-226 (VIEW-078): the ports a workspace is listening on, for its card. A scan reads the
//! system's listening TCP table (`netstat -ano`), then ties each port to a workspace by its
//! process: a port belongs to the terminal whose shell started the process, and that terminal
//! belongs to the deepest workspace folder that contains the folder it started in. Everything else
//! is external. The tying rules are pure, so tests prove them; the command at the end is thin.
//!
//! ponytail: Windows does not hand out another process's working folder without reading its
//! memory, so "the process's working folder" is the folder of the terminal that started it
//! (T-226-b in kolux-after.md for a real cwd read once a Win32 feature is allowed in Cargo.toml).

use serde::Serialize;
use std::collections::HashMap;
#[cfg(any(windows, test))]
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
    /// True for a port held by a process outside the active workspace.
    pub external: bool,
    /// The Kolux terminal whose shell started the holder. None for an external port.
    pub terminal: Option<u32>,
}

/// The listening TCP sockets in `netstat -ano` text (IPv4 and IPv6 lines alike).
pub fn parse_netstat(text: &str) -> Vec<Listener> {
    text.lines()
        .filter_map(|line| {
            let w: Vec<&str> = line.split_whitespace().collect();
            if w.len() < 5 || !w[0].eq_ignore_ascii_case("TCP") || !listening_row(&w) {
                return None;
            }
            let (addr, port) = w[1].rsplit_once(':')?;
            Some(Listener { port: port.parse().ok()?, addr: addr.trim_matches(['[', ']']).to_string(), pid: w.last()?.parse().ok()? })
        })
        .collect()
}

/// Whether a split `netstat -ano` TCP row is a listening socket. Windows translates the state column
/// (German `ABHÖREN`, French `ÉCOUTE`, Italian `IN ASCOLTO` in two words), so the row is told by its
/// foreign address instead: port 0 for a listening socket, never for a connection.
pub fn listening_row(w: &[&str]) -> bool {
    w.get(2).and_then(|f| f.rsplit_once(':')).is_some_and(|(_, port)| port == "0")
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
/// terminals as (id, shell pid, folder).
pub fn rows_for(listeners: &[Listener], parents: &HashMap<u32, u32>, sessions: &[(u32, u32, String)], workspaces: &[String], active: &str) -> Vec<PortRow> {
    let mut rows: Vec<PortRow> = Vec::new();
    for l in listeners {
        if rows.iter().any(|r| r.port == l.port && r.pid == l.pid) {
            continue;
        }
        let session = session_of(l.pid, parents, sessions);
        let owner = session.and_then(|(_, d)| deepest_workspace(d, workspaces));
        let own = owner.is_some_and(|w| norm(w) == norm(active));
        let terminal = if own { session.map(|(id, _)| id) } else { None };
        rows.push(PortRow { port: l.port, addr: l.addr.clone(), pid: l.pid, external: !own, terminal });
    }
    rows.sort_by_key(|r| (r.external, r.port));
    rows
}

/// How many external ports a scan hands back; a machine can hold hundreds, and the card shows only its own.
pub const MAX_EXTERNAL_ROWS: usize = 12;

/// Keeps every port of the workspace and the first `MAX_EXTERNAL_ROWS` external ones (`rows_for` order: own first, then by port).
pub fn cap_external(rows: Vec<PortRow>) -> Vec<PortRow> {
    let mut external = 0;
    rows.into_iter()
        .filter(|r| {
            external += usize::from(r.external);
            !r.external || external <= MAX_EXTERNAL_ROWS
        })
        .collect()
}

// ---- the system side ---------------------------------------------------------------------------

#[cfg(windows)]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    Ok(parse_netstat(&netstat()?))
}

/// T-726: the system's listening table. A table read less than `SHARED_FOR` ago is reused, so
/// cards hovered one after another share one `netstat` run.
#[cfg(windows)]
pub fn netstat() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    static LAST: std::sync::Mutex<Option<(std::time::Instant, String)>> = std::sync::Mutex::new(None);
    shared(&LAST, || {
        // CREATE_NO_WINDOW: a console would flash up on every poll.
        let out = std::process::Command::new("netstat").args(["-ano"]).creation_flags(crate::winproc::no_window()).output().map_err(|e| format!("The port scan could not start: {e}"))?;
        if !out.status.success() {
            return Err("The port scan failed: netstat did not finish".into());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
}

/// How old a shared table may be.
#[cfg(any(windows, test))]
const SHARED_FOR: Duration = Duration::from_millis(1500);

/// The last table when it is young enough, else a new one from `run`, dated when the run starts (so a
/// slow netstat does not make it look younger). The lock is held across the run, so a caller that
/// waits behind it reuses its table; a failure is not kept.
#[cfg(any(windows, test))]
fn shared(last: &std::sync::Mutex<Option<(std::time::Instant, String)>>, run: impl FnOnce() -> Result<String, String>) -> Result<String, String> {
    let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, text)) = last.as_ref().filter(|(at, _)| at.elapsed() < SHARED_FOR) {
        return Ok(text.clone());
    }
    let at = std::time::Instant::now();
    let text = run()?;
    *last = Some((at, text.clone()));
    Ok(text)
}

#[cfg(not(windows))]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    // ponytail: macOS and Linux read `lsof -iTCP -sTCP:LISTEN` with T-285; until then a card shows no ports, not an error.
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

/// One scan: the listening table, the parent table and the terminals as (id, shell pid, folder).
fn scan(terminals: &crate::terminal::Terminals, workspaces: &[String], active: &str) -> Result<Vec<PortRow>, String> {
    let listeners = scan_listeners()?;
    let sessions: Vec<(u32, u32, String)> = terminals.list().into_iter().filter_map(|(id, pid, dir)| Some((id, pid?, dir?))).collect();
    Ok(rows_for(&listeners, &parent_table(), &sessions, workspaces, active))
}

/// VIEW-078: the listening ports for the active workspace (own first, then external). A failed
/// scan is an error with its reason; the card keeps its last good list.
#[tauri::command]
pub async fn ports_list(terminals: tauri::State<'_, crate::terminal::Terminals>, workspaces: Vec<String>, active: String) -> Result<Vec<PortRow>, String> {
    let t = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || scan(&t, &workspaces, &active).map(cap_external)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETSTAT: &str = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1004\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242\n  TCP    [::1]:5173             [::]:0                 LISTENING       4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242\n  UDP    0.0.0.0:5353           *:*                                    900\n";

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

    /// Non-English Windows translates netstat's state column (German ABHÖREN/HERGESTELLT, Italian
    /// IN ASCOLTO in two words); listening sockets are still found and connections still left out.
    #[test]
    fn view078_listening_sockets_are_found_on_a_translated_windows() {
        let german = "\nAktive Verbindungen\n\n  Proto  Lokale Adresse         Remoteadresse          Status           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              ABHÖREN         1004\n  TCP    127.0.0.1:5173         0.0.0.0:0              ABH\u{FFFD}REN         4242\n  TCP    [::1]:5173             [::]:0                 ABHÖREN         4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        HERGESTELLT     4242\n  UDP    0.0.0.0:5353           *:*                                    900\n";
        assert_eq!(parse_netstat(german), parse_netstat(NETSTAT));
        let italian = "  TCP    127.0.0.1:5173         0.0.0.0:0              IN ASCOLTO      4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        STABILITO       4242\n";
        assert_eq!(parse_netstat(italian), vec![Listener { port: 5173, addr: "127.0.0.1".into(), pid: 4242 }]);
    }

    #[test]
    fn view078_a_dev_server_is_the_workspaces_own_and_a_service_is_external_without_a_stop() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let sessions = vec![(1, 3000, "C:\\work\\app".to_string())];
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions, &ws(), "C:\\work\\app");
        assert_eq!(rows.len(), 2, "5173 once even with an IPv4 and an IPv6 socket");
        assert_eq!((rows[0].port, rows[0].external), (5173, false));
        assert_eq!((rows[1].port, rows[1].external), (135, true));
    }

    #[test]
    fn view078_nested_worktrees_keep_their_own_ports() {
        let parents = HashMap::from([(4242, 3000)]);
        let sessions = vec![(1, 3000, "C:\\work\\app\\wt\\feat\\web".to_string())];
        let ls = parse_netstat(NETSTAT);
        let outer = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app");
        let inner = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app\\wt\\feat");
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
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &[(1, 3000, "C:\\work\\app".into())], &ws(), "C:\\work\\app");
        assert!(rows.iter().all(|r| r.external));
    }

    fn row(port: u16, external: bool) -> PortRow {
        PortRow { port, addr: "0.0.0.0".into(), pid: u32::from(port), external, terminal: None }
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

    #[test]
    fn view078_a_row_names_the_terminal_that_started_it() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &[(7, 3000, "C:\\work\\app".to_string())], &ws(), "C:\\work\\app");
        assert_eq!((rows[0].pid, rows[0].terminal), (4242, Some(7)));
        assert_eq!((rows[1].external, rows[1].terminal), (true, None), "an external port tells nothing about its holder");
    }

    #[cfg(not(windows))]
    #[test]
    fn row75_a_system_without_a_scan_shows_no_ports_not_an_error() {
        assert_eq!(scan_listeners(), Ok(Vec::new()));
    }

    #[test]
    fn t726_scans_close_together_share_one_table() {
        let last = std::sync::Mutex::new(None);
        let runs = std::cell::Cell::new(0);
        let run = || -> Result<String, String> {
            runs.set(runs.get() + 1);
            Ok(format!("table {}", runs.get()))
        };
        assert_eq!(shared(&last, run), Ok("table 1".into()));
        assert_eq!(shared(&last, run), Ok("table 1".into()), "the next scan reuses the same run");
        // an old table is read again; a failed read is an error and is not kept
        last.lock().unwrap().as_mut().unwrap().0 -= SHARED_FOR;
        assert_eq!(shared(&last, || Err("netstat did not finish".into())), Err("netstat did not finish".into()));
        assert_eq!(shared(&last, run), Ok("table 2".into()));
        assert_eq!(runs.get(), 2);
        // the table is dated when its run starts: a slow netstat must not make it look younger
        last.lock().unwrap().as_mut().unwrap().0 -= SHARED_FOR;
        let before = std::time::Instant::now();
        let slow = shared(&last, || {
            std::thread::sleep(std::time::Duration::from_millis(60));
            Ok("slow".into())
        });
        assert_eq!(slow, Ok("slow".into()));
        assert!(last.lock().unwrap().as_ref().unwrap().0.duration_since(before) < std::time::Duration::from_millis(60), "dated at the start of the run");
    }
}
