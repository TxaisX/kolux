//! T-075-b (APP-052, CLI-011; DT-C27 reversed by Txais 2026-10-20: terminals keep running after
//! quit): the background terminal service. One process per user, app identifier and profile folder
//! owns the terminals (the same `PtySession`s a window runs, one job per pane), so they outlive the
//! window.
//!
//! - One copy: a named mutex in the session-local namespace (`lifecycle::claim_named`), per
//!   identifier and profile, so a lane, trial or proof copy never blocks the installed app's service.
//! - Reaching it: the local command line's way (CLI-004): a TCP listener on 127.0.0.1 only and a
//!   random token in `terminals.json` inside the user's own data folder, which only that user can
//!   read. Every connection starts with a hello carrying the token; anything else is refused.
//! - Wire: one JSON object per line. A connection that sends `attach` is a window: it gets every
//!   running terminal with its recent output (the ORCH-057 tail), then each output chunk and exit as
//!   events, in order. `detach` or a closed connection ends the attachment; the terminals go on.
//! - Leaving: the service stops itself once no terminal is left and no window has been attached for
//!   `IDLE_LIMIT` (coordinator default 10 minutes; Txais may overrule).
//! - The window side that routes panes through the service is T-184-b (TERM-105). The importer
//!   part of the T-075-b line is T-213's and is not here.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use crate::lifecycle::{claim_named, Claim, Instance};
use crate::pty::PtySession;
use crate::terminal::{generation, Flow, Snap, PROTOCOL};

/// The command-line switch the app program runs the service under: `--terminal-service <identifier> <data folder>`.
pub const FLAG: &str = "--terminal-service";
/// The service's reachability file in the app's data folder.
pub const ENDPOINT_FILE: &str = "terminals.json";
/// Coordinator default (2026-10-20, Txais may overrule): no terminal and no window for this long ends the service.
pub const IDLE_LIMIT: Duration = Duration::from_secs(600);
/// APP-052: the oldest service protocol this build still pairs with; older ones are refused.
pub const OLDEST_PROTOCOL: u32 = 1;
/// How long a probe waits for the service's hello answer.
const PROBE_WAIT: Duration = Duration::from_millis(2500);
/// How often the accept loop looks at the idle clock.
const POLL: Duration = Duration::from_millis(100);
/// A launched service has this long to answer before the start is called failed.
pub const START_LIMIT: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------- one copy

/// The mutex name of the terminal service for one app identifier on one profile folder.
pub fn lock_name(identifier: &str, profile: &Path) -> String {
    format!("Local\\{identifier}.terminals-{}", crate::lifecycle::profile_suffix(profile))
}

/// The service's claim, held for its whole life; `None` when another service for the same profile runs.
pub fn lock(identifier: &str, profile: &Path) -> Option<Instance> {
    match claim_named(&lock_name(identifier, profile)) {
        Claim::First(held) => Some(held),
        Claim::Second => None,
    }
}

// ---------------------------------------------------------------- idle exit

/// The idle rule with the clock passed in: `tick` says whether the service should stop now.
#[derive(Debug)]
pub struct Idle {
    limit: Duration,
    since: Option<Instant>,
}

impl Idle {
    pub fn new(limit: Duration) -> Self {
        Idle { limit, since: None }
    }

    /// `panes` running terminals, `windows` attached windows, at `now`. Any of either restarts the
    /// count; the service stops once both have been zero for the whole limit.
    pub fn tick(&mut self, now: Instant, panes: usize, windows: usize) -> bool {
        if panes > 0 || windows > 0 {
            self.since = None;
            return false;
        }
        let since = *self.since.get_or_insert(now);
        now.saturating_duration_since(since) >= self.limit
    }
}

// ---------------------------------------------------------------- pairing

/// APP-052: a service speaking `theirs` pairs with this build when it is not older than the oldest
/// protocol this build speaks; a newer one only added things, so it is kept.
pub fn compatible(theirs: u32) -> Result<(), String> {
    if theirs < OLDEST_PROTOCOL {
        return Err(format!(
            "the background terminal service running now is from an older Kolux (protocol {theirs}; this one needs {OLDEST_PROTOCOL} or later), so Kolux cannot safely open its window on those terminals. It stops by itself 10 minutes after its last terminal closes; or end it in Task Manager and run open again (its terminals end with it)"
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------- reachability file

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub generation: u64,
    pub protocol: u32,
}

/// Written to a temporary name and renamed, so a reader never sees half a file.
pub fn write_endpoint(dir: &Path, ep: &Endpoint) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{ENDPOINT_FILE}.{}.tmp", ep.pid));
    std::fs::write(&tmp, serde_json::to_vec(ep).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, dir.join(ENDPOINT_FILE))
}

pub fn read_endpoint(dir: &Path) -> Option<Endpoint> {
    serde_json::from_slice(&std::fs::read(dir.join(ENDPOINT_FILE)).ok()?).ok()
}

/// Removes the file only when it still names this process (a newer service may have replaced it).
pub fn remove_endpoint_if_ours(dir: &Path, pid: u32) {
    if read_endpoint(dir).is_some_and(|e| e.pid == pid) {
        let _ = std::fs::remove_file(dir.join(ENDPOINT_FILE));
    }
}

// ---------------------------------------------------------------- the service

struct Term {
    session: PtySession,
    program: String,
    cwd: String,
    /// T-184-b: what the window that started it keeps about it (its handle, pane, secret, program),
    /// handed back to the window that takes it back after a restart.
    meta: Value,
}

#[derive(Default)]
struct Inner {
    terms: BTreeMap<u32, Term>,
    /// Each terminal's output count and recent tail, from before its session is stored (output may
    /// arrive while the spawn is still returning).
    snaps: BTreeMap<u32, Snap>,
    next_term: u32,
    windows: BTreeMap<u64, Sender<String>>,
    next_conn: u64,
    /// AFTER-696: an update asked the service to end (`stop`), so the installer can replace the
    /// program it runs from.
    stopping: bool,
    /// AFTER-699 (ACCT-054): how far each terminal's output has run ahead of the window's pane; its
    /// reader waits on it while a window is attached.
    flows: BTreeMap<u32, Arc<Flow>>,
}

impl Inner {
    fn broadcast(&mut self, line: &str) {
        self.windows.retain(|_, tx| tx.send(line.to_string()).is_ok());
    }
}

/// T-619: `PtySession::resize` on the master and size keeper taken out of the service lock: the size
/// is recorded under the master's own lock, so a restore cannot put an older one back, then applied.
/// ponytail: this body is a copy of `PtySession::resize` (pty.rs), which needs `&PtySession` and so the
/// service lock; upgrade: share one free function in pty.rs (not this lane's file) that both call.
fn resize_outside(master: Option<super::window_ops::SharedMaster>, size: Option<Arc<super::window_ops::SizeKeeper>>, cols: u16, rows: u16) -> Result<(), String> {
    let m = master.ok_or("session already closed")?;
    let m = m.lock().map_err(|_| "pty lock poisoned".to_string())?;
    if let Some(size) = &size {
        size.set(cols, rows);
    }
    m.resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

/// The terminals and attached windows of one running service.
#[derive(Clone, Default)]
pub struct Service {
    inner: Arc<Mutex<Inner>>,
}

/// What a service run is told: its token and protocol (a test passes an older one).
pub struct Config {
    pub token: String,
    pub protocol: u32,
    pub idle: Duration,
}

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// AFTER-699 (ACCT-054): a terminal's reader counts `bytes` just sent and, past the high mark, waits
/// for the window's pane to catch up, but only while a window is attached: with none there is no
/// pane to wait for (the output goes to the tail alone), so the count is dropped instead.
fn hold(flow: &Flow, attached: bool, bytes: u64) {
    hold_within(flow, attached, bytes, crate::terminal::FLOW_WAIT);
}

fn hold_within(flow: &Flow, attached: bool, bytes: u64, wait: Duration) {
    if attached {
        flow.sent_within(bytes, wait);
    } else {
        flow.release();
    }
}

impl Service {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Running terminals and attached windows.
    pub fn counts(&self) -> (usize, usize) {
        let g = self.lock();
        (g.terms.len(), g.windows.len())
    }

    fn row(id: u32, t: &Term) -> Value {
        json!({ "id": id, "pid": t.session.pid(), "program": t.session.program(), "requested": t.program, "cwd": t.cwd, "meta": t.meta })
    }

    /// Starts one terminal: a program with its arguments, or with no program the user's shell.
    pub fn spawn(&self, a: &Value) -> Result<Value, String> {
        let program = a["program"].as_str().unwrap_or_default().to_string();
        let cwd = a["cwd"].as_str().map(str::to_string);
        let args: Vec<String> = a["args"].as_array().map(|v| v.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let cols = a["cols"].as_u64().and_then(|c| u16::try_from(c).ok()).filter(|c| *c > 0).unwrap_or(80);
        let rows = a["rows"].as_u64().and_then(|r| u16::try_from(r).ok()).filter(|r| *r > 0).unwrap_or(24);
        // T-184-b: a window sends the commands it built (program, folder, its whole environment,
        // fallbacks in order), so a pane starts exactly as it would in the window.
        let built: Vec<_> = a["commands"].as_array().into_iter().flatten().filter_map(crate::pty::link::command_from).collect();
        let mut cmds = if !built.is_empty() {
            built
        } else if program.is_empty() { crate::pty::shell_commands(cwd.as_deref(), None) } else { vec![crate::pty::program_command(&program, &args, cwd.as_deref())] };
        if let Some(env) = a["env"].as_object() {
            for cmd in &mut cmds {
                for (k, v) in env {
                    if let Some(v) = v.as_str() {
                        cmd.env(k, v);
                    }
                }
            }
        }
        let id = {
            let mut g = self.lock();
            g.next_term += 1;
            let id = g.next_term;
            g.snaps.insert(id, Snap::default());
            g.flows.insert(id, Arc::new(Flow::default()));
            id
        };
        let out = self.inner.clone();
        let gone = self.inner.clone();
        let started = PtySession::spawn_first(
            cmds,
            cols,
            rows,
            move |chunk| {
                let mut g = out.lock().unwrap_or_else(PoisonError::into_inner);
                let Some(seq) = g.snaps.get_mut(&id).map(|s| s.push(chunk)) else { return };
                let line = json!({ "ev": "output", "id": id, "data": b64(chunk), "seq": seq, "generation": generation() }).to_string();
                g.broadcast(&line);
                let (flow, attached) = (g.flows.get(&id).cloned(), !g.windows.is_empty());
                drop(g);
                // AFTER-699: after the bookkeeping and outside the lock, this terminal's own reader
                // waits for the window's pane to catch up.
                if let Some(f) = flow {
                    hold(&f, attached, chunk.len() as u64);
                }
            },
            move |code| {
                let mut g = gone.lock().unwrap_or_else(PoisonError::into_inner);
                let ended = g.terms.remove(&id);
                g.snaps.remove(&id);
                if let Some(f) = g.flows.remove(&id) {
                    f.release();
                }
                let line = json!({ "ev": "exit", "id": id, "code": code }).to_string();
                g.broadcast(&line);
                drop(g);
                drop(ended);
            },
        );
        let mut g = self.lock();
        match started {
            Ok(session) => {
                let term = Term { session, program, cwd: cwd.unwrap_or_default(), meta: a["meta"].clone() };
                let row = Self::row(id, &term);
                // A program that ended before this line already removed its tail: it is not kept.
                if g.snaps.contains_key(&id) {
                    g.terms.insert(id, term);
                }
                Ok(row)
            }
            Err(e) => {
                g.snaps.remove(&id);
                Err(e)
            }
        }
    }

    fn with_term<T>(&self, a: &Value, f: impl FnOnce(&mut Term) -> Result<T, String>) -> Result<T, String> {
        let id = a["id"].as_u64().and_then(|i| u32::try_from(i).ok()).ok_or("no terminal id")?;
        let mut g = self.lock();
        let t = g.terms.get_mut(&id).ok_or_else(|| format!("no terminal {id} in this service"))?;
        f(t)
    }

    /// One request of a connection that is not attached (or the attach itself, which `serve` handles).
    pub fn answer(&self, req: &Value) -> Result<Value, String> {
        match req["op"].as_str().unwrap_or_default() {
            "list" => {
                let g = self.lock();
                Ok(json!({ "terminals": g.terms.iter().map(|(id, t)| Self::row(*id, t)).collect::<Vec<_>>(), "windows": g.windows.len() }))
            }
            "spawn" => self.spawn(req),
            "write" => {
                // APP-052: typing meant for another run of the service never reaches this one's terminals.
                crate::terminal::owns(req["generation"].as_u64())?;
                let data = base64::engine::general_purpose::STANDARD.decode(req["data"].as_str().unwrap_or_default()).map_err(|e| e.to_string())?;
                // Written outside the lock: a program that is not reading must not hold up output.
                let writer = self.with_term(req, |t| t.session.writer())?;
                crate::pty::write_shared(&writer, &data).map(|_| json!({}))
            }
            "resize" => {
                let cols = req["cols"].as_u64().and_then(|c| u16::try_from(c).ok()).ok_or("no cols")?;
                let rows = req["rows"].as_u64().and_then(|r| u16::try_from(r).ok()).ok_or("no rows")?;
                // T-619 (R06-terminal-process.2): resized after the lock is let go, since a resize can wait
                // on the very output the pump needs this lock for (pty_window_ops.rs).
                let (master, size) = self.with_term(req, |t| Ok((t.session.master.clone(), t.session.size.clone())))?;
                resize_outside(master, size, cols, rows).map(|_| json!({}))
            }
            "kill" => {
                // T-619 (R06-terminal-process.2, Row 784 here too): the terminal leaves the service under
                // the lock and is ended after it is let go, as on_exit and end_all do. Ending it runs
                // ClosePseudoConsole, which can wait for its output to drain (Windows 10, Windows 11
                // before 24H2), and draining needs this lock; its reader stops waiting for a pane too.
                let id = req["id"].as_u64().and_then(|i| u32::try_from(i).ok()).ok_or("no terminal id")?;
                let gone = {
                    let mut g = self.lock();
                    let t = g.terms.remove(&id).ok_or_else(|| format!("no terminal {id} in this service"))?;
                    if let Some(f) = g.flows.remove(&id) {
                        f.release();
                    }
                    t
                };
                drop(gone);
                Ok(json!({}))
            }
            "stop" => {
                self.lock().stopping = true;
                Ok(json!({}))
            }
            // AFTER-699: the window's pane drew `bytes` more of a terminal's output; `behind` is true
            // once after this terminal's reader gave up waiting for the pane (ORCH-057: a snapshot is
            // due). A terminal that is gone has nothing to count: not behind.
            "ack" => {
                let id = req["id"].as_u64().and_then(|i| u32::try_from(i).ok()).ok_or("no terminal id")?;
                let bytes = req["bytes"].as_u64().ok_or("no byte count")?;
                let flow = self.lock().flows.get(&id).cloned();
                Ok(json!({ "behind": flow.is_some_and(|f| f.ack(bytes)) }))
            }
            other => Err(format!("unknown request {other:?}")),
        }
    }

    /// Registers `tx` as an attached window and queues the attach answer on it first, all under one
    /// lock, so every output event after a terminal's tail reaches the window after the tail.
    fn attach(&self, conn: u64, re: &Value, tx: &Sender<String>) {
        let mut g = self.lock();
        let Inner { terms, snaps, .. } = &mut *g;
        let rows: Vec<Value> = terms
            .iter()
            .map(|(id, t)| {
                let mut row = Self::row(*id, t);
                if let Some(s) = snaps.get_mut(id).map(Snap::snapshot) {
                    row["seq"] = json!(s.seq);
                    row["data"] = json!(s.data);
                }
                row
            })
            .collect();
        let _ = tx.send(json!({ "re": re, "ok": true, "result": { "terminals": rows, "generation": generation() } }).to_string());
        g.windows.insert(conn, tx.clone());
    }

    fn detach(&self, conn: u64) {
        let mut g = self.lock();
        g.windows.remove(&conn);
        // AFTER-699: with no window left there is no pane to wait for; every paused reader goes on.
        if g.windows.is_empty() {
            for f in g.flows.values() {
                f.release();
            }
        }
    }

    fn next_conn(&self) -> u64 {
        let mut g = self.lock();
        g.next_conn += 1;
        g.next_conn
    }

    /// Ends every terminal (the service is stopping).
    pub fn end_all(&self) {
        let ended = std::mem::take(&mut self.lock().terms);
        drop(ended);
    }

    /// One connection: the hello, then requests until it closes. Every line out goes through one
    /// writer thread, so answers and events never interleave mid-line.
    fn serve(&self, stream: TcpStream, cfg: &Config) {
        let Ok(out) = stream.try_clone() else { return };
        let (tx, rx) = mpsc::channel::<String>();
        let writer = std::thread::spawn(move || {
            let mut out = out;
            for line in rx {
                if out.write_all(line.as_bytes()).and_then(|_| out.write_all(b"\n")).is_err() {
                    break;
                }
            }
            let _ = out.shutdown(std::net::Shutdown::Both);
        });
        let conn = self.next_conn();
        let mut lines = BufReader::new(stream).lines();
        let hello: Value = lines.next().and_then(Result::ok).and_then(|l| serde_json::from_str(&l).ok()).unwrap_or(Value::Null);
        let refused = if hello["op"] != "hello" {
            Some("the first line must be a hello")
        } else if hello["token"].as_str() != Some(cfg.token.as_str()) {
            Some("the token does not match this terminal service")
        } else {
            None
        };
        let _ = match refused {
            Some(why) => tx.send(json!({ "ok": false, "error": why }).to_string()),
            None => tx.send(json!({ "ok": true, "result": { "generation": generation(), "protocol": cfg.protocol, "pid": std::process::id() } }).to_string()),
        };
        if refused.is_none() {
            for line in lines {
                let Ok(line) = line else { break };
                let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                let re = req["re"].clone();
                match req["op"].as_str() {
                    Some("attach") => self.attach(conn, &re, &tx),
                    Some("detach") => {
                        self.detach(conn);
                        let _ = tx.send(json!({ "re": re, "ok": true, "result": {} }).to_string());
                    }
                    _ => {
                        let reply = match self.answer(&req) {
                            Ok(r) => json!({ "re": re, "ok": true, "result": r }),
                            Err(e) => json!({ "re": re, "ok": false, "error": e }),
                        };
                        let _ = tx.send(reply.to_string());
                    }
                }
            }
        }
        self.detach(conn);
        drop(tx);
        let _ = writer.join();
    }

    /// Accepts connections until the idle rule says stop (or `stop` is set). `now` is the clock.
    pub fn run(&self, listener: TcpListener, cfg: Config, now: impl Fn() -> Instant, stop: &AtomicBool) -> std::io::Result<()> {
        listener.set_nonblocking(true)?;
        let cfg = Arc::new(cfg);
        let mut idle = Idle::new(cfg.idle);
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let (me, cfg) = (self.clone(), cfg.clone());
                    std::thread::spawn(move || me.serve(stream, &cfg));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(POLL),
                Err(e) => return Err(e),
            }
            let (panes, windows) = self.counts();
            if idle.tick(now(), panes, windows) || self.lock().stopping {
                break;
            }
        }
        Ok(())
    }
}

/// The service process: `args` are what follows the app program's name (`--terminal-service
/// <identifier> <data folder>`). A second copy exits with `lifecycle::DUPLICATE_EXIT`.
pub fn main(args: &[String]) -> i32 {
    let (Some(identifier), Some(dir)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: {FLAG} <identifier> <data folder>");
        return 2;
    };
    let dir = PathBuf::from(dir);
    let Some(_held) = lock(identifier, &dir) else { return crate::lifecycle::DUPLICATE_EXIT };
    // TERM-115: the service is started in its own process group, which hands "ignore Ctrl+C" down to
    // every shell it starts; cleared before the first one, so a pane's Ctrl+C reaches its program.
    #[cfg(windows)]
    // SAFETY: a documented call on this process's own console state; no pointers are passed.
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
    }
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("the terminal service could not listen: {e}");
            return 1;
        }
    };
    let token = crate::cli::secret();
    let pid = std::process::id();
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    if let Err(e) = write_endpoint(&dir, &Endpoint { port, token: token.clone(), pid, generation: generation(), protocol: PROTOCOL }) {
        eprintln!("the terminal service could not write {ENDPOINT_FILE}: {e}");
        return 1;
    }
    let service = Service::default();
    let result = service.run(listener, Config { token, protocol: PROTOCOL, idle: IDLE_LIMIT }, Instant::now, &AtomicBool::new(false));
    service.end_all();
    remove_endpoint_if_ours(&dir, pid);
    i32::from(result.is_err())
}

// ---------------------------------------------------------------- the client side

/// One connection to the service after a good hello.
pub struct Client {
    reader: BufReader<TcpStream>,
    out: TcpStream,
    next: u64,
    pub hello: Value,
}

impl Client {
    pub fn connect(ep: &Endpoint, wait: Duration) -> Result<Client, String> {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], ep.port));
        let stream = TcpStream::connect_timeout(&addr, wait).map_err(|e| e.to_string())?;
        stream.set_read_timeout(Some(wait)).map_err(|e| e.to_string())?;
        let mut out = stream.try_clone().map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream);
        writeln!(out, "{}", json!({ "op": "hello", "token": ep.token, "protocol": PROTOCOL })).map_err(|e| e.to_string())?;
        let reply = Self::read_line(&mut reader)?;
        if reply["ok"] != true {
            return Err(reply["error"].as_str().unwrap_or("the terminal service refused the connection").to_string());
        }
        Ok(Client { reader, out, next: 0, hello: reply["result"].clone() })
    }

    /// How long a read waits (None: for as long as it takes, the window's event connection).
    pub fn set_wait(&mut self, wait: Option<Duration>) -> Result<(), String> {
        // Windows keeps a socket's timeout per handle: it must go on the one that reads, not `out`.
        self.reader.get_ref().set_read_timeout(wait).map_err(|e| e.to_string())
    }

    /// The service's protocol, from its hello.
    pub fn protocol(&self) -> u32 {
        self.hello["protocol"].as_u64().and_then(|p| u32::try_from(p).ok()).unwrap_or(0)
    }

    /// Sends one request and waits for its answer; events that arrive first (attached
    /// connections) go to `events`.
    pub fn request(&mut self, mut req: Value, events: &mut Vec<Value>) -> Result<Value, String> {
        self.next += 1;
        req["re"] = json!(self.next);
        writeln!(self.out, "{req}").map_err(|e| e.to_string())?;
        loop {
            let v = self.read()?;
            if v["re"] == json!(self.next) {
                return if v["ok"] == true { Ok(v["result"].clone()) } else { Err(v["error"].as_str().unwrap_or("refused").to_string()) };
            }
            events.push(v);
        }
    }

    /// The next line from the service (an event once attached).
    pub fn read(&mut self) -> Result<Value, String> {
        Self::read_line(&mut self.reader)
    }

    fn read_line(reader: &mut BufReader<TcpStream>) -> Result<Value, String> {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("the terminal service closed the connection".into());
        }
        serde_json::from_str(&line).map_err(|e| e.to_string())
    }
}

/// AFTER-696: ends the running service (and with it every shell it holds) before an update
/// replaces the program it runs from. True once nothing answers and its process is gone; a
/// service too old to know `stop` is ended by its pid. `wait` is ONE deadline for the whole call
/// (probes, the stop reply, the graceful wait and the check after the kill): the quit watchdog
/// counts on it (row 1014). A recorded process that is alive but does not answer is never
/// killed (the record may be stale and the pid reused): it is waited for until the deadline and
/// then reads as not stopped (row 1031).
pub fn stop(dir: &Path, wait: Duration) -> bool {
    // A probe or read is never given less than this, so a nearly spent deadline still gets one look.
    const FLOOR: Duration = Duration::from_millis(50);
    let start = Instant::now();
    let until = start + wait;
    let left = |t: Instant| t.saturating_duration_since(Instant::now());
    let me = std::process::id();
    let mut first = probe(dir, PROBE_WAIT.min(wait).max(FLOOR));
    let (ep, client) = loop {
        match first {
            Probe::Ready(ep, c) => break (ep, Some(c)),
            // Our token was accepted and only the protocol was refused: the recorded pid is that service's own.
            Probe::Refused(why) if !why.starts_with(TOKEN_REFUSED) => match read_endpoint(dir) {
                Some(ep) => break (ep, None),
                None => return true,
            },
            // No answer, or a token refusal (the port may belong to another Kolux while the record is stale): the pid is unverified.
            Probe::None | Probe::Refused(_) => {
                let Some(ep) = read_endpoint(dir) else { return true };
                // Nothing to wait for: an in-process service has no pid of its own, and a dead pid is a stopped one.
                if ep.pid == me || crate::procs::wait_gone(&[ep.pid], Duration::ZERO).is_empty() {
                    return true;
                }
                if Instant::now() >= until {
                    return false;
                }
                std::thread::sleep(POLL.min(left(until)));
                first = probe(dir, PROBE_WAIT.min(left(until)).max(FLOOR));
            }
        }
    };
    let own = ep.pid == me;
    // An in-process service has no pid to kill, so it gets the whole deadline; any other gets half, then the kill.
    // One that would not take `stop` at all (refused) has nothing to wait for.
    let graceful_end = if own {
        until
    } else if client.is_some() {
        start + wait / 2
    } else {
        Instant::now()
    };
    if let Some(mut c) = client {
        let _ = c.set_wait(Some(left(graceful_end).max(FLOOR)));
        let _ = c.request(json!({ "op": "stop" }), &mut Vec::new());
    }
    let gone = |end: Instant| loop {
        if matches!(probe(dir, PROBE_WAIT.min(left(end)).max(FLOOR)), Probe::None) && (own || crate::procs::wait_gone(&[ep.pid], POLL).is_empty()) {
            return true;
        }
        if Instant::now() >= end {
            return false;
        }
        std::thread::sleep(POLL.min(left(end)));
    };
    if gone(graceful_end) {
        return true;
    }
    if own {
        return false;
    }
    // ponytail: taskkill runs synchronously (~150-170 ms measured), so the deadline can overrun by that much; spawn + wait_timeout if it ever does.
    crate::procs::kill_tree(ep.pid);
    gone(until)
}

/// Starts the `Refused` reason of a service that did not accept this Kolux's token: whatever answers there did not write the recorded endpoint, so the record's pid is unverified.
const TOKEN_REFUSED: &str = "a terminal service answers for this profile but refused this Kolux";

/// What a look at the data folder finds.
#[derive(Debug)]
pub enum Probe {
    /// No service answers (no file, or a stale one nothing listens behind).
    None,
    Ready(Endpoint, Client),
    /// A service answers but this build must not use it.
    Refused(String),
}

pub fn probe(dir: &Path, wait: Duration) -> Probe {
    let Some(ep) = read_endpoint(dir) else { return Probe::None };
    // ux card 6: a service killed with its window leaves its record; a dead loopback port takes Windows ~2 s to refuse.
    if crate::procs::wait_gone(&[ep.pid], Duration::ZERO).is_empty() {
        return Probe::None;
    }
    match Client::connect(&ep, wait) {
        Ok(c) => match compatible(c.protocol()) {
            Ok(()) => Probe::Ready(ep, c),
            Err(why) => Probe::Refused(why),
        },
        Err(e) if e.contains("token") => Probe::Refused(format!("{TOKEN_REFUSED} ({e}); Kolux cannot safely open its window on it")),
        Err(_) => Probe::None,
    }
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").field("hello", &self.hello).finish()
    }
}

/// CLI-011: before `kolux open` starts the window. No service: start as usual (`None`). A service
/// holding the terminals: the window started next attaches to it, so open waits for that window as
/// it waits for any start (`Some` with the service's pid and run). A service this build cannot
/// pair with: the clear reason, and nothing is started.
pub fn before_open(dir: &Path) -> Result<Option<Value>, String> {
    match probe(dir, PROBE_WAIT) {
        Probe::None => Ok(None),
        Probe::Ready(ep, c) => Ok(Some(json!({ "pid": ep.pid, "generation": c.hello["generation"], "protocol": c.protocol() }))),
        Probe::Refused(why) => Err(why),
    }
}

/// The window's side: the running service, started with `launch` when none answers, waited for up
/// to `limit`. `launch` runs the app program with `FLAG` detached (see `launch_detached`).
pub fn ensure(dir: &Path, launch: impl FnOnce() -> Result<(), String>, limit: Duration) -> Result<(Endpoint, Client), String> {
    match probe(dir, PROBE_WAIT) {
        Probe::Ready(ep, c) => return Ok((ep, c)),
        Probe::Refused(why) => return Err(why),
        Probe::None => {}
    }
    launch()?;
    let until = Instant::now() + limit;
    loop {
        match probe(dir, PROBE_WAIT) {
            Probe::Ready(ep, c) => return Ok((ep, c)),
            Probe::Refused(why) => return Err(why),
            Probe::None if Instant::now() >= until => return Err(format!("the background terminal service did not answer within {} s", limit.as_secs())),
            Probe::None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// T-595 (CLI-011, R01-cli.4, L2-rust-crates.2): the folder a Kolux program started for the user works
/// in: the program's own folder, never the caller's, so Windows can still delete or rename the folder
/// `kolux open` ran in (a worktree) while Kolux and this service run, and a DLL planted there is never
/// searched for. A relative program path (a test's KOLUX_APP_EXECUTABLE) keeps the caller's folder,
/// since moving would change which file it names.
pub fn start_dir(exe: &Path) -> Option<&Path> {
    exe.parent().filter(|_| exe.is_absolute())
}

/// `exe FLAG identifier dir`, quiet, in the program's own folder.
fn detached(exe: &Path, identifier: &str, dir: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg(FLAG).arg(identifier).arg(dir);
    if let Some(own) = start_dir(exe) {
        cmd.current_dir(own);
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd
}

/// Starts `exe FLAG identifier dir` with no console and outside the window's process group, so
/// closing the window or its terminal leaves it running.
pub fn launch_detached(exe: &Path, identifier: &str, dir: &Path) -> Result<(), String> {
    let mut cmd = detached(exe, identifier, dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB, then without the
        // breakaway when an enclosing job does not allow it (the app-wide job does: procs::Job::app).
        if cmd.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0100_0000).spawn().is_ok() {
            return Ok(());
        }
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("the background terminal service could not start: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-t075b-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// An in-process service on its own thread, with its endpoint written to `dir`.
    struct Running {
        service: Service,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
        ep: Endpoint,
    }

    impl Drop for Running {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            self.service.end_all();
        }
    }

    fn start(dir: &Path, protocol: u32, idle: Duration) -> Running {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let ep = Endpoint { port: listener.local_addr().unwrap().port(), token: crate::cli::secret(), pid: std::process::id(), generation: generation(), protocol };
        write_endpoint(dir, &ep).unwrap();
        let service = Service::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (s, st, token) = (service.clone(), stop.clone(), ep.token.clone());
        let thread = std::thread::spawn(move || s.run(listener, Config { token, protocol, idle }, Instant::now, &st).unwrap());
        Running { service, stop, thread: Some(thread), ep }
    }

    #[test]
    fn t075b_one_service_per_identifier_and_profile_and_the_lock_frees_when_it_ends() {
        let id = format!("kolux-rs.t075b-test-{}", std::process::id());
        let real = Path::new(r"C:\Users\me\AppData\Roaming\com.x");
        let scratch = Path::new(r"G:\Temp\live-installed\home\AppData\Roaming\com.x");
        assert!(lock_name("com.x", real).starts_with("Local\\com.x.terminals-"));
        let first = lock(&id, real).expect("the first copy holds the lock");
        if cfg!(windows) {
            assert!(lock(&id, real).is_none(), "a second copy of the same profile is refused while the first runs");
            // Another identifier (a lane or trial build) and another profile (a proof copy) are not blocked.
            assert!(lock(&format!("{id}.other"), real).is_some());
            assert!(lock(&id, scratch).is_some(), "a proof copy on its own profile runs beside the real app");
        }
        drop(first);
        assert!(lock(&id, real).is_some(), "the lock is free again once the first copy ends");
    }

    #[test]
    fn t075b_idle_exit_only_after_ten_minutes_with_no_terminal_and_no_window() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        assert_eq!(IDLE_LIMIT, Duration::from_secs(600));
        let mut idle = Idle::new(IDLE_LIMIT);
        // A terminal or a window keeps it alive however long.
        assert!(!idle.tick(at(0), 1, 0));
        assert!(!idle.tick(at(5000), 0, 1));
        // Both gone: the count starts now and ends at the limit, not a second before.
        assert!(!idle.tick(at(5001), 0, 0));
        assert!(!idle.tick(at(5001 + 599), 0, 0));
        // A window attaching in between starts the count over.
        assert!(!idle.tick(at(5001 + 599), 0, 1));
        assert!(!idle.tick(at(5700), 0, 0));
        assert!(!idle.tick(at(5700 + 599), 0, 0));
        assert!(idle.tick(at(5700 + 600), 0, 0));
    }

    #[test]
    fn t075b_the_run_loop_stops_by_itself_when_idle_and_not_while_a_window_is_attached() {
        let dir = scratch("idle");
        let mut s = start(&dir, PROTOCOL, Duration::from_millis(600));
        let mut w = Client::connect(&s.ep, Duration::from_secs(5)).unwrap();
        w.request(json!({ "op": "attach" }), &mut Vec::new()).unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        assert!(!s.thread.as_ref().unwrap().is_finished(), "an attached window keeps the service running");
        w.request(json!({ "op": "detach" }), &mut Vec::new()).unwrap();
        let until = Instant::now() + Duration::from_secs(10);
        while !s.thread.as_ref().unwrap().is_finished() {
            assert!(Instant::now() < until, "the idle service did not stop");
            std::thread::sleep(Duration::from_millis(50));
        }
        s.thread.take().unwrap().join().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn after699_a_flood_in_a_service_terminal_waits_for_the_window_and_for_nobody_when_no_window_is_attached() {
        use crate::terminal::FLOW_HIGH;
        let service = Service::default();
        let flow = Arc::new(Flow::default());
        service.lock().flows.insert(7, flow.clone());
        // No window attached: a flood is never held (nothing would ever acknowledge it).
        let t = Instant::now();
        hold_within(&flow, false, FLOW_HIGH * 3, Duration::from_secs(5));
        // The wait asked for is 5 s, so 2 s still tells "not held" from "held"; 200 ms flaked under a loaded full run.
        assert!(t.elapsed() < Duration::from_secs(2), "held with no window: {:?}", t.elapsed());
        // A window attached: past the high mark the reader waits until the window's pane acknowledges.
        let (tx, _rx) = mpsc::channel::<String>();
        service.lock().windows.insert(1, tx);
        let acker = service.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            acker.answer(&json!({ "op": "ack", "id": 7, "bytes": FLOW_HIGH })).unwrap()
        });
        let t = Instant::now();
        hold_within(&flow, true, FLOW_HIGH, Duration::from_secs(5));
        let took = t.elapsed();
        assert_eq!(h.join().unwrap(), json!({ "behind": false }));
        assert!(took >= Duration::from_millis(120) && took < Duration::from_secs(4), "{took:?}");
        // A pane that never answers holds the reader for the wait only; the next ack says a snapshot is due, once.
        hold_within(&flow, true, FLOW_HIGH, Duration::from_millis(100));
        assert_eq!(service.answer(&json!({ "op": "ack", "id": 7, "bytes": 1 })).unwrap(), json!({ "behind": true }));
        assert_eq!(service.answer(&json!({ "op": "ack", "id": 7, "bytes": 1 })).unwrap(), json!({ "behind": false }));
        // The last window going away lets a paused reader go at once.
        let releaser = service.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            releaser.detach(1);
        });
        let t = Instant::now();
        hold_within(&flow, true, FLOW_HIGH, Duration::from_secs(5));
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(4), "{:?}", t.elapsed());
        assert_eq!(service.counts(), (0, 0));
        // An ack for a terminal that is gone counts nothing and is not an error; a malformed one is.
        assert_eq!(service.answer(&json!({ "op": "ack", "id": 99, "bytes": 5 })).unwrap(), json!({ "behind": false }));
        assert!(service.answer(&json!({ "op": "ack", "id": 7 })).is_err());
    }

    #[test]
    fn after696_an_update_stops_the_service_even_while_it_holds_a_terminal() {
        let dir = scratch("after696");
        // Load flake fix: a shell that dies on its own under load (its process refused to start) leaves
        // no terminal to hold, so the idle exit is right; that attempt is retried (3 at most). The
        // failure is the service ending while its terminal is still counted.
        let mut s = None;
        for attempt in 1..=3 {
            let running = start(&dir, PROTOCOL, Duration::from_millis(300));
            let mut ctl = Client::connect(&running.ep, Duration::from_secs(30)).unwrap();
            ctl.request(json!({ "op": "spawn", "cols": 80, "rows": 24 }), &mut Vec::new()).unwrap();
            drop(ctl);
            std::thread::sleep(Duration::from_millis(900));
            let held = running.service.counts().0 > 0;
            assert!(!(held && running.thread.as_ref().unwrap().is_finished()), "a held terminal keeps the idle rule from ending it");
            if held {
                s = Some(running);
                break;
            }
            assert!(attempt < 3, "the shell ended by itself on all 3 attempts");
            eprintln!("after696: attempt {attempt}: the shell ended by itself; trying again");
        }
        let mut s = s.unwrap();
        // `stop` can come back early when a loaded machine is slow to answer its probe: ask again, 3 times at most.
        // In-process, `stop` sees the listener go a hair before the run thread has returned.
        for round in 1..=3 {
            assert!(stop(&dir, Duration::from_secs(30)), "stop reports the service gone");
            let until = Instant::now() + Duration::from_secs(10);
            while !s.thread.as_ref().unwrap().is_finished() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(10));
            }
            if s.thread.as_ref().unwrap().is_finished() {
                break;
            }
            assert!(round < 3, "the run loop ended on the stop request");
        }
        assert!(matches!(probe(&dir, Duration::from_secs(2)), Probe::None), "nothing answers afterwards");
        s.thread.take().unwrap().join().unwrap();
        // No service at all: nothing to stop.
        assert!(stop(&dir, Duration::from_secs(1)));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A listener that answers every hello and nothing else, until `done` is set (a service that ignores `stop`).
    fn deaf_service(dir: &Path, pid: u32, protocol: Option<u32>) -> (Arc<AtomicBool>, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let ep = Endpoint { port: listener.local_addr().unwrap().port(), token: "t".into(), pid, generation: 1, protocol: protocol.unwrap_or(PROTOCOL) };
        write_endpoint(dir, &ep).unwrap();
        let done = Arc::new(AtomicBool::new(false));
        let flag = done.clone();
        let thread = std::thread::spawn(move || {
            let mut conns = Vec::new();
            while !flag.load(Ordering::SeqCst) {
                if let Ok((conn, _)) = listener.accept() {
                    conn.set_nonblocking(false).unwrap();
                    let mut out = conn.try_clone().unwrap();
                    let mut line = String::new();
                    if BufReader::new(conn.try_clone().unwrap()).read_line(&mut line).is_ok() {
                        // None: the token is refused, as a service that did not write this record would.
                        let reply = protocol.map_or(json!({ "ok": false, "error": "wrong token" }), |p| json!({ "ok": true, "result": { "protocol": p } }));
                        writeln!(out, "{reply}").unwrap();
                    }
                    conns.push(conn);
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        (done, thread)
    }

    #[test]
    fn row1014_stop_ends_at_its_one_deadline_when_the_service_ignores_it() {
        let limit = Duration::from_secs(2);
        // Another process's service: half the deadline of grace, then the kill, inside one deadline.
        let dir = scratch("row1014-other");
        let mut child = sleeper();
        let (done, thread) = deaf_service(&dir, child.id(), Some(PROTOCOL));
        let t = Instant::now();
        // The pid dies at the halfway kill, and a dead pid reads as a stopped service even though the listener still answers.
        assert!(stop(&dir, limit), "the kill at the halfway point ends it");
        let took = t.elapsed();
        eprintln!("row1014: other-pid stop took {took:?}");
        assert!(took >= Duration::from_millis(900) && took < Duration::from_millis(2500), "{took:?}");
        let _ = child.kill();
        let _ = child.wait();
        done.store(true, Ordering::SeqCst);
        thread.join().unwrap();
        let _ = std::fs::remove_dir_all(dir);
        // This process's own service: no kill, the graceful wait takes the whole deadline.
        let dir = scratch("row1014-own");
        let (done, thread) = deaf_service(&dir, std::process::id(), Some(PROTOCOL));
        let t = Instant::now();
        assert!(!stop(&dir, limit));
        let took = t.elapsed();
        eprintln!("row1014: own-pid stop took {took:?}");
        assert!(took >= Duration::from_millis(1500) && took < Duration::from_millis(3000), "{took:?}");
        done.store(true, Ordering::SeqCst);
        thread.join().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    fn sleeper() -> std::process::Child {
        if cfg!(windows) {
            // One process, no cmd.exe parent: a killed cmd would leave its ping holding any pipe handle it inherited from a parallel PTY test for 30 s.
            std::process::Command::new("ping.exe").args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap()
        } else {
            std::process::Command::new("sleep").arg("30").spawn().unwrap()
        }
    }

    #[test]
    fn row1031_a_service_this_build_refuses_is_ended_by_its_pid_and_a_silent_live_pid_is_never_killed() {
        let limit = Duration::from_secs(2);
        // A Kolux service answered the hello but this build refuses it (old protocol): its pid is confirmed, so it is killed at once.
        let dir = scratch("row1031-refused");
        let mut child = sleeper();
        let (done, thread) = deaf_service(&dir, child.id(), Some(0));
        let t = Instant::now();
        assert!(stop(&dir, limit), "the refused service's process was killed");
        let took = t.elapsed();
        eprintln!("row1031: refused-service stop took {took:?}");
        assert!(took < Duration::from_millis(1500), "{took:?}");
        let until = Instant::now() + Duration::from_secs(1);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < until, "stop returned true but the refused service's process is still running");
            std::thread::sleep(Duration::from_millis(20));
        }
        done.store(true, Ordering::SeqCst);
        thread.join().unwrap();
        let _ = std::fs::remove_dir_all(dir);
        // A token refusal: whatever answers did not write this record, so its pid is unverified and never killed.
        let dir = scratch("row1031-token");
        let mut child = sleeper();
        let (done, thread) = deaf_service(&dir, child.id(), None);
        let t = Instant::now();
        let stopped = stop(&dir, limit);
        let took = t.elapsed();
        eprintln!("row1031: token-refused stop took {took:?}");
        let alive = child.try_wait().unwrap().is_none();
        let _ = child.kill();
        let _ = child.wait();
        done.store(true, Ordering::SeqCst);
        thread.join().unwrap();
        assert!(!stopped && alive, "a token refusal is neither a stop nor a licence to kill (stopped {stopped}, alive {alive})");
        assert!(took >= Duration::from_millis(1800) && took < Duration::from_millis(2500), "{took:?}");
        let _ = std::fs::remove_dir_all(dir);
        // A recorded pid that is alive while nothing listens may be a reused pid: never killed, and the stop reads as failed at the deadline.
        let dir = scratch("row1031-silent");
        let mut child = sleeper();
        let closed = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        write_endpoint(&dir, &Endpoint { port: closed, token: "t".into(), pid: child.id(), generation: 1, protocol: PROTOCOL }).unwrap();
        let t = Instant::now();
        let stopped = stop(&dir, limit);
        let took = t.elapsed();
        eprintln!("row1031: silent live pid stop took {took:?}");
        let alive = child.try_wait().unwrap().is_none();
        let _ = child.kill();
        let _ = child.wait();
        assert!(!stopped, "a live pid nothing answers for is not a stopped service");
        assert!(took >= Duration::from_millis(1800) && took < Duration::from_millis(2500), "{took:?}");
        assert!(alive, "the unrelated live process must not be killed");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t075b_a_wrong_token_or_a_missing_hello_is_refused() {
        let dir = scratch("token");
        let s = start(&dir, PROTOCOL, IDLE_LIMIT);
        let wrong = Endpoint { token: "nope".into(), ..s.ep.clone() };
        let e = Client::connect(&wrong, Duration::from_secs(5)).unwrap_err();
        assert!(e.contains("token"), "{e}");
        // probe says so instead of starting a second service over it.
        write_endpoint(&dir, &wrong).unwrap();
        assert!(matches!(probe(&dir, Duration::from_secs(5)), Probe::Refused(_)));
        // A connection that skips the hello gets no terminal list.
        let mut raw = TcpStream::connect(("127.0.0.1", s.ep.port)).unwrap();
        raw.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        writeln!(raw, "{}", json!({ "op": "list" })).unwrap();
        let mut line = String::new();
        BufReader::new(raw).read_line(&mut line).unwrap();
        assert!(line.contains("\"ok\":false") && line.contains("hello"), "{line}");
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t075b_open_waits_for_a_compatible_service_and_refuses_an_incompatible_one() {
        let dir = scratch("open");
        // Nothing there, or a stale file nothing listens behind: open starts the app as usual.
        assert_eq!(before_open(&dir).unwrap(), None);
        let closed = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        write_endpoint(&dir, &Endpoint { port: closed, token: "t".into(), pid: 1, generation: 1, protocol: PROTOCOL }).unwrap();
        assert_eq!(before_open(&dir).unwrap(), None);
        // A service of this protocol: open goes on and the window attaches to it.
        let s = start(&dir, PROTOCOL, IDLE_LIMIT);
        let seen = before_open(&dir).unwrap().expect("the running service is found");
        assert_eq!((seen["pid"].as_u64(), seen["protocol"].as_u64()), (Some(u64::from(std::process::id())), Some(u64::from(PROTOCOL))));
        drop(s);
        // An older service: a clear reason, nothing started.
        let old = start(&dir, OLDEST_PROTOCOL - 1, IDLE_LIMIT);
        let why = before_open(&dir).unwrap_err();
        assert!(why.contains("older Kolux") && why.contains("cannot safely open its window"), "{why}");
        // ensure() refuses it too rather than starting a second service.
        let launched = std::cell::Cell::new(false);
        assert!(ensure(&dir, || { launched.set(true); Ok(()) }, Duration::ZERO).is_err() && !launched.get());
        drop(old);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t075b_ensure_starts_the_service_once_and_waits_for_it() {
        let dir = scratch("ensure");
        let holder: std::cell::RefCell<Option<Running>> = std::cell::RefCell::new(None);
        let (ep, c) = ensure(&dir, || { *holder.borrow_mut() = Some(start(&dir, PROTOCOL, IDLE_LIMIT)); Ok(()) }, Duration::from_secs(5)).unwrap();
        assert_eq!(ep.port, holder.borrow().as_ref().unwrap().ep.port);
        assert_eq!(c.protocol(), PROTOCOL);
        // Running already: not launched again.
        assert!(ensure(&dir, || Err("launched twice".into()), Duration::ZERO).is_ok());
        drop(holder);
        let e = ensure(&dir, || Ok(()), Duration::ZERO).unwrap_err();
        assert!(e.contains("did not answer"), "{e}");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The round trip: a terminal started through the service keeps running while no window is
    /// attached, and a window attaching later gets its earlier output and then its new output.
    #[test]
    fn t075b_a_terminal_outlives_its_window_and_a_new_window_gets_its_output_back() {
        let dir = scratch("attach");
        let s = start(&dir, PROTOCOL, IDLE_LIMIT);
        let mut events = Vec::new();
        // The console host asks where the cursor is before it draws; a window answers it.
        let answer_dsr = |c: &mut Client, ev: &Value, id: u64| {
            let text = String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(ev["data"].as_str().unwrap_or_default()).unwrap_or_default()).into_owned();
            if text.contains("\x1b[6n") {
                let _ = c.request(json!({ "op": "write", "id": id, "data": b64(b"\x1b[1;1R") }), &mut Vec::new());
            }
            text
        };
        let mut first = Client::connect(&s.ep, Duration::from_secs(10)).unwrap();
        let mut ctl = Client::connect(&s.ep, Duration::from_secs(10)).unwrap();
        first.request(json!({ "op": "attach" }), &mut events).unwrap();
        // The user's shell as the window would build it, minus the profile (see pty::without_profile).
        let mut shell = crate::pty::shell_commands(None, None);
        crate::pty::without_profile(&mut shell);
        let commands: Vec<Value> = shell.iter().map(crate::pty::link::command_json).collect();
        let row = ctl.request(json!({ "op": "spawn", "cols": 100, "rows": 30, "commands": commands }), &mut events).unwrap();
        let id = row["id"].as_u64().unwrap();
        assert_eq!(s.service.counts(), (1, 1));
        ctl.request(json!({ "op": "write", "id": id, "data": b64(b"echo kolux-t075b-before\r\n"), "generation": generation() }), &mut events).unwrap();
        let mut seen = String::new();
        // This wait includes the shell starting; the repo's real-shell tests give that 60 s (pty.rs).
        let until = Instant::now() + Duration::from_secs(60);
        while seen.matches("kolux-t075b-before").count() < 2 {
            assert!(Instant::now() < until, "marker not seen: {seen:?}");
            if let Ok(ev) = first.read() {
                if ev["ev"] == "output" && ev["id"] == id {
                    seen.push_str(&answer_dsr(&mut ctl, &ev, id));
                }
            }
        }
        // The window goes away: the terminal stays.
        drop(first);
        // The daemon notices the dropped connection on its own thread; under a loaded full run that takes seconds.
        let until = Instant::now() + Duration::from_secs(30);
        while s.service.counts() != (1, 0) {
            assert!(Instant::now() < until, "the closed window was not detached");
            std::thread::sleep(Duration::from_millis(20));
        }
        // Typing from a replaced run of the service is refused.
        let stale = ctl.request(json!({ "op": "write", "id": id, "data": b64(b"x"), "generation": generation() ^ 1 }), &mut events).unwrap_err();
        assert!(stale.contains("replaced"), "{stale}");
        ctl.request(json!({ "op": "write", "id": id, "data": b64(b"echo kolux-t075b-after\r\n") }), &mut events).unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        // A new window: the earlier output comes back with the terminal, then new output follows.
        let mut second = Client::connect(&s.ep, Duration::from_secs(10)).unwrap();
        let back = second.request(json!({ "op": "attach" }), &mut events).unwrap();
        let t = back["terminals"].as_array().unwrap().iter().find(|t| t["id"] == id).expect("the terminal is still there").clone();
        let tail = String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(t["data"].as_str().unwrap()).unwrap()).into_owned();
        assert!(tail.contains("kolux-t075b-before"), "{tail:?}");
        ctl.request(json!({ "op": "write", "id": id, "data": b64(b"echo kolux-t075b-again\r\n") }), &mut events).unwrap();
        let mut more = String::new();
        let until = Instant::now() + Duration::from_secs(30);
        while !more.contains("kolux-t075b-again") {
            assert!(Instant::now() < until, "new output not seen: {more:?}");
            if let Ok(ev) = second.read() {
                if ev["ev"] == "output" {
                    assert!(ev["seq"].as_u64().unwrap() > t["seq"].as_u64().unwrap(), "an event older than the tail was sent after it");
                    more.push_str(&answer_dsr(&mut ctl, &ev, id));
                }
            }
        }
        // kill ends it and the attached window hears the exit.
        ctl.request(json!({ "op": "kill", "id": id }), &mut events).unwrap();
        let until = Instant::now() + Duration::from_secs(15);
        loop {
            assert!(Instant::now() < until, "no exit event");
            if let Ok(ev) = second.read() {
                if ev["ev"] == "exit" && ev["id"] == id {
                    break;
                }
            }
        }
        assert_eq!(ctl.request(json!({ "op": "list" }), &mut events).unwrap()["terminals"], json!([]));
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t075b_the_endpoint_file_is_written_whole_and_removed_only_by_its_owner() {
        let dir = scratch("file");
        let ep = Endpoint { port: 1, token: "t".into(), pid: 42, generation: 7, protocol: PROTOCOL };
        write_endpoint(&dir, &ep).unwrap();
        assert_eq!(read_endpoint(&dir), Some(ep.clone()));
        remove_endpoint_if_ours(&dir, 41);
        assert!(read_endpoint(&dir).is_some(), "another process's file is left alone");
        remove_endpoint_if_ours(&dir, 42);
        assert!(read_endpoint(&dir).is_none());
        assert!(std::fs::read_dir(&dir).unwrap().next().is_none(), "no temporary file left behind");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// T-595 (CLI-011, R01-cli.4, L2-rust-crates.2): the service starts in its program's own folder, never
    /// in the folder the app was started from, and still gets its data folder as an argument.
    #[test]
    fn cli011_the_service_starts_in_its_own_folder_not_the_callers() {
        let exe = std::env::current_exe().unwrap();
        let data = scratch("t595");
        let cmd = detached(&exe, "id", &data);
        assert_eq!(cmd.get_current_dir(), exe.parent());
        assert_ne!(cmd.get_current_dir(), Some(std::env::current_dir().unwrap().as_path()), "the caller's folder");
        assert_eq!(cmd.get_args().collect::<Vec<_>>(), [std::ffi::OsStr::new(FLAG), "id".as_ref(), data.as_os_str()]);
        let _ = std::fs::remove_dir_all(data);
    }

    /// T-619: starts `list`, which needs the service lock, and says whether it answered within 2 s;
    /// the caller joins the probe after it lets its stall go.
    fn list_answers(service: &Service) -> (bool, std::thread::JoinHandle<()>) {
        let (done_tx, done_rx) = mpsc::channel();
        let prober = service.clone();
        let probe = std::thread::spawn(move || {
            let _ = prober.answer(&json!({ "op": "list" }));
            let _ = done_tx.send(());
        });
        (done_rx.recv_timeout(Duration::from_secs(2)).is_ok(), probe)
    }

    /// T-619 (R06-terminal-process.2): the service's copy of terminal.rs's Row 784 tests. Closing a pane
    /// whose teardown stalls (ClosePseudoConsole waiting for output to drain, on Windows 10 and Windows
    /// 11 before 24H2) must not hold the lock every pane's output needs. A fake session whose input
    /// stalls when it is closed stands in for the stalled console.
    #[test]
    fn row784_a_stalled_kill_does_not_hold_the_service_lock() {
        struct StallsOnClose(mpsc::Sender<()>, Arc<(Mutex<bool>, std::sync::Condvar)>);
        impl Write for StallsOnClose {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        impl Drop for StallsOnClose {
            fn drop(&mut self) {
                let _ = self.0.send(());
                let (open, cv) = &*self.1;
                let guard = open.lock().unwrap();
                let _ = cv.wait_timeout_while(guard, Duration::from_secs(10), |o| !*o);
            }
        }
        let service = Service::default();
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let (entered_tx, entered_rx) = mpsc::channel();
        let session = PtySession::fake(Box::new(StallsOnClose(entered_tx, Arc::clone(&gate))));
        service.lock().terms.insert(1, Term { session, program: String::new(), cwd: String::new(), meta: Value::Null });
        service.lock().flows.insert(1, Arc::new(Flow::default()));
        let closer = service.clone();
        let closing = std::thread::spawn(move || closer.answer(&json!({ "op": "kill", "id": 1 })));
        let stalled = entered_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        let (free, probe) = list_answers(&service);
        // Release the stall first, so a failing run still ends both threads.
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        assert_eq!(closing.join().unwrap(), Ok(json!({})));
        probe.join().unwrap();
        assert!(stalled, "the kill never reached the stalled teardown");
        assert!(free, "list waited behind a stalled kill");
        assert_eq!(service.answer(&json!({ "op": "list" })).unwrap()["terminals"], json!([]), "the killed terminal is off the list");
        assert!(service.lock().flows.is_empty(), "its reader no longer waits for a pane");
        assert!(service.answer(&json!({ "op": "kill", "id": 1 })).unwrap_err().contains("no terminal 1"));
    }

    /// T-619: a resize that has to wait on its terminal (ResizePseudoConsole can wait on the very output
    /// the pump needs the service lock for) must not hold that lock either. The test holds the
    /// terminal's own master lock, which is where a real resize waits.
    #[test]
    fn t619_a_resize_waiting_on_its_terminal_does_not_hold_the_service_lock() {
        let service = Service::default();
        let id = service.answer(&json!({ "op": "spawn", "cols": 80, "rows": 24 })).unwrap()["id"].as_u64().unwrap();
        let master = service.lock().terms[&(id as u32)].session.master.clone().expect("a real terminal has a master");
        let held = master.lock().unwrap();
        let resizer = service.clone();
        let resizing = std::thread::spawn(move || resizer.answer(&json!({ "op": "resize", "id": id, "cols": 100, "rows": 30 })));
        // Give the resize time to reach the master lock and wait there.
        std::thread::sleep(Duration::from_millis(200));
        let (free, probe) = list_answers(&service);
        drop(held);
        assert_eq!(resizing.join().unwrap(), Ok(json!({})));
        probe.join().unwrap();
        assert!(free, "list waited behind a resize that waits on its terminal");
        assert_eq!(master.lock().unwrap().get_size().unwrap().cols, 100, "the resize still happened");
        service.end_all();
    }
    /// ux card 6: Windows takes about 2 s to refuse a dead loopback port, and a service killed with its window leaves its
    /// record behind; a record whose process is gone must read as "no service" at once.
    #[test]
    fn ux6_a_recorded_service_whose_process_is_gone_is_not_dialled() {
        let dir = scratch("ux6gone");
        let port = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        let mut done = if cfg!(windows) { std::process::Command::new("cmd").args(["/C", "exit"]).spawn() } else { std::process::Command::new("true").spawn() }.unwrap();
        let pid = done.id();
        done.wait().unwrap();
        write_endpoint(&dir, &Endpoint { port, token: "t".into(), pid, generation: 1, protocol: PROTOCOL }).unwrap();
        let t = Instant::now();
        assert!(matches!(probe(&dir, PROBE_WAIT), Probe::None));
        assert!(t.elapsed() < Duration::from_millis(500), "took {:?}", t.elapsed());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn term106_an_event_connection_waits_past_the_connect_timeout() {
        // A quiet shell sends nothing for seconds; the attached read must outlast the connect wait.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut hello = String::new();
            BufReader::new(conn.try_clone().unwrap()).read_line(&mut hello).unwrap();
            writeln!(conn, "{}", json!({ "ok": true, "result": {} })).unwrap();
            std::thread::sleep(Duration::from_millis(900));
            writeln!(conn, "{}", json!({ "ev": "output", "id": 1 })).unwrap();
        });
        let ep = Endpoint { port, token: "t".into(), pid: 1, generation: 1, protocol: PROTOCOL };
        let mut c = Client::connect(&ep, Duration::from_millis(300)).unwrap();
        c.set_wait(None).unwrap();
        let ev = c.read().expect("the event connection must not time out while idle");
        assert_eq!(ev["ev"], "output");
        server.join().unwrap();
    }
}
