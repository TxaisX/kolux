//! T-120-b (STAT-009 / STAT-010 / STAT-011): status hooks for Gemini CLI, Antigravity and Amp,
//! from each vendor's public hook or plugin docs (PROVENANCE.md, T-120-b). Each vendor's event is
//! turned into the one shape the status rules read (`normalize`), then follows Codex's rules for an
//! agent whose hook semantics are unverified (`status::Agent::Vendor`).
//!
//! - Gemini CLI: `~/.gemini/settings.json`, `hooks` groups like Claude Code's, timeouts in ms.
//! - Antigravity: `~/.gemini/config/hooks.json`, one named bundle of event groups; the payload has
//!   no event name, so each command passes it as its argument and the script puts it in the route.
//! - Amp: a plugin file in `~/.config/amp/plugins/` that posts each event itself.

use super::super::{codex_change, home_dir, install_groups, script, write_atomic, write_json, write_script, Change};
use super::{back_up, backup_of, drop_created, fenced, kept, names_mine, read_opt, remove_groups, saved::SPOOL_FILE, scratch_only, switch, target_dir, Plan, BACKUP_RECORD};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const GEMINI_SCRIPT: &str = "gemini.cmd";
pub const ANTIGRAVITY_SCRIPT: &str = "antigravity.cmd";
/// The plugin file and the Antigravity bundle both carry this name.
pub const NAME: &str = "kolux-rs";
pub const GEMINI_EVENTS: [&str; 4] = ["BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool"];
const GEMINI_TOOL_EVENTS: [&str; 2] = ["BeforeTool", "AfterTool"];
/// Gemini CLI takes hook timeouts in milliseconds.
const GEMINI_TIMEOUT: u64 = 10_000;
pub const ANTIGRAVITY_EVENTS: [&str; 5] = ["PreInvocation", "PreToolUse", "PostToolUse", "PostInvocation", "Stop"];
/// FIX-1 (e): Antigravity's tool events take matcher groups; its other events a plain list of handlers.
const ANTIGRAVITY_TOOL_EVENTS: [&str; 2] = ["PreToolUse", "PostToolUse"];
/// FIX-1 (e): Amp's tool events carry no input and are never held in the spool (COMPAT 3.1).
const AMP_TOOL_EVENTS: [&str; 2] = ["tool.call", "tool.result"];
pub const AMP_EVENTS: [&str; 5] = ["session.start", "agent.start", "tool.call", "tool.result", "agent.end"];
/// Antigravity's tools that put a question to the user: the pane waits on them (STAT-010).
const ASK_TOOLS: [&str; 2] = ["ask_question", "ask_permission"];
const ANTIGRAVITY_ROUTE: &str = "/antigravity/";

/// A path the hook listener takes for one of these vendors.
pub fn is_route(path: &str) -> bool {
    path == "/gemini" || path == "/amp" || path.starts_with(ANTIGRAVITY_ROUTE)
}

/// The agent id a route reports for.
pub fn agent_of(path: &str) -> Option<&'static str> {
    let path = format!("/{}", path.trim_start_matches('/'));
    match path.as_str() {
        "/gemini" => Some("gemini"),
        "/amp" => Some("amp"),
        p if p.starts_with(ANTIGRAVITY_ROUTE) => Some("antigravity"),
        _ => None,
    }
}

/// STAT-062 (T-126): the transcripts whose turn has ended, per vendor: Antigravity conversations
/// after a fully idle Stop, Amp threads after an agent end. A late event naming one is discarded
/// until a fresh invocation or agent start names it again. The ids are the vendor's own and unique
/// per transcript, so one pane's ended thread never silences another's; the list is bounded, the
/// oldest end forgotten first. hooks FIX-2 (stand-in review hooks-146904a2 FIX-SOON 1): an end is
/// remembered for ENDED_FOR only. A late event arrives close to the end by definition, so after
/// that a tool event counts as working again even when the new turn's PreInvocation or agent.start
/// was lost (it came without its id, or fell into the holding file while the listener was busy);
/// before, one lost event silenced the whole turn.
#[derive(Default)]
pub struct Ended(std::collections::VecDeque<(&'static str, String, Instant)>);
const ENDED_CAP: usize = 256;
pub const ENDED_FOR: Duration = Duration::from_secs(60);

impl Ended {
    #[cfg(test)]
    fn is_ended(&self, agent: &str, id: &str) -> bool {
        self.is_ended_at(agent, id, Instant::now())
    }

    /// `is_ended` as of `now`: an end older than ENDED_FOR no longer counts.
    fn is_ended_at(&self, agent: &str, id: &str, now: Instant) -> bool {
        self.0.iter().any(|(a, i, at)| *a == agent && i == id && now.duration_since(*at) < ENDED_FOR)
    }

    #[cfg(test)]
    fn ended(&mut self, agent: &'static str, id: &str) {
        self.ended_at(agent, id, Instant::now())
    }

    fn ended_at(&mut self, agent: &'static str, id: &str, now: Instant) {
        self.fresh(agent, id);
        // Ends past their minute are dropped on the way, so the list holds only ends that still count.
        self.0.retain(|(_, _, at)| now.duration_since(*at) < ENDED_FOR);
        self.0.push_back((agent, id.to_string(), now));
        while self.0.len() > ENDED_CAP {
            self.0.pop_front();
        }
    }

    fn fresh(&mut self, agent: &str, id: &str) {
        self.0.retain(|(a, i, _)| !(*a == agent && i == id));
    }
}

/// Where in a transcript's turn an event falls, for the ended-turn memory.
#[derive(Clone, Copy)]
enum Turn {
    /// A new turn begins: the transcript is forgotten as ended.
    Fresh,
    /// The turn ends: the transcript is remembered; a second end is discarded.
    End,
    /// A step inside the turn: discarded once the transcript has ended.
    Within,
}

/// The one memory the hook listener and the spool replay share.
static ENDED: std::sync::Mutex<Ended> = std::sync::Mutex::new(Ended(std::collections::VecDeque::new()));

/// The vendor's event as the status rules read it (`hook_event_name` and Claude Code's field
/// names), or `None` when it changes nothing (a late event after the turn ended among them).
pub fn normalize(path: &str, event: &Value) -> Option<Value> {
    let mut ended = ENDED.lock().unwrap_or_else(|e| e.into_inner());
    normalize_with(&mut ended, path, event)
}

/// `normalize` with the ended-turn memory given (STAT-062).
pub fn normalize_with(ended: &mut Ended, path: &str, event: &Value) -> Option<Value> {
    normalize_at(ended, path, event, Instant::now())
}

/// `normalize_with` as of `now` (hooks FIX-2: the memory's time limit under an injected clock).
pub fn normalize_at(ended: &mut Ended, path: &str, event: &Value, now: Instant) -> Option<Value> {
    let path = format!("/{}", path.trim_start_matches('/'));
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let (name, session, mut out, memory) = if path == "/gemini" {
        let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input").or_else(|| event.get("arguments")) });
        let (name, out) = match str_of("hook_event_name")? {
            "BeforeAgent" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
            "AfterAgent" => ("Stop", json!({ "last_assistant_message": str_of("prompt_response") })),
            "BeforeTool" | "PreToolUse" => ("PreToolUse", tool()),
            "AfterTool" | "PostToolUse" => ("PostToolUse", tool()),
            _ => return None,
        };
        (name, str_of("session_id"), out, None)
    } else if let Some(name) = path.strip_prefix(ANTIGRAVITY_ROUTE) {
        let call = event.get("toolCall");
        let tool = || json!({ "tool_name": call.and_then(|c| c.get("name")), "tool_input": call.and_then(|c| c.get("args")) });
        let (name, out, turn) = match name {
            "PreInvocation" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") }), Turn::Fresh),
            "PreToolUse" => ("PreToolUse", tool(), Turn::Within),
            "PostToolUse" | "PostInvocation" => ("PostToolUse", tool(), Turn::Within),
            // STAT-010: only a Stop with the agent fully idle ends the turn.
            "Stop" if event.get("fullyIdle").and_then(Value::as_bool) == Some(true) => ("Stop", json!({}), Turn::End),
            _ => return None,
        };
        (name, str_of("conversationId"), out, Some(("antigravity", turn)))
    } else if path == "/amp" {
        let (name, out, turn) = match str_of("event")? {
            "agent.start" => ("UserPromptSubmit", json!({ "prompt": str_of("message") }), Turn::Fresh),
            "tool.call" => ("PreToolUse", json!({ "tool_name": str_of("tool") }), Turn::Within),
            "tool.result" => ("PostToolUse", json!({ "tool_name": str_of("tool") }), Turn::Within),
            // STAT-011: an end that is not `done` (cancelled, an error) is an interruption.
            "agent.end" => ("Stop", json!({ "kolux_interrupted": str_of("status") != Some("done") }), Turn::End),
            _ => return None,
        };
        (name, str_of("thread"), out, Some(("amp", turn)))
    } else {
        return None;
    };
    // STAT-062: the memory applies only to an event that names its transcript.
    if let (Some((agent, turn)), Some(id)) = (memory, session) {
        match turn {
            Turn::Fresh => ended.fresh(agent, id),
            Turn::End | Turn::Within if ended.is_ended_at(agent, id, now) => return None,
            Turn::End => ended.ended_at(agent, id, now),
            Turn::Within => {}
        }
    }
    let o = out.as_object_mut()?;
    o.retain(|_, v| !v.is_null());
    o.insert("hook_event_name".into(), name.into());
    if let Some(s) = session {
        o.insert("session_id".into(), s.into());
    }
    Some(out)
}

/// A normalized event's change: Codex's mapping, with Antigravity's ask tools waiting on the user.
pub fn change(event: &Value) -> Option<Change> {
    let mut change = codex_change(event)?;
    if event.get("hook_event_name").and_then(Value::as_str) == Some("PreToolUse") && change.tool.as_deref().is_some_and(|t| ASK_TOOLS.contains(&t)) {
        change.state = "waiting";
    }
    Some(change)
}

pub fn write_gemini_script(home: &Path) -> Result<String, String> {
    write_script(home, GEMINI_SCRIPT, &script("gemini", "gemini", true))
}

pub fn write_antigravity_script(home: &Path) -> Result<String, String> {
    write_script(home, ANTIGRAVITY_SCRIPT, &script("antigravity", "antigravity/%~1", true))
}

pub fn gemini_file(home: &Path) -> PathBuf {
    home.join(".gemini").join("settings.json")
}

pub fn antigravity_file(home: &Path) -> PathBuf {
    home.join(".gemini").join("config").join("hooks.json")
}

pub fn amp_file(home: &Path) -> PathBuf {
    home.join(".config").join("amp").join("plugins").join(format!("{NAME}.js"))
}

/// Amp's plugin: it reports each event to the Kolux that opened the pane and answers nothing.
pub fn amp_plugin() -> String {
    r#"// Kolux status plugin for Amp. Written by Kolux; edits are overwritten.
// It tells Kolux what this pane's agent is doing and never answers for Amp.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EVENTS = {EVENTS}
const TOOL_EVENTS = {TOOL_EVENTS}
const text = (v) => (typeof v === 'string' ? v : undefined)

async function send(name, event) {
  const env = process.env
  if (!env.KOLUX_PANE_KEY || !env.KOLUX_HOOK_IDENTITY) return
  let port = env.KOLUX_AGENT_HOOK_PORT
  let token = env.KOLUX_AGENT_HOOK_TOKEN
  try {
    const [p, t] = readFileSync(env.KOLUX_HOOK_ENDPOINT, 'utf8').trim().split(/\s+/)
    if (p && t) { port = p; token = t }
  } catch {}
  // The prompt goes with agent.start only; a tool's input never leaves Amp.
  const body = JSON.stringify({ event: name, thread: text(event?.thread?.id), message: name === 'agent.start' ? text(event?.message) : undefined, tool: text(event?.tool), status: text(event?.status) })
  try {
    if (!port || !token) throw new Error('no Kolux')
    // Loopback only: the same hook listener the .cmd scripts post to with curl.
    await fetch(`http://127.0.0.1:${port}/amp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kolux-Token': token, 'X-Kolux-Pane': env.KOLUX_HOOK_IDENTITY }, body, signal: AbortSignal.timeout(1500) })
  } catch {
    // Kolux is closed or not answering: the event waits, one whole line, for the next start.
    // A tool event is only worth its moment: it is never held.
    if (TOOL_EVENTS.includes(name)) return
    try {
      if (env.KOLUX_HOOK_ENDPOINT) appendFileSync(join(dirname(env.KOLUX_HOOK_ENDPOINT), '{SPOOL}'), `amp|${env.KOLUX_HOOK_IDENTITY}||${body}` + String.fromCharCode(10))
    } catch {}
  }
}

export default function (amp) {
  for (const name of EVENTS) amp.on(name, async (event) => { await send(name, event) })
}
"#
    .replace("{SPOOL}", SPOOL_FILE)
    .replace("{EVENTS}", &json!(AMP_EVENTS).to_string())
    .replace("{TOOL_EVENTS}", &json!(AMP_TOOL_EVENTS).to_string())
}

/// A fenced run (test, dev, lane) writes only below a scratch marker in the temp folder; the
/// deepest folder of `file` that exists already is the one checked.
fn target(profile: &Path, file: PathBuf) -> Result<PathBuf, String> {
    if fenced(profile) {
        let probe = file.ancestors().skip(1).find(|a| a.is_dir()).map(|a| a.join("probe")).unwrap_or_else(|| file.clone());
        scratch_only(&probe, &std::env::temp_dir(), &home_dir()).map_err(|e| e.replace(&probe.display().to_string(), &file.display().to_string()))?;
    }
    Ok(file)
}

fn parse(file: &Path, text: Option<&str>) -> Result<Value, String> {
    match text {
        Some(t) => serde_json::from_str(t).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display())),
        None => Ok(json!({})),
    }
}

/// FIX-1 (a): a copy of the user's `file` is kept (and checked against its record) before Kolux
/// writes it (`agent_hooks::back_up`). A file that did not exist has nothing to keep; one that
/// already holds Kolux's entries with no copy was written by Kolux (or by an install before FIX-1),
/// so a copy of it would only bring Kolux's entries back on removal.
fn keep_copy(home: &Path, file: &Path, agent: &str, existed: bool, mine_already: bool) -> Result<(), String> {
    // FIX-2 (S5): a file about to be created still goes through `back_up`, which records it missing.
    if existed && mine_already && !backup_of(file).exists() {
        return Ok(());
    }
    if let Some((original, copy)) = back_up(file, &target_dir(home, file).join(BACKUP_RECORD))? {
        eprintln!("kolux-rs: {agent} hooks: kept a copy before the first write: sha256 original {original}, backup {copy}");
    }
    Ok(())
}

/// FIX-1 (a): `v` goes back into `file`; when it reads the same as the copy kept before Kolux's
/// first write, the copy's own bytes are written, so the file is byte for byte the user's again.
/// FIX-2 (S5): a file Kolux created and left holding nothing is deleted instead (`drop_created`).
fn write_back(home: &Path, file: &Path, v: &Value, text: &str) -> Result<(), String> {
    match kept(file).filter(|(_, c)| c == v) {
        Some((bytes, _)) => write_atomic(file, &bytes, Some(text)),
        None if drop_created(file, &target_dir(home, file).join(BACKUP_RECORD), v, text)? => Ok(()),
        None => write_json(file, v, Some(text)),
    }
}

/// FIX-1 (c): a value Kolux would have to replace to add its own groups is the user's, so the
/// file is refused, never rewritten.
fn refuse_shape(file: &Path, v: &Value, events: &[&str]) -> Result<(), String> {
    let bad = |what: String| Err(format!("{} has {what}; left alone", file.display()));
    let Some(root) = v.as_object() else { return bad("a top level that is not an object".into()) };
    let Some(hooks) = root.get("hooks") else { return Ok(()) };
    let Some(hooks) = hooks.as_object() else { return bad("a \"hooks\" value that is not an object".into()) };
    match events.iter().find(|e| hooks.get(**e).is_some_and(|g| !g.is_array())) {
        Some(e) => bad(format!("a \"{e}\" value that is not a list")),
        None => Ok(()),
    }
}

/// FIX-1 (b): Gemini CLI hands a hook command to PowerShell's `-Command` on Windows (its shell
/// utilities take a PowerShell named by ComSpec, else pwsh, else Windows PowerShell), where a bare
/// quoted path is only printed. So the script is called with `&` on a single-quoted path, any `'`
/// doubled. Called this way it reads the agent's own stdin byte for byte; piping `$input` into it
/// would re-encode the event through the console code page.
///
/// FIX-2 (A4): PowerShell also takes the curly single quotes (U+2018, U+2019, U+201A, U+201B) as
/// quotes, so each of those is doubled too. A5: elsewhere Gemini CLI runs the command through a
/// POSIX shell, where `&` is a syntax error; there the path is single-quoted the POSIX way.
pub fn gemini_command(script: &str) -> String {
    if !cfg!(windows) {
        return format!("'{}'", script.replace('\'', "'\\''"));
    }
    let mut quoted = String::with_capacity(script.len() + 4);
    for c in script.chars() {
        quoted.push(c);
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201a}' | '\u{201b}') {
            quoted.push(c);
        }
    }
    format!("& '{quoted}'")
}

/// Gemini CLI: one Kolux group under each event; the user's own hooks stay.
pub fn install_gemini(home: &Path, file: &Path) -> Result<bool, String> {
    let command = gemini_command(&write_gemini_script(home)?);
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    refuse_shape(file, &v, &GEMINI_EVENTS)?;
    let mine_already = remove_groups(&mut v.clone(), false);
    let changed = install_groups(&mut v, &GEMINI_EVENTS, &GEMINI_TOOL_EVENTS, &command, GEMINI_TIMEOUT);
    if changed {
        keep_copy(home, file, "gemini", text.is_some(), mine_already)?;
        write_json(file, &v, text.as_deref())?;
    }
    Ok(changed)
}

/// Takes Kolux's entries out of a `{"hooks": {...}}` file (Gemini CLI's settings). A `hooks`
/// object left empty goes too unless the copy kept before the install had one (as for Claude Code).
pub fn remove_hooks(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let changed = remove_groups(&mut v, kept(file).is_none_or(|(_, c)| c.get("hooks").is_none()));
    if changed {
        write_back(home, file, &v, &text)?;
    }
    Ok(changed)
}

/// Every handler of a bundle: those in a tool event's matcher groups and those listed directly
/// under the other events.
fn handlers(bundle: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    for h in bundle.as_object().into_iter().flat_map(|o| o.values()).filter_map(Value::as_array).flatten() {
        match h.get("hooks").and_then(Value::as_array) {
            Some(hs) => out.extend(hs),
            None => out.push(h),
        }
    }
    out
}

/// A bundle every command of which is Kolux's.
fn bundle_mine(bundle: &Value) -> bool {
    let hs = handlers(bundle);
    bundle.is_object() && !hs.is_empty() && hs.into_iter().all(names_mine)
}

/// Antigravity: Kolux's own bundle, one command per event naming it.
pub fn install_antigravity(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_antigravity_script(home)?;
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    let Some(root) = v.as_object_mut() else { return Err(format!("{} is not an object; left alone", file.display())) };
    if root.get(NAME).is_some_and(|b| !bundle_mine(b)) {
        return Err(format!("{} has a {NAME} bundle that is not Kolux's; left alone", file.display()));
    }
    let handler = |e: &str| json!({ "type": "command", "command": format!("\"{path}\" {e}"), "timeout": 10 });
    let mut bundle: Map<String, Value> = ANTIGRAVITY_EVENTS
        .iter()
        .map(|e| (e.to_string(), if ANTIGRAVITY_TOOL_EVENTS.contains(e) { json!([{ "matcher": "*", "hooks": [handler(e)] }]) } else { json!([handler(e)]) }))
        .collect();
    // FIX-1 (e): the user's switch on the bundle stays as he set it.
    let had = root.get(NAME);
    if let Some(on) = had.and_then(|b| b.get("enabled")) {
        bundle.insert("enabled".into(), on.clone());
    }
    let bundle = Value::Object(bundle);
    if had == Some(&bundle) {
        return Ok(false);
    }
    let mine_already = had.is_some();
    root.insert(NAME.into(), bundle);
    keep_copy(home, file, "antigravity", text.is_some(), mine_already)?;
    write_json(file, &v, text.as_deref())?;
    Ok(true)
}

pub fn remove_antigravity(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let Some(root) = v.as_object_mut() else { return Ok(false) };
    if !root.get(NAME).is_some_and(bundle_mine) {
        return Ok(false);
    }
    root.remove(NAME);
    write_back(home, file, &v, &text)?;
    Ok(true)
}

/// Amp: Kolux's plugin file; a file of the user's under that name is never replaced.
pub fn install_amp(file: &Path) -> Result<bool, String> {
    let plugin = amp_plugin();
    let old = read_opt(file)?;
    if old.as_deref() == Some(plugin.as_str()) {
        return Ok(false);
    }
    if old.as_deref().is_some_and(|o| !amp_mine(o)) {
        return Err(format!("{} is not Kolux's own plugin; left alone", file.display()));
    }
    // FIX-1 (e): whole or not at all, and never over a file saved since it was read.
    write_atomic(file, plugin.as_bytes(), old.as_deref())?;
    Ok(true)
}

/// FIX-1 (e): Kolux's plugin says so on its first line; the words anywhere else are the user's.
fn amp_mine(text: &str) -> bool {
    text.lines().next().is_some_and(|l| l.starts_with("// ") && l.contains("Written by Kolux"))
}

pub fn remove_amp(file: &Path) -> Result<bool, String> {
    match read_opt(file)? {
        Some(t) if amp_mine(&t) => fs::remove_file(file).map(|_| true).map_err(|e| format!("{}: {e}", file.display())),
        _ => Ok(false),
    }
}

/// `agent_hooks::apply` for these three.
pub fn apply(home: &Path, profile: &Path, id: &str, plan: Plan) -> Result<&'static str, String> {
    let done = |installed: bool| if installed { "installed" } else { "removed" };
    let install = plan == Plan::Install;
    match id {
        "gemini" => {
            let file = target(profile, gemini_file(home))?;
            if install { install_gemini(home, &file) } else { remove_hooks(home, &file) }
        }
        "antigravity" => {
            let file = target(profile, antigravity_file(home))?;
            if install { install_antigravity(home, &file) } else { remove_antigravity(home, &file) }
        }
        "amp" => {
            let file = target(profile, amp_file(home))?;
            if install { install_amp(&file) } else { remove_amp(&file) }
        }
        _ => return Ok("left as it was"),
    }
    .map(|_| done(install))
}

fn inspect_antigravity(file: &Path) -> (&'static str, Option<String>) {
    let v: Value = match read_opt(file).map(|t| t.map(|t| serde_json::from_str::<Value>(&t))) {
        Ok(None) => return ("not installed", None),
        Ok(Some(Ok(v))) => v,
        Ok(Some(Err(e))) => return ("error", Some(format!("{} is not JSON ({e}); left alone", file.display()))),
        Err(e) => return ("error", Some(e)),
    };
    let Some(bundle) = v.get(NAME) else { return ("not installed", None) };
    if !bundle_mine(bundle) {
        return ("error", Some(format!("a {NAME} bundle that is not Kolux's")));
    }
    // FIX-1 (e): the user switched the bundle off in Antigravity's own file.
    if bundle.get("enabled") == Some(&Value::Bool(false)) {
        return ("disabled", Some(format!("the {NAME} bundle is switched off (\"enabled\": false)")));
    }
    let missing: Vec<&str> = ANTIGRAVITY_EVENTS.iter().copied().filter(|e| bundle.get(e).is_none()).collect();
    if missing.is_empty() {
        ("installed", None)
    } else {
        ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
    }
}

fn inspect_amp(file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) if t == amp_plugin() => ("installed", None),
        Ok(Some(t)) if amp_mine(&t) => ("partial", Some("an older Kolux plugin".into())),
        Ok(Some(_)) => ("error", Some(format!("{} is not Kolux's own plugin; left alone", file.display()))),
        Err(e) => ("error", Some(e)),
    }
}

/// `kolux agent hooks status` rows for the three vendors.
pub fn rows(home: &Path) -> Vec<Value> {
    let row = |agent: &str, name: &str, file: PathBuf, (state, reason): (&str, Option<String>)| json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason });
    vec![
        row("gemini", "Gemini CLI", gemini_file(home), switch::inspect(&gemini_file(home), &GEMINI_EVENTS)),
        row("antigravity", "Antigravity", antigravity_file(home), inspect_antigravity(&antigravity_file(home))),
        row("amp", "Amp", amp_file(home), inspect_amp(&amp_file(home))),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::{Agent, Session};

    fn state(s: &mut Session, path: &str, j: Value) -> Option<&'static str> {
        let e = normalize(path, &j)?;
        s.apply(Agent::Vendor, &e).map(|(c, _)| c.state)
    }

    #[test]
    fn gemini_events_drive_the_dot() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"BeforeAgent","prompt":"fix it","session_id":"g1"})), Some("working"));
        assert_eq!(normalize("/gemini", &json!({"hook_event_name":"BeforeAgent","prompt":"fix it","session_id":"g1"})).unwrap(), json!({"hook_event_name":"UserPromptSubmit","prompt":"fix it","session_id":"g1"}));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"BeforeTool","tool_name":"read_file","tool_input":{"file_path":"a.rs"}})), Some("working"));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"AfterTool","tool_name":"read_file"})), Some("working"));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"AfterAgent","prompt_response":"All fixed."})), Some("done"));
        assert_eq!(s.reply.as_deref(), Some("All fixed."));
        assert_eq!(normalize("/gemini", &json!({"hook_event_name":"Notification"})), None);
    }

    #[test]
    fn antigravity_events_drive_the_dot() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, "antigravity/PreInvocation", json!({"conversationId":"c1"})), Some("working"));
        let ask = normalize("/antigravity/PreToolUse", &json!({"toolCall":{"name":"ask_question","args":{}}})).unwrap();
        assert_eq!(ask["tool_name"], "ask_question");
        assert_eq!(s.apply(Agent::Vendor, &ask).map(|(c, _)| c.state), Some("waiting"));
        assert_eq!(state(&mut s, "/antigravity/PostToolUse", json!({"toolCall":{"name":"ask_question"}})), Some("working"));
        assert_eq!(normalize("/antigravity/Stop", &json!({"fullyIdle":false,"terminationReason":"tool"})), None, "a Stop that is not fully idle leaves the turn running");
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"fullyIdle":true})), Some("done"));
        assert_eq!(normalize("/antigravity/Mystery", &json!({})), None);
    }

    #[test]
    fn amp_events_drive_the_dot_and_a_cancel_is_an_interruption() {
        let mut s = Session::default();
        assert_eq!(normalize("/amp", &json!({"event":"session.start","thread":"t1"})), None);
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","thread":"t1","message":"go"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","tool":"Bash","input":{"cmd":"ls"}})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","status":"done"})), Some("done"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","message":"again"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","status":"cancelled"})), Some("interrupted"));
    }

    /// STAT-062 (T-126): once a transcript's turn has ended, a late tool or end-of-invocation
    /// event naming it is discarded, so the pane stays done; a fresh invocation (Antigravity) or
    /// agent start (Amp) begins a new turn; Amp's memory is per thread, so one ended thread never
    /// silences another. The ids are unique to this test: the memory behind `normalize` is shared.
    #[test]
    fn stat_062_late_events_after_an_ended_turn_never_bring_back_working() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, "/antigravity/PreInvocation", json!({"conversationId":"c-062","prompt":"go"})), Some("working"));
        assert_eq!(state(&mut s, "/antigravity/PreToolUse", json!({"conversationId":"c-062","toolCall":{"name":"read_file","args":{}}})), Some("working"));
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"conversationId":"c-062","fullyIdle":false,"terminationReason":"tool"})), None, "a Stop while still busy is not the end");
        assert_eq!(s.resolved(), "working");
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"conversationId":"c-062","fullyIdle":true})), Some("done"));
        assert_eq!(state(&mut s, "/antigravity/PostToolUse", json!({"conversationId":"c-062","toolCall":{"name":"read_file"}})), None, "a late tool event for the ended transcript is discarded");
        assert_eq!(s.resolved(), "done", "the pane stays done");
        assert_eq!(state(&mut s, "/antigravity/PostInvocation", json!({"conversationId":"c-062"})), None, "a late end-of-invocation event too");
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"conversationId":"c-062","fullyIdle":true})), None, "a repeated idle Stop changes nothing");
        assert_eq!(s.resolved(), "done");
        assert_eq!(state(&mut s, "/antigravity/PreInvocation", json!({"conversationId":"c-062","prompt":"again"})), Some("working"), "a fresh invocation begins a new turn");
        assert_eq!(state(&mut s, "/antigravity/PostToolUse", json!({"conversationId":"c-062","toolCall":{"name":"read_file"}})), Some("working"), "and its tool events count again");
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"conversationId":"c-062","fullyIdle":true})), Some("done"));
        assert_eq!(state(&mut s, "/antigravity/PostToolUse", json!({"conversationId":"c-062-other","toolCall":{"name":"read_file"}})), Some("working"), "another transcript is never silenced by this one");

        let mut s = Session::default();
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","thread":"t-062-a","message":"one"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","thread":"t-062-b","message":"two"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","thread":"t-062-a","status":"done"})), Some("done"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.result","thread":"t-062-a","tool":"Bash"})), None, "a late tool result for the ended thread is discarded");
        assert_eq!(s.resolved(), "done", "the pane stays done");
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","thread":"t-062-b","tool":"Bash"})), Some("working"), "the other thread in the pane still counts");
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","thread":"t-062-b","status":"done"})), Some("done"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","thread":"t-062-b","tool":"Bash"})), None);
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","thread":"t-062-b","status":"cancelled"})), None, "a late end for an ended thread changes nothing");
        assert_eq!(s.resolved(), "done");
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","thread":"t-062-a","message":"three"})), Some("working"), "a fresh agent start begins a new turn");
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","thread":"t-062-a","tool":"Bash"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","tool":"Bash"})), Some("working"), "an event naming no thread is read as before");

        // The memory itself: bounded, per agent, and cleared by a fresh start.
        let mut m = Ended::default();
        for i in 0..=ENDED_CAP {
            m.ended("amp", &format!("x{i}"));
        }
        assert!(!m.is_ended("amp", "x0") && m.is_ended("amp", &format!("x{ENDED_CAP}")), "the oldest ended id is forgotten past the cap");
        assert!(!m.is_ended("antigravity", "x1"), "an Amp thread's end says nothing about an Antigravity conversation of the same name");
        m.fresh("amp", "x1");
        assert!(!m.is_ended("amp", "x1"));
        assert_eq!(normalize_with(&mut m, "/amp", &json!({"event":"tool.call","thread":"x2","tool":"Bash"})), None);
        assert!(normalize_with(&mut m, "/amp", &json!({"event":"tool.call","thread":"x1","tool":"Bash"})).is_some());
    }

    /// hooks FIX-2 (stand-in review hooks-146904a2 FIX-SOON 1): an end is remembered for ENDED_FOR
    /// (60 s). A tool event 61 s after the end counts as working again, with no fresh start in
    /// between, so a lost PreInvocation or agent.start costs at most a minute, not the whole turn.
    /// The clock is injected: no sleeps.
    #[test]
    fn fix_2_an_ended_turn_is_forgotten_after_a_minute() {
        let t0 = Instant::now();
        let mut m = Ended::default();
        let end = json!({"event":"agent.end","thread":"t-fix2","status":"done"});
        let tool = json!({"event":"tool.call","thread":"t-fix2","tool":"Bash"});
        assert_eq!(normalize_at(&mut m, "/amp", &end, t0).map(|e| e["hook_event_name"].clone()), Some(json!("Stop")));
        assert_eq!(normalize_at(&mut m, "/amp", &tool, t0 + Duration::from_secs(59)), None, "within the minute a late tool event is still discarded");
        assert_eq!(normalize_at(&mut m, "/amp", &end, t0 + Duration::from_secs(59)), None, "and so is a repeated end");
        let late = normalize_at(&mut m, "/amp", &tool, t0 + Duration::from_secs(61));
        assert_eq!(late.as_ref().map(|e| e["hook_event_name"].clone()), Some(json!("PreToolUse")), "61 s after the end a tool event counts as working: {late:?}");
        // The same for Antigravity, through the memory directly.
        m.ended_at("antigravity", "c-fix2", t0);
        assert!(m.is_ended_at("antigravity", "c-fix2", t0 + ENDED_FOR - Duration::from_millis(1)));
        assert!(!m.is_ended_at("antigravity", "c-fix2", t0 + ENDED_FOR), "forgotten once ENDED_FOR has passed");
        assert!(m.is_ended_at("antigravity", "c-fix2", t0), "a clock that has not moved still remembers it");
        // An end after the minute is a new end: remembered again from then on.
        assert_eq!(normalize_at(&mut m, "/amp", &end, t0 + Duration::from_secs(62)).map(|e| e["hook_event_name"].clone()), Some(json!("Stop")));
        assert_eq!(normalize_at(&mut m, "/amp", &tool, t0 + Duration::from_secs(63)), None);
    }

    #[test]
    fn routes_and_agents() {
        assert!(is_route("/gemini") && is_route("/amp") && is_route("/antigravity/Stop") && !is_route("/claude"));
        assert_eq!((agent_of("gemini"), agent_of("antigravity/Stop"), agent_of("/amp"), agent_of("codex")), (Some("gemini"), Some("antigravity"), Some("amp"), None));
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-vendors-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn gemini_install_keeps_the_users_hooks_and_removal_takes_only_kolux() {
        let home = scratch("gemini");
        let file = gemini_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"theme":"dark","hooks":{"BeforeTool":[{"matcher":"write_file","hooks":[{"type":"command","command":"my-check"}]}]}}"#).unwrap();
        assert!(install_gemini(&home, &file).unwrap());
        assert!(!install_gemini(&home, &file).unwrap(), "a second install changes nothing");
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["hooks"]["BeforeTool"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["AfterAgent"][0]["hooks"][0]["timeout"], 10_000);
        assert_eq!(v["hooks"]["BeforeTool"][1]["matcher"], "*");
        assert_eq!(switch::inspect(&file, &GEMINI_EVENTS).0, "installed");
        assert!(remove_hooks(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["hooks"]["BeforeTool"][0]["hooks"][0]["command"], "my-check");
        assert!(v["hooks"].get("AfterAgent").is_none());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn antigravity_bundle_is_ours_alone() {
        let home = scratch("agy");
        let file = antigravity_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"mine":{"Stop":[{"hooks":[{"type":"command","command":"notify"}]}]}}"#).unwrap();
        assert!(install_antigravity(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(v[NAME]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("antigravity.cmd\" PreToolUse"));
        assert_eq!(inspect_antigravity(&file).0, "installed");
        assert!(remove_antigravity(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v, json!({"mine":{"Stop":[{"hooks":[{"type":"command","command":"notify"}]}]}}));
        fs::write(&file, r#"{"kolux-rs":{"Stop":[{"hooks":[{"type":"command","command":"someone else"}]}]}}"#).unwrap();
        assert!(install_antigravity(&home, &file).is_err(), "a same-named bundle of the user's is left alone");
        assert!(!remove_antigravity(&home, &file).unwrap());
        assert_eq!(inspect_antigravity(&file).0, "error");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn amp_plugin_is_never_put_over_the_users_file() {
        let home = scratch("amp");
        let file = amp_file(&home);
        assert_eq!(inspect_amp(&file).0, "not installed");
        assert!(install_amp(&file).unwrap());
        assert_eq!(inspect_amp(&file).0, "installed");
        let text = fs::read_to_string(&file).unwrap();
        assert!(AMP_EVENTS.iter().all(|e| text.contains(&format!("\"{e}\""))) && text.contains(SPOOL_FILE) && text.contains("/amp"));
        assert!(remove_amp(&file).unwrap() && !file.exists());
        fs::write(&file, "export default () => {}").unwrap();
        assert!(install_amp(&file).is_err());
        assert!(!remove_amp(&file).unwrap() && file.exists(), "the user's plugin stays");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_antigravity_script_routes_by_its_argument() {
        let s = script("antigravity", "antigravity/%~1", true);
        assert!(s.contains("/antigravity/%~1\"") && s.contains("antigravity/%~1|"));
    }

    fn sha(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// FIX-1 (a): the `.bak-kolux` copy holds the file as it was, and its record names the copy
    /// with that hash.
    fn kept_and_recorded(home: &Path, file: &Path, original: &[u8]) {
        let copy = super::super::backup_of(file);
        assert_eq!(fs::read(&copy).expect("a copy was kept before the first write"), original);
        let record = fs::read_to_string(super::super::target_dir(home, file).join(super::super::BACKUP_RECORD)).expect("the copy has a record");
        let want = (sha(original), copy.display().to_string());
        assert!(record.lines().filter_map(|l| l.split_once("  ")).any(|(h, p)| (h.to_string(), p.to_string()) == want), "{record}");
    }

    #[test]
    fn fix1_gemini_install_keeps_a_copy_and_removal_gives_back_the_bytes() {
        let home = scratch("fix1-gemini");
        let file = gemini_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        // A layout Kolux's own writer would never produce, so only the kept bytes can give it back.
        let original = b"{ \"theme\": \"dark\", \"mcpServers\": {\"a\": {\"command\": \"x\"}} }\n".to_vec();
        fs::write(&file, &original).unwrap();
        assert!(install_gemini(&home, &file).unwrap());
        kept_and_recorded(&home, &file, &original);
        assert!(!install_gemini(&home, &file).unwrap(), "a second install changes nothing and keeps the first copy");
        kept_and_recorded(&home, &file, &original);
        assert!(remove_hooks(&home, &file).unwrap());
        assert_eq!(fs::read(&file).unwrap(), original, "install then remove is byte for byte the user's file");
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-2 (S5): a settings file Kolux created (none was there before) is deleted when the
    /// hooks go off, not left as `{}`; one the user had stays.
    #[test]
    fn fix_2_s5_a_file_kolux_created_is_deleted_on_removal() {
        let home = scratch("fix2-created");
        for (file, agent) in [(gemini_file(&home), "gemini"), (antigravity_file(&home), "antigravity")] {
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            let on = |f: &Path| if agent == "gemini" { install_gemini(&home, f) } else { install_antigravity(&home, f) };
            let off = |f: &Path| if agent == "gemini" { remove_hooks(&home, f) } else { remove_antigravity(&home, f) };
            // hooks FIX-3: the record names the file with the `created` marker while it is on.
            let record = target_dir(&home, &file).join(BACKUP_RECORD);
            for round in 0..2 {
                assert!(!file.exists());
                assert!(on(&file).unwrap(), "{agent} round {round}");
                assert_eq!(fs::read_to_string(&record).unwrap(), format!("created  {}\n", file.display()), "{agent} round {round}");
                assert!(!on(&file).unwrap(), "{agent} round {round}: a second start changes nothing");
                assert!(super::super::was_created(&record, &file), "{agent} round {round}: still recorded as created");
                assert!(off(&file).unwrap());
                assert!(!file.exists(), "{agent} round {round}: off leaves no file, not {:?}", fs::read_to_string(&file).ok());
                assert!(!record.exists(), "{agent} round {round}: the record goes with the file");
            }
            // The user's own empty file stays.
            fs::write(&file, "{}").unwrap();
            assert!(on(&file).unwrap() && off(&file).unwrap());
            assert_eq!(fs::read_to_string(&file).unwrap(), "{}", "{agent}: the user's own file is never deleted");
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn fix1_antigravity_install_keeps_a_copy_and_removal_gives_back_the_bytes() {
        let home = scratch("fix1-agy");
        let file = antigravity_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let original = b"{\"mine\": {\"Stop\": [{\"command\": \"notify\"}]}}".to_vec();
        fs::write(&file, &original).unwrap();
        assert!(install_antigravity(&home, &file).unwrap());
        kept_and_recorded(&home, &file, &original);
        assert!(remove_antigravity(&home, &file).unwrap());
        assert_eq!(fs::read(&file).unwrap(), original);
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-1 (b): Gemini CLI runs a hook command through PowerShell's `-Command` on Windows (and
    /// adds its own exit-code check); the stored command must run the script, with the event on
    /// its stdin byte for byte, from a home whose path holds a `'`.
    #[cfg(windows)]
    #[test]
    fn fix1_the_gemini_command_runs_the_script_through_powershell_with_stdin_intact() {
        use std::io::Write as _;
        use std::process::{Command, Stdio};
        let home = scratch("fix1-ps-o'q");
        let file = gemini_file(&home);
        assert!(install_gemini(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let command = v["hooks"]["BeforeTool"].as_array().unwrap().iter().flat_map(|g| g["hooks"].as_array().unwrap()).find(|h| names_mine(h)).unwrap()["command"].as_str().unwrap().to_string();
        // A stand-in in the script's place that keeps what reached its stdin.
        let dir = home.join(crate::hooks::SCRIPT_DIR);
        fs::write(dir.join(GEMINI_SCRIPT), "@echo off\r\n%SystemRoot%\\System32\\more.com >\"%~dp0got.txt\"\r\nexit /b 0\r\n").unwrap();
        let payload = "{\"hook_event_name\":\"BeforeTool\",\"session_id\":\"g1\",\"prompt\":\"caf\u{e9} \u{2603}\"}";
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("{command}; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}")])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(payload.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(!String::from_utf8_lossy(&out.stdout).contains(GEMINI_SCRIPT), "the command is run, not printed: {}", String::from_utf8_lossy(&out.stdout));
        let got = fs::read(dir.join("got.txt")).expect("the script ran");
        assert!(got.starts_with(payload.as_bytes()), "{:?}", String::from_utf8_lossy(&got));
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-2 (A4): PowerShell reads the curly single quotes as quotes too, so a home like
    /// `O’Brien` has each of them doubled; A5: the `&` form is Windows only, a POSIX shell gets
    /// a plain single-quoted path.
    #[test]
    fn fix_2_a4_a5_the_gemini_command_quotes_every_single_quote_powershell_knows() {
        let path = "C:/Users/O'Brien \u{2018}x\u{2019} \u{201a}y\u{201b}/gemini.cmd";
        if cfg!(windows) {
            assert_eq!(gemini_command(path), "& 'C:/Users/O''Brien \u{2018}\u{2018}x\u{2019}\u{2019} \u{201a}\u{201a}y\u{201b}\u{201b}/gemini.cmd'");
        } else {
            assert_eq!(gemini_command("/home/o'b/gemini.cmd"), "'/home/o'\\''b/gemini.cmd'");
        }
    }

    /// FIX-2 (A4): run under PowerShell, the command with curly quotes in the path runs the script.
    #[cfg(windows)]
    #[test]
    fn fix_2_a4_a_curly_quote_in_the_home_still_runs_the_gemini_script() {
        use std::process::Command;
        let home = scratch("fix2-ps-o\u{2019}q");
        let dir = home.join(crate::hooks::SCRIPT_DIR);
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join(GEMINI_SCRIPT);
        fs::write(&script, "@echo off\r\necho ran>\"%~dp0ran.txt\"\r\nexit /b 0\r\n").unwrap();
        let command = gemini_command(&script.to_string_lossy().replace('\\', "/"));
        let out = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &format!("{command}; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}")]).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert!(dir.join("ran.txt").exists(), "the script ran: {}", String::from_utf8_lossy(&out.stderr));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn fix1_gemini_refuses_hook_values_it_would_have_to_replace() {
        let home = scratch("fix1-shape");
        let file = gemini_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        for text in ["[1]", "\"text\"", r#"{"hooks":[1]}"#, r#"{"hooks":"off"}"#, r#"{"hooks":{"BeforeTool":{"matcher":"x","hooks":[]}}}"#, r#"{"hooks":{"AfterAgent":"run-me"}}"#, "not json"] {
            fs::write(&file, text).unwrap();
            let e = install_gemini(&home, &file).expect_err(text);
            assert!(e.ends_with("left alone"), "{text}: {e}");
            assert_eq!(fs::read_to_string(&file).unwrap(), text, "the file is untouched");
            assert!(!super::super::backup_of(&file).exists(), "{text}: no copy of a file that is not written");
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn fix1_antigravity_refuses_malformed_files() {
        let home = scratch("fix1-agy-shape");
        let file = antigravity_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        for text in ["[1]", "not json", r#"{"kolux-rs":"x"}"#, r#"{"kolux-rs":{"Stop":"notify"}}"#] {
            fs::write(&file, text).unwrap();
            assert!(install_antigravity(&home, &file).is_err(), "{text}");
            assert_eq!(fs::read_to_string(&file).unwrap(), text);
            assert!(!remove_antigravity(&home, &file).unwrap_or(false));
            assert_eq!(fs::read_to_string(&file).unwrap(), text);
        }
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-1 (e): the documented shapes (tool events take matcher groups, the others a plain list of
    /// handlers) and the user's off switch on the bundle survives a reinstall.
    #[test]
    fn fix1_antigravity_keeps_the_users_off_switch_and_writes_the_documented_shapes() {
        let home = scratch("fix1-agy-off");
        let file = antigravity_file(&home);
        assert!(install_antigravity(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v[NAME]["PreToolUse"][0]["matcher"], "*");
        assert!(v[NAME]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("antigravity.cmd\" PreToolUse"));
        for e in ["PreInvocation", "PostInvocation", "Stop"] {
            assert!(v[NAME][e][0]["command"].as_str().unwrap().ends_with(&format!("antigravity.cmd\" {e}")), "{e}: {}", v[NAME][e]);
        }
        let mut off = v.clone();
        off[NAME]["enabled"] = json!(false);
        let text = serde_json::to_string_pretty(&off).unwrap();
        fs::write(&file, &text).unwrap();
        assert_eq!(inspect_antigravity(&file).0, "disabled");
        assert!(!install_antigravity(&home, &file).unwrap(), "a reinstall leaves the switched-off bundle as it is");
        assert_eq!(fs::read_to_string(&file).unwrap(), text);
        // An older Kolux bundle is brought up to date and stays off.
        off[NAME]["Stop"] = json!([{ "hooks": [{ "type": "command", "command": v[NAME]["Stop"][0]["command"] }] }]);
        fs::write(&file, serde_json::to_string_pretty(&off).unwrap()).unwrap();
        assert!(install_antigravity(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v[NAME]["enabled"], false);
        assert!(v[NAME]["Stop"][0]["command"].is_string());
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-1 (e): the header is the first line only; the plugin is written whole or not at all; a
    /// tool event carries no input and is never held in the spool; the prompt goes on agent.start only.
    #[test]
    fn fix1_amp_plugin_is_atomic_owned_by_its_first_line_and_keeps_tool_input_out() {
        let home = scratch("fix1-amp");
        let file = amp_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let mine = "// my own plugin\n// (I copied the line \"Written by Kolux\" from theirs)\nexport default () => {}\n";
        fs::write(&file, mine).unwrap();
        assert!(install_amp(&file).is_err());
        assert!(!remove_amp(&file).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), mine);
        assert_eq!(inspect_amp(&file).0, "error");
        fs::remove_file(&file).unwrap();
        assert!(install_amp(&file).unwrap());
        let left: Vec<_> = fs::read_dir(file.parent().unwrap()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from(format!("{NAME}.js"))], "no temp file left beside it");
        let plugin = amp_plugin();
        assert!(plugin.lines().next().unwrap().contains("Written by Kolux"));
        assert!(!plugin.contains("event?.input") && !plugin.contains("input:"), "the tool input never leaves Amp");
        assert!(plugin.contains("name === 'agent.start' ? text(event?.message)"));
        assert!(plugin.contains("if (TOOL_EVENTS.includes(name)) return"));
        assert!(plugin.contains("fetch(`http://127.0.0.1:${port}/amp`"), "the loopback URL stays in the fetch call where the privacy audit sees it");
        let e = normalize("/amp", &json!({"event":"tool.call","tool":"Bash","input":{"cmd":"echo secret"}})).unwrap();
        assert!(e.get("tool_input").is_none(), "{e}");
        assert!(normalize("/amp", &json!({"event":"agent.end","status":"done","message":"the whole reply"})).unwrap().get("prompt").is_none());
        let _ = fs::remove_dir_all(&home);
    }

    /// FIX-1 (S4): `apply` writes a vendor's file only below a scratch marker in a fenced run.
    #[test]
    fn fix1_apply_writes_vendor_files_only_below_a_scratch_marker() {
        let home = scratch("fix1-fence");
        let profile = Path::new("kolux-rs-test-profile");
        for id in ["gemini", "antigravity", "amp"] {
            let e = apply(&home, profile, id, Plan::Install).expect_err(id);
            assert!(e.contains("left alone"), "{id}: {e}");
        }
        assert!(!gemini_file(&home).exists() && !antigravity_file(&home).exists() && !amp_file(&home).exists());
        fs::write(home.join(super::super::SCRATCH_MARKER), "").unwrap();
        for id in ["gemini", "antigravity", "amp"] {
            assert_eq!(apply(&home, profile, id, Plan::Install), Ok("installed"), "{id}");
        }
        assert!(gemini_file(&home).exists() && antigravity_file(&home).exists() && amp_file(&home).exists());
        let _ = fs::remove_dir_all(&home);
    }
}
