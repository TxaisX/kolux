//! The typed reading of one stdout line of `claude -p --output-format stream-json --verbose`.
//!
//! Every line becomes exactly one [`ChatEvent`]; a line this file does not know (a new message
//! type, a hook event, a control response, text that is not JSON) is kept whole as
//! [`ChatEvent::Raw`], so nothing the agent says is dropped. Field names follow the Agent SDK's
//! documented message types (see docs/chat-engine.md for the sources); every field is read
//! leniently, so a missing optional field never loses the line.
//!
//! Tool steps go through the chat view's own parsers: [`crate::chat_tools::claude_step`] names
//! each tool call (or turns a to-do list / plan into Markdown), and [`crate::chat_tools::cap`] with
//! [`crate::chat_tools::MAX_OUTPUT`] bounds a tool result's text.
use crate::chat_tools::{self, Step, Tool};
use serde::Serialize;
use serde_json::Value;

/// One event of one chat, sent to the page as the `chat-event` Tauri event (with the chat's id).
// Events live for one line: read, sent to the page, dropped. Boxing the big variants would
// only cost an allocation per line, so the size gap is accepted.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ChatEvent {
    /// A process for the chat started; `resumed` is the session it resumes, if any.
    Started { pid: u32, resumed: Option<String> },
    /// `system/init`: what the session loaded (tools, skills, plugins, MCP servers, model).
    Init(Init),
    /// An assistant message: text, thinking and tool calls. `parent_tool_use_id` names the
    /// subagent (Task) call this message belongs to; `None` is the main conversation.
    Assistant { session_id: Option<String>, parent_tool_use_id: Option<String>, message_id: Option<String>, model: Option<String>, blocks: Vec<Block>, error: Option<String> },
    /// A user message: echoed text and, mostly, tool results.
    User { parent_tool_use_id: Option<String>, text: Vec<String>, tool_results: Vec<ToolResult> },
    /// `system/compact_boundary`: the conversation was compacted here.
    CompactBoundary { trigger: Option<String>, pre_tokens: Option<u64> },
    /// `system/permission_denied`: a tool call was refused.
    PermissionDenied { tool_name: String, tool_use_id: Option<String>, decision_reason_type: Option<String>, decision_reason: Option<String>, message: Option<String> },
    /// `system/api_retry`: an API call failed and will be tried again.
    ApiRetry { attempt: Option<u64>, max_retries: Option<u64>, retry_delay_ms: Option<u64>, error_status: Option<u64>, error: Option<String> },
    /// `result`: the turn ended (success or an error subtype), with its cost and usage.
    Result(TurnResult),
    /// One line the process wrote to stderr.
    Stderr { line: String },
    /// The process ended. `code` is its exit code when it had one.
    Exit { code: Option<i32>, reason: ExitReason },
    /// `chat_stop` finished: `interrupt` when the agent ended the turn itself, `ended` when the
    /// process had to be ended (the next send resumes the session).
    Stopped { how: StopHow },
    /// A line this reader does not know, kept whole; `json` is set when it parsed as JSON.
    Raw { line: String, json: Option<Value> },
}

/// Why a chat's process ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExitReason {
    /// `chat_end` or the app quitting.
    Closed,
    /// Idle sleep: no turn ran for the idle time; the next send resumes the session.
    Sleep,
    /// `chat_stop` had to end the process (the interrupt got no answer in time).
    Stopped,
    /// It ended by itself with exit code 0.
    Ended,
    /// It ended by itself with another code (or none).
    Crashed,
}

/// How `chat_stop` stopped the turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopHow {
    Interrupt,
    Ended,
}

/// The `system/init` message, every documented field typed, plus the whole line in `raw`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Init {
    pub session_id: String,
    pub uuid: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub claude_code_version: Option<String>,
    pub api_key_source: Option<String>,
    pub output_style: Option<String>,
    pub tools: Vec<String>,
    pub slash_commands: Vec<String>,
    pub terminal_slash_commands: Vec<String>,
    pub skills: Vec<String>,
    pub agents: Vec<String>,
    pub betas: Vec<String>,
    pub capabilities: Vec<String>,
    pub plugins: Vec<Plugin>,
    pub plugin_errors: Vec<PluginError>,
    pub mcp_servers: Vec<McpServer>,
    pub mcp_server_errors: Vec<McpServerError>,
    pub fast_mode_state: Option<Value>,
    pub effort: Option<Value>,
    pub raw: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub name: String,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginError {
    pub plugin: String,
    pub kind: Option<String>,
    pub message: Option<String>,
    pub path: Option<String>,
}

/// One MCP server (a "connector"); `status` is the agent's own word (`connected`, `failed`, ...).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub status: Option<String>,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerError {
    pub name: String,
    pub kind: Option<String>,
    pub message: Option<String>,
}

/// One content block of an assistant message.
// Events live for one line: read, sent to the page, dropped. Boxing the big variants would
// only cost an allocation per line, so the size gap is accepted.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Block {
    Text { text: String },
    Thinking { text: String },
    /// A tool call; `step` is the chat view's reading of it (see `chat_tools::claude_step`).
    ToolUse { id: String, name: String, input: Value, step: StepView },
    /// A block type this reader does not know, kept whole.
    Other { raw: Value },
}

/// `chat_tools::Step`, in a form the page can read.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StepView {
    Tool { tool: Tool },
    Plan { text: String, per_turn: bool },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_use_id: String,
    /// The result's text, capped at `chat_tools::MAX_OUTPUT` bytes.
    pub output: String,
    pub is_error: bool,
}

/// A `permission_denials` entry of a result.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Denial {
    pub tool_name: String,
    pub tool_use_id: Option<String>,
    pub tool_input: Value,
}

/// The `result` message that ends a turn.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    /// `success`, or an error subtype such as `error_during_execution` (an interrupted turn).
    pub subtype: String,
    pub is_error: bool,
    pub result: Option<String>,
    pub errors: Vec<String>,
    pub session_id: Option<String>,
    pub num_turns: Option<u64>,
    pub duration_ms: Option<u64>,
    pub duration_api_ms: Option<u64>,
    pub total_cost_usd: Option<f64>,
    pub usage: Option<Value>,
    pub model_usage: Option<Value>,
    pub stop_reason: Option<String>,
    pub permission_denials: Vec<Denial>,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn u(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn list<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v.get(key).and_then(Value::as_array).into_iter().flatten()
}

/// `agents` is documented as names; an object entry (a richer future shape) gives its `name`.
fn names(v: &Value, key: &str) -> Vec<String> {
    list(v, key).filter_map(|x| x.as_str().map(String::from).or_else(|| s(x, "name"))).collect()
}

/// Reads one stdout line. Blank lines give `None`; every other line gives one event.
pub fn parse_line(line: &str) -> Option<ChatEvent> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() {
        return None;
    }
    let raw = || ChatEvent::Raw { line: line.to_string(), json: None };
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Some(raw()) };
    let unknown = |v: Value| ChatEvent::Raw { line: line.to_string(), json: Some(v) };
    let ev = match (v.get("type").and_then(Value::as_str), v.get("subtype").and_then(Value::as_str)) {
        (Some("system"), Some("init")) => ChatEvent::Init(init(&v)),
        (Some("system"), Some("compact_boundary")) => {
            let m = v.get("compact_metadata").cloned().unwrap_or(Value::Null);
            ChatEvent::CompactBoundary { trigger: s(&m, "trigger"), pre_tokens: u(&m, "pre_tokens") }
        }
        (Some("system"), Some("permission_denied")) => ChatEvent::PermissionDenied {
            tool_name: s(&v, "tool_name").unwrap_or_default(),
            tool_use_id: s(&v, "tool_use_id"),
            decision_reason_type: s(&v, "decision_reason_type"),
            decision_reason: s(&v, "decision_reason"),
            message: s(&v, "message"),
        },
        (Some("system"), Some("api_retry")) => ChatEvent::ApiRetry { attempt: u(&v, "attempt"), max_retries: u(&v, "max_retries"), retry_delay_ms: u(&v, "retry_delay_ms"), error_status: u(&v, "error_status"), error: v.get("error").map(|e| e.as_str().map(String::from).unwrap_or_else(|| e.to_string())) },
        (Some("assistant"), _) => assistant(&v),
        (Some("user"), _) => user(&v),
        (Some("result"), _) => ChatEvent::Result(result(&v)),
        _ => return Some(unknown(v)),
    };
    Some(ev)
}

fn init(v: &Value) -> Init {
    Init {
        session_id: s(v, "session_id").unwrap_or_default(),
        uuid: s(v, "uuid"),
        cwd: s(v, "cwd"),
        model: s(v, "model"),
        permission_mode: s(v, "permissionMode").or_else(|| s(v, "permission_mode")),
        claude_code_version: s(v, "claude_code_version"),
        api_key_source: s(v, "apiKeySource").or_else(|| s(v, "api_key_source")),
        output_style: s(v, "output_style"),
        tools: strings(v, "tools"),
        slash_commands: strings(v, "slash_commands"),
        terminal_slash_commands: strings(v, "terminal_slash_commands"),
        skills: names(v, "skills"),
        agents: names(v, "agents"),
        betas: strings(v, "betas"),
        capabilities: strings(v, "capabilities"),
        plugins: list(v, "plugins").map(|p| Plugin { name: s(p, "name").unwrap_or_default(), path: s(p, "path") }).collect(),
        plugin_errors: list(v, "plugin_errors").map(|p| PluginError { plugin: s(p, "plugin").unwrap_or_default(), kind: s(p, "type"), message: s(p, "message"), path: s(p, "path") }).collect(),
        mcp_servers: list(v, "mcp_servers").map(|m| McpServer { name: s(m, "name").unwrap_or_default(), status: s(m, "status"), source: s(m, "source") }).collect(),
        mcp_server_errors: list(v, "mcp_server_errors").map(|m| McpServerError { name: s(m, "name").unwrap_or_default(), kind: s(m, "type"), message: s(m, "message") }).collect(),
        fast_mode_state: v.get("fast_mode_state").cloned(),
        effort: v.get("effort").cloned(),
        raw: v.clone(),
    }
}

fn step_view(step: Step) -> StepView {
    match step {
        Step::Tool(tool) => StepView::Tool { tool },
        Step::Plan { text, per_turn } => StepView::Plan { text, per_turn },
    }
}

fn assistant(v: &Value) -> ChatEvent {
    let msg = v.get("message").cloned().unwrap_or(Value::Null);
    let blocks = list(&msg, "content")
        .map(|b| match b.get("type").and_then(Value::as_str) {
            Some("text") => Block::Text { text: s(b, "text").unwrap_or_default() },
            Some("thinking") => Block::Thinking { text: s(b, "thinking").unwrap_or_default() },
            Some("tool_use") => {
                let (id, name) = (s(b, "id").unwrap_or_default(), s(b, "name").unwrap_or_default());
                let input = b.get("input").cloned().unwrap_or(Value::Null);
                let step = step_view(chat_tools::claude_step(&id, &name, &input));
                Block::ToolUse { id, name, input, step }
            }
            _ => Block::Other { raw: b.clone() },
        })
        .collect();
    let error = v.get("error").filter(|e| !e.is_null()).map(|e| e.as_str().map(String::from).unwrap_or_else(|| e.to_string()));
    ChatEvent::Assistant { session_id: s(v, "session_id"), parent_tool_use_id: s(v, "parent_tool_use_id"), message_id: s(&msg, "id"), model: s(&msg, "model"), blocks, error }
}

/// A tool result's text: a plain string, or the text parts of a content array joined by lines.
fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(t)) => t.clone(),
        Some(Value::Array(parts)) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

fn user(v: &Value) -> ChatEvent {
    let content = v.get("message").and_then(|m| m.get("content"));
    let (mut text, mut tool_results) = (Vec::new(), Vec::new());
    match content {
        Some(Value::String(t)) => text.push(t.clone()),
        Some(Value::Array(parts)) => {
            for p in parts {
                match p.get("type").and_then(Value::as_str) {
                    Some("text") => text.push(s(p, "text").unwrap_or_default()),
                    Some("tool_result") => tool_results.push(ToolResult {
                        tool_use_id: s(p, "tool_use_id").unwrap_or_default(),
                        output: chat_tools::cap(result_text(p.get("content")), chat_tools::MAX_OUTPUT),
                        is_error: p.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    }),
                    _ => {}
                }
            }
        }
        _ => {}
    }
    ChatEvent::User { parent_tool_use_id: s(v, "parent_tool_use_id"), text, tool_results }
}

fn result(v: &Value) -> TurnResult {
    TurnResult {
        subtype: s(v, "subtype").unwrap_or_default(),
        is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
        result: s(v, "result"),
        errors: strings(v, "errors"),
        session_id: s(v, "session_id"),
        num_turns: u(v, "num_turns"),
        duration_ms: u(v, "duration_ms"),
        duration_api_ms: u(v, "duration_api_ms"),
        total_cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
        usage: v.get("usage").cloned(),
        model_usage: v.get("modelUsage").or_else(|| v.get("model_usage")).cloned(),
        stop_reason: s(v, "stop_reason"),
        permission_denials: list(v, "permission_denials").map(|d| Denial { tool_name: s(d, "tool_name").unwrap_or_default(), tool_use_id: s(d, "tool_use_id"), tool_input: d.get("tool_input").cloned().unwrap_or(Value::Null) }).collect(),
    }
}

/// What a chat is expected to load: the names of the user's skills, plugins and connectors (MCP
/// servers) as Kolux found them on disk.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Expected {
    pub skills: Vec<String>,
    pub plugins: Vec<String>,
    pub connectors: Vec<String>,
}

/// The empty-init alarm: true when the session came up with no skills, no plugins and no
/// connectors at all while the user has at least one of them. That pattern means the agent ran
/// without the user's setup (a stripped "bare" start, or the wrong config folder), not that the
/// user has none.
pub fn empty_init_alarm(init: &Init, expected: &Expected) -> bool {
    let loaded_nothing = init.skills.is_empty() && init.plugins.is_empty() && init.mcp_servers.is_empty();
    let expects_something = !(expected.skills.is_empty() && expected.plugins.is_empty() && expected.connectors.is_empty());
    loaded_nothing && expects_something
}
