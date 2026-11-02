//! The command line (PROJ-077, with the CLI-004 envelope and CLI-005 exit codes as its
//! foundation). The running app listens on a loopback port and writes the port and a token to
//! `cli.json` in its data folder; the `kolux-dev` program sends one JSON request per call and
//! prints the reply as text, or as the JSON envelope with `--json`. Exit status: 0 worked, 1
//! any error.

use crate::cli_accounts;
use crate::git::{Git, Worktree};
use crate::projects::{self, Project};
use crate::orchestration::sendonce as so;
use crate::state::Store;
use crate::terminal::Terminals;
use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::collections::BTreeMap;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use self::args::*;
use self::help::*;
use self::text::*;
pub use self::args::{parse, Parsed};
// Named here too, so the child modules reach them as `super::Command` and `super::HELP`.
use self::args::Command;
use self::help::HELP;

#[path = "../automations_cli.rs"]
mod automations_cli;
#[path = "../local_cli.rs"]
mod local_cli;
#[path = "../cli_register.rs"]
pub mod cli_register;
#[path = "../file_cli.rs"]
pub mod file_cli;
#[path = "../worker_read.rs"]
mod worker_read;
mod args;
mod help;
mod text;

/// SKILL-017: Kolux's own skill guides (name, guide text), listed on the Skills page as bundled.
pub fn bundled_skills() -> Vec<(&'static str, &'static str)> {
    local_cli::bundled()
}

/// Where the app says how to reach it, inside its data folder.
pub const FILE: &str = "cli.json";
/// The event the front end gets when the CLI made or removed a workspace.
pub const EVENT: &str = "cli-workspace";
const DATA_DIR: &str = "com.txaisxiong.kolux-rs";
/// The environment value that tells the CLI which running app opened its terminal (CLI-007).
pub const APP_DIR_ENV: &str = "KOLUX_APP_DIR";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Request {
    pub id: String,
    pub token: String,
    pub command: String,
    /// The folder the command was run in: the default repo and the meaning of `current`.
    pub cwd: String,
    pub args: Value,
    /// CLI-007: the Kolux terminal the call came from, read from its environment; the app checks
    /// the key against the one it gave that terminal (ORCH-001).
    #[serde(default)]
    pub pane: Option<Pane>,
    /// CLI-038: the version of the command line that sent it, so an app older than the CLI turns
    /// an orchestration change away before running it. Empty from a CLI that predates the field.
    #[serde(default)]
    pub cli: String,
    /// When the app took the connection, which can be well before it gets to answer: requests
    /// are answered one at a time (ORCH-017's repeat that joins the start ahead of it).
    #[serde(skip)]
    pub arrived: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pane {
    pub handle: String,
    pub key: String,
}

/// A refused or failed command: the error of the envelope (CLI-004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
    pub data: Value,
}

impl Fail {
    pub fn new(code: &'static str, message: impl Into<String>) -> Fail {
        Fail { code, message: message.into(), data: Value::Null }
    }
    fn args(message: impl Into<String>) -> Fail {
        Fail::new("invalid_arguments", message)
    }
}

impl From<String> for Fail {
    fn from(message: String) -> Fail {
        Fail::new("failed", message)
    }
}

/// The one object `--json` prints (CLI-004): request id, success flag, result or error, and the
/// runtime that answered in its metadata.
pub fn envelope(id: &str, runtime: &str, out: Result<Value, Fail>) -> Value {
    match out {
        Ok(result) => json!({ "requestId": id, "success": true, "result": result, "meta": { "runtimeId": runtime } }),
        Err(f) => json!({ "requestId": id, "success": false, "error": { "code": f.code, "message": f.message, "data": f.data }, "meta": { "runtimeId": runtime } }),
    }
}

/// CLI-007: a terminal Kolux started names its own app folder in `KOLUX_APP_DIR`, so the CLI
/// reaches the copy of Kolux that opened it (a development or side-by-side build included);
/// anywhere else it is the installed app's folder.
fn data_dir() -> PathBuf {
    // COMPAT 7: KOLUX_USER_DATA_PATH points the command at another build's data folder.
    if let Some(d) = std::env::var_os("KOLUX_USER_DATA_PATH").filter(|d| !d.is_empty()) {
        return d.into();
    }
    data_dir_of(std::env::var_os(APP_DIR_ENV), std::env::var_os("APPDATA"))
}

fn data_dir_of(own: Option<std::ffi::OsString>, appdata: Option<std::ffi::OsString>) -> PathBuf {
    match own.filter(|d| !d.is_empty()) {
        Some(d) => d.into(),
        None => appdata.map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join(DATA_DIR),
    }
}

/// CLI-004: when the app cannot be reached, text mode suggests starting it, unless the error
/// already carries its own recovery or the command was `open` itself.
fn open_first(f: &Fail, command: &str) -> Option<String> {
    // CLI-041: diagnostics memory says it in its one line, which already names `open`.
    (f.code == "app_unreachable" && command != "app.open" && command != MEMORY && f.data["hint"].is_null()).then(|| format!("run {} open to start it, then try again", crate::orchestration::CLI))
}

/// CLI-010: the one failure that means the app is down, with the command that fixes it.
fn unreachable_fail(why: String) -> Fail {
    Fail { code: "app_unreachable", message: format!("Kolux is not running; start it with `{} open` first", crate::orchestration::CLI), data: json!({ "detail": why }) }
}

/// The request reached the app, but its answer did not come back: the change may have happened.
fn lost(code: &'static str, message: String) -> Fail {
    Fail { code, message, data: json!({}) }
}

/// "0.2.0" is newer than "0.1.9"; a missing version is the oldest.
fn newer(a: &str, b: &str) -> bool {
    let v = |s: &str| s.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    !a.trim().is_empty() && v(a) > v(b)
}

/// CLI-038: a random version-4 UUID.
fn uuid() -> String {
    let h = format!("{}{}", secret(), secret());
    let variant = ['8', '9', 'a', 'b'][usize::from(h.as_bytes()[16] % 4)];
    format!("{}-{}-4{}-{variant}{}-{}", &h[0..8], &h[8..12], &h[13..16], &h[17..20], &h[20..32])
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// JSON whose double quotes Windows PowerShell 5.1 removed: braces or brackets and no quote left.
fn quotes_lost(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with('{') || t.starts_with('[')) && !t.contains('"') && t.len() > 2
}

/// The words of a command line as they could be typed again.
fn retype(words: &[String]) -> String {
    words.iter().map(|w| if w.is_empty() || w.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'') { format!("'{}'", w.replace('\'', "''")) } else { w.clone() }).collect::<Vec<_>>().join(" ")
}

/// Reads the app's reachability file: the port and the token.
fn read_endpoint(dir: &Path) -> Result<(u16, String), Fail> {
    let text = std::fs::read_to_string(dir.join(FILE)).map_err(|e| unreachable_fail(e.to_string()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| unreachable_fail(e.to_string()))?;
    match (v["port"].as_u64(), v["token"].as_str()) {
        (Some(p), Some(t)) => Ok((p as u16, t.to_string())),
        _ => Err(unreachable_fail(format!("{} has no port or token", dir.join(FILE).display()))),
    }
}

/// How long a request waits for the app's answer: long, because a request may itself wait
/// (`terminal wait --timeout-ms`, a worktree create with its setup).
const CALL_WAIT: Duration = Duration::from_secs(300);

/// CLI-012: how long the status question waits. The app answers one request at a time, so while a
/// long one runs the question is not read for minutes; a short wait tells "up, busy" apart from
/// "up, idle" without holding a script for the whole 300 s.
pub const STATUS_WAIT: Duration = Duration::from_millis(2500);

/// Sends one request and reads the envelope back. A reply with another id is refused (CLI-004).
pub fn call(port: u16, req: &Request) -> Result<Value, Fail> {
    call_within(port, req, CALL_WAIT)
}

/// `call` with its own limit on how long the answer may take.
pub fn call_within(port: u16, req: &Request, wait: Duration) -> Result<Value, Fail> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| unreachable_fail(e.to_string()))?;
    stream.set_read_timeout(Some(wait)).ok();
    let line = serde_json::to_string(req).map_err(|e| Fail::new("failed", e.to_string()))?;
    stream.write_all(line.as_bytes()).and_then(|_| stream.write_all(b"\n")).map_err(|e| lost("lost_result", format!("the connection to Kolux dropped while sending: {e}")))?;
    let mut reply = String::new();
    // CLI-010: a slow answer is not the app being down.
    match BufReader::new(stream).read_line(&mut reply) {
        Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Err(lost("timeout", format!("Kolux is running but did not answer within {} s; it may still be working", wait.as_secs_f64()))),
        Err(e) => return Err(lost("lost_result", format!("the connection to Kolux dropped before its answer came: {e}"))),
        Ok(0) => return Err(lost("lost_result", "the connection to Kolux closed before its answer came".into())),
        Ok(_) => {}
    }
    let mut v: Value = serde_json::from_str(&reply).map_err(|e| Fail::new("failed", format!("malformed reply from the app: {e}")))?;
    if v["requestId"].as_str() != Some(&req.id) {
        return Err(Fail::new("failed", "the app answered another request"));
    }
    // CLI-010: an app that does not know a command this CLI knows is older, and says so.
    let app = v["meta"]["appVersion"].as_str().unwrap_or_default().to_string();
    if v["error"]["code"] == "invalid_arguments" && v["error"]["message"].as_str().is_some_and(|m| m.starts_with("unknown command")) && app != VERSION {
        let shown = if app.is_empty() { "an older version".to_string() } else { app.clone() };
        v["error"] = json!({ "code": "version_gap", "message": format!("the running Kolux ({shown}) does not know {}; this command line is {VERSION}. Update Kolux, or restart it if it is already updated", req.command), "data": { "appVersion": app, "cliVersion": VERSION } });
    }
    Ok(v)
}

/// CLI-011: asks a running app to come forward; when none answers, starts it once and asks again
/// until it answers or `limit` has passed since the start. Box 2: `grant` runs before the first
/// ask, letting the running copy take the foreground (Windows refuses a window that merely asks
/// for it, leaving a taskbar flash); after the answer, `raise` brings the window of the pid the
/// app answered with forward from this side too, the way a second launch does, and its verdict
/// goes into the result as `raised` (null when the answer named no pid or this platform cannot
/// tell), so the command reports whether the window is in front instead of assuming it.
pub fn open(send: &dyn Fn() -> Result<Value, Fail>, launch: &dyn Fn() -> Result<(), Fail>, grant: &dyn Fn(), raise: &dyn Fn(u32) -> Option<bool>, limit: Duration) -> Result<Value, Fail> {
    grant();
    let mut env = match send() {
        Err(f) if f.code == "app_unreachable" => {
            launch()?;
            let until = Instant::now() + limit;
            loop {
                match send() {
                    Ok(mut env) => {
                        if let Some(r) = env["result"].as_object_mut() {
                            r.insert("started".into(), json!(true));
                        }
                        break env;
                    }
                    Err(f) if f.code != "app_unreachable" => return Err(f),
                    Err(f) if Instant::now() >= until => {
                        return Err(Fail { code: "app_unreachable", message: format!("Kolux was started but did not answer within {} s", limit.as_secs()), data: f.data });
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(250)),
                }
            }
        }
        answered => answered?,
    };
    let pid = env["result"]["pid"].as_u64().and_then(|p| u32::try_from(p).ok());
    let raised = pid.and_then(raise);
    if let Some(r) = env["result"].as_object_mut() {
        r.insert("raised".into(), json!(raised));
    }
    Ok(env)
}

/// CLI-041: the wire name of `kolux diagnostics memory`.
const MEMORY: &str = "diagnostics.memory";

/// CLI-012: the wire name of `kolux status`.
const STATUS: &str = "app.status";
/// CLI-012: the four answers of `kolux status`; scripts read these names, so they stay stable.
pub const STATES: [&str; 4] = ["running", "not-running", "stale", "graph-not-ready"];
/// CLI-012: set once the app has read every project's worktrees after it started.
static GRAPH_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// CLI-012: what the app answers to the status question: who it is, and whether its workspace
/// graph is loaded.
fn status_answer(graph: &std::sync::atomic::AtomicBool) -> Value {
    json!({ "pid": std::process::id(), "version": VERSION, "graphReady": graph.load(std::sync::atomic::Ordering::SeqCst) })
}

/// CLI-012: the detail `status` gives when the app took the question but had no time to answer it.
const STATUS_BUSY: &str = "busy with another request";

/// CLI-012: sends the status question to the app on `port`, waiting `STATUS_WAIT` for the answer.
pub fn ask_status(port: u16, token: &str, id: &str, cwd: &str) -> Result<Value, Fail> {
    call_within(port, &Request { id: id.into(), token: token.into(), command: STATUS.into(), cwd: cwd.into(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None }, STATUS_WAIT)
}

/// CLI-012: where the app stands, from its startup file in `dir` and whether anything answers on
/// the port the file names. `ask` sends the status question with the file's token. Never fails:
/// every outcome is one of the four states.
pub fn status_of(dir: &Path, ask: &dyn Fn(u16, &str) -> Result<Value, Fail>) -> Value {
    let file = dir.join(FILE);
    let shown = file.display().to_string();
    let text = match std::fs::read_to_string(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return json!({ "state": "not-running", "startupFile": shown }),
        Err(e) => return json!({ "state": "stale", "startupFile": shown, "detail": e.to_string() }),
        Ok(t) => t,
    };
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let pid = v["pid"].clone();
    let (Some(port), Some(token)) = (v["port"].as_u64().and_then(|p| u16::try_from(p).ok()), v["token"].as_str()) else {
        return json!({ "state": "stale", "startupFile": shown, "pid": pid, "detail": "the startup file has no port or token" });
    };
    let stale = |detail: &Value| json!({ "state": "stale", "startupFile": shown, "pid": pid, "port": port, "detail": detail });
    match ask(port, token) {
        Ok(env) if env["success"] == Value::Bool(true) => {
            let r = &env["result"];
            let ready = r["graphReady"] != Value::Bool(false);
            let mut out = json!({ "state": if ready { "running" } else { "graph-not-ready" }, "startupFile": shown, "pid": r["pid"], "port": port, "version": r["version"], "graphReady": ready });
            // T-076-c: busy with a request that has run this long, so a hang can be told from a long one.
            if let Some(ms) = r["busy"]["runningMs"].as_u64() {
                out["detail"] = json!(STATUS_BUSY);
                out["busyMs"] = json!(ms);
                out["busyCommand"] = r["busy"]["command"].clone();
                if let Some(n) = r["busy"]["queued"].as_u64().filter(|n| *n > 0) {
                    out["busyQueued"] = json!(n);
                }
            }
            out
        }
        // A token from another run: the file outlived the app that wrote it.
        Ok(env) if env["error"]["code"] == "unauthorized" => stale(&env["error"]["message"]),
        // An app too old to know the question still answered.
        Ok(env) => json!({ "state": "running", "startupFile": shown, "pid": pid, "port": port, "version": env["meta"]["appVersion"], "graphReady": true, "detail": env["error"]["message"] }),
        // Took the connection but had no time to answer within STATUS_WAIT: it is up, answering an
        // earlier request (the app takes one at a time), so the state stays running.
        Err(f) if f.code == "timeout" => json!({ "state": "running", "startupFile": shown, "pid": pid, "port": port, "graphReady": true, "detail": STATUS_BUSY }),
        // Nothing listens on the port, or the connection dropped: the app that wrote the file is gone.
        Err(f) => stale(&if f.data["detail"].is_null() { json!(f.message) } else { f.data["detail"].clone() }),
    }
}

/// CLI-012 with CLI-005: 0 only when the app is up and ready; 1 for the other three states.
fn status_exit(r: &Value) -> i32 {
    i32::from(r["state"] != "running")
}

/// Starts the app detached from this terminal: KOLUX_APP_EXECUTABLE, else the app program
/// beside this one (both are built and installed side by side).
/// ponytail: on Linux and macOS the app is only spawned, not put in its own session.
fn launch_app() -> Result<(), Fail> {
    let exe = match std::env::var_os("KOLUX_APP_EXECUTABLE").filter(|e| !e.is_empty()) {
        Some(e) => PathBuf::from(e),
        None => {
            // CLI-006: an installed CLI sits in the install's bin folder, one level below the app.
            let me = std::env::current_exe().map_err(|e| Fail::new("launch_failed", e.to_string()))?;
            let name = if cfg!(windows) { "kolux-rs.exe" } else { "kolux-rs" };
            let beside = me.with_file_name(name);
            match me.parent().and_then(Path::parent).map(|p| p.join(name)) {
                Some(up) if !beside.is_file() && up.is_file() => up,
                _ => beside,
            }
        }
    };
    app_command(&exe).spawn().map(drop).map_err(|e| Fail::new("launch_failed", format!("could not start Kolux from {}: {e}", exe.display())))
}

/// The app's command line for `launch_app`. T-595 (CLI-011, R01-cli.4): it runs in the app's own
/// folder (`service::start_dir`), never in the caller's.
fn app_command(exe: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(exe);
    if let Some(own) = crate::pty::service::start_dir(exe) {
        cmd.current_dir(own);
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: closing this terminal or Ctrl+C here leaves the app running.
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd
}

fn request_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}", std::process::id(), t)
}

/// CLI-033 (T-089-d): the exit status of ask's hand-back.
const HANDED_BACK: i32 = 75;
/// CLI-033: how long a new question is waited on before the packaged Windows build hands control
/// back, under the two minutes an agent's shell tool commonly allows one command.
// ponytail: a fixed window; a flag if a caller ever needs another one.
const HAND_BACK_MS: u64 = 100_000;
/// The hand-back is the packaged Windows build's protocol; a dev build and other systems wait.
const PACKAGED_WINDOWS: bool = cfg!(all(windows, not(debug_assertions)));

/// CLI-033: on the packaged Windows build a new question hands control back after
/// `HAND_BACK_MS` with exit status 75, so the caller resumes the wait; a resumed wait
/// (`--resume`) never hands back again, it waits out its own timeout.
fn hand_back_after(packaged_windows: bool, req: &Request) -> Option<u64> {
    let resumed = req.args["resume"].as_str().is_some_and(|r| !r.trim().is_empty());
    (packaged_windows && req.command == ASK && !resumed).then_some(HAND_BACK_MS)
}

/// The exit status an answer the app gave carries: 0 on success, 1 on a failure, 75 when ask
/// handed control back with its question still open (CLI-033).
fn exit_status(command: &str, env: &Value) -> i32 {
    if env["success"] != Value::Bool(true) {
        1
    } else if command == ASK && env["result"]["handedBack"] == true {
        HANDED_BACK
    } else {
        0
    }
}

/// ORCH-005: `check --wait` asks again until mail comes, the time is up, or the pane is tied
/// elsewhere (the app answers fenced), writing a keepalive line to standard error meanwhile.
/// ORCH-029: `ask` waits the same way for the answer, resuming its own question each time, and
/// leaves the question open when the time is up.
fn wait_for_mail(port: u16, mut req: Request, hand_back: Option<u64>) -> Result<Value, Fail> {
    let ms = |v: Option<String>| v.and_then(|s| s.trim().parse::<u64>().ok()).filter(|n| *n > 0);
    let timeout = ms(req.args["timeoutMs"].as_str().map(str::to_string)).unwrap_or(WAIT_DEFAULT_MS);
    let every = ms(std::env::var("KOLUX_KEEPALIVE_INTERVAL_MS").ok()).or_else(|| ms(std::env::var("KOLUX_HEARTBEAT_INTERVAL_MS").ok())).unwrap_or(KEEPALIVE_MS);
    let start = Instant::now();
    let mut alive = start;
    loop {
        let mut env = call(port, &req)?;
        let ask = req.command == ASK;
        let done = if ask { env["result"]["status"] != "open" } else { env["result"]["messages"].as_array().is_some_and(|m| !m.is_empty()) };
        if env["success"] != Value::Bool(true) || done {
            return Ok(env);
        }
        let elapsed = start.elapsed().as_millis() as u64;
        if elapsed >= timeout {
            env["result"]["timedOut"] = Value::Bool(true);
            return Ok(env);
        }
        if ask && hand_back.is_some_and(|h| elapsed >= h) {
            env["result"]["handedBack"] = Value::Bool(true);
            return Ok(env);
        }
        if let Some(a) = req.args.as_object_mut() {
            if ask {
                for k in ["question", "options", "to", "run", "retryRequest"] {
                    a.remove(k);
                }
                a.insert("resume".into(), env["result"]["messageId"].clone());
            } else {
                a.remove("ack");
                a.entry("fence").or_insert_with(|| env["result"]["epoch"].clone());
            }
        }
        if alive.elapsed().as_millis() as u64 >= every {
            eprintln!("{}", json!({ "_keepalive": true, "_heartbeat": true, "elapsedMs": elapsed, "deadlineMs": timeout }));
            alive = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(500.min(timeout - elapsed)));
    }
}

/// CLI-025: `terminal wait` asks again every half second until the condition holds or the time
/// is up (`--timeout-ms`, default `WAIT_DEFAULT_MS`). A terminal that ends blocked on the user,
/// or the time running out, is a failure, so the exit status is 1.
fn wait_for_terminal(port: u16, req: Request) -> Result<Value, Fail> {
    let timeout = req.args["timeoutMs"].as_str().and_then(|s| s.trim().parse::<u64>().ok()).filter(|n| *n > 0).unwrap_or(WAIT_DEFAULT_MS);
    let start = Instant::now();
    loop {
        let env = call(port, &req)?;
        if env["success"] != Value::Bool(true) || wait_step(&env["result"])? {
            return Ok(env);
        }
        let elapsed = start.elapsed().as_millis() as u64;
        if elapsed >= timeout {
            let r = &env["result"];
            let mut f = Fail::new("timeout", format!("{} did not reach {} within {timeout} ms (it is {})", r["terminal"].as_str().unwrap_or_default(), req.args["for"].as_str().unwrap_or_default(), r["state"].as_str().unwrap_or_default()));
            f.data = r.clone();
            return Err(f);
        }
        std::thread::sleep(Duration::from_millis(500.min(timeout - elapsed)));
    }
}

/// One answer of `terminal.wait`: done, keep asking, or blocked on the user (an error).
fn wait_step(r: &Value) -> Result<bool, Fail> {
    if r["done"] != Value::Bool(true) {
        return Ok(false);
    }
    if r["blocked"] == Value::Bool(true) {
        let mut f = Fail::new("blocked", format!("{} is {}, not idle: the agent needs an answer", r["terminal"].as_str().unwrap_or_default(), r["state"].as_str().unwrap_or_default()));
        f.data = r.clone();
        return Err(f);
    }
    Ok(true)
}

/// ORCH-041: Claude Code with Agent Teams turned on, in the Kolux terminal it is run from; every
/// argument after `claude-teams` goes to Claude untouched. Windows is not supported, and outside a
/// Kolux terminal there is no pane for the team, so both refuse with exit status 1.
// ponytail: teammates always run in-process; the native-panes mode needs Kolux to answer Agent
// Teams' tmux calls (ORCH-042).
fn claude_teams(rest: &[String]) -> i32 {
    if let Err(why) = teams_allowed(cfg!(windows), std::env::var("KOLUX_TERMINAL_HANDLE").ok().filter(|h| !h.is_empty()).is_some()) {
        eprintln!("error: {why}");
        return 1;
    }
    match std::process::Command::new("claude").args(["--teammate-mode", "in-process"]).args(rest).env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1").status() {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("error: Claude Code could not be started ({e}); is it installed and on PATH?");
            1
        }
    }
}

fn teams_allowed(windows: bool, in_kolux: bool) -> Result<(), &'static str> {
    if windows {
        return Err("Claude Agent Teams is not supported on Windows yet; start Claude Code itself instead");
    }
    if !in_kolux {
        return Err("claude-teams has to run in a Kolux terminal: outside one there is no pane for the team");
    }
    Ok(())
}

/// The `kolux-dev` program: parses, talks to the app, prints, and returns the exit status.
pub fn main(words: Vec<String>) -> i32 {
    // APP-059 Compat: the CLI reports the same version as the app and the update manifest.
    if version_only(&words) {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    if words.first().map(String::as_str) == Some("claude-teams") {
        return claude_teams(&words[1..]);
    }
    let (json, parsed) = parse(&words);
    let id = request_id();
    let finish = |out: Result<(String, Value), Fail>| -> i32 {
        if let Ok((_, env)) = &out {
            for w in env["result"]["warnings"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                eprintln!("warning: {w}");
            }
        }
        match (&out, json) {
            (Ok((command, env)), true) => {
                println!("{}", serde_json::to_string_pretty(env).unwrap_or_default());
                exit_status(command, env)
            }
            (Ok((command, env)), false) => {
                if env["success"] == Value::Bool(true) {
                    println!("{}", text_of(command, &env["result"]));
                    exit_status(command, env)
                } else {
                    eprintln!("error: {}", env["error"]["message"].as_str().unwrap_or("the command failed"));
                    if let Some(h) = env["error"]["data"]["hint"].as_str() {
                        eprintln!("{h}");
                    }
                    1
                }
            }
            (Err(f), true) => {
                println!("{}", serde_json::to_string_pretty(&envelope(&id, "", Err(f.clone()))).unwrap_or_default());
                1
            }
            (Err(f), false) => {
                eprintln!("error: {}", f.message);
                if let Some(h) = f.data["hint"].as_str() {
                    eprintln!("{h}");
                }
                if f.code == "invalid_arguments" {
                    eprintln!("run {} --help for the usage", crate::orchestration::CLI);
                }
                1
            }
        }
    };
    let mut parsed = match parsed {
        Ok(Some(p)) => p,
        Ok(None) => {
            let (text, code) = help(&help_path(&words));
            if code == 0 {
                print!("{text}");
            } else {
                eprint!("{text}");
            }
            return code;
        }
        Err(f) => return finish(Err(f)),
    };
    // CLI-042 / CLI-043: these answer from the program itself, so the app may be closed.
    if json && matches!(parsed.command.as_str(), "skills.install" | "skills.update") {
        parsed.args.insert("json".into(), Value::Bool(true));
    }
    if let Some(out) = local_cli::run(&parsed) {
        return finish(out.map(|v| (parsed.command.clone(), envelope(&id, "", Ok(v)))));
    }
    // CLI-012: answers whether or not the app is up, so it never goes through the open advice.
    if parsed.command == STATUS {
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let ask = |port: u16, token: &str| ask_status(port, token, &id, &cwd);
        let r = status_of(&data_dir(), &ask);
        let code = status_exit(&r);
        if json {
            let runtime = r["pid"].as_u64().filter(|_| code == 0).map(|p| p.to_string()).unwrap_or_default();
            println!("{}", serde_json::to_string_pretty(&envelope(&id, &runtime, Ok(r))).unwrap_or_default());
        } else {
            println!("{}", status_line(&r));
        }
        return code;
    }
    if !json && parsed.command == "terminal.list" {
        parsed.args.insert("includeVisualLayouts".into(), Value::Bool(true));
    }
    caller_distro(&mut parsed.args, std::env::var("WSL_DISTRO_NAME").ok());
    let retry_word = CHANGES.contains(&parsed.command.as_str()).then(|| {
        let id = parsed.args.get("retryRequest").and_then(Value::as_str).map(str::to_string).unwrap_or_else(uuid);
        parsed.args.insert("retryRequest".into(), json!(id));
        id
    });
    let retry_hint = |mut f: Fail| -> Fail {
        if let (Some(id), "lost_result" | "timeout") = (&retry_word, f.code) {
            let mut again: Vec<String> = Vec::new();
            let mut skip = false;
            for w in &words {
                if std::mem::take(&mut skip) {
                    continue;
                }
                if w == "--retry-request" {
                    skip = true;
                } else if !w.starts_with("--retry-request=") {
                    again.push(w.clone());
                }
            }
            let cmd = format!("{} {} --retry-request {id}", crate::orchestration::CLI, retype(&again));
            f.message = format!("{}. It may have taken effect; run this to finish it without doing it twice", f.message);
            f.data = json!({ "hint": cmd, "retryRequest": id });
        }
        f
    };
    let run = || -> Result<(String, Value), Fail> {
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let pane = match (std::env::var("KOLUX_TERMINAL_HANDLE"), std::env::var("KOLUX_PANE_KEY")) {
            (Ok(handle), Ok(key)) if !handle.is_empty() => Some(Pane { handle, key }),
            _ => None,
        };
        if parsed.command == cli_accounts::ADD {
            let (port, token) = read_endpoint(&data_dir())?;
            let ask = |command: &str, args: Value| -> Result<Value, Fail> {
                let r = Request { id: request_id(), token: token.clone(), command: command.into(), cwd: cwd.clone(), args, pane: None, cli: VERSION.into(), arrived: None };
                let env = call(port, &r)?;
                if env["success"] == Value::Bool(true) {
                    return Ok(env["result"].clone());
                }
                Err(Fail::new("failed", env["error"]["message"].as_str().unwrap_or("the app refused the sign-in")))
            };
            let agent = parsed.args["agent"].as_str().unwrap_or("claude").to_string();
            cli_accounts::installed(&agent)?;
            let out = cli_accounts::add(&agent, ask, |temp| cli_accounts::run_login(&agent, temp));
            return Ok((parsed.command.clone(), envelope(&id, "", out)));
        }
        let mut args = parsed.args.clone();
        if json && parsed.command == "worktree.ps" {
            // ORCH-040: only a JSON poll may get the short "unchanged" answer; text is always whole.
            args.insert("json".into(), json!(true));
        }
        if (parsed.command == CHECK && parsed.args.contains_key("wait")) || parsed.command == ASK {
            let (port, token) = read_endpoint(&data_dir())?;
            let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(args), pane, cli: VERSION.into(), arrived: None };
            let hand_back = hand_back_after(PACKAGED_WINDOWS, &req);
            return Ok((parsed.command.clone(), wait_for_mail(port, req, hand_back)?));
        }
        if parsed.command == "terminal.wait" {
            let (port, token) = read_endpoint(&data_dir())?;
            let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(args), pane, cli: VERSION.into(), arrived: None };
            return Ok((parsed.command.clone(), wait_for_terminal(port, req)?));
        }
        let send = || {
            let (port, token) = read_endpoint(&data_dir())?;
            call(port, &Request { id: id.clone(), token, command: parsed.command.clone(), cwd: cwd.clone(), args: Value::Object(args.clone()), pane: pane.clone(), cli: VERSION.into(), arrived: None })
        };
        // CLI-011 / T-075-b: a background terminal service this build cannot pair with is a clear
        // refusal before anything starts; a compatible one is attached to by the window open starts.
        let launch = || crate::pty::service::before_open(&data_dir()).map_err(|why| Fail { code: "service_incompatible", message: why, data: json!({}) }).and_then(|_| launch_app());
        // CLI-011 box 2: the running copy (its pid from the startup file) may take the foreground
        // before it is asked, and once it answered its window is raised from here as well, as a
        // second launch does (lifecycle::forward_to); only Windows can say whether that worked.
        let grant = || {
            if let Some(pid) = crate::lifecycle::read_running(&data_dir()).and_then(|r| r.pid) {
                crate::lifecycle::allow_foreground(pid);
            }
        };
        let raise = |pid: u32| cfg!(windows).then(|| crate::lifecycle::raise_by_pid(pid, crate::lifecycle::RAISE_TRIES, std::thread::sleep));
        let env = if parsed.command == "app.open" { open(&send, &launch, &grant, &raise, OPEN_LIMIT)? } else { send()? };
        if parsed.command == "terminal.send" {
            // TERM-126: a prompt that did not submit within the wait is reported with exit status 1.
            submit_step(&env)?;
        }
        Ok((parsed.command.clone(), env))
    };
    let out = run().map_err(retry_hint);
    let advice = out.as_ref().err().and_then(|f| open_first(f, &parsed.command)).filter(|_| !json);
    let code = finish(out);
    if let Some(a) = advice {
        eprintln!("{a}");
    }
    code
}

// ---------------------------------------------------------------- the app's side

/// What a command needs from the app: Git, the store, the open terminals, and a way to tell the
/// front end what changed.
pub struct Ctx<'a> {
    /// Claude's user configuration, where a new worktree is marked trusted (SAFE-023).
    pub claude_config: PathBuf,
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    pub terminals: &'a Terminals,
    pub notify: &'a (dyn Fn(Value) + Sync),
    /// Shows the window, restored and in front.
    pub front: &'a (dyn Fn() -> Result<(), String> + Sync),
}

/// The context for one CLI request; Claude's config is read now so an account switch is followed (row 984).
pub(crate) fn request_ctx<'a>(store: &'a Mutex<Store>, git: &'a Git, terminals: &'a Terminals, notify: &'a (dyn Fn(Value) + Sync), front: &'a (dyn Fn() -> Result<(), String> + Sync)) -> Ctx<'a> {
    Ctx { claude_config: crate::claude_accounts::trust_config_file(store), git, store, terminals, notify, front }
}

fn lower(p: &Path) -> String {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase()
}

/// Is `cwd` the folder `dir` or inside it?
fn under(dir: &str, cwd: &str) -> bool {
    let (d, c) = (lower(Path::new(dir)), lower(Path::new(cwd)));
    c == d || c.strip_prefix(&d).is_some_and(|rest| rest.starts_with(['\\', '/']))
}

const REPO_FORMS: &str = "id:<repo-id>, name:<name> or path:<folder>";
const WORKTREE_FORMS: &str = "active, current, id:<repo-id>::<path>, identity:<repo-id>::<path>, name:<name>, branch:<branch>, issue:<number> or path:<folder>";

/// CLI-009: a selector's kind and value. A bare value is refused, never guessed: `42` could be
/// an issue, a name or an id.
fn selector<'a>(s: &'a str, flag: &str, kinds: &[&str], forms: &str) -> Result<(&'a str, &'a str), Fail> {
    match s.trim().split_once(':') {
        Some((k, v)) if kinds.contains(&k) && !v.trim().is_empty() => Ok((k, v.trim())),
        Some(("folder", _)) => Err(Fail::args("folder:<id> names a folder workspace and is accepted only where a parent worktree is expected (--parent-worktree)")),
        _ => Err(Fail { code: "invalid_arguments", message: format!("\"{s}\" is not a selector for --{flag}; it takes {forms}"), data: json!({ "value": s, "accepted": forms }) }),
    }
}

/// The project a call means: `--repo` by id, name or path, else the one whose checkout or
/// worktree the call was made in.
fn pick_project(ctx: &Ctx, repo: Option<&str>, cwd: &str) -> Result<Project, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let projects = projects::load_projects(&store);
    if let Some(sel) = repo {
        let (kind, v) = selector(sel, "repo", &["id", "name", "path"], REPO_FORMS)?;
        let mut hits: Vec<&Project> = projects
            .iter()
            .filter(|p| match kind {
                "id" => p.id == v,
                "name" => p.name.eq_ignore_ascii_case(v),
                _ => under(&p.path, v) || projects::list_workspaces(ctx.git, &store, p).map(|ws| ws.iter().any(|w| under(&w.path, v))).unwrap_or(false),
            })
            .collect();
        return match hits.len() {
            0 => Err(Fail::new("not_found", format!("no project matches --repo {sel}"))),
            1 => Ok(hits.remove(0).clone()),
            n => Err(Fail { code: "ambiguous", message: format!("{n} projects match --repo {sel}; use id:"), data: json!({ "ids": hits.iter().map(|p| p.id.clone()).collect::<Vec<_>>() }) }),
        };
    }
    for p in &projects {
        if under(&p.path, cwd) {
            return Ok(p.clone());
        }
        if projects::list_workspaces(ctx.git, &store, p).map(|ws| ws.iter().any(|w| under(&w.path, cwd))).unwrap_or(false) {
            return Ok(p.clone());
        }
    }
    Err(Fail { code: "not_found", message: format!("no project contains {cwd}"), data: json!({ "hint": "run it inside a project, or pass --repo name:<project>" }) })
}

/// The worktree of `project` the call was made from (the main checkout counts), the innermost
/// when folders nest; None when `cwd` is outside them all.
fn calling_worktree(ctx: &Ctx, project: &Project, cwd: &str) -> Result<Option<String>, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut inside: Vec<String> = projects::list_workspaces(ctx.git, &store, project)?.into_iter().map(|w| w.path).filter(|p| under(p, cwd)).collect();
    inside.sort_by_key(|p| std::cmp::Reverse(p.len()));
    Ok(inside.into_iter().next())
}

/// The worktree `--worktree` means (CLI-009): `current` and `active` are the innermost one the
/// call was made in; `name:` matches the typed name, the branch or the folder name; `branch:`
/// and `path:` match exactly; `issue:` is the GitHub issue it was made for; `id:` and
/// `identity:` are `<repo-id>::<path>` as the listings print it.
fn pick_worktree(ctx: &Ctx, sel: &str, cwd: &str) -> Result<(Project, Worktree), Fail> {
    pick_in(ctx, sel, cwd, false)
}

/// `parent`: a parent selector, which also takes `worktree:<repo-id>::<path>`.
// ponytail: identity: is the id form until worktrees carry an identity of their own (hosts are local only).
fn pick_in(ctx: &Ctx, sel: &str, cwd: &str, parent: bool) -> Result<(Project, Worktree), Fail> {
    let here = ["current", "active"].contains(&sel.trim());
    let kinds: &[&str] = if parent { &["id", "identity", "worktree", "folder", "name", "branch", "issue", "path"] } else { &["id", "identity", "name", "branch", "issue", "path"] };
    let (kind, v) = if here { ("current", cwd) } else { selector(sel, "worktree", kinds, WORKTREE_FORMS)? };
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    if kind == "folder" {
        return projects::folder_parent(&store, v).map_err(|e| Fail::new("not_found", e));
    }
    let mut hits: Vec<(Project, Worktree)> = Vec::new();
    for p in projects::load_projects(&store) {
        // A project whose folder is gone or unreadable has no worktrees to match; it must not stop
        // every other lookup.
        for w in projects::list_workspaces(ctx.git, &store, &p).unwrap_or_default() {
            let folder = Path::new(&w.path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let same = |x: &str| under(&w.path, x) && under(x, &w.path);
            let ok = match kind {
                "current" => under(&w.path, v),
                "name" => w.name.as_deref() == Some(v) || w.branch.as_deref() == Some(v) || folder == v,
                "branch" => w.branch.as_deref() == Some(v),
                "path" => same(v),
                "issue" => v.parse::<u64>().is_ok_and(|n| projects::origin(&store, &w.path).and_then(|o| o["issue"].as_u64()) == Some(n)),
                _ => v.split_once("::").is_some_and(|(id, path)| id == p.id && same(path)),
            };
            if ok {
                hits.push((p.clone(), w));
            }
        }
    }
    if kind == "current" {
        hits.sort_by_key(|(_, w)| std::cmp::Reverse(w.path.len()));
        hits.truncate(1);
        if hits.is_empty() {
            return Err(Fail { code: "not_found", message: format!("{cwd} is not inside a worktree of any project"), data: json!({ "hint": "run it inside a worktree's folder, or name one with --worktree id:|name:|branch:|path:" }) });
        }
    }
    match hits.len() {
        0 => Err(Fail::new("not_found", format!("no worktree matches --worktree {sel}"))),
        1 => Ok(hits.remove(0)),
        _ => Err(Fail { code: "ambiguous", message: format!("{} worktrees match --worktree {sel}; use path:", hits.len()), data: json!({ "paths": hits.iter().map(|(_, w)| w.path.clone()).collect::<Vec<_>>() }) }),
    }
}

/// CLI-019: a worktree's display name, linked issue, comment and parent, changed in one call. The
/// parent is checked first, so a refused move writes nothing; an empty comment clears it.
fn set_worktree(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let raw = |k: &str| a[k].as_str().map(str::trim);
    let (p, w) = pick_worktree(ctx, raw("worktree").filter(|s| !s.is_empty()).unwrap_or("current"), &req.cwd)?;
    let parent = if a["noParent"].as_bool().unwrap_or(false) {
        Some(None)
    } else if let Some(sel) = raw("parentWorktree") {
        let (owner, to) = pick_in(ctx, sel, &req.cwd, true)?;
        if owner.id != p.id && !sel.trim().starts_with("folder:") {
            return Err(Fail::args(format!("--parent-worktree {sel} is in project {}, not {}", owner.name, p.name)));
        }
        Some(Some(to.path))
    } else {
        None
    };
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    // CLI-019: a refused status writes nothing, like a refused parent.
    let status = raw("workspaceStatus").map(|s| projects::resolve_status(&store, s)).transpose().map_err(Fail::args)?;
    if let Some(to) = &parent {
        if raw("parentWorktree").is_some_and(|s| s.starts_with("folder:")) {
            // A folder workspace belongs to another project, so the parent is recorded directly (it is never a main checkout or a descendant).
            projects::set_parent(&store, &w.path, to.as_deref())?;
        } else {
            projects::reparent(ctx.git, &store, &p, &w.path, to.as_deref())?;
        }
    }
    if let Some(id) = &status {
        crate::bulk::set_status(&store, &w.path, id)?;
    }
    if let Some(n) = raw("displayName") {
        projects::set_name(&store, &w.path, Some(n))?;
    }
    if raw("issue").is_some() || raw("comment").is_some() {
        let mut o = projects::origin(&store, &w.path).filter(Value::is_object).unwrap_or_else(|| json!({}));
        if let Some(i) = raw("issue") {
            o["issue"] = i.parse::<u64>().map_or(Value::Null, |n| json!(n));
            o["issueUrl"] = Value::Null;
        }
        if let Some(c) = raw("comment") {
            o["comment"] = if c.is_empty() { Value::Null } else { json!(c) };
        }
        projects::set_origin(&store, &w.path, Some(&o))?;
    }
    let all = projects::list_workspaces(ctx.git, &store, &p)?;
    let board = crate::bulk::status_of(&store, &w.path);
    drop(store);
    let now = all.iter().find(|x| same_dir(&x.path, &w.path)).cloned().unwrap_or(w);
    (ctx.notify)(json!({ "kind": "changed", "projectId": p.id, "path": now.path }));
    let mut row = worktree_row(&p, &now, &all);
    row["workspaceStatus"] = json!(board);
    Ok(row)
}

/// CLI-009: a request from a WSL shell with its paths as Windows sees them: `path:` selectors and
/// the folder the call ran in (`/mnt/c/...` needs no distribution; any other Linux path goes to
/// the caller's own, read from where it ran). None when nothing needed changing.
/// CLI-036 (T-089-d): a terminal command whose --terminal is not a terminal handle may name a
/// worker by its dispatch id; only then are the dispatches loaded.
fn named_dispatch(req: &Request) -> bool {
    req.command.starts_with("terminal.") && req.args["terminal"].as_str().is_some_and(|h| !h.trim().is_empty() && !h.trim().starts_with("term-"))
}

/// CLI-036 (T-089-d): the request with a dispatch id in --terminal swapped for that worker's
/// terminal handle (`orchestration::terminal_for`); a worker with no terminal is refused by name
/// with the way to read it instead; a name that is no dispatch passes through unchanged.
fn by_dispatch(req: &Request, dispatches: &[Value]) -> Result<Option<Request>, Fail> {
    let Some(given) = req.args["terminal"].as_str().map(str::trim) else { return Ok(None) };
    let handle = crate::orchestration::terminal_for(dispatches, given)?;
    if handle == given {
        return Ok(None);
    }
    let mut out = req.clone();
    out.args["terminal"] = json!(handle);
    Ok(Some(out))
}

fn wsl_fixed(req: &Request) -> Option<Request> {
    let distro = projects::wsl_distro_of(&req.cwd).or_else(|| req.args["callerDistro"].as_str().map(str::to_string));
    let fix = |s: &str| match s.trim().split_once(':') {
        Some(("path", v)) => format!("path:{}", projects::wsl_path(v, distro.as_deref())),
        _ => s.to_string(),
    };
    let mut out = req.clone();
    out.cwd = projects::wsl_path(&req.cwd, distro.as_deref());
    for k in ["worktree", "parentWorktree", "repo"] {
        if let Some(s) = req.args[k].as_str() {
            out.args[k] = json!(fix(s));
        }
    }
    (out.cwd != req.cwd || out.args != req.args).then_some(out)
}

/// Runs one request against the app and says what it did.
pub fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let fixed = wsl_fixed(req);
    let req = fixed.as_ref().unwrap_or(req);
    let by_id = if named_dispatch(req) {
        let dispatches = load_list(&*ctx.store.lock().map_err(|e| e.to_string())?, DISPATCHES_KEY)?;
        by_dispatch(req, &dispatches)?
    } else {
        None
    };
    let req = by_id.as_ref().unwrap_or(req);
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    match req.command.as_str() {
        SET => set_worktree(ctx, req),
        "worktree.create" => {
            // PROJ-038: a prompt with no agent named goes to the default agent, else the first
            // installed one in catalogue order; a worktree made with neither gets no agent tab.
            let agent = match text("agent") {
                Some(id) => Some(installed_agent(&id).map(|_| id)?),
                None if text("prompt").is_some() => Some(fallback_agent(ctx)?.id),
                None => None,
            };
            let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            // PROJ-037: --issue with no --name names the worktree after the issue's title.
            let issue = text("issue").and_then(|v| v.parse::<u64>().ok());
            let name = match (text("name"), issue) {
                (Some(n), _) => n,
                (None, Some(n)) => crate::pr_checkout::issue(&crate::scm::gh_program().map_err(|e| Fail::new("failed", e))?, Path::new(&project.path), n).map_err(|e| Fail::new("failed", e))?.title,
                (None, None) => return Err(Fail::args("--name is required")),
            };
            // Lineage: the worktree the call was made from, unless a flag says otherwise.
            let parent = if a["noParent"].as_bool().unwrap_or(false) {
                None
            } else if let Some(sel) = text("parentWorktree") {
                let (owner, w) = pick_in(ctx, &sel, &req.cwd, true)?;
                if owner.id != project.id && !sel.starts_with("folder:") {
                    return Err(Fail::args(format!("--parent-worktree {sel} is in project {}, not {}", owner.name, project.name)));
                }
                Some(w.path)
            } else {
                calling_worktree(ctx, &project, &req.cwd)?
            };
            let made = projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref(), None)?;
            // The calling terminal, when the runtime vouches for it; a shell outside Kolux records none.
            let terminal = caller(ctx, req).ok().flatten();
            let pane_key = terminal.as_ref().and(req.pane.as_ref()).map(|p| p.key.clone());
            let origin = json!({ "madeBy": "cli", "parent": parent, "cwd": req.cwd, "issue": issue, "comment": text("comment"), "terminal": terminal, "paneKey": pane_key });
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_origin(&store, &made.worktree.path, Some(&origin))?;
                // PROJ-047: the sidebar nests it under its parent.
                if let Some(p) = &parent {
                    projects::set_parent(&store, &made.worktree.path, Some(p))?;
                }
            }
            let activate = a["activate"].as_bool().unwrap_or(false);
            let mut result = serde_json::to_value(&made).map_err(|e| Fail::new("failed", e.to_string()))?;
            let obj = result.as_object_mut().expect("a workspace is an object");
            obj.insert("projectId".into(), json!(project.id));
            obj.insert("agent".into(), json!(agent));
            obj.insert("activated".into(), json!(activate));
            obj.extend(origin.as_object().expect("an origin is an object").clone());
            // PROJ-033: the window runs the setup script in a Setup tab unless it is skipped;
            // --run-hooks runs it as --setup run does. Issue lookups (PROJ-037) are T-107-c.
            let mut setup = text("setup").unwrap_or_else(|| "inherit".into());
            if a["runHooks"].as_bool().unwrap_or(false) {
                setup = "run".into();
            }
            obj.insert("setup".into(), json!(setup));
            obj.insert("warnings".into(), json!([]));
            (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": made, "agent": agent, "prompt": text("prompt").unwrap_or_default(), "activate": activate, "setup": setup }));
            Ok(result)
        }
        "worktree.rm" => {
            let sel = text("worktree").ok_or_else(|| Fail::args("--worktree is required"))?;
            let (project, w) = pick_worktree(ctx, &sel, &req.cwd)?;
            if w.is_main {
                return Err(Fail::new("failed", "the main checkout cannot be removed; remove the project instead"));
            }
            let shown = w.name.clone().or(w.branch.clone()).unwrap_or_else(|| w.path.clone());
            if !a["force"].as_bool().unwrap_or(false) && ctx.git.dirty(Path::new(&w.path))? {
                return Err(Fail { code: "dirty", message: format!("{shown} has uncommitted changes"), data: json!({ "hint": "add --force to remove it anyway, changes and all" }) });
            }
            // ORCH-058: its terminals and their processes end first and must be shown gone; a stop
            // that cannot be proven blocks the removal unless --force waives it.
            let stopped = ctx.terminals.kill_under(Path::new(&w.path));
            if !stopped.stuck.is_empty() && !a["force"].as_bool().unwrap_or(false) {
                let pids: Vec<String> = stopped.stuck.iter().map(u32::to_string).collect();
                return Err(Fail { code: "stuck", message: format!("{} process{} in {shown} did not stop (pid {})", pids.len(), if pids.len() == 1 { "" } else { "es" }, pids.join(", ")), data: json!({ "hint": "add --force to remove it anyway, leaving them running", "pids": stopped.stuck }) });
            }
            // CLI-020: --force forces only the checkout's removal; the branch is kept. T-613b: without
            // it the branch is decided as the app's delete decides it (remove_one with no choice made):
            // the workspace's own record, then a branch holding commits found on no other branch and no
            // remote stays, and a detached HEAD's such commits are kept on a new kolux/kept- branch.
            let force = a["force"].as_bool().unwrap_or(false);
            let check = projects::remove_check(ctx.git, &project, &w.path)?;
            let by_record = projects::keeps_branch(&*ctx.store.lock().map_err(|e| e.to_string())?, &w.path);
            let kept = projects::remove_one(ctx.git, ctx.store, ctx.terminals, &project, &w.path, force, &check.stamp, force.then_some(true))?;
            (ctx.notify)(json!({ "kind": "removed", "path": w.path }));
            let mut warnings: Vec<String> = if a["runHooks"].as_bool().unwrap_or(false) { vec!["--run-hooks: teardown scripts do not run yet; the worktree was removed without them".into()] } else { vec![] };
            if let Some(k) = kept.as_ref().filter(|_| !check.commits.is_empty() && (w.branch.is_none() || (!force && !by_record))) {
                warnings.push(format!("the branch {} was kept: it holds commits found on no other branch and no remote (delete it with git branch -D {} once they are safe)", k.branch, k.branch));
            }
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id, "branchKept": kept.is_some(), "keptBranch": kept.as_ref().map(|k| &k.branch), "stopped": stopped.ended, "stuck": stopped.stuck, "warnings": warnings }))
        }
        "app.open" => {
            // T-324-b (APP-019): markdown files a second launch was handed wait for the page to take them.
            let files: Vec<String> = req.args["files"].as_array().map(|a| a.iter().filter_map(|f| f.as_str().map(str::to_string)).collect()).unwrap_or_default();
            if crate::lifecycle::queue_open(&files) > 0 {
                (ctx.notify)(json!({ "emit": "open-files", "payload": Value::Null }));
            }
            (ctx.front)()?;
            Ok(json!({ "ready": true, "started": false, "pid": std::process::id() }))
        }
        STATUS => Ok(status_answer(&GRAPH_READY)),
        MEMORY => serde_json::to_value(crate::resources::memory_now(ctx.terminals)).map_err(|e| Fail::new("failed", e.to_string())),
        WORKER_START => worker_start_once(ctx, req),
        c if QUERY.iter().any(|(_, w, _)| *w == c) => query(ctx, req),
        c if TERM.iter().any(|(_, w, _)| *w == c) => terminal_io(ctx, req),
        c if crate::orchestration::runtime::is_runtime(c) => {
            // T-312 (ORCH-062..064): the worktree is settled first (for automations mine, the owning
            // repo, and nothing is listed when no repo owns the call); runtime.rs works inside it.
            let (project, root, branch) = if c == crate::orchestration::runtime::MINE {
                let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
                let root = p.path.clone();
                (p, root, None)
            } else {
                let (p, w) = pick_worktree(ctx, text("worktree").as_deref().unwrap_or("current"), &req.cwd)?;
                (p, w.path, w.branch)
            };
            let place = crate::orchestration::runtime::Place { root: Path::new(&root), branch: branch.as_deref(), repo_id: &project.id, repo_name: &project.name };
            crate::orchestration::runtime::run(c, &req.args, Path::new(&req.cwd), &place, ctx.store)
        }
        c if c.starts_with("orchestration.") => mail(ctx, req),
        c if c.starts_with("account.") => cli_accounts::dispatch(ctx, req),
        c if c.starts_with("automations.") => automations_cli::dispatch(ctx, req),
        c if crate::browser::cli::is_browser(c) => {
            // BROW-042: --worktree names the tab's worktree; without it the caller's own folder is
            // the worktree, and a caller outside every worktree gets whichever tab is on screen.
            // BROW-044: `tab list --worktree all` is every worktree's tabs (the module reads the word).
            let worktree = match text("worktree") {
                Some(sel) if sel == "all" => None,
                Some(sel) => Some(pick_worktree(ctx, &sel, &req.cwd)?.1.path),
                None => pick_worktree(ctx, "current", &req.cwd).ok().map(|(_, w)| w.path),
            };
            crate::browser::cli::run(req, worktree.as_deref())
        }
        c if c.starts_with("terminal.") => terminal_cmd(ctx, req),
        c if c.starts_with("file.") => file_cli::dispatch(ctx, req),
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- terminals (CLI-023, CLI-026, CLI-027)

/// How long a terminal command waits for the window to act on it.
const PANE_WAIT: Duration = Duration::from_secs(15);

fn no_terminal(h: &str) -> Fail {
    Fail { code: "not_found", message: format!("no open terminal is {h}"), data: json!({ "hint": format!("{} terminal list prints the handles", crate::orchestration::CLI) }) }
}

/// CLI-026: one-shot forms of a startup command (exec, print, review, help) stay in the background.
fn one_shot(command: &str) -> bool {
    command.split_whitespace().skip(1).any(|w| ["exec", "review", "help", "-p", "--print", "--help", "-h"].contains(&w))
}

/// CLI-023: every open terminal with its worktree and where the window shows it: its pane (a cell
/// of the worktree's grid, counted from 1), its tab inside that pane, and whether it is in view.
fn terminal_rows(ctx: &Ctx) -> Result<Vec<Value>, Fail> {
    let mut trees: Vec<(String, Option<String>)> = Vec::new();
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        for p in projects::load_projects(&store) {
            trees.extend(projects::list_workspaces(ctx.git, &store, &p).unwrap_or_default().into_iter().map(|w| (w.path, w.branch)));
        }
    }
    // T-262-b: the rows are the session tab inventory (the same list the app and the agents read).
    // Row 256: as served over the socket, each program line is cut to its name (no keys or tokens).
    Ok(crate::agents::inventory::tabs_for_socket(ctx.terminals)
        .into_iter()
        .map(|t| {
            let home = t.cwd.as_deref().and_then(|d| trees.iter().filter(|(w, _)| under(w, d)).max_by_key(|(w, _)| w.len()));
            let (pane, tab, shown) = t.placement.as_ref().map_or((Value::Null, Value::Null, false), |p| (json!(p.pane), json!(p.tab), p.shown));
            json!({ "handle": t.handle, "title": t.title, "worktree": home.map(|h| h.0.clone()), "branch": home.and_then(|h| h.1.clone()), "cwd": t.cwd, "program": t.program, "agent": t.agent, "host": "local", "pane": pane, "tab": tab, "shown": shown })
        })
        .collect())
}

/// CLI-023: worktree, then pane, then the tabs inside it, each in window order.
fn layouts(rows: &[Value]) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for r in rows {
        let i = out.iter().position(|w| w["worktree"] == r["worktree"]).unwrap_or_else(|| {
            out.push(json!({ "worktree": r["worktree"], "panes": [] }));
            out.len() - 1
        });
        let panes = out[i]["panes"].as_array_mut().expect("panes is a list");
        let j = panes.iter().position(|p| p["pane"] == r["pane"]).unwrap_or_else(|| {
            panes.push(json!({ "pane": r["pane"], "tabs": [] }));
            panes.len() - 1
        });
        panes[j]["tabs"].as_array_mut().expect("tabs is a list").push(json!({ "tab": r["tab"], "handle": r["handle"], "title": r["title"], "shown": r["shown"] }));
    }
    for w in &mut out {
        let panes = w["panes"].as_array_mut().expect("panes is a list");
        panes.sort_by_key(|p| p["pane"].as_u64().unwrap_or(u64::MAX));
        for p in panes {
            p["tabs"].as_array_mut().expect("tabs is a list").sort_by_key(|t| t["tab"].as_u64().unwrap_or(u64::MAX));
        }
    }
    Value::Array(out)
}

/// Waits for the window's layout to show what found looks for.
fn await_layout(ctx: &Ctx, what: &str, found: impl Fn(&Value) -> Option<Result<Value, Fail>>) -> Result<Value, Fail> {
    let until = Instant::now() + PANE_WAIT;
    loop {
        if let Some(out) = ctx.terminals.layout().iter().find_map(&found) {
            return out;
        }
        if Instant::now() >= until {
            return Err(Fail { code: "timeout", message: format!("the window did not {what} within 15 seconds"), data: json!({ "hint": format!("it may still happen; {} terminal list shows what is open", crate::orchestration::CLI) }) });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The pane the window opened for request ask, or why it could not.
fn await_pane(ctx: &Ctx, ask: &str) -> Result<Value, Fail> {
    await_layout(ctx, "open the terminal", |r| {
        (r["ask"] == ask).then(|| r["error"].as_str().map_or(Ok(r.clone()), |e| Err(Fail::new("failed", e)))).filter(|out| out.is_err() || r["handle"].is_string())
    })
}

fn terminal_cmd(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let live = |h: &str| if ctx.terminals.live(h) { Ok(()) } else { Err(no_terminal(h)) };
    let handle = text("terminal").unwrap_or_default();
    match req.command.as_str() {
        "terminal.list" => {
            let only = text("worktree").map(|s| pick_worktree(ctx, &s, &req.cwd)).transpose()?;
            let mut rows: Vec<Value> = terminal_rows(ctx)?.into_iter().filter(|r| only.as_ref().is_none_or(|(_, w)| r["worktree"].as_str().is_some_and(|x| same_dir(x, &w.path)))).collect();
            let total = rows.len();
            if let Some(n) = text("limit").and_then(|l| l.parse::<usize>().ok()) {
                rows.truncate(n);
            }
            let mut out = json!({ "terminals": rows, "truncated": total > rows.len(), "scope": only.map(|(_, w)| w.path), "hosts": hosts() });
            if a["includeVisualLayouts"] == true {
                out["layouts"] = layouts(&rows);
            }
            Ok(out)
        }
        "terminal.show" => terminal_rows(ctx)?.into_iter().find(|r| r["handle"] == handle.as_str()).ok_or_else(|| no_terminal(&handle)),
        "terminal.create" => {
            let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
            crate::pty::check_start_dir(&w.path, false)?;
            let command = text("command");
            let asked = a["focus"] == true;
            let quiet = command.as_deref().is_some_and(one_shot);
            let focus = asked && !quiet;
            (ctx.notify)(json!({ "kind": "terminal-create", "path": w.path, "branch": w.branch, "command": command, "title": text("title"), "focus": focus, "ask": req.id }));
            let row = await_pane(ctx, &req.id)?;
            if focus {
                (ctx.front)()?;
            }
            let note = (asked && quiet).then_some("a one-shot command stays in the background, so it was not brought into view");
            Ok(json!({ "handle": row["handle"], "worktree": w.path, "branch": w.branch, "command": command, "title": row["title"], "pane": row["cell"], "tab": row["tab"], "focused": focus, "note": note }))
        }
        "terminal.split" => {
            live(&handle)?;
            let direction = text("direction").unwrap_or_else(|| "vertical".into());
            let dir = if direction == "horizontal" { "down" } else { "right" };
            (ctx.notify)(json!({ "kind": "terminal-split", "handle": handle, "dir": dir, "command": text("command"), "ask": req.id }));
            let row = await_pane(ctx, &req.id)?;
            Ok(json!({ "handle": row["handle"], "from": handle, "direction": direction, "pane": row["cell"], "tab": row["tab"], "focused": false }))
        }
        "terminal.rename" => {
            live(&handle)?;
            let title = text("title");
            (ctx.notify)(json!({ "kind": "terminal-rename", "handle": handle, "title": title }));
            let want = json!(title);
            let row = await_layout(ctx, "rename the terminal", |r| (r["handle"] == handle.as_str() && r["custom"] == want).then(|| Ok(r.clone())))?;
            Ok(json!({ "handle": handle, "title": row["title"], "default": title.is_none() }))
        }
        "terminal.switch" => {
            live(&handle)?;
            (ctx.notify)(json!({ "kind": "terminal-switch", "handle": handle }));
            (ctx.front)()?;
            let row = await_layout(ctx, "bring the terminal into view", |r| (r["handle"] == handle.as_str() && r["shown"] == true).then(|| Ok(r.clone())))?;
            Ok(json!({ "handle": handle, "title": row["title"], "shown": true }))
        }
        "terminal.close" => {
            let rows = terminal_rows(ctx)?;
            let of = |r: &Value| r["handle"].as_str().unwrap_or_default().to_string();
            let targets: Vec<String> = if handle.is_empty() {
                let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_default(), &req.cwd)?;
                rows.iter().filter(|r| r["worktree"].as_str().is_some_and(|x| same_dir(x, &w.path))).map(of).collect()
            } else {
                let row = rows.iter().find(|r| r["handle"] == handle.as_str()).ok_or_else(|| no_terminal(&handle))?;
                if a["tab"] == true && !row["pane"].is_null() {
                    rows.iter().filter(|r| r["cwd"] == row["cwd"] && r["pane"] == row["pane"]).map(of).collect()
                } else {
                    vec![handle.clone()]
                }
            };
            // The terminal this command runs in is left open: closing it would cut off the answer.
            let me = caller(ctx, req).ok().flatten();
            let (mine, targets): (Vec<String>, Vec<String>) = targets.into_iter().partition(|h| me.as_deref() == Some(h.as_str()));
            if targets.is_empty() && !mine.is_empty() && !handle.is_empty() {
                return Err(Fail::args(format!("{handle} is the terminal this command runs in; close it from another terminal or from the window")));
            }
            let (closed, alive): (Vec<String>, Vec<String>) = targets.iter().cloned().partition(|h| ctx.terminals.close(h));
            (ctx.notify)(json!({ "kind": "terminal-close", "handles": targets }));
            let out = json!({ "closed": closed, "notConfirmed": alive, "leftOpen": mine, "note": a["note"] });
            if !alive.is_empty() {
                return Err(Fail { code: "failed", message: format!("{} terminal(s) may still be running: {}", alive.len(), alive.join(", ")), data: out });
            }
            Ok(out)
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- repos, projects, worktrees (CLI-015..017)

fn repo_row(p: &Project) -> Value {
    json!({ "id": p.id, "selector": format!("id:{}", p.id), "name": p.name, "path": p.path, "baseRef": p.base })
}

/// A worktree as the listings show it: its selector id, lineage both ways, and its repo.
fn worktree_row(p: &Project, w: &Worktree, all: &[Worktree]) -> Value {
    let id = format!("{}::{}", p.id, w.path);
    let children: Vec<&str> = all.iter().filter(|c| c.parent.as_deref().is_some_and(|x| same_dir(x, &w.path))).map(|c| c.path.as_str()).collect();
    json!({ "id": id, "selector": format!("id:{id}"), "repoId": p.id, "repo": p.name, "path": w.path, "name": w.name, "branch": w.branch, "head": w.head, "isMain": w.is_main, "kind": w.kind, "parent": w.parent, "children": children, "number": w.number, "comment": w.comment })
}

/// Which hosts a listing looked at, so an empty one is never read as the whole picture.
// ponytail: local only; remote hosts were dropped (CLI-051), so nothing is ever left out.
/// ORCH-040: how long `worktree ps` reuses a repo's scan, and how long it waits on one before it
/// shows the last known worktrees instead.
const SCAN_FRESH: Duration = Duration::from_millis(1500);
const SCAN_SLOW: Duration = Duration::from_secs(3);

/// One repo's latest `git worktree list` for ps, and the last one that worked.
#[derive(Default)]
struct Scan {
    at: Option<Instant>,
    got: Option<Result<Vec<Worktree>, String>>,
    last_ok: Option<Vec<Worktree>>,
    running: bool,
}
static SCANS: Mutex<BTreeMap<String, Scan>> = Mutex::new(BTreeMap::new());
/// The snapshot each terminal's last JSON ps was given, keyed by its pane key.
static POLLS: Mutex<BTreeMap<String, u64>> = Mutex::new(BTreeMap::new());

/// What ps shows for one repo: its worktrees, how they were got, and why they may be stale. A
/// failed or slow scan never comes back empty-handed: the last list that worked is shown.
fn scan(repo: &str) -> (Vec<Worktree>, Value) {
    let key = repo.to_lowercase();
    let read = |s: &Scan, cached: bool| match &s.got {
        Some(Ok(v)) => (v.clone(), json!({ "scan": if cached { "cached" } else { "scanned" }, "cached": cached })),
        Some(Err(e)) => (s.last_ok.clone().unwrap_or_default(), json!({ "scan": "degraded", "cached": cached, "error": e.trim() })),
        None => (Vec::new(), json!({ "scan": "degraded", "cached": cached, "error": "the first scan has not finished" })),
    };
    let slow = |s: &Scan| (s.last_ok.clone().unwrap_or_default(), json!({ "scan": "degraded", "cached": true, "error": "the scan is slow; showing the last known worktrees" }));
    {
        let mut scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
        let s = scans.entry(key.clone()).or_default();
        if s.running {
            return slow(s);
        }
        if s.at.is_some_and(|t| t.elapsed() < SCAN_FRESH) {
            return read(s, true);
        }
        s.running = true;
    }
    let (tx, rx) = mpsc::channel();
    let (k, path) = (key.clone(), repo.to_string());
    std::thread::spawn(move || {
        let got = crate::git::run(&["worktree", "list", "--porcelain"], Some(Path::new(&path))).map(|t| crate::git::parse_worktrees(&t));
        let mut scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
        let s = scans.entry(k).or_default();
        if let Ok(v) = &got {
            s.last_ok = Some(v.clone());
        }
        (s.at, s.got, s.running) = (Some(Instant::now()), Some(got), false);
        let _ = tx.send(());
    });
    let done = rx.recv_timeout(SCAN_SLOW).is_ok();
    let scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
    if done {
        read(&scans[&key], false)
    } else {
        slow(&scans[&key])
    }
}

/// ORCH-040: `worktree ps`, one row per worktree with sessions or open workers, and a scope line.
fn ps(ctx: &Ctx, req: &Request, only: Option<Project>, limit: Option<usize>) -> Result<Value, Fail> {
    let lock = || ctx.store.lock().map_err(|e| Fail::from(e.to_string()));
    let listed = projects::load_projects(&*lock()?);
    let (mut lists, mut repos) = (Vec::new(), Vec::new());
    for p in listed.into_iter().filter(|p| only.as_ref().is_none_or(|o| o.id == p.id)) {
        let (all, mut how) = scan(&p.path);
        let all = projects::decorate(&*lock()?, &p, all)?;
        how["repoId"] = json!(p.id);
        how["name"] = json!(p.name);
        lists.push((p, all, how["scan"] == "degraded"));
        repos.push(how);
    }
    // Each open session goes to the innermost worktree its folder is in.
    // T-262-b: the sessions come from the session tab inventory; a tab with no start folder has no worktree.
    let sessions: Vec<(String, String, Option<String>)> = crate::agents::inventory::tabs_for_socket(ctx.terminals).into_iter().filter_map(|t| Some((t.handle, t.cwd?, t.program))).collect();
    let home = |dir: &str| lists.iter().flat_map(|(_, all, _)| all).filter(|w| under(&w.path, dir)).max_by_key(|w| w.path.len()).map(|w| w.path.clone());
    let homes: Vec<Option<String>> = sessions.iter().map(|(_, dir, _)| home(dir)).collect();
    // ps only reads: an unreadable dispatch list degrades to no workers (and says so), it does not fail the listing.
    let (dispatches, dispatches_unread) = match load_list(&*lock()?, DISPATCHES_KEY) {
        Ok(d) => (d, false),
        Err(e) => {
            eprintln!("kolux-rs: worktree ps: {}", e.message);
            (Vec::new(), true)
        }
    };
    let mut rows = Vec::new();
    for (p, all, degraded) in &lists {
        for w in all {
            let here = |h: &Option<String>| h.as_deref() == Some(w.path.as_str());
            let mine: Vec<Value> = sessions.iter().zip(&homes).filter(|(_, h)| here(h)).map(|((handle, _, program), _)| json!({ "terminal": handle, "program": program })).collect();
            let homed = |t: &str| sessions.iter().zip(&homes).any(|((handle, _, _), h)| handle == t && here(h));
            let workers = crate::orchestration::workers_in(&dispatches, &|d| lower(Path::new(d)) == lower(Path::new(&w.path)), &homed);
            if mine.is_empty() && workers.is_empty() {
                continue;
            }
            let mut row = worktree_row(p, w, all);
            row["sessions"] = json!(mine);
            row["workers"] = json!(workers);
            row["degraded"] = json!(degraded);
            rows.push(row);
        }
    }
    let worktrees: usize = lists.iter().map(|(_, all, _)| all.len()).sum();
    let mut scope = json!({ "repos": repos, "worktrees": worktrees, "shown": rows.len(), "machine": "this computer only", "hosts": hosts() });
    if dispatches_unread {
        scope["workersUnread"] = json!(true);
    }
    let truncated = limit.is_some_and(|n| rows.len() > n);
    rows.truncate(limit.unwrap_or(usize::MAX));
    let mut out = json!({ "worktrees": rows, "truncated": truncated, "hosts": hosts(), "scope": scope });
    // A terminal polling with --json gets the full snapshot once, then a tiny answer while it holds.
    if let (true, Some(pane)) = (req.args["json"] == true, &req.pane) {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        json!([out["worktrees"], out["truncated"], repos.iter().map(|r| &r["error"]).collect::<Vec<_>>()]).to_string().hash(&mut h);
        let snap = h.finish();
        let seen = POLLS.lock().unwrap_or_else(|e| e.into_inner()).insert(pane.key.clone(), snap);
        if seen == Some(snap) {
            return Ok(json!({ "unchanged": true, "snapshot": format!("{snap:016x}") }));
        }
        out["snapshot"] = json!(format!("{snap:016x}"));
    }
    Ok(out)
}

fn hosts() -> Value {
    json!({ "covered": ["local"], "leftOut": [] })
}

/// The ref a repo's worktrees are measured against: its saved base while that exists, else the
/// default branch. Only reads: unlike a create, nothing is fetched.
fn base_of(ctx: &Ctx, p: &Project) -> Option<String> {
    let repo = Path::new(&p.path);
    p.base.as_deref().map(str::trim).filter(|b| !b.is_empty() && ctx.git.rev_exists(repo, b)).map(String::from).or_else(|| ctx.git.default_branch(repo))
}

fn change_rows(list: &[crate::scm::Change]) -> Vec<Value> {
    list.iter().map(|c| json!({ "path": c.path, "status": c.status })).collect()
}

/// CLI-021: the siblings in the same repo (hidden ones too) whose changes share a file with this
/// worktree's, each with a clash prediction from the committed tips; siblings whose changes could
/// not be read are listed apart, and then the scan is not complete.
fn overlap(ctx: &Ctx, p: &Project, w: &Worktree) -> Result<Value, Fail> {
    let base = base_of(ctx, p);
    let mine: Vec<String> = crate::scm::changes(Path::new(&w.path), base.as_deref())?.into_iter().map(|c| c.path).collect();
    let listed = ctx.git.worktrees(Path::new(&p.path));
    let complete = listed.is_ok();
    let (mut siblings, mut unreadable, mut checked) = (Vec::new(), Vec::new(), 0);
    for s in listed.unwrap_or_default().into_iter().filter(|s| !same_dir(&s.path, &w.path)) {
        let theirs = if Path::new(&s.path).is_dir() { crate::scm::changes(Path::new(&s.path), base.as_deref()) } else { Err("its folder is missing".to_string()) };
        let theirs = match theirs {
            Ok(t) => t,
            Err(why) => {
                unreadable.push(json!({ "path": s.path, "branch": s.branch, "why": why }));
                continue;
            }
        };
        checked += 1;
        // ponytail: a linear scan per sibling; fine for the dozens of files a worktree touches.
        let shared: Vec<String> = theirs.into_iter().map(|c| c.path).filter(|f| mine.contains(f)).collect();
        if shared.is_empty() {
            continue;
        }
        let forecast = if ctx.git.predicts_merges() {
            crate::scm::clash(Path::new(&p.path), &w.head, &s.head)
        } else {
            crate::scm::Clash::Unverifiable(format!("{} is older than 2.38, which predicting a merge needs", ctx.git.version))
        };
        let (clash, conflicts, why) = match forecast {
            crate::scm::Clash::Clean => ("clean", Vec::new(), None),
            crate::scm::Clash::Conflict(files) => ("conflict", files, None),
            crate::scm::Clash::Unverifiable(why) => ("unverifiable", Vec::new(), Some(why)),
        };
        siblings.push(json!({ "path": s.path, "branch": s.branch, "files": shared, "clash": clash, "conflicts": conflicts, "why": why }));
    }
    let complete = complete && unreadable.is_empty();
    Ok(json!({ "worktree": w.path, "branch": w.branch, "base": base, "files": mine.len(), "siblings": siblings, "checked": checked, "unreadable": unreadable, "complete": complete, "hosts": hosts() }))
}

fn query(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let limit = text("limit").and_then(|l| l.parse::<usize>().ok());
    let lock = || ctx.store.lock().map_err(|e| Fail::from(e.to_string()));
    match req.command.as_str() {
        "repo.list" | "project.list" => {
            let rows: Vec<Value> = projects::load_projects(&*lock()?).iter().map(repo_row).collect();
            Ok(if req.command == "repo.list" { json!({ "repos": rows }) } else { json!({ "projects": rows }) })
        }
        "repo.add" => {
            let path = text("path").ok_or_else(|| Fail::args("--path is required"))?;
            let p = projects::add_project(ctx.git, &*lock()?, &Path::new(&req.cwd).join(path))?;
            (ctx.notify)(json!({ "kind": "repo", "projectId": p.id }));
            Ok(repo_row(&p))
        }
        "repo.show" => {
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            let count = projects::list_workspaces(ctx.git, &*lock()?, &p)?.len();
            let mut row = repo_row(&p);
            row["base"] = json!(base_of(ctx, &p));
            row["worktrees"] = json!(count);
            Ok(row)
        }
        "repo.set-base-ref" => {
            let r = text("ref").ok_or_else(|| Fail::args("--ref is required"))?;
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            if !ctx.git.base_available(Path::new(&p.path), &r) {
                return Err(Fail::new("not_found", format!("{r} is not a branch, tag or commit in {}", p.name)));
            }
            let p = projects::set_base(&*lock()?, &p.id, Some(&r))?;
            (ctx.notify)(json!({ "kind": "repo", "projectId": p.id }));
            Ok(repo_row(&p))
        }
        "repo.search-refs" => {
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            let q = text("query").unwrap_or_default().to_lowercase();
            let out = crate::git::run(&["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"], Some(Path::new(&p.path)))?;
            let refs: Vec<Value> = out
                .lines()
                .filter_map(|full| {
                    let (kind, name) = [("branch", "refs/heads/"), ("remote", "refs/remotes/"), ("tag", "refs/tags/")].into_iter().find_map(|(k, pre)| full.strip_prefix(pre).map(|n| (k, n)))?;
                    (!name.ends_with("/HEAD") && name.to_lowercase().contains(&q)).then(|| json!({ "name": name, "kind": kind }))
                })
                .take(limit.unwrap_or(20))
                .collect();
            Ok(json!({ "repoId": p.id, "refs": refs }))
        }
        "worktree.ps" => ps(ctx, req, text("repo").map(|r| pick_project(ctx, Some(&r), &req.cwd)).transpose()?, limit),
        "worktree.list" => {
            let only = text("repo").map(|r| pick_project(ctx, Some(&r), &req.cwd)).transpose()?;
            let (mut lists, mut unreadable) = (Vec::new(), Vec::new());
            {
                let store = lock()?;
                for p in projects::load_projects(&store).into_iter().filter(|p| only.as_ref().is_none_or(|o| o.id == p.id)) {
                    // T-596 (CLI-017, R01-cli.8): a project whose folder is gone or offline (APP-051 keeps
                    // it) is named, not fatal: the others are still listed, as pick_in and terminal_rows do.
                    // With --repo naming that one project there is nothing else to list, so its error stands.
                    match projects::list_workspaces(ctx.git, &store, &p) {
                        Ok(all) => lists.push((p, all)),
                        Err(e) if only.is_some() => return Err(e.into()),
                        Err(e) => unreadable.push(json!({ "repoId": p.id, "repo": p.name, "path": p.path, "error": e.trim() })),
                    }
                }
            }
            let mut rows: Vec<Value> = lists.iter().flat_map(|(p, all)| all.iter().map(move |w| worktree_row(p, w, all))).collect();
            let truncated = limit.is_some_and(|n| rows.len() > n);
            rows.truncate(limit.unwrap_or(usize::MAX));
            Ok(json!({ "worktrees": rows, "truncated": truncated, "hosts": hosts(), "unreadable": unreadable }))
        }
        "worktree.changes" | "worktree.overlap" => {
            let (p, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
            if req.command == "worktree.overlap" {
                return overlap(ctx, &p, &w);
            }
            let base = base_of(ctx, &p);
            let files = crate::scm::changes(Path::new(&w.path), base.as_deref())?;
            Ok(json!({ "worktree": w.path, "branch": w.branch, "base": base, "files": change_rows(&files) }))
        }
        "worktree.show" | "worktree.current" => {
            let sel = if req.command == "worktree.current" { "current".to_string() } else { text("worktree").unwrap_or_else(|| "current".into()) };
            let (p, w) = pick_worktree(ctx, &sel, &req.cwd)?;
            let all = projects::list_workspaces(ctx.git, &*lock()?, &p)?;
            let mut row = worktree_row(&p, &w, &all);
            // USAGE-016: an automation run (or anyone) asks what this worktree's sessions used. A
            // worktree nested inside this one keeps its own.
            if a["usage"].as_bool().unwrap_or(false) {
                crate::token_usage::rescan_tracked(ctx.store);
                let nested: Vec<&str> = all.iter().filter(|o| !same_dir(&o.path, &w.path) && under(&w.path, &o.path)).map(|o| o.path.as_str()).collect();
                row["usage"] = crate::token_usage::usage_in(ctx.store, |cwd| !cwd.is_empty() && under(&w.path, cwd) && !nested.iter().any(|n| under(n, cwd)));
            }
            Ok(row)
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- mail (ORCH-001..005)

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The pane a call came from, when the runtime can vouch for it.
fn caller(ctx: &Ctx, req: &Request) -> Result<Option<String>, Fail> {
    caller_with(req, &|k| ctx.terminals.by_key(k))
}

/// `caller` with the terminal behind a pane key given, so a test can stand a pane in.
fn caller_with(req: &Request, by_key: &dyn Fn(&str) -> Option<String>) -> Result<Option<String>, Fail> {
    let pane = req.pane.as_ref().map(|p| (p.handle.as_str(), p.key.as_str()));
    crate::orchestration::caller_of(req.args["from"].as_str(), pane, by_key)
}

fn unbound() -> Fail {
    Fail { code: "unbound_caller", message: "who is calling cannot be told: this needs the identity of a Kolux terminal, so run it inside one".into(), data: json!({ "hint": "a shell Kolux did not start has no KOLUX_TERMINAL_HANDLE and KOLUX_PANE_KEY" }) }
}

/// Runs, sends and checks. Everything that ties, sends or reads needs a pane the runtime knows;
/// a shell outside Kolux is turned away rather than tied to a guess (ORCH-001).
fn mail(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    use crate::orchestration::{Mail, Mode};
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let pane = caller(ctx, req)?;
    let need = || pane.clone().ok_or_else(unbound);
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut m = Mail::load(&store);
    // Row 877: a mail that could not be read is refused by every command that saves, before it changes anything.
    if MAIL_WRITES.contains(&req.command.as_str()) && !(req.command == "orchestration.dispatch" && a["dryRun"] == true) {
        m.ensure_readable()?;
    }
    let retry = text("retryRequest").map(|r| format!("{}|{}|{r}", req.command, pane.clone().unwrap_or_default()));
    let out = match req.command.as_str() {
        "orchestration.run-create" => {
            let p = need()?;
            let objective = text("objective").ok_or_else(|| Fail::args("--objective is required"))?;
            m.once(retry, |m| Ok(m.run_create(&p, &objective, now_ms())))?
        }
        "orchestration.run-use" => {
            let p = need()?;
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            m.once(retry, |m| m.run_use(&p, &id))?
        }
        "orchestration.run-current" => m.run_current(&need()?),
        "orchestration.run-list" => m.run_list(text("limit").and_then(|l| l.parse().ok()).unwrap_or(20).min(100), text("cursor").as_deref())?,
        "orchestration.run-show" => m.run_show(&text("id").ok_or_else(|| Fail::args("--id is required"))?)?,
        "orchestration.request-show" => m.request_show(&pane.clone().unwrap_or_default(), &text("request").ok_or_else(|| Fail::args("--request is required"))?, u64::from(std::process::id())),
        SEND => {
            let p = need()?;
            let (mut tasks, mut dispatches) = (load_list(&store, TASKS_KEY)?, load_list(&store, DISPATCHES_KEY)?);
            let peers = peers(ctx);
            let v = m.once(retry, |m| {
                let mut v = m.post(&p, a, &dispatches, &peers, now_ms())?;
                // ORCH-015: the worker's own done report settles its task with the mail.
                let settled = crate::orchestration::report(&mut tasks, &mut dispatches, &p, a, now_ms(), &|t| crate::orchestration::process_generation(ctx.terminals, t))?;
                if !settled.is_null() {
                    v["settled"] = settled;
                }
                Ok(v)
            })?;
            // ORCH-007 (T-030-b): an idle agent that reads this mail gets one line pointing at it.
            let ids: Vec<String> = v["messageIds"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(str::to_string)).collect();
            crate::orchestration::pointer::after_send(ctx.terminals, &m, &dispatches, &ids, &peers, &p);
            if !v["settled"].is_null() {
                let (t, d) = (Value::Array(tasks).to_string(), Value::Array(dispatches).to_string());
                store.set_all(&[(TASKS_KEY, &t), (DISPATCHES_KEY, &d)]).map_err(|e| Fail::new("failed", e.to_string()))?;
            }
            v
        }
        CHECK => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY)?;
            let (reader, boxes) = match (text("terminal"), text("run")) {
                (Some(t), _) => {
                    seen_from(&m, &p, &t, &dispatches)?;
                    (t.clone(), m.boxes_of(&t, &dispatches))
                }
                (None, Some(r)) => {
                    m.run_show(&r)?;
                    in_run(&m, &p, &r, &dispatches)?;
                    (format!("run:{r}"), vec![format!("run:{r}")])
                }
                (None, None) => (p.clone(), m.boxes_of(&p, &dispatches)),
            };
            let mode = if a["peek"] == true { Mode::Peek } else if a["unread"] == true { Mode::Unread } else if a["all"] == true { Mode::All } else { Mode::Next };
            let types: Option<Vec<String>> = text("types").map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect());
            if let Some(bad) = types.iter().flatten().find(|t| !crate::orchestration::KINDS.contains(&t.as_str())) {
                return Err(Fail::args(format!("--types does not know {bad}")));
            }
            let r = m.check(&p, &reader, &boxes, mode, types.as_deref(), text("ack").as_deref(), a["fence"].as_u64())?;
            // ORCH-007 (T-030-b): reading its own mail drops a pointer not yet typed; a waiting check takes the mail.
            crate::orchestration::pointer::after_check(&p, &reader, a["wait"] == true);
            r
        }
        "orchestration.reply" => {
            let p = need()?;
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            let body = a["body"].as_str().unwrap_or_default().to_string();
            let run = text("run");
            let dispatches = load_list(&store, DISPATCHES_KEY)?;
            let (boxes, mine) = (m.boxes_of(&p, &dispatches), m.run_of(&p, &dispatches));
            m.once(retry, |m| m.reply(&p, &id, &body, run.as_deref(), &boxes, mine.as_deref(), now_ms()))?
        }
        "orchestration.inbox" => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY)?;
            let reader = match text("terminal") {
                Some(t) => {
                    seen_from(&m, &p, &t, &dispatches)?;
                    t
                }
                None => p,
            };
            let boxes = m.boxes_of(&reader, &dispatches);
            m.inbox(&reader, &boxes, text("limit").and_then(|l| l.parse().ok()).unwrap_or(20).min(200), a["full"] == true)
        }
        RESET => {
            let scope = SCOPES.into_iter().find(|k| a[*k] == true).ok_or_else(|| Fail::args("reset needs exactly one scope: --all, --tasks or --messages"))?;
            reset(&store, &mut m, scope)?
        }
        ASK => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY)?;
            let peers = peers(ctx);
            m.once(retry, |m| m.ask(&p, a, &dispatches, &peers, now_ms()))?
        }
        "orchestration.task-create" | "orchestration.task-list" | "orchestration.dispatch" | "orchestration.dispatch-show" | ABANDON | UPDATE | TASK_RESET | STOP | WORKER_LIST | RETAIN | RELEASE | WORKER_SHOW | WORKER_READ | "orchestration.gate-create" | "orchestration.gate-resolve" | "orchestration.gate-list" => tasks(ctx, &store, &mut m, req, pane.as_deref(), retry)?,
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    // Reads on an unread mail answer from the empty mail; there is nothing to save or rebind.
    if !m.unread {
        m.save(&store)?;
        crate::orchestration::pointer::rebind(&m);
    }
    Ok(out)
}

/// ORCH-033: a pane reads another pane's mail only when both act in the same Run; any other
/// terminal reads as one that is not there.
fn seen_from(m: &crate::orchestration::Mail, me: &str, other: &str, dispatches: &[Value]) -> Result<(), Fail> {
    let mine = m.run_of(me, dispatches);
    if other == me || (mine.is_some() && m.run_of(other, dispatches) == mine) {
        return Ok(());
    }
    Err(Fail::new("not_found", format!("no open Kolux terminal is called {other}")))
}

/// ORCH-033: reading a Run's mail, and any change in a Run, needs the pane to act in that Run.
fn in_run(m: &crate::orchestration::Mail, me: &str, run: &str, dispatches: &[Value]) -> Result<(), Fail> {
    if m.run_of(me, dispatches).as_deref() == Some(run) {
        return Ok(());
    }
    Err(Fail::new("not_bound", format!("this terminal is not in {run}; read its summary with {} orchestration run-show --id {run}", crate::orchestration::CLI)))
}

/// ORCH-032: the cap a call asks for (`--max-depth`) and the configured one (`orchestrationMaxDepth`
/// in settings, whole numbers of 1 or more).
fn caps(store: &Store, a: &Value) -> (Option<u32>, Option<u32>) {
    let asked = a["maxDepth"].as_str().and_then(|v| v.trim().parse().ok()).or(a["maxDepth"].as_u64().map(|n| n as u32)).filter(|n| *n >= 1);
    let configured = store.settings()["orchestrationMaxDepth"].as_u64().filter(|n| *n >= 1).map(|n| n as u32);
    (asked, configured)
}

/// CLI-038: clears one scope of orchestration state, and the remembered answers of its changes.
fn reset(store: &Store, m: &mut crate::orchestration::Mail, scope: &str) -> Result<Value, Fail> {
    // Row 193: an unread mail cannot be saved, so refuse before the lists below are cleared.
    m.ensure_readable()?;
    let (mut tasks, mut dispatches, mut messages, mut runs) = (0, 0, 0, 0);
    if scope != "messages" {
        tasks = load_list(store, TASKS_KEY)?.len();
        dispatches = load_list(store, DISPATCHES_KEY)?.len();
        save_list(store, TASKS_KEY, &[])?;
        save_list(store, DISPATCHES_KEY, &[])?;
    }
    if scope != "tasks" {
        messages = m.messages.len();
        m.messages.clear();
        m.deliveries.clear();
    }
    if scope == "all" {
        runs = m.runs.len();
        m.runs.clear();
        m.bindings.clear();
    }
    let of_tasks = ["orchestration.task-create|", "orchestration.dispatch|", "orchestration.worker-start|"];
    let of_messages = ["orchestration.send|", "orchestration.reply|"];
    m.answers.retain(|k, _| match scope {
        "tasks" => !of_tasks.iter().any(|p| k.starts_with(p)),
        "messages" => !of_messages.iter().any(|p| k.starts_with(p)),
        _ => false,
    });
    // ORCH: the mail side's own reset (gates for tasks; everything for all), after the counts.
    m.reset(scope)?;
    Ok(json!({ "scope": scope, "tasks": tasks, "dispatches": dispatches, "messages": messages, "runs": runs }))
}

/// ORCH-010, ORCH-011, ORCH-013: tasks in a Run, and handing one to an agent terminal that is
/// already open. A task belongs to the Run named with --run, else to the caller's tied Run.
fn tasks(ctx: &Ctx, store: &Store, m: &mut crate::orchestration::Mail, req: &Request, pane: Option<&str>, retry: Option<String>) -> Result<Value, Fail> {
    use crate::orchestration as o;
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let named = text("run");
    if let Some(r) = &named {
        m.run_show(r)?;
    }
    let mut tasks = load_list(store, TASKS_KEY)?;
    o::promote(&mut tasks);
    let mut dispatches = load_list(store, DISPATCHES_KEY)?;
    // cli FIX-8: a session the window started after its start gave up is recorded on its row first, so
    // worker-show, worker-stop and worker-release see (and can end) it.
    reconcile_late(&mut dispatches, &|t| ctx.terminals.live(&crate::terminal::handle_of(t)).then(|| mark_program(ctx.terminals, t)));
    // cli FIX-12: and one whose late terminal is gone (closed by hand) is spent before any arm reads it.
    spend_gone_late(&mut dispatches, &|h| ctx.terminals.live(h));
    // after-list row 625: what each worker's hooks reported is kept on its row, to outlive the terminal.
    keep_transcripts(&mut dispatches, &worker_read::own_transcript);
    // ORCH-033: a pane acts in its own Run; another Run can be named to read it, never to change it.
    let own = pane.and_then(|p| m.run_of(p, &dispatches));
    let run = named.clone().or_else(|| own.clone());
    let caps = caps(store, a);
    // cli FIX-10: the dispatch worker-show reads, kept before the arms use up `run`.
    let shown_row = (req.command == WORKER_SHOW).then(|| (text("dispatch"), run.clone()));
    // cli FIX-11: the Run this answer speaks for, kept for the late notes (the arms use `run` up).
    let scope = run.clone();
    let changes = !READS.contains(&req.command.as_str()) && a["dryRun"] != true;
    if let (true, Some(n), Some(p)) = (changes, &named, pane) {
        in_run(m, p, n, &dispatches)?;
    }
    let out = match req.command.as_str() {
        "orchestration.task-create" => {
            // CLI-034: the creator is the calling terminal; with none known the command fails closed.
            let me = pane.ok_or_else(unbound)?.to_string();
            m.once(retry, |_| {
                let mut t = o::task_create(&mut tasks, a, run.clone(), now_ms())?;
                t["createdBy"] = json!(me);
                if let Some(last) = tasks.last_mut() {
                    last["createdBy"] = json!(me);
                }
                Ok(t)
            })?
        }
        "orchestration.task-list" => o::task_list(&tasks, &dispatches, run.as_deref(), a, &|h| ctx.terminals.live(h))?,
        "orchestration.dispatch" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            // CLI-034: a dry run needs no recipient; it only shows the opening text.
            let to = text("to");
            let (i, agent, tid) = match &to {
                Some(to) => {
                    let tid = to.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).filter(|_| ctx.terminals.live(to)).ok_or_else(|| Fail::new("not_found", format!("no open Kolux terminal is called {to}")))?;
                    // ORCH-032: handing work on from a worker counts as a level of nesting, except a
                    // context-only dispatch to the worker's own pane while budget remains.
                    let nested = o::nest(pane, &dispatches, caps.0, caps.1);
                    let own_ok = a["inject"] != true && nested.is_ok();
                    if Some(to.as_str()) != pane || a["inject"] == true {
                        nested.clone()?;
                    }
                    let (i, agent) = o::dispatch_check(&tasks, &dispatches, &task, to, pane, run.as_deref(), own_ok, &|h| pane_agent(ctx, h))?;
                    (i, Some(agent), Some(tid))
                }
                None if a["dryRun"] == true => (o::task_in(&tasks, &task, run.as_deref())?, None, None),
                None => return Err(Fail::args("--to is required")),
            };
            let (depth, cap) = o::nest(pane, &dispatches, caps.0, caps.1).unwrap_or((1, caps.0.or(caps.1).unwrap_or(o::DEFAULT_MAX_DEPTH)));
            let id = next_id(&dispatches, "dispatch-");
            let run = tasks[i]["runId"].as_str().map(str::to_string).or(run);
            let behind = to.as_deref().and_then(|t| ctx.terminals.dir_of(t)).and_then(|d| {
                let p = projects::load_projects(store).into_iter().find(|p| projects::list_workspaces(ctx.git, store, p).is_ok_and(|ws| ws.iter().any(|w| same_dir(&w.path, &d))))?;
                drift(ctx.git, &p, &d)
            });
            let brief = o::brief(&tasks[i], &o::Brief { dispatch: &id, run: run.as_deref(), coordinator: pane, behind, levels_left: cap.saturating_sub(depth) });
            let mode = if a["inject"] == true { "inject" } else { "context" };
            let mut plan = json!({ "dispatchId": id, "taskId": task, "to": to, "agent": agent, "runId": run, "mode": mode });
            if a["returnPreamble"] == true || a["dryRun"] == true {
                plan["preamble"] = json!(brief);
            }
            if a["dryRun"] == true {
                plan["dryRun"] = json!(true);
                plan["taskStatus"] = tasks[i]["status"].clone();
                return Ok(plan);
            }
            m.once(retry, |_| {
                if let (Some(tid), "inject") = (tid, mode) {
                    type_brief(ctx, tid, &brief)?;
                }
                // T-260-d: the starting pane's terminal, so the Floor nests a worker with no parent task under it.
                let from = pane.and_then(|h| h.strip_prefix("term-")?.parse::<u32>().ok());
                dispatches.push(json!({ "id": id, "runtime": std::process::id(), "runId": run, "taskId": task, "status": "running", "terminal": tid, "fromTerminal": from, "agent": agent, "mode": mode, "depth": depth, "maxDepth": cap, "brief": brief, "created": now_ms() }));
                tasks[i]["status"] = json!("dispatched");
                tasks[i]["dispatchId"] = json!(id);
                Ok(plan.clone())
            })?
        }
        "orchestration.dispatch-show" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            let mut v = dispatches.iter().rev().find(|d| d["taskId"] == task && d["runId"].as_str() == run.as_deref()).cloned().ok_or_else(|| Fail::new("not_found", format!("{task} has not been dispatched")))?;
            let brief = v.as_object_mut().and_then(|o| o.remove("brief"));
            // ORCH-067: the pass lives only inside the brief's commands, never as a field.
            v.as_object_mut().and_then(|o| o.remove("pass"));
            v["handle"] = json!(v["terminal"].as_u64().map(|t| crate::terminal::handle_of(t as u32)));
            if a["preamble"] == true {
                v["preamble"] = brief.unwrap_or_default();
            }
            v
        }
        ABANDON => {
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            m.once(retry, |_| o::abandon(&mut tasks, &mut dispatches, &id, run.as_deref(), now_ms()))?
        }
        TASK_RESET => {
            // ORCH-035 (T-279-d): breaker_reset closes the held task's breaker (the window's own task_reset command was never called and is gone, cycle 2).
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            m.once(retry, |_| o::breaker_reset(&tasks, &mut dispatches, &id, run.as_deref(), now_ms()))?
        }
        UPDATE => {
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            let to = text("status").ok_or_else(|| Fail::args("--status is required"))?;
            let result = a["result"].as_str().map(str::to_string);
            m.once(retry, |_| {
                let out = o::task_update(&mut tasks, &mut dispatches, &id, &to, result.as_deref(), run.as_deref(), pane, now_ms())?;
                o::promote(&mut tasks);
                Ok(out)
            })?
        }
        STOP => {
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            m.once(retry, |_| {
                // FIX-1 S2: what each terminal runs now, so one that is not the worker's own stays open;
                // cli FIX-4: a custom-command worker's recorded session is its own.
                let own = own_program(&dispatches, &id, run.as_deref());
                let now = |t: u32| session_now(ctx.terminals, t);
                let agent_of = |h: &str| runs_now(h, own.as_ref(), &now);
                let (mut receipt, kill) = o::stop_with(&mut tasks, &mut dispatches, &id, run.as_deref(), now_ms(), &agent_of)?;
                // ORCH-022: the agent terminal ends while the store is held, so its exit is never
                // taken for a worker that died by itself.
                if let Some(tid) = kill {
                    let ended = ctx.terminals.live(&crate::terminal::handle_of(tid)) && ctx.terminals.kill(tid).is_ok();
                    if !ended {
                        receipt["process"] = json!("unverifiable");
                        if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == id.as_str()) {
                            d["process"] = json!("unverifiable");
                        }
                        o::stop_warning(&mut receipt);
                    }
                }
                Ok(receipt)
            })?
        }
        WORKER_LIST => {
            // ORCH-026: the named Run, else the tied Run, else every Run; the answer says which.
            let from = if named.is_some() { "named" } else if own.is_some() { "tied" } else { "all" };
            let limit = text("limit").and_then(|v| v.parse::<usize>().ok()).unwrap_or(50);
            let live = |h: &str| ctx.terminals.live(h);
            late_rows(o::worker_list(&tasks, &dispatches, run.as_deref(), from, text("terminalState").as_deref(), text("cursor").as_deref(), limit, &live)?, &dispatches)
        }
        RETAIN => {
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            let live = |h: &str| ctx.terminals.live(h);
            m.once(retry, |_| o::retain(&mut dispatches, &live, &id, run.as_deref()))?
        }
        RELEASE => {
            // ORCH-024 (T-089-c): pending first, then the output saved, and only after a save the
            // terminal closed; a step that did not happen leaves the release unknown with its retry.
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            let live = |h: &str| ctx.terminals.live(h);
            let dir = store.dir();
            let save = |rows: &[Value]| {
                let d = Value::Array(rows.to_vec()).to_string();
                store.set_all(&[(DISPATCHES_KEY, &d)]).map_err(|e| Fail::new("failed", e.to_string()))
            };
            let read = |t: u32| ctx.terminals.read(t, None, None);
            let kill = |t: u32| ctx.terminals.kill(t).is_ok();
            // FIX-1 S1: a terminal that now runs another agent, or a plain shell, is left open;
            // cli FIX-4: a custom-command worker's recorded session is its own.
            let own = own_program(&dispatches, &id, run.as_deref());
            let now = |t: u32| session_now(ctx.terminals, t);
            let agent_of = |h: &str| runs_now(h, own.as_ref(), &now);
            m.once(retry, |_| release_worker(&mut dispatches, &id, run.as_deref(), &live, &agent_of, &dir, &save, &read, &kill))?
        }
        WORKER_SHOW => {
            // CLI-036 / T-129-d: the pane's own hook state, else a prompt read off its newest output
            // (ORCH-056), decides whether the worker waits on a person; a quiet pane reads unknown.
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            let live = |h: &str| ctx.terminals.live(h);
            let tid = dispatches.iter().find(|d| d["id"] == id.as_str() && d["runId"].as_str() == run.as_deref()).and_then(o::terminal_of).and_then(|h| h.strip_prefix("term-")?.parse::<u32>().ok());
            // T-089-d (ORCH-020): Kolux looked when the pane's hooks report a state or its newest output could be read.
            let hook = tid.and_then(crate::status::state_of);
            let frame = tid.and_then(|t| ctx.terminals.read(t, None, Some(crate::prompt_scan::FRAME_LINES)));
            let looked = hook.is_some() || frame.is_some();
            let attention = tid.and_then(|t| crate::prompt_scan::worker_attention(t, || frame));
            let mut shown = o::worker_show(&tasks, &dispatches, &id, run.as_deref(), &live, attention)?;
            let open = tid.is_some_and(|t| ctx.terminals.live(&crate::terminal::handle_of(t)));
            worker_read::settle_waiting(&mut shown, open, looked, hook);
            // cli FIX-9: a session recorded after the start gave up, and the status the row already had then.
            if let Some(d) = dispatches.iter().find(|d| d["id"] == id.as_str() && d["runId"].as_str() == run.as_deref()) {
                for k in ["lateStamp", "lateAfter"] {
                    if !d[k].is_null() {
                        shown[k] = d[k].clone();
                    }
                }
            }
            shown
        }
        WORKER_READ => {
            // ORCH-021 / CLI-036 (T-089-d): the worker's own transcript, else its terminal output as a
            // fallback, else the archive saved at its release; dispatch passes hidden throughout.
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            let ask = worker_read::Ask::from_args(a)?;
            let d = dispatches.iter().find(|d| d["id"] == id.as_str() && d["runId"].as_str() == run.as_deref()).cloned().ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
            let tid = o::terminal_of(&d).and_then(|h| h.strip_prefix("term-")?.parse::<u32>().ok());
            let live = tid.is_some_and(|t| ctx.terminals.live(&crate::terminal::handle_of(t)));
            let hook = tid.and_then(crate::status::state_of);
            let passes = o::passes(&dispatches);
            let worker = worker_read::Worker { d: &d, live, hook, passes: &passes };
            let transcript = || tid.and_then(worker_read::own_transcript).or_else(|| worker_read::kept_transcript(&d)).and_then(|p| worker_read::transcript_items(d["agent"].as_str(), &p, live));
            let terminal = |after: Option<u64>, limit: usize| tid.and_then(|t| ctx.terminals.read(t, after, Some(limit)));
            worker_read::read(&worker, &ask, transcript, terminal, worker_read::archive_lines)?
        }
        "orchestration.gate-create" => m.once(retry, |m| m.gate_create(run.as_deref(), &mut tasks, &dispatches, a, now_ms()))?,
        "orchestration.gate-resolve" => m.once(retry, |m| m.gate_resolve(run.as_deref(), &mut tasks, a, now_ms()))?,
        "orchestration.gate-list" => m.gate_list(run.as_deref(), a)?,
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    // cli FIX-10: every late note not yet read goes with this answer; worker-show on a dispatch reads its own.
    // cli FIX-12: an arm may have closed one (a stop): spent again before the notes are made.
    spend_gone_late(&mut dispatches, &|h| ctx.terminals.live(h));
    let late = pending_late_notes(&dispatches, scope.as_deref());
    if let Some((Some(id), shown_run)) = shown_row {
        if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == id.as_str() && d["runId"].as_str() == shown_run.as_deref()) {
            let open = d["terminal"].as_u64().and_then(|t| u32::try_from(t).ok()).is_some_and(|t| ctx.terminals.live(&crate::terminal::handle_of(t)));
            read_late(d, open);
        }
    }
    // ORCH-012: a task and its dispatch change together or not at all.
    let (t, d) = (Value::Array(tasks).to_string(), Value::Array(dispatches).to_string());
    store.set_all(&[(TASKS_KEY, &t), (DISPATCHES_KEY, &d)]).map_err(|e| Fail::new("failed", e.to_string()))?;
    Ok(with_late_notes(out, late))
}

/// ORCH-004: every open terminal with the agent Kolux started in it (none for a shell; a pane title
/// plays no part) and whether it has been quiet for `IDLE`.
fn peers(ctx: &Ctx) -> Vec<crate::orchestration::Peer> {
    // T-262-b: the peer list is the session tab inventory too (its agent credit is the same rule).
    crate::agents::inventory::tabs(ctx.terminals)
        .into_iter()
        .map(|t| {
            let idle = ctx.terminals.program_of(&t.handle, IDLE).is_some();
            crate::orchestration::Peer { agent: t.agent.map(str::to_string), idle, dir: t.cwd.unwrap_or_default(), handle: t.handle }
        })
        .collect()
}

/// The agent Kolux started in the calling pane. Unlike `pane_agent` it does not wait for the pane
/// to go quiet: the caller is busy echoing and running this very command.
fn own_agent(ctx: &Ctx, h: &str) -> Option<String> {
    peers(ctx).into_iter().find(|p| p.handle == h).and_then(|p| p.agent)
}

/// ORCH-013: the agent Kolux started in pane `h`, once it is up; a shell, or a program Kolux does
/// not know, is none.
fn pane_agent(ctx: &Ctx, h: &str) -> Option<String> {
    let p = ctx.terminals.program_of(h, SETTLE)?;
    let stem = Path::new(&p).file_stem()?.to_string_lossy().to_lowercase();
    crate::agents::agent_list().into_iter().find(|x| x.id == stem || x.program.eq_ignore_ascii_case(&stem)).map(|x| x.id)
}

// ---------------------------------------------------------------- terminal read, send, wait (CLI-024, CLI-025)

/// How long `send` watches for the agent to take a prompt unless `--wait-submit` says otherwise.
const SUBMIT_WATCH: Duration = Duration::from_secs(3);
/// T-596 (R01-cli.5): the longest `--wait-submit`, in seconds, as long as the longest browser wait.
/// The app answers kolux calls one at a time, and a huge number overflowed the clock and ended the app.
const WAIT_SUBMIT_MAX: u64 = 300;
/// MERGE 49: a zero wait would report an idle agent not submitted before it could start a turn.
const WAIT_SUBMIT_RANGE: &str = "--wait-submit takes the seconds to watch, from 1 to 300; leave it out for the default 3 s";
/// `terminal send` receipts by terminal and `--retry-request` id live in the store
/// (`orchestration::sendonce::Receipts`, ORCH-055): an exact retry, also after a restart, answers
/// without sending again.
const BLOCKED: [&str; 3] = ["permission", "waiting", "blocked"];

/// TERM-126: what became of a prompt sent with Enter, watched for `--wait-submit` seconds.
struct Submit {
    /// turn_began (taken), queued (the agent was working and still is), not_submitted (it was
    /// idle or needs an answer and no turn began), unknown (no status hooks report for the pane).
    receipt: &'static str,
    /// true = taken, false = did not submit within the wait, None = cannot be told.
    submitted: Option<bool>,
    /// The pane's hook state when the watch ended, where one is reported.
    state: Option<&'static str>,
    waited_ms: u64,
    warning: Option<String>,
}

/// Watches `activity` (the newest hooks history mark and whether the pane works) for up to `watch`.
/// The prompt is taken when a new history entry appears, or an idle pane turns working. Without a
/// hooks report (`before` is None) nothing can be told: with an explicit `--wait-submit` the output
/// stream is watched for the same time and the answer says whether anything was written after Enter.
fn submit_verdict(handle: &str, before: Option<((u64, usize), bool)>, watch: Duration, explicit: bool, mut activity: impl FnMut() -> Option<((u64, usize), bool)>, state: impl Fn() -> Option<&'static str>, mut output_moved: impl FnMut() -> bool) -> Submit {
    let start = Instant::now();
    // T-596: clamped and added without overflow, so no wait can panic (a panic ends the app).
    let watch = watch.min(Duration::from_secs(WAIT_SUBMIT_MAX));
    let until = start.checked_add(watch).unwrap_or(start);
    let secs = watch.as_secs();
    let Some((mark, busy)) = before else {
        let mut wrote = false;
        if explicit {
            while !wrote && Instant::now() < until {
                wrote = output_moved();
                if !wrote {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
        let seen = match (explicit, wrote) {
            (false, _) => String::new(),
            (true, true) => " (it wrote output after Enter, which a shell or an agent without hooks does either way)".to_string(),
            (true, false) => format!(" (it wrote nothing within {secs} s)"),
        };
        return Submit { receipt: "unknown", submitted: None, state: None, waited_ms: start.elapsed().as_millis() as u64, warning: Some(format!("no status hooks report for {handle}; whether the prompt was taken cannot be told{seen}")) };
    };
    // MERGE 49: a busy agent without an explicit --wait-submit answers queued at once, as before
    // T-188; only a wait the caller asked for is spent watching it (and can end in exit 1).
    if busy && !explicit {
        return Submit { receipt: "queued", submitted: Some(false), state: state(), waited_ms: 0, warning: Some(format!("{handle} is working; the prompt waits behind its turn (--wait-submit <seconds> watches for it to be taken)")) };
    }
    // An idle pane took the prompt when anything moved. A busy pane's own turn moves too: its end
    // (done, interrupted, blocked), a question (permission, waiting) and the carry-on after one are
    // the old turn; only a new turn after its end, or a new entry while it still works, is the prompt.
    let (mut mark, mut prev, mut ended, mut took) = (mark, state(), !busy, false);
    while !took && Instant::now() < until {
        if let Some((m, working)) = activity() {
            let now = state();
            if ended {
                took = m != mark || working;
            } else if m != mark {
                match now {
                    Some("done" | "interrupted" | "blocked") => ended = true,
                    Some("working") if !matches!(prev, Some("permission" | "waiting")) => took = true,
                    _ => {}
                }
                mark = m;
            }
            prev = now;
        }
        if !took {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let waited_ms = start.elapsed().as_millis() as u64;
    let state = state();
    if took {
        return Submit { receipt: "turn_began", submitted: Some(true), state, waited_ms, warning: None };
    }
    // Still in the turn it was busy with: queued behind it. Idle, or its turn ended and no new one began: lost.
    Submit { receipt: if ended { "not_submitted" } else { "queued" }, submitted: Some(false), state, waited_ms, warning: None }
}

/// TERM-126: the sentence for a prompt that did not submit, naming the pane's state.
fn not_submitted_line(r: &Value) -> String {
    let handle = r["terminal"].as_str().unwrap_or_default();
    let secs = r["waitSubmit"].as_u64().unwrap_or(0);
    let why = match r["state"].as_str() {
        Some("working") => "it is working; the prompt waits behind its turn".to_string(),
        Some("done") => "it is idle, so Enter may have been lost".to_string(),
        Some("permission") => "it is waiting for permission; answer that first".to_string(),
        Some("waiting") => "it is waiting for an answer; give it first".to_string(),
        Some("blocked") => "it is blocked".to_string(),
        Some("interrupted") => "it was interrupted".to_string(),
        Some(s) => format!("it is {s}"),
        None => "its state is not reported".to_string(),
    };
    format!("{handle} did not submit the prompt within {secs} s ({why})")
}

/// TERM-126: a send answer whose prompt did not submit becomes an error, so the exit status says so;
/// only when the caller asked for the wait with --wait-submit (MERGE 49). A plain send to a busy or
/// idle agent keeps exit 0 with a warning, so an agent never reads it as a failure and resends.
fn submit_step(env: &Value) -> Result<(), Fail> {
    let r = &env["result"];
    if env["success"] == Value::Bool(true) && r["submitted"] == Value::Bool(false) && r["waitAsked"] == Value::Bool(true) {
        let mut f = Fail::new("not_submitted", not_submitted_line(r));
        f.data = r.clone();
        return Err(f);
    }
    Ok(())
}

fn terminal_io(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let num = |k: &str, flag: &str| -> Result<Option<u64>, Fail> {
        match a[k].as_str() {
            None => Ok(None),
            Some(v) => v.trim().parse::<u64>().map(Some).map_err(|_| Fail::args(format!("{flag} takes a whole number, not `{}`", v.trim()))),
        }
    };
    // COMPAT 2.1: inside a Kolux terminal the command works on that terminal unless told otherwise.
    let handle = text("terminal").or_else(|| req.pane.as_ref().map(|p| p.handle.clone())).ok_or_else(|| Fail::args("--terminal <handle> is required outside a Kolux terminal (kolux worktree ps --json lists them)"))?;
    let id = handle.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).ok_or_else(|| Fail::args(format!("{handle} is not a terminal handle (term-<n>)")))?;
    let live = ctx.terminals.live(&handle);
    let gone = || Fail::new("not_found", format!("no open Kolux terminal is called {handle}"));
    match req.command.as_str() {
        "terminal.read" => {
            let cursor = num("cursor", "--cursor")?;
            let limit = num("limit", "--limit")?.map(|n| n as usize);
            if a["screen"].as_bool().unwrap_or(false) {
                if cursor.is_some() {
                    return Err(Fail::args("--screen and --cursor cannot be combined: a screen has no history"));
                }
                if !live {
                    return Err(gone());
                }
                let request = request_id();
                crate::terminal::screen_open(&request);
                (ctx.notify)(json!({ "emit": crate::terminal::SCREEN_EVENT, "payload": { "id": id, "request": request } }));
                if let Some(rows) = crate::terminal::screen_wait(&request) {
                    return hidden(ctx, json!({ "terminal": handle, "screen": true, "rows": rows }));
                }
                let r = ctx.terminals.read(id, None, limit).ok_or_else(gone)?;
                let mut out = serde_json::to_value(r).unwrap_or_default();
                out["terminal"] = json!(handle);
                out["screen"] = json!(false);
                out["warnings"] = json!([format!("the window did not supply {handle}'s screen; this is its output stream, not a screen")]);
                return hidden(ctx, out);
            }
            let r = ctx.terminals.read(id, cursor, limit).ok_or_else(gone)?;
            let mut warnings = Vec::new();
            if r.dropped {
                warnings.push(format!("only part of the output is kept: lines before cursor {} are gone; the oldest cursor to read on from is {}", r.oldest, r.oldest.saturating_sub(1)));
            }
            if r.more {
                warnings.push(match cursor {
                    Some(_) => format!("more lines follow; read on with --cursor {}", r.cursor),
                    None => "older lines were left out by --limit; page through them with --cursor".to_string(),
                });
            }
            let mut out = serde_json::to_value(r).unwrap_or_default();
            out["terminal"] = json!(handle);
            out["screen"] = json!(false);
            out["warnings"] = json!(warnings);
            hidden(ctx, out)
        }
        "terminal.send" => {
            let body = text("text");
            let enter = a["enter"].as_bool().unwrap_or(false);
            let interrupt = a["interrupt"].as_bool().unwrap_or(false);
            if body.is_none() && !enter && !interrupt {
                return Err(Fail::args("nothing to send: give --text, --enter or --interrupt"));
            }
            let asked = num("waitSubmit", "--wait-submit")?;
            if asked.is_some_and(|n| n == 0 || n > WAIT_SUBMIT_MAX) {
                return Err(Fail::args(WAIT_SUBMIT_RANGE));
            }
            let watch = asked.map(Duration::from_secs).unwrap_or(SUBMIT_WATCH);
            let retry = text("retryRequest").map(|r| format!("{handle}|{r}"));
            // Card 15: the receipt is saved after the lane lock is gone, so a same-request retry waits here for it.
            let retry_turn = retry.as_deref().map(retry_turn);
            let mut retry_turn = retry_turn.as_ref().map(|t| t.lock().unwrap_or_else(|p| p.into_inner()));
            // Row 883: an earlier send of this request typed but could not save its receipt; the memo stands in for it.
            if let Some((_, sent)) = retry_turn.as_deref().and_then(Option::as_ref) {
                let mut again = sent.clone();
                again["retried"] = json!(true);
                return Ok(again);
            }
            if let Some(key) = &retry {
                // ORCH-055: the receipt lasts in the store, so a retry after a restart sends nothing.
                // Card 13b: unreadable receipts refuse here, before anything is typed, so a retry never types twice.
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                let receipts = so::Receipts::try_load(&store).map_err(|e| Fail::new("failed", e))?;
                if let Some(receipt) = receipts.find(key) {
                    let mut again = receipt.clone();
                    again["retried"] = json!(true);
                    return Ok(again);
                }
            }
            if !live {
                return Err(gone());
            }
            let agent = ctx.terminals.program(id).flatten();
            let prompt = agent.is_some() && body.is_some() && enter;
            // TERM-126: a prompt to an agent is watched; so is any Enter when --wait-submit asks for it.
            let watching = prompt || (asked.is_some() && enter);
            let before = if watching { Some(crate::status::activity(id)) } else { None };
            let output_mark = |r: Option<crate::terminal::Read>| r.map(|r| (r.cursor, r.pending));
            let output_before = output_mark(ctx.terminals.read(id, None, Some(1)));
            let write = |s: &str| type_into(ctx, id, s).map_err(|e| Fail::new("failed", e));
            let mut delivered = Vec::new();
            if interrupt {
                write("\u{3}")?;
                crate::status::cancel(id);
                delivered.push("interrupt");
            }
            let mut sent_ms = now_ms();
            let mut held = None;
            if body.is_some() {
                // ORCH-055: the text goes in once the input box has settled, Enter once after a pause
                // that grows with its size; nothing is pasted while a permission prompt shows.
                let d = send_once(ctx, id, body.as_deref(), enter, agent.is_some())?;
                match &d.outcome {
                    so::Outcome::Blocked(why) => return Err(Fail::new("blocked", format!("{handle} shows a permission or approval prompt ({why}); nothing was pasted. Answer it first ({} terminal read --terminal {handle} --screen shows it), then send again", crate::orchestration::CLI))),
                    so::Outcome::Gone => return Err(gone()),
                    so::Outcome::Sent | so::Outcome::TextOnly => {}
                    other => held = Some(other.clone()),
                }
                delivered.extend(d.delivered);
                sent_ms = d.pasted_ms.unwrap_or(sent_ms);
            } else if enter {
                // A bare Enter answers what the agent shows; it is not a prompt, so it goes at once.
                write("\r")?;
                delivered.push("enter");
            }
            let mut out = json!({ "terminal": handle, "delivered": delivered, "agent": agent, "prompt": prompt });
            if let Some(h) = held {
                // The text is in the box and Enter was held back: say why and what to do; no retry pastes it again.
                out["receipt"] = json!(h.word());
                out["submitted"] = json!(false);
                out["enterHeld"] = json!(true);
                out["state"] = json!(crate::status::state_of(id));
                out["next"] = json!(format!("{} terminal read --terminal {handle} --screen", crate::orchestration::CLI));
                out["warnings"] = json!([held_line(&handle, &h)]);
            } else if let Some(before) = before {
                let next = format!("kolux terminal read --terminal {handle} --screen");
                let moved = || output_mark(ctx.terminals.read(id, None, Some(1))) != output_before;
                // ORCH-055: a report dated before the send is the old turn's, not proof the prompt arrived.
                let old_mark = before.map(|(m, _)| m);
                let activity = || crate::status::activity(id).map(|(m, working)| (if so::proves_arrival(m.0, sent_ms) { m } else { old_mark.unwrap_or(m) }, working));
                let v = submit_verdict(&handle, before, watch, asked.is_some(), activity, || crate::status::state_of(id), moved);
                out["receipt"] = json!(v.receipt);
                out["submitted"] = json!(v.submitted);
                out["state"] = json!(v.state);
                out["waitSubmit"] = json!(watch.as_secs());
                out["waitAsked"] = json!(asked.is_some());
                out["waitedMs"] = json!(v.waited_ms);
                if v.receipt != "turn_began" {
                    out["next"] = json!(next);
                }
                let mut warnings: Vec<String> = v.warning.into_iter().collect();
                if asked.is_none() && v.receipt == "not_submitted" {
                    warnings.push(not_submitted_line(&out));
                }
                out["warnings"] = json!(warnings);
            }
            if let Some(key) = retry {
                // Row 883: the text is already typed, so a receipt that cannot be saved is a warning, never "failed".
                let saved = ctx.store.lock().map_err(|e| e.to_string()).and_then(|store| {
                    let mut receipts = so::Receipts::try_load(&store)?;
                    receipts.record(&key, now_ms(), out.clone());
                    receipts.save(&store)
                });
                if let Err(why) = saved {
                    let mut warnings = out["warnings"].as_array().cloned().unwrap_or_default();
                    warnings.push(json!(format!("the receipt for this send was not saved ({why}); a retry in this run types nothing, but one after a restart would type again")));
                    out["warnings"] = json!(warnings);
                    if let Some(memo) = retry_turn.as_deref_mut() {
                        *memo = Some((now_ms(), out.clone()));
                    }
                }
            }
            Ok(out)
        }
        "terminal.wait" => {
            let what = text("for").ok_or_else(|| Fail::args("--for exit|tui-idle is required"))?;
            if !matches!(what.as_str(), "exit" | "tui-idle") {
                return Err(Fail::args(format!("--for takes exit or tui-idle, not `{what}`")));
            }
            if !live {
                // Either condition holds for a terminal that has ended.
                return Ok(json!({ "terminal": handle, "done": true, "state": "exited", "blocked": false }));
            }
            if what == "exit" {
                return Ok(json!({ "terminal": handle, "done": false, "state": "running", "blocked": false }));
            }
            match crate::status::state_of(id) {
                Some(state) => Ok(json!({ "terminal": handle, "done": state != "working", "state": state, "blocked": BLOCKED.contains(&state) })),
                None => {
                    // ponytail: no hooks report (a shell, or an agent without them): silence stands in for idle.
                    let quiet = ctx.terminals.quiet_for(id).is_none_or(|d| d >= IDLE);
                    Ok(json!({ "terminal": handle, "done": quiet, "state": if quiet { "quiet" } else { "writing" }, "blocked": false, "warnings": [format!("no status hooks report for {handle}; idle means {} s without output", IDLE.as_secs())] }))
                }
            }
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

fn same_dir(a: &str, b: &str) -> bool {
    Path::new(a).canonicalize().ok().is_some_and(|x| Path::new(b).canonicalize().ok() == Some(x))
}

/// ORCH-014: how many commits the worktree at `dir` is behind its project's base, when it is.
fn drift(git: &Git, project: &Project, dir: &str) -> Option<(u32, String)> {
    let base = project.base.clone().filter(|b| !b.trim().is_empty()).or_else(|| git.default_branch(Path::new(&project.path)))?;
    git.behind(Path::new(dir), &base).filter(|n| *n > 0).map(|n| (n, base))
}

/// ORCH-013's inject: the brief goes in as one bracketed paste, so its line breaks do not send it
/// early, then Enter submits it, once (ORCH-055). A brief turned away as blocked or left in the box
/// unsubmitted is a failure, so the dispatch keeps no receipt and the task is not marked dispatched.
fn type_brief(ctx: &Ctx, id: u32, brief: &str) -> Result<(), Fail> {
    let handle = crate::terminal::handle_of(id);
    let d = send_once(ctx, id, Some(brief), true, true)?;
    match d.outcome {
        so::Outcome::Sent => Ok(()),
        so::Outcome::Blocked(why) => Err(Fail::new("blocked", format!("{handle} shows a permission or approval prompt ({why}); the brief was not typed. Answer it first, then dispatch again"))),
        so::Outcome::Gone => Err(Fail::new("not_found", format!("{handle} ended while the brief was typed"))),
        other => Err(Fail::new("not_submitted", format!("{}; the brief is in {handle}'s input box, so press Enter there or send `{} terminal send --terminal {handle} --enter` instead of dispatching again", held_line(&handle, &other), crate::orchestration::CLI))),
    }
}

/// ORCH-055: why Enter was held back after the text went in.
fn held_line(handle: &str, o: &so::Outcome) -> String {
    match o {
        so::Outcome::Stale => format!("another writer typed into {handle} between the text and Enter, so Enter was held back and the send is stale"),
        so::Outcome::Cancelled => format!("the prompt was cancelled in {handle} while Kolux checked that the text arrived, so no Enter was sent"),
        so::Outcome::HeldPermission(why) => format!("{handle} showed a permission prompt mid-paste ({why}), so Enter was held back"),
        other => format!("the send to {handle} ended {}", other.word()),
    }
}

/// ORCH-055: types `text` (and Enter) into terminal `id` exactly once, behind the terminal's other
/// senders: waits for the input box to settle, pastes, holds Enter back for the size-scaled pause and
/// while a large paste is taken in, and never presses it when another writer, a cancel or a
/// permission prompt comes between the text and Enter.
/// Every keystroke `terminal send` types goes through here; tests count the calls.
fn type_into(ctx: &Ctx, id: u32, data: &str) -> Result<(), String> {
    #[cfg(test)]
    typed::bump(id);
    ctx.terminals.write(id, data)
}

#[cfg(test)]
mod typed {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    static COUNTS: Mutex<BTreeMap<u32, usize>> = Mutex::new(BTreeMap::new());

    pub fn bump(id: u32) {
        *COUNTS.lock().unwrap_or_else(|p| p.into_inner()).entry(id).or_default() += 1;
    }

    pub fn count(id: u32) -> usize {
        COUNTS.lock().unwrap_or_else(|p| p.into_inner()).get(&id).copied().unwrap_or(0)
    }
}

/// One lock per in-flight `terminal send` retry key; idle keys are dropped on the next call. It holds
/// the answer (and when it was given) of a send whose receipt could not be saved, until the receipt TTL.
type RetryTurn = std::sync::Arc<Mutex<Option<(u64, Value)>>>;

fn retry_turn(key: &str) -> RetryTurn {
    static TURNS: Mutex<BTreeMap<String, RetryTurn>> = Mutex::new(BTreeMap::new());
    retry_turn_in(&mut TURNS.lock().unwrap_or_else(|p| p.into_inner()), key, now_ms())
}

/// When this key's send memo was made; `None` while a send holds the key. A poisoned lock is read through.
fn memo_at(t: &RetryTurn) -> Option<Option<u64>> {
    match t.try_lock() {
        Ok(memo) => Some(memo.as_ref().map(|(at, _)| *at)),
        Err(std::sync::TryLockError::Poisoned(p)) => Some(p.into_inner().as_ref().map(|(at, _)| *at)),
        Err(std::sync::TryLockError::WouldBlock) => None,
    }
}

fn retry_turn_in(turns: &mut BTreeMap<String, RetryTurn>, key: &str, now: u64) -> RetryTurn {
    let remembered = |t: &RetryTurn| memo_at(t).is_none_or(|at| at.is_some_and(|at| now.saturating_sub(at) <= so::RECEIPT_TTL_MS));
    turns.retain(|k, t| k == key || std::sync::Arc::strong_count(t) > 1 || remembered(t));
    // The idle memos are capped like the saved receipts, oldest first.
    let mut idle: Vec<(u64, String)> = turns.iter().filter(|(k, t)| *k != key && std::sync::Arc::strong_count(t) == 1).filter_map(|(k, t)| Some((memo_at(t)??, k.clone()))).collect();
    if idle.len() > so::RECEIPTS_KEPT {
        idle.sort();
        for (_, k) in idle.drain(..idle.len() - so::RECEIPTS_KEPT) {
            turns.remove(&k);
        }
    }
    turns.entry(key.to_string()).or_default().clone()
}

fn send_once(ctx: &Ctx, id: u32, text: Option<&str>, enter: bool, agent: bool) -> Result<so::Delivery, Fail> {
    let turn = so::lane(id);
    let _turn = turn.lock().unwrap_or_else(|p| p.into_inner());
    let ticket = so::claim(id);
    let mut send = so::Send::new(text.map_or(0, str::len), enter, cfg!(windows), now_ms());
    let handle = crate::terminal::handle_of(id);
    let look = || {
        let now = now_ms();
        let tail = ctx.terminals.read(id, None, Some(8)).map(|r| r.lines.iter().map(|l| l.text.clone()).chain(std::iter::once(r.pending)).collect::<Vec<_>>().join("\n")).unwrap_or_default();
        let seen = so::current(id);
        so::Look {
            now_ms: now,
            last_output_ms: ctx.terminals.quiet_for(id).map(|q| now.saturating_sub(q.as_millis() as u64)),
            hooks_state: crate::status::state_of(id).map(str::to_string),
            screen_tail: tail,
            other_writer: seen.writer != ticket.writer,
            cancelled: seen.cancel != ticket.cancel,
            live: ctx.terminals.live(&handle),
        }
    };
    so::drive(&mut send, text, agent, look, |s| type_into(ctx, id, s), std::thread::sleep).map_err(|e| Fail::new("failed", e))
}

// ---------------------------------------------------------------- worker start (ORCH-016)

const TASKS_KEY: &str = "orchestration.tasks";
const DISPATCHES_KEY: &str = "orchestration.dispatches";
/// Readiness: the agent has written something and is still running this long after (ORCH-016).
/// ponytail: an idle detector comes with the status cards (STAT); first output is the honest
/// floor until then.
const SETTLE: Duration = Duration::from_millis(1000);
/// ORCH-004: an agent that has written nothing for this long counts as idle for @idle.
// ponytail: output quiet stands in for the idle detector of the STAT status cards.
const IDLE: Duration = Duration::from_secs(3);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Row 193: a list that no longer reads is kept aside (orchestration::kept) before it starts empty,
/// so the next save_list cannot wipe it. A store or copy that fails is an error, never an empty list
/// (a save would then overwrite the blob that was never kept).
fn load_list(store: &Store, key: &str) -> Result<Vec<Value>, Fail> {
    crate::orchestration::kept::load(store, key).map_err(Fail::from)
}

fn save_list(store: &Store, key: &str, list: &[Value]) -> Result<(), Fail> {
    store.set(key, &Value::Array(list.to_vec()).to_string()).map_err(|e| Fail::new("failed", e.to_string()))
}

/// after-list row 625: the transcript each worker's pane reported through its hooks is kept on the
/// dispatch row, so worker-read still has it once the terminal ends and the hook sessions go.
/// Returns whether any row changed.
fn keep_transcripts(dispatches: &mut [Value], own: &dyn Fn(u32) -> Option<PathBuf>) -> bool {
    let mut changed = false;
    for d in dispatches.iter_mut().filter(|d| d["released"] != true) {
        let Some(t) = crate::orchestration::terminal_of(d).and_then(|h| h.strip_prefix("term-")?.parse::<u32>().ok()) else { continue };
        let Some(path) = own(t).map(|p| p.to_string_lossy().into_owned()) else { continue };
        if d["transcript"].as_str() != Some(path.as_str()) {
            d["transcript"] = json!(path);
            changed = true;
        }
    }
    changed
}

/// The terminal-exit side of the same: stamps the rows of `terminal` before its sessions are retired.
/// Called by `terminal.rs` when a pane exits.
pub(crate) fn keep_transcript_of(store: &Store, terminal: u32) {
    let mut dispatches = match load_list(store, DISPATCHES_KEY) {
        Ok(d) => d,
        Err(e) => return eprintln!("kolux-rs: {}", e.message),
    };
    let mine = |t: u32| (t == terminal).then(|| worker_read::own_transcript(t)).flatten();
    if keep_transcripts(&mut dispatches, &mine) {
        let _ = save_list(store, DISPATCHES_KEY, &dispatches);
    }
}

/// ORCH-027: a worker's own terminal ended by itself (not closed by Kolux) before the worker
/// reported done: one high-priority escalation to its Run, its subject naming the task by title
/// (or id), so the coordinator can retry or reassign it. The dispatch is stamped so it never sends
/// twice. A dispatch with no Run, from an earlier start of Kolux, or already settled sends nothing.
pub(crate) fn worker_exited(store: &Store, terminal: u32, code: Option<u32>, now: u64) -> Option<Value> {
    let me = u64::from(std::process::id());
    let mut dispatches = load_list(store, DISPATCHES_KEY).ok()?;
    let d = dispatches.iter_mut().rev().find(|d| d["terminal"].as_u64() == Some(u64::from(terminal)) && d["runtime"].as_u64() == Some(me))?;
    let (id, task_id) = (d["id"].as_str()?.to_string(), d["taskId"].as_str().unwrap_or_default().to_string());
    let run = d["runId"].as_str()?.to_string();
    if !d["exitedAt"].is_null() || crate::orchestration::finished(d) {
        return None;
    }
    let mut mail = crate::orchestration::Mail::load(store);
    if mail.messages.iter().any(|m| m.kind == "worker_done" && m.extras.get("dispatchId").and_then(Value::as_str) == Some(id.as_str())) {
        return None;
    }
    d["exitedAt"] = json!(now);
    let worktree = d["worktree"].as_str().unwrap_or_default().to_string();
    // Only the title comes from the tasks and they are not saved here, so an unreadable list just falls back to the id.
    let tasks = load_list(store, TASKS_KEY).unwrap_or_default();
    let title = tasks.iter().find(|t| t["id"] == task_id.as_str()).and_then(|t| t["title"].as_str()).filter(|t| !t.trim().is_empty()).unwrap_or(&task_id).to_string();
    let how = code.map(|c| format!("with exit code {c}")).unwrap_or_else(|| "without an exit code".into());
    let body = format!(
        "The worker on {task_id} ({id}, in {worktree}) ended {how} before it reported done. Retry it with `{cli} orchestration worker-stop --dispatch {id}` then `{cli} orchestration worker-start --task {task_id}`, or hand the task to someone else.",
        cli = crate::orchestration::CLI
    );
    let a = json!({ "to": format!("run:{run}"), "subject": format!("Worker ended: {title}"), "body": body, "type": "escalation", "priority": "high", "taskId": task_id, "dispatchId": id });
    let sent = mail.send(&crate::terminal::handle_of(terminal), &a, &dispatches, &|_| false, now).ok()?;
    mail.save(store).ok()?;
    save_list(store, DISPATCHES_KEY, &dispatches).ok()?;
    Some(json!({ "dispatchId": id, "messageIds": sent["messageIds"] }))
}

pub(crate) fn next_id(list: &[Value], prefix: &str) -> String {
    let n = list.iter().filter_map(|t| t["id"].as_str()?.strip_prefix(prefix)?.parse::<u64>().ok()).max().unwrap_or(0);
    format!("{prefix}{}", n + 1)
}

/// The settings' default agent id (`claude` when none is set).
fn default_agent(ctx: &Ctx) -> Result<String, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    Ok(store.settings()["defaultAgent"].as_str().filter(|s| !s.is_empty()).unwrap_or("claude").to_string())
}

/// PROJ-038's fallback when no agent is named: the default agent when it is installed, else the
/// first installed one in catalogue order.
fn fallback_agent(ctx: &Ctx) -> Result<crate::agents::AgentInfo, Fail> {
    let wanted = default_agent(ctx)?;
    let list = crate::agents::agent_list();
    let hit = list.iter().find(|x| x.id == wanted && x.installed).or_else(|| list.iter().find(|x| x.installed));
    hit.cloned().ok_or_else(|| Fail::new("failed", "no agent is installed to take the prompt; install one or pass --agent"))
}

fn installed_agent(id: &str) -> Result<crate::agents::AgentInfo, Fail> {
    let known = crate::agents::agent_list().into_iter().find(|x| x.id == id).ok_or_else(|| Fail::args(format!("Kolux knows no agent `{id}`")))?;
    if !known.installed {
        return Err(Fail::new("failed", format!("{} is not installed", known.name)));
    }
    Ok(known)
}

/// The start-line arguments a model and effort add for an agent.
fn model_args(agent: &str, model: Option<&str>, effort: Option<&str>) -> Result<Vec<String>, Fail> {
    let mut extra = Vec::new();
    if let Some(m) = model {
        extra.extend(["--model".to_string(), m.to_string()]);
    }
    match (agent, effort) {
        (_, None) => {}
        ("claude", Some(e)) => extra.extend(["--effort".to_string(), e.to_string()]),
        ("codex", Some(e)) => extra.extend(["-c".to_string(), format!("model_reasoning_effort={e}")]),
        (a, Some(_)) => return Err(Fail::new("unsupported", format!("an effort level is only known for Claude Code and Codex, not {a}"))),
    }
    Ok(extra)
}

/// T-172-e: the environment variable the window puts in the worker's very first session, so the
/// session carries the dispatch it was started for. `terminal_spawn` reports it to `stamp_session`
/// when it starts a session with it; nothing else sets it.
pub(crate) const DISPATCH_ENV: &str = "KOLUX_DISPATCH_ID";

/// cli FIX-7: the dispatch id in a spawn's own environment, if it carries one. The window appends
/// its own entry last, so when the list already holds one (an agent environment the user set) the
/// last value wins and the user's can never take the place of the real dispatch's.
pub(crate) fn dispatch_in(env: &[(String, String)]) -> Option<String> {
    env.iter().rfind(|(k, _)| k == DISPATCH_ENV).map(|(_, v)| v.clone())
}

/// A start waiting for its session's stamp: the dispatch id, the session once it is stamped, and
/// (cli FIX-8) the moment a start that gave up waiting stops being told about a late session.
struct Stamp {
    dispatch: String,
    session: Option<u32>,
    late_until: Option<Instant>,
}

/// The starts waiting for their session's stamp, and those that timed out and still may be told.
/// Lock order (cli FIX-9): STAMPS is always taken BEFORE the terminals lock, never while holding it
/// (`reconcile_late` reads a session with STAMPS held; `tabs` and `spawn_stamped` never hold both).
static STAMPS: Mutex<Vec<Stamp>> = Mutex::new(Vec::new());

fn stamps() -> std::sync::MutexGuard<'static, Vec<Stamp>> {
    STAMPS.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A start is about to ask the window for its session: only a dispatch registered here can be stamped.
pub(crate) fn expect_stamp(dispatch: &str) {
    let mut s = stamps();
    s.retain(|e| e.dispatch != dispatch);
    s.push(Stamp { dispatch: dispatch.to_string(), session: None, late_until: None });
    if s.len() > 64 {
        s.remove(0);
    }
}

/// The window started session `id` with `dispatch` in its environment (`terminal_spawn`). Only the
/// first session of a start that is still waiting (or timed out less than `LATE_WINDOW` ago) is
/// stamped; any other call changes nothing.
pub(crate) fn stamp_session(dispatch: &str, id: u32) -> bool {
    let mut s = stamps();
    let now = Instant::now();
    match s.iter_mut().find(|e| e.dispatch == dispatch && e.session.is_none() && e.late_until.is_none_or(|u| now < u)) {
        Some(e) => {
            e.session = Some(id);
            true
        }
        None => false,
    }
}

/// cli FIX-8: spawns a session and stamps it. `dispatch` is the id read from the spawn's own
/// environment (`dispatch_in`) before the environment is handed to the spawn; a spawn that fails
/// stamps nothing. `terminal_spawn` runs every session through this.
pub(crate) fn spawn_stamped<E>(dispatch: Option<String>, spawn: impl FnOnce() -> Result<u32, E>) -> Result<u32, E> {
    let id = spawn()?;
    if let Some(d) = dispatch {
        stamp_session(&d, id);
    }
    Ok(id)
}

fn stamped(dispatch: &str) -> Option<u32> {
    stamps().iter().find(|e| e.dispatch == dispatch).and_then(|e| e.session)
}

fn forget_stamp(dispatch: &str) {
    stamps().retain(|e| e.dispatch != dispatch);
}

/// cli FIX-8 (council FIX-SOON 2 on 800b8a94): how long after a start gave up waiting its session,
/// if the window starts it after all (a loaded PC), is still tied to the dispatch.
const LATE_WINDOW: Duration = Duration::from_secs(600);

/// A start that ended `unknown` with no session stamped keeps its place for `window`, so a session
/// the window starts later is stamped to it and `reconcile_late` can record it on the row.
fn keep_late(dispatch: &str, window: Duration) {
    let mut s = stamps();
    if let Some(e) = s.iter_mut().find(|e| e.dispatch == dispatch) {
        e.late_until = Some(Instant::now() + window);
    }
}

/// cli FIX-8: what a start does with its stamp entry once its wait is over: a session was found, so
/// the entry is done; none was, so it stays for `window` and a late session can still be tied to it.
fn finish_stamp(dispatch: &str, found: Option<u32>, window: Duration) {
    if found.is_some() {
        forget_stamp(dispatch);
    } else {
        keep_late(dispatch, window);
    }
}

/// cli FIX-8: records the late sessions on their rows. A row of this run whose terminal was never
/// recorded and whose dispatch was stamped after the start gave up gets the session (and the
/// program Kolux started in it, `mark`) while that session is still open; the row's status is left
/// as the start reported it. Entries past their window are dropped; one is kept until then (a
/// refused call may not save the row), and a row that has its terminal is never changed again.
/// `session(t)` is None when `t` is gone, else its mark. Returns how many rows changed and, for the
/// rows that were already stopped, abandoned or released when the session came (cli FIX-9, council
/// FIX-SOON 1 on 529c53e2; completed and failed rows too, cli FIX-10), the row is marked `latePending`:
/// that agent is running on a task already handed back, and worker-release closes it. The row keeps
/// the status it had in `lateAfter`; `pending_late_notes` makes the notes, on every answer until a later worker-show
/// reads the row or a release closes the terminal (cli FIX-11).
/// Lock order: STAMPS is taken here before the terminals lock (`session` reads a session); nothing
/// takes the two the other way round (`tabs` lets go of STAMPS before it reads a session), so keep it so.
fn reconcile_late(dispatches: &mut [Value], session: &dyn Fn(u32) -> Option<Option<String>>) -> usize {
    let now = Instant::now();
    let me = u64::from(std::process::id());
    let mut changed = 0;
    let mut s = stamps();
    s.retain(|e| e.late_until.is_none_or(|u| now < u));
    for d in dispatches.iter_mut() {
        if !d["terminal"].is_null() || d["runtime"].as_u64() != Some(me) {
            continue;
        }
        let Some(i) = s.iter().position(|e| e.late_until.is_some() && d["id"].as_str() == Some(e.dispatch.as_str()) && e.session.is_some()) else { continue };
        let t = s[i].session.unwrap_or_default();
        if let Some(mark) = session(t) {
            d["terminal"] = json!(t);
            d["terminalProgram"] = json!(mark);
            d["lateStamp"] = json!(true);
            if let Some(status) = ended_status(d) {
                // cli FIX-10: the note is kept pending on the row until worker-show or worker-release reads it.
                d["lateAfter"] = json!(status);
                d["latePending"] = json!(true);
            }
            changed += 1;
        }
    }
    changed
}

/// cli FIX-9: the status a row had when the coordinator already ended it (stopped, abandoned or
/// released, completed or failed), else None.
fn ended_status(d: &Value) -> Option<&'static str> {
    match (d["released"] == true, d["status"].as_str()) {
        (true, _) | (_, Some("released")) => Some("released"),
        (_, Some("stopped")) => Some("stopped"),
        (_, Some("abandoned")) => Some("abandoned"),
        (_, Some("completed")) => Some("completed"),
        (_, Some("failed")) => Some("failed"),
        _ => None,
    }
}

/// cli FIX-9: what a late session on an ended row tells the caller, and how to close it.
fn late_note(d: &Value, status: &str) -> Value {
    let id = d["id"].as_str().unwrap_or_default();
    let handle = d["terminal"].as_u64().and_then(|t| u32::try_from(t).ok()).map(crate::terminal::handle_of);
    let place = handle.as_deref().unwrap_or("a terminal");
    // cli FIX-10: a finished row (completed, failed) is a second agent on a done task, the others a task handed back.
    let note = match status {
        "completed" | "failed" => format!("{id} had already {status} when its agent came up late; the agent in {place} is a second agent on a finished task, and it is recorded on the row"),
        _ => format!("{id} was already {status} when its agent came up late; the agent in {place} is running on a task that was handed back, and it is recorded on the row"),
    };
    json!({ "dispatchId": id, "terminal": handle, "status": status, "note": note, "next": format!("{} orchestration worker-release --dispatch {id}", crate::orchestration::CLI) })
}

/// cli FIX-10: the receipt of a release that left the late agent's terminal open says so, and names
/// the command that closes a terminal, instead of a release that promises a close.
fn left_open(mut note: Value, why: &str) -> Value {
    let id = note["dispatchId"].as_str().unwrap_or_default().to_string();
    let handle = note["terminal"].as_str().unwrap_or("its terminal").to_string();
    note["note"] = json!(format!("{id}: the late agent's terminal {handle} is left open ({why}), so that agent is still running on a task that was handed back"));
    note["next"] = json!(format!("{} terminal close --terminal {handle}", crate::orchestration::CLI));
    note
}

/// cli FIX-10 (council FIX-SOON 1 on 081bbfab): the late notes of every row not yet read, so an
/// answer that was lost or went to another agent does not hide a second agent on a handed-back task.
/// cli FIX-11 (council FIX-SOON 3 on 9afdd308, decision): the notes follow ORCH-033. An answer for a
/// Run carries that Run's notes and those of rows with no Run; an answer for no Run (a caller tied to
/// none, who sees every Run's workers in worker-list too) carries all. A row whose release left the
/// late terminal open is told as that (terminal close), not as a release that would leave it open again.
fn pending_late_notes(dispatches: &[Value], run: Option<&str>) -> Vec<Value> {
    dispatches
        .iter()
        .filter(|d| d["latePending"] == true && (run.is_none() || d["runId"].is_null() || d["runId"].as_str() == run))
        .filter_map(|d| {
            let note = late_note(d, d["lateAfter"].as_str()?);
            Some(match d["terminalLeftOpen"].as_str().filter(|w| !w.is_empty() && d["released"] == true) {
                Some(why) => left_open(note, why),
                None => note,
            })
        })
        .collect()
}

/// cli FIX-10: the late fields on each worker-list row, so a listing shows the fact and the open alarm.
fn late_rows(mut listed: Value, dispatches: &[Value]) -> Value {
    for w in listed["workers"].as_array_mut().into_iter().flatten() {
        let Some(d) = dispatches.iter().find(|d| d["id"] == w["dispatchId"] && d["runId"] == w["runId"]) else { continue };
        // cli FIX-12: terminalLeftOpen too, so the row text can name terminal close for a left-open terminal.
        for k in ["lateStamp", "lateAfter", "latePending", "terminalLeftOpen"] {
            if !d[k].is_null() {
                w[k] = d[k].clone();
            }
        }
    }
    listed
}

/// cli FIX-11 (council FIX-BEFORE 1 on 9afdd308): worker-show does not clear the alarm on the first
/// read, because that answer may be the one that is lost. The first show marks the row `lateShown`
/// (and the alarm stays on every answer); a later show, whose caller has asked again, clears it.
/// cli FIX-12 (council FIX-SOON 1 on 28f3eb7a, decision): not while the row's release left the late
/// terminal open and that terminal (`terminal_live`) is still running; that agent is still on a task
/// handed back, so showing the row twice does not silence it. It ends when the terminal is closed.
fn read_late(d: &mut Value, terminal_live: bool) {
    if d["latePending"] != true {
        return;
    }
    let held = terminal_live && d["released"] == true && d["terminalLeftOpen"].as_str().is_some_and(|w| !w.is_empty());
    if d["lateShown"] == true && !held {
        if let Some(o) = d.as_object_mut() {
            o.remove("latePending");
            o.remove("lateShown");
        }
    } else {
        d["lateShown"] = json!(true);
    }
}

/// cli FIX-11 (council FIX-BEFORE 1 on 9afdd308): the late agent is gone (its terminal is closed), so
/// the alarm stops; until then a release keeps it on the row.
/// cli FIX-12 (council AFTER 1 on 28f3eb7a, decision): the fact (`lateAfter`, what the dispatch was
/// when the agent came up) stays for worker-show on every path that spends the alarm.
fn spend_late(d: &mut Value) {
    if let Some(o) = d.as_object_mut() {
        o.remove("latePending");
        o.remove("lateShown");
    }
}

/// cli FIX-12 (council FIX-SOON 2 on 28f3eb7a): a row whose late terminal is already gone (closed by
/// hand, or by anything else) has nothing running to warn about; the alarm is spent, `lateAfter` stays.
/// `live(h)` says whether terminal `h` is open. A row with no recorded terminal is left alone.
fn spend_gone_late(dispatches: &mut [Value], live: &dyn Fn(&str) -> bool) {
    for d in dispatches.iter_mut().filter(|d| d["latePending"] == true) {
        let open = d["terminal"].as_u64().and_then(|t| u32::try_from(t).ok()).is_some_and(|t| live(&crate::terminal::handle_of(t)));
        if d["terminal"].as_u64().is_some() && !open {
            spend_late(d);
        }
    }
}

/// cli FIX-11: a release receipt that says the terminal is gone (released, and nothing left open).
fn terminal_closed(receipt: &Value) -> bool {
    receipt["terminalState"] == "released" && receipt["terminalLeftOpen"].as_str().is_none_or(str::is_empty)
}

/// cli FIX-9: puts the late worker notes in an answer, once per dispatch. An answer that is not an
/// object is handed back as it was (the notes stay pending on their rows, cli FIX-10).
fn with_late_notes(mut out: Value, notes: Vec<Value>) -> Value {
    if notes.is_empty() {
        return out;
    }
    if let Some(o) = out.as_object_mut() {
        let mut all = o.get("lateWorker").and_then(Value::as_array).cloned().unwrap_or_default();
        for n in notes {
            if !all.iter().any(|a| a["dispatchId"] == n["dispatchId"]) {
                all.push(n);
            }
        }
        o.insert("lateWorker".into(), Value::Array(all));
    }
    out
}

/// One open session as a start sees it: its id, and how long it has been quiet.
struct Tab {
    id: u32,
    quiet: Option<Duration>,
}

/// cli FIX-8: the dispatch's stamped session when it is still open, and nothing else. The wait polls
/// every 100 ms and only ever reads that one, so no other session is looked at or locked.
fn tabs(terminals: &Terminals, dispatch: &str) -> Vec<Tab> {
    stamped(dispatch).filter(|id| terminals.live(&crate::terminal::handle_of(*id))).map(|id| Tab { id, quiet: terminals.quiet_for(id) }).into_iter().collect()
}

/// Waits for the worker's terminal: ready once it has written and is still there `SETTLE` later;
/// gives up at `timeout`. Returns the terminal seen (if any) and readiness.
/// T-172-e, cli FIX-7: the worker's session is the one carrying the dispatch's stamp and no other.
/// With no stamp the wait takes no tab at all, however long it lasts: a tab the user opens in the
/// same folder is never read as the worker's, so a stop or release can never end it. A start whose
/// stamp never arrives (the window did not start the session) ends `unknown` with the terminal
/// unrecorded, and the offered commands clean up from there.
pub(crate) fn wait_ready(terminals: &Terminals, dispatch: &str, since: Instant, timeout: Duration) -> (Option<u32>, bool) {
    wait_ready_over(&|| tabs(terminals, dispatch), dispatch, since, timeout)
}

fn wait_ready_over(open: &dyn Fn() -> Vec<Tab>, dispatch: &str, since: Instant, timeout: Duration) -> (Option<u32>, bool) {
    let mut seen = None;
    while since.elapsed() < timeout {
        let all = open();
        seen = stamped(dispatch).filter(|id| all.iter().any(|t| t.id == *id));
        if seen.is_some_and(|id| all.iter().find(|t| t.id == id).and_then(|t| t.quiet).is_some_and(|q| q >= SETTLE)) {
            return (seen, true);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    (seen, false)
}

/// The program Kolux was asked to start in session `t` (its mark); none for a shell or a gone session.
fn mark_program(terminals: &Terminals, t: u32) -> Option<String> {
    let h = crate::terminal::handle_of(t);
    terminals.sessions().into_iter().find(|(s, _, _)| *s == h)?.2
}

/// What session `t` runs now, as worker-stop and worker-release read it (runs_now's `now`):
/// the agent it is credited to (None when it is gone) and the program Kolux started in it.
fn session_now(terminals: &Terminals, t: u32) -> (Option<Option<String>>, Option<String>) {
    (terminals.program(t).map(|a| a.map(str::to_string)), mark_program(terminals, t))
}

/// cli FIX-3 (c), FIX-4: a failed start's offered commands run as printed. The retry names the
/// agent the start used and its tier when it had one (so the retry is routed and recorded the same
/// way), else its model and effort, since worker-start refuses a line that says nothing of who
/// runs it; a value with a space in it, or with `@` (PowerShell splats it), `,` (it builds an
/// array) or `=`, is quoted (cli FIX-6: `"..."` is literal for these in PowerShell and cmd). Every orchestration line names the dispatch's
/// Run, so it reaches the dispatch from the coordinator's own pane and from a shell Kolux did not
/// start; a pane that acts in another Run is turned away by each of them (ORCH-033: it may read
/// that Run, never change it).
fn start_failed_run(receipt: &mut Value, run: Option<&str>) {
    start_failed_run_for(receipt, run, cfg!(windows));
}

/// Row 343: the offered lines quote a value the way the shell they will be pasted into reads it
/// (automations_cli::shell_word: double quotes on Windows, single quotes elsewhere).
fn start_failed_run_for(receipt: &mut Value, run: Option<&str>, windows: bool) {
    let lead = format!("{} orchestration worker-", crate::orchestration::CLI);
    let retry = format!("{lead}start ");
    // `safe` below keeps every value shell_word refuses out of the offered lines.
    let word = |v: &str| automations_cli::shell_word(v, windows).unwrap_or_default();
    let tiered = receipt["tier"].as_str().is_some_and(|t| !t.trim().is_empty());
    let mut who = String::new();
    let flags: &[&str] = if tiered { &["agent", "tier"] } else { &["agent", "model", "effort"] };
    for k in flags {
        if let Some(v) = receipt[*k].as_str().map(str::trim).filter(|v| !v.is_empty()) {
            who.push_str(&format!(" --{k} {}", word(v)));
        }
    }
    // cli FIX-5 (council AFTER 1 on c5fb49c): a value with a character PowerShell or cmd would act
    // on (a quote, `;`, `&`, `|`, `$`, a redirect...) is never pasted into an offered line; the
    // retry that would carry it is left out of `next` rather than offered unsafe.
    let safe = |v: &str| v.chars().all(|c| c.is_alphanumeric() || c == ' ' || "-_.:/@+=,".contains(c));
    let unsafe_who = flags.iter().any(|k| receipt[*k].as_str().is_some_and(|v| !safe(v.trim())));
    let unsafe_run = run.is_some_and(|r| !safe(r));
    let run = run.map(|r| format!(" --run {}", word(r))).unwrap_or_default();
    let Some(next) = receipt["next"].as_array_mut() else { return };
    next.retain(|l| !(unsafe_who || unsafe_run) || !l.as_str().is_some_and(|l| l.starts_with(&retry)));
    if unsafe_run {
        next.retain(|l| !l.as_str().is_some_and(|l| l.starts_with(&lead)));
    }
    for line in next.iter_mut() {
        if let Some(l) = line.as_str().filter(|l| l.starts_with(&lead)) {
            let who = if l.starts_with(&retry) { who.as_str() } else { "" };
            *line = json!(format!("{l}{who}{run}"));
        }
    }
    // cli FIX-7 (council AFTER on c5fb49c): a tier runs on the coordinator's own agent, so the
    // offered `--agent X --tier T` is turned away from a pane whose own agent is not X.
    let offered = next.iter().any(|l| l.as_str().is_some_and(|l| l.starts_with(&retry)));
    let agent = receipt["agent"].as_str().map(str::trim).filter(|a| !a.is_empty()).map(str::to_string);
    if let (true, true, Some(a)) = (tiered, offered, agent) {
        receipt["retryNote"] = json!(format!("the retry names --agent {a} with a tier; a tier runs on the coordinator's own agent, so a pane running another agent is turned away: there drop --agent {a}, or name a model instead of the tier"));
    }
}

/// `kolux orchestration worker-start` (ORCH-016): the task (made or found), the worktree (made or
/// found), the agent's start in a background tab, and a wait for it to come up.
/// ORCH-016 / CLI-035: an open terminal in the named worktree, running the coordinator's own agent,
/// takes the task instead of a new one; the brief is typed in as `dispatch --inject` would type it.
/// Everything that can turn the start away is checked before a task is made.
fn reuse(ctx: &Ctx, req: &Request, to: &str) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let tid = to.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).filter(|_| ctx.terminals.live(to)).ok_or_else(|| Fail::new("not_found", format!("no open Kolux terminal is called {to}")))?;
    let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
    if !ctx.terminals.dir_of(to).is_some_and(|d| same_dir(&d, &w.path)) {
        return Err(Fail::new("wrong_worktree", format!("{to} is not running in {}", w.path)));
    }
    let theirs = pane_agent(ctx, to).ok_or_else(|| Fail::new("not_an_agent", format!("{to} is not running an agent Kolux recognises, or the agent has not finished starting")))?;
    let mine = caller(ctx, req)?.and_then(|h| own_agent(ctx, &h));
    if let Some(other) = [text("agent"), mine].into_iter().flatten().find(|m| *m != theirs) {
        return Err(Fail::new("agent_mismatch", format!("{to} runs {theirs}; a worker runs the coordinator's own agent ({other})")));
    }
    let sub = |command: &str, mut args: Value| {
        for k in ["run", "from", "retryRequest", "maxDepth"] {
            if !a[k].is_null() {
                args[k] = a[k].clone();
            }
        }
        Request { command: command.into(), args, ..req.clone() }
    };
    let task = match text("task") {
        Some(t) => t,
        None => {
            let mut make = json!({ "spec": a["spec"] });
            for k in ["taskTitle", "displayName", "deps", "parent"] {
                if !a[k].is_null() {
                    make[k] = a[k].clone();
                }
            }
            mail(ctx, &sub("orchestration.task-create", make))?["id"].as_str().unwrap_or_default().to_string()
        }
    };
    let plan = mail(ctx, &sub("orchestration.dispatch", json!({ "task": task, "to": to, "inject": true }))).map_err(|mut e| {
        if text("task").is_none() {
            e.message = format!("{}; {task} was made: hand it on with {} orchestration dispatch --task {task} --to <handle> --inject", e.message, crate::orchestration::CLI);
        }
        e
    })?;
    Ok(json!({
        "dispatchId": plan["dispatchId"], "taskId": task, "status": "ready", "stage": "worker", "launch": "reused_terminal",
        "agent": theirs, "runId": plan["runId"], "worktree": { "path": w.path, "branch": w.branch, "name": w.name },
        "terminals": [{ "id": tid, "role": "worker" }],
    }))
}

/// ORCH-030: a worker start with `--retry-request` is entered in the ledger while it runs, so a
/// repeat with the same id waits for the first and hands back its receipt instead of starting a
/// second worker. A start turned away leaves no receipt; one that timed out keeps its outcome. A
/// start left pending by an earlier run of Kolux is over (its terminals went with it): it runs fresh.
fn worker_start_once(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    // Row 877: an unread mail cannot be saved, so refuse before a task, worktree or terminal is made.
    crate::orchestration::Mail::load(&*ctx.store.lock().map_err(|e| e.to_string())?).ensure_readable()?;
    // ORCH-017: the same start is the same caller, folder and flags; the CLI gives every send a
    // request id of its own, so that one is left out.
    let start = || {
        let mut flags = req.args.clone();
        flags.as_object_mut().map(|f| f.remove("retryRequest"));
        let same = format!("{}|{}|{}|{flags}", req.command, caller(ctx, req).ok().flatten().unwrap_or_default(), req.cwd);
        join_running(&same, req.arrived, || worker_start(ctx, req))
    };
    let Some(id) = req.args["retryRequest"].as_str().map(str::trim).filter(|s| !s.is_empty()) else { return start() };
    let key = format!("{}|{}|{id}", req.command, caller(ctx, req)?.unwrap_or_default());
    let me = u64::from(std::process::id());
    let until = Instant::now() + Duration::from_secs(300);
    loop {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut m = crate::orchestration::Mail::load(&store);
        if let Some(v) = m.answers.get(&key) {
            return match v.get("timedOut") {
                Some(f) => Err(Fail { code: "timeout", message: f["message"].as_str().unwrap_or_default().to_string(), data: f["data"].clone() }),
                None => Ok(v.clone()),
            };
        }
        if m.pending.get(&key).is_some_and(|p| p["runtime"].as_u64() == Some(me)) {
            drop(store);
            if Instant::now() > until {
                return Err(Fail::new("pending", format!("the start with request {id} is still under way; ask with {} orchestration request-show --request {id}", crate::orchestration::CLI)));
            }
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        m.begin(&key, me)?;
        m.save(&store)?;
        break;
    }
    let out = start();
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut m = crate::orchestration::Mail::load(&store);
    let kept = match &out {
        Ok(v) => Some(v.clone()),
        Err(f) if f.code == "timeout" => Some(json!({ "timedOut": { "message": f.message, "data": f.data } })),
        Err(_) => None,
    };
    m.finish(&key, kept);
    m.save(&store)?;
    out
}

/// Starts lately finished: the request (command, caller, folder and flags), when it began and
/// ended, and how it went. Kept ten minutes.
type Finished = (String, Instant, Instant, Result<Value, Fail>);
static FINISHED: Mutex<Vec<Finished>> = Mutex::new(Vec::new());

/// ORCH-017: the same start sent again while the first is under way joins it. The app answers
/// one request at a time, so the repeat waits behind the first; when its turn comes it hands back
/// the first one's outcome (marked `joined`) rather than starting a second worker. A repeat sent
/// after the first finished, or with any other flag, is a start of its own.
fn join_running(same: &str, arrived: Option<Instant>, start: impl FnOnce() -> Result<Value, Fail>) -> Result<Value, Fail> {
    let lock = || FINISHED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(at) = arrived {
        if let Some((.., out)) = lock().iter().rev().find(|(k, from, to, _)| k == same && *from <= at && at <= *to) {
            return out.clone().map(|mut v| {
                v["joined"] = json!(true);
                v
            });
        }
    }
    let from = Instant::now();
    let out = start();
    let mut done = lock();
    done.retain(|(.., to, _)| to.elapsed() < Duration::from_secs(600));
    done.push((same.to_string(), from, Instant::now(), out.clone()));
    out
}

/// ORCH-017 (cli FIX-2): may a new worker take task `i`? A completed task never; a task that has
/// a worker only when `retry_of` names that very dispatch and its terminal is no longer open (a
/// start that never came up, or one stopped since), in which case the old dispatch is abandoned
/// and marked as retried by `new_id`, so the retry the failed start offered can be run as given.
/// A `retry_of` that names another task's dispatch, or an older one, is refused by name.
fn claim_task(tasks: &[Value], dispatches: &mut [Value], i: usize, retry_of: Option<&str>, new_id: &str, live: &dyn Fn(&str) -> bool) -> Result<(), Fail> {
    let id = tasks[i]["id"].as_str().unwrap_or_default();
    let status = tasks[i]["status"].as_str().unwrap_or_default();
    let current = tasks[i]["dispatchId"].as_str().unwrap_or("?");
    if status == "completed" {
        return Err(Fail::new("failed", format!("{id} is already completed")));
    }
    let Some(r) = retry_of else {
        return match status {
            "dispatched" => Err(Fail::new("failed", format!("{id} already has a worker ({current})"))),
            _ => Ok(()),
        };
    };
    let old = dispatches.iter_mut().find(|d| d["id"] == r).ok_or_else(|| Fail::new("not_found", format!("no dispatch {r} to retry")))?;
    if old["taskId"] != id {
        return Err(Fail::args(format!("{r} worked on {}, not {id}", old["taskId"].as_str().unwrap_or("another task"))));
    }
    if status == "dispatched" && current != r {
        return Err(Fail::new("failed", format!("{id} already has a newer worker ({current}); retry that one instead")));
    }
    let mine = old["runtime"].as_u64().is_none_or(|p| p == u64::from(std::process::id()));
    if let Some(h) = old["terminal"].as_u64().filter(|_| mine).map(|t| crate::terminal::handle_of(t as u32)).filter(|h| live(h)) {
        return Err(Fail::new("dispatch_active", format!("{r}'s terminal {h} is still open; stop it first with {} orchestration worker-stop --dispatch {r}", crate::orchestration::CLI)));
    }
    if status == "dispatched" {
        old["status"] = json!("abandoned");
    }
    old["retriedBy"] = json!(new_id);
    Ok(())
}

/// ORCH-024 (cli FIX-2): the lines a released worker's archive holds. The terminal keeps only its
/// latest lines; when earlier ones were dropped, the archive opens with a line that says how many
/// are missing, so a cut-short archive is never taken for the whole output.
/// ORCH-067 (T-155-b): a read of a terminal never shows a dispatch pass, echoed in a command line
/// or sitting typed but unsubmitted in the input box; a warning says when one was hidden.
/// Fails closed: when the dispatches cannot be loaded the passes are unknown, so the read is refused and no output is returned.
fn hidden(ctx: &Ctx, mut out: Value) -> Result<Value, Fail> {
    let refused = |why: &str| Fail::new("failed", format!("can't check for secrets to hide; read refused ({why})"));
    let store = ctx.store.lock().map_err(|_| refused("the store is busy"))?;
    let dispatches = load_list(&store, DISPATCHES_KEY).map_err(|e| refused(&e.message))?;
    crate::orchestration::redact_read(&mut out, &crate::orchestration::passes(&dispatches));
    Ok(out)
}

fn archive_lines(r: crate::terminal::Read) -> Vec<String> {
    let mut lines = Vec::with_capacity(r.lines.len() + 2);
    if r.oldest > 1 {
        let gone = r.oldest.saturating_sub(1);
        lines.push(format!("[Kolux: the first {gone} line{} of this terminal's output were no longer kept; the archive starts at line {}]", if gone == 1 { "" } else { "s" }, r.oldest));
    }
    lines.extend(r.lines.into_iter().map(|l| l.text));
    if !r.pending.is_empty() {
        lines.push(r.pending);
    }
    lines
}

/// ORCH-024 (T-089-c, cli FIX-2): release a settled worker: pending first and SAVED (council FS6),
/// so a crash after the kill leaves a release to retry, never a closed terminal with no record;
/// then the output archived (with the dropped-lines marker, FS5), and only after a save the
/// terminal closed. A step that did not happen leaves the release unknown with its retry.
#[allow(clippy::too_many_arguments)]
fn release_worker(dispatches: &mut [Value], id: &str, run: Option<&str>, live: &dyn Fn(&str) -> bool, agent_of: &dyn Fn(&str) -> Option<Option<String>>, dir: &Path, save: &dyn Fn(&[Value]) -> Result<(), Fail>, read: &dyn Fn(u32) -> Option<crate::terminal::Read>, kill: &dyn Fn(u32) -> bool) -> Result<Value, Fail> {
    use crate::orchestration as o;
    // cli FIX-9: a session that came up after the dispatch was stopped or released is closed by the
    // release; a row released before it came is opened again for that, once, and the receipt says so.
    // cli FIX-11: the alarm (latePending) and the fact (lateAfter) stay on the row through the reopen and
    // are spent only once the receipt says the terminal is closed, so a release that leaves it open or
    // ends release_unknown, and a receipt that is lost, still leave the running agent on record.
    let late = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).and_then(|d| {
        let status = d["lateAfter"].as_str()?.to_string();
        let open = d["terminal"].as_u64().and_then(|t| u32::try_from(t).ok()).is_some_and(|t| live(&crate::terminal::handle_of(t)));
        if !open {
            // Nothing is running any more: the alarm is spent, the fact stays for worker-show (cli FIX-12:
            // released or not, a late terminal that is gone is not told as a running agent).
            spend_late(d);
            return None;
        }
        let note = late_note(d, &status);
        d["released"] = Value::Null;
        // The reopen asks keep_open again; a left-open reason from an earlier release must not outlive it.
        if let Some(o) = d.as_object_mut() {
            o.remove("terminalLeftOpen");
        }
        Some(note)
    });
    // cli FIX-10: a release that leaves the terminal open (terminalLeftOpen) says so in the note.
    let noted = |r: Value| {
        let note = late.clone().map(|n| match r["terminalLeftOpen"].as_str() {
            Some(why) if !why.is_empty() => left_open(n, why),
            _ => n,
        });
        with_late_notes(r, note.into_iter().collect())
    };
    let spent = |dispatches: &mut [Value], r: &Value| {
        if late.is_some() && terminal_closed(r) {
            if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run) {
                spend_late(d);
            }
        }
    };
    let (receipt, handle) = o::release_with(dispatches, live, id, run, now_ms(), agent_of)?;
    let Some(h) = handle else {
        spent(dispatches, &receipt);
        return Ok(noted(receipt));
    };
    save(dispatches)?;
    let tid = h.trim_start_matches("term-").parse::<u32>().ok();
    let saved = match tid.and_then(read) {
        Some(r) => o::write_archive(dir, id, &o::redact_lines(archive_lines(r), &o::passes(dispatches))),
        None => Err(format!("{h}'s output could not be read")),
    };
    let closed = saved.is_ok() && tid.is_some_and(kill);
    let receipt = o::release_done(dispatches, id, run, saved, closed, now_ms())?;
    spent(dispatches, &receipt);
    Ok(noted(receipt))
}

/// ORCH-026 (cli FIX-2, council S3): a worker-start dispatch row, stamped with this app's process
/// (its terminal handle means nothing to a later run) and the wall-clock time it was made, so a
/// worker that never reports can be told stale like any other.
/// cli FIX-4 (council FIX-SOON 1 on b4b1600): what terminal `h` runs now, as worker-stop and
/// worker-release ask it (keep_open's `agent_of`). `now` reads a session (session_now): what it
/// is credited to (None when it is gone) and the program Kolux was asked to start in it (its mark;
/// none for a shell). A worker started through a custom command (a wrapper or `npx`) is credited
/// to no agent; its session still counts as the worker's own while it is the dispatch's recorded
/// terminal (`own`: handle, program, agent) and its mark is the very program recorded when the
/// start found it. Every other session reads as before, so a shell stays open.
fn runs_now(h: &str, own: Option<&(String, String, String)>, now: &dyn Fn(u32) -> (Option<Option<String>>, Option<String>)) -> Option<Option<String>> {
    let t = h.strip_prefix("term-")?.parse::<u32>().ok()?;
    let (credit, mark) = now(t);
    match (credit, own) {
        (Some(None), Some((mine, program, agent))) if mine == h && mark.as_deref() == Some(program.as_str()) => Some(Some(agent.clone())),
        (credit, _) => credit,
    }
}

/// cli FIX-4: dispatch `id`'s recorded terminal, the program Kolux started in it and its agent,
/// while that terminal can still be the one this run of Kolux recorded (none for a row stamped by
/// an earlier run, or one recorded before FIX-4 with no program).
fn own_program(dispatches: &[Value], id: &str, run: Option<&str>) -> Option<(String, String, String)> {
    let d = dispatches.iter().find(|d| d["id"] == id && d["runId"].as_str() == run)?;
    if d["runtime"].as_u64().is_some_and(|r| r != u64::from(std::process::id())) {
        return None;
    }
    let t = u32::try_from(d["terminal"].as_u64()?).ok()?;
    Some((crate::terminal::handle_of(t), d["terminalProgram"].as_str()?.to_string(), d["agent"].as_str()?.to_string()))
}

/// cli FIX-7 (council AFTER on c5fb49c): `setup` in a worker-start receipt says `not_configured`
/// for both `run` and `inherit`, though the window then runs the new worktree's setup script when
/// the project has one. This says what happens, so the receipt is not read as "no setup runs".
fn setup_note(setup: &str, created: bool) -> Option<&'static str> {
    match (setup, created) {
        ("skip", _) => None,
        (_, false) => Some("no new worktree was made, so no setup script runs"),
        _ => Some("the window asks whether to trust the project's setup script and runs it once in the new worktree's Setup tab, if it has one; the agent starts after it ends"),
    }
}

fn worker_row(mut row: Value) -> Value {
    row["runtime"] = json!(std::process::id());
    row["created"] = json!(now_ms());
    row
}

fn worker_start(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    worker_start_with(ctx, req, &|k| ctx.terminals.by_key(k))
}

fn worker_start_with(ctx: &Ctx, req: &Request, by_key: &dyn Fn(&str) -> Option<String>) -> Result<Value, Fail> {
    if req.args["terminal"].as_str().is_some_and(|t| !t.trim().is_empty()) {
        return reuse(ctx, req, req.args["terminal"].as_str().unwrap_or_default().trim());
    }
    // cli FIX-5 (council FIX-SOON 1 on c5fb49c): a --from that cannot be proven fails the start,
    // as it fails worker-stop and worker-release, rather than making the call an outside one.
    let coordinator = caller_with(req, by_key)?;
    worker_start_as(ctx, req, coordinator)
}

/// cli FIX-4 (council FIX-SOON 2 on b4b1600): the Run a worker start acts in. A Run named with
/// `--run` must exist, and a pane may name only the Run it acts in itself (ORCH-033: another Run
/// may be read, never changed); a call from no Kolux pane may name any Run, as worker-stop and
/// worker-release allow. With no `--run` the start acts in the caller's own Run, if any.
fn start_run(m: &crate::orchestration::Mail, coordinator: Option<&str>, named: Option<&str>, dispatches: &[Value]) -> Result<Option<String>, Fail> {
    let Some(n) = named else { return Ok(coordinator.and_then(|p| m.run_of(p, dispatches))) };
    m.run_show(n)?;
    if let Some(p) = coordinator {
        in_run(m, p, n, dispatches)?;
    }
    Ok(Some(n.to_string()))
}

/// worker-start as `coordinator` (the caller's pane, if Kolux knows it).
fn worker_start_as(ctx: &Ctx, req: &Request, coordinator: Option<String>) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let default = default_agent(ctx)?;
    // ORCH-032: a worker may start another only inside the nesting cap; ORCH-033: in its own Run.
    let (depth, cap, run_id) = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let dispatches = load_list(&store, DISPATCHES_KEY)?;
        let (asked, configured) = caps(&store, a);
        let (depth, cap) = crate::orchestration::nest(coordinator.as_deref(), &dispatches, asked, configured)?;
        let run_id = start_run(&crate::orchestration::Mail::load(&store), coordinator.as_deref(), text("run").as_deref(), &dispatches)?;
        // cli FIX-4: a task that is not in that Run, or cannot take a worker, is turned away
        // before the agent is looked up (checked again when the task is claimed below).
        if let Some(id) = text("task") {
            let tasks = load_list(&store, TASKS_KEY)?;
            match text("retryOf") {
                None => crate::orchestration::start_check(&tasks, &id, run_id.as_deref()).map(drop)?,
                Some(_) => crate::orchestration::task_in(&tasks, &id, run_id.as_deref()).map(drop)?,
            }
        }
        (depth, cap, run_id)
    };
    let tier = text("tier");
    // ORCH-018: a tier runs on the coordinator's own agent, when Kolux started one in its pane.
    let agent_id = match &tier {
        Some(_) => crate::orchestration::tier_agent(text("agent").as_deref(), coordinator.as_deref().and_then(|h| own_agent(ctx, h)).as_deref(), &default)?,
        // ORCH-019: with no tier the worker takes the coordinator's own agent unless one is named.
        None => text("agent").or_else(|| coordinator.as_deref().and_then(|h| own_agent(ctx, h))).unwrap_or(default),
    };
    if let (None, Some(m)) = (&tier, text("model")) {
        crate::routing::model_fits(&agent_id, &m).map_err(Fail::args)?;
    }
    let agent = installed_agent(&agent_id)?;
    // ORCH-018 / SET-028: a tier means the model and effort picked for it in model routing.
    let (model, effort) = match &tier {
        Some(t) => {
            let settings = ctx.store.lock().map_err(|e| e.to_string())?.settings();
            crate::routing::route(&settings, &agent_id, t).map_err(|m| Fail::new("no_route", m))?
        }
        None => (text("model"), text("effort")),
    };
    let extra = model_args(&agent_id, model.as_deref(), effort.as_deref())?;
    let timeout = text("timeoutMs").and_then(|ms| ms.parse().ok()).map(Duration::from_millis).unwrap_or(DEFAULT_TIMEOUT);

    // The task: found by id, or made from the brief (ORCH-016's text form creates it).
    let (task, dispatch_id) = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut tasks = load_list(&store, TASKS_KEY)?;
        let mut dispatches = load_list(&store, DISPATCHES_KEY)?;
        let dispatch_id = next_id(&dispatches, "dispatch-");
        let idx = match (text("task"), text("spec")) {
            // orchestration FIX-1 B1: a plain start takes the same check a failed start's way out is
            // proven against; --retry-of goes through claim_task (cli FIX-2).
            (Some(id), _) => match text("retryOf") {
                None => crate::orchestration::start_check(&tasks, &id, run_id.as_deref())?,
                Some(r) => {
                    let i = crate::orchestration::task_in(&tasks, &id, run_id.as_deref())?;
                    let live = |h: &str| ctx.terminals.live(h);
                    claim_task(&tasks, &mut dispatches, i, Some(&r), &dispatch_id, &live)?;
                    save_list(&store, DISPATCHES_KEY, &dispatches)?;
                    i
                }
            },
            (None, Some(spec)) => {
                if spec.len() > crate::orchestration::SPEC_MAX {
                    return Err(Fail::new("too_large", format!("the task text is {} bytes; Kolux stores at most {}", spec.len(), crate::orchestration::SPEC_MAX)));
                }
                let title = text("taskTitle").unwrap_or_else(|| spec.lines().next().unwrap_or_default().chars().take(60).collect());
                let deps: Vec<String> = text("deps").and_then(|d| crate::orchestration::parse_deps(&d)).unwrap_or_default();
                let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                tasks.push(json!({ "id": next_id(&tasks, "task-"), "runId": run_id, "title": title, "spec": spec, "status": "pending", "deps": deps, "parent": text("parent"), "created": created }));
                tasks.len() - 1
            }
            (None, None) => return Err(Fail::args("give --task <id> or --spec <text>")),
        };
        tasks[idx]["status"] = json!("dispatched");
        tasks[idx]["dispatchId"] = json!(dispatch_id);
        save_list(&store, TASKS_KEY, &tasks)?;
        (tasks[idx].clone(), dispatch_id)
    };
    let task_id = task["id"].as_str().unwrap_or_default().to_string();

    // The placement: the caller's worktree, one picked by selector, or a new one (agent-first).
    let placement = text("worktree").unwrap_or_else(|| NEW_TOP.into());
    let (project, worktree, created) = if placement == NEW_TOP || placement == NEW_CHILD {
        // PROJ-047: new-child is a new worktree whose parent is the worktree the call came from;
        // called from outside one of the project's worktrees it has no parent (top level).
        let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
        let parent = if placement == NEW_CHILD { pick_worktree(ctx, "current", &req.cwd).ok().filter(|(p, _)| p.id == project.id).map(|(_, w)| w.path) } else { None };
        let wt = match text("name") {
            Some(name) => projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref(), None)?.worktree,
            None => projects::create_fresh(ctx.git, ctx.store, &project.id)?,
        };
        let wt = match text("displayName") {
            Some(shown) => {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_name(&store, &wt.path, Some(&shown))?;
                Worktree { name: Some(shown), ..wt }
            }
            None => wt,
        };
        let wt = match parent {
            Some(parent) => {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_parent(&store, &wt.path, Some(&parent))?;
                Worktree { parent: Some(parent), ..wt }
            }
            None => wt,
        };
        (project, wt, true)
    } else {
        let (p, w) = pick_worktree(ctx, &placement, &req.cwd)?;
        (p, w, false)
    };

    // ORCH-014: the worker's brief: how to report, beat and ask, any base drift, then the task.
    let behind = drift(ctx.git, &project, &worktree.path);
    // ORCH-067 (T-155-b): a fresh pass for this dispatch, carried only inside the brief's ready-made commands.
    let pass = secret();
    let brief = crate::orchestration::brief_tied(&task, &crate::orchestration::Brief { dispatch: &dispatch_id, run: run_id.as_deref(), coordinator: coordinator.as_deref(), behind, levels_left: cap - depth }, Some(&pass));

    // SAFE-023: a worktree Kolux made is trusted before the agent starts (never the main checkout or
    // a folder made elsewhere, T-443); best effort, a failure never stops the worker.
    let mine = crate::trust::made_by_kolux(ctx.store, &[PathBuf::from(&worktree.path)]);
    let trusted = match crate::trust::trust_folders(&ctx.claude_config, &agent_id, &mine) {
        Ok(_) if mine.is_empty() => json!("not trusted: not a worktree Kolux made, so the agent asks itself"),
        Ok(_) => json!(true),
        Err(e) => json!(format!("not trusted: {e}")),
    };
    let since = Instant::now();
    // cli FIX-4 (council AFTER 4): the window runs the new worktree's setup script unless the
    // notice says skip, so --setup reaches it as worktree create's does (PROJ-033).
    let setup = text("setup").unwrap_or_else(|| "inherit".into());
    // ORCH-017 (T-172-d): worker-start never runs the setup script itself. The created notice asks
    // the window (setupRequest) to run its trust question and the setup once, and the agent starts
    // only after the window reports how it ended (orchestration::setup_gate).
    let gated = created && setup != "skip";
    if created {
        if gated {
            crate::orchestration::setup_gate::open(&dispatch_id);
        }
        (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "isMain": false, "parent": worktree.parent }, "agent": Value::Null, "prompt": "", "activate": false, "setup": setup, "setupRequest": if gated { json!(dispatch_id) } else { Value::Null } }));
    }
    let (setup_failed, setup_result) = if gated {
        crate::orchestration::setup_gate::outcome(crate::orchestration::setup_gate::wait(&dispatch_id, crate::orchestration::setup_gate::LIMIT).as_ref())
    } else {
        (false, json!(if setup == "skip" { "skipped" } else { "not_configured" }))
    };
    let (terminal, ready) = if setup_failed {
        (None, false)
    } else {
        // T-172-e: the window starts the agent with the dispatch id in its environment (DISPATCH_ENV).
        expect_stamp(&dispatch_id);
        (ctx.notify)(json!({ "kind": "start", "path": worktree.path, "branch": worktree.branch, "agent": agent_id, "prompt": brief, "extra": extra, "title": task["title"], "dispatch": dispatch_id }));
        let (terminal, ready) = wait_ready(ctx.terminals, &dispatch_id, since, timeout);
        // cli FIX-8: a start that found no session keeps its place, so a session the window starts after
        // the timeout is still tied to this dispatch (reconcile_late records it on the row).
        finish_stamp(&dispatch_id, terminal, LATE_WINDOW);
        (terminal, ready)
    };
    let status = if ready { "ready" } else if setup_failed { "failed" } else { "unknown" };

    let mut receipt = json!({
        "dispatchId": dispatch_id, "taskId": task_id, "status": status, "stage": "worker",
        "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "projectId": project.id, "created": created, "parent": worktree.parent },
        "placement": placement, "agent": agent_id, "program": agent.program, "model": model, "effort": effort, "tier": tier,
        "setup": setup_result, "setupNote": setup_note(&setup, created), "trust": trusted,
        "terminals": terminal.map(|id| vec![json!({ "id": id, "role": "worker" })]).unwrap_or_default(),
        "waitedMs": since.elapsed().as_millis() as u64,
        "launch": "new_terminal",
        "hint": format!("{} worktree rm --worktree \"path:{}\" --force removes the worktree, its worker and all", crate::orchestration::CLI, worktree.path),
        // CLI-035: the worker runs in a background tab; this is where to find it.
        "reveal": format!("open {} under {} in the Kolux sidebar to see the worker", worktree.name.clone().or(worktree.branch.clone()).unwrap_or_else(|| worktree.path.clone()), project.name),
    });
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut dispatches = load_list(&store, DISPATCHES_KEY)?;
        let mut row = worker_row(json!({ "id": dispatch_id, "runId": run_id, "taskId": task_id, "status": status, "worktree": worktree.path, "agent": agent_id, "model": model, "effort": effort, "tier": tier, "terminal": terminal, "terminalProgram": terminal.and_then(|t| mark_program(ctx.terminals, t)), "depth": depth, "maxDepth": cap, "brief": brief, "pass": pass, "retryOf": text("retryOf") }));
        if let Some(g) = terminal.and_then(|t| crate::orchestration::process_generation(ctx.terminals, t)) {
            row[crate::orchestration::PASS_GENERATION] = json!(g);
        }
        dispatches.push(row);
        save_list(&store, DISPATCHES_KEY, &dispatches)?;
    }
    if ready {
        Ok(receipt)
    } else if setup_failed {
        // ORCH-017 (T-172-d): a failed setup fails the task (the row above is failed too), so the
        // offered retry passes start_check; no agent was started.
        {
            let store = ctx.store.lock().map_err(|e| e.to_string())?;
            let mut tasks = load_list(&store, TASKS_KEY)?;
            if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task_id.as_str() && t["dispatchId"] == dispatch_id.as_str()) {
                t["status"] = json!("failed");
            }
            save_list(&store, TASKS_KEY, &tasks)?;
        }
        let setup = receipt["setup"].clone();
        let why = match setup["exitCode"].as_i64() {
            Some(n) => format!("the worktree's setup script failed with exit code {n}"),
            None => setup["note"].as_str().unwrap_or("the worktree's setup script failed").to_string(),
        };
        crate::orchestration::start_failed(&mut receipt, "setup", setup);
        start_failed_run(&mut receipt, run_id.as_deref());
        Err(Fail { code: "failed", message: format!("{why}; the worker was not started ({dispatch_id} in {})", worktree.path), data: receipt })
    } else {
        // ORCH-017 (T-172-c): the stage reached, the setup result, what is left over (never closed)
        // and the commands to clean up or try again.
        let setup = receipt["setup"].clone();
        crate::orchestration::start_failed(&mut receipt, "worker", setup);
        start_failed_run(&mut receipt, run_id.as_deref());
        Err(Fail { code: "timeout", message: format!("the worker did not come up within {} ms; it may still be starting in the background ({dispatch_id} in {}); if it does, worker-show and worker-stop find its session", timeout.as_millis(), worktree.path), data: receipt })
    }
}

/// A token nobody outside this machine can guess: two hashes seeded from the OS's randomness.
pub(crate) fn secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    let seed = std::collections::hash_map::RandomState::new();
    let mut h = seed.build_hasher();
    h.write_u64(u64::from(std::process::id()));
    format!("{:016x}{:016x}", h.finish(), std::collections::hash_map::RandomState::new().build_hasher().finish())
}

/// CLI-012 (T-076-c): the request the app is answering now and when it began, plus the requests
/// read but not yet begun (command, arrival), so a status question that comes in meanwhile can say
/// what runs and for how long, and is not queued in the gap between two requests (cli FIX-1).
#[derive(Default)]
struct Busy {
    running: Option<(String, Instant)>,
    waiting: std::collections::VecDeque<(String, Instant)>,
}
type Current = std::sync::Arc<Mutex<Busy>>;

/// cli FIX-1: how long the accept thread waits for a connection's one line. A command line writes
/// it straight away; a silent local client must not hold the side answer to status past the
/// status question's own wait, so this stays well under STATUS_WAIT.
const ACCEPT_READ: Duration = Duration::from_millis(1500);

/// Answers requests on `listener` one at a time, for as long as the app runs.
pub fn serve_loop(listener: TcpListener, token: &str, runtime: &str, handle: impl Fn(&Request) -> Result<Value, Fail>) {
    serve_loop_with(listener, token, runtime, || status_answer(&GRAPH_READY), handle);
}

/// `serve_loop` with the status answer given, so a test can stand in for the app's.
fn serve_loop_with(listener: TcpListener, token: &str, runtime: &str, status: impl Fn() -> Value + Send + 'static, handle: impl Fn(&Request) -> Result<Value, Fail>) {
    // ponytail: one request at a time; a parallel accept loop if agents ever queue up on it. A
    // second thread takes each connection as it comes and reads its line, so a request knows
    // when it was sent, and a status question is answered at once while a request runs (T-076-c).
    let current: Current = std::sync::Arc::default();
    let (queue, taken) = mpsc::channel::<(TcpStream, Instant, String)>();
    let (busy, tok, rt) = (current.clone(), token.to_string(), runtime.to_string());
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let arrived = Instant::now();
            stream.set_read_timeout(Some(ACCEPT_READ)).ok();
            let mut line = String::new();
            if BufReader::new(&stream).read_line(&mut line).is_err() {
                continue;
            }
            // BROW-051: a web page can only ever send HTTP here; its request line is dropped unanswered.
            if line.split_whitespace().nth(2).is_some_and(|w| w.starts_with("HTTP/")) {
                continue;
            }
            if let Some(reply) = busy_status(&line, &tok, &rt, &busy, &status) {
                let _ = stream.write_all(reply.as_bytes()).and_then(|_| stream.write_all(b"\n"));
                continue;
            }
            let command = serde_json::from_str::<Request>(&line).map(|r| r.command).unwrap_or_default();
            if let Ok(mut b) = busy.lock() {
                b.waiting.push_back((command, arrived));
            }
            if queue.send((stream, arrived, line)).is_err() {
                break;
            }
        }
    });
    for (mut stream, arrived, line) in taken {
        // Taken off the queue and begun under one lock, so a status question never sees neither.
        if let Ok(mut c) = current.lock() {
            c.running = c.waiting.pop_front().map(|(command, _)| (command, Instant::now()));
        }
        let (id, out) = match serde_json::from_str::<Request>(&line) {
            Ok(req) if req.token != token => (req.id, Err(Fail::new("unauthorized", "the token does not match this app; is cli.json stale?"))),
            // CLI-038: an app older than the CLI turns a change away before it runs.
            Ok(req) if CHANGES.contains(&req.command.as_str()) && newer(&req.cli, VERSION) => {
                (req.id, Err(Fail { code: "version_gap", message: format!("this Kolux ({VERSION}) is older than the command line ({}); update Kolux before sending orchestration changes", req.cli), data: json!({ "appVersion": VERSION, "cliVersion": req.cli }) }))
            }
            Ok(req) => {
                let id = req.id.clone();
                let out = handle(&Request { arrived: Some(arrived), ..req });
                (id, out)
            }
            Err(e) => (String::new(), Err(Fail::args(format!("malformed request: {e}")))),
        };
        if let Ok(mut c) = current.lock() {
            c.running = None;
        }
        let mut reply = envelope(&id, runtime, out);
        reply["meta"]["appVersion"] = json!(VERSION);
        let reply = reply.to_string();
        let _ = stream.write_all(reply.as_bytes()).and_then(|_| stream.write_all(b"\n"));
    }
}

/// CLI-012 (T-076-c): while a request runs, a status question with the right token is answered
/// straight away with the app's answer plus the running request's command and how long it has
/// run; None hands the line on to the queue.
fn busy_status(line: &str, token: &str, runtime: &str, current: &Current, status: &dyn Fn() -> Value) -> Option<String> {
    let req = serde_json::from_str::<Request>(line).ok().filter(|r| r.command == STATUS && r.token == token)?;
    // cli FIX-1: nothing runs but requests wait their turn (the gap between two): busy with the
    // next one, for as long as it has waited.
    let (command, since, queued) = {
        let b = current.lock().ok()?;
        let (command, since) = b.running.clone().or_else(|| b.waiting.front().cloned())?;
        (command, since, b.waiting.len() - usize::from(b.running.is_none()))
    };
    let mut answer = status();
    answer["busy"] = json!({ "command": command, "runningMs": since.elapsed().as_millis() as u64, "queued": queued });
    let mut reply = envelope(&req.id, runtime, Ok(answer));
    reply["meta"]["appVersion"] = json!(VERSION);
    Some(reply.to_string())
}

/// Starts listening for the command line and writes `cli.json` so it can find the app.
pub fn serve(app: tauri::AppHandle, dir: &Path) -> std::io::Result<()> {
    use tauri::{Emitter, Manager};
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = secret();
    let runtime = std::process::id().to_string();
    std::fs::write(dir.join(FILE), json!({ "port": port, "token": token, "pid": std::process::id() }).to_string())?;
    // CLI-012: the workspace graph is ready once every project's worktrees have been read once;
    // until then `kolux status` says graph-not-ready. The reads also warm ps's scan cache.
    let warm = app.clone();
    std::thread::spawn(move || {
        let list = warm.state::<Mutex<Store>>().lock().map(|s| projects::load_projects(&s)).unwrap_or_default();
        for p in list {
            let _ = scan(&p.path);
        }
        GRAPH_READY.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    std::thread::spawn(move || {
        serve_loop(listener, &token, &runtime, |req| {
            let store = app.state::<Mutex<Store>>();
            let git = app.state::<Git>();
            let terminals = app.state::<Terminals>();
            // A change made for another view names its own event (the Automations page's, CLI-029).
            let notify = |v: Value| {
                if v["kind"] == "accounts" {
                    let _ = app.emit(crate::claude_accounts::EVENT, ());
                    let _ = app.emit(crate::codex_accounts::EVENT, ());
                } else {
                    let _ = match v["emit"].as_str() {
                        Some(event) => app.emit(event, v["payload"].clone()),
                        None => app.emit(EVENT, v),
                    };
                }
            };
            let front = || -> Result<(), String> {
                let w = app.get_webview_window("main").ok_or("the Kolux window is gone")?;
                let _ = w.unminimize();
                w.show().and_then(|_| w.set_focus()).map_err(|e| e.to_string())
            };
            dispatch(&request_ctx(&store, &git, &terminals, &notify, &front), req)
        });
    });
    Ok(())
}

/// Row 220: a client run inside WSL names its distribution, so the app can read a Linux-form
/// path (/home/...) against it; a value the caller gave is kept.
fn caller_distro(args: &mut Map<String, Value>, distro: Option<String>) {
    if let Some(d) = distro.filter(|d| !d.trim().is_empty()) {
        args.entry("callerDistro").or_insert(json!(d));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memo_turn(at: u64) -> RetryTurn {
        std::sync::Arc::new(Mutex::new(Some((at, Value::Null))))
    }

    #[test]
    fn row909_the_retry_memos_are_capped_and_the_oldest_idle_one_goes_first() {
        let now = 10 * so::RECEIPT_TTL_MS;
        let mut turns = BTreeMap::new();
        for n in 0..=so::RECEIPTS_KEPT as u64 {
            turns.insert(format!("k{n}"), memo_turn(now - 1000 + n));
        }
        let busy = memo_turn(now - 5000);
        let _held = busy.clone();
        turns.insert("busy".into(), busy);
        retry_turn_in(&mut turns, "fresh", now);
        assert!(!turns.contains_key("k0"), "the oldest idle memo went");
        assert!(turns.contains_key(&format!("k{}", so::RECEIPTS_KEPT)), "the newest is kept");
        assert!(turns.contains_key("busy"), "a key in use is never dropped, however old");
        let idle = turns.iter().filter(|(k, t)| k.starts_with('k') && t.try_lock().is_ok_and(|m| m.is_some())).count();
        assert_eq!(idle, so::RECEIPTS_KEPT);
    }

    #[test]
    fn row909_a_poisoned_retry_memo_is_read_through() {
        let now = 10 * so::RECEIPT_TTL_MS;
        let old = memo_turn(now - so::RECEIPT_TTL_MS - 1);
        let held = old.clone();
        let _ = std::thread::spawn(move || {
            let _g = held.lock().unwrap();
            panic!("poison the memo");
        })
        .join();
        let mut turns = BTreeMap::from([("old".to_string(), old)]);
        retry_turn_in(&mut turns, "fresh", now);
        assert!(!turns.contains_key("old"), "an expired memo is dropped even when its lock was poisoned");
    }

    #[test]
    fn row220_the_client_sends_the_wsl_distribution_it_runs_in() {
        let mut a = Map::new();
        caller_distro(&mut a, None);
        caller_distro(&mut a, Some(" ".into()));
        assert!(a.is_empty());
        caller_distro(&mut a, Some("Ubuntu".into()));
        assert_eq!(a["callerDistro"], "Ubuntu");
        caller_distro(&mut a, Some("Debian".into()));
        assert_eq!(a["callerDistro"], "Ubuntu", "a value already given is kept");
    }
    use std::process::Command;

    fn words(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }

    /// CLI-023, CLI-026, CLI-027: the terminal words, their flags, focus as switch and stop as a
    /// hidden close that says what replaced it.
    #[test]
    fn the_terminal_commands_are_checked_before_the_app_is_asked() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let p = ok("terminal list --worktree name:a --limit 2 --include-visual-layouts");
        assert_eq!((p.command.as_str(), &p.args["worktree"], &p.args["limit"], &p.args["includeVisualLayouts"]), ("terminal.list", &json!("name:a"), &json!("2"), &json!(true)));
        let p = ok("terminal create --worktree active --command codex --title Review --focus");
        assert_eq!((p.command.as_str(), &p.args["command"], &p.args["focus"]), ("terminal.create", &json!("codex"), &json!(true)));
        assert_eq!(ok("terminal focus --terminal term-3").command, "terminal.switch");
        assert_eq!(ok("terminal rename --terminal term-3").args.get("title"), None);
        assert_eq!(ok("terminal split --terminal term-3 --direction horizontal").args["direction"], "horizontal");
        assert!(refused("terminal split --terminal term-3 --direction sideways").contains("horizontal or vertical"));
        assert!(refused("terminal show").contains("--terminal is required"));
        assert!(refused("terminal close").contains("say what to close"));
        assert!(refused("terminal close --all").contains("go together"));
        assert!(refused("terminal close --tab --worktree name:a --all").contains("--tab"));
        assert!(refused("terminal close --terminal term-1 --worktree name:a --all").contains("not both"));
        assert_eq!(ok("terminal close --terminal term-1 --tab").args["tab"], true);
        assert!(refused("terminal list --limit 0").contains("above zero"));
        assert!(refused("terminal create --colour red").contains("unknown flag"));
        // the old word: hidden, still explains itself, and with a target it closes with a note
        assert!(refused("terminal stop").contains("replaced by terminal close"));
        let p = ok("terminal stop --worktree name:a --all");
        assert_eq!(p.command, "terminal.close");
        assert!(p.args["note"].as_str().unwrap().contains("terminal close"));
        assert!(!HELP.contains("terminal stop") && HELP.contains("terminal close"));
        assert!(one_shot("codex exec fix it") && one_shot("claude -p hi") && !one_shot("codex") && !one_shot("claude --model opus"));
    }

    /// CLI-023: the readable listing nests tabs under their pane, worktree by worktree, and an
    /// empty one says what it looked at.
    #[test]
    fn the_terminal_listing_draws_panes_with_their_tabs() {
        let row = |h: &str, wt: &str, pane: u64, tab: u64, shown: bool| json!({ "handle": h, "title": format!("T {h}"), "worktree": wt, "pane": pane, "tab": tab, "shown": shown });
        let rows = vec![row("term-4", "C:/a", 2, 1, false), row("term-2", "C:/a", 1, 2, true), row("term-1", "C:/a", 1, 1, false), row("term-9", "C:/b", 1, 1, true)];
        let out = json!({ "terminals": rows, "layouts": layouts(&rows), "hosts": hosts() });
        let text = terminal_text("terminal.list", &out).unwrap();
        assert_eq!(text, "C:/a\n  pane 1\n    term-1  T term-1\n    term-2  T term-2  (in view)\n  pane 2\n    term-4  T term-4\nC:/b\n  pane 1\n    term-9  T term-9  (in view)\nhosts covered: local; none left out");
        let empty = terminal_text("terminal.list", &json!({ "terminals": [], "scope": "C:/a" })).unwrap();
        assert!(empty.starts_with("no terminals open in C:/a") && empty.ends_with("none left out"));
    }

    #[test]
    fn cli003_typos_get_safe_suggestions_before_the_app_is_asked() {
        let fail = |s: &str| parse(&words(s)).1.unwrap_err();
        // A wrong group: the nearest group, and the full path when the verb fits it.
        let f = fail("worktre list");
        assert!(f.message.contains("`worktre`") && f.message.contains("worktree list"), "{}", f.message);
        assert_eq!(f.data["nextSteps"], json!(["kolux-dev worktree list"]));
        assert_eq!(f.data["unknown"], "worktre");
        // A wrong verb: rm only from one edit away; a harmless typo never lands on it.
        assert!(fail("worktree rmm --worktree name:x").message.contains("did you mean worktree rm?"));
        let lst = fail("worktree lst");
        assert!(lst.message.contains("worktree list") && !lst.message.contains(" rm"), "{}", lst.message);
        assert!(!fail("worktree rmx2").message.contains("rm?"), "two edits from rm");
        assert!(fail("worktree delet --worktree name:x").message.contains("worktree delete"), "aliases are suggested too");
        // A wrong flag: the nearest flag of that command, and the list of its flags.
        let flag = fail("worktree show --worktre name:x");
        assert!(flag.message.contains("unknown flag --worktre for worktree show") && flag.message.contains("did you mean --worktree?"), "{}", flag.message);
        assert_eq!(flag.data["flags"], json!(["--worktree", "--usage", "--json"]));
        assert!(flag.data["hint"].as_str().unwrap().contains("--worktree"));
        assert_eq!(flag.data["nextSteps"], json!(["kolux-dev worktree show --worktree name:x"]));
        let long = fail(&format!("worktree list --{}", "x".repeat(40)));
        assert_eq!(long.data["suggestions"], json!([]));
        assert_eq!(long.data["flags"], json!(["--repo", "--limit", "--json"]));
        // The renamed caller flag is pointed at --terminal, and only on check.
        let renamed = fail("orchestration check --from term-1");
        assert!(renamed.message.contains("--terminal") && renamed.message.contains("renamed"), "{}", renamed.message);
        assert!(!fail("orchestration inbox --from term-1").message.contains("renamed"));
        // A wrong flag ahead of the group is reported against the full path, and the call ends there.
        let (json, r) = parse(&words("--jso worktree --json list"));
        assert!(json);
        let f = r.unwrap_err();
        assert!(f.message.contains("--jso") && f.message.contains("worktree list"), "{}", f.message);
        assert_eq!(f.data["command"], "worktree list");
        assert_eq!(main(words("--jso worktree --json list")), 1);
    }

    #[test]
    fn the_command_line_is_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("worktree create --name one --agent claude --prompt=hi --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "worktree.create");
        assert_eq!(p.args["name"], "one");
        assert_eq!(p.args["prompt"], "hi");
        assert_eq!(p.args["setup"], "inherit");
        let (_, p) = parse(&words("worktree delete --worktree name:one --force"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.command, "worktree.rm");
        assert_eq!(p.args["force"], true);
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        // T-014-b-fix: a prompt with no --agent goes to the app, which picks the agent (PROJ-038).
        assert_eq!(parse(&words("worktree create --name x --prompt hi")).1.unwrap().unwrap().args["prompt"], "hi");
        assert!(refused("worktree create --name x --name y").contains("twice"));
        assert!(refused("worktree create --name x --bogus 1").contains("--bogus"));
        assert!(refused("worktree create --name x --setup later").contains("run, skip or inherit"));
        // PROJ-037: --issue alone is enough; the app names the worktree after the issue's title.
        assert!(refused("worktree create --agent claude").contains("--name is required (or --issue"));
        assert_eq!(parse(&words("worktree create --issue 7")).1.unwrap().unwrap().args["issue"], "7");
        assert!(refused("worktree create --name x --no-parent --parent-worktree name:a").contains("disagree"));
        assert!(refused("worktree create --name x --parent-workspace name:a").contains("retired"));
        assert!(refused("worktree create --name x --parent-worktree").contains("needs a value"));
        assert!(refused("worktree create --name x --parent-worktree=").contains("empty"));
        assert!(refused("worktree create --name x --issue abc").contains("issue number"));
        assert!(refused("worktree create --name x --issue 0").contains("issue number"));
        assert_eq!(parse(&words("worktree create --name x --issue 12 --no-parent")).1.unwrap().unwrap().args["noParent"], true);
        assert!(refused("worktree rm").contains("--worktree"));
        assert!(refused("worktree frobnicate").contains("unknown command"));
        assert_eq!(parse(&words("open --json")).1.unwrap().unwrap().command, "app.open");
        assert!(refused("open --name x").contains("unknown flag --name"));
        assert!(parse(&words("--help")).1.unwrap().is_none());
        assert!(parse(&words("help worktree")).1.unwrap().is_none());
    }

    #[test]
    fn help_answers_on_every_level_of_the_command_tree() {
        let h = |s: &str| help(&help_path(&words(s)));
        // The overview: every group, and the global options.
        let (all, code) = h("--help");
        assert_eq!(code, 0);
        assert!(all.contains("Global options") && all.contains("--help") && all.contains("--json"), "{all}");
        assert_eq!(h(""), h("help"));
        // A group lists its commands and nothing else.
        let (wt, code) = h("worktree --help");
        assert_eq!(code, 0);
        for verb in ["list", "show", "current", "create", "rm", "ps", "changes", "overlap"] {
            assert!(wt.contains(&format!("worktree {verb}")), "worktree help lacks {verb}: {wt}");
        }
        assert!(!wt.contains("orchestration send") && wt.contains("Global options"), "{wt}");
        assert_eq!(h("help worktree"), h("worktree --help"), "help <path> and <path> --help agree");
        // A command, with its flags and its global options; an alias finds the command it stands for.
        let (create, code) = h("worktree create --name x --help");
        assert_eq!(code, 0);
        assert!(create.contains("--base-branch") && !create.contains("worktree rm"), "{create}");
        assert_eq!(h("worktree delete --help"), h("worktree rm --help"));
        assert_eq!(h("skills show -h"), h("skills get -h"));
        // Every command can be found from its own group's help.
        for (path, _, _) in commands() {
            let group = path.split(' ').next().unwrap();
            let (text, code) = h(&format!("help {group}"));
            assert_eq!(code, 0, "{group}");
            assert!(text.contains(path.rsplit(' ').next().unwrap()), "{path} is missing from the {group} help");
            assert_eq!(h(&format!("help {path}")).1, 0, "{path}");
        }
        // A path nothing answers to: the closest help, a suggestion, exit 1.
        let (typo, code) = h("help worktree craete");
        assert_eq!(code, 1);
        assert!(typo.contains("did you mean kolux-dev worktree create") && typo.contains("worktree list"), "{typo}");
        let (typo, code) = h("help wrktree");
        assert_eq!(code, 1);
        assert!(typo.contains("did you mean kolux-dev worktree"), "{typo}");
        let (none, code) = h("help zzzzzzzzzz");
        assert_eq!(code, 1);
        assert!(none.contains("Global options"), "the overview when nothing is close");
        // Flag values are not taken for command words.
        assert_eq!(help_path(&words("--repo name:x worktree list --help")), vec!["worktree".to_string(), "list".to_string()]);
    }

    #[test]
    fn the_version_flag_counts_only_on_its_own_and_a_leading_double_dash_is_ignored() {
        assert!(version_only(&words("--version")) && version_only(&words("-v")));
        assert!(!version_only(&words("--version --json")) && !version_only(&words("worktree list -v")));
        assert_eq!(parse(&words("-- skills list")).1.unwrap().unwrap().command, parse(&words("skills list")).1.unwrap().unwrap().command);
    }

    #[test]
    fn the_skill_guides_name_only_commands_and_flags_that_exist() {
        let paths: Vec<&str> = commands().iter().map(|c| c.0).collect();
        let groups: Vec<&str> = paths.iter().map(|p| p.split(' ').next().unwrap()).collect();
        for (name, text) in local_cli::guides() {
            let w: Vec<&str> = text.split(|c: char| c.is_whitespace() || "`'\"()[]|".contains(c)).filter(|s| !s.is_empty()).collect();
            for i in 0..w.len() {
                if (w[i] == "kolux" || w[i] == "kolux-dev") && i + 1 < w.len() && groups.contains(&w[i + 1]) {
                    let one = w[i + 1];
                    let two = w.get(i + 2).map(|v| format!("{one} {v}")).unwrap_or_default();
                    assert!(paths.contains(&one) || paths.contains(&two.as_str()), "{name} names kolux {two}, which is not a command");
                }
                if let Some(flag) = w[i].strip_prefix("--") {
                    let flag = flag.split('=').next().unwrap().trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
                    assert!(flag.is_empty() || ["json", "help", "version"].contains(&flag) || known_flag(flag) || SWITCHES.contains(&flag), "{name} names --{flag}, which no command takes");
                }
            }
        }
    }

    #[test]
    fn account_commands_assume_claude_and_refuse_what_they_cannot_honour() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let p = ok("account add");
        assert_eq!((p.command.as_str(), p.args["agent"].as_str()), ("account.add", Some("claude")), "Claude when --agent is left out");
        assert_eq!(ok("account add --agent codex").args["agent"], "codex");
        assert_eq!(ok("account add --agent Codex").args["agent"], "codex");
        assert_eq!(ok("account list").command, "account.list");
        assert!(parse(&words("account list --json")).0);
        assert!(refused("account add --agent=").contains("empty"), "an empty --agent is refused, not Claude");
        assert!(refused("account add --agent grok").contains("claude or codex"));
        for flag in ["--environment work", "--pairing-code 1234", "--remote box", "--target box"] {
            assert!(refused(&format!("account add {flag}")).contains("this machine"), "{flag}");
            assert!(refused(&format!("account list {flag}")).contains("this machine"), "{flag}");
        }
        assert!(refused("account list --agent claude").contains("--agent"));
    }

    #[test]
    fn terminal_read_send_and_wait_parse_and_refuse_what_the_cards_say() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let p = ok("terminal read --terminal term-3 --cursor 5 --limit 10");
        assert_eq!((p.command.as_str(), p.args["terminal"].as_str(), p.args["cursor"].as_str(), p.args["limit"].as_str()), ("terminal.read", Some("term-3"), Some("5"), Some("10")));
        assert_eq!(ok("terminal read --screen").args["screen"], true);
        let p = ok("terminal send --text hi --enter --interrupt --wait-submit 5 --retry-request r1");
        assert_eq!((p.args["text"].as_str(), p.args["enter"].as_bool(), p.args["interrupt"].as_bool(), p.args["waitSubmit"].as_str(), p.args["retryRequest"].as_str()), (Some("hi"), Some(true), Some(true), Some("5"), Some("r1")));
        let p = ok("terminal wait --for tui-idle --timeout-ms 100");
        assert_eq!((p.command.as_str(), p.args["for"].as_str(), p.args["timeoutMs"].as_str()), ("terminal.wait", Some("tui-idle"), Some("100")));
        for c in ["terminal read", "terminal send", "terminal wait"] {
            assert!(HELP.contains(&format!("kolux-dev {c} ")), "{c} in help");
        }

        let dir = std::env::temp_dir().join(format!("kolux-rs-term-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let pane = Some(Pane { handle: "term-7".into(), key: "k".into() });
        let req = |command: &str, args: Value, pane: Option<Pane>| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane, cli: VERSION.into(), arrived: None };
        // Outside a Kolux terminal --terminal is required; inside one it defaults to that terminal.
        assert!(dispatch(&ctx, &req("terminal.read", json!({}), None)).unwrap_err().message.contains("--terminal"));
        assert_eq!(dispatch(&ctx, &req("terminal.read", json!({}), pane.clone())).unwrap_err().message, "no open Kolux terminal is called term-7");
        assert_eq!(dispatch(&ctx, &req("terminal.read", json!({ "terminal": "term-9" }), None)).unwrap_err().code, "not_found");
        assert!(dispatch(&ctx, &req("terminal.read", json!({ "terminal": "nine" }), None)).unwrap_err().message.contains("term-<n>"));
        // CLI-024: a screen has no history, so --screen --cursor is refused before anything is looked up.
        let both = dispatch(&ctx, &req("terminal.read", json!({ "terminal": "term-9", "screen": true, "cursor": "5" }), None)).unwrap_err();
        assert!(both.message.contains("--screen and --cursor"), "{}", both.message);
        assert!(dispatch(&ctx, &req("terminal.read", json!({ "terminal": "term-9", "cursor": "x" }), None)).unwrap_err().message.contains("--cursor takes a whole number"));
        // CLI-025: send needs something to send; a retry of a known request answers without a terminal.
        assert!(dispatch(&ctx, &req("terminal.send", json!({ "terminal": "term-9" }), None)).unwrap_err().message.contains("--text, --enter or --interrupt"));
        assert_eq!(dispatch(&ctx, &req("terminal.send", json!({ "terminal": "term-9", "enter": true }), None)).unwrap_err().code, "not_found");
        // ORCH-055: the receipt is kept in the store, so it answers after a restart too.
        {
            let s = store.lock().unwrap();
            let mut receipts = so::Receipts::load(&s);
            receipts.record("term-9|r1", now_ms(), json!({ "terminal": "term-9", "receipt": "turn_began" }));
            receipts.save(&s).unwrap();
            assert!(so::Receipts::load(&s).find("term-9|r1").is_some());
        }
        let again = dispatch(&ctx, &req("terminal.send", json!({ "terminal": "term-9", "text": "hi", "enter": true, "retryRequest": "r1" }), None)).unwrap();
        assert_eq!((again["receipt"].as_str(), again["retried"].as_bool()), (Some("turn_began"), Some(true)));
        assert_eq!(dispatch(&ctx, &req("terminal.send", json!({ "terminal": "term-9", "text": "hi", "enter": true, "retryRequest": "r2" }), None)).unwrap_err().code, "not_found");
        // CLI-025: wait needs a condition it knows; an ended terminal has met either.
        assert!(dispatch(&ctx, &req("terminal.wait", json!({ "terminal": "term-9" }), None)).unwrap_err().message.contains("--for"));
        assert!(dispatch(&ctx, &req("terminal.wait", json!({ "terminal": "term-9", "for": "idle" }), None)).unwrap_err().message.contains("exit or tui-idle"));
        let ended = dispatch(&ctx, &req("terminal.wait", json!({ "terminal": "term-9", "for": "tui-idle" }), None)).unwrap();
        assert_eq!((ended["done"].as_bool(), ended["state"].as_str()), (Some(true), Some("exited")));
        assert!(wait_step(&ended).unwrap());
        assert!(!wait_step(&json!({ "done": false })).unwrap());
        let blocked = wait_step(&json!({ "terminal": "term-2", "done": true, "state": "permission", "blocked": true })).unwrap_err();
        assert_eq!((blocked.code, blocked.message.as_str()), ("blocked", "term-2 is permission, not idle: the agent needs an answer"));
        // Text output: a screen is its rows; a read is its lines, the unfinished one, and the cursor.
        assert_eq!(text_of("terminal.read", &json!({ "screen": true, "rows": ["a", "b", ""] })), "a\nb");
        assert_eq!(text_of("terminal.read", &json!({ "screen": false, "lines": [{ "cursor": 4, "text": "x" }], "pending": "> ", "cursor": 4 })), "x\n> \n-- cursor 4");
        assert_eq!(text_of("terminal.send", &json!({ "terminal": "term-1", "delivered": ["text", "enter"], "receipt": "turn_began" })), "sent text+enter to term-1: the prompt was taken (the agent began a turn)");
        assert_eq!(text_of("terminal.send", &json!({ "terminal": "term-1", "delivered": ["text", "enter"], "receipt": "queued", "next": "kolux terminal read --terminal term-1 --screen" })), "sent text+enter to term-1: queued; look with kolux terminal read --terminal term-1 --screen");
        assert_eq!(text_of("terminal.wait", &json!({ "terminal": "term-1", "state": "done" })), "term-1 is done");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// TERM-125 box 2: `terminal close --worktree X --all` through dispatch closes every terminal of that worktree and no other.
    #[test]
    fn term125_close_worktree_all_closes_every_terminal_there_and_only_there() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-term125close-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let x = dispatch(&ctx, &req("worktree.create", json!({ "repo": "name:repo", "name": "xx" }))).unwrap()["path"].as_str().unwrap().to_string();
        let y = dispatch(&ctx, &req("worktree.create", json!({ "repo": "name:repo", "name": "yy" }))).unwrap()["path"].as_str().unwrap().to_string();
        // three terminals in X (one running a program), one in Y
        terminals.fake_session(21, &x, None);
        terminals.fake_session(22, &x, None);
        terminals.fake_session(23, &x, Some("npx"));
        terminals.fake_session(24, &y, None);
        // a stand-in session never reports its exit, so the three-second confirmation is not met: the answer lists exactly X's
        // terminals as "not confirmed", and none of Y's
        let out = dispatch(&ctx, &req("terminal.close", json!({ "worktree": format!("path:{x}"), "all": true }))).unwrap_err();
        let mut asked: Vec<String> = out.data["notConfirmed"].as_array().unwrap().iter().map(|h| h.as_str().unwrap().to_string()).collect();
        asked.sort();
        assert_eq!(asked, ["term-21", "term-22", "term-23"], "{}", out.message);
        assert!(["term-21", "term-22", "term-23"].iter().all(|h| !terminals.live(h)), "every terminal of X is gone");
        assert!(terminals.live("term-24"), "the other worktree's terminal stays");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// TERM-125 (rest): the texts of `terminal show`, a plain `send` (with Enter, or an interrupt)
    /// and `wait`; and `wait`'s time limit: it asks again every half second and, when the
    /// condition is still not met, fails with the state the terminal is in.
    #[test]
    fn term125_show_send_and_wait_texts_and_the_wait_time_limit() {
        let shown = json!({ "handle": "term-1", "title": "Terminal 1", "worktree": null, "pane": 1, "tab": 1, "host": "local", "shown": true });
        assert_eq!(terminal_text("terminal.show", &shown).unwrap(), "term-1  Terminal 1\nworktree none · pane 1 tab 1 · host local · in view");
        let hidden = json!({ "handle": "term-2", "title": "t079b-exit", "worktree": "G:/r", "pane": 1, "tab": 2, "host": "local", "shown": false });
        assert_eq!(terminal_text("terminal.show", &hidden).unwrap(), "term-2  t079b-exit\nworktree G:/r · pane 1 tab 2 · host local");
        assert_eq!(text_of("terminal.send", &json!({ "terminal": "term-1", "delivered": ["text", "enter"] })), "sent text+enter to term-1");
        assert_eq!(text_of("terminal.send", &json!({ "terminal": "term-1", "delivered": ["interrupt"] })), "sent interrupt to term-1");
        assert_eq!(text_of("terminal.wait", &json!({ "terminal": "term-2", "done": true, "state": "exited" })), "term-2 is exited");
        assert_eq!(text_of("terminal.wait", &json!({ "terminal": "term-1", "done": true, "state": "quiet" })), "term-1 is quiet");

        // An app whose terminal keeps running: wait polls (at least twice in 700 ms) and then fails.
        use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let asked = Arc::new(AtomicUsize::new(0));
        let count = asked.clone();
        std::thread::spawn(move || {
            serve_loop(listener, "secret", "rt-1", move |_| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(json!({ "terminal": "term-1", "done": false, "state": "running", "blocked": false }))
            })
        });
        let req = Request { id: "w1".into(), token: "secret".into(), command: "terminal.wait".into(), cwd: String::new(), args: json!({ "terminal": "term-1", "for": "exit", "timeoutMs": "700" }), pane: None, cli: VERSION.into(), arrived: None };
        let start = Instant::now();
        let f = wait_for_terminal(port, req).unwrap_err();
        let took = start.elapsed();
        assert_eq!((f.code, f.message.as_str()), ("timeout", "term-1 did not reach exit within 700 ms (it is running)"));
        assert_eq!(f.data["state"], "running");
        assert!(took >= Duration::from_millis(700) && took < Duration::from_secs(5), "took {took:?}");
        assert!(asked.load(Ordering::SeqCst) >= 2, "asked {} times", asked.load(Ordering::SeqCst));
    }

    /// TERM-126: a prompt sent with Enter is watched for the whole `--wait-submit`: a busy agent
    /// that stays busy reports it did not submit, with the state named and exit status 1; a new
    /// history entry within the wait means the prompt was taken; an idle pane that stays idle is
    /// not submitted; a pane without hooks is unknown, its output watched only when asked.
    #[test]
    fn term126_send_wait_submit_honours_the_wait_and_names_the_state() {
        use std::cell::Cell;
        let working = |m: u64| Some(((m, 1usize), true));
        let idle = |m: u64| Some(((m, 1usize), false));
        // Busy and still busy after the wait: the whole wait is used, then queued / not submitted / exit 1.
        let start = Instant::now();
        let v = submit_verdict("term-2", working(10), Duration::from_millis(400), true, || working(10), || Some("working"), || true);
        assert_eq!((v.receipt, v.submitted, v.state), ("queued", Some(false), Some("working")));
        assert!(start.elapsed() >= Duration::from_millis(400) && v.waited_ms >= 400, "waited {} ms", v.waited_ms);
        // Busy, then its turn ends and the queued prompt starts a new one (a new history mark): taken.
        let polls = Cell::new(0);
        let v = submit_verdict("term-2", working(10), Duration::from_secs(5), true, || { polls.set(polls.get() + 1); if polls.get() >= 3 { working(11) } else { working(10) } }, || Some("working"), || false);
        assert_eq!((v.receipt, v.submitted), ("turn_began", Some(true)));
        assert!(v.waited_ms < 2000, "answered as soon as the turn began, not after the wait: {} ms", v.waited_ms);
        // Busy, then its own turn ends (a new mark, done) and no new turn begins: not taken, the state named.
        let (polls, st) = (Cell::new(0), Cell::new("working"));
        let act = || { polls.set(polls.get() + 1); if polls.get() >= 2 { st.set("done"); idle(11) } else { working(10) } };
        let v = submit_verdict("term-2", working(10), Duration::from_millis(500), true, act, || Some(st.get()), || false);
        assert_eq!((v.receipt, v.submitted, v.state), ("not_submitted", Some(false), Some("done")), "the old turn's end is not the prompt");
        // Busy, its turn ends, then a new turn begins: taken.
        let (polls, st) = (Cell::new(0), Cell::new("working"));
        let act = || { polls.set(polls.get() + 1); match polls.get() { 0..=1 => working(10), 2 => { st.set("done"); idle(11) } _ => { st.set("working"); working(12) } } };
        let v = submit_verdict("term-2", working(10), Duration::from_secs(5), true, act, || Some(st.get()), || false);
        assert_eq!((v.receipt, v.submitted), ("turn_began", Some(true)));
        // Busy, it asks for permission, then carries on with the same turn: still queued.
        let (polls, st) = (Cell::new(0), Cell::new("working"));
        let act = || { polls.set(polls.get() + 1); match polls.get() { 0..=1 => working(10), 2 => { st.set("permission"); idle(11) } _ => { st.set("working"); working(12) } } };
        let v = submit_verdict("term-2", working(10), Duration::from_millis(600), true, act, || Some(st.get()), || false);
        assert_eq!((v.receipt, v.submitted, v.state), ("queued", Some(false), Some("working")), "the carry-on after a question is the old turn");
        // Idle, then working: taken. Idle and still idle: not submitted, exit 1, the state named.
        let v = submit_verdict("term-2", idle(10), Duration::from_secs(5), false, || working(10), || Some("working"), || false);
        assert_eq!((v.receipt, v.submitted), ("turn_began", Some(true)));
        let v = submit_verdict("term-2", idle(10), Duration::from_millis(200), true, || idle(10), || Some("done"), || true);
        assert_eq!((v.receipt, v.submitted, v.state), ("not_submitted", Some(false), Some("done")));
        let v = submit_verdict("term-2", idle(10), Duration::from_millis(100), true, || idle(10), || Some("permission"), || true);
        assert_eq!((v.receipt, v.state), ("not_submitted", Some("permission")));
        // No hooks report: unknown. The default watch answers at once; an explicit one watches the output.
        let start = Instant::now();
        let v = submit_verdict("term-3", None, Duration::from_secs(3), false, || None, || None, || false);
        assert_eq!((v.receipt, v.submitted, v.state), ("unknown", None, None));
        assert!(start.elapsed() < Duration::from_millis(500));
        assert_eq!(v.warning.as_deref(), Some("no status hooks report for term-3; whether the prompt was taken cannot be told"));
        let v = submit_verdict("term-3", None, Duration::from_millis(300), true, || None, || None, || false);
        assert_eq!(v.warning.as_deref(), Some("no status hooks report for term-3; whether the prompt was taken cannot be told (it wrote nothing within 0 s)"));
        assert!(v.waited_ms >= 300, "the explicit wait watches the output for its whole time: {} ms", v.waited_ms);
        let v = submit_verdict("term-3", None, Duration::from_secs(5), true, || None, || None, || true);
        assert!(v.warning.as_deref().unwrap().contains("it wrote output after Enter"), "{:?}", v.warning);
        assert!(v.waited_ms < 1000);
        // The client turns submitted=false into exit 1 with a sentence naming the state; the rest passes.
        let r = |state: &str| json!({ "requestId": "r", "success": true, "result": { "terminal": "term-2", "submitted": false, "state": state, "waitSubmit": 5, "waitAsked": true, "receipt": "queued" } });
        let f = submit_step(&r("working")).unwrap_err();
        assert_eq!((f.code, f.message.as_str()), ("not_submitted", "term-2 did not submit the prompt within 5 s (it is working; the prompt waits behind its turn)"));
        assert_eq!(f.data["receipt"], "queued", "the answer travels as the error's data");
        assert_eq!(submit_step(&r("done")).unwrap_err().message, "term-2 did not submit the prompt within 5 s (it is idle, so Enter may have been lost)");
        assert_eq!(submit_step(&r("permission")).unwrap_err().message, "term-2 did not submit the prompt within 5 s (it is waiting for permission; answer that first)");
        assert!(submit_step(&json!({ "success": true, "result": { "terminal": "term-2", "submitted": true } })).is_ok());
        assert!(submit_step(&json!({ "success": true, "result": { "terminal": "term-2", "submitted": null, "receipt": "unknown" } })).is_ok(), "unknown is not a failure");
        assert!(submit_step(&json!({ "success": true, "result": { "terminal": "term-1", "delivered": ["enter"] } })).is_ok(), "a plain send has no verdict");
    }

    /// MERGE 49 (council FIX-BEFORE on T-188): a plain send --text --enter to a busy agent answers
    /// queued at once with exit 0, as it did before T-188; an idle agent that does not start a turn
    /// within the default watch is a warning, exit 0. Only an explicit --wait-submit makes a prompt
    /// that did not submit exit 1. --wait-submit 0 is a usage error.
    #[test]
    fn merge49_plain_send_to_a_busy_agent_is_queued_at_once_and_exits_0() {
        let working = |m: u64| Some(((m, 1usize), true));
        let start = Instant::now();
        let v = submit_verdict("term-2", working(10), SUBMIT_WATCH, false, || working(10), || Some("working"), || true);
        assert!(start.elapsed() < Duration::from_millis(500), "a plain send must not wait: {:?}", start.elapsed());
        assert_eq!((v.receipt, v.submitted, v.state, v.waited_ms), ("queued", Some(false), Some("working"), 0));
        assert_eq!(v.warning.as_deref(), Some("term-2 is working; the prompt waits behind its turn (--wait-submit <seconds> watches for it to be taken)"));
        // The client: submitted=false without the asked flag passes (exit 0); with it, exit 1.
        let plain = json!({ "success": true, "result": { "terminal": "term-2", "submitted": false, "state": "working", "waitSubmit": 3, "waitAsked": false, "receipt": "queued" } });
        assert!(submit_step(&plain).is_ok(), "a plain send is never a failure");
        let idle_plain = json!({ "success": true, "result": { "terminal": "term-2", "submitted": false, "state": "done", "waitSubmit": 3, "waitAsked": false, "receipt": "not_submitted" } });
        assert!(submit_step(&idle_plain).is_ok());
        let mut asked = plain.clone();
        asked["result"]["waitAsked"] = json!(true);
        assert_eq!(submit_step(&asked).unwrap_err().code, "not_submitted");
        // An explicit wait on the same busy agent still watches the whole wait.
        let start = Instant::now();
        let v = submit_verdict("term-2", working(10), Duration::from_millis(300), true, || working(10), || Some("working"), || true);
        assert!(start.elapsed() >= Duration::from_millis(300) && v.warning.is_none());
        // --wait-submit 0 is refused before sending; 1 is fine.
        let refused = |w: &str| parse(&words(w)).1.unwrap_err();
        let f = refused("terminal send --terminal term-2 --text hi --enter --wait-submit 0");
        assert_eq!((f.code, f.message.as_str()), ("invalid_arguments", WAIT_SUBMIT_RANGE));
        assert!(parse(&words("terminal send --terminal term-2 --text hi --enter --wait-submit 1")).1.is_ok());
    }

    /// T-596 (R01-cli.5): an oversized --wait-submit is refused by the command line and by the app,
    /// and the watch itself never overflows the clock (a panic there ended the whole app: panic = abort).
    #[test]
    fn t596_an_oversized_wait_submit_is_refused_and_never_ends_the_app() {
        let huge = u64::MAX.to_string();
        let line = |w: &str| words(&format!("terminal send --terminal term-2 --text hi --enter --wait-submit {w}"));
        for w in [huge.as_str(), "301"] {
            let f = parse(&line(w)).1.unwrap_err();
            assert_eq!((f.code, f.message.as_str()), ("invalid_arguments", WAIT_SUBMIT_RANGE), "--wait-submit {w}");
        }
        assert!(parse(&line("300")).1.is_ok());
        assert!(WAIT_SUBMIT_RANGE.contains(&WAIT_SUBMIT_MAX.to_string()));
        // The app refuses it too, whichever client sent it, before anything is typed.
        let dir = std::env::temp_dir().join(format!("kolux-rs-t596w-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let args = json!({ "terminal": "term-2", "text": "hi", "enter": true, "waitSubmit": huge });
        let req = Request { id: "r".into(), token: String::new(), command: "terminal.send".into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let f = dispatch(&ctx, &req).unwrap_err();
        assert_eq!((f.code, f.message.as_str()), ("invalid_arguments", WAIT_SUBMIT_RANGE));
        // The watch: u64::MAX seconds once panicked with "overflow when adding duration to instant".
        let v = submit_verdict("term-2", None, Duration::from_secs(u64::MAX), true, || None, || None, || true);
        assert_eq!(v.receipt, "unknown");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row193_reset_on_an_unread_mail_is_refused_before_it_clears_anything() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row193-reset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let broken = "{\"runs\": [{\"id\": \"run-1\"}], \"messages\": [tru";
        {
            let s = store.lock().unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-1" })]).unwrap();
            save_list(&s, DISPATCHES_KEY, &[json!({ "id": "d-1" })]).unwrap();
            s.set("orchestration.mail", broken).unwrap();
        }
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        for scope in SCOPES {
            let mut args = serde_json::Map::new();
            args.insert(scope.to_string(), json!(true));
            let err = dispatch(&ctx, &req("orchestration.reset", Value::Object(args))).unwrap_err();
            assert!(err.message.contains("orchestration.mail") && err.message.contains("nothing was saved over it"), "{scope}: {}", err.message);
            let s = store.lock().unwrap();
            assert_eq!((load_list(&s, TASKS_KEY).unwrap().len(), load_list(&s, DISPATCHES_KEY).unwrap().len()), (1, 1), "{scope}: the lists were not cleared");
            assert_eq!(s.get("orchestration.mail").unwrap().as_deref(), Some(broken), "{scope}: the mail blob is byte-identical");
        }
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row877_mutating_mail_commands_on_an_unread_mail_are_refused_before_saving_anything() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row877-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let broken = "{\"runs\": [{\"id\": \"run-1\"}], \"messages\": [tru";
        {
            let s = store.lock().unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-1", "status": "ready" })]).unwrap();
            save_list(&s, DISPATCHES_KEY, &[json!({ "id": "d-1" })]).unwrap();
            s.set("orchestration.mail", broken).unwrap();
        }
        let (tasks_before, dispatches_before) = {
            let s = store.lock().unwrap();
            (s.get(TASKS_KEY).unwrap(), s.get(DISPATCHES_KEY).unwrap())
        };
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        for (command, args) in [
            ("orchestration.task-create", json!({ "spec": "new work" })),
            ("orchestration.task-update", json!({ "id": "task-1", "status": "blocked" })),
            ("orchestration.worker-start", json!({ "spec": "x", "terminal": "term-9", "worktree": "current" })),
            ("orchestration.run-create", json!({ "objective": "ship" })),
            ("orchestration.dispatch", json!({ "task": "task-1", "to": "term-9" })),
        ] {
            let err = dispatch(&ctx, &req(command, args)).unwrap_err();
            assert!(err.message.contains("orchestration.mail") && err.message.contains("nothing was saved over it"), "{command}: {}", err.message);
            let s = store.lock().unwrap();
            assert_eq!((s.get(TASKS_KEY).unwrap(), s.get(DISPATCHES_KEY).unwrap()), (tasks_before.clone(), dispatches_before.clone()), "{command}: the lists are unchanged");
            assert_eq!(s.get("orchestration.mail").unwrap().as_deref(), Some(broken), "{command}: the mail blob is byte-identical");
        }
        // Card 13b: check acks what it hands out, so it is refused too (it used to answer "no mail").
        let err = dispatch(&ctx, &req("orchestration.check", json!({ "ack": "delivery-1" }))).unwrap_err();
        assert!(err.message.contains("orchestration.mail") && err.message.contains("nothing was saved over it"), "check: {}", err.message);
        // Reads still answer from the empty mail, and change nothing.
        for (command, args) in [("orchestration.task-list", json!({})), ("orchestration.run-list", json!({})), ("orchestration.dispatch", json!({ "task": "task-1", "dryRun": true }))] {
            let err = dispatch(&ctx, &req(command, args)).err();
            assert!(err.is_none_or(|e| !e.message.contains("nothing was saved over it")), "{command} must not be refused for the unread mail");
        }
        let s = store.lock().unwrap();
        assert_eq!(s.get("orchestration.mail").unwrap().as_deref(), Some(broken), "reads left the mail blob alone");
        drop(s);
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card13b_a_send_retry_with_unreadable_receipts_types_nothing_and_a_repaired_one_types_once() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-c13b-send-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        terminals.fake_session(5313, &dir.display().to_string(), None);
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = Request { id: "r".into(), token: String::new(), command: "terminal.send".into(), cwd: dir.display().to_string(), args: json!({ "terminal": "term-5313", "text": "hello", "retryRequest": "r1" }), pane: None, cli: String::new(), arrived: None };
        let broken = "[{\"key\": \"term-5313|r0\", \"at\": 1, \"receipt\": {";
        store.lock().unwrap().set(so::KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        let err = dispatch(&ctx, &req).unwrap_err();
        assert_eq!(err.code, "failed");
        assert_eq!(typed::count(5313), 0, "nothing was typed before the refusal");
        assert_eq!(store.lock().unwrap().get(so::KEY).unwrap().as_deref(), Some(broken), "the receipts blob is byte-identical");
        // Repaired and restarted (row 881: this run refuses to save over the key until then): the same retry types once, then answers from its receipt without typing again.
        let mut restarted = Store::open(&dir.join("data")).unwrap();
        restarted.set(so::KEY, "[]").unwrap();
        std::mem::swap(&mut *store.lock().unwrap(), &mut restarted);
        drop(restarted);
        dispatch(&ctx, &req).unwrap();
        let typed_once = typed::count(5313);
        assert!(typed_once >= 1);
        let again = dispatch(&ctx, &req).unwrap();
        assert_eq!(again["retried"], true);
        assert_eq!(typed::count(5313), typed_once, "a retry of a recorded send types nothing");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Card 13b note 1: a caller that times out and retries while the first send still waits for the
    /// input box must not type a second time; the retry waits for the first send's receipt.
    #[test]
    fn card15_two_sends_with_the_same_retry_request_type_once() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-c15-send-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let terminals = Terminals::default();
        terminals.fake_session(5314, &dir.display().to_string(), None);
        let req = Request { id: "r".into(), token: String::new(), command: "terminal.send".into(), cwd: dir.display().to_string(), args: json!({ "terminal": "term-5314", "text": "hello", "retryRequest": "same" }), pane: None, cli: VERSION.into(), arrived: None };
        let lane = so::lane(5314);
        let held = lane.lock().unwrap();
        let outs = std::thread::scope(|sc| {
            let go = || {
                sc.spawn(|| {
                    let notify = |_: Value| {};
                    let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
                    dispatch(&ctx, &req)
                })
            };
            let (a, b) = (go(), go());
            // Both callers are now past the receipt check (or queued behind the first), waiting for the input box.
            std::thread::sleep(Duration::from_millis(400));
            drop(held);
            [a.join().unwrap().unwrap(), b.join().unwrap().unwrap()]
        });
        assert_eq!(typed::count(5314), 1, "the text went in once");
        assert_eq!(outs.iter().filter(|o| o["retried"] == true).count(), 1, "the other answered from the receipt");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Row 883: the text is already typed when the receipt is saved, so a failed save is a warning, never "failed".
    #[test]
    fn row883_a_receipt_that_cannot_be_saved_after_typing_is_a_warning_and_a_retry_types_nothing() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-r883-send-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        terminals.fake_session(5316, &dir.display().to_string(), None);
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = Request { id: "r".into(), token: String::new(), command: "terminal.send".into(), cwd: dir.display().to_string(), args: json!({ "terminal": "term-5316", "text": "hello", "retryRequest": "r883" }), pane: None, cli: VERSION.into(), arrived: None };
        // The receipts can be read (nothing there yet) but a write to their key is refused, as a full disk would.
        let conn = rusqlite::Connection::open(dir.join("data").join("state.db")).unwrap();
        conn.execute_batch(&format!("CREATE TRIGGER no_sends BEFORE INSERT ON kv WHEN NEW.key = '{k}' BEGIN SELECT RAISE(ABORT, 'disk full'); END; CREATE TRIGGER no_sends_up BEFORE UPDATE ON kv WHEN NEW.key = '{k}' BEGIN SELECT RAISE(ABORT, 'disk full'); END;", k = so::KEY)).unwrap();
        let first = dispatch(&ctx, &req).expect("the text was typed, so the caller is not told it failed");
        assert_eq!(typed::count(5316), 1, "the text went in once");
        assert!(first["retried"].is_null());
        let warnings = first["warnings"].as_array().expect("a warning says the receipt was not saved");
        assert!(warnings.iter().any(|w| w.as_str().is_some_and(|w| w.contains("receipt") && w.contains("not saved"))), "{warnings:?}");
        // Same run, same retry key: nothing more is typed, even though no receipt could be kept.
        let again = dispatch(&ctx, &req).expect("the retry answers");
        assert_eq!(again["retried"], true);
        assert_eq!(typed::count(5316), 1, "a retry of a send whose receipt was not saved types nothing");
        drop(conn);
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hidden_fails_closed_when_the_dispatch_passes_cannot_be_loaded() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-hidden-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        terminals.fake_session(41, &dir.display().to_string(), None);
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = Request { id: "r".into(), token: String::new(), command: "terminal.read".into(), cwd: dir.display().to_string(), args: json!({ "terminal": "term-41" }), pane: None, cli: String::new(), arrived: None };
        // Readable dispatches: the read answers.
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[json!({ "id": "d-1", "pass": "pass-SECRET-123" })]).unwrap();
        assert!(dispatch(&ctx, &req).is_ok());
        // A list that cannot be read or kept aside: the passes are unknown, so the read is refused (no output).
        let broken = "[{\"id\": \"d-1\", \"pass\": \"pass-SECRET-123\"}, tru";
        store.lock().unwrap().set(DISPATCHES_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        let err = dispatch(&ctx, &req).unwrap_err();
        assert!(err.message.contains("can't check for secrets to hide; read refused") && err.message.contains(DISPATCHES_KEY), "{}", err.message);
        assert!(!err.message.contains("pass-SECRET-123") && !err.data.to_string().contains("pass-SECRET-123"), "the error never carries a pass");
        assert_eq!(store.lock().unwrap().get(DISPATCHES_KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_ps_still_answers_when_the_dispatch_list_cannot_be_read() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-ps-unread-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = Request { id: "r".into(), token: String::new(), command: "worktree.ps".into(), cwd: dir.display().to_string(), args: json!({}), pane: None, cli: String::new(), arrived: None };
        let broken = "[{\"id\": \"dispatch-3\"}, ";
        store.lock().unwrap().set(DISPATCHES_KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        let out = dispatch(&ctx, &req).unwrap();
        assert_eq!(out["scope"]["workersUnread"], true);
        assert_eq!(store.lock().unwrap().get(DISPATCHES_KEY).unwrap().as_deref(), Some(broken), "ps changed nothing");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row193_a_task_list_that_cannot_be_kept_aside_is_never_saved_over() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row193-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let (broken_tasks, broken_dispatches) = ("[{\"id\": \"task-7\", \"spec\": \"keep me\"}, tru", "[{\"id\": \"dispatch-3\"}, ");
        {
            let s = store.lock().unwrap();
            s.set(TASKS_KEY, broken_tasks).unwrap();
            s.set(DISPATCHES_KEY, broken_dispatches).unwrap();
        }
        crate::orchestration::kept::refuse_copies(&dir.join("data"));
        let s = store.lock().unwrap();
        let (t, d) = (load_list(&s, TASKS_KEY).unwrap_err(), load_list(&s, DISPATCHES_KEY).unwrap_err());
        assert!(t.message.contains(TASKS_KEY) && d.message.contains(DISPATCHES_KEY), "{} / {}", t.message, d.message);
        let mut m = crate::orchestration::Mail::default();
        let made = tasks(&ctx, &s, &mut m, &req("orchestration.task-create", json!({ "spec": "new work" })), Some("term-1"), None).unwrap_err();
        assert!(made.message.contains(TASKS_KEY), "{}", made.message);
        assert_eq!(s.get(TASKS_KEY).unwrap().as_deref(), Some(broken_tasks), "the task list is byte-identical");
        assert_eq!(s.get(DISPATCHES_KEY).unwrap().as_deref(), Some(broken_dispatches), "the dispatch list is byte-identical");
        drop(s);
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tasks_need_a_known_creator_and_a_dry_run_needs_no_recipient() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-dry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        // CLI-034: outside any Kolux terminal there is no creator, so nothing is made.
        let orphan = dispatch(&ctx, &req("orchestration.task-create", json!({ "spec": "add a test" }))).unwrap_err();
        assert_eq!(orphan.code, "unbound_caller");
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-1", "spec": "add a test", "status": "ready", "deps": [] })]).unwrap();
        let plan = dispatch(&ctx, &req("orchestration.dispatch", json!({ "task": "task-1", "dryRun": true }))).unwrap();
        assert_eq!(plan["dryRun"], true);
        assert!(plan["preamble"].as_str().unwrap().ends_with("add a test"), "{}", plan["preamble"]);
        assert_eq!(plan["to"], Value::Null);
        let list = dispatch(&ctx, &req("orchestration.task-list", json!({}))).unwrap();
        assert_eq!(list["tasks"][0]["status"], "ready");
        assert!(load_list(&store.lock().unwrap(), DISPATCHES_KEY).unwrap().is_empty());
        // CLI-035: reusing a terminal that is not open is refused before any task is made.
        let gone = dispatch(&ctx, &req("orchestration.worker-start", json!({ "spec": "x", "terminal": "term-9", "worktree": "current" }))).unwrap_err();
        assert_eq!(gone.code, "not_found", "{}", gone.message);
        assert_eq!(load_list(&store.lock().unwrap(), TASKS_KEY).unwrap().len(), 1);
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_kolux_terminal_reaches_the_app_that_opened_it() {
        let own = data_dir_of(Some("D:\\lane\\app".into()), Some("C:\\roaming".into()));
        assert_eq!(own, PathBuf::from("D:\\lane\\app"));
        let installed = data_dir_of(None, Some("C:\\roaming".into()));
        assert_eq!(installed, PathBuf::from("C:\\roaming").join(DATA_DIR));
        assert_eq!(data_dir_of(Some("".into()), Some("C:\\roaming".into())), installed);
    }

    #[test]
    fn mail_commands_are_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("orchestration send --subject hi --to run:run-1 --type worker_done --outcome succeeded --files-modified a,b --retry-request 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "orchestration.send");
        assert_eq!(p.args["filesModified"], "a,b");
        assert_eq!(p.args["retryRequest"], "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a");
        let (_, p) = parse(&words("orchestration check --wait --timeout-ms 40000 --types status,question"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.args["wait"], true);
        assert_eq!(p.args["timeoutMs"], "40000");
        let (_, p) = parse(&words("orchestration run-use --id run-1 --takeover-legacy"));
        assert_eq!(p.unwrap().unwrap().args["takeoverLegacy"], true);
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration run-create").contains("--objective"));
        assert!(refused("orchestration send --to run:run-1").contains("--subject"));
        assert!(refused("orchestration check --peek --all").contains("one of"));
        // CLI-031: refused here, before the sender is worked out.
        assert!(refused("orchestration send --subject hi --type heartbeat --to @all").contains("never to a group"));
        assert!(refused("orchestration send --subject hi --type worker_done --outcome failed --to @worktree:w1").contains("never to a group"));
        assert!(refused("orchestration send --subject hi --to run:run-1 --task-id t1 --payload {}").contains("not both"));
        assert!(refused("orchestration check --timeout-ms 0").contains("above zero"));
        assert!(refused("orchestration run-list --bogus 1").contains("--bogus"));
        assert!(refused("orchestration run-show").contains("--id"));
        let (_, p) = parse(&words("orchestration dispatch --task task-1 --to term-3 --dry-run --return-preamble"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.command, "orchestration.dispatch");
        assert_eq!((&p.args["dryRun"], &p.args["returnPreamble"]), (&json!(true), &json!(true)));
        let (_, p) = parse(&words("orchestration task-create --spec b --deps [\"task-1\"] --display-name B"));
        assert_eq!(p.unwrap().unwrap().args["displayName"], "B");
        assert_eq!(parse(&words("orchestration inbox --limit 5 --full")).1.unwrap().unwrap().args["full"], true);
        assert!(refused("orchestration reply --id msg-1").contains("--body"));
        assert!(refused("orchestration dispatch --task task-1").contains("--to"));
        assert!(refused("orchestration task-create").contains("--spec"));
        assert!(refused("orchestration dispatch-show").contains("--task"));
        // ORCH-032, ORCH-023: the nesting cap takes whole numbers of 1 or more; abandon names a dispatch.
        assert!(refused("orchestration dispatch --task task-1 --to term-3 --max-depth 0").contains("--max-depth"));
        assert!(refused("orchestration worker-start --spec x --agent claude --max-depth two").contains("--max-depth"));
        assert!(refused("orchestration worker-abandon").contains("--dispatch"));
        assert!(refused("orchestration worker-stop").contains("--dispatch"));
        // ORCH-026, ORCH-025: pages hold 1 to 100 workers; the terminal states are a closed set.
        assert!(refused("orchestration worker-list --limit 101").contains("--limit"));
        assert!(refused("orchestration worker-list --terminal-state kept").contains("--terminal-state"));
        assert!(refused("orchestration worker-retain").contains("--dispatch"));
        let (_, p) = parse(&words("orchestration worker-list --terminal-state reclaimable --limit 100"));
        assert_eq!(p.unwrap().unwrap().args["terminalState"], "reclaimable");
        assert!(refused("orchestration task-update --status completed").contains("--id"));
        assert!(refused("orchestration task-update --id task-1").contains("--status"));
        let (_, p) = parse(&words("orchestration task-update --id task-1 --status completed --result green"));
        let p = p.unwrap().unwrap();
        assert_eq!((p.command.as_str(), p.args["result"].as_str()), ("orchestration.task-update", Some("green")));
        let (_, p) = parse(&words("orchestration worker-abandon --dispatch dispatch-2"));
        assert_eq!(p.unwrap().unwrap().args["dispatch"], "dispatch-2");
        assert!(refused("orchestration task-list --inject").contains("--inject"));
    }

    #[test]
    fn worker_start_is_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("orchestration worker-start --spec=add_a_test --agent claude --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "orchestration.worker-start");
        assert_eq!(p.args["spec"], "add_a_test");
        assert_eq!(p.args["worktree"], "new-top-level");
        assert_eq!(p.args["setup"], "inherit");
        let (_, p) = parse(&words("orchestration worker-start --task task-1 --tier light --worktree current --timeout-ms 5000 --task-title T"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.args["timeoutMs"], "5000");
        assert_eq!(p.args["taskTitle"], "T");
        // ORCH-019: a model alone says who runs it, on the coordinator's own agent.
        let (_, p) = parse(&words("orchestration worker-start --spec x --model opus --effort high"));
        assert_eq!(p.unwrap().unwrap().args["model"], "opus");
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration worker-start --agent claude").contains("--spec"));
        assert!(refused("orchestration worker-start --task t --spec x --agent claude").contains("one of"));
        assert!(refused("orchestration worker-start --spec x").contains("--agent"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree current --base-branch main").contains("--base-branch"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree name:other --name n").contains("--name"));
        assert!(refused("orchestration worker-start --spec x --agent claude --effort high").contains("--model"));
        assert!(refused("orchestration worker-start --spec x --effort high").contains("--effort needs --model"));
        // ORCH-029 / ORCH-028: ask and the gate commands are known and checked before the app is asked.
        assert_eq!(parse(&words("orchestration ask --question hi --options a,b --timeout-ms 1000")).1.unwrap().unwrap().command, "orchestration.ask");
        assert!(refused("orchestration ask").contains("--question"));
        assert!(refused("orchestration ask --question hi --resume msg-1").contains("not both"));
        assert_eq!(parse(&words("orchestration gate-create --task t --question q")).1.unwrap().unwrap().command, "orchestration.gate-create");
        assert_eq!(parse(&words("orchestration gate-resolve --id gate-1 --resolution yes")).1.unwrap().unwrap().command, "orchestration.gate-resolve");
        assert_eq!(parse(&words("orchestration gate-list --status timeout --run run-1")).1.unwrap().unwrap().command, "orchestration.gate-list");
        // ORCH-041: Windows refuses first, then a shell outside Kolux.
        assert!(teams_allowed(true, true).unwrap_err().contains("not supported on Windows"));
        assert!(teams_allowed(false, false).unwrap_err().contains("Kolux terminal"));
        assert!(teams_allowed(false, true).is_ok());
        // ORCH-031: exactly one scope.
        assert_eq!(parse(&words("orchestration reset --tasks")).1.unwrap().unwrap().command, "orchestration.reset");
        assert!(refused("orchestration reset").contains("exactly one"));
        assert!(refused("orchestration reset --tasks --all").contains("exactly one"));
        // ORCH-065: every orchestration command has its line in the help.
        for (name, _, _) in commands().iter().filter(|c| c.0.starts_with("orchestration ")) {
            assert!(HELP.contains(&format!("kolux-dev {name} ")), "{name} has no help line");
        }
        assert!(refused("orchestration worker-start --spec x --tier deep --model opus").contains("tier"));
        assert!(refused("orchestration worker-start --spec x --tier huge").contains("major, deep, build or light"));
        assert!(refused("orchestration worker-start --spec x --terminal t1 --model opus").contains("--terminal"));
        assert!(refused("orchestration worker-start --spec x --agent claude --timeout-ms soon").contains("--timeout-ms"));
        assert!(refused("orchestration worker-start --spec x --agent claude --retry-of d1").contains("--task"));
        // CLI-035 / ORCH-016: a reused terminal needs its worktree named, and not a new one.
        assert!(refused("orchestration worker-start --spec x --terminal term-2").contains("--worktree"));
        assert!(refused("orchestration worker-start --spec x --terminal term-2 --worktree new-child").contains("--worktree"));
        assert!(parse(&words("orchestration worker-start --spec x --terminal term-2 --worktree current")).1.is_ok());
        assert!(parse(&words("orchestration worker-start --spec x --agent claude --deps [task-1,task-2]")).1.is_ok());
        // CLI-034: a dry run needs no recipient.
        assert!(parse(&words("orchestration dispatch --task task-1 --dry-run")).1.is_ok());
        assert!(refused("orchestration dispatch --task task-1").contains("--to"));
        assert!(refused("orchestration worker-start --spec x --agent claude --deps nope").contains("--deps"));
    }

    #[test]
    fn an_app_that_cannot_be_reached_is_met_with_the_open_advice() {
        let down = unreachable_fail("no endpoint file".into());
        assert!(open_first(&down, "worktree.list").unwrap().contains(&format!("{} open", crate::orchestration::CLI)));
        assert!(open_first(&down, "app.open").is_none(), "open itself is not told to run open");
        let mut own = down.clone();
        own.data["hint"] = json!(format!("{} orchestration run-use --id run-1 picks it up again", crate::orchestration::CLI));
        assert!(open_first(&own, "orchestration.send").is_none(), "its own recovery wins");
        assert!(open_first(&Fail::new("failed", "x"), "worktree.list").is_none());
    }

    #[test]
    fn open_starts_the_app_only_when_none_answers_and_gives_up_after_the_limit() {
        use std::cell::Cell;
        let down = || Fail::new("app_unreachable", "down");
        let up = || Ok(json!({ "success": true, "result": { "ready": true, "started": false } }));
        let (grant, raise) = (|| {}, |_: u32| None);
        let launches = Cell::new(0);
        let launch = || {
            launches.set(launches.get() + 1);
            Ok(())
        };
        // Already running: brought forward, nothing started.
        let v = open(&up, &launch, &grant, &raise, Duration::from_secs(5)).unwrap();
        assert_eq!((v["result"]["started"].clone(), launches.get()), (json!(false), 0));
        // Closed: started once, then answers on the third try.
        let tries = Cell::new(0);
        let late = || {
            tries.set(tries.get() + 1);
            if tries.get() < 3 { Err(down()) } else { up() }
        };
        let v = open(&late, &launch, &grant, &raise, Duration::from_secs(5)).unwrap();
        assert_eq!((v["result"]["started"].clone(), launches.get(), tries.get()), (json!(true), 1, 3));
        // Never answers: an error naming the limit, after one start.
        let e = open(&|| Err(down()), &launch, &grant, &raise, Duration::ZERO).unwrap_err();
        assert!(e.message.contains("did not answer within 0 s") && launches.get() == 2, "{}", e.message);
        // Another failure is reported as it is, without starting anything.
        let e = open(&|| Err(Fail::new("unauthorized", "stale")), &launch, &grant, &raise, Duration::ZERO).unwrap_err();
        assert_eq!((e.code, launches.get()), ("unauthorized", 2));
    }

    #[test]
    fn brow051_an_http_shaped_request_gets_no_reply_and_runs_nothing() {
        use std::io::Read;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        assert!(listener.local_addr().unwrap().ip().is_loopback());
        let port = listener.local_addr().unwrap().port();
        let ran = Arc::new(AtomicBool::new(false));
        let seen = ran.clone();
        std::thread::spawn(move || serve_loop(listener, "secret", "rt-1", move |_| { seen.store(true, Ordering::SeqCst); Ok(json!({})) }));
        // What a web page's fetch or form post looks like on the wire: dropped without a byte back.
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(b"POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://evil.example\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let mut reply = String::new();
        let _ = s.read_to_string(&mut reply);
        assert_eq!(reply, "", "no reply, not even an error envelope");
        assert!(!ran.load(Ordering::SeqCst), "nothing ran");
        // The real client on the same listener still works afterwards.
        let req = Request { id: "r2".into(), token: "secret".into(), command: "x".into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None };
        assert_eq!(call(port, &req).unwrap()["success"], true);
        assert!(ran.load(Ordering::SeqCst));
    }

    #[test]
    fn a_start_repeated_while_the_first_runs_joins_it() {
        let key = "orchestration.worker-start|7|C:/repo|{\"spec\":\"join test\"}";
        let mid = std::cell::Cell::new(None);
        let first = join_running(key, None, || {
            mid.set(Some(Instant::now()));
            Ok(json!({ "dispatchId": "dispatch-1" }))
        })
        .unwrap();
        assert_eq!(first["dispatchId"], "dispatch-1");
        assert!(first.get("joined").is_none());
        // Sent while the first was under way: it gets the first one's receipt, no second worker.
        let again = join_running(key, mid.get(), || panic!("a repeat of a start under way must not start a second worker")).unwrap();
        assert_eq!(again["dispatchId"], "dispatch-1");
        assert_eq!(again["joined"], true);
        // A failure is joined too, with the same error.
        let bad = "orchestration.worker-start|7|C:/repo|{\"task\":\"task-9\"}";
        let mid = std::cell::Cell::new(None);
        let _ = join_running(bad, None, || {
            mid.set(Some(Instant::now()));
            Err(Fail::new("failed", "task-9 already has a worker (dispatch-3)"))
        });
        assert_eq!(join_running(bad, mid.get(), || panic!("joined")).unwrap_err().message, "task-9 already has a worker (dispatch-3)");
        // Sent after the first finished, or with other flags, or not over the port: a start of its own.
        let later = join_running(key, Some(Instant::now()), || Ok(json!({ "dispatchId": "dispatch-2" }))).unwrap();
        assert_eq!(later["dispatchId"], "dispatch-2");
        let other = join_running("orchestration.worker-start|7|C:/repo|{\"spec\":\"other\"}", mid.get(), || Ok(json!({ "dispatchId": "dispatch-4" }))).unwrap();
        assert_eq!(other["dispatchId"], "dispatch-4");
    }

    #[test]
    fn requests_cross_the_loopback_port_with_the_token() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "secret", "rt-1", |req| Ok(json!({ "echo": req.args, "arrived": req.arrived.is_some() }))));
        let req = Request { id: "r1".into(), token: "secret".into(), command: "x".into(), cwd: String::new(), args: json!({ "a": 1 }), pane: None, cli: String::new(), arrived: None };
        let v = call(port, &req).unwrap();
        assert_eq!(v["success"], true);
        assert_eq!(v["requestId"], "r1");
        assert_eq!(v["result"]["echo"]["a"], 1);
        assert_eq!(v["result"]["arrived"], true, "the app stamps when it took the connection");
        assert_eq!(v["meta"]["runtimeId"], "rt-1");
        let bad = Request { token: "wrong".into(), ..req.clone() };
        let v = call(port, &bad).unwrap();
        assert_eq!(v["success"], false);
        assert_eq!(v["error"]["code"], "unauthorized");
        // CLI-038: every answer says the app's version, and a change from a newer CLI is turned away.
        assert_eq!(v["meta"]["appVersion"], VERSION);
        let future = Request { command: SEND.into(), cli: "999.0.0".into(), ..req.clone() };
        assert_eq!(call(port, &future).unwrap()["error"]["code"], "version_gap");
        let same = Request { command: SEND.into(), cli: VERSION.into(), ..req.clone() };
        assert_eq!(call(port, &same).unwrap()["success"], true);
        let asking = Request { command: CHECK.into(), cli: "999.0.0".into(), ..req };
        assert_eq!(call(port, &asking).unwrap()["success"], true);
    }

    #[test]
    fn an_app_that_does_not_know_a_command_is_a_version_gap_and_a_lost_answer_is_not_app_down() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        // An older app: it has never heard of the command and does not say its version.
        std::thread::spawn(move || {
            for (n, s) in listener.incoming().flatten().enumerate() {
                let mut s = s;
                let mut line = String::new();
                BufReader::new(&s).read_line(&mut line).unwrap();
                let id = serde_json::from_str::<Value>(&line).unwrap()["id"].as_str().unwrap().to_string();
                if n == 0 {
                    let out = json!({ "requestId": id, "success": false, "error": { "code": "invalid_arguments", "message": "unknown command orchestration.reset" }, "meta": { "runtimeId": "old" } });
                    writeln!(s, "{out}").unwrap();
                }
                // The second request: the app reads it and closes without answering.
            }
        });
        let req = Request { id: "r1".into(), token: "t".into(), command: "orchestration.reset".into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None };
        let v = call(port, &req).unwrap();
        assert_eq!(v["error"]["code"], "version_gap", "{v}");
        assert!(v["error"]["message"].as_str().unwrap().contains("Update Kolux"), "{v}");
        let e = call(port, &req).unwrap_err();
        assert_eq!(e.code, "lost_result", "{}", e.message);
        // Nothing listening is the one case that means the app is down, with the command that opens it.
        let closed = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        let down = call(closed, &req).unwrap_err();
        assert_eq!(down.code, "app_unreachable");
        assert!(down.message.contains(&format!("{} open", crate::orchestration::CLI)), "{}", down.message);
    }

    #[test]
    fn retry_ids_are_uuids_and_lost_quotes_are_spotted() {
        let id = uuid();
        assert!(is_uuid(&id), "{id}");
        assert_eq!(&id[14..15], "4");
        assert_ne!(uuid(), id);
        assert!(!is_uuid("r1") && !is_uuid("1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633g") && !is_uuid("1b4e28ba2fa1-4d3b-a3f5-ef19b5a7633a-"));
        assert!(newer("0.2.0", "0.1.9") && newer("1.0.0", "0.99.0") && !newer("0.1.0", "0.1.0") && !newer("", "0.1.0"));
        assert!(quotes_lost("{files:[a,b]}") && quotes_lost("[a,b]") && !quotes_lost(r#"{"a":1}"#) && !quotes_lost("{}"));
        assert_eq!(retype(&words("orchestration send --body two words")), "orchestration send --body two words");
        assert_eq!(retype(&["--body".into(), "two words".into(), "it's".into()]), "--body 'two words' 'it''s'");

        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration task-create --spec x --retry-request r1").contains("UUID"));
        assert!(refused("orchestration request-show").contains("--request"));
        assert!(refused("orchestration request-show --request abc").contains("UUID"));
        assert!(refused("orchestration reset").contains("exactly one scope"));
        assert!(refused("orchestration reset --tasks --messages").contains("exactly one scope"));
        assert!(refused("orchestration send --to run:r --subject s --payload {files:[a,b]}").contains("PowerShell 5.1"));
        assert!(refused("orchestration send --to run:r --subject s --payload nope").contains("takes JSON"));
        let p = parse(&words("orchestration reset --messages")).1.unwrap().unwrap();
        assert_eq!((p.command.as_str(), &p.args["messages"]), ("orchestration.reset", &json!(true)));
        let p = parse(&words(&format!("orchestration request-show --request {id}"))).1.unwrap().unwrap();
        assert_eq!(p.args["request"], id.as_str());
    }

    #[test]
    fn a_lost_change_can_be_looked_up_and_each_scope_reset_on_its_own() {
        use crate::orchestration::Mail;
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli038-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let done = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a";
        let sent = "2b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a";
        {
            let s = store.lock().unwrap();
            let mut m = Mail::load(&s);
            m.answers.insert(format!("orchestration.task-create||{done}"), json!({ "id": "task-1" }));
            m.answers.insert(format!("orchestration.send||{sent}"), json!({ "messageIds": ["m1"] }));
            m.save(&s).unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-1" })]).unwrap();
            save_list(&s, DISPATCHES_KEY, &[json!({ "id": "d-1" })]).unwrap();
        }
        let show = |id: &str| dispatch(&ctx, &req("orchestration.request-show", json!({ "request": id }))).unwrap();
        let v = show(done);
        assert_eq!((&v["state"], &v["command"], &v["result"]["id"]), (&json!("completed"), &json!("orchestration.task-create"), &json!("task-1")), "{v}");
        assert!(text_of("orchestration.request-show", &v).contains("took effect"));
        assert_eq!(show("3b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a")["state"], "absent");

        let v = dispatch(&ctx, &req("orchestration.reset", json!({ "tasks": true }))).unwrap();
        assert_eq!((&v["tasks"], &v["dispatches"], &v["messages"]), (&json!(1), &json!(1), &json!(0)), "{v}");
        assert!(load_list(&store.lock().unwrap(), TASKS_KEY).unwrap().is_empty() && load_list(&store.lock().unwrap(), DISPATCHES_KEY).unwrap().is_empty());
        assert_eq!(show(done)["state"], "absent");
        assert_eq!(show(sent)["state"], "completed", "a tasks reset leaves the messages' answers");
        let said = text_of("orchestration.reset", &v);
        assert!(said.starts_with("cleared tasks") && said.ends_with("the tasks, workers and gates went; Runs and mail are kept"), "{said}");
        let v = dispatch(&ctx, &req("orchestration.reset", json!({ "messages": true }))).unwrap();
        assert!(text_of("orchestration.reset", &v).ends_with("the mail and delivery positions went; Runs and tasks are kept"));
        assert!(text_of("orchestration.reset", &json!({ "scope": "all", "tasks": 0, "dispatches": 0, "messages": 0, "runs": 0 })).ends_with("everything went; ids keep counting up"));
        assert_eq!(show(sent)["state"], "absent");
        let e = dispatch(&ctx, &req("orchestration.reset", json!({}))).unwrap_err();
        assert!(e.message.contains("exactly one scope"));
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn git(args: &[&str], cwd: &Path) {
        let out = Command::new("git").args(args).current_dir(cwd).output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    /// T-596 (CLI-017, R01-cli.8): a project whose folder is gone (deleted, or on a drive that is
    /// offline; APP-051 keeps it registered) no longer empties `worktree list`: the other projects
    /// are listed and the missing one is named, in JSON and in the text.
    #[test]
    fn cli017_worktree_list_lists_what_it_can_and_names_a_project_whose_folder_is_gone() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t596-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (kept, gone) = (dir.join("kept"), dir.join("gone"));
        for r in [&kept, &gone] {
            std::fs::create_dir_all(r).unwrap();
            git(&["init", "-q", "-b", "main"], r);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], r);
        }
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        for r in [&kept, &gone] {
            projects::add_project(&git_, &store.lock().unwrap(), r).unwrap();
        }
        std::fs::remove_dir_all(&gone).unwrap();
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = Request { id: "r".into(), token: String::new(), command: "worktree.list".into(), cwd: dir.display().to_string(), args: json!({}), pane: None, cli: String::new(), arrived: None };
        let list = dispatch(&ctx, &req).expect("one missing project folder must not fail the whole listing");
        let rows = list["worktrees"].as_array().unwrap();
        assert_eq!(rows.len(), 1, "{list}");
        assert!(Path::new(rows[0]["path"].as_str().unwrap()).ends_with("kept"), "{list}");
        let missing = list["unreadable"].as_array().unwrap();
        assert_eq!((missing.len(), missing[0]["repo"].as_str()), (1, Some("gone")), "{list}");
        assert!(!missing[0]["error"].as_str().unwrap().is_empty());
        let text = text_of("worktree.list", &list);
        assert!(text.contains("kept") && text.contains("gone: not listed"), "{text}");
        // --repo naming the gone project itself still fails, as before T-596: only the full listing tolerates it.
        let one = Request { args: json!({ "repo": "name:gone" }), ..req.clone() };
        assert!(dispatch(&ctx, &one).is_err(), "--repo on a missing folder must still fail");
        let kept_only = dispatch(&ctx, &Request { args: json!({ "repo": "name:kept" }), ..req.clone() }).unwrap();
        assert_eq!(kept_only["worktrees"].as_array().unwrap().len(), 1, "{kept_only}");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repos_projects_and_worktrees_are_listed_and_picked_by_selector() {
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let (_, p) = parse(&words("repo search-refs --repo name:x --query de --limit 5"));
        assert_eq!(p.unwrap().unwrap().command, "repo.search-refs");
        assert!(refused("repo set-base-ref --repo name:x").contains("--ref"));
        assert!(refused("repo add").contains("--path"));
        assert!(refused("worktree list --limit 0").contains("above zero"));
        assert!(refused("worktree current --worktree name:a").contains("unknown flag"));
        assert_eq!(parse(&words("worktree current --usage")).1.unwrap().unwrap().args["usage"], true);
        assert_eq!(parse(&words("worktree show --worktree name:a --usage")).1.unwrap().unwrap().args["usage"], true);

        let dir = std::env::temp_dir().join(format!("kolux-rs-cli117-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        let other = dir.join("other");
        for r in [&repo, &other] {
            std::fs::create_dir_all(r).unwrap();
            git(&["init", "-q", "-b", "main"], r);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], r);
        }
        git(&["branch", "develop"], &repo);
        git(&["checkout", "-q", "develop"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "on develop"], &repo);
        git(&["checkout", "-q", "main"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new(), arrived: None };

        // CLI-015: a relative path counts from the folder the command ran in.
        let added = dispatch(&ctx, &req("repo.add", &dir, json!({ "path": "other" }))).unwrap();
        assert_eq!(added["name"], "other");
        let repos = dispatch(&ctx, &req("repo.list", &dir, json!({}))).unwrap();
        assert_eq!(repos["repos"].as_array().unwrap().len(), 2);
        // CLI-016: the projects the app shows.
        let listed = dispatch(&ctx, &req("project.list", &dir, json!({}))).unwrap();
        assert_eq!(listed["projects"].as_array().unwrap().len(), 2);
        let id = repos["repos"].as_array().unwrap().iter().find(|r| r["name"] == "repo").unwrap()["id"].as_str().unwrap().to_string();
        let shown = dispatch(&ctx, &req("repo.show", &dir, json!({ "repo": format!("id:{id}") }))).unwrap();
        assert_eq!(shown["name"], "repo");
        let refs = dispatch(&ctx, &req("repo.search-refs", &repo, json!({ "query": "DEV" }))).unwrap();
        assert_eq!(refs["refs"], json!([{ "name": "develop", "kind": "branch" }]));
        assert!(dispatch(&ctx, &req("repo.set-base-ref", &repo, json!({ "ref": "nope" }))).unwrap_err().message.contains("nope"));
        dispatch(&ctx, &req("repo.set-base-ref", &repo, json!({ "repo": "name:repo", "ref": "develop" }))).unwrap();
        let made = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "same", "issue": "7" }))).unwrap();
        let develop = Command::new("git").args(["rev-parse", "develop"]).current_dir(&repo).output().unwrap();
        assert_eq!(made["head"], String::from_utf8_lossy(&develop.stdout).trim(), "the new worktree starts from the new base");
        let path = PathBuf::from(made["path"].as_str().unwrap());
        dispatch(&ctx, &req("worktree.create", &other, json!({ "name": "same" }))).unwrap();

        // CLI-017: one repo's worktrees, with lineage and the hosts covered.
        let list = dispatch(&ctx, &req("worktree.list", &dir, json!({ "repo": "name:repo" }))).unwrap();
        let rows = list["worktrees"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r["repoId"] == json!(id)));
        assert_eq!(rows[0]["children"], json!([made["path"]]));
        assert_eq!(list["hosts"], json!({ "covered": ["local"], "leftOut": [] }));
        let capped = dispatch(&ctx, &req("worktree.list", &dir, json!({ "limit": "1" }))).unwrap();
        assert_eq!((capped["worktrees"].as_array().unwrap().len(), &capped["truncated"]), (1, &json!(true)));

        // CLI-009: current and active mean the worktree around the folder; issue: finds the link.
        let inner = path.join("src");
        std::fs::create_dir_all(&inner).unwrap();
        for sel in [None, Some("active")] {
            let args = sel.map(|s| json!({ "worktree": s })).unwrap_or(json!({}));
            let cmd = if sel.is_some() { "worktree.show" } else { "worktree.current" };
            assert_eq!(dispatch(&ctx, &req(cmd, &inner, args)).unwrap()["path"], made["path"]);
        }
        assert_eq!(dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "issue:7" }))).unwrap()["path"], made["path"]);
        let wid = rows[1]["id"].as_str().unwrap().to_string();
        for form in [format!("id:{wid}"), format!("identity:{wid}")] {
            assert_eq!(dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": form }))).unwrap()["path"], made["path"]);
        }
        // USAGE-016: --usage adds what the worktree's sessions used; with tracking off nothing is read.
        let plain = dispatch(&ctx, &req("worktree.current", &inner, json!({}))).unwrap();
        assert!(plain.get("usage").is_none(), "only asked for");
        let used = dispatch(&ctx, &req("worktree.current", &inner, json!({ "usage": true }))).unwrap();
        assert_eq!((&used["usage"]["claude"], &used["usage"]["codex"]), (&json!({ "tracked": false }), &json!({ "tracked": false })));
        assert!(query_text("worktree.current", &used).unwrap().contains("tokens claude: not tracked"));
        let outside = dispatch(&ctx, &req("worktree.current", &dir, json!({}))).unwrap_err();
        assert!(outside.data["hint"].as_str().unwrap().contains("--worktree"), "{:?}", outside.data);
        let bare = dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "42" }))).unwrap_err();
        assert_eq!(bare.code, "invalid_arguments");
        assert!(bare.message.contains("\"42\"") && bare.message.contains("name:") && bare.message.contains("path:"), "{}", bare.message);
        assert!(dispatch(&ctx, &req("repo.show", &dir, json!({ "repo": "repo" }))).unwrap_err().message.contains("id:"));
        let twice = dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "name:same" }))).unwrap_err();
        assert_eq!(twice.code, "ambiguous");
        // ps: no Kolux terminal is open in a test.
        assert_eq!(dispatch(&ctx, &req("worktree.ps", &dir, json!({}))).unwrap()["worktrees"], json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cli019_worktree_set_renames_links_comments_and_moves_a_worktree() {
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("worktree set --worktree name:a --no-parent --parent-worktree name:b").contains("disagree"));
        assert!(refused("worktree set --worktree name:a --parent-worktree").contains("needs a value"));
        assert!(refused("worktree set --worktree name:a --issue seven").contains("null"));
        assert!(refused("worktree set --worktree name:a --issue 0").contains("null"));
        let blank = ["worktree", "set", "--worktree", "name:a", "--display-name", ""].map(String::from);
        assert!(parse(&blank).1.unwrap_err().message.contains("cannot be empty"));
        assert!(refused("worktree set --worktree name:a").contains("nothing to set"));
        assert!(refused("worktree set --worktree name:a --workspace-status").contains("needs a value"));
        let (_, ok) = parse(&words("worktree set --worktree name:a --workspace-status in-review"));
        assert_eq!(ok.unwrap().unwrap().args["workspaceStatus"], json!("in-review"));
        let (_, p) = parse(&words("worktree set --worktree active --issue null --display-name Login --no-parent"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.command, "worktree.set");
        assert_eq!((&p.args["issue"], &p.args["displayName"], &p.args["noParent"]), (&json!("null"), &json!("Login"), &json!(true)));

        let dir = std::env::temp_dir().join(format!("kolux-rs-cli019-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let seen = Mutex::new(Vec::<Value>::new());
        let notify = |v: Value| seen.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let a = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "a", "issue": "7", "comment": "first" }))).unwrap();
        let b = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "b" }))).unwrap();
        let a_path = PathBuf::from(a["path"].as_str().unwrap());
        seen.lock().unwrap().clear();

        // active: the worktree around the folder; --issue null drops the link and keeps the rest
        let set = dispatch(&ctx, &req("worktree.set", &a_path.join("."), json!({ "worktree": "active", "issue": "null" }))).unwrap();
        assert_eq!((&set["path"], &set["number"], &set["comment"]), (&a["path"], &Value::Null, &json!("first")));
        assert!(dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": "issue:7" }))).is_err(), "the link is gone");
        assert_eq!(seen.lock().unwrap().last().unwrap()["kind"], "changed", "the window is told to redraw");

        // a new name, issue, comment and parent in one call
        let set = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": "name:a", "displayName": "Login page", "issue": "12", "comment": "second", "parentWorktree": "name:b" }))).unwrap();
        assert_eq!((&set["name"], &set["number"], &set["comment"], &set["parent"]), (&json!("Login page"), &json!(12), &json!("second"), &b["path"]));
        let shown = dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": "issue:12" }))).unwrap();
        assert_eq!(shown["path"], a["path"]);
        let text = text_of("worktree.set", &set);
        assert!(text.contains("Login page") && text.contains("linked #12") && text.contains("second"), "{text}");

        // a loop is refused and nothing else in the call is written
        let e = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": "name:b", "parentWorktree": "name:Login page", "comment": "x" }))).unwrap_err();
        assert!(e.message.contains("loop"), "{}", e.message);
        assert_eq!(dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": "name:b" }))).unwrap()["comment"], Value::Null);

        // the parent taken from the current folder, then removed; an empty comment clears it
        let set = dispatch(&ctx, &req("worktree.set", &a_path, json!({ "worktree": "name:b", "parentWorktree": "current" })));
        assert!(set.unwrap_err().message.contains("loop"), "b cannot sit under a, which sits under b");
        let set = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": "name:Login page", "noParent": true, "comment": "" }))).unwrap();
        assert_eq!((&set["parent"], &set["comment"], &set["number"]), (&Value::Null, &Value::Null, &json!(12)));
        let set = dispatch(&ctx, &req("worktree.set", &a_path, json!({ "worktree": "name:b", "parentWorktree": "current" }))).unwrap();
        assert_eq!(set["parent"], a["path"]);
        let main = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": format!("path:{}", repo.display()), "parentWorktree": "name:b" }))).unwrap_err();
        assert!(main.message.contains("main checkout"), "{}", main.message);

        // T-117-b-b: --workspace-status by id, by label or as "completed"; a wrong one writes nothing
        let status = |s: &str, extra: Value| {
            let mut args = json!({ "worktree": "name:b", "workspaceStatus": s });
            args.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            dispatch(&ctx, &req("worktree.set", &repo, args))
        };
        assert_eq!(status("in-review", json!({})).unwrap()["workspaceStatus"], "in-review");
        assert_eq!(status("In progress", json!({})).unwrap()["workspaceStatus"], "in-progress");
        assert_eq!(status("completed", json!({})).unwrap()["workspaceStatus"], "done");
        let e = status("blocked", json!({ "comment": "y" })).unwrap_err();
        assert!(e.message.contains("no status blocked") && e.message.contains("in-review"), "{}", e.message);
        assert_eq!(dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": "name:b" }))).unwrap()["comment"], Value::Null, "a refused status writes nothing");

        // T-117-b-b: folder:<id> where a parent is expected, from another project; elsewhere it is refused
        let plain = dir.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let folder = crate::folder_projects::add_folder(&store.lock().unwrap(), &plain).unwrap();
        let set = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": "name:b", "parentWorktree": format!("folder:{}", folder.id) }))).unwrap();
        assert!(set["parent"].as_str().is_some_and(|p| p.to_lowercase().ends_with("plain")), "{}", set["parent"]);
        let created = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "c", "parentWorktree": format!("folder:{}", folder.id) }))).unwrap();
        assert!(created["parent"].as_str().is_some_and(|p| p.to_lowercase().ends_with("plain")), "{}", created["parent"]);
        let e = dispatch(&ctx, &req("worktree.set", &repo, json!({ "worktree": "name:b", "parentWorktree": "folder:nope" }))).unwrap_err();
        assert_eq!(e.code, "not_found");
        let e = dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": format!("folder:{}", folder.id) }))).unwrap_err();
        assert!(e.message.contains("only where a parent worktree is expected"), "{}", e.message);

        // T-117-b-b: a /mnt/<drive>/... path from a WSL shell resolves with no distribution
        let win = repo.display().to_string();
        let wsl = format!("/mnt/{}{}", win[..1].to_lowercase(), win[2..].replace('\\', "/"));
        let shown = dispatch(&ctx, &req("worktree.show", &repo, json!({ "worktree": format!("path:{wsl}") }))).unwrap();
        assert_eq!(shown["isMain"], json!(true), "{wsl}");
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_worktree_lists_its_changes_and_the_siblings_that_touch_them() {
        let (_, p) = parse(&words("worktree overlap --worktree name:one --json"));
        assert_eq!(p.unwrap().unwrap().command, "worktree.overlap");
        assert!(parse(&words("worktree changes --repo name:x")).1.unwrap_err().message.contains("unknown flag"));

        let dir = std::env::temp_dir().join(format!("kolux-rs-cli118-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let commit = |cwd: &Path, file: &str, text: &str| {
            std::fs::write(cwd.join(file), text).unwrap();
            git(&["add", "-A"], cwd);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", file], cwd);
        };
        git(&["init", "-q", "-b", "main"], &repo);
        commit(&repo, "a.txt", "base\n");
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let make = |name: &str| PathBuf::from(dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": name }))).unwrap()["path"].as_str().unwrap());
        let (one, two, quiet) = (make("one"), make("two"), make("quiet"));
        commit(&one, "a.txt", "one\n");
        std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
        commit(&two, "a.txt", "two\n");
        commit(&quiet, "q.txt", "elsewhere\n");

        // changes: committed and uncommitted work together, against the base.
        let ch = dispatch(&ctx, &req("worktree.changes", &one, json!({}))).unwrap();
        assert_eq!(ch["base"], "main");
        assert_eq!(ch["files"], json!([{ "path": "a.txt", "status": "M" }, { "path": "new.txt", "status": "U" }]));

        // overlap: the sibling that edits the same file, and a predicted clash on the committed tips.
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({}))).unwrap();
        let sib = ov["siblings"].as_array().unwrap();
        assert_eq!(sib.len(), 1, "{ov}");
        assert!(same_dir(sib[0]["path"].as_str().unwrap(), &two.display().to_string()));
        assert_eq!((&sib[0]["files"], &sib[0]["clash"]), (&json!(["a.txt"]), &json!("conflict")));
        assert_eq!(ov["complete"], true);

        // A sibling with no history in common: the merge cannot be checked, so it is never clean.
        let orphan = dir.join("ws").join("orphan");
        git(&["worktree", "add", "-q", "--orphan", "-b", "orphan", &orphan.display().to_string()], &repo);
        commit(&orphan, "a.txt", "unrelated\n");
        // A sibling whose folder is gone: its changes cannot be read, so the scan is incomplete.
        let gone = make("gone");
        std::fs::remove_dir_all(&gone).unwrap();
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({ "worktree": "name:one" }))).unwrap();
        let un = ov["siblings"].as_array().unwrap().iter().find(|s| s["branch"] == "orphan").cloned().unwrap();
        assert_eq!(un["clash"], "unverifiable", "{un}");
        assert_eq!(ov["complete"], false);
        assert_eq!(ov["unreadable"].as_array().unwrap().len(), 1);
        let text = text_of("worktree.overlap", &ov);
        assert!(text.contains("unverifiable") && text.contains("could not"), "{text}");

        // GIT-068: with a Git older than 2.38 (read once at startup) the clash is unverifiable and
        // merge-tree is not tried, even for the sibling that would conflict.
        let old = Git { version: "git version 2.37.1".into() };
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &old, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({ "worktree": "name:one" }))).unwrap();
        let s2 = ov["siblings"].as_array().unwrap().iter().find(|s| s["branch"] == "two").cloned().unwrap();
        assert_eq!(s2["clash"], "unverifiable", "{s2}");
        assert!(s2["why"].as_str().unwrap().contains("older than 2.38"), "{s2}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T-613b (review of PR #10): `kolux worktree rm` decides the branch as the app's delete does
    /// (`remove_one` with no choice made): a branch holding a commit found on no other branch and no
    /// remote is kept and named; one with nothing of its own still goes.
    #[test]
    fn t613b_worktree_rm_keeps_a_branch_holding_a_commit_found_nowhere_else() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli613b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: repo.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let made = dispatch(&ctx, &req("worktree.create", json!({ "name": "unique", "setup": "skip" }))).unwrap();
        let path = PathBuf::from(made["path"].as_str().unwrap());
        std::fs::write(path.join("work.txt"), "only here").unwrap();
        git(&["add", "."], &path);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "only here"], &path);
        let tip = String::from_utf8(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&path).output().unwrap().stdout).unwrap().trim().to_string();
        let out = dispatch(&ctx, &req("worktree.rm", json!({ "worktree": "name:unique" }))).unwrap();
        assert!(!path.exists(), "the folder went");
        let has = |rev: &str| Command::new("git").args(["rev-parse", "--verify", "--quiet", rev]).current_dir(&repo).output().unwrap().status.success();
        let holders = String::from_utf8(Command::new("git").args(["branch", "--contains", &tip]).current_dir(&repo).output().unwrap().stdout).unwrap_or_default();
        assert!(has("refs/heads/unique") && holders.contains("unique"), "the unique commit survives on its branch: {out}");
        assert_eq!(out["branchKept"], true, "{out}");
        assert!(out["warnings"].as_array().unwrap().iter().any(|w| w.as_str().unwrap().contains("unique") && w.as_str().unwrap().contains("found on no other branch")), "the kept branch is named: {out}");
        // nothing of its own: the branch goes with the folder, as before
        let plain = dispatch(&ctx, &req("worktree.create", json!({ "name": "plain", "setup": "skip" }))).unwrap();
        let out = dispatch(&ctx, &req("worktree.rm", json!({ "worktree": format!("path:{}", plain["path"].as_str().unwrap()) }))).unwrap();
        assert_eq!(out["branchKept"], false, "{out}");
        assert!(!has("refs/heads/plain"));
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_and_remove_a_worktree_from_the_command_line() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let events = Mutex::new(Vec::<Value>::new());
        // T-172-d: the stand-in window answers a worker start's setup request with `answer`.
        let answer = Mutex::new(json!({ "result": "none" }));
        let notify = |v: Value| {
            if let Some(r) = v["setupRequest"].as_str() {
                crate::orchestration::setup_gate::settle(r, answer.lock().unwrap().clone());
            }
            events.lock().unwrap().push(v)
        };
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new(), arrived: None };

        let made = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "cli one", "setup": "skip" }))).unwrap();
        let path = PathBuf::from(made["path"].as_str().unwrap());
        assert!(path.join(".git").exists(), "{}", path.display());
        assert_eq!(made["name"], "cli one");
        assert_eq!(made["branch"], "cli-one");
        assert_eq!(made["agent"], Value::Null, "no prompt, no agent asked: none is picked");
        assert_eq!(made["warnings"], json!([]), "nothing inert was passed");
        assert_eq!(events.lock().unwrap()[0]["kind"], "created");
        // CLI-018 lineage: called from the main checkout, the parent is the main checkout.
        assert_eq!(made["madeBy"], "cli");
        assert_eq!(made["parent"], json!(repo.display().to_string()));
        let child = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "child", "repo": "name:repo", "parentWorktree": "name:cli one", "issue": "12", "comment": "from a test" }))).unwrap();
        assert_eq!(child["parent"], json!(path.display().to_string()));
        assert_eq!(child["issue"], 12);
        assert_eq!(child["comment"], "from a test");
        // EDIT-047: the comment is no longer inert: the worktree palette shows it and finds the worktree by it.
        assert_eq!(child["warnings"], json!([]));
        let child_path = child["path"].as_str().unwrap().to_string();
        {
            let st = store.lock().unwrap();
            let project = projects::load_projects(&st).into_iter().next().unwrap();
            let listed = projects::list_workspaces(&git_, &st, &project).unwrap();
            let row = listed.iter().find(|w| projects::same_folder(Path::new(&w.path), Path::new(&child_path))).unwrap();
            assert_eq!((row.comment.as_deref(), row.number), (Some("from a test"), Some(12)));
        }
        let stored = projects::origin(&store.lock().unwrap(), &child_path).unwrap();
        assert_eq!(stored["parent"], json!(path.display().to_string()));
        assert_eq!(stored["cwd"], json!(dir.display().to_string()));
        assert_eq!(stored["terminal"], Value::Null, "a call from outside Kolux records no terminal");
        assert!(store.lock().unwrap().get("workspaceParents").unwrap().unwrap().contains("child"), "the sidebar nests it (PROJ-047)");
        let inside = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "grandchild" }))).unwrap();
        assert_eq!(inside["parent"], json!(path.display().to_string()), "called from inside cli one");
        let alone = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "alone", "noParent": true }))).unwrap();
        assert_eq!(alone["parent"], Value::Null);
        let from_elsewhere = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "top", "repo": "name:repo", "setup": "run", "runHooks": true, "activate": true }))).unwrap();
        assert_eq!(from_elsewhere["parent"], Value::Null, "called from outside every worktree");
        assert_eq!(from_elsewhere["warnings"], json!([]), "T-107-b: --setup and --run-hooks act now (PROJ-033)");
        let missing = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "parentWorktree": "name:nope" }))).unwrap_err();
        assert_eq!(missing.code, "not_found");
        // T-014-b-fix: the issue: selector finds the worktree made for that issue; the forms with
        // no meaning on the command line are refused with the accepted ones listed. (DT-C12 refused
        // `identity:` and `active` too; T-117-a, CLI-009, defines both, so they are no longer refused
        // and an unknown identity is simply not found.)
        let no_issue = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "issue:99", "force": true }))).unwrap_err();
        assert_eq!(no_issue.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "identity:x", "force": true }))).unwrap_err();
        assert_eq!(unknown.code, "not_found");
        for sel in ["nope:x", "42"] {
            let refused = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": sel, "force": true }))).unwrap_err();
            assert_eq!(refused.code, "invalid_arguments", "{sel}");
            assert!(refused.message.contains("issue:") && refused.message.contains("branch:"), "{sel}: {}", refused.message);
        }
        let by_issue = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "issue:12", "force": true }))).unwrap();
        assert_eq!(by_issue["path"], json!(child_path));
        for n in ["grandchild", "alone"] {
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("name:{n}"), "force": true }))).unwrap();
        }
        let top = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:top", "force": true, "runHooks": true }))).unwrap();
        assert!(top["warnings"][0].as_str().unwrap().starts_with("--run-hooks"), "{}", top["warnings"]);
        assert!(projects::origin(&store.lock().unwrap(), &child_path).is_none(), "the origin goes with the worktree");

        let outside = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "nowhere" }))).unwrap_err();
        assert_eq!(outside.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "agent": "nobody" }))).unwrap_err();
        assert!(unknown.message.contains("nobody"));
        // T-014-b-fix, PROJ-038: a prompt with no --agent goes to the default agent when it is
        // installed, else to the first installed one in catalogue order; none installed is an error.
        let list = crate::agents::agent_list();
        let wanted = list.iter().find(|x| x.id == "claude" && x.installed).or_else(|| list.iter().find(|x| x.installed)).map(|x| x.id.clone());
        let prompted = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "prompted", "prompt": "say hi" })));
        match wanted {
            Some(id) => {
                let made = prompted.unwrap();
                assert_eq!(made["agent"], json!(id));
                let ev = events.lock().unwrap();
                let last = ev.last().unwrap();
                assert_eq!(last["agent"], json!(id));
                assert_eq!(last["prompt"], "say hi");
                drop(ev);
                dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:prompted", "force": true }))).unwrap();
            }
            None => {
                let err = prompted.unwrap_err();
                assert!(err.message.contains("installed"), "{}", err.message);
            }
        }

        std::fs::write(path.join("junk.txt"), "x").unwrap();
        let dirty = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one" }))).unwrap_err();
        assert_eq!(dirty.code, "dirty");
        assert!(path.exists());
        let forced = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one", "force": true }))).unwrap();
        assert!(!path.exists());
        // CLI-020: --force removes the checkout and never the branch.
        assert_eq!(forced["branchKept"], true);
        let branch = format!("refs/heads/{}", forced["branch"].as_str().unwrap());
        assert!(Command::new("git").args(["rev-parse", "--verify", &branch]).current_dir(&repo).output().unwrap().status.success(), "the branch stays");
        assert_eq!(events.lock().unwrap().last().unwrap()["kind"], "removed");

        let two = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "two" }))).unwrap();
        let two_path = PathBuf::from(two["path"].as_str().unwrap());
        assert_eq!(dispatch(&ctx, &req("worktree.rm", &two_path, json!({ "worktree": "current" }))).unwrap()["branchKept"], false, "a plain rm takes the branch it made");
        assert!(!two_path.exists());
        let main = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "current" }))).unwrap_err();
        assert!(main.message.contains("main checkout"));

        // ORCH-016: a worker start makes the task, the worktree and the start event, then waits
        // for the worker's terminal; with no window to open one, the wait runs out.
        let claude_installed = crate::agents::agent_list().iter().any(|a| a.id == "claude" && a.installed);
        // SET-028: the light tier was given Sonnet at low effort in settings, so the worker runs on it.
        store.lock().unwrap().save_settings(&json!({ "modelRouting": { "claude": { "light": { "model": "sonnet", "effort": "low" } } } })).unwrap();
        let start = json!({ "spec": "add a test", "agent": "claude", "tier": "light", "worktree": "new-top-level", "setup": "inherit", "timeoutMs": "1" });
        let out = dispatch(&ctx, &req("orchestration.worker-start", &repo, start.clone())).unwrap_err();
        if claude_installed {
            assert_eq!(out.code, "timeout", "{}", out.message);
            assert_eq!(out.data["dispatchId"], "dispatch-1");
            assert_eq!(out.data["taskId"], "task-1");
            assert_eq!(out.data["model"], "sonnet");
            assert_eq!(out.data["effort"], "low");
            assert_eq!(out.data["setup"], "not_configured");
            assert!(out.data["setupNote"].as_str().is_some_and(|n| n.contains("setup script")), "cli FIX-7: the receipt says what the window does about setup");
            let wt = PathBuf::from(out.data["worktree"]["path"].as_str().unwrap());
            assert!(wt.join(".git").exists());
            // SAFE-023: the new worktree is trusted before the start; the main checkout is not (T-443).
            assert_eq!(out.data["trust"], true, "{}", out.data["trust"]);
            let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join(".claude.json")).unwrap()).unwrap();
            assert_eq!(conf["projects"][crate::trust::claude_key(&wt).unwrap()]["hasTrustDialogAccepted"], true);
            assert!(conf["projects"].get(crate::trust::claude_key(&repo).unwrap()).is_none(), "the main checkout keeps Claude's own prompt");
            let ev = events.lock().unwrap();
            let n = ev.len();
            assert_eq!(ev[n - 2]["kind"], "created");
            assert_eq!(ev[n - 2]["setup"], "inherit", "cli FIX-4: --setup reaches the window");
            assert_eq!(ev[n - 2]["setupRequest"], "dispatch-1", "T-172-d: the window is asked to run the setup and report back");
            assert_eq!(ev[n - 1]["kind"], "start");
            assert_eq!(ev[n - 1]["dispatch"], "dispatch-1", "cli FIX-6: the window is told which dispatch it starts");
            // ORCH-014: the worker gets its brief, the task text last.
            let prompt = ev[n - 1]["prompt"].as_str().unwrap();
            assert!(prompt.contains("--type worker_done") && prompt.contains("--dispatch-id dispatch-1") && prompt.ends_with(&format!("{}\nadd a test", crate::orchestration::DIVIDER)), "{prompt}");
            assert_eq!(ev[n - 1]["extra"], json!(["--model", "sonnet", "--effort", "low"]));
            assert_eq!(ev[n - 1]["path"], out.data["worktree"]["path"]);
            drop(ev);
            let tasks = store.lock().unwrap().get("orchestration.tasks").unwrap().unwrap();
            assert!(tasks.contains("\"dispatched\""), "{tasks}");
            // PROJ-047: a new-child worker called from inside that worktree is listed under it.
            let child = dispatch(&ctx, &req("orchestration.worker-start", &wt, json!({ "spec": "a child", "agent": "claude", "worktree": "new-child", "setup": "skip", "timeoutMs": "1" }))).unwrap_err();
            assert_eq!(child.code, "timeout", "{}", child.message);
            // cli FIX-4 (council AFTER 4): --setup skip reaches the window, which then runs no setup.
            let ev = events.lock().unwrap();
            let n = ev.len();
            assert_eq!((ev[n - 2]["kind"].as_str(), ev[n - 2]["setup"].as_str(), child.data["setup"].as_str()), (Some("created"), Some("skip"), Some("skipped")));
            assert!(child.data["setupNote"].is_null(), "--setup skip has nothing to note");
            drop(ev);
            let child_path = child.data["worktree"]["path"].as_str().unwrap().to_string();
            assert_eq!(child.data["worktree"]["parent"], out.data["worktree"]["path"]);
            let project = projects::load_projects(&store.lock().unwrap()).remove(0);
            let listed = projects::list_workspaces(&git_, &store.lock().unwrap(), &project).unwrap();
            assert_eq!(listed.iter().find(|w| w.path == child_path).unwrap().parent.as_ref(), out.data["worktree"]["path"].as_str().map(String::from).as_ref());
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("path:{child_path}"), "force": true }))).unwrap();
            assert_eq!(store.lock().unwrap().get("workspaceParents").unwrap().unwrap(), "{}", "removing the child forgets its parent");
            let again = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "task": "task-1", "agent": "claude", "worktree": "current", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert!(again.message.contains("already"), "{}", again.message);
            let gone = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "task": "task-9", "agent": "claude", "worktree": "current", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert_eq!(gone.code, "not_found");
            // ORCH-017 (T-172-d): a setup the window reports failed fails the start at the setup
            // stage with its exit code; no agent is started and the task can be started again.
            *answer.lock().unwrap() = json!({ "result": "ran", "exitCode": 3 });
            let before = events.lock().unwrap().len();
            let bad = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "spec": "setup fails", "agent": "claude", "worktree": "new-top-level", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert_eq!((bad.code, bad.data["stage"].as_str(), bad.data["setup"]["exitCode"].as_i64()), ("failed", Some("setup"), Some(3)), "{}", bad.message);
            assert!(bad.message.contains("exit code 3"), "{}", bad.message);
            assert!(events.lock().unwrap()[before..].iter().all(|e| e["kind"] != "start"), "no agent starts after a failed setup");
            let task = bad.data["taskId"].as_str().unwrap().to_string();
            let tasks = load_list(&store.lock().unwrap(), TASKS_KEY).unwrap();
            assert_eq!(tasks.iter().find(|t| t["id"] == task.as_str()).unwrap()["status"], "failed");
            assert!(bad.data["next"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains(&format!("worker-start --task {task}"))), "{}", bad.data["next"]);
            let made = bad.data["worktree"]["path"].as_str().unwrap().to_string();
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("path:{made}"), "force": true }))).unwrap();
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("path:{}", wt.display()), "force": true }))).unwrap();
        } else {
            assert!(out.message.contains("not installed"));
        }
        let handle = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "spec": "x", "terminal": "t1", "worktree": "current", "setup": "inherit" }))).unwrap_err();
        assert_eq!(handle.code, "not_found");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn worktree_ps_sums_up_workers_and_keeps_the_last_list_when_a_scan_fails() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli129-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: repo.display().to_string(), args, pane: None, cli: VERSION.into(), arrived: None };
        let mut open = Vec::new();
        for n in ["a", "b", "c", "d"] {
            let made = dispatch(&ctx, &req("worktree.create", json!({ "name": n, "setup": "skip" }))).unwrap();
            open.push(json!({ "id": format!("d-{n}"), "runId": "run-1", "taskId": format!("t-{n}"), "status": "running", "worktree": made["path"], "agent": "claude" }));
        }
        open.push(json!({ "id": "d-old", "taskId": "t-old", "status": "completed", "worktree": open[0]["worktree"], "agent": "claude" }));
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &open).unwrap();

        // ORCH-040: one row per worktree with its workers, a row cap and a scope line.
        let ps = dispatch(&ctx, &req("worktree.ps", json!({ "limit": "3" }))).unwrap();
        let rows = ps["worktrees"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(ps["truncated"], true);
        assert_eq!(rows[0]["workers"].as_array().unwrap().len(), 1, "a finished dispatch is not counted: {}", rows[0]);
        assert_eq!(ps["scope"]["worktrees"], 5);
        assert_eq!(ps["scope"]["shown"], 4);
        assert_eq!(ps["scope"]["repos"][0]["scan"], "scanned");
        let text = query_text("worktree.ps", &ps).unwrap();
        assert!(text.contains("worker d-") && text.contains("scope: 1 repo, 5 worktrees, 4 with work"), "{text}");
        // An immediate repeat reuses the scan instead of running git again.
        let again = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(again["scope"]["repos"][0]["scan"], "cached");

        // A repeated JSON poll from the same terminal gets a tiny answer when nothing changed.
        let poll = |json_: bool| Request { pane: Some(Pane { handle: "term-1".into(), key: "k1".into() }), ..req("worktree.ps", json!({ "json": json_ })) };
        let first = dispatch(&ctx, &poll(true)).unwrap();
        assert!(first["worktrees"].is_array() && first["snapshot"].is_string());
        let second = dispatch(&ctx, &poll(true)).unwrap();
        assert_eq!(second["unchanged"], true);
        assert_eq!(second["snapshot"], first["snapshot"]);
        assert!(second.get("worktrees").is_none());
        assert!(dispatch(&ctx, &poll(false)).unwrap()["worktrees"].is_array(), "text output is always the full list");

        // Break the repo: the last list stays, marked degraded, and the failure is remembered.
        std::thread::sleep(SCAN_FRESH + Duration::from_millis(100));
        std::fs::rename(repo.join(".git"), dir.join("git-aside")).unwrap();
        let broken = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(broken["worktrees"].as_array().unwrap().len(), 4, "{broken}");
        assert_eq!(broken["worktrees"][0]["degraded"], true);
        assert_eq!(broken["scope"]["repos"][0]["scan"], "degraded");
        assert!(broken["scope"]["repos"][0]["error"].is_string());
        assert!(query_text("worktree.ps", &broken).unwrap().contains("last known"));
        let polled = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(polled["scope"]["repos"][0]["scan"], "degraded");
        assert_eq!(polled["scope"]["repos"][0]["cached"], true, "the failure is remembered: {}", polled["scope"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mail_reads_as_a_banner() {
        let msgs = vec![
            json!({ "id": "msg-3", "from": "term-2", "fromAgent": "Claude Code", "type": "status", "priority": "urgent", "subject": "stop", "body": "halt now", "payload": { "n": 1 }, "reply": "kolux orchestration reply --id msg-3 --body x" }),
            json!({ "id": "msg-4", "from": "term-5", "type": "question", "priority": "normal", "subject": "which?", "body": "", "reply": "kolux orchestration reply --id msg-4 --body y" }),
            json!({ "id": "msg-5", "from": "term-3", "type": "worker_done", "priority": "normal", "subject": "done", "body": "", "outcome": "succeeded", "filesModified": ["a.rs", "b.rs"], "reportPath": "notes/r.md" }),
        ];
        let mut out = Vec::new();
        mail_lines(&msgs, &mut out);
        let text = out.join("\n");
        assert!(text.contains("[URGENT]") && text.contains("Claude Code (term-2)") && text.contains("payload: {\"n\":1}"), "{text}");
        assert!(text.contains("--id msg-3") && text.contains("from term-5") && !text.contains("[NORMAL]"), "{text}");
        assert!(text.contains("  outcome: succeeded") && text.contains("  files: a.rs, b.rs") && text.contains("  report: notes/r.md"), "{text}");
        assert_eq!(out.iter().filter(|l| l.starts_with("----")).count(), 3, "each message ends with its own divider");
    }

    #[test]
    fn a_worker_whose_terminal_dies_mid_task_escalates_once_to_its_run() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli172-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("data")).unwrap();
        let mut mail = crate::orchestration::Mail::default();
        let run = mail.run_create("term-1", "ship it", 1)["binding"]["runId"].as_str().unwrap().to_string();
        let me = u64::from(std::process::id());
        let tasks = vec![json!({ "id": "task-1", "title": "Fix the login page", "status": "dispatched" }), json!({ "id": "task-2", "status": "dispatched" }), json!({ "id": "task-3", "title": "Done already", "status": "dispatched" })];
        let ds = vec![
            json!({ "id": "dispatch-1", "runtime": me, "runId": run, "taskId": "task-1", "status": "ready", "terminal": 7, "worktree": "w1" }),
            json!({ "id": "dispatch-2", "runtime": me, "runId": run, "taskId": "task-2", "status": "ready", "terminal": 8, "worktree": "w2" }),
            json!({ "id": "dispatch-3", "runtime": me, "runId": run, "taskId": "task-3", "status": "ready", "terminal": 9, "worktree": "w3" }),
            json!({ "id": "dispatch-old", "runtime": me + 1, "runId": run, "taskId": "task-1", "status": "ready", "terminal": 7, "worktree": "w1" }),
        ];
        save_list(&store, TASKS_KEY, &tasks).unwrap();
        save_list(&store, DISPATCHES_KEY, &ds).unwrap();
        mail.send(&crate::terminal::handle_of(9), &json!({ "to": format!("run:{run}"), "subject": "done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-3" }), &ds, &|_| true, 2).unwrap();
        mail.save(&store).unwrap();

        // The terminal ends by itself: one escalation to the Run, named by the task title.
        let sent = worker_exited(&store, 7, Some(1), 5).unwrap();
        assert_eq!(sent["dispatchId"], "dispatch-1");
        assert!(worker_exited(&store, 7, Some(1), 6).is_none(), "one escalation per worker exit");
        // No title: the task id. A worker that already reported done, or an unknown terminal: nothing.
        worker_exited(&store, 8, None, 7).unwrap();
        assert!(worker_exited(&store, 9, Some(0), 8).is_none());
        assert!(worker_exited(&store, 42, Some(0), 8).is_none());

        let mail = crate::orchestration::Mail::load(&store);
        let esc: Vec<_> = mail.messages.iter().filter(|x| x.kind == "escalation").collect();
        assert_eq!(esc.len(), 2);
        assert_eq!((esc[0].to.clone(), esc[0].priority.as_str()), (format!("run:{run}"), "high"));
        assert!(esc[0].subject.contains("Fix the login page"), "{}", esc[0].subject);
        assert!(esc[0].body.contains("exit code 1") && esc[0].body.contains("worker-stop --dispatch dispatch-1` then `kolux-dev orchestration worker-start --task task-1"), "{}", esc[0].body);
        assert!(esc[1].subject.contains("task-2"), "{}", esc[1].subject);
        let after = load_list(&store, DISPATCHES_KEY).unwrap();
        assert!(after[0]["exitedAt"].is_u64() && after[3]["exitedAt"].is_null(), "an earlier start's dispatch on the same number is left alone");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn request_show_reads_the_ledger_and_a_worker_start_retry_never_starts_twice() {
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration request-show").contains("--request"));
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli173-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let show = |id: &str| dispatch(&ctx, &req("orchestration.request-show", json!({ "request": id }))).unwrap();
        assert_eq!(show("never-sent")["state"], "absent");
        {
            let s = store.lock().unwrap();
            let mut m = crate::orchestration::Mail::load(&s);
            m.finish("orchestration.worker-start||w1", Some(json!({ "dispatchId": "dispatch-7", "status": "ready" })));
            m.finish("orchestration.worker-start||w2", Some(json!({ "timedOut": { "message": "the worker did not come up", "data": { "dispatchId": "dispatch-8" } } })));
            m.begin("orchestration.worker-start||w3", u64::from(std::process::id()) + 1).unwrap();
            m.save(&s).unwrap();
        }
        assert_eq!((show("w1")["state"].as_str(), show("w1")["command"].as_str()), (Some("completed"), Some(WORKER_START)));
        assert_eq!(show("w3")["interrupted"], true);
        // The same id hands back the first start's receipt, or its timeout, and starts nothing.
        let again = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w1" }))).unwrap();
        assert_eq!(again["dispatchId"], "dispatch-7");
        let late = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w2" }))).unwrap_err();
        assert_eq!((late.code, late.data["dispatchId"].as_str()), ("timeout", Some("dispatch-8")));
        // A start left pending by an earlier run of Kolux runs fresh; turned away, it leaves no receipt.
        let fresh = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w3" }))).unwrap_err();
        assert!(fresh.message.contains("no-such-agent"), "{}", fresh.message);
        assert_eq!(show("w3")["state"], "absent");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T-595 (CLI-011, R01-cli.4): `kolux open` run inside a worktree starts the app in the app's own
    /// folder, so Windows can still delete or rename that worktree and nothing planted there is loaded.
    #[test]
    fn cli011_open_starts_the_app_in_its_own_folder_not_the_callers() {
        let app = std::env::temp_dir().join("kolux-t595-app").join(if cfg!(windows) { "kolux-rs.exe" } else { "kolux-rs" });
        let cmd = app_command(&app);
        assert_eq!(cmd.get_current_dir(), app.parent());
        assert_ne!(cmd.get_current_dir(), Some(std::env::current_dir().unwrap().as_path()), "the caller's folder");
        assert_eq!(cmd.get_args().count(), 0);
        // A relative program (a test's KOLUX_APP_EXECUTABLE) keeps the caller's folder: moving would change the file it names.
        assert_eq!(app_command(Path::new("kolux-rs")).get_current_dir(), None);
    }

    /// CLI-011 box 2: every `app.open` asks the window forward, exactly once, and answers ready
    /// without a start; a window that cannot come forward fails the request instead of claiming it did.
    #[test]
    fn cli011_box2_app_open_asks_the_window_forward() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli011-front-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let fronts = AtomicUsize::new(0);
        let front = || {
            fronts.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        let req = || Request { id: "o".into(), token: String::new(), command: "app.open".into(), cwd: dir.display().to_string(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None };
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &front };
        let r = dispatch(&ctx, &req()).unwrap();
        assert_eq!(fronts.load(Ordering::SeqCst), 1, "asked forward once");
        assert_eq!((r["ready"].clone(), r["started"].clone(), r["pid"].clone()), (json!(true), json!(false), json!(std::process::id())));
        // Asked again while already in front: it is asked forward again, not only the first time.
        dispatch(&ctx, &req()).unwrap();
        assert_eq!(fronts.load(Ordering::SeqCst), 2);
        // The window cannot come forward: the request fails and never answers ready.
        let gone = || Err("the Kolux window is gone".to_string());
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &gone };
        let e = dispatch(&ctx, &req()).unwrap_err();
        assert_eq!((e.code, e.message.as_str()), ("failed", "the Kolux window is gone"));
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CLI-011 box 2: `kolux open` lets the running copy take the foreground before asking it, and
    /// after the answer raises its window itself and reports whether it is in front (`raised`).
    #[test]
    fn cli011_open_grants_the_foreground_before_asking_and_says_whether_the_window_came_forward() {
        use std::cell::{Cell, RefCell};
        let log = RefCell::new(Vec::<String>::new());
        let note = |s: String| log.borrow_mut().push(s);
        let up = |pid: u32| Ok(json!({ "success": true, "result": { "ready": true, "started": false, "pid": pid } }));
        let send = || {
            note("ask".into());
            up(4242)
        };
        let launch = || {
            note("launch".into());
            Ok(())
        };
        let grant = || note("grant".into());
        let raise = |pid: u32| {
            note(format!("raise {pid}"));
            Some(true)
        };
        // Already running: the grant comes first, then the ask, then the raise of the pid it answered with.
        let v = open(&send, &launch, &grant, &raise, Duration::from_secs(5)).unwrap();
        assert_eq!(log.borrow().as_slice(), ["grant", "ask", "raise 4242"]);
        assert_eq!((v["result"]["started"].clone(), v["result"]["raised"].clone()), (json!(false), json!(true)));
        // Windows kept another window in front: the answer says so.
        let refused = |_: u32| Some(false);
        assert_eq!(open(&send, &launch, &grant, &refused, Duration::from_secs(5)).unwrap()["result"]["raised"], json!(false));
        // A platform that cannot tell leaves the question open rather than answering it.
        let unknown = |_: u32| None;
        assert_eq!(open(&send, &launch, &grant, &unknown, Duration::from_secs(5)).unwrap()["result"]["raised"], Value::Null);
        // Closed: started, and the new copy's window raised by the pid in its answer.
        log.borrow_mut().clear();
        let tries = Cell::new(0);
        let late = || {
            tries.set(tries.get() + 1);
            note("ask".into());
            if tries.get() < 2 { Err(Fail::new("app_unreachable", "down")) } else { up(7) }
        };
        let v = open(&late, &launch, &grant, &raise, Duration::from_secs(5)).unwrap();
        assert_eq!(log.borrow().as_slice(), ["grant", "ask", "launch", "ask", "raise 7"]);
        assert_eq!((v["result"]["started"].clone(), v["result"]["raised"].clone()), (json!(true), json!(true)));
        // An answer naming no pid raises nothing and says nothing about the front.
        log.borrow_mut().clear();
        let no_pid = || {
            note("ask".into());
            Ok(json!({ "success": true, "result": { "ready": true, "started": false } }))
        };
        let v = open(&no_pid, &launch, &grant, &raise, Duration::from_secs(5)).unwrap();
        assert_eq!(log.borrow().as_slice(), ["grant", "ask"]);
        assert_eq!(v["result"]["raised"], Value::Null);
        // A refusal that is not "unreachable" is reported as it is, with no raise after it.
        log.borrow_mut().clear();
        let e = open(&|| Err(Fail::new("unauthorized", "stale")), &launch, &grant, &raise, Duration::ZERO).unwrap_err();
        assert_eq!(e.code, "unauthorized");
        assert_eq!(log.borrow().as_slice(), ["grant"]);
    }

    /// CLI-011 box 2: the readable answer says "in front" only when the window really came forward.
    #[test]
    fn cli011_open_text_says_when_windows_kept_another_window_in_front() {
        let t = |r: Value| text_of("app.open", &r);
        assert_eq!(t(json!({ "ready": true, "started": false, "pid": 1, "raised": true })), "Kolux is ready; its window is in front");
        assert_eq!(t(json!({ "ready": true, "started": false, "pid": 1, "raised": false })), "Kolux is ready; its window was restored, but Windows kept another window in front");
        assert_eq!(t(json!({ "ready": true, "started": false, "pid": 1, "raised": null })), "Kolux is ready; its window is in front");
        assert_eq!(t(json!({ "ready": true, "started": true, "pid": 1, "raised": false })), "Kolux started and is ready");
    }

    /// CLI-012: the four states of `kolux status`, met at the real edges: no startup file, a file
    /// whose port nothing listens on any more, an app still reading its workspaces, and one ready.
    #[test]
    fn cli012_status_tells_running_not_running_stale_and_graph_not_ready_apart() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli012-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ask = |port: u16, token: &str| ask_status(port, token, "s1", "");
        // App closed: no startup file.
        let r = status_of(&dir, &ask);
        assert_eq!(r["state"], "not-running");
        assert_eq!(status_exit(&r), 1);
        assert!(status_line(&r).contains("not running"), "{}", status_line(&r));
        // Killed hard: the file stays behind and nothing listens on its port.
        let gone = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let dead = gone.local_addr().unwrap().port();
        drop(gone);
        std::fs::write(dir.join(FILE), json!({ "port": dead, "token": "t", "pid": 4242 }).to_string()).unwrap();
        let r = status_of(&dir, &ask);
        assert_eq!((r["state"].as_str(), r["pid"].as_u64()), (Some("stale"), Some(4242)));
        assert_eq!(status_exit(&r), 1);
        assert!(status_line(&r).contains("4242"), "{}", status_line(&r));
        // A half-written file is stale too, not a crash.
        std::fs::write(dir.join(FILE), "{").unwrap();
        assert_eq!(status_of(&dir, &ask)["state"], "stale");
        // Up: a real listener answering the status question, first while the graph loads, then ready.
        let ready = std::sync::Arc::new(AtomicBool::new(false));
        let flag = ready.clone();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "tok", "rt-1", move |req| if req.command == STATUS { Ok(status_answer(&flag)) } else { Err(Fail::args("unknown command")) }));
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "tok", "pid": 7 }).to_string()).unwrap();
        let r = status_of(&dir, &ask);
        assert_eq!((r["state"].as_str(), r["graphReady"].as_bool()), (Some("graph-not-ready"), Some(false)));
        assert_eq!(status_exit(&r), 1);
        ready.store(true, Ordering::SeqCst);
        let r = status_of(&dir, &ask);
        assert_eq!((r["state"].as_str(), r["pid"].as_u64(), r["version"].as_str()), (Some("running"), Some(u64::from(std::process::id())), Some(VERSION)));
        assert_eq!(status_exit(&r), 0);
        // A token from another run: the file outlived the app that wrote it.
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "old", "pid": 7 }).to_string()).unwrap();
        assert_eq!(status_of(&dir, &ask)["state"], "stale");
        // Each of the four names has its own line, and the word parses with --json.
        let lines: std::collections::BTreeSet<String> = STATES.iter().map(|s| status_line(&json!({ "state": s, "pid": 1 }))).collect();
        assert_eq!(lines.len(), 4);
        let p = parse(&words("status --json"));
        assert_eq!((p.0, p.1.unwrap().unwrap().command), (true, STATUS.to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CLI-012 (T-076-b): the app answers one request at a time, so while a long one runs the status
    /// question is taken but not answered. A listener that accepts and never replies stands in for
    /// that: `status` comes back within its own short wait, not `call`'s 300 s, and says running,
    /// busy with another request, with the pid the startup file names.
    #[test]
    fn cli012_status_answers_within_its_short_wait_while_the_app_is_busy() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli012b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        // Takes every connection and holds it open without ever writing a byte back.
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                held.push(stream);
            }
        });
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "tok", "pid": 4343 }).to_string()).unwrap();
        let ask = |port: u16, token: &str| ask_status(port, token, "s2", "");
        let started = Instant::now();
        let r = status_of(&dir, &ask);
        let took = started.elapsed();
        assert!(took < Duration::from_secs(5), "status took {took:?}, longer than its short wait allows");
        assert!(took >= STATUS_WAIT, "status gave up before its wait ran out: {took:?}");
        assert_eq!((r["state"].as_str(), r["detail"].as_str(), r["pid"].as_u64()), (Some("running"), Some(STATUS_BUSY), Some(4343)));
        assert_eq!(status_exit(&r), 0);
        let line = status_line(&r);
        assert!(line.starts_with("running:") && line.contains(STATUS_BUSY) && line.contains("4343"), "{line}");
        // The general request path keeps its long wait: only the status question is impatient.
        assert_eq!(CALL_WAIT, Duration::from_secs(300));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CLI-012 (T-076-c): while a long request runs, the status question is answered at once (not
    /// after the 2.5 s wait) and says what runs and for how long, in text and JSON; the state stays
    /// running, exit 0. A status question with a stale token is not answered from the side. Once
    /// the request ends the reading has no busy part.
    #[test]
    fn t076c_status_while_busy_says_what_runs_and_for_how_long() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t076c-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (go, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let answer = || json!({ "pid": 4545, "version": VERSION, "graphReady": true });
        std::thread::spawn(move || {
            serve_loop_with(listener, "tok", "rt-1", answer, move |req| {
                if req.command == "worktree.create" {
                    let _ = wait.lock().unwrap().recv();
                }
                Ok(answer())
            })
        });
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "tok", "pid": 4545 }).to_string()).unwrap();
        let long = Request { id: "r1".into(), token: "tok".into(), command: "worktree.create".into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None };
        let slow = std::thread::spawn(move || call(port, &long));
        let ask = |port: u16, token: &str| ask_status(port, token, "s3", "");
        // cli FIX-3 (f): wait on the condition, not a fixed sleep, so a loaded PC cannot flake it:
        // first until the app has begun the long request, then a little over the 1.2 s it is read at.
        let until = |what: &str, done: &dyn Fn(&Value) -> bool| {
            let end = Instant::now() + Duration::from_secs(20);
            loop {
                let r = status_of(&dir, &ask);
                if done(&r) {
                    return;
                }
                assert!(Instant::now() < end, "{what} within 20 s: {r}");
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        until("the long request begun", &|r| r["busyCommand"] == "worktree.create");
        std::thread::sleep(Duration::from_millis(1300));
        let started = Instant::now();
        let r = status_of(&dir, &ask);
        assert!(started.elapsed() < Duration::from_millis(1500), "answered at once, not after the wait: {:?}", started.elapsed());
        assert_eq!((r["state"].as_str(), r["detail"].as_str(), r["busyCommand"].as_str()), (Some("running"), Some(STATUS_BUSY), Some("worktree.create")));
        let ms = r["busyMs"].as_u64().unwrap();
        assert!((1200..10_000).contains(&ms), "running {ms} ms");
        assert_eq!(status_exit(&r), 0);
        assert_eq!(status_line(&r), format!("running: Kolux is up, busy with another request for {} (worktree.create) (pid 4545)", span(ms)));
        // A stale token is not answered from the side: it waits its turn, so status gives up busy.
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "old", "pid": 4545 }).to_string()).unwrap();
        let r = status_of(&dir, &ask);
        assert_eq!((r["detail"].as_str(), r["busyMs"].is_null()), (Some(STATUS_BUSY), true));
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "tok", "pid": 4545 }).to_string()).unwrap();
        go.send(()).unwrap();
        assert_eq!(slow.join().unwrap().unwrap()["success"], true);
        // The stale-token question queued behind it is answered next; wait until the queue is clear.
        until("the queue cleared", &|r| r["detail"].is_null());
        let r = status_of(&dir, &ask);
        assert_eq!((r["state"].as_str(), r["detail"].is_null(), r["busyMs"].is_null()), (Some("running"), true, true));
        assert_eq!(status_line(&r), "running: Kolux is up and ready (pid 4545)");
        assert_eq!((span(4_000), span(192_500), span(3_900_000)), ("4 s".to_string(), "3 min 12 s".to_string(), "1 h 5 min".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-1 (council FIX-SOON on T-076-c): a local client that connects and never writes holds
    /// the accept thread only briefly, so a status question behind it still gets the side answer
    /// (what runs, for how long) within its own short wait. A request waiting behind the running one
    /// is counted, and in the gap between two requests (nothing runs, the queue is not empty) status
    /// still reads busy with the next one instead of being queued.
    #[test]
    fn fix1_status_answers_past_a_silent_client_and_counts_the_queue() {
        assert!(ACCEPT_READ + Duration::from_millis(500) <= STATUS_WAIT, "the accept read must end well inside the status wait");
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix1-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (go, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let answer = || json!({ "pid": 4646, "version": VERSION, "graphReady": true });
        std::thread::spawn(move || {
            serve_loop_with(listener, "tok", "rt-1", answer, move |req| {
                if req.command == "worktree.create" {
                    let _ = wait.lock().unwrap().recv();
                }
                Ok(answer())
            })
        });
        std::fs::write(dir.join(FILE), json!({ "port": port, "token": "tok", "pid": 4646 }).to_string()).unwrap();
        let req = |id: &str, command: &str| Request { id: id.into(), token: "tok".into(), command: command.into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None };
        let long = req("r1", "worktree.create");
        let slow = std::thread::spawn(move || call(port, &long));
        std::thread::sleep(Duration::from_millis(300));
        // A request queued behind the long one.
        let next = req("r2", "ps");
        let queued = std::thread::spawn(move || call(port, &next));
        std::thread::sleep(Duration::from_millis(300));
        // A silent local client: connects, writes nothing, stays open.
        let silent = TcpStream::connect(("127.0.0.1", port)).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let ask = |port: u16, token: &str| ask_status(port, token, "s4", "");
        let r = status_of(&dir, &ask);
        assert_eq!((r["detail"].as_str(), r["busyCommand"].as_str(), r["busyQueued"].as_u64()), (Some(STATUS_BUSY), Some("worktree.create"), Some(1)), "{r}");
        let line = status_line(&r);
        assert!(line.contains("(worktree.create), 1 more waiting (pid 4646)"), "{line}");
        drop(silent);
        go.send(()).unwrap();
        assert_eq!(slow.join().unwrap().unwrap()["success"], true);
        assert_eq!(queued.join().unwrap().unwrap()["success"], true);
        // The gap between two requests: nothing runs, one waits. Status reads busy with it.
        let current: Current = std::sync::Arc::default();
        let status_line_in = json!({ "id": "s5", "token": "tok", "command": STATUS, "cwd": "", "args": {}, "cli": VERSION }).to_string();
        assert!(busy_status(&status_line_in, "tok", "rt-1", &current, &answer).is_none(), "idle: the question goes to the queue");
        current.lock().unwrap().waiting.push_back(("worktree.create".into(), Instant::now() - Duration::from_millis(400)));
        let reply: Value = serde_json::from_str(&busy_status(&status_line_in, "tok", "rt-1", &current, &answer).expect("busy while the queue is not empty")).unwrap();
        assert_eq!((reply["result"]["busy"]["command"].as_str(), reply["result"]["busy"]["queued"].as_u64()), (Some("worktree.create"), Some(0)));
        assert!(reply["result"]["busy"]["runningMs"].as_u64().unwrap() >= 400);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-2 (council FB B1 on the orchestration re-review): the retry a failed worker start
    /// offers, `worker-start --retry-of <dispatch> --task <task>`, can be run as given. The task is
    /// still dispatched to that start, so without --retry-of it is refused as before; with it the
    /// old dispatch is abandoned and marked retried, once its terminal is gone. An open terminal is
    /// sent to worker-stop first; a dispatch of another task, a newer worker, an unknown dispatch
    /// and a completed task are refused by name. After worker-stop (task back to ready) the retry
    /// runs too and the stopped dispatch keeps its state.
    #[test]
    fn fix2_retry_of_re_arms_the_task_a_failed_start_left_dispatched() {
        let me = u64::from(std::process::id());
        let task = |status: &str, d: &str| vec![json!({ "id": "task-1", "status": status, "dispatchId": d }), json!({ "id": "task-2", "status": "dispatched", "dispatchId": "dispatch-2" })];
        let rows = |terminal: Value, runtime: u64, status: &str| vec![json!({ "id": "dispatch-1", "taskId": "task-1", "status": status, "terminal": terminal, "runtime": runtime }), json!({ "id": "dispatch-2", "taskId": "task-2", "status": "running" })];
        let none = |_: &str| false;
        let open = |h: &str| h == "term-7";
        let claim = |tasks: &[Value], ds: &mut Vec<Value>, retry: Option<&str>, live: &dyn Fn(&str) -> bool| claim_task(tasks, ds, 0, retry, "dispatch-3", live);
        // No --retry-of: a dispatched task is refused, as before.
        let tasks = task("dispatched", "dispatch-1");
        let mut ds = rows(Value::Null, me, "unknown");
        assert_eq!(claim(&tasks, &mut ds, None, &none).unwrap_err().message, "task-1 already has a worker (dispatch-1)");
        // The start never got a terminal: the retry re-arms the task.
        claim(&tasks, &mut ds, Some("dispatch-1"), &none).unwrap();
        assert_eq!((ds[0]["status"].as_str(), ds[0]["retriedBy"].as_str()), (Some("abandoned"), Some("dispatch-3")));
        // Its terminal is still open: stop it first.
        let mut ds = rows(json!(7), me, "unknown");
        let e = claim(&tasks, &mut ds, Some("dispatch-1"), &open).unwrap_err();
        assert_eq!(e.code, "dispatch_active");
        assert!(e.message.contains("term-7") && e.message.contains("orchestration worker-stop --dispatch dispatch-1"), "{}", e.message);
        assert_eq!(ds[0]["status"], "unknown", "a refused retry changes nothing");
        // A terminal number stamped by an earlier run of the app is no one's: gone.
        let mut ds = rows(json!(7), me + 1, "unknown");
        claim(&tasks, &mut ds, Some("dispatch-1"), &open).unwrap();
        // Refused by name: another task's dispatch, an unknown dispatch, a newer worker, a completed task.
        let mut ds = rows(Value::Null, me, "unknown");
        assert!(claim(&tasks, &mut ds, Some("dispatch-2"), &none).unwrap_err().message.contains("dispatch-2 worked on task-2, not task-1"));
        assert_eq!(claim(&tasks, &mut ds, Some("dispatch-9"), &none).unwrap_err().code, "not_found");
        let newer = task("dispatched", "dispatch-4");
        assert!(claim(&newer, &mut ds, Some("dispatch-1"), &none).unwrap_err().message.contains("newer worker (dispatch-4)"));
        assert_eq!(claim(&task("completed", "dispatch-1"), &mut ds, Some("dispatch-1"), &none).unwrap_err().message, "task-1 is already completed");
        // In order: worker-stop put the task back to ready, then the retry runs; stopped stays stopped.
        let mut ds = rows(json!(7), me, "stopped");
        claim(&task("ready", "dispatch-1"), &mut ds, Some("dispatch-1"), &none).unwrap();
        assert_eq!((ds[0]["status"].as_str(), ds[0]["retriedBy"].as_str()), (Some("stopped"), Some("dispatch-3")));
        // The flag parses with --task and the help names it.
        let p = parse(&words("orchestration worker-start --task task-1 --retry-of dispatch-1 --agent claude")).1.unwrap().unwrap();
        assert_eq!(p.args["retryOf"], "dispatch-1");
        assert!(HELP.contains("[--retry-of <dispatch>]"));
    }

    /// cli FIX-2 (council S3): a worker-start dispatch row carries the wall-clock time it was made
    /// (not the milliseconds the start waited), so the stale check can read it, and this app's pid.
    #[test]
    fn fix2_a_worker_start_row_carries_wall_clock_time() {
        let row = worker_row(json!({ "id": "dispatch-1", "taskId": "task-1" }));
        let made = row["created"].as_u64().unwrap();
        assert!(made >= 1_000_000_000_000, "created {made} is not a wall-clock time");
        assert!(now_ms().abs_diff(made) < 10_000, "created {made} is not now");
        assert_eq!((row["runtime"].as_u64(), row["id"].as_str()), (Some(u64::from(std::process::id())), Some("dispatch-1")));
    }

    /// cli FIX-2 (council FS3, FS5, FS6 on T-089-c): worker-release saves the pending mark before
    /// it reads or closes anything, so the store already says pending when the terminal is killed;
    /// the archive of a terminal that outgrew its log opens with the dropped-lines line; a read that
    /// fails closes nothing and leaves the release unknown with its retry; worker-show is a read,
    /// so another Run may be named for it.
    #[test]
    fn fix2_worker_release_saves_pending_before_the_kill() {
        use std::cell::RefCell;
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix2r-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let me = u64::from(std::process::id());
        let rows = || vec![json!({ "id": "dispatch-1", "taskId": "task-1", "status": "completed", "terminal": 5, "runtime": me })];
        let live = |h: &str| h == "term-5";
        let stored: RefCell<Vec<Value>> = RefCell::new(Vec::new());
        let save = |r: &[Value]| {
            *stored.borrow_mut() = r.to_vec();
            Ok(())
        };
        let read = |_: u32| {
            let mut log = crate::terminal::OutputLog::default();
            for i in 1..=crate::terminal::LOG_LINES + 3 {
                log.push(format!("line {i}\n").as_bytes());
            }
            Some(log.read(None, None))
        };
        let pending_at_kill = RefCell::new(None);
        let kill = |_: u32| {
            *pending_at_kill.borrow_mut() = stored.borrow().first().map(|d| d["release"].clone());
            true
        };
        let mut ds = rows();
        let r = release_worker(&mut ds, "dispatch-1", None, &live, &|_| None, &dir, &save, &read, &kill).unwrap();
        assert_eq!(*pending_at_kill.borrow(), Some(json!("pending")), "the pending mark was saved before the kill");
        assert_eq!(r["terminalState"], "released", "{r}");
        let text = std::fs::read_to_string(r["archive"].as_str().unwrap()).unwrap();
        assert!(text.starts_with("[Kolux: the first 3 lines of this terminal's output were no longer kept; the archive starts at line 4]\nline 4\n"), "{}", &text[..120]);
        // A read that fails: nothing is closed, the release is unknown and says how to retry.
        let mut ds = rows();
        let killed = RefCell::new(false);
        let r = release_worker(&mut ds, "dispatch-1", None, &live, &|_| None, &dir, &save, &|_| None, &|_| {
            *killed.borrow_mut() = true;
            true
        })
        .unwrap();
        assert_eq!((r["terminalState"].as_str(), *killed.borrow()), (Some("release_unknown"), false), "{r}");
        assert!(r["next"].as_str().unwrap().contains("worker-release --dispatch dispatch-1"));
        assert_eq!(stored.borrow()[0]["release"], "pending", "saved pending before the failed read");
        // worker-show only reads; worker-release changes.
        assert!(READS.contains(&WORKER_SHOW) && !READS.contains(&RELEASE));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-2 (council FS5): a terminal keeps its latest LOG_LINES lines. A release of a terminal
    /// that wrote more saves an archive that opens with a line saying how many earlier lines are
    /// missing and where it starts; one that wrote less has no such line. The unfinished last line
    /// (a prompt) is kept at the end.
    #[test]
    fn fix2_a_cut_short_archive_says_how_many_lines_are_missing() {
        let wrote = |n: usize| {
            let mut log = crate::terminal::OutputLog::default();
            for i in 1..=n {
                log.push(format!("line {i}\n").as_bytes());
            }
            log.push(b"> ");
            archive_lines(log.read(None, None))
        };
        let total = crate::terminal::LOG_LINES + 500;
        let cut = wrote(total);
        assert_eq!(cut.len(), crate::terminal::LOG_LINES + 2, "marker + the kept lines + the prompt");
        assert_eq!(cut[0], "[Kolux: the first 500 lines of this terminal's output were no longer kept; the archive starts at line 501]");
        assert_eq!((cut[1].as_str(), cut[cut.len() - 2].as_str(), cut[cut.len() - 1].as_str()), ("line 501", format!("line {total}").as_str(), "> "));
        let whole = wrote(crate::terminal::LOG_LINES);
        assert_eq!((whole.len(), whole[0].as_str()), (crate::terminal::LOG_LINES + 1, "line 1"));
        let one_over = wrote(crate::terminal::LOG_LINES + 1);
        assert!(one_over[0].starts_with("[Kolux: the first 1 line of"), "{}", one_over[0]);
    }

    /// CLI-041: `kolux diagnostics memory` against a fake app: the text shows resident and committed
    /// side by side per row and in total, the JSON carries the app's committed figure unchanged, and
    /// with no app it is one line that names `open`, with no second advice line.
    #[test]
    fn cli041_diagnostics_memory_shows_committed_beside_resident_and_passes_it_through() {
        const MB: u64 = 1024 * 1024;
        let answer = json!({
            "app": { "bytes": 300 * MB, "cpu": 0.0, "processes": 6, "committed": 123_456_789 },
            "sessions": [
                { "id": 1, "pid": 4321, "dir": "C:/w/fox", "bytes": 12 * MB, "cpu": 0.0, "processes": 2, "committed": 8 * MB },
                { "id": 2, "pid": null, "dir": null, "bytes": 0, "cpu": 0.0, "processes": 0, "committed": null }
            ],
            "free": 2048 * MB, "total": 4096 * MB
        });
        let canned = answer.clone();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "tok", "rt-1", move |req| if req.command == MEMORY { Ok(canned.clone()) } else { Err(Fail::args("unknown command")) }));
        let p = parse(&words("diagnostics memory --json"));
        let parsed = p.1.unwrap().unwrap();
        assert_eq!((p.0, parsed.command.as_str()), (true, MEMORY));
        let env = call(port, &Request { id: "m1".into(), token: "tok".into(), command: MEMORY.into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into(), arrived: None }).unwrap();
        assert_eq!(env["success"], true);
        assert_eq!(env["result"]["app"]["committed"].as_u64(), Some(123_456_789), "committed passes through unchanged");
        assert_eq!(env["result"], answer);
        let text = text_of(MEMORY, &env["result"]);
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines[0].contains("resident") && lines[0].contains("committed"), "{text}");
        assert!(lines[1].contains("Kolux") && lines[1].contains("300.0 MB") && lines[1].contains("117.7 MB") && lines[1].contains("6 processes"), "{text}");
        assert!(lines[2].contains("Session 1 · pid 4321") && lines[2].contains("12.0 MB") && lines[2].contains("8.0 MB") && lines[2].contains("C:/w/fox"), "{text}");
        assert!(lines[3].contains("Session 2") && lines[3].contains("– MB") && !lines[3].contains("pid"), "an unknown committed figure is a dash: {text}");
        // 300 + 12 MB resident; 123456789 + 8 MiB committed = 125.7 MB; 8 processes.
        assert!(lines[4].contains("Total") && lines[4].contains("312.0 MB") && lines[4].contains("125.7 MB") && lines[4].contains("8 processes"), "{text}");
        assert_eq!(lines[5].trim(), "2.00 GB free of 4.00 GB");
        assert_eq!(memory_figure(&json!(1024 * MB)), "1.00 GB");
        // T-287-c: the app says 2 of 7 processes could not be read: that row and the total show a dash and say so.
        let partial = json!({
            "app": { "bytes": 300 * MB, "cpu": 0.0, "processes": 5, "committed": null, "unreadable": 2 },
            "sessions": [{ "id": 1, "pid": 4321, "dir": "C:/w/fox", "bytes": 12 * MB, "cpu": 0.0, "processes": 2, "committed": 8 * MB, "unreadable": 0 }],
            "free": null, "total": null, "committed_total": null, "unreadable": 2
        });
        let text = text_of(MEMORY, &partial);
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines[1].contains("Kolux") && lines[1].contains("– MB") && lines[1].contains("5 processes  (2 of 5 could not be read)"), "{text}");
        assert!(lines[2].contains("8.0 MB") && !lines[2].contains("could not be read"), "{text}");
        assert!(lines[3].contains("Total") && lines[3].contains("312.0 MB") && lines[3].contains("– MB") && lines[3].ends_with("7 processes  (2 of 7 could not be read)"), "{text}");
        // An older app without committed_total: a row with processes and no figure makes the total a dash.
        let mut old = partial.clone();
        old.as_object_mut().unwrap().remove("committed_total");
        assert!(text_of(MEMORY, &old).lines().nth(3).unwrap().contains("– MB"), "{}", text_of(MEMORY, &old));
        // No app: no startup file, so one plain line and a non-zero exit.
        let none = std::env::temp_dir().join(format!("kolux-rs-cli041-{}", std::process::id()));
        let f = read_endpoint(&none).unwrap_err();
        assert_eq!(f.code, "app_unreachable");
        assert!(f.message.contains("not running") && f.message.contains(&format!("{} open", crate::orchestration::CLI)), "{}", f.message);
        assert_eq!(open_first(&f, MEMORY), None, "no second advice line");
        assert!(open_first(&f, "worktree.list").is_some(), "other commands keep their advice");
    }

    #[test]
    fn usage_text_names_the_program_this_build_answers_to() {
        let (all, code) = help(&[]);
        assert_eq!(code, 0);
        assert!(all.starts_with(&format!("{}: drive Kolux", crate::orchestration::CLI)), "{all}");
        assert!(all.contains(&format!("  {} status [--json]", crate::orchestration::CLI)), "{all}");
        // A release build answers to `kolux`: not one help line may tell the user to type kolux-dev.
        let release = named(&help_raw(&[]).0, "kolux");
        assert!(release.contains("  kolux --version") && release.contains("  kolux status [--json]"), "{release}");
        assert!(!release.contains("kolux-dev"), "{release}");
        let scoped = named(&help_raw(&words("worktree")).0, "kolux");
        assert!(scoped.starts_with("kolux worktree") && !scoped.contains("kolux-dev"), "{scoped}");
        let typo = named(&help_raw(&words("wrktree")).0, "kolux");
        assert!(typo.contains("did you mean kolux worktree") && !typo.contains("kolux-dev"), "{typo}");
    }

    /// T-550: the notes and hints a user reads outside help name the program this build answers
    /// to (`kolux` in a release build), never a written-in kolux-dev.
    #[test]
    fn t550_hints_name_the_program_this_build_answers_to() {
        let cli = crate::orchestration::CLI;
        assert!(stop_gone().contains(&format!("use {cli} terminal close --worktree")), "{}", stop_gone());
        assert_eq!(no_terminal("t9").data["hint"], json!(format!("{cli} terminal list prints the handles")));
        assert_eq!(query_text("repo.list", &json!({ "repos": [] })).unwrap(), format!("no repos yet; add one with {cli} repo add --path <folder>"));
        assert!(local_cli::text("agent-context", &json!({ "commandCount": 3 })).unwrap().contains(&format!("; {cli} agent-context --json")));
        let (_, refused) = parse(&words("terminal stop"));
        assert!(refused.unwrap_err().message.contains(&format!("{cli} terminal close")));
    }

    /// cli FIX-3 (b), council FIX-SOON 2: a release that leaves the worker's terminal open (it runs
    /// another agent, a shell, or another dispatch still claims it) says so and why, never that the
    /// terminal was already gone.
    #[test]
    fn fix3_b_release_text_says_when_the_terminal_is_left_open() {
        let why = "term-4 was already open when the worker started, so it is not the worker's to close";
        let r = json!({ "dispatchId": "dispatch-3", "terminalState": "released", "terminal": "term-4", "terminalLeftOpen": why, "worktree": "C:\\w", "alreadyReleased": false });
        let t = text_of(RELEASE, &r);
        assert!(!t.contains("already gone"), "{t}");
        assert_eq!(t, format!("dispatch-3 released: its terminal term-4 is left open ({why}); the worktree C:\\w stays"));
        let gone = json!({ "dispatchId": "dispatch-3", "terminalState": "released", "terminalLeftOpen": null, "worktree": "C:\\w", "alreadyReleased": false });
        assert_eq!(text_of(RELEASE, &gone), "dispatch-3 released: its terminal was already gone; the worktree C:\\w stays");
    }

    /// cli FIX-3 (c), council FIX-SOON 4: every command a failed worker start offers runs as
    /// printed: it parses as a known command with its flags, and when the dispatch belongs to a Run
    /// each orchestration line names it with --run, so a coordinator in another Run (or a pane
    /// tied to none) reaches the same dispatch.
    #[test]
    fn fix3_c_a_failed_start_offers_lines_that_parse_and_name_the_run() {
        let cli = crate::orchestration::CLI;
        let offered = |stage: &str, run: Option<&str>| {
            let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "codex", "model": "gpt-5", "effort": null, "terminals": [{ "id": 7, "role": "worker" }], "worktree": { "path": "C:\\Temp\\a b\\wt-1", "created": true } });
            crate::orchestration::start_failed(&mut r, stage, json!("not_configured"));
            start_failed_run(&mut r, run);
            r["next"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect::<Vec<_>>()
        };
        for stage in ["worker", "setup"] {
            for run in [Some("run-2"), None] {
                let lines = offered(stage, run);
                assert!(lines.len() >= 3, "{stage}: {lines:?}");
                for l in &lines {
                    let rest = l.strip_prefix(&format!("{cli} ")).unwrap_or_else(|| panic!("{l} names the program"));
                    let p = parse(&crate::agents::split_args(rest)).1.unwrap_or_else(|e| panic!("{l}: {}", e.message)).unwrap();
                    if p.command.starts_with("orchestration.") {
                        assert_eq!(p.args.get("run").and_then(Value::as_str), run, "{stage}: {l}");
                    } else {
                        assert_eq!(p.args.get("worktree").and_then(Value::as_str), Some("path:C:\\Temp\\a b\\wt-1"), "{l}");
                    }
                }
                let stop = if stage == "worker" { "worker-stop" } else { "worker-release" };
                assert!(lines[0].contains(stop) && lines[1].contains("worker-start --task task-2"), "{stage}: {lines:?}");
                // The retry starts the same agent and model as the failed start did.
                let retry = parse(&crate::agents::split_args(lines[1].strip_prefix(&format!("{cli} ")).unwrap())).1.unwrap().unwrap();
                assert_eq!((retry.args.get("agent").and_then(Value::as_str), retry.args.get("model").and_then(Value::as_str)), (Some("codex"), Some("gpt-5")), "{}", lines[1]);
            }
        }
    }

    /// cli FIX-4 (council FIX-SOON 1 on b4b1600): a worker started through a custom command is
    /// credited to no agent, but its recorded session (marked, still running the program recorded
    /// when the start found it) is its own: worker-stop ends it and worker-release closes it. A
    /// plain shell, a session running another program, a row stamped by an earlier run of Kolux,
    /// or a row recorded with no program all stay open, as before.
    #[test]
    fn fix4_a_custom_command_worker_is_its_own_for_stop_and_release() {
        use crate::orchestration as o;
        type Now<'a> = &'a dyn Fn(u32) -> (Option<Option<String>>, Option<String>);
        let me = u64::from(std::process::id());
        let row = |status: &str, program: Value, runtime: u64| vec![json!({ "id": "dispatch-1", "runId": null, "taskId": "task-1", "status": status, "terminal": 7, "agent": "claude", "terminalProgram": program, "runtime": runtime, "worktree": "w" })];
        let tasks = || vec![json!({ "id": "task-1", "status": "dispatched", "dispatchId": "dispatch-1" })];
        // The session: credited to no agent; the program Kolux started in it (none for a shell).
        let session = |mark: Option<&'static str>| move |t: u32| if t == 7 { (Some(None), mark.map(str::to_string)) } else { (None, None) };
        let stop = |ds: &mut Vec<Value>, now: Now| {
            let own = own_program(ds, "dispatch-1", None);
            let mut ts = tasks();
            o::stop_with(&mut ts, ds, "dispatch-1", None, 1, &|h: &str| runs_now(h, own.as_ref(), now)).unwrap()
        };
        let release = |ds: &mut Vec<Value>, now: Now| {
            let own = own_program(ds, "dispatch-1", None);
            o::release_with(ds, &|h: &str| h == "term-7", "dispatch-1", None, 1, &|h: &str| runs_now(h, own.as_ref(), now)).unwrap()
        };
        // The custom-command worker: stop ends its terminal, release closes it.
        let mut ds = row("ready", json!("npx"), me);
        let (r, kill) = stop(&mut ds, &session(Some("npx")));
        assert_eq!((kill, r["process"].as_str(), r["terminalLeftOpen"].is_null()), (Some(7), Some("ended"), true), "{r}");
        let mut ds = row("stopped", json!("npx"), me);
        let (r, handle) = release(&mut ds, &session(Some("npx")));
        assert_eq!((handle.as_deref(), r["terminalState"].as_str()), (Some("term-7"), Some("release_pending")), "{r}");
        // What the old reading said of the same worker: a shell, left open.
        let mut ts = tasks();
        let mut ds = row("ready", json!("npx"), me);
        let (r, kill) = o::stop_with(&mut ts, &mut ds, "dispatch-1", None, 1, &|_| Some(None)).unwrap();
        assert_eq!(kill, None);
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("runs no agent"), "{r}");
        // Not the worker's own: an unmarked shell, another program on the number, no recorded
        // program, a row from an earlier run of Kolux.
        for (mark, program, runtime) in [(None, json!("npx"), me), (Some("pwsh"), json!("npx"), me), (Some("npx"), Value::Null, me), (Some("npx"), json!("npx"), me + 1)] {
            let mut ds = row("ready", program.clone(), runtime);
            let (r, kill) = stop(&mut ds, &session(mark));
            assert_eq!(kill, None, "{mark:?} {program} {runtime}: {r}");
            let mut ds = row("stopped", program.clone(), runtime);
            let (_, handle) = release(&mut ds, &session(mark));
            assert_eq!(handle, None, "{mark:?} {program} {runtime}");
        }
        // A session credited to an agent reads as before, whatever was recorded.
        let codex = |t: u32| ((t == 7).then(|| Some("codex".to_string())), Some("npx".to_string()));
        let mut ds = row("ready", json!("npx"), me);
        let (r, kill) = stop(&mut ds, &codex);
        assert_eq!(kill, None);
        assert!(r["terminalLeftOpen"].as_str().unwrap_or_default().contains("now runs codex"), "{r}");
    }

    /// cli FIX-4 (council FIX-SOON 2 and AFTER 1 on b4b1600): each command a failed worker start
    /// offers runs as printed from the coordinator's own pane and from a shell Kolux did not start
    /// (no pane): worker-stop stops the dispatch, the retry's worker-start finds the task in that
    /// Run (it honours --run) and goes on to the agent, worker-release releases it. A pane that
    /// acts in another Run is turned away by every one of them. The retry carries the start's tier
    /// when it had one, and quotes a value with a space in it.
    #[test]
    fn fix4_b_offered_lines_run_from_the_coordinator_pane_and_from_no_pane() {
        let cli = crate::orchestration::CLI;
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let me = u64::from(std::process::id());
        let (run, other) = {
            let mut m = crate::orchestration::Mail::default();
            let run = m.run_create("term-1", "ship it", 1)["binding"]["runId"].as_str().unwrap().to_string();
            let other = m.run_create("term-5", "something else", 2)["binding"]["runId"].as_str().unwrap().to_string();
            m.save(&store.lock().unwrap()).unwrap();
            (run, other)
        };
        let reset = || {
            let s = store.lock().unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-2", "runId": run, "status": "dispatched", "dispatchId": "dispatch-4" })]).unwrap();
            save_list(&s, DISPATCHES_KEY, &[json!({ "id": "dispatch-4", "runId": run, "taskId": "task-2", "status": "unknown", "terminal": null, "agent": "codex", "model": "gpt-5", "runtime": me, "worktree": "w" })]).unwrap();
        };
        let offered = |stage: &str, tier: Option<&str>| {
            let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "codex", "model": "gpt-5", "effort": null, "tier": tier, "terminals": [{ "id": 9, "role": "worker" }], "worktree": { "path": "C:\\w", "created": false } });
            crate::orchestration::start_failed(&mut r, stage, json!("not_configured"));
            start_failed_run(&mut r, Some(run.as_str()));
            r["next"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect::<Vec<_>>()
        };
        let request = |line: &str| {
            let p = parse(&crate::agents::split_args(line.strip_prefix(&format!("{cli} ")).unwrap())).1.unwrap().unwrap();
            Request { id: "r".into(), token: String::new(), command: p.command, cwd: dir.display().to_string(), args: Value::Object(p.args), pane: None, cli: String::new(), arrived: None }
        };
        let run_line = |line: &str, pane: Option<&str>| {
            let req = request(line);
            if req.command == WORKER_START {
                return worker_start_as(&ctx, &req, pane.map(str::to_string));
            }
            let s = store.lock().unwrap();
            let mut m = crate::orchestration::Mail::load(&s);
            tasks(&ctx, &s, &mut m, &req, pane, None)
        };
        let worker = offered("worker", None);
        let setup = offered("setup", None);
        assert!(worker[0].contains("worker-stop") && worker[1].contains("worker-start --task task-2") && setup[0].contains("worker-release"), "{worker:?} {setup:?}");
        let no_agent = |l: &str| l.replace("--agent codex", "--agent no-such-agent").replace(" --model gpt-5", "");
        for pane in [Some("term-1"), None] {
            reset();
            let stopped = run_line(&worker[0], pane).unwrap_or_else(|e| panic!("{pane:?} {}: {}", worker[0], e.message));
            assert_eq!(stopped["status"], "stopped", "{pane:?}");
            // The retry as printed: the Run and task checks never refuse it (an installed codex goes
            // on to placement, which this folder has no project for).
            if let Err(e) = run_line(&worker[1], pane) {
                let refused = ["not_bound", "unbound_caller"].contains(&e.code) || e.message.starts_with("no task") || e.message.starts_with("no Run");
                assert!(!refused, "{pane:?} {}: {} {}", worker[1], e.code, e.message);
            }
            // The same retry with an unknown agent: it got past the task lookup to the agent.
            reset();
            run_line(&worker[0], pane).unwrap();
            let e = run_line(&no_agent(&worker[1]), pane).unwrap_err();
            assert!(e.message.contains("Kolux knows no agent `no-such-agent`"), "{pane:?}: {}", e.message);
            let released = run_line(&setup[0], pane).unwrap_or_else(|e| panic!("{pane:?} {}: {}", setup[0], e.message));
            assert_eq!(released["terminalState"], "released", "{pane:?}");
        }
        // Without --run a line from no pane names no Run, so the task is not found there.
        reset();
        let bare = no_agent(&worker[1]).replace(&format!(" --run {run}"), "");
        assert_eq!(run_line(&bare, None).unwrap_err().code, "not_found");
        // A pane acting in another Run may not change this one.
        reset();
        for line in [&worker[0], &worker[1], &setup[0]] {
            let e = run_line(line, Some("term-5")).unwrap_err();
            assert_eq!(e.code, "not_bound", "{line}: {}", e.message);
        }
        let m = crate::orchestration::Mail::load(&store.lock().unwrap());
        assert_eq!(start_run(&m, Some("term-5"), None, &[]).unwrap().as_deref(), Some(other.as_str()));
        assert_eq!(start_run(&m, None, Some("run-99"), &[]).unwrap_err().code, "not_found");
        // A tiered start's retry carries the tier, not the model it routed to; spaces are quoted.
        let tiered = offered("worker", Some("light"));
        let p = request(&tiered[1]);
        assert_eq!((p.args["tier"].as_str(), p.args.get("model"), p.args["agent"].as_str()), (Some("light"), None, Some("codex")), "{}", tiered[1]);
        let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "claude", "model": "my model", "effort": "high", "tier": null, "terminals": [], "worktree": { "path": "C:\\w", "created": false } });
        crate::orchestration::start_failed(&mut r, "worker", json!("not_configured"));
        start_failed_run(&mut r, Some("run-1"));
        let line = r["next"][1].as_str().unwrap().to_string();
        assert!(line.contains("--model \"my model\" --effort high --run run-1"), "{line}");
        assert_eq!(request(&line).args["model"], "my model");
        // Row 343: on a POSIX shell the same value is single-quoted.
        let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "claude", "model": "my model", "effort": "high", "tier": null, "terminals": [], "worktree": { "path": "/w", "created": false } });
        crate::orchestration::start_failed(&mut r, "worker", json!("not_configured"));
        start_failed_run_for(&mut r, Some("run 1"), false);
        let line = r["next"][1].as_str().unwrap().to_string();
        assert!(line.contains("--model 'my model' --effort high --run 'run 1'"), "{line}");
        // cli FIX-5 (council AFTER 1): a value a shell would act on is never offered; the stop and
        // release lines still are.
        for bad in ["m\"x", "m;rm", "a&b", "a|b", "$env:X", "a`b", "a>b"] {
            let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "claude", "model": bad, "effort": "high", "tier": null, "terminals": [], "worktree": { "path": "C:\\w", "created": false } });
            crate::orchestration::start_failed(&mut r, "worker", json!("not_configured"));
            let before = r["next"].as_array().map_or(0, Vec::len);
            start_failed_run(&mut r, Some("run-1"));
            let next: Vec<String> = r["next"].as_array().unwrap().iter().filter_map(|l| l.as_str().map(str::to_string)).collect();
            assert_eq!(next.len() + 1, before, "{bad}: {next:?}");
            assert!(next.iter().all(|l| !l.contains(bad) && !l.contains("worker-start")), "{bad}: {next:?}");
            assert!(next.iter().any(|l| l.contains("worker-stop") && l.ends_with("--run run-1")), "{bad}: {next:?}");
        }
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
    /// cli FIX-5 (council FIX-SOON 1 on c5fb49c): worker-start checks --from as worker-stop and
    /// worker-release do. A --from that cannot be proven (here: no Kolux pane; from a pane, one
    /// that names another terminal) fails the start, instead of making it an outside caller that
    /// may name any Run.
    #[test]
    fn fix5_b_worker_start_with_a_from_it_cannot_prove_fails() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix5-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let run = {
            let mut m = crate::orchestration::Mail::default();
            let run = m.run_create("term-1", "ship it", 1)["binding"]["runId"].as_str().unwrap().to_string();
            m.save(&store.lock().unwrap()).unwrap();
            save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-2", "runId": run, "status": "pending" })]).unwrap();
            run
        };
        let start = |from: Option<&str>| {
            let mut args = json!({ "run": run, "task": "task-2", "agent": "no-such-agent" });
            if let Some(f) = from {
                args["from"] = json!(f);
            }
            let req = Request { id: "r".into(), token: String::new(), command: WORKER_START.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
            worker_start(&ctx, &req).unwrap_err()
        };
        let e = start(Some("term-1"));
        assert_eq!(e.code, "unbound_caller", "{}", e.message);
        // Without --from the same start from no pane passes the Run and task checks, to the agent.
        assert!(start(None).message.contains("Kolux knows no agent `no-such-agent`"));
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-6 (council AFTER 1 on 152e581): PowerShell acts on a leading `@` (splatting) and on
    /// `,` (an array); a value with `=` is easy to misread. An offered line quotes such a value, so
    /// the pasted line means what was printed, and still parses back to the same value.
    #[test]
    fn fix6_c_offered_lines_quote_at_comma_and_equals() {
        let cli = crate::orchestration::CLI;
        for (v, shown) in [("@x", "\"@x\""), ("a,b", "\"a,b\""), ("m=1", "\"m=1\""), ("two words", "\"two words\""), ("plain-1.5", "plain-1.5")] {
            let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "codex", "model": v, "effort": null, "terminals": [{ "id": 7, "role": "worker" }], "worktree": { "path": "C:/Temp/wt-1", "created": true } });
            crate::orchestration::start_failed(&mut r, "worker", json!("not_configured"));
            start_failed_run(&mut r, Some("run-2"));
            let retry = r["next"][1].as_str().unwrap().to_string();
            assert!(retry.contains(&format!(" --model {shown}")), "{v}: {retry}");
            let p = parse(&crate::agents::split_args(retry.strip_prefix(&format!("{cli} ")).unwrap())).1.unwrap_or_else(|e| panic!("{retry}: {}", e.message)).unwrap();
            assert_eq!(p.args.get("model").and_then(Value::as_str), Some(v), "{retry}");
        }
    }

    fn tab(id: u32, quiet_ms: u64) -> Tab {
        Tab { id, quiet: Some(Duration::from_millis(quiet_ms)) }
    }

    /// cli FIX-6 item 2 (T-172-e, council FIX-SOON 1 on 152e581): the session the window starts
    /// with the dispatch id in its environment is the worker's, even when the user opens the same
    /// agent in the folder first and its banner has settled. Only a dispatch whose start is waiting
    /// can be stamped, and only once.
    #[test]
    fn fix6_a_the_stamped_session_is_the_workers_not_the_users_tab() {
        // The user's Claude tab (5) is open and quiet when the first poll runs; the window's own
        // session (6) is stamped and appears a poll later. Taking "the one fresh Claude tab" would
        // return 5 at once; the stamp makes it 6.
        let d = "dispatch-fix6-a1";
        expect_stamp(d);
        let polls = std::cell::Cell::new(0);
        let open = || {
            polls.set(polls.get() + 1);
            let mut v = vec![tab(5, 5000)];
            if polls.get() >= 2 {
                assert!(stamp_session(d, 6));
                v.push(tab(6, 5000));
            }
            v
        };
        let got = wait_ready_over(&open, d, Instant::now(), Duration::from_secs(30));
        assert_eq!(got, (Some(6), true));
        assert!(polls.get() >= 2, "the first poll took no tab");
        forget_stamp(d);
        // A stamp for a session that has since gone is no one's.
        let d2 = "dispatch-fix6-a2";
        expect_stamp(d2);
        assert!(stamp_session(d2, 9));
        assert_eq!(wait_ready_over(&|| vec![tab(5, 5000)], d2, Instant::now(), Duration::from_millis(300)), (None, false));
        forget_stamp(d2);
        // Only a waiting start can be stamped, and once: a user's own variable cannot claim a session.
        assert!(!stamp_session("dispatch-fix6-a3", 1), "never expected");
        expect_stamp("dispatch-fix6-a3");
        assert!(stamp_session("dispatch-fix6-a3", 1));
        assert!(!stamp_session("dispatch-fix6-a3", 2), "stamped once");
        assert_eq!(stamped("dispatch-fix6-a3"), Some(1));
        forget_stamp("dispatch-fix6-a3");
        assert!(!stamp_session("dispatch-fix6-a3", 3), "a finished start is not stamped");
    }

    /// cli FIX-7 item 1 (council FIX-SOON 1 on 4dce90d5): with no stamp the start takes no tab at
    /// all. A Claude tab the user opened in the worktree that has settled is never read as the
    /// worker's, however long the start waits, so a stop or release can never end it; the start
    /// reports `unknown` and leaves the terminal unrecorded.
    #[test]
    fn fix7_a_no_stamp_takes_no_tab() {
        let t = Instant::now();
        let got = wait_ready_over(&|| vec![tab(5, 5000)], "dispatch-fix7-a", t, Duration::from_millis(900));
        assert_eq!(got, (None, false));
        assert!(t.elapsed() >= Duration::from_millis(900), "waited the whole timeout: {:?}", t.elapsed());
        // Registered but never stamped: the same.
        expect_stamp("dispatch-fix7-a");
        assert_eq!(wait_ready_over(&|| vec![tab(5, 5000)], "dispatch-fix7-a", Instant::now(), Duration::from_millis(400)), (None, false));
        forget_stamp("dispatch-fix7-a");
    }

    /// cli FIX-7 item 1: the stamped session is the worker's whatever else is open; ready only once
    /// it has been quiet for SETTLE (found, not ready, until then).
    #[test]
    fn fix7_b_the_stamped_session_is_ready_once_it_settles() {
        let d = "dispatch-fix7-b";
        expect_stamp(d);
        assert!(stamp_session(d, 7));
        // Inside SETTLE: found, not ready.
        assert_eq!(wait_ready_over(&|| vec![tab(5, 5000), tab(7, 100)], d, Instant::now(), Duration::from_millis(500)), (Some(7), false));
        // Settled, with a settled neighbour that was never stamped: the stamped one.
        assert_eq!(wait_ready_over(&|| vec![tab(5, 5000), tab(7, 5000)], d, Instant::now(), Duration::from_millis(500)), (Some(7), true));
        // Still starting (never written): not ready.
        assert_eq!(wait_ready_over(&|| vec![Tab { id: 7, quiet: None }], d, Instant::now(), Duration::from_millis(300)), (Some(7), false));
        forget_stamp(d);
    }

    /// cli FIX-7 items 2 and 3 (council FIX-SOON 2, AFTER 1): the step terminal_spawn runs on its
    /// own environment before it starts the session. The last KOLUX_DISPATCH_ID wins, so a value
    /// the user's agent environment already holds cannot stand in for the window's; and only the
    /// dispatch a start registered can be stamped, so the user's value stamps nothing.
    #[test]
    fn fix7_c_the_spawn_env_names_the_dispatch_to_stamp() {
        let e = |k: &str, v: &str| (k.to_string(), v.to_string());
        assert_eq!(dispatch_in(&[]), None);
        assert_eq!(dispatch_in(&[e("PATH", "x")]), None);
        assert_eq!(dispatch_in(&[e(DISPATCH_ENV, "dispatch-7")]), Some("dispatch-7".to_string()));
        // The user's own entry first, the window's last: the window's wins.
        let env = [e("A", "1"), e(DISPATCH_ENV, "dispatch-fix7-user"), e("B", "2"), e(DISPATCH_ENV, "dispatch-fix7-c")];
        assert_eq!(dispatch_in(&env).as_deref(), Some("dispatch-fix7-c"));
        // End to end: the start registers its dispatch, the spawn reads it from the env and stamps
        // the new session, and the wait returns that session.
        expect_stamp("dispatch-fix7-c");
        let named = dispatch_in(&env).unwrap();
        assert!(stamp_session(&named, 12));
        assert_eq!(wait_ready_over(&|| vec![tab(12, 5000)], "dispatch-fix7-c", Instant::now(), Duration::from_millis(500)), (Some(12), true));
        forget_stamp("dispatch-fix7-c");
        // The user's value alone names a dispatch no start is waiting on: nothing is stamped.
        let only_user = [e(DISPATCH_ENV, "dispatch-fix7-user")];
        assert!(!stamp_session(&dispatch_in(&only_user).unwrap(), 13));
    }

    /// cli FIX-7 (earlier AFTER on c5fb49c): worker-stop and worker-release as the command line
    /// reaches them (dispatch, not the helpers). A custom-command worker's marked session is ended
    /// and closed; a shell the row happens to name, and a tab the user opened running the same
    /// command, stay open. A wrong tuple order in `session_now`/`runs_now` would show here.
    #[test]
    fn fix7_d_stop_and_release_through_dispatch_end_only_the_workers_marked_session() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix7-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        // 7: the worker (npx, a custom command); 8: a shell; 9: the user's own tab running npx too; 10: a settled worker.
        terminals.fake_session(7, &wd, Some("npx"));
        terminals.fake_session(8, &wd, None);
        terminals.fake_session(9, &wd, Some("npx"));
        terminals.fake_session(10, &wd, Some("npx"));
        // 11: a tab the user opened that a row names, but marked with another program than the row recorded.
        terminals.fake_session(11, &wd, Some("node"));
        let row = |n: u32, status: &str, term: u32| worker_row(json!({ "id": format!("dispatch-{n}"), "runId": null, "taskId": format!("task-{n}"), "status": status, "worktree": wd, "agent": "claude", "terminal": term, "terminalProgram": "npx" }));
        let task = |n: u32| json!({ "id": format!("task-{n}"), "status": "dispatched", "dispatchId": format!("dispatch-{n}") });
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, "ready", 7), row(2, "ready", 8), row(3, "stopped", 10), row(4, "stopped", 8), row(5, "ready", 11), row(6, "stopped", 11)]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[task(1), task(2), task(3), task(4), task(5), task(6)]).unwrap();
        let call = |command: &str, id: &str| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": id }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req)
        };
        // A shell that the row names is not the worker's: stop leaves it open and says why.
        let r = call(STOP, "dispatch-2").unwrap();
        assert!(r["terminalLeftOpen"].is_string(), "{r}");
        assert!(terminals.live("term-8"), "the shell stays");
        // The marked custom-command session is the worker's: stop ends it, and nothing else.
        let r = call(STOP, "dispatch-1").unwrap();
        assert_eq!(r["process"], "ended", "{r}");
        assert!(!terminals.live("term-7"), "the worker's session ended");
        assert!(terminals.live("term-9") && terminals.live("term-10"), "the user's tab and the other worker stay");
        // Release closes a settled worker's marked session; a shell it names stays.
        let r = call(RELEASE, "dispatch-3").unwrap();
        assert_eq!(r["terminalState"], "released", "{r}");
        assert!(!terminals.live("term-10"), "release closed the worker's session");
        let r = call(RELEASE, "dispatch-4").unwrap();
        assert!(r["terminalLeftOpen"].is_string(), "{r}");
        assert!(terminals.live("term-8") && terminals.live("term-9"), "a shell and the user's tab stay open");
        // cli FIX-8: a session a row names whose mark is not the row's recorded program is the user's, not the
        // worker's (runs_now's mark check): stop and release both leave it open and say why.
        let r = call(STOP, "dispatch-5").unwrap();
        assert!(r["terminalLeftOpen"].is_string(), "{r}");
        assert!(terminals.live("term-11"), "stop left the differently-marked session open");
        let r = call(RELEASE, "dispatch-6").unwrap();
        assert!(r["terminalLeftOpen"].is_string(), "{r}");
        assert!(terminals.live("term-11"), "release left it open");
        for t in [8, 9, 11] {
            let _ = terminals.kill(t);
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Ctx pieces a dispatch-level test needs: a scratch folder, its store and the git runner.
    fn fix8_world(tag: &str) -> (std::path::PathBuf, Git, Mutex<Store>) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix8-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        (dir, Git::detect().unwrap(), store)
    }

    /// cli FIX-8 item 2 (council FIX-SOON 2 on 800b8a94): a worker the window starts after the start
    /// gave up (a loaded PC) is not lost. Its session is stamped to the dispatch inside the late
    /// window, the next worker-show / stop / release call records it on the row, and a stop then
    /// ends it, and only it. Without this a stop freed the task but killed nothing and the retry made
    /// a second agent on the same task.
    #[test]
    fn fix8_a_a_late_stamp_lands_on_the_row_and_a_stop_ends_it() {
        let (dir, git_, store) = fix8_world("a");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let row = |n: u32, status: &str| worker_row(json!({ "id": format!("dispatch-fix8-a{n}"), "runId": null, "taskId": format!("task-fix8-a{n}"), "status": status, "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        let task = |n: u32| json!({ "id": format!("task-fix8-a{n}"), "status": "dispatched", "dispatchId": format!("dispatch-fix8-a{n}") });
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, "unknown"), row(2, "unknown"), row(3, "unknown")]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[task(1), task(2), task(3)]).unwrap();
        let call = |command: &str, id: &str| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": id }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req)
        };
        let saved = |id: &str| load_list(&store.lock().unwrap(), DISPATCHES_KEY).unwrap().into_iter().find(|d| d["id"] == id).unwrap();
        // Both starts ended `unknown` without a session; they keep their place for the window.
        for n in [1, 2] {
            let d = format!("dispatch-fix8-a{n}");
            expect_stamp(&d);
            finish_stamp(&d, None, LATE_WINDOW);
        }
        // Nothing has arrived yet: a call changes nothing.
        call(WORKER_SHOW, "dispatch-fix8-a1").unwrap();
        assert!(saved("dispatch-fix8-a1")["terminal"].is_null());
        // The window starts both agents late (7 and 8) and the user opens a tab (9) with the same program.
        terminals.fake_session(7, &wd, Some("npx"));
        terminals.fake_session(8, &wd, Some("npx"));
        terminals.fake_session(9, &wd, Some("npx"));
        assert!(stamp_session("dispatch-fix8-a1", 7), "a start that timed out can still be stamped");
        assert!(!stamp_session("dispatch-fix8-a1", 9), "once");
        // worker-show records it on the row.
        call(WORKER_SHOW, "dispatch-fix8-a1").unwrap();
        let d1 = saved("dispatch-fix8-a1");
        assert_eq!((d1["terminal"].as_u64(), d1["terminalProgram"].as_str(), d1["lateStamp"].as_bool()), (Some(7), Some("npx"), Some(true)), "{d1}");
        assert_eq!(d1["status"], "unknown", "the status stays as the start reported it");
        // A stop now ends that session, not the user's tab or the other worker's.
        let r = call(STOP, "dispatch-fix8-a1").unwrap();
        assert_eq!(r["process"], "ended", "{r}");
        assert!(!terminals.live("term-7"), "the late worker ended");
        assert!(terminals.live("term-8") && terminals.live("term-9"), "the other worker and the user's tab stay");
        // The stop came first for the second dispatch (nothing recorded, so it kills nothing and says so).
        let r = call(STOP, "dispatch-fix8-a2").unwrap();
        assert_eq!(r["process"], "unverifiable", "{r}");
        assert!(terminals.live("term-8"));
        // Its session arrives after the stop: it is recorded, so the offered release can close it.
        assert!(stamp_session("dispatch-fix8-a2", 8));
        call(WORKER_SHOW, "dispatch-fix8-a2").unwrap();
        assert_eq!(saved("dispatch-fix8-a2")["terminal"].as_u64(), Some(8));
        let r = call(RELEASE, "dispatch-fix8-a2").unwrap();
        assert_eq!(r["terminalState"], "released", "{r}");
        assert!(!terminals.live("term-8"), "release closed the late worker");
        assert!(terminals.live("term-9"), "the user's tab stays");
        // A third start whose session is gone before anything reads it records nothing.
        let d3 = "dispatch-fix8-a3";
        expect_stamp(d3);
        finish_stamp(d3, None, LATE_WINDOW);
        terminals.fake_session(11, &wd, Some("npx"));
        assert!(stamp_session(d3, 11));
        terminals.kill(11).unwrap();
        call(WORKER_SHOW, d3).unwrap();
        assert!(saved(d3)["terminal"].is_null());
        forget_stamp(d3);
        let _ = terminals.kill(9);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-8 item 2: the late window is bounded and a found session ends the entry. A start that
    /// found its session forgets the entry; one that found none keeps it for the window only; and a
    /// row of an earlier run, or one that already has a terminal, is never changed.
    #[test]
    fn fix8_b_the_late_window_is_bounded() {
        let d = "dispatch-fix8-b";
        expect_stamp(d);
        finish_stamp(d, Some(4), LATE_WINDOW);
        assert!(!stamp_session(d, 5), "a start that found its session is done");
        // Kept for a window that has already passed: nothing can be stamped any more.
        expect_stamp(d);
        finish_stamp(d, None, Duration::ZERO);
        assert!(!stamp_session(d, 5), "past the window");
        // A late session is recorded once, on this run's row without a terminal only.
        let me = u64::from(std::process::id());
        expect_stamp(d);
        finish_stamp(d, None, LATE_WINDOW);
        assert!(stamp_session(d, 6));
        let open = |t: u32| (t == 6).then(|| Some("npx".to_string()));
        let mut rows = vec![
            json!({ "id": d, "runtime": me + 1, "terminal": null }),
            json!({ "id": d, "runtime": me, "terminal": 3 }),
            json!({ "id": "dispatch-fix8-b-other", "runtime": me, "terminal": null }),
        ];
        assert_eq!(reconcile_late(&mut rows, &open), 0, "an earlier run's row, a recorded row and another dispatch stay: {rows:?}");
        rows.push(json!({ "id": d, "runtime": me, "terminal": null }));
        assert_eq!(reconcile_late(&mut rows, &open), 1);
        assert_eq!(rows[3]["terminal"], 6);
        assert_eq!(reconcile_late(&mut rows, &open), 0, "recorded once");
        forget_stamp(d);
    }

    /// cli FIX-8 AFTER 4: the wait reads only the stamped session. With no stamp, or a stamped
    /// session that has gone, it sees nothing; with one it sees that session and no other.
    #[test]
    fn fix8_c_tabs_reads_only_the_stamped_session() {
        let terminals = Terminals::default();
        terminals.fake_session(5, "C:/w", Some("npx"));
        terminals.fake_session(6, "C:/w", Some("npx"));
        let d = "dispatch-fix8-c";
        assert!(tabs(&terminals, d).is_empty(), "no entry");
        expect_stamp(d);
        assert!(tabs(&terminals, d).is_empty(), "no stamp yet");
        assert!(stamp_session(d, 6));
        let seen = tabs(&terminals, d);
        assert_eq!(seen.iter().map(|t| t.id).collect::<Vec<_>>(), vec![6]);
        assert!(seen[0].quiet.is_some_and(|q| q >= SETTLE));
        terminals.kill(6).unwrap();
        assert!(tabs(&terminals, d).is_empty(), "the stamped session is gone");
        let _ = terminals.kill(5);
        forget_stamp(d);
    }

    /// cli FIX-8 AFTER 1: the step terminal_spawn runs around a spawn. The id comes from the
    /// environment before it is handed over, the new session is stamped only once the spawn
    /// succeeded, and the user's own value (an entry no start registered) stamps nothing.
    #[test]
    fn fix8_d_spawn_stamped_stamps_the_new_session_on_success_only() {
        let e = |k: &str, v: &str| (k.to_string(), v.to_string());
        let env = [e(DISPATCH_ENV, "dispatch-fix8-user"), e("A", "1"), e(DISPATCH_ENV, "dispatch-fix8-d")];
        expect_stamp("dispatch-fix8-d");
        let id: Result<u32, String> = spawn_stamped(dispatch_in(&env), || Ok(21));
        assert_eq!(id, Ok(21));
        assert_eq!(stamped("dispatch-fix8-d"), Some(21));
        forget_stamp("dispatch-fix8-d");
        // A spawn that fails stamps nothing and its error comes back.
        expect_stamp("dispatch-fix8-d2");
        let id: Result<u32, String> = spawn_stamped(Some("dispatch-fix8-d2".into()), || Err("no pty".into()));
        assert_eq!(id, Err("no pty".to_string()));
        assert_eq!(stamped("dispatch-fix8-d2"), None);
        assert!(stamp_session("dispatch-fix8-d2", 1), "still waiting: the failed spawn used no stamp");
        forget_stamp("dispatch-fix8-d2");
        // No dispatch in the environment, or the user's alone: nothing to stamp, the id still comes back.
        assert_eq!(spawn_stamped::<String>(dispatch_in(&[e("A", "1")]), || Ok(22)), Ok(22));
        assert_eq!(spawn_stamped::<String>(dispatch_in(&[e(DISPATCH_ENV, "dispatch-fix8-user")]), || Ok(23)), Ok(23));
        assert_eq!(stamped("dispatch-fix8-user"), None);
    }

    /// cli FIX-9 item 1 (council FIX-SOON 1 on 529c53e2): a session that arrives late for a dispatch
    /// the coordinator already stopped (or released) is not attached in silence. The call that
    /// records it says so (`lateWorker`: the dispatch, the session, its status, and worker-release as
    /// the next step), worker-show keeps saying it (`lateStamp`, `lateAfter`), and worker-release
    /// closes that session, also on a row released before it came, with the same note in its receipt.
    /// A row still running takes the session as before and says nothing.
    #[test]
    fn fix9_a_a_late_session_on_a_stopped_or_released_row_is_said_so() {
        let (dir, git_, store) = fix8_world("fix9a");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let row = |n: u32, status: &str, released: bool| worker_row(json!({ "id": format!("dispatch-fix9-a{n}"), "runId": null, "taskId": format!("task-fix9-a{n}"), "status": status, "released": released, "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        let task = |n: u32| json!({ "id": format!("task-fix9-a{n}"), "status": "dispatched", "dispatchId": format!("dispatch-fix9-a{n}") });
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, "stopped", false), row(2, "stopped", true), row(3, "unknown", false)]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[task(1), task(2), task(3)]).unwrap();
        let call = |command: &str, n: u32| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": format!("dispatch-fix9-a{n}") }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req).unwrap()
        };
        let late = |n: u32, session: u32| {
            let d = format!("dispatch-fix9-a{n}");
            expect_stamp(&d);
            finish_stamp(&d, None, LATE_WINDOW);
            terminals.fake_session(session, &wd, Some("npx"));
            assert!(stamp_session(&d, session));
        };
        // 1: stopped first, then its agent comes up.
        late(1, 7);
        let r = call(WORKER_SHOW, 1);
        let note = &r["lateWorker"][0];
        assert_eq!((note["dispatchId"].as_str(), note["terminal"].as_str(), note["status"].as_str()), (Some("dispatch-fix9-a1"), Some("term-7"), Some("stopped")), "{r}");
        assert!(note["next"].as_str().is_some_and(|n| n.contains("worker-release --dispatch dispatch-fix9-a1")), "{r}");
        assert!(r["lateWorker"].as_array().is_some_and(|a| a.len() == 1), "only the row the session came for: {r}");
        // worker-show keeps saying it on later calls; the note goes with the show that clears the alarm (cli FIX-11), then stops.
        let r = call(WORKER_SHOW, 1);
        assert_eq!((r["lateStamp"].as_bool(), r["lateAfter"].as_str()), (Some(true), Some("stopped")), "{r}");
        assert_eq!(r["lateWorker"][0]["dispatchId"], "dispatch-fix9-a1", "the second show still tells it, then clears: {r}");
        let r = call(WORKER_SHOW, 1);
        assert!(r["lateWorker"].is_null(), "said until a later show cleared it: {r}");
        let r = call(RELEASE, 1);
        assert_eq!(r["terminalState"], "released", "{r}");
        assert_eq!(r["lateWorker"][0]["terminal"], "term-7", "{r}");
        assert!(!terminals.live("term-7"), "release closed the late worker");
        // 2: released before its agent came up; the release is opened again and closes it.
        late(2, 8);
        let r = call(WORKER_SHOW, 2);
        assert_eq!(r["lateWorker"][0]["status"], "released", "{r}");
        let r = call(RELEASE, 2);
        assert_eq!((r["terminalState"].as_str(), r["alreadyReleased"].as_bool()), (Some("released"), Some(false)), "{r}");
        assert_eq!(r["lateWorker"][0]["terminal"], "term-8", "{r}");
        assert!(!terminals.live("term-8"), "release closed the session that came after the release");
        let r = call(RELEASE, 2);
        assert_eq!(r["alreadyReleased"], true, "closed once, then it stays released: {r}");
        // 3: still running; the session is recorded as before and nothing is said.
        late(3, 9);
        let r = call(WORKER_SHOW, 3);
        assert!(r["lateWorker"].is_null(), "{r}");
        assert_eq!((r["lateStamp"].as_bool(), r["lateAfter"].is_null()), (Some(true), true), "{r}");
        let _ = terminals.kill(9);
        for n in 1..=3 {
            forget_stamp(&format!("dispatch-fix9-a{n}"));
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-9 item 4: worker-show says a late agent in words, and any answer prints its late worker
    /// notes with the way to close them.
    #[test]
    fn fix9_b_the_text_says_a_late_agent_and_prints_late_worker_notes() {
        let base = json!({ "dispatchId": "dispatch-1", "terminalState": "reclaimable", "taskStatus": "dispatched", "terminal": "term-3", "worktree": "C:/w", "waiting": "unknown", "waitingWhy": "x" });
        assert!(!text_of(WORKER_SHOW, &base).contains("late"));
        let mut shown = base.clone();
        shown["lateStamp"] = json!(true);
        assert!(text_of(WORKER_SHOW, &shown).ends_with("; its agent came up late"));
        shown["lateAfter"] = json!("stopped");
        assert!(text_of(WORKER_SHOW, &shown).ends_with("; its agent came up late, after the dispatch was stopped"));
        let warned = json!({ "dispatchId": "dispatch-1", "terminalState": "released", "lateWorker": [{ "note": "dispatch-1 was already stopped when its agent came up late", "next": "kolux orchestration worker-release --dispatch dispatch-1" }] });
        assert!(text_of(RELEASE, &warned).ends_with("\nwarning: dispatch-1 was already stopped when its agent came up late; next: kolux orchestration worker-release --dispatch dispatch-1"));
    }

    /// cli FIX-10 item 1 and 3 (council FIX-SOON 1 and 3 on 081bbfab): a late-worker note is not one
    /// answer's luck. It stays on every answer (the list rows too: lateStamp, lateAfter, latePending)
    /// until worker-show or worker-release reads that dispatch; completed and failed rows get it too.
    #[test]
    fn fix10_a_the_late_note_stays_until_the_dispatch_is_read_and_covers_finished_rows() {
        let (dir, git_, store) = fix8_world("fix10a");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let row = |n: u32, status: &str| worker_row(json!({ "id": format!("dispatch-fix10-a{n}"), "runId": null, "taskId": format!("task-fix10-a{n}"), "status": status, "released": false, "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        // cli FIX-11 (council FIX-SOON 2 on 9afdd308): the tasks of the completed and failed rows are finished and hold a result.
        let task = |n: u32| match n {
            2 => json!({ "id": "task-fix10-a2", "status": "completed", "result": "built it", "dispatchId": "dispatch-fix10-a2" }),
            3 => json!({ "id": "task-fix10-a3", "status": "failed", "result": "broke", "dispatchId": "dispatch-fix10-a3" }),
            _ => json!({ "id": format!("task-fix10-a{n}"), "status": "dispatched", "dispatchId": format!("dispatch-fix10-a{n}") }),
        };
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, "stopped"), row(2, "completed"), row(3, "failed")]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[task(1), task(2), task(3)]).unwrap();
        let call = |command: &str, n: u32| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": format!("dispatch-fix10-a{n}") }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req).unwrap()
        };
        let late = |n: u32, session: u32| {
            let d = format!("dispatch-fix10-a{n}");
            expect_stamp(&d);
            finish_stamp(&d, None, LATE_WINDOW);
            terminals.fake_session(session, &wd, Some("npx"));
            assert!(stamp_session(&d, session));
        };
        late(1, 17);
        late(2, 18);
        late(3, 19);
        let notes = |r: &Value| {
            let mut ids: Vec<String> = r["lateWorker"].as_array().into_iter().flatten().filter_map(|n| n["dispatchId"].as_str()).map(str::to_string).collect();
            ids.sort();
            ids
        };
        let all = vec!["dispatch-fix10-a1".to_string(), "dispatch-fix10-a2".to_string(), "dispatch-fix10-a3".to_string()];
        // A list is the first call to see them, and says it for stopped, completed and failed alike.
        let r = call(WORKER_LIST, 1);
        assert_eq!(notes(&r), all, "{r}");
        let row_of = |r: &Value, n: u32| r["workers"].as_array().unwrap().iter().find(|w| w["dispatchId"] == format!("dispatch-fix10-a{n}")).cloned().unwrap();
        for (n, status) in [(1, "stopped"), (2, "completed"), (3, "failed")] {
            let w = row_of(&r, n);
            assert_eq!((w["lateStamp"].as_bool(), w["lateAfter"].as_str(), w["latePending"].as_bool()), (Some(true), Some(status), Some(true)), "{w}");
        }
        assert!(text_of(WORKER_LIST, &r).contains("its agent came up late"), "{}", text_of(WORKER_LIST, &r));
        // It is not said once: the next answer, a list or any other, says it again.
        let r = call(WORKER_LIST, 1);
        assert_eq!(notes(&r), all, "durable: {r}");
        // worker-show on one dispatch reads it: told in the show, and (cli FIX-11) dropped by a later show.
        let r = call(WORKER_SHOW, 1);
        assert_eq!(r["lateAfter"], "stopped", "{r}");
        let r = call(WORKER_SHOW, 1);
        assert_eq!(r["lateWorker"][0]["dispatchId"], "dispatch-fix10-a1", "{r}");
        let r = call(WORKER_LIST, 1);
        assert_eq!(notes(&r), vec!["dispatch-fix10-a2".to_string(), "dispatch-fix10-a3".to_string()], "{r}");
        let w = row_of(&r, 1);
        assert_eq!((w["lateAfter"].as_str(), w["latePending"].as_bool().unwrap_or(false)), (Some("stopped"), false), "the list keeps the fact, not the alarm: {w}");
        // A release of a completed row closes the late agent and reads it.
        let tasks_before = load_list(&store.lock().unwrap(), TASKS_KEY).unwrap();
        let r = call(RELEASE, 2);
        assert_eq!(r["terminalState"], "released", "{r}");
        assert!(!terminals.live("term-18"), "release closed the late agent on the completed row");
        let r = call(WORKER_LIST, 1);
        assert_eq!(notes(&r), vec!["dispatch-fix10-a3".to_string()], "{r}");
        // cli FIX-11: and the failed row's; neither release touches a finished task or its result.
        call(RELEASE, 3);
        assert!(!terminals.live("term-19"), "release closed the late agent on the failed row");
        let tasks_after = load_list(&store.lock().unwrap(), TASKS_KEY).unwrap();
        assert_eq!(tasks_after, tasks_before, "a release changes no task");
        assert_eq!((tasks_after[1]["status"].as_str(), tasks_after[1]["result"].as_str()), (Some("completed"), Some("built it")));
        assert_eq!((tasks_after[2]["status"].as_str(), tasks_after[2]["result"].as_str()), (Some("failed"), Some("broke")));
        let _ = terminals.kill(17);
        for n in 1..=3 {
            forget_stamp(&format!("dispatch-fix10-a{n}"));
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-10 item 2 (council FIX-SOON 2 on 081bbfab): when a release leaves the late agent's
    /// terminal open (it was handed to the worker already open), the note says it is still open and
    /// names the command that closes a terminal, not a release that promises a close.
    #[test]
    fn fix10_b_a_release_that_leaves_the_late_terminal_open_says_so() {
        let (dir, git_, store) = fix8_world("fix10b");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let row = worker_row(json!({ "id": "dispatch-fix10-b1", "runId": null, "taskId": "task-fix10-b1", "status": "stopped", "released": false, "mode": "existing", "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-fix10-b1", "status": "dispatched", "dispatchId": "dispatch-fix10-b1" })]).unwrap();
        expect_stamp("dispatch-fix10-b1");
        finish_stamp("dispatch-fix10-b1", None, LATE_WINDOW);
        terminals.fake_session(21, &wd, Some("npx"));
        assert!(stamp_session("dispatch-fix10-b1", 21));
        let req = Request { id: "r".into(), token: String::new(), command: RELEASE.into(), cwd: wd.clone(), args: json!({ "dispatch": "dispatch-fix10-b1" }), pane: None, cli: String::new(), arrived: None };
        let r = dispatch(&ctx, &req).unwrap();
        assert!(r["terminalLeftOpen"].is_string(), "{r}");
        assert!(terminals.live("term-21"), "the release did not close it");
        let note = &r["lateWorker"][0];
        assert!(note["note"].as_str().is_some_and(|n| n.contains("left open") && n.contains("term-21")), "{r}");
        let next = note["next"].as_str().unwrap_or_default();
        assert!(next.contains("terminal close --terminal term-21") && !next.contains("worker-release"), "{next}");
        let _ = terminals.kill(21);
        forget_stamp("dispatch-fix10-b1");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-10 item 4 (council AFTER 2 on 081bbfab): a release that reopens a released row for a
    /// late agent and then cannot close the terminal leaves an unknown release, and the retry takes
    /// the ordinary path and closes it. An answer that is not an object keeps its shape.
    #[test]
    fn fix10_c_a_reopen_whose_kill_fails_is_retried_the_ordinary_way() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix10c-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut rows = vec![json!({ "id": "dispatch-1", "runId": null, "taskId": "task-1", "status": "stopped", "released": true, "lateStamp": true, "lateAfter": "released", "latePending": true, "terminal": 7, "agent": "claude", "worktree": "w" })];
        let live = |h: &str| h == "term-7";
        let agent_of = |_: &str| None;
        let save = |_: &[Value]| Ok(());
        let read = |_: u32| Some(crate::terminal::Read::default());
        let kills = std::cell::Cell::new(0);
        let failing = |_: u32| {
            kills.set(kills.get() + 1);
            false
        };
        let r = release_worker(&mut rows, "dispatch-1", None, &live, &agent_of, &dir, &save, &read, &failing).unwrap();
        assert_eq!(r["terminalState"], "release_unknown", "{r}");
        assert_eq!(r["lateWorker"][0]["terminal"], "term-7", "{r}");
        assert_eq!((rows[0]["lateAfter"].as_str(), rows[0]["latePending"].as_bool()), (Some("released"), Some(true)), "cli FIX-11: the agent is still running, so the alarm and the fact stay: {}", rows[0]);
        let closing = |_: u32| {
            kills.set(kills.get() + 1);
            true
        };
        let r = release_worker(&mut rows, "dispatch-1", None, &live, &agent_of, &dir, &save, &read, &closing).unwrap();
        assert_eq!((r["terminalState"].as_str(), r["alreadyReleased"].as_bool()), (Some("released"), Some(false)), "{r}");
        assert_eq!(r["lateWorker"][0]["terminal"], "term-7", "cli FIX-11: the retry still tells it, the agent runs until it closes: {r}");
        // cli FIX-12 (council AFTER 1 on 28f3eb7a): the alarm is spent, the fact stays, as on the found-gone path.
        assert!(rows[0]["latePending"].is_null() && rows[0]["lateAfter"] == "released", "closed: the alarm is spent, the fact stays: {}", rows[0]);
        assert_eq!(kills.get(), 2);
        // A non-object answer is handed back as it was.
        let note = json!({ "dispatchId": "dispatch-1" });
        assert_eq!(with_late_notes(json!([1, 2]), vec![note.clone()]), json!([1, 2]));
        assert_eq!(with_late_notes(json!("x"), vec![note]), json!("x"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-11 item 1 (council FIX-BEFORE 1 on 9afdd308): a release that leaves the late agent's
    /// terminal open keeps the alarm and the fact on the row, so a receipt that is lost still leaves the
    /// running agent on record; the list and every answer say it, and name terminal close. Once the
    /// terminal is closed another release spends the alarm.
    #[test]
    fn fix11_a_a_left_open_release_keeps_the_alarm_until_the_terminal_is_closed() {
        let (dir, git_, store) = fix8_world("fix11a");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let row = worker_row(json!({ "id": "dispatch-fix11-a1", "runId": null, "taskId": "task-fix11-a1", "status": "stopped", "released": false, "mode": "existing", "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-fix11-a1", "status": "dispatched", "dispatchId": "dispatch-fix11-a1" })]).unwrap();
        expect_stamp("dispatch-fix11-a1");
        finish_stamp("dispatch-fix11-a1", None, LATE_WINDOW);
        terminals.fake_session(31, &wd, Some("npx"));
        assert!(stamp_session("dispatch-fix11-a1", 31));
        let call = |command: &str| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": "dispatch-fix11-a1" }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req).unwrap()
        };
        let r = call(RELEASE);
        assert!(r["terminalLeftOpen"].is_string() && terminals.live("term-31"), "{r}");
        // The receipt could be lost: the row still says the agent runs, in the list and on the next answer.
        let r = call(WORKER_LIST);
        let w = &r["workers"][0];
        assert_eq!((w["lateAfter"].as_str(), w["latePending"].as_bool()), (Some("stopped"), Some(true)), "{w}");
        let next = r["lateWorker"][0]["next"].as_str().unwrap_or_default();
        assert!(next.contains("terminal close --terminal term-31") && !next.contains("worker-release"), "{r}");
        // Releasing again leaves it open the same way and says the same.
        let r = call(RELEASE);
        assert!(r["lateWorker"][0]["next"].as_str().is_some_and(|n| n.contains("terminal close")), "{r}");
        // Closed by the person: the next release finds nothing running and spends the alarm.
        terminals.kill(31).unwrap();
        let r = call(RELEASE);
        assert_eq!(r["terminalState"], "released", "{r}");
        assert!(r["lateWorker"].is_null(), "{r}");
        let r = call(WORKER_LIST);
        assert!(r["lateWorker"].is_null() && r["workers"][0]["latePending"].is_null(), "{r}");
        forget_stamp("dispatch-fix11-a1");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-11 item 2 (council FIX-BEFORE 1, worker-show half): the first worker-show of a late row
    /// does not clear the alarm, because that answer may be the one that is lost; the show after it does.
    #[test]
    fn fix11_b_worker_show_clears_the_alarm_on_a_later_show() {
        let mut d = json!({ "id": "dispatch-1", "latePending": true, "lateAfter": "stopped", "lateStamp": true });
        read_late(&mut d, true);
        assert_eq!((d["latePending"].as_bool(), d["lateShown"].as_bool()), (Some(true), Some(true)), "the first read leaves the alarm: {d}");
        assert_eq!(pending_late_notes(&[d.clone()], None).len(), 1, "and every answer still tells it");
        read_late(&mut d, true);
        assert!(d["latePending"].is_null() && d["lateShown"].is_null(), "a later show clears it: {d}");
        assert_eq!(d["lateAfter"], "stopped", "the fact stays");
        assert!(pending_late_notes(&[d.clone()], None).is_empty());
        let mut quiet = json!({ "id": "dispatch-2" });
        read_late(&mut quiet, true);
        assert_eq!(quiet, json!({ "id": "dispatch-2" }), "a row with no alarm is left alone");
    }

    /// CLI-033 (T-089-d): on the packaged Windows build a new question hands control back with exit
    /// status 75 and the resume command; a resumed wait never hands back; a dev build waits on.
    #[test]
    fn t089d_ask_hands_back_with_exit_75_and_a_resumed_wait_never_does() {
        let ask = |args: Value| Request { id: "a1".into(), token: "secret".into(), command: ASK.into(), cwd: String::new(), args, pane: None, cli: VERSION.into(), arrived: None };
        assert_eq!(hand_back_after(true, &ask(json!({ "question": "ship it?" }))), Some(HAND_BACK_MS));
        assert_eq!(hand_back_after(true, &ask(json!({ "resume": "msg-4" }))), None, "a resumed wait never hands back");
        assert_eq!(hand_back_after(false, &ask(json!({ "question": "ship it?" }))), None, "a dev build or another system waits on");
        const { assert!(HAND_BACK_MS < 120_000, "hands back inside two minutes") };
        // An app whose question stays open: the hand-back answer carries the resume command.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "secret", "rt-1", |_| Ok(json!({ "status": "open", "messageId": "msg-4", "to": "term-1" }))));
        let env = wait_for_mail(port, ask(json!({ "question": "ship it?", "timeoutMs": "60000" })), Some(0)).unwrap();
        assert_eq!((env["result"]["handedBack"].as_bool(), exit_status(ASK, &env)), (Some(true), 75));
        let line = text_of(ASK, &env["result"]);
        assert!(line.contains("exit status 75") && line.contains("orchestration ask --resume msg-4"), "{line}");
        // The resumed wait (no hand-back) runs out its own timeout and exits 0 with the question open.
        let resumed = wait_for_mail(port, ask(json!({ "resume": "msg-4", "timeoutMs": "1" })), None).unwrap();
        assert_eq!((resumed["result"]["handedBack"].as_bool(), resumed["result"]["timedOut"].as_bool(), exit_status(ASK, &resumed)), (None, Some(true), 0));
        assert_eq!(exit_status(ASK, &json!({ "success": false })), 1);
        assert_eq!(exit_status(WORKER_SHOW, &json!({ "success": true, "result": { "handedBack": true } })), 0, "only ask hands back");
    }

    /// CLI-036 (T-089-d): terminal commands take a worker's dispatch id: it resolves through
    /// orchestration::terminal_for to the worker's terminal; a worker with no terminal is refused by
    /// name; a terminal handle or a name that is no dispatch passes through unchanged.
    #[test]
    fn t089d_terminal_commands_resolve_a_dispatch_id() {
        let d = [worker_row(json!({ "id": "dispatch-1", "terminal": 4 })), json!({ "id": "dispatch-2", "terminal": null })];
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: String::new(), args, pane: None, cli: String::new(), arrived: None };
        let r = req("terminal.send", json!({ "terminal": "dispatch-1", "text": "hi" }));
        assert!(named_dispatch(&r));
        assert_eq!(by_dispatch(&r, &d).unwrap().unwrap().args, json!({ "terminal": "term-4", "text": "hi" }));
        let no = by_dispatch(&req("terminal.read", json!({ "terminal": "dispatch-2" })), &d).unwrap_err();
        assert_eq!(no.code, "no_terminal");
        assert!(no.message.contains("worker-read --dispatch dispatch-2 --source transcript"), "{}", no.message);
        assert!(!named_dispatch(&req("terminal.read", json!({ "terminal": "term-4" }))), "a handle loads nothing");
        assert!(!named_dispatch(&req("orchestration.worker-show", json!({ "terminal": "dispatch-1" }))), "only terminal commands");
        assert_eq!(by_dispatch(&req("terminal.read", json!({ "terminal": "nine" })), &d).unwrap(), None);
    }

    /// T-089-d through the app's side with a stand-in hook and a fixture transcript (no real agent):
    /// worker-show takes the pane's own hook state (permission: yes from the hook; working during a
    /// tool call: an explicit no) and says no from the screen when no hook reports; worker-read reads
    /// the transcript the pane's hooks reported; terminal read by dispatch id reaches its terminal.
    #[test]
    fn t089d_worker_show_and_read_with_stand_in_hook_state() {
        const T: u32 = 926_101;
        const PANE: u32 = 926_201;
        let (dir, git_, store) = fix8_world("t089d");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        terminals.fake_session(T, &wd, Some("claude"));
        let row = |n: u32, terminal: Value| worker_row(json!({ "id": format!("dispatch-t089d-{n}"), "runId": null, "taskId": format!("task-t089d-{n}"), "status": "running", "released": false, "worktree": wd, "agent": "claude", "terminal": terminal }));
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, json!(T)), row(2, Value::Null)]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-t089d-1", "runId": null, "status": "dispatched" }), json!({ "id": "task-t089d-2", "runId": null, "status": "dispatched" })]).unwrap();
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args, pane: None, cli: String::new(), arrived: None };
        let show = || dispatch(&ctx, &req(WORKER_SHOW, json!({ "dispatch": "dispatch-t089d-1" }))).unwrap();

        let quiet = show();
        assert_eq!((quiet["waiting"].as_str(), quiet["waitingSource"].as_str()), (Some("no"), Some("prompt text")), "{quiet}");

        let transcript = dir.join("session.jsonl");
        let line = |i: u32, role: &str, text: &str| json!({ "type": role, "uuid": format!("u{i}"), "isSidechain": false, "message": { "id": format!("m{i}"), "role": role, "content": [{ "type": "text", "text": text }] } }).to_string();
        std::fs::write(&transcript, format!("{}\n{}\n", line(0, "user", "build it"), line(1, "assistant", "built"))).unwrap();
        let hook = |e: Value| crate::status::report(PANE, Some(T), crate::status::Agent::Claude, &e);
        hook(json!({ "hook_event_name": "UserPromptSubmit", "prompt": "build it", "transcript_path": transcript.to_string_lossy() }));
        hook(json!({ "hook_event_name": "PreToolUse", "tool_name": "Bash" }));
        let busy = show();
        assert_eq!((busy["waiting"].as_str(), busy["waitingSource"].as_str()), (Some("no"), Some("hook")), "a long tool call is no prompt: {busy}");
        hook(json!({ "hook_event_name": "PermissionRequest", "tool_name": "Write" }));
        let asked = show();
        assert_eq!((asked["waiting"].as_str(), asked["waitingSource"].as_str(), asked["attention"].as_str()), (Some("yes"), Some("hook"), Some("approval")), "{asked}");

        let read = dispatch(&ctx, &req(WORKER_READ, json!({ "dispatch": "dispatch-t089d-1" }))).unwrap();
        let turns: Vec<&str> = read["turns"].as_array().unwrap().iter().filter_map(|t| t["text"].as_str()).collect();
        assert_eq!((read["source"].as_str(), turns), (Some("transcript"), vec!["build it", "built"]), "{read}");
        assert_eq!((read["process"].as_str(), read["agentState"].as_str()), (Some("running"), Some("permission")), "the process verdict and the agent verdict stay apart");
        let out = dispatch(&ctx, &req(WORKER_READ, json!({ "dispatch": "dispatch-t089d-1", "source": "terminal" }))).unwrap();
        assert_eq!((out["source"].as_str(), out["fallback"].as_bool()), (Some("terminal output"), Some(false)));
        assert_eq!(dispatch(&ctx, &req(WORKER_READ, json!({ "dispatch": "dispatch-t089d-2", "source": "terminal" }))).unwrap_err().code, "no_terminal");

        let by_id = dispatch(&ctx, &req("terminal.read", json!({ "terminal": "dispatch-t089d-1" }))).unwrap();
        assert_eq!(by_id["terminal"], crate::terminal::handle_of(T));
        assert_eq!(dispatch(&ctx, &req("terminal.read", json!({ "terminal": "dispatch-t089d-2" }))).unwrap_err().code, "no_terminal");
        crate::status::terminal_ended(T);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// after-list row 625 (T-089-d): the transcript a pane's hooks reported stays on the dispatch row,
    /// so worker-read still reads it after the terminal ends and its hook sessions are retired.
    /// `via_exit` stamps through the terminal-exit path; else any worker command stamps it.
    fn fix625_run(tag: &str, t: u32, pane: u32, via_exit: bool) {
        let (dir, git_, store) = fix8_world(tag);
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        terminals.fake_session(t, &wd, Some("claude"));
        let id = format!("dispatch-{tag}");
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[worker_row(json!({ "id": id, "runId": null, "taskId": "task-625", "status": "running", "released": false, "worktree": wd, "agent": "claude", "terminal": t }))]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-625", "runId": null, "status": "dispatched" })]).unwrap();
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args, pane: None, cli: String::new(), arrived: None };
        let transcript = dir.join("session.jsonl");
        let line = |i: u32, role: &str, text: &str| json!({ "type": role, "uuid": format!("u{i}"), "isSidechain": false, "message": { "id": format!("m{i}"), "role": role, "content": [{ "type": "text", "text": text }] } }).to_string();
        std::fs::write(&transcript, format!("{}\n{}\n", line(0, "user", "build it"), line(1, "assistant", "built"))).unwrap();
        crate::status::report(pane, Some(t), crate::status::Agent::Claude, &json!({ "hook_event_name": "UserPromptSubmit", "prompt": "build it", "transcript_path": transcript.to_string_lossy() }));
        if via_exit {
            keep_transcript_of(&store.lock().unwrap(), t);
        } else {
            dispatch(&ctx, &req(WORKER_SHOW, json!({ "dispatch": id }))).unwrap();
        }
        crate::status::terminal_ended(t);
        let read = dispatch(&ctx, &req(WORKER_READ, json!({ "dispatch": id, "source": "transcript" }))).unwrap();
        let turns: Vec<&str> = read["turns"].as_array().unwrap().iter().filter_map(|x| x["text"].as_str()).collect();
        assert_eq!((read["source"].as_str(), turns), (Some("transcript"), vec!["build it", "built"]), "{read}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fix625_a_worker_command_keeps_the_transcript_on_the_row_past_the_terminal() {
        fix625_run("fix625a", 926_111, 926_211, false);
    }

    #[test]
    fn fix625_b_the_terminal_exit_keeps_the_transcript_on_the_row() {
        fix625_run("fix625b", 926_112, 926_212, true);
    }

    /// cli FIX-11 items 4 and 5 (council FIX-SOON 3 and AFTER 1 on 9afdd308): pending notes follow
    /// ORCH-033: an answer for a Run carries that Run's notes and those of rows with no Run, an answer
    /// for no Run carries all; a worker-show of another Run's row is not found and clears nothing.
    #[test]
    fn fix11_c_late_notes_stay_in_their_run_and_a_show_from_another_run_is_not_found() {
        let (dir, git_, store) = fix8_world("fix11c");
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let (run_a, run_b) = {
            let mut m = crate::orchestration::Mail::default();
            let a = m.run_create("term-1", "run a", 1)["binding"]["runId"].as_str().unwrap().to_string();
            let b = m.run_create("term-2", "run b", 2)["binding"]["runId"].as_str().unwrap().to_string();
            m.save(&store.lock().unwrap()).unwrap();
            (a, b)
        };
        let row = |n: u32, run: Value| worker_row(json!({ "id": format!("dispatch-fix11-c{n}"), "runId": run, "taskId": format!("task-fix11-c{n}"), "status": "stopped", "released": false, "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
        let task = |n: u32, run: Value| json!({ "id": format!("task-fix11-c{n}"), "runId": run, "status": "dispatched", "dispatchId": format!("dispatch-fix11-c{n}") });
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &[row(1, json!(run_a)), row(2, json!(run_b)), row(3, Value::Null)]).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &[task(1, json!(run_a)), task(2, json!(run_b)), task(3, Value::Null)]).unwrap();
        for (n, session) in [(1, 41), (2, 42), (3, 43)] {
            let d = format!("dispatch-fix11-c{n}");
            expect_stamp(&d);
            finish_stamp(&d, None, LATE_WINDOW);
            terminals.fake_session(session, &wd, Some("npx"));
            assert!(stamp_session(&d, session));
        }
        let call = |command: &str, run: Option<&str>, dispatch_id: Option<&str>| {
            let mut args = json!({});
            if let Some(r) = run {
                args["run"] = json!(r);
            }
            if let Some(d) = dispatch_id {
                args["dispatch"] = json!(d);
            }
            dispatch(&ctx, &Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args, pane: None, cli: String::new(), arrived: None })
        };
        let notes = |r: &Value| {
            let mut ids: Vec<String> = r["lateWorker"].as_array().into_iter().flatten().filter_map(|n| n["dispatchId"].as_str()).map(|d| d.trim_start_matches("dispatch-fix11-").to_string()).collect();
            ids.sort();
            ids
        };
        // The first call records the late sessions; each Run hears its own and the Run-less row's.
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_a), None).unwrap()), ["c1", "c3"]);
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_b), None).unwrap()), ["c2", "c3"]);
        assert_eq!(notes(&call(WORKER_LIST, None, None).unwrap()), ["c1", "c2", "c3"], "a caller tied to no Run hears all");
        // A show of Run A's row from Run B is not found, and clears nothing, however often.
        for _ in 0..3 {
            let e = call(WORKER_SHOW, Some(&run_b), Some("dispatch-fix11-c1")).unwrap_err();
            assert_eq!(e.code, "not_found", "{e:?}");
        }
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_a), None).unwrap()), ["c1", "c3"], "Run A's alarm is still up");
        // cli FIX-12 (council AFTER 2 on 28f3eb7a): the other answers of Run B never carry Run A's note either.
        assert_eq!(notes(&call(WORKER_SHOW, Some(&run_b), Some("dispatch-fix11-c2")).unwrap()), ["c2", "c3"], "a worker-show of Run B");
        let r = call(RELEASE, Some(&run_b), Some("dispatch-fix11-c2")).unwrap();
        assert_eq!(notes(&r), ["c2", "c3"], "a worker-release of Run B: {r}");
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_a), None).unwrap()), ["c1", "c3"], "Run A's alarm is still up after Run B's release");
        // Shows in the right Run clear that row only.
        call(WORKER_SHOW, Some(&run_a), Some("dispatch-fix11-c1")).unwrap();
        call(WORKER_SHOW, Some(&run_a), Some("dispatch-fix11-c1")).unwrap();
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_a), None).unwrap()), ["c3"]);
        assert_eq!(notes(&call(WORKER_LIST, Some(&run_b), None).unwrap()), ["c3"], "Run B's own row was released above; the Run-less row stays");
        for t in [41, 42, 43] {
            let _ = terminals.kill(t);
        }
        for n in 1..=3 {
            forget_stamp(&format!("dispatch-fix11-c{n}"));
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A world with late-agent rows `dispatch-<tag><n>` (n = 1..=sessions.len()), each stopped, its late
    /// session `sessions[n-1]` stamped to it and (when `existing`) started on an existing worktree, so a
    /// release leaves that terminal open.
    fn fix12_late_world(tag: &str, sessions: &[u32], existing: bool) -> (std::path::PathBuf, Git, Mutex<Store>, Terminals) {
        let (dir, git_, store) = fix8_world(tag);
        let terminals = Terminals::default();
        let wd = dir.display().to_string();
        let mut rows = vec![];
        let mut tasks = vec![];
        for (i, session) in sessions.iter().enumerate() {
            let n = i + 1;
            let (d, t) = (format!("dispatch-{tag}{n}"), format!("task-{tag}{n}"));
            let mut row = worker_row(json!({ "id": d, "runId": null, "taskId": t, "status": "stopped", "released": false, "worktree": wd, "agent": "claude", "terminal": null, "terminalProgram": null }));
            if existing {
                row["mode"] = json!("existing");
            }
            rows.push(row);
            tasks.push(json!({ "id": t, "status": "dispatched", "dispatchId": d }));
            expect_stamp(&d);
            finish_stamp(&d, None, LATE_WINDOW);
            terminals.fake_session(*session, &wd, Some("npx"));
            assert!(stamp_session(&d, *session));
        }
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &rows).unwrap();
        save_list(&store.lock().unwrap(), TASKS_KEY, &tasks).unwrap();
        (dir, git_, store, terminals)
    }

    /// cli FIX-12 item 1 (council FIX-SOON 1 on 28f3eb7a, decision): showing a row twice, or ten times,
    /// does not silence the alarm while its release left the late terminal open and that terminal still
    /// runs; the alarm ends when the terminal is closed (item 2: by hand too), and the fact stays.
    #[test]
    fn fix12_a_shows_do_not_silence_a_live_left_open_terminal_and_closing_it_spends_the_alarm() {
        let mut held = json!({ "id": "dispatch-1", "released": true, "terminalLeftOpen": "x", "latePending": true, "lateAfter": "stopped", "lateShown": true });
        read_late(&mut held, true);
        assert_eq!(held["latePending"], true, "a live left-open terminal keeps it: {held}");
        read_late(&mut held, false);
        assert!(held["latePending"].is_null(), "a terminal that is gone does not: {held}");
        let mut plain = json!({ "id": "dispatch-1", "released": false, "latePending": true, "lateAfter": "stopped", "lateShown": true });
        read_late(&mut plain, true);
        assert!(plain["latePending"].is_null(), "a row that was not left open clears on the later show as before: {plain}");

        let (dir, git_, store, terminals) = fix12_late_world("fix12a", &[51], true);
        let notify = |_: Value| {};
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let call = |command: &str| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": "dispatch-fix12a1" }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req).unwrap()
        };
        let r = call(RELEASE);
        assert!(r["terminalLeftOpen"].is_string() && terminals.live("term-51"), "{r}");
        for i in 0..4 {
            let r = call(WORKER_SHOW);
            assert_eq!(r["lateWorker"][0]["dispatchId"], "dispatch-fix12a1", "show {i} still tells the running agent: {r}");
        }
        let r = call(WORKER_LIST);
        assert_eq!((r["workers"][0]["latePending"].as_bool(), r["workers"][0]["terminalLeftOpen"].is_string()), (Some(true), true), "{r}");
        // Closed by the person: the next answer spends the alarm and keeps the fact.
        terminals.kill(51).unwrap();
        let r = call(WORKER_LIST);
        assert!(r["lateWorker"].is_null() && r["workers"][0]["latePending"].is_null(), "{r}");
        assert_eq!(r["workers"][0]["lateAfter"], "stopped", "the fact stays: {r}");
        let rows = load_list(&store.lock().unwrap(), DISPATCHES_KEY).unwrap();
        assert!(rows[0]["latePending"].is_null() && rows[0]["lateShown"].is_null() && rows[0]["lateAfter"] == "stopped", "{}", rows[0]);
        forget_stamp("dispatch-fix12a1");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-12 item 2 (council FIX-SOON 2 on 28f3eb7a): a late terminal closed by hand spends the
    /// alarm on any row, whether or not it was ever released; a release of such a row tells no running
    /// agent. The fact (lateAfter) stays for worker-show.
    #[test]
    fn fix12_b_a_late_terminal_that_is_gone_spends_the_alarm_and_keeps_the_fact() {
        let (dir, git_, store, terminals) = fix12_late_world("fix12b", &[52, 53], false);
        let notify = |_: Value| {};
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = dir.display().to_string();
        let call = |command: &str, n: u32| {
            let req = Request { id: "r".into(), token: String::new(), command: command.into(), cwd: wd.clone(), args: json!({ "dispatch": format!("dispatch-fix12b{n}") }), pane: None, cli: String::new(), arrived: None };
            dispatch(&ctx, &req).unwrap()
        };
        let r = call(WORKER_LIST, 1);
        assert_eq!(r["lateWorker"].as_array().map(Vec::len), Some(2), "{r}");
        terminals.kill(52).unwrap();
        terminals.kill(53).unwrap();
        // Releasing a row whose agent is already gone does not say an agent is running.
        let r = call(RELEASE, 1);
        assert!(r["lateWorker"].is_null(), "{r}");
        let r = call(WORKER_LIST, 1);
        assert!(r["lateWorker"].is_null(), "the other row's alarm is spent by the list: {r}");
        for w in r["workers"].as_array().unwrap() {
            assert!(w["latePending"].is_null() && w["lateAfter"] == "stopped", "{w}");
        }
        forget_stamp("dispatch-fix12b1");
        forget_stamp("dispatch-fix12b2");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// cli FIX-12 item 3 (council FIX-SOON 3 on 28f3eb7a): the worker-list line of a pending row names
    /// the way out that works: terminal close for a left-open terminal, worker-release otherwise, and
    /// never worker-show, which only ends the alarm. late_rows carries terminalLeftOpen.
    #[test]
    fn fix12_c_the_worker_list_text_names_the_way_out_that_works() {
        let row = |left_open: Option<&str>| {
            let mut w = json!({ "dispatchId": "dispatch-1", "terminalState": "released", "taskStatus": "dispatched", "terminal": "term-3", "worktree": "C:/w", "latePending": true, "lateAfter": "stopped", "lateStamp": true });
            if let Some(why) = left_open {
                w["terminalLeftOpen"] = json!(why);
            }
            text_of(WORKER_LIST, &json!({ "workers": [w], "scope": { "run": null, "from": "all" } }))
        };
        let plain = row(None);
        assert!(plain.contains("after the dispatch was stopped") && plain.contains("worker-release --dispatch dispatch-1"), "{plain}");
        assert!(!plain.contains("worker-show") && !plain.contains("left open"), "{plain}");
        let open = row(Some("term-3 was already open when it was handed to the worker"));
        assert!(open.contains("terminal is left open (term-3 was already open when it was handed to the worker)") && open.contains("terminal close --terminal term-3"), "{open}");
        assert!(!open.contains("worker-show") && !open.contains("worker-release"), "{open}");
        // The late fields on a listed row include the left-open reason.
        let d = json!({ "id": "dispatch-1", "runId": null, "released": true, "terminalLeftOpen": "why", "latePending": true, "lateAfter": "stopped" });
        let out = late_rows(json!({ "workers": [{ "dispatchId": "dispatch-1", "runId": null }] }), &[d]);
        assert_eq!(out["workers"][0]["terminalLeftOpen"], "why", "{out}");
    }

    /// cli FIX-7 (earlier AFTER on c5fb49c): the receipt says what the window does about setup, and
    /// a failed tiered start says its offered retry can be turned away from another agent's pane.
    #[test]
    fn fix7_e_receipt_notes_setup_and_the_tier_retry() {
        assert_eq!(setup_note("skip", true), None);
        assert!(setup_note("inherit", true).unwrap().contains("setup script"));
        assert!(setup_note("run", true).unwrap().contains("starts after it ends"), "T-172-d: the start waits for the setup");
        assert!(setup_note("inherit", false).unwrap().contains("no new worktree"));
        let failed = |tier: Value, run: Option<&str>| {
            let mut r = json!({ "dispatchId": "dispatch-4", "taskId": "task-2", "agent": "codex", "model": null, "effort": null, "tier": tier, "terminals": [{ "id": 7, "role": "worker" }], "worktree": { "path": "C:/Temp/wt-1", "created": true } });
            crate::orchestration::start_failed(&mut r, "worker", json!("not_configured"));
            start_failed_run(&mut r, run);
            r
        };
        let r = failed(json!("build"), Some("run-2"));
        let note = r["retryNote"].as_str().unwrap_or_default();
        assert!(note.contains("--agent codex") && note.contains("coordinator's own agent"), "{r}");
        // No tier, no note; an unsafe value drops the retry line, and with it the note.
        assert!(failed(Value::Null, Some("run-2"))["retryNote"].is_null());
        assert!(failed(json!("build"), Some("r;x"))["retryNote"].is_null());
    }

    /// cli FIX-6 item 5 (council AFTER 3 on 152e581): a pane that names another terminal with
    /// --from, while naming another Run with --run, is turned away as a caller mismatch before
    /// anything is made; naming itself, it is still held to its own Run.
    #[test]
    fn fix6_d_worker_start_from_a_pane_naming_another_terminal_is_a_mismatch() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-clifix6-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let (run_a, run_b) = {
            let mut m = crate::orchestration::Mail::default();
            let a = m.run_create("term-1", "run a", 1)["binding"]["runId"].as_str().unwrap().to_string();
            let b = m.run_create("term-2", "run b", 2)["binding"]["runId"].as_str().unwrap().to_string();
            m.save(&store.lock().unwrap()).unwrap();
            save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-2", "runId": a, "status": "pending" })]).unwrap();
            (a, b)
        };
        assert_ne!(run_a, run_b);
        // term-2 is the pane that runs this command; its secret is "key-b".
        let by_key = |k: &str| (k == "key-b").then(|| "term-2".to_string());
        let start = |from: Option<&str>, run: &str| {
            let mut args = json!({ "run": run, "task": "task-2", "agent": "no-such-agent" });
            if let Some(f) = from {
                args["from"] = json!(f);
            }
            let req = Request { id: "r".into(), token: String::new(), command: WORKER_START.into(), cwd: dir.display().to_string(), args, pane: Some(Pane { handle: "term-2".into(), key: "key-b".into() }), cli: String::new(), arrived: None };
            worker_start_with(&ctx, &req, &by_key).unwrap_err()
        };
        let e = start(Some("term-1"), &run_a);
        assert_eq!(e.code, "caller_mismatch", "{}", e.message);
        assert!(e.message.contains("term-2") && e.message.contains("term-1"), "{}", e.message);
        // Naming itself is a fine caller; Run A is not its Run, so the Run check turns it away.
        let e = start(Some("term-2"), &run_a);
        assert_ne!(e.code, "caller_mismatch", "{}", e.message);
        assert!(!e.message.contains("Kolux knows no agent"), "turned away before the agent is looked up: {}", e.message);
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CLI-002 / T-250-b: the grammar of the commands whose work is not built yet is already exact.
    #[test]
    fn t250b_a_cookie_set_keeps_an_empty_value_and_refuses_a_missing_one_skills_install_collects_every_skill() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let empty = ok("cookie set --name a --value=");
        assert_eq!((empty.command.as_str(), &empty.args["value"], &empty.args["name"]), ("browser.cookie-set", &json!(""), &json!("a")));
        assert!(parse(&words("cookie set --name a")).1.unwrap_err().message.contains("--value is required"));
        assert!(parse(&words("cookie set --name a --value")).1.unwrap_err().message.contains("--value needs a value"));
        // A value that starts with two dashes is taken only in the equals form.
        assert_eq!(ok("cookie set --name a --value=--x").args["value"], "--x");
        assert!(parse(&words("cookie set --name a --value --x")).1.is_err());
        let two = ok("skills install --skill a --skill b");
        assert_eq!(two.command, "skills.install");
        assert_eq!(two.args["skill"], json!(["a", "b"]));
        assert_eq!(ok("skills install --skill=only").args["skill"], json!(["only"]));
        // Ordinary text flags still keep one value and refuse a second, different one.
        assert!(parse(&words("worktree rm --worktree a --worktree b")).1.unwrap_err().message.contains("twice"));
        // cookie set and skills install are each routed, once.
        assert_eq!(commands().iter().filter(|c| c.0 == "cookie set").count(), 1);
        assert!(commands().iter().any(|c| c.0 == "skills install"));
    }

    #[test]
    fn t250b_b_the_file_words_take_a_bare_path_or_a_flag_and_check_their_values_before_any_lookup() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let bare = ok("file open src/a.rs");
        assert_eq!((bare.command.as_str(), &bare.args["path"]), ("file.open", &json!("src/a.rs")));
        assert_eq!(ok("file diff --path a.rs --staged --worktree name:x").args["staged"], true);
        assert_eq!(ok("file diff a.rs").args["path"], "a.rs");
        assert_eq!(ok("file open-changed").command, "file.open-changed");
        assert_eq!(ok("file open-changed --mode both").args["mode"], "both");
        assert!(parse(&words("file open a.rs --path b.rs")).1.unwrap_err().message.contains("twice"));
        assert!(parse(&words("file open a.rs --worktree")).1.unwrap_err().message.contains("--worktree needs a value"));
        assert!(parse(&words("file open a.rs --worktree=")).1.unwrap_err().message.contains("--worktree cannot be empty"));
        assert!(parse(&words("file open")).1.unwrap_err().message.contains("file path is required"));
        assert!(parse(&words("file open-changed --mode tabs")).1.unwrap_err().message.contains("--mode takes diff, edit or both"));
        assert!(parse(&words("file open a.rs --mode edit")).1.is_err());
        assert_eq!(help(&["file".to_string()]).1, 0);
    }

    #[test]
    fn t250b_c_file_open_diff_and_open_changed_tell_the_window_and_report_opened_and_skipped() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli250b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let commit = |cwd: &Path, file: &str, text: &str| {
            std::fs::write(cwd.join(file), text).unwrap();
            git(&["add", "-A"], cwd);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", file], cwd);
        };
        git(&["init", "-q", "-b", "main"], &repo);
        commit(&repo, "a.txt", "base\n");
        commit(&repo, "gone.txt", "bye\n");
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let sent: Mutex<Vec<Value>> = Mutex::new(Vec::new());
        // Row 65: a listening window that confirms every file it is told about.
        file_cli::ACKS.listen(true);
        let notify = |v: Value| {
            if let Some(id) = v["ack"].as_u64() {
                file_cli::ACKS.report(id, None);
            }
            sent.lock().unwrap().push(v);
        };
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        let one = PathBuf::from(dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "one" }))).unwrap()["path"].as_str().unwrap());
        sent.lock().unwrap().clear();
        std::fs::remove_file(one.join("gone.txt")).unwrap();
        std::fs::write(one.join("a.txt"), "changed\n").unwrap();
        std::fs::write(one.join("new.txt"), "fresh\n").unwrap();
        std::fs::create_dir_all(one.join("sub")).unwrap();
        std::fs::write(one.join("sub").join("deep.txt"), "x\n").unwrap();
        let tail = |v: &Value| v["path"].as_str().unwrap().rsplit(['/', '\\']).next().unwrap().to_string();

        // A relative path opens from the current folder inside the worktree.
        let r = dispatch(&ctx, &req("file.open", &one.join("sub"), json!({ "path": "deep.txt" }))).unwrap();
        assert_eq!(r["opened"], json!([{ "path": "sub/deep.txt", "kind": "edit", "staged": false }]));
        let ev = sent.lock().unwrap().pop().unwrap();
        assert_eq!((ev["kind"].as_str(), tail(&ev).as_str()), (Some("file-open"), "deep.txt"));
        assert_eq!(ev["worktree"].as_str().map(|w| w.replace('\\', "/")), Some(one.display().to_string().replace('\\', "/")));
        assert!(ev.get("branch").is_some());
        // The explicit --worktree skips the guess about the current folder.
        let r = dispatch(&ctx, &req("file.open", &dir, json!({ "path": "a.txt", "worktree": "name:one" }))).unwrap();
        assert_eq!(r["opened"][0]["path"], "a.txt");
        // A full path inside the worktree works; its top folder is refused and nothing is sent.
        let full = one.join("a.txt").display().to_string();
        assert_eq!(dispatch(&ctx, &req("file.open", &dir, json!({ "path": full, "worktree": "name:one" }))).unwrap()["opened"][0]["path"], "a.txt");
        sent.lock().unwrap().clear();
        let top = dispatch(&ctx, &req("file.open", &dir, json!({ "path": one.display().to_string(), "worktree": "name:one" }))).unwrap_err();
        assert_eq!(top.code, "not_a_file");
        assert!(sent.lock().unwrap().is_empty());
        // A file that is not there cannot be edited, but its diff can be shown.
        assert_eq!(dispatch(&ctx, &req("file.open", &one, json!({ "path": "gone.txt" }))).unwrap_err().code, "not_found");
        let d = dispatch(&ctx, &req("file.diff", &one, json!({ "path": "gone.txt", "staged": true }))).unwrap();
        assert_eq!(d["opened"][0], json!({ "path": "gone.txt", "kind": "diff", "staged": true }));
        assert_eq!(sent.lock().unwrap().last().unwrap()["kind"], "file-diff");

        // open-changed: diffs by default; editing skips the deleted file.
        sent.lock().unwrap().clear();
        let c = dispatch(&ctx, &req("file.open-changed", &one, json!({}))).unwrap();
        let mut diffs: Vec<String> = c["opened"].as_array().unwrap().iter().map(|o| o["path"].as_str().unwrap().to_string()).collect();
        diffs.sort();
        assert_eq!(diffs, vec!["a.txt", "gone.txt", "new.txt", "sub/deep.txt"]);
        assert_eq!(c["skipped"], json!([]));
        assert_eq!(sent.lock().unwrap().iter().filter(|e| e["kind"] == "file-diff").count(), 4);
        let e = dispatch(&ctx, &req("file.open-changed", &one, json!({ "mode": "edit" }))).unwrap();
        assert_eq!(e["skipped"], json!([{ "path": "gone.txt", "kind": "edit", "why": "deleted" }]));
        assert_eq!(e["opened"].as_array().unwrap().len(), 3);
        assert!(dispatch(&ctx, &req("file.open-changed", &one, json!({ "mode": "tabs" }))).is_err());
        file_cli::ACKS.listen(false);
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T-262-b: the terminal list, the worktree list and the peer list read the one session tab
    /// inventory, so a plain shell, an agent tab and the window's placement agree in all three.
    #[test]
    fn t262b_the_terminal_worktree_and_peer_lists_read_the_session_tab_inventory() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli262b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        std::fs::write(repo.join("a.txt"), "base\n").unwrap();
        git(&["add", "-A"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let wd = repo.display().to_string();
        terminals.fake_session(21, &wd, None);
        terminals.fake_session(22, &wd, Some("claude --permission-mode auto --token tok-secret-256"));
        terminals.set_layout(vec![
            json!({ "handle": "term-21", "dir": wd, "cell": 1, "tab": 1, "title": "pwsh", "custom": null, "shown": false, "ask": null }),
            json!({ "handle": "term-22", "dir": wd, "cell": 1, "tab": 2, "title": "Claude", "custom": null, "shown": true, "ask": null }),
        ]);
        let inventory: Vec<String> = crate::agents::inventory::tabs(&terminals).into_iter().map(|t| t.handle).collect();
        assert_eq!(inventory, ["term-21", "term-22"]);
        // The terminal list: the inventory's tabs with the window's placement and the agent credit.
        let rows = terminal_rows(&ctx).unwrap();
        assert_eq!(rows.iter().map(|r| r["handle"].as_str().unwrap()).collect::<Vec<_>>(), inventory);
        assert_eq!((rows[1]["title"].as_str(), rows[1]["pane"].as_u64(), rows[1]["tab"].as_u64(), rows[1]["shown"].as_bool(), rows[1]["agent"].as_str()), (Some("Claude"), Some(1), Some(2), Some(true), Some("claude")));
        assert_eq!((rows[0]["agent"].is_null(), rows[0]["shown"].as_bool()), (true, Some(false)));
        // The peer list: the same handles, the agent credit the inventory gives.
        let peer_list = peers(&ctx);
        assert_eq!(peer_list.iter().map(|p| p.handle.clone()).collect::<Vec<_>>(), inventory);
        assert_eq!((peer_list[0].agent.clone(), peer_list[1].agent.clone()), (None, Some("claude".to_string())));
        assert_eq!(peer_list[1].dir, wd);
        // The worktree list: both tabs sit in the worktree their start folder is in.
        let req = Request { id: "r".into(), token: String::new(), command: "worktree.ps".into(), cwd: wd.clone(), args: json!({}), pane: None, cli: String::new(), arrived: None };
        let ps = dispatch(&ctx, &req).unwrap();
        let listed: Vec<String> = ps["worktrees"].as_array().unwrap().iter().flat_map(|w| w["sessions"].as_array().unwrap().iter().map(|s| s["terminal"].as_str().unwrap().to_string())).collect();
        assert_eq!(listed, inventory);
        // Row 256: neither list carries the arguments of a program line (a key or token may sit there).
        let wire = format!("{} {}", serde_json::to_string(&rows).unwrap(), ps);
        assert!(!wire.contains("tok-secret-256"), "{wire}");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T-279-d: a task held after three failed hand-outs shows "held (3 failures)" in the text line,
    /// `orchestration task-reset` closes the breaker, and the task lists ready again.
    #[test]
    fn t279d_task_reset_frees_a_held_task_and_the_text_line_shows_the_held_label() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli279d-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new(), arrived: None };
        {
            let s = store.lock().unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-1", "spec": "add a test", "status": "ready", "deps": [] }), json!({ "id": "task-2", "spec": "other", "status": "ready", "deps": [] })]).unwrap();
            let failed = |n: u32, task: &str| json!({ "id": format!("dispatch-{n}"), "taskId": task, "runId": null, "status": "failed", "terminal": 3 });
            save_list(&s, DISPATCHES_KEY, &[failed(1, "task-1"), failed(2, "task-1"), failed(3, "task-1"), failed(4, "task-2")]).unwrap();
        }
        let line_of = |id: &str| -> String {
            let list = dispatch(&ctx, &req("orchestration.task-list", json!({}))).unwrap();
            text_of("orchestration.task-list", &list).lines().find(|l| l.starts_with(id)).unwrap().to_string()
        };
        assert!(line_of("task-1").contains("  held (3 failures)  "), "{}", line_of("task-1"));
        assert!(line_of("task-2").contains("  ready  "), "one failure is not held: {}", line_of("task-2"));
        // The command parses (one wire name, --id required) and the dispatch breaker is open.
        assert!(parse(&words("orchestration task-reset")).1.unwrap_err().message.contains("--id"));
        let (_, p) = parse(&words("orchestration task-reset --id task-1"));
        assert_eq!(p.unwrap().unwrap().command, "orchestration.task-reset");
        let out = dispatch(&ctx, &req("orchestration.task-reset", json!({ "id": "task-1" }))).unwrap();
        assert_eq!((out["cleared"].as_u64(), out["failures"].as_u64()), (Some(3), Some(0)));
        assert_eq!(text_of("orchestration.task-reset", &out), "task-1 released: 3 failed hand-outs are no longer counted; it lists ready again");
        assert!(line_of("task-1").contains("  ready  "), "{}", line_of("task-1"));
        assert!(!line_of("task-1").contains("held"));
        // The failed records stay (stamped) and a second reset changes nothing; an unknown task is refused.
        let kept = load_list(&store.lock().unwrap(), DISPATCHES_KEY).unwrap();
        assert_eq!(kept.iter().filter(|d| d["status"] == "failed" && !d["breakerReset"].is_null()).count(), 3);
        let again = dispatch(&ctx, &req("orchestration.task-reset", json!({ "id": "task-1" }))).unwrap();
        assert_eq!(text_of("orchestration.task-reset", &again), "task-1 had no counted failures; it is ready");
        assert_eq!(dispatch(&ctx, &req("orchestration.task-reset", json!({ "id": "task-9" }))).unwrap_err().code, "not_found");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn app019_a_second_launch_hands_its_markdown_files_to_the_running_copy() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-app019-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let told = Mutex::new(Vec::<Value>::new());
        let notify = |v: Value| told.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |args: Value| Request { id: "r".into(), token: String::new(), command: "app.open".into(), cwd: dir.display().to_string(), args, pane: None, cli: VERSION.into(), arrived: None };
        let md = if cfg!(windows) { "C:\\notes\\a b.md" } else { "/notes/a b.md" };
        // a plain `open` and an open with only other kinds of file queue nothing and tell the page nothing
        assert_eq!(dispatch(&ctx, &req(json!({}))).unwrap()["ready"], true);
        dispatch(&ctx, &req(json!({ "files": ["x.txt"] }))).unwrap();
        assert!(told.lock().unwrap().is_empty());
        dispatch(&ctx, &req(json!({ "files": [md, "x.txt"] }))).unwrap();
        assert_eq!(told.lock().unwrap().as_slice(), &[json!({ "emit": "open-files", "payload": null })]);
        assert_eq!(crate::lifecycle::take_open(), vec![md.to_string()], "only the markdown file was queued");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
