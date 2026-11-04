//! STAT-026 (T-025-c): what Kolux keeps about each pane's agent between hook events (COMPAT 3.5,
//! the stored-status table): the lead's own state, the tool waiting on a permission, the roster of
//! sub-agents and teammates, whether background work outlives the turn, the interrupted flag, the
//! last reply and the last twenty states. `hooks.rs` turns one event into a `Change`; this module
//! folds it into the pane's `Session` and resolves the state the window is shown.

use crate::hooks::{claude_change, codex_change, Change};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// STAT-001: no more than 32 child agents per report.
const MAX_CHILDREN: usize = 32;
const MAX_HISTORY: usize = 20;
/// T-123-c: how many of a turn's tool ids are kept to tell a new step from a killed tool's late report.
const MAX_TOOLS: usize = 256;
/// STAT-028: how long after Ctrl+C or Escape a turn with no Stop is taken as interrupted.
const CANCEL_GRACE_MS: u64 = 3000;
/// STAT-032: a working reading with no hook event for this long is marked unverified.
const UNVERIFIED_MS: u64 = 30 * 60 * 1000;
/// STAT-034: the states a program may print in band; anything else is dropped.
const INBAND_STATES: [&str; 5] = ["working", "done", "permission", "waiting", "idle"];

/// The unverified window; a debug build takes `KOLUX_UNVERIFIED_MS` so a live proof need not wait
/// half an hour. `pub(crate)`: the automations clock borrows the same window for a run whose pane
/// still reads working but has gone silent (C25-R2-01).
pub(crate) fn unverified_ms() -> u64 {
    #[cfg(debug_assertions)]
    if let Some(ms) = std::env::var("KOLUX_UNVERIFIED_MS").ok().and_then(|v| v.parse().ok()) {
        return ms;
    }
    UNVERIFIED_MS
}

/// STAT-029: how Claude Code opens the message it submits itself after a compaction.
const CONTINUATION: &str = "This session is being continued from a previous conversation";

/// Every pane's stored status, by pane key. ponytail: in memory only; a restart starts clean
/// (STAT-006's catch-up is its own card).
pub static SESSIONS: Mutex<Option<HashMap<u32, Session>>> = Mutex::new(None);
/// T-563: per pane key, the terminals whose exit took that pane's session, newest last. A hook
/// still in flight from one of them is dropped, so it never points the session back at a dead
/// terminal. Terminal ids are never reused within a run, so a few per pane are enough.
static RETIRED: Mutex<Option<Retired>> = Mutex::new(None);
const RETIRED_KEEP: usize = 16;
/// hooks FIX-5: how many ended terminals are remembered on their own, whatever pane they had.
const ENDED_KEEP: usize = 256;
/// hooks FIX-6 (stand-in review FIX-SOON 1): the tests that lean on `ended` alone (a terminal
/// ended, then its hook expected to be dropped) take this before anything else, so the race
/// test's two thousand ends never flush the ring under them on a loaded PC.
#[cfg(test)]
static ENDED_TESTS: Mutex<()> = Mutex::new(());

/// T-563's per-pane retirements and, hooks FIX-5 (stand-in review AFTER 3), the last ended
/// terminals on their own: an agent that crashes right after its first hook left its pane no
/// session to retire from, so that hook, handled after the exit, would otherwise create one on
/// the dead terminal. A terminal that ended can never send a hook that counts.
#[derive(Default)]
struct Retired {
    by_pane: HashMap<u32, VecDeque<u32>>,
    ended: VecDeque<u32>,
}

fn with_retired<T>(f: impl FnOnce(&mut Retired) -> T) -> T {
    let mut guard = RETIRED.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(Retired::default))
}

/// T-563: `terminal`'s exit already took `pane_key`'s session; hooks FIX-5: or it ended lately,
/// session or not.
fn retired(pane_key: u32, terminal: u32) -> bool {
    with_retired(|r| r.ended.contains(&terminal) || r.by_pane.get(&pane_key).is_some_and(|t| t.contains(&terminal)))
}
/// When the usage window the status line last saw used up lifts (ms), 0 for none (STAT-040); a
/// limit stop carries it (STAT-022).
pub static LIMIT_RESETS_AT: AtomicI64 = AtomicI64::new(0);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Agent {
    Claude,
    Codex,
    /// T-120-b: Gemini CLI, Antigravity or Amp, its event already normalized; hook semantics unverified.
    Vendor,
}

/// A sub-agent or teammate under a lead session.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub state: &'static str,
    #[serde(skip)]
    pending: Option<String>,
    /// Hash of the input of the tool `pending` waits on (VIEW-025 b5).
    #[serde(skip)]
    pending_input: u64,
    pub started: u64,
}

/// A tool an agent started this turn: `agent` is the sub-agent's id, `None` for the lead (VIEW-025 b5).
#[derive(Debug)]
struct Started {
    agent: Option<String>,
    id: String,
    name: String,
    input: u64,
}

/// A hash of the tool input as Claude sent it; the same process writes the PreToolUse and the
/// PermissionRequest, so the serialized form is stable.
fn input_hash(event: &Value) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(event.get("tool_input").unwrap_or(&Value::Null)).unwrap_or_default().hash(&mut h);
    h.finish()
}

fn record_start(list: &mut Vec<Started>, agent: Option<&str>, event: &Value) {
    let Some(id) = str_of(event, "tool_use_id") else { return };
    if list.len() >= MAX_TOOLS {
        list.remove(0);
    }
    list.push(Started { agent: agent.map(str::to_string), id: trim(id, 80), name: str_of(event, "tool_name").map(|t| trim(t, 60)).unwrap_or_default(), input: input_hash(event) });
}

/// One line of the pane's history: the state it entered, the prompt that began the turn, when.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub started: u64,
    pub interrupted: bool,
}

/// Why the lead is stopped (STAT-022): the cause, the agent's own words, and when a limit lifts
/// (milliseconds since the epoch; T-039-b fills it from the status line's figures).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stop {
    pub cause: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
}

/// What the window is told after an event: the resolved state plus the roster.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub pane_key: u32,
    pub terminal: Option<u32>,
    #[serde(flatten)]
    pub change: Change,
    pub children: Vec<Child>,
    /// Attached while the session is stopped on a limit, a sign-in or an error, until a later
    /// turn reaches done (STAT-022).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Stop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    /// The child whose turn just ended, so its reply is announced on its own (STAT-026).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child: Option<String>,
    pub interrupted: bool,
    /// STAT-024: the turn is over but Claude Code's background tasks are still going.
    pub monitoring: bool,
}

#[derive(Default, Debug)]
pub struct Session {
    /// The terminal the pane's hooks last reported for, so a keystroke can find the session.
    pub terminal: Option<u32>,
    /// The agent whose hook last reported, so a typed keystroke knows whose prompt it lands on.
    agent: Option<Agent>,
    /// The lead's own last state; `None` when Kolux holds nothing for it yet.
    own: Option<&'static str>,
    /// The tool the lead is waiting on a permission for; cleared only when that tool resumes.
    pending: Option<String>,
    pub children: Vec<Child>,
    /// Claude Code's background tasks were still in flight at the last Stop (STAT-024).
    background: bool,
    /// Ctrl+C or Escape was typed while working: the next Stop reads interrupted (STAT-028).
    cancelled: bool,
    /// When that keystroke came (ms), so a turn that never sends its Stop settles anyway.
    cancelled_at: u64,
    /// That cancel is a Claude Deny (card or typed Esc): its settle sets the busy children aside.
    deny: bool,
    /// The current turn ended on a cancel; late tool events cannot bring it back to working.
    interrupted: bool,
    /// The tool ids the lead has started this turn, newest last (T-123-c).
    tools: Vec<String>,
    /// The tool ids already started when the cancel keystroke came: their own late reports say
    /// nothing about the turn, while a tool id outside this list proves the turn went on (T-123-c).
    killed: Vec<String>,
    /// The tool ids a Claude Deny (card or typed Esc) refused: their late Post* never mean the turn went on.
    denied: Vec<String>,
    /// Children a deny settle took off the roster, oldest first; true = set aside this turn. Their own
    /// events bring them back at any time, the interrupt's undo only this turn's; a new prompt keeps them.
    parked: Vec<(Child, bool)>,
    /// T-585: the children that were working when an Escape could not be concluded (STAT-028: never while a child
    /// works). Esc stops the turn and its helpers, and Claude sends neither stop; one not heard from since is cleared
    /// at the next prompt, so it cannot keep later turns working.
    escaped: Vec<String>,
    /// Every tool the lead and the sub-agents started this turn, newest last (VIEW-025 b5).
    started: Vec<Started>,
    /// Hash of the input of the tool the lead's `pending` waits on.
    pending_input: u64,
    prompt: Option<String>,
    pub reply: Option<String>,
    /// The stop the session is blocked on, kept until a turn reaches done (STAT-022).
    pub stop: Option<Stop>,
    pub history: VecDeque<Entry>,
    /// The quiet alert already went out for this silent spell (STAT-045).
    quiet_fired: bool,
    /// Where the agent's hooks say its transcript is (CHAT-006 reads it before any folder search).
    pub transcript: Option<String>,
    /// When the last hook (or in-band) signal came (ms), 0 before the first (STAT-032).
    seen: u64,
    /// The working reading has had no signal for the unverified window; the next one clears it.
    unverified: bool,
}

/// What the window is told when a working agent has printed nothing for too long (STAT-045).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quiet {
    pub pane_key: u32,
    pub minutes: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn trim(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn str_of<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

impl Session {
    /// The state the pane shows: a child waiting on Txais first, then the lead's own needs, then
    /// working while the lead, any child or background work is busy, else the lead's last state.
    pub fn resolved(&self) -> &'static str {
        if self.children.iter().any(|c| c.state == "permission") {
            return "permission";
        }
        if self.children.iter().any(|c| c.state == "waiting") {
            return "waiting";
        }
        match self.own {
            Some(s @ ("permission" | "waiting" | "blocked" | "interrupted")) => s,
            _ if self.own == Some("working") || self.background || self.children.iter().any(|c| c.state == "working") => "working",
            Some(s) => s,
            None => "working",
        }
    }

    /// STAT-024: the turn has settled while background tasks run on; Kolux is watching them.
    pub fn monitoring(&self) -> bool {
        self.background && self.own == Some("done") && !self.children.iter().any(|c| c.state == "working")
    }

    /// One tick of the quiet alert: `silent` says the terminal has been past the threshold. Fires
    /// once per silent spell, only while working; output or any other state re-arms it (STAT-045).
    pub fn quiet(&mut self, silent: bool) -> bool {
        let quiet = silent && self.resolved() == "working";
        let fire = quiet && !self.quiet_fired;
        self.quiet_fired = quiet;
        fire
    }

    fn reset(&mut self) {
        let (terminal, agent) = (self.terminal, self.agent);
        let history = std::mem::take(&mut self.history);
        *self = Session { terminal, agent, history, ..Session::default() };
    }

    /// Folds one event in and says what the window should be told, or `None` when nothing changed.
    pub fn apply(&mut self, agent: Agent, event: &Value) -> Option<(Change, Option<String>)> {
        // VIEW-025 b3: a cancel whose grace ran out settles before this event is judged, so the
        // 2 s settle tick cannot let a late report from the killed tool pass as the turn going on.
        let settled = self.settle_cancel(now_ms());
        let applied = self.fold(agent, event);
        match applied {
            None if settled => Some((Change { state: self.resolved(), ..Change::default() }, None)),
            _ => applied,
        }
    }

    fn fold(&mut self, agent: Agent, event: &Value) -> Option<(Change, Option<String>)> {
        let name = event.get("hook_event_name")?.as_str()?;
        self.signal();
        self.agent = Some(agent);
        // T-585: a child heard from after an Escape was not stopped by it.
        if let Some(id) = str_of(event, "agent_id") {
            self.escaped.retain(|e| e != id);
        }
        // A sub-agent starting or starting a tool inside a cancel's grace proves the turn went on.
        if self.cancelled && self.child_alive(agent, name, event) {
            self.drop_cancel();
        }
        let before = self.resolved();
        self.restore_parked(event);
        let mut announce = None;
        // Council FIX-3 (chat e5412ff, FS1): the tool a sub-agent just started, named on the change.
        let mut started = None;
        match (name, str_of(event, "agent_id")) {
            ("SubagentStart", id) => {
                let id = id.unwrap_or_default().to_string();
                let kind = trim(str_of(event, "agent_type").unwrap_or("agent"), 40);
                let model = str_of(event, "model").map(|m| trim(m, 120));
                match self.children.iter_mut().find(|c| c.id == id) {
                    Some(c) => {
                        c.state = "working";
                        c.kind = kind;
                    }
                    None => {
                        self.parked.retain(|(c, _)| c.id != id);
                        if self.children.len() >= MAX_CHILDREN {
                            // ponytail: the cap drops the oldest settled child; a full roster of live ones ignores the newcomer.
                            let i = self.children.iter().position(|c| c.state != "working")?;
                            self.children.remove(i);
                        }
                        self.children.push(Child { id, kind, model, state: "working", pending: None, pending_input: 0, started: now_ms() });
                    }
                }
            }
            ("SubagentStop", id) => {
                let id = id.unwrap_or_default();
                // A child already cleared away never comes back; a known one is finished and announced.
                let i = self.children.iter().position(|c| c.id == id)?;
                let gone = self.children.remove(i);
                self.reply = str_of(event, "last_assistant_message").map(clean_reply);
                // Announced by role (what a notification names, STAT-041); the id when there is none.
                announce = Some(if gone.kind.is_empty() { gone.id } else { gone.kind });
            }
            ("TeammateIdle", id) => {
                let who = str_of(event, "teammate_name").or(id).unwrap_or_default();
                if let Some(c) = self.children.iter_mut().find(|c| c.id == who || c.kind == who) {
                    c.state = "idle";
                    c.pending = None;
                }
            }
            (_, Some(id)) => {
                // A sub-agent's own tool events move that child only (never a child already gone).
                let c = self.children.iter_mut().find(|c| c.id == id)?;
                let tool = str_of(event, "tool_name").map(|t| trim(t, 60));
                let change = match agent {
                    Agent::Claude => claude_change(&strip_agent(event)),
                    Agent::Codex => codex_change(&strip_agent(event)),
                    Agent::Vendor => None,
                }?;
                match name {
                    "PermissionRequest" => {
                        c.pending = tool;
                        c.pending_input = input_hash(event);
                        c.state = "permission";
                    }
                    "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
                        if c.state == "permission" && c.pending != tool {
                            return None;
                        }
                        c.pending = None;
                        c.state = change.state;
                        if name == "PreToolUse" {
                            record_start(&mut self.started, Some(id), event);
                            started = tool;
                        }
                    }
                    _ => return None,
                }
            }
            (_, None) => return self.apply_lead(agent, name, event),
        }
        let after = self.resolved();
        if after != before {
            self.remember(after);
        }
        // T-124-c: a child's hook permission names its pending tool, which is what lets the card answer it.
        // Council FIX-3 (FS1): a child's tool start names its tool, as the lead's does, so the window
        // holds its keys for the moment a permission menu may take to be reported.
        let tool = if after == "permission" {
            self.children.iter().find(|c| c.state == "permission").and_then(|c| c.pending.clone())
        } else {
            started.filter(|_| after == "working")
        };
        Some((Change { state: after, tool, ..Change::default() }, announce))
    }

    /// T-124-c: a hook PermissionRequest stands, the lead's or a child's, naming the tool it waits on.
    /// A permission printed in band (OSC 9999) names none, so there is nothing for a card to answer.
    pub fn answerable(&self) -> bool {
        (self.own == Some("permission") && self.pending.is_some()) || self.children.iter().any(|c| c.state == "permission" && c.pending.is_some())
    }

    fn apply_lead(&mut self, agent: Agent, name: &str, event: &Value) -> Option<(Change, Option<String>)> {
        // An automatic compact changes nothing; its own Stop closes the turn (STAT-029).
        if (name == "PostCompact" && str_of(event, "trigger") != Some("manual")) || (name == "SessionStart" && str_of(event, "source") == Some("compact")) {
            return None;
        }
        // STAT-029: the continuation message Claude Code submits after a compaction is not a turn,
        // so the card keeps the user's last real prompt; a prompt that only quotes it later counts.
        if name == "UserPromptSubmit" && agent == Agent::Claude && str_of(event, "prompt").is_some_and(|p| p.trim_start().starts_with(CONTINUATION)) {
            return None;
        }
        // T-123-c: Ctrl+C on a draft or Escape on a menu leaves the turn running. A sign of life after
        // the cancel proves it (goes_on): the cancel is dropped inside the grace, and a settled
        // interrupt is undone, its misread history line with it.
        if self.goes_on(agent, name, event) {
            self.drop_cancel();
            if self.interrupted {
                self.interrupted = false;
                self.restore_all_parked();
                self.own = Some("working");
                if self.history.back().is_some_and(|e| e.state == "interrupted" && e.interrupted) {
                    self.history.pop_back();
                }
            }
        }
        // Late events after an interrupt cannot revive the turn (STAT-028), nor stop it (STAT-022).
        if self.interrupted && !matches!(name, "UserPromptSubmit" | "SessionStart" | "PostCompact") {
            return None;
        }
        let mut change = match agent {
            Agent::Claude => claude_change(event),
            Agent::Codex => codex_change(event),
            Agent::Vendor => crate::hooks::agent_hooks::more::change(event).unwrap_or_else(|| crate::hooks::agent_hooks::vendors::change(event)),
        }?;
        let before = self.resolved();
        if change.boundary {
            self.reset();
        }
        match name {
            "UserPromptSubmit" => {
                // T-585: a child silent since an Escape stopped the last turn most likely went with that turn (its stop
                // never comes), so it no longer keeps the pane working. It is set aside, not forgotten: a background
                // helper or teammate the Esc did not stop comes back with its own next event (restore_parked).
                let escaped = std::mem::take(&mut self.escaped);
                let (gone, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.children).into_iter().partition(|c| c.state == "working" && escaped.contains(&c.id));
                self.children = kept;
                self.parked.extend(gone.into_iter().map(|c| (c, false)));
                let over = self.parked.len().saturating_sub(MAX_CHILDREN);
                self.parked.drain(..over);
                self.prompt = change.prompt.clone();
                self.pending = None;
                self.interrupted = false;
                self.drop_cancel();
                self.tools.clear();
                self.killed.clear();
                self.denied.clear();
                self.parked.iter_mut().for_each(|p| p.1 = false);
                self.started.clear();
                self.reply = None;
                self.own = Some("working");
            }
            "Stop" => {
                // T-120-b: Amp says itself when a turn was cancelled.
                // STAT-013: Droid's stops never count a Ctrl+C as an interruption.
                let ctrl_c = self.drop_cancel() && event.get("kolux_no_cancel").and_then(Value::as_bool) != Some(true);
                self.interrupted = ctrl_c || event.get("kolux_interrupted").and_then(Value::as_bool) == Some(true);
                self.pending = None;
                self.reply = str_of(event, "last_assistant_message").map(clean_reply);
                // STAT-024: Claude Code's own lists of background tasks and session crons decide.
                let busy = |k: &str| event.get(k).and_then(Value::as_array).is_some_and(|t| !t.is_empty());
                self.background = busy("background_tasks") || busy("session_crons");
                self.own = Some(if self.interrupted { "interrupted" } else { "done" });
                self.stop = None;
            }
            "StopFailure" => {
                self.pending = None;
                // A failure after a Kolux cancel is the interruption, not a stop (STAT-022).
                if self.drop_cancel() {
                    self.interrupted = true;
                    self.own = Some("interrupted");
                } else {
                    // One episode keeps the first report's words, however many reports arrive.
                    if self.own != Some("blocked") || self.stop.is_none() {
                        let cause = change.cause.unwrap_or("error");
                        let resets_at = (cause == "limit").then(|| LIMIT_RESETS_AT.load(Ordering::Relaxed)).filter(|t| *t > crate::claude_key::now_ms()).map(|t| t as u64);
                        self.stop = Some(Stop { cause, detail: change.detail.clone(), resets_at });
                    }
                    self.own = Some("blocked");
                }
            }
            "PermissionRequest" => {
                // A question asked as a permission waits instead, and clears on later tool work (STAT-027).
                self.pending = change.tool.clone();
                self.pending_input = input_hash(event);
                self.own = Some(change.state);
            }
            "PostCompact" => {
                // STAT-029: the compacted turn is labelled by its summary.
                self.prompt = str_of(event, "compact_summary").map(|s| trim(&s.split_whitespace().collect::<Vec<_>>().join(" "), 200));
                self.own = Some(change.state);
            }
            "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
                // A pending permission clears only when that same tool carries on. The event names the
                // tool even where the outgoing change does not (PostToolUse), SAFE-007.
                if self.own == Some("permission") && self.pending != str_of(event, "tool_name").map(|t| trim(t, 60)) {
                    return None;
                }
                if name == "PreToolUse" {
                    record_start(&mut self.started, None, event);
                    if let Some(id) = str_of(event, "tool_use_id") {
                        if self.tools.len() >= MAX_TOOLS {
                            self.tools.remove(0);
                        }
                        self.tools.push(trim(id, 80));
                    }
                }
                self.pending = None;
                self.own = Some(change.state);
            }
            _ => self.own = Some(change.state),
        }
        let after = self.resolved();
        // A new turn is a history line of its own, even when the word stays working.
        if after != before || change.boundary || name == "UserPromptSubmit" {
            self.remember(after);
        }
        change.state = after;
        Some((change, None))
    }

    fn remember(&mut self, state: &'static str) {
        self.history.push_back(Entry { state, prompt: self.prompt.clone(), started: now_ms(), interrupted: self.interrupted });
        while self.history.len() > MAX_HISTORY {
            self.history.pop_front();
        }
    }

    /// Ctrl+C or Escape while the lead itself works: the coming Stop is an interruption. Nothing is
    /// concluded while a child or background work is still going (STAT-028).
    pub fn cancel(&mut self) {
        self.mark_cancel(false);
    }

    /// `deny`: a Claude Deny's Esc interrupts the whole turn, so it is marked while children work too.
    fn mark_cancel(&mut self, deny: bool) {
        let busy: Vec<String> = self.children.iter().filter(|c| c.state == "working").map(|c| c.id.clone()).collect();
        if self.own == Some("working") && !self.background && (deny || busy.is_empty()) {
            self.cancelled = true;
            self.deny = deny;
            self.cancelled_at = now_ms();
            self.killed.clone_from(&self.tools);
            self.denied.clear();
        } else if self.own == Some("working") {
            // T-585: refused because children work; those not heard from again went with the turn.
            self.escaped = busy;
        }
    }

    /// Ctrl+C or Escape typed into the pane (terminal_write and the CLI's interrupt reach here).
    /// VIEW-025 b3: at a Claude hook permission prompt a typed Esc (or Ctrl+C, which the caller cannot
    /// tell apart) is the deny, answered like a card's; Codex keeps its prompt and its own hooks.
    pub fn typed_cancel(&mut self) {
        if self.agent == Some(Agent::Claude) && self.answerable() {
            self.answer(Agent::Claude, false);
        } else {
            self.cancel();
        }
    }

    /// T-123-c-b: what proves a turn went on after a cancel. Claude Code's hook reference says Stop
    /// does not run when the user interrupts and cancelling a running tool fires no Post* hook, so for
    /// Claude a Stop, or a tool step carrying any id, means the turn was not interrupted. Agents whose
    /// hook semantics are unverified (Codex) keep T-123-c's rule: only an id unseen at the cancel.
    fn goes_on(&self, agent: Agent, name: &str, event: &Value) -> bool {
        match agent {
            // T-123-c-c: an event marked as the interrupt itself never counts, and the Post* of a tool
            // running when the key landed counts only once the grace is over (or the cancel settled):
            // inside it, that report is the cancelled tool's own hook finishing, not the turn going on.
            _ if event.get("is_interrupt").and_then(Value::as_bool) == Some(true) => false,
            // VIEW-025 b4: the tool a Deny refused never counts, whenever its Post lands (the 2 s tick may not have run).
            Agent::Claude => name == "Stop" || (matches!(name, "PreToolUse" | "PostToolUse" | "PostToolUseFailure") && str_of(event, "tool_use_id").is_some_and(|id| name == "PreToolUse" || (!self.denied.iter().any(|d| d == id) && (self.past_grace() || !self.killed.iter().any(|k| k == id))))),
            Agent::Codex | Agent::Vendor => self.fresh_tool(name, event),
        }
    }

    /// A Claude sub-agent's sign of life: a SubagentStart, or a known child's PreToolUse that is not
    /// the denied tool. A child's Post* never counts (it may be the killed tool's own report).
    fn child_alive(&self, agent: Agent, name: &str, event: &Value) -> bool {
        agent == Agent::Claude
            && match (name, str_of(event, "agent_id")) {
                ("SubagentStart", _) => true,
                ("PreToolUse", Some(a)) => self.children.iter().any(|c| c.id == a) && str_of(event, "tool_use_id").is_none_or(|id| !self.denied.iter().any(|d| d == id)),
                _ => false,
            }
    }

    /// Drops the cancel (and its deny mark); says whether one stood.
    fn drop_cancel(&mut self) -> bool {
        self.deny = false;
        std::mem::take(&mut self.cancelled)
    }

    /// A child a deny settle set aside speaks again: it is back on the roster before its event is handled
    /// (never for the denied tool's own late report, which proves nothing).
    fn restore_parked(&mut self, event: &Value) {
        let Some(id) = str_of(event, "agent_id") else { return };
        let denied_tool = str_of(event, "tool_use_id").is_some_and(|t| self.denied.iter().any(|d| d == t));
        if denied_tool || self.children.iter().any(|c| c.id == id) {
            return;
        }
        let Some(i) = self.parked.iter().position(|(c, _)| c.id == id) else { return };
        if self.children.len() >= MAX_CHILDREN {
            // Same rule as SubagentStart: the oldest settled child makes room; a roster of live ones does not.
            let Some(j) = self.children.iter().position(|c| c.state != "working") else { return };
            self.children.remove(j);
        }
        self.children.push(self.parked.remove(i).0);
    }

    /// The interrupt was undone: the children set aside this turn are on the roster again (earlier turns' stay aside).
    fn restore_all_parked(&mut self) {
        let (now, earlier): (Vec<_>, Vec<_>) = std::mem::take(&mut self.parked).into_iter().partition(|p| p.1);
        self.parked = earlier;
        let room = MAX_CHILDREN.saturating_sub(self.children.len());
        self.children.extend(now.into_iter().take(room).map(|p| p.0));
    }

    /// T-123-c-c: the cancel has settled, or its grace is over.
    fn past_grace(&self) -> bool {
        self.interrupted || now_ms().saturating_sub(self.cancelled_at) >= CANCEL_GRACE_MS
    }

    /// T-123-c: a tool step carrying an id the lead had not started when the cancel came. The killed
    /// tool reporting late carries an id on the list; a step with no id at all proves nothing.
    fn fresh_tool(&self, name: &str, event: &Value) -> bool {
        matches!(name, "PreToolUse" | "PostToolUse" | "PostToolUseFailure") && str_of(event, "tool_use_id").is_some_and(|id| !self.killed.iter().any(|k| k == id))
    }

    /// STAT-032: a genuine signal from the agent: the unverified mark lifts and the window restarts.
    fn signal(&mut self) {
        self.seen = now_ms();
        self.unverified = false;
    }

    /// STAT-032: a working reading with no signal for the whole window is marked unverified, once
    /// per silent spell; a settled turn (done, blocked, ...) never is.
    fn settle_unverified(&mut self, now: u64) -> bool {
        if self.unverified || self.seen == 0 || self.resolved() != "working" || now.saturating_sub(self.seen) < unverified_ms() {
            return false;
        }
        self.unverified = true;
        true
    }

    /// TERM-122: a working reading keep-awake can believe at `now`: the agent was heard from at
    /// all, the reading is not marked unverified and has not gone the whole window silent.
    pub fn believed_working(&self, now: u64) -> bool {
        self.seen > 0 && !self.unverified && now.saturating_sub(self.seen) < unverified_ms() && self.resolved() == "working"
    }

    /// STAT-034: a state the program printed in band. Only the lead's own state moves: the reply,
    /// the stop, the roster and background work are hook knowledge and stay (an in-band done keeps
    /// monitoring going), while an in-band working is a new turn that undoes an interrupt.
    pub fn inband(&mut self, state: &'static str) -> Change {
        self.signal();
        let before = self.resolved();
        if state == "working" {
            self.drop_cancel();
            self.interrupted = false;
            self.tools.clear();
            self.killed.clear();
            self.denied.clear();
            self.parked.iter_mut().for_each(|p| p.1 = false);
            self.started.clear();
        }
        self.pending = None;
        self.own = Some(state);
        let after = self.resolved();
        if before != after {
            self.remember(after);
        }
        Change { state: after, ..Change::default() }
    }

    /// STAT-028: a cancel keystroke a while back and still no Stop: the turn was interrupted.
    fn settle_cancel(&mut self, now: u64) -> bool {
        if !self.cancelled || self.own != Some("working") || now.saturating_sub(self.cancelled_at) < CANCEL_GRACE_MS {
            return false;
        }
        let deny = self.deny;
        self.drop_cancel();
        self.interrupted = true;
        self.pending = None;
        self.own = Some("interrupted");
        // A Deny's Esc interrupts every child too, and the window knows no "interrupted" child state, so
        // the busy ones are set aside (parked), not forgotten: the interrupt may be undone (VIEW-025).
        if deny {
            let (busy, kept) = std::mem::take(&mut self.children).into_iter().partition(|c| matches!(c.state, "working" | "permission" | "waiting"));
            self.children = kept;
            self.parked.extend(busy.into_iter().map(|c| (c, true)));
            let over = self.parked.len().saturating_sub(MAX_CHILDREN);
            self.parked.drain(..over);
        }
        self.remember("interrupted");
        true
    }

    /// VIEW-025: the approval was answered from a card; the lead is working until its hooks say otherwise.
    pub fn answered(&mut self) {
        self.pending = None;
        if self.own == Some("permission") {
            self.own = Some("working");
            let now = self.resolved();
            self.remember(now);
        }
    }

    /// Council FIX-3 (chat e5412ff, FS2): answers from a card and says what the pane is after it:
    /// still "permission" while another sub-agent asks, so the window keeps holding its keys.
    /// Stand-in review of 1e9613e, FIX-BEFORE 1: the card answers the first sub-agent asking with a
    /// pending tool (the one a Change names), which is working again with nothing pending; with no
    /// such sub-agent it answers the lead.
    /// VIEW-025 b2: the card's answer. A Claude Deny types Esc, which real Claude takes as an interrupt
    /// and answers with no hook, so the deny is marked as a cancel and settles like STAT-028's.
    pub fn answer(&mut self, agent: Agent, approve: bool) -> &'static str {
        let asked = self.asked_ids();
        let state = self.answer_state();
        if agent == Agent::Claude && !approve {
            self.mark_cancel(true);
            if self.cancelled {
                self.denied = asked;
            }
        }
        state
    }

    /// The started ids of the asker `answer_state` answers (the first child asking, else the lead)
    /// whose name and input match its prompt; the PermissionRequest carries no tool_use_id.
    fn asked_ids(&self) -> Vec<String> {
        let (who, name, input) = match self.children.iter().find(|c| c.state == "permission" && c.pending.is_some()) {
            Some(c) => (Some(c.id.as_str()), c.pending.as_deref().unwrap_or_default(), c.pending_input),
            None if self.own == Some("permission") && self.pending.is_some() => (None, self.pending.as_deref().unwrap_or_default(), self.pending_input),
            None => return Vec::new(),
        };
        let mine = || self.started.iter().filter(|t| t.agent.as_deref() == who);
        let hits: Vec<String> = mine().filter(|t| t.name == name && t.input == input).map(|t| t.id.clone()).collect();
        // No match (the prompt names a tool never seen start): the asker's last started tool.
        if hits.is_empty() { mine().next_back().map(|t| t.id.clone()).into_iter().collect() } else { hits }
    }

    pub fn answer_state(&mut self) -> &'static str {
        let before = self.resolved();
        match self.children.iter_mut().find(|c| c.state == "permission" && c.pending.is_some()) {
            Some(c) => {
                c.state = "working";
                c.pending = None;
                let now = self.resolved();
                if now != before {
                    self.remember(now);
                }
            }
            None => self.answered(),
        }
        self.resolved()
    }
}

/// VIEW-025: the keys that answer an approval at the agent's own prompt. Claude Code's dialog
/// takes Enter for its first option (Yes) and Esc for No; Codex's approval modal takes y and n.
/// T-151-c: no other agent's keys are guessed; a vendor agent has none.
pub fn answer_keys(agent: Agent, approve: bool) -> Option<&'static str> {
    match (agent, approve) {
        (Agent::Claude, true) => Some("\r"),
        (Agent::Claude, false) => Some("\x1b"),
        (Agent::Codex, true) => Some("y"),
        (Agent::Codex, false) => Some("n"),
        (Agent::Vendor, _) => None,
    }
}

/// VIEW-025: approve or deny what `pane_key`'s agent is asking by typing the answer into its terminal.
#[tauri::command]
pub fn agent_answer(terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32, agent: String, approve: bool) -> Result<String, String> {
    let agent = match agent.as_str() {
        "claude" => Agent::Claude,
        "codex" => Agent::Codex,
        _ => return Err("not an agent pane".into()),
    };
    let (terminal, answerable) = with_sessions(|s| s.get(&pane_key).map(|x| (x.terminal, x.answerable()))).ok_or("no session for this pane")?;
    let terminal = terminal.ok_or("no session for this pane")?;
    // T-124-c: keys are typed only for a hook permission; an in-band one has nothing to answer.
    if !answerable {
        return Err("no hook permission to answer".into());
    }
    terminals.write(terminal, answer_keys(agent, approve).ok_or("not an agent pane")?)?;
    // Council FIX-3 (FS2): the window takes the resolved state, never a blanket "working".
    Ok(with_sessions(|s| s.get_mut(&pane_key).map(|x| x.answer(agent, approve))).unwrap_or("working").to_string())
}

/// STAT-025: Unicode line and paragraph separators become line breaks, and a run of blank lines
/// longer than two is cut to two.
fn clean_reply(s: &str) -> String {
    let s = s.replace(['\u{2028}', '\u{2029}'], "\n");
    let mut blank = 0;
    let lines: Vec<&str> = s
        .lines()
        .filter(|l| {
            blank = if l.trim().is_empty() { blank + 1 } else { 0 };
            blank <= 2
        })
        .collect();
    trim(lines.join("\n").trim(), 8000)
}

fn strip_agent(event: &Value) -> Value {
    let mut e = event.clone();
    if let Some(o) = e.as_object_mut() {
        o.remove("agent_id");
    }
    e
}

fn with_sessions<T>(f: impl FnOnce(&mut HashMap<u32, Session>) -> T) -> T {
    let mut guard = SESSIONS.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

/// SAFE-006: the most characters one status update carrying a plan may take.
pub const PLAN_STATUS_MAX: usize = 16_000;

/// SAFE-006: trims the plan to the longest prefix that keeps the whole update within
/// PLAN_STATUS_MAX characters and marks it cut; the one-line summary is never touched. When even an
/// empty plan would not fit, the plan is left out, so no review is offered.
pub fn fit_plan(mut s: Status) -> Status {
    let size = |s: &Status| serde_json::to_string(s).map_or(usize::MAX, |t| t.chars().count());
    if s.change.plan.is_none() || size(&s) <= PLAN_STATUS_MAX {
        return s;
    }
    let plan = s.change.plan.take().unwrap_or_default();
    let ends: Vec<usize> = plan.char_indices().map(|(i, _)| i).collect();
    s.change.plan_cut = true;
    let fits = |s: &mut Status, n: usize| {
        s.change.plan = Some(plan[..ends.get(n).copied().unwrap_or(plan.len())].to_string());
        size(s) <= PLAN_STATUS_MAX
    };
    if !fits(&mut s, 0) {
        s.change.plan = None;
        s.change.plan_cut = false;
        return s;
    }
    // The whole plan did not fit, so the longest fit is shorter than it; `lo` always fits.
    let (mut lo, mut hi) = (0, ends.len().saturating_sub(1));
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if fits(&mut s, mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    fits(&mut s, lo);
    s
}

/// Folds an event into the pane's session and builds what the window is told. T-563: a hook from
/// a terminal whose exit already took this pane's session is dropped before it touches anything.
/// hooks FIX-4: that check runs under the sessions lock, the same lock `terminal_ended` retires
/// under, so a hook racing its terminal's exit can never pass the check and then recreate the
/// session on the dead terminal. Lock order everywhere: SESSIONS, then RETIRED.
pub fn report(pane_key: u32, terminal: Option<u32>, agent: Agent, event: &Value) -> Option<Status> {
    with_sessions(|s| {
        if terminal.is_some_and(|t| retired(pane_key, t)) {
            return None;
        }
        let session = s.entry(pane_key).or_default();
        session.terminal = terminal.or(session.terminal);
        let path = str_of(event, "transcript_path").map(str::to_string);
        let applied = session.apply(agent, event);
        // CHAT-006: kept after `apply`, since a fresh session start clears the rest of the record.
        if path.is_some() {
            session.transcript = path;
        }
        let (change, child) = applied?;
        crate::activity::note_from(pane_key, session.terminal, change.state);
        Some(fit_plan(status_of(pane_key, terminal, session, change, child)))
    })
}

fn status_of(pane_key: u32, terminal: Option<u32>, session: &Session, change: Change, child: Option<String>) -> Status {
    Status { pane_key, terminal, change, children: session.children.clone(), stop: session.stop.clone(), reply: session.reply.clone(), child, interrupted: session.interrupted, monitoring: session.monitoring() }
}

/// STAT-028: the turns cancelled with Ctrl+C or Escape that never sent a Stop, now interrupted.
pub fn settle_cancels() -> Vec<Status> {
    let now = now_ms();
    with_sessions(|s| {
        s.iter_mut()
            .filter_map(|(key, session)| {
                session.settle_cancel(now).then(|| {
                    crate::activity::note_from(*key, session.terminal, "interrupted");
                    status_of(*key, session.terminal, session, Change { state: session.resolved(), ..Change::default() }, None)
                })
            })
            .collect()
    })
}

/// The transcript `pane_key`'s hooks last reported (CHAT-006).
pub fn transcript_of(pane_key: u32) -> Option<String> {
    with_sessions(|s| s.get(&pane_key).and_then(|x| x.transcript.clone()))
}

/// T-722: an open pane's hooks last reported `file` as their transcript, or a file inside `folder`
/// (the session's own folder, where a sub-agent's transcript lives), so an agent is still running
/// that session (a pane's sessions go when its terminal ends). Both sides are compared as the
/// filesystem resolves them, so case and `/` against `\` never hide a match; the paths are
/// resolved after the sessions lock is let go.
pub fn transcript_live(file: &std::path::Path, folder: Option<&std::path::Path>) -> bool {
    let Ok(want) = std::fs::canonicalize(file) else { return false };
    let under = folder.and_then(|f| std::fs::canonicalize(f).ok());
    let live: Vec<String> = with_sessions(|s| s.values().filter_map(|x| x.transcript.clone()).collect());
    live.iter().filter_map(|p| std::fs::canonicalize(p).ok()).any(|p| p == want || under.as_ref().is_some_and(|u| p.starts_with(u)))
}

/// The pane's agent is mid-turn as its hooks tell it (CHAT-006 keeps loading rather than erroring).
pub fn working(pane_key: u32) -> bool {
    with_sessions(|s| s.get(&pane_key).is_some_and(|x| x.own.is_some() && x.resolved() == "working"))
}

/// The panes whose hooks last reported for `terminal`.
pub fn panes_of(terminal: u32) -> Vec<u32> {
    with_sessions(|s| s.iter().filter(|(_, x)| x.terminal == Some(terminal)).map(|(k, _)| *k).collect())
}

/// TERM-122: how many panes read working now and can be believed (stale and never-heard sessions
/// do not count) and sit on a terminal `live` says is still running: a session with no terminal
/// (an in-band state from a hookless pane) or one whose terminal ended (a straggler hook) never
/// counts. Keep-awake's Agent mode holds while this is above zero. `live` is asked after the
/// sessions lock is let go, so it may take the terminals' own lock.
pub fn working_now(live: impl Fn(u32) -> bool) -> usize {
    let now = now_ms();
    let terminals: Vec<u32> = with_sessions(|s| s.values().filter(|x| x.believed_working(now)).filter_map(|x| x.terminal).collect());
    terminals.into_iter().filter(|t| live(*t)).count()
}

/// A terminal ended (its program exited or crashed, or its pane closed): the panes its hooks
/// reported for are forgotten, so a dead agent never reads working again (TERM-122). T-563: each
/// such pane retires the terminal, so a late hook from it is dropped by `report`. hooks FIX-4:
/// the sessions go and the terminal is retired under the one sessions lock (SESSIONS, then
/// RETIRED), so no hook can slip in between and take the pane back to the ended terminal.
/// hooks FIX-5: the terminal is also remembered as ended on its own, so a pane that had no
/// session yet (its first hook still in flight) drops that hook too.
pub fn terminal_ended(terminal: u32) {
    with_sessions(|s| {
        let gone: Vec<u32> = s.iter().filter(|(_, x)| x.terminal == Some(terminal)).map(|(k, _)| *k).collect();
        gone.iter().for_each(|k| drop(s.remove(k)));
        with_retired(|r| {
            for pane in gone {
                let list = r.by_pane.entry(pane).or_default();
                list.push_back(terminal);
                while list.len() > RETIRED_KEEP {
                    list.pop_front();
                }
            }
            r.ended.push_back(terminal);
            while r.ended.len() > ENDED_KEEP {
                r.ended.pop_front();
            }
        });
    });
}

/// STAT-032: the panes whose working reading just went the whole window without a signal, each
/// once per spell; the payload names the window in minutes.
// Called from the lib.rs 2 s tick (T-124 hunk, RE-APPLY ON MERGE); drop the allow once that lands.
pub fn settle_unverified() -> Vec<Quiet> {
    let now = now_ms();
    let minutes = unverified_ms() / 60_000;
    with_sessions(|s| s.iter_mut().filter_map(|(key, session)| session.settle_unverified(now).then_some(Quiet { pane_key: *key, minutes })).collect())
}

/// STAT-034: the state an OSC 9999 payload carries: the whole sequence (ESC ] 9999 ; json, then
/// BEL or ESC \) or just the text after "9999;" as a terminal parser hands it over. A malformed
/// payload or an unknown state gives None.
pub fn parse_inband(bytes: &[u8]) -> Option<&'static str> {
    let body = bytes.strip_prefix(b"\x1b]").unwrap_or(bytes);
    let body = body.strip_prefix(b"9999;").unwrap_or(body);
    let body = body.strip_suffix(b"\x07").or_else(|| body.strip_suffix(b"\x1b\\")).unwrap_or(body);
    let v: Value = serde_json::from_slice(body).ok()?;
    let state = v.get("state").or_else(|| v.get("status"))?.as_str()?;
    INBAND_STATES.into_iter().find(|s| *s == state)
}

/// STAT-034: a status a program printed in band; the window's terminal parser hands the payload
/// over (and never draws the sequence). True when the pane's status moved. T-563: `terminal` is
/// the pane's live terminal as the window knows it (absent from an older window); the activity lane
/// takes it, the session does not store it.
#[tauri::command]
pub fn status_inband(app: tauri::AppHandle, pane_key: u32, terminal: Option<u32>, data: String) -> bool {
    let Some(state) = parse_inband(data.as_bytes()) else {
        return false;
    };
    let (status, _) = inband_change(pane_key, terminal, state);
    // Row 16 (AUTO-012 / AUTO-004, T-085-e): an agent that reports only in band completes an
    // automation run in its pane and starts the agent-finished automations, as a hook does.
    crate::automations::follow(&app, |s| crate::automations::on_status(s, status.terminal, status.pane_key, status.change.state, status.change.boundary, status.child.is_some(), status.change.session.as_deref(), crate::automations::now_ms()));
    crate::automations::on_finish(&app, status.pane_key, status.terminal, status.change.state, status.change.boundary, status.child.is_some(), status.interrupted);
    tauri::Emitter::emit(&app, crate::hooks::EVENT, status).is_ok()
}

/// STAT-034 / T-563: folds an in-band state into the pane's session; the activity lane is noted
/// for `terminal`, else the session's own. Returns the status and the terminal that was noted.
fn inband_change(pane_key: u32, terminal: Option<u32>, state: &'static str) -> (Status, Option<u32>) {
    with_sessions(|s| {
        let session = s.entry(pane_key).or_default();
        let change = session.inband(state);
        let noted = terminal.or(session.terminal);
        crate::activity::note_from(pane_key, noted, change.state);
        (status_of(pane_key, session.terminal, session, change, None), noted)
    })
}

/// The terminal `pane_key`'s hooks last reported for.
pub fn terminal_of(pane_key: u32) -> Option<u32> {
    with_sessions(|s| s.get(&pane_key).and_then(|x| x.terminal))
}

/// CLI-025: the newest history entry's time and count across `terminal`'s panes, and whether one
/// is working; a prompt taken changes the first. None when no pane's hooks report for it.
pub fn activity(terminal: u32) -> Option<((u64, usize), bool)> {
    with_sessions(|s| {
        let panes: Vec<&Session> = s.values().filter(|x| x.terminal == Some(terminal)).collect();
        if panes.is_empty() {
            return None;
        }
        let newest = panes.iter().flat_map(|x| x.history.iter().map(|e| e.started)).max().unwrap_or(0);
        let count = panes.iter().map(|x| x.history.len()).sum();
        Some(((newest, count), panes.iter().any(|x| x.resolved() == "working")))
    })
}

/// CLI-025: the state `terminal` shows, the neediest of its panes' states; none when no pane's
/// hooks report for it.
pub fn state_of(terminal: u32) -> Option<&'static str> {
    const ORDER: [&str; 6] = ["permission", "waiting", "blocked", "interrupted", "working", "done"];
    with_sessions(|s| {
        s.values().filter(|x| x.terminal == Some(terminal)).map(Session::resolved).min_by_key(|r| ORDER.iter().position(|o| o == r).unwrap_or(ORDER.len()))
    })
}

/// The panes currently blocked on a usage limit (USAGE-007's pick-up when the switch goes on).
pub fn limit_stops() -> Vec<(u32, Stop)> {
    with_sessions(|s| s.iter().filter(|(_, x)| x.own == Some("blocked")).filter_map(|(k, x)| x.stop.clone().filter(|st| st.cause == "limit").map(|st| (*k, st))).collect())
}

/// A cancel keystroke typed into `terminal` (STAT-028).
pub fn cancel(terminal: u32) {
    with_sessions(|s| {
        for session in s.values_mut().filter(|x| x.terminal == Some(terminal)) {
            session.typed_cancel();
        }
    });
}

/// STAT-045: the panes whose working agent has been silent for `threshold`, each once per spell;
/// `silence(terminal)` is how long since that terminal last wrote. `None` (the alert is off)
/// re-arms every session and fires nothing.
pub fn quiet_check(threshold: Option<Duration>, silence: impl Fn(u32) -> Option<Duration>) -> Vec<u32> {
    with_sessions(|s| {
        let mut fired = Vec::new();
        for (key, session) in s.iter_mut() {
            let silent = threshold.is_some_and(|t| session.terminal.and_then(&silence).is_some_and(|d| d >= t));
            if session.quiet(silent) {
                fired.push(*key);
            }
        }
        fired
    })
}


/// The pane's last twenty states, oldest first (COMPAT 3.5 stored status: History).
#[tauri::command]
pub fn agent_history(pane_key: u32) -> Vec<Entry> {
    with_sessions(|s| s.get(&pane_key).map(|x| x.history.iter().cloned().collect()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }
    fn state(s: &mut Session, json: &str) -> Option<&'static str> {
        s.apply(Agent::Claude, &ev(json)).map(|(c, _)| c.state)
    }

    #[test]
    fn a_plan_too_long_for_one_status_is_cut_to_the_longest_fit_and_says_so() {
        // SAFE-006: the update carrying the plan stays within 16,000 characters; the summary stays.
        let status = |plan: &str, detail: &str, cut: bool| Status {
            pane_key: 1,
            terminal: Some(2),
            change: Change { state: "permission", tool: Some("ExitPlanMode".into()), detail: Some(detail.into()), plan: Some(plan.into()), plan_cut: cut, ..Change::default() },
            children: vec![],
            stop: None,
            reply: None,
            child: None,
            interrupted: false,
            monitoring: false,
        };
        let size = |s: &Status| serde_json::to_string(s).unwrap().chars().count();
        let long = "1. Read the é file. ".repeat(2000);
        assert_eq!(long.chars().count(), 40_000);
        let cut = fit_plan(status(&long, "Exit plan mode", false));
        let kept = cut.change.plan.clone().unwrap();
        assert!(cut.change.plan_cut && long.starts_with(&kept) && size(&cut) <= PLAN_STATUS_MAX);
        assert_eq!(cut.change.detail.as_deref(), Some("Exit plan mode"));
        assert!(serde_json::to_string(&cut).unwrap().contains(r#""planCut":true"#));
        let one_more: String = long.chars().take(kept.chars().count() + 1).collect();
        assert!(size(&status(&one_more, "Exit plan mode", true)) > PLAN_STATUS_MAX, "the longest fit");
        let short = fit_plan(status("# Plan", "Exit plan mode", false));
        assert_eq!((short.change.plan.as_deref(), short.change.plan_cut), (Some("# Plan"), false));
        assert!(!serde_json::to_string(&short).unwrap().contains("planCut"));
        let crowded = fit_plan(status("# Plan", &"x".repeat(PLAN_STATUS_MAX), false));
        assert_eq!((crowded.change.plan, crowded.change.plan_cut, crowded.change.detail.map(|d| d.len())), (None, false, Some(PLAN_STATUS_MAX)));
    }

    #[test]
    fn an_answer_from_a_card_clears_the_pending_permission_and_types_the_agents_own_keys() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write"}"#), Some("permission"));
        s.answered();
        assert_eq!(s.resolved(), "working");
        // Another tool carrying on is no longer refused as "a different tool than the pending one".
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), Some("working"));
        assert_eq!(s.history.back().map(|e| e.state), Some("working"));
        assert_eq!((answer_keys(Agent::Claude, true), answer_keys(Agent::Claude, false)), (Some("\r"), Some("\x1b")));
        assert_eq!((answer_keys(Agent::Codex, true), answer_keys(Agent::Codex, false)), (Some("y"), Some("n")));
        // T-151-c: a vendor agent's keys are never guessed.
        assert_eq!((answer_keys(Agent::Vendor, true), answer_keys(Agent::Vendor, false)), (None, None));
    }

    #[test]
    fn the_lead_stays_working_while_a_child_works_and_a_teammate_waiting_raises_needs_you() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"review"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"code-reviewer","model":"opus"}"#), Some("working"));
        assert_eq!((s.children[0].kind.as_str(), s.children[0].model.as_deref()), ("code-reviewer", Some("opus")));
        // The lead ends its turn: still working, the child is live.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"handed off"}"#), Some("working"));
        assert_eq!(s.reply.as_deref(), Some("handed off"));
        // The child asks for permission: needs you; unrelated progress by the lead does not clear it.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a1","tool_name":"Bash"}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Read"}"#), None);
        assert_eq!(s.resolved(), "permission");
        // The teammate goes idle: cleared, and the lead's done shows through... unless the lead is done: it is.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"TeammateIdle","teammate_name":"a1"}"#), Some("done"));
        assert_eq!(s.children[0].state, "idle");
        // A teammate going idle never ends a working lead, even with nothing stored for it.
        let mut fresh = Session::default();
        fresh.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"t1","agent_type":"tester"}"#));
        assert_eq!(state(&mut fresh, r#"{"hook_event_name":"TeammateIdle","teammate_name":"t1"}"#), Some("working"));
    }

    #[test]
    fn the_quiet_alert_fires_once_per_silent_spell_and_only_while_working() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        assert!(s.quiet(true), "the first check over the threshold fires");
        assert!(!s.quiet(true), "the same silent spell fires nothing more");
        assert!(!s.quiet(false), "fresh output restarts the clock");
        assert!(s.quiet(true), "a new spell fires again");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"done"}"#), Some("done"));
        assert!(!s.quiet(true), "a finished agent is never quiet");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"more"}"#), Some("working"));
        assert!(s.quiet(true), "leaving working cancelled the spell, so the next turn's silence counts anew");
    }

    #[test]
    fn a_child_stop_announces_its_own_reply_and_a_gone_child_never_returns() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"worker"}"#);
        state(&mut s, r#"{"hook_event_name":"Stop"}"#);
        let (c, child) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"a1","agent_type":"worker","last_assistant_message":"child done"}"#)).unwrap();
        assert_eq!((c.state, child.as_deref(), s.reply.as_deref()), ("done", Some("worker"), Some("child done")));
        assert!(s.children.is_empty());
        // Late events from the finished child change nothing and do not re-add it.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Bash"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"a1"}"#), None);
        assert!(s.children.is_empty());
        // The roster is capped at 32 live children.
        for i in 0..40 {
            state(&mut s, &format!(r#"{{"hook_event_name":"SubagentStart","agent_id":"c{i}","agent_type":"w"}}"#));
        }
        assert_eq!(s.children.len(), MAX_CHILDREN);
    }

    #[test]
    fn a_failure_stops_the_session_with_its_cause_until_a_later_turn_finishes() {
        // STAT-022: the cause stays attached while blocked, a second report in the episode changes
        // nothing, and a turn that reaches done drops it.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"5-hour limit"}"#), Some("blocked"));
        assert_eq!(s.stop, Some(Stop { cause: "limit", detail: Some("5-hour limit".into()), resets_at: None }));
        // T-039-b: the reset time the status line last reported rides on a limit stop, when it is
        // still ahead; a stop for another cause never carries it.
        let ahead = crate::claude_key::now_ms() + 3_600_000;
        LIMIT_RESETS_AT.store(ahead, std::sync::atomic::Ordering::Relaxed);
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), Some(ahead as u64));
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"server_error"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), None);
        LIMIT_RESETS_AT.store(ahead - 7_200_000, std::sync::atomic::Ordering::Relaxed);
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), None, "a reset already past is no reset");
        LIMIT_RESETS_AT.store(0, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#), Some("blocked"));
        assert_eq!(s.stop.as_ref().map(|t| t.detail.as_deref()), Some(Some("5-hour limit")), "the first report's words stay");
        assert_eq!(s.history.iter().filter(|e| e.state == "blocked").count(), 1, "one episode, one history line");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#), Some("working"));
        assert!(s.stop.is_some(), "still attached until the turn finishes");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        assert_eq!(s.stop, None);
        // A failure report without an error attached, and one after a Kolux cancel, never stop the session.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"more"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure"}"#), None);
        assert_eq!(s.resolved(), "working");
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"server_error"}"#), Some("interrupted"));
        assert_eq!(s.stop, None);
        // A sign-in failure reads as such, and a session boundary forgets the stop.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"x"}"#);
        state(&mut s, r#"{"hook_event_name":"StopFailure","error":"authentication_failed"}"#);
        assert_eq!(s.stop.as_ref().map(|t| t.cause), Some("signin"));
        state(&mut s, r#"{"hook_event_name":"SessionStart","source":"startup"}"#);
        assert_eq!(s.stop, None);
    }

    #[test]
    fn stop_after_a_kolux_cancel_reads_interrupted_and_late_events_cannot_revive_it() {
        // T-123-c-b: the old rule, kept for agents whose hook semantics are unverified (Codex); for
        // Claude a Stop after a cancel is done (stat_028_rest_b_*).
        let state = |s: &mut Session, j: &str| s.apply(Agent::Codex, &ev(j)).map(|(c, _)| c.state);
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long job"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("interrupted"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        // A new prompt starts a clean turn that ends done.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        // No cancel is concluded while a child is still working.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"team"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"k","agent_type":"w"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"k"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("interrupted", true), ("working", false), ("done", false), ("working", false), ("done", false)]);
        assert_eq!(s.history[0].prompt.as_deref(), Some("long job"));
    }

    #[test]
    fn a_plan_approved_in_the_terminal_ends_the_wait_when_its_tool_finishes() {
        // SAFE-007: Claude's PostToolUse names its tool, so the plan's own wait ends there.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan it"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{"plan":"1. a"}}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"1. a"}}"#), Some("working"));
    }

    #[test]
    fn a_permission_clears_only_when_the_same_tool_resumes_and_background_work_keeps_working() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"edit"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write"}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Write"}"#), Some("working"));
        // Background shells outlive the turn: working until a Stop with none in flight.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running","description":"npm test"}]}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[]}"#), Some("done"));
        // The prompt Claude re-submits after an automatic compact is not a new turn.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostCompact","trigger":"auto"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"This session is being continued from a previous conversation that ran out of context."}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"real"}"#), Some("working"));
        assert_eq!(s.history.len(), 5);
        for _ in 0..30 {
            state(&mut s, r#"{"hook_event_name":"Stop"}"#);
            state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"x"}"#);
        }
        assert_eq!(s.history.len(), MAX_HISTORY);
    }

    #[test]
    fn codex_children_follow_their_own_tool_events() {
        let mut s = Session::default();
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SessionStart"}"#));
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"x","agent_type":"explorer","model":"gpt-5"}"#));
        let c = |s: &mut Session, j: &str| s.apply(Agent::Codex, &ev(j)).map(|(c, _)| c.state);
        assert_eq!(c(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("working"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"x","tool_name":"request_user_input"}"#), Some("waiting"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"PostToolUse","agent_id":"x","tool_name":"request_user_input"}"#), Some("working"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"x"}"#), Some("done"));
        // A boundary wipes the roster.
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"y","agent_type":"w"}"#));
        c(&mut s, r#"{"hook_event_name":"SessionStart"}"#);
        assert!(s.children.is_empty());
    }

    #[test]
    fn stat_024_background_work_after_the_turn_is_monitoring_until_its_list_empties() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"run the soak test"}"#);
        assert!(!s.monitoring(), "a turn still going is working, not monitoring");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running","command":"npm run soak"}]}"#), Some("working"));
        assert!(s.monitoring(), "the turn settled while the shell runs on");
        // A scheduled session task keeps it watched too.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[],"session_crons":[{"id":"c1","schedule":"0 9 * * 1-5","recurring":true,"prompt":"check"}]}"#), Some("working"));
        assert!(s.monitoring());
        // Work woken by the background task is a turn of its own, not monitoring.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat soak.log"}}"#), Some("working"));
        assert!(!s.monitoring());
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[],"session_crons":[]}"#), Some("done"));
        assert!(!s.monitoring());
        // No cancel is concluded while background work runs (STAT-028).
        state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b2","type":"shell","status":"running"}]}"#);
        s.cancel();
        assert!(!s.settle_cancel(now_ms() + CANCEL_GRACE_MS));
    }

    #[test]
    fn stat_025_the_reply_keeps_line_breaks_and_shortens_blank_runs_and_list_tools_show_no_input() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix it"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/main.rs","old_string":"a","new_string":"b"}}"#)).unwrap();
        assert_eq!((c.tool.as_deref(), c.detail.as_deref()), (Some("Edit"), Some("src/main.rs")));
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"secret plan step"}]}}"#)).unwrap();
        assert_eq!((c.tool.as_deref(), c.detail), (Some("TodoWrite"), None));
        let reply = format!("Fixed.\u{2028}Tests pass.\u{2029}Next{}end", "\n".repeat(11));
        let stop = serde_json::json!({"hook_event_name":"Stop","last_assistant_message":reply});
        s.apply(Agent::Claude, &stop);
        assert_eq!(s.reply.as_deref(), Some("Fixed.\nTests pass.\nNext\n\n\nend"));
    }

    #[test]
    fn stat_027_waiting_carries_the_plan_or_the_question_and_clears_when_tool_work_resumes() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan the refactor"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"Refactor auth\n1. Extract the token check"}}"#)).unwrap();
        // The plan rides on `plan` alone (SAFE-001; fit_plan sizes the whole update): `ask` is the question's field (T-123-d).
        assert_eq!((c.state, c.ask.as_deref(), c.plan.as_deref(), c.detail.as_deref()), ("waiting", None, Some("Refactor auth\n1. Extract the token check"), Some("Refactor auth")));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"auth.rs"}}"#), Some("working"));
        // A question asked as a permission waits with every question (one per line; the card's line is the first), and clears on any later tool step.
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which framework?","header":"Framework","options":[]},{"question":"Which database?","header":"Data","options":[]},{"question":"Deploy where?","header":"Deploy","options":[]}]}}"#)).unwrap();
        assert_eq!((c.state, c.ask.as_deref(), c.detail.as_deref(), c.plan.as_deref()), ("waiting", Some("Which framework?\nWhich database?\nDeploy where?"), Some("Which framework?"), None));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), Some("working"));
        // A real permission still waits for its own tool.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        // A question past the limit is cut and says so; a long plan never rides on `ask` (its cut is fit_plan's, SAFE-006).
        let long = serde_json::json!({"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"x".repeat(9000)}]}});
        let ask = crate::hooks::claude_change(&long).unwrap().ask.unwrap();
        assert!(ask.ends_with("… (cut)") && ask.chars().count() == 8000 + "\n… (cut)".chars().count());
        let long_plan = serde_json::json!({"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"x".repeat(9000)}});
        let c = crate::hooks::claude_change(&long_plan).unwrap();
        assert_eq!((c.ask, c.plan.map(|p| p.chars().count())), (None, Some(9000)));
    }

    #[test]
    fn stat_028_a_cancel_with_no_stop_settles_interrupted_and_late_events_cannot_revive_it() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long job"}"#);
        s.cancel();
        assert!(!s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS - 1), "the Stop gets its moment first");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        assert!(!s.settle_cancel(u64::MAX), "settled once");
        // A step with no id proves nothing (a Claude Stop here is T-123-c-b's done, stat_028_rest_b_*).
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(s.history.back().map(|e| (e.state, e.interrupted)), Some(("interrupted", true)));
    }

    #[test]
    fn stat_028_rest_a_tool_step_after_a_draft_clearing_cancel_keeps_the_turn_working() {
        // T-123-c-b: this is the rule for agents with unverified hook semantics (Codex).
        let state = |s: &mut Session, j: &str| s.apply(Agent::Codex, &ev(j)).map(|(c, _)| c.state);
        // T-123-c: Ctrl+C on a non-empty input box only clears the draft (Esc also closes menus), so the
        // turn goes on. A tool step the lead never reported before the cancel proves it inside the grace.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        // (c) the tool that started before the cancel reporting back says nothing about the turn.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), Some("working"));
        assert!(s.cancelled, "the killed tool's own report cannot clear the cancel");
        // (a) a new tool step inside the grace clears the cancel; nothing settles and the Stop is a plain done.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert!(!s.cancelled);
        assert!(!s.settle_cancel(u64::MAX), "nothing left to settle");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        assert!(!s.interrupted);
    }

    #[test]
    fn stat_028_rest_a_settled_interrupt_is_undone_by_a_tool_step_it_never_saw_before_the_cancel() {
        // T-123-c-b: this is the rule for agents with unverified hook semantics (Codex).
        let state = |s: &mut Session, j: &str| s.apply(Agent::Codex, &ev(j)).map(|(c, _)| c.state);
        // T-123-c: prompt, Ctrl+C on a draft, a Bash step longer than the grace: the settle reads
        // interrupted, then the PreToolUse at +5 s revives the turn and its Stop reads done.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + 5_000));
        assert_eq!(s.resolved(), "interrupted");
        // (c) the pre-cancel tool reporting late stays ignored, settled or not.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu1","error":"killed"}"#), None);
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        // A step with no id at all is not proof of a new tool (the late-event rule keeps it out).
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), None);
        // (b) a tool id never seen before the cancel revives the turn to working; the misread line is dropped.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted, s.cancelled), ("working", false, false));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#), Some("done"));
        assert_eq!(s.reply.as_deref(), Some("built"));
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("done", false)], "one turn, never interrupted");
        // A second cancel in the same turn takes every tool seen so far as in flight: a later Post for tu2 proves nothing.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu3"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu3"}"#), Some("working"));
        assert!(s.cancelled);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("interrupted"), "for Codex a Stop while the cancel stands is still an interruption");
    }

    #[test]
    fn stat_028_rest_b_for_claude_a_stop_while_the_cancel_stands_is_done() {
        // T-123-c-b: Claude Code runs no Stop when the user interrupts, so a Stop inside the grace
        // means the cancel only cleared a draft or closed a menu: the turn is done, with its reply.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu3"}"#);
        s.cancel();
        assert!(s.cancelled);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"all set"}"#), Some("done"), "for Claude a Stop while the cancel stands is done");
        assert_eq!((s.interrupted, s.cancelled, s.reply.as_deref()), (false, false, Some("all set")));
        assert!(!s.settle_cancel(u64::MAX), "nothing left to settle");
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("done", false)]);
    }

    #[test]
    fn stat_028_rest_b_for_claude_the_pre_cancel_tools_post_and_a_late_stop_undo_a_settled_interrupt() {
        // T-123-c-b: Ctrl+C on a draft while the turn's last tool runs past the grace, then a reply with
        // no new tool. A cancelled tool fires no Post* in Claude Code, so PostToolUse(tu1) proves the
        // turn went on, and the Stop that follows reads done with the reply.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + 5_000));
        assert_eq!(s.resolved(), "interrupted");
        // A step with no id still proves nothing.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted, s.cancelled), ("working", false, false));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#), Some("done"));
        assert_eq!(s.reply.as_deref(), Some("built"));
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("done", false)], "one turn, never interrupted");
        // Settled with no tool event at all: the Stop alone undoes the interrupt.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"think"}"#);
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + 5_000));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"thought"}"#), Some("done"));
        assert_eq!((s.interrupted, s.reply.as_deref()), (false, Some("thought")));
        // T-123-c-c: inside the grace the pre-cancel tool's Post is that tool's own hook finishing as
        // the key landed: the cancel stands and settles to interrupted.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"race"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu9"}"#);
        s.cancel();
        state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu9","error":"exit 1"}"#);
        assert!(s.cancelled, "the killed tool's Post inside the grace leaves the cancel standing");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "interrupted");
    }

    #[test]
    fn t123cc_escape_during_a_post_tool_hook_settles_interrupted_and_an_interrupt_event_never_revives() {
        // The race: Escape lands while the tool's PostToolUse hook runs. Its report arrives inside the
        // grace and must not keep the card working until the 30-minute unverified mark.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"run tests"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu5"}"#);
        s.cancel();
        state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu5"}"#);
        assert!(s.cancelled, "inside the grace the killed tool's Post proves nothing");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(s.history.back().map(|e| (e.state, e.interrupted)), Some(("interrupted", true)));
        // An event flagged as the interrupt itself never revives the turn, whatever its id.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu6","is_interrupt":true,"error":"interrupted"}"#), None);
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        // Once the cancel has settled, the killed tool's Post does count, as T-123-c-b rules.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu5"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted), ("working", false));
        // A tool unseen at the cancel, inside the grace, still proves the turn went on.
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu7"}"#);
        s.cancel();
        state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read","tool_use_id":"tu8"}"#);
        assert!(!s.cancelled, "a fresh id clears the cancel");
        // An interrupt-flagged event inside the grace leaves the cancel standing too.
        s.cancel();
        state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu99","is_interrupt":true}"#);
        assert!(s.cancelled);
    }

    #[test]
    fn t124c_an_in_band_permission_has_nothing_to_answer_and_a_hook_one_names_its_tool() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        assert_eq!(s.inband("permission").state, "permission");
        assert!(!s.answerable(), "an OSC 9999 permission names no tool to answer");
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"cargo build"}}"#)).unwrap();
        assert_eq!((c.state, c.tool.as_deref()), ("permission", Some("Bash")));
        assert!(s.answerable());
        s.answered();
        assert!(!s.answerable());
        // A child's hook permission carries its tool on the lead's change, so the card can answer it.
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"k","agent_type":"w"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","agent_id":"k","tool_name":"Write","tool_input":{"file_path":"a.txt"}}"#)).unwrap();
        assert_eq!((c.state, c.tool.as_deref()), ("permission", Some("Write")));
        assert!(s.answerable());
    }

    #[test]
    fn stat_032_a_working_reading_with_no_signal_for_the_window_is_unverified_until_the_next_one() {
        let mut s = Session::default();
        assert!(!s.settle_unverified(u64::MAX), "nothing reported yet is nothing to doubt");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        let seen = s.seen;
        assert!(!s.settle_unverified(seen + UNVERIFIED_MS - 1), "inside the window the reading holds");
        assert!(s.settle_unverified(seen + UNVERIFIED_MS), "30 minutes of silence marks it");
        assert!(!s.settle_unverified(seen + 2 * UNVERIFIED_MS), "once per silent spell");
        // The next genuine signal brings the row back to life and restarts the window.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#), Some("working"));
        assert!(!s.unverified);
        assert!(!s.settle_unverified(s.seen + UNVERIFIED_MS - 1));
        assert!(s.settle_unverified(s.seen + UNVERIFIED_MS));
        // A settled turn is never doubted, however long it sits.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"ok"}"#), Some("done"));
        assert!(!s.settle_unverified(s.seen + 10 * UNVERIFIED_MS));
        assert_eq!(UNVERIFIED_MS, 30 * 60 * 1000);
    }

    /// TERM-122: keep-awake believes only a working reading the agent stands behind: heard from
    /// at all, not marked unverified and not silent for the whole unverified window.
    #[test]
    fn term122_only_a_believable_working_reading_keeps_the_computer_awake() {
        let mut s = Session::default();
        assert_eq!(s.resolved(), "working", "a session nothing reported into still reads working");
        assert!(!s.believed_working(now_ms()), "but nothing was ever heard, so it does not count");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        let seen = s.seen;
        assert!(s.believed_working(seen) && s.believed_working(seen + UNVERIFIED_MS - 1));
        assert!(!s.believed_working(seen + UNVERIFIED_MS), "silent for the whole window is stale");
        assert!(s.settle_unverified(seen + UNVERIFIED_MS));
        assert!(!s.believed_working(seen), "marked unverified is stale whatever the clock says");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#), Some("working"));
        assert!(s.believed_working(s.seen), "the next signal makes it count again");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"ok"}"#), Some("done"));
        assert!(!s.believed_working(s.seen));
    }

    /// TERM-122: only a session tied to a live terminal keeps the computer awake. A hook report that
    /// carries no terminal id and a session on a terminal that is no longer running (its exit not
    /// yet handled, so not yet retired) both read working, but neither holds the computer awake.
    /// (This drives the hook path, report(); the in-band path, status_inband, leaves the terminal
    /// None unless a hook named one, and is not run here. hooks FIX-5: a straggler hook from a
    /// terminal already handled as ended makes no session at all; see
    /// fix_5_a_panes_first_hook_handled_after_its_terminals_exit_is_dropped.)
    #[test]
    fn term122_a_session_without_a_live_terminal_never_keeps_the_computer_awake() {
        const NO_TERM: u32 = 922_301;
        const STRAY: u32 = 922_302;
        const LIVE: u32 = 922_303;
        const DEAD_T: u32 = 922_401;
        const LIVE_T: u32 = 922_402;
        // Only this test's live terminal is running; other tests' sessions sit on other ids.
        let live = |t: u32| t == LIVE_T;
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        report(NO_TERM, None, Agent::Claude, &go);
        report(STRAY, Some(DEAD_T), Agent::Claude, &go);
        assert_eq!(state_of(DEAD_T), Some("working"), "the session on the terminal that stopped running does read working");
        assert_eq!(working_now(live), 0, "but no session without a live terminal counts");
        assert_eq!(working_now(|t| t == DEAD_T), 1, "the same reading on a running terminal would count");
        report(LIVE, Some(LIVE_T), Agent::Claude, &go);
        assert_eq!(working_now(live), 1, "a live terminal's working pane counts");
        for t in [DEAD_T, LIVE_T] {
            terminal_ended(t);
        }
        with_sessions(|s| s.remove(&NO_TERM));
    }

    /// TERM-122: a terminal that ended (its program exited or crashed, or its pane was closed) takes
    /// its panes' sessions with it, so a dead agent never reads working again.
    #[test]
    fn term122_an_ended_terminal_forgets_its_panes_so_a_dead_agent_stops_counting() {
        const PANE: u32 = 922_101;
        const OTHER: u32 = 922_102;
        const TERM: u32 = 922_201;
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        report(PANE, Some(TERM), Agent::Claude, &go);
        report(OTHER, Some(TERM + 1), Agent::Claude, &go);
        assert_eq!(state_of(TERM), Some("working"));
        assert_eq!(working_now(|t| t == TERM || t == TERM + 1), 2, "both live panes count");
        terminal_ended(TERM);
        assert_eq!(state_of(TERM), None, "the ended terminal's pane is gone");
        assert!(panes_of(TERM).is_empty() && agent_history(PANE).is_empty());
        assert_eq!(state_of(TERM + 1), Some("working"), "another terminal's pane stays");
        terminal_ended(TERM + 1);
        assert_eq!(state_of(TERM + 1), None);
    }

    /// T-563: after a Restart, a Stop still in flight from the old terminal lands once the new one
    /// reports. It is dropped before it touches the session, so the session stays on the new
    /// terminal and that terminal's exit ends it (and, through panes_of, the activity lane).
    #[test]
    fn t563_a_late_hook_from_a_retired_terminal_never_takes_the_pane_back() {
        let _serial = ENDED_TESTS.lock().unwrap_or_else(|p| p.into_inner());
        const PANE: u32 = 956_301;
        const OLD: u32 = 956_303;
        const NEW: u32 = 956_304;
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        let stop = ev(r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#);
        assert!(report(PANE, Some(OLD), Agent::Claude, &go).is_some());
        terminal_ended(OLD);
        assert_eq!(terminal_of(PANE), None, "the old terminal's exit took the session");
        assert!(report(PANE, Some(NEW), Agent::Claude, &go).is_some(), "Restart: the new terminal reports");
        assert!(report(PANE, Some(OLD), Agent::Claude, &stop).is_none(), "the old terminal's late Stop is dropped");
        assert_eq!(terminal_of(PANE), Some(NEW), "and never points the session back at the old terminal");
        assert_eq!(panes_of(NEW), vec![PANE], "so the new terminal's exit finds the pane (activity ends its lane)");
        assert!(working(PANE), "the new turn is still working");
        terminal_ended(NEW);
        assert_eq!(terminal_of(PANE), None, "the new terminal's exit ends the session");
        // Retired for this pane only: another pane on another terminal is untouched, and a hook
        // with no terminal is not a straggler.
        assert!(report(PANE + 1, Some(NEW + 10), Agent::Claude, &go).is_some());
        terminal_ended(NEW + 10);
        assert!(report(PANE + 1, Some(NEW + 10), Agent::Claude, &stop).is_none(), "retired for the pane it ended");
        assert!(report(PANE, None, Agent::Claude, &go).is_some(), "no terminal given: not dropped");
        assert!(report(PANE, Some(NEW), Agent::Claude, &stop).is_none(), "the new terminal is retired too now");
        // hooks FIX-5: an ended terminal is ended for every pane; no hook from it counts anywhere.
        assert!(report(PANE, Some(NEW + 10), Agent::Claude, &stop).is_none(), "another pane's ended terminal is ended here too");
        with_sessions(|s| s.remove(&PANE));
    }

    /// hooks FIX-5 (stand-in review AFTER 3): an agent crashes right after its first hook, and that
    /// hook is handled after the exit. The pane had no session to retire from, so the terminal's
    /// end is remembered on its own and the hook is dropped instead of making a session on the
    /// dead terminal. No session is seeded here.
    #[test]
    fn fix_5_a_panes_first_hook_handled_after_its_terminals_exit_is_dropped() {
        let _serial = ENDED_TESTS.lock().unwrap_or_else(|p| p.into_inner());
        const PANE: u32 = 958_101;
        const DEAD: u32 = 958_103;
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        assert_eq!(terminal_of(PANE), None, "no session before");
        terminal_ended(DEAD);
        // hooks FIX-6: HOOKS_TEST_GAP_MS widens the window between the end and the hook, so a run
        // without ENDED_TESTS shows the race test's burst evicting DEAD from the ring:
        // `HOOKS_TEST_GAP_MS=1000 cargo test status::tests::fix_ -- --test-threads=2`.
        if let Some(ms) = std::env::var("HOOKS_TEST_GAP_MS").ok().and_then(|v| v.parse().ok()) {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
        assert!(report(PANE, Some(DEAD), Agent::Claude, &go).is_none(), "the first hook of a terminal that already ended is dropped");
        assert!(with_sessions(|s| !s.contains_key(&PANE)), "and makes no session");
        assert!(report(PANE, Some(DEAD + 1), Agent::Claude, &go).is_some(), "the pane's next terminal reports as usual");
        assert_eq!(terminal_of(PANE), Some(DEAD + 1));
        with_sessions(|s| s.remove(&PANE));
        with_retired(|r| r.ended.retain(|t| *t != DEAD));
    }

    /// hooks FIX-4 (stand-in review FIX-SOON 2): the agent's last hook and its exit handled on two
    /// threads at the same moment. Whichever runs first, no session is left on the ended terminal:
    /// the retired check and the retiring happen under the one sessions lock.
    #[test]
    fn fix_4_a_hook_racing_its_terminals_exit_never_keeps_the_dead_terminal() {
        let _serial = ENDED_TESTS.lock().unwrap_or_else(|p| p.into_inner());
        use std::sync::{Arc, Barrier};
        const BASE: u32 = 957_100_000;
        // Before the fix about half the rounds kept the dead terminal (10008 of 20000 in the red
        // run), so this many rounds meets the race hundreds of times in a few seconds.
        const ROUNDS: u32 = 2_000;
        let go = ev(r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#);
        for i in 0..ROUNDS {
            assert!(report(BASE + i, Some(BASE + ROUNDS + i), Agent::Claude, &go).is_some());
        }
        let gate = Arc::new(Barrier::new(2));
        let (g, e) = (gate.clone(), go.clone());
        let hooks = std::thread::spawn(move || {
            for i in 0..ROUNDS {
                g.wait();
                report(BASE + i, Some(BASE + ROUNDS + i), Agent::Claude, &e);
            }
        });
        for i in 0..ROUNDS {
            gate.wait();
            terminal_ended(BASE + ROUNDS + i);
        }
        hooks.join().unwrap();
        let stuck: Vec<u32> = with_sessions(|s| {
            let stuck = (0..ROUNDS).filter(|i| s.get(&(BASE + i)).is_some_and(|x| x.terminal.is_some())).collect();
            (0..ROUNDS).for_each(|i| drop(s.remove(&(BASE + i))));
            stuck
        });
        // hooks FIX-5 (stand-in review AFTER 5): the retirements this test made go too.
        with_retired(|r| {
            (0..ROUNDS).for_each(|i| drop(r.by_pane.remove(&(BASE + i))));
            r.ended.retain(|t| !(BASE + ROUNDS..BASE + 2 * ROUNDS).contains(t));
        });
        assert!(stuck.is_empty(), "{} of {ROUNDS} panes kept a session on their ended terminal", stuck.len());
    }

    /// T-563: an in-band status names the pane's live terminal for the activity lane without
    /// storing it, so a hookless program on a pane key that had an agent before still gets its lane.
    #[test]
    fn t563_an_in_band_status_notes_the_given_terminal_without_storing_it() {
        const PANE: u32 = 956_401;
        let (status, noted) = inband_change(PANE, Some(956_402), "working");
        assert_eq!((status.change.state, noted), ("working", Some(956_402)));
        assert_eq!(terminal_of(PANE), None, "the terminal is not stored on the session");
        let go = ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        report(PANE, Some(956_403), Agent::Claude, &go);
        assert_eq!(inband_change(PANE, None, "idle").1, Some(956_403), "none given: the session's own terminal");
        assert_eq!(inband_change(PANE, Some(956_404), "working").1, Some(956_404), "given: it wins");
        assert_eq!(terminal_of(PANE), Some(956_403), "and the session keeps the one its hooks named");
        with_sessions(|s| s.remove(&PANE));
    }

    /// Row 16 (T-085-e): an in-band working then done is an agent finish the automations hear;
    /// a done with no working before it, or a second done, is not.
    #[test]
    fn row_16_an_in_band_finish_reaches_the_agent_finished_automations() {
        const PANE: u32 = 956_501;
        let mut seen = std::collections::HashMap::new();
        let mut fires = |state: &'static str| {
            let (st, _) = inband_change(PANE, Some(956_502), state);
            crate::automations::agent_finished(&mut seen, st.pane_key, st.change.state, st.change.boundary, st.child.is_some(), st.interrupted)
        };
        assert!(!fires("done"), "no turn yet");
        assert!(!fires("working"));
        assert!(fires("done"), "working then done fires once");
        assert!(!fires("done"), "and not again");
        with_sessions(|s| s.remove(&PANE));
    }

    #[test]
    fn stat_034_an_in_band_status_moves_the_pane_without_erasing_what_only_hooks_know() {
        // The byte sequence a script prints: ESC ] 9999 ; payload BEL, or ESC \ as the terminator.
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"working\"}\x07"), Some("working"));
        assert_eq!(parse_inband(b"\x1b]9999;{\"status\":\"done\"}\x1b\\"), Some("done"));
        // What xterm's OSC handler hands over is the text after "9999;".
        assert_eq!(parse_inband(b"{\"state\":\"permission\"}"), Some("permission"));
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"working\"\x07"), None, "malformed payload");
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"exploding\"}\x07"), None, "unknown state");
        assert_eq!(parse_inband(b"\x1b]9999;plain text\x07"), None);

        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built","background_tasks":[{"id":"b1","type":"shell","status":"running","description":"npm test"}]}"#), Some("working"));
        assert!(s.monitoring());
        // An in-band done keeps the monitoring, the reply and the stored roster.
        assert_eq!(s.inband("done").state, "working");
        assert!(s.monitoring(), "monitoring is hook knowledge; the in-band done does not end it");
        assert_eq!(s.reply.as_deref(), Some("built"));
        // An in-band working is a new turn: it undoes an interrupt and reads working.
        s.own = Some("working");
        s.background = false;
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(s.inband("working").state, "working");
        assert!(!s.interrupted);
        assert_eq!(s.history.back().map(|e| e.state), Some("working"));
        // A state change is remembered once; the same state again is not.
        let len = s.history.len();
        assert_eq!(s.inband("working").state, "working");
        assert_eq!(s.history.len(), len);
        assert_eq!(s.inband("waiting").state, "waiting");
        assert_eq!(s.history.len(), len + 1);
    }

    #[test]
    fn stat_029_boundaries_settle_quietly_and_the_compact_summary_labels_the_turn() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"build it"}"#);
        state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#);
        // /clear is a boundary: done, and the finished turn stays in history.
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SessionStart","source":"clear"}"#)).unwrap();
        assert!(c.boundary && c.state == "done");
        assert!(s.history.iter().any(|e| e.state == "done" && e.prompt.as_deref() == Some("build it")));
        // A manual compact settles a row stuck on working into a quiet done, labelled by its summary.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"stuck"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PostCompact","trigger":"manual","compact_summary":"Refactored the auth\n module."}"#)).unwrap();
        assert!(c.boundary && c.state == "done");
        assert_eq!(s.history.back().and_then(|e| e.prompt.as_deref()), Some("Refactored the auth module."));
        // The continuation Claude submits after compacting is not a turn; a prompt quoting it later is.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"real prompt"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"  This session is being continued from a previous conversation that ran out of context."}"#), None);
        assert_eq!(s.prompt.as_deref(), Some("real prompt"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"why does it say This session is being continued from a previous conversation?"}"#), Some("working"));
        // Codex has no such message: the same words from Codex are a prompt.
        let mut x = Session::default();
        let codex = x.apply(Agent::Codex, &ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"This session is being continued from a previous conversation"}"#));
        assert_eq!(codex.map(|(c, _)| c.state), Some("working"));
    }

    #[test]
    fn fix3_a_sub_agents_tool_start_names_its_tool_and_its_end_names_none() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"k","agent_type":"w"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","agent_id":"k","tool_name":"Bash"}"#)).unwrap();
        assert_eq!((c.state, c.tool.as_deref()), ("working", Some("Bash")));
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PostToolUse","agent_id":"k","tool_name":"Bash"}"#)).unwrap();
        assert_eq!((c.state, c.tool.as_deref()), ("working", None));
    }

    #[test]
    fn fix3_a_card_answer_reports_permission_while_a_second_sub_agent_still_asks() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"b","tool_name":"Write"}"#), Some("permission"));
        assert_eq!(s.answer_state(), "permission");
        // The lead's own menu, answered, leaves it working.
        let mut lead = Session::default();
        state(&mut lead, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        assert_eq!(state(&mut lead, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#), Some("permission"));
        assert_eq!(lead.answer_state(), "working");
    }

    /// A Claude session asking permission for a Bash tool it started as `t1`.
    fn asking() -> Session {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#), Some("permission"));
        s
    }

    #[test]
    fn view025b2_a_claude_deny_from_a_card_settles_interrupted_and_nothing_else_does() {
        let mut s = asking();
        assert_eq!(s.answer(Agent::Claude, false), "working");
        assert!(!s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS - 1), "Claude gets its moment first");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS), "Esc fires no hook: the quiet turn was interrupted");
        assert_eq!(s.resolved(), "interrupted");
        // Approve (Enter) and Codex's n (its turn goes on and keeps reporting) mark no cancel.
        let mut s = asking();
        assert_eq!(s.answer(Agent::Claude, true), "working");
        assert!(!s.settle_cancel(u64::MAX) && s.resolved() == "working");
        let mut s = asking();
        assert_eq!(s.answer(Agent::Codex, false), "working");
        assert!(!s.settle_cancel(u64::MAX) && s.resolved() == "working");
    }

    #[test]
    fn view025b2_a_stop_or_a_fresh_tool_inside_the_grace_after_a_deny_is_never_read_as_interrupted() {
        let mut s = asking();
        s.answer(Agent::Claude, false);
        assert!(s.cancelled, "the deny is marked as a cancel");
        let at = s.cancelled_at;
        // The denied tool's own late report proves nothing; a PreToolUse with a new id is the turn going on.
        state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"t1","error":"denied"}"#);
        assert!(s.cancelled, "the denied tool's own report inside the grace leaves the cancel standing");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"t2"}"#), Some("working"));
        assert!(!s.settle_cancel(at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "working");
        let mut s = asking();
        s.answer(Agent::Claude, false);
        let at = s.cancelled_at;
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        assert!(!s.settle_cancel(at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "done");
    }

    #[test]
    fn view025b3_esc_typed_at_a_claude_permission_prompt_settles_interrupted_like_a_card_deny() {
        let mut s = asking();
        assert!(s.answerable());
        s.typed_cancel();
        assert!(s.cancelled, "the typed Esc answered the prompt and marked the cancel");
        assert_eq!(s.resolved(), "working", "the prompt is gone");
        assert!(!s.answerable());
        assert!(!s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS - 1), "Claude gets its moment first");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS), "Claude fires no hook after Esc: the quiet turn was interrupted");
        assert_eq!(s.resolved(), "interrupted");
        // Codex keeps its own prompt: its turn goes on and reports, so nothing is marked.
        let mut c = Session::default();
        c.apply(Agent::Codex, &ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#));
        c.apply(Agent::Codex, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#));
        assert_eq!(c.resolved(), "permission");
        c.typed_cancel();
        assert!(!c.cancelled && !c.settle_cancel(u64::MAX));
        assert_eq!(c.resolved(), "permission");
        // A working Claude lead keeps STAT-028's rule.
        let mut w = Session::default();
        state(&mut w, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        w.typed_cancel();
        assert!(w.cancelled);
        assert!(w.settle_cancel(w.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(w.resolved(), "interrupted");
    }

    #[test]
    fn view025b3_a_deny_whose_grace_ran_out_before_the_tick_settles_before_the_next_event_is_judged() {
        let mut s = asking();
        s.answer(Agent::Claude, false);
        s.cancelled_at -= CANCEL_GRACE_MS + 1;
        // The denied tool's own report lands past the grace but before settle_cancels ticks.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"t1","error":"denied"}"#), Some("interrupted"));
        assert_eq!((s.resolved(), s.interrupted, s.cancelled), ("interrupted", true, false));
        assert_eq!(s.history.back().map(|e| (e.state, e.interrupted)), Some(("interrupted", true)));
        // A fresh tool after the settled interrupt is the turn going on, as for any settled interrupt.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"t2"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted), ("working", false));
        assert!(s.history.back().is_some_and(|e| e.state == "working"), "the misread interrupted line is gone");
    }

    #[test]
    fn view025b4_the_denied_tools_post_never_counts_as_the_turn_going_on_however_the_cancel_settled() {
        // Settled by the tick: the denied tool's late report must not undo the interrupt.
        let mut s = asking();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"t1","error":"denied"}"#), None);
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        // Settled by apply itself (grace ran out before the tick): same verdict.
        let mut s = asking();
        s.answer(Agent::Claude, false);
        s.cancelled_at -= CANCEL_GRACE_MS + 1;
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"t1"}"#), Some("interrupted"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"t1"}"#), None);
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        // A typed Esc at the prompt goes through answer() and gets the same rule.
        let mut s = asking();
        s.typed_cancel();
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"t1","error":"denied"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        // Only the denied tool is exempt: another pre-cancel tool's Post past the grace is the turn going on.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"t0"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read","tool_use_id":"t0"}"#), Some("working"));
        // A new turn forgets the denial.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        assert!(s.denied.is_empty());
    }

    #[test]
    fn view025b4_a_user_esc_while_working_judges_the_killed_tools_post_the_same_before_or_after_the_tick() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        assert!(s.denied.is_empty(), "no permission prompt, nothing denied");
        // Past the grace, before any tick: apply settles first, then the Post is the turn going on (as after a tick).
        s.cancelled_at -= CANCEL_GRACE_MS + 1;
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted, s.cancelled), ("working", false, false));
        assert_eq!(s.history.back().map(|e| e.state), Some("working"));
    }

    #[test]
    fn p80_a_deny_of_a_sub_agents_prompt_or_of_the_leads_while_a_child_works_settles_the_pane_interrupted() {
        // (a) a card Deny of child A's prompt: the whole turn was interrupted, the roster empties.
        let mut s = child_asking();
        assert_eq!(s.answer(Agent::Claude, false), "working");
        assert!(s.cancelled, "the deny is marked even though the answered child is working");
        assert!(!s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS - 1), "Claude gets its moment first");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "interrupted");
        assert!(s.children.is_empty(), "the children still working or asking are parked");
        // The denied tool's late report from a parked child is ignored.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","agent_id":"a","tool_name":"Bash","tool_use_id":"c1"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        // (c) a typed Esc at A's prompt is the same deny.
        // A working sibling B must not make the typed Esc a refused plain cancel (it did before the deny path).
        let mut s = child_asking();
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        s.typed_cancel();
        assert!(s.cancelled);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.resolved(), s.children.len()), ("interrupted", 0));
        // (d) a deny at the lead's prompt while child B works.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#), Some("permission"));
        s.answer(Agent::Claude, false);
        assert!(s.cancelled);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.resolved(), s.children.len()), ("interrupted", 0));
    }

    #[test]
    fn p80_a_sub_agents_sign_of_life_inside_the_grace_drops_the_deny_cancel() {
        // (b) a fresh PreToolUse from A, or a new SubagentStart, after the deny.
        let mut s = child_asking();
        s.answer(Agent::Claude, false);
        let at = s.cancelled_at;
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a","tool_name":"Read","tool_use_id":"c2"}"#), Some("working"));
        assert!(!s.cancelled, "the cancel is dropped");
        assert!(!s.settle_cancel(at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "working");
        let mut s = child_asking();
        s.answer(Agent::Claude, false);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"z","agent_type":"w"}"#);
        assert!(!s.cancelled && !s.settle_cancel(u64::MAX));
        assert_eq!(s.resolved(), "working");
        // A child's Post never counts.
        let mut s = child_asking();
        s.answer(Agent::Claude, false);
        state(&mut s, r#"{"hook_event_name":"PostToolUse","agent_id":"a","tool_name":"Bash","tool_use_id":"c1"}"#);
        assert!(s.cancelled, "a child's Post proves nothing");
    }

    #[test]
    fn p80_a_plain_esc_while_a_child_works_is_still_refused() {
        // (e) STAT-028: nothing is concluded while a child works.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        s.cancel();
        assert!(!s.cancelled && !s.settle_cancel(u64::MAX));
        s.typed_cancel();
        assert!(!s.cancelled, "no prompt stands, so a typed Esc is a plain cancel");
        assert_eq!(s.resolved(), "working");
    }

    #[test]
    fn p80_the_denied_tool_is_found_by_name_and_input_not_by_the_last_one_started() {
        // (f) two parallel WebFetch calls; the prompt is for t1's url, t2 started last.
        let fetch = |id: &str, url: &str| format!(r#"{{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_use_id":"{id}","tool_input":{{"url":"{url}"}}}}"#);
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, &fetch("t1", "https://a.example"));
        state(&mut s, &fetch("t2", "https://b.example"));
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"WebFetch","tool_input":{"url":"https://a.example"}}"#);
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"WebFetch","tool_use_id":"t1","error":"denied"}"#), None);
        assert_eq!(s.resolved(), "interrupted", "the denied t1's late report does not undo the interrupt");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"WebFetch","tool_use_id":"t2"}"#), Some("working"));
        // (g) a child's denied tool reporting after the settle changes nothing.
        let mut s = child_asking();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","agent_id":"a","tool_name":"Bash","tool_use_id":"c1","error":"denied"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
    }

    #[test]
    fn p80_the_denied_set_holds_every_started_id_of_the_asker_that_matches_and_is_bounded_and_cleared() {
        let pre = |agent: &str, id: &str, cmd: &str| format!(r#"{{"hook_event_name":"PreToolUse",{agent}"tool_name":"Bash","tool_use_id":"{id}","tool_input":{{"command":"{cmd}"}}}}"#);
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        state(&mut s, &pre("", "l1", "ls"));
        state(&mut s, &pre(r#""agent_id":"a","#, "c1", "ls"));
        state(&mut s, &pre(r#""agent_id":"a","#, "c2", "make"));
        state(&mut s, &pre(r#""agent_id":"a","#, "c3", "ls"));
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash","tool_input":{"command":"ls"}}"#);
        s.answer(Agent::Claude, false);
        assert_eq!(s.denied, vec!["c1", "c3"], "only the asker's started tools with that name and input, not the lead's l1 or c2");
        // No match: the asker's last started tool.
        let mut s = child_asking();
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash","tool_input":{"command":"never started"}}"#);
        s.answer(Agent::Claude, false);
        assert_eq!(s.denied, vec!["c1"]);
        // Bounded by MAX_TOOLS, and a new turn forgets the record.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        for i in 0..MAX_TOOLS + 5 {
            state(&mut s, &pre("", &format!("x{i}"), "ls"));
        }
        assert_eq!(s.started.len(), MAX_TOOLS);
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        assert!(s.started.is_empty());
    }

    /// A Claude lead working with sub-agent `a`, which asks permission for a Bash tool it started as `c1`.
    fn child_asking() -> Session {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a","tool_name":"Bash","tool_use_id":"c1"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash"}"#), Some("permission"));
        s
    }

    /// A Claude lead running a Task `t0` with sub-agent `b` inside one Bash tool, then asking permission for its own Bash `t1`.
    fn lead_asking_while_b_works() -> Session {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Task","tool_use_id":"t0"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"b","tool_name":"Bash","tool_use_id":"b1"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#), Some("permission"));
        s
    }

    fn ids(s: &Session) -> Vec<&str> {
        s.children.iter().map(|c| c.id.as_str()).collect()
    }

    #[test]
    fn p81_a_child_a_deny_settle_set_aside_is_announced_and_answered_when_it_finishes() {
        let mut s = lead_asking_while_b_works();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.resolved(), s.children.len()), ("interrupted", 0));
        let (_, announce) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"b","last_assistant_message":"all set"}"#)).unwrap();
        assert_eq!(announce.as_deref(), Some("w"), "B's finish is announced by role");
        assert_eq!(s.reply.as_deref(), Some("all set"));
        // B's next tool is heard too: it is back on the roster, though the lead stays interrupted.
        let mut s = lead_asking_while_b_works();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"b","tool_name":"Read","tool_use_id":"b2"}"#);
        assert_eq!((ids(&s), s.resolved()), (vec!["b"], "interrupted"));
    }

    #[test]
    fn p81_undoing_the_interrupt_brings_the_set_aside_children_back() {
        let mut s = lead_asking_while_b_works();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert!(s.children.is_empty());
        // The lead's Task finishing past the grace is the turn going on.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Task","tool_use_id":"t0"}"#), Some("working"));
        assert_eq!((ids(&s), s.resolved(), s.interrupted), (vec!["b"], "working", false));
        // A new prompt does not put them back (Esc may really have killed them); their own event does (p82).
        let mut s = lead_asking_while_b_works();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        assert!(s.children.is_empty());
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"b","tool_name":"Read","tool_use_id":"b2"}"#);
        assert_eq!(ids(&s), vec!["b"]);
    }

    #[test]
    fn p81_a_plain_cancel_that_settles_leaves_the_roster_as_it_was() {
        // A child at a prompt: Esc settles the lead, the child still asks.
        let mut s = child_asking();
        s.cancel();
        assert!(s.cancelled);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((ids(&s), s.resolved()), (vec!["a"], "permission"));
        // An idle teammate stays too.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"TeammateIdle","agent_id":"a"}"#);
        s.cancel();
        assert!(s.cancelled);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.children.iter().map(|c| (c.id.as_str(), c.state)).collect::<Vec<_>>(), vec![("a", "idle")]);
    }

    #[test]
    fn p81_a_deny_settle_sets_a_waiting_child_aside_and_both_readings_say_interrupted() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        // Only a Codex child reports "waiting" (its request_user_input tool).
        let waiting = s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"PreToolUse","agent_id":"b","tool_name":"request_user_input"}"#)).map(|(c, _)| c.state);
        assert_eq!(waiting, Some("waiting"));
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);
        s.answer(Agent::Claude, false);
        s.cancelled_at -= CANCEL_GRACE_MS + 1;
        const KEY: u32 = 4_081_001;
        with_sessions(|m| m.insert(KEY, s));
        let settled = settle_cancels().into_iter().find(|x| x.pane_key == KEY).expect("the deny settled");
        let resolved = with_sessions(|m| m.remove(&KEY)).map(|x| x.resolved());
        assert_eq!((settled.change.state, resolved), ("interrupted", Some("interrupted")));
        assert!(settled.children.is_empty());
    }

    #[test]
    fn p81_the_set_aside_children_are_bounded_and_a_new_turn_clears_them() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#);
        for i in 0..MAX_CHILDREN + 3 {
            state(&mut s, &format!(r#"{{"hook_event_name":"SubagentStart","agent_id":"c{i}","agent_type":"w"}}"#));
        }
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.children.len(), s.parked.len()), (0, MAX_CHILDREN));
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        assert!(s.children.is_empty() && s.parked.len() == MAX_CHILDREN && s.parked.iter().all(|p| !p.1), "kept for their own events, no longer this turn's");
    }

    /// `lead_asking_while_b_works`, denied at the lead's prompt and settled: B is set aside.
    fn b_set_aside() -> Session {
        let mut s = lead_asking_while_b_works();
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert!(s.children.is_empty());
        s
    }

    fn parked_ids(s: &Session) -> Vec<String> {
        s.parked.iter().map(|p| p.0.id.clone()).collect()
    }

    #[test]
    fn p82_a_set_aside_child_survives_the_next_prompt_and_is_still_announced_when_it_finishes() {
        let mut s = b_set_aside();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"next"}"#);
        let (_, announce) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"b","last_assistant_message":"done late"}"#)).expect("B is heard after the new prompt");
        assert_eq!(announce.as_deref(), Some("w"));
        assert_eq!(s.reply.as_deref(), Some("done late"));
        // The same through an in-band working.
        let mut s = b_set_aside();
        s.inband("working");
        assert!(s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"b"}"#)).is_some_and(|(_, a)| a.as_deref() == Some("w")));
    }

    #[test]
    fn p82_an_earlier_turns_set_aside_child_is_not_put_back_by_a_later_turns_undo_but_its_own_event_still_brings_it() {
        let mut s = b_set_aside();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Task","tool_use_id":"t9"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"c","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t10"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert!(s.children.is_empty());
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Task","tool_use_id":"t9"}"#), Some("working"));
        assert_eq!((ids(&s), parked_ids(&s)), (vec!["c"], vec!["b".to_string()]), "this turn's child is back; B stays set aside");
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"b","tool_name":"Read","tool_use_id":"b2"}"#);
        assert_eq!(ids(&s), vec!["c", "b"]);
        assert!(s.parked.is_empty());
    }

    #[test]
    fn p82_a_set_aside_child_asking_again_moves_the_pane_out_of_interrupted_and_the_history_says_so() {
        // A answered the deny; sibling A2 still asks when the settle sets both aside.
        let mut s = child_asking();
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a2","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a2","tool_name":"Bash"}"#);
        s.answer(Agent::Claude, false);
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.children.len(), parked_ids(&s).len()), (0, 2));
        assert_eq!(s.history.back().map(|e| e.state), Some("interrupted"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a2","tool_name":"Bash"}"#), Some("permission"));
        assert_eq!(s.history.back().map(|e| e.state), Some("permission"), "the change out of interrupted is recorded");
    }

    /// B set aside by a deny, then a roster of MAX_CHILDREN idle children.
    fn b_set_aside_behind_a_full_idle_roster() -> Session {
        let mut s = b_set_aside();
        for i in 0..MAX_CHILDREN {
            state(&mut s, &format!(r#"{{"hook_event_name":"SubagentStart","agent_id":"c{i}","agent_type":"w"}}"#));
            state(&mut s, &format!(r#"{{"hook_event_name":"TeammateIdle","agent_id":"c{i}"}}"#));
        }
        assert!(s.children.len() == MAX_CHILDREN && s.children.iter().all(|c| c.state == "idle"));
        s
    }

    #[test]
    fn p82_a_full_roster_of_settled_children_makes_room_for_a_set_aside_child_that_speaks() {
        let mut s = b_set_aside_behind_a_full_idle_roster();
        let (_, announce) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"b","last_assistant_message":"late"}"#)).expect("B is heard");
        assert_eq!(announce.as_deref(), Some("w"));
        assert_eq!(s.reply.as_deref(), Some("late"));
        assert!(!s.children.iter().any(|c| c.id == "c0"), "the oldest settled child made room");
        // A roster full of working children ignores the event as before.
        let mut s = b_set_aside();
        for i in 0..MAX_CHILDREN {
            state(&mut s, &format!(r#"{{"hook_event_name":"SubagentStart","agent_id":"c{i}","agent_type":"w"}}"#));
        }
        assert!(s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"b"}"#)).is_none());
        assert_eq!((s.children.len(), s.parked.len()), (MAX_CHILDREN, 1));
    }

    #[test]
    fn p82_a_restarted_child_is_never_on_the_roster_and_in_the_set_aside_list_at_once() {
        let mut s = b_set_aside_behind_a_full_idle_roster();
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        let on_roster = s.children.iter().filter(|c| c.id == "b").count();
        let set_aside = parked_ids(&s).iter().filter(|p| *p == "b").count();
        assert_eq!((on_roster, set_aside), (1, 0));
        // And with room on the roster.
        let mut s = b_set_aside();
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        assert_eq!((ids(&s), s.parked.len()), (vec!["b"], 0));
    }

    #[test]
    fn p82_a_plain_cancel_that_settles_ticks_the_childs_permission_not_interrupted() {
        const KEY: u32 = 4_082_001;
        let mut s = child_asking();
        s.cancel();
        assert!(s.cancelled);
        s.cancelled_at -= CANCEL_GRACE_MS + 1;
        with_sessions(|m| m.insert(KEY, s));
        let settled = settle_cancels().into_iter().find(|x| x.pane_key == KEY).expect("the cancel settled");
        with_sessions(|m| m.remove(&KEY));
        assert_eq!(settled.change.state, "permission");
        assert_eq!(settled.children.len(), 1);
    }

    #[test]
    fn fix_before1_one_child_asks_answer_state_is_working() {
        // Stand-in review of chat 1e9613e, FIX-BEFORE 1: the card answered the only asking sub-agent,
        // so the pane is working, nothing is left to answer, and that child's next tool is heard.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash"}"#), Some("permission"));
        assert_eq!(s.answer_state(), "working");
        assert!(!s.answerable());
        assert_eq!(s.resolved(), "working");
        // After a Deny the child moves on to another tool; that event is no longer dropped.
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","agent_id":"a","tool_name":"Write"}"#)).unwrap();
        assert_eq!((c.state, c.tool.as_deref()), ("working", Some("Write")));
    }

    #[test]
    fn fix_before1_answering_a_sub_agent_leaves_the_leads_own_menu_standing() {
        // The card answers the sub-agent it names; the lead's own menu still asks, so the pane stays
        // "permission" and keeps holding its keys (fails closed). The next answer is the lead's.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Edit"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"w"}"#);
        state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a","tool_name":"Bash"}"#);
        assert_eq!(s.answer_state(), "permission");
        assert!(s.answerable());
        assert_eq!(s.answer_state(), "working");
        assert!(!s.answerable());
    }

    // ---- T-585 (R02-hooks-status.2): a helper agent whose stop never arrives ----

    #[test]
    fn t585_a_helper_stopped_by_an_escape_with_its_turn_does_not_keep_later_turns_working() {
        // Esc while Claude runs a helper stops both, and Claude sends neither the helper's stop nor the lead's.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"review the branch"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"code-reviewer"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Read","tool_use_id":"r1"}"#);
        s.typed_cancel();
        assert_eq!(s.resolved(), "working", "STAT-028: nothing is concluded while a child works");
        // The next prompt starts a new turn without the helper, and when that turn ends the pane reads done.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"just fix the typo"}"#), Some("working"));
        assert!(s.children.is_empty(), "the helper stopped with the old turn is off the roster");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"fixed"}"#), Some("done"));
        // A later turn with a helper of its own is shown as before.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a2","agent_type":"tester"}"#);
        assert_eq!(ids(&s), vec!["a2"]);
        // Round 1 review: a1 was set aside, not lost. A background helper or teammate the Esc did not stop
        // comes back with its own next event, so its later work and questions still show.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"review the branch"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"code-reviewer"}"#);
        s.typed_cancel();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"just fix the typo"}"#);
        assert!(s.children.is_empty() && parked_ids(&s) == ["a1"], "set aside, not deleted");
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Bash","tool_use_id":"r9"}"#);
        assert_eq!(ids(&s), vec!["a1"], "its own event brings it back onto the roster");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a1","tool_name":"Bash","tool_use_id":"r9"}"#), Some("permission"));
    }

    #[test]
    fn t585_a_helper_heard_from_after_the_escape_or_outliving_its_lead_stays() {
        // The helper reports after the Esc: the Esc did not stop it, so the next prompt keeps it.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"review"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"w"}"#);
        s.typed_cancel();
        state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Read","tool_use_id":"r2"}"#);
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"and then"}"#);
        assert_eq!(ids(&s), vec!["a1"]);
        // STAT-026 box 1: with no Esc, a helper that outlives the lead's turn keeps the pane working, a new prompt included.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"b","agent_type":"w"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"next"}"#), Some("working"));
        assert_eq!(ids(&s), vec!["b"]);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("working"), "b still works");
    }
}
