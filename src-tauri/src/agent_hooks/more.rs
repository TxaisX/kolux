//! T-121 (STAT-012 / STAT-013 / STAT-015) and T-122 (STAT-017): status hooks for Cursor Agent,
//! Factory's Droid, Kimi Code and GitHub Copilot CLI, from each vendor's public hook docs (PROVENANCE.md, T-121). As for the T-120-b vendors,
//! each event is turned into the one shape the status rules read (`normalize`); `change` then reads
//! it with Codex's rules plus what each card adds (a blocked stop, a question).
//!
//! - Cursor Agent: `~/.cursor/hooks.json`, `{"version": 1, "hooks": {"<event>": [{"command"}]}}`.
//! - Droid: `~/.factory/hooks.json` keyed by event (Claude Code's matcher groups), or, while that
//!   file is absent, the `hooks` key of `~/.factory/settings.json`, where `hooksDisabled` lives too.
//! - Kimi Code: `[[hooks]]` tables in `~/.kimi-code/config.toml`, inside one marked block after
//!   the user's own settings; taking the block out gives the file back byte for byte.
//! - Copilot CLI: Kolux's own `kolux-rs.json` in `hooks` under Copilot's home (`COPILOT_HOME`).
//! - Grok (STAT-018, `grok`): Kolux's own `kolux-rs.json` in `hooks` under Grok's home, taken away at quit.
//! - Devin CLI (STAT-019, `devin`): marked blocks in its commented user config (`jsonc`).
//! - Pi (STAT-021, `pi`): Kolux's own extension file, `kolux-rs.ts`, in Pi's user extensions folder.
//! - Hermes (STAT-016, `hermes`): marked blocks in its `config.yaml` shell hooks, approved in its allowlist.

use super::super::{codex_change, install_groups, script, write_atomic, write_json, write_script, Change};
use super::{back_up, backup_of, drop_created, fenced, kept, names_mine, read_opt, remove_groups, scratch_only, target_dir, was_created, Plan, BACKUP_RECORD};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

pub const CURSOR_SCRIPT: &str = "cursor.cmd";
pub const DROID_SCRIPT: &str = "droid.cmd";
pub const COMMAND_CODE_SCRIPT: &str = "command-code.cmd";
pub const KIMI_SCRIPT: &str = "kimi.cmd";
/// The agents this module manages, by catalogue id.
pub const AGENTS: [&str; 9] = ["cursor", "droid", "command-code", "kimi", "copilot", "grok", "devin", "pi", "hermes"];
pub const COPILOT_SCRIPT: &str = "copilot.cmd";
/// STAT-017: Copilot CLI's 13 events, under the names its compat list gives (the PascalCase ones,
/// whose payloads carry snake_case fields; subagentStart has no PascalCase form).
pub const COPILOT_EVENTS: [&str; 13] = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "subagentStart", "SubagentStop", "PreCompact", "Stop", "ErrorOccurred", "PermissionRequest", "Notification"];
/// Copilot's ask-the-user tool, by its documented name.
const COPILOT_ASK_TOOL: &str = "ask_user";
/// STAT-012 / DT-C49: the five Cursor state events installed. `preToolUse`, `beforeShellExecution` and
/// `beforeMCPExecution` are Cursor permission hooks: it blocks on any answer outside their schema
/// (cursor.com/docs/agent/hooks) and SAFE-009 guards only Claude Code, so they are understood
/// (`normalize`) but never installed, and install takes Kolux's old entries out. Session start can
/// fire while idle and is left unhooked on purpose; session end is understood but not installed.
pub const CURSOR_EVENTS: [&str; 5] = ["beforeSubmitPrompt", "stop", "postToolUse", "postToolUseFailure", "afterAgentResponse"];
/// STAT-013: Droid's documented events Kolux hooks. SessionStart and SubagentStop are installed
/// and ignored (both fire while idle). PermissionRequest is not in Factory's hook reference, so it
/// is read when it comes but not installed.
pub const DROID_EVENTS: [&str; 7] = ["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "PreToolUse", "PostToolUse", "Notification"];
const DROID_TOOL_EVENTS: [&str; 2] = ["PreToolUse", "PostToolUse"];
/// Whether each Claude-group agent's script prints the reply; install and write_scripts both read these.
const CURSOR_PRINTS: bool = true;
const DROID_PRINTS: bool = true;
const COMMAND_CODE_PRINTS: bool = false;
/// STAT-014: Command Code's events (commandcode.ai/docs/hooks/reference); SessionStart fires while idle, so it is not hooked.
pub const COMMAND_CODE_EVENTS: [&str; 3] = ["PreToolUse", "PostToolUse", "Stop"];
/// STAT-015: Kimi's events (its hook docs list each one).
pub const KIMI_EVENTS: [&str; 7] = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Stop", "StopFailure"];
/// Seconds, the unit Droid and Kimi take.
const TIMEOUT: u64 = 10;
/// The key a normalized event of this module carries: the agent it came from.
pub const MARK: &str = "kolux_more";
/// STAT-015: Kimi's block, opened and closed by these lines. A begin line naming Kolux under
/// another spelling (the product's former name) is taken as the same block and replaced.
const KIMI_BEGIN: &str = "# >>> kolux-rs status hooks (written by Kolux; Kolux takes this block out when its hooks go) >>>";
const KIMI_BEGIN_JOINED: &str = "# >>> kolux-rs status hooks (written by Kolux; joined) >>>";
const KIMI_END: &str = "# <<< kolux-rs status hooks <<<";
const MEMORY_CAP: usize = 256;

/// A path the hook listener takes for one of these agents.
pub fn is_route(path: &str) -> bool {
    agent_of(path).is_some()
}

/// The agent id a route reports for.
pub fn agent_of(path: &str) -> Option<&'static str> {
    let p = path.trim_start_matches('/');
    // Copilot's, Grok's and Pi's routes name the event (`copilot/<event>`), as Antigravity's does.
    let named = |a: &str| p.strip_prefix(a).and_then(|r| r.strip_prefix('/')).is_some_and(|e| !e.is_empty() && !e.contains('/'));
    AGENTS.iter().copied().find(|a| p == *a || (matches!(*a, "copilot" | "grok" | "pi") && named(a)))
}

/// What these agents' events need remembered between events, per session.
#[derive(Default)]
pub struct Memory {
    /// STAT-012: Cursor conversations whose turn stopped completed; an after-response event
    /// counts as done only for these.
    done: VecDeque<String>,
    /// STAT-013: the last tool each Droid session started, which its permission notice is about.
    tools: VecDeque<(String, String)>,
}

impl Memory {
    fn mark_done(&mut self, id: &str, done: bool) {
        self.done.retain(|d| d != id);
        if done {
            self.done.push_back(id.to_string());
            while self.done.len() > MEMORY_CAP {
                self.done.pop_front();
            }
        }
    }

    fn tool(&mut self, id: &str, tool: Option<&str>) {
        self.tools.retain(|(s, _)| s != id);
        if let Some(t) = tool {
            self.tools.push_back((id.to_string(), t.to_string()));
            while self.tools.len() > MEMORY_CAP {
                self.tools.pop_front();
            }
        }
    }

    fn last_tool(&self, id: &str) -> Option<&str> {
        self.tools.iter().find(|(s, _)| s == id).map(|(_, t)| t.as_str())
    }
}

static MEMORY: std::sync::Mutex<Memory> = std::sync::Mutex::new(Memory { done: VecDeque::new(), tools: VecDeque::new() });

/// The event as the status rules read it, or `None` when it changes nothing.
pub fn normalize(path: &str, event: &Value) -> Option<Value> {
    let mut memory = MEMORY.lock().unwrap_or_else(|e| e.into_inner());
    normalize_with(&mut memory, path, event)
}

/// The listener's and the spool replay's one entry for every vendor route: this module's, else
/// the T-120-b vendors'.
pub fn normalize_any(path: &str, event: &Value) -> Option<Value> {
    if is_route(path) { normalize(path, event) } else { super::vendors::normalize(path, event) }
}

/// `normalize` with the memory given.
pub fn normalize_with(memory: &mut Memory, path: &str, event: &Value) -> Option<Value> {
    let agent = agent_of(path)?;
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let name = match path.trim_start_matches('/').split_once('/') {
        Some((_, e)) => e,
        None => str_of("hook_event_name")?,
    };
    let tool = |n: Option<&str>, input: Option<&Value>| json!({ "tool_name": n, "tool_input": input });
    let (name, session, mut out) = match agent {
        "cursor" => {
            let session = str_of("conversation_id");
            let (name, out) = match name {
                "beforeSubmitPrompt" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "preToolUse" => ("PreToolUse", tool(str_of("tool_name"), event.get("tool_input"))),
                // STAT-012: shell and MCP steps are working, and never notify.
                "beforeShellExecution" => ("PreToolUse", tool(Some("Shell"), Some(&json!({ "command": str_of("command") })))),
                "beforeMCPExecution" => ("PreToolUse", tool(str_of("tool_name"), event.get("tool_input"))),
                "postToolUse" | "postToolUseFailure" => ("PostToolUse", tool(str_of("tool_name"), None)),
                // STAT-012: a stop whose status is anything but completed is an interruption.
                "stop" => {
                    let completed = str_of("status") == Some("completed");
                    if let Some(s) = session {
                        memory.mark_done(s, completed);
                    }
                    ("Stop", json!({ "kolux_interrupted": !completed }))
                }
                // The reply arrives on its own; it is a done only once the turn already stopped done.
                "afterAgentResponse" if session.is_some_and(|s| memory.done.iter().any(|d| d == s)) => ("Stop", json!({ "last_assistant_message": str_of("text") })),
                "sessionEnd" => ("Stop", json!({})),
                _ => return None,
            };
            if name == "UserPromptSubmit" {
                if let Some(s) = session {
                    memory.mark_done(s, false);
                }
            }
            (name, session, out)
        }
        // STAT-014: tool events mean working, Stop means done; the reply is always neutral.
        "command-code" => {
            let (name, out) = match name {
                "PreToolUse" => ("PreToolUse", tool(str_of("tool_name"), None)),
                "PostToolUse" => ("PostToolUse", tool(str_of("tool_name"), None)),
                "Stop" => ("Stop", json!({})),
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "droid" => {
            let session = str_of("session_id");
            let (name, out) = match name {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                // STAT-013: Kolux never infers an interruption from Ctrl+C for Droid.
                "Stop" => ("Stop", json!({ "kolux_no_cancel": true })),
                "PreToolUse" => {
                    if let Some(s) = session {
                        memory.tool(s, str_of("tool_name"));
                    }
                    ("PreToolUse", tool(str_of("tool_name"), event.get("tool_input")))
                }
                "PostToolUse" => ("PostToolUse", tool(str_of("tool_name"), None)),
                "PermissionRequest" => ("PermissionRequest", tool(str_of("tool_name"), event.get("tool_input"))),
                "Notification" => match droid_notice(str_of("notification_type"), str_of("message"))? {
                    Notice::Permission => ("PermissionRequest", tool(session.and_then(|s| memory.last_tool(s)), None)),
                    Notice::Ask => ("PreToolUse", json!({ "kolux_ask": str_of("message").unwrap_or("Droid needs your input") })),
                    Notice::Idle => ("Stop", json!({ "kolux_no_cancel": true })),
                },
                // SessionStart and SubagentStop fire while idle; the rest change nothing.
                _ => return None,
            };
            (name, session, out)
        }
        "kimi" => {
            let session = str_of("session_id");
            let (name, out) = match name {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                n @ ("PreToolUse" | "PermissionRequest") => (n, tool(str_of("tool_name"), event.get("tool_input"))),
                "PostToolUse" | "PostToolUseFailure" => ("PostToolUse", tool(str_of("tool_name"), None)),
                "Stop" => ("Stop", json!({})),
                // STAT-015: a rate-limit failure is blocked for the limit, never done.
                "StopFailure" => {
                    let error = str_of("error_type").or_else(|| str_of("error"));
                    ("StopFailure", json!({ "kolux_cause": if error.is_some_and(is_rate_limit) { "limit" } else { "error" }, "error_details": str_of("message") }))
                }
                _ => return None,
            };
            (name, session, out)
        }
        "copilot" => {
            // STAT-017: both spellings of each event and of each field are read.
            let either = |a: &str, b: &str| str_of(a).or_else(|| str_of(b));
            let session = either("session_id", "sessionId");
            let tool_name = either("tool_name", "toolName");
            let input = event.get("tool_input").or_else(|| event.get("toolArgs"));
            let (name, out) = match name {
                "UserPromptSubmit" | "userPromptSubmitted" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "PreToolUse" | "preToolUse" if tool_name == Some(COPILOT_ASK_TOOL) => ("PreToolUse", json!({ "kolux_ask": question(input).unwrap_or("Copilot is asking you something") })),
                "PreToolUse" | "preToolUse" => {
                    if let Some(s) = session {
                        memory.tool(s, tool_name);
                    }
                    ("PreToolUse", tool(tool_name, input))
                }
                "PostToolUse" | "postToolUse" | "PostToolUseFailure" | "postToolUseFailure" => ("PostToolUse", tool(tool_name, None)),
                "PermissionRequest" | "permissionRequest" => ("PermissionRequest", tool(tool_name.or_else(|| session.and_then(|s| memory.last_tool(s))), input)),
                "Notification" | "notification" => match droid_notice(None, str_of("message"))? {
                    Notice::Permission => ("PermissionRequest", tool(session.and_then(|s| memory.last_tool(s)), None)),
                    Notice::Ask => ("PreToolUse", json!({ "kolux_ask": str_of("message") })),
                    Notice::Idle => ("Stop", json!({})),
                },
                "Stop" | "agentStop" | "SessionEnd" | "sessionEnd" => ("Stop", json!({})),
                // STAT-017: an error Copilot recovers from keeps the turn working; any other ends it.
                "ErrorOccurred" | "errorOccurred" if event.get("recoverable").and_then(Value::as_bool) == Some(true) => ("PostToolUse", json!({})),
                "ErrorOccurred" | "errorOccurred" => ("Stop", json!({})),
                // Session start (idle at launch), subagent and before-compact events change nothing.
                _ => return None,
            };
            (name, session, out)
        }
        // T-122: Grok (STAT-018) and Devin (STAT-019).
        "grok" => grok::event(memory, name, event)?,
        "devin" => devin::event(name, event)?,
        // T-122: Pi (STAT-021), through Kolux's own extension.
        "pi" => pi::event(name, event)?,
        // T-121: Hermes (STAT-016), through its config.yaml shell hooks.
        "hermes" => hermes::event(name, event)?,
        _ => return None,
    };
    let o = out.as_object_mut()?;
    o.retain(|_, v| !v.is_null());
    o.insert("hook_event_name".into(), name.into());
    o.insert(MARK.into(), agent.into());
    if let Some(s) = session {
        o.insert("session_id".into(), s.into());
    }
    Some(out)
}

/// The question an ask-the-user call carries: its first text argument (the argument names are not
/// documented, so `question` and `message` are tried first).
fn question(input: Option<&Value>) -> Option<&str> {
    let o = input?.as_object()?;
    ["question", "message", "prompt"].iter().find_map(|k| o.get(*k).and_then(Value::as_str)).or_else(|| o.values().find_map(Value::as_str)).filter(|q| !q.trim().is_empty())
}

/// STAT-015: a failure kind that names a rate limit.
fn is_rate_limit(kind: &str) -> bool {
    let k = kind.to_ascii_lowercase().replace([' ', '-'], "_");
    k.contains("rate_limit") || k.contains("ratelimit") || k.contains("429")
}

enum Notice {
    Permission,
    Ask,
    Idle,
}

/// STAT-013: a Droid notice by its documented type (`permission_prompt`, `idle_prompt`,
/// `elicitation_dialog`), else by its wording; anything else is ignored.
fn droid_notice(kind: Option<&str>, message: Option<&str>) -> Option<Notice> {
    match kind {
        Some("permission_prompt") => return Some(Notice::Permission),
        Some("idle_prompt") => return Some(Notice::Idle),
        Some("elicitation_dialog") => return Some(Notice::Ask),
        Some(_) => return None,
        None => {}
    }
    let m = message?.to_ascii_lowercase();
    if m.contains("permission") {
        Some(Notice::Permission)
    } else if m.contains("waiting for your input") || m.contains("waiting for input") || m.contains("idle") {
        Some(Notice::Idle)
    } else {
        None
    }
}

/// A normalized event of this module's (`Some`), read by Codex's rules with what the cards add;
/// `None` for another vendor's event.
pub fn change(event: &Value) -> Option<Option<Change>> {
    event.get(MARK)?;
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let session = str_of("session_id").map(|s| s.chars().take(100).collect::<String>());
    if str_of("hook_event_name") == Some("StopFailure") {
        let cause = if str_of("kolux_cause") == Some("limit") { "limit" } else { "error" };
        return Some(Some(Change { state: "blocked", cause: Some(cause), detail: str_of("error_details").map(|d| d.chars().take(160).collect()), session, ..Change::default() }));
    }
    let mut change = codex_change(event);
    if let (Some(c), Some(ask)) = (change.as_mut(), str_of("kolux_ask")) {
        c.state = "waiting";
        c.detail = ask.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| l.chars().take(160).collect());
        c.ask = Some(ask.chars().take(8000).collect());
    }
    Some(change)
}

// Wired into agent_hooks::sync by evidence/hooks-T-121-mod.rs.patch (the lane/vendors region).
#[allow(dead_code)]
pub fn write_scripts(home: &Path) -> Result<String, String> {
    write_script(home, CURSOR_SCRIPT, &script("cursor", "cursor", CURSOR_PRINTS))?;
    write_script(home, DROID_SCRIPT, &script("droid", "droid", DROID_PRINTS))?;
    write_script(home, COMMAND_CODE_SCRIPT, &script("command-code", "command-code", COMMAND_CODE_PRINTS))?;
    // Kimi adds a hook's output to the model's context, so its script prints nothing.
    write_script(home, KIMI_SCRIPT, &script("kimi", "kimi", false))?;
    write_copilot_script(home)?;
    grok::write_script(home)?;
    pi::write_script(home)?;
    hermes::write_script(home)?;
    devin::write_script(home)
}

/// Copilot's script takes the event as its argument; it prints nothing, which Copilot reads as no
/// decision.
fn write_copilot_script(home: &Path) -> Result<String, String> {
    write_script(home, COPILOT_SCRIPT, &script("copilot", "copilot/%~1", false))
}

/// STAT-017: Copilot's home, `COPILOT_HOME` when the user set it.
fn copilot_home(home: &Path) -> PathBuf {
    std::env::var_os("COPILOT_HOME").filter(|h| !h.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".copilot"))
}

/// Kolux's own user-level hook file in Copilot's home.
pub fn copilot_file(home: &Path) -> PathBuf {
    copilot_home(home).join("hooks").join("kolux-rs.json")
}

/// A Copilot hook file is Kolux's when one of its commands runs a script from Kolux's folder.
fn copilot_mine(v: &Value) -> bool {
    v.get("hooks").and_then(Value::as_object).is_some_and(|h| {
        h.values().filter_map(Value::as_array).flatten().any(|e| ["bash", "powershell", "command"].iter().any(|k| e.get(*k).and_then(Value::as_str).is_some_and(super::super::is_my_command)))
    })
}

/// STAT-017: Kolux's file, written whole: version 1, one entry per event, no disable-all switch.
pub fn install_copilot(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_copilot_script(home)?;
    let text = read_opt(file)?;
    if let Some(t) = &text {
        if !serde_json::from_str::<Value>(t).is_ok_and(|v| copilot_mine(&v)) {
            return Err(format!("{} is not Kolux's own hook file; left alone", file.display()));
        }
    }
    let ps = super::vendors::gemini_command(&path);
    let hooks: Map<String, Value> = COPILOT_EVENTS.iter().map(|e| (e.to_string(), json!([{ "type": "command", "bash": format!("{} {e}", quoted(&path)), "powershell": format!("{ps} {e}"), "timeoutSec": TIMEOUT }]))).collect();
    let v = json!({ "version": 1, "hooks": hooks });
    if text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok()).as_ref() == Some(&v) {
        return Ok(false);
    }
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}; hooks not installed", dir.display()))?;
    }
    write_json(file, &v, text.as_deref())?;
    Ok(true)
}

/// Kolux's file goes; a file of the same name that is not Kolux's stays.
pub fn remove_copilot(file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    if !serde_json::from_str::<Value>(&text).is_ok_and(|v| copilot_mine(&v)) {
        return Ok(false);
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
    Ok(true)
}

fn inspect_copilot(file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file).map(|t| t.map(|t| serde_json::from_str::<Value>(&t))) {
        Ok(None) => ("not installed", None),
        Ok(Some(Ok(v))) if copilot_mine(&v) => {
            let missing: Vec<&str> = COPILOT_EVENTS.iter().copied().filter(|e| v["hooks"].get(*e).and_then(Value::as_array).is_none_or(|l| l.is_empty())).collect();
            if v.get("disableAllHooks").and_then(Value::as_bool) == Some(true) {
                ("partial", Some("disableAllHooks is set in Kolux's hook file".into()))
            } else if missing.is_empty() {
                ("installed", None)
            } else {
                ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
            }
        }
        Ok(Some(Ok(_))) => ("error", Some(format!("{} is not Kolux's own hook file", file.display()))),
        Ok(Some(Err(e))) => ("error", Some(format!("{} is not JSON ({e})", file.display()))),
        Err(e) => ("error", Some(e)),
    }
}

/// After-list row 481: neither Cursor nor Factory documents the shell its hook commands run in on
/// Windows. A plain path (letters, digits, `/ : . - _`) is written bare, which cmd, POSIX shells and
/// PowerShell all run; any other path keeps double quotes, which cmd and POSIX shells run
/// (coordinator default; Txais may overrule).
fn quoted(path: &str) -> String {
    if !path.is_empty() && path.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b':' | b'.' | b'-' | b'_')) {
        path.to_string()
    } else {
        format!("\"{path}\"")
    }
}

pub fn cursor_file(home: &Path) -> PathBuf {
    home.join(".cursor").join("hooks.json")
}

/// Droid reads `hooks.json` when it is there, else the `hooks` key of `settings.json`; Kolux
/// writes where Droid reads, so the user's hooks in `settings.json` never stop counting.
pub fn droid_file(home: &Path) -> PathBuf {
    let dir = home.join(".factory");
    if dir.join("hooks.json").is_file() { dir.join("hooks.json") } else { dir.join("settings.json") }
}

fn droid_wrapped(file: &Path) -> bool {
    file.file_name().is_some_and(|n| n == "hooks.json")
}

pub fn command_code_file(home: &Path) -> PathBuf {
    home.join(".commandcode").join("settings.json")
}

pub fn kimi_file(home: &Path) -> PathBuf {
    home.join(".kimi-code").join("config.toml")
}

/// A fenced run writes only below a scratch marker in the temp folder (as `vendors::target`).
#[allow(dead_code)]
fn target(profile: &Path, file: PathBuf) -> Result<PathBuf, String> {
    if fenced(profile) {
        let probe = file.ancestors().skip(1).find(|a| a.is_dir()).map(|a| a.join("probe")).unwrap_or_else(|| file.clone());
        scratch_only(&probe, &std::env::temp_dir(), &super::super::home_dir()).map_err(|e| e.replace(&probe.display().to_string(), &file.display().to_string()))?;
    }
    Ok(file)
}

fn parse(file: &Path, text: Option<&str>) -> Result<Value, String> {
    match text {
        Some(t) => serde_json::from_str(t).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display())),
        None => Ok(json!({})),
    }
}

/// A copy of the user's file is kept before Kolux's first write (`agent_hooks::back_up`); a file
/// already holding Kolux's entries with no copy was written by Kolux and needs none.
fn keep_copy(home: &Path, file: &Path, agent: &str, mine_already: bool) -> Result<(), String> {
    if file.exists() && mine_already && !backup_of(file).exists() {
        return Ok(());
    }
    // The record is found by the resolved path, which needs the folder to exist from the start.
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}; hooks not installed", dir.display()))?;
    }
    if let Some((original, copy)) = back_up(file, &target_dir(home, file).join(BACKUP_RECORD))? {
        eprintln!("kolux-rs: {agent} hooks: kept a copy before the first write: sha256 original {original}, backup {copy}");
    }
    Ok(())
}

/// `v` goes back into `file`: the kept copy's own bytes when it reads the same, the file deleted
/// when Kolux created it and nothing is left, else `v` written over the text read.
fn write_back(home: &Path, file: &Path, v: &Value, text: &str) -> Result<(), String> {
    match kept(file).filter(|(_, c)| c == v) {
        Some((bytes, _)) => write_atomic(file, &bytes, Some(text)),
        None if drop_created(file, &target_dir(home, file).join(BACKUP_RECORD), v, text)? => Ok(()),
        None => write_json(file, v, Some(text)),
    }
}

fn root_of<'a>(file: &Path, v: &'a mut Value) -> Result<&'a mut Map<String, Value>, String> {
    v.as_object_mut().ok_or_else(|| format!("{} has a top level that is not an object; left alone", file.display()))
}

/// The kept copy has `event` under "hooks": the key is the user's, so Kolux's strip leaves it even when it empties it.
fn kept_has_hooks_key(file: &Path, event: &str) -> bool {
    kept(file).is_some_and(|(_, c)| c.get("hooks").and_then(Value::as_object).is_some_and(|h| h.contains_key(event)))
}

/// STAT-012: one Kolux entry under each Cursor event, the user's entries kept where they are; an older
/// file's Kolux entries under the permission events go (DT-C49).
pub fn install_cursor(home: &Path, file: &Path) -> Result<bool, String> {
    let command = quoted(&write_script(home, CURSOR_SCRIPT, &script("cursor", "cursor", CURSOR_PRINTS))?);
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    let before = v.clone();
    let root = root_of(file, &mut v)?;
    if root.get("hooks").is_some_and(|h| !h.is_object()) {
        return Err(format!("{} has a \"hooks\" value that is not an object; left alone", file.display()));
    }
    let hooks = root.entry("hooks").or_insert_with(|| json!({})).as_object_mut().expect("checked above");
    if let Some(e) = CURSOR_EVENTS.iter().find(|e| hooks.get(**e).is_some_and(|g| !g.is_array())) {
        return Err(format!("{} has a \"{e}\" value that is not a list; left alone", file.display()));
    }
    let mine_already = hooks.values().filter_map(Value::as_array).flatten().any(names_mine);
    // Only a key Kolux's own strip empties goes, and not one the kept copy has; the user's own empty key stays as it was.
    let mut emptied = Vec::new();
    for (event, entries) in hooks.iter_mut() {
        if let Some(list) = entries.as_array_mut().filter(|_| !CURSOR_EVENTS.contains(&event.as_str())) {
            let n = list.len();
            list.retain(|h| !names_mine(h));
            if list.is_empty() && n > 0 {
                emptied.push(event.clone());
            }
        }
    }
    hooks.retain(|e, _| !emptied.contains(e) || kept_has_hooks_key(file, e));
    for event in CURSOR_EVENTS {
        let list = hooks.entry(event).or_insert_with(|| json!([])).as_array_mut().expect("checked above");
        let mine = json!({ "command": command });
        match list.iter().position(names_mine) {
            Some(i) => {
                list.retain(|h| !names_mine(h));
                list.insert(i.min(list.len()), mine);
            }
            None => list.push(mine),
        }
    }
    // Cursor requires the version; the user's own value stays.
    root.entry("version").or_insert(json!(1));
    if v == before {
        return Ok(false);
    }
    keep_copy(home, file, "cursor", mine_already)?;
    write_json(file, &v, text.as_deref())?;
    Ok(true)
}

pub fn remove_cursor(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let Some(hooks) = v.get_mut("hooks").and_then(Value::as_object_mut) else { return Ok(false) };
    let mut changed = false;
    let mut emptied = Vec::new();
    for (event, list) in hooks.iter_mut().filter_map(|(e, l)| l.as_array_mut().map(|l| (e, l))) {
        let n = list.len();
        list.retain(|h| !names_mine(h));
        if list.is_empty() && n > 0 {
            emptied.push(event.clone());
        }
        changed |= list.len() != n;
    }
    if !changed {
        return Ok(false);
    }
    // Only a key Kolux's removal emptied goes, and not one the kept copy has; the user's own empty key stays.
    hooks.retain(|e, _| !emptied.contains(e) || kept_has_hooks_key(file, e));
    let copy = kept(file).map(|(_, c)| c);
    let root = v.as_object_mut().expect("has hooks");
    if root.get("hooks").and_then(Value::as_object).is_some_and(Map::is_empty) && copy.as_ref().is_none_or(|c| c.get("hooks").is_none()) {
        root.remove("hooks");
    }
    // The version Kolux added goes with its last entry.
    let added_version = copy.as_ref().map_or_else(|| was_created(&target_dir(home, file).join(BACKUP_RECORD), file), |c| c.get("version").is_none());
    if added_version && !root.contains_key("hooks") && root.get("version") == Some(&json!(1)) {
        root.remove("version");
    }
    write_back(home, file, &v, &text)?;
    Ok(true)
}

/// STAT-013: Claude Code's matcher groups, under each event at the top of `hooks.json` or in the
/// `hooks` key of `settings.json`.
pub fn install_droid(home: &Path, file: &Path) -> Result<bool, String> {
    install_claude_groups(home, file, "droid", DROID_SCRIPT, DROID_PRINTS, &DROID_EVENTS, &DROID_TOOL_EVENTS, droid_wrapped(file))
}

pub fn remove_droid(home: &Path, file: &Path) -> Result<bool, String> {
    remove_claude_groups(home, file, droid_wrapped(file))
}

/// STAT-014: Command Code's `hooks` key in `settings.json`, in the same group shape.
pub fn install_command_code(home: &Path, file: &Path) -> Result<bool, String> {
    // Command Code matches every tool when a group omits the matcher, so no event takes one.
    install_claude_groups(home, file, "command-code", COMMAND_CODE_SCRIPT, COMMAND_CODE_PRINTS, &COMMAND_CODE_EVENTS, &[], false)
}

pub fn remove_command_code(home: &Path, file: &Path) -> Result<bool, String> {
    remove_claude_groups(home, file, false)
}

/// Claude-style groups for one agent; `wrapped` means the groups are the file's top level.
#[allow(clippy::too_many_arguments)]
fn install_claude_groups(home: &Path, file: &Path, id: &str, script_name: &str, prints: bool, events: &[&str], matched: &[&str], wrapped: bool) -> Result<bool, String> {
    let command = quoted(&write_script(home, script_name, &script(id, id, prints))?);
    let text = read_opt(file)?;
    let v = parse(file, text.as_deref())?;
    let mut groups = if wrapped { json!({ "hooks": v.clone() }) } else { v.clone() };
    let hooks = groups.get("hooks");
    if !v.is_object() || hooks.is_some_and(|h| !h.is_object()) {
        return Err(format!("{} has a hooks map that is not an object; left alone", file.display()));
    }
    if let Some(e) = events.iter().find(|e| hooks.and_then(|h| h.get(**e)).is_some_and(|g| !g.is_array())) {
        return Err(format!("{} has a \"{e}\" value that is not a list; left alone", file.display()));
    }
    let mine_already = remove_groups(&mut groups.clone(), false);
    if !install_groups(&mut groups, events, matched, &command, TIMEOUT) {
        return Ok(false);
    }
    let out = if wrapped { groups["hooks"].take() } else { groups };
    keep_copy(home, file, id, mine_already)?;
    write_json(file, &out, text.as_deref())?;
    Ok(true)
}

fn remove_claude_groups(home: &Path, file: &Path, wrapped: bool) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let v = parse(file, Some(&text))?;
    let mut groups = if wrapped { json!({ "hooks": v }) } else { v };
    let drop_empty = !wrapped && kept(file).is_none_or(|(_, c)| c.get("hooks").is_none());
    if !remove_groups(&mut groups, drop_empty) {
        return Ok(false);
    }
    let out = if wrapped { groups["hooks"].take() } else { groups };
    write_back(home, file, &out, &text)?;
    Ok(true)
}

/// STAT-013: Factory's global switch, `hooksDisabled` in `~/.factory/settings.json`.
fn droid_switched_off(home: &Path) -> bool {
    let file = home.join(".factory").join("settings.json");
    read_opt(&file).ok().flatten().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.get("hooksDisabled").and_then(Value::as_bool)) == Some(true)
}

/// A TOML basic string.
fn toml_str(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// STAT-015: Kolux's block: one `[[hooks]]` table per Kimi event, no matcher (every tool).
pub fn kimi_block(script_path: &str, joined: bool) -> String {
    let mut out = String::new();
    if joined {
        out.push('\n');
    }
    out.push_str(if joined { KIMI_BEGIN_JOINED } else { KIMI_BEGIN });
    out.push('\n');
    for e in KIMI_EVENTS {
        out.push_str(&format!("[[hooks]]\nevent = \"{e}\"\ncommand = {}\ntimeout = {TIMEOUT}\n", toml_str(&quoted(script_path))));
    }
    out.push_str(KIMI_END);
    out.push('\n');
    out
}

fn is_kimi_begin(line: &str) -> bool {
    let l = line.trim_end_matches('\r').to_ascii_lowercase();
    l.starts_with("# >>> kolux") && l.contains("hooks")
}

/// A line Kolux writes inside its block, for finding a block whose end line a hand edit removed.
fn is_kimi_own_line(line: &str) -> bool {
    let l = line.trim();
    l.is_empty() || l == "[[hooks]]" || l.starts_with("event = ") || l.starts_with("timeout = ") || (l.starts_with("command = ") && super::super::is_my_command(l))
}

/// Where Kolux's block sits in `text`: (start byte, end byte, joined). The block runs from its
/// begin line through its end line; without an end line, through the last line Kolux writes.
fn kimi_span(text: &str) -> Option<(usize, usize, bool)> {
    let mut at = 0;
    let mut start = None;
    let mut last_own = 0;
    for line in text.split_inclusive('\n') {
        let next = at + line.len();
        match start {
            None if is_kimi_begin(line) => {
                start = Some((at, line.contains("joined")));
                last_own = next;
            }
            Some((s, joined)) if line.trim_end().starts_with("# <<< kolux") => return Some((s, next, joined)),
            // A table of Kolux's ends on its timeout line; a user table after the block is kept.
            Some(_) if is_kimi_own_line(line) => {
                if line.trim().starts_with("timeout = ") {
                    last_own = next;
                }
            }
            Some((s, joined)) => return Some((s, last_own, joined)),
            None => {}
        }
        at = next;
    }
    start.map(|(s, joined)| (s, last_own, joined))
}

/// `text` without Kolux's block (and without the line break the block added before itself).
fn kimi_without(text: &str) -> Option<String> {
    let (s, e, joined) = kimi_span(text)?;
    let s = if joined && text[..s].ends_with('\n') { s - 1 } else { s };
    Some(format!("{}{}", &text[..s], &text[e..]))
}

/// A top-level `hooks = ...` key would clash with Kolux's `[[hooks]]` tables.
fn kimi_clash(text: &str) -> bool {
    let mut top = true;
    for l in text.lines().map(str::trim) {
        if l.starts_with('[') {
            top = false;
        }
        if top && (l.starts_with("hooks=") || l.starts_with("hooks =")) {
            return true;
        }
    }
    false
}

pub fn install_kimi(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_script(home, KIMI_SCRIPT, &script("kimi", "kimi", false))?;
    let text = read_opt(file)?;
    let mine_already = text.as_deref().is_some_and(|t| kimi_span(t).is_some());
    let base = text.as_deref().map(|t| kimi_without(t).unwrap_or_else(|| t.to_string())).unwrap_or_default();
    if kimi_clash(&base) {
        return Err(format!("{} sets hooks as a plain key, which Kolux's [[hooks]] tables would clash with; left alone", file.display()));
    }
    let joined = !base.is_empty() && !base.ends_with('\n');
    let new = format!("{base}{}", kimi_block(&path, joined));
    if text.as_deref() == Some(new.as_str()) {
        return Ok(false);
    }
    keep_copy(home, file, "kimi", mine_already)?;
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// STAT-015: the block comes out and the file is the user's again, byte for byte; a file Kolux
/// created and left empty goes.
pub fn remove_kimi(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let Some(rest) = kimi_without(&text) else { return Ok(false) };
    let record = target_dir(home, file).join(BACKUP_RECORD);
    if rest.is_empty() && !backup_of(file).exists() && was_created(&record, file) {
        fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
        let _ = fs::remove_file(record);
        return Ok(true);
    }
    write_atomic(file, rest.as_bytes(), Some(&text))?;
    Ok(true)
}

/// `agent_hooks::apply` for these agents (wired by evidence/hooks-T-121-mod.rs.patch).
#[allow(dead_code)]
pub fn apply(home: &Path, profile: &Path, id: &str, plan: Plan) -> Result<&'static str, String> {
    let install = plan == Plan::Install;
    match id {
        "cursor" => {
            let file = target(profile, cursor_file(home))?;
            if install { install_cursor(home, &file) } else { remove_cursor(home, &file) }
        }
        "droid" => {
            let file = target(profile, droid_file(home))?;
            if install { install_droid(home, &file) } else { remove_droid(home, &file) }
        }
        "command-code" => {
            let file = target(profile, command_code_file(home))?;
            if install { install_command_code(home, &file) } else { remove_command_code(home, &file) }
        }
        "kimi" => {
            let file = target(profile, kimi_file(home))?;
            if install { install_kimi(home, &file) } else { remove_kimi(home, &file) }
        }
        "copilot" => {
            let file = target(profile, copilot_file(home))?;
            if install { install_copilot(home, &file) } else { remove_copilot(&file) }
        }
        // STAT-018: this run owns Grok's file from its install until it quits (grok::at_quit).
        "grok" => {
            let file = target(profile, grok::file(home))?;
            if install {
                grok::own(home, &grok::me(profile), crate::procs::alive);
                grok::install(home, &file)
            } else {
                grok::remove(home, &file, true)
            }
        }
        "devin" => {
            let file = target(profile, devin::file(home))?;
            if install { devin::install(home, &file) } else { devin::remove(home, &file) }
        }
        "pi" => {
            let file = target(profile, pi::file(home))?;
            if install { pi::install(home, &file) } else { pi::remove(&file) }
        }
        // STAT-016: the marked config.yaml blocks only; Hermes's own allowlist is never written.
        "hermes" => {
            let file = target(profile, hermes::file(home))?;
            if install { hermes::install(home, &file) } else { hermes::remove(home, &file) }
        }
        _ => return Ok("left as it was"),
    }
    .map(|_| if install { "installed" } else { "removed" })
}

fn inspect_cursor(file: &Path) -> (&'static str, Option<String>) {
    let v: Value = match read_opt(file).map(|t| t.map(|t| serde_json::from_str::<Value>(&t))) {
        Ok(None) => return ("not installed", None),
        Ok(Some(Ok(v))) => v,
        Ok(Some(Err(e))) => return ("error", Some(format!("{} is not JSON ({e})", file.display()))),
        Err(e) => return ("error", Some(e)),
    };
    let has = |e: &str| v.get("hooks").and_then(|h| h.get(e)).and_then(Value::as_array).is_some_and(|l| l.iter().any(names_mine));
    let missing: Vec<&str> = CURSOR_EVENTS.iter().copied().filter(|e| !has(e)).collect();
    // An older file's Kolux entries under the permission events are rewritten at the next start (DT-C49).
    let stale: Vec<&str> = v.get("hooks").and_then(Value::as_object).map_or_else(Vec::new, |h| h.keys().map(String::as_str).filter(|e| !CURSOR_EVENTS.contains(e) && has(e)).collect());
    match (missing.len(), stale.is_empty()) {
        (0, true) => ("installed", None),
        (n, true) if n == CURSOR_EVENTS.len() => ("not installed", None),
        _ => {
            let mut why = Vec::new();
            if !missing.is_empty() {
                why.push(format!("no Kolux entry for {}", missing.join(", ")));
            }
            if !stale.is_empty() {
                why.push(format!("an old Kolux entry under {}", stale.join(", ")));
            }
            ("partial", Some(why.join("; ")))
        }
    }
}

fn inspect_droid(home: &Path) -> (&'static str, Option<String>) {
    let file = droid_file(home);
    inspect_claude_groups(&file, &DROID_EVENTS, droid_wrapped(&file), || droid_switched_off(home).then(|| "hooks are switched off in Factory's settings (hooksDisabled)".to_string()))
}

pub fn inspect_command_code(file: &Path) -> (&'static str, Option<String>) {
    inspect_claude_groups(file, &COMMAND_CODE_EVENTS, false, || None)
}

/// `off` runs once some Kolux entry exists, and turns the verdict into "partial" (a global switch).
fn inspect_claude_groups(file: &Path, events: &[&str], wrapped: bool, off: impl Fn() -> Option<String>) -> (&'static str, Option<String>) {
    let v: Value = match read_opt(file).map(|t| t.map(|t| serde_json::from_str::<Value>(&t))) {
        Ok(None) => return ("not installed", None),
        Ok(Some(Ok(v))) => v,
        Ok(Some(Err(e))) => return ("error", Some(format!("{} is not JSON ({e})", file.display()))),
        Err(e) => return ("error", Some(e)),
    };
    let hooks = if wrapped { Some(&v) } else { v.get("hooks") };
    let has = |e: &str| hooks.and_then(|h| h.get(e)).and_then(Value::as_array).is_some_and(|gs| gs.iter().filter_map(|g| g.get("hooks").and_then(Value::as_array)).flatten().any(names_mine));
    let missing: Vec<&str> = events.iter().copied().filter(|e| !has(e)).collect();
    if missing.len() == events.len() {
        return ("not installed", None);
    }
    if let Some(reason) = off() {
        return ("partial", Some(reason));
    }
    if missing.is_empty() { ("installed", None) } else { ("partial", Some(format!("no Kolux entry for {}", missing.join(", ")))) }
}

fn inspect_kimi(file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) => match kimi_span(&t) {
            None => ("not installed", None),
            Some((s, e, _)) => {
                let block = &t[s..e];
                let missing: Vec<&str> = KIMI_EVENTS.iter().copied().filter(|ev| !block.contains(&format!("event = \"{ev}\""))).collect();
                if !block.contains(KIMI_END) {
                    ("partial", Some("the Kolux block has lost its end line".into()))
                } else if missing.is_empty() {
                    ("installed", None)
                } else {
                    ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
                }
            }
        },
        Err(e) => ("error", Some(e)),
    }
}

/// `kolux agent hooks status` rows for these agents (wired by evidence/hooks-T-121-switch.rs.patch).
#[allow(dead_code)]
pub fn rows(home: &Path) -> Vec<Value> {
    let row = |agent: &str, name: &str, file: PathBuf, (state, reason): (&str, Option<String>)| json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason });
    vec![
        row("cursor", "Cursor Agent", cursor_file(home), inspect_cursor(&cursor_file(home))),
        row("droid", "Droid", droid_file(home), inspect_droid(home)),
        row("command-code", "Command Code", command_code_file(home), inspect_command_code(&command_code_file(home))),
        row("kimi", "Kimi Code", kimi_file(home), inspect_kimi(&kimi_file(home))),
        row("copilot", "GitHub Copilot CLI", copilot_file(home), inspect_copilot(&copilot_file(home))),
        row("grok", "Grok", grok::file(home), grok::inspect(home, &grok::file(home))),
        row("devin", "Devin", devin::file(home), devin::inspect(&devin::file(home))),
        row("pi", "Pi", pi::file(home), pi::inspect(home, &pi::file(home))),
        row("hermes", "Hermes", hermes::file(home), hermes::inspect(home, &hermes::file(home), &hermes::allow_file(home))),
    ]
}

#[path = "jsonc.rs"]
pub mod jsonc;
#[path = "grok.rs"]
pub mod grok;
#[path = "devin.rs"]
pub mod devin;
#[path = "pi.rs"]
pub mod pi;
#[path = "hermes.rs"]
pub mod hermes;

#[cfg(test)]
#[path = "more_tests.rs"]
mod tests;
