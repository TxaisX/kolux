//! The OpenCode backend of the chat engine (2026-11-24): every chat-pane model runs through OpenCode.
//!
//! One `opencode serve` is shared by the whole app. It is started the first time a chat (or a model or
//! session list) needs it, on a loopback port the system picks, with no console window; it is ended when the app
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
//! Kolux makes a fresh random password for each start and hands it to the server as
//! `OPENCODE_PASSWORD`. It is kept in memory only: it is never written to a file, a log or an event.
//! The server's environment carries it, so the programs OpenCode starts can read it too; it opens
//! only this loopback server, which those programs already run under.
use super::events::{Block, ChatEvent, ExitReason, Init, StopHow, ToolResult, TurnResult};
use super::{Config, Image, Sink, Spec};
use crate::chat_tools::{self, Step};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The agent id a chat names to run through OpenCode.
pub const AGENT: &str = "opencode";
/// The user name of the server's HTTP Basic sign-in (the password is the one Kolux made for it).
const USER: &str = "opencode";
/// How long a fresh server may take to print its address.
const START_WAIT: Duration = Duration::from_secs(60);
/// How long a caller waits for a fresh server's event stream to open before it goes on anyway.
const READY_WAIT: Duration = Duration::from_secs(10);
/// The longest wait between two tries of a refused event stream.
const RETRY_MAX: Duration = Duration::from_secs(10);
/// An event stream that lived less than this before it dropped counts as a failed one.
const STREAM_STEADY: Duration = Duration::from_secs(5);
/// Reads of a model list that came back empty, before the empty list is the answer.
const MODEL_TRIES: u32 = 20;
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
    /// The page was told the running turn is over before OpenCode said so (a stop that got no answer,
    /// a lost event stream). That run's late events are dropped until the next run starts, so the
    /// finished turn does not come back with no end.
    orphan: bool,
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

    /// The run's late events are being dropped (see `orphan`): OpenCode may still be running it.
    pub fn orphaned(&self) -> bool {
        self.orphan
    }

    /// Forgets the messages still waiting, which OpenCode dropped with its queue: each gets a result of
    /// its own, so the page never waits for one that will not run.
    fn drop_queue(&mut self) -> Vec<ChatEvent> {
        let n = self.inbox.len();
        self.inbox.clear();
        (0..n).map(|_| ChatEvent::Result(TurnResult { subtype: "error_during_execution".to_string(), is_error: true, errors: vec!["This message was not run: OpenCode dropped it when the run before it ended.".to_string()], session_id: Some(self.session.clone()), ..TurnResult::default() })).collect()
    }

    /// Ends the running turn as stopped without OpenCode's own word for it, when OpenCode dropped its
    /// queue too (an accepted stop that did not end in time, or the server went away): the page must
    /// not wait for a result that will not come, for the turn or for a message still waiting.
    pub fn cut(&mut self, now: Instant) -> Vec<ChatEvent> {
        let mut out = self.end_unseen("error_during_execution", Vec::new(), now);
        out.extend(self.drop_queue());
        out
    }

    /// Ends the running turn on the page while OpenCode may still have it and its queue (a stop that
    /// OpenCode did not take): a message still waiting is kept, and starts a turn of its own when
    /// OpenCode takes it up.
    pub fn cut_kept(&mut self, now: Instant) -> Vec<ChatEvent> {
        self.end_unseen("error_during_execution", Vec::new(), now)
    }

    /// Ends the running turn because Kolux lost OpenCode's event stream: what the run does next is not
    /// seen, so it is dropped like a cut run's. OpenCode was not stopped, so a message still waiting is
    /// kept for the turn it will start.
    pub fn lost(&mut self, errors: Vec<String>, now: Instant) -> Vec<ChatEvent> {
        self.end_unseen("connection_lost", errors, now)
    }

    fn end_unseen(&mut self, subtype: &str, errors: Vec<String>, now: Instant) -> Vec<ChatEvent> {
        if self.running || self.delivered > 0 {
            self.orphan = true;
        }
        self.finish(subtype, true, errors, now)
    }

    fn begin(&mut self, now: Instant) {
        self.running = true;
        self.began = Some(now);
        self.cost = 0.0;
        self.steps = 0;
        self.last_text = None;
        self.last_usage = None;
        self.last_error = None;
    }

    /// One event of this session. `kind` is the event's `type`, `data` its `data`.
    pub fn on_event(&mut self, kind: &str, data: &Value, now: Instant) -> Vec<ChatEvent> {
        if self.orphan {
            match kind {
                // A message sent after the cut is still kept for the run that takes it up.
                "session.inbox.enqueued" | "session.execution.started" => {}
                // The cut run takes up a message sent after the cut: from here the run is that message's.
                "session.inbox.delivered" if self.inbox.contains_key(&text_of(data, "inboxID")) => {
                    self.orphan = false;
                    self.begin(now);
                }
                "session.execution.succeeded" => {
                    self.orphan = false;
                    return Vec::new();
                }
                // A stopped or failed run drops OpenCode's queue with it.
                "session.execution.interrupted" | "session.execution.failed" => {
                    self.orphan = false;
                    return self.drop_queue();
                }
                _ => return Vec::new(),
            }
            if kind == "session.execution.started" {
                self.orphan = false;
            }
        }
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
                self.begin(now);
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
            // A stopped or failed run leaves no message waiting: OpenCode drops its queue with the run.
            "session.execution.interrupted" => {
                let mut out = self.finish("error_during_execution", true, Vec::new(), now);
                out.extend(self.drop_queue());
                out
            }
            "session.execution.failed" => {
                let named = data.get("error").map(|e| (text_of(e, "type"), text_of(e, "message"))).filter(|(_, m)| !m.is_empty());
                let (kind, message) = named.or(self.last_error.take()).unwrap_or_default();
                let mut out = self.finish(if kind.is_empty() { "failed" } else { &kind }, true, if message.is_empty() { Vec::new() } else { vec![message] }, now);
                out.extend(self.drop_queue());
                out
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

    /// An API on a local address, for the tests' stand-in server.
    #[cfg(test)]
    pub(super) fn local(base: &str, password: &str) -> Api {
        Api { base: base.to_string(), password: password.to_string(), http: reqwest::Client::builder().no_proxy().build().expect("a client") }
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

/// The server process Kolux started.
pub(super) struct Proc {
    child: Child,
    pid: u32,
    /// The server's own kill-on-close job: the server and everything it starts end with it.
    job: Option<crate::procs::Job>,
}

/// A running server: its process (none for the tests' stand-in) and its API.
pub(super) struct Up {
    proc: Option<Proc>,
    api: Api,
}

impl Up {
    #[cfg(test)]
    pub(super) fn fake(api: Api) -> Up {
        Up { proc: None, api }
    }

    fn pid(&self) -> u32 {
        self.proc.as_ref().map_or(0, |p| p.pid)
    }

    /// `Some((clean, code))` once the process has ended; the tests' stand-in never ends.
    fn ended(&mut self) -> Option<(bool, Option<i32>)> {
        let p = self.proc.as_mut()?;
        match p.child.try_wait() {
            Ok(None) => None,
            Ok(Some(status)) => Some((status.success(), status.code())),
            Err(_) => Some((false, None)),
        }
    }

    /// Ends the process and everything it started. Never called with a lock held: `taskkill` can
    /// take a while.
    fn end(self) {
        if let Some(mut p) = self.proc {
            crate::procs::kill_tree(p.pid);
            drop(p.job.take());
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }
}

/// Puts a freshly started server in a kill-on-close job of its own.
fn own(child: Child) -> Proc {
    let pid = child.id();
    let job = crate::procs::Job::new().ok().filter(|j| j.assign_pid(pid).is_ok());
    Proc { child, pid, job }
}

/// Starts a server with this environment. The real one is [`start_server`]; tests use a stand-in.
pub(super) type Starter = Arc<dyn Fn(&[(String, String)]) -> Result<Up, String> + Send + Sync>;

#[derive(Default)]
struct State {
    up: Option<Up>,
    /// Counts server starts, so a watcher or a stream of an earlier one knows it is over.
    gen: u64,
    /// Open chats by OpenCode session id; one session can be open in more than one chat. They stay
    /// through a sleep: the next send wakes the server.
    chats: HashMap<String, Vec<Arc<OpenChat>>>,
    last_active: Option<Instant>,
    models: Option<Vec<ModelRow>>,
    /// The environment every start uses (see [`Server::set_env`]).
    env: Vec<(String, String)>,
    /// A start is under way with the lock let go; a second waker waits for it.
    starting: bool,
    /// Counts shutdowns: a start that finishes after one is ended, not used.
    halts: u64,
    /// The current start's event stream is open: events are heard, so requests may be sent.
    ready: bool,
    /// Event streams in a row that ended without opening.
    stream_fails: u32,
    /// A model-list read is under way; other callers wait for its answer.
    models_reading: bool,
    models_round: u64,
    models_last: Option<Result<Vec<ModelRow>, String>>,
}

/// The app's one `opencode serve`, started when first needed.
pub struct Server {
    cfg: Config,
    state: Mutex<State>,
    /// Woken on every change a waiter waits for: a start done, the stream open, a model list read.
    cv: Condvar,
    start: Starter,
    /// The wait before the first re-open of a refused event stream; it doubles on each refusal.
    retry_base: Duration,
    /// Refusals in a row after which the stream is given up.
    retry_tries: u32,
    /// The wait between two reads of a model list that came back empty.
    model_poll: Duration,
}

impl Default for Server {
    fn default() -> Self {
        Server::new(Config::default())
    }
}

/// Fills `buf` from the system's secure random source.
fn os_random(buf: &mut [u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
        // SAFETY: `buf` is valid for writes of its whole length; the system-preferred generator needs
        // no algorithm handle.
        let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("No secure random source ({status:#x})."))
        }
    }
    #[cfg(not(windows))]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).map_err(|e| format!("No secure random source: {e}"))
    }
}

/// A fresh server password: 32 bytes from the system's secure random source, as hex. It lives only in
/// memory and in the server's environment.
pub(super) fn new_password() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    os_random(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The address in the server's "server listening on <url>" line.
pub(super) fn listening(line: &str) -> Option<String> {
    line.split("server listening on ").nth(1).map(|url| url.trim().trim_end_matches('/').to_string())
}

/// The `opencode serve` command for `program`: a port the system picks (the server names it in its
/// first line), and Kolux's own password. A password variable in `env` is replaced, never used.
/// An npm `.cmd` shim is not run through cmd.exe: the program it names (OpenCode's own `opencode.exe`)
/// is started directly, so the server is Kolux's child and not a cmd.exe in front of it. The user name
/// and password variables in `env` are removed, so only Kolux's own pair is used.
pub(super) fn serve_command(program: &std::path::Path, env: &[(String, String)], password: &str) -> Result<std::process::Command, String> {
    let (exe, pre) = crate::pty::start_line(program);
    let mut cmd = crate::winproc::command(exe);
    cmd.args(pre);
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", "0"]).envs(env.iter().map(|(k, v)| (k, v))).env("OPENCODE_PASSWORD", password).env_remove("OPENCODE_SERVER_PASSWORD").env_remove("OPENCODE_SERVER_USERNAME");
    Ok(cmd)
}

/// Starts `opencode serve` on a loopback port the system picks, with a password Kolux made, and waits
/// for the line that names its address.
fn start_server(env: &[(String, String)]) -> Result<Up, String> {
    let program = crate::agents::find_program(AGENT).ok_or_else(|| "OpenCode was not found on PATH. Install it, then open the chat again.".to_string())?;
    launch(&program, env, &new_password()?)
}

/// Starts `program` as the server. It is put in its own job right after it starts, before anything it
/// starts in turn (MCP servers, language servers), so all of them end with the job.
pub(super) fn launch(program: &std::path::Path, env: &[(String, String)], password: &str) -> Result<Up, String> {
    let password = password.to_string();
    let mut cmd = serve_command(program, env, &password)?;
    if let Some(home) = crate::chat::home().filter(|h| h.is_dir()) {
        cmd.current_dir(home);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut proc = own(cmd.spawn().map_err(|e| format!("Could not start OpenCode: {e}"))?);
    let (child, pid) = (&mut proc.child, proc.pid);
    // Both pipes are read for as long as the server lives, so it never blocks on a full one. Its
    // stdout lines are not kept or sent anywhere.
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
    let mut base = None;
    while base.is_none() {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => base = listening(&line),
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
    Ok(Up { proc: Some(proc), api: Api { base: base.unwrap_or_default(), password, http } })
}

impl Server {
    pub fn new(cfg: Config) -> Self {
        Self::with_starter(cfg, Arc::new(start_server))
    }

    pub(super) fn with_starter(cfg: Config, start: Starter) -> Self {
        Server { cfg, state: Mutex::default(), cv: Condvar::new(), start, retry_base: Duration::from_millis(300), retry_tries: 8, model_poll: Duration::from_millis(500) }
    }

    /// The environment every start of the server uses (the sign-in and settings a terminal's OpenCode
    /// gets). Set by every command before it may wake the server.
    pub fn set_env(&self, env: Vec<(String, String)>) {
        self.lock().env = env;
    }

    #[cfg(test)]
    pub(super) fn env(&self) -> Vec<(String, String)> {
        self.lock().env.clone()
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn chats_of(st: &State) -> Vec<Arc<OpenChat>> {
        st.chats.values().flatten().cloned().collect()
    }

    /// Takes the server out of the state, with the chats to tell. The caller ends it with
    /// [`Server::bring_down`] once the lock is let go.
    fn take_down(st: &mut State) -> Option<(Up, Vec<Arc<OpenChat>>)> {
        let up = st.up.take()?;
        st.ready = false;
        // The next server may list other models (another sign-in, a changed setting).
        st.models = None;
        Some((up, Self::chats_of(st)))
    }

    /// Ends a server [`Server::take_down`] took out, and tells its chats. Never called with the lock
    /// held: `taskkill` can take a while.
    fn bring_down(&self, gone: Option<(Up, Vec<Arc<OpenChat>>)>, code: Option<i32>, reason: ExitReason) {
        self.cv.notify_all();
        if let Some((up, chats)) = gone {
            let pid = up.pid();
            up.end();
            for c in chats {
                c.server_gone(pid, code, reason);
            }
        }
    }

    /// The running server, started first when it is not up. Returns its API, its pid and the count of
    /// this start. The lock is let go while the server starts, so a quit or a status read never waits
    /// for it; a second waker waits for the start instead of making another. Every start uses the
    /// server's own environment.
    fn wake(self: &Arc<Self>) -> Result<(Api, u32, u64), String> {
        let mut st = self.lock();
        st.last_active = Some(Instant::now());
        // A quit while this caller waits for another start must not be followed by a fresh start.
        let halts = st.halts;
        while st.starting {
            st = self.cv.wait(st).unwrap_or_else(|e| e.into_inner());
        }
        if st.halts != halts {
            return Err("Kolux is closing.".to_string());
        }
        let mut lost = None;
        if let Some(up) = st.up.as_mut() {
            match up.ended() {
                None => {
                    let out = (up.api.clone(), up.pid(), st.gen);
                    drop(st);
                    self.wait_ready(out.2)?;
                    return Ok(out);
                }
                // It ended by itself and its watcher has not said so yet: say it here, then start again.
                Some((_, code)) => lost = Some(code),
            }
        }
        let gone = Self::take_down(&mut st);
        st.starting = true;
        let env = st.env.clone();
        drop(st);
        if lost.is_some() {
            self.bring_down(gone, lost.flatten(), ExitReason::Crashed);
        }
        // A starter that panics must not leave `starting` set, or every later waker waits forever.
        let started = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.start)(&env))).unwrap_or_else(|_| Err("OpenCode could not be started.".to_string()));
        let mut st = self.lock();
        st.starting = false;
        let out = match started {
            Ok(up) if st.halts == halts => {
                st.gen += 1;
                st.ready = false;
                st.stream_fails = 0;
                let out = (up.api.clone(), up.pid(), st.gen);
                st.up = Some(up);
                Ok(out)
            }
            // The app began quitting while the server started: it is ended, never used.
            Ok(up) => {
                drop(st);
                self.cv.notify_all();
                up.end();
                return Err("Kolux is closing.".to_string());
            }
            Err(e) => Err(e),
        };
        drop(st);
        self.cv.notify_all();
        let out = out?;
        self.listen(out.0.clone(), out.2);
        let watcher = Arc::clone(self);
        let gen = out.2;
        std::thread::spawn(move || watcher.watch(gen));
        self.wait_ready(gen)?;
        Ok(out)
    }

    /// Events sent while nobody listens are lost, so nothing is asked of the server before its event
    /// stream is open. A stream that is slow to open is waited for a while, then the caller goes on.
    fn wait_ready(&self, gen: u64) -> Result<(), String> {
        let st = self.lock();
        let (st, _) = self.cv.wait_timeout_while(st, READY_WAIT, |s| !s.ready && s.gen == gen && s.up.is_some()).unwrap_or_else(|e| e.into_inner());
        if st.gen != gen || st.up.is_none() {
            return Err("OpenCode stopped before Kolux could follow it. Try again.".to_string());
        }
        Ok(())
    }

    /// The server's API when it is up; never starts it.
    fn api(&self) -> Option<Api> {
        self.lock().up.as_ref().map(|u| u.api.clone())
    }

    /// Opens the event stream and routes each event to its chats. The stream counts as open (the
    /// state's `ready`) once its first event has arrived; a refused stream (a status that is not 2xx)
    /// never opens.
    fn listen(self: &Arc<Self>, api: Api, gen: u64) {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let req = api.http.get(format!("{}/api/event", api.base)).basic_auth(USER, Some(&api.password)).header("accept", "text/event-stream");
        tauri::async_runtime::spawn(async move {
            if let Ok(mut resp) = req.send().await {
                if !resp.status().is_success() {
                    return;
                }
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
            let mut opened = None;
            for chunk in rx {
                for (kind, data) in frames.feed(&chunk) {
                    if opened.is_none() {
                        opened = Some(Instant::now());
                        me.opened(gen);
                    }
                    me.route(gen, &kind, &data);
                }
            }
            // A stream that opened and dropped at once counts as a failure, or a server that keeps
            // dropping it would be re-opened forever.
            let steady = opened.is_some_and(|t| t.elapsed() >= STREAM_STEADY);
            me.stream_ended(gen, api, opened.is_some(), steady);
        });
    }

    /// The stream of start `gen` is open: waiting callers may go on.
    fn opened(&self, gen: u64) {
        {
            let mut st = self.lock();
            if st.gen != gen {
                return;
            }
            st.ready = true;
        }
        self.cv.notify_all();
    }

    fn route(&self, gen: u64, kind: &str, data: &Value) {
        let Some(session) = data.get("sessionID").and_then(Value::as_str) else { return };
        let (chats, asked) = {
            let mut st = self.lock();
            if st.gen != gen {
                return;
            }
            let chats = st.chats.get(session).cloned().unwrap_or_default();
            if !chats.is_empty() {
                st.last_active = Some(Instant::now());
            }
            // Answered here, before any chat: a subagent's own session has no chat of its own, and
            // its question would wait forever.
            let asked = if kind == "permission.asked" { st.up.as_ref().map(|u| u.api.clone()) } else { None };
            (chats, asked)
        };
        if let Some(api) = asked {
            allow(api, session, data);
        }
        for c in chats {
            c.heard(kind, data);
        }
    }

    /// The event stream closed while its server still runs (OpenCode drops a listener that falls
    /// behind). Events were missed, so a turn that was running is ended on the page with a notice, and
    /// the stream is opened again. A stream that keeps failing to open is tried again after a wait
    /// that doubles each time; after `retry_tries` in a row the server is given up and its chats are
    /// told why.
    fn stream_ended(self: &Arc<Self>, gen: u64, api: Api, opened: bool, steady: bool) {
        // A server that crashed closes its stream first: give its end a moment to show, so its chats
        // hear the crash rather than a lost link.
        std::thread::sleep(self.retry_base.min(Duration::from_millis(300)));
        let (wait, chats) = {
            let mut st = self.lock();
            let alive = st.gen == gen && st.up.as_mut().is_some_and(|u| u.ended().is_none());
            if !alive {
                return;
            }
            st.ready = false;
            if steady {
                st.stream_fails = 0;
            } else {
                st.stream_fails += 1;
            }
            let fails = st.stream_fails;
            if fails >= self.retry_tries {
                let gone = Self::take_down(&mut st);
                drop(st);
                if let Some((_, chats)) = &gone {
                    for c in chats {
                        c.say("OpenCode refused Kolux's event stream, so the chat cannot follow its replies. Kolux stopped OpenCode; send again to start it fresh.");
                    }
                }
                self.bring_down(gone, None, ExitReason::Crashed);
                return;
            }
            let wait = self.retry_base.saturating_mul(1u32 << fails.saturating_sub(1).min(16)).min(RETRY_MAX);
            (wait, if opened { Self::chats_of(&st) } else { Vec::new() })
        };
        for c in chats {
            c.stream_lost();
        }
        std::thread::sleep(wait);
        let alive = {
            let mut st = self.lock();
            st.gen == gen && st.up.as_mut().is_some_and(|u| u.ended().is_none())
        };
        if alive {
            self.listen(api, gen);
        }
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
            let dead = st.up.as_mut().and_then(Up::ended);
            let busy = st.chats.values().flatten().any(|c| c.busy());
            let limit = if busy { self.cfg.busy_idle } else { self.cfg.idle };
            let why = match dead {
                Some((clean, code)) => Some((if clean { ExitReason::Ended } else { ExitReason::Crashed }, code)),
                None if st.last_active.is_none_or(|t| t.elapsed() >= limit) => Some((ExitReason::Sleep, None)),
                None => None,
            };
            if let Some((reason, code)) = why {
                let gone = Self::take_down(&mut st);
                drop(st);
                self.bring_down(gone, code, reason);
                return;
            }
        }
    }

    /// Ends the server (the app is quitting). Open chats were closed by the caller. A start under way
    /// is not waited for: it ends its server itself when it finishes. The process is ended after the
    /// lock is let go.
    pub fn shutdown(&self) {
        let gone = {
            let mut st = self.lock();
            st.halts += 1;
            st.chats.clear();
            Self::take_down(&mut st)
        };
        self.cv.notify_all();
        if let Some((up, _)) = gone {
            up.end();
        }
    }

    /// Whether the server process is up right now.
    pub fn is_running(&self) -> bool {
        self.lock().up.is_some()
    }

    /// OpenCode's models. The list is kept once it has been read with something in it; a server that
    /// has just started answers with an empty list for a moment, so the read is tried again. One read
    /// runs at a time: a caller that comes while one runs waits for its answer.
    pub fn models(self: &Arc<Self>, env: &[(String, String)]) -> Result<Vec<ModelRow>, String> {
        {
            let mut st = self.lock();
            st.env = env.to_vec();
            if let Some(m) = st.models.clone() {
                return Ok(m);
            }
            if st.models_reading {
                let round = st.models_round;
                let st = self.cv.wait_while(st, |s| s.models_round == round).unwrap_or_else(|e| e.into_inner());
                return st.models_last.clone().unwrap_or_else(|| Err("OpenCode did not list its models.".to_string()));
            }
            st.models_reading = true;
        }
        let out = self.read_models();
        {
            let mut st = self.lock();
            st.models_reading = false;
            st.models_round += 1;
            if let Ok(rows) = &out {
                if !rows.is_empty() {
                    st.models = Some(rows.clone());
                }
            }
            st.models_last = Some(out.clone());
        }
        self.cv.notify_all();
        out
    }

    fn read_models(self: &Arc<Self>) -> Result<Vec<ModelRow>, String> {
        let (api, _, _) = self.wake()?;
        let mut rows = Vec::new();
        for _ in 0..MODEL_TRIES {
            rows = model_rows(&api.ok("GET", "/api/model", None)?);
            if !rows.is_empty() {
                break;
            }
            std::thread::sleep(self.model_poll);
        }
        Ok(rows)
    }

    /// The saved chats of a folder, newest first.
    pub fn sessions(self: &Arc<Self>, env: &[(String, String)], cwd: &str) -> Result<Vec<SessionRow>, String> {
        self.set_env(env.to_vec());
        let (api, _, _) = self.wake()?;
        let mut rows = session_rows(&api.ok("GET", &format!("/api/session?directory={}&order=desc&limit=100", enc(cwd)), None)?);
        rows.sort_by_key(|r| std::cmp::Reverse(r.updated_at));
        Ok(rows)
    }

    /// Deletes a saved chat for good.
    pub fn delete(self: &Arc<Self>, env: &[(String, String)], session: &str) -> Result<(), String> {
        if !valid_session(session) {
            return Err(format!("\"{session}\" is not a session id."));
        }
        self.set_env(env.to_vec());
        let (api, _, _) = self.wake()?;
        api.ok("DELETE",&format!("/api/session/{session}"), None).map(|_| ())
    }

    /// What a reopened chat shows: the newest saved messages of its session.
    pub fn history(self: &Arc<Self>, env: &[(String, String)], session: &str, limit: usize) -> Result<crate::chat::ChatRead, String> {
        if !valid_session(session) {
            return Err(format!("\"{session}\" is not a session id."));
        }
        let gone = |_| "This chat's conversation is not in OpenCode anymore.".to_string();
        self.set_env(env.to_vec());
        let (api, _, _) = self.wake()?;
        api.ok("GET", &format!("/api/session/{session}"), None).map_err(gone)?;
        let list = api.ok("GET", &format!("/api/session/{session}/message?limit={}&order=desc", limit.clamp(1, HISTORY_MESSAGES)), None).map_err(gone)?;
        let mut messages = list.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        messages.reverse();
        let items = history_items(&messages);
        Ok(crate::chat::ChatRead { state: if items.is_empty() { "empty" } else { "ready" }, reset: true, items, open: false, error: None, retry_ms: 1_000, older: None, earlier: false })
    }
}

/// OpenCode asks before a tool call its rules do not already allow. A chat never asks (DT-C283), so
/// every question on this private server is answered "allow once", whatever its session: a subagent
/// runs in a session of its own that no chat has open. The question still reaches an open chat of its
/// session as a `raw` event.
fn allow(api: Api, session: &str, data: &Value) {
    let request = text_of(data, "id");
    if !valid_session(session) || !valid_session(&request) {
        return;
    }
    let session = session.to_string();
    std::thread::spawn(move || {
        let _ = api.call("POST", &format!("/api/session/{session}/permission/{request}/reply"), Some(json!({ "decision": "once" })));
    });
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
        let (api, pid, gen) = server.wake()?;
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
        let chat = Self::attach(server, chat_id, spec, &session, model, gen, sink);
        chat.emit(&ChatEvent::Started { pid, resumed: resume });
        chat.emit(&chat.init(data));
        Ok(chat)
    }

    /// Makes the chat for `session` and puts it in the server's routing table.
    pub(super) fn attach(server: &Arc<Server>, chat_id: &str, spec: Spec, session: &str, model: Option<Value>, gen: u64, sink: Sink) -> Arc<OpenChat> {
        let chat = Arc::new(OpenChat { id: chat_id.to_string(), sink, server: Arc::clone(server), inner: Mutex::new(ChatInner { spec, session: session.to_string(), seen_gen: gen, model, pending_model: None, tr: Translator::new(session), closed: false }) });
        server.lock().chats.entry(session.to_string()).or_default().push(Arc::clone(&chat));
        chat
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
        let (api, pid, gen) = self.server.wake()?;
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
            if let Err(e) = api.ok("POST", &format!("/api/session/{session}/model"), Some(json!({ "model": w }))) {
                // The pick stays waiting for the next send, and the page is told the message did not go.
                let name = model_name(Some(&w)).unwrap_or_default();
                {
                    let mut i = self.lock();
                    if i.pending_model.is_none() {
                        i.pending_model = Some(w);
                    }
                }
                let line = format!("OpenCode did not switch this chat to {name}, so the message was not sent. Pick the model again or send again to retry. ({e})");
                self.emit(&ChatEvent::Stderr { line: line.clone() });
                return Err(line);
            }
        }
        api.ok("POST", &format!("/api/session/{session}/prompt"), Some(json!({ "text": text }))).map(|_| ())
    }

    /// Stops the running turn. Never `None`: with nothing running it is `Ended`. `Interrupt` when OpenCode ended the turn
    /// itself; `Ended` when it did not say so within the stop grace, and the page is told the turn is
    /// over anyway (the shared server is never ended for one chat's stop).
    ///
    /// A run the page was already told is over but OpenCode may still be running (a lost stream, a
    /// stop that got no answer) is stopped too. With nothing to stop, the page still hears `stopped`,
    /// so a Stop never leaves it waiting.
    pub fn stop(&self) -> Option<StopHow> {
        let (session, busy, orphan) = {
            let i = self.lock();
            (i.session.clone(), i.tr.busy(), i.tr.orphaned())
        };
        if !busy && !orphan {
            self.emit(&ChatEvent::Stopped { how: StopHow::Ended });
            return Some(StopHow::Ended);
        }
        let asked = self.server.api().is_some_and(|api| api.ok("POST", &format!("/api/session/{session}/interrupt"), None).is_ok());
        let end = Instant::now() + self.server.cfg.stop_grace;
        let how = loop {
            if !asked || Instant::now() >= end {
                break StopHow::Ended;
            }
            let i = self.lock();
            if !i.tr.running() && !i.tr.orphaned() {
                break StopHow::Interrupt;
            }
            drop(i);
            std::thread::sleep(Duration::from_millis(20));
        };
        if how == StopHow::Ended {
            // A stop OpenCode took drops its queue; one it did not take leaves the queue to run.
            let cut = {
                let mut i = self.lock();
                if asked {
                    i.tr.cut(Instant::now())
                } else {
                    i.tr.cut_kept(Instant::now())
                }
            };
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
        self.end(true);
    }

    /// Closes the chat as the app quits: the page hears `exit`, and no stop is sent. The server is
    /// ended next, which ends any running turn, so quit never waits on OpenCode.
    pub fn close_for_quit(&self) {
        self.end(false);
    }

    fn end(&self, interrupt: bool) {
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
            // Only this chat: the same session may be open in another one.
            if let Some(list) = st.chats.get_mut(&session) {
                list.retain(|c| !std::ptr::eq(Arc::as_ptr(c), self));
                if list.is_empty() {
                    st.chats.remove(&session);
                }
            }
            st.up.as_ref().map(|u| (u.pid(), u.api.clone()))
        };
        if let Some((pid, api)) = up {
            if busy && interrupt {
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

    /// A line from Kolux about the server, shown as the chat's `stderr`.
    fn say(&self, line: &str) {
        if !self.lock().closed {
            self.emit(&ChatEvent::Stderr { line: line.to_string() });
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
            i.tr.lost(vec!["Kolux lost its link to OpenCode for a moment. The reply may have gone on without being shown; reopen the chat to see what was saved.".to_string()], Instant::now())
        };
        for e in &lost {
            self.emit(e);
        }
    }
}

#[cfg(test)]
#[path = "opencode_lifecycle_tests.rs"]
mod lifecycle_tests;
