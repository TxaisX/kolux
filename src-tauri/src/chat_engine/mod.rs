//! The chat engine: each chat is one hidden `claude -p` process that reads and writes
//! stream-json (one JSON message per line on stdin and stdout). docs/chat-engine.md is the
//! contract for the page: the four commands, the `chat-event` event and its shapes, stop and
//! idle-sleep rules, and what is not known about the agent's side.
//!
//! - Any number of chats run at once, keyed by the page's chat id; the registry ([`Engines`]) is
//!   Tauri state, managed on first use so the app's setup block stays untouched.
//! - The process runs with the user's whole setup (hooks, skills, plugins, MCP, CLAUDE.md,
//!   memory): it is never started with `--bare`, and `CLAUDE_CODE_SIMPLE` (what `--bare` sets) is
//!   removed from its environment.
//! - Sign-in comes from [`crate::terminal::agent_env`], the same place terminal panes get it.
//! - Stop sends the documented `interrupt` control request; when no turn end follows within
//!   [`STOP_GRACE`], the process is ended and the next send resumes the session.
//! - Idle sleep: after [`IDLE_SLEEP`] with no turn running the process is ended; the session id is
//!   kept and the next send starts it again with `--resume`.
#![allow(dead_code)] // wired in the chat-app screens stage

pub mod events;
#[cfg(test)]
mod tests;

pub use events::{parse_line, ChatEvent, ExitReason, StopHow};

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The Tauri event every chat's events go out on; the payload is `{ chatId, kind, ... }`.
pub const EVENT: &str = "chat-event";
/// Idle sleep: a chat's process ends after this long with no turn running.
pub const IDLE_SLEEP: Duration = Duration::from_secs(10 * 60);
/// How long `chat_stop` waits for the interrupted turn to end before it ends the process.
pub const STOP_GRACE: Duration = Duration::from_secs(5);
/// The environment variable `--bare` sets; removed so a chat always loads the user's setup.
pub const BARE_ENV: &str = "CLAUDE_CODE_SIMPLE";

/// Where each event goes: the chat id and the event. The app sends it to the page; tests collect it.
pub type Sink = Arc<dyn Fn(&str, &ChatEvent) + Send + Sync>;

/// A program to run instead of `claude` found on PATH (tests run a stub through node).
#[derive(Clone, Debug)]
pub struct Launch {
    pub program: PathBuf,
    pub pre_args: Vec<String>,
}

/// Engine settings; the app uses the defaults, tests shorten the times.
#[derive(Clone, Debug)]
pub struct Config {
    pub launch: Option<Launch>,
    pub idle: Duration,
    pub stop_grace: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Config { launch: None, idle: IDLE_SLEEP, stop_grace: STOP_GRACE }
    }
}

/// What a chat is started with.
#[derive(Clone, Debug)]
pub struct Spec {
    pub cwd: PathBuf,
    pub model: Option<String>,
    /// Variables added to the inherited environment (sign-in first, then the caller's own).
    pub env: Vec<(String, String)>,
}

/// An image sent with a message.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Image {
    #[serde(alias = "mediaType")]
    pub media_type: String,
    pub base64: String,
}

/// The command line after the program. Never contains `--bare`.
pub fn claude_args(model: Option<&str>, resume: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"].map(String::from).to_vec();
    if let Some(m) = model {
        a.extend(["--model".to_string(), m.to_string()]);
    }
    if let Some(r) = resume {
        a.extend(["--resume".to_string(), r.to_string()]);
    }
    a
}

/// A model name or session id may reach `cmd.exe /c` (a `claude.cmd` shim), so only plain
/// characters pass: letters, digits and `-._:[]/@` for a model, letters, digits and `-` for a session.
fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 200 && m.chars().all(|c| c.is_ascii_alphanumeric() || "-._:[]/@".contains(c))
}

fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The user message line written to stdin.
pub fn user_line(text: &str, images: &[Image]) -> String {
    let mut content = vec![serde_json::json!({ "type": "text", "text": text })];
    for i in images {
        content.push(serde_json::json!({ "type": "image", "source": { "type": "base64", "media_type": i.media_type, "data": i.base64 } }));
    }
    serde_json::json!({ "type": "user", "message": { "role": "user", "content": content }, "parent_tool_use_id": null }).to_string()
}

/// The interrupt control request line written to stdin by `chat_stop`.
pub fn interrupt_line(request_id: &str) -> String {
    serde_json::json!({ "type": "control_request", "request_id": request_id, "request": { "subtype": "interrupt" } }).to_string()
}

static REQUESTS: AtomicU64 = AtomicU64::new(1);

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
    pid: u32,
    gen: u64,
}

struct Inner {
    spec: Spec,
    session_id: Option<String>,
    child: Option<Running>,
    gen: u64,
    busy: bool,
    last_active: Instant,
    closing: bool,
    /// The process ended on purpose last: its generation, why, and its exit code.
    ending: Option<(u64, ExitReason, Option<i32>)>,
}

/// One chat.
pub struct Engine {
    id: String,
    cfg: Config,
    sink: Sink,
    inner: Mutex<Inner>,
}

fn lock(m: &Mutex<Inner>) -> std::sync::MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Engine {
    fn emit(&self, ev: &ChatEvent) {
        (self.sink)(&self.id, ev);
    }

    /// Starts the process (resuming `session_id` when set). Called with the lock held.
    fn spawn(self: &Arc<Self>, inner: &mut Inner) -> Result<(), String> {
        let (program, pre) = match &self.cfg.launch {
            Some(l) => (l.program.clone(), l.pre_args.clone()),
            None => (crate::agents::find_program("claude").ok_or("Claude Code was not found on PATH. Install it, then open the chat again.")?, Vec::new()),
        };
        let resume = inner.session_id.clone();
        let args = claude_args(inner.spec.model.as_deref(), resume.as_deref());
        let shim = program.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
        let mut cmd = if shim {
            let mut c = crate::winproc::command(crate::pty::system_program("cmd.exe"));
            c.arg("/d").arg("/c").arg(&program);
            c
        } else {
            crate::winproc::command(&program)
        };
        cmd.args(&pre).args(&args).current_dir(&inner.spec.cwd).envs(inner.spec.env.iter().map(|(k, v)| (k, v))).env_remove(BARE_ENV);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Could not start Claude Code: {e}"))?;
        let pid = child.id();
        let (stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        inner.gen += 1;
        let gen = inner.gen;
        inner.child = Some(Running { child, stdin, pid, gen });
        inner.busy = false;
        inner.last_active = Instant::now();
        self.emit(&ChatEvent::Started { pid, resumed: resume });
        if let Some(err) = stderr {
            let me = Arc::clone(self);
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    me.emit(&ChatEvent::Stderr { line });
                }
            });
        }
        if let Some(out) = stdout {
            let me = Arc::clone(self);
            std::thread::spawn(move || me.read_stdout(out, gen));
        }
        Ok(())
    }

    fn read_stdout(self: Arc<Self>, out: std::process::ChildStdout, gen: u64) {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let Some(ev) = parse_line(&line) else { continue };
            {
                let mut inner = lock(&self.inner);
                match &ev {
                    ChatEvent::Init(i) if !i.session_id.is_empty() => inner.session_id = Some(i.session_id.clone()),
                    ChatEvent::Result(r) => {
                        if let Some(id) = &r.session_id {
                            inner.session_id = Some(id.clone());
                        }
                        if inner.gen == gen {
                            inner.busy = false;
                            inner.last_active = Instant::now();
                        }
                    }
                    _ => {}
                }
            }
            self.emit(&ev);
        }
        // Stdout closed: the process is ending. Collect it and say why it ended.
        let (running, ended) = {
            let mut inner = lock(&self.inner);
            let running = if inner.child.as_ref().is_some_and(|r| r.gen == gen) { inner.child.take() } else { None };
            if inner.gen == gen {
                inner.busy = false;
            }
            let ended = if inner.ending.is_some_and(|(g, _, _)| g == gen) { inner.ending.take() } else { None };
            (running, ended)
        };
        let (code, reason) = match ended {
            Some((_, reason, code)) => (code, reason),
            None => {
                let code = running.and_then(|mut r| {
                    drop(r.stdin.take());
                    wait_or_kill(&mut r.child, r.pid, Duration::from_secs(3))
                });
                (code, if code == Some(0) { ExitReason::Ended } else { ExitReason::Crashed })
            }
        };
        self.emit(&ChatEvent::Exit { code, reason });
    }

    /// Ends the current process on purpose and records why, so its stdout reader reports the
    /// exit with `reason`. The process leaves the chat at once: a send right after starts a new one.
    fn end_process(inner: &mut Inner, reason: ExitReason) {
        if let Some(mut r) = inner.child.take() {
            drop(r.stdin.take());
            crate::procs::kill_tree(r.pid);
            let _ = r.child.kill();
            let code = r.child.wait().ok().and_then(|s| s.code());
            inner.ending = Some((r.gen, reason, code));
        }
        inner.busy = false;
    }

    fn send(self: &Arc<Self>, text: &str, images: &[Image]) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        if inner.closing {
            return Err("This chat is closed.".into());
        }
        if inner.child.is_none() {
            self.spawn(&mut inner)?;
        }
        let line = user_line(text, images);
        let stdin = inner.child.as_mut().and_then(|r| r.stdin.as_mut()).ok_or("The chat's process is not running.")?;
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.write_all(b"\n")).and_then(|_| stdin.flush()).map_err(|e| format!("Could not send to Claude Code: {e}"))?;
        inner.busy = true;
        inner.last_active = Instant::now();
        Ok(())
    }

    /// Stops the running turn. Returns how, or `None` when no turn was running.
    fn stop(&self) -> Option<StopHow> {
        let request = format!("kolux-stop-{}", REQUESTS.fetch_add(1, Ordering::Relaxed));
        let gen = {
            let mut inner = lock(&self.inner);
            if !inner.busy {
                return None;
            }
            let gen = inner.gen;
            let line = interrupt_line(&request);
            let sent = inner.child.as_mut().and_then(|r| r.stdin.as_mut()).is_some_and(|s| s.write_all(line.as_bytes()).and_then(|_| s.write_all(b"\n")).and_then(|_| s.flush()).is_ok());
            if !sent {
                Self::end_process(&mut inner, ExitReason::Stopped);
                drop(inner);
                self.emit(&ChatEvent::Stopped { how: StopHow::Ended });
                return Some(StopHow::Ended);
            }
            gen
        };
        let end = Instant::now() + self.cfg.stop_grace;
        loop {
            {
                let mut inner = lock(&self.inner);
                if !inner.busy || inner.gen != gen {
                    break;
                }
                if Instant::now() >= end {
                    Self::end_process(&mut inner, ExitReason::Stopped);
                    drop(inner);
                    self.emit(&ChatEvent::Stopped { how: StopHow::Ended });
                    return Some(StopHow::Ended);
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.emit(&ChatEvent::Stopped { how: StopHow::Interrupt });
        Some(StopHow::Interrupt)
    }

    fn close(&self) {
        let mut inner = lock(&self.inner);
        inner.closing = true;
        Self::end_process(&mut inner, ExitReason::Closed);
    }

    /// Idle sleep: ends the process after `cfg.idle` with no turn running. Runs until the chat closes.
    fn watch_idle(self: Arc<Self>) {
        let tick = (self.cfg.idle / 4).clamp(Duration::from_millis(10), Duration::from_secs(1));
        loop {
            std::thread::sleep(tick);
            let mut inner = lock(&self.inner);
            if inner.closing {
                return;
            }
            if inner.child.is_some() && !inner.busy && inner.last_active.elapsed() >= self.cfg.idle {
                Self::end_process(&mut inner, ExitReason::Sleep);
            }
        }
    }

    /// The session id the chat resumes with, once the agent named one.
    pub fn session_id(&self) -> Option<String> {
        lock(&self.inner).session_id.clone()
    }

    /// Whether a process is running for the chat right now.
    pub fn is_running(&self) -> bool {
        lock(&self.inner).child.is_some()
    }
}

/// Waits for `child` up to `grace`, then ends its tree. The exit code when it had one.
fn wait_or_kill(child: &mut Child, pid: u32, grace: Duration) -> Option<i32> {
    let end = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                crate::procs::kill_tree(pid);
                let _ = child.kill();
                return child.wait().ok().and_then(|s| s.code());
            }
        }
    }
}

/// Every open chat, by chat id. No count limit.
#[derive(Clone, Default)]
pub struct Engines {
    map: Arc<Mutex<HashMap<String, Arc<Engine>>>>,
    cfg: Config,
}

impl Engines {
    pub fn new(cfg: Config) -> Self {
        Engines { map: Arc::default(), cfg }
    }

    fn get(&self, chat_id: &str) -> Result<Arc<Engine>, String> {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).get(chat_id).cloned().ok_or_else(|| format!("No open chat {chat_id}."))
    }

    /// Opens a chat and starts its process. A chat id already open is closed first.
    pub fn start(&self, chat_id: &str, spec: Spec, resume_session_id: Option<String>, sink: Sink) -> Result<(), String> {
        if let Some(m) = &spec.model {
            if !valid_model(m) {
                return Err(format!("\"{m}\" is not a model name."));
            }
        }
        if let Some(r) = &resume_session_id {
            if !valid_session(r) {
                return Err(format!("\"{r}\" is not a session id."));
            }
        }
        if !Path::new(&spec.cwd).is_dir() {
            return Err(format!("The folder {} does not exist.", spec.cwd.display()));
        }
        self.close(chat_id);
        let engine = Arc::new(Engine {
            id: chat_id.to_string(),
            cfg: self.cfg.clone(),
            sink,
            inner: Mutex::new(Inner { spec, session_id: resume_session_id, child: None, gen: 0, busy: false, last_active: Instant::now(), closing: false, ending: None }),
        });
        {
            let mut inner = lock(&engine.inner);
            engine.spawn(&mut inner)?;
        }
        let watcher = Arc::clone(&engine);
        std::thread::spawn(move || watcher.watch_idle());
        self.map.lock().unwrap_or_else(|e| e.into_inner()).insert(chat_id.to_string(), engine);
        Ok(())
    }

    /// Sends a message; a sleeping (or crashed) chat starts again with `--resume` first.
    pub fn send(&self, chat_id: &str, text: &str, images: &[Image]) -> Result<(), String> {
        self.get(chat_id)?.send(text, images)
    }

    /// Stops the running turn and keeps the chat resumable. `None` when no turn was running.
    pub fn stop(&self, chat_id: &str) -> Result<Option<StopHow>, String> {
        Ok(self.get(chat_id)?.stop())
    }

    /// Closes a chat and ends its process. Closing a chat that is not open does nothing.
    pub fn close(&self, chat_id: &str) {
        let engine = self.map.lock().unwrap_or_else(|e| e.into_inner()).remove(chat_id);
        if let Some(e) = engine {
            e.close();
        }
    }

    /// Ends every chat's process (the app is quitting).
    pub fn close_all(&self) {
        let all: Vec<Arc<Engine>> = self.map.lock().unwrap_or_else(|e| e.into_inner()).drain().map(|(_, e)| e).collect();
        for e in all {
            e.close();
        }
    }

    pub fn engine(&self, chat_id: &str) -> Option<Arc<Engine>> {
        self.get(chat_id).ok()
    }
}

/// The app's registry, made Tauri state on first use (the setup block is not edited for it).
fn engines(app: &tauri::AppHandle) -> Engines {
    use tauri::Manager;
    if app.try_state::<Engines>().is_none() {
        app.manage(Engines::default());
    }
    app.state::<Engines>().inner().clone()
}

/// The page's payload: the chat id beside the event's own fields.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload<'a> {
    pub chat_id: &'a str,
    #[serde(flatten)]
    pub event: &'a ChatEvent,
}

fn app_sink(app: &tauri::AppHandle) -> Sink {
    use tauri::Emitter;
    let app = app.clone();
    Arc::new(move |chat_id: &str, event: &ChatEvent| {
        let _ = app.emit(EVENT, Payload { chat_id, event });
    })
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Opens chat `chat_id` in `cwd` and starts its hidden `claude` process.
#[tauri::command]
pub async fn chat_start(app: tauri::AppHandle, chat_id: String, cwd: String, model: Option<String>, resume_session_id: Option<String>, extra_env: Vec<(String, String)>) -> Result<(), String> {
    use tauri::Manager;
    let sign_in = {
        let store = app.state::<Mutex<crate::state::Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        crate::terminal::agent_env(&store, &settings, Some("claude"), None, None, &extra_env)?.env
    };
    // The caller's own variables first; the sign-in wins (ACCT-024 already refused a clash).
    let env: Vec<(String, String)> = extra_env.into_iter().chain(sign_in).collect();
    let (engines, sink) = (engines(&app), app_sink(&app));
    blocking(move || engines.start(&chat_id, Spec { cwd: PathBuf::from(cwd), model, env }, resume_session_id, sink)).await
}

/// Sends `text` (and images) to chat `chat_id` as the next user message.
#[tauri::command]
pub async fn chat_send(app: tauri::AppHandle, chat_id: String, text: String, images: Vec<Image>) -> Result<(), String> {
    let engines = engines(&app);
    blocking(move || engines.send(&chat_id, &text, &images)).await
}

/// Stops chat `chat_id`'s running turn: `"interrupt"`, `"ended"`, or `null` when none was running.
#[tauri::command]
pub async fn chat_stop(app: tauri::AppHandle, chat_id: String) -> Result<Option<StopHow>, String> {
    let engines = engines(&app);
    blocking(move || engines.stop(&chat_id)).await
}

/// Closes chat `chat_id` and ends its process. Named `chat_end` because the pane chat
/// (`chat.rs`, retired in stage 4) already registers a `chat_close` command.
#[tauri::command]
pub async fn chat_end(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
    let engines = engines(&app);
    blocking(move || {
        engines.close(&chat_id);
        Ok(())
    })
    .await
}

/// Ends every chat's process; called once from the app's quit path.
pub fn close_all(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(engines) = app.try_state::<Engines>() {
        engines.close_all();
    }
}
