//! ACCT-050 (T-128): which agent a plain shell pane is running in front, for an agent the user
//! starts by hand. On Windows the answer comes from the processes the pane's shell started (there
//! is no job control there, so a program started from the pane counts); elsewhere from the pane's
//! foreground process group, so an agent suspended with Ctrl-Z or sent to the background is not
//! in front. When two different agents could be in front the answer is unknown, never a guess.
//! Answers per process are kept, so each poll costs one process list and nothing more.

use std::collections::HashMap;
use std::sync::Mutex;

/// What a shell pane has in front.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Front {
    Shell,
    Agent(&'static str),
    Unknown,
}

impl Front {
    pub fn agent(self) -> Option<&'static str> {
        match self {
            Front::Agent(a) => Some(a),
            _ => None,
        }
    }
}

/// The last answer per terminal, read by `Terminals::program` and reported on change.
static FOUND: Mutex<Option<HashMap<u32, Front>>> = Mutex::new(None);
#[cfg(windows)]
/// The agent each process id was credited as, with the name it had then (a reused id with
/// another name is asked again).
static CREDITS: Mutex<Option<HashMap<u32, Credit>>> = Mutex::new(None);
#[cfg(windows)]
type Credit = (String, Option<&'static str>);

/// The agent found in front of shell terminal `id`, if one is.
pub fn found(id: u32) -> Option<&'static str> {
    FOUND.lock().ok()?.as_ref()?.get(&id).and_then(|f| f.agent())
}

/// Stores `front` for terminal `id`; true when it changed (a terminal seen first as a shell is
/// not a change). Terminals not in `live` are forgotten.
pub fn note(id: u32, front: Front, live: &[u32]) -> bool {
    let mut guard = FOUND.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    map.retain(|k, _| live.contains(k));
    let before = map.insert(id, front).unwrap_or(Front::Shell);
    before != front
}

#[cfg(windows)]
/// The agent a process is credited as, from its program name and, for a script interpreter, its
/// command line (read once per process).
fn credit(pid: u32, name: &str, line: impl FnOnce() -> Option<String>) -> Option<&'static str> {
    let mut guard = CREDITS.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some((n, a)) = map.get(&pid) {
        if n == name {
            return *a;
        }
    }
    let agent = crate::agents::credited_agent(name).or_else(|| is_interpreter(name).then(line).flatten().and_then(|l| crate::agents::credited_agent(&l)));
    map.insert(pid, (name.to_string(), agent));
    agent
}

#[cfg(windows)]
fn is_interpreter(name: &str) -> bool {
    let base = name.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase();
    let stem = base.strip_suffix(".exe").unwrap_or(&base);
    ["node", "bun", "deno", "python", "python3", "pwsh"].contains(&stem)
}

/// Drops the remembered answers for processes no longer running.
#[cfg(windows)]
fn forget_gone(live: &dyn Fn(u32) -> bool) {
    if let Some(map) = CREDITS.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        map.retain(|pid, _| live(*pid));
    }
}

/// The agents in front under `root` in a process table of (pid, parent, name): the first agent on
/// each line of descent; programs an agent started itself are its own business.
pub fn front_in(root: u32, table: &[(u32, u32, String)], credit_of: &mut dyn FnMut(u32, &str) -> Option<&'static str>) -> Front {
    let mut found: Vec<&'static str> = Vec::new();
    let mut queue = vec![root];
    let mut seen = vec![root];
    while let Some(parent) = queue.pop() {
        for (pid, ppid, name) in table {
            if *ppid != parent || seen.contains(pid) {
                continue;
            }
            seen.push(*pid);
            match credit_of(*pid, name) {
                Some(a) => {
                    if !found.contains(&a) {
                        found.push(a);
                    }
                }
                None => queue.push(*pid),
            }
        }
    }
    match found.as_slice() {
        [] => Front::Shell,
        [a] => Front::Agent(a),
        _ => Front::Unknown,
    }
}

/// What process `pid` has in front (Windows: itself when it is an agent Kolux started as the
/// pane's program, else its descendants; T-050-c).
#[cfg(windows)]
pub fn front(pid: u32, _group: Option<i32>) -> Front {
    let Some(table) = imp::table() else { return Front::Unknown };
    let live: std::collections::HashSet<u32> = table.iter().map(|t| t.0).collect();
    forget_gone(&|p| live.contains(&p));
    crate::chat::live::front_of(pid, &table, &mut |p, name| credit(p, name, || imp::command_line(p)))
}

/// What the pane has in front: the leader of its foreground process group, or the pane's own
/// process (the shell, or an agent Kolux started as the pane's program; T-050-c).
#[cfg(not(windows))]
pub fn front(pid: u32, group: Option<i32>) -> Front {
    let Some(group) = group.and_then(|g| u32::try_from(g).ok()) else { return Front::Unknown };
    if group == pid {
        return imp::command_line(pid).and_then(|l| crate::agents::credited_agent(&l)).map_or(Front::Shell, Front::Agent);
    }
    // One small read per poll and pane while something runs in front; nothing to remember.
    match imp::command_line(group) {
        None => Front::Unknown,
        Some(line) => crate::agents::credited_agent(&line).map_or(Front::Shell, Front::Agent),
    }
}

/// One poll of every shell pane; a change is told to the window as `pane-agent`.
pub fn poll(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let shells = app.state::<crate::terminal::Terminals>().shells();
    let live: Vec<u32> = shells.iter().map(|s| s.0).collect();
    for (id, pid, group) in shells {
        let Some(pid) = pid else { continue };
        let now = front(pid, group);
        if note(id, now, &live) {
            // T-050-c: the chat looks for a hand-started transcript from this moment.
            crate::chat::live::noted(id, now.agent(), std::time::SystemTime::now());
            let _ = app.emit("pane-agent", serde_json::json!({ "terminal": id, "agent": now.agent(), "unknown": now == Front::Unknown }));
        }
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, UNICODE_STRING};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// Every running process as (pid, parent, program file name).
    // ponytail: parent ids only, as TERM-045's check; an orphan whose dead parent's id was reused
    // by the shell would read as the shell's. Compare creation times if that ever shows up.
    pub fn table() -> Option<Vec<(u32, u32, String)>> {
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
            let walked = ok;
            while ok {
                let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
                out.push((entry.th32ProcessID, entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len])));
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            walked.then_some(out)
        }
    }

    /// A process's command line, when this user may read it.
    pub fn command_line(pid: u32) -> Option<String> {
        // SAFETY: the handle is checked and closed once; the buffer is sized by the first call's
        // reported length, is u64-aligned for the UNICODE_STRING header it starts with, and the
        // string is only read within the length the call filled in.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut need = 0u32;
            NtQueryInformationProcess(h, ProcessCommandLineInformation, std::ptr::null_mut(), 0, &mut need);
            let mut buf = vec![0u64; (need as usize).div_ceil(8).max(4)];
            let size = (buf.len() * 8) as u32;
            let status = NtQueryInformationProcess(h, ProcessCommandLineInformation, buf.as_mut_ptr().cast(), size, &mut need);
            CloseHandle(h);
            if status < 0 {
                return None;
            }
            let us = &*(buf.as_ptr() as *const UNICODE_STRING);
            if us.Buffer.is_null() || us.Length == 0 {
                return None;
            }
            let chars = std::slice::from_raw_parts(us.Buffer, us.Length as usize / 2);
            Some(String::from_utf16_lossy(chars))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// A process's command line: Linux's /proc, else `ps`.
    pub fn command_line(pid: u32) -> Option<String> {
        if let Ok(raw) = std::fs::read(format!("/proc/{pid}/cmdline")) {
            let line = raw.split(|b| *b == 0).filter(|p| !p.is_empty()).map(String::from_utf8_lossy).collect::<Vec<_>>().join(" ");
            return (!line.is_empty()).then_some(line);
        }
        let out = std::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !line.is_empty()).then_some(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(rows: &[(u32, u32, &str)]) -> Vec<(u32, u32, String)> {
        rows.iter().map(|(a, b, c)| (*a, *b, c.to_string())).collect()
    }

    fn by_name(_: u32, name: &str) -> Option<&'static str> {
        crate::agents::credited_agent(name)
    }

    #[test]
    fn acct_050_the_first_agent_under_the_shell_is_in_front_and_two_agents_are_unknown() {
        // shell 10 -> cmd 11 -> claude 12 -> codex 13 (Claude's own tool run): Claude is in front.
        let table = t(&[(10, 1, "pwsh.exe"), (11, 10, "cmd.exe"), (12, 11, "claude.exe"), (13, 12, "codex.exe"), (20, 1, "codex.exe")]);
        assert_eq!(front_in(10, &table, &mut by_name), Front::Agent("claude"));
        assert_eq!(front_in(11, &table, &mut by_name), Front::Agent("claude"));
        // A shell running nothing, or only programs that are not agents.
        assert_eq!(front_in(10, &t(&[(10, 1, "pwsh.exe"), (11, 10, "git.exe")]), &mut by_name), Front::Shell);
        // Two different agents started from the pane: unclear, so unknown.
        let two = t(&[(10, 1, "pwsh.exe"), (11, 10, "claude.exe"), (12, 10, "codex.exe")]);
        assert_eq!(front_in(10, &two, &mut by_name), Front::Unknown);
        // The same agent twice is still that agent.
        let same = t(&[(10, 1, "pwsh.exe"), (11, 10, "claude.exe"), (12, 10, "claude.exe")]);
        assert_eq!(front_in(10, &same, &mut by_name), Front::Agent("claude"));
        // A parent loop in a broken table ends.
        assert_eq!(front_in(10, &t(&[(10, 11, "a.exe"), (11, 10, "b.exe")]), &mut by_name), Front::Shell);
    }

    #[cfg(windows)]
    #[test]
    fn acct_050_an_interpreter_is_credited_by_its_command_line_read_once_per_process() {
        let mut reads = 0;
        let mut line = || {
            reads += 1;
            Some(r#""C:\nodejs\node.exe" C:\npm\node_modules\@anthropic-ai\claude-code\cli.js"#.to_string())
        };
        assert_eq!(credit(900_001, "node.exe", &mut line), Some("claude"));
        assert_eq!(credit(900_001, "node.exe", &mut line), Some("claude"), "remembered");
        assert_eq!(reads, 1, "the command line is read once");
        assert_eq!(credit(900_001, "git.exe", || None), None, "a reused id with another name is asked again");
        assert_eq!(credit(900_002, "claude.exe", || panic!("a program named for its agent needs no command line")), Some("claude"));
    }

    #[test]
    fn acct_050_a_change_is_reported_once_and_gone_terminals_are_forgotten() {
        assert!(!note(900_101, Front::Shell, &[900_101]), "first seen as a shell is no change");
        assert!(note(900_101, Front::Agent("claude"), &[900_101]));
        assert_eq!(found(900_101), Some("claude"));
        assert!(!note(900_101, Front::Agent("claude"), &[900_101]));
        assert!(note(900_101, Front::Shell, &[900_101]), "Ctrl-Z or exit: the shell owns the pane again");
        assert_eq!(found(900_101), None);
        note(900_102, Front::Agent("codex"), &[900_102]);
        assert_eq!(found(900_101), None, "a terminal not in the live list is forgotten");
    }

    #[cfg(windows)]
    #[test]
    fn acct_050_a_real_agent_typed_into_a_shell_is_found_through_node() {
        // cmd stands in for the pane's shell; the "agent" is node running a script under a
        // `claude-code` package folder, as an npm install starts it.
        let dir = std::env::temp_dir().join(format!("kolux-acct050-{}", std::process::id())).join("node_modules").join("claude-code");
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("cli.js");
        std::fs::write(&script, "setTimeout(() => {}, 6000);").unwrap();
        let mut shell = std::process::Command::new("cmd.exe").arg("/d").arg("/c").arg("node").arg(&script).spawn().unwrap();
        let mut got = Front::Shell;
        for _ in 0..40 {
            got = front(shell.id(), None);
            if got != Front::Shell {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &shell.id().to_string()]).output();
        let _ = shell.wait();
        let _ = std::fs::remove_dir_all(dir.ancestors().nth(2).unwrap());
        assert_eq!(got, Front::Agent("claude"));
    }

    /// T-128-b: the Unix path, checked for the first time. An interactive bash in a real PTY, in a
    /// fresh temp folder; the "agent" is a program named `claude` (a link to `sleep`, so its
    /// command line reads `./claude 30` as a native Claude binary's would). Dropping the pane ends
    /// the job (`kill -9 %1`), kills the shell and removes the folder, so the cleanup also runs
    /// when an assertion fails.
    #[cfg(unix)]
    struct UnixPane {
        session: crate::pty::PtySession,
        pid: u32,
        dir: std::path::PathBuf,
    }

    #[cfg(unix)]
    impl UnixPane {
        fn start() -> Self {
            let dir = std::env::temp_dir().join(format!("kolux-acct050-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            std::fs::create_dir_all(&dir).unwrap();
            std::os::unix::fs::symlink("/bin/sleep", dir.join("claude")).unwrap();
            let mut cmd = portable_pty::CommandBuilder::new("bash");
            cmd.args(["--norc", "--noprofile", "-i"]);
            cmd.cwd(&dir);
            cmd.env("PS1", "$ ");
            let session = crate::pty::PtySession::spawn(cmd, 80, 24, |_| {}, |_| {}).expect("spawn an interactive bash in a pty");
            let pid = session.pid().expect("the shell's pid");
            Self { session, pid, dir }
        }

        fn group(&self) -> Option<i32> {
            self.session.foreground_group()
        }

        /// One poll, as `poll` does it.
        fn front(&self) -> Front {
            front(self.pid, self.group())
        }

        /// Polls every 100 ms for up to `secs`, until `front` answers `want`.
        fn front_within(&self, want: Front, secs: u64) -> Front {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(secs);
            let mut got = self.front();
            while got != want && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(100));
                got = self.front();
            }
            got
        }

        /// The id of the `./claude 30` job the shell started (a child of the shell).
        fn job(&self) -> Option<u32> {
            let out = std::process::Command::new("pgrep").args(["-P", &self.pid.to_string(), "-f", r"^\./claude 30"]).output().ok()?;
            String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
        }
    }

    #[cfg(unix)]
    impl Drop for UnixPane {
        fn drop(&mut self) {
            // The job (stopped or in the background) goes before the shell, so nothing outlives the test.
            let _ = self.session.write(b"kill -9 %1\n");
            std::thread::sleep(std::time::Duration::from_millis(200));
            self.session.kill();
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    #[test]
    fn acct_050_unix_an_agent_typed_into_a_shell_is_in_front_until_ctrl_z_hands_the_pane_back() {
        let pane = UnixPane::start();
        let pid = pane.pid;
        // The shell owns the pane: its own process group is the terminal's foreground group.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while pane.group() != Some(pid as i32) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(pane.group(), Some(pid as i32), "the shell's group is the pane's foreground group");
        assert_eq!(pane.front_within(Front::Shell, 2), Front::Shell, "a shell running nothing is the shell");
        // Type the agent: within a few seconds its process group is in front and it is credited by name.
        pane.session.write(b"./claude 30\n").unwrap();
        assert_eq!(pane.front_within(Front::Agent("claude"), 3), Front::Agent("claude"));
        let agent_group = pane.group().expect("the agent's group");
        assert_ne!(agent_group, pid as i32, "the agent runs in its own process group, in front");
        // Ctrl-Z: the agent is suspended, the shell takes the pane back, the agent no longer counts.
        pane.session.write(b"\x1a").unwrap();
        assert_eq!(pane.front_within(Front::Shell, 2), Front::Shell, "a suspended agent is not running");
        assert_eq!(pane.group(), Some(pid as i32));
        // `fg` brings it back in front.
        pane.session.write(b"fg\n").unwrap();
        assert_eq!(pane.front_within(Front::Agent("claude"), 2), Front::Agent("claude"), "fg puts the agent in front again");
        pane.session.write(b"\x1a").unwrap();
        assert_eq!(pane.front_within(Front::Shell, 2), Front::Shell);
    }

    #[cfg(unix)]
    #[test]
    fn acct_050_unix_a_background_job_is_never_the_foreground_agent() {
        let pane = UnixPane::start();
        let pid = pane.pid;
        assert_eq!(pane.front_within(Front::Shell, 2), Front::Shell);
        pane.session.write(b"./claude 30 &\n").unwrap();
        // Give the shell time to start the job; it must stay the shell's pane throughout.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut job = pane.job();
        while job.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
            job = pane.job();
        }
        let job = job.expect("the background job is running under the shell");
        assert_eq!(pane.front(), Front::Shell, "a background job is never the foreground agent");
        assert_eq!(pane.group(), Some(pid as i32), "the foreground group stays the shell's");
        // The job would be credited if it were in front: its command line reads as Claude's, and
        // `front` names it when its own group is the one in front. It is not, so the pane is the shell's.
        let line = imp::command_line(job).expect("the job's command line");
        assert_eq!(crate::agents::credited_agent(&line), Some("claude"), "{line:?} reads as the agent");
        assert_eq!(front(pid, Some(job as i32)), Front::Agent("claude"), "in front, the job would be the agent");
        assert_eq!(pane.front(), Front::Shell);
    }

}
