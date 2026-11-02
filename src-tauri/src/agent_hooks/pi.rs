//! T-122 (STAT-021, Pi part): Pi status through a Kolux extension, from Pi's public extensions
//! guide and its exported extension declarations (PROVENANCE.md, T-122): Pi loads TypeScript or
//! JavaScript files placed directly in its user extensions folder, `~/.pi/agent/extensions/`; an
//! extension's default export receives the extension API, whose `on(event, handler)` observes
//! `before_agent_start` (with `prompt` for a run a user message started), `agent_start`,
//! `tool_execution_start` / `tool_execution_end` (with `toolName`, `isError`), `agent_settled`
//! (with `aborted`), `session_start` and `session_shutdown` (with `reason`).
//!
//! Kolux writes its own file there, `kolux-rs.ts`, apart from the user's own extensions: it runs
//! Kolux's hook script with the event name and a small JSON body, only inside a Kolux pane. A file
//! of that name Kolux did not write is never touched; taking the hooks away deletes only Kolux's.
//! STAT-025: the prompt that began the run is the one text that goes along (cut at 16000, the
//! status rules' own limit); the card and its history name the turn by it.
//! Titles: the extension names the tab `π - <session name> - <folder>` through Pi's `ctx.ui.setTitle`
//! once the session has a name (`pi.getSessionName`, `session_info_changed`); nothing else sets it.
//! Not built here: Pi has no documented event for its own dialogs (approval forwarding is OMP's,
//! and OMP has no public source), so "needs you while a dialog is open" stays with the open card.

use super::super::super::{script, write_atomic, write_script as write_named};
use super::super::read_opt;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const SCRIPT: &str = "pi.cmd";
/// The line that marks the extension as Kolux's own.
pub const MARK_LINE: &str = "// Kolux RS status extension for Pi. Written by Kolux RS; edits are overwritten.";
/// STAT-021: the Pi events the extension reports, by Pi's own names.
pub const EVENTS: [&str; 7] = ["session_start", "before_agent_start", "agent_start", "tool_execution_start", "tool_execution_end", "agent_settled", "session_shutdown"];

/// T-122 (STAT-021, titles): the events after which the extension refreshes Pi's tab title; a
/// rename (`session_info_changed`) refreshes it too.
pub const TITLE_EVENTS: [&str; 3] = ["session_start", "agent_start", "agent_settled"];

/// Kolux's own extension file in Pi's user extensions folder.
pub fn file(home: &Path) -> PathBuf {
    home.join(".pi").join("agent").join("extensions").join("kolux-rs.ts")
}

/// The script takes the event as its argument and prints nothing.
pub fn write_script(home: &Path) -> Result<String, String> {
    write_named(home, SCRIPT, &script("pi", "pi/%~1", false))
}

/// The extension's text for the script at `script_path`. Plain JavaScript (valid TypeScript too),
/// so it loads whether Pi reads it as either; a failed report never disturbs Pi.
pub fn extension(script_path: &str) -> String {
    let native = if cfg!(windows) { script_path.replace('/', "\\") } else { script_path.to_string() };
    let lit = serde_json::to_string(&native).expect("a string");
    let events = serde_json::to_string(&EVENTS).expect("strings");
    [
        MARK_LINE,
        "// Kolux takes this file away when its status hooks are switched off. It reports Pi's lifecycle",
        "// events to Kolux through Kolux's hook script, and does nothing outside a Kolux pane.",
        "import { spawn } from \"node:child_process\";",
        "",
        &format!("const SCRIPT = {lit};"),
        &format!("const EVENTS = {events};"),
        &format!("const TITLE_EVENTS = {};", serde_json::to_string(&TITLE_EVENTS).expect("strings")),
        "",
        "export default function (pi) {",
        "  if (!process.env.KOLUX_PANE_KEY || !process.env.KOLUX_HOOK_IDENTITY) return;",
        "  const send = (name, body) => {",
        "    try {",
        "      const child = spawn(process.env.ComSpec || \"cmd.exe\", [\"/d\", \"/c\", SCRIPT, name], { stdio: [\"pipe\", \"ignore\", \"ignore\"], windowsHide: true });",
        "      child.on(\"error\", () => {});",
        "      child.stdin.on(\"error\", () => {});",
        "      child.stdin.end(JSON.stringify({ hook_event_name: name, ...body }));",
        "    } catch {}",
        "  };",
        "  const fields = {",
        "    session_start: (e) => ({ reason: e?.reason }),",
        "    // The run's prompt (a user-started run has one), cut as the status rules keep it; nothing else of the run.",
        "    before_agent_start: (e) => ({ prompt: typeof e?.prompt === \"string\" ? e.prompt.slice(0, 16000) : undefined }),",
        "    agent_start: () => ({}),",
        "    tool_execution_start: (e) => ({ tool_name: e?.toolName }),",
        "    tool_execution_end: (e) => ({ tool_name: e?.toolName, is_error: e?.isError === true }),",
        "    agent_settled: (e) => ({ aborted: e?.aborted === true }),",
        "    session_shutdown: (e) => ({ reason: e?.reason }),",
        "  };",
        "  // The tab title comes only from here: the session's name and folder, once Pi has named it.",
        "  const clean = (s) => String(s ?? \"\").replace(/[\\u0000-\\u001f\\u007f]/g, \" \").trim().slice(0, 80);",
        "  const retitle = (ctx) => {",
        "    try {",
        "      const name = clean(pi.getSessionName?.());",
        "      if (!name || typeof ctx?.ui?.setTitle !== \"function\") return;",
        "      const dir = clean(String(ctx.cwd || process.cwd()).split(/[\\\\/]/).filter(Boolean).pop());",
        "      ctx.ui.setTitle(dir ? `π - ${name} - ${dir}` : `π - ${name}`);",
        "    } catch {}",
        "  };",
        "  for (const name of EVENTS) pi.on(name, (e, ctx) => { send(name, fields[name](e)); if (TITLE_EVENTS.includes(name)) retitle(ctx); });",
        "  try { pi.on(\"session_info_changed\", (_e, ctx) => retitle(ctx)); } catch {}",
        "}",
        "",
    ]
    .join("\n")
}

/// The extension is Kolux's when its first line is Kolux's mark.
pub fn mine(text: &str) -> bool {
    text.trim_start_matches('\u{feff}').lines().next() == Some(MARK_LINE)
}

/// STAT-021: writes Kolux's extension (only when it changed); a file of that name that is not
/// Kolux's is left alone with a reason.
pub fn install(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_script(home)?;
    let want = extension(&path);
    let text = read_opt(file)?;
    match text.as_deref() {
        Some(t) if !mine(t) => return Err(format!("{} is not Kolux's own extension; left alone", file.display())),
        Some(t) if t == want => return Ok(false),
        _ => {}
    }
    write_atomic(file, want.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// Kolux's extension goes; a file of the same name that is not Kolux's stays.
pub fn remove(file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    if !mine(&text) {
        return Ok(false);
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
    Ok(true)
}

/// The status row's state for Pi.
pub fn inspect(home: &Path, file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) if !mine(&t) => ("error", Some(format!("{} is not Kolux's own extension", file.display()))),
        Ok(Some(t)) => {
            let script = home.join(super::super::super::SCRIPT_DIR).join(SCRIPT);
            if t == extension(&script.to_string_lossy().replace('\\', "/")) {
                ("installed", None)
            } else {
                ("partial", Some("Kolux's extension is out of date; it is rewritten on the next start".into()))
            }
        }
        Err(e) => ("error", Some(e)),
    }
}

/// STAT-021: a Pi event as the status rules read it: a run starting is working, with its prompt
/// (STAT-025) when a user message started it; tool steps keep it working; a settled run is done
/// (an aborted one too: Pi says the run is over); session start and shutdown change nothing (idle
/// at launch, and the pane itself reports an exit).
pub fn event(name: &str, event: &Value) -> Option<(&'static str, Option<&'static str>, Value)> {
    let tool_name = event.get("tool_name").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| s.chars().take(100).collect::<String>());
    let tool = |n: Option<String>| json!({ "tool_name": n, "tool_input": Value::Null });
    let (name, out) = match name {
        "before_agent_start" => ("UserPromptSubmit", json!({ "prompt": event.get("prompt").and_then(Value::as_str).filter(|s| !s.is_empty()) })),
        // Pi fires this right after before_agent_start, whose prompt names the turn: a second
        // UserPromptSubmit would take the prompt away, so this only keeps the turn working. The
        // two reports are separate processes, so either order leaves the same card.
        "agent_start" => ("PostToolUse", json!({})),
        "tool_execution_start" => ("PreToolUse", tool(tool_name)),
        "tool_execution_end" => ("PostToolUse", tool(tool_name)),
        "agent_settled" => ("Stop", json!({})),
        _ => return None,
    };
    Some((name, None, out))
}
