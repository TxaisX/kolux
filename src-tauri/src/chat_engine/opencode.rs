//! The OpenCode backend of the chat engine (2026-11-24): every chat-pane model runs through OpenCode.
//!
//! One `opencode serve` is shared by the whole app. It is started the first time a chat (or a model or
//! session list) needs it, on a free loopback port, with no console window; it is ended when the app
//! quits and after the engine's idle time with no chat active. Each chat is one OpenCode session, so
//! its session id is what the page keeps to resume the chat and to list a folder's saved chats.
//!
//! The server speaks OpenCode's v2 HTTP API (read from the running server's own `/openapi.json`,
//! v2.4.1): a session is made with `POST /api/session`, a message is `POST /api/session/{id}/prompt`,
//! a model or effort pick is `POST /api/session/{id}/model`, a stop is
//! `POST /api/session/{id}/interrupt`, and everything the agent says arrives on one `GET /api/event`
//! stream. [`Translator`] turns those events into the same [`ChatEvent`]s the stream-json engine
//! sends, so the page draws an OpenCode chat with no change (see docs/chat-engine.md for the table).
//!
//! The server prints a one-time password when it starts. It is read from that line and kept in memory
//! only: it is never written to a file, a log or an event.
use super::events::{Block, ChatEvent, ExitReason, Init, StopHow, ToolResult, TurnResult};
use super::{Config, Image, Sink, Spec};
use crate::chat_tools::{self, Step};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The agent id a chat names to run through OpenCode.
pub const AGENT: &str = "opencode";
/// The user name of the server's HTTP Basic sign-in (the password is the one it prints at start).
const USER: &str = "opencode";
/// How long a fresh server may take to print its address and password.
const START_WAIT: Duration = Duration::from_secs(60);
/// How long one API call may take.
const CALL_WAIT: Duration = Duration::from_secs(30);
/// A reply that is still being written is sent to the page at most this often.
const STREAM_EVERY: Duration = Duration::from_millis(80);
/// The newest messages a reopened chat reads.
const HISTORY_MESSAGES: usize = 200;

fn text_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// A session id is part of a URL path: only letters, digits, `_` and `-` pass (`ses_df0d...`).
pub fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// An effort is a model's own variant name (`low`, `high`, `max`, `none`, ...): one plain word.
pub fn valid_effort(effort: &str) -> bool {
    !effort.is_empty() && effort.len() <= 40 && effort.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The model OpenCode's API names, from the id `opencode models` prints: the first segment is the
/// provider, the rest is the model (`openrouter/deepseek/x` is provider `openrouter`, model
/// `deepseek/x`). The effort is the model's variant.
pub fn model_ref(model: &str, effort: Option<&str>) -> Result<Value, String> {
    let (provider, id) = model.split_once('/').filter(|(p, id)| !p.is_empty() && !id.is_empty()).ok_or_else(|| format!("\"{model}\" is not a model OpenCode lists."))?;
    let mut v = json!({ "id": id, "providerID": provider });
    if let Some(e) = effort {
        v["variant"] = json!(e);
    }
    Ok(v)
}

/// The id `opencode models` prints for a session's or a step's model.
fn model_name(model: Option<&Value>) -> Option<String> {
    let m = model?;
    let (provider, id) = (m.get("providerID")?.as_str()?, m.get("id")?.as_str()?);
    Some(format!("{provider}/{id}"))
}

/// Whether the session is already on the wanted model (and on the wanted effort, when one is named).
fn same_model(current: Option<&Value>, want: &Value) -> bool {
    current.is_some_and(|c| c.get("id") == want.get("id") && c.get("providerID") == want.get("providerID") && (want.get("variant").is_none() || c.get("variant") == want.get("variant")))
}

/// One query value, percent-encoded.
fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// One model the chat can pick, as `src/chat/opencode.ts` hands it to the page.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ModelRow {
    /// The exact string `opencode models` prints.
    pub id: String,
    pub label: String,
    /// The vendor segment of the id (`anthropic`); the provider itself when the id has none.
    pub provider: String,
    /// The reasoning levels OpenCode can pass for the model; empty when it has none.
    pub efforts: Vec<String>,
}

/// `GET /api/model`'s list as rows; a model the user turned off is left out.
pub fn model_rows(list: &Value) -> Vec<ModelRow> {
    let rows = list.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    rows.iter()
        .filter(|m| m.get("enabled").and_then(Value::as_bool) != Some(false))
        .filter_map(|m| {
            let (id, provider) = (m.get("id")?.as_str()?, m.get("providerID")?.as_str()?);
            let label = m.get("name").and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or(id).to_string();
            let vendor = id.split_once('/').map_or(provider, |(v, _)| v).to_string();
            let efforts = m.get("variants").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.get("id").and_then(Value::as_str).map(String::from)).collect()).unwrap_or_default();
            Some(ModelRow { id: format!("{provider}/{id}"), label, provider: vendor, efforts })
        })
        .collect()
}

/// One saved chat of a folder.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    /// Milliseconds since 1970.
    pub updated_at: u64,
}

/// `GET /api/session`'s list as rows, in the order the server gave (newest first is asked for). A
/// session a subagent made for itself is not a chat of the user's, so it is left out.
pub fn session_rows(list: &Value) -> Vec<SessionRow> {
    let rows = list.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    rows.iter()
        .filter(|s| s.get("parentID").is_none_or(Value::is_null))
        .filter_map(|s| {
            let id = s.get("id")?.as_str()?.to_string();
            let time = s.get("time");
            let at = |k: &str| time.and_then(|t| t.get(k)).and_then(Value::as_u64);
            let title = s.get("title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).unwrap_or("New chat").to_string();
            Some(SessionRow { id, title, updated_at: at("updated").or_else(|| at("created")).unwrap_or(0) })
        })
        .collect()
}

/// An OpenCode tool call as the chat view's step: `shell` is the command row, and the file and
/// search tools take the same `path` / `pattern` / `command` arguments omp's do.
pub fn step(call: &str, name: &str, input: &Value) -> Step {
    match name {
        "shell" | "bash" => chat_tools::claude_step(call, "Bash", &json!({ "command": text_of(input, "command") })),
        _ => chat_tools::omp_step(call, name, input),
    }
}

/// The text of a tool result's content parts; a file part is named by its name or address.
fn content_text(content: Option<&Value>) -> String {
    let parts = content.and_then(Value::as_array).cloned().unwrap_or_default();
    parts.iter().map(|p| if p.get("type").and_then(Value::as_str) == Some("file") { p.get("name").or_else(|| p.get("uri")).and_then(Value::as_str).unwrap_or_default().to_string() } else { text_of(p, "text") }).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n")
}

/// A step's token counts under the names Claude Code uses, which the page's context reading knows.
fn usage_of(tokens: Option<&Value>) -> Option<Value> {
    let t = tokens?;
    let n = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
    let cache = t.get("cache");
    Some(json!({
        "input_tokens": n(t.get("input")),
        "cache_read_input_tokens": n(cache.and_then(|c| c.get("read"))),
        "cache_creation_input_tokens": n(cache.and_then(|c| c.get("write"))),
        "output_tokens": n(t.get("output")),
        "reasoning_tokens": n(t.get("reasoning")),
    }))
}

/// One assistant message while it is written: its blocks in the order they began.
#[derive(Default)]
struct Message {
    slots: Vec<(String, Block)>,
    last_sent: Option<Instant>,
}

impl Message {
    fn slot(&mut self, key: &str, thinking: bool) -> &mut Block {
        let at = match self.slots.iter().position(|(k, _)| k == key) {
            Some(i) => i,
            None => {
                self.slots.push((key.to_string(), if thinking { Block::Thinking { text: String::new() } } else { Block::Text { text: String::new() } }));
                self.slots.len() - 1
            }
        };
        &mut self.slots[at].1
    }
}

fn write(block: &mut Block, words: &str, add: bool) {
    if let Block::Text { text } | Block::Thinking { text } = block {
        if !add {
            text.clear();
        }
        text.push_str(words);
    }
}

/// Turns one session's OpenCode events into the page's chat events. It keeps what a turn needs across
/// events: the messages sent and not yet taken up, each reply's blocks, and the turn's cost.
#[derive(Default)]
pub struct Translator {
    session: String,
    /// Messages OpenCode queued (`inbox.enqueued`), by inbox id, until it takes each one up.
    inbox: HashMap<String, String>,
    /// Messages taken up in the running turn. OpenCode answers two messages sent back to back in one
    /// run, while the page counts one result per message, so the run's end sends one result for each.
    delivered: usize,
    running: bool,
    messages: HashMap<String, Message>,
    /// Tool call id to the message it belongs to and the tool's name.
    tools: HashMap<String, (String, String)>,
    current: Option<String>,
    model: Option<String>,
    cost: f64,
    steps: u64,
    last_text: Option<String>,
    last_usage: Option<Value>,
    last_error: Option<(String, String)>,
    began: Option<Instant>,
}

impl Translator {
    pub fn new(session: &str) -> Self {
        Translator { session: session.to_string(), ..Translator::default() }
    }

    /// A turn is running.
    pub fn running(&self) -> bool {
        self.running
    }

    /// A turn is running, or a message is waiting for one.
    pub fn busy(&self) -> bool {
        self.running || !self.inbox.is_empty()
    }

    fn message(&self, id: &str, usage: Option<Value>) -> ChatEvent {
        let blocks = self.messages.get(id).map(|m| m.slots.iter().map(|(_, b)| b.clone()).collect()).unwrap_or_default();
        ChatEvent::Assistant { session_id: Some(self.session.clone()), parent_tool_use_id: None, message_id: Some(id.to_string()), model: self.model.clone(), blocks, error: None, usage }
    }

    /// The end of a run: one result with the run's outcome, then a plain one for every further message
    /// the run took up. A run that already ended here (a stop that gave up waiting) sends nothing.
    fn finish(&mut self, subtype: &str, is_error: bool, errors: Vec<String>, now: Instant) -> Vec<ChatEvent> {
        if !self.running && self.delivered == 0 {
            return Vec::new();
        }
        let first = TurnResult {
            subtype: subtype.to_string(),
            is_error,
            result: if is_error { None } else { self.last_text.clone() },
            errors,
            session_id: Some(self.session.clone()),
            num_turns: Some(self.steps),
            duration_ms: self.began.map(|t| now.saturating_duration_since(t).as_millis() as u64),
            total_cost_usd: Some(self.cost),
            usage: self.last_usage.clone(),
            ..TurnResult::default()
        };
        let mut out = vec![ChatEvent::Result(first)];
        for _ in 1..self.delivered {
            out.push(ChatEvent::Result(TurnResult { subtype: "success".to_string(), session_id: Some(self.session.clone()), ..TurnResult::default() }));
        }
        self.running = false;
        self.delivered = 0;
        self.messages.clear();
        self.tools.clear();
        self.current = None;
        self.began = None;
        out
    }

    /// Ends the running turn as stopped without OpenCode's own word for it (the stop got no answer in
    /// time, or the server went away): the page must not wait for a result that will not come.
    pub fn cut(&mut self, now: Instant) -> Vec<ChatEvent> {
        self.inbox.clear();
        self.finish("error_during_execution", true, Vec::new(), now)
    }

    /// One event of this session. `kind` is the event's `type`, `data` its `data`.
    pub fn on_event(&mut self, kind: &str, data: &Value, now: Instant) -> Vec<ChatEvent> {
        let s = |k: &str| text_of(data, k);
        let ordinal = data.get("ordinal").and_then(Value::as_u64).unwrap_or(0);
        let thinking = kind.starts_with("session.reasoning.");
        let key = format!("{}{ordinal}", if thinking { "r" } else { "t" });
        match kind {
            "session.inbox.enqueued" => {
                let item = data.get("item");
                if item.and_then(|i| i.get("type")).and_then(Value::as_str) == Some("user") {
                    let text = item.and_then(|i| i.get("payload")).map(|p| text_of(p, "text")).unwrap_or_default();
                    self.inbox.insert(s("inboxID"), text);
                }
                Vec::new()
            }
            // The message is taken up now: the echo the page confirms its waiting row with.
            "session.inbox.delivered" => {
                self.delivered += 1;
                match self.inbox.remove(&s("inboxID")) {
                    Some(text) if !text.is_empty() => vec![ChatEvent::User { parent_tool_use_id: None, text: vec![text], tool_results: Vec::new() }],
                    _ => Vec::new(),
                }
            }
            "session.execution.started" => {
                self.running = true;
                self.began = Some(now);
                self.cost = 0.0;
                self.steps = 0;
                self.last_text = None;
                self.last_usage = None;
                self.last_error = None;
                Vec::new()
            }
            "session.step.started" => {
                self.steps += 1;
                self.model = model_name(data.get("model")).or(self.model.take());
                let id = s("assistantMessageID");
                self.messages.entry(id.clone()).or_default();
                self.current = Some(id);
                Vec::new()
            }
            "session.text.started" | "session.reasoning.started" => {
                self.messages.entry(s("assistantMessageID")).or_default().slot(&key, thinking);
                Vec::new()
            }
            "session.text.delta" | "session.reasoning.delta" => {
                let id = s("assistantMessageID");
                let m = self.messages.entry(id.clone()).or_default();
                write(m.slot(&key, thinking), &s("delta"), true);
                if m.last_sent.is_some_and(|t| now.saturating_duration_since(t) < STREAM_EVERY) {
                    return Vec::new();
                }
                m.last_sent = Some(now);
                vec![self.message(&id, None)]
            }
            "session.text.ended" | "session.reasoning.ended" => {
                let (id, text) = (s("assistantMessageID"), s("text"));
                let m = self.messages.entry(id.clone()).or_default();
                write(m.slot(&key, thinking), &text, false);
                m.last_sent = Some(now);
                if !thinking && !text.trim().is_empty() {
                    self.last_text = Some(text);
                }
                vec![self.message(&id, None)]
            }
            "session.tool.input.started" => {
                let (id, call) = (s("assistantMessageID"), s("id"));
                self.messages.entry(id.clone()).or_default().slot(&format!("x{call}"), false);
                self.tools.insert(call, (id, s("name")));
                Vec::new()
            }
            "session.tool.called" => {
                let call = s("id");
                let (id, name) = self.tools.get(&call).cloned().unwrap_or_else(|| (if s("assistantMessageID").is_empty() { self.current.clone().unwrap_or_default() } else { s("assistantMessageID") }, if s("name").is_empty() { "tool".to_string() } else { s("name") }));
                let input = data.get("input").cloned().unwrap_or(Value::Null);
                let view = super::events::step_view(step(&call, &name, &input));
                *self.messages.entry(id.clone()).or_default().slot(&format!("x{call}"), false) = Block::ToolUse { id: call.clone(), name, input, step: view };
                vec![self.message(&id, None)]
            }
            "session.tool.success" | "session.tool.failed" => {
                let failed = kind.ends_with("failed");
                let mut output = content_text(data.get("content"));
                if failed && output.is_empty() {
                    output = data.get("error").map(|e| text_of(e, "message")).unwrap_or_default();
                }
                vec![ChatEvent::User { parent_tool_use_id: None, text: Vec::new(), tool_results: vec![ToolResult { tool_use_id: s("id"), output: chat_tools::cap(output, chat_tools::MAX_OUTPUT), is_error: failed }] }]
            }
            "session.step.ended" => {
                self.cost += data.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
                let usage = usage_of(data.get("tokens"));
                if usage.is_some() {
                    self.last_usage = usage.clone();
                }
                vec![self.message(&s("assistantMessageID"), usage)]
            }
            "session.step.failed" => {
                self.cost += data.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
                if let Some(e) = data.get("error") {
                    self.last_error = Some((text_of(e, "type"), text_of(e, "message")));
                }
                Vec::new()
            }
            "session.retry.scheduled" => {
                let e = data.get("error");
                vec![ChatEvent::ApiRetry { attempt: data.get("attempt").and_then(Value::as_u64), max_retries: None, retry_delay_ms: None, error_status: e.and_then(|e| e.get("status")).and_then(Value::as_u64), error: e.map(|e| text_of(e, "message")).filter(|m| !m.is_empty()) }]
            }
            "session.compaction.ended" => vec![ChatEvent::CompactBoundary { trigger: Some(s("reason")).filter(|r| !r.is_empty()), pre_tokens: None }],
            "session.execution.succeeded" => self.finish("success", false, Vec::new(), now),
            // A stop: the page marks the turn "Interrupted" from this subtype, as it does for Claude Code.
            "session.execution.interrupted" => self.finish("error_during_execution", true, Vec::new(), now),
            "session.execution.failed" => {
                let named = data.get("error").map(|e| (text_of(e, "type"), text_of(e, "message"))).filter(|(_, m)| !m.is_empty());
                let (kind, message) = named.or(self.last_error.take()).unwrap_or_default();
                self.finish(if kind.is_empty() { "failed" } else { &kind }, true, if message.is_empty() { Vec::new() } else { vec![message] }, now)
            }
            // Written piece by piece and repeated whole by the event that ends it: nothing to draw yet.
            "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.progress" | "session.usage.updated" => Vec::new(),
            _ => vec![ChatEvent::Raw { line: kind.to_string(), json: Some(json!({ "type": kind, "data": data })) }],
        }
    }
}

/// The saved messages of a session (`GET /api/session/{id}/message`, oldest first) as chat rows. A
/// block's row id is the live one (`<message id>:<place>`), so a reply seen live and read again is
/// one row.
pub fn history_items(messages: &[Value]) -> Vec<crate::chat::Item> {
    let mut out = Vec::new();
    let row = |id: String, role: &'static str, kind: &'static str, text: String, at: Option<u64>| crate::chat::Item { id, role, kind, text, at, images: Vec::new(), tool: None, details: None };
    for m in messages {
        let id = text_of(m, "id");
        let at = m.get("time").and_then(|t| t.get("created")).and_then(Value::as_u64);
        match m.get("type").and_then(Value::as_str) {
            Some("user") => {
                let text = text_of(m, "text");
                if !text.trim().is_empty() {
                    out.push(row(id, "user", "text", text, at));
                }
            }
            Some("assistant") => {
                for (i, c) in m.get("content").and_then(Value::as_array).into_iter().flatten().enumerate() {
                    let rid = format!("{id}:{i:03}");
                    match c.get("type").and_then(Value::as_str) {
                        Some("text") if !text_of(c, "text").trim().is_empty() => out.push(row(rid, "assistant", "text", text_of(c, "text"), at)),
                        Some("reasoning") if !text_of(c, "text").trim().is_empty() => out.push(row(rid, "assistant", "thought", text_of(c, "text"), at)),
                        Some("tool") => {
                            let state = c.get("state").cloned().unwrap_or(Value::Null);
                            let status = text_of(&state, "status");
                            let input = state.get("input").filter(|v| v.is_object()).cloned().unwrap_or(Value::Null);
                            match step(&text_of(c, "id"), &text_of(c, "name"), &input) {
                                Step::Tool(mut t) => {
                                    t.done = status == "completed" || status == "error";
                                    t.failed = status == "error";
                                    let mut output = content_text(state.get("content"));
                                    if t.failed && output.is_empty() {
                                        output = state.get("error").map(|e| text_of(e, "message")).unwrap_or_default();
                                    }
                                    if t.done {
                                        t.output = Some(chat_tools::cap(output, chat_tools::MAX_OUTPUT));
                                    }
                                    out.push(crate::chat::Item { tool: Some(t.clone()), ..row(rid, "assistant", "tool", t.preview, at) });
                                }
                                Step::Plan { text, .. } => out.push(row(rid, "assistant", "plan", text, at)),
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some("idle") if m.get("outcome").and_then(Value::as_str) == Some("interrupted") => out.push(row(id, "status", "interrupted", "Interrupted".to_string(), at)),
            _ => {}
        }
    }
    out
}

/// Splits the event stream's bytes into events: frames end at a blank line, a frame's `data:` lines
/// are one JSON object, and a comment frame (`: heartbeat`) is nothing.
#[derive(Default)]
pub struct Frames {
    buf: Vec<u8>,
}

impl Frames {
    /// Feeds bytes as they arrive; returns each whole event as its `type` and `data`.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<(String, Value)> {
        self.buf.extend(bytes.iter().filter(|b| **b != b'\r'));
        let mut out = Vec::new();
        while let Some(end) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let frame: Vec<u8> = self.buf.drain(..end + 2).collect();
            let text = String::from_utf8_lossy(&frame);
            let data: Vec<&str> = text.lines().filter_map(|l| l.strip_prefix("data:")).map(|l| l.strip_prefix(' ').unwrap_or(l)).collect();
            if data.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(&data.join("\n")) {
                let kind = text_of(&v, "type");
                if !kind.is_empty() {
                    out.push((kind, v.get("data").cloned().unwrap_or(Value::Null)));
                }
            }
        }
        out
    }
}

/// The running server's address and sign-in.
#[derive(Clone)]
pub struct Api {
    base: String,
    password: String,
    http: reqwest::Client,
}

impl Api {
    /// One call: the status and the body. The request runs on the app's async runtime; this thread
    /// only waits for its answer, so it is safe from any blocking worker.
    fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<(u16, String), String> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = self.http.request(method, format!("{}{path}", self.base)).basic_auth(USER, Some(&self.password)).timeout(CALL_WAIT);
        if let Some(b) = body {
            req = req.header("content-type", "application/json").body(b.to_string());
        }
        let (tx, rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let out = match req.send().await {
                Ok(r) => {
                    let status = r.status().as_u16();
                    r.text().await.map(|t| (status, t)).map_err(|e| e.to_string())
                }
                Err(e) => Err(e.to_string()),
            };
            let _ = tx.send(out);
        });
        rx.recv_timeout(CALL_WAIT + Duration::from_secs(5)).map_err(|_| "OpenCode did not answer in time.".to_string())?.map_err(|e| format!("OpenCode could not be reached: {e}"))
    }

    /// A call that must succeed: the body as JSON (`null` for an empty one), or OpenCode's own message.
    fn ok(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let (status, text) = self.call(method, path, body)?;
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(v);
        }
        Err(v.get("message").and_then(Value::as_str).map_or_else(|| format!("OpenCode answered {status}."), |m| format!("OpenCode: {m}")))
    }
}

struct Up {
    child: Child,
    pid: u32,
    api: Api,
}

#[derive(Default)]
struct State {
    up: Option<Up>,
    /// Counts server starts, so a watcher or a stream of an earlier one knows it is over.
    gen: u64,
    /// Open chats by OpenCode session id. They stay through a sleep: the next send wakes the server.
    chats: HashMap<String, Arc<OpenChat>>,
    last_active: Option<Instant>,
    models: Option<Vec<ModelRow>>,
}

/// The app's one `opencode serve`, started when first needed.
pub struct Server {
    cfg: Config,
    state: Mutex<State>,
}

impl Default for Server {
    fn default() -> Self {
        Server::new(Config::default())
    }
}

fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("No free port for OpenCode: {e}"))?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Starts `opencode serve` on a free loopback port and waits for the two lines it prints: its address
/// and its password.
fn start_server(env: &[(String, String)]) -> Result<Up, String> {
    let program = crate::agents::find_program(AGENT).ok_or_else(|| "OpenCode was not found on PATH. Install it, then open the chat again.".to_string())?;
    let port = free_port()?;
    let shim = program.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if shim {
        let mut c = crate::winproc::command(crate::pty::system_program("cmd.exe"));
        c.arg("/d").arg("/c").arg(&program);
        c
    } else {
        crate::winproc::command(&program)
    };
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()]).envs(env.iter().map(|(k, v)| (k, v)));
    if let Some(home) = crate::chat::home().filter(|h| h.is_dir()) {
        cmd.current_dir(home);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Could not start OpenCode: {e}"))?;
    let pid = child.id();
    // Both pipes are read for as long as the server lives, so it never blocks on a full one. Its
    // lines are not kept or sent anywhere: one of them is the password.
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    let said: Arc<Mutex<Vec<String>>> = Arc::default();
    if let Some(err) = child.stderr.take() {
        let said = Arc::clone(&said);
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let mut s = said.lock().unwrap_or_else(|e| e.into_inner());
                if s.len() < 20 {
                    s.push(line);
                }
            }
        });
    }
    let end = Instant::now() + START_WAIT;
    let (mut base, mut password) = (None, None);
    while base.is_none() || password.is_none() {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Some(url) = line.split("server listening on ").nth(1) {
                    base = Some(url.trim().trim_end_matches('/').to_string());
                } else if let Some(p) = line.split("server password ").nth(1) {
                    password = Some(p.trim().to_string());
                }
            }
            Err(_) => {
                let gone = matches!(child.try_wait(), Ok(Some(_)));
                if gone || Instant::now() >= end {
                    crate::procs::kill_tree(pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    let why = said.lock().unwrap_or_else(|e| e.into_inner()).join(" ");
                    let why = if why.trim().is_empty() { String::new() } else { format!(" It said: {}", why.trim()) };
                    return Err(if gone { format!("OpenCode ended before it was ready.{why}") } else { format!("OpenCode did not start in time.{why}") });
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
    // A local address: never through a system proxy.
    let http = reqwest::Client::builder().no_proxy().build().map_err(|e| e.to_string())?;
    Ok(Up { child, pid, api: Api { base: base.unwrap_or_default(), password: password.unwrap_or_default(), http } })
}

impl Server {
    pub fn new(cfg: Config) -> Self {
        Server { cfg, state: Mutex::default() }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Ends the server process and hands back its pid and the chats to tell.
    fn take_down(st: &mut State) -> Option<(u32, Vec<Arc<OpenChat>>)> {
        let mut up = st.up.take()?;
        crate::procs::kill_tree(up.pid);
        let _ = up.child.kill();
        let _ = up.child.wait();
        Some((up.pid, st.chats.values().cloned().collect()))
    }

    /// The running server, started first when it is not up. Returns its API, its pid and the count of
    /// this start.
    fn wake(self: &Arc<Self>, env: &[(String, String)]) -> Result<(Api, u32, u64), String> {
        let mut st = self.lock();
        st.last_active = Some(Instant::now());
        let gen = st.gen;
        let mut lost = None;
        if let Some(up) = st.up.as_mut() {
            match up.child.try_wait() {
                Ok(None) => return Ok((up.api.clone(), up.pid, gen)),
                // It ended by itself and its watcher has not said so yet: say it here, then start again.
                Ok(Some(status)) => lost = Some(status.code()),
                Err(_) => lost = Some(None),
            }
        }
        let gone = lost.and_then(|code| Self::take_down(&mut st).map(|(pid, chats)| (pid, chats, code)));
        let up = start_server(env);
        let (ready, out) = match up {
            Ok(up) => {
                st.gen += 1;
                let out = (up.api.clone(), up.pid, st.gen);
                st.up = Some(up);
                (Some(self.listen(out.0.clone(), out.2)), Ok(out))
            }
            Err(e) => (None, Err(e)),
        };
        drop(st);
        if let Some((pid, chats, code)) = gone {
            for c in chats {
                c.server_gone(pid, code, ExitReason::Crashed);
            }
        }
        if let (Some(ready), Ok((_, _, gen))) = (ready, &out) {
            // Events sent while nobody listens are lost, so nothing is asked of the server before its
            // event stream is open.
            let _ = ready.recv_timeout(Duration::from_secs(10));
            let watcher = Arc::clone(self);
            let gen = *gen;
            std::thread::spawn(move || watcher.watch(gen));
        }
        out
    }

    /// The server's API when it is up; never starts it.
    fn api(&self) -> Option<Api> {
        self.lock().up.as_ref().map(|u| u.api.clone())
    }

    /// Opens the event stream and routes each event to its chat. The receiver hears once, when the
    /// stream's first event has arrived.
    fn listen(self: &Arc<Self>, api: Api, gen: u64) -> mpsc::Receiver<()> {
        let (ready_tx, ready_rx) = mpsc::channel();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let req = api.http.get(format!("{}/api/event", api.base)).basic_auth(USER, Some(&api.password)).header("accept", "text/event-stream");
        tauri::async_runtime::spawn(async move {
            if let Ok(mut resp) = req.send().await {
                while let Ok(Some(chunk)) = resp.chunk().await {
                    if tx.send(chunk.to_vec()).is_err() {
                        break;
                    }
                }
            }
        });
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let mut frames = Frames::default();
            let mut ready = Some(ready_tx);
            for chunk in rx {
                for (kind, data) in frames.feed(&chunk) {
                    if let Some(r) = ready.take() {
                        let _ = r.send(());
                    }
                    me.route(gen, &kind, &data);
                }
            }
            me.stream_ended(gen, api);
        });
        ready_rx
    }

    fn route(&self, gen: u64, kind: &str, data: &Value) {
        let Some(session) = data.get("sessionID").and_then(Value::as_str) else { return };
        let chat = {
            let mut st = self.lock();
            if st.gen != gen {
                return;
            }
            let chat = st.chats.get(session).cloned();
            if chat.is_some() {
                st.last_active = Some(Instant::now());
            }
            chat
        };
        if let Some(c) = chat {
            c.heard(kind, data);
        }
    }

    /// The event stream closed while its server still runs (OpenCode drops a listener that falls
    /// behind). Events were missed, so a turn that was running is ended on the page with a notice, and
    /// the stream is opened again.
    fn stream_ended(self: &Arc<Self>, gen: u64, api: Api) {
        std::thread::sleep(Duration::from_millis(300));
        let chats: Vec<Arc<OpenChat>> = {
            let mut st = self.lock();
            let alive = st.gen == gen && st.up.as_mut().is_some_and(|u| matches!(u.child.try_wait(), Ok(None)));
            if !alive {
                return;
            }
            st.chats.values().cloned().collect()
        };
        for c in chats {
            c.stream_lost();
        }
        let _ = self.listen(api, gen);
    }

    /// Ends the server after the idle time with no chat active (the longer busy time while a turn
    /// runs), and reports a server that ended by itself. One watcher per start.
    fn watch(self: Arc<Self>, gen: u64) {
        let tick = (self.cfg.idle.min(self.cfg.busy_idle) / 4).clamp(Duration::from_millis(10), Duration::from_secs(1));
        loop {
            std::thread::sleep(tick);
            let mut st = self.lock();
            if st.gen != gen || st.up.is_none() {
                return;
            }
            let dead = st.up.as_mut().and_then(|u| u.child.try_wait().ok().flatten());
            let busy = st.chats.values().any(|c| c.busy());
            let limit = if busy { self.cfg.busy_idle } else { self.cfg.idle };
            let why = match dead {
                Some(status) => Some((if status.success() { ExitReason::Ended } else { ExitReason::Crashed }, status.code())),
                None if st.last_active.is_none_or(|t| t.elapsed() >= limit) => Some((ExitReason::Sleep, None)),
                None => None,
            };
            if let Some((reason, code)) = why {
                let gone = Self::take_down(&mut st);
                drop(st);
                if let Some((pid, chats)) = gone {
                    for c in chats {
                        c.server_gone(pid, code, reason);
                    }
                }
                return;
            }
        }
    }

    /// Ends the server (the app is quitting). Open chats were closed by the caller.
    pub fn shutdown(&self) {
        let mut st = self.lock();
        st.chats.clear();
        let _ = Self::take_down(&mut st);
    }

    /// Whether the server process is up right now.
    pub fn is_running(&self) -> bool {
        self.lock().up.is_some()
    }

    /// OpenCode's models. The list is kept once it has been read with something in it; a server that
    /// has just started answers with an empty list for a moment, so the read is tried again.
    pub fn models(self: &Arc<Self>, env: &[(String, String)]) -> Result<Vec<ModelRow>, String> {
        if let Some(m) = self.lock().models.clone() {
            return Ok(m);
        }
        let (api, _, _) = self.wake(env)?;
        let mut rows = Vec::new();
        for _ in 0..40 {
            rows = model_rows(&api.ok("GET", "/api/model", None)?);
            if !rows.is_empty() {
                self.lock().models = Some(rows.clone());
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Ok(rows)
    }

    /// The saved chats of a folder, newest first.
    pub fn sessions(self: &Arc<Self>, env: &[(String, String)], cwd: &str) -> Result<Vec<SessionRow>, String> {
        let (api, _, _) = self.wake(env)?;
        let mut rows = session_rows(&api.ok("GET", &format!("/api/session?directory={}&order=desc&limit=100", enc(cwd)), None)?);
        rows.sort_by_key(|r| std::cmp::Reverse(r.updated_at));
        Ok(rows)
    }

    /// Deletes a saved chat for good.
    pub fn delete(self: &Arc<Self>, env: &[(String, String)], session: &str) -> Result<(), String> {
        if !valid_session(session) {
            return Err(format!("\"{session}\" is not a session id."));
        }
        let (api, _, _) = self.wake(env)?;
        api.ok("DELETE", &format!("/api/session/{session}"), None).map(|_| ())
    }

    /// What a reopened chat shows: the newest saved messages of its session.
    pub fn history(self: &Arc<Self>, env: &[(String, String)], session: &str, limit: usize) -> Result<crate::chat::ChatRead, String> {
        if !valid_session(session) {
            return Err(format!("\"{session}\" is not a session id."));
        }
        let gone = |_| "This chat's conversation is not in OpenCode anymore.".to_string();
        let (api, _, _) = self.wake(env)?;
        api.ok("GET", &format!("/api/session/{session}"), None).map_err(gone)?;
        let list = api.ok("GET", &format!("/api/session/{session}/message?limit={}&order=desc", limit.clamp(1, HISTORY_MESSAGES)), None).map_err(gone)?;
        let mut messages = list.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        messages.reverse();
        let items = history_items(&messages);
        Ok(crate::chat::ChatRead { state: if items.is_empty() { "empty" } else { "ready" }, reset: true, items, open: false, error: None, retry_ms: 1_000, older: None, earlier: false })
    }
}

struct ChatInner {
    spec: Spec,
    session: String,
    /// The server start this chat last spoke to; another one means the server slept or was replaced.
    seen_gen: u64,
    /// The model the session is on, as last set here.
    model: Option<Value>,
    /// A model pick made while the server slept, applied before the next message.
    pending_model: Option<Value>,
    tr: Translator,
    closed: bool,
}

/// One chat that runs through OpenCode: one session on the shared server.
pub struct OpenChat {
    id: String,
    sink: Sink,
    server: Arc<Server>,
    inner: Mutex<ChatInner>,
}

impl OpenChat {
    fn lock(&self) -> MutexGuard<'_, ChatInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn emit(&self, ev: &ChatEvent) {
        (self.sink)(&self.id, ev);
    }

    fn init(&self, raw: Value) -> ChatEvent {
        let i = self.lock();
        ChatEvent::Init(Init {
            session_id: i.session.clone(),
            cwd: Some(i.spec.cwd.to_string_lossy().into_owned()),
            model: i.spec.model.clone().or_else(|| model_name(i.model.as_ref())),
            // OpenCode's own permission rules decide; a question it asks is answered "allow once"
            // (the chat's "never ask" rule, DT-C283).
            permission_mode: Some("bypassPermissions".to_string()),
            effort: i.spec.effort.clone().map(Value::String),
            raw,
            ..Init::default()
        })
    }

    /// Opens a chat: a new session in the chat's folder, or `resume` picked up again. The page hears
    /// `started` and then `init` with the session's id.
    pub fn open(server: &Arc<Server>, chat_id: &str, spec: Spec, resume: Option<String>, sink: Sink) -> Result<Arc<OpenChat>, String> {
        let want = spec.model.as_deref().map(|m| model_ref(m, spec.effort.as_deref())).transpose()?;
        let (api, pid, gen) = server.wake(&spec.env)?;
        let info = match &resume {
            Some(id) => api.ok("GET", &format!("/api/session/{id}"), None).map_err(|_| "This chat's conversation is not in OpenCode anymore.".to_string())?,
            None => {
                let mut body = json!({ "location": { "directory": spec.cwd.to_string_lossy() } });
                if let Some(w) = &want {
                    body["model"] = w.clone();
                }
                api.ok("POST", "/api/session", Some(body))?
            }
        };
        let data = info.get("data").cloned().unwrap_or(info);
        let session = data.get("id").and_then(Value::as_str).filter(|id| valid_session(id)).ok_or_else(|| "OpenCode did not name the conversation.".to_string())?.to_string();
        let mut model = data.get("model").cloned();
        if let (Some(_), Some(w)) = (&resume, &want) {
            if !same_model(model.as_ref(), w) {
                api.ok("POST", &format!("/api/session/{session}/model"), Some(json!({ "model": w })))?;
                model = Some(w.clone());
            }
        }
        let chat = Arc::new(OpenChat { id: chat_id.to_string(), sink, server: Arc::clone(server), inner: Mutex::new(ChatInner { spec, session: session.clone(), seen_gen: gen, model, pending_model: None, tr: Translator::new(&session), closed: false }) });
        server.lock().chats.insert(session, Arc::clone(&chat));
        chat.emit(&ChatEvent::Started { pid, resumed: resume });
        chat.emit(&chat.init(data));
        Ok(chat)
    }

    /// Whether this chat is the conversation `resume` in `cwd`: a start that names it again is a model
    /// or effort pick, not a new chat.
    pub fn is(&self, cwd: &std::path::Path, resume: Option<&str>) -> bool {
        let i = self.lock();
        !i.closed && resume == Some(i.session.as_str()) && i.spec.cwd == cwd
    }

    /// A model or effort pick between turns: the session is switched in place, with no restart. With
    /// the server asleep the pick is kept and applied before the next message.
    pub fn retarget(&self, spec: Spec) -> Result<(), String> {
        let want = spec.model.as_deref().map(|m| model_ref(m, spec.effort.as_deref())).transpose()?;
        let (session, current) = {
            let i = self.lock();
            (i.session.clone(), i.model.clone())
        };
        let change = want.filter(|w| !same_model(current.as_ref(), w));
        let api = self.server.api();
        if let (Some(w), Some(api)) = (&change, &api) {
            api.ok("POST", &format!("/api/session/{session}/model"), Some(json!({ "model": w })))?;
        }
        {
            let mut i = self.lock();
            i.spec = spec;
            if let Some(w) = change {
                if api.is_none() {
                    i.pending_model = Some(w.clone());
                }
                i.model = Some(w);
            }
        }
        self.emit(&self.init(Value::Null));
        Ok(())
    }

    /// Sends a message. A server that slept is started again first; the session is still on its disk.
    pub fn send(&self, text: &str, images: &[Image]) -> Result<(), String> {
        if !images.is_empty() {
            return Err("Pictures cannot be sent in this chat yet.".to_string());
        }
        let env = self.lock().spec.env.clone();
        let (api, pid, gen) = self.server.wake(&env)?;
        let (session, pending, woke) = {
            let mut i = self.lock();
            if i.closed {
                return Err(format!("No open chat {}.", self.id));
            }
            let woke = i.seen_gen != gen;
            i.seen_gen = gen;
            (i.session.clone(), i.pending_model.take(), woke)
        };
        if woke {
            self.emit(&ChatEvent::Started { pid, resumed: Some(session.clone()) });
        }
        if let Some(w) = pending {
            api.ok("POST", &format!("/api/session/{session}/model"), Some(json!({ "model": w })))?;
        }
        api.ok("POST", &format!("/api/session/{session}/prompt"), Some(json!({ "text": text }))).map(|_| ())
    }

    /// Stops the running turn. `None` when none was running. `Interrupt` when OpenCode ended the turn
    /// itself; `Ended` when it did not say so within the stop grace, and the page is told the turn is
    /// over anyway (the shared server is never ended for one chat's stop).
    pub fn stop(&self) -> Option<StopHow> {
        let session = {
            let i = self.lock();
            if !i.tr.busy() {
                return None;
            }
            i.session.clone()
        };
        let asked = self.server.api().is_some_and(|api| api.ok("POST", &format!("/api/session/{session}/interrupt"), None).is_ok());
        let end = Instant::now() + self.server.cfg.stop_grace;
        let how = loop {
            if !asked || Instant::now() >= end {
                break StopHow::Ended;
            }
            if !self.lock().tr.running() {
                break StopHow::Interrupt;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        if how == StopHow::Ended {
            let cut = self.lock().tr.cut(Instant::now());
            for e in &cut {
                self.emit(e);
            }
        }
        self.emit(&ChatEvent::Stopped { how });
        Some(how)
    }

    /// Closes the chat: a running turn is stopped, and the page hears `exit`. The session stays saved
    /// in OpenCode; the server keeps running for the other chats until it idles out.
    pub fn close(&self) {
        let (session, busy) = {
            let mut i = self.lock();
            if i.closed {
                return;
            }
            i.closed = true;
            (i.session.clone(), i.tr.busy())
        };
        let up = {
            let mut st = self.server.lock();
            st.chats.remove(&session);
            st.up.as_ref().map(|u| (u.pid, u.api.clone()))
        };
        if let Some((pid, api)) = up {
            if busy {
                let _ = api.call("POST", &format!("/api/session/{session}/interrupt"), None);
            }
            self.emit(&ChatEvent::Exit { pid, code: None, reason: ExitReason::Closed });
        }
    }

    /// The OpenCode session this chat is.
    pub fn session_id(&self) -> String {
        self.lock().session.clone()
    }

    fn busy(&self) -> bool {
        self.lock().tr.busy()
    }

    /// One event of this chat's session, from the server's stream.
    fn heard(self: &Arc<Self>, kind: &str, data: &Value) {
        if kind == "permission.asked" {
            self.allow(data);
        }
        let events = {
            let mut i = self.lock();
            if i.closed {
                return;
            }
            i.tr.on_event(kind, data, Instant::now())
        };
        for e in &events {
            self.emit(e);
        }
    }

    /// OpenCode asks before a tool call its rules do not already allow. A chat never asks (DT-C283),
    /// so the answer is "allow once"; the question itself still reaches the page as a `raw` event.
    fn allow(self: &Arc<Self>, data: &Value) {
        let (request, session) = (text_of(data, "id"), self.session_id());
        if !valid_session(&request) {
            return;
        }
        if let Some(api) = self.server.api() {
            std::thread::spawn(move || {
                let _ = api.call("POST", &format!("/api/session/{session}/permission/{request}/reply"), Some(json!({ "decision": "once" })));
            });
        }
    }

    /// The server ended (idle sleep, a crash, the app quitting): a running turn is over, and the page
    /// hears `exit` with the reason. The next send starts the server again.
    fn server_gone(&self, pid: u32, code: Option<i32>, reason: ExitReason) {
        let cut = {
            let mut i = self.lock();
            if i.closed {
                return;
            }
            i.tr.cut(Instant::now())
        };
        for e in &cut {
            self.emit(e);
        }
        self.emit(&ChatEvent::Exit { pid, code, reason });
    }

    /// The event stream dropped and events were missed: a turn that was running cannot be followed to
    /// its end, so the page is told it ended with an error instead of waiting forever.
    fn stream_lost(&self) {
        let lost = {
            let mut i = self.lock();
            if i.closed || !i.tr.busy() {
                return;
            }
            i.tr.inbox.clear();
            i.tr.finish("connection_lost", true, vec!["Kolux lost its link to OpenCode for a moment. The reply may have gone on without being shown; reopen the chat to see what was saved.".to_string()], Instant::now())
        };
        for e in &lost {
            self.emit(e);
        }
    }
}
