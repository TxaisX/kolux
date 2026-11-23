//! The chat engine: each chat is one hidden agent process (`claude`, or `openclaude` for the other
//! models, 2026-11-20) that reads and writes
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
    /// The agent whose program runs the chat: `claude`, or `openclaude` for the other models
    /// (2026-11-20). Both speak the same stream-json CLI; nothing else does yet.
    pub agent: String,
    pub cwd: PathBuf,
    pub model: Option<String>,
    /// The effort level this conversation runs at (`--effort`); none keeps the program's own.
    pub effort: Option<String>,
    /// Variables added to the inherited environment (sign-in first, then the caller's own).
    pub env: Vec<(String, String)>,
    /// The context line this chat hands off at (`handoff::at`, 0 turns it off). At or past it the
    /// turn's process is ended and the next message starts a fresh conversation.
    pub handoff_at: u64,
    /// The chat's handoff note, given to Claude Code as an appended system prompt so the agent keeps
    /// the work on paper across a handoff. `None` for an agent whose CLI is not known to take one.
    pub handoff_note: Option<PathBuf>,
}

/// The agents a chat can run today. Both are Claude Code's CLI shape; an id outside this list has no
/// chat engine, so `chat_start` refuses it instead of starting a program that cannot read the lines.
pub const CHAT_AGENTS: [&str; 2] = ["claude", "openclaude"];

/// The gateway OpenClaude's model list in the window (seats.ts, `openclaude`) is taken from: every id
/// there is an OpenRouter name, so a picked model is routed there. A chat started with no model adds
/// no provider and keeps whatever OpenClaude is configured for ("Program default").
pub const OPENCLAUDE_PROVIDER: &str = "openrouter";

/// The permission mode that lets a chat act with no prompt (DT-C283). Claude Code's `auto` is not a
/// mode OpenClaude knows: it quietly falls back to `default`, where every tool call is refused, so
/// OpenClaude gets `bypassPermissions` — the same "never ask" rule under the name it does know.
fn permission_mode(agent: &str) -> &'static str {
    if agent == "openclaude" {
        "bypassPermissions"
    } else {
        "auto"
    }
}

/// An image sent with a message.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Image {
    #[serde(alias = "mediaType")]
    pub media_type: String,
    pub base64: String,
}

/// The effort levels a chat accepts: OpenClaude's own list, also understood by Claude Code. `ultracode`
/// stays OpenClaude-only.
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const OPENCLAUDE_EFFORTS: [&str; 6] = ["low", "medium", "high", "xhigh", "max", "ultracode"];

pub fn valid_effort(agent: &str, effort: &str) -> bool {
    if agent == "openclaude" {
        OPENCLAUDE_EFFORTS.contains(&effort)
    } else {
        EFFORTS.contains(&effort)
    }
}

/// The command line after the program. Never contains `--bare`.
pub fn chat_args(agent: &str, model: Option<&str>, effort: Option<&str>, resume: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", permission_mode(agent)].map(String::from).to_vec();
    if let Some(m) = model {
        if agent == "openclaude" {
            a.extend(["--provider".to_string(), OPENCLAUDE_PROVIDER.to_string()]);
        }
        a.extend(["--model".to_string(), m.to_string()]);
    }
    if let Some(e) = effort {
        a.extend(["--effort".to_string(), e.to_string()]);
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
    /// The prompt size of the last main-conversation message this process wrote (its input plus both
    /// cache parts). The turn's `result` carries the whole turn's usage, summed across every tool
    /// call, so it cannot be the context size; the last message's own usage is. Cleared at every
    /// spawn and taken at every result, so a turn that reports nothing is never guessed at.
    last_prompt: Option<u64>,
    /// User messages written to this process whose turn has not reported its result yet. Claude Code
    /// queues a message sent while a turn runs, so a handoff waits until this is back to 0: ending
    /// the process earlier would lose what the user wrote. 0 at every spawn.
    outstanding: u32,
    /// A reading crossed the handoff line while messages were still outstanding: the handoff fires on
    /// the first result that leaves none. Holds the reading that crossed.
    handoff_due: Option<u64>,
    /// The process was handed off and the next one cannot take the note on its command line
    /// (OpenClaude, or Claude Code through a `.cmd` shim): the next message carries it instead.
    note_due: bool,
    child: Option<Running>,
    gen: u64,
    busy: bool,
    last_active: Instant,
    closing: bool,
    /// The process ended on purpose last: its generation, why, and its exit code.
    ending: Option<(u64, ExitReason, Option<i32>)>,
}

impl Inner {
    /// A main-conversation message's usage, read by the stdout reader of process `gen`.
    fn saw_usage(&mut self, gen: u64, usage: Option<&serde_json::Value>) {
        // Review P2-C (2026-11-23): a late line from an ended process is not this process's reading.
        if self.gen != gen {
            return;
        }
        if let Some(tokens) = prompt_tokens(usage) {
            self.last_prompt = Some(tokens);
        }
    }

    /// A turn's result, read by the stdout reader of process `gen`. Answers the reading and the line
    /// when the chat hands off now: a reading at or past the line marks the handoff due, and it fires
    /// on the first result that leaves no message of the user's outstanding.
    fn handoff_after_result(&mut self, gen: u64) -> Option<(u64, u64)> {
        if self.gen != gen {
            return None;
        }
        self.outstanding = self.outstanding.saturating_sub(1);
        let reading = self.last_prompt.take();
        let at = self.spec.handoff_at;
        if at == 0 || self.closing {
            return None;
        }
        if let Some(tokens) = reading.filter(|t| *t >= at) {
            self.handoff_due = Some(self.handoff_due.map_or(tokens, |due| due.max(tokens)));
        }
        if self.outstanding > 0 {
            return None;
        }
        self.handoff_due.take().map(|tokens| (tokens, at))
    }

    /// One line the stdout reader of process `gen` read: the chat's state follows it. Answers whether
    /// the page hears the line, and the handoff it fires (the reading and the line), if any.
    fn heard(&mut self, gen: u64, ev: &ChatEvent) -> (bool, Option<(u64, u64)>) {
        let current = self.gen == gen;
        match ev {
            // Review P3 (2026-11-23): a late line from an ended process never names the session the
            // chat resumes, and its init is not this process's start.
            ChatEvent::Init(_) if !current => return (false, None),
            ChatEvent::Init(i) if !i.session_id.is_empty() => self.session_id = Some(i.session_id.clone()),
            ChatEvent::Assistant { parent_tool_use_id, usage, .. } => {
                // A reply still being written keeps the chat awake.
                if current {
                    self.last_active = Instant::now();
                }
                // The reading is the last main-conversation message's own usage: the turn's `result`
                // sums every tool call of the turn, which is not how full the window is.
                if parent_tool_use_id.is_none() {
                    self.saw_usage(gen, usage.as_ref());
                }
            }
            ChatEvent::Result(r) => {
                // Txais (2026-11-21): a chat is handed off at the same line a pane is. The last message's
                // usage is the reading (never a guess); at or past the line the process ends and the next
                // message starts a fresh conversation, with the note on paper. A turn with no reading
                // leaves the chat running.
                // Review P1-A (2026-11-23): never while a message the user wrote is still queued in the
                // process; see `handoff_after_result`.
                let handoff = self.handoff_after_result(gen);
                if current {
                    if let Some(id) = &r.session_id {
                        self.session_id = Some(id.clone());
                    }
                    // Review P2 (2026-11-23): a message queued behind this turn still runs, so the chat
                    // stays busy (no idle sleep, Stop still stops it) until its own result.
                    self.busy = self.outstanding > 0;
                    self.last_active = Instant::now();
                }
                if let Some(cleared) = handoff {
                    self.session_id = None;
                    self.note_due = true;
                    Engine::end_process(self, ExitReason::Handoff);
                    return (true, Some(cleared));
                }
            }
            _ => {}
        }
        (true, None)
    }
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
        let agent = inner.spec.agent.clone();
        let (program, pre) = match &self.cfg.launch {
            Some(l) => (l.program.clone(), l.pre_args.clone()),
            None => (crate::agents::find_program(&agent).ok_or_else(|| format!("{} was not found on PATH. Install it, then open the chat again.", crate::agents::agent_name(&agent)))?, Vec::new()),
        };
        let resume = inner.session_id.clone();
        let mut args = chat_args(&agent, inner.spec.model.as_deref(), inner.spec.effort.as_deref(), resume.as_deref());
        let shim = program.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
        if notes_on_line(&agent, shim) {
            if let Some(note) = inner.spec.handoff_note.as_deref() {
                args.push("--append-system-prompt".to_string());
                args.push(note_prompt(note));
            }
            // The note is on this line already; the first message need not carry it as well.
            inner.note_due = false;
        }
        let mut cmd = if shim {
            let mut c = crate::winproc::command(crate::pty::system_program("cmd.exe"));
            c.arg("/d").arg("/c").arg(&program);
            c
        } else {
            crate::winproc::command(&program)
        };
        cmd.args(&pre).args(&args).current_dir(&inner.spec.cwd).envs(inner.spec.env.iter().map(|(k, v)| (k, v))).env_remove(BARE_ENV);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", crate::agents::agent_name(&agent)))?;
        let pid = child.id();
        let (stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        inner.gen += 1;
        let gen = inner.gen;
        inner.child = Some(Running { child, stdin, pid, gen });
        inner.last_prompt = None;
        inner.outstanding = 0;
        inner.handoff_due = None;
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
            let (heard, cleared) = lock(&self.inner).heard(gen, &ev);
            if heard {
                self.emit(&ev);
            }
            if let Some((tokens, at)) = cleared {
                self.emit(&ChatEvent::Handoff { tokens, at });
            }
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
        // Review P2-D (2026-11-23): the first message after a handoff carries the note when the process
        // could not take it on its command line. It goes inside the JSON line, never on a command line.
        let line = match inner.spec.handoff_note.as_deref().filter(|_| inner.note_due) {
            Some(note) => user_line(&note_message(note, text), images),
            None => user_line(text, images),
        };
        let agent = inner.spec.agent.clone();
        let stdin = inner.child.as_mut().and_then(|r| r.stdin.as_mut()).ok_or("The chat's process is not running.")?;
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.write_all(b"\n")).and_then(|_| stdin.flush()).map_err(|e| format!("Could not send to {}: {e}", crate::agents::agent_name(&agent)))?;
        inner.note_due = false;
        inner.outstanding = inner.outstanding.saturating_add(1);
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
        // Review P2 (2026-11-23): a fresh conversation starts from the note too. A process that takes it
        // on its command line clears this at spawn; any other (OpenClaude, a shim) carries it in the
        // first message. A resumed conversation already has it.
        let note_due = spec.handoff_note.is_some() && resume_session_id.is_none();
        let engine = Arc::new(Engine {
            id: chat_id.to_string(),
            cfg: self.cfg.clone(),
            sink,
            inner: Mutex::new(Inner { spec, session_id: resume_session_id, last_prompt: None, outstanding: 0, handoff_due: None, note_due, child: None, gen: 0, busy: false, last_active: Instant::now(), closing: false, ending: None }),
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

/// The prompt size a message reports: uncached input plus the cache write plus the cache read, the
/// three parts of the prompt (the same sum `hooks.rs` takes from a status line). `None` when the
/// message carried no usage at all, which is never guessed at.
fn prompt_tokens(usage: Option<&serde_json::Value>) -> Option<u64> {
    let u = usage?;
    let n = |k: &str| u.get(k).and_then(serde_json::Value::as_u64);
    let sum = n("input_tokens")?.checked_add(n("cache_creation_input_tokens").unwrap_or(0))?.checked_add(n("cache_read_input_tokens").unwrap_or(0))?;
    Some(sum)
}

/// Whether the handoff note may ride on the command line. It is Claude Code's own flag, so an agent
/// whose CLI is not known to take it gets no note. A `.cmd`/`.bat` shim never gets one either: the
/// note is free text the agent itself writes, and through `cmd.exe /c` a newline would cut the line
/// short and a `&` would start another command (the same reason `add_team` skips a shim).
fn notes_on_line(agent: &str, shim: bool) -> bool {
    agent == "claude" && !shim
}

/// The handoff note as an appended system prompt: the file's own words, capped so a long note never
/// crowds the window it is meant to protect. A note that cannot be read adds nothing.
fn note_prompt(note: &Path) -> String {
    // Review P3-E (2026-11-23): a NUL would end the string the CLI reads; it is never part of a note.
    let text = std::fs::read_to_string(note).unwrap_or_default().replace('\0', "");
    let mut kept: String = text.chars().take(8_000).collect();
    if kept.chars().count() < text.chars().count() {
        kept.push_str("\n\n(The handoff note is longer; read the file for the rest.)");
    }
    format!("Your handoff note is at {}. Keep it current as you work: the chat hands off at the context line, and this note is what the next conversation starts from.\n\n{}", note.display(), kept)
}

/// The first message after a handoff, for a process that could not take the note on its command
/// line: the note first, then what the user wrote. Review P2 (2026-11-23): the note rides in a
/// `<system-reminder>` envelope, which every transcript read hides (`chat.rs` `HIDDEN_TAGS`), so a
/// reopened chat shows only the user's own words. The note is free text: a closing tag inside it is
/// broken so it can never end the envelope early.
pub(crate) fn note_message(note: &Path, text: &str) -> String {
    let body = note_prompt(note).replace("</system-reminder", "</system_reminder");
    format!("<system-reminder>\n{body}\n</system-reminder>\n\n{text}")
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

/// Opens chat `chat_id` in `cwd` and starts its hidden agent process: `claude`, or `openclaude`
/// when the page asks for it (2026-11-20). `agent` left out means Claude Code, as before. `effort`
/// (2026-11-21) is the level the conversation runs at; a later pick restarts the process and resumes
/// the same session on the new model or effort.
// Each argument is a field the page sends by name (lively added `effort` as the eighth); a struct
// would change the page's call, so the count is allowed here.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn chat_start(app: tauri::AppHandle, chat_id: String, cwd: String, model: Option<String>, effort: Option<String>, resume_session_id: Option<String>, extra_env: Vec<(String, String)>, agent: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    let agent = agent.unwrap_or_else(|| "claude".to_string());
    if !CHAT_AGENTS.contains(&agent.as_str()) {
        return Err(format!("{agent} has no chat engine. A chat runs Claude Code or OpenClaude."));
    }
    if let Some(e) = effort.as_deref() {
        if !valid_effort(&agent, e) {
            return Err(format!("{e} is not an effort level {} knows.", crate::agents::agent_name(&agent)));
        }
    }
    let cwd = PathBuf::from(cwd);
    let mut extra_env = extra_env;
    // The Everyday folder is a plain folder under the home: keep any repository above it invisible
    // to git, so a chat there never commits or branches the folder it sits in (plan v6, 2026-11-19).
    if crate::everyday::is_everyday(&cwd) {
        extra_env.extend(crate::claude_shared::everyday_env(&cwd));
    }
    let sign_in = {
        let store = app.state::<Mutex<crate::state::Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        crate::terminal::agent_env(&store, &settings, Some(&agent), None, None, &extra_env)?.env
    };
    // The caller's own variables first; the sign-in wins (ACCT-024 already refused a clash).
    let mut env: Vec<(String, String)> = extra_env.into_iter().chain(sign_in).collect();
    // Txais (2026-11-21): chat panes follow the same 200k cap, handoff line and note as terminal
    // panes. The cap goes on here (the CLI's own variable) rather than inside the engine, so the
    // engine stays a plain stream reader. The note is created beside the folder's other Kolux
    // scratch, and a folder that cannot take one simply runs without it.
    let at = {
        let store = app.state::<Mutex<crate::state::Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        if crate::cap::on(&settings) {
            // A variable the user set themselves (their own environment, or the agent's saved options)
            // is their choice: the cap leaves it alone.
            let set = crate::cap::env_set() || env.iter().any(|(k, _)| k.eq_ignore_ascii_case(crate::cap::CLAUDE_ENV));
            crate::cap::apply(Some(agent.as_str()), &mut Vec::new(), &mut env, set);
        }
        crate::handoff::at(&settings)
    };
    // One note per folder, the way a worktree has one: two chats in the same folder start from the
    // same page of paper. Best effort; a folder that cannot take one runs without it.
    let name = cwd.file_name().and_then(|n| n.to_str()).unwrap_or("chat").to_string();
    let note = crate::projects::prepare_handoff(&cwd, &name).ok();
    let (engines, sink) = (engines(&app), app_sink(&app));
    blocking(move || engines.start(&chat_id, Spec { agent, cwd, model, effort, env, handoff_at: at, handoff_note: note }, resume_session_id, sink)).await
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
